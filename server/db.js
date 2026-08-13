// Local SQLite storage, layered on top of the browser localStorage queue
// (public/js/app.js) rather than replacing it - localStorage stays exactly
// what it's always been, the *live, editable, in-progress* queue. This adds
// what localStorage can't: a permanent record of what was actually printed
// (talkers vanish from the queue once removed, but the History panel keeps
// every print).
//
// One SQLite file (data.db) in the same per-PC directory upcCatalog.js's
// config.json lives in (see appData.js) - a single file on disk, no server
// process, no network, matching how this whole app is a single-PC tool.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { getAppDataDir } = require('./appData');

function dbFilePath() {
  return path.join(getAppDataDir(), 'data.db');
}

function applySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS printed_talkers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      printed_at TEXT NOT NULL,
      client_id TEXT,
      title TEXT,
      category TEXT,
      sign_type TEXT,
      sku TEXT,
      size TEXT,
      price TEXT,
      sale_price TEXT,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_printed_talkers_printed_at ON printed_talkers(printed_at);
    CREATE INDEX IF NOT EXISTS idx_printed_talkers_title ON printed_talkers(title);
    CREATE INDEX IF NOT EXISTS idx_printed_talkers_sku ON printed_talkers(sku);

    -- The product cache (SKU/UPC lookups) is gone - every lookup is a
    -- straight live fetch now, with a real error instead of a stale
    -- fallback on failure. Dropped here (not just left uncreated) so a PC
    -- that already has one from before this change actually loses the
    -- stored data on its next launch, rather than it sitting around unused.
    DROP TABLE IF EXISTS product_cache;

    -- Mash Bill Library (Tools -> Mash Bill Library..., Bourbon Shelf
    -- Talkers only): one researched grain composition per product title, so
    -- it can be recalled instead of re-typed on the next talker for that
    -- same bottle. One row per title (case-insensitive - the unique index
    -- below), distillery is free text for browsing/search only and plays no
    -- part in matching (see app.js's exact-title recall). This table is
    -- always this PC's own local copy; whichever PC is currently marked
    -- Server PC (see serverConfig.js) is the one whose copy is authoritative
    -- store-wide - see mashBillSync.js for how every other PC's writes get
    -- forwarded to it and its reads get cached locally.
    CREATE TABLE IF NOT EXISTS mash_bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      distillery TEXT,
      grains TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'Manual',
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mash_bills_title_unique ON mash_bills (title COLLATE NOCASE);
  `);
}

// Re-derived whenever the configured directory changes (same pattern as
// upcCatalog.js's catalog cache) - the only place this actually happens
// outside tests is SHELF_TALKER_CONFIG_DIR, which isn't expected to change
// mid-run in production, but every test gets its own throwaway directory.
let dbInstance = null;
let dbInstancePath = null;

function getDb() {
  const filePath = dbFilePath();
  if (dbInstance && dbInstancePath === filePath) return dbInstance;
  if (dbInstance) dbInstance.close();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  dbInstance = new Database(filePath);
  // WAL trades a couple of extra files on disk (.db-wal/.db-shm) for better
  // read/write behavior - recommended default per better-sqlite3's own docs,
  // and this app's single local process is exactly the case it's good for.
  dbInstance.pragma('journal_mode = WAL');
  applySchema(dbInstance);
  dbInstancePath = filePath;
  return dbInstance;
}

function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbInstancePath = null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

// ================================================================
// Print history - an append-only log: every "Print Now" writes one row per
// talker in the queue at that moment, snapshotting the full talker object
// (so a reprint restores everything - theme, ratings, awards, all of it),
// not just a few fields. Nothing here is ever updated in place; printing
// the "same" talker again just adds another row with a new timestamp,
// which is also how "printed twice" naturally shows up in search.
// ================================================================

function recordPrintedTalkers(talkers) {
  if (!Array.isArray(talkers) || !talkers.length) return { inserted: 0, printedAt: null };
  const db = getDb();
  const printedAt = nowIso();
  const insert = db.prepare(`
    INSERT INTO printed_talkers (printed_at, client_id, title, category, sign_type, sku, size, price, sale_price, data)
    VALUES (@printedAt, @clientId, @title, @category, @signType, @sku, @size, @price, @salePrice, @data)
  `);
  const insertAll = db.transaction((items) => {
    for (const talker of items) {
      insert.run({
        printedAt,
        clientId: talker.id || null,
        title: talker.title || '',
        category: talker.category || '',
        signType: talker.signType || '',
        sku: talker.sku || null,
        size: talker.size || '',
        price: talker.price || '',
        salePrice: talker.salePrice || '',
        data: JSON.stringify(talker),
      });
    }
  });
  insertAll(talkers);
  return { inserted: talkers.length, printedAt };
}

const HISTORY_LIST_COLUMNS = `
  id, printed_at AS printedAt, title, category, sign_type AS signType,
  sku, size, price, sale_price AS salePrice
`;

// Search is deliberately simple (LIKE over title/sku) rather than SQLite's
// full-text-search extension - a single store's print history is small
// enough that a plain index-backed LIKE is plenty fast, and it keeps this
// module dependency-free beyond better-sqlite3 itself.
function searchHistory({ q, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const query = (q || '').trim();

  if (!query) {
    return {
      rows: db.prepare(`SELECT ${HISTORY_LIST_COLUMNS} FROM printed_talkers ORDER BY printed_at DESC, id DESC LIMIT ? OFFSET ?`).all(lim, off),
      total: db.prepare('SELECT COUNT(*) AS n FROM printed_talkers').get().n,
    };
  }

  const like = `%${query}%`;
  return {
    rows: db.prepare(`
      SELECT ${HISTORY_LIST_COLUMNS} FROM printed_talkers
      WHERE title LIKE ? OR sku LIKE ?
      ORDER BY printed_at DESC, id DESC LIMIT ? OFFSET ?
    `).all(like, like, lim, off),
    total: db.prepare('SELECT COUNT(*) AS n FROM printed_talkers WHERE title LIKE ? OR sku LIKE ?').get(like, like).n,
  };
}

// Returns the full original talker object (everything readForm()/fillForm()
// needs) plus historyId/printedAt layered on top - named that way, not
// `id`/`printedAt` on the object directly, so they can't collide with a
// same-named field the stored talker itself happens to have.
function getHistoryEntry(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM printed_talkers WHERE id = ?').get(id);
  if (!row) return null;
  return { ...JSON.parse(row.data), historyId: row.id, printedAt: row.printed_at };
}

function deleteHistoryEntry(id) {
  const db = getDb();
  return db.prepare('DELETE FROM printed_talkers WHERE id = ?').run(id).changes > 0;
}

// Backs the "Server PC" dialog (Advanced menu) - a cheap sanity-check
// number rather than anything about the data's contents, so a store PC's
// staff/support can tell at a glance whether this PC actually has real
// accumulated data (a healthy, long-used PC) versus a fresh install with
// nothing in it yet.
function getStats() {
  const db = getDb();
  return {
    printedTalkers: db.prepare('SELECT COUNT(*) AS n FROM printed_talkers').get().n,
    mashBills: db.prepare('SELECT COUNT(*) AS n FROM mash_bills').get().n,
  };
}

// ================================================================
// Mash Bill Library - see the mash_bills table comment in applySchema
// above for the shape/matching rules. Every grains array round-trips
// through the same shape the Edit Talker form's own currentMashBill
// already uses ([{grain, pct}, ...] - see addMashBillGrain in app.js and
// parseMashBillEntries in card.js), just persisted here instead of only
// living on one talker.
// ================================================================

function normalizeGrains(grains) {
  if (!Array.isArray(grains)) return [];
  return grains
    .map((g) => ({ grain: g && g.grain ? String(g.grain).trim() : '', pct: Number(g && g.pct) }))
    .filter((g) => g.grain && Number.isFinite(g.pct) && g.pct > 0);
}

function rowToMashBill(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    distillery: row.distillery || '',
    grains: JSON.parse(row.grains),
    source: row.source,
    updatedAt: row.updated_at,
  };
}

function listMashBills() {
  const db = getDb();
  return db.prepare('SELECT * FROM mash_bills ORDER BY title COLLATE NOCASE ASC').all().map(rowToMashBill);
}

function getMashBill(id) {
  const db = getDb();
  return rowToMashBill(db.prepare('SELECT * FROM mash_bills WHERE id = ?').get(id));
}

function validateMashBillInput({ title, grains }) {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) throw Object.assign(new Error('A product title is required.'), { code: 'TITLE_REQUIRED' });
  const cleanGrains = normalizeGrains(grains);
  if (!cleanGrains.length) throw Object.assign(new Error('At least one grain is required.'), { code: 'GRAINS_REQUIRED' });
  return { cleanTitle, cleanGrains };
}

// Create-or-update by title (case-insensitive) - the "Save to Library"
// button on Edit Talker's Mash Bill field always calls this, so clicking it
// again after correcting a typo just updates the same entry in place
// instead of erroring or creating a duplicate. The Manage Mash Bill
// Library dialog's own "+ Add entry manually" uses it too, for the same
// reason - typing a title that already has an entry merges into it rather
// than blocking on a "already exists" error.
function upsertMashBill({
  title, distillery, grains, source,
}) {
  const db = getDb();
  const { cleanTitle, cleanGrains } = validateMashBillInput({ title, grains });
  const now = nowIso();
  const params = {
    title: cleanTitle,
    distillery: (distillery || '').trim() || null,
    grains: JSON.stringify(cleanGrains),
    source: source || 'Manual',
    updatedAt: now,
  };

  const existing = db.prepare('SELECT id FROM mash_bills WHERE title = ? COLLATE NOCASE').get(cleanTitle);
  if (existing) {
    db.prepare(`
      UPDATE mash_bills SET title = @title, distillery = @distillery, grains = @grains, source = @source, updated_at = @updatedAt
      WHERE id = @id
    `).run({ ...params, id: existing.id });
    return getMashBill(existing.id);
  }
  const info = db.prepare(`
    INSERT INTO mash_bills (title, distillery, grains, source, updated_at)
    VALUES (@title, @distillery, @grains, @source, @updatedAt)
  `).run(params);
  return getMashBill(info.lastInsertRowid);
}

// Explicit update-by-id - only the Manage Mash Bill Library dialog's "Edit"
// action uses this (it already knows the id, and may be changing the
// title itself). Unlike upsertMashBill above, renaming to a title another
// entry already owns is a real conflict here, not a merge - the unique
// index catches it and this surfaces it as DUPLICATE_TITLE rather than
// letting better-sqlite3's raw constraint error reach the caller.
function updateMashBillById(id, {
  title, distillery, grains, source,
}) {
  const db = getDb();
  const existing = getMashBill(id);
  if (!existing) return null;
  const { cleanTitle, cleanGrains } = validateMashBillInput({
    title: title !== undefined ? title : existing.title,
    grains: grains !== undefined ? grains : existing.grains,
  });

  try {
    db.prepare(`
      UPDATE mash_bills SET title = @title, distillery = @distillery, grains = @grains, source = @source, updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      title: cleanTitle,
      distillery: distillery !== undefined ? ((distillery || '').trim() || null) : existing.distillery || null,
      grains: JSON.stringify(cleanGrains),
      source: source || existing.source,
      updatedAt: nowIso(),
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw Object.assign(new Error(`Another entry already uses the title "${cleanTitle}" - edit that one instead, or delete it first.`), { code: 'DUPLICATE_TITLE' });
    }
    throw err;
  }
  return getMashBill(id);
}

function deleteMashBill(id) {
  const db = getDb();
  return db.prepare('DELETE FROM mash_bills WHERE id = ?').run(id).changes > 0;
}

module.exports = {
  getDb,
  closeDb,
  recordPrintedTalkers,
  searchHistory,
  getHistoryEntry,
  deleteHistoryEntry,
  getStats,
  listMashBills,
  getMashBill,
  upsertMashBill,
  updateMashBillById,
  deleteMashBill,
  // Exported for tests only.
  dbFilePath,
};
