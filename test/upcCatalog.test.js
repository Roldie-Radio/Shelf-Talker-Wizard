const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseDelimited, matchColumns, upcVariants, buildIndex,
  getUpcSettings, setUpcSettings, setAutoSync, syncedExportFilePath, readExportFileRaw,
  lookupUpc, searchByName, scoreNameMatch, previewExport,
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

// ---------- auto-sync / effective export path ----------
// Register-side half of exportSync.js: whether a PC reads its own manually
// configured export file, or the local copy exportSync.js's puller last
// wrote (see syncedExportFilePath). getUpcSettings/setUpcSettings/
// lookupUpc/searchByName/previewExport all resolve against whichever is
// currently in effect - the puller itself is exercised in exportSync.test.js
// (mocked fetch, no real config dir involved), not here.

test('getUpcSettings defaults to auto-sync off, exportPath equal to configuredPath', () => {
  withTempConfigDir((dir) => {
    const filePath = writeExport(dir, 'items.csv', SAMPLE_CSV);
    setUpcSettings(filePath);
    const settings = getUpcSettings();
    assert.equal(settings.autoSync, false);
    assert.equal(settings.exportPath, filePath);
    assert.equal(settings.configuredPath, filePath);
  });
});

test('setAutoSync switches getUpcSettings/lookupUpc onto the synced file, not the manually configured one', () => {
  withTempConfigDir((dir) => {
    const manualPath = writeExport(dir, 'manual.csv', SAMPLE_CSV);
    setUpcSettings(manualPath);

    // Nothing synced yet - the manually configured file is a real, valid
    // export, but auto-sync being on means it's ignored entirely.
    const onNoSync = setAutoSync(true);
    assert.equal(onNoSync.autoSync, true);
    assert.equal(onNoSync.exportPath, syncedExportFilePath());
    assert.equal(onNoSync.configuredPath, manualPath);
    assert.equal(onNoSync.fileExists, false);
    assert.match(onNoSync.error, /Waiting for the first sync/);
    assert.throws(() => lookupUpc('085000010652'), (err) => err.code === 'EXPORT_NOT_FOUND');

    // Once something's actually been synced (writing directly to the same
    // path exportSync.js's puller would), lookups pick it up like any other
    // export file - a different product than the manually configured one,
    // to prove it's really reading the synced copy and not falling back.
    fs.writeFileSync(syncedExportFilePath(), 'UPC,Title,Price\n999999999999,Synced Product,5.00\n', 'utf-8');
    const product = lookupUpc('999999999999');
    assert.equal(product.title, 'Synced Product');
    assert.throws(() => lookupUpc('085000010652'), (err) => err.code === 'UPC_NOT_FOUND');

    // Switching back off restores the manually configured file exactly as
    // it was - setAutoSync/setUpcSettings never overwrite each other.
    const off = setAutoSync(false);
    assert.equal(off.autoSync, false);
    assert.equal(off.exportPath, manualPath);
    assert.equal(off.configuredPath, manualPath);
    assert.equal(lookupUpc('085000010652').title, 'Josh Cellars, Cabernet Sauvignon');
  });
});

test('setUpcSettings (the manual path) never changes the auto-sync flag', () => {
  withTempConfigDir((dir) => {
    setAutoSync(true);
    setUpcSettings(writeExport(dir, 'manual.csv', SAMPLE_CSV));
    assert.equal(getUpcSettings().autoSync, true);
  });
});

test('previewExport reads the synced file while auto-sync is on', () => {
  withTempConfigDir((dir) => {
    setUpcSettings(writeExport(dir, 'manual.csv', SAMPLE_CSV));
    setAutoSync(true);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(syncedExportFilePath(), 'UPC,Title,Price\n999999999999,Synced Product,5.00\n', 'utf-8');

    const preview = previewExport({ limit: 10 });
    assert.equal(preview.autoSync, true);
    assert.equal(preview.exportPath, syncedExportFilePath());
    assert.deepEqual(preview.rows, [['999999999999', 'Synced Product', '5.00']]);
  });
});

test('readExportFileRaw always reads the manually configured path, ignoring auto-sync', () => {
  withTempConfigDir((dir) => {
    const manualPath = writeExport(dir, 'manual.csv', SAMPLE_CSV);
    setUpcSettings(manualPath);
    setAutoSync(true); // even with this on...
    fs.writeFileSync(syncedExportFilePath(), 'UPC,Title\n1,Should not be served\n', 'utf-8');

    const raw = readExportFileRaw();
    assert.equal(raw.exportPath, manualPath);
    assert.match(raw.content, /Josh Cellars/);
  });
});

test('readExportFileRaw throws NO_EXPORT_PATH when nothing is manually configured, even with auto-sync on', () => {
  withTempConfigDir(() => {
    setAutoSync(true);
    assert.throws(() => readExportFileRaw(), (err) => err.code === 'NO_EXPORT_PATH');
  });
});

test('readExportFileRaw throws EXPORT_NOT_FOUND when the manually configured file is missing', () => {
  withTempConfigDir((dir) => {
    setUpcSettings(path.join(dir, 'nope.csv'));
    assert.throws(() => readExportFileRaw(), (err) => err.code === 'EXPORT_NOT_FOUND');
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

// ---------- scoreNameMatch ----------

test('scoreNameMatch ranks an exact match highest, then start-of-title, then start-of-word, then a mid-word substring', () => {
  const exact = scoreNameMatch('Josh Cellars', 'josh cellars');
  const startOfTitle = scoreNameMatch('Josh Cellars Cabernet', 'josh');
  const startOfWord = scoreNameMatch('14 Hands Cabernet', 'cab');
  const midWord = scoreNameMatch('Meiomi Pinot Noir', 'omi');
  assert.ok(exact > startOfTitle);
  assert.ok(startOfTitle > startOfWord);
  assert.ok(startOfWord > midWord);
  assert.ok(midWord > -1);
});

test('scoreNameMatch is case-insensitive', () => {
  assert.equal(scoreNameMatch('Josh Cellars', 'JOSH'), scoreNameMatch('Josh Cellars', 'josh'));
});

test('scoreNameMatch returns -1 for no match and for an empty query', () => {
  assert.equal(scoreNameMatch('Josh Cellars', 'zzz'), -1);
  assert.equal(scoreNameMatch('Josh Cellars', ''), -1);
  assert.equal(scoreNameMatch('Josh Cellars', '   '), -1);
});

test('scoreNameMatch never lets a later word-start match drop below the mid-word "contains" tier', () => {
  // "contains" tier is a flat 40 (see the SAMPLE_CSV-based midWord case
  // above) - a word-start match, however many words deep, must still beat
  // it, or a long title's later words would rank worse than an unrelated
  // mid-word hit elsewhere.
  const longTitle = 'A B C D E F G H I J Cabernet';
  const wordStartDeep = scoreNameMatch(longTitle, 'cab');
  assert.ok(wordStartDeep > 40, `expected a deep word-start match (${wordStartDeep}) to still beat the mid-word tier (40)`);
});

// ---------- searchByName ----------

const NAME_SEARCH_CSV = [
  'UPC,Title,Brand,Size,Vintage,Regular Price,SKU',
  '1,Josh Cellars Cabernet Sauvignon,Josh Cellars,750ml,2023,13.99,10432',
  '2,Josh Cellars Chardonnay,Josh Cellars,750ml,2023,13.99,10433',
  '3,14 Hands Cabernet Sauvignon,14 Hands,750ml,2022,17.99,9415',
  '4,Meiomi Pinot Noir,Meiomi,750ml,2022,19.99,7742',
  "5,Vintner's Reserve Chardonnay,Kendall-Jackson,750ml,2023,12.99,8821",
].join('\n');

test('searchByName ranks the closest title matches first', () => {
  withTempConfigDir((dir) => {
    setUpcSettings(writeExport(dir, 'items.csv', NAME_SEARCH_CSV));
    const results = searchByName('josh');
    assert.deepEqual(results.map((p) => p.title), ['Josh Cellars Cabernet Sauvignon', 'Josh Cellars Chardonnay']);
  });
});

test('searchByName matches a word anywhere in the title, not just the start', () => {
  withTempConfigDir((dir) => {
    setUpcSettings(writeExport(dir, 'items.csv', NAME_SEARCH_CSV));
    const results = searchByName('cab');
    assert.deepEqual(results.map((p) => p.title).sort(), ['14 Hands Cabernet Sauvignon', 'Josh Cellars Cabernet Sauvignon'].sort());
  });
});

test('searchByName falls back to a brand match when the title itself does not contain the query', () => {
  withTempConfigDir((dir) => {
    setUpcSettings(writeExport(dir, 'items.csv', NAME_SEARCH_CSV));
    const results = searchByName('kendall');
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "Vintner's Reserve Chardonnay");
  });
});

test('searchByName respects the limit option', () => {
  withTempConfigDir((dir) => {
    setUpcSettings(writeExport(dir, 'items.csv', NAME_SEARCH_CSV));
    const results = searchByName('e', { limit: 2 }); // matches several titles
    assert.equal(results.length, 2);
  });
});

test('searchByName returns an empty list (not an error) for an empty or whitespace-only query', () => {
  withTempConfigDir((dir) => {
    setUpcSettings(writeExport(dir, 'items.csv', NAME_SEARCH_CSV));
    assert.deepEqual(searchByName(''), []);
    assert.deepEqual(searchByName('   '), []);
  });
});

test('searchByName returns an empty list for a query that matches nothing', () => {
  withTempConfigDir((dir) => {
    setUpcSettings(writeExport(dir, 'items.csv', NAME_SEARCH_CSV));
    assert.deepEqual(searchByName('zzz-not-a-product'), []);
  });
});

test('searchByName throws NO_EXPORT_PATH when nothing has been configured yet', () => {
  withTempConfigDir(() => {
    assert.throws(() => searchByName('josh'), (err) => err.code === 'NO_EXPORT_PATH');
  });
});

test('searchByName throws EXPORT_NOT_FOUND when the configured file is missing', () => {
  withTempConfigDir((dir) => {
    setUpcSettings(path.join(dir, 'nope.csv'));
    assert.throws(() => searchByName('josh'), (err) => err.code === 'EXPORT_NOT_FOUND');
  });
});

test('searchByName finds a real export row by (partial) name', () => {
  withTempConfigDir(() => {
    setUpcSettings(REAL_EXPORT_PATH);
    const results = searchByName('hands');
    assert.equal(results.length, 1);
    assert.equal(results[0].title, '14 HANDS CABERNET');
    assert.equal(results[0].sku, '9415');
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

// ---------- Real WinePOS export (test/fixtures/wine-pos-inventory-demo.csv) ----------
//
// A real inventory export a store sent us, kept as-is (UTF-8 BOM, CRLF line
// endings, and all) rather than a hand-written approximation - this is what
// caught three real bugs before they ever reached a store PC: its UPC
// column is named "UPC Data" (not in the original alias list), its UPC
// value is stored as a number and has lost a leading zero (a checksum-
// verified UPC-A, confirmed by hand against the real check-digit
// algorithm), and the BOM was leaking into error messages/previews.

const REAL_EXPORT_PATH = path.join(__dirname, 'fixtures', 'wine-pos-inventory-demo.csv');

test('previewExport reads a real WinePOS export as-is, BOM and CRLF included', () => {
  withTempConfigDir(() => {
    setUpcSettings(REAL_EXPORT_PATH);
    const preview = previewExport({ limit: 10 });
    // No leading U+FEFF on the first header - stripped for real, not just
    // for matching (see the note above parseDelimited).
    assert.equal(preview.headers[0], 'Item #');
    assert.equal(preview.headers.includes('UPC Data'), true);
    assert.equal(preview.totalRows, 1);
    assert.deepEqual(preview.rows[0], ['9415', '14 HANDS CABERNET', '750ML', '2022', 'ABD', '12', '1', '17.99', '0', '0', '55', '7.3333', '88', '88586001895']);
  });
});

test('lookupUpc finds a real export row by the UPC a physical scanner would actually send', () => {
  withTempConfigDir(() => {
    setUpcSettings(REAL_EXPORT_PATH);
    // The file itself stores "88586001895" (11 digits - a dropped leading
    // zero); "088586001895" is the real, checksum-valid 12-digit UPC-A a
    // barcode scanner reading the actual bottle would send.
    const product = lookupUpc('088586001895');
    assert.equal(product.title, '14 HANDS CABERNET');
    assert.equal(product.brand, 'ABD');
    assert.equal(product.sku, '9415');
    assert.equal(product.size, '750ML');
    assert.equal(product.vintage, '2022');
    assert.equal(product.price, '17.99');
  });
});

test('lookupUpc also finds the same real export row by the exact (zero-dropped) value stored in the file', () => {
  withTempConfigDir(() => {
    setUpcSettings(REAL_EXPORT_PATH);
    assert.equal(lookupUpc('88586001895').title, '14 HANDS CABERNET');
  });
});
