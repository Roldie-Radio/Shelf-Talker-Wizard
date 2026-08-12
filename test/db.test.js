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
    assert.deepEqual(db.getStats(), { printedTalkers: 0 });
  });
});

test('getStats counts printed talkers', () => {
  withTempDb(() => {
    db.recordPrintedTalkers([sampleTalker({ id: 'a' }), sampleTalker({ id: 'b' })]);
    assert.deepEqual(db.getStats(), { printedTalkers: 2 });
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
