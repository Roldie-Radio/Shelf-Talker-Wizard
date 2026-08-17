const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../server/db');
const { importBeerBibleCsv } = require('../server/beerBibleCsvImport');

// Same throwaway-directory pattern as test/beerBibleExportSync.test.js.
async function withTempDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-talker-beer-csv-import-test-'));
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

const EXPORT_HEADER = 'Title,Beer Name (Untappd),Brewery,Location,Style,ABV,IBU,Untappd Rating,Untappd Rating Count,SKU,UPC,Tasting Notes,Source,Researched';

test('importBeerBibleCsv reads a real Export CSV round-trip, including a blank-optional-field row', () => withTempDb(() => {
  const csv = [
    EXPORT_HEADER,
    'LANCASTER MILK STOUT CAN,Milk Stout,Lancaster Brewing Company,"Lancaster, PA",Milk / Sweet Stout,5.5%,22,3.82,1140,55555,085000010652,A smooth milk stout.,Typed in by staff,Yes',
    '2ND FAVOR HEAVY SPECTRUM 4PK,,,,,,,,,41788,,,,No',
  ].join('\r\n');

  const result = importBeerBibleCsv(db, csv);
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.total, 2);

  const lancaster = db.getBeerByTitle('LANCASTER MILK STOUT CAN');
  assert.equal(lancaster.beerName, 'Milk Stout');
  assert.equal(lancaster.brewery, 'Lancaster Brewing Company');
  assert.equal(lancaster.location, 'Lancaster, PA');
  assert.equal(lancaster.style, 'Milk / Sweet Stout');
  assert.equal(lancaster.abv, '5.5%');
  assert.equal(lancaster.ibu, '22');
  assert.equal(lancaster.untappdRating, '3.82');
  assert.equal(lancaster.untappdRatingCount, '1140');
  assert.equal(lancaster.sku, '55555');
  assert.equal(lancaster.upc, '085000010652');
  assert.equal(lancaster.description, 'A smooth milk stout.');
  // Source/Researched columns are never read back in - every imported row
  // is tagged 'Import' instead (see the module's own comment for why).
  assert.equal(lancaster.source, 'Import');

  const stub = db.getBeerByTitle('2ND FAVOR HEAVY SPECTRUM 4PK');
  assert.equal(stub.sku, '41788');
  assert.equal(stub.brewery, '');
}));

test('importBeerBibleCsv never overwrites an existing field with a blank cell', () => withTempDb(() => {
  db.upsertBeer({ title: 'Slack Tide Flounder Pounder', brewery: 'Slack Tide Brewing Company', style: 'American IPA' });

  const csv = [EXPORT_HEADER, 'Slack Tide Flounder Pounder,,,,,,,,,,,,,'].join('\n');
  const result = importBeerBibleCsv(db, csv);
  assert.equal(result.imported, 1);

  const entry = db.getBeerByTitle('Slack Tide Flounder Pounder');
  assert.equal(entry.brewery, 'Slack Tide Brewing Company');
  assert.equal(entry.style, 'American IPA');
}));

test('importBeerBibleCsv matches an existing entry by SKU (never renaming its title), same as any other Beer Bible save', () => withTempDb(() => {
  db.upsertBeer({
    title: 'Central Waters Bourbon Barrel Tiramisu Stout Can', brewery: 'Central Waters Brewing Company', sku: '41299',
  });

  const csv = [
    EXPORT_HEADER,
    'CENTRAL WATERS BOURBON BARREL TIRAMISU STOUT 4PK CAN,,,,,11.1%,,,,41299,,,,',
  ].join('\n');
  const result = importBeerBibleCsv(db, csv);
  assert.equal(result.imported, 1);

  const matches = db.listBeers().filter((b) => b.sku === '41299');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].title, 'Central Waters Bourbon Barrel Tiramisu Stout Can');
  assert.equal(matches[0].brewery, 'Central Waters Brewing Company');
  assert.equal(matches[0].abv, '11.1%');
}));

test('importBeerBibleCsv skips a row with a blank title, without failing the rest of the file', () => withTempDb(() => {
  const csv = [
    EXPORT_HEADER,
    ',,,,,,,,,99999,,,,',
    'Founders All Day IPA,,,,,,,,,,,,,',
  ].join('\n');
  const result = importBeerBibleCsv(db, csv);
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.total, 2);
  assert.equal(db.listBeers().length, 1);
}));

test('importBeerBibleCsv works with a subset of columns (e.g. UPC deleted before importing) and different column order', () => withTempDb(() => {
  const csv = ['SKU,Title,Brewery', '12345,Founders All Day IPA,Founders Brewing Co.'].join('\n');
  const result = importBeerBibleCsv(db, csv);
  assert.equal(result.imported, 1);
  const entry = db.getBeerByTitle('Founders All Day IPA');
  assert.equal(entry.sku, '12345');
  assert.equal(entry.brewery, 'Founders Brewing Co.');
  assert.equal(entry.upc, '');
}));

test('importBeerBibleCsv reads the Variety Pack column back as a real boolean, unlike every other (plain-text) column', () => withTempDb(() => {
  const header = `${EXPORT_HEADER},Variety Pack`;
  const csv = [
    header,
    '2ND FAVOR HEAVY SPECTRUM 4PK,,,,,,,,,41788,,,,No,Yes',
    'Founders All Day IPA,,,,,,,,,,,,,,No',
  ].join('\r\n');

  const result = importBeerBibleCsv(db, csv);
  assert.equal(result.imported, 2);

  assert.equal(db.getBeerByTitle('2ND FAVOR HEAVY SPECTRUM 4PK').varietyPack, true);
  assert.equal(db.getBeerByTitle('Founders All Day IPA').varietyPack, false);
}));

test('importBeerBibleCsv with no Variety Pack column at all leaves the flag alone on a repeat import, same as every other omitted column', () => withTempDb(() => {
  db.upsertBeer({ title: 'Founders All Day IPA', varietyPack: true, sku: '12345' });

  const csv = [EXPORT_HEADER, 'Founders All Day IPA,,,,,,,,,12345,,,,'].join('\n');
  const result = importBeerBibleCsv(db, csv);
  assert.equal(result.imported, 1);
  assert.equal(db.getBeerByTitle('Founders All Day IPA').varietyPack, true);
}));

test('importBeerBibleCsv reads a Size column back as plain text, same as every other optional field', () => withTempDb(() => {
  const header = `${EXPORT_HEADER},Size`;
  const csv = [
    header,
    'DOGFISH HEAD 60 MIN IPA 6PK CAN,60 Minute IPA,Dogfish Head Craft Brewery,"Milton, DE",IPA - American,6%,60,4.2,3000,111,,,,Yes,6-Pack',
    'DOGFISH HEAD 60 MIN IPA 12PK CAN,60 Minute IPA,Dogfish Head Craft Brewery,"Milton, DE",IPA - American,6%,60,4.2,3000,112,,,,Yes,12-Pack',
  ].join('\r\n');

  const result = importBeerBibleCsv(db, csv);
  assert.equal(result.imported, 2);

  assert.equal(db.getBeerByTitle('DOGFISH HEAD 60 MIN IPA 6PK CAN').size, '6-Pack');
  assert.equal(db.getBeerByTitle('DOGFISH HEAD 60 MIN IPA 12PK CAN').size, '12-Pack');
}));

test('importBeerBibleCsv throws NO_TITLE_COLUMN when the file has no recognizable Title column', () => withTempDb(() => {
  const csv = ['Brewery,Style', 'Founders Brewing Co.,IPA'].join('\n');
  assert.throws(() => importBeerBibleCsv(db, csv), { code: 'NO_TITLE_COLUMN' });
}));

test('importBeerBibleCsv throws NO_ROWS for an empty file', () => withTempDb(() => {
  assert.throws(() => importBeerBibleCsv(db, ''), { code: 'NO_ROWS' });
}));
