const os = require('os');
const path = require('path');
const express = require('express');
const {
  extractProduct, extractBeer, findTastingNotes, TASTING_NOTE_PROVIDER_NAMES, parsePastedProduct,
  lookupSku, lookupSkuFromHtml, untappdBeerFromUrl, untappdBeerFromHtml, enrichWineDescriptionFromStore,
} = require('./productImport');
const {
  getUpcSettings, setUpcSettings, lookupUpc, searchByName, previewExport,
} = require('./upcCatalog');
const {
  recordPrintedTalkers, searchHistory, getHistoryEntry, deleteHistoryEntry,
  upsertCachedProduct, getCachedProduct, isFresh, getStats,
} = require('./db');
const { getServerConfig, setServerConfig } = require('./serverConfig');
const { createBeacon } = require('./discovery');

// The LAN discovery beacon (see discovery.js) is only ever passed in by
// start() below - createApp() itself never touches the network, so tests
// that build an app with createApp() alone (see test/index.test.js) never
// bind a UDP socket as a side effect. Without a beacon, /api/server-status
// simply reports no discovered server and its POST is a no-op for
// announcing, rather than crashing.
function createApp({ beacon } = {}) {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

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
  app.get('/api/tasting-notes/sources', (req, res) => {
    res.json({ sources: TASTING_NOTE_PROVIDER_NAMES });
  });

  // Backs the "Find Tasting Notes" dialog (Manual Entry, Wine/Spirits only) -
  // unlike /api/import-url above, there's no URL here: title/vintage come
  // straight from whatever's already in the form, and the server does the
  // searching (see findTastingNotes). An optional `source` restricts the
  // search to one named provider (the dialog's Source dropdown) instead of
  // trying all of them in order.
  app.post('/api/tasting-notes', async (req, res) => {
    const { title, vintage, source } = req.body || {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'A product title is required.' });
    }

    try {
      const result = await findTastingNotes({
        title: title.trim(),
        vintage: typeof vintage === 'string' ? vintage.trim() : '',
        source: typeof source === 'string' && source.trim() ? source.trim() : undefined,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not find tasting notes for that product.' });
    }
  });

  // Backs the "SKU Lookup" tab (which replaced Bulk CSV Import): staff type
  // in the store's own SKU, this searches liquoroutletwinecellars.com for
  // it and pulls title/size/price off the matching product page. For beer,
  // lookupSku also runs a best-effort Untappd search on the title it just
  // found (see enrichBeerFromUntappd in productImport.js) to fill in the
  // description/brewery/style/ABV/IBU/rating a retail page wouldn't have.
  //
  // Layered with a local cache (db.js) keyed by SKU: a lookup less than a
  // day old skips the network entirely (fromCache: true) rather than
  // re-scraping the same product every time it's re-entered; a *failed*
  // network lookup falls back to whatever's cached regardless of age
  // (fromCache + stale: true) rather than a hard error, since a stale price
  // beats no data at all when the site is temporarily blocking requests.
  // Cache key is the SKU as typed, not the category (a user can switch
  // Wine/Beer on the same SKU, a mistake but not this app's to prevent), so
  // the cached entry itself carries the category it was last resolved under
  // (see `category` folded into `data` below) - a fresh hit only skips the
  // network when that matches what's being asked for *now*. Without this, a
  // SKU looked up as Wine/Spirits first, then re-looked-up as Beer within
  // the freshness window, would silently serve back the Wine-only cached
  // copy and skip the beer-only Untappd enrichment step entirely, even
  // though Beer was explicitly requested this time.
  app.post('/api/sku-lookup', async (req, res) => {
    const { sku, category } = req.body || {};

    if (!sku || typeof sku !== 'string' || !sku.trim()) {
      return res.status(400).json({ error: 'A SKU is required.' });
    }
    const trimmedSku = sku.trim();
    const normalizedCategory = category === 'beer' ? 'beer' : 'wine';
    const cached = getCachedProduct({ keyType: 'sku', key: trimmedSku });

    if (isFresh(cached) && cached.data.category === normalizedCategory) {
      return res.json({ ...cached.data, fromCache: true });
    }

    try {
      const product = await lookupSku({ sku: trimmedSku, category });
      const data = { ...product, category: normalizedCategory };
      upsertCachedProduct({ keyType: 'sku', key: trimmedSku, source: 'sku-lookup', data });
      res.json(data);
    } catch (err) {
      if (cached) {
        return res.json({ ...cached.data, fromCache: true, stale: true });
      }
      res.status(502).json({ error: err.message || 'Could not look up that SKU.' });
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
      res.json(product);
    } catch (err) {
      res.status(400).json({ error: err.message || 'Could not read product data from that HTML.' });
    }
  });

  // Backs the "Scan UPC" tab's Settings box: reads/writes the local path to
  // a WinePOS product export file (see upcCatalog.js) - unlike SKU Lookup
  // above, this never makes a network request, since a scanned barcode is
  // the bottle's manufacturer UPC, a different number from the store's own
  // SKU that liquoroutletwinecellars.com's search actually indexes.
  app.get('/api/upc-settings', (req, res) => {
    res.json(getUpcSettings());
  });

  app.post('/api/upc-settings', (req, res) => {
    const { exportPath } = req.body || {};
    if (typeof exportPath !== 'string') {
      return res.status(400).json({ error: 'exportPath must be a string.' });
    }
    res.json(setUpcSettings(exportPath.trim()));
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
  // store lookup just leaves the export's own description in place. Beer
  // skips this step entirely and keeps whatever the export file had, same
  // as before.
  //
  // Also layered with the same product cache /api/sku-lookup uses (see its
  // note above), keyed by UPC instead of SKU - and, now that Wine/Spirits
  // scans make a real network request as part of resolving this, the same
  // category-aware freshness check /api/sku-lookup uses: the cached copy
  // records which category it was resolved under (`lookupCategory`, kept
  // separate from `category`, which is the WinePOS export's own department/
  // class column - a different thing this route never overwrites), and a
  // fresh cache hit is only served when that matches what's being asked for
  // now. Without this, a UPC scanned as Beer first (no store lookup) and
  // then rescanned as Wine/Spirits within the freshness window would
  // silently serve back the Beer-only cached copy and skip the store
  // description lookup entirely. A *failed* lookup still falls back to
  // whatever's cached regardless of category, same as before - stale data
  // (clearly marked) beats sending staff to Manual Entry.
  app.post('/api/upc-lookup', async (req, res) => {
    const { upc, category } = req.body || {};
    if (!upc || typeof upc !== 'string' || !upc.trim()) {
      return res.status(400).json({ error: 'A UPC is required.' });
    }
    const trimmedUpc = upc.trim();
    const normalizedCategory = category === 'beer' ? 'beer' : 'wine';
    const cached = getCachedProduct({ keyType: 'upc', key: trimmedUpc });

    if (isFresh(cached) && cached.data.lookupCategory === normalizedCategory) {
      return res.json({ ...cached.data, fromCache: true });
    }

    try {
      const rawProduct = lookupUpc(trimmedUpc);
      const product = normalizedCategory === 'beer' ? rawProduct : await enrichWineDescriptionFromStore(rawProduct);
      const data = { ...product, lookupCategory: normalizedCategory };
      upsertCachedProduct({ keyType: 'upc', key: trimmedUpc, source: 'scan-upc', data });
      res.json(data);
    } catch (err) {
      if (cached) {
        return res.json({ ...cached.data, fromCache: true, stale: true });
      }
      const status = err.code === 'EXPORT_UNREADABLE' ? 500 : 404;
      res.status(status).json({ error: err.message || 'Could not look up that UPC.', code: err.code });
    }
  });

  // Backs the "Search by Name" tab: staff type part of a product's title and
  // this ranks matches out of the same local WinePOS export file Scan UPC
  // reads above (see searchByName in upcCatalog.js) - no network request,
  // same as UPC lookup's own local-file path, and the same NO_EXPORT_PATH/
  // EXPORT_NOT_FOUND/EXPORT_UNREADABLE error codes. Unlike SKU/UPC lookup
  // there's no single canonical match to cache here - this hands back a
  // short list of candidates for staff to choose from, and nothing gets
  // written to the product cache (db.js) until a specific one is picked, at
  // which point picking it just fills the form the same way the other
  // lookup tabs' results do.
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

  // Backs the desktop app's "View Export File" dialog (Advanced menu) - a
  // read-only look at the raw WinePOS export configured in Scan UPC ->
  // Settings, for confirming it's actually hooked up right without staff
  // needing to go find and open the file themselves.
  app.get('/api/export-preview', (req, res) => {
    try {
      res.json(previewExport({ limit: req.query.limit }));
    } catch (err) {
      const status = err.code === 'EXPORT_UNREADABLE' ? 500 : 404;
      res.status(status).json({ error: err.message || 'Could not read the export file.', code: err.code });
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

  // Backs the desktop app's "View Database" dialog (Advanced menu) - counts
  // plus a page of the most recent Print History rows, reusing searchHistory
  // with no query rather than a separate query, so this list is guaranteed
  // to stay in sync with whatever the History panel itself would show.
  app.get('/api/db-preview', (req, res) => {
    const { rows, total } = searchHistory({ limit: req.query.limit });
    res.json({ history: rows, historyTotal: total, stats: getStats() });
  });

  // Backs the desktop app's "Server PC" dialog (Advanced menu): this PC's
  // LAN-visible IPv4 addresses, the current isServer flag/db stats (so
  // staff can tell whether this looks like the PC with real accumulated
  // data before marking it), and discoveredServer - the most recent LAN
  // announcement this PC has heard from whichever PC *is* currently marked
  // (see discovery.js), or null if none has been heard recently. The HTTP
  // API itself is still 127.0.0.1-only (see start() below); only the small
  // UDP beacon actually reaches the network.
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

  return app;
}

/**
 * Starts the server, bound to localhost only (this is a single-PC tool, not
 * meant to be reachable from the network). Returns the underlying
 * http.Server instance once listening, so callers (e.g. the Electron main
 * process) can close it on shutdown.
 *
 * Also starts the LAN discovery beacon (see discovery.js): every PC listens
 * for announcements from whichever PC is marked the main store PC, and this
 * one starts sending its own if it's already marked when it boots. The
 * beacon is a separate UDP socket, not the HTTP server above - it's the
 * only thing about this that reaches the network.
 */
function start(port) {
  const resolvedPort = port || process.env.PORT || 3000;
  const beacon = createBeacon();
  const app = createApp({ beacon });
  return new Promise((resolve, reject) => {
    const server = app.listen(resolvedPort, '127.0.0.1', () => {
      beacon.startListening();
      const config = getServerConfig();
      if (config.isServer) beacon.startAnnouncing({ confirmedAt: config.confirmedAt });
      console.log(`Shelf Talker Wizard running at http://localhost:${resolvedPort}`);
      resolve(server);
    });
    server.on('error', reject);
    server.on('close', () => beacon.stop());
  });
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start };
