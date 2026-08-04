const path = require('path');
const express = require('express');
const {
  extractProduct, extractBeer, findTastingNotes, TASTING_NOTE_PROVIDER_NAMES, parsePastedProduct,
  lookupSku, lookupSkuFromHtml, untappdBeerFromUrl, untappdBeerFromHtml,
} = require('./productImport');

function createApp() {
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
  app.post('/api/sku-lookup', async (req, res) => {
    const { sku, category } = req.body || {};

    if (!sku || typeof sku !== 'string' || !sku.trim()) {
      return res.status(400).json({ error: 'A SKU is required.' });
    }

    try {
      const product = await lookupSku({ sku: sku.trim(), category });
      res.json(product);
    } catch (err) {
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
 */
function start(port) {
  const resolvedPort = port || process.env.PORT || 3000;
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(resolvedPort, '127.0.0.1', () => {
      console.log(`Shelf Talker Wizard running at http://localhost:${resolvedPort}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start };
