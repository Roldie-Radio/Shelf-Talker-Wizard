// Lets every register share one Beer Bible (see the `beers` table in
// db.js) instead of each PC keeping its own independent, un-synced copy -
// the exact same shape as mashBillSync.js's own Mash Bill Library sync,
// just pointed at /beers instead of /mashbills. A beer can be researched
// (or auto-saved from a Beer talker) at *any* register, so this needs real
// write endpoints too, same reasoning as the Mash Bill Library.
//
// Two halves, same split as mashBillSync.js/exportSync.js:
//  - serve side (createBeerBibleServeServer): a PC marked isServer runs a
//    tiny, dedicated HTTP server - GET/POST/PUT/DELETE on /beers, bound to
//    every interface (0.0.0.0), not just loopback. Its own data.db is the
//    single source of truth: every read/write here goes straight to it, no
//    caching layer of its own.
//  - pull side (createBeerBiblePuller): every PC polls on an interval and
//    keeps the last successfully fetched list in memory, so GET /api/beers
//    (see index.js) never blocks on a live round trip and keeps working off
//    a stale-but-recent copy if the Server PC is temporarily unreachable.
//    Not gated behind an opt-in setting, same as the Mash Bill puller - a
//    beer researched at one register should show up everywhere without
//    someone first finding and flipping a setting. The same object also
//    exposes forwardWrite(), which a non-Server PC's /api/beers route
//    handler (see index.js) uses to relay a save/edit/delete to whichever
//    PC currently holds the role, then immediately re-syncs so the local
//    cache reflects it without waiting up to SYNC_INTERVAL_MS for the next
//    poll.
//
// Deliberately its own port/module rather than folded into mashBillSync.js -
// same "a single-purpose, easy-to-reason-about surface" argument that
// file's own header comment makes for keeping the mash-bill-serve port out
// of the export sync's own module.

const http = require('http');
const {
  listBeers, upsertBeer, updateBeerById, deleteBeer,
} = require('./db');

const BEER_BIBLE_SYNC_PORT = 41237;
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
  const idMatch = url.match(/^\/beers\/(\d+)$/);

  try {
    if (req.method === 'GET' && url === '/beers') {
      return sendJson(res, 200, { beers: listBeers() });
    }

    if (req.method === 'POST' && url === '/beers') {
      const body = await readJsonBody(req);
      return sendJson(res, 201, upsertBeer(body));
    }

    if (req.method === 'PUT' && idMatch) {
      const body = await readJsonBody(req);
      const updated = updateBeerById(Number(idMatch[1]), body);
      if (!updated) return sendJson(res, 404, { error: 'No beer entry with that id.' });
      return sendJson(res, 200, updated);
    }

    if (req.method === 'DELETE' && idMatch) {
      const deleted = deleteBeer(Number(idMatch[1]));
      if (!deleted) return sendJson(res, 404, { error: 'No beer entry with that id.' });
      return sendJson(res, 200, { success: true });
    }

    return sendJson(res, 404, { error: 'Not found.' });
  } catch (err) {
    const status = err.code === 'BAD_JSON' || err.code === 'TITLE_REQUIRED' ? 400
      : err.code === 'DUPLICATE_TITLE' ? 409 : 500;
    return sendJson(res, status, { error: err.message || 'Something went wrong.', code: err.code });
  }
}

/**
 * A tiny HTTP server (GET/POST/PUT/DELETE on /beers[/:id]) bound to every
 * interface, not just loopback - the point of it, same as
 * mashBillSync.js's own createMashBillServeServer. `port` is overridable so
 * tests can avoid colliding with a real running copy of the app.
 */
function createBeerBibleServeServer({ port = BEER_BIBLE_SYNC_PORT } = {}) {
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
 * same as mashBillSync.js's own createMashBillPuller. Without a discovered
 * server, a sync attempt just records that as its status and leaves the
 * last successfully cached list in place.
 */
function createBeerBiblePuller({ beacon, port = BEER_BIBLE_SYNC_PORT, intervalMs = SYNC_INTERVAL_MS } = {}) {
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
      const resp = await fetch(`http://${found.address}:${port}/beers`);
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
      cached = Array.isArray(body.beers) ? body.beers : [];
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
  BEER_BIBLE_SYNC_PORT,
  SYNC_INTERVAL_MS,
  createBeerBibleServeServer,
  createBeerBiblePuller,
};
