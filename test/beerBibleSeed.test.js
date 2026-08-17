const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../server/db');
const {
  autoSeedBeerBible, maybeAutoSeedBeerBible, GITHUB_SEED_URL, BUNDLED_SEED_PATH,
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

// This is the exact real-world failure this fallback exists for: a store
// PC where GitHub (or raw.githubusercontent.com specifically) is
// unreachable - same reasoning as bourbonLibrarySeed.test.js's own
// equivalent test. The library must still end up populated from the copy
// bundled into the install - a real product export's worth of title/SKU
// stubs (see scripts/populate-beer-bible-from-export.js's own history for
// how this file was populated), not the empty placeholder it originally
// shipped with.
test('autoSeedBeerBible falls back to the bundled file when the GitHub fetch fails', () => withTempDb(() => withMockFetch(
  async () => { throw new Error('simulated network failure'); },
  async () => {
    const result = await autoSeedBeerBible(db);
    assert.equal(result.source, 'the bundled copy');

    const bundled = require(BUNDLED_SEED_PATH); // eslint-disable-line global-require
    assert.ok(bundled.length > 0);
    assert.equal(result.seeded, bundled.length);
    assert.equal(db.listBeers().length, bundled.length);
  },
)));

test('autoSeedBeerBible also falls back to the bundled file on a non-ok GitHub response', () => withTempDb(() => withMockFetch(
  async () => jsonResponse(null, { ok: false, status: 500 }),
  async () => {
    const result = await autoSeedBeerBible(db);
    assert.equal(result.source, 'the bundled copy');
    assert.ok(result.seeded > 0);
  },
)));

test('maybeAutoSeedBeerBible never throws, and still seeds via the bundled fallback when GitHub is unreachable', () => withTempDb(() => withMockFetch(
  async () => { throw new Error('network is down'); },
  async () => {
    assert.doesNotThrow(() => maybeAutoSeedBeerBible(db));
    // Let the fire-and-forget promise chain settle before the temp dir gets
    // torn down out from under it.
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(db.listBeers().length > 0);
  },
)));
