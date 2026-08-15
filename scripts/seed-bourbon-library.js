// Optional, opt-in seed data for the Bourbon Library (`npm run
// db:seed-bourbon-library`) - never run automatically on app launch, so it
// never silently writes demo entries into a real store's data.db. Safe to
// run more than once: upsertMashBill matches by title, so re-running this
// just refreshes the same five entries rather than duplicating them.
//
// These five are a deliberately mixed set of real, publicly-known bourbons
// - Confirmed, Reported, and Estimated all appear (see confidence.tier
// below), because that mix is what the Mash Bill Confidence system exists
// to represent honestly. None of these percentages are invented for this
// app: Four Roses is the one distillery here that actually publishes exact
// mash bill numbers, so it's the only "confirmed" entry; the rest are the
// figures most consistently cited across whiskey trade writing for
// distilleries (Buffalo Trace, MGP) that don't publish theirs, with that
// caveat spelled out in each entry's confidence note rather than presented
// as fact. Treat this as a starting point for staff to correct and expand,
// not a finished reference.

const { upsertMashBill, closeDb } = require('../server/db');

const ENTRIES = [
  {
    title: 'Buffalo Trace',
    distillery: 'Buffalo Trace Distillery',
    parentCompany: 'Sazerac Company',
    category: 'Kentucky Straight Bourbon',
    grains: [
      { grain: 'Corn', pct: 90 },
      { grain: 'Rye', pct: 8 },
      { grain: 'Malted Barley', pct: 2 },
    ],
    nose: 'Vanilla, brown sugar, and mint with a subtle spiciness.',
    palate: 'Brown sugar and spice, balanced with oak, toffee, and dark fruit.',
    finish: 'Long, smooth, and pleasant.',
    tastingSource: 'Buffalo Trace Distillery official product notes',
    confidence: {
      tier: 'reported',
      note: 'Buffalo Trace Distillery confirms it uses two mash bills but does not publish exact percentages to consumers. This low-rye recipe (used for Buffalo Trace, Eagle Rare, and others in that family) is the figure most consistently cited across whiskey trade writing, not an official distillery number.',
      sources: [
        { label: 'Buffalo Trace Distillery - Our Process', url: 'https://www.buffalotracedistillery.com' },
      ],
      verifiedAt: '',
    },
  },
  {
    title: 'Four Roses Single Barrel',
    distillery: 'Four Roses Distillery',
    parentCompany: 'Kirin Holdings Company',
    category: 'Kentucky Straight Bourbon',
    grains: [
      { grain: 'Corn', pct: 60 },
      { grain: 'Rye', pct: 35 },
      { grain: 'Malted Barley', pct: 5 },
    ],
    nose: 'Ripe berries, plum, and spice.',
    palate: 'Full-bodied and mellow, with red berries, caramel, and a spicy rye kick.',
    finish: 'Long and warm.',
    tastingSource: 'Four Roses Distillery official product notes',
    confidence: {
      tier: 'confirmed',
      note: 'Four Roses is unusually transparent about its process, publicly documenting both of its mash bills (a 75/20/5 recipe and this 60/35/5 high-rye recipe) and which of its ten bourbon recipes go into each product. Single Barrel is built from recipe OBSV - this mash bill with the V yeast strain.',
      sources: [
        { label: 'Four Roses - Our Bourbon', url: 'https://fourrosesbourbon.com' },
      ],
      verifiedAt: '',
    },
  },
  {
    title: "Blanton's Single Barrel",
    distillery: 'Buffalo Trace Distillery',
    parentCompany: 'Sazerac Company',
    category: 'Kentucky Straight Bourbon',
    grains: [
      { grain: 'Corn', pct: 75 },
      { grain: 'Rye', pct: 15 },
      { grain: 'Malted Barley', pct: 10 },
    ],
    nose: 'Nutty, with hints of citrus, honey, and vanilla.',
    palate: 'Rich caramel and toffee balanced with dried fruit and a hint of spice.',
    finish: 'Long and dry, with a touch of leather.',
    tastingSource: 'Common tasting note consensus (whiskey trade press)',
    confidence: {
      tier: 'estimated',
      note: "Blanton's is drawn from Buffalo Trace's second, higher-rye mash bill, but Sazerac has never published its exact percentages the way it hasn't for Mash Bill #1 either. These figures are an approximation based on the range most often reported by whiskey writers - treat them as a starting estimate, not a distillery-confirmed recipe.",
      sources: [],
      verifiedAt: '',
    },
  },
  {
    title: "Michter's US*1 Bourbon",
    distillery: "Michter's Distillery",
    parentCompany: "Michter's Distillery, LLC (Chatham Imports)",
    category: 'Bourbon',
    grains: [
      { grain: 'Corn', pct: 72 },
      { grain: 'Rye', pct: 21 },
      { grain: 'Malted Barley', pct: 7 },
    ],
    nose: 'Caramel, vanilla, and light fruit.',
    palate: 'Butterscotch, brown sugar, and oak.',
    finish: 'Balanced, moderate length.',
    tastingSource: 'Common tasting note consensus (whiskey trade press)',
    confidence: {
      tier: 'estimated',
      note: "Michter's does not publicly disclose mash bill percentages for any of its whiskeys. These figures are a rough placeholder based on typical medium-rye Kentucky bourbon proportions, not a distillery-confirmed recipe - replace this entry as soon as better information turns up.",
      sources: [],
      verifiedAt: '',
    },
  },
  {
    title: 'Redemption Bourbon',
    distillery: 'MGP of Indiana',
    parentCompany: 'Deutsch Family Wine & Spirits',
    category: 'Straight Bourbon',
    grains: [
      { grain: 'Corn', pct: 75 },
      { grain: 'Rye', pct: 21 },
      { grain: 'Malted Barley', pct: 4 },
    ],
    nose: 'Rye spice, vanilla, and caramel.',
    palate: 'Black pepper, cinnamon, and brown sugar.',
    finish: 'Spicy and warm.',
    tastingSource: 'Common tasting note consensus (whiskey trade press)',
    confidence: {
      tier: 'reported',
      note: "Redemption is a sourced whiskey distilled at MGP of Indiana, which doesn't publish mash bills directly to consumers. This 75/21/4 'high-rye bourbon' recipe is one of the most extensively and consistently documented mash bills in whiskey writing, since it's the base for many sourced brands beyond just Redemption.",
      sources: [
        { label: 'MGP Ingredients - Distillery Products', url: 'https://www.mgpingredients.com' },
      ],
      verifiedAt: '',
    },
  },
];

function run() {
  ENTRIES.forEach((entry) => {
    const saved = upsertMashBill(entry);
    console.log(`Saved "${saved.title}" (confidence: ${saved.confidence.tier})`);
  });
  closeDb();
  console.log(`\nDone - seeded ${ENTRIES.length} Bourbon Library entries.`);
}

run();
