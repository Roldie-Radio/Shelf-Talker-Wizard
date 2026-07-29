const path = require('path');
const express = require('express');
const { extractProduct, extractBeer, findTastingNotes, TASTING_NOTE_PROVIDER_NAMES } = require('./productImport');

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
