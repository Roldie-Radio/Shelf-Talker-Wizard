const path = require('path');
const express = require('express');
const { extractProduct } = require('./productImport');

function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.post('/api/import-url', async (req, res) => {
    const { url } = req.body || {};

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
      const product = await extractProduct(parsed.toString());
      res.json(product);
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not read product data from that page.' });
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
