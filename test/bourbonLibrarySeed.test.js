const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../server/db');
const {
  autoSeedBourbonLibrary, maybeAutoSeedBourbonLibrary, syncNewBourbonLibraryEntries, GITHUB_SEED_URL, BUNDLED_SEED_PATH,
} = require('../server/bourbonLibrarySeed');

// Same throwaway-directory pattern as test/db.test.js, but async - unlike
// that file's withTempDb, autoSeedBourbonLibrary always awaits a fetch (or
// a bundled-file read), so there's no synchronous-only call site to
// preserve here.
async function withTempDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-talker-bourbon-seed-test-'));
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

function withMockFetch(impl, fn) {
  const prev = global.fetch;
  global.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => { global.fetch = prev; });
}

const SAMPLE_ENTRIES = [
  {
    title: 'Buffalo Trace',
    distillery: 'Buffalo Trace Distillery',
    grains: [{ grain: 'Corn', pct: 90 }, { grain: 'Rye', pct: 8 }, { grain: 'Malted Barley', pct: 2 }],
    confidence: { tier: 'reported', note: 'Test note.', sources: [], verifiedAt: '' },
  },
  {
    title: "Maker's Mark",
    distillery: "Maker's Mark Distillery",
    grains: [{ grain: 'Corn', pct: 70 }, { grain: 'Red Winter Wheat', pct: 16 }, { grain: 'Malted Barley', pct: 14 }],
    confidence: { tier: 'confirmed', note: 'Test note.', sources: [], verifiedAt: '' },
  },
];

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

test('autoSeedBourbonLibrary seeds from GitHub when the fetch succeeds', () => withTempDb(() => withMockFetch(
  async (url) => {
    assert.equal(url, GITHUB_SEED_URL);
    return jsonResponse(SAMPLE_ENTRIES);
  },
  async () => {
    const result = await autoSeedBourbonLibrary(db);
    assert.equal(result.seeded, 2);
    assert.equal(result.source, 'GitHub');
    const titles = db.listMashBills().map((m) => m.title).sort();
    assert.deepEqual(titles, ['Buffalo Trace', "Maker's Mark"]);
  },
)));

test('autoSeedBourbonLibrary skips entirely when the library already has entries', () => withTempDb(async () => {
  db.upsertMashBill({
    title: 'Already Here',
    distillery: 'Some Distillery',
    grains: [{ grain: 'Corn', pct: 100 }],
  });

  return withMockFetch(
    async () => { throw new Error('fetch should not have been called'); },
    async () => {
      const result = await autoSeedBourbonLibrary(db);
      assert.equal(result.seeded, 0);
      assert.ok(result.skipped);
      assert.deepEqual(db.listMashBills().map((m) => m.title), ['Already Here']);
    },
  );
}));

// This is the exact real-world failure this fallback exists for: a store
// PC where GitHub (or raw.githubusercontent.com specifically) is
// unreachable - blocked by a firewall/content filter, no internet, DNS
// failure, timeout, a non-ok HTTP response, anything. The library must
// still end up populated from the copy bundled into the install.
test('autoSeedBourbonLibrary falls back to the bundled file when the GitHub fetch fails', () => withTempDb(() => withMockFetch(
  async () => { throw new Error('simulated network failure'); },
  async () => {
    const result = await autoSeedBourbonLibrary(db);
    assert.equal(result.source, 'the bundled copy');
    assert.ok(result.seeded > 0);

    const bundled = require(BUNDLED_SEED_PATH); // eslint-disable-line global-require
    assert.equal(result.seeded, bundled.length);
    const seededTitles = db.listMashBills().map((m) => m.title).sort();
    const bundledTitles = bundled.map((e) => e.title).sort();
    assert.deepEqual(seededTitles, bundledTitles);
  },
)));

test('autoSeedBourbonLibrary also falls back to the bundled file on a non-ok GitHub response', () => withTempDb(() => withMockFetch(
  async () => jsonResponse(null, { ok: false, status: 500 }),
  async () => {
    const result = await autoSeedBourbonLibrary(db);
    assert.equal(result.source, 'the bundled copy');
    assert.ok(result.seeded > 0);
  },
)));

// ---------- syncNewBourbonLibraryEntries (manual "Check GitHub for New
// Bourbons" sync, for a library that's already populated) ----------

test('syncNewBourbonLibraryEntries adds only entries not already present, leaving existing ones untouched', () => withTempDb(() => {
  db.upsertMashBill({
    title: 'Buffalo Trace',
    distillery: 'Local Edit',
    grains: [{ grain: 'Corn', pct: 100 }],
    confidence: { tier: 'unknown', note: 'Staff already edited this one.', verifiedAt: '' },
  });

  return withMockFetch(
    async (url) => {
      assert.equal(url, GITHUB_SEED_URL);
      return jsonResponse(SAMPLE_ENTRIES);
    },
    async () => {
      const result = await syncNewBourbonLibraryEntries(db);
      assert.equal(result.added, 1);
      assert.equal(result.skipped, 1);
      assert.equal(result.source, 'GitHub');

      const titles = db.listMashBills().map((m) => m.title).sort();
      assert.deepEqual(titles, ['Buffalo Trace', "Maker's Mark"]);

      // The existing "Buffalo Trace" entry must not have been overwritten.
      const buffaloTrace = db.listMashBills().find((m) => m.title === 'Buffalo Trace');
      assert.equal(buffaloTrace.distillery, 'Local Edit');
    },
  );
}));

test('syncNewBourbonLibraryEntries matches titles case-insensitively', () => withTempDb(() => {
  db.upsertMashBill({
    title: 'BUFFALO TRACE',
    distillery: 'Local Edit',
    grains: [{ grain: 'Corn', pct: 100 }],
  });

  return withMockFetch(
    async () => jsonResponse(SAMPLE_ENTRIES),
    async () => {
      const result = await syncNewBourbonLibraryEntries(db);
      assert.equal(result.added, 1);
      assert.equal(db.listMashBills().length, 2);
    },
  );
}));

test('syncNewBourbonLibraryEntries reports everything as skipped, adds nothing, when the library already has every entry', () => withTempDb(() => {
  SAMPLE_ENTRIES.forEach((e) => db.upsertMashBill(e));

  return withMockFetch(
    async () => jsonResponse(SAMPLE_ENTRIES),
    async () => {
      const result = await syncNewBourbonLibraryEntries(db);
      assert.equal(result.added, 0);
      assert.equal(result.skipped, 2);
      assert.equal(db.listMashBills().length, 2);
    },
  );
}));

test('syncNewBourbonLibraryEntries falls back to the bundled file when GitHub is unreachable, same as auto-seed', () => withTempDb(() => withMockFetch(
  async () => { throw new Error('simulated network failure'); },
  async () => {
    const result = await syncNewBourbonLibraryEntries(db);
    assert.equal(result.source, 'the bundled copy');
    assert.ok(result.added > 0);
  },
)));

test('maybeAutoSeedBourbonLibrary never throws, and still seeds via the bundled fallback when GitHub is unreachable', () => withTempDb(() => withMockFetch(
  async () => { throw new Error('network is down'); },
  async () => {
    assert.doesNotThrow(() => maybeAutoSeedBourbonLibrary(db));
    // Let the fire-and-forget promise chain settle before the temp dir gets
    // torn down out from under it.
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(db.listMashBills().length > 0);
  },
)));
