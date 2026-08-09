const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createExportServeServer, createExportPuller } = require('../server/exportSync');
const { setUpcSettings, setAutoSync, syncedExportFilePath } = require('../server/upcCatalog');

// Same per-test throwaway config dir pattern as test/upcCatalog.test.js,
// but `async`/`await fn(dir)` rather than `return fn(dir)` - every caller
// here is async (real HTTP round trips, mocked fetch), and a plain `return`
// would let the `finally` below restore SHELF_TALKER_CONFIG_DIR and delete
// `dir` the moment `fn` merely *starts* (returns its pending promise)
// rather than after it finishes, silently pointing the rest of the test at
// a deleted directory. See test/index.test.js's withTempDb for the same
// fix applied to the same latent bug there.
async function withTempConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-talker-exportsync-test-'));
  const prev = process.env.SHELF_TALKER_CONFIG_DIR;
  process.env.SHELF_TALKER_CONFIG_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.SHELF_TALKER_CONFIG_DIR;
    else process.env.SHELF_TALKER_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeExport(dir, name, contents) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents, 'utf-8');
  return filePath;
}

// Distinct from EXPORT_SYNC_PORT (41235) - real deployments must all agree
// on that one, but these tests bind their own real sockets and shouldn't
// fight a real running copy of the app on the same machine.
const TEST_PORT = 41735;

function getRaw(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
    }).on('error', reject);
  });
}

// Same mock-the-global-fetch technique as test/index.test.js/
// test/productImport.test.js - createExportPuller's own outbound fetch is
// the only thing that touches globalThis.fetch here.
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
// createExportServeServer - serve side, real HTTP round trip (a PC
// currently marked isServer).
// ================================================================

test('createExportServeServer serves the configured export file at GET /export', async () => {
  await withTempConfigDir(async (dir) => {
    const filePath = writeExport(dir, 'items.csv', 'UPC,Title\n085000010652,Josh Cellars\n');
    setUpcSettings(filePath);

    const server = createExportServeServer({ port: TEST_PORT });
    await server.start();
    try {
      const { status, headers, body } = await getRaw(TEST_PORT, '/export');
      assert.equal(status, 200);
      assert.match(headers['content-type'], /text\/plain/);
      assert.ok(headers['x-export-mtime']);
      assert.equal(body, 'UPC,Title\n085000010652,Josh Cellars\n');
    } finally {
      await server.stop();
    }
  });
});

test('createExportServeServer responds 404 with NO_EXPORT_PATH when nothing is configured', async () => {
  await withTempConfigDir(async () => {
    const server = createExportServeServer({ port: TEST_PORT + 1 });
    await server.start();
    try {
      const { status, body } = await getRaw(TEST_PORT + 1, '/export');
      assert.equal(status, 404);
      assert.equal(JSON.parse(body).code, 'NO_EXPORT_PATH');
    } finally {
      await server.stop();
    }
  });
});

test('createExportServeServer responds 404 with EXPORT_NOT_FOUND when the configured file is missing', async () => {
  await withTempConfigDir(async (dir) => {
    setUpcSettings(path.join(dir, 'nope.csv'));
    const server = createExportServeServer({ port: TEST_PORT + 2 });
    await server.start();
    try {
      const { status, body } = await getRaw(TEST_PORT + 2, '/export');
      assert.equal(status, 404);
      assert.equal(JSON.parse(body).code, 'EXPORT_NOT_FOUND');
    } finally {
      await server.stop();
    }
  });
});

test('createExportServeServer responds 404 for any other path - no other route exists', async () => {
  await withTempConfigDir(async (dir) => {
    setUpcSettings(writeExport(dir, 'items.csv', 'UPC,Title\n1,A\n'));
    const server = createExportServeServer({ port: TEST_PORT + 3 });
    await server.start();
    try {
      const { status } = await getRaw(TEST_PORT + 3, '/');
      assert.equal(status, 404);
    } finally {
      await server.stop();
    }
  });
});

test('createExportServeServer always serves the manually configured file, ignoring this PC\'s own auto-sync setting', async () => {
  await withTempConfigDir(async (dir) => {
    const manualPath = writeExport(dir, 'manual.csv', 'UPC,Title\n1,Real WinePOS export\n');
    setUpcSettings(manualPath);
    setAutoSync(true); // misconfigured (also marked isServer, hypothetically), shouldn't matter
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(syncedExportFilePath(), 'UPC,Title\n2,Should never be served\n', 'utf-8');

    const server = createExportServeServer({ port: TEST_PORT + 4 });
    await server.start();
    try {
      const { body } = await getRaw(TEST_PORT + 4, '/export');
      assert.match(body, /Real WinePOS export/);
    } finally {
      await server.stop();
    }
  });
});

// ================================================================
// createExportPuller - pull side, mocked fetch/beacon (every PC).
// ================================================================

test('createExportPuller.syncOnce does nothing when auto-sync is off', async () => {
  await withTempConfigDir(async () => {
    let called = false;
    await withMockFetch(async () => { called = true; return { ok: true, text: async () => '' }; }, async () => {
      const puller = createExportPuller({ beacon: fakeBeacon({ hostname: 'SERVER-PC', addresses: ['192.168.1.10'] }) });
      await puller.syncOnce();
      assert.equal(called, false);
      assert.deepEqual(puller.getStatus(), { lastSyncedAt: null, lastError: null, syncedFrom: null });
    });
  });
});

test('createExportPuller.syncOnce records an error when no Server PC has been discovered yet', async () => {
  await withTempConfigDir(async () => {
    setAutoSync(true);
    const puller = createExportPuller({ beacon: fakeBeacon(null) });
    await puller.syncOnce();
    const status = puller.getStatus();
    assert.match(status.lastError, /No Server PC found/);
    assert.equal(status.lastSyncedAt, null);
  });
});

test('createExportPuller.syncOnce fetches from the discovered server and writes the synced file', async () => {
  await withTempConfigDir(async () => {
    setAutoSync(true);
    let requestedUrl = null;
    await withMockFetch(async (url) => {
      requestedUrl = url;
      return { ok: true, status: 200, text: async () => 'UPC,Title\n1,Synced\n' };
    }, async () => {
      const puller = createExportPuller({
        beacon: fakeBeacon({ hostname: 'SERVER-PC', addresses: ['192.168.1.10'] }),
        port: 41235,
      });
      await puller.syncOnce();

      assert.equal(requestedUrl, 'http://192.168.1.10:41235/export');
      assert.equal(fs.readFileSync(syncedExportFilePath(), 'utf-8'), 'UPC,Title\n1,Synced\n');

      const status = puller.getStatus();
      assert.equal(status.syncedFrom, 'SERVER-PC');
      assert.equal(status.lastError, null);
      assert.ok(status.lastSyncedAt);
    });
  });
});

test('createExportPuller.syncOnce records the server\'s own error body on a non-ok response', async () => {
  await withTempConfigDir(async () => {
    setAutoSync(true);
    await withMockFetch(async () => ({
      ok: false, status: 404, json: async () => ({ error: 'No export file location is set yet.', code: 'NO_EXPORT_PATH' }),
    }), async () => {
      const puller = createExportPuller({ beacon: fakeBeacon({ hostname: 'SERVER-PC', addresses: ['192.168.1.10'] }) });
      await puller.syncOnce();
      assert.equal(puller.getStatus().lastError, 'No export file location is set yet.');
    });
  });
});

test('createExportPuller.syncOnce keeps the last successful sync status when a later sync fails', async () => {
  await withTempConfigDir(async () => {
    setAutoSync(true);
    const beacon = fakeBeacon({ hostname: 'SERVER-PC', addresses: ['192.168.1.10'] });
    const puller = createExportPuller({ beacon });

    await withMockFetch(async () => ({ ok: true, status: 200, text: async () => 'UPC,Title\n1,A\n' }), async () => {
      await puller.syncOnce();
    });
    const goodStatus = puller.getStatus();
    assert.ok(goodStatus.lastSyncedAt);
    assert.equal(goodStatus.syncedFrom, 'SERVER-PC');

    await withMockFetch(async () => { throw new Error('network down'); }, async () => {
      await puller.syncOnce();
    });
    const afterFailure = puller.getStatus();
    assert.equal(afterFailure.lastError, 'network down');
    // The previous success is still on record, not wiped by the failure.
    assert.equal(afterFailure.lastSyncedAt, goodStatus.lastSyncedAt);
    assert.equal(afterFailure.syncedFrom, 'SERVER-PC');
  });
});

test('createExportPuller.syncOnce uses the discovered server\'s first address', async () => {
  await withTempConfigDir(async () => {
    setAutoSync(true);
    let requestedUrl = null;
    await withMockFetch(async (url) => {
      requestedUrl = url;
      return { ok: true, status: 200, text: async () => '' };
    }, async () => {
      const puller = createExportPuller({
        beacon: fakeBeacon({ hostname: 'SERVER-PC', addresses: ['10.0.0.5', '10.0.0.6'] }),
        port: 41235,
      });
      await puller.syncOnce();
      assert.equal(requestedUrl, 'http://10.0.0.5:41235/export');
    });
  });
});

test('createExportPuller without a beacon wired in still records "no server found" rather than throwing', async () => {
  await withTempConfigDir(async () => {
    setAutoSync(true);
    const puller = createExportPuller({});
    await assert.doesNotReject(() => puller.syncOnce());
    assert.match(puller.getStatus().lastError, /No Server PC found/);
  });
});
