// Runs the Beer Bible import job (Advanced -> Import Beer Bible from
// Export File...) - the in-app equivalent of
// scripts/populate-beer-bible-from-export.js, for a store PC running the
// packaged app rather than a developer with a checkout and a system-wide
// Node install. Unlike that script (which writes into the repo's own
// scripts/beer-bible-seed-data.json, meant to be committed and shared via
// GitHub sync - see beerBibleSeed.js), this writes straight into this PC's
// own local `beers` table via upsertBeer, the same table /api/beers
// already reads and writes - so an import here shows up on the Beer Bible
// screen immediately, no restart and no GitHub round-trip needed.
//
// Same matching as everywhere else: every row's title runs through the
// exact same Untappd search Search by Name/SKU Lookup/Scan UPC already use
// (enrichBeerFromUntappd in productImport.js), and a row Untappd can't
// confidently match (no match, or a genuine tie) is skipped rather than
// guessed at.
//
// One job at a time, tracked in memory (module-level state, not persisted
// to disk) - closing the dialog (or even reloading the page) doesn't stop
// the job, it just stops watching it; getStatus() below always reflects
// whatever's actually running server-side, so reopening the dialog picks
// the live progress back up.
const fs = require('fs');
const path = require('path');
const { parseDelimited, matchColumns } = require('./upcCatalog');
const { enrichBeerFromUntappd } = require('./productImport');

const DELAY_MS = 400;
// Caps how many skipped/errored rows this keeps around for the dialog's
// own "what happened" summary - a 2500-row file with a bad query pattern
// could otherwise pile up thousands of these in memory for the life of the
// process. The running counts (noMatch/ambiguous/errored below) are never
// capped, only this detail list.
const MAX_RECENT_ISSUES = 50;

function freshStatus() {
  return {
    running: false,
    filePath: null,
    total: 0,
    processed: 0,
    matched: 0,
    noMatch: 0,
    ambiguous: 0,
    errored: 0,
    skipped: 0,
    currentTitle: '',
    startedAt: null,
    finishedAt: null,
    cancelled: false,
    fatalError: null,
    recentIssues: [],
  };
}

let status = freshStatus();
let cancelRequested = false;

function getStatus() {
  return { ...status };
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Reads an .xlsx/.xlsm workbook's first sheet into the same
// [headerRow, ...dataRows] shape parseDelimited returns for CSV/TSV, so
// both formats share one column-matching/extraction path below - same
// approach as scripts/populate-beer-bible-from-export.js.
function readWorkbookRows(filePath) {
  // eslint-disable-next-line global-require -- only needed for the
  // .xlsx/.xlsm branch; a CSV/TSV-only run never requires this.
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

// Same alias-driven column matching as upcCatalog.js's own Scan UPC/Search
// by Name reads use (FIELD_ALIASES), so this recognizes the same
// "Title/Description/Product Name/...", "SKU/Store SKU/Item Number/...",
// "Size/Unit Size/..." header variations the rest of the app already does.
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

function pushIssue(title, sku, kind, detail) {
  status.recentIssues.push({ title, sku, status: kind, detail });
  if (status.recentIssues.length > MAX_RECENT_ISSUES) status.recentIssues.shift();
}

// Only a SKU belonging to an already-*enriched* entry counts as "already
// handled" - one with a real brewery/style/ABV on file, not just a bare
// title+SKU stub (e.g. from a bulk pre-seed pass that only had the export
// itself to go on, no Untappd access yet - see scripts/beer-bible-seed-data.json's
// own history). Otherwise a stub's SKU would look "already saved" forever
// and a later real enrichment run would silently skip it - never actually
// getting enriched.
//
// A SKU already marked Variety Pack (see the beers table's variety_pack
// comment in db.js) counts as handled too, even with none of those fields
// filled in - a variety pack has no Untappd page to find, so running the
// search on it every import would just add another guaranteed no-match to
// the file's own noMatch count for no benefit.
function isEnriched(beer) {
  return !!(beer.varietyPack || beer.brewery || beer.style || beer.abv || beer.ibu || beer.untappdRating || beer.description);
}

async function runImport(products, db) {
  const existingSkus = new Set(db.listBeers().filter(isEnriched).map((b) => b.sku).filter(Boolean));

  for (let i = 0; i < products.length; i += 1) {
    if (cancelRequested) {
      status.cancelled = true;
      break;
    }
    const product = products[i];
    status.currentTitle = product.title;

    if (product.sku && existingSkus.has(product.sku)) {
      status.skipped += 1;
    } else {
      try {
        // eslint-disable-next-line no-await-in-loop -- deliberately
        // sequential and paced (see DELAY_MS below), not a burst.
        const result = await enrichBeerFromUntappd({ title: product.title, size: product.size });
        if (result.untappdError) {
          status.noMatch += 1;
          pushIssue(product.title, product.sku, 'no-match', result.untappdError);
        } else if (result.untappdCandidates) {
          status.ambiguous += 1;
          pushIssue(product.title, product.sku, 'ambiguous', result.untappdCandidates.map((c) => c.title || c.beerName).join(', '));
        } else {
          db.upsertBeer({
            title: result.title,
            beerName: result.beerName || '',
            brewery: result.brewery || '',
            location: result.location || '',
            style: result.style || '',
            abv: result.abv || '',
            ibu: result.ibu || '',
            untappdRating: result.untappdRating || '',
            untappdRatingCount: result.untappdRatingCount || '',
            description: result.description || '',
            sku: product.sku || '',
            source: 'Import',
          });
          if (product.sku) existingSkus.add(product.sku);
          status.matched += 1;
        }
      } catch (err) {
        status.errored += 1;
        pushIssue(product.title, product.sku, 'error', err.message);
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(DELAY_MS);
    }
    status.processed = i + 1;
  }

  status.running = false;
  status.currentTitle = '';
  status.finishedAt = new Date().toISOString();
}

// Kicks off a new import job. Rejects synchronously (before anything
// async starts) for a bad request - already running, no file, unreadable
// file, or a file with no recognizable title column - so the route
// handler can turn that straight into a 400/409 without waiting on
// anything. The actual row-by-row work is fire-and-forget from here on;
// getStatus() above is how the caller watches it.
function startImport({ filePath, db }) {
  if (status.running) {
    throw Object.assign(new Error('An import is already running.'), { code: 'ALREADY_RUNNING' });
  }
  if (!filePath || !String(filePath).trim()) {
    throw Object.assign(new Error('A file path is required.'), { code: 'FILE_REQUIRED' });
  }
  let rows;
  try {
    rows = readRows(filePath);
  } catch (err) {
    throw Object.assign(new Error(`Could not read that file: ${err.message}`), { code: 'FILE_UNREADABLE' });
  }
  const products = extractProducts(rows);
  if (!products.length) {
    throw Object.assign(new Error("Could not find a title column in that file's header row (looked for Title/Description/Product Name/... - see server/upcCatalog.js's FIELD_ALIASES)."), { code: 'NO_ROWS' });
  }

  cancelRequested = false;
  status = {
    ...freshStatus(),
    running: true,
    filePath,
    total: products.length,
    startedAt: new Date().toISOString(),
  };

  runImport(products, db).catch((err) => {
    // Only reachable for a bug in this loop itself, not a per-row failure
    // (those are caught individually above) - surfaces as a fatal error
    // on the status object rather than an unhandled rejection.
    status.running = false;
    status.fatalError = err.message;
    status.finishedAt = new Date().toISOString();
  });

  return getStatus();
}

function cancelImport() {
  if (status.running) cancelRequested = true;
  return getStatus();
}

module.exports = {
  getStatus, startImport, cancelImport, isEnriched,
  // Exported for tests only.
  extractProducts, readRows,
};
