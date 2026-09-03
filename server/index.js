const os = require('os');
const path = require('path');
const express = require('express');
const {
  extractProduct, extractBeer, findTastingNotes, TASTING_NOTE_PROVIDER_NAMES,
  TASTING_NOTE_EXPERIMENTAL_PROVIDER_NAMES, parsePastedProduct,
  lookupSku, lookupSkuFromHtml, untappdBeerFromUrl, untappdBeerFromHtml, enrichWineDescriptionFromStore,
  enrichBeerScanFromStore, enrichBeerFromUntappd, enrichSalePriceFromStore, enrichWineFromStore, mergeUntappdBeer,
  algoliaSearchBeerCandidates,
} = require('./productImport');
const {
  getUpcSettings, setUpcSettings, setAutoSync, lookupUpc, lookupSkuInExport, searchByName, previewExport,
  listKegsInStock,
} = require('./upcCatalog');
const {
  recordPrintedTalkers, searchHistory, getHistoryEntry, deleteHistoryEntry, getStats,
  listMashBills, upsertMashBill, updateMashBillById, deleteMashBill,
  listBeers, getBeer, upsertBeer, updateBeerById, deleteBeer, getBeerByTitle,
  listRums, upsertRum, updateRumById, deleteRum,
} = require('./db');
const { getServerConfig, setServerConfig } = require('./serverConfig');
const { createBeacon } = require('./discovery');
const { createExportServeServer, createExportPuller } = require('./exportSync');
const { createMashBillServeServer, createMashBillPuller } = require('./mashBillSync');
const { createBeerBibleServeServer, createBeerBiblePuller } = require('./beerBibleSync');
const { maybeAutoSeedBourbonLibrary, syncNewBourbonLibraryEntries } = require('./bourbonLibrarySeed');
const { maybeAutoSeedBeerBible } = require('./beerBibleSeed');
const { syncBeerBibleFromExport } = require('./beerBibleExportSync');
const { importBeerBibleCsv } = require('./beerBibleCsvImport');
const {
  getStatus: getBeerBibleImportStatus, startImport: startBeerBibleImport, cancelImport: cancelBeerBibleImport,
  isEnriched: isBeerBibleEntryEnriched,
} = require('./beerBibleImport');
const { maybeAutoSeedRumRepository, syncNewRumRepositoryEntries } = require('./rumRepositorySeed');
const {
  getState: getProductDatabaseState, setExportFile: setProductDatabaseExportFile, setHaFile: setProductDatabaseHaFile,
  findRumProducts,
} = require('./productDatabase');
const db = require('./db');
const { version: APP_VERSION } = require('../package.json');

// The LAN discovery beacon and the export-sync/mash-bill-sync serve/pull
// halves (see discovery.js, exportSync.js, mashBillSync.js) are only ever
// passed in by start() below - createApp() itself never touches the
// network, so tests that build an app with createApp() alone (see
// test/index.test.js) never bind a socket as a side effect. Without them,
// /api/server-status simply reports no discovered server and its POST is a
// no-op for announcing/serving, /api/upc-settings reports no sync status,
// and /api/mashbills falls back to an empty cached list with no sync
// status, rather than crashing.
function createApp({
  beacon, exportServeServer, exportPuller, mashBillServeServer, mashBillPuller,
  beerBibleServeServer, beerBiblePuller,
} = {}) {
  const app = express();

  // Express's own default JSON body limit is 100kb - fine for every other
  // route here (small option objects), but POST /api/beers/import-csv
  // sends a whole Beer Bible CSV as one JSON string field, and a real
  // store's export (thousands of rows, some with a Tasting Notes
  // description) clears 100kb easily - confirmed against a real 2,539-row
  // export at 241kb before a single hand-typed description is added. That
  // request was silently rejected with a 413 before ever reaching
  // importBeerBibleCsv, which read to staff as "Import CSV… said it
  // worked, but the beer I researched came back Needs research" - the
  // import never ran at all, so whatever stub was already there (from
  // auto-seed) was left untouched. 25mb comfortably covers even a large
  // multi-thousand-row export with descriptions; this is a single local
  // process on a store's own LAN, not a public-facing service, so raising
  // it for every route rather than just this one isn't a real exposure.
  app.use(express.json({ limit: '25mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Backs the "What's New" popup (app.js): the renderer compares this
  // against the version it last showed a popup for (stored in localStorage)
  // to decide whether there's anything new to announce. Reading it from the
  // server rather than baking it into app.js keeps a single source of truth
  // with package.json - the same one electron-builder/electron_updater use -
  // and works the same whether the page is loaded via the plain browser dev
  // copy or Electron's own local server (see electron/main.js).
  app.get('/api/app-version', (req, res) => {
    res.json({ version: APP_VERSION });
  });

  app.post('/api/import-url', async (req, res) => {
    const { url, category } = req.body || {};

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'A product URL is required.' });
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: 'That does not look like a valid URL.' });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'Only http/https URLs are supported.' });
    }

    try {
      // The client's Wine/Spirits vs Beer toggle picks the extraction path -
      // beer gets Untappd-focused parsing (brewery, style, ABV, IBU,
      // rating) instead of the price-and-description extraction generic
      // retail product pages use.
      const product = category === 'beer'
        ? await extractBeer(parsed.toString())
        : await extractProduct(parsed.toString());
      res.json(product);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not read product data from that page.' });
    }
  });

  // Fallback for "Import from website" when a site blocks the fetch above
  // outright (see fetchProductHtml/extractProduct in productImport.js) -
  // staff copy the page's HTML out of their own browser, which already got
  // past the block, and this parses it the same way a successful fetch
  // would have. No network request happens here at all.
  app.post('/api/import-html', (req, res) => {
    const { html, url, category } = req.body || {};

    if (!html || typeof html !== 'string' || !html.trim()) {
      return res.status(400).json({ error: "Paste the page's HTML first." });
    }

    try {
      const product = parsePastedProduct({ html, url, category });
      res.json(product);
    } catch (err) {
      res.status(400).json({ error: err.message || 'Could not read product data from that HTML.' });
    }
  });

  // Populates the Source dropdown in the "Find Tasting Notes" dialog - a
  // plain list of provider names, so a new provider added to
  // TASTING_NOTE_PROVIDERS shows up there without an app.js change.
  // `experimental` names the subset gated behind Product Type: Bourbon -
  // the client filters those out of the dropdown unless Bourbon is selected
  // (see renderTastingNotesSourceOptions in app.js).
  app.get('/api/tasting-notes/sources', (req, res) => {
    res.json({ sources: TASTING_NOTE_PROVIDER_NAMES, experimental: TASTING_NOTE_EXPERIMENTAL_PROVIDER_NAMES });
  });

  // Backs the "Find Tasting Notes" dialog (Manual Entry, Wine/Spirits only) -
  // unlike /api/import-url above, there's no URL here: title/vintage come
  // straight from whatever's already in the form, and the server does the
  // searching (see findTastingNotes). An optional `source` restricts the
  // search to one named provider (the dialog's Source dropdown) instead of
  // trying all of them in order. `allowExperimental` is Settings' "Bourbon
  // Shelf Talkers" toggle, sent on every request rather than trusted as
  // server-side state - see findTastingNotes for why this (not just the
  // dropdown filtering) is what actually keeps Distiller unreachable while
  // the toggle is off.
  app.post('/api/tasting-notes', async (req, res) => {
    const { title, vintage, source, allowExperimental } = req.body || {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'A product title is required.' });
    }

    try {
      const result = await findTastingNotes({
        title: title.trim(),
        vintage: typeof vintage === 'string' ? vintage.trim() : '',
        source: typeof source === 'string' && source.trim() ? source.trim() : undefined,
        allowExperimental: !!allowExperimental,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not find tasting notes for that product.' });
    }
  });

  // Beer's own live Untappd search (enrichBeerFromUntappd in
  // productImport.js) coming back empty doesn't necessarily mean the beer
  // is unknown - it can just as easily be Untappd's shared search key
  // getting rate-limited, a network hiccup, or a store title that doesn't
  // happen to match well. When it does come back empty (`untappdError`),
  // the Beer Bible (the `beers` table in db.js) may already carry a
  // fully-researched entry for the exact same beer - saved from an earlier
  // successful Untappd match, a Beer Bible Import run, or typed in by hand -
  // keyed by the same case-insensitive title the Beer Bible form itself
  // uses (getBeerByTitle). Reusing it here is what lets staff still get a
  // complete talker instead of a mostly-blank one on a lookup that hits a
  // bad day, or a beer Untappd genuinely never had listed. Reused via
  // mergeUntappdBeer - the exact same field-by-field merge a live match
  // already goes through - so a Beer Bible entry missing one field (say,
  // no rating) still lets whatever the store page already found for that
  // field stand.
  //
  // A Beer Bible entry that's just a bare title+SKU stub (see isEnriched in
  // beerBibleImport.js - e.g. left over from a bulk pre-seed pass that
  // never actually ran Untappd) has nothing more to offer than `result`
  // already has, so it's left alone the same as no entry at all. Untouched
  // when Untappd DID find something (no untappdError) or came back
  // ambiguous (untappdCandidates) - a tie needs a human pick, not a guess
  // at which Beer Bible entry, if either, is the right one. Shared by every
  // route below that can end up with a beer's untappdError set: SKU Lookup
  // (live and pasted-HTML), Scan UPC, and Search by Name.
  function applyBeerBibleFallback(result) {
    if (!result || !result.untappdError) return result;
    const beerBibleEntry = getBeerByTitle(result.title);
    if (!beerBibleEntry || !isBeerBibleEntryEnriched(beerBibleEntry)) return result;
    const { untappdError, ...rest } = result;
    // mergeUntappdBeer's `beer` argument is normally a live Untappd search
    // result, whose own `.title` is the beer's real name (see its own
    // `beerName: beer.title || ...` line). beerBibleEntry is shaped
    // differently - its `.title` is the store-matching text (see the beers
    // table comment in server/db.js), not a name to show staff - so it's
    // swapped for beerBibleEntry.beerName (Untappd's own name, if this
    // entry was ever actually matched) before merging, the same "what to
    // actually call this beer" beerBibleEntry.title would otherwise wrongly
    // stand in for.
    const asUntappdBeer = { ...beerBibleEntry, title: beerBibleEntry.beerName || beerBibleEntry.title };
    return { ...rest, ...mergeUntappdBeer(rest, asUntappdBeer), untappdSource: 'Beer Bible' };
  }

  // Backs the "SKU Lookup" tab (which replaced Bulk CSV Import): staff type
  // in the store's own SKU, this searches liquoroutletwinecellars.com for
  // it and pulls title/size/price off the matching product page. For beer,
  // lookupSku also runs a best-effort Untappd search on the title it just
  // found (see enrichBeerFromUntappd in productImport.js) to fill in the
  // description/brewery/style/ABV/IBU/rating a retail page wouldn't have.
  //
  // Every lookup here is live - a "still fresh, skip the network" shortcut
  // (and, later, a stale-cache fallback on a failed lookup) used to live
  // here, but both got removed: a beer that missed on Untappd (or came back
  // ambiguous) got cached as "fresh" for a full day exactly like a
  // successful lookup, so a fix that would have found it on a retry never
  // got the chance to - staff just saw the exact same stale result the next
  // time they looked it up.
  //
  // A SKU the live store search doesn't turn up anything for - out of stock
  // and pulled from the site's own search, never published there to begin
  // with, or the site blocking the request outright - falls back to the same
  // local WinePOS export /api/upc-lookup already reads (see lookupSkuInExport
  // in upcCatalog.js), same as enrichBeerScanFromStore/enrichWineFromStore
  // already give a scanned UPC whose export row's own SKU the store site
  // doesn't recognize (see storeSourceError there) - just reached from a
  // typed SKU instead of one read off a scanned UPC's export row. Only when
  // the SKU is in neither place is a failed lookup still the hard error it
  // always was.
  app.post('/api/sku-lookup', async (req, res) => {
    const { sku, category } = req.body || {};

    if (!sku || typeof sku !== 'string' || !sku.trim()) {
      return res.status(400).json({ error: 'A SKU is required.' });
    }
    const trimmedSku = sku.trim();
    const normalizedCategory = category === 'beer' ? 'beer' : 'wine';

    try {
      const product = await lookupSku({ sku: trimmedSku, category });
      const withBeerBibleFallback = normalizedCategory === 'beer' ? applyBeerBibleFallback(product) : product;
      res.json({ ...withBeerBibleFallback, category: normalizedCategory });
    } catch (err) {
      let exportProduct;
      try {
        exportProduct = lookupSkuInExport(trimmedSku);
      } catch {
        return res.status(502).json({ error: err.message || 'Could not look up that SKU.' });
      }
      const enriched = normalizedCategory === 'beer' ? await enrichBeerFromUntappd(exportProduct) : exportProduct;
      const withBeerBibleFallback = normalizedCategory === 'beer' ? applyBeerBibleFallback(enriched) : enriched;
      res.json({
        ...withBeerBibleFallback,
        category: normalizedCategory,
        storeSourceError: err.message || 'Could not look up that SKU on liquoroutletwinecellars.com.',
      });
    }
  });

  // Fallback for the SKU Lookup tab when the store site blocks the search
  // or product-page fetch outright (see fetchStoreHtml/lookupStoreSku in
  // productImport.js) - staff search the SKU themselves and paste the
  // resulting product page's HTML, same pattern as /api/import-html above.
  app.post('/api/sku-lookup-html', async (req, res) => {
    const { html, url, category } = req.body || {};

    if (!html || typeof html !== 'string' || !html.trim()) {
      return res.status(400).json({ error: "Paste the page's HTML first." });
    }

    try {
      const product = await lookupSkuFromHtml({ html, url, category });
      res.json(category === 'beer' ? applyBeerBibleFallback(product) : product);
    } catch (err) {
      res.status(400).json({ error: err.message || 'Could not read product data from that HTML.' });
    }
  });

  // Backs the "Scan UPC" tab's Settings box: reads/writes the local path to
  // a WinePOS product export file (see upcCatalog.js) - unlike SKU Lookup
  // above, this never makes a network request itself for the UPC match, since
  // a scanned barcode is the bottle's manufacturer UPC, a different number
  // from the store's own SKU that liquoroutletwinecellars.com's search
  // actually indexes. `sync` reports the auto-sync puller's own status (see
  // exportSync.js) - null when this PC never had one wired in (createApp()
  // alone, see the note above) rather than when auto-sync itself is off, so
  // the dialog can always tell "auto-sync is off" (getUpcSettings().autoSync)
  // apart from "there's no puller running to report on at all".
  app.get('/api/upc-settings', (req, res) => {
    res.json({ ...getUpcSettings(), sync: exportPuller ? exportPuller.getStatus() : null });
  });

  app.post('/api/upc-settings', (req, res) => {
    const { exportPath } = req.body || {};
    if (typeof exportPath !== 'string') {
      return res.status(400).json({ error: 'exportPath must be a string.' });
    }
    res.json({ ...setUpcSettings(exportPath.trim()), sync: exportPuller ? exportPuller.getStatus() : null });
  });

  // Backs the Export File Settings dialog's "Automatically pull from the
  // Server PC" checkbox - turns exportSync.js's pull loop on/off (see
  // upcCatalog.js's setAutoSync/isAutoSyncEnabled) without touching the
  // manually-typed export path underneath it, so switching this back off
  // restores exactly what was there before. The puller itself (see
  // exportSync.js) always polls once started; this only ever flips whether
  // a given poll actually does anything, which is why there's no
  // corresponding start/stop call here the way marking a PC as the Server
  // PC starts/stops the discovery beacon's announcing below.
  app.post('/api/upc-settings/auto-sync', (req, res) => {
    const { autoSync } = req.body || {};
    res.json({ ...setAutoSync(!!autoSync), sync: exportPuller ? exportPuller.getStatus() : null });
  });

  // Backs the Export File Settings dialog's "Sync Now" button - forces an
  // immediate pull from the Server PC (see exportSync.js's syncOnce) rather
  // than waiting up to ~30s for the puller's own interval, then reports back
  // the same shape as GET /api/upc-settings above so the dialog can refresh
  // its status line right away instead of waiting for its own next poll. A
  // no-op, same as GET's own sync: null, when this PC never had a puller
  // wired in (createApp() alone); also effectively a no-op when auto-sync
  // itself is off, since syncOnce() already checks isAutoSyncEnabled() and
  // leaves whatever status was already there in place rather than erasing
  // it - the button is only shown enabled in the dialog while auto-sync is
  // on, this is just the same belt-and-suspenders as the route above.
  app.post('/api/upc-settings/sync-now', async (req, res) => {
    if (exportPuller) await exportPuller.syncOnce();
    res.json({ ...getUpcSettings(), sync: exportPuller ? exportPuller.getStatus() : null });
  });

  // Backs the "Scan UPC" tab itself: staff scan a bottle's UPC (a USB/
  // Bluetooth scanner just types it, like a keyboard) into the tab's input,
  // and this looks it up in the export file configured above rather than
  // fetching anything over the network for the UPC match itself. See
  // upcCatalog.js's lookupUpc for the specific error codes (no file
  // configured yet, file missing, unreadable, or UPC not found in it)
  // surfaced through `code` below.
  //
  // For Wine/Spirits (the tab's own category toggle, sent as `category`),
  // the local export's own Description column is then layered under
  // whatever liquoroutletwinecellars.com's own product page has for that
  // item's store SKU (see enrichWineDescriptionFromStore in
  // productImport.js) - the same site the SKU Lookup tab already reads a
  // description from, so both lookup paths end up sourcing Wine/Spirits
  // descriptions the same way. Best-effort: a missing store SKU or a failed
  // store lookup just leaves the export's own description in place.
  //
  // Beer runs its own two-step enrichment instead (see
  // enrichBeerScanFromStore in productImport.js): the whole product page
  // (title/size/price/description) from that same store site - not just
  // pricing, since a WinePOS export's own Title/Brand columns are often too
  // abbreviated to search Untappd with well - then
  // brewery/location/style/ABV/IBU/rating from Untappd off of that store
  // title. The same two sources the SKU Lookup tab's beer path already
  // draws from (see lookupSku), just reached by the WinePOS export's own
  // store-SKU column instead of a typed-in one. Both steps are
  // independently best-effort, same as the Wine/Spirits description above.
  //
  // Every lookup here is live, same as SKU Lookup above - a failed lookup
  // (store site blocked, export file unreadable) is a real error, not a
  // stale fallback. `lookupCategory` is kept separate from `category` (the
  // WinePOS export's own department/class column) since Wine/Spirits' own
  // enrichment never overwrites it, though a successful Beer store lookup
  // does, the same as it replaces every other export-only field with the
  // store's own.
  app.post('/api/upc-lookup', async (req, res) => {
    const { upc, category } = req.body || {};
    if (!upc || typeof upc !== 'string' || !upc.trim()) {
      return res.status(400).json({ error: 'A UPC is required.' });
    }
    const trimmedUpc = upc.trim();
    const normalizedCategory = category === 'beer' ? 'beer' : 'wine';

    try {
      const rawProduct = lookupUpc(trimmedUpc);
      const product = normalizedCategory === 'beer'
        ? applyBeerBibleFallback(await enrichBeerScanFromStore(rawProduct))
        : await enrichWineDescriptionFromStore(rawProduct);
      res.json({ ...product, lookupCategory: normalizedCategory });
    } catch (err) {
      const status = err.code === 'EXPORT_UNREADABLE' ? 500 : 404;
      res.status(status).json({ error: err.message || 'Could not look up that UPC.', code: err.code });
    }
  });

  // Backs the Bourbon Library profile page's Price row: looks a library
  // entry's own `sku` (see mash_bills in db.js) up against the same local
  // WinePOS export file Scan UPC reads above (see lookupSkuInExport in
  // upcCatalog.js) - no network request, no store-site scrape (unlike
  // /api/sku-lookup, which searches liquoroutletwinecellars.com by a typed-
  // in SKU for the current talker's own Price field). A miss is a real
  // error, not a stale fallback - same NO_EXPORT_PATH/EXPORT_NOT_FOUND/
  // EXPORT_UNREADABLE codes as /api/upc-lookup, plus SKU_NOT_FOUND for a SKU
  // the export doesn't have.
  app.get('/api/export-price', (req, res) => {
    const { sku } = req.query || {};
    if (!sku || !String(sku).trim()) {
      return res.status(400).json({ error: 'A SKU is required.' });
    }
    try {
      res.json(lookupSkuInExport(String(sku).trim()));
    } catch (err) {
      const status = err.code === 'EXPORT_UNREADABLE' ? 500 : 404;
      res.status(status).json({ error: err.message || 'Could not look up that SKU.', code: err.code });
    }
  });

  // Backs the "Search by Name" tab: staff type part of a product's title and
  // this ranks matches out of the same local WinePOS export file Scan UPC
  // reads above (see searchByName in upcCatalog.js) - no network request,
  // same as UPC lookup's own local-file path, and the same NO_EXPORT_PATH/
  // EXPORT_NOT_FOUND/EXPORT_UNREADABLE error codes. This hands back a short
  // list of candidates for staff to choose from; picking one (see
  // /api/name-search-select below) just fills the form the same way the
  // other lookup tabs' results do.
  //
  // A blank/missing query returns an empty result list rather than a 400 -
  // the client only calls this once someone's actually typed something, but
  // treating "nothing typed" as a client error would be one more thing a
  // debounced keystroke could race against a fast Backspace to nothing.
  app.get('/api/name-search', (req, res) => {
    const { q, limit } = req.query || {};
    if (!q || !String(q).trim()) return res.json({ results: [] });
    try {
      res.json({ results: searchByName(String(q), { limit }) });
    } catch (err) {
      const status = err.code === 'EXPORT_UNREADABLE' ? 500 : 404;
      res.status(status).json({ error: err.message || 'Could not search the export file.', code: err.code });
    }
  });

  // Backs picking a candidate off the "Search by Name" tab's dropdown - runs
  // once, on that click/Enter, not per keystroke against the whole result
  // list above (an Untappd search per row would be both slow and a good way
  // to get this app's Algolia key rate-limited or revoked).
  //
  // Wine/Spirits: every pick runs enrichWineFromStore (productImport.js) - a
  // best-effort, never-throws lookup of the export's own SKU against
  // liquoroutletwinecellars.com's product page, since the local WinePOS
  // export often has no sale/promo price column of its own (see
  // FIELD_ALIASES.salePrice in upcCatalog.js), and its own Description
  // column tends to be blank or a short internal note rather than
  // shopper-facing tasting notes. That store page supplies both salePrice
  // and description in one fetch, same as Scan UPC/SKU Lookup already
  // source a Wine/Spirits description - all three lookup methods now end up
  // sourcing it the same way. Everything else about the product (title/
  // size/regular price) still comes from the export.
  //
  // Beer keeps running enrichSalePriceFromStore on its own (unchanged) for
  // the same salePrice gap, then the same best-effort Untappd step SKU
  // Lookup and Scan UPC already layer on top of their own product (see
  // enrichBeerFromUntappd in productImport.js), off of the export's own
  // title/brand/size rather than the store page - beer's description comes
  // from Untappd, not this store page, so it has no use for
  // enrichWineFromStore. A miss (blocked, no match) comes back as
  // untappdError, same as those two tabs, rather than failing the pick
  // outright - the export's own fields are still good enough to queue a
  // talker from.
  //
  // Every pick runs a live store/Untappd search, same as SKU Lookup/Scan
  // UPC - a search that fails outright is a real error, not a stale
  // fallback.
  app.post('/api/name-search-select', async (req, res) => {
    const { product, category } = req.body || {};
    if (!product || typeof product !== 'object' || !product.title) {
      return res.status(400).json({ error: 'A product is required.' });
    }
    const normalizedCategory = category === 'beer' ? 'beer' : 'wine';

    if (normalizedCategory !== 'beer') {
      const enriched = await enrichWineFromStore(product);
      return res.json({ ...enriched, category: normalizedCategory });
    }

    const withSalePrice = await enrichSalePriceFromStore(product);
    try {
      const data = { ...applyBeerBibleFallback(await enrichBeerFromUntappd(withSalePrice)), category: 'beer' };
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not search Untappd for that beer.' });
    }
  });

  // Backs the desktop app's "View Export File" dialog (Advanced menu) - a
  // read-only look at the raw WinePOS export configured in Scan UPC ->
  // Settings, for confirming it's actually hooked up right without staff
  // needing to go find and open the file themselves. `q` is the dialog's
  // search box (see previewExport's own note on why that's a plain
  // substring match run server-side over every row, not just the ones
  // already sent down).
  app.get('/api/export-preview', (req, res) => {
    try {
      res.json(previewExport({ limit: req.query.limit, query: req.query.q }));
    } catch (err) {
      const status = err.code === 'EXPORT_UNREADABLE' ? 500 : 404;
      res.status(status).json({ error: err.message || 'Could not read the export file.', code: err.code });
    }
  });

  // Backs the sales-floor Keg Display page (public/keg-display.html) -
  // every keg currently in stock, with its price, straight out of the same
  // WinePOS export file Scan UPC/Search by Name already read (see
  // listKegsInStock in upcCatalog.js). No separate setup: whatever export
  // file is already configured in Advanced -> Export File Settings is what
  // this reads too. Same error codes/status mapping as every other export-
  // backed route above (NO_EXPORT_PATH/EXPORT_NOT_FOUND -> 404,
  // EXPORT_UNREADABLE -> 500) so the display page can show one clear message
  // for "nothing configured yet" vs. "something's actually broken".
  app.get('/api/kegs', (req, res) => {
    try {
      res.json({ kegs: listKegsInStock() });
    } catch (err) {
      const status = err.code === 'EXPORT_UNREADABLE' ? 500 : 404;
      res.status(status).json({ error: err.message || 'Could not read kegs from the export file.', code: err.code });
    }
  });

  // Backs the History panel: called once, at the moment "Print Now" is
  // clicked, with the entire current queue (that's what actually goes to
  // the printer - see printNow() in app.js), so every talker in it gets
  // logged as printed. Nothing about the live queue in localStorage is
  // touched by this - History is a separate, permanent record layered on
  // top, not a replacement for it (see db.js's own note on this).
  app.post('/api/history', (req, res) => {
    const { talkers } = req.body || {};
    if (!Array.isArray(talkers) || !talkers.length) {
      return res.status(400).json({ error: 'At least one talker is required.' });
    }
    res.json(recordPrintedTalkers(talkers));
  });

  // Backs the History panel's search box - title/SKU substring match, most
  // recently printed first. `total` (of the matching set, not just this
  // page) drives the panel's "Showing X of Y" footer.
  app.get('/api/history', (req, res) => {
    const { q, limit, offset } = req.query || {};
    res.json(searchHistory({ q, limit, offset }));
  });

  // A single history row's full stored talker, for the History panel's
  // "Reprint" action - everything fillForm() needs to restore the talker
  // exactly as it was printed, not just the few columns the search list
  // above shows.
  app.get('/api/history/:id', (req, res) => {
    const entry = getHistoryEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: 'No history entry with that id.' });
    res.json(entry);
  });

  // Lets staff prune a mistaken entry (e.g. a typo caught right after
  // printing) out of the History panel.
  app.delete('/api/history/:id', (req, res) => {
    const deleted = deleteHistoryEntry(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'No history entry with that id.' });
    res.json({ success: true });
  });

  // Backs the Mash Bill Library (Tools -> Mash Bill Library..., Bourbon
  // Shelf Talkers only): a shared, Server-PC-hosted table of researched
  // grain compositions (see the mash_bills table in db.js), so the same
  // bottle's mash bill doesn't need re-researching on every talker made for
  // it. Every route below branches on whether *this* PC is currently
  // marked Server PC (see serverConfig.js):
  //  - isServer: this PC's own data.db is the source of truth - read/write
  //    it directly, exactly what mashBillSync.js's serve-side HTTP server
  //    does for every *other* PC's requests.
  //  - not isServer: reads come back from mashBillPuller's last
  //    successfully synced cache (never blocking on a live round trip -
  //    same fallback spirit as the UPC export's own auto-sync), and writes
  //    are forwarded over the network to whichever PC currently holds the
  //    role (see mashBillSync.js's forwardWrite) and its response relayed
  //    back as-is.
  // A PC that never had a puller wired in (createApp() alone, see the note
  // above) just reports an empty list with isServer: false and no sync
  // status, and every write 503s, rather than crashing.
  app.get('/api/mashbills', (req, res) => {
    if (getServerConfig().isServer) {
      return res.json({ mashBills: listMashBills(), sync: { isServer: true } });
    }
    res.json({
      mashBills: mashBillPuller ? mashBillPuller.getCached() : [],
      sync: { isServer: false, ...(mashBillPuller ? mashBillPuller.getStatus() : {}) },
    });
  });

  // Bourbon Library fields (parent company, category, SKU, tasting notes,
  // Mash Bill Confidence, and References & Sources) beyond the original
  // title/distillery/grains/source - see mashBillOptionalFieldParams in
  // db.js for how an omitted (undefined) one leaves whatever's already
  // saved alone rather than blanking it out.
  function mashBillOptionalFields(body) {
    const {
      parentCompany, category, sku, nose, palate, finish, tastingSource, confidence, references,
    } = body || {};
    return {
      parentCompany, category, sku, nose, palate, finish, tastingSource, confidence, references,
    };
  }

  app.post('/api/mashbills', async (req, res) => {
    const { title, distillery, grains, source } = req.body || {};
    const optional = mashBillOptionalFields(req.body);
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'A product title is required.' });
    }
    if (getServerConfig().isServer) {
      try {
        return res.status(201).json(upsertMashBill({
          title, distillery, grains, source, ...optional,
        }));
      } catch (err) {
        return res.status(err.code === 'GRAINS_REQUIRED' ? 400 : 500).json({ error: err.message, code: err.code });
      }
    }
    if (!mashBillPuller) return res.status(503).json({ error: 'Mash bill syncing is not set up on this PC.' });
    try {
      const result = await mashBillPuller.forwardWrite('POST', '/mashbills', {
        title, distillery, grains, source, ...optional,
      });
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not reach the Server PC.' });
    }
  });

  app.put('/api/mashbills/:id', async (req, res) => {
    const { title, distillery, grains, source } = req.body || {};
    const optional = mashBillOptionalFields(req.body);
    if (getServerConfig().isServer) {
      try {
        const updated = updateMashBillById(Number(req.params.id), {
          title, distillery, grains, source, ...optional,
        });
        if (!updated) return res.status(404).json({ error: 'No mash bill entry with that id.' });
        return res.json(updated);
      } catch (err) {
        return res.status(err.code === 'DUPLICATE_TITLE' ? 409 : err.code === 'GRAINS_REQUIRED' ? 400 : 500).json({ error: err.message, code: err.code });
      }
    }
    if (!mashBillPuller) return res.status(503).json({ error: 'Mash bill syncing is not set up on this PC.' });
    try {
      const result = await mashBillPuller.forwardWrite('PUT', `/mashbills/${Number(req.params.id)}`, {
        title, distillery, grains, source, ...optional,
      });
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not reach the Server PC.' });
    }
  });

  app.delete('/api/mashbills/:id', async (req, res) => {
    if (getServerConfig().isServer) {
      const deleted = deleteMashBill(Number(req.params.id));
      if (!deleted) return res.status(404).json({ error: 'No mash bill entry with that id.' });
      return res.json({ success: true });
    }
    if (!mashBillPuller) return res.status(503).json({ error: 'Mash bill syncing is not set up on this PC.' });
    try {
      const result = await mashBillPuller.forwardWrite('DELETE', `/mashbills/${Number(req.params.id)}`);
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not reach the Server PC.' });
    }
  });

  // Backs the Mash Bill Library dialog's "Sync Now" button - forces an
  // immediate pull from the Server PC rather than waiting up to ~30s for
  // the puller's own interval, same pattern as /api/upc-settings/sync-now.
  app.post('/api/mashbills/sync-now', async (req, res) => {
    if (mashBillPuller) await mashBillPuller.syncOnce();
    if (getServerConfig().isServer) {
      return res.json({ mashBills: listMashBills(), sync: { isServer: true } });
    }
    res.json({
      mashBills: mashBillPuller ? mashBillPuller.getCached() : [],
      sync: { isServer: false, ...(mashBillPuller ? mashBillPuller.getStatus() : {}) },
    });
  });

  // Backs the Server PC dialog's "Check GitHub for New Bourbons" button -
  // the manual counterpart to maybeAutoSeedBourbonLibrary's own auto-seed,
  // for a library that's already populated (auto-seed only ever fires once,
  // on a completely empty library, so a store that seeded months ago never
  // sees anything added to the curated list since without this). Server-PC
  // only: this PC's own data.db is the only copy worth updating from
  // GitHub - every other PC just pulls the result from it on the next
  // mashBillPuller cycle, same as any other write here.
  app.post('/api/mashbills/sync-library', async (req, res) => {
    if (!getServerConfig().isServer) {
      return res.status(400).json({ error: 'Only the Server PC can check GitHub for new bourbons - mark this PC as the Server PC first (Advanced → Server PC…).' });
    }
    try {
      const { added, skipped, source } = await syncNewBourbonLibraryEntries(db);
      res.json({ added, skipped, source, mashBills: listMashBills() });
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not reach GitHub or the bundled seed data right now.' });
    }
  });

  // Backs the Beer Bible (rail "Beer Bible" view) - the same idea as the
  // Mash Bill Library above (a shared record of researched products, so the
  // same lookup doesn't need doing twice), for Beer instead of Bourbon, and
  // now with the same cross-register sync: every route below branches on
  // whether *this* PC is currently marked Server PC (see serverConfig.js),
  // exactly like /api/mashbills above -
  //  - isServer: this PC's own data.db is the source of truth - read/write
  //    it directly, exactly what beerBibleSync.js's serve-side HTTP server
  //    does for every *other* PC's requests.
  //  - not isServer: reads come back from beerBiblePuller's last
  //    successfully synced cache (never blocking on a live round trip), and
  //    writes are forwarded over the network to whichever PC currently
  //    holds the role (see beerBibleSync.js's forwardWrite) and its
  //    response relayed back as-is.
  // A PC that never had a puller wired in (createApp() alone, see the note
  // above) just reports an empty list with isServer: false and no sync
  // status, and every write 503s, rather than crashing. Nothing on Edit
  // Talker recalls from this yet; it's reachable only from the rail's own
  // Beer Bible screen (browse/add/edit/delete), same as the Bourbon Library
  // page owns for mash bills. See the beers table comment in db.js for the
  // fuller picture of what's scaffolded here vs. not.
  app.get('/api/beers', (req, res) => {
    if (getServerConfig().isServer) {
      return res.json({ beers: listBeers(), sync: { isServer: true } });
    }
    res.json({
      beers: beerBiblePuller ? beerBiblePuller.getCached() : [],
      sync: { isServer: false, ...(beerBiblePuller ? beerBiblePuller.getStatus() : {}) },
    });
  });

  // Beer Bible fields beyond title/source - see beerOptionalFieldParams in
  // db.js for how an omitted (undefined) one leaves whatever's already
  // saved alone rather than blanking it out.
  function beerOptionalFields(body) {
    const {
      beerName, brewery, location, region, country, style, size, abv, ibu, untappdRating, untappdRatingCount, description, sku, upc, varietyPack,
    } = body || {};
    return {
      beerName, brewery, location, region, country, style, size, abv, ibu, untappdRating, untappdRatingCount, description, sku, upc, varietyPack,
    };
  }

  app.post('/api/beers', async (req, res) => {
    const { title, source } = req.body || {};
    const optional = beerOptionalFields(req.body);
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'A beer name is required.' });
    }
    if (getServerConfig().isServer) {
      try {
        return res.status(201).json(upsertBeer({ title, source, ...optional }));
      } catch (err) {
        return res.status(err.code === 'TITLE_REQUIRED' ? 400 : 500).json({ error: err.message, code: err.code });
      }
    }
    if (!beerBiblePuller) return res.status(503).json({ error: 'Beer Bible syncing is not set up on this PC.' });
    try {
      const result = await beerBiblePuller.forwardWrite('POST', '/beers', { title, source, ...optional });
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not reach the Server PC.' });
    }
  });

  app.put('/api/beers/:id', async (req, res) => {
    const { title, source } = req.body || {};
    const optional = beerOptionalFields(req.body);
    if (getServerConfig().isServer) {
      try {
        const updated = updateBeerById(Number(req.params.id), { title, source, ...optional });
        if (!updated) return res.status(404).json({ error: 'No beer entry with that id.' });
        return res.json(updated);
      } catch (err) {
        return res.status(err.code === 'DUPLICATE_TITLE' ? 409 : err.code === 'TITLE_REQUIRED' ? 400 : 500).json({ error: err.message, code: err.code });
      }
    }
    if (!beerBiblePuller) return res.status(503).json({ error: 'Beer Bible syncing is not set up on this PC.' });
    try {
      const result = await beerBiblePuller.forwardWrite('PUT', `/beers/${Number(req.params.id)}`, { title, source, ...optional });
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not reach the Server PC.' });
    }
  });

  app.delete('/api/beers/:id', async (req, res) => {
    if (getServerConfig().isServer) {
      const deleted = deleteBeer(Number(req.params.id));
      if (!deleted) return res.status(404).json({ error: 'No beer entry with that id.' });
      return res.json({ success: true });
    }
    if (!beerBiblePuller) return res.status(503).json({ error: 'Beer Bible syncing is not set up on this PC.' });
    try {
      const result = await beerBiblePuller.forwardWrite('DELETE', `/beers/${Number(req.params.id)}`);
      res.status(result.status).json(result.data);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not reach the Server PC.' });
    }
  });

  // Backs the Beer Bible page's "Sync Now" button - forces an immediate
  // pull from the Server PC rather than waiting up to ~30s for the puller's
  // own interval, same pattern as /api/mashbills/sync-now.
  app.post('/api/beers/sync-now', async (req, res) => {
    if (beerBiblePuller) await beerBiblePuller.syncOnce();
    if (getServerConfig().isServer) {
      return res.json({ beers: listBeers(), sync: { isServer: true } });
    }
    res.json({
      beers: beerBiblePuller ? beerBiblePuller.getCached() : [],
      sync: { isServer: false, ...(beerBiblePuller ? beerBiblePuller.getStatus() : {}) },
    });
  });

  // Backs the Beer Bible's one-click "Research" button (grid card + profile
  // page, see app.js) - the same live Untappd search Search by Name/SKU
  // Lookup/Scan UPC already run, just started from an already-saved Beer
  // Bible row instead of a fresh product lookup. Runs the search off this
  // entry's own title (the store-sourced Product Title, never overwritten -
  // see rowToBeer's own comment in db.js) and passes the rest of the row's
  // current fields through as `product` too, so enrichBeerFromUntappd's own
  // mergeUntappdBeer fallback keeps whatever's already saved (a hand-typed
  // description, say) wherever Untappd's own page doesn't have one.
  //
  // Read-only: this never writes to the entry itself, same as every other
  // beer lookup route - a confident single match still needs staff to
  // accept it (Confirm Untappd Match), and a tie still needs a pick
  // (openUntappdPicker), before either one is actually saved via the
  // existing PUT /api/beers/:id. `title` is deliberately left out of the
  // response the client ends up saving (see saveBeerResearchFields in
  // app.js) so a research run can never rename the entry the way a SKU-
  // matched auto-save already refuses to.
  //
  // Reads off whichever copy is authoritative for *this* PC, same
  // isServer branching as every other Beer Bible route above: this PC's
  // own data.db when it's the Server PC, otherwise beerBiblePuller's last
  // synced cache - a non-Server PC's local data.db doesn't necessarily have
  // a row under this same id (or any row at all) once entries are coming
  // from the Server PC's own table instead.
  app.post('/api/beers/:id/research', async (req, res) => {
    const id = Number(req.params.id);
    const beer = getServerConfig().isServer
      ? getBeer(id)
      : (beerBiblePuller ? beerBiblePuller.getCached().find((b) => b.id === id) : null);
    if (!beer) return res.status(404).json({ error: 'No beer entry with that id.' });
    // A variety pack is several different beers under one SKU - Untappd has
    // no page for the pack itself, so a search here can never find a real
    // match (see the beers table's variety_pack comment in db.js). The Beer
    // Bible UI already hides the Research button for one of these; this is
    // the same guard for a request that reaches this route some other way.
    if (beer.varietyPack) {
      return res.status(400).json({ error: "Variety packs don't have their own Untappd page to search for." });
    }
    try {
      const data = await enrichBeerFromUntappd({
        title: beer.title,
        beerName: beer.beerName,
        brewery: beer.brewery,
        location: beer.location,
        style: beer.style,
        abv: beer.abv,
        ibu: beer.ibu,
        untappdRating: beer.untappdRating,
        untappdRatingCount: beer.untappdRatingCount,
        description: beer.description,
      });
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not search Untappd for that beer.' });
    }
  });

  // Backs the Beer Bible page's "Export File Sync" button (see
  // server/beerBibleExportSync.js for the full reasoning) - replaces the
  // old "Check GitHub for New Beers" button that used to sit here. Fills in
  // upc on any already-saved entry whose sku matches a row in the same
  // local WinePOS export Scan UPC reads (see upcCatalog.js); never adds new
  // entries, unlike the old GitHub sync (see that module's own comment for
  // why). Server-PC only, now that the Beer Bible has real cross-register
  // sync (see beerBibleSync.js): this writes straight to the local data.db
  // via `db`, bypassing forwardWrite, so it only makes sense to run against
  // whichever PC's copy is actually the source of truth - every other PC
  // picks the result up on its next beerBiblePuller cycle, same as
  // /api/mashbills/sync-library. NO_EXPORT_PATH/EXPORT_NOT_FOUND/
  // EXPORT_UNREADABLE are the same three codes /api/export-price and
  // friends already use for "no export file to read at all", so this maps
  // them to HTTP status the same way.
  app.post('/api/beers/sync-export', (req, res) => {
    if (!getServerConfig().isServer) {
      return res.status(400).json({ error: 'Only the Server PC can run Export File Sync - mark this PC as the Server PC first (Advanced → Server PC…).' });
    }
    try {
      const result = syncBeerBibleFromExport(db);
      res.json({ ...result, beers: listBeers() });
    } catch (err) {
      const status = err.code === 'EXPORT_UNREADABLE' ? 500 : 404;
      res.status(status).json({ error: err.message || 'Could not sync from the export file.', code: err.code });
    }
  });

  // Backs the Beer Bible page's "Import CSV…" button (see
  // server/beerBibleCsvImport.js for the full reasoning) - the round-trip
  // counterpart to Export CSV, not the same thing as the Advanced menu's
  // "Import Beer Bible from Export File..." below (that one runs a live
  // Untappd search per row; this one expects every field already filled
  // in and just upserts, synchronously, no network calls). The client
  // reads the file itself (a plain <input type="file">, works the same in
  // the browser and in Electron's webview) and posts the raw text here -
  // no server-side file path needed, unlike import/start below. Server-PC
  // only, same reasoning as /api/beers/sync-export above - this upserts
  // straight into the local data.db via `db`, bypassing forwardWrite.
  app.post('/api/beers/import-csv', (req, res) => {
    if (!getServerConfig().isServer) {
      return res.status(400).json({ error: 'Only the Server PC can import a CSV - mark this PC as the Server PC first (Advanced → Server PC…).' });
    }
    const { csv } = req.body || {};
    if (!csv || typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ error: 'No CSV content to import.' });
    }
    try {
      const result = importBeerBibleCsv(db, csv);
      res.json({ ...result, beers: listBeers() });
    } catch (err) {
      const status = { NO_ROWS: 400, NO_TITLE_COLUMN: 400 }[err.code] || 500;
      res.status(status).json({ error: err.message, code: err.code });
    }
  });

  // Backs the Advanced menu's "Import Beer Bible from Export File..."
  // dialog - the in-app equivalent of scripts/populate-beer-bible-from-
  // export.js, for a store PC that has the packaged app but no system-wide
  // Node install of its own to run that script with (see
  // beerBibleImport.js's own header for the full story). Server-PC only,
  // same reasoning as /api/beers/sync-export above - this runs directly
  // against the local data.db via `db`, bypassing forwardWrite.
  app.post('/api/beers/import/start', (req, res) => {
    if (!getServerConfig().isServer) {
      return res.status(400).json({ error: 'Only the Server PC can import from an export file - mark this PC as the Server PC first (Advanced → Server PC…).' });
    }
    const { filePath } = req.body || {};
    try {
      res.status(202).json(startBeerBibleImport({ filePath, db }));
    } catch (err) {
      const status = { FILE_REQUIRED: 400, FILE_UNREADABLE: 400, NO_ROWS: 400, ALREADY_RUNNING: 409 }[err.code] || 500;
      res.status(status).json({ error: err.message, code: err.code });
    }
  });

  // Polled by the dialog (see renderBeerBibleImportStatus in app.js) while
  // it's open - the job itself runs to completion server-side regardless
  // of whether anything is watching, so reopening the dialog mid-import
  // just picks the live progress back up.
  app.get('/api/beers/import/status', (req, res) => {
    res.json(getBeerBibleImportStatus());
  });

  app.post('/api/beers/import/cancel', (req, res) => {
    res.json(cancelBeerBibleImport());
  });

  // Backs the Rum Repository (rail "Rum Repository" view) - a bare-scaffold
  // browse/add/edit/delete library for Rum, same idea as /api/beers above
  // but for Rum instead of Beer. Same reach as /api/beers: no cross-
  // register sync (every route below just reads/writes this PC's own
  // data.db directly - no Server PC branching, no forwardWrite) and no
  // bulk import-from-export-file route (that feature leans on a per-row
  // Untappd lookup, which has no rum equivalent). See the rums table
  // comment in db.js for the fuller picture.
  app.get('/api/rums', (req, res) => {
    res.json({ rums: listRums() });
  });

  // Rum Repository fields beyond title/source - see rumOptionalFieldParams
  // in db.js for how an omitted (undefined) one leaves whatever's already
  // saved alone rather than blanking it out.
  function rumOptionalFields(body) {
    const {
      distillery, region, style, abv, ageStatement, description, sku, country,
    } = body || {};
    return {
      distillery, region, style, abv, ageStatement, description, sku, country,
    };
  }

  app.post('/api/rums', (req, res) => {
    const { title, source } = req.body || {};
    const optional = rumOptionalFields(req.body);
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'A rum name is required.' });
    }
    try {
      res.status(201).json(upsertRum({ title, source, ...optional }));
    } catch (err) {
      res.status(err.code === 'TITLE_REQUIRED' ? 400 : 500).json({ error: err.message, code: err.code });
    }
  });

  app.put('/api/rums/:id', (req, res) => {
    const { title, source } = req.body || {};
    const optional = rumOptionalFields(req.body);
    try {
      const updated = updateRumById(Number(req.params.id), { title, source, ...optional });
      if (!updated) return res.status(404).json({ error: 'No rum entry with that id.' });
      res.json(updated);
    } catch (err) {
      res.status(err.code === 'DUPLICATE_TITLE' ? 409 : err.code === 'TITLE_REQUIRED' ? 400 : 500).json({ error: err.message, code: err.code });
    }
  });

  app.delete('/api/rums/:id', (req, res) => {
    const deleted = deleteRum(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'No rum entry with that id.' });
    res.json({ success: true });
  });

  // Backs the Rum Repository page's "Check GitHub for New Rums" button -
  // the manual counterpart to maybeAutoSeedRumRepository's own auto-seed,
  // for a library that's already populated, same pattern the Beer Bible's
  // own GitHub sync used to follow before it was replaced by Export File
  // Sync (see /api/beers/sync-export above). Not gated behind Server PC
  // since there's no cross-register sync here yet - this PC's own data.db
  // is always the one being updated.
  app.post('/api/rums/sync-library', async (req, res) => {
    try {
      const { added, skipped, source } = await syncNewRumRepositoryEntries(db);
      res.json({ added, skipped, source, rums: listRums() });
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not reach GitHub or the bundled seed data right now.' });
    }
  });

  // Backs the Rum Repository page's "Add from Product Database" button -
  // pulls in any Product Database row whose Department/Sub Department
  // names Rum (see findRumProducts in productDatabase.js) as a new entry,
  // titled and SKU'd from that row. Additive only, same convention as
  // /api/rums/sync-library just above: a title that already exists locally
  // (case-insensitive) is left alone rather than overwritten, so this can
  // never clobber a distillery/region/style/etc. already researched by
  // hand - it only ever adds the stub for staff to fill in later. Requires
  // the Export File and/or HA Details file to already be loaded on this PC
  // (see productDatabase.js's in-memory state) - matchedCount reports 0
  // rather than erroring when neither is loaded yet, same "nothing to sync
  // from" shape as an empty GitHub seed list.
  app.post('/api/rums/sync-product-database', (req, res) => {
    try {
      const rumProducts = findRumProducts(getProductDatabaseState().products);
      const existingTitles = new Set(listRums().map((r) => r.title.trim().toLowerCase()));
      let added = 0;
      let skipped = 0;
      rumProducts.forEach((p) => {
        const title = (p.title || '').trim();
        const key = title.toLowerCase();
        if (!title || existingTitles.has(key)) {
          skipped += 1;
          return;
        }
        try {
          upsertRum({ title, source: 'Product Database', sku: p.sku });
          existingTitles.add(key);
          added += 1;
        } catch {
          // A malformed/duplicate-cased title shouldn't sink the rest of
          // the batch - same spirit as syncNewRumRepositoryEntries above.
          skipped += 1;
        }
      });
      res.json({
        added, skipped, matched: rumProducts.length, rums: listRums(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Could not sync from the Product Database.' });
    }
  });

  // Backs the Product Database (rail "Product Database" view, table icon
  // above Settings) - see productDatabase.js's own header for the full
  // picture. Deliberately not gated behind Server PC/forwardWrite the way
  // the Beer Bible's bulk import routes are: this holds no sqlite state at
  // all yet (see productDatabase.js's in-memory `state`), so there's
  // nothing cross-register to protect - each PC just parses/merges
  // whatever it was handed.
  app.get('/api/product-database', (req, res) => {
    res.json(getProductDatabaseState());
  });

  app.post('/api/product-database/export-file', (req, res) => {
    try {
      res.json(setProductDatabaseExportFile(req.body || {}));
    } catch (err) {
      const status = { NO_FILE: 400, NO_SKU_COLUMN: 400, NO_ROWS: 400 }[err.code] || 500;
      res.status(status).json({ error: err.message, code: err.code });
    }
  });

  app.post('/api/product-database/ha-file', (req, res) => {
    try {
      res.json(setProductDatabaseHaFile(req.body || {}));
    } catch (err) {
      const status = { NO_FILE: 400, NO_SKU_COLUMN: 400, NO_ROWS: 400 }[err.code] || 500;
      res.status(status).json({ error: err.message, code: err.code });
    }
  });

  // Backs the desktop app's "Server PC" dialog (Advanced menu): this PC's
  // LAN-visible IPv4 addresses, the current isServer flag/db stats (so
  // staff can tell whether this looks like the PC with real accumulated
  // data before marking it), and discoveredServer - the most recent LAN
  // announcement this PC has heard from whichever PC *is* currently marked
  // (see discovery.js), or null if none has been heard recently. The main
  // HTTP API itself is still 127.0.0.1-only (see start() below); only the
  // small UDP discovery beacon and the export-sync serve port (see
  // exportSync.js, started/stopped alongside the beacon's own announcing
  // just below) actually reach the network.
  app.get('/api/server-status', (req, res) => {
    const nets = os.networkInterfaces();
    const addresses = [];
    for (const entries of Object.values(nets)) {
      for (const net of entries || []) {
        if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
      }
    }
    res.json({
      ...getServerConfig(),
      addresses,
      stats: getStats(),
      discoveredServer: beacon ? beacon.getDiscoveredServer() : null,
    });
  });

  app.post('/api/server-status', (req, res) => {
    const { isServer } = req.body || {};
    const config = setServerConfig({ isServer: !!isServer });
    if (beacon) {
      if (config.isServer) beacon.startAnnouncing({ confirmedAt: config.confirmedAt });
      else beacon.stopAnnouncing();
    }
    // The export-sync serve port (see exportSync.js) only ever runs on the
    // PC currently marked isServer, same as the beacon's own announcing -
    // other PCs' auto-sync pulls have nothing to fetch from an unmarked PC.
    if (exportServeServer) {
      if (config.isServer) exportServeServer.start();
      else exportServeServer.stop();
    }
    // Same gating for the Mash Bill Library's serve port (see
    // mashBillSync.js) - only the PC currently marked isServer answers
    // GET/POST/PUT/DELETE /mashbills for everyone else's pull/forwardWrite.
    if (mashBillServeServer) {
      if (config.isServer) mashBillServeServer.start();
      else mashBillServeServer.stop();
    }
    // Same gating for the Beer Bible's serve port (see beerBibleSync.js) -
    // only the PC currently marked isServer answers GET/POST/PUT/DELETE
    // /beers for everyone else's pull/forwardWrite.
    if (beerBibleServeServer) {
      if (config.isServer) beerBibleServeServer.start();
      else beerBibleServeServer.stop();
    }
    res.json(config);
  });

  // Manual fallback for a beer SKU lookup whose automatic Untappd search
  // came up empty (see enrichBeerFromUntappd's untappdError in
  // productImport.js) - Untappd's search-results page renders client-side,
  // so this app can never scrape it directly, but the beer's own page is a
  // normal server-rendered page. Staff search Untappd themselves, then hand
  // this the beer page's URL; `current` is the form's present field values
  // (from the client's readForm()), which this only ever adds to, never
  // clears - see mergeUntappdBeer.
  app.post('/api/untappd-lookup', async (req, res) => {
    const { current, untappdUrl } = req.body || {};

    if (!untappdUrl || typeof untappdUrl !== 'string' || !untappdUrl.trim()) {
      return res.status(400).json({ error: "Enter the beer's Untappd URL first." });
    }

    try {
      const fields = await untappdBeerFromUrl(current, untappdUrl.trim());
      res.json(fields);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not read that Untappd page.' });
    }
  });

  // Fallback for /api/untappd-lookup above when even the beer's own page
  // gets blocked outright - same paste-the-HTML pattern as /api/sku-lookup-html.
  app.post('/api/untappd-lookup-html', async (req, res) => {
    const { current, html, url } = req.body || {};

    if (!html || typeof html !== 'string' || !html.trim()) {
      return res.status(400).json({ error: "Paste the beer page's HTML first." });
    }

    try {
      const fields = await untappdBeerFromHtml(current, { html, url });
      res.json(fields);
    } catch (err) {
      res.status(400).json({ error: err.message || 'Could not read that pasted HTML.' });
    }
  });

  // Manual Untappd search - the "Or search Untappd yourself" box at the
  // bottom of the Pick the Right Beer dialog (openUntappdPicker in
  // app.js), for when the beer's own automatic search - its confident
  // match, or the tied candidates it offered instead - wasn't actually
  // the right beer. Reuses the exact same raw candidate search
  // algoliaSearchBeerCandidates (productImport.js) does for a tie, but
  // skips matchUntappdCandidates' scoring/tie-detection entirely: a
  // hand-typed query doesn't get to silently guess a "best" one on
  // staff's behalf, it always hands back whatever Untappd found (already
  // ranked by Untappd's own relevance) for a human to pick from, same
  // shape as UntappdAmbiguousMatchError's own `candidates` -
  // {url, title, brewery, beerName} - so the client can render/pick from
  // either set with the same code.
  app.post('/api/untappd-search', async (req, res) => {
    const query = ((req.body && req.body.query) || '').trim();
    if (!query) return res.status(400).json({ error: 'Enter something to search Untappd for.' });

    try {
      const candidates = await algoliaSearchBeerCandidates(query);
      res.json({ candidates });
    } catch (err) {
      res.status(502).json({ error: err.message || "Untappd's search isn't responding right now." });
    }
  });

  return app;
}

/**
 * Starts the server, bound to localhost only (the main app is a single-PC
 * tool, not meant to be reachable from the network). Returns the underlying
 * http.Server instance once listening, so callers (e.g. the Electron main
 * process) can close it on shutdown.
 *
 * Also starts three small, separate network surfaces the main app itself
 * doesn't use:
 *  - the LAN discovery beacon (see discovery.js): every PC listens for
 *    announcements from whichever PC is marked the main store PC, and this
 *    one starts sending its own if it's already marked when it boots.
 *  - the export-sync puller (see exportSync.js): every PC polls on an
 *    interval for a synced export file, but only actually fetches anything
 *    once auto-sync is turned on (see upcCatalog.js's isAutoSyncEnabled).
 *    If this PC is already marked isServer when it boots, its own
 *    export-serve port starts too, so other PCs' pulls have something to
 *    fetch from immediately rather than waiting for the Server PC dialog to
 *    be opened and re-saved.
 *  - the Mash Bill Library puller (see mashBillSync.js): every PC polls on
 *    the same interval, always (not opt-in like export auto-sync - see that
 *    file's own header comment for why). Same isServer boot check starts
 *    its own serve port immediately when this PC is already marked.
 *  - the Beer Bible puller (see beerBibleSync.js): same always-on polling
 *    and isServer boot check as the Mash Bill Library puller above, just
 *    for /beers instead of /mashbills.
 */
function start(port) {
  const resolvedPort = port || process.env.PORT || 3000;
  const beacon = createBeacon();
  const exportServeServer = createExportServeServer();
  const exportPuller = createExportPuller({ beacon });
  const mashBillServeServer = createMashBillServeServer();
  const mashBillPuller = createMashBillPuller({ beacon });
  const beerBibleServeServer = createBeerBibleServeServer();
  const beerBiblePuller = createBeerBiblePuller({ beacon });
  const app = createApp({
    beacon, exportServeServer, exportPuller, mashBillServeServer, mashBillPuller,
    beerBibleServeServer, beerBiblePuller,
  });
  return new Promise((resolve, reject) => {
    const server = app.listen(resolvedPort, '127.0.0.1', () => {
      beacon.startListening();
      exportPuller.start();
      mashBillPuller.start();
      beerBiblePuller.start();
      const config = getServerConfig();
      if (config.isServer) {
        beacon.startAnnouncing({ confirmedAt: config.confirmedAt });
        exportServeServer.start();
        mashBillServeServer.start();
        beerBibleServeServer.start();
      }
      console.log(`Shelf Talker Wizard running at http://localhost:${resolvedPort}`);
      // Fire-and-forget: never delays the server coming up, and a PC with
      // no internet (or GitHub unreachable) just stays empty and retries
      // on its next launch - see bourbonLibrarySeed.js.
      maybeAutoSeedBourbonLibrary(db);
      // Same fire-and-forget pattern for the Beer Bible - see
      // beerBibleSeed.js.
      maybeAutoSeedBeerBible(db);
      // Same fire-and-forget pattern for the Rum Repository - see
      // rumRepositorySeed.js.
      maybeAutoSeedRumRepository(db);
      resolve(server);
    });
    server.on('error', reject);
    server.on('close', () => {
      beacon.stop();
      exportPuller.stop();
      exportServeServer.stop();
      mashBillPuller.stop();
      mashBillServeServer.stop();
      beerBiblePuller.stop();
      beerBibleServeServer.stop();
    });
  });
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start };
