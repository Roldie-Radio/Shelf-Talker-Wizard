// Backs the "Scan UPC" tab: instead of talking to a network API, this reads
// a product export file that the store's WinePOS system writes to disk on
// the same PC (the kind of feed WinePOS's own "electronic shelf tag"
// integrations consume) and looks products up by the manufacturer UPC
// printed on the bottle - a different number from the store's own SKU that
// /api/sku-lookup already searches liquoroutletwinecellars.com for (see the
// og:upc-is-actually-SKU note in productImport.js). Nothing here makes a
// network request; it only ever reads a local file path staff configure
// once in the Scan UPC tab's Settings box (or, for a PC with auto-sync
// turned on, a local copy this app itself keeps up to date - see
// "auto-sync" below and exportSync.js).
//
// The exact column layout of that export isn't something this project
// controls (it depends on how the store's WinePOS export is set up), so
// parsing leans on two things unlikely to break: plain CSV/TSV structure,
// and matching column headers by a list of likely names (see FIELD_ALIASES)
// rather than an exact expected header row. If a required column can't be
// found, the error names the headers that *were* found so staff (or WinePOS
// support) know what to rename or add to the export template.

const fs = require('fs');
const path = require('path');
const { getAppDataDir } = require('./appData');

// ================================================================
// Config - where the export file lives is a one-time, per-PC setting (the
// Scan UPC tab's Settings box), so it's persisted to a small JSON file
// rather than asked for on every lookup, in the same per-PC directory
// db.js's SQLite file lives in (see appData.js).
//
// `autoSync` is the register-side half of exportSync.js: when on, this PC
// ignores its own manually-configured `exportPath` for actual lookups and
// instead reads whatever exportSync.js's puller most recently fetched from
// the Server PC (see effectiveExportPath/syncedExportFilePath below) - the
// manual `exportPath` is left alone in storage rather than overwritten, so
// switching auto-sync back off restores it instead of leaving the field
// blank.
// ================================================================

function configFilePath() {
  return path.join(getAppDataDir(), 'config.json');
}

function readConfig() {
  try {
    const raw = fs.readFileSync(configFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      exportPath: typeof parsed.exportPath === 'string' ? parsed.exportPath : '',
      autoSync: !!parsed.autoSync,
    };
  } catch {
    // No config file yet, or it's unreadable/corrupt - either way, treat it
    // the same as "nothing configured" rather than failing settings lookups.
    return { exportPath: '', autoSync: false };
  }
}

function writeConfig(config) {
  fs.mkdirSync(getAppDataDir(), { recursive: true });
  fs.writeFileSync(configFilePath(), JSON.stringify({
    exportPath: config.exportPath || '',
    autoSync: !!config.autoSync,
  }, null, 2), 'utf-8');
}

// The local file exportSync.js's puller (register side) writes each
// successful sync to, and that effectiveExportPath() below points lookups
// at whenever auto-sync is on. Lives in the same per-PC app data directory
// as config.json/data.db (see appData.js) rather than somewhere a staff
// member might stumble into and mistake for the real WinePOS export.
function syncedExportFilePath() {
  return path.join(getAppDataDir(), 'synced-export.csv');
}

// What lookups (and the export preview) actually read: the manually
// configured path, unless auto-sync is on, in which case it's always the
// locally-synced copy regardless of what the manual path field still says.
function effectiveExportPath() {
  const { exportPath, autoSync } = readConfig();
  return autoSync ? syncedExportFilePath() : exportPath;
}

function isAutoSyncEnabled() {
  return readConfig().autoSync;
}

function setAutoSync(autoSync) {
  const { exportPath } = readConfig();
  writeConfig({ exportPath, autoSync: !!autoSync });
  invalidateCache();
  return getUpcSettings();
}

// ================================================================
// CSV/TSV parsing - a small RFC4180-ish parser (quoted fields, embedded
// commas/quotes/newlines) rather than a dependency, since the format is
// simple and this is the only place in the app that needs it. Delimiter is
// auto-detected per file: some POS exports use tabs instead of commas,
// especially for a "plain text for label printers" style feed.
// ================================================================

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return tabCount > commaCount ? '\t' : ',';
}

function parseDelimited(rawText) {
  // Strip a leading UTF-8 byte-order-mark up front, not just when matching
  // headers below - confirmed on a real WinePOS export (common from
  // Excel/some POS export tools). Otherwise it survives as a real U+FEFF
  // character stuck to the very first header, which normalizeHeader's own
  // stripping keeps out of column *matching*, but would still show up
  // as an invisible stray character anywhere the raw header itself is
  // displayed (error messages, the export preview table).
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      pushField();
    } else if (c === '\r') {
      // Ignore - the \n right after it (or standalone \r on very old files)
      // is what actually ends the row, handled below.
    } else if (c === '\n') {
      pushRow();
    } else {
      field += c;
    }
  }
  // Last line often has no trailing newline - flush whatever's pending.
  if (field.length || row.length) pushRow();

  // Drop fully blank lines (a trailing blank line is common in exports).
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

// ================================================================
// Column matching - header names are matched case-insensitively against a
// list of likely aliases per field, so the export doesn't need to use one
// exact set of column names.
// ================================================================

function normalizeHeader(h) {
  return String(h || '')
    // A leading UTF-8 byte-order-mark (common on files saved by Excel/some
    // POS export tools, confirmed on a real WinePOS export) survives
    // fs.readFileSync's utf-8 decoding as a real U+FEFF character on the
    // very first header - \s already matches it, so matching itself isn't
    // affected, but leaving it in would show up as an invisible stray
    // character in error messages and the export preview.
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FIELD_ALIASES = {
  // 'upc data' confirmed against a real WinePOS inventory export - its UPC
  // column is literally named that, not just "UPC".
  upc: ['upc', 'upc code', 'upc a', 'upc data', 'barcode', 'bar code', 'scancode', 'scan code', 'ean', 'ean13', 'ean 13'],
  title: ['title', 'description', 'item description', 'product', 'product name', 'product title', 'item name', 'name'],
  // Deliberately no 'vendor' alias here - confirmed against a real WinePOS
  // export (wine-pos-inventory-demo.csv) whose only vendor-ish column is
  // literally named "Vendor" and holds a short internal distributor code
  // ("ABD", "KOH"), not the producer's own name. Matching that column here
  // used to feed the code straight into searchByName/lookupUpc's `brand`
  // field, which composeProducerTitle (productImport.js) then prepends onto
  // the title ("ABD 14 Hands Cabernet") and, for beer, sends to Untappd as
  // part of the search query - breaking the match the same way the SKU
  // Lookup store-page scrape's own vendor-code bug did (see dropVendorCode
  // in productImport.js). Vendor codes aren't meant to be used for anything
  // (yet), so a row with only a Vendor column now leaves brand blank rather
  // than guessing it's a real brand name.
  brand: ['brand', 'supplier', 'winery', 'brewery', 'manufacturer'],
  sku: ['sku', 'store sku', 'item number', 'item #', 'item no', 'plu'],
  size: ['size', 'unit size', 'bottle size', 'container size'],
  vintage: ['vintage', 'year'],
  price: ['price', 'regular price', 'retail price', 'reg price', 'unit price', 'list price'],
  salePrice: ['sale price', 'promo price', 'special price', 'promotion price', 'sale'],
  // Beer is commonly shelved and shopped by the pack/case, but a WinePOS
  // export's `price` column above is priced per single bottle/can (a store's
  // own inventory convention, confirmed against a real export) - these are
  // for stores whose export separately carries what the whole pack rings up
  // for, so Search by Name can offer that instead of (or alongside) the
  // per-unit price. Both are optional: a row with no matching column here
  // just has no pack price to offer, same as any other unmatched field.
  packPrice: ['pack price', 'case price', 'carton price', 'multi-pack price', 'multipack price', 'pack retail price'],
  packQty: ['pack qty', 'pack quantity', 'pack count', 'units per pack', 'case qty', 'case quantity', 'case count', 'units per case'],
  description: ['tasting notes', 'notes', 'long description', 'web description'],
  category: ['category', 'department', 'class', 'dept'],
  // 'current inv' confirmed against a real WinePOS export
  // (wine-pos-inventory-demo.csv) - the on-hand quantity for that SKU at
  // the time the file was exported, not a live count (see
  // productDatabase.js's Product Database table, the one place this is
  // surfaced so far).
  onHand: ['current inv', 'on hand', 'qty on hand', 'quantity on hand', 'on-hand', 'onhand', 'inventory', 'inventory qty', 'inv qty', 'stock', 'stock on hand', 'units on hand'],
};

// Maps each field to the header index that matched one of its aliases (the
// first header to match wins). Returns {} entries left undefined for any
// field this export doesn't have - callers treat a missing field as blank,
// except `upc`, which is required (see buildIndex).
function matchColumns(headerRow) {
  const headers = headerRow.map(normalizeHeader);
  const colFor = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const idx = headers.findIndex((h) => aliases.includes(h));
    if (idx !== -1) colFor[field] = idx;
  }
  return colFor;
}

function cell(row, colFor, field) {
  const idx = colFor[field];
  if (idx === undefined) return '';
  return (row[idx] || '').trim();
}

function normalizeMoney(raw) {
  if (!raw) return '';
  const cleaned = raw.replace(/[^0-9.]/g, '');
  return cleaned;
}

// Recovers a pack's unit count from the Size column itself ("12pk 12oz
// Cans", "6 Pack 12oz Btl") when the export has no dedicated pack-quantity
// column of its own (see packQty in FIELD_ALIASES above) - beer sizes
// commonly spell the count out there already, so this saves a store from
// having to add one more column just to label a pack price "Pack (12)"
// instead of just "Pack". Returns null (rather than 1) when nothing looks
// like a pack count, since "unknown count" and "definitely one" shouldn't
// both suppress the label the same way.
function parsePackQtyFromSize(size) {
  const m = String(size || '').match(/(\d+)\s*[- ]?(?:pk|pack|ct|count)\b/i);
  const qty = m ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(qty) && qty > 1 ? qty : null;
}

// Strips the same "stored as a number, not text" artifacts upcVariants
// below needs gone before it can build match variants - a spurious
// trailing ".0"/".00" (a UPC column typed as a float, e.g. WinePOS
// exporting 88586001895 as "88586001895.0") and anything that isn't a
// digit. Shared with buildIndex below, which stores this cleaned form as a
// product's own `upc` field (e.g. for the Beer Bible's Export File Sync to
// save) - deliberately NOT zero-padded the way upcVariants' own match
// variants are; padding is only safe for generating extra *lookup* keys
// (a wrong guess there is a harmless unused index entry), not for a value
// this app then treats as ground truth and writes down.
function cleanUpcDigits(raw) {
  const withoutTrailingZeroDecimal = String(raw || '').replace(/\.0+$/, '');
  return withoutTrailingZeroDecimal.replace(/\D/g, '');
}

// A scanner (or the export itself) can represent the same product as a
// 12-digit UPC-A or its 13-digit EAN-13 form (a leading zero) - both are
// printed on U.S. retail products interchangeably depending on what read
// the barcode, so a lookup tries both rather than requiring an exact-length
// match. Returns a de-duplicated list, digits only.
function upcVariants(raw) {
  const digits = cleanUpcDigits(raw);
  if (!digits) return [];
  const variants = new Set([digits]);
  if (digits.length === 13 && digits[0] === '0') variants.add(digits.slice(1));
  if (digits.length === 12) variants.add(`0${digits}`);

  // Confirmed against a real WinePOS export: a UPC column stored as a
  // number (rather than text) silently drops leading zeros - a 12-digit
  // UPC-A starting with 0 comes out looking like an 11-digit (or shorter)
  // number in the file. Padding back up to the standard lengths recovers
  // the same code a real barcode scanner would actually send. (This
  // wouldn't correctly reconstruct a genuinely short code like UPC-E,
  // which isn't just a zero-padded UPC-A - but the extra padded variant is
  // harmless in that case, just an unused index entry.)
  if (digits.length < 12) {
    variants.add(digits.padStart(12, '0'));
    variants.add(digits.padStart(13, '0'));
  }
  return [...variants];
}

// A content fingerprint of everything a product object actually surfaces to
// staff (Search by Name's list/selected card, the Settings item count) -
// used by dedupeProducts below to collapse rows that are indistinguishable
// from a shelf-talker's perspective. Deliberately doesn't include the row's
// UPC (byUpc, built separately in buildIndex, keeps every UPC variant
// mapped regardless of this dedup - two genuinely different barcodes for
// what looks like "the same" item still both need to scan correctly).
function productSignature(p) {
  return [
    p.title, p.brand, p.sku, p.size, p.vintage, p.price, p.salePrice,
    p.packPrice, p.packQty, p.description, p.category,
  ].map((v) => (v === null || v === undefined ? '' : String(v)).trim().toLowerCase()).join('');
}

// Collapses rows that are exact duplicates of each other in every field
// staff actually see (see productSignature) - confirmed against a real
// WinePOS export, which can carry the same item on more than one row (e.g.
// one per bin/location). Doesn't touch byUpc (still built from every row,
// see buildIndex) - only what Search by Name lists and what the Settings
// dialog counts as "items in the export", both of which duplicate rows were
// making look worse than the file's real inventory: a search could burn
// several of its limited result slots on the same item shown 5 times,
// crowding out other real matches, and the item count over-reported how
// much the export actually held. Keeps the first occurrence, file order.
function dedupeProducts(products) {
  const seen = new Set();
  const deduped = [];
  for (const product of products) {
    const signature = productSignature(product);
    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(product);
  }
  return deduped;
}

// Same "number stored as a float" quirk upcVariants strips off a UPC
// (see its own comment) can hit a SKU column too - a store SKU is
// otherwise plain digits, so this is deliberately narrow (only an
// all-zero fraction) rather than a general numeric-string normalizer.
function normalizeSkuKey(raw) {
  return String(raw || '').replace(/\.0+$/, '').trim().toLowerCase();
}

function buildIndex(rows) {
  if (!rows.length) return { byUpc: new Map(), bySku: new Map(), headers: [], products: [] };
  const headerRow = rows[0];
  const colFor = matchColumns(headerRow);
  if (colFor.upc === undefined) {
    throw new Error(
      `Could not find a UPC/barcode column in the export file. Found columns: ${headerRow.join(', ') || '(none)'}. `
      + 'Rename the UPC column in the WinePOS export to "UPC" or "Barcode", or ask WinePOS support to add one.'
    );
  }

  const byUpc = new Map();
  // Keyed by normalizeSkuKey(sku), one entry per distinct SKU in file order -
  // backs lookupSkuInExport (the Bourbon Library profile page's Price row),
  // a separate index from byUpc since a product's store SKU and its
  // manufacturer UPC are different numbers matched by different flows (see
  // this file's own top-of-file note on that distinction).
  const bySku = new Map();
  // One entry per data row with a UPC, in file order - deduplicated before
  // this function hands it back (see dedupeProducts below), so what actually
  // gets returned is one entry per *distinct* item. The Search by Name tab
  // (see searchByName below) scores against that returned list directly
  // rather than deriving it from byUpc's values on every search, since a
  // product sits at multiple keys there (its 12- and 13-digit UPC variants
  // both point at the same object - see upcVariants).
  const products = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;
    const rawUpc = cell(row, colFor, 'upc');
    if (!rawUpc) continue;

    const size = cell(row, colFor, 'size');
    const packQtyCell = cell(row, colFor, 'packQty');
    const packQtyFromColumn = packQtyCell ? parseInt(packQtyCell, 10) : NaN;
    const packQty = Number.isFinite(packQtyFromColumn) && packQtyFromColumn > 1
      ? packQtyFromColumn
      : parsePackQtyFromSize(size);

    const product = {
      title: cell(row, colFor, 'title'),
      brand: cell(row, colFor, 'brand'),
      sku: cell(row, colFor, 'sku'),
      // Cleaned (float-artifact/non-digit stripped) but not zero-padded -
      // see cleanUpcDigits' own comment for why. Backs the Beer Bible's
      // Export File Sync (server/beerBibleExportSync.js), which saves this
      // onto a matching entry's own upc column.
      upc: cleanUpcDigits(rawUpc),
      size,
      vintage: cell(row, colFor, 'vintage'),
      price: normalizeMoney(cell(row, colFor, 'price')),
      salePrice: normalizeMoney(cell(row, colFor, 'salePrice')),
      // See packPrice/packQty in FIELD_ALIASES above - both blank/null when
      // the export has no pack pricing of its own to offer.
      packPrice: normalizeMoney(cell(row, colFor, 'packPrice')),
      packQty,
      description: cell(row, colFor, 'description'),
      category: cell(row, colFor, 'category'),
    };
    products.push(product);
    for (const variant of upcVariants(rawUpc)) {
      byUpc.set(variant, product);
    }
    if (product.sku) {
      const skuKey = normalizeSkuKey(product.sku);
      if (skuKey) bySku.set(skuKey, product);
    }
  }
  // byUpc/bySku above still have an entry per row (every UPC variant needs to
  // keep scanning correctly, and a duplicate SKU row just overwrites with the
  // same data) - only the returned product list is deduplicated, see
  // dedupeProducts.
  return { byUpc, bySku, headers: headerRow, products: dedupeProducts(products) };
}

// ================================================================
// Catalog loading - cached in memory and keyed by the file's own mtime, so
// a scan re-reads and re-parses the (potentially large) export only when it
// has actually changed since the last lookup, not on every single scan.
// ================================================================

let cache = { filePath: null, mtimeMs: null, byUpc: null, bySku: null, headers: null, products: null };

function loadCatalog(filePath) {
  const stat = fs.statSync(filePath); // throws ENOENT if missing
  if (cache.filePath === filePath && cache.mtimeMs === stat.mtimeMs) {
    return cache;
  }
  const text = fs.readFileSync(filePath, 'utf-8');
  const { byUpc, bySku, headers, products } = buildIndex(parseDelimited(text));
  cache = { filePath, mtimeMs: stat.mtimeMs, byUpc, bySku, headers, products };
  return cache;
}

function invalidateCache() {
  cache = { filePath: null, mtimeMs: null, byUpc: null, bySku: null, headers: null, products: null };
}

// ================================================================
// Public API
// ================================================================

// exportPath/fileExists/lastModified/itemCount/error all describe the
// *effective* path (see effectiveExportPath) - the manually configured one,
// unless auto-sync is on, in which case it's always the locally-synced
// copy. `exportPath` is kept as the name (rather than e.g. `effectivePath`)
// since this is what every existing caller (the Export File Settings
// dialog, the export preview) already reads; `autoSync` is new, and lets
// callers tell "this is the real configured path" apart from "this is a
// synced copy, edit auto-sync instead of this field to change it".
function getUpcSettings() {
  const { exportPath: configuredPath, autoSync } = readConfig();
  const exportPath = effectiveExportPath();
  const settings = {
    exportPath,
    autoSync,
    // Surfaced only for the Settings dialog, which still shows/edits the
    // manually-typed path even while auto-sync (and thus the synced copy
    // `exportPath` above points at) is what's actually in effect - so
    // turning auto-sync back off restores it instead of leaving the field
    // blank.
    configuredPath,
    fileExists: false,
    lastModified: null,
    itemCount: null,
    error: null,
  };
  if (!exportPath) return settings;

  try {
    const stat = fs.statSync(exportPath);
    settings.fileExists = true;
    settings.lastModified = stat.mtime.toISOString();
    // products is one entry per *distinct* item (buildIndex's own
    // dedupeProducts pass already collapsed exact-duplicate rows - see its
    // comment) - byUpc has multiple keys (12/13-digit variants, plus one per
    // duplicate row) per product, so counting that map's own size would
    // overcount further still.
    const { products } = loadCatalog(exportPath);
    settings.itemCount = products.length;
  } catch (err) {
    if (err.code === 'ENOENT') {
      settings.error = autoSync
        ? 'Waiting for the first sync from the Server PC. Open the Server PC dialog (Advanced menu) to check its status.'
        : `No file found at ${exportPath}.`;
    } else {
      settings.error = err.message;
    }
  }
  return settings;
}

// Only ever changes the manually-configured path - auto-sync is left as-is
// (see setAutoSync for that), so saving a path in the Settings dialog can't
// silently flip a PC's auto-sync setting off as a side effect.
function setUpcSettings(exportPath) {
  const { autoSync } = readConfig();
  writeConfig({ exportPath, autoSync });
  invalidateCache();
  return getUpcSettings();
}

// Shared by lookupUpc and searchByName below - both need the same "is an
// export even configured, does it exist, can it be parsed" checks before
// they can do anything with it, and the same three error codes callers (see
// /api/upc-lookup and /api/name-search) map to HTTP statuses: NO_EXPORT_PATH,
// EXPORT_NOT_FOUND, EXPORT_UNREADABLE.
function requireCatalog() {
  const { autoSync } = readConfig();
  const exportPath = effectiveExportPath();
  if (!exportPath) {
    const err = new Error('No export file location is set yet. Open Scan UPC → Settings and point it at the WinePOS export file.');
    err.code = 'NO_EXPORT_PATH';
    throw err;
  }

  try {
    return loadCatalog(exportPath);
  } catch (e) {
    if (e.code === 'ENOENT') {
      const err = new Error(
        autoSync
          ? 'Waiting for the first sync from the Server PC. Open the Server PC dialog (Advanced menu) to check its status.'
          : `No file found at ${exportPath}. Check the export path in Scan UPC → Settings.`
      );
      err.code = 'EXPORT_NOT_FOUND';
      throw err;
    }
    const err = new Error(e.message);
    err.code = 'EXPORT_UNREADABLE';
    throw err;
  }
}

// Looks up a scanned UPC against the configured export file. Throws an
// Error with a `code` staff-facing callers (see /api/upc-lookup) can use to
// pick a status code: NO_EXPORT_PATH, EXPORT_NOT_FOUND, EXPORT_UNREADABLE,
// or UPC_NOT_FOUND.
function lookupUpc(scannedUpc) {
  const { byUpc } = requireCatalog();
  for (const variant of upcVariants(scannedUpc)) {
    if (byUpc.has(variant)) return byUpc.get(variant);
  }
  const err = new Error(`UPC ${scannedUpc} was not found in the export file. Enter this item manually.`);
  err.code = 'UPC_NOT_FOUND';
  throw err;
}

// Looks up a store SKU against the configured export file - backs the
// Bourbon Library profile page's Price row (a library entry's own `sku`
// field, see mash_bills in db.js, checked against whatever the export
// currently has on file for it). Same local-file, no-network shape as
// lookupUpc above, and the same NO_EXPORT_PATH/EXPORT_NOT_FOUND/
// EXPORT_UNREADABLE error codes, plus SKU_NOT_FOUND for a SKU the export
// doesn't have.
function lookupSkuInExport(sku) {
  const { bySku } = requireCatalog();
  const key = normalizeSkuKey(sku);
  if (key && bySku.has(key)) return bySku.get(key);
  const err = new Error(`SKU ${sku} was not found in the export file.`);
  err.code = 'SKU_NOT_FOUND';
  throw err;
}

// ================================================================
// Search by Name - backs the "Search by Name" tab: staff type part of a
// product's title and get back a short, ranked list of candidates to pick
// from, rather than the single exact match lookupUpc above requires. Same
// local export file, no network request either way.
// ================================================================

// Ranks `text` against `query` (both matched case-insensitively) for a
// single field. Higher is a closer match; -1 means "doesn't match at all"
// so callers can filter it out. Word-start matches beat a match buried
// mid-word, which beats nothing - a search for "cab" should put "Cabernet
// Sauvignon" and "14 Hands Cabernet" ahead of a product whose name merely
// contains "cab" somewhere that isn't the start of a word.
function scoreNameMatch(text, query) {
  const t = String(text || '').toLowerCase();
  const q = String(query || '').trim().toLowerCase();
  if (!q || !t) return -1;
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  const words = t.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    if (words[i].startsWith(q)) {
      // Earlier words win ties (a match on the 1st word outranks the 5th),
      // but never so much that it drops below the plain "contains" tier
      // just below - a word-start match anywhere in the title should still
      // outrank a mid-word substring match.
      return Math.max(89 - i, 61);
    }
  }
  if (t.includes(q)) return 40;
  return -1;
}

// A product's own best score across the fields worth searching: mainly its
// title, but falling back to its brand/vendor (capped below any title match)
// so "kendall" still finds a Kendall-Jackson bottle whose title doesn't
// happen to repeat the winery name.
function scoreProduct(product, query) {
  const titleScore = scoreNameMatch(product.title, query);
  if (titleScore > -1) return titleScore;
  const brandScore = scoreNameMatch(product.brand, query);
  return brandScore > -1 ? Math.min(brandScore, 25) : -1;
}

// Returns up to `limit` products ranked by how closely their name matches
// `query`, best match first (ties broken alphabetically). An empty/
// whitespace-only query returns no results rather than the whole catalog -
// there's no ranking to speak of and staff wouldn't be shown thousands of
// unrelated rows. Unlike lookupUpc, finding nothing isn't exceptional - it's
// just an empty list for the tab to show its own "no matches" state for.
function searchByName(query, { limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const { products } = requireCatalog();
  const lim = Math.min(Math.max(Number(limit) || 8, 1), 25);
  return products
    .map((product) => ({ product, score: scoreProduct(product, q) }))
    .filter((r) => r.score > -1)
    .sort((a, b) => b.score - a.score || a.product.title.localeCompare(b.product.title))
    .slice(0, lim)
    .map((r) => r.product);
}

// Backs the desktop app's "View Export File" dialog (Advanced menu): the
// raw file as WinePOS actually wrote it - headers exactly as named, first
// `limit` data rows - rather than loadCatalog's parsed/column-matched
// index above. Deliberately separate from that lookup path: a preview is
// for confirming what the file actually contains (does it even have a
// column that looks like a UPC, what's it literally called) - matching it
// against FIELD_ALIASES would hide exactly the thing staff most need to
// see when the export isn't working. Same error codes as lookupUpc for the
// "nothing configured yet"/"file missing" cases. Reads the *effective* path
// (see effectiveExportPath) same as a real lookup would, so on a PC with
// auto-sync on this previews the synced copy - what Scan UPC/Search by Name
// are actually reading - not the (possibly blank, possibly stale) manually
// configured path.
//
// `query`, if given, filters to data rows containing it (plain case-
// insensitive substring, any column) *before* `limit` is applied - unlike
// searchByName, this is deliberately not fuzzy/scored/alias-matched: the
// point of this dialog is to answer "is this literal text in the file
// somewhere, in whatever column", which is exactly what a scored/aliased
// search would obscure. That also means it has to run over every data row
// server-side rather than the client filtering whatever page it already
// has - a filter over just the displayed rows would silently miss matches
// past `limit` and report a false "not found" for a row that's actually
// there. Matching against the parsed rows already in memory rather than
// re-reading anything, so this stays cheap even as staff type.
function previewExport({ limit = 50, query = '' } = {}) {
  const { autoSync } = readConfig();
  const exportPath = effectiveExportPath();
  if (!exportPath) {
    const err = new Error('No export file location is set yet. Open Scan UPC → Settings and point it at the WinePOS export file.');
    err.code = 'NO_EXPORT_PATH';
    throw err;
  }

  let text;
  try {
    text = fs.readFileSync(exportPath, 'utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      const err = new Error(
        autoSync
          ? 'Waiting for the first sync from the Server PC. Open the Server PC dialog (Advanced menu) to check its status.'
          : `No file found at ${exportPath}. Check the export path in Scan UPC → Settings.`
      );
      err.code = 'EXPORT_NOT_FOUND';
      throw err;
    }
    const wrapped = new Error(e.message);
    wrapped.code = 'EXPORT_UNREADABLE';
    throw wrapped;
  }

  const rows = parseDelimited(text);
  const headers = rows[0] || [];
  const dataRows = rows.slice(1);
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);

  const trimmedQuery = String(query || '').trim();
  const needle = trimmedQuery.toLowerCase();
  const matchedRows = needle
    ? dataRows.filter((row) => row.some((cell) => String(cell).toLowerCase().includes(needle)))
    : dataRows;

  return {
    exportPath,
    autoSync,
    headers,
    rows: matchedRows.slice(0, lim),
    totalRows: dataRows.length,
    matchedRows: matchedRows.length,
    query: trimmedQuery,
  };
}

// Reads the manually-configured export file's raw bytes, ignoring auto-sync
// entirely - used only by exportSync.js's serve side (a PC marked as the
// Server PC hands this back to other PCs over the LAN, see
// createExportServeServer). Always the manual path, never effectiveExportPath,
// so a PC that's both marked Server PC *and* has auto-sync on (a
// misconfiguration - see the Server PC dialog's copy) serves the real
// WinePOS file it's configured with rather than re-serving its own synced
// copy back out. Same NO_EXPORT_PATH/EXPORT_NOT_FOUND/EXPORT_UNREADABLE
// error codes as lookupUpc/requireCatalog above.
function readExportFileRaw() {
  const { exportPath } = readConfig();
  if (!exportPath) {
    const err = new Error('No export file location is set yet.');
    err.code = 'NO_EXPORT_PATH';
    throw err;
  }

  try {
    const stat = fs.statSync(exportPath);
    const content = fs.readFileSync(exportPath, 'utf-8');
    return { exportPath, content, mtimeMs: stat.mtimeMs };
  } catch (e) {
    if (e.code === 'ENOENT') {
      const err = new Error(`No file found at ${exportPath}.`);
      err.code = 'EXPORT_NOT_FOUND';
      throw err;
    }
    const err = new Error(e.message);
    err.code = 'EXPORT_UNREADABLE';
    throw err;
  }
}

module.exports = {
  getUpcSettings,
  setUpcSettings,
  setAutoSync,
  isAutoSyncEnabled,
  syncedExportFilePath,
  readExportFileRaw,
  lookupUpc,
  lookupSkuInExport,
  searchByName,
  previewExport,
  // Exported for tests only.
  parseDelimited,
  matchColumns,
  upcVariants,
  normalizeSkuKey,
  buildIndex,
  scoreNameMatch,
  parsePackQtyFromSize,
  dedupeProducts,
  configFilePath,
};
