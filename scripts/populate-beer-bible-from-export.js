// Populates scripts/beer-bible-seed-data.json from a real product export
// (WinePOS CSV/TSV, or an .xlsx/.xlsm workbook exported the same way) by
// running each row's title through the exact same Untappd search Search by
// Name/SKU Lookup/Scan UPC already use (enrichBeerFromUntappd in
// server/productImport.js) - same matching, same "found nothing beats a
// wrong answer" rule: a row Untappd can't confidently match is logged and
// skipped, never filled in with a guess.
//
// This is a network-heavy, one-off admin tool (not run automatically, not
// bundled into the installer - see package.json's build.files, which lists
// only the seed *data* JSON, not this script) meant to be run by hand on a
// PC with normal internet access, since untappd.com/Algolia may not be
// reachable from every environment (confirmed blocked outright in the
// sandboxed session that wrote this script - see the PR/commit this shipped
// in for the full story). Safe to interrupt and re-run: every successful
// match is written to the seed file immediately (not batched to the end),
// and --skip-existing (the default) skips a row whose SKU is already in the
// seed file so a resumed run doesn't re-search titles it already has.
//
// Usage:
//   npm install                     # pulls in the xlsx devDependency below
//   node scripts/populate-beer-bible-from-export.js <path-to-export> [options]
//
// Options:
//   --start N        Skip the first N data rows (default 0)
//   --limit N        Process at most N data rows (default: all)
//   --delay-ms N      Pause between rows, milliseconds (default 400)
//   --no-skip-existing  Re-check every row even if its SKU is already saved
//
// Column matching reuses upcCatalog.js's own FIELD_ALIASES-driven matching
// (parseDelimited/matchColumns) for CSV/TSV, and the same alias lists
// against an .xlsx sheet's header row - so this recognizes the same
// "Title/Description/Product Name/...", "SKU/Store SKU/Item Number/...",
// "Size/Unit Size/..." header variations the rest of the app already does,
// not just this one export's exact column names.

const fs = require('fs');
const path = require('path');
const { parseDelimited, matchColumns } = require('../server/upcCatalog');
const { enrichBeerFromUntappd } = require('../server/productImport');

const SEED_PATH = path.join(__dirname, 'beer-bible-seed-data.json');
const LOG_PATH = path.join(__dirname, 'beer-bible-import.log.jsonl');

function parseArgs(argv) {
  const opts = {
    start: 0, limit: Infinity, delayMs: 400, skipExisting: true,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--start') opts.start = Number(argv[++i]);
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
    else if (arg === '--delay-ms') opts.delayMs = Number(argv[++i]);
    else if (arg === '--no-skip-existing') opts.skipExisting = false;
    else positional.push(arg);
  }
  if (!positional[0]) {
    console.error('Usage: node scripts/populate-beer-bible-from-export.js <path-to-export> [--start N] [--limit N] [--delay-ms N] [--no-skip-existing]');
    process.exit(1);
  }
  opts.filePath = positional[0];
  return opts;
}

// Reads an .xlsx/.xlsm workbook's first sheet into the same
// [headerRow, ...dataRows] shape parseDelimited returns for CSV/TSV, so
// both formats can share one column-matching/extraction path below.
function readWorkbookRows(filePath) {
  // eslint-disable-next-line global-require -- optional devDependency, only
  // needed for the .xlsx branch; a CSV/TSV-only run never requires this.
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
}

function readRows(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xlsx' || ext === '.xlsm') return readWorkbookRows(filePath);
  return parseDelimited(fs.readFileSync(filePath, 'utf-8'));
}

// Extracts {title, size, sku} per data row using the app's own column
// aliases (see matchColumns/FIELD_ALIASES in upcCatalog.js) - title/sku/
// size are the only fields this needs; brand/price/etc. aliases are matched
// too but simply unused here.
function extractProducts(rows) {
  if (rows.length < 2) return [];
  const colFor = matchColumns(rows[0]);
  return rows.slice(1)
    .map((row) => ({
      title: (colFor.title !== undefined ? row[colFor.title] : '') || '',
      size: (colFor.size !== undefined ? row[colFor.size] : '') || '',
      sku: (colFor.sku !== undefined ? row[colFor.sku] : '') || '',
    }))
    .map((p) => ({ title: String(p.title).trim(), size: String(p.size).trim(), sku: String(p.sku).trim() }))
    .filter((p) => p.title);
}

function loadSeed() {
  try {
    return JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveSeed(entries) {
  fs.writeFileSync(SEED_PATH, `${JSON.stringify(entries, null, 2)}\n`);
}

// Same case-insensitive-title upsert rule as server/db.js's own
// upsertBeer, applied here to the seed *file* so re-running this script
// (or running it twice against overlapping rows) refreshes an entry in
// place instead of duplicating it.
function upsertEntry(entries, entry) {
  const idx = entries.findIndex((e) => e.title.trim().toLowerCase() === entry.title.trim().toLowerCase());
  if (idx === -1) entries.push(entry);
  else entries[idx] = entry;
}

function appendLog(obj) {
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(obj)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  const allProducts = extractProducts(readRows(opts.filePath));
  console.log(`Read ${allProducts.length} rows with a title from ${opts.filePath}.`);

  const seed = loadSeed();
  const existingSkus = new Set(seed.map((e) => e.sku).filter(Boolean));

  const slice = allProducts.slice(opts.start, opts.start + opts.limit);
  let matched = 0;
  let noMatch = 0;
  let ambiguous = 0;
  let errored = 0;
  let skipped = 0;

  for (let i = 0; i < slice.length; i += 1) {
    const product = slice[i];
    const rowNum = opts.start + i;

    if (opts.skipExisting && product.sku && existingSkus.has(product.sku)) {
      skipped += 1;
    } else {
      try {
        // eslint-disable-next-line no-await-in-loop -- deliberately
        // sequential: a single, paced stream of requests is the whole
        // point (see the --delay-ms note above), not a burst.
        const result = await enrichBeerFromUntappd({ title: product.title, size: product.size });
        if (result.untappdError) {
          noMatch += 1;
          appendLog({
            row: rowNum, sku: product.sku, title: product.title, status: 'no-match', detail: result.untappdError,
          });
        } else if (result.untappdCandidates) {
          ambiguous += 1;
          appendLog({
            row: rowNum,
            sku: product.sku,
            title: product.title,
            status: 'ambiguous',
            candidates: result.untappdCandidates.map((c) => c.title || c.beerName),
          });
        } else {
          matched += 1;
          upsertEntry(seed, {
            title: result.title,
            brewery: result.brewery || '',
            location: result.location || '',
            style: result.style || '',
            abv: result.abv || '',
            ibu: result.ibu || '',
            untappdRating: result.untappdRating || '',
            untappdRatingCount: result.untappdRatingCount || '',
            description: result.description || '',
            sku: product.sku || '',
            source: 'Untappd',
          });
          if (product.sku) existingSkus.add(product.sku);
          // Written after every match, not batched to the end, so an
          // interrupted run still leaves everything found so far in a
          // valid, usable seed file (see this file's header comment).
          saveSeed(seed);
          appendLog({
            row: rowNum, sku: product.sku, title: product.title, status: 'matched', matchedTitle: result.title,
          });
        }
      } catch (err) {
        errored += 1;
        appendLog({
          row: rowNum, sku: product.sku, title: product.title, status: 'error', detail: err.message,
        });
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(opts.delayMs);
    }

    if ((i + 1) % 25 === 0 || i === slice.length - 1) {
      console.log(`  ${i + 1}/${slice.length} - matched ${matched}, no-match ${noMatch}, ambiguous ${ambiguous}, error ${errored}, skipped (already saved) ${skipped}`);
    }
  }

  console.log(`\nDone. Seed file now has ${seed.length} beers (${SEED_PATH}).`);
  console.log(`This run: ${matched} matched, ${noMatch} no Untappd match, ${ambiguous} ambiguous (multiple candidates), ${errored} errored, ${skipped} already saved.`);
  if (noMatch || ambiguous || errored) {
    console.log(`Rows that weren't saved are logged in ${LOG_PATH} for manual follow-up.`);
  }
}

run().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
