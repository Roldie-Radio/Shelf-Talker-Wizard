// Auto-seeds the Beer Bible the first time a PC's beer library is empty -
// same idea as bourbonLibrarySeed.js, for Beer instead of Bourbon. Narrow on
// purpose: only fires when the beers table has zero rows, so it never
// overwrites anything a store has already entered, edited, or intentionally
// cleared out.
//
// Two sources, in order:
//   1. GitHub (scripts/beer-bible-seed-data.json on the Main branch) - picks
//      up whatever the latest curated list is, even between app releases,
//      without needing a new installer.
//   2. The same JSON file bundled straight into the installer (see
//      package.json's build.files) - the guaranteed-to-work fallback when
//      #1 fails for any reason (no internet, GitHub/raw.githubusercontent.com
//      blocked by a store's firewall or content filter, timeout, ...).
// A failure of #1 falling through to #2 is expected and silent (a warning
// only), same as the Bourbon Library's own auto-seed. This never blocks or
// slows down app startup either way (see start() in index.js, which fires
// this off without awaiting it).
//
// Unlike the Bourbon Library, beer-bible-seed-data.json starts as an empty
// array - there's no curated starting list for beer yet. Wiring this up now
// (rather than only once one exists) means a curated list can be dropped in
// later with no code changes; against an empty file, auto-seed/GitHub sync
// are both harmless no-ops.
const path = require('path');
const GITHUB_SEED_URL = 'https://raw.githubusercontent.com/Roldie-Radio/Shelf-Talker-Wizard/Main/scripts/beer-bible-seed-data.json';
const BUNDLED_SEED_PATH = path.join(__dirname, '..', 'scripts', 'beer-bible-seed-data.json');
const FETCH_TIMEOUT_MS = 10000;
const USER_AGENT = 'ShelfTalkerWizard/1.0 (+beer bible auto-seed)';

async function fetchGitHubSeedEntries() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(GITHUB_SEED_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!resp.ok) {
      throw new Error(`GitHub responded with ${resp.status} fetching the Beer Bible seed data.`);
    }
    const entries = await resp.json();
    if (!Array.isArray(entries)) {
      throw new Error('Beer Bible seed data was not a JSON array.');
    }
    return entries;
  } finally {
    clearTimeout(timer);
  }
}

// Synchronous (plain require of a bundled JSON file) but kept in an async
// function so both sources have the same call shape in autoSeedBeerBible
// below - and so a bad/missing bundled file rejects instead of throwing
// synchronously out of that function.
async function loadBundledSeedEntries() {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const entries = require(BUNDLED_SEED_PATH);
  if (!Array.isArray(entries)) {
    throw new Error('Bundled Beer Bible seed data was not a JSON array.');
  }
  return entries;
}

async function loadSeedEntries() {
  try {
    return { entries: await fetchGitHubSeedEntries(), source: 'GitHub' };
  } catch (err) {
    console.warn(`Beer Bible auto-seed: GitHub fetch failed (${err.message}) - falling back to the bundled copy.`);
    return { entries: await loadBundledSeedEntries(), source: 'the bundled copy' };
  }
}

// Split out from maybeAutoSeedBeerBible so tests can call it directly
// against a fake `db` without going through the timing/logging wrapper.
async function autoSeedBeerBible(db) {
  if (db.listBeers().length > 0) return { seeded: 0, skipped: 'already has entries' };

  const { entries, source } = await loadSeedEntries();
  let seeded = 0;
  for (const entry of entries) {
    try {
      db.upsertBeer(entry);
      seeded += 1;
    } catch (err) {
      // One malformed entry shouldn't sink the rest of the batch.
      console.warn(`Beer Bible auto-seed: skipped "${entry && entry.title}" - ${err.message}`);
    }
  }
  return { seeded, source };
}

function normalizeKey(value) {
  return (value || '').toString().trim().toLowerCase();
}

// Same "only the fields that actually have something in them" filter as
// beerAutoSaveFields in app.js - a curated entry's blank fields (very common
// for a stub that's only ever had a title/SKU to go on, see
// scripts/beer-bible-seed-data.json) must never be sent through to
// updateBeerById below, or its "undefined leaves it alone" rule wouldn't
// help: an explicit '' is still a provided value as far as
// beerOptionalFieldParams (server/db.js) is concerned, and would blank out
// whatever the existing entry already had researched.
function nonEmptyFields(entry) {
  const fields = {};
  ['brewery', 'location', 'style', 'abv', 'ibu', 'untappdRating', 'untappdRatingCount', 'description'].forEach((key) => {
    if (entry && entry[key]) fields[key] = entry[key];
  });
  return fields;
}

// Manual counterpart to autoSeedBeerBible above, for a library that's
// already populated - the Beer Bible page's "Check GitHub for New Beers"
// button (server/index.js's POST /api/beers/sync-library) calls this.
// Auto-seed only ever fires once, on a completely empty library, so a store
// that seeded a while ago never sees entries added to the curated list
// since - this is how they catch up without a new installer.
//
// Deliberately additive-or-merge, never overwrite: an entry whose title
// already exists locally (case-insensitive, same matching upsertBeer's own
// unique index uses) is left alone rather than touched at all - it's
// already represented, whatever shape it's in.
//
// A same-SKU entry under a *different* title is the real-world case this
// exists for: a raw POS export title like "CENTRAL WATERS BOURBON BARREL
// TIRAMISU STOUT 4PK CAN" (this file's own curated source, keyed off the
// store's SKU) and the Untappd-enriched title a Shelf Talker/SKU Lookup
// already saved under this PC's own auto-save (see autoSaveBeerToBible in
// app.js) - "Central Waters Bourbon Barrel Tiramisu Stout Can" - are the
// same product, but an exact-title check alone can't tell that, and used to
// add a second row for it. Matching SKUs as well means that gets merged
// into the existing row instead (filling in only whatever field it doesn't
// already have - never renaming its title or overwriting a field it's
// already got) rather than creating a duplicate.
async function syncNewBeerBibleEntries(db) {
  const existingBeers = db.listBeers();
  const existingTitles = new Set(existingBeers.map((b) => normalizeKey(b.title)));
  const existingBySku = new Map();
  for (const beer of existingBeers) {
    const skuKey = normalizeKey(beer.sku);
    if (skuKey) existingBySku.set(skuKey, beer);
  }

  const { entries, source } = await loadSeedEntries();
  let added = 0;
  let merged = 0;
  let skipped = 0;
  for (const entry of entries) {
    const title = normalizeKey(entry && entry.title);
    if (!title || existingTitles.has(title)) {
      skipped += 1;
      continue;
    }

    const skuMatch = existingBySku.get(normalizeKey(entry && entry.sku));
    try {
      if (skuMatch) {
        db.updateBeerById(skuMatch.id, nonEmptyFields(entry));
        merged += 1;
      } else {
        const saved = db.upsertBeer(entry);
        existingTitles.add(title);
        const skuKey = normalizeKey(saved.sku);
        if (skuKey) existingBySku.set(skuKey, saved);
        added += 1;
      }
    } catch (err) {
      // One malformed entry shouldn't sink the rest of the batch - same
      // spirit as autoSeedBeerBible above.
      console.warn(`Beer Bible GitHub sync: skipped "${entry && entry.title}" - ${err.message}`);
      skipped += 1;
    }
  }
  return {
    added, merged, skipped, source,
  };
}

// Fire-and-forget entry point for start() in index.js: never throws, never
// keeps the app waiting before its UI is usable. Only the GitHub fetch
// (loadSeedEntries' first attempt) can really fail slowly here - the
// bundled-file fallback is a synchronous disk read wrapped in a promise, so
// this settles fast even on a PC with no network at all.
function maybeAutoSeedBeerBible(db) {
  autoSeedBeerBible(db)
    .then(({ seeded, skipped, source }) => {
      if (skipped) return;
      if (seeded > 0) console.log(`Beer Bible: auto-seeded ${seeded} entries from ${source}.`);
    })
    .catch((err) => {
      // Only reachable if the bundled-file fallback itself failed too
      // (missing from this build, corrupt JSON, etc.) - stays empty and
      // tries again on the next launch, nothing more to do here.
      console.warn(`Beer Bible auto-seed failed: ${err.message}`);
    });
}

module.exports = {
  autoSeedBeerBible, maybeAutoSeedBeerBible, syncNewBeerBibleEntries, GITHUB_SEED_URL, BUNDLED_SEED_PATH,
};
