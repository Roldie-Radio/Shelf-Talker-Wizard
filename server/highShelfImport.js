// Runs The High Shelf's "Import from Export File..." (its own library page)
// - reads a raw THC/CBD product export (CSV/TSV, or an Excel .xlsx/.xlsm
// workbook), the kind of file that has NO header row at all: column A is a
// store SKU, column B is the product's own title (which already encodes its
// THC mg and pack count, e.g. "ALTE THC BLACKBERRY LEMON VANILLA 10MG 4PK
// CAN"), and the rest are cost/retail/case-price columns this feature
// doesn't use. Unlike the Beer Bible's own raw-export import
// (beerBibleImport.js), there's no live per-row lookup here - no external
// data source exists for this category - so this is entirely synchronous,
// no job/polling/cancel machinery needed, same shape as importBeerBibleCsv.
//
// Deliberately narrow about what it fills in: THC mg and Servings come
// straight from the title text itself (as reliable as the export it's
// already trusting for SKU/title), everything else - CBD content, Lab
// Tested status - is left blank rather than guessed at zero. A THC beverage
// can just as easily be a 1:1 THC:CBD wellness tonic as a THC-only seltzer
// (see BREZ Drift, whose title says "5MG" but is actually 5mg THC + 75mg
// CBD), so printing a wrong "0mg CBD" on a shelf talker would be worse than
// printing nothing. Staff fill those in by hand afterward (Add/Edit on The
// High Shelf page, or the Edit Talker recall banner once a title matches).
const fs = require('fs');
const path = require('path');
const { parseDelimited } = require('./upcCatalog');
const { upsertHighShelfEntry } = require('./db');

// Same recipe as beerBibleImport.js's own readWorkbookRows/readRows - reads
// either format into one [row, ...] shape (arrays of raw cell strings, no
// header row assumed) so extractHighShelfRows below doesn't care which kind
// of file it got.
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

// Matches "10MG", "5 MG", "(50MG)" - the one potency fact these exports
// always encode, since it's part of how the product itself is labeled and
// sold. Takes the first mg number in the title; a title naming two (rare)
// isn't something this can disambiguate, same "don't guess" reasoning as
// CBD above.
function parseThcMgFromTitle(title) {
  const m = String(title || '').match(/(\d+(?:\.\d+)?)\s*MG/i);
  return m ? m[1] : '';
}

// Matches "4PK"/"12PK" (pack count) or "4K CAN" - some brands' own POS
// titles (Crescent 9 among them) abbreviate a 4-pack that way instead of
// "4PK". A THC beverage is dosed per-can, so a pack's own SKU is read as
// that many servings, the same way a can counts as one serving on the
// printed talker.
function parseServingsFromTitle(title) {
  const m = String(title || '').match(/(\d+)\s*(?:PK|K\s*CAN)\b/i);
  return m ? m[1] : '';
}

function extractHighShelfRows(rows) {
  return rows
    .map((row) => ({ sku: String((row && row[0]) || '').trim(), title: String((row && row[1]) || '').trim() }))
    .filter((r) => r.title)
    .map((r) => ({
      title: r.title,
      sku: r.sku,
      thcMg: parseThcMgFromTitle(r.title),
      servings: parseServingsFromTitle(r.title),
    }));
}

// Upserts every row (same SKU-first/title-second matching as any other save
// to The High Shelf - see upsertHighShelfEntry in db.js), then reports back
// how much of the file actually had a usable THC mg/pack count in its title
// so staff know how much is left to fill in by hand.
function importHighShelfExport(filePath) {
  const rows = readRows(filePath);
  const candidates = extractHighShelfRows(rows);
  candidates.forEach((c) => {
    upsertHighShelfEntry({
      title: c.title, source: 'Export File', sku: c.sku, thcMg: c.thcMg, servings: c.servings,
    });
  });
  return {
    total: rows.length,
    imported: candidates.length,
    skipped: rows.length - candidates.length,
    missingThcMg: candidates.filter((c) => !c.thcMg).length,
    missingServings: candidates.filter((c) => !c.servings).length,
  };
}

module.exports = {
  importHighShelfExport, extractHighShelfRows, parseThcMgFromTitle, parseServingsFromTitle,
};
