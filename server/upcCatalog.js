// Backs the "Scan UPC" tab: instead of talking to a network API, this reads
// a product export file that the store's WinePOS system writes to disk on
// the same PC (the kind of feed WinePOS's own "electronic shelf tag"
// integrations consume) and looks products up by the manufacturer UPC
// printed on the bottle - a different number from the store's own SKU that
// /api/sku-lookup already searches liquoroutletwinecellars.com for (see the
// og:upc-is-actually-SKU note in productImport.js). Nothing here makes a
// network request; it only ever reads a local file path staff configure
// once in the Scan UPC tab's Settings box.
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
// ================================================================

function configFilePath() {
  return path.join(getAppDataDir(), 'config.json');
}

function readConfig() {
  try {
    const raw = fs.readFileSync(configFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return { exportPath: typeof parsed.exportPath === 'string' ? parsed.exportPath : '' };
  } catch {
    // No config file yet, or it's unreadable/corrupt - either way, treat it
    // the same as "nothing configured" rather than failing settings lookups.
    return { exportPath: '' };
  }
}

function writeConfig(config) {
  fs.mkdirSync(getAppDataDir(), { recursive: true });
  fs.writeFileSync(configFilePath(), JSON.stringify({ exportPath: config.exportPath || '' }, null, 2), 'utf-8');
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
  brand: ['brand', 'vendor', 'supplier', 'winery', 'brewery', 'manufacturer'],
  sku: ['sku', 'store sku', 'item number', 'item #', 'item no', 'plu'],
  size: ['size', 'unit size', 'bottle size', 'container size'],
  vintage: ['vintage', 'year'],
  price: ['price', 'regular price', 'retail price', 'reg price', 'unit price', 'list price'],
  salePrice: ['sale price', 'promo price', 'special price', 'promotion price', 'sale'],
  description: ['tasting notes', 'notes', 'long description', 'web description'],
  category: ['category', 'department', 'class', 'dept'],
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

// A scanner (or the export itself) can represent the same product as a
// 12-digit UPC-A or its 13-digit EAN-13 form (a leading zero) - both are
// printed on U.S. retail products interchangeably depending on what read
// the barcode, so a lookup tries both rather than requiring an exact-length
// match. Returns a de-duplicated list, digits only.
function upcVariants(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
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

function buildIndex(rows) {
  if (!rows.length) return { byUpc: new Map(), headers: [], products: [] };
  const headerRow = rows[0];
  const colFor = matchColumns(headerRow);
  if (colFor.upc === undefined) {
    throw new Error(
      `Could not find a UPC/barcode column in the export file. Found columns: ${headerRow.join(', ') || '(none)'}. `
      + 'Rename the UPC column in the WinePOS export to "UPC" or "Barcode", or ask WinePOS support to add one.'
    );
  }

  const byUpc = new Map();
  // One entry per data row with a UPC, in file order - the Search by Name
  // tab (see searchByName below) scores against this list directly rather
  // than deriving it from byUpc's values on every search, since a product
  // sits at multiple keys there (its 12- and 13-digit UPC variants both
  // point at the same object - see upcVariants).
  const products = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;
    const rawUpc = cell(row, colFor, 'upc');
    if (!rawUpc) continue;

    const product = {
      title: cell(row, colFor, 'title'),
      brand: cell(row, colFor, 'brand'),
      sku: cell(row, colFor, 'sku'),
      size: cell(row, colFor, 'size'),
      vintage: cell(row, colFor, 'vintage'),
      price: normalizeMoney(cell(row, colFor, 'price')),
      salePrice: normalizeMoney(cell(row, colFor, 'salePrice')),
      description: cell(row, colFor, 'description'),
      category: cell(row, colFor, 'category'),
    };
    products.push(product);
    for (const variant of upcVariants(rawUpc)) {
      byUpc.set(variant, product);
    }
  }
  return { byUpc, headers: headerRow, products };
}

// ================================================================
// Catalog loading - cached in memory and keyed by the file's own mtime, so
// a scan re-reads and re-parses the (potentially large) export only when it
// has actually changed since the last lookup, not on every single scan.
// ================================================================

let cache = { filePath: null, mtimeMs: null, byUpc: null, headers: null, products: null };

function loadCatalog(filePath) {
  const stat = fs.statSync(filePath); // throws ENOENT if missing
  if (cache.filePath === filePath && cache.mtimeMs === stat.mtimeMs) {
    return cache;
  }
  const text = fs.readFileSync(filePath, 'utf-8');
  const { byUpc, headers, products } = buildIndex(parseDelimited(text));
  cache = { filePath, mtimeMs: stat.mtimeMs, byUpc, headers, products };
  return cache;
}

function invalidateCache() {
  cache = { filePath: null, mtimeMs: null, byUpc: null, headers: null, products: null };
}

// ================================================================
// Public API
// ================================================================

function getUpcSettings() {
  const { exportPath } = readConfig();
  const settings = {
    exportPath, fileExists: false, lastModified: null, itemCount: null, error: null,
  };
  if (!exportPath) return settings;

  try {
    const stat = fs.statSync(exportPath);
    settings.fileExists = true;
    settings.lastModified = stat.mtime.toISOString();
    // products is already one entry per row (see buildIndex) - byUpc has
    // multiple keys (12/13-digit variants) per product, so counting that
    // map's own size would overcount.
    const { products } = loadCatalog(exportPath);
    settings.itemCount = products.length;
  } catch (err) {
    settings.error = err.code === 'ENOENT' ? `No file found at ${exportPath}.` : err.message;
  }
  return settings;
}

function setUpcSettings(exportPath) {
  writeConfig({ exportPath });
  invalidateCache();
  return getUpcSettings();
}

// Shared by lookupUpc and searchByName below - both need the same "is an
// export even configured, does it exist, can it be parsed" checks before
// they can do anything with it, and the same three error codes callers (see
// /api/upc-lookup and /api/name-search) map to HTTP statuses: NO_EXPORT_PATH,
// EXPORT_NOT_FOUND, EXPORT_UNREADABLE.
function requireCatalog() {
  const { exportPath } = readConfig();
  if (!exportPath) {
    const err = new Error('No export file location is set yet. Open Scan UPC → Settings and point it at the WinePOS export file.');
    err.code = 'NO_EXPORT_PATH';
    throw err;
  }

  try {
    return loadCatalog(exportPath);
  } catch (e) {
    if (e.code === 'ENOENT') {
      const err = new Error(`No file found at ${exportPath}. Check the export path in Scan UPC → Settings.`);
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
// "nothing configured yet"/"file missing" cases.
function previewExport({ limit = 50 } = {}) {
  const { exportPath } = readConfig();
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
      const err = new Error(`No file found at ${exportPath}. Check the export path in Scan UPC → Settings.`);
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

  return {
    exportPath,
    headers,
    rows: dataRows.slice(0, lim),
    totalRows: dataRows.length,
  };
}

module.exports = {
  getUpcSettings,
  setUpcSettings,
  lookupUpc,
  searchByName,
  previewExport,
  // Exported for tests only.
  parseDelimited,
  matchColumns,
  upcVariants,
  buildIndex,
  scoreNameMatch,
  configFilePath,
};
