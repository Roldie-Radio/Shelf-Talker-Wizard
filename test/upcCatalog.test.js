const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseDelimited, matchColumns, upcVariants, buildIndex,
  getUpcSettings, setUpcSettings, lookupUpc, previewExport,
} = require('../server/upcCatalog');

// Every test gets its own throwaway config dir (so config.json read/writes
// never touch a real machine's actual settings) and its own throwaway
// export file - SHELF_TALKER_CONFIG_DIR is read fresh on every call into
// upcCatalog.js, not cached at require time, so swapping it per test is safe
// even though the module itself is only ever required once.
function withTempConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-talker-upc-test-'));
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

function writeExport(dir, name, contents) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents, 'utf-8');
  return filePath;
}

const SAMPLE_CSV = [
  'UPC,Item Description,Brand,Size,Vintage,Regular Price,Sale Price,Department',
  '085000010652,"Josh Cellars, Cabernet Sauvignon",Josh Cellars,750ml,2022,13.99,9.99,Wine',
  '019214600037,Corona Extra 12pk Cans,Constellation Brands,12pk,,15.99,,Beer',
].join('\n');

// ---------- parseDelimited ----------

test('parseDelimited splits plain CSV rows into fields', () => {
  const rows = parseDelimited('a,b,c\n1,2,3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('parseDelimited handles quoted fields with embedded commas and escaped quotes', () => {
  const rows = parseDelimited('Title,Note\n"Cellars, Inc.","She said ""hi"""\n');
  assert.deepEqual(rows, [['Title', 'Note'], ['Cellars, Inc.', 'She said "hi"']]);
});

test('parseDelimited copes with CRLF line endings and a missing trailing newline', () => {
  const rows = parseDelimited('a,b\r\n1,2\r\n3,4');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('parseDelimited auto-detects tab-delimited files', () => {
  const rows = parseDelimited('UPC\tTitle\n085000010652\tJosh Cellars\n');
  assert.deepEqual(rows, [['UPC', 'Title'], ['085000010652', 'Josh Cellars']]);
});

test('parseDelimited drops a trailing blank line', () => {
  const rows = parseDelimited('a,b\n1,2\n\n');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

// ---------- matchColumns ----------

test('matchColumns matches common header aliases case-insensitively', () => {
  const cols = matchColumns(['upc', 'Item Description', 'Regular Price', 'Sale Price']);
  assert.equal(cols.upc, 0);
  assert.equal(cols.title, 1);
  assert.equal(cols.price, 2);
  assert.equal(cols.salePrice, 3);
});

test('matchColumns normalizes underscores/dashes and extra whitespace', () => {
  const cols = matchColumns(['Bar_Code', 'unit-price', '  Item   Description  ']);
  assert.equal(cols.upc, 0);
  assert.equal(cols.price, 1);
  assert.equal(cols.title, 2);
});

test('matchColumns leaves unmatched fields undefined', () => {
  const cols = matchColumns(['UPC', 'Some Unrelated Column']);
  assert.equal(cols.upc, 0);
  assert.equal(cols.title, undefined);
});

// ---------- upcVariants ----------

test('upcVariants strips non-digit characters', () => {
  // 12 digits after stripping, so it's also treated as a UPC-A and gets the
  // EAN-13 leading-zero variant added - see the dedicated test below for
  // that behavior; this one just confirms the punctuation itself is gone.
  assert.ok(upcVariants('085000-010652').includes('085000010652'));
});

test('upcVariants adds the EAN-13 leading-zero form for a 12-digit UPC-A', () => {
  assert.deepEqual(upcVariants('085000010652').sort(), ['0085000010652', '085000010652'].sort());
});

test('upcVariants strips the leading zero for a 13-digit EAN-13', () => {
  assert.deepEqual(upcVariants('0085000010652').sort(), ['0085000010652', '085000010652'].sort());
});

test('upcVariants returns nothing for an empty/non-numeric input', () => {
  assert.deepEqual(upcVariants(''), []);
  assert.deepEqual(upcVariants('abc'), []);
});

// ---------- buildIndex ----------

test('buildIndex maps rows onto product fields by matched columns', () => {
  const { byUpc } = buildIndex(parseDelimited(SAMPLE_CSV));
  const product = byUpc.get('085000010652');
  assert.equal(product.title, 'Josh Cellars, Cabernet Sauvignon');
  assert.equal(product.brand, 'Josh Cellars');
  assert.equal(product.size, '750ml');
  assert.equal(product.vintage, '2022');
  assert.equal(product.price, '13.99');
  assert.equal(product.salePrice, '9.99');
  assert.equal(product.category, 'Wine');
});

test('buildIndex indexes both UPC-A and EAN-13 forms of the same row', () => {
  const { byUpc } = buildIndex(parseDelimited(SAMPLE_CSV));
  assert.equal(byUpc.get('085000010652'), byUpc.get('0085000010652'));
});

test('buildIndex skips rows with a blank UPC instead of throwing', () => {
  const csv = 'UPC,Title\n,No Barcode Item\n085000010652,Josh Cellars\n';
  const { byUpc } = buildIndex(parseDelimited(csv));
  assert.equal(byUpc.size, 2); // one product, two UPC-length variants
});

test('buildIndex throws a descriptive error when no UPC column is found', () => {
  const csv = 'Title,Price\nJosh Cellars,13.99\n';
  assert.throws(
    () => buildIndex(parseDelimited(csv)),
    /Could not find a UPC\/barcode column.*Title, Price/s
  );
});

// ---------- getUpcSettings / setUpcSettings / lookupUpc ----------

test('lookupUpc throws NO_EXPORT_PATH when nothing has been configured yet', () => {
  withTempConfigDir(() => {
    assert.throws(() => lookupUpc('085000010652'), (err) => err.code === 'NO_EXPORT_PATH');
  });
});

test('setUpcSettings persists the export path and getUpcSettings reads it back', () => {
  withTempConfigDir((dir) => {
    const filePath = writeExport(dir, 'items.csv', SAMPLE_CSV);
    const saved = setUpcSettings(filePath);
    assert.equal(saved.exportPath, filePath);
    assert.equal(saved.fileExists, true);
    assert.equal(saved.itemCount, 2);

    const reloaded = getUpcSettings();
    assert.equal(reloaded.exportPath, filePath);
    assert.equal(reloaded.itemCount, 2);
  });
});

test('getUpcSettings reports a missing file without throwing', () => {
  withTempConfigDir((dir) => {
    const missingPath = path.join(dir, 'does-not-exist.csv');
    setUpcSettings(missingPath);
    const settings = getUpcSettings();
    assert.equal(settings.fileExists, false);
    assert.match(settings.error, /No file found/);
  });
});

test('lookupUpc finds a product by its exact scanned UPC', () => {
  withTempConfigDir((dir) => {
    const filePath = writeExport(dir, 'items.csv', SAMPLE_CSV);
    setUpcSettings(filePath);
    const product = lookupUpc('085000010652');
    assert.equal(product.title, 'Josh Cellars, Cabernet Sauvignon');
  });
});

test('lookupUpc finds a UPC-A product when the export stores it as EAN-13', () => {
  withTempConfigDir((dir) => {
    const filePath = writeExport(dir, 'items.csv', SAMPLE_CSV);
    setUpcSettings(filePath);
    const product = lookupUpc('0085000010652');
    assert.equal(product.title, 'Josh Cellars, Cabernet Sauvignon');
  });
});

test('lookupUpc throws EXPORT_NOT_FOUND when the configured file is missing', () => {
  withTempConfigDir((dir) => {
    setUpcSettings(path.join(dir, 'nope.csv'));
    assert.throws(() => lookupUpc('085000010652'), (err) => err.code === 'EXPORT_NOT_FOUND');
  });
});

test('lookupUpc throws UPC_NOT_FOUND for a UPC absent from the file', () => {
  withTempConfigDir((dir) => {
    const filePath = writeExport(dir, 'items.csv', SAMPLE_CSV);
    setUpcSettings(filePath);
    assert.throws(() => lookupUpc('000000000000'), (err) => err.code === 'UPC_NOT_FOUND');
  });
});

test('lookupUpc throws EXPORT_UNREADABLE when the file has no UPC column', () => {
  withTempConfigDir((dir) => {
    const filePath = writeExport(dir, 'items.csv', 'Title,Price\nJosh Cellars,13.99\n');
    setUpcSettings(filePath);
    assert.throws(() => lookupUpc('085000010652'), (err) => err.code === 'EXPORT_UNREADABLE');
  });
});

test('lookupUpc picks up changes to the export file after it is re-saved', () => {
  withTempConfigDir((dir) => {
    const filePath = writeExport(dir, 'items.csv', SAMPLE_CSV);
    setUpcSettings(filePath);
    assert.equal(lookupUpc('085000010652').price, '13.99');

    const updatedCsv = SAMPLE_CSV.replace('13.99', '11.99');
    fs.writeFileSync(filePath, updatedCsv, 'utf-8');
    // Force a distinct mtime rather than relying on filesystem timestamp
    // resolution (which can be coarser than the time this test takes to
    // run) to actually differ between the two writes.
    const bumped = new Date(fs.statSync(filePath).mtime.getTime() + 2000);
    fs.utimesSync(filePath, bumped, bumped);

    assert.equal(lookupUpc('085000010652').price, '11.99');
  });
});

// ---------- previewExport ----------

test('previewExport returns the raw headers and rows, not the column-matched product shape', () => {
  withTempConfigDir((dir) => {
    const filePath = writeExport(dir, 'items.csv', SAMPLE_CSV);
    setUpcSettings(filePath);
    const preview = previewExport({ limit: 10 });
    assert.equal(preview.exportPath, filePath);
    assert.deepEqual(preview.headers, ['UPC', 'Item Description', 'Brand', 'Size', 'Vintage', 'Regular Price', 'Sale Price', 'Department']);
    assert.equal(preview.totalRows, 2);
    assert.equal(preview.rows.length, 2);
    assert.equal(preview.rows[0][0], '085000010652');
  });
});

test('previewExport respects the limit without changing totalRows', () => {
  withTempConfigDir((dir) => {
    const filePath = writeExport(dir, 'items.csv', SAMPLE_CSV);
    setUpcSettings(filePath);
    const preview = previewExport({ limit: 1 });
    assert.equal(preview.rows.length, 1);
    assert.equal(preview.totalRows, 2);
  });
});

test('previewExport does not require a UPC column - unlike lookupUpc, a raw preview should work on any export', () => {
  withTempConfigDir((dir) => {
    const filePath = writeExport(dir, 'items.csv', 'Title,Price\nJosh Cellars,13.99\n');
    setUpcSettings(filePath);
    const preview = previewExport({ limit: 10 });
    assert.deepEqual(preview.headers, ['Title', 'Price']);
    assert.equal(preview.totalRows, 1);
  });
});

test('previewExport throws NO_EXPORT_PATH when nothing is configured', () => {
  withTempConfigDir(() => {
    assert.throws(() => previewExport({}), (err) => err.code === 'NO_EXPORT_PATH');
  });
});

test('previewExport throws EXPORT_NOT_FOUND when the configured file is missing', () => {
  withTempConfigDir((dir) => {
    setUpcSettings(path.join(dir, 'nope.csv'));
    assert.throws(() => previewExport({}), (err) => err.code === 'EXPORT_NOT_FOUND');
  });
});
