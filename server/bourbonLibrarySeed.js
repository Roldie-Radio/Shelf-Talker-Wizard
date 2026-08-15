// Auto-seeds the Bourbon Library from this repo's own GitHub-hosted seed
// data (scripts/bourbon-library-seed-data.json on the Main branch) the
// first time a PC's Bourbon Library is empty - so staff never have to run
// `npm run db:seed-bourbon-library` by hand on a store PC (see that
// script's own header for the manual/offline path this complements).
//
// Deliberately narrow: only fires when mash_bills has zero rows, so it
// never overwrites anything a store has already entered, edited, or
// intentionally cleared out. A PC with no internet access (or GitHub
// unreachable) just stays empty until network shows up on some later
// launch - this never blocks or slows down app startup, and a failure here
// is always non-fatal (see start() in index.js, which fires this off
// without awaiting it).
const GITHUB_SEED_URL = 'https://raw.githubusercontent.com/Roldie-Radio/Shelf-Talker-Wizard/Main/scripts/bourbon-library-seed-data.json';
const FETCH_TIMEOUT_MS = 10000;
const USER_AGENT = 'ShelfTalkerWizard/1.0 (+bourbon library auto-seed)';

async function fetchSeedEntries() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(GITHUB_SEED_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!resp.ok) {
      throw new Error(`GitHub responded with ${resp.status} fetching the Bourbon Library seed data.`);
    }
    const entries = await resp.json();
    if (!Array.isArray(entries)) {
      throw new Error('Bourbon Library seed data was not a JSON array.');
    }
    return entries;
  } finally {
    clearTimeout(timer);
  }
}

// Split out from maybeAutoSeedBourbonLibrary so tests can call it directly
// against a fake `db` without going through the timing/logging wrapper.
async function autoSeedBourbonLibrary(db) {
  if (db.listMashBills().length > 0) return { seeded: 0, skipped: 'already has entries' };

  const entries = await fetchSeedEntries();
  let seeded = 0;
  for (const entry of entries) {
    try {
      db.upsertMashBill(entry);
      seeded += 1;
    } catch (err) {
      // One malformed entry shouldn't sink the rest of the batch.
      console.warn(`Bourbon Library auto-seed: skipped "${entry && entry.title}" - ${err.message}`);
    }
  }
  return { seeded };
}

// Fire-and-forget entry point for start() in index.js: never throws, never
// keeps the app waiting on the network before its UI is usable.
function maybeAutoSeedBourbonLibrary(db) {
  autoSeedBourbonLibrary(db)
    .then(({ seeded, skipped }) => {
      if (skipped) return;
      if (seeded > 0) console.log(`Bourbon Library: auto-seeded ${seeded} entries from GitHub.`);
    })
    .catch((err) => {
      // No internet, GitHub unreachable, timeout, bad JSON, etc. - stays
      // empty and tries again on the next launch, nothing more to do here.
      console.warn(`Bourbon Library auto-seed skipped: ${err.message}`);
    });
}

module.exports = { autoSeedBourbonLibrary, maybeAutoSeedBourbonLibrary, GITHUB_SEED_URL };
