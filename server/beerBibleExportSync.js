// Backs the Beer Bible page's "Export File Sync" button (server/index.js's
// POST /api/beers/sync-export) - the replacement for the old "Check GitHub
// for New Beers" button (see beerBibleSeed.js's own history: that function,
// syncNewBeerBibleEntries, is gone; maybeAutoSeedBeerBible - the automatic
// first-run seed for a brand-new, empty Beer Bible - is untouched).
//
// Deliberately narrower than that old button in one way and wider in
// another:
//   - Narrower: this never adds new entries. The GitHub sync could, because
//     every row in its curated list is already known to be beer. The
//     configured WinePOS export (see upcCatalog.js) is the *whole* store
//     catalog - wine, spirits, and beer mixed together under whatever loose
//     department/class text a row happens to have (see enrichBeerFromUntappd's
//     own "almost never spelled 'beer' exactly" note in productImport.js) -
//     not reliable enough to guess which new rows are beer. So this only
//     ever touches a `beers` row that's already there, matched by the SKU
//     already saved on it.
//   - Wider: it's not a per-row Untappd search - it's a local file lookup,
//     so this can safely (and quickly) run against every SKU'd entry in the
//     Beer Bible at once, no rate limit or per-row delay needed (contrast
//     with beerBibleImport.js's own DELAY_MS).
//
// Only ever fills in `upc` (see the beers table's own comment in db.js for
// why price/pack price are deliberately NOT synced/stored here - the Beer
// Bible profile page looks those up live instead, same as the Bourbon
// Library's own Price row).
const { lookupSkuInExport } = require('./upcCatalog');

// Same "matched a SKU that has nothing new to offer" case a plain equality
// check already covers (a blank upc column for that row, or a UPC already
// on file that hasn't changed) - split out only so the loop below reads as
// one line per outcome rather than a nested if/else.
function upcNeedsUpdate(beer, product) {
  return !!(product.upc && product.upc !== beer.upc);
}

// Runs once, synchronously (a fetch/parse of the export file the first time
// it's needed, then in-memory Map lookups - see lookupSkuInExport/
// loadCatalog's own mtime-keyed cache in upcCatalog.js), so there's no
// progress-polling dialog the way Beer Bible Import needs; the whole run
// finishes within the one request.
//
// A beer with no SKU on file can't be matched against the export at all
// (SKU is the only key upcCatalog.js indexes by) - counted separately
// (`noSku`) rather than folded into `noMatch`, so the summary can tell
// staff "go add SKUs" apart from "these SKUs really aren't in the file".
//
// Any error other than a per-row SKU_NOT_FOUND (no export configured, the
// configured file is missing/unreadable) aborts the whole run and
// propagates to the caller (server/index.js's route), same as every other
// export-file-backed route's NO_EXPORT_PATH/EXPORT_NOT_FOUND/
// EXPORT_UNREADABLE handling - a global problem like that isn't a "this one
// SKU wasn't found" outcome, and continuing to loop 2,000 more times
// against a file that isn't there would just repeat the same failure.
function syncBeerBibleFromExport(db) {
  const beers = db.listBeers();
  const withSku = beers.filter((b) => b.sku && b.sku.trim());
  let matched = 0;
  let updated = 0;
  let noMatch = 0;

  withSku.forEach((beer) => {
    let product;
    try {
      product = lookupSkuInExport(beer.sku);
    } catch (err) {
      if (err.code === 'SKU_NOT_FOUND') {
        noMatch += 1;
        return;
      }
      throw err;
    }
    matched += 1;
    if (upcNeedsUpdate(beer, product)) {
      db.updateBeerById(beer.id, { upc: product.upc });
      updated += 1;
    }
  });

  return {
    checked: withSku.length,
    noSku: beers.length - withSku.length,
    matched,
    updated,
    noMatch,
  };
}

module.exports = { syncBeerBibleFromExport };
