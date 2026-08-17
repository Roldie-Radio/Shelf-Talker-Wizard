const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  getStatus, startImport, cancelImport, extractProducts, readRows,
} = require('../server/beerBibleImport');

function withMockFetch(impl, run) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve().then(run).finally(() => { globalThis.fetch = real; });
}

function mockResponse({ status = 200, body = '<html></html>' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: () => 'text/html; charset=utf-8' },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

function algoliaHitsResponse(hits) {
  return JSON.stringify({ results: [{ hits }] });
}

function beerPage({ title, brewery }) {
  return `<!doctype html><html><head><meta property="og:title" content="${title} by ${brewery} | Untappd" /></head>`
    + `<body><p class="brewery"><a href="#">${brewery}</a></p></body></html>`;
}

// A tiny fake `db` - just the two methods beerBibleImport.js actually calls
// (listBeers for the skip-existing check, upsertBeer per match), same "fake
// object, just the methods used" pattern test/index.test.js's
// fakeMashBillPuller uses. Real db.js behavior (upsert semantics, etc.) is
// covered by test/db.test.js - this only needs to confirm beerBibleImport.js
// calls it correctly.
function fakeDb(initialBeers = []) {
  const saved = [];
  return {
    listBeers: () => initialBeers,
    upsertBeer: (entry) => { saved.push(entry); return { id: saved.length, ...entry }; },
    saved,
  };
}

// `fn` is always async here (every caller either awaits a network-mocked
// job or is itself synchronous-but-wrapped) - this has to `await fn(...)`,
// not `return fn(...)`, or the `finally` below deletes the temp file out
// from under a still-running startImport job. Same pitfall test/index.test.js's
// own withTempDb warns about.
async function withTempFile(content, ext, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-talker-beer-import-test-'));
  const filePath = path.join(dir, `export${ext}`);
  fs.writeFileSync(filePath, content);
  try {
    return await fn(filePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function waitUntilDone() {
  // startImport's own loop paces itself with a real setTimeout between rows
  // (see DELAY_MS in beerBibleImport.js) - polling getStatus() here is the
  // same "watch it finish" approach the real dialog uses, just without the
  // HTTP round trip. Every test using this awaits it before returning, so
  // beerBibleImport.js's module-level job state is never left running
  // across tests (see this file's own note on that state being a shared
  // singleton, same as mashBillSync.js's puller).
  for (let i = 0; i < 200; i += 1) {
    if (!getStatus().running) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error('Import job never finished - test would hang.');
}

// ---------- extractProducts / readRows (file parsing) ----------

test('extractProducts matches title/size/sku columns by the app\'s own header aliases', () => {
  const rows = [
    ['Item Description', 'Store SKU', 'Unit Size', 'Vendor'],
    ['Michelob ULTRA', '09144', '12oz Can', 'AB'],
    ['', '09145', '12oz Can', 'AB'], // blank title - dropped
  ];
  assert.deepEqual(extractProducts(rows), [
    { title: 'Michelob ULTRA', size: '12oz Can', sku: '09144' },
  ]);
});

test('extractProducts returns nothing for a header-only (or empty) sheet', () => {
  assert.deepEqual(extractProducts([['Title', 'SKU']]), []);
  assert.deepEqual(extractProducts([]), []);
});

test('readRows parses a real CSV file', () => withTempFile(
  'Product Name,SKU\nSierra Nevada Pale Ale,12345\n',
  '.csv',
  (filePath) => {
    const rows = readRows(filePath);
    assert.deepEqual(rows, [['Product Name', 'SKU'], ['Sierra Nevada Pale Ale', '12345']]);
  }
));

test('readRows parses a real .xlsx workbook', () => {
  // eslint-disable-next-line global-require
  const XLSX = require('xlsx');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-talker-beer-import-xlsx-test-'));
  const filePath = path.join(dir, 'export.xlsx');
  try {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Product Name', 'SKU'],
      ['Founders All Day IPA', '54321'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    XLSX.writeFile(workbook, filePath);

    const rows = readRows(filePath);
    assert.deepEqual(rows, [['Product Name', 'SKU'], ['Founders All Day IPA', '54321']]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- startImport / getStatus / cancelImport ----------

test('startImport requires a file path', () => {
  assert.throws(() => startImport({ filePath: '', db: fakeDb() }), { code: 'FILE_REQUIRED' });
});

test('startImport rejects an unreadable file', () => {
  assert.throws(
    () => startImport({ filePath: '/no/such/file.csv', db: fakeDb() }),
    { code: 'FILE_UNREADABLE' },
  );
});

test('startImport rejects a file with no recognizable title column', () => withTempFile(
  'Foo,Bar\n1,2\n',
  '.csv',
  (filePath) => {
    assert.throws(() => startImport({ filePath, db: fakeDb() }), { code: 'NO_ROWS' });
  }
));

test('startImport processes every row, saving a confident match and skipping a no-match/ambiguous one, without blocking the caller', () => withTempFile(
  'Product Name,SKU\n'
    + 'Sierra Nevada Pale Ale,111\n' // matches
    + 'Some Totally Unknown Beer,222\n' // no match
    + 'Ambiguous Beer,333\n', // ambiguous (two candidates)
  '.csv',
  (filePath) => withMockFetch(
    async (url, opts) => {
      if (url.includes('algolia.net')) {
        const { params } = JSON.parse(opts.body).requests[0];
        if (params.includes('Sierra')) {
          return mockResponse({
            status: 200,
            body: algoliaHitsResponse([{ beer_slug: 'sierra-nevada-pale-ale', bid: 1, beer_name: 'Pale Ale', brewery_name: 'Sierra Nevada Brewing Co.' }]),
          });
        }
        if (params.includes('Ambiguous')) {
          return mockResponse({
            status: 200,
            body: algoliaHitsResponse([
              { beer_slug: 'a', bid: 1, beer_name: 'Ambiguous Beer', brewery_name: 'Brewery A' },
              { beer_slug: 'b', bid: 2, beer_name: 'Ambiguous Beer', brewery_name: 'Brewery B' },
            ]),
          });
        }
        return mockResponse({ status: 200, body: algoliaHitsResponse([]) });
      }
      return mockResponse({ status: 200, body: beerPage({ title: 'Pale Ale', brewery: 'Sierra Nevada Brewing Co.' }) });
    },
    async () => {
      const db = fakeDb();
      const started = startImport({ filePath, db });
      // startImport itself never awaits the row loop - it returns
      // immediately with the job already marked running, which is the
      // whole point (the HTTP route it backs can respond right away).
      assert.equal(started.running, true);
      assert.equal(started.total, 3);

      await waitUntilDone();

      const finished = getStatus();
      assert.equal(finished.running, false);
      assert.equal(finished.matched, 1);
      assert.equal(finished.noMatch, 1);
      assert.equal(finished.ambiguous, 1);
      assert.equal(finished.processed, 3);
      assert.ok(finished.finishedAt);

      assert.equal(db.saved.length, 1);
      // The store's own title (from the export), not Untappd's shorter
      // internal beer name - same as every other enrichBeerFromUntappd
      // caller (SKU Lookup, Scan UPC, Search by Name).
      assert.equal(db.saved[0].title, 'Sierra Nevada Pale Ale');
      assert.equal(db.saved[0].brewery, 'Sierra Nevada Brewing Co.');
      assert.equal(db.saved[0].sku, '111');
    },
  ),
));

test('startImport skips a row whose SKU already belongs to an enriched entry, without making any request for it', () => withTempFile(
  'Product Name,SKU\nAlready Saved Beer,999\n',
  '.csv',
  (filePath) => withMockFetch(
    async () => { throw new Error('should not have made any request - this row should be skipped entirely'); },
    async () => {
      const db = fakeDb([{ title: 'Already Saved Beer', sku: '999', brewery: 'Some Brewery' }]);
      startImport({ filePath, db });
      await waitUntilDone();
      const finished = getStatus();
      assert.equal(finished.skipped, 1);
      assert.equal(finished.matched, 0);
      assert.equal(db.saved.length, 0);
    },
  ),
));

// A bare title+SKU stub (e.g. from a bulk pre-seed pass with no Untappd
// access at seed time) must NOT count as "already saved" - see isEnriched's
// own comment in beerBibleImport.js. Otherwise a stub could never actually
// get enriched: every later real import run would see its SKU already on
// file and skip it forever.
test('startImport does not skip a row whose SKU only belongs to a bare, unenriched stub', () => withTempFile(
  'Product Name,SKU\nStub Beer,999\n',
  '.csv',
  (filePath) => withMockFetch(
    async () => mockResponse({ status: 200, body: algoliaHitsResponse([]) }),
    async () => {
      const db = fakeDb([{ title: 'Stub Beer', sku: '999', brewery: '', style: '', abv: '' }]);
      startImport({ filePath, db });
      await waitUntilDone();
      const finished = getStatus();
      assert.equal(finished.skipped, 0);
      assert.equal(finished.noMatch, 1, 'the row was actually looked up, not skipped');
    },
  ),
));

test('startImport refuses to start a second job while one is already running', () => withTempFile(
  'Product Name,SKU\nSlow Beer,1\nSlow Beer Two,2\n',
  '.csv',
  (filePath) => withMockFetch(
    async () => mockResponse({ status: 200, body: algoliaHitsResponse([]) }), // every row comes back "no match", quickly
    async () => {
      const db = fakeDb();
      startImport({ filePath, db });
      assert.throws(() => startImport({ filePath, db }), { code: 'ALREADY_RUNNING' });
      await waitUntilDone();
    },
  ),
));

test('cancelImport stops the job before it processes every row', () => withTempFile(
  'Product Name,SKU\nBeer One,1\nBeer Two,2\nBeer Three,3\n',
  '.csv',
  (filePath) => withMockFetch(
    async () => mockResponse({ status: 200, body: algoliaHitsResponse([]) }),
    async () => {
      const db = fakeDb();
      startImport({ filePath, db });
      // Cancel right away - DELAY_MS between rows (see beerBibleImport.js)
      // gives plenty of time for this to land before the first row even
      // finishes its request/response round trip.
      const cancelled = cancelImport();
      assert.equal(cancelled.running, true, 'cancelling only requests a stop - the loop notices on its own next iteration');
      await waitUntilDone();
      const finished = getStatus();
      assert.equal(finished.cancelled, true);
      assert.ok(finished.processed < 3, 'stopped before finishing every row');
    },
  ),
));

test('cancelImport with nothing running is a harmless no-op', () => {
  const status = cancelImport();
  assert.equal(status.running, false);
});
