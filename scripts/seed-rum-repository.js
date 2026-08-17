// Optional, opt-in seed data for the Rum Repository (`npm run
// db:seed-rum-repository`) - mirrors scripts/seed-beer-bible.js. Never run
// automatically on app launch, so it never silently writes demo entries
// into a real store's data.db. Safe to run more than once: upsertRum
// matches by title, so re-running this just refreshes the same entries
// rather than duplicating them.
//
// The actual entries live in rum-repository-seed-data.json, not here - that
// same file also ships bundled inside the installer (see package.json's
// build.files) and is what server/rumRepositorySeed.js reads to auto-seed a
// store PC's Rum Repository on launch, whether that PC has internet access
// or not. Keeping one JSON file as the source for every path means a PC
// seeded locally via this script and one seeded automatically on launch
// always end up with identical data.
//
// rum-repository-seed-data.json starts as an empty array - there's no
// curated starting list for rum yet. Running this script against an empty
// file is a harmless no-op; once a real curated list exists, drop it into
// that file and this script (and the app's own auto-seed/GitHub sync)
// picks it up with no other changes needed.

const { upsertRum, closeDb } = require('../server/db');
const ENTRIES = require('./rum-repository-seed-data.json');

function run() {
  ENTRIES.forEach((entry) => {
    const saved = upsertRum(entry);
    console.log(`Saved "${saved.title}"`);
  });
  closeDb();
  console.log(`\nDone - seeded ${ENTRIES.length} Rum Repository entries.`);
}

run();
