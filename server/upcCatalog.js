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
const os = require('os');

// ================================================================
// Config - where the export file lives is a one-time, per-PC setting (the
// Scan UPC tab's Settings box), so it's persisted to a small JSON file
// rather than asked for on every lookup. SHELF_TALKER_CONFIG_DIR overrides
// the location entirely, which both the test suite and (if ever needed) the
// Electron main process can use instead of the real per-OS default below.
// ================================================================

function configDir() {
  if (process.env.SHELF_TALKER_CONFIG_DIR) return process.env.SHELF_TALKER_CONFIG_DIR;
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'Shelf Talker Wizard');
  }
  return path.join(os.homedir(), '.shelf-talker-wizard');
}

function configFilePath() {
  return path.join(configDir(), 'config.json');
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
  fs.mkdirSync(configDir(), { recursive: true });
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

function parseDelimited(text) {
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
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FIELD_ALIASES = {
  upc: ['upc', 'upc code', 'upc a', 'barcode', 'bar code', 'scancode', 'scan code', 'ean', 'ean13', 'ean 13'],
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
  return [...variants];
}

function buildIndex(rows) {
  if (!rows.length) return { byUpc: new Map(), headers: [] };
  const headerRow = rows[0];
  const colFor = matchColumns(headerRow);
  if (colFor.upc === undefined) {
    throw new Error(
      `Could not find a UPC/barcode column in the export file. Found columns: ${headerRow.join(', ') || '(none)'}. `
      + 'Rename the UPC column in the WinePOS export to "UPC" or "Barcode", or ask WinePOS support to add one.'
    );
  }

  const byUpc = new Map();
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
    for (const variant of upcVariants(rawUpc)) {
      byUpc.set(variant, product);
    }
  }
  return { byUpc, headers: headerRow };
}

// ================================================================
// Catalog loading - cached in memory and keyed by the file's own mtime, so
// a scan re-reads and re-parses the (potentially large) export only when it
// has actually changed since the last lookup, not on every single scan.
// ================================================================

let cache = { filePath: null, mtimeMs: null, byUpc: null, headers: null };

function loadCatalog(filePath) {
  const stat = fs.statSync(filePath); // throws ENOENT if missing
  if (cache.filePath === filePath && cache.mtimeMs === stat.mtimeMs) {
    return cache;
  }
  const text = fs.readFileSync(filePath, 'utf-8');
  const { byUpc, headers } = buildIndex(parseDelimited(text));
  cache = { filePath, mtimeMs: stat.mtimeMs, byUpc, headers };
  return cache;
}

function invalidateCache() {
  cache = { filePath: null, mtimeMs: null, byUpc: null, headers: null };
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
    const { byUpc } = loadCatalog(exportPath);
    // Multiple UPC-variant keys (12/13-digit) can point at the same product
    // object, so count distinct products, not map entries.
    settings.itemCount = new Set(byUpc.values()).size;
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

// Looks up a scanned UPC against the configured export file. Throws an
// Error with a `code` staff-facing callers (see /api/upc-lookup) can use to
// pick a status code: NO_EXPORT_PATH, EXPORT_NOT_FOUND, EXPORT_UNREADABLE,
// or UPC_NOT_FOUND.
function lookupUpc(scannedUpc) {
  const { exportPath } = readConfig();
  if (!exportPath) {
    const err = new Error('No export file location is set yet. Open Scan UPC → Settings and point it at the WinePOS export file.');
    err.code = 'NO_EXPORT_PATH';
    throw err;
  }

  let byUpc;
  try {
    ({ byUpc } = loadCatalog(exportPath));
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

  for (const variant of upcVariants(scannedUpc)) {
    if (byUpc.has(variant)) return byUpc.get(variant);
  }
  const err = new Error(`UPC ${scannedUpc} was not found in the export file. Enter this item manually.`);
  err.code = 'UPC_NOT_FOUND';
  throw err;
}

module.exports = {
  getUpcSettings,
  setUpcSettings,
  lookupUpc,
  // Exported for tests only.
  parseDelimited,
  matchColumns,
  upcVariants,
  buildIndex,
  configFilePath,
};
