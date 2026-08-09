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

// ---------- product cache ----------

test('upsertCachedProduct + getCachedProduct round-trips by key', () => {
  withTempDb(() => {
    db.upsertCachedProduct({ keyType: 'sku', key: '09144', source: 'sku-lookup', data: { title: 'Josh Cellars', price: '13.99' } });
    const cached = db.getCachedProduct({ keyType: 'sku', key: '09144' });
    assert.equal(cached.data.title, 'Josh Cellars');
    assert.equal(cached.source, 'sku-lookup');
    assert.ok(db.isFresh(cached));
  });
});

test('getCachedProduct returns null on a miss', () => {
  withTempDb(() => {
    assert.equal(db.getCachedProduct({ keyType: 'sku', key: 'nope' }), null);
  });
});

test('product cache key lookup is case/whitespace-insensitive', () => {
  withTempDb(() => {
    db.upsertCachedProduct({ keyType: 'upc', key: '  085000010652  ', source: 'scan-upc', data: { title: 'Josh Cellars' } });
    const cached = db.getCachedProduct({ keyType: 'upc', key: '085000010652' });
    assert.ok(cached);
    assert.equal(cached.data.title, 'Josh Cellars');
  });
});

test('a SKU and UPC that share the same digits do not collide', () => {
  withTempDb(() => {
    db.upsertCachedProduct({ keyType: 'sku', key: '12345', source: 'sku-lookup', data: { title: 'From SKU Lookup' } });
    db.upsertCachedProduct({ keyType: 'upc', key: '12345', source: 'scan-upc', data: { title: 'From Scan UPC' } });
    assert.equal(db.getCachedProduct({ keyType: 'sku', key: '12345' }).data.title, 'From SKU Lookup');
    assert.equal(db.getCachedProduct({ keyType: 'upc', key: '12345' }).data.title, 'From Scan UPC');
  });
});

test('upsertCachedProduct overwrites rather than duplicating an existing key', () => {
  withTempDb(() => {
    db.upsertCachedProduct({ keyType: 'sku', key: '09144', source: 'sku-lookup', data: { price: '13.99' } });
    db.upsertCachedProduct({ keyType: 'sku', key: '09144', source: 'sku-lookup', data: { price: '11.99' } });
    assert.equal(db.getCachedProduct({ keyType: 'sku', key: '09144' }).data.price, '11.99');
  });
});

test('isFresh is false for an entry older than the freshness window', () => {
  withTempDb(() => {
    db.upsertCachedProduct({ keyType: 'sku', key: '09144', source: 'sku-lookup', data: { price: '13.99' } });
    // Backdate updated_at directly rather than waiting 24h - getDb() is
    // exported for exactly this kind of test-only direct access.
    const old = new Date(Date.now() - db.CACHE_FRESH_MS - 1000).toISOString();
    db.getDb().prepare('UPDATE product_cache SET updated_at = ? WHERE key_type = ? AND key = ?').run(old, 'sku', '09144');

    const cached = db.getCachedProduct({ keyType: 'sku', key: '09144' });
    assert.equal(db.isFresh(cached), false);
    // Still returns the (stale) data - staleness is the caller's decision, not this module's.
    assert.equal(cached.data.price, '13.99');
  });
});

// ---------- getStats ----------

test('getStats reports zero counts on a fresh database', () => {
  withTempDb(() => {
    assert.deepEqual(db.getStats(), { printedTalkers: 0, cachedProducts: 0 });
  });
});

test('getStats counts printed talkers and cached products independently', () => {
  withTempDb(() => {
    db.recordPrintedTalkers([sampleTalker({ id: 'a' }), sampleTalker({ id: 'b' })]);
    db.upsertCachedProduct({ keyType: 'sku', key: '09144', source: 'sku-lookup', data: { title: 'Josh Cellars' } });
    assert.deepEqual(db.getStats(), { printedTalkers: 2, cachedProducts: 1 });
  });
});

test('getStats counts each product-cache row once even with multiple UPC-variant keys', () => {
  withTempDb(() => {
    // Distinct from upcCatalog.js's own UPC-A/EAN-13 variant indexing (which
    // stores the same product under two Map keys in memory) - here each
    // upsert is a single row keyed by (key_type, key), so two different
    // *keys* for the same conceptual product genuinely are two rows; this
    // just confirms getStats reflects row count, not some deduped notion.
    db.upsertCachedProduct({ keyType: 'upc', key: '085000010652', source: 'scan-upc', data: {} });
    db.upsertCachedProduct({ keyType: 'upc', key: '0085000010652', source: 'scan-upc', data: {} });
    assert.equal(db.getStats().cachedProducts, 2);
  });
});
