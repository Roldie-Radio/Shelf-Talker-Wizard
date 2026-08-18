const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  extractExportProducts, extractHaProducts, mergeProducts, readRows,
  setExportFile, setHaFile, getState, findRumProducts, isRumProduct,
} = require('../server/productDatabase');

// Same throwaway-directory pattern as test/beerBibleCsvImport.test.js -
// setExportFile/setHaFile now persist to this PC's own app data directory
// (see productDatabase.js's own header), so a test that calls them without
// this would read/write the real one on whatever machine runs the suite.
function withTempConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-talker-product-database-test-'));
  const prev = process.env.SHELF_TALKER_CONFIG_DIR;
  process.env.SHELF_TALKER_CONFIG_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.SHELF_TALKER_CONFIG_DIR;
    else process.env.SHELF_TALKER_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const EXPORT_ROWS = [
  ['SKU', 'UPC', 'Description', 'Size', 'Price', 'Current Inv'],
  ['1001', '012345678905', 'Josh Cellars Cab', '750ml', '13.99', '24'],
  ['1002', '012345678912', 'Some Beer 6pk', '6pk', '9.99', '0'],
];

const HA_ROWS = [
  ['Item Number', 'Item Description', 'Department', 'Sub Department'],
  ['1001', 'Josh Cellars Cab', 'Wine', 'Red Wine'],
  ['1003', 'Mystery Item', 'Beer', 'IPA'],
];

test('extractExportProducts reads SKU/UPC/title/size/price/on-hand by header alias, same as upcCatalog.js', () => {
  const products = extractExportProducts(EXPORT_ROWS);
  assert.equal(products.length, 2);
  assert.deepEqual(products[0], {
    sku: '1001', title: 'Josh Cellars Cab', upc: '012345678905', size: '750ml', price: '13.99', brand: '', onHand: '24',
  });
  assert.equal(products[1].onHand, '0');
});

test('extractExportProducts throws NO_SKU_COLUMN when the header row has no recognizable SKU column', () => {
  assert.throws(() => extractExportProducts([['UPC', 'Title'], ['1', 'x']]), { code: 'NO_SKU_COLUMN' });
});

test('extractHaProducts reads SKU/Department/Sub Department by its own alias set', () => {
  const products = extractHaProducts(HA_ROWS);
  assert.equal(products.length, 2);
  assert.deepEqual(products[0], {
    sku: '1001', title: 'Josh Cellars Cab', department: 'Wine', subDepartment: 'Red Wine',
  });
});

test('extractHaProducts throws NO_SKU_COLUMN when the header row has no recognizable SKU column', () => {
  assert.throws(() => extractHaProducts([['Department'], ['Wine']]), { code: 'NO_SKU_COLUMN' });
});

test('mergeProducts joins by SKU: a SKU in both files gets both halves, a SKU in only one still gets a row', () => {
  const merged = mergeProducts(extractExportProducts(EXPORT_ROWS), extractHaProducts(HA_ROWS));
  assert.equal(merged.length, 3);

  const bySku = Object.fromEntries(merged.map((p) => [p.sku, p]));
  assert.equal(bySku['1001'].department, 'Wine');
  assert.equal(bySku['1001'].upc, '012345678905');
  assert.equal(bySku['1001'].onHand, '24');
  assert.equal(bySku['1002'].department, ''); // export-only row
  assert.equal(bySku['1002'].upc, '012345678912');
  assert.equal(bySku['1002'].onHand, '0');
  assert.equal(bySku['1003'].department, 'Beer'); // HA-only row
  assert.equal(bySku['1003'].upc, '');
  assert.equal(bySku['1003'].onHand, ''); // HA-only row has no on-hand qty
});

test('mergeProducts matches SKUs that differ only by a trailing ".0" float artifact, same as upcCatalog.js', () => {
  const merged = mergeProducts(
    [{
      sku: '1001.0', title: 'x', upc: '1', size: '', price: '', brand: '',
    }],
    [{
      sku: '1001', title: 'x', department: 'Wine', subDepartment: 'Red',
    }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].department, 'Wine');
});

test('readRows parses CSV/TSV text the same way upcCatalog.js does', () => {
  const csv = Buffer.from('SKU,Title\n1001,Test Item\n', 'utf-8').toString('base64');
  const rows = readRows({ filename: 'export.csv', contentBase64: csv });
  assert.deepEqual(rows, [['SKU', 'Title'], ['1001', 'Test Item']]);
});

test('readRows rejects when contentBase64 is missing', () => {
  assert.throws(() => readRows({ filename: 'export.csv' }), { code: 'NO_FILE' });
});

test('setExportFile/setHaFile/getState round-trip through disk-persisted state', () => withTempConfigDir(() => {
  const exportCsv = Buffer.from('SKU,UPC,Description,Size,Price\n2001,099999999999,Test Wine,750ml,19.99\n', 'utf-8').toString('base64');
  const haCsv = Buffer.from('SKU,Department,Sub Department\n2001,Wine,Red Wine\n', 'utf-8').toString('base64');

  const afterExport = setExportFile({ filename: 'export.csv', contentBase64: exportCsv });
  assert.equal(afterExport.exportFileName, 'export.csv');
  assert.equal(afterExport.exportCount, 1);
  assert.equal(afterExport.products.length, 1);
  assert.equal(afterExport.products[0].department, ''); // HA file not loaded yet

  const afterHa = setHaFile({ filename: 'ha-details.csv', contentBase64: haCsv });
  assert.equal(afterHa.haFileName, 'ha-details.csv');
  assert.equal(afterHa.products[0].department, 'Wine');

  const state = getState();
  assert.equal(state.products.length, 1);
  assert.equal(state.products[0].sku, '2001');
}));

test('getState with nothing ever loaded (no state file on disk yet) returns the empty default, not an error', () => withTempConfigDir(() => {
  const state = getState();
  assert.deepEqual(state, {
    exportFileName: '',
    exportLoadedAt: null,
    exportCount: 0,
    haFileName: '',
    haLoadedAt: null,
    haCount: 0,
    products: [],
  });
}));

test('a corrupt/unreadable state file on disk is treated as nothing loaded, not a crash', () => withTempConfigDir((dir) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'product-database.json'), 'not valid json{{{', 'utf-8');
  assert.doesNotThrow(() => getState());
  assert.equal(getState().products.length, 0);
}));

test('setExportFile/setHaFile survive a fresh module load (real restart persistence, not just this process\'s memory)', () => withTempConfigDir(() => {
  const exportCsv = Buffer.from('SKU,UPC,Description,Size,Price\n3001,088888888888,Restart Test Wine,750ml,9.99\n', 'utf-8').toString('base64');
  setExportFile({ filename: 'export.csv', contentBase64: exportCsv });

  // Re-require as a fresh module instance (clearing the require cache) -
  // simulates the app process restarting (a PC reboot, closing and
  // reopening the app), not just re-reading the same already-running
  // module's own state.
  delete require.cache[require.resolve('../server/productDatabase')];
  // eslint-disable-next-line global-require -- deliberate fresh re-require, see above
  const reloaded = require('../server/productDatabase');
  const state = reloaded.getState();
  assert.equal(state.exportFileName, 'export.csv');
  assert.equal(state.products.length, 1);
  assert.equal(state.products[0].sku, '3001');
}));

test('setExportFile throws NO_ROWS for a file with no SKU-bearing rows', () => withTempConfigDir(() => {
  const csv = Buffer.from('SKU,UPC\n', 'utf-8').toString('base64');
  assert.throws(() => setExportFile({ filename: 'empty.csv', contentBase64: csv }), { code: 'NO_ROWS' });
}));

test('isRumProduct matches Department or Sub Department by whole word, case-insensitively', () => {
  assert.equal(isRumProduct({ department: 'Rum', subDepartment: '' }), true);
  assert.equal(isRumProduct({ department: 'SPIRITS', subDepartment: 'rum' }), true);
  assert.equal(isRumProduct({ department: 'Spiced Rum', subDepartment: '' }), true);
  assert.equal(isRumProduct({ department: 'Bourbon', subDepartment: 'Rye' }), false);
  assert.equal(isRumProduct({ department: '', subDepartment: '' }), false);
});

test('isRumProduct does not match "rum" as a substring inside an unrelated word', () => {
  assert.equal(isRumProduct({ department: 'Instruments', subDepartment: '' }), false);
});

test('findRumProducts filters a merged product list down to just the Rum rows', () => {
  const products = [
    { sku: '1', title: 'Plantation Original Dark', department: 'Spirits', subDepartment: 'Rum' },
    { sku: '2', title: "Maker's Mark", department: 'Spirits', subDepartment: 'Bourbon' },
    { sku: '3', title: 'Bacardi Superior', department: 'Rum', subDepartment: '' },
  ];
  const rums = findRumProducts(products);
  assert.deepEqual(rums.map((p) => p.sku), ['1', '3']);
});
