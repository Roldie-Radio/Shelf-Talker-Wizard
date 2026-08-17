const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../server/db');
const { setUpcSettings } = require('../server/upcCatalog');
const { syncBeerBibleFromExport } = require('../server/beerBibleExportSync');

// Same throwaway-directory pattern as test/beerBibleSeed.test.js - db.js and
// upcCatalog.js both key off SHELF_TALKER_CONFIG_DIR.
async function withTempDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-talker-beer-export-sync-test-'));
  const prev = process.env.SHELF_TALKER_CONFIG_DIR;
  process.env.SHELF_TALKER_CONFIG_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    db.closeDb();
    if (prev === undefined) delete process.env.SHELF_TALKER_CONFIG_DIR;
    else process.env.SHELF_TALKER_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeExport(dir, rows) {
  const filePath = path.join(dir, 'export.csv');
  fs.writeFileSync(filePath, ['UPC,Title,SKU,Regular Price', ...rows].join('\n'), 'utf-8');
  setUpcSettings(filePath);
}

test('syncBeerBibleFromExport fills in upc for a SKU-matched entry', () => withTempDb((dir) => {
  writeExport(dir, ['085000010652,Slack Tide Flounder Pounder,55555,14.99']);
  const entry = db.upsertBeer({ title: 'Slack Tide Flounder Pounder', sku: '55555' });

  const result = syncBeerBibleFromExport(db);
  assert.equal(result.checked, 1);
  assert.equal(result.matched, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.noMatch, 0);
  assert.equal(result.noSku, 0);
  assert.equal(db.getBeer(entry.id).upc, '085000010652');
}));

test('syncBeerBibleFromExport counts a matched SKU with an already-current upc as matched, not updated', () => withTempDb((dir) => {
  writeExport(dir, ['085000010652,Slack Tide Flounder Pounder,55555,14.99']);
  db.upsertBeer({ title: 'Slack Tide Flounder Pounder', sku: '55555', upc: '085000010652' });

  const result = syncBeerBibleFromExport(db);
  assert.equal(result.matched, 1);
  assert.equal(result.updated, 0);
}));

test('syncBeerBibleFromExport counts a SKU absent from the export as noMatch, without touching that entry', () => withTempDb((dir) => {
  writeExport(dir, ['085000010652,Slack Tide Flounder Pounder,55555,14.99']);
  const entry = db.upsertBeer({ title: 'Founders All Day IPA', sku: '99999' });

  const result = syncBeerBibleFromExport(db);
  assert.equal(result.matched, 0);
  assert.equal(result.noMatch, 1);
  assert.equal(db.getBeer(entry.id).upc, '');
}));

test('syncBeerBibleFromExport never touches an entry with no SKU, and counts it separately from noMatch', () => withTempDb((dir) => {
  writeExport(dir, ['085000010652,Slack Tide Flounder Pounder,55555,14.99']);
  const entry = db.upsertBeer({ title: 'Michelob ULTRA' });

  const result = syncBeerBibleFromExport(db);
  assert.equal(result.checked, 0);
  assert.equal(result.noSku, 1);
  assert.equal(result.noMatch, 0);
  assert.equal(db.getBeer(entry.id).upc, '');
}));

// This is the whole reason Export File Sync never creates new entries (see
// the module's own top-of-file comment): the configured export is the
// store's *entire* catalog, wine/spirits included, with nothing reliable to
// tell a beer row apart from any other - so it only ever enriches a `beers`
// row that's already there.
test('syncBeerBibleFromExport never adds a new entry for a SKU that only exists in the export, not the Beer Bible', () => withTempDb((dir) => {
  writeExport(dir, [
    '085000010652,Slack Tide Flounder Pounder,55555,14.99',
    '019214600037,Josh Cellars Cabernet Sauvignon,66666,12.99',
  ]);
  db.upsertBeer({ title: 'Slack Tide Flounder Pounder', sku: '55555' });

  const result = syncBeerBibleFromExport(db);
  assert.equal(db.listBeers().length, 1);
  assert.equal(result.checked, 1);
}));

test('syncBeerBibleFromExport throws NO_EXPORT_PATH when nothing is configured', () => withTempDb(() => {
  db.upsertBeer({ title: 'Slack Tide Flounder Pounder', sku: '55555' });
  assert.throws(() => syncBeerBibleFromExport(db), { code: 'NO_EXPORT_PATH' });
}));
