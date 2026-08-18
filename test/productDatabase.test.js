const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractExportProducts, extractHaProducts, mergeProducts, readRows,
  setExportFile, setHaFile, getState,
} = require('../server/productDatabase');

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

test('setExportFile/setHaFile/getState round-trip through the module\'s in-memory state', () => {
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
});

test('setExportFile throws NO_ROWS for a file with no SKU-bearing rows', () => {
  const csv = Buffer.from('SKU,UPC\n', 'utf-8').toString('base64');
  assert.throws(() => setExportFile({ filename: 'empty.csv', contentBase64: csv }), { code: 'NO_ROWS' });
});
