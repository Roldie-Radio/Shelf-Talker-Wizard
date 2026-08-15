// Opt-in only - never run automatically. This is a real store's production
// tool, so auto-seeding sample bourbons into a real data.db on launch would
// be wrong; run this by hand (`npm run seed:mash-bills`) when you want
// something to look at in the Bourbon Library screen locally. Writes to
// whatever data.db this PC's app itself would use (same SHELF_TALKER_CONFIG_DIR
// override db.js/appData.js already respect), and upserts by title, so
// running it again just refreshes the same five entries in place rather
// than duplicating them.
//
// The five entries and their sourcing are copied as-is from the sample data
// in docs/mockups/bourbon-profile-page.html, picked there specifically so
// all four confidence tiers show up at least once: Four Roses (Confirmed -
// the distillery publishes its recipes directly), Buffalo Trace and
// Redemption (Reported - independent sources agree but the distillery
// hasn't confirmed it), Blanton's (Estimated - sources disagree on the rye
// share), and Michter's (Unknown - no mash bill has ever been disclosed,
// so it's seeded with zero grains on purpose).

const { upsertMashBill } = require('../server/db');

const BOURBONS = [
  {
    title: 'Buffalo Trace',
    distillery: 'Buffalo Trace Distillery',
    parentCompany: 'Sazerac Company',
    category: 'Straight Bourbon',
    grains: [{ grain: 'Corn', pct: 89.5 }, { grain: 'Rye', pct: 7 }, { grain: 'Malted Barley', pct: 3.5 }],
    nose: 'Vanilla, brown sugar, a light hit of oak spice.',
    palate: 'Caramel corn, mint, oak.',
    finish: 'Long, warm, a trace of smoke.',
    confidence: {
      tier: 'reported',
      note: 'Sazerac has never officially published exact percentages for either Buffalo Trace mash bill. These figures are what multiple independent industry sources consistently converge on, but they’re estimates, not a distillery statement.',
      verified: 'Aug 2026',
      sources: [
        { label: 'VinePair — The Complete Guide to Each of Buffalo Trace’s Elusive Mash Bills', url: 'https://vinepair.com/articles/buffalo-trace-mash-bill-guide/' },
        { label: 'Whisky Advocate — The Mashbills of Buffalo Trace', url: 'https://whiskyadvocate.com/The-Mashbills-of-Buffalo-Trace' },
        { label: 'bourbonr.com — Updated: Buffalo Trace Distillery Mash Bills', url: 'http://bourbonr.com/blog/updated-buffalo-trace-distillery-mash-bills/' },
      ],
    },
  },
  {
    title: 'Four Roses Single Barrel',
    distillery: 'Four Roses Distillery',
    parentCompany: 'Kirin Holdings (Four Roses Distillery LLC)',
    category: 'Single Barrel Bourbon',
    grains: [{ grain: 'Corn', pct: 60 }, { grain: 'Rye', pct: 35 }, { grain: 'Malted Barley', pct: 5 }],
    nose: 'Ripe berries, caramel, floral notes.',
    palate: 'Cinnamon, dried fruit, toasted oak.',
    finish: 'Spicy and warm, lingers.',
    confidence: {
      tier: 'confirmed',
      note: 'Four Roses publishes both base mash bills ("B" and "E") and all ten recipe codes directly on their own site — the rare case of a distillery stating exact percentages itself.',
      verified: 'Aug 2026',
      sources: [
        { label: 'Four Roses — Our Recipes (official)', url: 'https://www.fourrosesbourbon.com/our-recipes' },
        { label: 'VinePair — The Complete Guide to the 10 Four Roses Bourbon Recipes', url: 'https://vinepair.com/articles/four-roses-bourbon-recipe-guide/' },
      ],
    },
  },
  {
    title: "Blanton's Single Barrel",
    distillery: 'Buffalo Trace Distillery',
    parentCompany: 'Sazerac Company',
    category: 'Single Barrel Bourbon',
    grains: [{ grain: 'Corn', pct: 87.5 }, { grain: 'Rye', pct: 9 }, { grain: 'Malted Barley', pct: 3.5 }],
    nose: 'Citrus peel, honey, vanilla.',
    palate: 'Nutmeg, caramel, orange zest.',
    finish: 'Smooth, sweet, medium length.',
    confidence: {
      tier: 'estimated',
      note: 'Corn and malted barley are reasonably consistent across sources, but the rye share is genuinely disputed — estimates range from about 9% to as high as 15%. Shown here at the low end of that range; treat the rye figure as approximate, not exact.',
      verified: 'Aug 2026',
      sources: [
        { label: 'VinePair — The Complete Guide to Each of Buffalo Trace’s Elusive Mash Bills', url: 'https://vinepair.com/articles/buffalo-trace-mash-bill-guide/' },
        { label: 'Taste Select Repeat — The Ultimate Guide To Buffalo Trace Mash Bills', url: 'https://www.tasteselectrepeat.com/blogs/bts/buffalo-trace' },
      ],
    },
  },
  {
    title: "Michter's US*1 Bourbon",
    distillery: "Michter's Distillery (Shively / Fort Nelson)",
    parentCompany: 'Chatham Imports',
    category: 'Small Batch Bourbon',
    grains: [],
    nose: 'Toffee, vanilla, light oak.',
    palate: 'Caramel, baking spice.',
    finish: 'Soft, balanced.',
    confidence: {
      tier: 'unknown',
      note: 'Michter’s has never disclosed a mash bill for this expression. The only mention found is one blog’s unconfirmed speculation, which doesn’t meet the bar for even an "Estimated" entry — nothing is recorded here rather than printing a guess.',
      verified: 'Aug 2026',
      sources: [
        { label: 'Bourbon Culture — Michter’s Distillery: Past, Present and Future (no distillery confirmation)', url: 'https://thebourbonculture.com/whiskey-info/michters-distillery-past-present-and-future/' },
      ],
    },
  },
  {
    title: 'Redemption Bourbon',
    distillery: 'MGP Ingredients (Lawrenceburg, IN)',
    parentCompany: 'Deutsch Family Wine & Spirits',
    category: 'Straight Bourbon',
    grains: [{ grain: 'Corn', pct: 60 }, { grain: 'Rye', pct: 38.1 }, { grain: 'Malted Barley', pct: 1.8 }],
    nose: 'Rye spice, black pepper, caramel.',
    palate: 'Cinnamon, dark fruit, oak.',
    finish: 'Dry, peppery.',
    confidence: {
      tier: 'reported',
      note: 'MGP itself doesn’t publish per-brand percentages, but this specific breakdown is consistently cited across whiskey-industry references tracking MGP’s standard recipes.',
      verified: 'Aug 2026',
      sources: [
        { label: 'Kindred Cocktails — Redemption (ingredient reference)', url: 'https://kindredcocktails.com/ingredient/redemption' },
        { label: 'bourbonr.com — MGP/LDI by Mash Bill', url: 'http://bourbonr.com/blog/mgpldi-mash-bill/' },
      ],
    },
  },
];

function run() {
  console.log(`Seeding ${BOURBONS.length} sample Bourbon Library entries...`);
  for (const bourbon of BOURBONS) {
    const entry = upsertMashBill({ ...bourbon, source: 'Manual' });
    console.log(`  - ${entry.title} (${entry.confidence.tier})`);
  }
  console.log('Done. Safe to re-run any time - entries are upserted by title.');
}

run();
