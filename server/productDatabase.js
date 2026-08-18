// Backs the Product Database (rail "Product Database" view, table icon
// above Settings) - a bare scaffold for now, same spirit as the Rum
// Repository's own "browse a shared record" starting point: two staff-
// picked spreadsheets get parsed and merged into one table, no editing,
// no persistence beyond this process's own memory.
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
// State lives in memory only (module-level, like beerBibleImport.js's own
// job status) - reloading either file replaces that file's half of the
// merge; there's nothing to persist yet since the merged table has no
// functionality beyond display for the time being.

const path = require('path');
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

let state = freshState();

function publicState() {
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
  state = {
    ...state,
    exportFileName: filename || 'Export File',
    exportLoadedAt: new Date().toISOString(),
    exportCount: products.length,
    exportProducts: products,
  };
  return publicState();
}

function setHaFile({ filename, contentBase64 }) {
  const products = extractHaProducts(readRows({ filename, contentBase64 }));
  if (!products.length) {
    const err = new Error("Could not find any rows with a SKU in that file - make sure it's the HA Details export.");
    err.code = 'NO_ROWS';
    throw err;
  }
  state = {
    ...state,
    haFileName: filename || 'HA Details',
    haLoadedAt: new Date().toISOString(),
    haCount: products.length,
    haProducts: products,
  };
  return publicState();
}

function getState() {
  return publicState();
}

module.exports = {
  getState, setExportFile, setHaFile,
  // Exported for tests only.
  readRows, extractExportProducts, extractHaProducts, mergeProducts,
};
