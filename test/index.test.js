const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../server/db');
const { createApp } = require('../server/index');
const { setUpcSettings } = require('../server/upcCatalog');

// Same per-test throwaway directory pattern as test/db.test.js - db.js's
// getDb() re-derives its connection whenever SHELF_TALKER_CONFIG_DIR
// changes, so each test gets its own isolated SQLite file.
//
// `fn` is always async here (every caller passes withServer(...), whose
// request/response round trip needs real event-loop ticks) - this has to
// be `async`/`await fn(dir)`, not `return fn(dir)`, or the `finally` below
// runs synchronously right after `fn` merely *starts* (returns its
// pending promise) rather than after it actually finishes. That would
// restore SHELF_TALKER_CONFIG_DIR and delete `dir` while the server is
// still mid-request, silently sending everything for the rest of that
// test to this machine's real app data directory instead of a throwaway
// one - the isolation this helper exists for, gone without any visible
// error (a real, previously-latent bug this comment is here to keep from
// coming back).
async function withTempDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-talker-index-test-'));
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

function page({ head = '', body = '' } = {}) {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
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

// Same mock-the-global-fetch technique as test/productImport.test.js - this
// only ever stands in for productImport.js's *outbound* calls (store site,
// Untappd/Algolia); the test's own request into the app below goes over a
// real loopback HTTP connection via node:http, a separate code path from
// fetch(), so the two never collide.
async function withMockFetch(impl, run) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

function algoliaHitsResponse(hits) {
  return JSON.stringify({ results: [{ hits }] });
}

function storeSearchHtml(sku) {
  return page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="${sku}" />
        <a class="product-link" href="/Michelob-ULTRA-${sku}-1009144/">
          <span class="productnameTitle">Michelob ULTRA</span>
        </a>
      </div>
    `,
  });
}

const storeProductHtml = page({
  body: `
    <h1 itemprop="name">Michelob ULTRA</h1>
    <div class="pricingDetails"><span class="priceFull">$8.99</span></div>
    <table><tr><th>Size</th><td>12pk-12oz Cans</td></tr></table>
    <div id="description"><div class="text-product-desc">A superior light beer.</div></div>
  `,
});

// Starts a real server on an ephemeral port for the duration of one test -
// createApp() alone never binds a socket (see start() in server/index.js),
// so the loopback request below needs something actually listening.
function withServer(run) {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      try {
        const { port } = server.address();
        await run(port);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
    server.on('error', reject);
  });
}

// Same as withServer above, but lets a test inject plain fake beacon/
// exportServeServer/exportPuller objects (just the methods createApp()
// actually calls on them - see server/index.js) instead of createApp()'s
// own no-args default. Used only for confirming createApp() calls the
// right methods at the right time (see the /api/server-status and
// /api/upc-settings tests below) - the real beacon/export-sync objects'
// own behavior is covered by discovery.test.js and exportSync.test.js.
function withServerAndFakes({
  beacon, exportServeServer, exportPuller, mashBillServeServer, mashBillPuller,
} = {}, run) {
  const app = createApp({
    beacon, exportServeServer, exportPuller, mashBillServeServer, mashBillPuller,
  });
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      try {
        const { port } = server.address();
        await run(port);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
    server.on('error', reject);
  });
}

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

function postJson(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Generic PUT/DELETE (postJson above is POST-only) - used by the
// /api/mashbills tests, the first routes in this file needing either verb.
function requestJson(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ================================================================
// /api/sku-lookup is always live - see the comment above the route in
// server/index.js for why a "still fresh, skip the network" shortcut used
// to live here and got removed: it meant a beer that missed on Untappd (or
// came back ambiguous) stayed stuck showing that exact same stale result
// for a full day, even after a fix that would have found it on a retry
// shipped. There's no product cache to fall back to anymore either - a
// live attempt that fails outright is a real error (see below).
// ================================================================

test('a second SKU lookup, even in the same category, still hits the network again', async () => {
  await withTempDb(() => withServer(async (port) => {
    const calls = [];
    await withMockFetch(
      async (url) => {
        calls.push(url);
        if (url.includes('/store/search.asp')) return mockResponse({ body: storeSearchHtml('09144') });
        return mockResponse({ body: storeProductHtml });
      },
      async () => {
        const first = await postJson(port, '/api/sku-lookup', { sku: '09144', category: 'wine' });
        assert.equal(first.status, 200);
        assert.equal(first.body.title, 'Michelob ULTRA');

        const callsAfterFirst = calls.length;
        const second = await postJson(port, '/api/sku-lookup', { sku: '09144', category: 'wine' });
        assert.equal(second.status, 200);
        assert.ok(calls.length > callsAfterFirst, 'a repeat lookup should hit the network again, not reuse a cached copy');
      }
    );
  }));
});

test('switching a looked-up SKU to Beer re-runs the lookup and actually runs the Untappd search', async () => {
  await withTempDb(() => withServer(async (port) => {
    const calls = [];
    await withMockFetch(
      async (url) => {
        calls.push(url);
        if (url.includes('/store/search.asp')) return mockResponse({ body: storeSearchHtml('09144') });
        if (url.includes('algolia.net')) return mockResponse({ body: algoliaHitsResponse([]) });
        return mockResponse({ body: storeProductHtml });
      },
      async () => {
        const wineResult = await postJson(port, '/api/sku-lookup', { sku: '09144', category: 'wine' });
        assert.equal(wineResult.status, 200);
        assert.equal(wineResult.body.untappdError, undefined);

        const callsAfterWine = calls.length;
        const beerResult = await postJson(port, '/api/sku-lookup', { sku: '09144', category: 'beer' });
        assert.equal(beerResult.status, 200);
        assert.ok(calls.length > callsAfterWine, 'switching to Beer should re-hit the network for the Untappd step');
        assert.ok(
          calls.some((url) => url.includes('algolia.net')),
          'switching to Beer should run the Untappd (Algolia) search, not just the store lookup'
        );
        // Algolia came back with no hits, so the best-effort Untappd step
        // surfaces its miss the same way enrichBeerFromUntappd always does.
        assert.match(beerResult.body.untappdError, /Could not find/);
      }
    );
  }));
});

// Regression coverage for the product cache's removal: a live attempt that
// fails outright (site blocked, Untappd down, a network hiccup) used to
// fall back to the last thing that DID resolve, marked stale - now it's
// just a hard error, even immediately after a successful lookup of the
// exact same SKU.
test('a SKU lookup that fails outright is a hard error, not a stale fallback', async () => {
  await withTempDb(() => withServer(async (port) => {
    let shouldFail = false;
    await withMockFetch(
      async (url) => {
        if (shouldFail) return mockResponse({ status: 403 });
        if (url.includes('/store/search.asp')) return mockResponse({ body: storeSearchHtml('09144') });
        return mockResponse({ body: storeProductHtml });
      },
      async () => {
        const first = await postJson(port, '/api/sku-lookup', { sku: '09144', category: 'wine' });
        assert.equal(first.status, 200);
        assert.equal(first.body.title, 'Michelob ULTRA');

        shouldFail = true;
        const second = await postJson(port, '/api/sku-lookup', { sku: '09144', category: 'wine' });
        assert.equal(second.status, 502);
        assert.ok(second.body.error, 'a failed live attempt should surface a real error message');
      }
    );
  }));
});

// ================================================================
// /api/import-url ("Import from website") for a liquoroutletwinecellars.com
// product URL pasted in directly, rather than looked up by SKU. Generic
// retail parsing (parseProductHtml) has nothing on this site to read Size
// or Price from - see the note above isStoreUrl in productImport.js - so
// this confirms the route delegates to the store-specific parser instead
// and both fields actually come back filled in.
// ================================================================

test('/api/import-url fills in Size and Price for a liquoroutletwinecellars.com product URL', async () => {
  await withTempDb(() => withServer(async (port) => {
    await withMockFetch(
      async () => mockResponse({ body: storeProductHtml }),
      async () => {
        const result = await postJson(port, '/api/import-url', {
          url: 'https://www.liquoroutletwinecellars.com/Michelob-ULTRA-09144-1009144/',
          category: 'wine',
        });
        assert.equal(result.status, 200);
        assert.equal(result.body.title, 'Michelob ULTRA');
        assert.equal(result.body.price, '8.99');
        assert.equal(result.body.size, '12pk-12oz Cans');
      }
    );
  }));
});

// The page's own H1 can trail off with the container size ("Cabernet
// Sauvignon 750mL") - the Product Title field should read just the
// producer + name, not that size repeated a second time on top of the new
// Size field above.
test('/api/import-url strips the container size out of the title for a liquoroutletwinecellars.com product URL', async () => {
  const sizedTitleHtml = page({
    body: `
      <h1 itemprop="name">Cabernet Sauvignon 750mL</h1>
      <h6><a href="/brand/josh-cellars">Josh Cellars</a></h6>
      <div class="pricingDetails"><span class="priceFull">$14.99</span></div>
      <table><tr><th>Size</th><td>750mL</td></tr></table>
    `,
  });
  await withTempDb(() => withServer(async (port) => {
    await withMockFetch(
      async () => mockResponse({ body: sizedTitleHtml }),
      async () => {
        const result = await postJson(port, '/api/import-url', {
          url: 'https://www.liquoroutletwinecellars.com/Josh-Cellars-Cabernet-55555-1055555/',
          category: 'wine',
        });
        assert.equal(result.status, 200);
        assert.equal(result.body.title, 'Josh Cellars Cabernet Sauvignon');
        assert.equal(result.body.size, '750mL');
      }
    );
  }));
});

// ================================================================
// /api/upc-lookup's Wine/Spirits store-description enrichment (see the
// comment above the route in server/index.js), mirroring the
// /api/sku-lookup tests above.
// ================================================================

function writeUpcExport(dir, rows) {
  const filePath = path.join(dir, 'export.csv');
  fs.writeFileSync(filePath, ['UPC,Title,SKU,Notes', ...rows].join('\n'), 'utf-8');
  return filePath;
}

test('a Wine/Spirits UPC scan replaces the export file\'s own description with the store site\'s', async () => {
  await withTempDb((dir) => withServer(async (port) => {
    setUpcSettings(writeUpcExport(dir, ['085000010652,Josh Cellars Cabernet Sauvignon,55555,internal note: reorder soon']));
    const storeProductHtml = page({
      body: '<h1 itemprop="name">Josh Cellars Cabernet Sauvignon</h1>'
        + '<div id="description"><div class="text-product-desc">Rich, full-bodied with notes of dark fruit and oak.</div></div>',
    });
    await withMockFetch(
      async (url) => mockResponse({ body: url.includes('/store/search.asp') ? storeSearchHtml('55555') : storeProductHtml }),
      async () => {
        const result = await postJson(port, '/api/upc-lookup', { upc: '085000010652', category: 'wine' });
        assert.equal(result.status, 200);
        assert.equal(result.body.title, 'Josh Cellars Cabernet Sauvignon');
        assert.equal(result.body.description, 'Rich, full-bodied with notes of dark fruit and oak.');
      }
    );
  }));
});

test('a Beer UPC scan pulls current pricing from the store site and the remaining fields from Untappd', async () => {
  await withTempDb((dir) => withServer(async (port) => {
    setUpcSettings(writeUpcExport(dir, ['019214600037,Corona Extra 12pk Cans,55555,internal note: reorder soon']));
    const storeProductHtml = page({
      body: '<h1 itemprop="name">Corona Extra 12pk Cans</h1>'
        + '<div class="pricingDetails"><span class="priceFull">$14.99</span></div>',
    });
    const algoliaBody = algoliaHitsResponse([
      { beer_slug: 'grupo-modelo-corona-extra', bid: 4321, beer_name: 'Corona Extra', brewery_name: 'Grupo Modelo' },
    ]);
    const untappdBeerHtml = page({
      head: '<meta property="og:title" content="Corona Extra by Grupo Modelo | Untappd" />',
      body: '<p class="brewery"><a href="#">Grupo Modelo</a></p><p class="style">Pale Lager</p>'
        + '<div class="details"><p class="abv">4.60% ABV</p></div>',
    });
    await withMockFetch(
      async (url) => {
        if (url.includes('/store/search.asp')) return mockResponse({ body: storeSearchHtml('55555') });
        if (url.includes('algolia.net')) return mockResponse({ body: algoliaBody });
        if (url.includes('liquoroutletwinecellars.com')) return mockResponse({ body: storeProductHtml });
        return mockResponse({ body: untappdBeerHtml });
      },
      async () => {
        const result = await postJson(port, '/api/upc-lookup', { upc: '019214600037', category: 'beer' });
        assert.equal(result.status, 200);
        // Pricing comes from the store site, not the (stale) export value.
        assert.equal(result.body.price, '14.99');
        // Brewery/style/ABV/description come from Untappd, replacing the
        // export's own internal note - same as SKU Lookup's beer path.
        assert.equal(result.body.brewery, 'Grupo Modelo');
        assert.equal(result.body.style, 'Pale Lager');
        assert.equal(result.body.abv, '4.6%');
        assert.equal(result.body.description, '');
        assert.equal(result.body.storeSourceError, undefined);
        assert.equal(result.body.untappdError, undefined);
      }
    );
  }));
});

test('switching a looked-up UPC from Beer to Wine/Spirits re-runs its own store description lookup', async () => {
  await withTempDb((dir) => withServer(async (port) => {
    setUpcSettings(writeUpcExport(dir, ['085000010652,Josh Cellars Cabernet Sauvignon,55555,internal note: reorder soon']));
    const storeProductHtml = page({
      body: '<h1 itemprop="name">Josh Cellars Cabernet Sauvignon</h1>'
        + '<div class="pricingDetails"><span class="priceFull">$13.99</span></div>'
        + '<div id="description"><div class="text-product-desc">Rich, full-bodied with notes of dark fruit and oak.</div></div>',
    });
    const calls = [];
    await withMockFetch(
      async (url) => {
        calls.push(url);
        if (url.includes('/store/search.asp')) return mockResponse({ body: storeSearchHtml('55555') });
        if (url.includes('algolia.net')) return mockResponse({ body: algoliaHitsResponse([]) }); // Untappd: no match, best-effort
        return mockResponse({ body: storeProductHtml });
      },
      async () => {
        // The store page here has its own real description, so it wins
        // over the export's internal note even though Untappd itself has
        // no match.
        const beerResult = await postJson(port, '/api/upc-lookup', { upc: '085000010652', category: 'beer' });
        assert.equal(beerResult.body.price, '13.99');
        assert.equal(beerResult.body.description, 'Rich, full-bodied with notes of dark fruit and oak.');
        assert.match(beerResult.body.untappdError, /Could not find/);
        const callsAfterBeer = calls.length;
        assert.ok(callsAfterBeer > 0, 'a Beer scan should hit the network for price + Untappd');

        const wineResult = await postJson(port, '/api/upc-lookup', { upc: '085000010652', category: 'wine' });
        assert.equal(wineResult.body.description, 'Rich, full-bodied with notes of dark fruit and oak.');
        assert.ok(calls.length > callsAfterBeer, 'switching to Wine/Spirits should run its own store description lookup');
      }
    );
  }));
});

test('a Beer UPC scan surfaces storeSourceError when the store has no match for the export\'s SKU, but still tries Untappd off the local title', async () => {
  await withTempDb((dir) => withServer(async (port) => {
    setUpcSettings(writeUpcExport(dir, ['019214600037,Corona Extra 12pk Cans,99999,internal note: reorder soon']));
    const algoliaBody = algoliaHitsResponse([
      { beer_slug: 'grupo-modelo-corona-extra', bid: 4321, beer_name: 'Corona Extra', brewery_name: 'Grupo Modelo' },
    ]);
    const untappdBeerHtml = page({
      head: '<meta property="og:title" content="Corona Extra by Grupo Modelo | Untappd" />',
      body: '<p class="brewery"><a href="#">Grupo Modelo</a></p><p class="style">Pale Lager</p>',
    });
    await withMockFetch(
      async (url) => {
        if (url.includes('/store/search.asp')) return mockResponse({ body: page({ body: '' }) }); // no card matches 99999
        if (url.includes('algolia.net')) return mockResponse({ body: algoliaBody });
        return mockResponse({ body: untappdBeerHtml });
      },
      async () => {
        const result = await postJson(port, '/api/upc-lookup', { upc: '019214600037', category: 'beer' });
        assert.equal(result.status, 200);
        assert.match(result.body.storeSourceError, /No product found for SKU "99999"/);
        // The store lookup failing doesn't also skip Untappd - it still ran
        // off the local export's own title, and found a match.
        assert.equal(result.body.brewery, 'Grupo Modelo');
        assert.equal(result.body.untappdError, undefined);
      }
    );
  }));
});

// ================================================================
// /api/export-price - backs the Bourbon Library profile page's Price row
// (a library entry's own `sku`, checked against the local WinePOS export
// file). The underlying lookup logic (SKU matching, error codes) is
// already covered in depth in test/upcCatalog.test.js against
// lookupSkuInExport directly - these just confirm the HTTP layer wraps it
// correctly.
// ================================================================

test('GET /api/export-price returns the export file\'s price for a matching SKU', async () => {
  await withTempDb((dir) => withServer(async (port) => {
    const filePath = path.join(dir, 'export.csv');
    fs.writeFileSync(filePath, ['UPC,Title,SKU,Regular Price', '085000010652,Buffalo Trace,12345,24.99'].join('\n'), 'utf-8');
    setUpcSettings(filePath);
    const result = await getJson(port, '/api/export-price?sku=12345');
    assert.equal(result.status, 200);
    assert.equal(result.body.price, '24.99');
    assert.equal(result.body.title, 'Buffalo Trace');
  }));
});

test('GET /api/export-price 404s with SKU_NOT_FOUND for a SKU absent from the file', async () => {
  await withTempDb((dir) => withServer(async (port) => {
    const filePath = path.join(dir, 'export.csv');
    fs.writeFileSync(filePath, ['UPC,Title,SKU,Regular Price', '085000010652,Buffalo Trace,12345,24.99'].join('\n'), 'utf-8');
    setUpcSettings(filePath);
    const result = await getJson(port, '/api/export-price?sku=00000');
    assert.equal(result.status, 404);
    assert.equal(result.body.code, 'SKU_NOT_FOUND');
  }));
});

test('GET /api/export-price requires a sku query param', async () => {
  await withTempDb(() => withServer(async (port) => {
    const result = await getJson(port, '/api/export-price');
    assert.equal(result.status, 400);
  }));
});

// ================================================================
// /api/name-search - see the comment above the route in server/index.js.
// The ranking/error-code behavior itself is covered in
// test/upcCatalog.test.js against searchByName directly; these confirm the
// HTTP layer wraps it correctly (query param parsing, status codes, the
// blank-query short circuit).
// ================================================================

test('GET /api/name-search returns ranked matches from the configured export file', async () => {
  await withTempDb((dir) => withServer(async (port) => {
    setUpcSettings(writeUpcExport(dir, [
      '1,Josh Cellars Cabernet Sauvignon,10432,',
      '2,Josh Cellars Chardonnay,10433,',
      '3,14 Hands Cabernet Sauvignon,9415,',
    ]));
    const { status, body } = await getJson(port, '/api/name-search?q=josh');
    assert.equal(status, 200);
    assert.deepEqual(body.results.map((p) => p.title), ['Josh Cellars Cabernet Sauvignon', 'Josh Cellars Chardonnay']);
  }));
});

test('GET /api/name-search returns an empty result list for a blank query instead of an error', async () => {
  await withTempDb(() => withServer(async (port) => {
    const { status, body } = await getJson(port, '/api/name-search');
    assert.equal(status, 200);
    assert.deepEqual(body.results, []);
  }));
});

test('GET /api/name-search reports a 404 with NO_EXPORT_PATH when nothing has been configured yet', async () => {
  await withTempDb(() => withServer(async (port) => {
    const { status, body } = await getJson(port, '/api/name-search?q=josh');
    assert.equal(status, 404);
    assert.equal(body.code, 'NO_EXPORT_PATH');
  }));
});

// ================================================================
// /api/name-search-select - backs picking a candidate off the "Search by
// Name" tab's dropdown (see the comment above the route in
// server/index.js). No export file/setUpcSettings needed here - unlike
// /api/name-search above, this never reads the export itself, only the
// `product` the client already got back from that endpoint.
// ================================================================

test('POST /api/name-search-select runs a Beer pick through Untappd, same as SKU Lookup\'s beer path', async () => {
  await withTempDb(() => withServer(async (port) => {
    const algoliaBody = algoliaHitsResponse([
      { beer_slug: 'grupo-modelo-corona-extra', bid: 4321, beer_name: 'Corona Extra', brewery_name: 'Grupo Modelo' },
    ]);
    const untappdBeerHtml = page({
      head: '<meta property="og:title" content="Corona Extra by Grupo Modelo | Untappd" />',
      body: '<p class="brewery"><a href="#">Grupo Modelo</a></p><p class="style">Pale Lager</p>'
        + '<div class="details"><p class="abv">4.60% ABV</p></div>',
    });
    await withMockFetch(
      async (url) => (url.includes('algolia.net') ? mockResponse({ body: algoliaBody }) : mockResponse({ body: untappdBeerHtml })),
      async () => {
        const product = { title: 'Corona Extra 12pk Cans', sku: '55555', price: '14.99', brand: 'Corona' };
        const result = await postJson(port, '/api/name-search-select', { product, category: 'beer' });
        assert.equal(result.status, 200);
        // The export's own price/sku carry straight through - only
        // Untappd's own fields (brewery/style/ABV) get layered on top.
        assert.equal(result.body.price, '14.99');
        assert.equal(result.body.sku, '55555');
        assert.equal(result.body.brewery, 'Grupo Modelo');
        assert.equal(result.body.style, 'Pale Lager');
        assert.equal(result.body.abv, '4.6%');
        assert.equal(result.body.untappdError, undefined);
      }
    );
  }));
});

test('POST /api/name-search-select checks the store site for a sale price on a Wine/Spirits pick (no Untappd data to fetch)', async () => {
  await withTempDb(() => withServer(async (port) => {
    const searchHtml = page({
      body: `
        <div class="product-list-item">
          <input class="product-code" type="hidden" value="10432" />
          <a class="product-link" href="/Josh-Cellars-Cabernet-Sauvignon-10432-1010432/">
            <span class="productnameTitle">Josh Cellars Cabernet Sauvignon</span>
          </a>
        </div>
      `,
    });
    const productHtml = page({
      body: `
        <h1 itemprop="name">Josh Cellars Cabernet Sauvignon</h1>
        <div class="pricingDetails">
          <span class="priceFull">$12.99</span>
          <span class="priceCurrent">$9.99</span>
        </div>
      `,
    });
    const requestedUrls = [];
    await withMockFetch(
      async (url) => {
        requestedUrls.push(url);
        return mockResponse({ body: url.includes('/store/search.asp') ? searchHtml : productHtml });
      },
      async () => {
        const product = { title: 'Josh Cellars Cabernet Sauvignon', sku: '10432', price: '12.99', vintage: '2021' };
        const result = await postJson(port, '/api/name-search-select', { product, category: 'wine' });
        assert.equal(result.status, 200);
        // Title/vintage/price all still come from the export's own product,
        // untouched - only salePrice is taken from the store site.
        assert.equal(result.body.title, 'Josh Cellars Cabernet Sauvignon');
        assert.equal(result.body.vintage, '2021');
        assert.equal(result.body.price, '12.99');
        assert.equal(result.body.salePrice, '9.99');
      }
    );
    assert.equal(requestedUrls.length, 2, 'should search, then fetch the matched product page');
  }));
});

test('POST /api/name-search-select leaves salePrice blank (rather than failing the pick) when the store site has no match for the SKU', async () => {
  await withTempDb(() => withServer(async (port) => {
    const searchHtml = page({ body: '<div class="no-results">No products found.</div>' });
    await withMockFetch(
      async () => mockResponse({ body: searchHtml }),
      async () => {
        const product = { title: 'Josh Cellars Cabernet Sauvignon', sku: '99999', price: '12.99', vintage: '2021' };
        const result = await postJson(port, '/api/name-search-select', { product, category: 'wine' });
        assert.equal(result.status, 200);
        assert.equal(result.body.title, 'Josh Cellars Cabernet Sauvignon');
        assert.equal(result.body.price, '12.99');
        assert.equal(result.body.salePrice, undefined);
        assert.match(result.body.salePriceSourceError, /No product found for SKU/);
      }
    );
  }));
});

test('POST /api/name-search-select surfaces untappdError when Untappd has no match, without failing the pick', async () => {
  await withTempDb(() => withServer(async (port) => {
    await withMockFetch(
      async () => mockResponse({ body: algoliaHitsResponse([]) }),
      async () => {
        const product = { title: 'Corona Extra 12pk Cans', sku: '55555', price: '14.99' };
        const result = await postJson(port, '/api/name-search-select', { product, category: 'beer' });
        assert.equal(result.status, 200);
        assert.equal(result.body.price, '14.99');
        assert.match(result.body.untappdError, /Could not find/);
      }
    );
  }));
});

test('POST /api/name-search-select re-runs the Untappd search on a second pick of the same SKU, same as SKU Lookup/Scan UPC', async () => {
  await withTempDb(() => withServer(async (port) => {
    const algoliaBody = algoliaHitsResponse([
      { beer_slug: 'grupo-modelo-corona-extra', bid: 4321, beer_name: 'Corona Extra', brewery_name: 'Grupo Modelo' },
    ]);
    const untappdBeerHtml = page({
      head: '<meta property="og:title" content="Corona Extra by Grupo Modelo | Untappd" />',
      body: '<p class="brewery"><a href="#">Grupo Modelo</a></p>',
    });
    const calls = [];
    await withMockFetch(
      async (url) => {
        calls.push(url);
        return url.includes('algolia.net') ? mockResponse({ body: algoliaBody }) : mockResponse({ body: untappdBeerHtml });
      },
      async () => {
        const product = { title: 'Corona Extra 12pk Cans', sku: '55555', price: '14.99' };
        const first = await postJson(port, '/api/name-search-select', { product, category: 'beer' });
        assert.equal(first.status, 200);
        const callsAfterFirst = calls.length;
        assert.ok(callsAfterFirst > 0);

        const second = await postJson(port, '/api/name-search-select', { product, category: 'beer' });
        assert.equal(second.body.brewery, 'Grupo Modelo');
        assert.ok(calls.length > callsAfterFirst, 'a second pick of the same SKU should hit the network again, not reuse a cached copy');
      }
    );
  }));
});

test('POST /api/name-search-select requires a product with a title', async () => {
  await withTempDb(() => withServer(async (port) => {
    const result = await postJson(port, '/api/name-search-select', { category: 'beer' });
    assert.equal(result.status, 400);
  }));
});

// ================================================================
// /api/app-version - backs the "What's New" popup (public/js/app.js), which
// compares this against what it last showed a popup for. Just needs to
// echo package.json's own version back.
// ================================================================

test('GET /api/app-version reports package.json\'s version', async () => {
  const { version } = require('../package.json');
  await withTempDb(() => withServer(async (port) => {
    const { status, body } = await getJson(port, '/api/app-version');
    assert.equal(status, 200);
    assert.equal(body.version, version);
  }));
});

// ================================================================
// /api/server-status - see the comment above the routes in server/index.js.
// withServer() builds its app with createApp() alone (no beacon, see
// server/discovery.js), the same as every other test in this file - these
// confirm that's a fully safe, working configuration (no crash, and a
// well-formed "nothing discovered" response) rather than something that
// only works once start() supplies a real beacon. discovery.js's own tests
// cover the beacon/wire-format behavior itself.
// ================================================================

test('GET /api/server-status reports discoveredServer: null when no beacon is wired in (createApp() alone)', async () => {
  await withTempDb(() => withServer(async (port) => {
    const { status, body } = await getJson(port, '/api/server-status');
    assert.equal(status, 200);
    assert.equal(body.isServer, false);
    assert.equal(body.discoveredServer, null);
    assert.ok(Array.isArray(body.addresses));
  }));
});

test('POST /api/server-status still persists the flag with no beacon wired in', async () => {
  await withTempDb(() => withServer(async (port) => {
    const posted = await postJson(port, '/api/server-status', { isServer: true });
    assert.equal(posted.status, 200);
    assert.equal(posted.body.isServer, true);
    assert.ok(posted.body.confirmedAt);

    const { body } = await getJson(port, '/api/server-status');
    assert.equal(body.isServer, true);
    assert.equal(body.discoveredServer, null);
  }));
});

test('POST /api/server-status starts/stops the injected exportServeServer alongside marking/unmarking isServer', async () => {
  const calls = [];
  const fakeExportServeServer = {
    start: () => { calls.push('start'); },
    stop: () => { calls.push('stop'); },
  };
  await withTempDb(() => withServerAndFakes({ exportServeServer: fakeExportServeServer }, async (port) => {
    await postJson(port, '/api/server-status', { isServer: true });
    assert.deepEqual(calls, ['start']);

    await postJson(port, '/api/server-status', { isServer: false });
    assert.deepEqual(calls, ['start', 'stop']);
  }));
});

test('POST /api/server-status with no exportServeServer wired in is still a no-op success (createApp() alone)', async () => {
  await withTempDb(() => withServer(async (port) => {
    const posted = await postJson(port, '/api/server-status', { isServer: true });
    assert.equal(posted.status, 200);
    assert.equal(posted.body.isServer, true);
  }));
});

// ================================================================
// /api/upc-settings + /api/upc-settings/auto-sync - the register-side half
// of exportSync.js (see the comment above the routes in server/index.js).
// upcCatalog.test.js already covers the underlying auto-sync/effective-path
// logic (setAutoSync, effectiveExportPath, ...) in full; these just confirm
// the HTTP layer wires it up, including the injected exportPuller's own
// status surfacing as `sync` - same "null means nothing wired in, not that
// the feature itself is off" shape as discoveredServer above.
// ================================================================

test('GET /api/upc-settings reports sync: null when no exportPuller is wired in (createApp() alone)', async () => {
  await withTempDb(() => withServer(async (port) => {
    const { status, body } = await getJson(port, '/api/upc-settings');
    assert.equal(status, 200);
    assert.equal(body.autoSync, false);
    assert.equal(body.sync, null);
  }));
});

test('GET /api/upc-settings reports the injected exportPuller\'s own status', async () => {
  const fakePuller = {
    getStatus: () => ({ lastSyncedAt: '2026-08-09T12:00:00.000Z', lastError: null, syncedFrom: 'SERVER-PC' }),
  };
  await withTempDb(() => withServerAndFakes({ exportPuller: fakePuller }, async (port) => {
    const { body } = await getJson(port, '/api/upc-settings');
    assert.deepEqual(body.sync, { lastSyncedAt: '2026-08-09T12:00:00.000Z', lastError: null, syncedFrom: 'SERVER-PC' });
  }));
});

test('POST /api/upc-settings/auto-sync turns auto-sync on/off without touching the manually configured path', async () => {
  await withTempDb(() => withServer(async (port) => {
    await postJson(port, '/api/upc-settings', { exportPath: '/tmp/whatever.csv' });

    const on = await postJson(port, '/api/upc-settings/auto-sync', { autoSync: true });
    assert.equal(on.status, 200);
    assert.equal(on.body.autoSync, true);
    assert.equal(on.body.configuredPath, '/tmp/whatever.csv');
    assert.notEqual(on.body.exportPath, '/tmp/whatever.csv'); // now the synced-copy path instead

    const off = await postJson(port, '/api/upc-settings/auto-sync', { autoSync: false });
    assert.equal(off.body.autoSync, false);
    assert.equal(off.body.configuredPath, '/tmp/whatever.csv');
    assert.equal(off.body.exportPath, '/tmp/whatever.csv');
  }));
});

// POST /api/upc-settings/sync-now - the Export File Settings dialog's "Sync
// Now" button, a forced call into the injected exportPuller's own syncOnce
// (see exportSync.js) instead of waiting for its ~30s interval.
test('POST /api/upc-settings/sync-now calls the injected exportPuller\'s syncOnce and reports its resulting status', async () => {
  let syncOnceCalls = 0;
  const fakePuller = {
    syncOnce: async () => { syncOnceCalls += 1; },
    getStatus: () => ({ lastSyncedAt: '2026-08-11T12:00:00.000Z', lastError: null, syncedFrom: 'SERVER-PC' }),
  };
  await withTempDb(() => withServerAndFakes({ exportPuller: fakePuller }, async (port) => {
    const { status, body } = await postJson(port, '/api/upc-settings/sync-now', {});
    assert.equal(status, 200);
    assert.equal(syncOnceCalls, 1);
    assert.deepEqual(body.sync, { lastSyncedAt: '2026-08-11T12:00:00.000Z', lastError: null, syncedFrom: 'SERVER-PC' });
  }));
});

test('POST /api/upc-settings/sync-now reports sync: null when no exportPuller is wired in (createApp() alone)', async () => {
  await withTempDb(() => withServer(async (port) => {
    const { status, body } = await postJson(port, '/api/upc-settings/sync-now', {});
    assert.equal(status, 200);
    assert.equal(body.sync, null);
  }));
});

// ================================================================
// /api/mashbills - the Mash Bill Library (Tools -> Mash Bill Library...,
// see the comment above the routes in server/index.js). Two shapes:
// isServer reads/writes this PC's own data.db directly (db.test.js already
// covers the underlying upsert/update/delete logic in full - these confirm
// the HTTP layer's isServer branch and status codes); not isServer relies
// on an injected mashBillPuller, same "fake object, just the methods
// createApp() actually calls" pattern as exportPuller above - the real
// puller's own behavior is covered by mashBillSync.test.js.
// ================================================================

function fakeMashBillPuller({ cached = [], status = { lastSyncedAt: null, lastError: null, syncedFrom: null }, forwardWrite } = {}) {
  return {
    getCached: () => cached,
    getStatus: () => status,
    syncOnce: async () => {},
    forwardWrite: forwardWrite || (async () => { throw new Error('forwardWrite not stubbed for this test'); }),
  };
}

test('GET /api/mashbills reads this PC\'s own data.db directly once marked isServer', async () => {
  await withTempDb(() => withServer(async (port) => {
    await postJson(port, '/api/server-status', { isServer: true });
    await postJson(port, '/api/mashbills', { title: 'Four Roses Single Barrel', distillery: 'Four Roses', grains: [{ grain: 'Corn', pct: 75 }] });

    const { status, body } = await getJson(port, '/api/mashbills');
    assert.equal(status, 200);
    assert.equal(body.mashBills.length, 1);
    assert.equal(body.mashBills[0].title, 'Four Roses Single Barrel');
    assert.deepEqual(body.sync, { isServer: true });
  }));
});

test('GET /api/mashbills falls back to an empty cached list with no puller wired in (createApp() alone)', async () => {
  await withTempDb(() => withServer(async (port) => {
    const { status, body } = await getJson(port, '/api/mashbills');
    assert.equal(status, 200);
    assert.deepEqual(body.mashBills, []);
    assert.equal(body.sync.isServer, false);
  }));
});

test('GET /api/mashbills reports the injected mashBillPuller\'s cached list and status when not isServer', async () => {
  const puller = fakeMashBillPuller({
    cached: [{ id: 1, title: 'Larceny' }],
    status: { lastSyncedAt: '2026-08-13T12:00:00.000Z', lastError: null, syncedFrom: 'SERVER-PC' },
  });
  await withTempDb(() => withServerAndFakes({ mashBillPuller: puller }, async (port) => {
    const { body } = await getJson(port, '/api/mashbills');
    assert.deepEqual(body.mashBills, [{ id: 1, title: 'Larceny' }]);
    assert.equal(body.sync.isServer, false);
    assert.equal(body.sync.syncedFrom, 'SERVER-PC');
  }));
});

test('POST /api/mashbills upserts directly once isServer, requires a title', async () => {
  await withTempDb(() => withServer(async (port) => {
    await postJson(port, '/api/server-status', { isServer: true });

    const missingTitle = await postJson(port, '/api/mashbills', { grains: [{ grain: 'Corn', pct: 90 }] });
    assert.equal(missingTitle.status, 400);

    const created = await postJson(port, '/api/mashbills', { title: 'Eagle Rare', grains: [{ grain: 'Corn', pct: 90 }] });
    assert.equal(created.status, 201);
    assert.equal(created.body.title, 'Eagle Rare');
  }));
});

// Route-level check that the Bourbon Library fields (parentCompany,
// category, sku, nose/palate/finish, tastingSource, confidence) actually
// reach db.js rather than being silently dropped by this route's own
// destructuring - db.test.js already covers upsertMashBill/rowToMashBill
// in depth, this just confirms the wiring in between. `sku` in particular
// used to be dropped here (mashBillOptionalFields never destructured it,
// even though db.js's own mashBillOptionalFieldParams always accepted it),
// so a SKU typed into the Manage Mash Bill Library dialog silently never
// reached the database - only db.js's own tests and the seed script (which
// calls upsertMashBill directly, bypassing this route) ever exercised it.
test('POST /api/mashbills persists Bourbon Library fields (parent company, tasting notes, confidence), PUT updates them', async () => {
  await withTempDb(() => withServer(async (port) => {
    await postJson(port, '/api/server-status', { isServer: true });

    const created = await postJson(port, '/api/mashbills', {
      title: 'Buffalo Trace',
      distillery: 'Buffalo Trace Distillery',
      grains: [{ grain: 'Corn', pct: 90 }],
      parentCompany: 'Sazerac Company',
      category: 'Kentucky Straight Bourbon',
      sku: '12345',
      nose: 'Vanilla, brown sugar, mint',
      palate: 'Brown sugar and spice',
      finish: 'Long and smooth',
      tastingSource: 'Distillery official tasting notes',
      confidence: {
        tier: 'confirmed', note: 'Publicly confirmed.', verifiedAt: '2026-01-15',
      },
      references: [{ label: 'Distillery site', url: 'https://example.com', tags: ['Mash Bill'] }],
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.parentCompany, 'Sazerac Company');
    assert.equal(created.body.category, 'Kentucky Straight Bourbon');
    assert.equal(created.body.sku, '12345');
    assert.equal(created.body.nose, 'Vanilla, brown sugar, mint');
    assert.deepEqual(created.body.confidence, {
      tier: 'confirmed', note: 'Publicly confirmed.', verifiedAt: '2026-01-15',
    });
    assert.deepEqual(created.body.references, [{ label: 'Distillery site', url: 'https://example.com', tags: ['Mash Bill'] }]);

    const updated = await requestJson(port, 'PUT', `/api/mashbills/${created.body.id}`, {
      confidence: { tier: 'estimated' },
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.confidence, {
      tier: 'estimated', note: '', verifiedAt: '',
    });
    // Fields left off the PUT payload stay untouched.
    assert.equal(updated.body.parentCompany, 'Sazerac Company');
    assert.equal(updated.body.sku, '12345');
    assert.equal(updated.body.nose, 'Vanilla, brown sugar, mint');
    assert.deepEqual(updated.body.references, [{ label: 'Distillery site', url: 'https://example.com', tags: ['Mash Bill'] }]);
  }));
});

test('POST /api/mashbills forwards to the injected mashBillPuller when not isServer', async () => {
  let forwarded = null;
  const puller = fakeMashBillPuller({
    forwardWrite: async (method, path, body) => {
      forwarded = { method, path, body };
      return { status: 201, data: { id: 1, ...body } };
    },
  });
  await withTempDb(() => withServerAndFakes({ mashBillPuller: puller }, async (port) => {
    const { status, body } = await postJson(port, '/api/mashbills', { title: 'Larceny', grains: [{ grain: 'Corn', pct: 68 }] });
    assert.equal(status, 201);
    assert.equal(body.title, 'Larceny');
    assert.deepEqual(forwarded, {
      method: 'POST',
      path: '/mashbills',
      body: {
        title: 'Larceny', distillery: undefined, grains: [{ grain: 'Corn', pct: 68 }], source: undefined,
        parentCompany: undefined, category: undefined, sku: undefined, nose: undefined, palate: undefined, finish: undefined,
        tastingSource: undefined, confidence: undefined, references: undefined,
      },
    });
  }));
});

test('POST /api/mashbills reports 503 with no mashBillPuller wired in and not isServer (createApp() alone)', async () => {
  await withTempDb(() => withServer(async (port) => {
    const { status } = await postJson(port, '/api/mashbills', { title: 'Larceny', grains: [{ grain: 'Corn', pct: 68 }] });
    assert.equal(status, 503);
  }));
});

test('POST /api/mashbills surfaces a Server PC unreachable error from forwardWrite as a 502', async () => {
  const puller = fakeMashBillPuller({
    forwardWrite: async () => { throw new Error('No Server PC found on this network yet.'); },
  });
  await withTempDb(() => withServerAndFakes({ mashBillPuller: puller }, async (port) => {
    const { status, body } = await postJson(port, '/api/mashbills', { title: 'Larceny', grains: [{ grain: 'Corn', pct: 68 }] });
    assert.equal(status, 502);
    assert.match(body.error, /No Server PC found/);
  }));
});

test('PUT /api/mashbills/:id updates directly once isServer, 404s for an unknown id, 409s on a title collision', async () => {
  await withTempDb(() => withServer(async (port) => {
    await postJson(port, '/api/server-status', { isServer: true });
    const a = await postJson(port, '/api/mashbills', { title: 'Eagle Rare', grains: [{ grain: 'Corn', pct: 90 }] });
    const b = await postJson(port, '/api/mashbills', { title: "Blanton's", grains: [{ grain: 'Corn', pct: 75 }] });

    const updated = await requestJson(port, 'PUT', `/api/mashbills/${a.body.id}`, { title: 'Eagle Rare 17 Year', grains: [{ grain: 'Corn', pct: 90 }] });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.title, 'Eagle Rare 17 Year');

    const missing = await requestJson(port, 'PUT', '/api/mashbills/999999', { title: 'Nope', grains: [{ grain: 'Corn', pct: 90 }] });
    assert.equal(missing.status, 404);

    const collision = await requestJson(port, 'PUT', `/api/mashbills/${b.body.id}`, { title: 'eagle rare 17 year', grains: [{ grain: 'Corn', pct: 75 }] });
    assert.equal(collision.status, 409);
  }));
});

test('PUT /api/mashbills/:id forwards to the injected mashBillPuller when not isServer', async () => {
  let forwarded = null;
  const puller = fakeMashBillPuller({
    forwardWrite: async (method, path, body) => {
      forwarded = { method, path, body };
      return { status: 200, data: { id: 7, ...body } };
    },
  });
  await withTempDb(() => withServerAndFakes({ mashBillPuller: puller }, async (port) => {
    const { status, body } = await requestJson(port, 'PUT', '/api/mashbills/7', { title: 'Larceny', grains: [{ grain: 'Corn', pct: 68 }] });
    assert.equal(status, 200);
    assert.equal(body.id, 7);
    assert.equal(forwarded.path, '/mashbills/7');
  }));
});

test('DELETE /api/mashbills/:id deletes directly once isServer, 404s for an unknown id', async () => {
  await withTempDb(() => withServer(async (port) => {
    await postJson(port, '/api/server-status', { isServer: true });
    const created = await postJson(port, '/api/mashbills', { title: 'Larceny', grains: [{ grain: 'Corn', pct: 68 }] });

    const deleted = await requestJson(port, 'DELETE', `/api/mashbills/${created.body.id}`);
    assert.equal(deleted.status, 200);
    assert.deepEqual((await getJson(port, '/api/mashbills')).body.mashBills, []);

    const missing = await requestJson(port, 'DELETE', `/api/mashbills/${created.body.id}`);
    assert.equal(missing.status, 404);
  }));
});

test('DELETE /api/mashbills/:id forwards to the injected mashBillPuller when not isServer', async () => {
  let forwarded = null;
  const puller = fakeMashBillPuller({
    forwardWrite: async (method, path) => {
      forwarded = { method, path };
      return { status: 200, data: { success: true } };
    },
  });
  await withTempDb(() => withServerAndFakes({ mashBillPuller: puller }, async (port) => {
    const { status, body } = await requestJson(port, 'DELETE', '/api/mashbills/7');
    assert.equal(status, 200);
    assert.deepEqual(body, { success: true });
    assert.deepEqual(forwarded, { method: 'DELETE', path: '/mashbills/7' });
  }));
});

test('POST /api/mashbills/sync-now calls the injected mashBillPuller\'s syncOnce, then reports isServer:false status', async () => {
  let syncOnceCalls = 0;
  const puller = fakeMashBillPuller({
    cached: [{ id: 1, title: 'Larceny' }],
    status: { lastSyncedAt: '2026-08-13T12:00:00.000Z', lastError: null, syncedFrom: 'SERVER-PC' },
  });
  puller.syncOnce = async () => { syncOnceCalls += 1; };
  await withTempDb(() => withServerAndFakes({ mashBillPuller: puller }, async (port) => {
    const { status, body } = await postJson(port, '/api/mashbills/sync-now', {});
    assert.equal(status, 200);
    assert.equal(syncOnceCalls, 1);
    assert.deepEqual(body.mashBills, [{ id: 1, title: 'Larceny' }]);
  }));
});

test('POST /api/mashbills/sync-now reports this PC\'s own data.db once isServer, ignoring any cached puller list', async () => {
  const puller = fakeMashBillPuller({ cached: [{ id: 999, title: 'Should not appear' }] });
  await withTempDb(() => withServerAndFakes({ mashBillPuller: puller }, async (port) => {
    await postJson(port, '/api/server-status', { isServer: true });
    await postJson(port, '/api/mashbills', { title: 'Eagle Rare', grains: [{ grain: 'Corn', pct: 90 }] });

    const { body } = await postJson(port, '/api/mashbills/sync-now', {});
    assert.equal(body.sync.isServer, true);
    assert.equal(body.mashBills.length, 1);
    assert.equal(body.mashBills[0].title, 'Eagle Rare');
  }));
});

// POST /api/mashbills/sync-library - the Server PC dialog's "Check GitHub
// for New Bourbons" button (the manual, already-populated-library
// counterpart to bourbonLibrarySeed.js's own auto-seed).

test('POST /api/mashbills/sync-library is rejected on a non-Server PC', async () => {
  await withTempDb(() => withServerAndFakes({}, async (port) => {
    const { status, body } = await postJson(port, '/api/mashbills/sync-library', {});
    assert.equal(status, 400);
    assert.match(body.error, /Server PC/);
  }));
});

test('POST /api/mashbills/sync-library adds only new titles on the Server PC, leaving an existing entry untouched', async () => {
  await withTempDb(() => withServerAndFakes({}, async (port) => {
    await postJson(port, '/api/server-status', { isServer: true });
    await postJson(port, '/api/mashbills', {
      title: 'Buffalo Trace', distillery: 'Local Edit', grains: [{ grain: 'Corn', pct: 100 }],
    });

    await withMockFetch(
      async () => ({
        ok: true,
        status: 200,
        json: async () => [
          { title: 'Buffalo Trace', distillery: 'GitHub Version', grains: [{ grain: 'Corn', pct: 90 }] },
          { title: "Maker's Mark", distillery: "Maker's Mark Distillery", grains: [{ grain: 'Corn', pct: 70 }] },
        ],
      }),
      async () => {
        const { status, body } = await postJson(port, '/api/mashbills/sync-library', {});
        assert.equal(status, 200);
        assert.equal(body.added, 1);
        assert.equal(body.skipped, 1);
        assert.equal(body.source, 'GitHub');
        assert.equal(body.mashBills.length, 2);
        const buffaloTrace = body.mashBills.find((m) => m.title === 'Buffalo Trace');
        assert.equal(buffaloTrace.distillery, 'Local Edit');
      },
    );
  }));
});

// /api/beers - the Beer Bible (rail "Beer Bible" view), a bare-scaffold
// first cut of the same idea as /api/mashbills above, for Beer instead of
// Bourbon. Unlike those routes, there's no isServer/mashBillPuller
// branching to cover here - every route always reads/writes this PC's own
// data.db directly (see the beers table comment in db.js), so plain
// withServer (no injected fakes) is enough for every test below.

test('GET /api/beers returns an empty list on a fresh database', async () => {
  await withTempDb(() => withServer(async (port) => {
    const { status, body } = await getJson(port, '/api/beers');
    assert.equal(status, 200);
    assert.deepEqual(body.beers, []);
  }));
});

test('POST /api/beers creates an entry and requires a title', async () => {
  await withTempDb(() => withServer(async (port) => {
    const missingTitle = await postJson(port, '/api/beers', { brewery: 'Anheuser-Busch' });
    assert.equal(missingTitle.status, 400);

    const created = await postJson(port, '/api/beers', {
      title: 'Michelob ULTRA', brewery: 'Anheuser-Busch', style: 'Light Lager', abv: '4.2%', ibu: '',
      untappdRating: '3.3', untappdRatingCount: '5,201', description: 'A superior light beer.', sku: '09144',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.title, 'Michelob ULTRA');
    assert.equal(created.body.brewery, 'Anheuser-Busch');
    assert.equal(created.body.style, 'Light Lager');
    assert.equal(created.body.abv, '4.2%');
    assert.equal(created.body.untappdRating, '3.3');
    assert.equal(created.body.untappdRatingCount, '5,201');
    assert.equal(created.body.description, 'A superior light beer.');
    assert.equal(created.body.sku, '09144');

    const { body } = await getJson(port, '/api/beers');
    assert.equal(body.beers.length, 1);
    assert.equal(body.beers[0].title, 'Michelob ULTRA');
  }));
});

test('PUT /api/beers/:id updates fields (preserving an omitted one), 404s for an unknown id, 409s on a title collision', async () => {
  await withTempDb(() => withServer(async (port) => {
    const a = await postJson(port, '/api/beers', { title: 'Sam Adams Boston Lager', brewery: 'Boston Beer Company' });
    const b = await postJson(port, '/api/beers', { title: 'Dogfish Head 60 Minute IPA' });

    const updated = await requestJson(port, 'PUT', `/api/beers/${a.body.id}`, { abv: '5.0%' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.abv, '5.0%');
    // brewery wasn't passed to this update, so it's unchanged.
    assert.equal(updated.body.brewery, 'Boston Beer Company');

    const missing = await requestJson(port, 'PUT', '/api/beers/999999', { title: 'Nope' });
    assert.equal(missing.status, 404);

    const collision = await requestJson(port, 'PUT', `/api/beers/${b.body.id}`, { title: 'sam adams boston lager' });
    assert.equal(collision.status, 409);
  }));
});

test('DELETE /api/beers/:id deletes and 404s for an unknown id', async () => {
  await withTempDb(() => withServer(async (port) => {
    const created = await postJson(port, '/api/beers', { title: 'Founders All Day IPA' });
    const deleted = await requestJson(port, 'DELETE', `/api/beers/${created.body.id}`);
    assert.equal(deleted.status, 200);
    assert.deepEqual((await getJson(port, '/api/beers')).body.beers, []);

    const missing = await requestJson(port, 'DELETE', `/api/beers/${created.body.id}`);
    assert.equal(missing.status, 404);
  }));
});

test('POST /api/beers/sync-library adds only new titles, leaving an existing entry untouched - not gated behind Server PC', async () => {
  await withTempDb(() => withServer(async (port) => {
    // Deliberately not marked isServer - unlike /api/mashbills/sync-library,
    // this route works on any PC (see the beers table comment in db.js).
    await postJson(port, '/api/beers', { title: 'Slack Tide Flounder Pounder', brewery: 'Local Edit' });

    await withMockFetch(
      async () => ({
        ok: true,
        status: 200,
        json: async () => [
          { title: 'Slack Tide Flounder Pounder', brewery: 'GitHub Version' },
          { title: 'Michelob ULTRA', brewery: 'Anheuser-Busch' },
        ],
      }),
      async () => {
        const { status, body } = await postJson(port, '/api/beers/sync-library', {});
        assert.equal(status, 200);
        assert.equal(body.added, 1);
        assert.equal(body.skipped, 1);
        assert.equal(body.source, 'GitHub');
        assert.equal(body.beers.length, 2);
        const flounderPounder = body.beers.find((b) => b.title === 'Slack Tide Flounder Pounder');
        assert.equal(flounderPounder.brewery, 'Local Edit');
      },
    );
  }));
});
