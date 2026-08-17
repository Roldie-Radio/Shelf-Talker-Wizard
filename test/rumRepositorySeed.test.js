const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../server/db');
const {
  autoSeedRumRepository, maybeAutoSeedRumRepository, syncNewRumRepositoryEntries, GITHUB_SEED_URL, BUNDLED_SEED_PATH,
} = require('../server/rumRepositorySeed');

// Same throwaway-directory pattern as test/beerBibleSeed.test.js.
async function withTempDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-talker-rum-seed-test-'));
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
  { title: 'Mount Gay XO', distillery: 'Mount Gay', style: 'Aged Rum' },
  { title: 'Appleton Estate 12', distillery: 'Appleton Estate', style: 'Aged Rum' },
];

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

test('autoSeedRumRepository seeds from GitHub when the fetch succeeds', () => withTempDb(() => withMockFetch(
  async (url) => {
    assert.equal(url, GITHUB_SEED_URL);
    return jsonResponse(SAMPLE_ENTRIES);
  },
  async () => {
    const result = await autoSeedRumRepository(db);
    assert.equal(result.seeded, 2);
    assert.equal(result.source, 'GitHub');
    const titles = db.listRums().map((r) => r.title).sort();
    assert.deepEqual(titles, ['Appleton Estate 12', 'Mount Gay XO']);
  },
)));

test('autoSeedRumRepository skips entirely when the library already has entries', () => withTempDb(async () => {
  db.upsertRum({ title: 'Already Here' });

  return withMockFetch(
    async () => { throw new Error('fetch should not have been called'); },
    async () => {
      const result = await autoSeedRumRepository(db);
      assert.equal(result.seeded, 0);
      assert.ok(result.skipped);
      assert.deepEqual(db.listRums().map((r) => r.title), ['Already Here']);
    },
  );
}));

// The bundled fallback file (scripts/rum-repository-seed-data.json) starts
// as an empty array - there's no curated starting list for rum yet (see
// its own comment). This still exercises the real fallback path end to
// end: a network failure must not throw, and the library ends up matching
// whatever the bundled file actually has (currently nothing).
test('autoSeedRumRepository falls back to the bundled file when the GitHub fetch fails', () => withTempDb(() => withMockFetch(
  async () => { throw new Error('simulated network failure'); },
  async () => {
    const result = await autoSeedRumRepository(db);
    assert.equal(result.source, 'the bundled copy');

    const bundled = require(BUNDLED_SEED_PATH); // eslint-disable-line global-require
    assert.equal(result.seeded, bundled.length);
    assert.equal(db.listRums().length, bundled.length);
  },
)));

test('autoSeedRumRepository also falls back to the bundled file on a non-ok GitHub response', () => withTempDb(() => withMockFetch(
  async () => jsonResponse(null, { ok: false, status: 500 }),
  async () => {
    const result = await autoSeedRumRepository(db);
    assert.equal(result.source, 'the bundled copy');
    assert.equal(result.seeded, require(BUNDLED_SEED_PATH).length); // eslint-disable-line global-require
  },
)));

// ---------- syncNewRumRepositoryEntries (manual "Check GitHub for New
// Rums" sync, for a library that's already populated) ----------

test('syncNewRumRepositoryEntries adds only entries not already present, leaving existing ones untouched', () => withTempDb(() => {
  db.upsertRum({ title: 'Mount Gay XO', distillery: 'Local Edit' });

  return withMockFetch(
    async (url) => {
      assert.equal(url, GITHUB_SEED_URL);
      return jsonResponse(SAMPLE_ENTRIES);
    },
    async () => {
      const result = await syncNewRumRepositoryEntries(db);
      assert.equal(result.added, 1);
      assert.equal(result.skipped, 1);
      assert.equal(result.source, 'GitHub');

      const titles = db.listRums().map((r) => r.title).sort();
      assert.deepEqual(titles, ['Appleton Estate 12', 'Mount Gay XO']);

      // The existing entry must not have been overwritten.
      const mountGay = db.listRums().find((r) => r.title === 'Mount Gay XO');
      assert.equal(mountGay.distillery, 'Local Edit');
    },
  );
}));

test('syncNewRumRepositoryEntries matches titles case-insensitively', () => withTempDb(() => {
  db.upsertRum({ title: 'MOUNT GAY XO', distillery: 'Local Edit' });

  return withMockFetch(
    async () => jsonResponse(SAMPLE_ENTRIES),
    async () => {
      const result = await syncNewRumRepositoryEntries(db);
      assert.equal(result.added, 1);
      assert.equal(db.listRums().length, 2);
    },
  );
}));

test('syncNewRumRepositoryEntries reports everything as skipped, adds nothing, when the library already has every entry', () => withTempDb(() => {
  SAMPLE_ENTRIES.forEach((e) => db.upsertRum(e));

  return withMockFetch(
    async () => jsonResponse(SAMPLE_ENTRIES),
    async () => {
      const result = await syncNewRumRepositoryEntries(db);
      assert.equal(result.added, 0);
      assert.equal(result.skipped, 2);
      assert.equal(db.listRums().length, 2);
    },
  );
}));

test('syncNewRumRepositoryEntries falls back to the bundled file when GitHub is unreachable, same as auto-seed', () => withTempDb(() => withMockFetch(
  async () => { throw new Error('simulated network failure'); },
  async () => {
    const result = await syncNewRumRepositoryEntries(db);
    assert.equal(result.source, 'the bundled copy');
    assert.equal(result.added, require(BUNDLED_SEED_PATH).length); // eslint-disable-line global-require
  },
)));

test('maybeAutoSeedRumRepository never throws, even when GitHub is unreachable', () => withTempDb(() => withMockFetch(
  async () => { throw new Error('network is down'); },
  async () => {
    assert.doesNotThrow(() => maybeAutoSeedRumRepository(db));
    // Let the fire-and-forget promise chain settle before the temp dir gets
    // torn down out from under it.
    await new Promise((resolve) => setImmediate(resolve));
  },
)));
