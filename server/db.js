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
    --
    -- The columns below parent_company onward back the Bourbon Library read
    -- view (see renderLibraryView in app.js) - every one of them is
    -- optional, since a lot of entries will only ever have the original
    -- title/distillery/grains a talker needed. See applyMashBillColumns
    -- below for how these were added to installs that shipped before this
    -- table grew past its original 6 columns.
    CREATE TABLE IF NOT EXISTS mash_bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      distillery TEXT,
      grains TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'Manual',
      updated_at TEXT NOT NULL,
      parent_company TEXT,
      category TEXT,
      nose TEXT,
      palate TEXT,
      finish TEXT,
      tasting_source TEXT,
      confidence_tier TEXT,
      confidence_note TEXT,
      confidence_sources TEXT,
      confidence_verified_at TEXT,
      sku TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mash_bills_title_unique ON mash_bills (title COLLATE NOCASE);

    -- The Beer Bible (rail "Beer Bible" view): one researched beer per
    -- title, so a brewery/style/ABV/IBU/rating/tasting-notes lookup done
    -- once doesn't need re-doing on the next talker made for that same
    -- beer - the same idea as mash_bills above, just for Beer instead of
    -- Bourbon. One row per title (case-insensitive - the unique index
    -- below), same matching convention as mash_bills.
    --
    -- This is a bare-scaffold first cut, deliberately smaller than
    -- mash_bills: no cross-register sync yet (this PC's own data.db is
    -- always the only copy - contrast with mash_bills, whose authoritative
    -- copy lives on whichever PC is marked Server PC, see
    -- server/mashBillSync.js) and nothing on Edit Talker recalls from this
    -- table yet either (see refreshMashBillRecall in app.js for the
    -- Bourbon equivalent this doesn't have). Both are natural follow-ups
    -- once this is in real use, not ruled out by this schema. A brand-new,
    -- empty Beer Bible still gets seeded from the curated GitHub list (see
    -- server/beerBibleSeed.js's maybeAutoSeedBeerBible) - only the manual
    -- re-sync button that used to sit on top of that ("Check GitHub for New
    -- Beers") is gone, replaced by Export File Sync (see
    -- server/beerBibleExportSync.js), which fills in upc below on an
    -- already-existing entry from the same local WinePOS export Scan UPC
    -- reads, matched by this row's own sku.
    -- beer_name is Untappd's own name for the matched beer (see
    -- mergeUntappdBeer in server/productImport.js), kept separate from
    -- title on purpose: title stays whatever the store's own product
    -- export/scan/SKU lookup called it - the exact text getBeerByTitle
    -- matches a repeat lookup against, and what idx_beers_title_unique
    -- below dedupes on - so it can't just be overwritten with Untappd's own
    -- wording without breaking that matching for every future lookup of
    -- the same product. beer_name is blank for a beer Untappd never
    -- matched (a bare import stub, or a fully manual entry, where title
    -- already *is* the beer's own name) - see beerDisplayName in app.js for
    -- how the Beer Bible screen picks whichever of the two to actually show
    -- staff. upc is this beer's own manufacturer barcode, separate from sku
    -- (the store's own SKU) the same way Scan UPC's own UPC-vs-SKU
    -- distinction works everywhere else in this app (see upcCatalog.js's
    -- top-of-file note) - typed in by hand same as any other field, or
    -- filled in by Export File Sync. variety_pack marks an entry that's a
    -- mixed/variety pack rather than a single beer - Untappd has no page
    -- for a pack of several different beers, so a variety pack never has a
    -- real match to find there. Staff set this by hand (see the Beer Bible
    -- form's own Variety Pack checkbox in app.js); nothing infers it from
    -- title text. Stored as 0/1 (SQLite has no native boolean) - rowToBeer
    -- below turns it back into a real boolean.
    -- size is a free-text package descriptor ("6-Pack", "12-Pack", "Single")
    -- for the ONE row/SKU/UPC this entry actually is - the same beer sold in
    -- more than one pack size is still one row per SKU here (title/sku/upc
    -- stay row-specific; a store's raw export title and SKU are already
    -- specific to one package size, and Export File Sync/Scan UPC/SKU
    -- Lookup only ever know about the one SKU a given lookup was for). What
    -- ties multiple package-size rows of the *same* beer together into one
    -- profile page is a client-side display concept, not a schema one - see
    -- beerGroupKey/buildBeerBibleGroups in app.js, which group entries
    -- sharing the same brewery + beer_name (below).
    CREATE TABLE IF NOT EXISTS beers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      beer_name TEXT,
      brewery TEXT,
      location TEXT,
      region TEXT,
      country TEXT,
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_beers_title_unique ON beers (title COLLATE NOCASE);

    -- The Rum Repository (rail "Rum Repository" view): one researched rum
    -- per title, same idea as the beers table just above - a
    -- distillery/region/style/ABV/age-statement/tasting-notes lookup done
    -- once doesn't need re-doing on the next talker made for that same rum.
    -- One row per title (case-insensitive - the unique index below), same
    -- matching convention as beers and mash_bills.
    --
    -- Bare-scaffold, same reach as the beers table: no cross-register sync
    -- (this PC's own data.db is always the only copy), no Edit Talker
    -- recall, and no bulk import-from-export-file - beers' import feature
    -- leans on a per-row Untappd lookup that has no rum equivalent, so this
    -- only has the GitHub curated-list sync and auto-seed (see
    -- server/rumRepositorySeed.js) plus manual add/edit/delete. Both
    -- deliberately left as natural follow-ups, not ruled out by this
    -- schema, same as beers' own header comment says.
    CREATE TABLE IF NOT EXISTS rums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      distillery TEXT,
      region TEXT,
      style TEXT,
      abv TEXT,
      age_statement TEXT,
      description TEXT,
      sku TEXT,
      source TEXT NOT NULL DEFAULT 'Manual',
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rums_title_unique ON rums (title COLLATE NOCASE);

    -- The High Shelf (rail "The High Shelf" view): one researched THC/CBD
    -- ready-to-drink beverage per title, same idea as beers/rums above - a
    -- potency lookup typed in once doesn't need retyping on the next talker
    -- made for that same product. One row per title (case-insensitive - the
    -- unique index below); sku is also unique per non-blank value the same
    -- way beers' own sku column is matched (see getHighShelfEntryBySku/
    -- upsertHighShelfEntry) even though it isn't itself a unique index -
    -- application code, not the schema, resolves SKU-vs-title collisions.
    --
    -- No external lookup source exists for this category (no Untappd
    -- equivalent), so unlike beers this never gets an import-from-export or
    -- research-on-X feature - every entry is either typed by hand here or
    -- auto-saved from a THC/CBD talker (see autoSaveThcCbdToHighShelf in
    -- app.js). No cross-register sync yet either, same bare-scaffold reach
    -- as the rums table above - a natural follow-up, not ruled out by this
    -- schema.
    CREATE TABLE IF NOT EXISTS high_shelf_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      sku TEXT,
      thc_mg TEXT,
      cbd_mg TEXT,
      servings TEXT,
      is_lab_tested INTEGER NOT NULL DEFAULT 0,
      strain TEXT,
      effects TEXT,
      source TEXT NOT NULL DEFAULT 'Manual',
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_high_shelf_entries_title_unique ON high_shelf_entries (title COLLATE NOCASE);
  `);
  applyMashBillColumns(db);
  applyBeerColumns(db);
  applyRumColumns(db);
  applyHighShelfColumns(db);
}

// beers shipped without beer_name (then later upc) for several releases -
// same "ALTER TABLE whatever PRAGMA table_info says is actually missing"
// migration as applyMashBillColumns above.
function applyBeerColumns(db) {
  const existing = new Set(db.pragma('table_info(beers)').map((col) => col.name));
  if (!existing.has('beer_name')) db.exec('ALTER TABLE beers ADD COLUMN beer_name TEXT');
  if (!existing.has('upc')) db.exec('ALTER TABLE beers ADD COLUMN upc TEXT');
  if (!existing.has('variety_pack')) db.exec('ALTER TABLE beers ADD COLUMN variety_pack INTEGER NOT NULL DEFAULT 0');
  if (!existing.has('size')) db.exec('ALTER TABLE beers ADD COLUMN size TEXT');
  // region/country back the Beer Bible's geography sort/filter options (see
  // BEER_SORTS in app.js) and the landing page's "Where it's from" section
  // - split out from the single free-text `location` field (which stays
  // as-is, still shown/edited on its own) so sorting/grouping by
  // state/province or country doesn't have to re-parse that string on
  // every render.
  const addingGeoColumns = !existing.has('region') || !existing.has('country');
  if (!existing.has('region')) db.exec('ALTER TABLE beers ADD COLUMN region TEXT');
  if (!existing.has('country')) db.exec('ALTER TABLE beers ADD COLUMN country TEXT');
  // On a fresh migration both columns are blank for every row (they didn't
  // exist a moment ago), so the full-table backfillBeerGeoColumns below
  // covers it. On every other launch, backfillMissingBeerGeoColumns (see
  // its own comment) catches any row that's still sitting with both blank
  // - e.g. a beer imported before upsertBeer/updateBeerById started
  // deriving region/country from location on save (see
  // beerOptionalFieldParams). Neither ever touches a row that has a real
  // value in either field already, so a save that deliberately blanks one
  // out - country but not region, say - is never silently re-filled.
  if (addingGeoColumns) backfillBeerGeoColumns(db);
  else backfillMissingBeerGeoColumns(db);
}

// rums shipped without country for several releases - same "ALTER TABLE
// whatever PRAGMA table_info says is actually missing" migration as
// applyBeerColumns above. Unlike beers' own region/country split, there's
// no existing free-text field to backfill this from (rums' own `region` is
// a style-region string like "Caribbean", not a parseable location) - a
// rum added before this column existed just starts with a blank country,
// same as every other optional field already does.
function applyRumColumns(db) {
  const existing = new Set(db.pragma('table_info(rums)').map((col) => col.name));
  if (!existing.has('country')) db.exec('ALTER TABLE rums ADD COLUMN country TEXT');
}

// high_shelf_entries shipped without strain/effects across a couple of
// releases - same "ALTER TABLE whatever PRAGMA table_info says is actually
// missing" migration as applyRumColumns above. A row added before either
// column existed just starts with it blank, same as every other optional
// field already does.
function applyHighShelfColumns(db) {
  const existing = new Set(db.pragma('table_info(high_shelf_entries)').map((col) => col.name));
  if (!existing.has('strain')) db.exec('ALTER TABLE high_shelf_entries ADD COLUMN strain TEXT');
  if (!existing.has('effects')) db.exec('ALTER TABLE high_shelf_entries ADD COLUMN effects TEXT');
}

// Countries whose name this can recognize inside a Location tail, longest
// name first (so "united kingdom" is checked before a shorter name it might
// otherwise be shadowed by) - same precedence trick, and much the same list,
// as card.js's own COUNTRY_NAME_TO_CODE for the printed shelf talkers. Kept
// as a separate list rather than shared with the browser bundle - this file
// only runs server-side. Canonical values are Title Case and deliberately
// match what public/js/app.js's BEER_LANDING_COUNTRY_DISPLAY_NAMES/
// BEER_LANDING_COUNTRY_FLAG_SVGS expect (lowercased), so a country parsed
// out here always resolves to a real flag on the Beer Bible landing page
// instead of the plain-globe fallback.
const KNOWN_LOCATION_COUNTRIES = [
  ['united states of america', 'United States'], ['united states', 'United States'],
  ['u.s.a.', 'United States'], ['usa', 'United States'], ['us', 'United States'],
  ['united kingdom', 'United Kingdom'], ['great britain', 'United Kingdom'], ['u.k.', 'United Kingdom'], ['uk', 'United Kingdom'],
  ['northern ireland', 'United Kingdom'], ['england', 'England'], ['scotland', 'Scotland'], ['wales', 'United Kingdom'],
  ['ireland', 'Ireland'],
  ['mexico', 'Mexico'], ['canada', 'Canada'],
  ['germany', 'Germany'], ['netherlands', 'Netherlands'], ['holland', 'Netherlands'], ['belgium', 'Belgium'],
  ['france', 'France'], ['italy', 'Italy'], ['spain', 'Spain'], ['portugal', 'Portugal'],
  ['czech republic', 'Czech Republic'], ['czechia', 'Czechia'], ['poland', 'Poland'],
  ['austria', 'Austria'], ['switzerland', 'Switzerland'],
  ['denmark', 'Denmark'], ['sweden', 'Sweden'], ['norway', 'Norway'], ['finland', 'Finland'],
  ['japan', 'Japan'], ['china', 'China'], ['australia', 'Australia'], ['new zealand', 'New Zealand'],
  ['brazil', 'Brazil'], ['south africa', 'South Africa'],
].sort((a, b) => b[0].length - a[0].length);

// Word-boundary match, not plain substring search, so a short name like
// "us" doesn't fire inside an unrelated word - see card.js's own
// countryNameMatches, which this mirrors.
function matchKnownLocationCountry(lowerText) {
  return KNOWN_LOCATION_COUNTRIES.find(([name]) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`).test(lowerText);
  });
}

// Best-effort split of the existing `location` text into region (state/
// province) + country, for rows that already had a location before
// region/country existed to type into directly. Untappd's own brewery
// location strings are the main shape this is tuned for - "Morris Plains,
// NJ United States" (city, then a state/province code or name, then the
// country with no comma before it) - and "Amsterdam, Netherlands" (city,
// then just a country) for anything outside the US/Canada. The country is
// matched by name (see KNOWN_LOCATION_COUNTRIES above) rather than assumed
// to be whatever follows a short state/province code, so a spelled-out
// region like "County Dublin" (no comma, no 2-3 letter code) doesn't get
// swallowed into the country value the way "County Dublin Ireland" once
// parsed to a country of "County Dublin Ireland" instead of "Ireland".
// Genuinely ambiguous shapes (a bare "Portland" with no comma, or a country
// this doesn't recognize by name) fall back to the old code-or-bare-tail
// guess rather than being left blank - staff can always fill region/country
// in by hand afterward, same as any other optional field.
function parseLocationForGeoColumns(location) {
  const parts = (location || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { region: '', country: '' };
  const tail = parts.slice(1).join(', ');
  const match = matchKnownLocationCountry(tail.toLowerCase());
  if (match) {
    const [name, canonical] = match;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const idx = tail.toLowerCase().search(new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`));
    const prefixEnd = idx < 0 ? 0 : (tail[idx] && /[a-z]/i.test(tail[idx]) ? idx : idx + 1);
    const region = tail.slice(0, prefixEnd).replace(/,\s*$/, '').trim();
    return { region, country: canonical };
  }
  const lastPart = parts[parts.length - 1];
  const stateAndCountry = lastPart.match(/^([A-Za-z]{2,3})\s+(.+)$/);
  if (stateAndCountry) return { region: stateAndCountry[1], country: stateAndCountry[2] };
  return { region: '', country: lastPart };
}

function backfillBeerGeoColumns(db) {
  const rows = db.prepare("SELECT id, location FROM beers WHERE location IS NOT NULL AND location != ''").all();
  const update = db.prepare('UPDATE beers SET region = @region, country = @country WHERE id = @id');
  const runAll = db.transaction((entries) => {
    for (const row of entries) {
      const { region, country } = parseLocationForGeoColumns(row.location);
      if (region || country) update.run({ id: row.id, region, country });
    }
  });
  runAll(rows);
}

// Ongoing counterpart to backfillBeerGeoColumns above - runs on every
// launch (see applyBeerColumns), not just the one-time column-creation
// migration, so a beer that already existed before upsertBeer/
// updateBeerById started deriving region/country from location on save
// (see beerOptionalFieldParams) still picks it up, without anyone having to
// open and re-save every entry by hand. Only rows where BOTH region and
// country are still blank get touched - a row with a real value in either
// field is left exactly as it is, same "never overwrite an explicit value"
// rule the save path follows. Cheap to run every launch: once a row has
// been filled in (here or by any later save), it never matches this WHERE
// clause again.
function backfillMissingBeerGeoColumns(db) {
  const rows = db.prepare(`
    SELECT id, location FROM beers
    WHERE location IS NOT NULL AND location != ''
      AND (region IS NULL OR region = '')
      AND (country IS NULL OR country = '')
  `).all();
  const update = db.prepare('UPDATE beers SET region = @region, country = @country WHERE id = @id');
  const runAll = db.transaction((entries) => {
    for (const row of entries) {
      const { region, country } = parseLocationForGeoColumns(row.location);
      if (region || country) update.run({ id: row.id, region, country });
    }
  });
  runAll(rows);
}

// mash_bills shipped with just id/title/distillery/grains/source/updated_at
// for several releases (as far back as 3.3.x) - CREATE TABLE IF NOT EXISTS
// above is a no-op against an existing installs's data.db, so the ten
// Bourbon Library columns it now also lists need to be added the honest
// way, one ALTER TABLE per column actually missing. Checked via
// PRAGMA table_info rather than SQLite 3.35's ADD COLUMN IF NOT EXISTS
// syntax, since better-sqlite3's bundled SQLite version isn't pinned here -
// this works on any version. Safe (and cheap) to run on every launch: a
// fresh install's CREATE TABLE above already has every column, so the
// PRAGMA finds nothing missing and every ALTER TABLE is skipped.
function applyMashBillColumns(db) {
  const existing = new Set(db.pragma('table_info(mash_bills)').map((col) => col.name));
  const wanted = [
    'parent_company', 'category', 'nose', 'palate', 'finish', 'tasting_source',
    'confidence_tier', 'confidence_note', 'confidence_sources', 'confidence_verified_at', 'sku',
  ];
  for (const column of wanted) {
    if (!existing.has(column)) db.exec(`ALTER TABLE mash_bills ADD COLUMN ${column} TEXT`);
  }
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
    beers: db.prepare('SELECT COUNT(*) AS n FROM beers').get().n,
    rums: db.prepare('SELECT COUNT(*) AS n FROM rums').get().n,
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

// Mash Bill Confidence (see the Bourbon Library profile page in app.js) -
// how directly a saved grain composition traces back to the distillery
// itself. Deliberately not required or defaulted at write time (an entry
// with no tier at all just means nobody has assessed it yet); rowToMashBill
// below is where a missing tier becomes the literal 'unknown' tier for
// display, rather than every legacy/simple row needing one written in.
const CONFIDENCE_TIERS = new Set(['confirmed', 'reported', 'estimated', 'unknown']);

function normalizeConfidenceTier(tier) {
  const clean = (tier || '').trim().toLowerCase();
  return CONFIDENCE_TIERS.has(clean) ? clean : null;
}

// Same JSON-column pattern as grains above - a small ordered list of
// {label, url, tags} citations, shown as the profile page's unified
// "References & Sources" section. `tags` says which part(s) of the entry a
// source backs (Mash Bill, Tasting Notes, Distillery & Ownership, Other),
// so the profile page can drop a numbered marker next to just the
// section(s) it supports. Still stored in the confidence_sources column -
// that name predates this section covering more than the mash bill, but
// renaming the column would mean a migration for no behavior change.
const REFERENCE_TAGS = new Set(['Mash Bill', 'Tasting Notes', 'Distillery & Ownership', 'Other']);

function normalizeReferences(refs) {
  if (!Array.isArray(refs)) return [];
  return refs
    .map((r) => ({
      label: r && r.label ? String(r.label).trim() : '',
      url: r && r.url ? String(r.url).trim() : '',
      tags: Array.isArray(r && r.tags) ? r.tags.map((t) => String(t).trim()).filter((t) => REFERENCE_TAGS.has(t)) : [],
    }))
    .filter((r) => r.label || r.url);
}

function normalizeOptionalText(value) {
  const clean = (value || '').toString().trim();
  return clean || null;
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
    parentCompany: row.parent_company || '',
    category: row.category || '',
    sku: row.sku || '',
    nose: row.nose || '',
    palate: row.palate || '',
    finish: row.finish || '',
    tastingSource: row.tasting_source || '',
    confidence: {
      tier: row.confidence_tier || 'unknown',
      note: row.confidence_note || '',
      verifiedAt: row.confidence_verified_at || '',
    },
    references: row.confidence_sources ? JSON.parse(row.confidence_sources) : [],
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

// Shared by upsertMashBill/updateMashBillById below: every Bourbon Library
// field beyond the original title/distillery/grains/source is optional, and
// omitting one (undefined, as opposed to explicitly clearing it with '')
// means "leave whatever's already there alone" - the same convention
// updateMashBillById's own distillery handling already used before this
// helper existed. `existing` is a rowToMashBill()-shaped object or null.
function mashBillOptionalFieldParams({
  parentCompany, category, sku, nose, palate, finish, tastingSource, confidence, references,
}, existing) {
  const prev = existing || {
    parentCompany: '', category: '', sku: '', nose: '', palate: '', finish: '', tastingSource: '',
    confidence: { tier: '', note: '', verifiedAt: '' }, references: [],
  };
  const conf = confidence !== undefined ? (confidence || {}) : prev.confidence;
  return {
    parentCompany: normalizeOptionalText(parentCompany !== undefined ? parentCompany : prev.parentCompany),
    category: normalizeOptionalText(category !== undefined ? category : prev.category),
    sku: normalizeOptionalText(sku !== undefined ? sku : prev.sku),
    nose: normalizeOptionalText(nose !== undefined ? nose : prev.nose),
    palate: normalizeOptionalText(palate !== undefined ? palate : prev.palate),
    finish: normalizeOptionalText(finish !== undefined ? finish : prev.finish),
    tastingSource: normalizeOptionalText(tastingSource !== undefined ? tastingSource : prev.tastingSource),
    confidenceTier: normalizeConfidenceTier(conf.tier),
    confidenceNote: normalizeOptionalText(conf.note),
    confidenceVerifiedAt: normalizeOptionalText(conf.verifiedAt),
    confidenceSources: JSON.stringify(normalizeReferences(references !== undefined ? references : prev.references)),
  };
}

const MASH_BILL_OPTIONAL_COLUMNS_SET = `
  parent_company = @parentCompany, category = @category, sku = @sku, nose = @nose, palate = @palate, finish = @finish,
  tasting_source = @tastingSource, confidence_tier = @confidenceTier, confidence_note = @confidenceNote,
  confidence_sources = @confidenceSources, confidence_verified_at = @confidenceVerifiedAt
`;

// Create-or-update by title (case-insensitive) - the "Save to Library"
// button on Edit Talker's Mash Bill field always calls this, so clicking it
// again after correcting a typo just updates the same entry in place
// instead of erroring or creating a duplicate. The Manage Mash Bill
// Library dialog's own "+ Add entry manually" uses it too, for the same
// reason - typing a title that already has an entry merges into it rather
// than blocking on a "already exists" error.
function upsertMashBill({
  title, distillery, grains, source,
  parentCompany, category, sku, nose, palate, finish, tastingSource, confidence, references,
}) {
  const db = getDb();
  const { cleanTitle, cleanGrains } = validateMashBillInput({ title, grains });
  const now = nowIso();
  const existingRow = db.prepare('SELECT id FROM mash_bills WHERE title = ? COLLATE NOCASE').get(cleanTitle);
  const existing = existingRow ? getMashBill(existingRow.id) : null;
  const params = {
    title: cleanTitle,
    distillery: (distillery || '').trim() || null,
    grains: JSON.stringify(cleanGrains),
    source: source || 'Manual',
    updatedAt: now,
    ...mashBillOptionalFieldParams({
      parentCompany, category, sku, nose, palate, finish, tastingSource, confidence, references,
    }, existing),
  };

  if (existing) {
    db.prepare(`
      UPDATE mash_bills SET title = @title, distillery = @distillery, grains = @grains, source = @source, updated_at = @updatedAt,
      ${MASH_BILL_OPTIONAL_COLUMNS_SET}
      WHERE id = @id
    `).run({ ...params, id: existing.id });
    return getMashBill(existing.id);
  }
  const info = db.prepare(`
    INSERT INTO mash_bills (
      title, distillery, grains, source, updated_at,
      parent_company, category, sku, nose, palate, finish, tasting_source,
      confidence_tier, confidence_note, confidence_sources, confidence_verified_at
    )
    VALUES (
      @title, @distillery, @grains, @source, @updatedAt,
      @parentCompany, @category, @sku, @nose, @palate, @finish, @tastingSource,
      @confidenceTier, @confidenceNote, @confidenceSources, @confidenceVerifiedAt
    )
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
  parentCompany, category, sku, nose, palate, finish, tastingSource, confidence, references,
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
      UPDATE mash_bills SET title = @title, distillery = @distillery, grains = @grains, source = @source, updated_at = @updatedAt,
      ${MASH_BILL_OPTIONAL_COLUMNS_SET}
      WHERE id = @id
    `).run({
      id,
      title: cleanTitle,
      distillery: distillery !== undefined ? ((distillery || '').trim() || null) : existing.distillery || null,
      grains: JSON.stringify(cleanGrains),
      source: source || existing.source,
      updatedAt: nowIso(),
      ...mashBillOptionalFieldParams({
        parentCompany, category, sku, nose, palate, finish, tastingSource, confidence, references,
      }, existing),
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

// ================================================================
// The Beer Bible - see the beers table comment in applySchema above for
// the shape/matching rules and how this deliberately differs from the
// Bourbon Library's own mash_bills table (no cross-register sync, no Edit
// Talker recall integration - both scaffolded to add later, not designed
// against). No grains/confidence/references here - just the fields Beer
// already pulls from Untappd (brewery, location, style, ABV, IBU, rating)
// plus a free-text tasting-notes field, so the "leave blank if you don't
// know it yet" rule the Bourbon Library form uses applies just as well
// here.
// ================================================================

function rowToBeer(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    beerName: row.beer_name || '',
    brewery: row.brewery || '',
    location: row.location || '',
    region: row.region || '',
    country: row.country || '',
    style: row.style || '',
    size: row.size || '',
    abv: row.abv || '',
    ibu: row.ibu || '',
    untappdRating: row.untappd_rating || '',
    untappdRatingCount: row.untappd_rating_count || '',
    description: row.description || '',
    sku: row.sku || '',
    upc: row.upc || '',
    varietyPack: !!row.variety_pack,
    source: row.source,
    updatedAt: row.updated_at,
  };
}

function listBeers() {
  const db = getDb();
  return db.prepare('SELECT * FROM beers ORDER BY title COLLATE NOCASE ASC').all().map(rowToBeer);
}

function getBeer(id) {
  const db = getDb();
  return rowToBeer(db.prepare('SELECT * FROM beers WHERE id = ?').get(id));
}

// Looks a beer up by title, case-insensitively - the same "one row per
// title" matching rule upsertBeer's own uniqueness check already uses (see
// idx_beers_title_unique in applySchema above), just exposed as a plain
// lookup rather than an upsert. Backs the Untappd-miss fallback in
// index.js's beer lookup routes: when a live Untappd search comes back
// empty, this is how an already-researched Beer Bible entry for the same
// beer - however it got there (a past successful Untappd match, a Beer
// Bible Import run, or a manual entry) - gets reused instead of leaving
// those fields blank. Returns null for a blank title rather than the first
// row COLLATE NOCASE might otherwise match nothing against.
function getBeerByTitle(title) {
  const db = getDb();
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) return null;
  return rowToBeer(db.prepare('SELECT * FROM beers WHERE title = ? COLLATE NOCASE').get(cleanTitle));
}

// Same idea as getBeerByTitle just above, keyed on the store's own SKU
// instead - trimmed, case-insensitive. This is what upsertBeer checks
// first (see below) so a repeat save under a different title still finds
// its way back to the same row. Returns null for a blank SKU rather than
// matching every other blank-SKU row in the table.
function getBeerBySku(sku) {
  const db = getDb();
  const cleanSku = (sku || '').toString().trim();
  if (!cleanSku) return null;
  return rowToBeer(db.prepare('SELECT * FROM beers WHERE sku = ? COLLATE NOCASE').get(cleanSku));
}

function validateBeerInput({ title }) {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) throw Object.assign(new Error('A beer name is required.'), { code: 'TITLE_REQUIRED' });
  return { cleanTitle };
}

// Same "undefined leaves whatever's already there alone" convention as
// mashBillOptionalFieldParams above - every field here beyond title/source
// is optional, and `existing` is a rowToBeer()-shaped object or null.
function beerOptionalFieldParams({
  beerName, brewery, location, region, country, style, size, abv, ibu, untappdRating, untappdRatingCount, description, sku, upc, varietyPack,
}, existing) {
  const prev = existing || {
    beerName: '', brewery: '', location: '', region: '', country: '', style: '', size: '', abv: '', ibu: '', untappdRating: '', untappdRatingCount: '', description: '', sku: '', upc: '', varietyPack: false,
  };
  const resolvedLocation = normalizeOptionalText(location !== undefined ? location : prev.location);
  let resolvedRegion = normalizeOptionalText(region !== undefined ? region : prev.region);
  let resolvedCountry = normalizeOptionalText(country !== undefined ? country : prev.country);
  // A beer saved with only a `location` string (the shape Untappd imports
  // arrive in - see productImport.js's fillBeerLocation) never had its own
  // Region/Country split out the way backfillBeerGeoColumns does for older
  // rows at migration time - that one-time pass never re-runs for beers
  // added afterward, so every subsequent import landed with a country-less
  // entry unless staff typed one in by hand. Deriving it here, on every
  // save, means the "Where it's from" breakdown actually reflects what's on
  // file instead of only whatever a person got around to typing. Only fires
  // when both are still blank - an explicit Region and/or Country already
  // on file (typed by hand, or a prior derive) is never overwritten by a
  // fresh guess off the location string.
  if (!resolvedRegion && !resolvedCountry && resolvedLocation) {
    const derived = parseLocationForGeoColumns(resolvedLocation);
    resolvedRegion = derived.region;
    resolvedCountry = derived.country;
  }
  return {
    beerName: normalizeOptionalText(beerName !== undefined ? beerName : prev.beerName),
    brewery: normalizeOptionalText(brewery !== undefined ? brewery : prev.brewery),
    location: resolvedLocation,
    region: resolvedRegion,
    country: resolvedCountry,
    style: normalizeOptionalText(style !== undefined ? style : prev.style),
    size: normalizeOptionalText(size !== undefined ? size : prev.size),
    abv: normalizeOptionalText(abv !== undefined ? abv : prev.abv),
    ibu: normalizeOptionalText(ibu !== undefined ? ibu : prev.ibu),
    untappdRating: normalizeOptionalText(untappdRating !== undefined ? untappdRating : prev.untappdRating),
    untappdRatingCount: normalizeOptionalText(untappdRatingCount !== undefined ? untappdRatingCount : prev.untappdRatingCount),
    description: normalizeOptionalText(description !== undefined ? description : prev.description),
    sku: normalizeOptionalText(sku !== undefined ? sku : prev.sku),
    upc: normalizeOptionalText(upc !== undefined ? upc : prev.upc),
    // Unlike every other field above, `false` is a real, meaningful value
    // here (not "leave it alone") - so this checks undefined specifically,
    // not falsiness, the same distinction upsertMashBill's confidence
    // handling makes for its own tier field.
    varietyPack: (varietyPack !== undefined ? !!varietyPack : !!prev.varietyPack) ? 1 : 0,
  };
}

const BEER_OPTIONAL_COLUMNS_SET = `
  beer_name = @beerName, brewery = @brewery, location = @location, region = @region, country = @country, style = @style, size = @size, abv = @abv, ibu = @ibu,
  untappd_rating = @untappdRating, untappd_rating_count = @untappdRatingCount,
  description = @description, sku = @sku, upc = @upc, variety_pack = @varietyPack
`;

// Create-or-update by SKU first, title (case-insensitive) second - see the
// SKU/title matching comment inside this function for why. Same reasoning
// as upsertMashBill above: the Beer Bible form's Add/Save button, every
// talker's own auto-save, and the Beer Bible Import job all call this, so
// saving again for a beer already on file updates that same entry instead
// of erroring or duplicating it.
function upsertBeer({
  title, source, beerName, brewery, location, region, country, style, size, abv, ibu, untappdRating, untappdRatingCount, description, sku, upc, varietyPack,
}) {
  const db = getDb();
  const { cleanTitle } = validateBeerInput({ title });
  const now = nowIso();

  // SKU first, title second. Title alone used to be the only way this
  // found a "same beer" match, but the same physical product can show up
  // under more than one title over its life - a raw POS export's literal
  // text, whatever wording an Untappd search happened to match on that
  // day, a staff typo fix - while the store's own SKU on the shelf tag
  // doesn't change. Matching SKU first is what makes a second save for the
  // same SKU land on the existing row instead of adding a duplicate every
  // time the title comes out a little different. Title stays as the
  // fallback for saves with nothing to key off of (Manual Entry with no
  // SKU, or a row saved before this PC had SKUs on file at all).
  const bySku = getBeerBySku(sku);
  let existing = bySku;
  if (!existing) {
    const existingRow = db.prepare('SELECT id FROM beers WHERE title = ? COLLATE NOCASE').get(cleanTitle);
    existing = existingRow ? getBeer(existingRow.id) : null;
  }

  // A SKU match under a different title never renames the existing row -
  // same "don't clobber an already-established name" rule
  // syncNewBeerBibleEntries already uses for its own same-SKU merges (see
  // server/beerBibleSeed.js). Only an actual title match (this save's
  // title, not just its SKU, matches the existing row) updates the title
  // text itself - e.g. to fix casing on a repeat save.
  const resolvedTitle = bySku ? bySku.title : cleanTitle;

  const params = {
    title: resolvedTitle,
    source: source || 'Manual',
    updatedAt: now,
    ...beerOptionalFieldParams({
      beerName, brewery, location, region, country, style, size, abv, ibu, untappdRating, untappdRatingCount, description, sku, upc, varietyPack,
    }, existing),
  };

  if (existing) {
    db.prepare(`
      UPDATE beers SET title = @title, source = @source, updated_at = @updatedAt,
      ${BEER_OPTIONAL_COLUMNS_SET}
      WHERE id = @id
    `).run({ ...params, id: existing.id });
    return getBeer(existing.id);
  }
  const info = db.prepare(`
    INSERT INTO beers (
      title, source, updated_at, beer_name, brewery, location, region, country, style, size, abv, ibu, untappd_rating, untappd_rating_count, description, sku, upc, variety_pack
    )
    VALUES (
      @title, @source, @updatedAt, @beerName, @brewery, @location, @region, @country, @style, @size, @abv, @ibu, @untappdRating, @untappdRatingCount, @description, @sku, @upc, @varietyPack
    )
  `).run(params);
  return getBeer(info.lastInsertRowid);
}

// Explicit update-by-id - only the Beer Bible form's "Edit" flow uses this
// (it already knows the id, and may be changing the title itself). Unlike
// upsertBeer above, renaming onto a title another entry already owns is a
// real conflict here, not a merge - same DUPLICATE_TITLE handling as
// updateMashBillById.
function updateBeerById(id, {
  title, source, beerName, brewery, location, region, country, style, size, abv, ibu, untappdRating, untappdRatingCount, description, sku, upc, varietyPack,
}) {
  const db = getDb();
  const existing = getBeer(id);
  if (!existing) return null;
  const { cleanTitle } = validateBeerInput({ title: title !== undefined ? title : existing.title });

  try {
    db.prepare(`
      UPDATE beers SET title = @title, source = @source, updated_at = @updatedAt,
      ${BEER_OPTIONAL_COLUMNS_SET}
      WHERE id = @id
    `).run({
      id,
      title: cleanTitle,
      source: source || existing.source,
      updatedAt: nowIso(),
      ...beerOptionalFieldParams({
        beerName, brewery, location, region, country, style, size, abv, ibu, untappdRating, untappdRatingCount, description, sku, upc, varietyPack,
      }, existing),
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw Object.assign(new Error(`Another entry already uses the name "${cleanTitle}" - edit that one instead, or delete it first.`), { code: 'DUPLICATE_TITLE' });
    }
    throw err;
  }
  return getBeer(id);
}

function deleteBeer(id) {
  const db = getDb();
  return db.prepare('DELETE FROM beers WHERE id = ?').run(id).changes > 0;
}

// ================================================================
// The Rum Repository - see the rums table comment in applySchema above for
// the shape/matching rules and how this deliberately differs from the
// Bourbon Library's own mash_bills table (no cross-register sync, no Edit
// Talker recall integration, no bulk import) - same reach as the Beer
// Bible's beers table just above, just Distillery/Region/Style/ABV/Age
// Statement instead of Brewery/Location/Style/ABV/IBU/Rating.
// ================================================================

function rowToRum(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    distillery: row.distillery || '',
    region: row.region || '',
    style: row.style || '',
    abv: row.abv || '',
    ageStatement: row.age_statement || '',
    description: row.description || '',
    sku: row.sku || '',
    country: row.country || '',
    source: row.source,
    updatedAt: row.updated_at,
  };
}

function listRums() {
  const db = getDb();
  return db.prepare('SELECT * FROM rums ORDER BY title COLLATE NOCASE ASC').all().map(rowToRum);
}

function getRum(id) {
  const db = getDb();
  return rowToRum(db.prepare('SELECT * FROM rums WHERE id = ?').get(id));
}

function validateRumInput({ title }) {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) throw Object.assign(new Error('A rum name is required.'), { code: 'TITLE_REQUIRED' });
  return { cleanTitle };
}

// Same "undefined leaves whatever's already there alone" convention as
// beerOptionalFieldParams above - every field here beyond title/source is
// optional, and `existing` is a rowToRum()-shaped object or null.
function rumOptionalFieldParams({
  distillery, region, style, abv, ageStatement, description, sku, country,
}, existing) {
  const prev = existing || {
    distillery: '', region: '', style: '', abv: '', ageStatement: '', description: '', sku: '', country: '',
  };
  return {
    distillery: normalizeOptionalText(distillery !== undefined ? distillery : prev.distillery),
    region: normalizeOptionalText(region !== undefined ? region : prev.region),
    style: normalizeOptionalText(style !== undefined ? style : prev.style),
    abv: normalizeOptionalText(abv !== undefined ? abv : prev.abv),
    ageStatement: normalizeOptionalText(ageStatement !== undefined ? ageStatement : prev.ageStatement),
    description: normalizeOptionalText(description !== undefined ? description : prev.description),
    sku: normalizeOptionalText(sku !== undefined ? sku : prev.sku),
    country: normalizeOptionalText(country !== undefined ? country : prev.country),
  };
}

const RUM_OPTIONAL_COLUMNS_SET = `
  distillery = @distillery, region = @region, style = @style, abv = @abv,
  age_statement = @ageStatement, description = @description, sku = @sku, country = @country
`;

// Create-or-update by title (case-insensitive), same reasoning as
// upsertBeer above: the Rum Repository form's Add/Save button always calls
// this, so saving again after a typo fix updates the same entry instead of
// erroring or duplicating it.
function upsertRum({
  title, source, distillery, region, style, abv, ageStatement, description, sku, country,
}) {
  const db = getDb();
  const { cleanTitle } = validateRumInput({ title });
  const now = nowIso();
  const existingRow = db.prepare('SELECT id FROM rums WHERE title = ? COLLATE NOCASE').get(cleanTitle);
  const existing = existingRow ? getRum(existingRow.id) : null;
  const params = {
    title: cleanTitle,
    source: source || 'Manual',
    updatedAt: now,
    ...rumOptionalFieldParams({
      distillery, region, style, abv, ageStatement, description, sku, country,
    }, existing),
  };

  if (existing) {
    db.prepare(`
      UPDATE rums SET title = @title, source = @source, updated_at = @updatedAt,
      ${RUM_OPTIONAL_COLUMNS_SET}
      WHERE id = @id
    `).run({ ...params, id: existing.id });
    return getRum(existing.id);
  }
  const info = db.prepare(`
    INSERT INTO rums (
      title, source, updated_at, distillery, region, style, abv, age_statement, description, sku, country
    )
    VALUES (
      @title, @source, @updatedAt, @distillery, @region, @style, @abv, @ageStatement, @description, @sku, @country
    )
  `).run(params);
  return getRum(info.lastInsertRowid);
}

// Explicit update-by-id - only the Rum Repository form's "Edit" flow uses
// this (it already knows the id, and may be changing the title itself).
// Unlike upsertRum above, renaming onto a title another entry already owns
// is a real conflict here, not a merge - same DUPLICATE_TITLE handling as
// updateBeerById.
function updateRumById(id, {
  title, source, distillery, region, style, abv, ageStatement, description, sku, country,
}) {
  const db = getDb();
  const existing = getRum(id);
  if (!existing) return null;
  const { cleanTitle } = validateRumInput({ title: title !== undefined ? title : existing.title });

  try {
    db.prepare(`
      UPDATE rums SET title = @title, source = @source, updated_at = @updatedAt,
      ${RUM_OPTIONAL_COLUMNS_SET}
      WHERE id = @id
    `).run({
      id,
      title: cleanTitle,
      source: source || existing.source,
      updatedAt: nowIso(),
      ...rumOptionalFieldParams({
        distillery, region, style, abv, ageStatement, description, sku, country,
      }, existing),
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw Object.assign(new Error(`Another entry already uses the name "${cleanTitle}" - edit that one instead, or delete it first.`), { code: 'DUPLICATE_TITLE' });
    }
    throw err;
  }
  return getRum(id);
}

function deleteRum(id) {
  const db = getDb();
  return db.prepare('DELETE FROM rums WHERE id = ?').run(id).changes > 0;
}

function rowToHighShelfEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    sku: row.sku || '',
    thcMg: row.thc_mg || '',
    cbdMg: row.cbd_mg || '',
    servings: row.servings || '',
    isLabTested: !!row.is_lab_tested,
    strain: row.strain || '',
    effects: row.effects || '',
    source: row.source,
    updatedAt: row.updated_at,
  };
}

function listHighShelfEntries() {
  const db = getDb();
  return db.prepare('SELECT * FROM high_shelf_entries ORDER BY title COLLATE NOCASE ASC').all().map(rowToHighShelfEntry);
}

function getHighShelfEntry(id) {
  const db = getDb();
  return rowToHighShelfEntry(db.prepare('SELECT * FROM high_shelf_entries WHERE id = ?').get(id));
}

// Same idea as getBeerByTitle/getBeerBySku above - exposed as plain lookups
// (case-insensitive, trimmed, null on blank input) rather than an upsert,
// for the Edit Talker recall banner's own exact-title match.
function getHighShelfEntryByTitle(title) {
  const db = getDb();
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) return null;
  return rowToHighShelfEntry(db.prepare('SELECT * FROM high_shelf_entries WHERE title = ? COLLATE NOCASE').get(cleanTitle));
}

function getHighShelfEntryBySku(sku) {
  const db = getDb();
  const cleanSku = (sku || '').toString().trim();
  if (!cleanSku) return null;
  return rowToHighShelfEntry(db.prepare('SELECT * FROM high_shelf_entries WHERE sku = ? COLLATE NOCASE').get(cleanSku));
}

function validateHighShelfInput({ title }) {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) throw Object.assign(new Error('A product name is required.'), { code: 'TITLE_REQUIRED' });
  return { cleanTitle };
}

// Same "undefined leaves whatever's already there alone" convention as
// beerOptionalFieldParams/rumOptionalFieldParams above - isLabTested is the
// one exception, same as beer's own varietyPack: `false` is a real,
// meaningful value there, so it checks undefined specifically, not
// falsiness.
function highShelfOptionalFieldParams({
  sku, thcMg, cbdMg, servings, isLabTested, strain, effects,
}, existing) {
  const prev = existing || {
    sku: '', thcMg: '', cbdMg: '', servings: '', isLabTested: false, strain: '', effects: '',
  };
  return {
    sku: normalizeOptionalText(sku !== undefined ? sku : prev.sku),
    thcMg: normalizeOptionalText(thcMg !== undefined ? thcMg : prev.thcMg),
    cbdMg: normalizeOptionalText(cbdMg !== undefined ? cbdMg : prev.cbdMg),
    servings: normalizeOptionalText(servings !== undefined ? servings : prev.servings),
    isLabTested: (isLabTested !== undefined ? !!isLabTested : !!prev.isLabTested) ? 1 : 0,
    strain: normalizeOptionalText(strain !== undefined ? strain : prev.strain),
    effects: normalizeOptionalText(effects !== undefined ? effects : prev.effects),
  };
}

const HIGH_SHELF_OPTIONAL_COLUMNS_SET = `
  sku = @sku, thc_mg = @thcMg, cbd_mg = @cbdMg, servings = @servings, is_lab_tested = @isLabTested, strain = @strain, effects = @effects
`;

// Create-or-update by SKU first, title (case-insensitive) second - same
// reasoning and shape as upsertBeer above: a THC/CBD talker's own auto-save
// (see autoSaveThcCbdToHighShelf in app.js) and The High Shelf form's own
// Add/Save button both call this, so saving again for a product already on
// file updates that same entry instead of duplicating it.
function upsertHighShelfEntry({
  title, source, sku, thcMg, cbdMg, servings, isLabTested, strain, effects,
}) {
  const db = getDb();
  const { cleanTitle } = validateHighShelfInput({ title });
  const now = nowIso();

  const bySku = getHighShelfEntryBySku(sku);
  let existing = bySku;
  if (!existing) {
    const existingRow = db.prepare('SELECT id FROM high_shelf_entries WHERE title = ? COLLATE NOCASE').get(cleanTitle);
    existing = existingRow ? getHighShelfEntry(existingRow.id) : null;
  }

  // A SKU match under a different title never renames the existing row -
  // same "don't clobber an already-established name" rule upsertBeer uses.
  const resolvedTitle = bySku ? bySku.title : cleanTitle;

  const params = {
    title: resolvedTitle,
    source: source || 'Manual',
    updatedAt: now,
    ...highShelfOptionalFieldParams({
      sku, thcMg, cbdMg, servings, isLabTested, strain, effects,
    }, existing),
  };

  if (existing) {
    db.prepare(`
      UPDATE high_shelf_entries SET title = @title, source = @source, updated_at = @updatedAt,
      ${HIGH_SHELF_OPTIONAL_COLUMNS_SET}
      WHERE id = @id
    `).run({ ...params, id: existing.id });
    return getHighShelfEntry(existing.id);
  }
  const info = db.prepare(`
    INSERT INTO high_shelf_entries (
      title, source, updated_at, sku, thc_mg, cbd_mg, servings, is_lab_tested, strain, effects
    )
    VALUES (
      @title, @source, @updatedAt, @sku, @thcMg, @cbdMg, @servings, @isLabTested, @strain, @effects
    )
  `).run(params);
  return getHighShelfEntry(info.lastInsertRowid);
}

// Explicit update-by-id - only The High Shelf form's "Edit" flow uses this
// (it already knows the id, and may be changing the title itself). Unlike
// upsertHighShelfEntry above, renaming onto a title another entry already
// owns is a real conflict here, not a merge - same DUPLICATE_TITLE handling
// as updateBeerById/updateRumById.
function updateHighShelfEntryById(id, {
  title, source, sku, thcMg, cbdMg, servings, isLabTested, strain, effects,
}) {
  const db = getDb();
  const existing = getHighShelfEntry(id);
  if (!existing) return null;
  const { cleanTitle } = validateHighShelfInput({ title: title !== undefined ? title : existing.title });

  try {
    db.prepare(`
      UPDATE high_shelf_entries SET title = @title, source = @source, updated_at = @updatedAt,
      ${HIGH_SHELF_OPTIONAL_COLUMNS_SET}
      WHERE id = @id
    `).run({
      id,
      title: cleanTitle,
      source: source || existing.source,
      updatedAt: nowIso(),
      ...highShelfOptionalFieldParams({
        sku, thcMg, cbdMg, servings, isLabTested, strain, effects,
      }, existing),
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw Object.assign(new Error(`Another entry already uses the name "${cleanTitle}" - edit that one instead, or delete it first.`), { code: 'DUPLICATE_TITLE' });
    }
    throw err;
  }
  return getHighShelfEntry(id);
}

function deleteHighShelfEntry(id) {
  const db = getDb();
  return db.prepare('DELETE FROM high_shelf_entries WHERE id = ?').run(id).changes > 0;
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
  listBeers,
  getBeer,
  getBeerByTitle,
  getBeerBySku,
  upsertBeer,
  updateBeerById,
  deleteBeer,
  listRums,
  getRum,
  upsertRum,
  updateRumById,
  deleteRum,
  listHighShelfEntries,
  getHighShelfEntry,
  getHighShelfEntryByTitle,
  getHighShelfEntryBySku,
  upsertHighShelfEntry,
  updateHighShelfEntryById,
  deleteHighShelfEntry,
  // Exported for tests only.
  dbFilePath,
};
