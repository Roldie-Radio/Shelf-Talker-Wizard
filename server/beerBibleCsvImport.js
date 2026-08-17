// Backs the Beer Bible page's "Import CSV…" button (POST
// /api/beers/import-csv in server/index.js) - the round-trip counterpart to
// Export CSV (exportBeerBibleCsv in app.js): reads a CSV in that same
// shape back in, so a backup taken on one PC (or a spreadsheet someone
// hand-edited) can be brought back into the Beer Bible on this one - handy
// since there's no cross-register sync yet (see the beers table comment in
// db.js).
//
// Deliberately NOT the same thing as the Advanced menu's "Import Beer
// Bible from Export File…" (beerBibleImport.js): that one reads a raw
// WinePOS product export and runs a live Untappd search per row (slow,
// rate-limited, a progress dialog). This reads a file that already has
// every field filled in - a CSV this same page's own Export CSV produced,
// or one shaped like it - so it's a plain, fast, synchronous parse-and-
// upsert with no network calls at all.
//
// Matches columns by exact header text (case-insensitive, trimmed) rather
// than upcCatalog.js's alias-matching system - that system is tuned for
// the wide variety of real POS export header spellings; this only ever
// needs to recognize the one fixed set of headers Export CSV itself
// writes (see BEER_CSV_COLUMNS below), so an exact match is simpler and
// can't accidentally misfire on some unrelated file.
const { parseDelimited } = require('./upcCatalog');

// header text (lowercased) -> the field name upsertBeer expects. Source and
// Researched are deliberately left unmapped: Source in the file is
// BEER_SOURCE_LABELS' human text (see app.js), not the raw enum value
// upsertBeer actually stores, and Researched is derived from the other
// fields rather than a real column - reimporting either verbatim would be
// meaningless at best. Every imported row's source is set to 'Import'
// instead (see importBeerBibleCsv below), the same label a bulk product-
// export import already uses. Variety Pack IS reimported (see
// VARIETY_PACK_COLUMN/parseVarietyPackCell below) - unlike Researched, it's
// a real, staff-set column of its own, not a derived one.
const BEER_CSV_COLUMNS = {
  title: 'title',
  'beer name (untappd)': 'beerName',
  brewery: 'brewery',
  location: 'location',
  style: 'style',
  size: 'size',
  abv: 'abv',
  ibu: 'ibu',
  'untappd rating': 'untappdRating',
  'untappd rating count': 'untappdRatingCount',
  sku: 'sku',
  upc: 'upc',
  'tasting notes': 'description',
};

// Handled outside BEER_CSV_COLUMNS/the generic fields loop below, since
// every other column there is plain text ("only set it if the cell isn't
// blank" - see the fields loop's own comment) while this one is a
// Yes/No boolean Export CSV writes (see exportBeerBibleCsv in app.js) -
// a blank/"No" cell is still a meaningful value to import (explicitly not a
// variety pack), not "nothing to say" the way a blank Brewery cell is.
const VARIETY_PACK_COLUMN = 'variety pack';

function parseVarietyPackCell(raw) {
  return /^yes$/i.test((raw || '').trim());
}

function normalizeHeader(h) {
  return (h || '').trim().toLowerCase();
}

// Parses `csvText` and upserts one row at a time via the same upsertBeer
// every other Beer Bible save goes through (server/db.js) - so a row whose
// SKU (or, failing that, title) already matches an entry here merges into
// it exactly the way a repeat Add Beer/Edit save would, title never
// renamed by a SKU match, and a blank cell in the file never overwrites a
// fuller value already on file (only non-blank cells are ever included in
// what gets sent to upsertBeer - see the fields loop below, same "don't
// send what wasn't actually provided" rule beerAutoSaveFields in app.js
// uses for its own upsert). A row with no Title cell is skipped, never
// guessed at.
function importBeerBibleCsv(db, csvText) {
  const rows = parseDelimited(csvText);
  if (!rows.length) {
    const err = new Error('That file has no rows to import.');
    err.code = 'NO_ROWS';
    throw err;
  }
  const [headerRow, ...dataRows] = rows;
  const colFor = {};
  let varietyPackCol;
  headerRow.forEach((h, i) => {
    const normalized = normalizeHeader(h);
    if (normalized === VARIETY_PACK_COLUMN) {
      if (varietyPackCol === undefined) varietyPackCol = i;
      return;
    }
    const key = BEER_CSV_COLUMNS[normalized];
    if (key && colFor[key] === undefined) colFor[key] = i;
  });
  if (colFor.title === undefined) {
    const err = new Error('Could not find a "Title" column in that file - make sure it\'s a Beer Bible CSV export (or has its own Title column).');
    err.code = 'NO_TITLE_COLUMN';
    throw err;
  }

  let imported = 0;
  let skipped = 0;
  dataRows.forEach((row) => {
    if (!row.some((cell) => (cell || '').trim())) return; // a genuinely blank line - not worth counting either way
    const title = (row[colFor.title] || '').trim();
    if (!title) {
      skipped += 1;
      return;
    }
    const fields = { title, source: 'Import' };
    Object.entries(colFor).forEach(([key, idx]) => {
      if (key === 'title') return;
      const value = (row[idx] || '').trim();
      if (value) fields[key] = value;
    });
    if (varietyPackCol !== undefined) fields.varietyPack = parseVarietyPackCell(row[varietyPackCol]);
    try {
      db.upsertBeer(fields);
      imported += 1;
    } catch (err) {
      // A malformed row (e.g. TITLE_REQUIRED can't actually happen here
      // since title is already checked above, but a future column/
      // constraint might add one) shouldn't sink the rest of the file -
      // same spirit as beerBibleSeed.js's own per-entry try/catch.
      skipped += 1;
    }
  });

  return { imported, skipped, total: dataRows.length };
}

module.exports = { importBeerBibleCsv };
