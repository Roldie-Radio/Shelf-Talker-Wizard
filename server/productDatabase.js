// Backs the Product Database (rail "Product Database" view, table icon
// above Settings) - a bare scaffold for now, same spirit as the Rum
// Repository's own "browse a shared record" starting point: two staff-
// picked spreadsheets get parsed and merged into one table, no editing
// beyond re-loading either file.
//
// The two files:
//  - Export File: the same WinePOS product export Scan UPC/Export File
//    Settings already read (see upcCatalog.js) - has UPC, price, size,
//    on-hand quantity, etc. per SKU.
//  - HA Details: a separate spreadsheet staff export from wherever
//    Department/Sub Department live (a system this app has no other
//    integration with) - same SKUs, different columns.
//
// Both are merged by SKU, the one column both files are expected to share.
// Reuses upcCatalog.js's alias-driven header matching (parseDelimited,
// matchColumns, normalizeSkuKey) for the Export file side, since it's the
// exact same file format that module already knows how to read; the HA
// Details file gets its own small alias map below (HA_FIELD_ALIASES) since
// Department/Sub Department have no equivalent in upcCatalog.js's own
// FIELD_ALIASES.
//
// Persisted to this PC's own app data directory as a plain JSON file (see
// appData.js - same per-PC directory db.js's SQLite file and upcCatalog.js's
// config.json already live in), not held in memory only - otherwise every
// server restart (a PC reboot, a Windows Update, the app just being closed
// and reopened) would silently lose both loaded files and leave the screen
// blank until someone re-picked them. This also means it needs no
// load-on-launch wiring in index.js/start() the way db.js's SQLite
// connection or the beer/bourbon GitHub auto-seeds do - the first read just
// reads it off disk itself, whenever that first read happens to be.
//
// readState()/writeState() below cache that disk copy in memory for the
// life of the process (see cachedState) rather than re-reading and
// JSON-parsing the file on every single call - a real store's Export/HA
// Details files can run to several thousand rows, and this is now read on
// every Product Database screen visit *and* every Rum Repository visit (its
// In-Stock Only toggle - see app.js). The cache still starts empty on every
// fresh process, so a real restart correctly re-reads the disk copy; only
// repeat reads within one running process skip the file entirely.
const fs = require('fs');
const path = require('path');
const { getAppDataDir } = require('./appData');
const { parseDelimited, matchColumns, normalizeSkuKey } = require('./upcCatalog');

// Reads an uploaded file's rows into the same [headerRow, ...dataRows]
// shape parseDelimited returns for CSV/TSV - the client sends the file's
// raw bytes as base64 (works identically for a plain <input type="file">
// in the browser or Electron's webview, no native path/Browse… dialog
// needed - same reasoning as Beer Bible's own Import CSV… button) and this
// picks CSV/TSV vs. Excel parsing by the filename's extension, same as
// beerBibleImport.js's readRows/readWorkbookRows.
function readRows({ filename, contentBase64 }) {
  if (!contentBase64) {
    const err = new Error('No file content was received.');
    err.code = 'NO_FILE';
    throw err;
  }
  const buffer = Buffer.from(contentBase64, 'base64');
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.xlsx' || ext === '.xlsm') {
    // eslint-disable-next-line global-require -- only needed for the
    // .xlsx/.xlsm branch, same lazy-require reasoning as beerBibleImport.js.
    const XLSX = require('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  }
  return parseDelimited(buffer.toString('utf-8'));
}

function normalizeHeader(h) {
  return String(h || '')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const HA_FIELD_ALIASES = {
  sku: ['sku', 'store sku', 'item number', 'item #', 'item no', 'plu'],
  title: ['title', 'description', 'item description', 'product', 'product name', 'item name', 'name'],
  department: ['department', 'dept', 'dept name', 'department name'],
  subDepartment: ['sub department', 'subdepartment', 'sub dept', 'sub-department', 'sub category', 'subcategory', 'sub class'],
};

function matchHaColumns(headerRow) {
  const headers = headerRow.map(normalizeHeader);
  const colFor = {};
  Object.entries(HA_FIELD_ALIASES).forEach(([field, aliases]) => {
    const idx = headers.findIndex((h) => aliases.includes(h));
    if (idx !== -1) colFor[field] = idx;
  });
  return colFor;
}

function cellAt(row, colFor, field) {
  const idx = colFor[field];
  return idx === undefined ? '' : String(row[idx] || '').trim();
}

// Uses upcCatalog.js's own alias set (matchColumns) so this recognizes the
// exact same header variations Scan UPC/Export File Settings already do.
function extractExportProducts(rows) {
  if (rows.length < 2) return [];
  const colFor = matchColumns(rows[0]);
  if (colFor.sku === undefined) {
    const err = new Error(`Could not find a SKU column in the Export file's header row. Found columns: ${rows[0].join(', ') || '(none)'}.`);
    err.code = 'NO_SKU_COLUMN';
    throw err;
  }
  return rows.slice(1)
    .map((row) => ({
      sku: cellAt(row, colFor, 'sku'),
      title: cellAt(row, colFor, 'title'),
      upc: cellAt(row, colFor, 'upc'),
      size: cellAt(row, colFor, 'size'),
      price: cellAt(row, colFor, 'price'),
      brand: cellAt(row, colFor, 'brand'),
      onHand: cellAt(row, colFor, 'onHand'),
    }))
    .filter((p) => p.sku);
}

function extractHaProducts(rows) {
  if (rows.length < 2) return [];
  const colFor = matchHaColumns(rows[0]);
  if (colFor.sku === undefined) {
    const err = new Error(`Could not find a SKU column in the HA Details file's header row. Found columns: ${rows[0].join(', ') || '(none)'}.`);
    err.code = 'NO_SKU_COLUMN';
    throw err;
  }
  return rows.slice(1)
    .map((row) => ({
      sku: cellAt(row, colFor, 'sku'),
      title: cellAt(row, colFor, 'title'),
      department: cellAt(row, colFor, 'department'),
      subDepartment: cellAt(row, colFor, 'subDepartment'),
    }))
    .filter((p) => p.sku);
}

// One row per distinct SKU seen in either file - Export file order first
// (its own columns filled in, plus Department/Sub Department from the HA
// Details file when that SKU is also there), then any SKU the HA Details
// file has that the Export file doesn't, appended after with just its own
// columns filled in. Never drops a SKU just because it's only on one side -
// staff still need to see it's missing from the other file, not have it
// silently disappear.
function mergeProducts(exportProducts, haProducts) {
  const haBySku = new Map();
  haProducts.forEach((p) => {
    const key = normalizeSkuKey(p.sku);
    if (!haBySku.has(key)) haBySku.set(key, p);
  });

  const seen = new Set();
  const merged = [];
  exportProducts.forEach((p) => {
    const key = normalizeSkuKey(p.sku);
    if (seen.has(key)) return;
    seen.add(key);
    const ha = haBySku.get(key);
    merged.push({
      sku: p.sku,
      title: p.title || (ha && ha.title) || '',
      upc: p.upc,
      size: p.size,
      price: p.price,
      brand: p.brand,
      onHand: p.onHand,
      department: ha ? ha.department : '',
      subDepartment: ha ? ha.subDepartment : '',
    });
  });
  haProducts.forEach((p) => {
    const key = normalizeSkuKey(p.sku);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({
      sku: p.sku,
      title: p.title,
      upc: '',
      size: '',
      price: '',
      brand: '',
      onHand: '',
      department: p.department,
      subDepartment: p.subDepartment,
    });
  });
  return merged;
}

function freshState() {
  return {
    exportFileName: '',
    exportLoadedAt: null,
    exportCount: 0,
    haFileName: '',
    haLoadedAt: null,
    haCount: 0,
    exportProducts: [],
    haProducts: [],
  };
}

function stateFilePath() {
  return path.join(getAppDataDir(), 'product-database.json');
}

// No file yet (first launch, or neither file has ever been loaded on this
// PC) and a corrupt/unreadable file are both treated as "nothing loaded" -
// same "missing config is just the default, not an error" reasoning as
// upcCatalog.js's own readConfig. Each field is validated/defaulted
// individually rather than trusting the parsed JSON's shape wholesale, so a
// hand-edited or partially-written file degrades gracefully field by field
// instead of losing everything to one bad key.
function loadStateFromDisk() {
  try {
    const raw = fs.readFileSync(stateFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      exportFileName: typeof parsed.exportFileName === 'string' ? parsed.exportFileName : '',
      exportLoadedAt: typeof parsed.exportLoadedAt === 'string' ? parsed.exportLoadedAt : null,
      exportCount: Number.isFinite(parsed.exportCount) ? parsed.exportCount : 0,
      haFileName: typeof parsed.haFileName === 'string' ? parsed.haFileName : '',
      haLoadedAt: typeof parsed.haLoadedAt === 'string' ? parsed.haLoadedAt : null,
      haCount: Number.isFinite(parsed.haCount) ? parsed.haCount : 0,
      exportProducts: Array.isArray(parsed.exportProducts) ? parsed.exportProducts : [],
      haProducts: Array.isArray(parsed.haProducts) ? parsed.haProducts : [],
    };
  } catch {
    return freshState();
  }
}

// In-memory cache over loadStateFromDisk, keyed by the resolved file path
// rather than a single flag - at real store scale (a multi-thousand-row
// Export File merged with a similarly large HA Details file) re-reading and
// JSON-parsing the persisted copy on every single GET /api/product-database
// call (the Product Database screen's own load, and now the Rum
// Repository's In-Stock Only toggle fetching it on every visit - see
// app.js) adds real, avoidable latency to something that's otherwise just
// reading a value that hasn't changed. A real app restart still re-reads
// the disk copy correctly (a fresh process starts with an empty cache), so
// this doesn't undo the persistence guarantee just fixes the "process
// re-reads the same unchanged file over and over" waste. Keyed by path
// rather than a plain boolean so a changed SHELF_TALKER_CONFIG_DIR (the
// test suite switches it per test; in production it's fixed for the life
// of the process) naturally invalidates the cache instead of serving stale
// data from a different directory.
let cachedState = null;
let cachedStatePath = null;

function readState() {
  const currentPath = stateFilePath();
  if (!cachedState || cachedStatePath !== currentPath) {
    cachedState = loadStateFromDisk();
    cachedStatePath = currentPath;
  }
  return cachedState;
}

function writeState(state) {
  const currentPath = stateFilePath();
  fs.mkdirSync(getAppDataDir(), { recursive: true });
  fs.writeFileSync(currentPath, JSON.stringify(state), 'utf-8');
  cachedState = state;
  cachedStatePath = currentPath;
}

function publicState(state) {
  return {
    exportFileName: state.exportFileName,
    exportLoadedAt: state.exportLoadedAt,
    exportCount: state.exportCount,
    haFileName: state.haFileName,
    haLoadedAt: state.haLoadedAt,
    haCount: state.haCount,
    products: mergeProducts(state.exportProducts, state.haProducts),
  };
}

function setExportFile({ filename, contentBase64 }) {
  const products = extractExportProducts(readRows({ filename, contentBase64 }));
  if (!products.length) {
    const err = new Error("Could not find any rows with a SKU in that file - make sure it's the WinePOS product export.");
    err.code = 'NO_ROWS';
    throw err;
  }
  const state = {
    ...readState(),
    exportFileName: filename || 'Export File',
    exportLoadedAt: new Date().toISOString(),
    exportCount: products.length,
    exportProducts: products,
  };
  writeState(state);
  return publicState(state);
}

function setHaFile({ filename, contentBase64 }) {
  const products = extractHaProducts(readRows({ filename, contentBase64 }));
  if (!products.length) {
    const err = new Error("Could not find any rows with a SKU in that file - make sure it's the HA Details export.");
    err.code = 'NO_ROWS';
    throw err;
  }
  const state = {
    ...readState(),
    haFileName: filename || 'HA Details',
    haLoadedAt: new Date().toISOString(),
    haCount: products.length,
    haProducts: products,
  };
  writeState(state);
  return publicState(state);
}

function getState() {
  return publicState(readState());
}

// Backs the Rum Repository's "Add from Product Database" button (POST
// /api/rums/sync-product-database in index.js) - a merged row counts as a
// rum when its Department or Sub Department names Rum as a whole word, not
// just a substring match (so a department like "Instruments" or "Costume"
// - neither remotely rum-related - can't accidentally match on a stray
// "rum" inside a longer word). Case-insensitive, since a WinePOS/HA Details
// export's own casing convention isn't something this app controls.
const RUM_DEPARTMENT_PATTERN = /\brum\b/i;

function isRumProduct(product) {
  return RUM_DEPARTMENT_PATTERN.test(product.department) || RUM_DEPARTMENT_PATTERN.test(product.subDepartment);
}

function findRumProducts(products) {
  return products.filter(isRumProduct);
}

module.exports = {
  getState, setExportFile, setHaFile, findRumProducts,
  // Exported for tests only.
  readRows, extractExportProducts, extractHaProducts, mergeProducts, isRumProduct,
};
