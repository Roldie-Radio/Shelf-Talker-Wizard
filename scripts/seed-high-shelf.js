// Optional, opt-in seed data for The High Shelf (`npm run
// db:seed-high-shelf`) - mirrors scripts/seed-rum-repository.js. Never run
// automatically on app launch, so it never silently writes demo entries
// into a real store's data.db. Safe to run more than once: upsertHighShelfEntry
// matches by SKU first, title second, so re-running this just refreshes the
// same entries rather than duplicating them.
//
// The actual entries live in high-shelf-seed-data.json, not here - that
// same file also ships bundled inside the installer (see package.json's
// build.files) and is what server/highShelfSeed.js reads to auto-seed a
// store PC's High Shelf on launch, whether that PC has internet access or
// not. Keeping one JSON file as the source for every path means a PC
// seeded locally via this script and one seeded automatically on launch
// always end up with identical data.
//
// high-shelf-seed-data.json is this store's own THC/CBD department, built
// from a real WinePOS export (server/highShelfImport.js's own Import from
// Export File... is what generated the THC mg/Servings on most rows - see
// each entry's own `source`, "Export File" for a title-derived row vs.
// "Manual" for one a person has since corrected/researched by hand, e.g.
// filling in a real CBD content or Lab Tested status the title alone never
// carries).

const { upsertHighShelfEntry, closeDb } = require('../server/db');
const ENTRIES = require('./high-shelf-seed-data.json');

function run() {
  ENTRIES.forEach((entry) => {
    const saved = upsertHighShelfEntry(entry);
    console.log(`Saved "${saved.title}"`);
  });
  closeDb();
  console.log(`\nDone - seeded ${ENTRIES.length} High Shelf entries.`);
}

run();
