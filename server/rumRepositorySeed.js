// Auto-seeds the Rum Repository the first time a PC's rum library is empty -
// same idea as beerBibleSeed.js (and bourbonLibrarySeed.js before it), for
// Rum instead of Beer/Bourbon. Narrow on purpose: only fires when the rums
// table has zero rows, so it never overwrites anything a store has already
// entered, edited, or intentionally cleared out.
//
// Two sources, in order:
//   1. GitHub (scripts/rum-repository-seed-data.json on the Main branch) -
//      picks up whatever the latest curated list is, even between app
//      releases, without needing a new installer.
//   2. The same JSON file bundled straight into the installer (see
//      package.json's build.files) - the guaranteed-to-work fallback when
//      #1 fails for any reason (no internet, GitHub/raw.githubusercontent.com
//      blocked by a store's firewall or content filter, timeout, ...).
// A failure of #1 falling through to #2 is expected and silent (a warning
// only), same as the Beer Bible's own auto-seed. This never blocks or
// slows down app startup either way (see start() in index.js, which fires
// this off without awaiting it).
//
// rum-repository-seed-data.json now carries a curated title + country-of-
// origin list, built batch by batch from a real store's own Rum department
// export (see server/productDatabase.js's own "Add from Product Database"
// sync for the SKU-discovery half of that same workflow) - staff research
// the country, this ships it store-wide via GitHub the same way a Bourbon
// Library mash bill does. Each entry is deliberately a stub beyond title/
// country/sku (no distillery/style/ABV yet) - there's no per-row Untappd
// equivalent to fill those in automatically, so they're left for a future
// batch or a manual edit. This module itself was wired up before the list
// existed (auto-seed/GitHub sync are harmless no-ops against an empty
// file), so a growing list needs no code changes here.
const path = require('path');
const GITHUB_SEED_URL = 'https://raw.githubusercontent.com/Roldie-Radio/Shelf-Talker-Wizard/Main/scripts/rum-repository-seed-data.json';
const BUNDLED_SEED_PATH = path.join(__dirname, '..', 'scripts', 'rum-repository-seed-data.json');
const FETCH_TIMEOUT_MS = 10000;
const USER_AGENT = 'ShelfTalkerWizard/1.0 (+rum repository auto-seed)';

async function fetchGitHubSeedEntries() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(GITHUB_SEED_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!resp.ok) {
      throw new Error(`GitHub responded with ${resp.status} fetching the Rum Repository seed data.`);
    }
    const entries = await resp.json();
    if (!Array.isArray(entries)) {
      throw new Error('Rum Repository seed data was not a JSON array.');
    }
    return entries;
  } finally {
    clearTimeout(timer);
  }
}

// Synchronous (plain require of a bundled JSON file) but kept in an async
// function so both sources have the same call shape in autoSeedRumRepository
// below - and so a bad/missing bundled file rejects instead of throwing
// synchronously out of that function.
async function loadBundledSeedEntries() {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const entries = require(BUNDLED_SEED_PATH);
  if (!Array.isArray(entries)) {
    throw new Error('Bundled Rum Repository seed data was not a JSON array.');
  }
  return entries;
}

async function loadSeedEntries() {
  try {
    return { entries: await fetchGitHubSeedEntries(), source: 'GitHub' };
  } catch (err) {
    console.warn(`Rum Repository auto-seed: GitHub fetch failed (${err.message}) - falling back to the bundled copy.`);
    return { entries: await loadBundledSeedEntries(), source: 'the bundled copy' };
  }
}

// Split out from maybeAutoSeedRumRepository so tests can call it directly
// against a fake `db` without going through the timing/logging wrapper.
async function autoSeedRumRepository(db) {
  if (db.listRums().length > 0) return { seeded: 0, skipped: 'already has entries' };

  const { entries, source } = await loadSeedEntries();
  let seeded = 0;
  for (const entry of entries) {
    try {
      db.upsertRum(entry);
      seeded += 1;
    } catch (err) {
      // One malformed entry shouldn't sink the rest of the batch.
      console.warn(`Rum Repository auto-seed: skipped "${entry && entry.title}" - ${err.message}`);
    }
  }
  return { seeded, source };
}

// Manual counterpart to autoSeedRumRepository above, for a library that's
// already populated - the Rum Repository page's "Check GitHub for New
// Rums" button (server/index.js's POST /api/rums/sync-library) calls this.
// Auto-seed only ever fires once, on a completely empty library, so a store
// that seeded a while ago never sees entries added to the curated list
// since - this is how they catch up without a new installer.
//
// Deliberately additive only: an entry whose title already exists locally
// (case-insensitive, same matching upsertRum's own unique index uses) is
// left alone rather than overwritten, so this can never silently clobber a
// correction or a from-scratch entry staff typed in themselves. Re-running
// it is always safe - already-added titles are just skipped again next time.
async function syncNewRumRepositoryEntries(db) {
  const existingTitles = new Set(db.listRums().map((r) => r.title.trim().toLowerCase()));
  const { entries, source } = await loadSeedEntries();
  let added = 0;
  let skipped = 0;
  for (const entry of entries) {
    const title = (entry && entry.title || '').trim().toLowerCase();
    if (!title || existingTitles.has(title)) {
      skipped += 1;
      continue;
    }
    try {
      db.upsertRum(entry);
      existingTitles.add(title);
      added += 1;
    } catch (err) {
      // One malformed entry shouldn't sink the rest of the batch - same
      // spirit as autoSeedRumRepository above.
      console.warn(`Rum Repository GitHub sync: skipped "${entry && entry.title}" - ${err.message}`);
      skipped += 1;
    }
  }
  return { added, skipped, source };
}

// Fire-and-forget entry point for start() in index.js: never throws, never
// keeps the app waiting before its UI is usable. Only the GitHub fetch
// (loadSeedEntries' first attempt) can really fail slowly here - the
// bundled-file fallback is a synchronous disk read wrapped in a promise, so
// this settles fast even on a PC with no network at all.
function maybeAutoSeedRumRepository(db) {
  autoSeedRumRepository(db)
    .then(({ seeded, skipped, source }) => {
      if (skipped) return;
      if (seeded > 0) console.log(`Rum Repository: auto-seeded ${seeded} entries from ${source}.`);
    })
    .catch((err) => {
      // Only reachable if the bundled-file fallback itself failed too
      // (missing from this build, corrupt JSON, etc.) - stays empty and
      // tries again on the next launch, nothing more to do here.
      console.warn(`Rum Repository auto-seed failed: ${err.message}`);
    });
}

module.exports = {
  autoSeedRumRepository, maybeAutoSeedRumRepository, syncNewRumRepositoryEntries, GITHUB_SEED_URL, BUNDLED_SEED_PATH,
};
