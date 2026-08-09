const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../server/db');
const { createApp } = require('../server/index');

// Same per-test throwaway directory pattern as test/db.test.js - db.js's
// getDb() re-derives its connection whenever SHELF_TALKER_CONFIG_DIR
// changes, so each test gets its own isolated SQLite file/cache.
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
