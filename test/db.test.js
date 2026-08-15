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
    assert.deepEqual(db.getStats(), { printedTalkers: 0, mashBills: 0 });
  });
});

test('getStats counts printed talkers', () => {
  withTempDb(() => {
    db.recordPrintedTalkers([sampleTalker({ id: 'a' }), sampleTalker({ id: 'b' })]);
    assert.deepEqual(db.getStats(), { printedTalkers: 2, mashBills: 0 });
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

test('upsertMashBill rejects a missing title', () => {
  withTempDb(() => {
    assert.throws(() => db.upsertMashBill({ title: '', grains: sampleGrains() }), { code: 'TITLE_REQUIRED' });
  });
});

// Grains are optional now (see the comment on validateMashBillInput in
// db.js) - an entry can legitimately track "nothing researched yet" as the
// Bourbon Library's "Unknown" confidence tier, rather than being forced to
// have a mash bill to exist at all.
test('upsertMashBill allows an entry with no grains at all (an "Unknown"-tier Library entry)', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({ title: "Michter's US*1 Bourbon", grains: null });
    assert.deepEqual(entry.grains, []);
    const entryWithJunk = db.upsertMashBill({ title: 'Wild Turkey 101', grains: [{ grain: '', pct: 90 }] });
    assert.deepEqual(entryWithJunk.grains, []);
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

// ---------- Bourbon Library profile fields (parent company/category/tasting
// notes/confidence) added on top of the original mash bill columns above ----------

function sampleConfidence() {
  return {
    tier: 'reported',
    note: 'Multiple independent sources agree, but the distillery has not confirmed it directly.',
    verified: '2026-06-01',
    sources: [{ label: 'Distiller Encyclopedia', url: 'https://example.com/buffalo-trace' }],
  };
}

test('upsertMashBill stores and returns the profile and confidence fields', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({
      title: 'Buffalo Trace',
      grains: sampleGrains(),
      parentCompany: 'Sazerac',
      category: 'Straight Bourbon',
      nose: 'Vanilla, brown sugar',
      palate: 'Caramel, oak',
      finish: 'Long, spicy',
      confidence: sampleConfidence(),
    });
    assert.equal(entry.parentCompany, 'Sazerac');
    assert.equal(entry.category, 'Straight Bourbon');
    assert.equal(entry.nose, 'Vanilla, brown sugar');
    assert.deepEqual(entry.confidence, sampleConfidence());
  });
});

test('upsertMashBill defaults profile/confidence fields to blank/unknown when omitted', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({ title: 'Wild Turkey 101', grains: sampleGrains() });
    assert.equal(entry.parentCompany, '');
    assert.equal(entry.category, '');
    assert.deepEqual(entry.confidence, {
      tier: 'unknown', note: '', verified: '', sources: [],
    });
  });
});

test('updateMashBillById keeps existing profile/confidence fields when the call omits them (partial merge)', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({
      title: 'Four Roses',
      grains: sampleGrains(),
      parentCompany: 'Kirin',
      confidence: sampleConfidence(),
    });
    // Same shape the Manage Mash Bill Library dialog's Edit action actually
    // sends today - title/distillery/grains/source only.
    const updated = db.updateMashBillById(entry.id, { title: 'Four Roses', distillery: 'Four Roses Distillery', grains: sampleGrains() });
    assert.equal(updated.parentCompany, 'Kirin');
    assert.deepEqual(updated.confidence, sampleConfidence());
  });
});

test('updateMashBillById replaces the whole confidence block when one is provided', () => {
  withTempDb(() => {
    const entry = db.upsertMashBill({ title: 'Michter\'s', grains: sampleGrains(), confidence: sampleConfidence() });
    const updated = db.updateMashBillById(entry.id, {
      grains: sampleGrains(),
      confidence: { tier: 'unknown', sources: [] },
    });
    assert.deepEqual(updated.confidence, {
      tier: 'unknown', note: '', verified: '', sources: [],
    });
  });
});
