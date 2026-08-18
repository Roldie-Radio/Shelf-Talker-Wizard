const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createBeerBibleServeServer, createBeerBiblePuller } = require('../server/beerBibleSync');
const db = require('../server/db');

// Same per-test throwaway config dir + closeDb() pattern as
// test/mashBillSync.test.js - this module's serve side reads/writes real
// data.db rows, so both need cleaning up.
async function withTempConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-talker-beerbiblesync-test-'));
  const prev = process.env.SHELF_TALKER_CONFIG_DIR;
  process.env.SHELF_TALKER_CONFIG_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    db.closeDb();
    if (prev === undefined) delete process.env.SHELF_TALKER_CONFIG_DIR;
    else process.env.SHELF_TALKER_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Distinct from BEER_BIBLE_SYNC_PORT (41237) - real deployments must all
// agree on that one, but these tests bind their own real sockets and
// shouldn't fight a real running copy of the app on the same machine.
const TEST_PORT = 41937;

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method, headers: data ? { 'Content-Type': 'application/json' } : {},
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Same mock-the-global-fetch technique as test/mashBillSync.test.js.
async function withMockFetch(impl, run) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

function fakeBeacon(discoveredServer) {
  return { getDiscoveredServer: () => discoveredServer };
}

// ================================================================
// createBeerBibleServeServer - serve side, real HTTP round trip (a PC
// currently marked isServer).
// ================================================================

test('createBeerBibleServeServer supports create, list, update, and delete over real HTTP', async () => {
  await withTempConfigDir(async () => {
    const server = createBeerBibleServeServer({ port: TEST_PORT });
    await server.start();
    try {
      const created = await request(TEST_PORT, 'POST', '/beers', {
        title: 'Bell\'s Two Hearted Ale', brewery: 'Bell\'s Brewery', source: 'Manual',
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.title, "Bell's Two Hearted Ale");
      assert.ok(created.body.id);

      const listed = await request(TEST_PORT, 'GET', '/beers');
      assert.equal(listed.status, 200);
      assert.equal(listed.body.beers.length, 1);

      const updated = await request(TEST_PORT, 'PUT', `/beers/${created.body.id}`, {
        title: "Bell's Two Hearted Ale", style: 'American IPA', abv: '7%',
      });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.style, 'American IPA');

      const deleted = await request(TEST_PORT, 'DELETE', `/beers/${created.body.id}`);
      assert.equal(deleted.status, 200);
      assert.deepEqual((await request(TEST_PORT, 'GET', '/beers')).body.beers, []);
    } finally {
      await server.stop();
    }
  });
});

test('createBeerBibleServeServer POST upserts by title instead of erroring on a repeat save', async () => {
  await withTempConfigDir(async () => {
    const server = createBeerBibleServeServer({ port: TEST_PORT + 1 });
    await server.start();
    try {
      await request(TEST_PORT + 1, 'POST', '/beers', { title: 'Fat Tire' });
      const second = await request(TEST_PORT + 1, 'POST', '/beers', { title: 'fat tire', style: 'Amber Ale' });
      assert.equal(second.status, 201);
      const listed = await request(TEST_PORT + 1, 'GET', '/beers');
      assert.equal(listed.body.beers.length, 1);
      assert.equal(listed.body.beers[0].style, 'Amber Ale');
    } finally {
      await server.stop();
    }
  });
});

test('createBeerBibleServeServer responds 400 for a missing title, 404 for an unknown id', async () => {
  await withTempConfigDir(async () => {
    const server = createBeerBibleServeServer({ port: TEST_PORT + 2 });
    await server.start();
    try {
      const badPost = await request(TEST_PORT + 2, 'POST', '/beers', { brewery: 'Nobody' });
      assert.equal(badPost.status, 400);
      assert.equal(badPost.body.code, 'TITLE_REQUIRED');

      const missingPut = await request(TEST_PORT + 2, 'PUT', '/beers/999999', { title: 'Nope' });
      assert.equal(missingPut.status, 404);

      const missingDelete = await request(TEST_PORT + 2, 'DELETE', '/beers/999999');
      assert.equal(missingDelete.status, 404);
    } finally {
      await server.stop();
    }
  });
});

test('createBeerBibleServeServer responds 404 for any other route', async () => {
  await withTempConfigDir(async () => {
    const server = createBeerBibleServeServer({ port: TEST_PORT + 3 });
    await server.start();
    try {
      const { status } = await request(TEST_PORT + 3, 'GET', '/');
      assert.equal(status, 404);
    } finally {
      await server.stop();
    }
  });
});

// ================================================================
// createBeerBiblePuller - pull side, mocked fetch/beacon (every PC).
// ================================================================

test('createBeerBiblePuller.syncOnce records an error when no Server PC has been discovered yet', async () => {
  await withTempConfigDir(async () => {
    const puller = createBeerBiblePuller({ beacon: fakeBeacon(null) });
    await puller.syncOnce();
    assert.match(puller.getStatus().lastError, /No Server PC found/);
    assert.deepEqual(puller.getCached(), []);
  });
});

test('createBeerBiblePuller.syncOnce fetches from the discovered server and caches the list (not gated by any opt-in setting)', async () => {
  await withTempConfigDir(async () => {
    let requestedUrl = null;
    await withMockFetch(async (url) => {
      requestedUrl = url;
      return { ok: true, status: 200, json: async () => ({ beers: [{ id: 1, title: 'Fat Tire' }] }) };
    }, async () => {
      const puller = createBeerBiblePuller({
        beacon: fakeBeacon({ hostname: 'SERVER-PC', addresses: ['192.168.1.10'] }),
        port: 41237,
      });
      await puller.syncOnce();

      assert.equal(requestedUrl, 'http://192.168.1.10:41237/beers');
      assert.deepEqual(puller.getCached(), [{ id: 1, title: 'Fat Tire' }]);
      const status = puller.getStatus();
      assert.equal(status.syncedFrom, 'SERVER-PC');
      assert.equal(status.lastError, null);
      assert.ok(status.lastSyncedAt);
    });
  });
});

test('createBeerBiblePuller.syncOnce keeps the last cached list when a later sync fails', async () => {
  await withTempConfigDir(async () => {
    const beacon = fakeBeacon({ hostname: 'SERVER-PC', addresses: ['192.168.1.10'] });
    const puller = createBeerBiblePuller({ beacon });

    await withMockFetch(async () => ({ ok: true, status: 200, json: async () => ({ beers: [{ id: 1, title: 'Fat Tire' }] }) }), async () => {
      await puller.syncOnce();
    });

    await withMockFetch(async () => { throw new Error('network down'); }, async () => {
      await puller.syncOnce();
    });
    assert.equal(puller.getStatus().lastError, 'network down');
    assert.deepEqual(puller.getCached(), [{ id: 1, title: 'Fat Tire' }]);
  });
});

test('forwardWrite throws when no Server PC has been discovered yet', async () => {
  await withTempConfigDir(async () => {
    const puller = createBeerBiblePuller({ beacon: fakeBeacon(null) });
    await assert.rejects(() => puller.forwardWrite('POST', '/beers', { title: 'Fat Tire' }), /No Server PC found/);
  });
});

test('forwardWrite POSTs to the discovered server and re-syncs the cache from its response', async () => {
  await withTempConfigDir(async () => {
    const calls = [];
    await withMockFetch(async (url, opts) => {
      calls.push({ url, opts });
      if (opts && opts.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ id: 1, title: 'Fat Tire' }) };
      }
      // The re-sync GET that follows a successful write.
      return { ok: true, status: 200, json: async () => ({ beers: [{ id: 1, title: 'Fat Tire' }] }) };
    }, async () => {
      const puller = createBeerBiblePuller({
        beacon: fakeBeacon({ hostname: 'SERVER-PC', addresses: ['192.168.1.10'] }),
        port: 41237,
      });
      const result = await puller.forwardWrite('POST', '/beers', { title: 'Fat Tire', style: 'Amber Ale' });

      assert.equal(result.status, 201);
      assert.deepEqual(result.data, { id: 1, title: 'Fat Tire' });
      assert.equal(calls[0].url, 'http://192.168.1.10:41237/beers');
      assert.equal(calls[0].opts.method, 'POST');
      assert.deepEqual(JSON.parse(calls[0].opts.body), { title: 'Fat Tire', style: 'Amber Ale' });
      // forwardWrite re-synced automatically - the cache reflects the write
      // without waiting for the next scheduled poll.
      assert.deepEqual(puller.getCached(), [{ id: 1, title: 'Fat Tire' }]);
    });
  });
});
