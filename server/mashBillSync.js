// Lets every register share one Mash Bill Library (see the mash_bills table
// in db.js) instead of each PC keeping its own independent, un-synced copy -
// the same shape as exportSync.js's WinePOS export sync, with one real
// difference: the export file only ever has one writer (WinePOS itself, on
// whichever PC is marked Server PC), so that sync is read-only. A mash bill
// can be researched at *any* register, so this needs real write endpoints
// too.
//
// Two halves, same split as exportSync.js:
//  - serve side (createMashBillServeServer): a PC marked isServer runs a
//    tiny, dedicated HTTP server - GET/POST/PUT/DELETE on /mashbills, bound
//    to every interface (0.0.0.0), not just loopback - the point of it, same
//    reasoning as the export-serve port. Its own data.db (see db.js) is the
//    single source of truth: every read/write here goes straight to it, no
//    caching layer of its own.
//  - pull side (createMashBillPuller): every PC polls on an interval and
//    keeps the last successfully fetched list in memory, so GET
//    /api/mashbills (see index.js) never blocks on a live round trip and
//    keeps working off a stale-but-recent copy if the Server PC is
//    temporarily unreachable - same graceful-degradation spirit as the UPC
//    export's own auto-sync fallback. Unlike that export sync, this pull
//    loop is NOT gated behind an opt-in "auto-sync" setting - recall only
//    being usable after someone finds and flips a setting would defeat the
//    point, so every PC always tries to stay current. The same object also
//    exposes forwardWrite(), which a non-Server PC's /api/mashbills route
//    handler (see index.js) uses to relay a save/edit/delete to whichever PC
//    currently holds the role, then immediately re-syncs so the local cache
//    reflects it without waiting up to SYNC_INTERVAL_MS for the next poll.
//
// Deliberately its own port/module rather than folded into exportSync.js -
// same "a single-purpose, easy-to-reason-about surface" argument that file's
// own header comment makes for keeping the export-serve port out of the main
// Express app, just applied one level up: this shares almost no code with
// export sync (it needs real request bodies and multiple methods, that one
// never does) and conflating "sync the read-only WinePOS file" with "sync a
// writable shared table" in one file would make both harder to follow.

const http = require('http');
const {
  listMashBills, upsertMashBill, updateMashBillById, deleteMashBill,
} = require('./db');

const MASH_BILL_SYNC_PORT = 41236;
const SYNC_INTERVAL_MS = 30000;

// ================================================================
// Serve side - only ever run on a PC currently marked isServer.
// ================================================================

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Malformed JSON body.'), { code: 'BAD_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handleRequest(req, res) {
  const url = (req.url || '').split('?')[0];
  const idMatch = url.match(/^\/mashbills\/(\d+)$/);

  try {
    if (req.method === 'GET' && url === '/mashbills') {
      return sendJson(res, 200, { mashBills: listMashBills() });
    }

    if (req.method === 'POST' && url === '/mashbills') {
      const body = await readJsonBody(req);
      return sendJson(res, 201, upsertMashBill(body));
    }

    if (req.method === 'PUT' && idMatch) {
      const body = await readJsonBody(req);
      const updated = updateMashBillById(Number(idMatch[1]), body);
      if (!updated) return sendJson(res, 404, { error: 'No mash bill entry with that id.' });
      return sendJson(res, 200, updated);
    }

    if (req.method === 'DELETE' && idMatch) {
      const deleted = deleteMashBill(Number(idMatch[1]));
      if (!deleted) return sendJson(res, 404, { error: 'No mash bill entry with that id.' });
      return sendJson(res, 200, { success: true });
    }

    return sendJson(res, 404, { error: 'Not found.' });
  } catch (err) {
    const status = err.code === 'BAD_JSON' || err.code === 'TITLE_REQUIRED' || err.code === 'GRAINS_REQUIRED' ? 400
      : err.code === 'DUPLICATE_TITLE' ? 409 : 500;
    return sendJson(res, status, { error: err.message || 'Something went wrong.', code: err.code });
  }
}

/**
 * A tiny HTTP server (GET/POST/PUT/DELETE on /mashbills[/:id]) bound to
 * every interface, not just loopback - the point of it, same as
 * exportSync.js's own createExportServeServer. `port` is overridable so
 * tests can avoid colliding with a real running copy of the app.
 */
function createMashBillServeServer({ port = MASH_BILL_SYNC_PORT } = {}) {
  const server = http.createServer((req, res) => { handleRequest(req, res); });
  server.on('error', () => {}); // best-effort, same spirit as the beacon/export-serve server
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
// Pull side - runs on every PC, always (not gated by an opt-in setting -
// see the header comment above for why).
// ================================================================

/**
 * Wires the pull loop to a real `beacon` (see discovery.js's createBeacon) -
 * `beacon.getDiscoveredServer()` is how this finds the Server PC's address,
 * same as exportSync.js's own createExportPuller. Without a discovered
 * server, a sync attempt just records that as its status and leaves the
 * last successfully cached list in place.
 */
function createMashBillPuller({ beacon, port = MASH_BILL_SYNC_PORT, intervalMs = SYNC_INTERVAL_MS } = {}) {
  let timer = null;
  let cached = [];
  let status = { lastSyncedAt: null, lastError: null, syncedFrom: null };

  function discoveredAddress() {
    const discovered = beacon ? beacon.getDiscoveredServer() : null;
    return discovered && discovered.addresses && discovered.addresses[0]
      ? { address: discovered.addresses[0], hostname: discovered.hostname }
      : null;
  }

  async function syncOnce() {
    const found = discoveredAddress();
    if (!found) {
      status = { ...status, lastError: 'No Server PC found on this network yet.' };
      return;
    }

    try {
      const resp = await fetch(`http://${found.address}:${port}/mashbills`);
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
      const body = await resp.json();
      cached = Array.isArray(body.mashBills) ? body.mashBills : [];
      status = { lastSyncedAt: new Date().toISOString(), lastError: null, syncedFrom: found.hostname };
    } catch (err) {
      // Keep the previous cached list/syncedFrom - a failed sync doesn't
      // erase the last good one, same as the export puller's own fallback.
      status = { ...status, lastError: err.message || 'Could not reach the Server PC.' };
    }
  }

  // Relays a save/edit/delete made on this (non-Server) PC to whichever PC
  // currently holds the role, then re-syncs immediately so `cached` reflects
  // it right away instead of waiting up to `intervalMs` for the next poll.
  // Throws (rather than returning an error shape) on anything that isn't a
  // reachable server responding with JSON - index.js's route handlers turn
  // that into the request's own error response.
  async function forwardWrite(method, path, body) {
    const found = discoveredAddress();
    if (!found) throw new Error('No Server PC found on this network yet.');

    const resp = await fetch(`http://${found.address}:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    let data = null;
    try {
      data = await resp.json();
    } catch {
      // No/invalid JSON body - data stays null, status still carries the result.
    }
    await syncOnce();
    return { status: resp.status, data };
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

  function getCached() {
    return cached;
  }

  function getStatus() {
    return status;
  }

  return {
    start, stop, syncOnce, forwardWrite, getCached, getStatus,
  };
}

module.exports = {
  MASH_BILL_SYNC_PORT,
  SYNC_INTERVAL_MS,
  createMashBillServeServer,
  createMashBillPuller,
};
