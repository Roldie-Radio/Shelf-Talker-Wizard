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

// This is the exact real-world case that motivated matching by SKU as well
// as title: a curated GitHub entry that's the same product as an existing
// local row, just saved under a different title (e.g. the raw POS export
// title here vs. the Untappd-enriched title a Shelf Talker/SKU Lookup
// already saved it under via autoSaveBeerToBible in app.js). Exact-title
// matching alone can't tell those apart and used to add a second row.
test('syncNewBeerBibleEntries merges a same-SKU entry under a different title into the existing row, instead of adding a duplicate', () => withTempDb(() => {
  db.upsertBeer({
    title: 'Central Waters Bourbon Barrel Tiramisu Stout Can', brewery: 'Central Waters Brewing Company', style: 'Stout - Imperial / Double Coffee', abv: '11.1%', sku: '41299',
  });

  return withMockFetch(
    async () => jsonResponse([
      { title: 'CENTRAL WATERS BOURBON BARREL TIRAMISU STOUT 4PK CAN', sku: '41299' },
      ...SAMPLE_ENTRIES,
    ]),
    async () => {
      const result = await syncNewBeerBibleEntries(db);
      assert.equal(result.added, 2); // the two SAMPLE_ENTRIES
      assert.equal(result.merged, 1);
      assert.equal(result.skipped, 0);

      // No second row for the same SKU, and the existing row's own title and
      // already-researched fields are untouched.
      const matches = db.listBeers().filter((b) => b.sku === '41299');
      assert.equal(matches.length, 1);
      assert.equal(matches[0].title, 'Central Waters Bourbon Barrel Tiramisu Stout Can');
      assert.equal(matches[0].brewery, 'Central Waters Brewing Company');
    },
  );
}));

// The reverse direction: the existing local row is the bare stub (just a
// title/SKU, e.g. from Import Beer Bible from Export File...) and the
// curated GitHub entry is the one with real data - merging should fill the
// existing row in rather than leaving it blank forever or adding a second,
// enriched row next to it.
test('syncNewBeerBibleEntries fills in a same-SKU stub entry from the curated data, rather than adding a duplicate', () => withTempDb(() => {
  db.upsertBeer({ title: 'CENTRAL WATERS BOURBON BARREL TIRAMISU STOUT 4PK CAN', sku: '41299' });

  return withMockFetch(
    async () => jsonResponse([
      {
        title: 'Central Waters Bourbon Barrel Tiramisu Stout Can', brewery: 'Central Waters Brewing Company', abv: '11.1%', sku: '41299',
      },
    ]),
    async () => {
      const result = await syncNewBeerBibleEntries(db);
      assert.equal(result.added, 0);
      assert.equal(result.merged, 1);

      const matches = db.listBeers().filter((b) => b.sku === '41299');
      assert.equal(matches.length, 1);
      // Title is left as-is (never renamed by a merge) but the blank fields
      // are now filled in.
      assert.equal(matches[0].title, 'CENTRAL WATERS BOURBON BARREL TIRAMISU STOUT 4PK CAN');
      assert.equal(matches[0].brewery, 'Central Waters Brewing Company');
      assert.equal(matches[0].abv, '11.1%');
    },
  );
}));

test('syncNewBeerBibleEntries falls back to the bundled file when GitHub is unreachable, same as auto-seed', () => withTempDb(() => withMockFetch(
  async () => { throw new Error('simulated network failure'); },
  async () => {
    const result = await syncNewBeerBibleEntries(db);
    assert.equal(result.source, 'the bundled copy');
    assert.ok(result.added > 0);
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
