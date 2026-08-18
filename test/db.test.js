const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../server/db');

// Same per-test throwaway directory pattern as test/upcCatalog.test.js -
// db.js's getDb() re-derives its connection whenever SHELF_TALKER_CONFIG_DIR
// changes, so each test gets its own isolated SQLite file. closeDb() in the
// finally block matters more here than it does for upcCatalog's plain JSON
// file: better-sqlite3 holds a real open file handle (plus WAL/SHM files)
// that needs releasing before the temp directory is deleted out from under it.
// NOTE: every caller below passes a synchronous fn - that matters. Making
// this `async`/`await fn(dir)` to future-proof it (as test/index.test.js's
// withTempDb needed, see the comment there) would turn a synchronous
// assertion failure inside fn into a rejected promise that none of these
// call sites `await`, which is worse (an unhandled rejection instead of a
// clean test failure) rather than better. If an async caller is ever
// needed here, fix every call site to `await withTempDb(...)` in the same
// change, not just this function.
function withTempDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-talker-db-test-'));
  const prev = process.env.SHELF_TALKER_CONFIG_DIR;
  process.env.SHELF_TALKER_CONFIG_DIR = dir;
  try {
    return fn(dir);
  } finally {
    db.closeDb();
    if (prev === undefined) delete process.env.SHELF_TALKER_CONFIG_DIR;
    else process.env.SHELF_TALKER_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function sampleTalker(overrides = {}) {
  return {
    id: 'client-1',
    title: 'Josh Cellars Cabernet Sauvignon',
    category: 'wine',
    signType: 'talker',
    talkerSize: 'full',
    sku: '09144',
    size: '750ml',
    price: '13.99',
    salePrice: '9.99',
    theme: 'amber',
    ...overrides,
  };
}

// ---------- dbFilePath ----------

test('dbFilePath respects SHELF_TALKER_CONFIG_DIR', () => {
  withTempDb((dir) => {
    assert.equal(db.dbFilePath(), path.join(dir, 'data.db'));
  });
});

// ---------- recordPrintedTalkers / searchHistory ----------

test('recordPrintedTalkers writes one row per talker and creates the db file', () => {
  withTempDb((dir) => {
    const result = db.recordPrintedTalkers([sampleTalker(), sampleTalker({ id: 'client-2', title: 'Corona Extra', category: 'beer', sku: '' })]);
    assert.equal(result.inserted, 2);
    assert.ok(result.printedAt);
    assert.ok(fs.existsSync(path.join(dir, 'data.db')));

    const { rows, total } = db.searchHistory({});
    assert.equal(total, 2);
    assert.equal(rows.length, 2);
  });
});

test('recordPrintedTalkers is a no-op for an empty or invalid array', () => {
  withTempDb(() => {
    assert.deepEqual(db.recordPrintedTalkers([]), { inserted: 0, printedAt: null });
    assert.deepEqual(db.recordPrintedTalkers(null), { inserted: 0, printedAt: null });
    assert.equal(db.searchHistory({}).total, 0);
  });
});

test('searchHistory orders most-recently-printed first', () => {
  withTempDb(() => {
    db.recordPrintedTalkers([sampleTalker({ id: 'a', title: 'First Printed' })]);
    db.recordPrintedTalkers([sampleTalker({ id: 'b', title: 'Second Printed' })]);
    const { rows } = db.searchHistory({});
    assert.equal(rows[0].title, 'Second Printed');
    assert.equal(rows[1].title, 'First Printed');
  });
});

test('searchHistory filters by title or SKU substring, case-insensitively', () => {
  withTempDb(() => {
    db.recordPrintedTalkers([
      sampleTalker({ id: 'a', title: 'Josh Cellars Cabernet Sauvignon', sku: '09144' }),
      sampleTalker({ id: 'b', title: 'Corona Extra 12pk', sku: '20531' }),
    ]);

    assert.equal(db.searchHistory({ q: 'cabernet' }).total, 1);
    assert.equal(db.searchHistory({ q: 'CORONA' }).total, 1);
    assert.equal(db.searchHistory({ q: '09144' }).total, 1);
    assert.equal(db.searchHistory({ q: 'nonexistent' }).total, 0);
  });
});

test('searchHistory paginates with limit/offset and reports the full total', () => {
  withTempDb(() => {
    for (let i = 0; i < 5; i++) {
      db.recordPrintedTalkers([sampleTalker({ id: `t${i}`, title: `Item ${i}` })]);
    }
    const page1 = db.searchHistory({ limit: 2, offset: 0 });
    const page2 = db.searchHistory({ limit: 2, offset: 2 });
    assert.equal(page1.total, 5);
    assert.equal(page1.rows.length, 2);
    assert.equal(page2.rows.length, 2);
    // No overlap between pages.
    assert.notEqual(page1.rows[0].id, page2.rows[0].id);
  });
});

test('searchHistory clamps an out-of-range limit rather than erroring', () => {
  withTempDb(() => {
    db.recordPrintedTalkers([sampleTalker()]);
    assert.doesNotThrow(() => db.searchHistory({ limit: 0 }));
    assert.doesNotThrow(() => db.searchHistory({ limit: 100000 }));
    assert.doesNotThrow(() => db.searchHistory({ offset: -5 }));
  });
});

// ---------- getHistoryEntry / deleteHistoryEntry ----------

test('getHistoryEntry returns the full stored talker plus historyId/printedAt', () => {
  withTempDb(() => {
    db.recordPrintedTalkers([sampleTalker({ awards: 'Gold Medal' })]);
    const { rows } = db.searchHistory({});
    const entry = db.getHistoryEntry(rows[0].id);
    assert.equal(entry.title, 'Josh Cellars Cabernet Sauvignon');
    assert.equal(entry.awards, 'Gold Medal');
    assert.equal(entry.historyId, rows[0].id);
    assert.ok(entry.printedAt);
  });
});

test('getHistoryEntry returns null for a missing id', () => {
  withTempDb(() => {
    assert.equal(db.getHistoryEntry(999999), null);
  });
});

test('deleteHistoryEntry removes the row and returns true, false if already gone', () => {
  withTempDb(() => {
    db.recordPrintedTalkers([sampleTalker()]);
    const { rows } = db.searchHistory({});
    const id = rows[0].id;

    assert.equal(db.deleteHistoryEntry(id), true);
    assert.equal(db.getHistoryEntry(id), null);
    assert.equal(db.deleteHistoryEntry(id), false);
  });
});

// ---------- getStats ----------

test('getStats reports zero counts on a fresh database', () => {
  withTempDb(() => {
    assert.deepEqual(db.getStats(), {
      printedTalkers: 0, mashBills: 0, beers: 0, rums: 0,
    });
  });
});

test('getStats counts printed talkers', () => {
  withTempDb(() => {
    db.recordPrintedTalkers([sampleTalker({ id: 'a' }), sampleTalker({ id: 'b' })]);
    assert.deepEqual(db.getStats(), {
      printedTalkers: 2, mashBills: 0, beers: 0, rums: 0,
    });
  });
});

// The product cache (SKU/UPC lookups) was removed along with its
// product_cache table - applySchema now drops it outright on startup so a
// PC that already had one loses the stored data too, not just stops adding
// to it.
test('applySchema drops a pre-existing product_cache table', () => {
  withTempDb(() => {
    const conn = db.getDb();
    conn.exec('CREATE TABLE product_cache (key_type TEXT, key TEXT, data TEXT)');
    conn.prepare('INSERT INTO product_cache (key_type, key, data) VALUES (?, ?, ?)').run('sku', '09144', '{}');
    db.closeDb();

    // Reopening re-runs applySchema, which should drop the table this time.
    const reopened = db.getDb();
    const table = reopened.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'product_cache'").get();
    assert.equal(table, undefined);
  });
});

// ---------- Mash Bill Library ----------

function sampleGrains() {
  return [{ grain: 'Corn', pct: 75 }, { grain: 'Rye', pct: 20 }, { grain: 'Malted Barley', pct: 5 }];
}

test('upsertMashBill creates a new entry with the given fields', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({
      title: 'Four Roses Single Barrel', distillery: 'Four Roses', grains: sampleGrains(), source: 'Manual',
    });
    assert.equal(entry.title, 'Four Roses Single Barrel');
    assert.equal(entry.distillery, 'Four Roses');
    assert.deepEqual(entry.grains, sampleGrains());
    assert.equal(entry.source, 'Manual');
    assert.ok(entry.updatedAt);
    assert.ok(entry.id);
  });
});

test('upsertMashBill updates the existing entry in place on a repeat save (case-insensitive title)', () => {
  withTempDb(() => {
    const first = db.upsertMashBill({ title: 'Buffalo Trace', grains: sampleGrains() });
    const second = db.upsertMashBill({
      title: 'buffalo trace', distillery: 'Buffalo Trace Distillery', grains: [{ grain: 'Corn', pct: 90 }],
    });
    assert.equal(second.id, first.id);
    assert.equal(second.distillery, 'Buffalo Trace Distillery');
    assert.deepEqual(second.grains, [{ grain: 'Corn', pct: 90 }]);
    assert.equal(db.listMashBills().length, 1);
  });
});

test('upsertMashBill rejects a missing title or empty grains', () => {
  withTempDb(() => {
    assert.throws(() => db.upsertMashBill({ title: '', grains: sampleGrains() }), { code: 'TITLE_REQUIRED' });
    assert.throws(() => db.upsertMashBill({ title: 'Wild Turkey 101', grains: [] }), { code: 'GRAINS_REQUIRED' });
    assert.throws(() => db.upsertMashBill({ title: 'Wild Turkey 101', grains: [{ grain: '', pct: 90 }] }), { code: 'GRAINS_REQUIRED' });
  });
});

test('upsertMashBill drops zero/negative/non-numeric grain entries rather than storing them', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({
      title: 'Four Roses Small Batch',
      grains: [{ grain: 'Corn', pct: 60 }, { grain: 'Rye', pct: 0 }, { grain: '', pct: 40 }, { grain: 'Oat', pct: 'NaN' }],
    });
    assert.deepEqual(entry.grains, [{ grain: 'Corn', pct: 60 }]);
  });
});

test('listMashBills orders alphabetically by title, case-insensitively', () => {
  withTempDb(() => {
    db.upsertMashBill({ title: 'wild turkey 101', grains: sampleGrains() });
    db.upsertMashBill({ title: 'Buffalo Trace', grains: sampleGrains() });
    db.upsertMashBill({ title: 'Four Roses', grains: sampleGrains() });
    assert.deepEqual(db.listMashBills().map((m) => m.title), ['Buffalo Trace', 'Four Roses', 'wild turkey 101']);
  });
});

test('getMashBill returns a single entry or null', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({ title: 'Elijah Craig Small Batch', grains: sampleGrains() });
    assert.deepEqual(db.getMashBill(entry.id), entry);
    assert.equal(db.getMashBill(999999), null);
  });
});

test('updateMashBillById changes fields and returns the updated entry', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({ title: 'Old Grand-Dad', grains: sampleGrains() });
    const updated = db.updateMashBillById(entry.id, {
      title: 'Old Grand-Dad Bonded', distillery: 'Jim Beam', grains: [{ grain: 'Corn', pct: 63 }, { grain: 'Rye', pct: 27 }],
    });
    assert.equal(updated.title, 'Old Grand-Dad Bonded');
    assert.equal(updated.distillery, 'Jim Beam');
    assert.deepEqual(updated.grains, [{ grain: 'Corn', pct: 63 }, { grain: 'Rye', pct: 27 }]);
  });
});

test('updateMashBillById returns null for a missing id', () => {
  withTempDb(() => {
    assert.equal(db.updateMashBillById(999999, { title: 'Nope', grains: sampleGrains() }), null);
  });
});

test('updateMashBillById refuses to rename onto another entry\'s title', () => {
  withTempDb(() => {
    db.upsertMashBill({ title: 'Eagle Rare', grains: sampleGrains() });
    const other = db.upsertMashBill({ title: 'Blanton\'s', grains: sampleGrains() });
    assert.throws(
      () => db.updateMashBillById(other.id, { title: 'eagle rare', grains: sampleGrains() }),
      { code: 'DUPLICATE_TITLE' },
    );
    // Unchanged - the failed rename didn't partially apply.
    assert.equal(db.getMashBill(other.id).title, "Blanton's");
  });
});

test('deleteMashBill removes the row and returns true, false if already gone', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({ title: 'Weller Special Reserve', grains: sampleGrains() });
    assert.equal(db.deleteMashBill(entry.id), true);
    assert.equal(db.getMashBill(entry.id), null);
    assert.equal(db.deleteMashBill(entry.id), false);
  });
});

test('getStats includes the mash bill count', () => {
  withTempDb(() => {
    assert.equal(db.getStats().mashBills, 0);
    db.upsertMashBill({ title: 'Larceny', grains: sampleGrains() });
    db.upsertMashBill({ title: 'Bulleit Bourbon', grains: sampleGrains() });
    assert.equal(db.getStats().mashBills, 2);
  });
});

// ---------- Bourbon Library fields (parent company / category / tasting
// notes / Mash Bill Confidence) ----------

function sampleConfidence(overrides = {}) {
  return {
    tier: 'confirmed',
    note: 'Mash bill #1 is publicly confirmed by the distillery.',
    verifiedAt: '2026-01-15',
    ...overrides,
  };
}

function sampleReferences(overrides) {
  return overrides || [{ label: 'Distillery site', url: 'https://example.com', tags: ['Mash Bill'] }];
}

test('upsertMashBill stores every Bourbon Library field and rowToMashBill round-trips them', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({
      title: 'Eagle Rare 10 Year',
      distillery: 'Buffalo Trace Distillery',
      grains: sampleGrains(),
      parentCompany: 'Sazerac Company',
      category: 'Kentucky Straight Bourbon',
      nose: 'Vanilla, brown sugar, mint',
      palate: 'Brown sugar and spice, oak',
      finish: 'Long and smooth',
      tastingSource: 'Distillery official tasting notes',
      confidence: sampleConfidence(),
      references: sampleReferences(),
    });
    assert.equal(entry.parentCompany, 'Sazerac Company');
    assert.equal(entry.category, 'Kentucky Straight Bourbon');
    assert.equal(entry.nose, 'Vanilla, brown sugar, mint');
    assert.equal(entry.palate, 'Brown sugar and spice, oak');
    assert.equal(entry.finish, 'Long and smooth');
    assert.equal(entry.tastingSource, 'Distillery official tasting notes');
    assert.deepEqual(entry.confidence, sampleConfidence());
    assert.deepEqual(entry.references, sampleReferences());
    // Reads back identically through getMashBill too, not just the
    // upsert's own return value.
    assert.deepEqual(db.getMashBill(entry.id), entry);
  });
});

test('a mash bill with no confidence data at all defaults to the "unknown" tier for display, not backfilled on write', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({ title: 'Mystery Batch', grains: sampleGrains() });
    assert.deepEqual(entry.confidence, {
      tier: 'unknown', note: '', verifiedAt: '',
    });
    assert.deepEqual(entry.references, []);
    assert.equal(entry.parentCompany, '');
    assert.equal(entry.category, '');
    assert.equal(entry.nose, '');
  });
});

test('upsertMashBill rejects an unrecognized confidence tier rather than storing garbage', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({
      title: 'Some Bourbon', grains: sampleGrains(), confidence: { tier: 'extremely-sure' },
    });
    // Falls back to "unknown" for display, same as no tier at all -
    // normalizeConfidenceTier only accepts the four known tiers.
    assert.equal(entry.confidence.tier, 'unknown');
  });
});

test('updateMashBillById: omitting a Bourbon Library field (undefined) preserves the existing value', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({
      title: 'Blanton\'s Single Barrel',
      grains: sampleGrains(),
      parentCompany: 'Sazerac Company',
      category: 'Kentucky Straight Bourbon',
      confidence: sampleConfidence(),
    });
    // Only touches nose - every other Bourbon Library field is left off
    // the payload entirely (undefined), which must NOT clear them.
    const updated = db.updateMashBillById(entry.id, { nose: 'Nutty, citrus, honey' });
    assert.equal(updated.nose, 'Nutty, citrus, honey');
    assert.equal(updated.parentCompany, 'Sazerac Company');
    assert.equal(updated.category, 'Kentucky Straight Bourbon');
    assert.deepEqual(updated.confidence, sampleConfidence());
  });
});

test('updateMashBillById: omitting references (undefined) preserves the existing list', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({
      title: 'Weller Special Reserve', grains: sampleGrains(), references: sampleReferences(),
    });
    const updated = db.updateMashBillById(entry.id, { nose: 'Caramel, vanilla' });
    assert.deepEqual(updated.references, sampleReferences());
  });
});

test('updateMashBillById: an explicit empty string clears a field, unlike omitting it', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({
      title: 'Old Forester 86', grains: sampleGrains(), parentCompany: 'Brown-Forman',
    });
    const updated = db.updateMashBillById(entry.id, { parentCompany: '' });
    assert.equal(updated.parentCompany, '');
  });
});

test('updateMashBillById: confidence is replaced as a whole object when provided, not merged field-by-field', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({ title: 'Larceny Barrel Proof', grains: sampleGrains(), confidence: sampleConfidence() });
    const updated = db.updateMashBillById(entry.id, { confidence: { tier: 'estimated' } });
    assert.deepEqual(updated.confidence, {
      tier: 'estimated', note: '', verifiedAt: '',
    });
  });
});

test('references drops entries with neither a label nor a url, and strips unrecognized tags', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({
      title: 'Wild Turkey Rare Breed',
      grains: sampleGrains(),
      references: [
        { label: 'Good source', url: 'https://example.com', tags: ['Mash Bill', 'Not A Real Tag'] },
        { label: '', url: '' },
        {},
      ],
    });
    assert.deepEqual(entry.references, [{ label: 'Good source', url: 'https://example.com', tags: ['Mash Bill'] }]);
  });
});

test('updateMashBillById: references is replaced as a whole list when provided, not merged item-by-item', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({ title: 'Four Roses Small Batch', grains: sampleGrains(), references: sampleReferences() });
    const updated = db.updateMashBillById(entry.id, {
      references: [{ label: 'New source', url: 'https://example.org', tags: [] }],
    });
    assert.deepEqual(updated.references, [{ label: 'New source', url: 'https://example.org', tags: [] }]);
  });
});

// The migration itself: mash_bills shipped with just six columns for
// several releases (see applyMashBillColumns's own comment in db.js) -
// simulate exactly that shape on disk, then confirm opening it through
// db.js adds the ten Bourbon Library columns without losing the existing
// row, and that writes against the now-migrated table work normally.
test('applyMashBillColumns migrates a pre-existing 6-column mash_bills table cleanly', () => {
  withTempDb((dir) => {
    const Database = require('better-sqlite3');
    const filePath = path.join(dir, 'data.db');
    const raw = new Database(filePath);
    raw.exec(`
      CREATE TABLE mash_bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        distillery TEXT,
        grains TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'Manual',
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_mash_bills_title_unique ON mash_bills (title COLLATE NOCASE);
    `);
    raw.prepare(`
      INSERT INTO mash_bills (title, distillery, grains, source, updated_at)
      VALUES ('Legacy Entry', 'Some Distillery', '[{"grain":"Corn","pct":80}]', 'Manual', '2025-01-01T00:00:00.000Z')
    `).run();
    raw.close();

    // Opening through db.js (any call reaches getDb() -> applySchema()) is
    // what a real app launch against an old data.db would do.
    const legacy = db.listMashBills().find((m) => m.title === 'Legacy Entry');
    assert.ok(legacy, 'the pre-existing row survived the migration');
    assert.equal(legacy.distillery, 'Some Distillery');
    assert.deepEqual(legacy.grains, [{ grain: 'Corn', pct: 80 }]);
    // New columns exist and default to the same "nothing known yet" shape
    // a brand-new row would have.
    assert.deepEqual(legacy.confidence, {
      tier: 'unknown', note: '', verifiedAt: '',
    });
    assert.deepEqual(legacy.references, []);
    assert.equal(legacy.parentCompany, '');

    // And the migrated table isn't just readable - it accepts writes to
    // the new columns like any fresh install's table would.
    const updated = db.updateMashBillById(legacy.id, { parentCompany: 'Test Co' });
    assert.equal(updated.parentCompany, 'Test Co');

    // Re-running the migration (a second launch against the same file)
    // is a no-op, not a duplicate-column error.
    assert.doesNotThrow(() => db.getDb());
  });
});

// The beers table's own migration: simulate a pre-existing install whose
// beers table predates the region/country columns (see applyBeerColumns's
// own comment in db.js), confirm opening it through db.js adds them without
// losing the existing row, and that the location text on file gets
// best-effort split into region/country as part of that same migration.
test('applyBeerColumns migrates a pre-existing beers table and backfills region/country from location', () => {
  withTempDb((dir) => {
    const Database = require('better-sqlite3');
    const filePath = path.join(dir, 'data.db');
    const raw = new Database(filePath);
    raw.exec(`
      CREATE TABLE beers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        beer_name TEXT,
        brewery TEXT,
        location TEXT,
        style TEXT,
        size TEXT,
        abv TEXT,
        ibu TEXT,
        untappd_rating TEXT,
        untappd_rating_count TEXT,
        description TEXT,
        sku TEXT,
        upc TEXT,
        variety_pack INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'Manual',
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_beers_title_unique ON beers (title COLLATE NOCASE);
    `);
    raw.prepare(`
      INSERT INTO beers (title, brewery, location, source, updated_at)
      VALUES
        ('US Beer', 'Slack Tide Brewing Company', 'Morris Plains, NJ United States', 'Manual', '2025-01-01T00:00:00.000Z'),
        ('International Beer', 'Some Brewery', 'Amsterdam, Netherlands', 'Manual', '2025-01-01T00:00:00.000Z'),
        ('No Location Beer', 'Another Brewery', '', 'Manual', '2025-01-01T00:00:00.000Z'),
        ('Irish Beer', 'Some Irish Brewery', 'Dublin, County Dublin Ireland', 'Manual', '2025-01-01T00:00:00.000Z')
    `).run();
    raw.close();

    // Opening through db.js (any call reaches getDb() -> applySchema()) is
    // what a real app launch against an old data.db would do.
    const beers = db.listBeers();
    const usBeer = beers.find((b) => b.title === 'US Beer');
    const intlBeer = beers.find((b) => b.title === 'International Beer');
    const noLocationBeer = beers.find((b) => b.title === 'No Location Beer');
    const irishBeer = beers.find((b) => b.title === 'Irish Beer');

    assert.ok(usBeer, 'the pre-existing row survived the migration');
    assert.equal(usBeer.region, 'NJ');
    assert.equal(usBeer.country, 'United States');
    assert.equal(intlBeer.region, '');
    assert.equal(intlBeer.country, 'Netherlands');
    assert.equal(noLocationBeer.region, '');
    assert.equal(noLocationBeer.country, '');
    // A spelled-out region with no comma before the country (the shape a
    // "County Dublin" style Untappd location has, unlike a 2-3 letter US
    // state code) used to swallow the whole tail into country - confirm it
    // now splits the same way the US case above does.
    assert.equal(irishBeer.region, 'County Dublin');
    assert.equal(irishBeer.country, 'Ireland');

    // And the migrated table isn't just readable - it accepts writes to the
    // new columns like any fresh install's table would.
    const updated = db.updateBeerById(usBeer.id, { region: 'NY' });
    assert.equal(updated.region, 'NY');

    // Re-running the migration (a second launch against the same file) is a
    // no-op, not a duplicate-column error, and doesn't clobber the hand
    // edit above back to the parsed-from-location value.
    assert.doesNotThrow(() => db.getDb());
    assert.equal(db.getBeer(usBeer.id).region, 'NY');
  });
});

// ---------- The Beer Bible ----------

test('upsertBeer creates a new entry with the given fields', () => {
  withTempDb(() => {
    const entry = db.upsertBeer({
      title: 'Slack Tide Flounder Pounder',
      brewery: 'Slack Tide Brewing Company',
      location: 'Wilmington, NC',
      style: 'American IPA',
      abv: '6.2%',
      ibu: '55',
      untappdRating: '3.9',
      untappdRatingCount: '1,204',
      description: 'A hazy, tropical IPA.',
      sku: '15614',
      source: 'Manual',
    });
    assert.equal(entry.title, 'Slack Tide Flounder Pounder');
    assert.equal(entry.brewery, 'Slack Tide Brewing Company');
    assert.equal(entry.location, 'Wilmington, NC');
    assert.equal(entry.style, 'American IPA');
    assert.equal(entry.abv, '6.2%');
    assert.equal(entry.ibu, '55');
    assert.equal(entry.untappdRating, '3.9');
    assert.equal(entry.untappdRatingCount, '1,204');
    assert.equal(entry.description, 'A hazy, tropical IPA.');
    assert.equal(entry.sku, '15614');
    assert.equal(entry.source, 'Manual');
    assert.ok(entry.updatedAt);
    assert.ok(entry.id);
  });
});

test('upsertBeer persists beerName separately from title, and an omitted beerName on a repeat save leaves it alone', () => {
  withTempDb(() => {
    const first = db.upsertBeer({
      title: 'TIRED HANDS HOPHANDS CAN', beerName: 'Tired Hands Brewing HopHands', brewery: 'Tired Hands Brewing Company', sku: '55001',
    });
    assert.equal(first.title, 'TIRED HANDS HOPHANDS CAN');
    assert.equal(first.beerName, 'Tired Hands Brewing HopHands');

    // A repeat save (e.g. a re-scan under the same SKU) with no beerName in
    // the request leaves the one already on file untouched - same
    // "undefined leaves it alone" rule every other optional field follows.
    const second = db.upsertBeer({ title: 'TIRED HANDS HOPHANDS CAN', style: 'Pale Ale - American', sku: '55001' });
    assert.equal(second.id, first.id);
    assert.equal(second.beerName, 'Tired Hands Brewing HopHands');
    assert.equal(second.style, 'Pale Ale - American');
  });
});

test('upsertBeer updates the existing entry in place on a repeat save (case-insensitive title)', () => {
  withTempDb(() => {
    const first = db.upsertBeer({ title: 'Michelob ULTRA', brewery: 'Anheuser-Busch' });
    const second = db.upsertBeer({ title: 'michelob ultra', style: 'Light Lager' });
    assert.equal(second.id, first.id);
    // Omitted (undefined) fields on the second save leave what's already
    // there alone - same convention as upsertMashBill.
    assert.equal(second.brewery, 'Anheuser-Busch');
    assert.equal(second.style, 'Light Lager');
    assert.equal(db.listBeers().length, 1);
  });
});

test('upsertBeer persists varietyPack, and an omitted varietyPack on a repeat save leaves it alone - false is a real value here, not "unset"', () => {
  withTempDb(() => {
    const first = db.upsertBeer({ title: '2ND FAVOR HEAVY SPECTRUM 4PK', varietyPack: true, sku: '41788' });
    assert.equal(first.varietyPack, true);

    // A repeat save with no varietyPack in the request leaves the flag as
    // it already was - same "undefined leaves it alone" rule every other
    // optional field follows (see the test above), just for a boolean.
    const second = db.upsertBeer({ title: '2ND FAVOR HEAVY SPECTRUM 4PK', style: 'Mixed Pack', sku: '41788' });
    assert.equal(second.id, first.id);
    assert.equal(second.varietyPack, true);

    // Explicitly saving `false` really does clear it, unlike leaving it
    // omitted.
    const third = db.upsertBeer({ title: '2ND FAVOR HEAVY SPECTRUM 4PK', varietyPack: false, sku: '41788' });
    assert.equal(third.varietyPack, false);
  });
});

test('upsertBeer persists size as plain text, and an omitted size on a repeat save leaves it alone (same convention as every other optional text field)', () => {
  withTempDb(() => {
    const first = db.upsertBeer({ title: 'DOGFISH HEAD 60 MIN IPA 6PK CAN', size: '6-Pack', sku: '111' });
    assert.equal(first.size, '6-Pack');

    const second = db.upsertBeer({ title: 'DOGFISH HEAD 60 MIN IPA 6PK CAN', style: 'American IPA', sku: '111' });
    assert.equal(second.id, first.id);
    assert.equal(second.size, '6-Pack');
  });
});

test('upsertBeer rejects a missing title', () => {
  withTempDb(() => {
    assert.throws(() => db.upsertBeer({ title: '' }), { code: 'TITLE_REQUIRED' });
    assert.throws(() => db.upsertBeer({}), { code: 'TITLE_REQUIRED' });
  });
});

test('a new beer entry defaults every optional field to an empty string, not null/undefined', () => {
  withTempDb(() => {
    const entry = db.upsertBeer({ title: 'Mystery Lager' });
    assert.deepEqual(entry, {
      id: entry.id,
      title: 'Mystery Lager',
      beerName: '',
      brewery: '',
      location: '',
      region: '',
      country: '',
      style: '',
      size: '',
      abv: '',
      ibu: '',
      untappdRating: '',
      untappdRatingCount: '',
      description: '',
      sku: '',
      upc: '',
      varietyPack: false,
      source: 'Manual',
      updatedAt: entry.updatedAt,
    });
  });
});

test('listBeers orders alphabetically by title, case-insensitively', () => {
  withTempDb(() => {
    db.upsertBeer({ title: 'yuengling lager' });
    db.upsertBeer({ title: 'Blue Moon Belgian White' });
    db.upsertBeer({ title: 'Michelob ULTRA' });
    assert.deepEqual(db.listBeers().map((b) => b.title), ['Blue Moon Belgian White', 'Michelob ULTRA', 'yuengling lager']);
  });
});

test('getBeer returns a single entry or null', () => {
  withTempDb(() => {
    const entry = db.upsertBeer({ title: 'Sierra Nevada Pale Ale' });
    assert.deepEqual(db.getBeer(entry.id), entry);
    assert.equal(db.getBeer(999999), null);
  });
});

test('getBeerByTitle matches case-insensitively (same rule as upsertBeer\'s own uniqueness check) and returns null otherwise', () => {
  withTempDb(() => {
    const entry = db.upsertBeer({ title: 'Sierra Nevada Pale Ale', brewery: 'Sierra Nevada' });
    assert.deepEqual(db.getBeerByTitle('sierra nevada pale ale'), entry);
    assert.deepEqual(db.getBeerByTitle('SIERRA NEVADA PALE ALE'), entry);
    assert.equal(db.getBeerByTitle('Not On File'), null);
    assert.equal(db.getBeerByTitle(''), null);
    assert.equal(db.getBeerByTitle(undefined), null);
  });
});

test('getBeerBySku matches on the trimmed SKU, case-insensitively, and returns null otherwise', () => {
  withTempDb(() => {
    const entry = db.upsertBeer({ title: 'Sierra Nevada Pale Ale', sku: 'sw-4021' });
    assert.deepEqual(db.getBeerBySku('SW-4021'), entry);
    assert.deepEqual(db.getBeerBySku('  sw-4021  '), entry);
    assert.equal(db.getBeerBySku('99999'), null);
    assert.equal(db.getBeerBySku(''), null);
    assert.equal(db.getBeerBySku(undefined), null);
  });
});

test('upsertBeer matches an existing row by SKU even when the title is worded differently, instead of adding a duplicate', () => {
  withTempDb(() => {
    const first = db.upsertBeer({
      title: 'CENTRAL WATERS BOURBON BARREL TIRAMISU STOUT 4PK CAN',
      sku: '48213',
      source: 'Import',
    });
    // Same SKU, but the title this time is the nicer Untappd-matched
    // wording a Shelf Talker auto-save would send - still the same row,
    // not a second one.
    const second = db.upsertBeer({
      title: 'Central Waters Bourbon Barrel Tiramisu Stout',
      sku: '48213',
      brewery: 'Central Waters Brewing Co.',
      style: 'American Imperial Stout',
      source: 'Shelf Talker',
    });
    assert.equal(second.id, first.id);
    assert.equal(db.listBeers().length, 1);
    // A SKU match never renames the existing row - the original title
    // stands, the new save just fills in what was missing.
    assert.equal(second.title, 'CENTRAL WATERS BOURBON BARREL TIRAMISU STOUT 4PK CAN');
    assert.equal(second.brewery, 'Central Waters Brewing Co.');
    assert.equal(second.style, 'American Imperial Stout');
    assert.equal(second.source, 'Shelf Talker');
  });
});

test('upsertBeer with no SKU (on either save) still falls back to matching by title', () => {
  withTempDb(() => {
    const first = db.upsertBeer({ title: 'Yuengling Lager', brewery: 'Yuengling' });
    const second = db.upsertBeer({ title: 'yuengling lager', style: 'American Amber Lager' });
    assert.equal(second.id, first.id);
    assert.equal(db.listBeers().length, 1);
  });
});

test('upsertBeer with a SKU that matches nothing on file still falls back to matching by title', () => {
  withTempDb(() => {
    const first = db.upsertBeer({ title: 'Blue Moon Belgian White', sku: '10001' });
    const second = db.upsertBeer({ title: 'Blue Moon Belgian White', sku: '10002', style: 'Witbier' });
    assert.equal(second.id, first.id);
    assert.equal(db.listBeers().length, 1);
    // The title match still updates the SKU field itself like any other
    // optional field - only the title is protected from a SKU-driven rename.
    assert.equal(second.sku, '10002');
    assert.equal(second.style, 'Witbier');
  });
});

test('upsertBeer with a SKU that belongs to a different title creates a genuinely new row', () => {
  withTempDb(() => {
    db.upsertBeer({ title: 'Bell\'s Two Hearted Ale', sku: '77001' });
    const other = db.upsertBeer({ title: 'Founders All Day IPA', sku: '77002' });
    assert.equal(db.listBeers().length, 2);
    assert.equal(other.title, 'Founders All Day IPA');
    assert.equal(other.sku, '77002');
  });
});

test('updateBeerById changes fields and returns the updated entry, preserving an omitted (undefined) field', () => {
  withTempDb(() => {
    const entry = db.upsertBeer({ title: 'Modelo Especial', brewery: 'Grupo Modelo', style: 'Pale Lager' });
    const updated = db.updateBeerById(entry.id, { abv: '4.4%', ibu: '18' });
    assert.equal(updated.abv, '4.4%');
    assert.equal(updated.ibu, '18');
    // brewery/style weren't passed to this update, so they're unchanged.
    assert.equal(updated.brewery, 'Grupo Modelo');
    assert.equal(updated.style, 'Pale Lager');
  });
});

test('updateBeerById can update beerName without touching title (the Beer Bible edit form\'s own save shape - see els.beerBibleFormSaveBtn in app.js)', () => {
  withTempDb(() => {
    const entry = db.upsertBeer({ title: 'TIRED HANDS HOPHANDS CAN', brewery: 'Tired Hands Brewing Company' });
    const updated = db.updateBeerById(entry.id, { beerName: 'Tired Hands Brewing HopHands' });
    assert.equal(updated.beerName, 'Tired Hands Brewing HopHands');
    // title is the SKU/title-matching text (see getBeerByTitle) - an edit
    // that only sends beerName must never touch it.
    assert.equal(updated.title, 'TIRED HANDS HOPHANDS CAN');
  });
});

test('updateBeerById returns null for a missing id', () => {
  withTempDb(() => {
    assert.equal(db.updateBeerById(999999, { title: 'Nope' }), null);
  });
});

test('updateBeerById refuses to rename onto another entry\'s title', () => {
  withTempDb(() => {
    db.upsertBeer({ title: 'Sam Adams Boston Lager' });
    const other = db.upsertBeer({ title: 'Dogfish Head 60 Minute IPA' });
    assert.throws(
      () => db.updateBeerById(other.id, { title: 'sam adams boston lager' }),
      { code: 'DUPLICATE_TITLE' },
    );
    // Unchanged - the failed rename didn't partially apply.
    assert.equal(db.getBeer(other.id).title, 'Dogfish Head 60 Minute IPA');
  });
});

test('deleteBeer removes the row and returns true, false if already gone', () => {
  withTempDb(() => {
    const entry = db.upsertBeer({ title: 'Founders All Day IPA' });
    assert.equal(db.deleteBeer(entry.id), true);
    assert.equal(db.getBeer(entry.id), null);
    assert.equal(db.deleteBeer(entry.id), false);
  });
});

test('getStats includes the beer count, independent of mashBills', () => {
  withTempDb(() => {
    assert.equal(db.getStats().beers, 0);
    db.upsertBeer({ title: 'Larceny Not Actually Bourbon' }); // deliberately beer-table only
    db.upsertMashBill({ title: 'Larceny', grains: sampleGrains() });
    assert.equal(db.getStats().beers, 1);
    assert.equal(db.getStats().mashBills, 1);
  });
});

// ---------- The Rum Repository ----------

test('upsertRum creates a new entry with the given fields', () => {
  withTempDb(() => {
    const entry = db.upsertRum({
      title: 'Plantation Original Dark',
      distillery: 'Maison Ferrand',
      region: 'Caribbean',
      style: 'Dark Rum',
      abv: '40%',
      ageStatement: 'Aged 8-14 years',
      description: 'Rich notes of dried fruit, molasses, and baking spice.',
      sku: '15614',
      source: 'Manual',
    });
    assert.equal(entry.title, 'Plantation Original Dark');
    assert.equal(entry.distillery, 'Maison Ferrand');
    assert.equal(entry.region, 'Caribbean');
    assert.equal(entry.style, 'Dark Rum');
    assert.equal(entry.abv, '40%');
    assert.equal(entry.ageStatement, 'Aged 8-14 years');
    assert.equal(entry.description, 'Rich notes of dried fruit, molasses, and baking spice.');
    assert.equal(entry.sku, '15614');
    assert.equal(entry.source, 'Manual');
    assert.ok(entry.updatedAt);
    assert.ok(entry.id);
  });
});

test('upsertRum updates the existing entry in place on a repeat save (case-insensitive title)', () => {
  withTempDb(() => {
    const first = db.upsertRum({ title: 'Mount Gay XO', distillery: 'Mount Gay' });
    const second = db.upsertRum({ title: 'mount gay xo', style: 'Aged Rum' });
    assert.equal(second.id, first.id);
    // Omitted (undefined) fields on the second save leave what's already
    // there alone - same convention as upsertBeer.
    assert.equal(second.distillery, 'Mount Gay');
    assert.equal(second.style, 'Aged Rum');
    assert.equal(db.listRums().length, 1);
  });
});

test('upsertRum rejects a missing title', () => {
  withTempDb(() => {
    assert.throws(() => db.upsertRum({ title: '' }), { code: 'TITLE_REQUIRED' });
    assert.throws(() => db.upsertRum({}), { code: 'TITLE_REQUIRED' });
  });
});

test('a new rum entry defaults every optional field to an empty string, not null/undefined', () => {
  withTempDb(() => {
    const entry = db.upsertRum({ title: 'Mystery Rum' });
    assert.deepEqual(entry, {
      id: entry.id,
      title: 'Mystery Rum',
      distillery: '',
      region: '',
      style: '',
      abv: '',
      ageStatement: '',
      description: '',
      sku: '',
      source: 'Manual',
      updatedAt: entry.updatedAt,
    });
  });
});

test('listRums orders alphabetically by title, case-insensitively', () => {
  withTempDb(() => {
    db.upsertRum({ title: 'zacapa 23' });
    db.upsertRum({ title: 'Appleton Estate 12' });
    db.upsertRum({ title: 'Mount Gay XO' });
    assert.deepEqual(db.listRums().map((r) => r.title), ['Appleton Estate 12', 'Mount Gay XO', 'zacapa 23']);
  });
});

test('getRum returns a single entry or null', () => {
  withTempDb(() => {
    const entry = db.upsertRum({ title: 'Diplomatico Reserva Exclusiva' });
    assert.deepEqual(db.getRum(entry.id), entry);
    assert.equal(db.getRum(999999), null);
  });
});

test('updateRumById changes fields and returns the updated entry, preserving an omitted (undefined) field', () => {
  withTempDb(() => {
    const entry = db.upsertRum({ title: 'Bacardi Superior', distillery: 'Bacardi', style: 'White Rum' });
    const updated = db.updateRumById(entry.id, { abv: '40%', ageStatement: 'Unaged' });
    assert.equal(updated.abv, '40%');
    assert.equal(updated.ageStatement, 'Unaged');
    // distillery/style weren't passed to this update, so they're unchanged.
    assert.equal(updated.distillery, 'Bacardi');
    assert.equal(updated.style, 'White Rum');
  });
});

test('updateRumById returns null for a missing id', () => {
  withTempDb(() => {
    assert.equal(db.updateRumById(999999, { title: 'Nope' }), null);
  });
});

test('updateRumById refuses to rename onto another entry\'s title', () => {
  withTempDb(() => {
    db.upsertRum({ title: 'Captain Morgan Original Spiced' });
    const other = db.upsertRum({ title: 'Kraken Black Spiced' });
    assert.throws(
      () => db.updateRumById(other.id, { title: 'captain morgan original spiced' }),
      { code: 'DUPLICATE_TITLE' },
    );
    // Unchanged - the failed rename didn't partially apply.
    assert.equal(db.getRum(other.id).title, 'Kraken Black Spiced');
  });
});

test('deleteRum removes the row and returns true, false if already gone', () => {
  withTempDb(() => {
    const entry = db.upsertRum({ title: 'Wray & Nephew White Overproof' });
    assert.equal(db.deleteRum(entry.id), true);
    assert.equal(db.getRum(entry.id), null);
    assert.equal(db.deleteRum(entry.id), false);
  });
});

test('getStats includes the rum count, independent of beers and mashBills', () => {
  withTempDb(() => {
    assert.equal(db.getStats().rums, 0);
    db.upsertRum({ title: 'Cruzan Aged Light Rum' }); // deliberately rum-table only
    db.upsertBeer({ title: 'Not A Rum' });
    db.upsertMashBill({ title: 'Also Not A Rum', grains: sampleGrains() });
    assert.equal(db.getStats().rums, 1);
    assert.equal(db.getStats().beers, 1);
    assert.equal(db.getStats().mashBills, 1);
  });
});
