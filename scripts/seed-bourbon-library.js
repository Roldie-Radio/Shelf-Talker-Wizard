// Optional, opt-in seed data for the Bourbon Library (`npm run
// db:seed-bourbon-library`) - never run automatically on app launch, so it
// never silently writes demo entries into a real store's data.db. Safe to
// run more than once: upsertMashBill matches by title, so re-running this
// just refreshes the same entries rather than duplicating them.
//
// The actual entries live in bourbon-library-seed-data.json, not here -
// that file is also what server/bourbonLibrarySeed.js fetches straight from
// GitHub to auto-seed a store PC's Bourbon Library on launch (see that
// module's own header comment). Keeping one JSON file as the source for both
// paths means a PC seeded locally via this script and one seeded
// automatically over the network always end up with identical data.
//
// These 26 are a deliberately mixed set of real, publicly-known bourbons -
// Confirmed, Reported, and Estimated all appear (see confidence.tier
// below), because that mix is what the Mash Bill Confidence system exists
// to represent honestly. None of these percentages are invented for this
// app: Four Roses, Maker's Mark, Woodford Reserve, and Old Forester are the
// distilleries here that actually publish their mash bill numbers, so
// those are the "confirmed" entries; the rest are the figures most
// consistently cited across whiskey trade writing (and, for a few, on-record
// master-distiller interviews) for distilleries that don't publish theirs
// to consumers, with that caveat spelled out in each entry's confidence
// note rather than presented as fact. Treat this as a starting point for
// staff to correct and expand, not a finished reference.

const { upsertMashBill, closeDb } = require('../server/db');
const ENTRIES = require('./bourbon-library-seed-data.json');

function run() {
  ENTRIES.forEach((entry) => {
    const saved = upsertMashBill(entry);
    console.log(`Saved "${saved.title}" (confidence: ${saved.confidence.tier})`);
  });
  closeDb();
  console.log(`\nDone - seeded ${ENTRIES.length} Bourbon Library entries.`);
}

run();
