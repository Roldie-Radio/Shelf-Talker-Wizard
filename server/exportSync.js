// Lets a non-server register automatically keep its Scan UPC export file
// (see upcCatalog.js) in sync with whichever PC is currently marked the
// Server PC (see serverConfig.js/discovery.js), instead of staff manually
// copying the WinePOS export file to every register by hand.
//
// Two halves, the same shape as discovery.js's beacon:
//  - serve side (createExportServeServer): a PC marked isServer runs a
//    tiny, dedicated HTTP server - GET /export and nothing else, read-only.
//    Bound to 0.0.0.0 (unlike the main app, which stays 127.0.0.1-only -
//    see index.js) because this is the one thing meant to be reachable
//    from other PCs on the LAN. Kept as its own tiny http.Server rather
//    than folded into the main Express app for the same reason the UDP
//    discovery beacon is a separate socket, not another Express route: a
//    single-purpose, read-only, LAN-reachable surface is easy to reason
//    about in a way "the whole app, but now on the network" isn't. Only
//    ever started by index.js's start() when this PC is marked isServer,
//    same as the beacon's own announcing half.
//  - pull side (createExportPuller): every PC polls on an interval,
//    fetching from whichever server the discovery beacon has most recently
//    heard from (see discovery.js's getDiscoveredServer) and writing what
//    it gets back to a local file - but only does anything once auto-sync
//    is turned on (see upcCatalog.js's isAutoSyncEnabled/setAutoSync), so a
//    PC that hasn't opted in never makes this request. Runs continuously
//    regardless of this PC's own isServer flag, same as the beacon always
//    listens - auto-sync and "is this PC the server" are independent
//    settings (a store could, oddly but harmlessly, mark the same PC as
//    both, though the serve side always serves its *own* manually
//    configured file rather than a copy of what it just synced - see
//    upcCatalog.js's readExportFileRaw).
//
// Deliberately not wired through discovery.js's own UDP socket: that wire
// format is small and fixed (see discovery.js's MAGIC/payload shape) and
// was never meant to carry a whole export file's worth of bytes, and a
// dedicated TCP request/response is a much better fit for "fetch this file"
// than a repeating broadcast would be anyway.

const http = require('http');
const fs = require('fs');
const {
  readExportFileRaw, syncedExportFilePath, isAutoSyncEnabled,
} = require('./upcCatalog');
const { getAppDataDir } = require('./appData');

const EXPORT_SYNC_PORT = 41235;
const SYNC_INTERVAL_MS = 30000;

// ================================================================
// Serve side - only ever run on a PC currently marked isServer.
// ================================================================

function handleRequest(req, res) {
  const url = (req.url || '').split('?')[0];
  if (req.method !== 'GET' || url !== '/export') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found.' }));
    return;
  }

  try {
    const { content, mtimeMs } = readExportFileRaw();
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Export-Mtime': String(mtimeMs),
    });
    res.end(content);
  } catch (err) {
    const status = err.code === 'EXPORT_UNREADABLE' ? 500 : 404;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message, code: err.code }));
  }
}

/**
 * A tiny HTTP server with exactly one route (GET /export, the raw
 * configured export file) bound to every interface, not just loopback -
 * the point of it. `port` is overridable so tests can avoid colliding with
 * a real running copy of the app on the same machine, same as
 * discovery.js's createBeacon({ port }).
 */
function createExportServeServer({ port = EXPORT_SYNC_PORT } = {}) {
  const server = http.createServer(handleRequest);
  server.on('error', () => {}); // best-effort, same spirit as the beacon
  let listening = false;

  function start() {
    if (listening) return Promise.resolve();
    return new Promise((resolve) => {
      server.listen(port, '0.0.0.0', () => {
        listening = true;
        resolve();
      });
    });
  }

  function stop() {
    if (!listening) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => {
        listening = false;
        resolve();
      });
    });
  }

  return { start, stop };
}

// ================================================================
// Pull side - runs on every PC, but only fetches anything once auto-sync
// is turned on.
// ================================================================

/**
 * Wires the pull loop to a real `beacon` (see discovery.js's createBeacon) -
 * `beacon.getDiscoveredServer()` is how this finds the Server PC's address,
 * the same source the Server PC dialog's own "Main store PC on this
 * network" line reads. Without a discovered server (nothing announcing yet,
 * or this PC hasn't heard it in a while - see discovery.js's STALE_AFTER_MS)
 * a sync attempt just records that as its status and leaves whatever was
 * last successfully synced in place, same graceful-degradation spirit as
 * the SKU/UPC lookup cache falling back to stale data over a hard error.
 */
function createExportPuller({ beacon, port = EXPORT_SYNC_PORT, intervalMs = SYNC_INTERVAL_MS } = {}) {
  let timer = null;
  let status = { lastSyncedAt: null, lastError: null, syncedFrom: null };

  async function syncOnce() {
    if (!isAutoSyncEnabled()) return;

    const discovered = beacon ? beacon.getDiscoveredServer() : null;
    const address = discovered && discovered.addresses && discovered.addresses[0];
    if (!address) {
      status = { ...status, lastError: 'No Server PC found on this network yet.' };
      return;
    }

    try {
      const resp = await fetch(`http://${address}:${port}/export`);
      if (!resp.ok) {
        let message = `The Server PC returned an error (HTTP ${resp.status}).`;
        try {
          const body = await resp.json();
          if (body && body.error) message = body.error;
        } catch {
          // Not a JSON body - keep the generic message above.
        }
        throw new Error(message);
      }
      const text = await resp.text();
      fs.mkdirSync(getAppDataDir(), { recursive: true });
      fs.writeFileSync(syncedExportFilePath(), text, 'utf-8');
      status = { lastSyncedAt: new Date().toISOString(), lastError: null, syncedFrom: discovered.hostname };
    } catch (err) {
      // Keep the previous syncedFrom/lastSyncedAt - a failed sync doesn't
      // erase the last good one, same as SKU/UPC lookup's own stale-cache
      // fallback (see index.js's /api/sku-lookup and /api/upc-lookup).
      status = { ...status, lastError: err.message || 'Could not reach the Server PC.' };
    }
  }

  function start() {
    syncOnce();
    timer = setInterval(syncOnce, intervalMs);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function getStatus() {
    return status;
  }

  return {
    start, stop, syncOnce, getStatus,
  };
}

module.exports = {
  EXPORT_SYNC_PORT,
  SYNC_INTERVAL_MS,
  createExportServeServer,
  createExportPuller,
};
