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
// changes, so each test gets its own isolated SQLite file/cache.
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
function withServerAndFakes({ beacon, exportServeServer, exportPuller } = {}, run) {
  const app = createApp({ beacon, exportServeServer, exportPuller });
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

// ================================================================
// /api/sku-lookup's category-aware cache - see the comment above the route
// in server/index.js. The cache is keyed by SKU alone, not category, so
// these confirm a same-SKU, different-category re-lookup within the 24h
// freshness window actually re-runs the store+Untappd lookup instead of
// silently reusing the other category's cached copy.
// ================================================================

test('a second SKU lookup in the same category reuses the fresh cache instead of hitting the network again', async () => {
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
        assert.equal(first.body.fromCache, undefined);
        assert.equal(first.body.title, 'Michelob ULTRA');

        const callsAfterFirst = calls.length;
        const second = await postJson(port, '/api/sku-lookup', { sku: '09144', category: 'wine' });
        assert.equal(second.status, 200);
        assert.equal(second.body.fromCache, true);
        assert.equal(calls.length, callsAfterFirst, 'a same-category repeat lookup should not hit the network again');
      }
    );
  }));
});

test('switching a cached SKU to Beer re-runs the lookup (and Untappd search) instead of reusing the Wine/Spirits cache', async () => {
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
        assert.equal(beerResult.body.fromCache, undefined, 'switching category should not serve the Wine/Spirits cache hit');
        assert.ok(calls.length > callsAfterWine, 'switching to Beer should re-hit the network for the Untappd step');
        assert.ok(
          calls.some((url) => url.includes('algolia.net')),
          'switching to Beer should run the Untappd (Algolia) search, not just the store lookup'
        );
        // Algolia came back with no hits, so the best-effort Untappd step
        // surfaces its miss the same way enrichBeerFromUntappd always does.
        assert.match(beerResult.body.untappdError, /Could not find/);

        // A second Beer lookup right after, though, should now be served
        // from the (freshly Beer-tagged) cache.
        const callsAfterBeer = calls.length;
        const secondBeerResult = await postJson(port, '/api/sku-lookup', { sku: '09144', category: 'beer' });
        assert.equal(secondBeerResult.body.fromCache, true);
        assert.equal(calls.length, callsAfterBeer);
      }
    );
  }));
});

// ================================================================
// /api/upc-lookup's Wine/Spirits store-description enrichment (see the
// comment above the route in server/index.js) and its own category-aware
// cache, mirroring the /api/sku-lookup tests above.
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

test('switching a cached UPC from Beer to Wine/Spirits re-runs the store description lookup instead of reusing the Beer-only cache', async () => {
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
        // Beer now also hits the network (store product page + Untappd),
        // unlike before - the point of this test is the category-aware
        // cache below, not "Beer never touches the network" (that
        // assumption no longer holds - see the test above). The store page
        // here has its own real description, so it wins over the export's
        // internal note even though Untappd itself has no match.
        const beerResult = await postJson(port, '/api/upc-lookup', { upc: '085000010652', category: 'beer' });
        assert.equal(beerResult.body.price, '13.99');
        assert.equal(beerResult.body.description, 'Rich, full-bodied with notes of dark fruit and oak.');
        assert.match(beerResult.body.untappdError, /Could not find/);
        const callsAfterBeer = calls.length;
        assert.ok(callsAfterBeer > 0, 'a Beer scan should hit the network for price + Untappd');

        const wineResult = await postJson(port, '/api/upc-lookup', { upc: '085000010652', category: 'wine' });
        assert.equal(wineResult.body.fromCache, undefined, 'switching to Wine/Spirits should not serve the Beer-only cache hit');
        assert.equal(wineResult.body.description, 'Rich, full-bodied with notes of dark fruit and oak.');
        assert.ok(calls.length > callsAfterBeer, 'switching to Wine/Spirits should run its own store description lookup');

        // A second Wine/Spirits scan right after should now be served from
        // the (freshly Wine/Spirits-tagged) cache.
        const callsAfterWine = calls.length;
        const secondWineResult = await postJson(port, '/api/upc-lookup', { upc: '085000010652', category: 'wine' });
        assert.equal(secondWineResult.body.fromCache, true);
        assert.equal(calls.length, callsAfterWine);
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
