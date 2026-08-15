const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../server/db');
const { autoSeedBourbonLibrary, maybeAutoSeedBourbonLibrary, GITHUB_SEED_URL } = require('../server/bourbonLibrarySeed');

// Same throwaway-directory pattern as test/db.test.js, but async - unlike
// that file's withTempDb, autoSeedBourbonLibrary always awaits a fetch, so
// there's no synchronous-only call site to preserve here.
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

test('autoSeedBourbonLibrary seeds from GitHub when the library is empty', () => withTempDb(() => withMockFetch(
  async (url) => {
    assert.equal(url, GITHUB_SEED_URL);
    return jsonResponse(SAMPLE_ENTRIES);
  },
  async () => {
    const result = await autoSeedBourbonLibrary(db);
    assert.equal(result.seeded, 2);
    const titles = db.listMashBills().map((m) => m.title).sort();
    assert.deepEqual(titles, ['Buffalo Trace', "Maker's Mark"]);
  },
)));

test('autoSeedBourbonLibrary skips the fetch entirely when the library already has entries', () => withTempDb(async () => {
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

test('autoSeedBourbonLibrary rejects a non-ok response instead of seeding garbage', () => withTempDb(() => withMockFetch(
  async () => jsonResponse(null, { ok: false, status: 500 }),
  async () => {
    await assert.rejects(() => autoSeedBourbonLibrary(db), /500/);
    assert.equal(db.listMashBills().length, 0);
  },
)));

test('maybeAutoSeedBourbonLibrary never throws, even when the fetch fails', () => withTempDb(() => withMockFetch(
  async () => { throw new Error('network is down'); },
  async () => {
    assert.doesNotThrow(() => maybeAutoSeedBourbonLibrary(db));
    // Let the fire-and-forget promise chain settle before the temp dir gets
    // torn down out from under it.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(db.listMashBills().length, 0);
  },
)));
