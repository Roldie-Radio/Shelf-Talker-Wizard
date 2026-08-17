const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../server/db');
const {
  autoSeedBeerBible, maybeAutoSeedBeerBible, syncNewBeerBibleEntries, GITHUB_SEED_URL, BUNDLED_SEED_PATH,
} = require('../server/beerBibleSeed');

// Same throwaway-directory pattern as test/bourbonLibrarySeed.test.js.
async function withTempDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-talker-beer-seed-test-'));
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
  { title: 'Slack Tide Flounder Pounder', brewery: 'Slack Tide Brewing Company', style: 'American IPA' },
  { title: 'Michelob ULTRA', brewery: 'Anheuser-Busch', style: 'Light Lager' },
];

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

test('autoSeedBeerBible seeds from GitHub when the fetch succeeds', () => withTempDb(() => withMockFetch(
  async (url) => {
    assert.equal(url, GITHUB_SEED_URL);
    return jsonResponse(SAMPLE_ENTRIES);
  },
  async () => {
    const result = await autoSeedBeerBible(db);
    assert.equal(result.seeded, 2);
    assert.equal(result.source, 'GitHub');
    const titles = db.listBeers().map((b) => b.title).sort();
    assert.deepEqual(titles, ['Michelob ULTRA', 'Slack Tide Flounder Pounder']);
  },
)));

test('autoSeedBeerBible skips entirely when the library already has entries', () => withTempDb(async () => {
  db.upsertBeer({ title: 'Already Here' });

  return withMockFetch(
    async () => { throw new Error('fetch should not have been called'); },
    async () => {
      const result = await autoSeedBeerBible(db);
      assert.equal(result.seeded, 0);
      assert.ok(result.skipped);
      assert.deepEqual(db.listBeers().map((b) => b.title), ['Already Here']);
    },
  );
}));

// beer-bible-seed-data.json ships as an empty array (see its own header
// comment) - unlike the Bourbon Library's bundled fallback, this settles on
// zero entries rather than a real curated set, but it still has to resolve
// cleanly (not throw, not error) against a real, unmocked read of that
// bundled file - that's what this exercises.
test('autoSeedBeerBible falls back to the bundled file when the GitHub fetch fails, which is empty for now', () => withTempDb(() => withMockFetch(
  async () => { throw new Error('simulated network failure'); },
  async () => {
    const result = await autoSeedBeerBible(db);
    assert.equal(result.source, 'the bundled copy');

    const bundled = require(BUNDLED_SEED_PATH); // eslint-disable-line global-require
    assert.deepEqual(bundled, []);
    assert.equal(result.seeded, 0);
    assert.deepEqual(db.listBeers(), []);
  },
)));

test('autoSeedBeerBible also falls back to the bundled file on a non-ok GitHub response', () => withTempDb(() => withMockFetch(
  async () => jsonResponse(null, { ok: false, status: 500 }),
  async () => {
    const result = await autoSeedBeerBible(db);
    assert.equal(result.source, 'the bundled copy');
    assert.equal(result.seeded, 0);
  },
)));

// ---------- syncNewBeerBibleEntries (manual "Check GitHub for New Beers"
// sync, for a library that's already populated) ----------

test('syncNewBeerBibleEntries adds only entries not already present, leaving existing ones untouched', () => withTempDb(() => {
  db.upsertBeer({ title: 'Slack Tide Flounder Pounder', brewery: 'Local Edit' });

  return withMockFetch(
    async (url) => {
      assert.equal(url, GITHUB_SEED_URL);
      return jsonResponse(SAMPLE_ENTRIES);
    },
    async () => {
      const result = await syncNewBeerBibleEntries(db);
      assert.equal(result.added, 1);
      assert.equal(result.skipped, 1);
      assert.equal(result.source, 'GitHub');

      const titles = db.listBeers().map((b) => b.title).sort();
      assert.deepEqual(titles, ['Michelob ULTRA', 'Slack Tide Flounder Pounder']);

      // The existing entry must not have been overwritten.
      const flounderPounder = db.listBeers().find((b) => b.title === 'Slack Tide Flounder Pounder');
      assert.equal(flounderPounder.brewery, 'Local Edit');
    },
  );
}));

test('syncNewBeerBibleEntries matches titles case-insensitively', () => withTempDb(() => {
  db.upsertBeer({ title: 'MICHELOB ULTRA', brewery: 'Local Edit' });

  return withMockFetch(
    async () => jsonResponse(SAMPLE_ENTRIES),
    async () => {
      const result = await syncNewBeerBibleEntries(db);
      assert.equal(result.added, 1);
      assert.equal(db.listBeers().length, 2);
    },
  );
}));

test('syncNewBeerBibleEntries reports everything as skipped, adds nothing, when the library already has every entry', () => withTempDb(() => {
  SAMPLE_ENTRIES.forEach((e) => db.upsertBeer(e));

  return withMockFetch(
    async () => jsonResponse(SAMPLE_ENTRIES),
    async () => {
      const result = await syncNewBeerBibleEntries(db);
      assert.equal(result.added, 0);
      assert.equal(result.skipped, 2);
      assert.equal(db.listBeers().length, 2);
    },
  );
}));

test('syncNewBeerBibleEntries falls back to the bundled file when GitHub is unreachable, same as auto-seed', () => withTempDb(() => withMockFetch(
  async () => { throw new Error('simulated network failure'); },
  async () => {
    const result = await syncNewBeerBibleEntries(db);
    assert.equal(result.source, 'the bundled copy');
    assert.equal(result.added, 0);
  },
)));

test('maybeAutoSeedBeerBible never throws even when GitHub is unreachable', () => withTempDb(() => withMockFetch(
  async () => { throw new Error('network is down'); },
  async () => {
    assert.doesNotThrow(() => maybeAutoSeedBeerBible(db));
    // Let the fire-and-forget promise chain settle before the temp dir gets
    // torn down out from under it.
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(db.listBeers(), []);
  },
)));
