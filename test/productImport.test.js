// extractBeer's HTML parsing (Untappd-focused import) is split out as
// parseBeerHtml specifically so it can be tested here against fixture HTML.
// A real fetch to Untappd isn't something these tests can rely on - every
// outbound request from the environment this was first built in was
// blocked before it reached Untappd at all, which says nothing about
// whether Untappd itself would have accepted the request (see the longer
// note above parseBeerHtml in productImport.js). These fixtures encode the
// best-effort assumptions the parser makes about Untappd's markup, so a
// future change to those assumptions shows up here instead of silently
// changing what an import fills in.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  parseBeerHtml, fetchBeerHtml, extractBeer, parseBreweryHtml, extractBreweryUrl,
  buildTastingNotesQuery, pickBestMatch, parseWineComSearchResults, parseWineComProductHtml,
  wineComSearchUrl, findTastingNotes, TASTING_NOTE_PROVIDER_NAMES, TASTING_NOTE_EXPERIMENTAL_PROVIDER_NAMES,
  parseVivinoSearchResults, parseVivinoProductHtml, vivinoSearchUrl,
  distillerSearchUrl, parseDistillerSearchResults, parseDistillerProductHtml,
  extractFlavorNotes, selectTastingNotesContainer,
  extractProduct, parseProductHtml, parsePastedProduct,
  storeSearchUrl, parseStoreSearchResults, pickSkuMatch, parseStoreProductHtml,
  lookupStoreSku, parsePastedStoreProduct, enrichWineDescriptionFromStore,
  algoliaSearchBeerCandidates, searchUntappd, matchUntappdCandidates, UntappdAmbiguousMatchError,
  composeProducerTitle, buildUntappdSearchQuery,
  enrichBeerScanFromStore, enrichBeerFromUntappd,
  untappdBeerFromUrl, untappdBeerFromHtml, lookupSku, lookupSkuFromHtml,
} = require('../server/productImport');

// Must come after the require('../server/productImport') above - that
// module shims the global File class (see its own top-of-file comment)
// before it requires cheerio itself, which is what lets cheerio's own
// undici dependency load without crashing on Node 18. Requiring cheerio
// here first would skip that shim and blow up instead.
const cheerio = require('cheerio');

function page({ head = '', body = '' } = {}) {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

test('parseBeerHtml reads a full Untappd-style page', () => {
  const html = page({
    head: `
      <title>Trapped In A Sunbeam by New Anthem Beer Project | Untappd</title>
      <meta property="og:title" content="Trapped In A Sunbeam by New Anthem Beer Project | Untappd" />
      <meta property="og:description" content="Hazy double IPA bursting with tropical fruit and a soft, pillowy body." />
      <meta property="og:image" content="https://example.com/beer.jpg" />
    `,
    body: `
      <div class="name"><h1>Trapped In A Sunbeam</h1></div>
      <p class="brewery"><a href="#">New Anthem Beer Project</a></p>
      <p class="brewery-location">Wilmington, NC</p>
      <p class="style">IPA - Imperial / Double New England / Hazy</p>
      <div class="details">
        <p class="abv">8.00% ABV</p>
        <p class="ibu">65 IBU</p>
      </div>
      <div class="rating"><span class="num">4.27</span></div>
      <p>Rated 4.27 out of 5 by 2,345 people.</p>
    `,
  });

  const result = parseBeerHtml(html, 'https://untappd.com/b/new-anthem-beer-project-trapped-in-a-sunbeam/1');

  assert.deepEqual(result, {
    title: 'Trapped In A Sunbeam',
    description: 'Hazy double IPA bursting with tropical fruit and a soft, pillowy body.',
    brewery: 'New Anthem Beer Project',
    location: 'Wilmington, NC',
    style: 'IPA - Imperial / Double New England / Hazy',
    abv: '8%',
    ibu: '65',
    untappdRating: '4.27',
    untappdRatingCount: '',
    imageUrl: 'https://example.com/beer.jpg',
    sourceUrl: 'https://untappd.com/b/new-anthem-beer-project-trapped-in-a-sunbeam/1',
  });
});

test('parseBeerHtml falls back to Open Graph tags when the DOM has none of the expected classes', () => {
  // Simulates Untappd's markup having moved on since the selectors above
  // were written - nothing but og:title/og:description survives.
  const html = page({
    head: `
      <meta property="og:title" content="Ba'al by New Anthem Beer Project | Untappd" />
      <meta property="og:description" content="A hazy IPA with notes of citrus and pine." />
    `,
    body: '<div class="unrelated-redesign">Some other layout entirely.</div>',
  });

  const result = parseBeerHtml(html, 'https://untappd.com/b/x/2');

  assert.equal(result.title, "Ba'al");
  assert.equal(result.brewery, 'New Anthem Beer Project');
  assert.equal(result.description, 'A hazy IPA with notes of citrus and pine.');
  // Nothing in this fixture states an ABV/IBU/rating, so they must come
  // back blank rather than the parser inventing something.
  assert.equal(result.abv, '');
  assert.equal(result.ibu, '');
  assert.equal(result.untappdRating, '');
});

test('parseBeerHtml recognizes both IBU/ABV orderings', () => {
  const numberFirst = parseBeerHtml(
    page({ body: '<p>8% ABV. 65 IBU.</p><meta property="og:description" content="d" />' }),
    'https://example.com/a'
  );
  assert.equal(numberFirst.abv, '8%');
  assert.equal(numberFirst.ibu, '65');

  const wordFirst = parseBeerHtml(
    page({ body: '<p>ABV: 8%. IBU: 65.</p><meta property="og:description" content="d" />' }),
    'https://example.com/b'
  );
  assert.equal(wordFirst.abv, '8%');
  assert.equal(wordFirst.ibu, '65');
});

test('parseBeerHtml trims trailing zeros from ABV', () => {
  const result = parseBeerHtml(
    page({ body: '<p>5.50% ABV</p><meta property="og:description" content="d" />' }),
    'https://example.com/a'
  );
  assert.equal(result.abv, '5.5%');
});

test('parseBeerHtml only accepts a rating shaped like Untappd\'s 0-5 scale', () => {
  // A page mentioning some other decimal (a price, a year, a check-in
  // count) must not be misread as the beer's rating.
  const html = page({
    body: `
      <p>Rated 4.27 out of 5 by 2,345 people.</p>
      <p>This bottle costs $12.99 and was checked in 8.5 times as often this year.</p>
      <meta property="og:description" content="d" />
    `,
  });
  const result = parseBeerHtml(html, 'https://example.com/a');
  assert.equal(result.untappdRating, '4.27');
});

test('parseBeerHtml rejects a bare decimal with no rating-shaped context', () => {
  const html = page({
    body: '<p>This beer pours a hazy 8.5 out of ordinary orange color.</p><meta property="og:description" content="d" />',
  });
  const result = parseBeerHtml(html, 'https://example.com/a');
  // "8.5 out of ordinary" is not "out of 5" and has no "Rated" cue - the
  // parser must not guess.
  assert.equal(result.untappdRating, '');
});

test('parseBeerHtml does not mistake an unrelated in-range decimal for the rating', () => {
  // This is the case that actually needs the regex's "Rated"/"out of 5"
  // context requirement, not just asRating's 0-5 bound: 4.99 sits well
  // inside the valid rating range, so only the missing context keeps it
  // from being misread as one.
  const html = page({
    body: '<p>This bottle costs $4.99 and pairs well with cheese.</p><meta property="og:description" content="d" />',
  });
  const result = parseBeerHtml(html, 'https://example.com/a');
  assert.equal(result.untappdRating, '');
});

test('parseBeerHtml prefers a DOM rating element over the regex fallback', () => {
  const html = page({
    body: `
      <div class="rating"><span class="num">4.5</span></div>
      <p>Rated 3.9 out of 5 by someone else on the same page.</p>
      <meta property="og:description" content="d" />
    `,
  });
  const result = parseBeerHtml(html, 'https://example.com/a');
  assert.equal(result.untappdRating, '4.5');
});

// Regression fixture built from a real Untappd page (a user reported the
// importer missing both fields after the 403 fix; screenshots of the
// actual page showed why). The real page shows "N/A IBU" - not a number -
// and the rating as a bare "(4.23)" next to the dot widget, with none of
// the "Rated"/"out of 5" phrasing the original patterns looked for. That
// exact phrase does appear, but only inside the auto-generated og:
// description ("...which has a rating of 4.2 out of 5..."), rounded to one
// decimal rather than the on-page widget's two.
test('parseBeerHtml matches the real page that motivated the N/A-IBU and bare-rating fallbacks', () => {
  const html = page({
    head: `
      <meta property="og:title" content="Full Circle by Autodidact Beer | Untappd" />
      <meta property="og:description" content="Full Circle by Autodidact Beer is a IPA - Imperial / Double New England / Hazy which has a rating of 4.2 out of 5, with 1,382 ratings and reviews on Untappd." />
    `,
    body: `
      <h1>Full Circle</h1>
      <p>Autodidact Beer</p>
      <p>IPA - Imperial / Double New England / Hazy</p>
      <div>8% ABV</div>
      <div>N/A IBU</div>
      <div>(4.23)</div>
      <div>1,382 Ratings</div>
    `,
  });
  const result = parseBeerHtml(html, 'https://untappd.com/b/x/1');
  assert.equal(result.abv, '8%');
  assert.equal(result.ibu, 'N/A');
  // The precise on-page number wins over the rounded one in the description.
  assert.equal(result.untappdRating, '4.23');
  assert.equal(result.untappdRatingCount, '1382');
});

test('parseBeerHtml prefers the on-page rating count over the og:description fallback, and strips its thousands separator', () => {
  const html = page({
    head: '<meta property="og:description" content="d, with 500 ratings on Untappd." />',
    body: '<div>12,004 Ratings</div>',
  });
  const result = parseBeerHtml(html, 'https://example.com/a');
  assert.equal(result.untappdRatingCount, '12004');
});

test('parseBeerHtml leaves the rating count blank when neither the page nor og:description mentions one', () => {
  const html = page({
    body: '<h1>Steez</h1><meta property="og:description" content="A hazy IPA with notes of citrus and pine." />',
  });
  const result = parseBeerHtml(html, 'https://example.com/a');
  assert.equal(result.untappdRatingCount, '');
});

test('parseBeerHtml normalizes "N/A" IBU to a consistent case regardless of the page\'s own casing', () => {
  const lower = parseBeerHtml(page({ body: '<p>8% ABV. n/a ibu.</p><meta property="og:description" content="d" />' }), 'https://example.com/a');
  assert.equal(lower.ibu, 'N/A');

  const wordFirst = parseBeerHtml(page({ body: '<p>ABV: 8%. IBU: N/A.</p><meta property="og:description" content="d" />' }), 'https://example.com/b');
  assert.equal(wordFirst.ibu, 'N/A');
});

test('parseBeerHtml reads a bare parenthesized rating with no "Rated"/"out of 5" phrasing', () => {
  const html = page({
    body: '<p>Some unrelated (7) count.</p><p>(4.23)</p><meta property="og:description" content="d" />',
  });
  const result = parseBeerHtml(html, 'https://example.com/a');
  assert.equal(result.untappdRating, '4.23');
});

test('parseBeerHtml falls back to the rating mentioned in og:description when nothing on the visible page has it', () => {
  const html = page({
    head: '<meta property="og:description" content="Steez by New Anthem is a hazy IPA which has a rating of 4.2 out of 5, with 500 ratings on Untappd." />',
    body: '<h1>Steez</h1>',
  });
  const result = parseBeerHtml(html, 'https://example.com/a');
  assert.equal(result.untappdRating, '4.2');
  assert.equal(result.untappdRatingCount, '500');
});

test('parseBeerHtml does not misread a parenthesized decimal outside Untappd\'s 0-5 rating range', () => {
  // Same shape a real rating would have (one digit, a dot, two digits) but
  // starting above 5 - asRating()'s range check, not just the capture
  // pattern's shape, is what has to reject this.
  const html = page({
    body: '<p>Barrel-aged for (8.50) months in oak.</p><meta property="og:description" content="d" />',
  });
  const result = parseBeerHtml(html, 'https://example.com/a');
  assert.equal(result.untappdRating, '');
});

// Regression fixture built from a real Untappd page (a user reported the
// importer no longer pulling ratings at all; a DevTools screenshot of the
// actual page - untappd.com/b/autodidact-beer-daylily/5251415 - showed why).
// The rendered page shows only a rounded whole number in parentheses next to
// the 5-cap widget ("(4)"), not the two-decimal text every existing pattern
// looked for - the precise value lives exclusively in a data-rating
// attribute on div.caps, which nothing here read before now.
test('parseBeerHtml reads the precise rating from the caps widget\'s data-rating attribute', () => {
  const html = page({
    body: `
      <h1>Daylily</h1>
      <p class="brewery"><a href="#">Autodidact Beer</a></p>
      <div class="details">
        <p class="abv">5.8% ABV</p>
        <p class="ibu">N/A IBU</p>
        <div class="caps" data-rating="3.99866">
          <div class="cap cap-100"></div>
          <div class="cap cap-100"></div>
          <div class="cap cap-100"></div>
          <div class="cap cap-100"></div>
          <div class="cap"></div>
        </div>
        <span>(4)</span>
      </div>
      <meta property="og:description" content="d" />
    `,
  });
  const result = parseBeerHtml(html, 'https://untappd.com/b/autodidact-beer-daylily/5251415');
  assert.equal(result.untappdRating, '4.00');
  assert.equal(result.abv, '5.8%');
  assert.equal(result.ibu, 'N/A');
});

test('parseBeerHtml prefers the data-rating attribute over a rounded visible-text match', () => {
  const html = page({
    body: `
      <div class="caps" data-rating="3.99866"></div>
      <p>(4)</p>
      <meta property="og:description" content="d" />
    `,
  });
  const result = parseBeerHtml(html, 'https://example.com/a');
  assert.equal(result.untappdRating, '4.00');
});

test('parseBeerHtml ignores an out-of-range or non-numeric data-rating attribute', () => {
  const outOfRange = parseBeerHtml(
    page({ body: '<div class="caps" data-rating="7.2"></div><meta property="og:description" content="d" />' }),
    'https://example.com/a'
  );
  assert.equal(outOfRange.untappdRating, '');

  const nonNumeric = parseBeerHtml(
    page({ body: '<div class="caps" data-rating="tbd"></div><meta property="og:description" content="d" />' }),
    'https://example.com/b'
  );
  assert.equal(nonNumeric.untappdRating, '');
});

// A beer with no computed average yet still gets a caps widget on its real
// Untappd page, just one whose data-rating attribute is literally "0" -
// rendered there as empty dots and "(N/A)", not a zero score, even when the
// page also shows a nonzero "Ratings" count alongside it (confirmed via a
// user-supplied screenshot: "NJ Born And Raised" shows "9 Ratings" next to
// an empty, N/A-labeled widget). Importing that "0" as if it were a real
// 4.00-style rating would misreport the beer as the worst possible score
// instead of "not yet rated" - see the matching note on asRatingAttr.
test('parseBeerHtml treats a "0" data-rating attribute as no rating, not a zero score', () => {
  const result = parseBeerHtml(
    page({
      body: `
        <div class="caps" data-rating="0"></div>
        <span>9 Ratings</span>
        <meta property="og:description" content="d" />
      `,
    }),
    'https://example.com/a'
  );
  assert.equal(result.untappdRating, '');
  assert.equal(result.untappdRatingCount, '9');
});

// Same rule for the plain-text fallbacks (domRating/ratingRaw), in case a
// future page shape puts a bare "0" somewhere asRating() scans instead of
// in the data-rating attribute.
test('parseBeerHtml treats a bare "0" rating in visible text as no rating', () => {
  const result = parseBeerHtml(
    page({ body: '<p class="rating"><span class="num">0</span></p><meta property="og:description" content="d" />' }),
    'https://example.com/a'
  );
  assert.equal(result.untappdRating, '');
});

// Regression fixture built from a real Untappd page (a user reported the
// description field pulling the wrong text after the rating/IBU fixes
// shipped - a DevTools screenshot of the actual page showed why). The
// brewery's real tasting note lives in a div with Untappd's own typo'd
// class name, not in og:description, which is an auto-generated SEO
// summary Untappd writes itself. The div also contains a "Show Less"
// toggle link nested inside the same element as the text.
test('parseBeerHtml prefers the real tasting note in .beer-descrption-read-less over the auto-generated og:description', () => {
  const html = page({
    head: '<meta property="og:description" content="Full Circle by Autodidact Beer is a IPA - Imperial / Double New England / Hazy which has a rating of 4.2 out of 5, with 1,382 ratings and reviews on Untappd." />',
    body: `
      <h1>Full Circle</h1>
      <div class="desc">
        <div class="beer-descrption-read-more" style="display: none;">Daylily's biggest sibling...</div>
        <div class="beer-descrption-read-less" style="display: block;">
          Daylily's biggest sibling. Full Circle is a double IPA hopped brewed with
          Citra and Mosaic hops, but pushed even further for more drippy hoppy
          goodness. Drink fresh and enjoy!
          <a class="read-less track-click" href="#" data-track="beer" data-href="#:info/readless">Show Less</a>
        </div>
      </div>
    `,
  });
  const result = parseBeerHtml(html, 'https://untappd.com/b/x/1');
  assert.equal(
    result.description,
    "Daylily's biggest sibling. Full Circle is a double IPA hopped brewed with Citra and Mosaic hops, but pushed even further for more drippy hoppy goodness. Drink fresh and enjoy!"
  );
});

test('parseBeerHtml falls back to .beer-descrption-read-more when -read-less is absent', () => {
  const html = page({
    head: '<meta property="og:description" content="d" />',
    body: `
      <h1>Steez</h1>
      <div class="beer-descrption-read-more">A hazy IPA with notes of citrus and pine.</div>
    `,
  });
  const result = parseBeerHtml(html, 'https://example.com/a');
  assert.equal(result.description, 'A hazy IPA with notes of citrus and pine.');
});

test('parseBeerHtml falls back to og:description when neither beer-descrption div is present', () => {
  const html = page({
    head: '<meta property="og:description" content="A hazy IPA with notes of citrus and pine." />',
    body: '<h1>Steez</h1>',
  });
  const result = parseBeerHtml(html, 'https://example.com/a');
  assert.equal(result.description, 'A hazy IPA with notes of citrus and pine.');
});

test('parseBeerHtml throws when the page has nothing usable', () => {
  const html = page({ body: '<p>This page is not a beer at all.</p>' });
  assert.throws(() => parseBeerHtml(html, 'https://example.com/nope'), /Could not find beer details/);
});

test('parseBeerHtml never returns price, salePrice or size fields', () => {
  // Untappd is not a retailer - a beer import result must not shadow the
  // wine importer's shape with fields it has no source for.
  const html = page({
    head: '<meta property="og:title" content="Steez by New Anthem Beer Project" />'
      + '<meta property="og:description" content="d" />',
  });
  const result = parseBeerHtml(html, 'https://example.com/a');
  assert.equal('price' in result, false);
  assert.equal('salePrice' in result, false);
  assert.equal('size' in result, false);
});

// Regression test for a real crash: cheerio's HTTP dependency (undici)
// reads the global File class the instant anything requires cheerio, and
// Node only started providing that global itself in the 20.x line - on
// Node 18 (confirmed against the real v18.20.8 binary while diagnosing
// this) requiring productImport.js throws "ReferenceError: File is not
// defined" before any of this file's own code runs. productImport.js works
// around it by re-exposing node:buffer's File as the global before it
// requires cheerio.
//
// This can't be tested by just requiring productImport.js in-process,
// because whichever Node version happens to run this suite already defines
// globalThis.File (true for every version currently in the CI matrix) -
// that would make the test pass whether or not the workaround is even
// there. Spawning a subprocess that deletes the global first reproduces the
// missing-global condition deterministically, regardless of the host Node
// version - including if Node 18 itself is ever dropped from the CI matrix,
// which is exactly when a test relying on actually running under 18 would
// stop meaning anything.
test('productImport.js loads even when the platform has no global File (Node 18)', () => {
  const script = `
    delete globalThis.File;
    require(${JSON.stringify(path.join(__dirname, '..', 'server', 'productImport.js'))});
    console.log('loaded-ok');
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0,
    `expected productImport.js to load without a global File; stderr:\n${result.stderr}`);
  assert.match(result.stdout, /loaded-ok/);
});

test('parseBeerHtml handles a title with no "by <brewery>" clause', () => {
  const html = page({
    head: '<meta property="og:title" content="Untappd" />'
      + '<meta property="og:description" content="d" />',
    body: '<div class="name"><h1>Mystery Beer</h1></div>',
  });
  const result = parseBeerHtml(html, 'https://example.com/a');
  assert.equal(result.title, 'Mystery Beer');
  assert.equal(result.brewery, '');
});

// ================================================================
// fetchBeerHtml / extractBeer's retry orchestration.
//
// A real fetch to Untappd isn't available to test against (see the note at
// the top of this file), but the DECISION of when to retry with a
// different header set - and which one goes first - is pure logic that
// doesn't need one: mocking the global fetch() lets these be pinned exactly
// regardless of what Untappd itself would actually do.
// ================================================================

function mockResponse({ status = 200, body = '<html></html>', headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  if (!lower['content-type']) lower['content-type'] = 'text/html; charset=utf-8';
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

// Swaps globalThis.fetch for the duration of one test and guarantees it's
// put back afterward, success or failure - a leaked mock would silently
// break every later test in this file that expects the real network stack.
async function withMockFetch(impl, run) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

test('fetchBeerHtml succeeds on the first (plain) attempt without trying the second', async () => {
  const calls = [];
  await withMockFetch(
    async (url, opts) => { calls.push(opts.headers); return mockResponse({ status: 200, body: 'ok-body' }); },
    async () => {
      const html = await fetchBeerHtml('https://untappd.com/b/x/1');
      assert.equal(html, 'ok-body');
    }
  );
  assert.equal(calls.length, 1, 'a successful first attempt must not trigger a second');
  assert.doesNotMatch(calls[0]['User-Agent'], /Chrome/,
    'the first attempt must be the plain, honest UA - not the full-browser header set');
});

test('fetchBeerHtml falls back to the full-browser header set only after a blocked-looking response', async () => {
  const calls = [];
  await withMockFetch(
    async (url, opts) => {
      calls.push(opts.headers);
      return calls.length === 1 ? mockResponse({ status: 403 }) : mockResponse({ status: 200, body: 'second-attempt-body' });
    },
    async () => {
      const html = await fetchBeerHtml('https://untappd.com/b/x/1');
      assert.equal(html, 'second-attempt-body');
    }
  );
  assert.equal(calls.length, 2, 'a 403 on the first attempt should trigger exactly one retry');
  assert.doesNotMatch(calls[0]['User-Agent'], /Chrome/, 'first attempt: plain UA');
  assert.match(calls[1]['User-Agent'], /Chrome/, 'second attempt: the full desktop-browser header set');
  assert.ok(calls[1]['Sec-Fetch-Mode'], 'second attempt should send the accompanying browser headers, not just a UA string');
});

test('fetchBeerHtml does not retry a plain 404 - a wrong URL retrying with different headers would not fix', async () => {
  const calls = [];
  await withMockFetch(
    async (url, opts) => { calls.push(opts.headers); return mockResponse({ status: 404 }); },
    async () => {
      await assert.rejects(() => fetchBeerHtml('https://untappd.com/b/gone/1'), /404/);
    }
  );
  assert.equal(calls.length, 1, 'a 404 is not a block and must not spend a second round-trip');
});

test('fetchBeerHtml does not retry a network-level failure', async () => {
  const calls = [];
  await withMockFetch(
    async () => { calls.push(1); throw new Error('getaddrinfo ENOTFOUND'); },
    async () => {
      await assert.rejects(() => fetchBeerHtml('https://untappd.com/b/x/1'), /ENOTFOUND/);
    }
  );
  assert.equal(calls.length, 1, 'a network failure has no httpStatus and must not be treated as a block to retry');
});

test('extractBeer turns a block that survives both attempts into an actionable message', async () => {
  await withMockFetch(
    async () => mockResponse({ status: 403 }),
    async () => {
      await assert.rejects(
        () => extractBeer('https://untappd.com/b/x/1'),
        /Untappd blocked this request/
      );
    }
  );
});

test('extractBeer passes through a non-block failure unchanged', async () => {
  await withMockFetch(
    async () => mockResponse({ status: 404 }),
    async () => {
      await assert.rejects(() => extractBeer('https://untappd.com/b/gone/1'), /404/);
    }
  );
});

test('extractBeer succeeds end-to-end when the second attempt gets through', async () => {
  let call = 0;
  const html = page({
    head: '<meta property="og:title" content="Two Attempts by Some Brewery" />'
      + '<meta property="og:description" content="d" />',
  });
  await withMockFetch(
    async () => { call += 1; return call === 1 ? mockResponse({ status: 403 }) : mockResponse({ status: 200, body: html }); },
    async () => {
      const result = await extractBeer('https://untappd.com/b/x/1');
      assert.equal(result.title, 'Two Attempts');
      assert.equal(result.brewery, 'Some Brewery');
    }
  );
});

// ================================================================
// Brewery location - a second request following the beer page's brewery
// link. Confirmed via two real DevTools screenshots (the beer page's
// .brewery link, and the brewery page's own reuse of that same class name
// for a plain-text location instead) - see the notes above
// extractBreweryUrl/parseBreweryHtml in productImport.js.
// ================================================================

test('extractBreweryUrl resolves a root-relative brewery link against the beer page URL', () => {
  const html = page({
    body: '<h1>Full Circle</h1><p class="brewery"><a href="/w/autodidact-beer/432029">Autodidact Beer</a></p>',
  });
  const url = extractBreweryUrl(html, 'https://untappd.com/b/autodidact-beer-full-circle/5307329');
  assert.equal(url, 'https://untappd.com/w/autodidact-beer/432029');
});

test('extractBreweryUrl passes through an already-absolute brewery link unchanged', () => {
  const html = page({
    body: '<p class="brewery"><a href="https://untappd.com/w/autodidact-beer/432029">Autodidact Beer</a></p>',
  });
  const url = extractBreweryUrl(html, 'https://untappd.com/b/x/1');
  assert.equal(url, 'https://untappd.com/w/autodidact-beer/432029');
});

test('extractBreweryUrl returns undefined when the beer page has no brewery link', () => {
  const html = page({ body: '<h1>Full Circle</h1>' });
  assert.equal(extractBreweryUrl(html, 'https://untappd.com/b/x/1'), undefined);
});

test('parseBreweryHtml reads the location from a real brewery page structure', () => {
  const html = page({
    body: `
      <div class="cont brewery-page">
        <div class="main"><div class="box b_info"><div class="content"><div class="top">
          <div class="basic">
            <div class="name">
              <h1>Autodidact Beer</h1>
              <p class="brewery">Morris Plains, NJ United States</p>
              <p class="style">Micro Brewery</p>
            </div>
          </div>
        </div></div></div></div>
      </div>
    `,
  });
  assert.equal(parseBreweryHtml(html), 'Morris Plains, NJ United States');
});

test('parseBreweryHtml returns undefined when the page has no recognizable location', () => {
  const html = page({ body: '<h1>Some Brewery</h1>' });
  assert.equal(parseBreweryHtml(html), undefined);
});

test('extractBeer follows the brewery link and fills in location from the brewery page', async () => {
  const beerHtml = page({
    head: '<meta property="og:title" content="Full Circle by Autodidact Beer | Untappd" />'
      + '<meta property="og:description" content="d" />',
    body: '<p class="brewery"><a href="/w/autodidact-beer/432029">Autodidact Beer</a></p>',
  });
  const breweryHtml = page({
    body: '<div class="basic"><div class="name"><h1>Autodidact Beer</h1>'
      + '<p class="brewery">Morris Plains, NJ United States</p></div></div>',
  });
  const requestedUrls = [];
  await withMockFetch(
    async (url) => {
      requestedUrls.push(url);
      if (url === 'https://untappd.com/b/autodidact-beer-full-circle/1') {
        return mockResponse({ status: 200, body: beerHtml });
      }
      if (url === 'https://untappd.com/w/autodidact-beer/432029') {
        return mockResponse({ status: 200, body: breweryHtml });
      }
      throw new Error('unexpected URL: ' + url);
    },
    async () => {
      const result = await extractBeer('https://untappd.com/b/autodidact-beer-full-circle/1');
      assert.equal(result.brewery, 'Autodidact Beer');
      assert.equal(result.location, 'Morris Plains, NJ United States');
    }
  );
  assert.deepEqual(requestedUrls, [
    'https://untappd.com/b/autodidact-beer-full-circle/1',
    'https://untappd.com/w/autodidact-beer/432029',
  ]);
});

test('extractBeer still succeeds with a blank location when the brewery page is blocked', async () => {
  const beerHtml = page({
    head: '<meta property="og:title" content="Full Circle by Autodidact Beer | Untappd" />'
      + '<meta property="og:description" content="d" />',
    body: '<p class="brewery"><a href="/w/autodidact-beer/432029">Autodidact Beer</a></p>',
  });
  await withMockFetch(
    async (url) => (url.includes('/w/') ? mockResponse({ status: 403 }) : mockResponse({ status: 200, body: beerHtml })),
    async () => {
      const result = await extractBeer('https://untappd.com/b/autodidact-beer-full-circle/1');
      assert.equal(result.brewery, 'Autodidact Beer');
      assert.equal(result.location, '');
    }
  );
});

test('extractBeer does not request the brewery page at all when there is no brewery link to follow', async () => {
  const beerHtml = page({
    head: '<meta property="og:title" content="Full Circle by Autodidact Beer | Untappd" />'
      + '<meta property="og:description" content="d" />',
  });
  let calls = 0;
  await withMockFetch(
    async () => { calls += 1; return mockResponse({ status: 200, body: beerHtml }); },
    async () => {
      const result = await extractBeer('https://untappd.com/b/autodidact-beer-full-circle/1');
      assert.equal(result.location, '');
    }
  );
  assert.equal(calls, 1, 'no .brewery a link means nothing to follow - must not make a second request');
});

// ================================================================
// Generic retail product import ("Import from website", Wine/Spirits mode -
// extractProduct/parseProductHtml). Wine.com is a real-world example of a
// site pasted in here, but this path is meant to work against any
// retailer's product page, so these fixtures aren't wine.com-specific.
// ================================================================

test('parseProductHtml reads title/description/price/image from JSON-LD Product schema', () => {
  const html = page({
    head: `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      name: 'Josh Cellars Cabernet Sauvignon 2022',
      description: 'Bold and full-bodied.',
      image: 'https://example.com/bottle.jpg',
      offers: { price: '14.99' },
    })}</script>`,
  });
  const result = parseProductHtml(html, 'https://example.com/products/josh-cellars-cab');
  assert.deepEqual(result, {
    title: 'Josh Cellars Cabernet Sauvignon 2022',
    description: 'Bold and full-bodied.',
    price: '14.99',
    salePrice: '',
    size: '',
    imageUrl: 'https://example.com/bottle.jpg',
    sourceUrl: 'https://example.com/products/josh-cellars-cab',
  });
});

test('parseProductHtml falls back to Open Graph tags when there is no JSON-LD', () => {
  const html = page({
    head: '<meta property="og:title" content="Josh Cellars Chardonnay 2022" />'
      + '<meta property="og:description" content="Crisp and citrusy." />',
  });
  const result = parseProductHtml(html, 'https://example.com/products/josh-cellars-chard');
  assert.equal(result.title, 'Josh Cellars Chardonnay 2022');
  assert.equal(result.description, 'Crisp and citrusy.');
});

test('parseProductHtml throws when the page has neither a title nor a price', () => {
  const html = page({ body: '<p>Nothing recognizable here.</p>' });
  assert.throws(
    () => parseProductHtml(html, 'https://example.com/x'),
    /Could not find product details/
  );
});

test('parseProductHtml reads list/sale price from a single offer\'s priceSpecification array (wine.com\'s shape)', () => {
  const html = page({
    head: `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      name: 'Chateau Bourdieu No.1 2018',
      description: 'Rich and generous.',
      offers: {
        price: 18.99,
        priceCurrency: 'USD',
        priceSpecification: [
          { priceType: 'https://schema.org/ListPrice', price: 30 },
          { priceType: 'https://schema.org/SalePrice', price: 18.99 },
        ],
      },
    })}</script>`,
  });
  const result = parseProductHtml(html, 'https://www.wine.com/product/chateau-bourdieu-no1-2018/4122420');
  assert.equal(result.price, '30.00');
  assert.equal(result.salePrice, '18.99');
});

test('parseProductHtml reads size from hasMeasurement when there is no plain "size" field (wine.com\'s shape)', () => {
  const html = page({
    head: `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      name: 'Chateau Bourdieu No.1 2018',
      description: 'Rich and generous.',
      hasMeasurement: { value: 750, unitCode: 'MLT', unitText: 'ml' },
      offers: { price: '18.99' },
    })}</script>`,
  });
  const result = parseProductHtml(html, 'https://www.wine.com/product/chateau-bourdieu-no1-2018/4122420');
  assert.equal(result.size, '750ml');
});

test('extractProduct retries a blocked response with browser headers before giving up', async () => {
  const html = page({
    head: '<meta property="og:title" content="Two Attempts Wine 2022" />'
      + '<meta property="og:description" content="d" />',
  });
  const calls = [];
  await withMockFetch(
    async (url, opts) => {
      calls.push(opts.headers);
      return calls.length === 1 ? mockResponse({ status: 403 }) : mockResponse({ status: 200, body: html });
    },
    async () => {
      const result = await extractProduct('https://example.com/products/x');
      assert.equal(result.title, 'Two Attempts Wine 2022');
    }
  );
  assert.equal(calls.length, 2, 'a 403 on the first attempt should trigger exactly one retry');
  assert.match(calls[1]['User-Agent'], /Chrome/, 'second attempt: the full desktop-browser header set');
});

test('extractProduct turns a block that survives both attempts into an actionable message', async () => {
  await withMockFetch(
    async () => mockResponse({ status: 403 }),
    async () => {
      await assert.rejects(
        () => extractProduct('https://example.com/products/x'),
        /blocked this automated request/
      );
    }
  );
});

test('extractProduct passes through a non-block failure unchanged', async () => {
  await withMockFetch(
    async () => mockResponse({ status: 404 }),
    async () => {
      await assert.rejects(() => extractProduct('https://example.com/products/gone'), /404/);
    }
  );
});

// liquoroutletwinecellars.com product pages don't carry the schema.org/Open
// Graph price+size markup parseProductHtml looks for (see the note above
// isStoreUrl in productImport.js) - a URL on this host pasted into "Import
// from website" must be routed to parseStoreProductHtml instead, so Size
// and Price come back filled in rather than silently blank. www. and
// bare-domain both count as this host.
test('extractProduct routes a liquoroutletwinecellars.com URL to the store-specific parser, filling in Size and Price', async () => {
  const html = page({
    body: `
      <h1 itemprop="name">Michelob ULTRA</h1>
      <div class="pricingDetails"><span class="priceFull">$8.99</span></div>
      <table><tr><th>Size</th><td>12pk-12oz Cans</td></tr></table>
    `,
  });
  await withMockFetch(
    async () => mockResponse({ status: 200, body: html }),
    async () => {
      const result = await extractProduct('https://www.liquoroutletwinecellars.com/Michelob-ULTRA-09144-1009144/');
      assert.equal(result.title, 'Michelob ULTRA');
      assert.equal(result.price, '8.99');
      assert.equal(result.size, '12pk-12oz Cans');
    }
  );
});

test('extractProduct routes the bare liquoroutletwinecellars.com domain (no "www.") to the store-specific parser too', async () => {
  const html = page({
    body: `
      <h1 itemprop="name">Michelob ULTRA</h1>
      <div class="pricingDetails"><span class="priceFull">$8.99</span></div>
      <table><tr><th>Size</th><td>12pk-12oz Cans</td></tr></table>
    `,
  });
  await withMockFetch(
    async () => mockResponse({ status: 200, body: html }),
    async () => {
      const result = await extractProduct('https://liquoroutletwinecellars.com/Michelob-ULTRA-09144-1009144/');
      assert.equal(result.price, '8.99');
      assert.equal(result.size, '12pk-12oz Cans');
    }
  );
});

test('extractProduct gives the store-specific blocked-request message for a blocked liquoroutletwinecellars.com fetch', async () => {
  await withMockFetch(
    async () => mockResponse({ status: 403 }),
    async () => {
      await assert.rejects(
        () => extractProduct('https://www.liquoroutletwinecellars.com/Michelob-ULTRA-09144-1009144/'),
        /store site blocked/
      );
    }
  );
});

// A store page's own H1 sometimes trails off with the container size, just
// like the SKU Lookup tab's fixtures already confirm (see
// composeProducerTitle's own tests further down) - extractProduct needs to
// run the same size-stripping/brand-prepending step SKU Lookup already does
// for that path, or the size ends up duplicated: once in the new Size field
// this now fills in, and again inside the Product Title itself.
test('extractProduct strips the container size out of the title and prepends the brand, same as SKU Lookup does', async () => {
  const html = page({
    body: `
      <h1 itemprop="name">Cabernet Sauvignon 750mL</h1>
      <h6><a href="/brand/josh-cellars">Josh Cellars</a></h6>
      <div class="pricingDetails"><span class="priceFull">$14.99</span></div>
      <table><tr><th>Size</th><td>750mL</td></tr></table>
    `,
  });
  await withMockFetch(
    async () => mockResponse({ status: 200, body: html }),
    async () => {
      const result = await extractProduct('https://www.liquoroutletwinecellars.com/Josh-Cellars-Cabernet-55555-1055555/');
      assert.equal(result.title, 'Josh Cellars Cabernet Sauvignon');
      assert.equal(result.size, '750mL');
      assert.equal(result.price, '14.99');
    }
  );
});

// ================================================================
// "Paste page HTML" fallback (parsePastedProduct) - what the "Import from
// website" tab falls back to when even extractProduct's retry above keeps
// getting blocked. No fetch happens here; it just runs the same parsing a
// successful fetch would have against HTML the caller already has.
// ================================================================

test('parsePastedProduct parses wine/spirits HTML the same way extractProduct would', () => {
  const html = page({
    head: '<meta property="og:title" content="Pasted Wine 2022" />'
      + '<meta property="og:description" content="Tastes great." />',
  });
  const result = parsePastedProduct({ html, url: 'https://www.wine.com/product/x/1', category: 'wine' });
  assert.equal(result.title, 'Pasted Wine 2022');
  assert.equal(result.description, 'Tastes great.');
  assert.equal(result.sourceUrl, 'https://www.wine.com/product/x/1');
});

test('parsePastedProduct parses beer HTML the same way extractBeer would', () => {
  const html = page({
    head: '<meta property="og:title" content="Trapped In A Sunbeam by New Anthem Beer Project | Untappd" />'
      + '<meta property="og:description" content="Hazy double IPA." />',
  });
  const result = parsePastedProduct({ html, url: 'https://untappd.com/b/x/1', category: 'beer' });
  assert.equal(result.title, 'Trapped In A Sunbeam');
  assert.equal(result.brewery, 'New Anthem Beer Project');
});

test('parsePastedProduct treats a missing url as an optional field, not an error', () => {
  const html = page({
    head: '<meta property="og:title" content="No URL Wine 2022" />'
      + '<meta property="og:description" content="d" />',
  });
  const result = parsePastedProduct({ html, category: 'wine' });
  assert.equal(result.title, 'No URL Wine 2022');
  assert.equal(result.sourceUrl, '');
});

test('parsePastedProduct rejects an empty paste without attempting to parse it', () => {
  assert.throws(() => parsePastedProduct({ html: '   ', category: 'wine' }), /Paste the page's HTML first/);
  assert.throws(() => parsePastedProduct({ category: 'wine' }), /Paste the page's HTML first/);
});

// Same store-hostname routing as extractProduct above, but for the "paste
// page HTML" fallback - a liquoroutletwinecellars.com page pasted here
// still needs to go through parseStoreProductHtml, or Size and Price come
// back blank the same way they would from the generic parser.
test('parsePastedProduct routes a pasted liquoroutletwinecellars.com page to the store-specific parser too', () => {
  const html = page({
    body: `
      <h1 itemprop="name">Michelob ULTRA</h1>
      <div class="pricingDetails"><span class="priceFull">$8.99</span></div>
      <table><tr><th>Size</th><td>12pk-12oz Cans</td></tr></table>
    `,
  });
  const result = parsePastedProduct({
    html,
    url: 'https://www.liquoroutletwinecellars.com/Michelob-ULTRA-09144-1009144/',
    category: 'wine',
  });
  assert.equal(result.price, '8.99');
  assert.equal(result.size, '12pk-12oz Cans');
});

// Same size-stripping/brand-prepending as extractProduct's own version of
// this test above - the "paste page HTML" fallback must not reintroduce a
// size-in-the-title bug that only the live-fetch path was fixed for.
test('parsePastedProduct strips the container size out of a pasted store page\'s title too', () => {
  const html = page({
    body: `
      <h1 itemprop="name">Cabernet Sauvignon 750mL</h1>
      <h6><a href="/brand/josh-cellars">Josh Cellars</a></h6>
      <table><tr><th>Size</th><td>750mL</td></tr></table>
    `,
  });
  const result = parsePastedProduct({
    html,
    url: 'https://www.liquoroutletwinecellars.com/Josh-Cellars-Cabernet-55555-1055555/',
    category: 'wine',
  });
  assert.equal(result.title, 'Josh Cellars Cabernet Sauvignon');
  assert.equal(result.size, '750mL');
});

// ================================================================
// Wine/spirits "Find Tasting Notes" lookup (searchWineCom, via
// findTastingNotes). Same testing constraint as the beer importer above -
// no real fetch to wine.com is available from here - so these pin the
// query-building, result-matching, and page-parsing logic against
// hand-built fixtures instead.
// ================================================================

test('buildTastingNotesQuery appends the vintage only when the title has no year of its own', () => {
  assert.equal(
    buildTastingNotesQuery('Josh Cellars Cabernet Sauvignon', '2022'),
    'Josh Cellars Cabernet Sauvignon 2022'
  );
  assert.equal(
    buildTastingNotesQuery('Josh Cellars Cabernet Sauvignon 2025', '2022'),
    'Josh Cellars Cabernet Sauvignon 2025',
    'title already has a year - do not tack on a second, conflicting one'
  );
  assert.equal(buildTastingNotesQuery('Josh Cellars Cabernet Sauvignon', ''), 'Josh Cellars Cabernet Sauvignon');
});

test('pickBestMatch prefers the candidate whose title overlaps the query the most', () => {
  const candidates = [
    { url: 'https://www.wine.com/product/a/1', title: 'Josh Cellars Chardonnay 2022' },
    { url: 'https://www.wine.com/product/b/2', title: 'Josh Cellars Cabernet Sauvignon 2022' },
  ];
  const match = pickBestMatch(candidates, 'Josh Cellars Cabernet Sauvignon 2022');
  assert.equal(match.url, 'https://www.wine.com/product/b/2');
});

test('pickBestMatch returns nothing when no candidate meaningfully overlaps the query', () => {
  const candidates = [{ url: 'https://www.wine.com/product/a/1', title: 'Completely Unrelated Wine 2019' }];
  assert.equal(pickBestMatch(candidates, 'Josh Cellars Cabernet Sauvignon 2022'), undefined);
});

test('pickBestMatch returns nothing for an empty candidate list', () => {
  assert.equal(pickBestMatch([], 'Josh Cellars Cabernet Sauvignon 2022'), undefined);
});

// Regression test for a real miss: a Scan UPC beer title carries style
// words ("Dry Irish Stout") that Untappd's own concise "<Brewery> <Beer
// Name>" candidate title never repeats, and that candidate title in turn
// carries brewery-suffix words ("Brewing Company") the store title never
// had either - so neither side's title fully contains the other's words,
// which is exactly the shape a threshold sized only off the query
// (5 words here) used to reject. See the comment above pickBestMatch.
test('pickBestMatch still matches when the candidate title is shorter than the query and neither side is a subset of the other', () => {
  const candidates = [{ url: 'https://untappd.com/b/oakflower-augury/1', title: 'Oakflower Brewing Company Augury' }];
  const match = pickBestMatch(candidates, 'Oakflower Augury Dry Irish Stout');
  assert.equal(match.url, 'https://untappd.com/b/oakflower-augury/1');
});

test('pickBestMatch still rejects a short candidate that only weakly overlaps a long query', () => {
  const candidates = [{ url: 'https://untappd.com/b/unrelated/1', title: 'Riverbend Brewing Golden Ale' }];
  const match = pickBestMatch(candidates, 'Oakflower Augury Dry Irish Stout');
  assert.equal(match, undefined);
});

// matchUntappdCandidates - see its own comment in productImport.js for why
// Untappd specifically needs to know about a tie rather than silently
// keeping pickBestMatch's own "first one wins" behavior.
test('matchUntappdCandidates returns a single confident match unambiguously, same candidate pickBestMatch would pick', () => {
  const candidates = [
    { url: 'https://untappd.com/b/a/1', title: 'Autodidact Beer Daylily' },
    { url: 'https://untappd.com/b/b/2', title: 'Unrelated Brewing Company Nightshade' },
  ];
  const result = matchUntappdCandidates(candidates, 'Autodidact Beer Daylily');
  assert.equal(result.match.url, 'https://untappd.com/b/a/1');
  assert.deepEqual(result.tied, []);
});

test('matchUntappdCandidates surfaces a tie instead of silently picking one', () => {
  // Same shape as a real miss: a query with no brewery-distinguishing word
  // left in it (see BEER_STYLE_WORD_PATTERN's deliberate exclusion of
  // "Light"/"Dark"/"Gold"/... in productImport.js) scores two real,
  // separately-listed Untappd beers identically.
  const candidates = [
    { url: 'https://untappd.com/b/autodidact-beer-daylily/1', title: 'Autodidact Beer Daylily' },
    { url: 'https://untappd.com/b/fox-farm-brewery-daylily/2', title: 'Fox Farm Brewery Daylily' },
  ];
  const result = matchUntappdCandidates(candidates, 'Daylily');
  assert.equal(result.match, undefined);
  assert.deepEqual(result.tied.map((c) => c.url), [
    'https://untappd.com/b/autodidact-beer-daylily/1',
    'https://untappd.com/b/fox-farm-brewery-daylily/2',
  ]);
});

test('matchUntappdCandidates returns no match and no tie when nothing meaningfully overlaps', () => {
  const candidates = [{ url: 'https://untappd.com/b/unrelated/1', title: 'Completely Unrelated Beer' }];
  const result = matchUntappdCandidates(candidates, 'Oakflower Augury');
  assert.equal(result.match, undefined);
  assert.deepEqual(result.tied, []);
});

test('parseWineComSearchResults reads candidates from ItemList JSON-LD', () => {
  const html = page({
    head: `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, item: { name: 'Josh Cellars Cabernet Sauvignon 2022', url: '/product/josh-cellars-cabernet-sauvignon-2022/123456' } },
      ],
    })}</script>`,
  });
  const candidates = parseWineComSearchResults(html, 'https://www.wine.com/search/josh%20cellars');
  assert.deepEqual(candidates, [
    { url: 'https://www.wine.com/product/josh-cellars-cabernet-sauvignon-2022/123456', title: 'Josh Cellars Cabernet Sauvignon 2022' },
  ]);
});

test('parseWineComSearchResults falls back to /product/ links when there is no ItemList JSON-LD', () => {
  const html = page({
    body: `
      <a href="/product/josh-cellars-cabernet-sauvignon-2022/123456">Josh Cellars Cabernet Sauvignon 2022</a>
      <a href="/account/login">Sign In</a>
    `,
  });
  const candidates = parseWineComSearchResults(html, 'https://www.wine.com/search/josh%20cellars');
  assert.deepEqual(candidates, [
    { url: 'https://www.wine.com/product/josh-cellars-cabernet-sauvignon-2022/123456', title: 'Josh Cellars Cabernet Sauvignon 2022' },
  ]);
});

test('parseWineComProductHtml prefers JSON-LD Product description, falling back to Open Graph', () => {
  const withLd = page({
    head: `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      name: 'Josh Cellars Cabernet Sauvignon 2022',
      description: 'Rich dark fruit with a hint of oak and vanilla.',
    })}</script>`,
  });
  assert.equal(
    parseWineComProductHtml(withLd, 'https://www.wine.com/product/x/1').description,
    'Rich dark fruit with a hint of oak and vanilla.'
  );

  const ogOnly = page({
    head: '<meta property="og:description" content="Bold and full-bodied." />',
  });
  assert.equal(parseWineComProductHtml(ogOnly, 'https://www.wine.com/product/x/1').description, 'Bold and full-bodied.');
});

test('wineComSearchUrl encodes the query', () => {
  assert.equal(wineComSearchUrl('Josh Cellars 2022'), 'https://www.wine.com/search/Josh%20Cellars%202022');
});

// ================================================================
// Vivino - the second tasting-notes provider. Reuses the same
// parseGenericSearchResults/parseGenericProductDescription logic as
// wine.com under the hood (see productImport.js), so these tests mirror
// the wine.com ones above but through Vivino's own exported names and URL
// shape (`/w/<id>` instead of `/product/<slug>/<id>`).
// ================================================================

test('parseVivinoSearchResults falls back to /w/ links when there is no ItemList JSON-LD', () => {
  const html = page({
    body: `
      <a href="/US/en/josh-cellars-cabernet-sauvignon/w/123456">Josh Cellars Cabernet Sauvignon 2022</a>
      <a href="/sign-in">Sign In</a>
    `,
  });
  const candidates = parseVivinoSearchResults(html, 'https://www.vivino.com/search/wines?q=josh%20cellars');
  assert.deepEqual(candidates, [
    { url: 'https://www.vivino.com/US/en/josh-cellars-cabernet-sauvignon/w/123456', title: 'Josh Cellars Cabernet Sauvignon 2022' },
  ]);
});

test('parseVivinoProductHtml prefers JSON-LD Product description, falling back to Open Graph', () => {
  const withLd = page({
    head: `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      name: 'Josh Cellars Cabernet Sauvignon 2022',
      description: 'Rich dark fruit with a hint of oak and vanilla.',
    })}</script>`,
  });
  assert.equal(
    parseVivinoProductHtml(withLd, 'https://www.vivino.com/US/en/x/w/1').description,
    'Rich dark fruit with a hint of oak and vanilla.'
  );

  const ogOnly = page({ head: '<meta property="og:description" content="Bold and full-bodied." />' });
  assert.equal(parseVivinoProductHtml(ogOnly, 'https://www.vivino.com/US/en/x/w/1').description, 'Bold and full-bodied.');
});

test('vivinoSearchUrl encodes the query', () => {
  assert.equal(vivinoSearchUrl('Josh Cellars 2022'), 'https://www.vivino.com/search/wines?q=Josh%20Cellars%202022');
});

test('findTastingNotes with source "Vivino" only searches Vivino', async () => {
  const searchHtml = page({
    body: '<a href="/US/en/josh-cellars-cabernet-sauvignon/w/123456">Josh Cellars Cabernet Sauvignon 2022</a>',
  });
  const productHtml = page({ head: '<meta property="og:description" content="Rich dark fruit." />' });
  await withMockFetch(
    async (url) => mockResponse({ status: 200, body: url.includes('/search/wines') ? searchHtml : productHtml }),
    async () => {
      const result = await findTastingNotes({ title: 'Josh Cellars Cabernet Sauvignon 2022', source: 'Vivino' });
      assert.equal(result.sourceName, 'Vivino');
    }
  );
});

test('findTastingNotes with "Any source" falls through to Vivino when Wine.com finds nothing', async () => {
  const vivinoSearchHtml = page({
    body: '<a href="/US/en/josh-cellars-cabernet-sauvignon/w/123456">Josh Cellars Cabernet Sauvignon 2022</a>',
  });
  const vivinoProductHtml = page({ head: '<meta property="og:description" content="Found on Vivino instead." />' });
  await withMockFetch(
    async (url) => {
      if (url.includes('wine.com')) return mockResponse({ status: 404 });
      if (url.includes('/search/wines')) return mockResponse({ status: 200, body: vivinoSearchHtml });
      return mockResponse({ status: 200, body: vivinoProductHtml });
    },
    async () => {
      const result = await findTastingNotes({ title: 'Josh Cellars Cabernet Sauvignon 2022' });
      assert.equal(result.sourceName, 'Vivino');
      assert.equal(result.description, 'Found on Vivino instead.');
    }
  );
});

// ================================================================
// Catalog-site requests being blocked outright (403) - confirmed in real
// use against both wine.com and Vivino, not just a hypothetical. Both
// routes through fetchCatalogHtml (see productImport.js): the
// browser-header retry already covered by the fetchBeerHtml tests above
// (same fetchHtmlResilient underneath), and turning a still-blocked
// response into the same kind of actionable message extractBeer already
// gives for a blocked Untappd request.
// ================================================================

test('findTastingNotes retries a blocked Wine.com response with browser headers before giving up', async () => {
  const searchHtml = page({
    body: '<a href="/product/josh-cellars-cabernet-sauvignon-2022/123456">Josh Cellars Cabernet Sauvignon 2022</a>',
  });
  const productHtml = page({ head: '<meta property="og:description" content="Rich dark fruit." />' });
  const calls = [];
  await withMockFetch(
    async (url, opts) => {
      calls.push(opts.headers);
      // Every attempt without the full-browser header set is blocked; only
      // the retry (which carries it) gets through.
      if (!opts.headers['Sec-Fetch-Mode']) return mockResponse({ status: 403 });
      return mockResponse({ status: 200, body: url.includes('/search/') ? searchHtml : productHtml });
    },
    async () => {
      const result = await findTastingNotes({ title: 'Josh Cellars Cabernet Sauvignon 2022', source: 'Wine.com' });
      assert.equal(result.sourceName, 'Wine.com');
    }
  );
  assert.ok(calls.length >= 2, 'a blocked first attempt should trigger the browser-header retry');
});

test('findTastingNotes turns a persistently blocked Wine.com response into an actionable message, not a bare HTTP status', async () => {
  await withMockFetch(
    async () => mockResponse({ status: 403 }),
    async () => {
      await assert.rejects(
        () => findTastingNotes({ title: 'Josh Cellars Cabernet Sauvignon 2022', source: 'Wine.com' }),
        /Wine\.com blocked this request/
      );
    }
  );
});

test('findTastingNotes turns a persistently blocked Vivino response into an actionable message too', async () => {
  await withMockFetch(
    async () => mockResponse({ status: 403 }),
    async () => {
      await assert.rejects(
        () => findTastingNotes({ title: 'Josh Cellars Cabernet Sauvignon 2022', source: 'Vivino' }),
        /Vivino blocked this request/
      );
    }
  );
});

test('findTastingNotes returns a description end-to-end against fixture search + product pages', async () => {
  const searchHtml = page({
    body: '<a href="/product/josh-cellars-cabernet-sauvignon-2022/123456">Josh Cellars Cabernet Sauvignon 2022</a>',
  });
  const productHtml = page({
    head: '<meta property="og:description" content="Rich dark fruit with a hint of oak and vanilla." />',
  });
  await withMockFetch(
    async (url) => mockResponse({ status: 200, body: url.includes('/search/') ? searchHtml : productHtml }),
    async () => {
      const result = await findTastingNotes({ title: 'Josh Cellars Cabernet Sauvignon 2022' });
      assert.equal(result.description, 'Rich dark fruit with a hint of oak and vanilla.');
      assert.equal(result.sourceName, 'Wine.com');
      assert.equal(result.sourceUrl, 'https://www.wine.com/product/josh-cellars-cabernet-sauvignon-2022/123456');
    }
  );
});

test('findTastingNotes surfaces a clear error when nothing matches', async () => {
  const searchHtml = page({ body: '<a href="/product/unrelated-wine/1">Completely Unrelated Wine 2019</a>' });
  await withMockFetch(
    async () => mockResponse({ status: 200, body: searchHtml }),
    async () => {
      await assert.rejects(
        () => findTastingNotes({ title: 'Josh Cellars Cabernet Sauvignon 2022' }),
        /Could not find "Josh Cellars Cabernet Sauvignon 2022" on Wine\.com/
      );
    }
  );
});

test('findTastingNotes rejects immediately when there is no title to search with', async () => {
  await assert.rejects(() => findTastingNotes({ title: '' }), /Enter a product title first\./);
});

test('TASTING_NOTE_PROVIDER_NAMES lists all three providers - the Source dropdown in the Find Tasting Notes dialog reads straight from this', () => {
  assert.deepEqual(TASTING_NOTE_PROVIDER_NAMES, ['Wine.com', 'Vivino', 'Distiller']);
});

test('findTastingNotes with a matching source only searches that provider', async () => {
  const searchHtml = page({
    body: '<a href="/product/josh-cellars-cabernet-sauvignon-2022/123456">Josh Cellars Cabernet Sauvignon 2022</a>',
  });
  const productHtml = page({ head: '<meta property="og:description" content="Rich dark fruit." />' });
  await withMockFetch(
    async (url) => mockResponse({ status: 200, body: url.includes('/search/') ? searchHtml : productHtml }),
    async () => {
      const result = await findTastingNotes({ title: 'Josh Cellars Cabernet Sauvignon 2022', source: 'Wine.com' });
      assert.equal(result.sourceName, 'Wine.com');
    }
  );
});

test('findTastingNotes rejects an unrecognized source without making any request', async () => {
  let calls = 0;
  await withMockFetch(
    async () => { calls += 1; return mockResponse({ status: 200 }); },
    async () => {
      await assert.rejects(
        () => findTastingNotes({ title: 'Josh Cellars Cabernet Sauvignon 2022', source: 'Total Wine' }),
        /Unknown tasting notes source: "Total Wine"/
      );
    }
  );
  assert.equal(calls, 0, 'an unrecognized source name should short-circuit before any fetch');
});

// ================================================================
// Distiller - the third tasting-notes provider, and the only one that
// returns Nose/Palate/Finish pre-split instead of one description blob
// (see productImport.js's own note above parseDistillerProductHtml). Same
// testing constraint as wine.com/Vivino above - no real fetch to
// distiller.com is available from here.
// ================================================================

test('distillerSearchUrl encodes the query', () => {
  assert.equal(distillerSearchUrl('Buffalo Trace Bourbon'), 'https://distiller.com/search?q=Buffalo%20Trace%20Bourbon');
});

test('parseDistillerSearchResults falls back to /spirits/ links when there is no ItemList JSON-LD', () => {
  const html = page({
    body: `
      <a href="/spirits/buffalo-trace-bourbon">Buffalo Trace Bourbon</a>
      <a href="/account/sign-in">Sign In</a>
    `,
  });
  const candidates = parseDistillerSearchResults(html, 'https://distiller.com/search?q=buffalo%20trace');
  assert.deepEqual(candidates, [
    { url: 'https://distiller.com/spirits/buffalo-trace-bourbon', title: 'Buffalo Trace Bourbon' },
  ]);
});

test('selectTastingNotesContainer prefers an element hinting at tasting notes over the full page', () => {
  const $ = cheerio.load(page({
    body: `
      <nav>Finish Line Rewards - Palate Cleanser Recipes - Nose around our other spirits</nav>
      <div class="tasting-notes">Nose: Caramel. Palate: Spice. Finish: Long.</div>
    `,
  }));
  const container = selectTastingNotesContainer($);
  assert.equal(container.hasClass('tasting-notes'), true);
});

test('selectTastingNotesContainer falls back to the full body when nothing hints at tasting notes', () => {
  const $ = cheerio.load(page({ body: '<p>Nose: Caramel. Palate: Spice. Finish: Long.</p>' }));
  const container = selectTastingNotesContainer($);
  assert.equal(container.is('body'), true);
});

test('extractFlavorNotes reads Nose/Palate/Finish from separate headings and paragraphs', () => {
  const $ = cheerio.load(page({
    body: `
      <div class="tasting-notes">
        <h3>Nose</h3><p>Caramel corn, toasted oak, dried cherry</p>
        <h3>Palate</h3><p>Brown sugar, baking spice, orange peel</p>
        <h3>Finish</h3><p>Long and warm, a whisper of black pepper</p>
      </div>
    `,
  }));
  assert.deepEqual(extractFlavorNotes($), {
    nose: 'Caramel corn, toasted oak, dried cherry',
    palate: 'Brown sugar, baking spice, orange peel',
    finish: 'Long and warm, a whisper of black pepper',
  });
});

test('extractFlavorNotes reads Nose/Palate/Finish from one inline run of text', () => {
  const $ = cheerio.load(page({
    body: '<div class="tasting-notes">Nose: caramel and oak. Palate: spice and brown sugar. Finish: long, warm.</div>',
  }));
  const notes = extractFlavorNotes($);
  assert.equal(notes.nose, 'caramel and oak');
  assert.equal(notes.palate, 'spice and brown sugar');
  assert.equal(notes.finish, 'long, warm');
});

test('extractFlavorNotes trims Finish (the label with nothing after it to bound it) at a buy-button/cross-sell stop phrase', () => {
  const $ = cheerio.load(page({
    body: '<div class="tasting-notes">Finish: long and warm, a whisper of pepper. Buy Now for $34.99. You might also like...</div>',
  }));
  assert.equal(extractFlavorNotes($).finish, 'long and warm, a whisper of pepper');
});

test('extractFlavorNotes does not mistake "Finished..." for a Finish label', () => {
  const $ = cheerio.load(page({
    body: '<div class="tasting-notes">Finished in a sherry cask for the last six months.</div>',
  }));
  assert.deepEqual(extractFlavorNotes($), {});
});

test('extractFlavorNotes leaves out whichever label the page never has', () => {
  const $ = cheerio.load(page({
    body: '<div class="tasting-notes">Nose: caramel and oak. Finish: long, warm.</div>',
  }));
  assert.deepEqual(extractFlavorNotes($), { nose: 'caramel and oak', finish: 'long, warm' });
});

test('parseDistillerProductHtml combines the generic description fallback with Nose/Palate/Finish', () => {
  const html = page({
    head: '<meta property="og:description" content="A cornerstone of the American whiskey category." />',
    body: '<div class="tasting-notes">Nose: caramel corn. Palate: brown sugar. Finish: long and warm.</div>',
  });
  const result = parseDistillerProductHtml(html, 'https://distiller.com/spirits/buffalo-trace-bourbon');
  assert.equal(result.description, 'A cornerstone of the American whiskey category.');
  assert.equal(result.nose, 'caramel corn');
  assert.equal(result.palate, 'brown sugar');
  assert.equal(result.finish, 'long and warm');
});

test('findTastingNotes with source "Distiller" and allowExperimental returns Nose/Palate/Finish end-to-end against fixture pages', async () => {
  const searchHtml = page({ body: '<a href="/spirits/buffalo-trace-bourbon">Buffalo Trace Bourbon</a>' });
  const productHtml = page({
    body: '<div class="tasting-notes">Nose: caramel corn, toasted oak. Palate: brown sugar, baking spice. Finish: long and warm.</div>',
  });
  await withMockFetch(
    async (url) => mockResponse({ status: 200, body: url.includes('/search?q=') ? searchHtml : productHtml }),
    async () => {
      const result = await findTastingNotes({ title: 'Buffalo Trace Bourbon', source: 'Distiller', allowExperimental: true });
      assert.equal(result.sourceName, 'Distiller');
      assert.equal(result.nose, 'caramel corn, toasted oak');
      assert.equal(result.palate, 'brown sugar, baking spice');
      assert.equal(result.finish, 'long and warm');
      assert.equal(result.description, '', 'no meta/JSON-LD description on this fixture - should come back empty, not undefined');
    }
  );
});

test('findTastingNotes with "Any source" and allowExperimental falls all the way through to Distiller when Wine.com and Vivino both find nothing', async () => {
  const distillerSearchHtml = page({ body: '<a href="/spirits/buffalo-trace-bourbon">Buffalo Trace Bourbon</a>' });
  const distillerProductHtml = page({ body: '<div class="tasting-notes">Nose: caramel. Palate: spice. Finish: long.</div>' });
  await withMockFetch(
    async (url) => {
      if (url.includes('wine.com') || url.includes('vivino.com')) return mockResponse({ status: 404 });
      if (url.includes('/search?q=')) return mockResponse({ status: 200, body: distillerSearchHtml });
      return mockResponse({ status: 200, body: distillerProductHtml });
    },
    async () => {
      const result = await findTastingNotes({ title: 'Buffalo Trace Bourbon', allowExperimental: true });
      assert.equal(result.sourceName, 'Distiller');
      assert.equal(result.nose, 'caramel');
    }
  );
});

test('findTastingNotes turns a persistently blocked Distiller response into an actionable message too, when allowed', async () => {
  await withMockFetch(
    async () => mockResponse({ status: 403 }),
    async () => {
      await assert.rejects(
        () => findTastingNotes({ title: 'Buffalo Trace Bourbon', source: 'Distiller', allowExperimental: true }),
        /Distiller blocked this request/
      );
    }
  );
});

// ================================================================
// The "Experimental Features -> Bourbon Shelf Talkers" gate (Settings) -
// Distiller is the one provider marked experimental (see
// TASTING_NOTE_PROVIDERS), and findTastingNotes has to actually enforce
// that server-side, not just trust the dropdown filtering app.js already
// does client-side (see the note above findTastingNotes).
// ================================================================

test('TASTING_NOTE_EXPERIMENTAL_PROVIDER_NAMES lists only Distiller', () => {
  assert.deepEqual(TASTING_NOTE_EXPERIMENTAL_PROVIDER_NAMES, ['Distiller']);
});

test('findTastingNotes rejects an explicit source: "Distiller" without allowExperimental, before making any request', async () => {
  let calls = 0;
  await withMockFetch(
    async () => { calls += 1; return mockResponse({ status: 200 }); },
    async () => {
      await assert.rejects(
        () => findTastingNotes({ title: 'Buffalo Trace Bourbon', source: 'Distiller' }),
        /Distiller is an experimental source - turn on Experimental Features -> Bourbon Shelf Talkers in Settings first\./
      );
    }
  );
  assert.equal(calls, 0, 'an experimental source without the flag should short-circuit before any fetch');
});

test('findTastingNotes with "Any source" and no allowExperimental skips Distiller entirely, even when Wine.com and Vivino both find nothing', async () => {
  const calls = [];
  await withMockFetch(
    async (url) => {
      calls.push(url);
      return mockResponse({ status: 404 });
    },
    async () => {
      await assert.rejects(
        () => findTastingNotes({ title: 'Buffalo Trace Bourbon' }),
        (err) => {
          assert.match(err.message, /Wine\.com/);
          assert.match(err.message, /Vivino/);
          assert.doesNotMatch(err.message, /Distiller/);
          return true;
        }
      );
    }
  );
  assert.ok(calls.every((url) => !url.includes('distiller.com')), 'Distiller should never be reached while the toggle is off');
});

// ================================================================
// Store SKU lookup (the "SKU Lookup" tab). Unlike the wine.com/Vivino/
// Untappd parsing above, these fixtures are modeled on real markup a staff
// member copied out of their own browser against a live SKU
// (liquoroutletwinecellars.com, SKU 09144 "Michelob ULTRA") - both the
// search-results page and the product page it led to - rather than a
// guess written against an environment that couldn't reach the site at
// all. See the note above parseStoreProductHtml in productImport.js.
// ================================================================

test('storeSearchUrl builds the store\'s GET search URL with a trailing wildcard', () => {
  assert.equal(
    storeSearchUrl('09144'),
    'https://www.liquoroutletwinecellars.com/store/search.asp?keyword=09144*'
  );
});

test('parseStoreSearchResults reads SKU/url/title/brand from product-list-item cards', () => {
  const html = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="09144" />
        <a class="product-link" href="/Michelob-ULTRA-09144-1009144/">
          <span class="productnameTitle">Michelob ULTRA</span>
        </a>
        <h6>Anheuser-Busch</h6>
      </div>
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="09145" />
        <a class="product-link" href="/Michelob-ULTRA-LIGHT-09145-1009145/">
          <span class="productnameTitle">Michelob ULTRA Light</span>
        </a>
        <h6>Anheuser-Busch</h6>
      </div>
    `,
  });
  const candidates = parseStoreSearchResults(html, 'https://www.liquoroutletwinecellars.com/store/search.asp?keyword=09144*');
  assert.deepEqual(candidates, [
    { sku: '09144', url: 'https://www.liquoroutletwinecellars.com/Michelob-ULTRA-09144-1009144/', title: 'Michelob ULTRA', brand: 'Anheuser-Busch' },
    { sku: '09145', url: 'https://www.liquoroutletwinecellars.com/Michelob-ULTRA-LIGHT-09145-1009145/', title: 'Michelob ULTRA Light', brand: 'Anheuser-Busch' },
  ]);
});

test('parseStoreSearchResults skips a card missing a SKU or URL', () => {
  const html = page({
    body: `
      <div class="product-list-item">
        <a class="product-link" href="/no-sku-here/"><span class="productnameTitle">No SKU Item</span></a>
      </div>
    `,
  });
  assert.deepEqual(parseStoreSearchResults(html, 'https://www.liquoroutletwinecellars.com/store/search.asp?keyword=x*'), []);
});

test('pickSkuMatch finds the candidate with an exact SKU match, not a partial/fuzzy one', () => {
  const candidates = [
    { sku: '09144', url: 'https://example.com/a', title: 'A', brand: 'X' },
    { sku: '09145', url: 'https://example.com/b', title: 'B', brand: 'X' },
  ];
  assert.deepEqual(pickSkuMatch(candidates, '09145'), candidates[1]);
  assert.equal(pickSkuMatch(candidates, '99999'), undefined);
  assert.equal(pickSkuMatch(candidates, '0914'), undefined, 'a partial SKU must not match');
});

test('parseStoreProductHtml reads title/brand/sku/size/price/description from a real product page shape', () => {
  const html = page({
    head: `
      <meta property="og:title" content="Michelob ULTRA" />
      <meta property="og:upc" content="09144" />
      <meta property="og:brand" content="Anheuser-Busch" />
    `,
    body: `
      <h1 itemprop="name">Michelob ULTRA</h1>
      <h6><a href="/brand/anheuser-busch">Anheuser-Busch</a></h6>
      <div class="pricingDetails">
        <span class="priceFull">$8.99</span>
        <span class="priceCurrent">$7.99</span>
      </div>
      <table>
        <tr><th>SKU</th><td>09144</td></tr>
        <tr><th>Size</th><td>12pk-12oz Cans</td></tr>
      </table>
      <div id="description">
        <div class="text-product-desc">A superior light beer. Untappd Rating: 2.49</div>
      </div>
    `,
  });
  const result = parseStoreProductHtml(html, 'https://www.liquoroutletwinecellars.com/Michelob-ULTRA-09144-1009144/');
  assert.deepEqual(result, {
    title: 'Michelob ULTRA',
    brand: 'Anheuser-Busch',
    sku: '09144',
    size: '12pk-12oz Cans',
    packSize: '',
    vintage: '',
    price: '8.99',
    salePrice: '7.99',
    description: 'A superior light beer. Untappd Rating: 2.49',
    sourceUrl: 'https://www.liquoroutletwinecellars.com/Michelob-ULTRA-09144-1009144/',
  });
});

// This product's Size row is the container only ("16oz") with a separate
// Pack Size row ("4-Pack") - unlike the Michelob ULTRA fixture above, whose
// Size row already reads the pack count combined in ("12pk-12oz Cans").
// Both shapes are real (see the module comment above parseStoreProductHtml)
// - parseStoreProductHtml itself keeps them separate either way; only
// combineBeerSize (beer-only, via enrichBeerFromUntappd - see the
// lookupSku test further down) folds Size and Pack Size into one value.
test('parseStoreProductHtml reads a separate Pack Size row from the spec table without combining it into size', () => {
  const html = page({
    body: `
      <h1 itemprop="name">New Anthem Hazy IPA</h1>
      <table>
        <tr><th>Size</th><td>16oz</td></tr>
        <tr><th>Pack Size</th><td>4-Pack</td></tr>
      </table>
    `,
  });
  const result = parseStoreProductHtml(html, 'https://www.liquoroutletwinecellars.com/New-Anthem-Hazy-IPA-12345-1012345/');
  assert.equal(result.size, '16oz');
  assert.equal(result.packSize, '4-Pack');
});

// Mirrors the Year row's "Not Specified" placeholder handling right above -
// a single-item product's Pack Size row reads that literal text instead of
// being blank or absent.
test('parseStoreProductHtml leaves packSize blank when the store\'s Pack Size row reads "Not Specified"', () => {
  const html = page({
    body: `
      <h1 itemprop="name">Josh Cellars Cabernet Sauvignon</h1>
      <table>
        <tr><th>Size</th><td>750mL</td></tr>
        <tr><th>Pack Size</th><td>Not Specified</td></tr>
      </table>
    `,
  });
  const result = parseStoreProductHtml(html, 'https://www.liquoroutletwinecellars.com/Josh-Cellars-55555-1055555/');
  assert.equal(result.packSize, '');
});

// The store's own Brand link reads "Not Specified" (not a blank row, and
// not just absent) for a product with no manufacturer on file - same
// placeholder, same handling, as Pack Size/Year above. Left unguarded, this
// used to get prepended straight onto the title by composeProducerTitle
// ("Not Specified Hazy IPA") and sent to Untappd as part of the search
// query along with it.
test('parseStoreProductHtml leaves brand blank when the store\'s Brand link reads "Not Specified"', () => {
  const html = page({
    body: `
      <h1 itemprop="name">Hazy IPA</h1>
      <h6><a href="/brand/not-specified">Not Specified</a></h6>
      <table>
        <tr><th>Size</th><td>16oz</td></tr>
      </table>
    `,
  });
  const result = parseStoreProductHtml(html, 'https://www.liquoroutletwinecellars.com/Hazy-IPA-12345-1012345/');
  assert.equal(result.brand, '');
});

// Same placeholder, but on the og:brand meta fallback instead of the h6
// link - and with a real brand sitting in the *other* source, confirming
// the placeholder is dropped from each source individually rather than
// blanking the brand outright just because one of the two reads it.
test('parseStoreProductHtml falls back to a real og:brand when the store\'s Brand link reads "Not Specified"', () => {
  const html = page({
    head: '<meta property="og:brand" content="New Anthem Beer Project" />',
    body: `
      <h1 itemprop="name">Hazy IPA</h1>
      <h6><a href="/brand/not-specified">Not Specified</a></h6>
    `,
  });
  const result = parseStoreProductHtml(html, 'https://www.liquoroutletwinecellars.com/Hazy-IPA-12345-1012345/');
  assert.equal(result.brand, 'New Anthem Beer Project');
});

// A real miss (SKU 36211): the store's Brand link reads "AB" - a short
// internal vendor/distributor code, not the actual producer ("Autodidact") -
// which used to get prepended onto the title by composeProducerTitle ("AB
// Autodidact Abaddon") and sent to Untappd as part of the search query,
// breaking the match entirely.
test('parseStoreProductHtml leaves brand blank when the store\'s Brand link reads a short vendor code', () => {
  const html = page({
    body: `
      <h1 itemprop="name">Autodidact Abaddon</h1>
      <h6><a href="/brand/ab">AB</a></h6>
      <table>
        <tr><th>Size</th><td>16oz</td></tr>
      </table>
    `,
  });
  const result = parseStoreProductHtml(html, 'https://www.liquoroutletwinecellars.com/Autodidact-Abaddon-36211-1036211/');
  assert.equal(result.brand, '');
});

// Same vendor-code handling, but on the og:brand meta fallback - dropped
// from each source individually, same as the "Not Specified" placeholder
// above.
test('parseStoreProductHtml falls back to a real og:brand when the store\'s Brand link reads a short vendor code', () => {
  const html = page({
    head: '<meta property="og:brand" content="Autodidact" />',
    body: `
      <h1 itemprop="name">Autodidact Abaddon</h1>
      <h6><a href="/brand/ab">AB</a></h6>
    `,
  });
  const result = parseStoreProductHtml(html, 'https://www.liquoroutletwinecellars.com/Autodidact-Abaddon-36211-1036211/');
  assert.equal(result.brand, 'Autodidact');
});

test('parseStoreProductHtml reads a vintage year from the spec table\'s Year row', () => {
  const html = page({
    body: `
      <h1 itemprop="name">Josh Cellars Cabernet Sauvignon</h1>
      <div class="pricingDetails"><span class="priceFull">$13.99</span></div>
      <table>
        <tr><th>Varietal</th><td>Cabernet Sauvignon</td></tr>
        <tr><th>Year</th><td>2022</td></tr>
        <tr><th>Size</th><td>750mL</td></tr>
      </table>
    `,
  });
  const result = parseStoreProductHtml(html, 'https://www.liquoroutletwinecellars.com/Josh-Cellars-Cabernet-55555-1055555/');
  assert.equal(result.vintage, '2022');
  assert.equal(result.size, '750mL');
});

test('parseStoreProductHtml falls back to guessing a vintage year from the title when there is no Year row', () => {
  const html = page({
    body: '<h1 itemprop="name">Josh Cellars Cabernet Sauvignon 2022</h1>'
      + '<div class="pricingDetails"><span class="priceFull">$13.99</span></div>',
  });
  const result = parseStoreProductHtml(html, 'https://www.liquoroutletwinecellars.com/Josh-Cellars-Cabernet-55555-1055555/');
  assert.equal(result.vintage, '2022');
});

test('parseStoreProductHtml leaves vintage blank when the page has no Year row and no year in the title', () => {
  const html = page({
    body: '<h1 itemprop="name">Michelob ULTRA</h1><div class="pricingDetails"><span class="priceFull">$8.99</span></div>',
  });
  const result = parseStoreProductHtml(html, 'https://www.liquoroutletwinecellars.com/Michelob-ULTRA-09144-1009144/');
  assert.equal(result.vintage, '');
});

test('parseStoreProductHtml leaves vintage blank when the store\'s Year row reads "Not Specified" instead of a year', () => {
  const html = page({
    body: `
      <h1 itemprop="name">NV Champagne Brut</h1>
      <div class="pricingDetails"><span class="priceFull">$29.99</span></div>
      <table>
        <tr><th>Varietal</th><td>Champagne</td></tr>
        <tr><th>Year</th><td>Not Specified</td></tr>
      </table>
    `,
  });
  const result = parseStoreProductHtml(html, 'https://www.liquoroutletwinecellars.com/NV-Champagne-Brut-12345-1012345/');
  assert.equal(result.vintage, '');
});

test('parseStoreProductHtml falls back to Open Graph/meta tags when the page has no spec table', () => {
  const html = page({
    head: `
      <meta property="og:title" content="Michelob ULTRA" />
      <meta property="og:upc" content="09144" />
      <meta property="og:brand" content="Anheuser-Busch" />
      <meta property="og:price:standard_amount" content="8.99" />
      <meta property="og:description" content="A superior light beer." />
    `,
    body: '<div class="unrelated-redesign">Some other layout entirely.</div>',
  });
  const result = parseStoreProductHtml(html, 'https://www.liquoroutletwinecellars.com/Michelob-ULTRA-09144-1009144/');
  assert.equal(result.title, 'Michelob ULTRA');
  assert.equal(result.brand, 'Anheuser-Busch');
  assert.equal(result.sku, '09144');
  assert.equal(result.price, '8.99');
  assert.equal(result.salePrice, '');
  assert.equal(result.description, 'A superior light beer.');
});

test('parseStoreProductHtml throws when the page has no title at all', () => {
  const html = page({ body: '<div>nothing useful here</div>' });
  assert.throws(() => parseStoreProductHtml(html, 'https://example.com/x'), /Could not find product details/);
});

test('lookupStoreSku searches, exact-matches the SKU, then extracts the product page', async () => {
  const searchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="09144" />
        <a class="product-link" href="/Michelob-ULTRA-09144-1009144/">
          <span class="productnameTitle">Michelob ULTRA</span>
        </a>
        <h6>Anheuser-Busch</h6>
      </div>
    `,
  });
  const productHtml = page({
    body: `
      <h1 itemprop="name">Michelob ULTRA</h1>
      <div class="pricingDetails"><span class="priceFull">$8.99</span></div>
      <table><tr><th>Size</th><td>12pk-12oz Cans</td></tr></table>
    `,
  });
  const requestedUrls = [];
  await withMockFetch(
    async (url) => {
      requestedUrls.push(url);
      if (url.includes('/store/search.asp')) return mockResponse({ status: 200, body: searchHtml });
      return mockResponse({ status: 200, body: productHtml });
    },
    async () => {
      const result = await lookupStoreSku('09144');
      assert.equal(result.title, 'Michelob ULTRA');
      assert.equal(result.price, '8.99');
      assert.equal(result.size, '12pk-12oz Cans');
    }
  );
  assert.equal(requestedUrls[0], 'https://www.liquoroutletwinecellars.com/store/search.asp?keyword=09144*');
  assert.equal(requestedUrls[1], 'https://www.liquoroutletwinecellars.com/Michelob-ULTRA-09144-1009144/');
});

test('lookupStoreSku throws a clear error when no search result matches the SKU exactly', async () => {
  const searchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="09145" />
        <a class="product-link" href="/Michelob-ULTRA-LIGHT-09145-1009145/">
          <span class="productnameTitle">Michelob ULTRA Light</span>
        </a>
      </div>
    `,
  });
  await withMockFetch(
    async () => mockResponse({ status: 200, body: searchHtml }),
    async () => {
      await assert.rejects(() => lookupStoreSku('09144'), /No product found for SKU "09144"/);
    }
  );
});

test('lookupStoreSku rejects immediately when given a blank SKU', async () => {
  await assert.rejects(() => lookupStoreSku('  '), /Enter a SKU first\./);
});

test('lookupStoreSku turns a persistently blocked store response into an actionable message', async () => {
  await withMockFetch(
    async () => mockResponse({ status: 403 }),
    async () => {
      await assert.rejects(() => lookupStoreSku('09144'), /store site blocked this automated request/);
    }
  );
});

test('parsePastedStoreProduct parses store product HTML the same way lookupStoreSku would', () => {
  const html = page({
    body: '<h1 itemprop="name">Michelob ULTRA</h1><div class="pricingDetails"><span class="priceFull">$8.99</span></div>',
  });
  const result = parsePastedStoreProduct({ html, url: 'https://www.liquoroutletwinecellars.com/Michelob-ULTRA-09144-1009144/' });
  assert.equal(result.title, 'Michelob ULTRA');
  assert.equal(result.sourceUrl, 'https://www.liquoroutletwinecellars.com/Michelob-ULTRA-09144-1009144/');
});

test('parsePastedStoreProduct rejects an empty paste without attempting to parse it', () => {
  assert.throws(() => parsePastedStoreProduct({ html: '   ' }), /Paste the page's HTML first\./);
});

// ================================================================
// Untappd search-by-name - the SKU lookup's beer-specific enrichment step.
// Confirmed directly (a real user's DevTools, not a guess) that Untappd's
// own search page can't be scraped at all - it's rendered client-side by
// Algolia InstantSearch - so this calls that same Algolia endpoint the
// widget itself calls, using the app ID/API key/index name pulled from a
// real search's Network tab. The beer-page fetch and parse after a match
// is found is unconfirmed from this environment, same caveat as the rest
// of the Untappd parsing further up in this file.
// ================================================================

function algoliaHitsResponse(hits) {
  return JSON.stringify({ results: [{ hits }] });
}

test('algoliaSearchBeerCandidates queries the "beer" index and maps hits into {url, title, brewery, beerName} candidates', async () => {
  const hits = [
    { beer_slug: 'autodidact-beer-daylily', bid: 5251415, beer_name: 'Daylily', brewery_name: 'Autodidact Beer' },
    { beer_slug: 'fox-farm-brewery-daylily', bid: 2212715, beer_name: 'Daylily', brewery_name: 'Fox Farm Brewery' },
  ];
  let requestedUrl;
  let requestedOpts;
  let requestedBody;
  await withMockFetch(
    async (url, opts) => {
      requestedUrl = url;
      requestedOpts = opts;
      requestedBody = JSON.parse(opts.body);
      return mockResponse({ status: 200, body: algoliaHitsResponse(hits) });
    },
    async () => {
      const candidates = await algoliaSearchBeerCandidates('daylily');
      assert.deepEqual(candidates, [
        {
          url: 'https://untappd.com/b/autodidact-beer-daylily/5251415',
          title: 'Autodidact Beer Daylily',
          brewery: 'Autodidact Beer',
          beerName: 'Daylily',
        },
        {
          url: 'https://untappd.com/b/fox-farm-brewery-daylily/2212715',
          title: 'Fox Farm Brewery Daylily',
          brewery: 'Fox Farm Brewery',
          beerName: 'Daylily',
        },
      ]);
    }
  );
  assert.match(requestedUrl, /^https:\/\/9WBO4RQ3HO-dsn\.algolia\.net\/1\/indexes\/\*\/queries\?/);
  assert.equal(requestedBody.requests[0].indexName, 'beer');
  assert.match(requestedBody.requests[0].params, /query=daylily/);
  // Regression test for a real 403 from Algolia itself against v2.0.6: the
  // search-only key is locked to Untappd's own site via Algolia's
  // HTTP-referrer restriction, which a real browser satisfies automatically
  // but a server-side fetch has to fake by hand.
  assert.equal(requestedOpts.headers.Referer, 'https://untappd.com/');
  assert.equal(requestedOpts.headers.Origin, 'https://untappd.com');
});

test('algoliaSearchBeerCandidates surfaces a clear error when the Algolia request itself fails', async () => {
  await withMockFetch(
    async () => mockResponse({ status: 403 }),
    async () => {
      await assert.rejects(
        () => algoliaSearchBeerCandidates('daylily'),
        /Untappd's search isn't responding right now \(403\)\./
      );
    }
  );
});

test('searchUntappd finds a match and returns full parseBeerHtml fields', async () => {
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'anheuser-busch-michelob-ultra', bid: 1234, beer_name: 'Michelob ULTRA', brewery_name: 'Anheuser-Busch' },
  ]);
  const beerHtml = page({
    head: '<meta property="og:title" content="Michelob ULTRA by Anheuser-Busch | Untappd" />'
      + '<meta property="og:description" content="A superior light beer." />',
    body: '<p class="brewery"><a href="#">Anheuser-Busch</a></p><p class="style">Light Lager</p>',
  });
  await withMockFetch(
    async (url) => mockResponse({ status: 200, body: url.includes('algolia.net') ? algoliaBody : beerHtml }),
    async () => {
      const result = await searchUntappd('Michelob ULTRA');
      assert.equal(result.title, 'Michelob ULTRA');
      assert.equal(result.brewery, 'Anheuser-Busch');
      assert.equal(result.style, 'Light Lager');
      assert.equal(result.description, 'A superior light beer.');
    }
  );
});

// Same gap as untappdBeerFromUrl's regression test above, in the automatic
// search path this time: searchUntappd's own beerHtml fetch also went
// straight into bare parseBeerHtml, so a real search-driven SKU lookup for
// a beer would come back with brewery/style/ABV/rating but never location,
// even when Untappd itself had one for that beer.
test('searchUntappd follows the brewery link and fills in location, same as extractBeer does', async () => {
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'autodidact-beer-daylily', bid: 9999, beer_name: 'Daylily', brewery_name: 'Autodidact Beer' },
  ]);
  const beerHtml = page({
    head: '<meta property="og:title" content="Daylily by Autodidact Beer | Untappd" />',
    body: '<p class="brewery"><a href="/w/autodidact-beer/432029">Autodidact Beer</a></p>',
  });
  const breweryHtml = page({
    body: '<div class="basic"><div class="name"><h1>Autodidact Beer</h1>'
      + '<p class="brewery">Wilmington, NC United States</p></div></div>',
  });
  await withMockFetch(
    async (url) => {
      if (url.includes('algolia.net')) return mockResponse({ status: 200, body: algoliaBody });
      if (url.includes('/w/autodidact-beer/432029')) return mockResponse({ status: 200, body: breweryHtml });
      return mockResponse({ status: 200, body: beerHtml });
    },
    async () => {
      const result = await searchUntappd('Daylily');
      assert.equal(result.brewery, 'Autodidact Beer');
      assert.equal(result.location, 'Wilmington, NC United States');
    }
  );
});

test('searchUntappd surfaces a clear error when nothing matches', async () => {
  await withMockFetch(
    async () => mockResponse({ status: 200, body: algoliaHitsResponse([]) }),
    async () => {
      await assert.rejects(() => searchUntappd('Nonexistent Beer'), /Could not find "Nonexistent Beer" on Untappd\./);
    }
  );
});

// Regression coverage for the disambiguation picker (see
// UntappdAmbiguousMatchError/matchUntappdCandidates in productImport.js) -
// a query with no brewery-distinguishing word left in it scores two real,
// separately-listed Untappd beers identically. searchUntappd throws a
// typed error carrying both, rather than silently keeping the first one
// (or, worse, failing outright) - no beer-page fetch happens for either,
// since which one to fetch is exactly what's unresolved.
test('searchUntappd throws UntappdAmbiguousMatchError with the tied candidates when nothing breaks the tie', async () => {
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'autodidact-beer-daylily', bid: 1, beer_name: 'Daylily', brewery_name: 'Autodidact Beer' },
    { beer_slug: 'fox-farm-brewery-daylily', bid: 2, beer_name: 'Daylily', brewery_name: 'Fox Farm Brewery' },
  ]);
  let beerPageFetched = false;
  await withMockFetch(
    async (url) => {
      if (url.includes('algolia.net')) return mockResponse({ status: 200, body: algoliaBody });
      beerPageFetched = true;
      return mockResponse({ status: 200, body: page({}) });
    },
    async () => {
      await assert.rejects(() => searchUntappd('Daylily'), (err) => {
        assert.ok(err instanceof UntappdAmbiguousMatchError);
        assert.equal(err.candidates.length, 2);
        assert.equal(err.candidates[0].brewery, 'Autodidact Beer');
        assert.equal(err.candidates[1].brewery, 'Fox Farm Brewery');
        return true;
      });
    }
  );
  assert.equal(beerPageFetched, false, 'neither candidate\'s own page should be fetched while the tie is unresolved');
});

// Regression test for a real Scan UPC miss: the store's own title carries
// style words ("Dry Irish Stout") that never show up in Untappd's own
// "<Brewery> <Beer Name>" hit title, which used to dilute the match below
// pickBestMatch's threshold and fail the whole search - see the comment
// above pickBestMatch for the full story.
test('searchUntappd finds a match even when the query carries style words the Untappd title does not', async () => {
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'oakflower-brewing-company-augury', bid: 4242, beer_name: 'Augury', brewery_name: 'Oakflower Brewing Company' },
  ]);
  const beerHtml = page({
    head: '<meta property="og:title" content="Augury by Oakflower Brewing Company | Untappd" />',
    body: '<p class="brewery"><a href="#">Oakflower Brewing Company</a></p><p class="style">Stout - Irish Dry</p>',
  });
  await withMockFetch(
    async (url) => mockResponse({ status: 200, body: url.includes('algolia.net') ? algoliaBody : beerHtml }),
    async () => {
      const result = await searchUntappd('Oakflower Augury Dry Irish Stout');
      assert.equal(result.title, 'Augury');
      assert.equal(result.brewery, 'Oakflower Brewing Company');
    }
  );
});

// enrichBeerFromUntappd - end-to-end coverage that buildUntappdSearchQuery
// is actually wired in, using a brewery legal name long enough that
// pickBestMatch's own min(query, candidate) threshold (see its comment) is
// no longer enough on its own: an *unstripped* 5-word query against this
// 5-word candidate title needs 3 overlapping words, but "Oakflower"/
// "Augury" is only ever 2 - stripping the query down to just those two
// words is what actually gets it under a 1-word bar instead. Confirms both
// halves at once: the request Algolia actually receives has the style
// words gone, and the *displayed* title (what ends up on the talker) still
// has them, unchanged.
test('enrichBeerFromUntappd strips style words from the Untappd query without touching the displayed title', async () => {
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'oakflower-craft-brewing-company-augury', bid: 4242, beer_name: 'Augury', brewery_name: 'Oakflower Craft Brewing Company' },
  ]);
  const beerHtml = page({
    head: '<meta property="og:title" content="Augury by Oakflower Craft Brewing Company | Untappd" />',
    body: '<p class="brewery"><a href="#">Oakflower Craft Brewing Company</a></p><p class="style">Stout - Irish Dry</p>',
  });
  let requestedBody;
  await withMockFetch(
    async (url, opts) => {
      if (url.includes('algolia.net')) {
        requestedBody = JSON.parse(opts.body);
        return mockResponse({ status: 200, body: algoliaBody });
      }
      return mockResponse({ status: 200, body: beerHtml });
    },
    async () => {
      const result = await enrichBeerFromUntappd({
        title: 'Augury Dry Irish Stout', brand: 'Oakflower', size: '', sku: '41305',
      });
      assert.equal(result.title, 'Oakflower Augury Dry Irish Stout', 'the Product Title field keeps its style suffix');
      assert.equal(result.brewery, 'Oakflower Craft Brewing Company');
      assert.equal(result.untappdError, undefined);
    }
  );
  assert.match(requestedBody.requests[0].params, /query=Oakflower%20Augury(&|$)/);
});

// Regression coverage for the disambiguation picker at the level Scan UPC/
// SKU Lookup/Search by Name actually see it: enrichBeerFromUntappd's own
// catch block special-cases UntappdAmbiguousMatchError into
// `untappdCandidates`, not `untappdError` - the two are meant to be
// mutually exclusive so a caller only needs to check one to know which
// situation it's looking at (see the comment above enrichBeerFromUntappd).
test('enrichBeerFromUntappd surfaces untappdCandidates instead of untappdError when Untappd itself can\'t break a tie', async () => {
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'autodidact-beer-daylily', bid: 1, beer_name: 'Daylily', brewery_name: 'Autodidact Beer' },
    { beer_slug: 'fox-farm-brewery-daylily', bid: 2, beer_name: 'Daylily', brewery_name: 'Fox Farm Brewery' },
  ]);
  await withMockFetch(
    async () => mockResponse({ status: 200, body: algoliaBody }),
    async () => {
      const result = await enrichBeerFromUntappd({ title: 'Daylily', brand: '', size: '' });
      assert.equal(result.untappdError, undefined);
      assert.equal(result.untappdCandidates.length, 2);
      assert.deepEqual(result.untappdCandidates.map((c) => c.brewery), ['Autodidact Beer', 'Fox Farm Brewery']);
      // The store-sourced fields still fill in, same as an outright miss -
      // staff aren't blocked from queuing the talker while a pick is
      // pending, just missing the Untappd-only fields until they make one.
      assert.equal(result.title, 'Daylily');
    }
  );
});

// ================================================================
// lookupSku / lookupSkuFromHtml - the end-to-end orchestration behind
// /api/sku-lookup and /api/sku-lookup-html: store lookup always, plus a
// best-effort Untappd enrichment step for beer only.
// ================================================================

test('lookupSku enriches a beer entry with Untappd data on top of the store lookup', async () => {
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="09144" />
        <a class="product-link" href="/Michelob-ULTRA-09144-1009144/">
          <span class="productnameTitle">Michelob ULTRA</span>
        </a>
      </div>
    `,
  });
  const storeProductHtml = page({
    body: `
      <h1 itemprop="name">Michelob ULTRA</h1>
      <div class="pricingDetails"><span class="priceFull">$8.99</span></div>
      <table><tr><th>Size</th><td>12pk-12oz Cans</td></tr></table>
      <div id="description"><div class="text-product-desc">A superior light beer. Untappd Rating: 2.49</div></div>
    `,
  });
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'anheuser-busch-michelob-ultra', bid: 1234, beer_name: 'Michelob ULTRA', brewery_name: 'Anheuser-Busch' },
  ]);
  const untappdBeerHtml = page({
    head: '<meta property="og:title" content="Michelob ULTRA by Anheuser-Busch | Untappd" />'
      + '<meta property="og:description" content="Fallback SEO description." />',
    body: '<p class="brewery"><a href="#">Anheuser-Busch</a></p><p class="style">Light Lager</p>'
      + '<div class="details"><p class="abv">4.20% ABV</p></div>',
  });
  await withMockFetch(
    async (url) => {
      if (url.includes('/store/search.asp')) return mockResponse({ status: 200, body: storeSearchHtml });
      if (url.includes('liquoroutletwinecellars.com/Michelob')) return mockResponse({ status: 200, body: storeProductHtml });
      if (url.includes('algolia.net')) return mockResponse({ status: 200, body: algoliaBody });
      return mockResponse({ status: 200, body: untappdBeerHtml });
    },
    async () => {
      const result = await lookupSku({ sku: '09144', category: 'beer' });
      assert.equal(result.title, 'Michelob ULTRA');
      assert.equal(result.price, '8.99');
      assert.equal(result.size, '12pk-12oz Cans');
      assert.equal(result.brewery, 'Anheuser-Busch');
      assert.equal(result.style, 'Light Lager');
      assert.equal(result.abv, '4.2%');
      // Untappd's own page is preferred over the store's generic blurb once a match is found.
      assert.equal(result.description, 'Fallback SEO description.');
    }
  );
});

test('lookupSku combines a beer\'s separate Size and Pack Size rows into one Size/Unit value', async () => {
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="12345" />
        <a class="product-link" href="/New-Anthem-Hazy-IPA-12345-1012345/">
          <span class="productnameTitle">Hazy IPA</span>
        </a>
      </div>
    `,
  });
  const storeProductHtml = page({
    body: `
      <h1 itemprop="name">Hazy IPA</h1>
      <h6><a href="/brand/new-anthem">New Anthem Beer Project</a></h6>
      <div class="pricingDetails"><span class="priceFull">$13.99</span></div>
      <table>
        <tr><th>Size</th><td>16oz</td></tr>
        <tr><th>Pack Size</th><td>4-Pack</td></tr>
      </table>
    `,
  });
  const algoliaBody = algoliaHitsResponse([]);
  await withMockFetch(
    async (url) => {
      if (url.includes('/store/search.asp')) return mockResponse({ status: 200, body: storeSearchHtml });
      if (url.includes('liquoroutletwinecellars.com/New-Anthem')) return mockResponse({ status: 200, body: storeProductHtml });
      // Untappd search comes back empty here - irrelevant to this test, which
      // only cares about the store-sourced Size/Pack Size combination, not
      // the Untappd enrichment step.
      return mockResponse({ status: 200, body: algoliaBody });
    },
    async () => {
      const result = await lookupSku({ sku: '12345', category: 'beer' });
      assert.equal(result.size, '16oz 4-Pack');
    }
  );
});

test('lookupSku leaves the description blank when Untappd matches the beer but its page has no description at all', async () => {
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="09144" />
        <a class="product-link" href="/Michelob-ULTRA-09144-1009144/">
          <span class="productnameTitle">Michelob ULTRA</span>
        </a>
      </div>
    `,
  });
  const storeProductHtml = page({
    body: `
      <h1 itemprop="name">Michelob ULTRA</h1>
      <div class="pricingDetails"><span class="priceFull">$8.99</span></div>
      <div id="description"><div class="text-product-desc">Store's own generic description.</div></div>
    `,
  });
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'anheuser-busch-michelob-ultra', bid: 1234, beer_name: 'Michelob ULTRA', brewery_name: 'Anheuser-Busch' },
  ]);
  // No og:description meta and no .beer-descrption-read-less/-more div - a
  // real beer page with nothing for parseBeerHtml's description to find.
  const untappdBeerHtml = page({
    head: '<meta property="og:title" content="Michelob ULTRA by Anheuser-Busch | Untappd" />',
    body: '<p class="brewery"><a href="#">Anheuser-Busch</a></p><p class="style">Light Lager</p>',
  });
  await withMockFetch(
    async (url) => {
      if (url.includes('/store/search.asp')) return mockResponse({ status: 200, body: storeSearchHtml });
      if (url.includes('liquoroutletwinecellars.com/Michelob')) return mockResponse({ status: 200, body: storeProductHtml });
      if (url.includes('algolia.net')) return mockResponse({ status: 200, body: algoliaBody });
      return mockResponse({ status: 200, body: untappdBeerHtml });
    },
    async () => {
      const result = await lookupSku({ sku: '09144', category: 'beer' });
      assert.equal(result.brewery, 'Anheuser-Busch');
      assert.equal(result.style, 'Light Lager');
      // Untappd was found, but has no description of its own - the store's
      // generic blurb must not silently take its place.
      assert.equal(result.description, '');
      assert.equal(result.untappdError, undefined);
    }
  );
});

test('lookupSku falls back to the store\'s own description when Untappd has nothing for that title', async () => {
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="09144" />
        <a class="product-link" href="/Michelob-ULTRA-09144-1009144/">
          <span class="productnameTitle">Michelob ULTRA</span>
        </a>
      </div>
    `,
  });
  const storeProductHtml = page({
    body: `
      <h1 itemprop="name">Michelob ULTRA</h1>
      <div class="pricingDetails"><span class="priceFull">$8.99</span></div>
      <div id="description"><div class="text-product-desc">Store's own generic description.</div></div>
    `,
  });
  await withMockFetch(
    async (url) => {
      if (url.includes('/store/search.asp')) return mockResponse({ status: 200, body: storeSearchHtml });
      if (url.includes('liquoroutletwinecellars.com/Michelob')) return mockResponse({ status: 200, body: storeProductHtml });
      return mockResponse({ status: 200, body: algoliaHitsResponse([]) });
    },
    async () => {
      const result = await lookupSku({ sku: '09144', category: 'beer' });
      assert.equal(result.description, "Store's own generic description.");
      assert.equal(result.brewery, '');
      assert.match(result.untappdError, /Could not find "Michelob ULTRA" on Untappd\./);
    }
  );
});

test('lookupSku prepends the producer to a beer title, strips the size, and searches Untappd with the same producer title', async () => {
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="35849" />
        <a class="product-link" href="/Daylily-35849-1035849/">
          <span class="productnameTitle">Daylily 16OZ</span>
        </a>
      </div>
    `,
  });
  const storeProductHtml = page({
    body: `
      <h1 itemprop="name">Daylily 16OZ</h1>
      <h6><a href="/brand/autodidact">Autodidact</a></h6>
      <div class="pricingDetails"><span class="priceFull">$15.99</span></div>
    `,
  });
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'autodidact-daylily', bid: 9999, beer_name: 'Daylily', brewery_name: 'Autodidact Beer' },
  ]);
  const untappdBeerHtml = page({
    head: '<meta property="og:title" content="Daylily by Autodidact Beer | Untappd" />'
      + '<meta property="og:description" content="A hazy pale ale." />',
    body: '<p class="brewery"><a href="#">Autodidact Beer</a></p><p class="style">Pale Ale - Hazy / Juicy</p>'
      + '<div class="details"><p class="abv">6.00% ABV</p></div>',
  });
  const requestedUrls = [];
  let algoliaRequestBody;
  await withMockFetch(
    async (url, opts) => {
      requestedUrls.push(url);
      if (url.includes('/store/search.asp')) return mockResponse({ status: 200, body: storeSearchHtml });
      if (url.includes('liquoroutletwinecellars.com/Daylily')) return mockResponse({ status: 200, body: storeProductHtml });
      if (url.includes('algolia.net')) {
        algoliaRequestBody = JSON.parse(opts.body);
        return mockResponse({ status: 200, body: algoliaBody });
      }
      return mockResponse({ status: 200, body: untappdBeerHtml });
    },
    async () => {
      const result = await lookupSku({ sku: '35849', category: 'beer' });
      assert.equal(result.title, 'Autodidact Daylily');
      assert.equal(result.style, 'Pale Ale - Hazy / Juicy');
      assert.equal(result.abv, '6%');
      assert.equal(result.untappdError, undefined);
    }
  );
  assert.ok(requestedUrls.some((u) => u.includes('algolia.net')), 'expected an Algolia search request');
  const query = algoliaRequestBody.requests[0].params;
  assert.ok(!query.includes('16OZ') && !query.includes('16oz'), `Untappd search query should not include the size, got: ${query}`);
  assert.match(query, /query=Autodidact%20Daylily/);
});

// The real miss that motivated dropVendorCode (SKU 36211): the store's
// Brand link reads "AB" - a short vendor code, not the actual producer
// ("Autodidact") - and the store's own title already includes the real
// producer name. Confirms the vendor code is never folded into the title or
// the Untappd search query, so the search still succeeds instead of
// searching for "AB Autodidact Abaddon" (which Untappd can't find).
test('lookupSku does not prepend a vendor code onto a beer title or Untappd search query', async () => {
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="36211" />
        <a class="product-link" href="/Autodidact-Abaddon-36211-1036211/">
          <span class="productnameTitle">Autodidact Abaddon 16OZ</span>
        </a>
      </div>
    `,
  });
  const storeProductHtml = page({
    body: `
      <h1 itemprop="name">Autodidact Abaddon 16OZ</h1>
      <h6><a href="/brand/ab">AB</a></h6>
      <div class="pricingDetails"><span class="priceFull">$4.99</span></div>
    `,
  });
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'autodidact-abaddon', bid: 8888, beer_name: 'Abaddon', brewery_name: 'Autodidact' },
  ]);
  const untappdBeerHtml = page({
    head: '<meta property="og:title" content="Abaddon by Autodidact | Untappd" />'
      + '<meta property="og:description" content="An imperial stout." />',
    body: '<p class="brewery"><a href="#">Autodidact</a></p><p class="style">Stout - Imperial / Double</p>'
      + '<div class="details"><p class="abv">10.00% ABV</p></div>',
  });
  let algoliaRequestBody;
  await withMockFetch(
    async (url, opts) => {
      if (url.includes('/store/search.asp')) return mockResponse({ status: 200, body: storeSearchHtml });
      if (url.includes('liquoroutletwinecellars.com/Autodidact')) return mockResponse({ status: 200, body: storeProductHtml });
      if (url.includes('algolia.net')) {
        algoliaRequestBody = JSON.parse(opts.body);
        return mockResponse({ status: 200, body: algoliaBody });
      }
      return mockResponse({ status: 200, body: untappdBeerHtml });
    },
    async () => {
      const result = await lookupSku({ sku: '36211', category: 'beer' });
      assert.equal(result.title, 'Autodidact Abaddon');
      assert.equal(result.brewery, 'Autodidact');
      assert.equal(result.untappdError, undefined);
    }
  );
  const query = algoliaRequestBody.requests[0].params;
  assert.ok(!query.includes('AB'), `Untappd search query should not include the vendor code, got: ${query}`);
});

test('lookupSku searches Untappd with a bare beer name when the store page has no brand to fold in', async () => {
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="09144" />
        <a class="product-link" href="/Michelob-ULTRA-09144-1009144/">
          <span class="productnameTitle">Michelob ULTRA</span>
        </a>
      </div>
    `,
  });
  const storeProductHtml = page({
    body: '<h1 itemprop="name">Michelob ULTRA</h1>'
      + '<div class="pricingDetails"><span class="priceFull">$8.99</span></div>',
  });
  let algoliaRequestBody;
  await withMockFetch(
    async (url, opts) => {
      if (url.includes('/store/search.asp')) return mockResponse({ status: 200, body: storeSearchHtml });
      if (url.includes('liquoroutletwinecellars.com/Michelob')) return mockResponse({ status: 200, body: storeProductHtml });
      algoliaRequestBody = JSON.parse(opts.body);
      return mockResponse({ status: 200, body: algoliaHitsResponse([]) });
    },
    async () => {
      await lookupSku({ sku: '09144', category: 'beer' });
    }
  );
  assert.match(algoliaRequestBody.requests[0].params, /query=Michelob%20ULTRA/);
});

test('lookupSku does not attempt an Untappd search for wine/spirits', async () => {
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="55555" />
        <a class="product-link" href="/Josh-Cellars-Cabernet-55555-1055555/">
          <span class="productnameTitle">Josh Cellars Cabernet Sauvignon</span>
        </a>
      </div>
    `,
  });
  const storeProductHtml = page({
    body: '<h1 itemprop="name">Josh Cellars Cabernet Sauvignon</h1>'
      + '<div class="pricingDetails"><span class="priceFull">$13.99</span></div>',
  });
  const requestedUrls = [];
  await withMockFetch(
    async (url) => {
      requestedUrls.push(url);
      return mockResponse({ status: 200, body: url.includes('/store/search.asp') ? storeSearchHtml : storeProductHtml });
    },
    async () => {
      const result = await lookupSku({ sku: '55555', category: 'wine' });
      assert.equal(result.title, 'Josh Cellars Cabernet Sauvignon');
    }
  );
  assert.ok(
    requestedUrls.every((u) => !u.includes('untappd.com') && !u.includes('algolia.net')),
    'wine/spirits lookups must never call Untappd'
  );
});

test('lookupSku prepends the producer to the title and drops the size for wine/spirits', async () => {
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="55555" />
        <a class="product-link" href="/Josh-Cellars-Cabernet-55555-1055555/">
          <span class="productnameTitle">Cabernet Sauvignon 750mL</span>
        </a>
      </div>
    `,
  });
  const storeProductHtml = page({
    body: `
      <h1 itemprop="name">Cabernet Sauvignon 750mL</h1>
      <h6><a href="/brand/josh-cellars">Josh Cellars</a></h6>
      <div class="pricingDetails"><span class="priceFull">$13.99</span></div>
      <table>
        <tr><th>Year</th><td>2022</td></tr>
        <tr><th>Size</th><td>750mL</td></tr>
      </table>
    `,
  });
  await withMockFetch(
    async (url) => mockResponse({ status: 200, body: url.includes('/store/search.asp') ? storeSearchHtml : storeProductHtml }),
    async () => {
      const result = await lookupSku({ sku: '55555', category: 'wine' });
      assert.equal(result.title, 'Josh Cellars Cabernet Sauvignon');
      assert.equal(result.size, '750mL');
      assert.equal(result.vintage, '2022');
    }
  );
});

test('lookupSku does not duplicate the producer name when the store title already starts with it', async () => {
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="55555" />
        <a class="product-link" href="/Josh-Cellars-Cabernet-55555-1055555/">
          <span class="productnameTitle">Josh Cellars Cabernet Sauvignon</span>
        </a>
      </div>
    `,
  });
  const storeProductHtml = page({
    body: `
      <h1 itemprop="name">Josh Cellars Cabernet Sauvignon</h1>
      <h6><a href="/brand/josh-cellars">Josh Cellars</a></h6>
      <div class="pricingDetails"><span class="priceFull">$13.99</span></div>
    `,
  });
  await withMockFetch(
    async (url) => mockResponse({ status: 200, body: url.includes('/store/search.asp') ? storeSearchHtml : storeProductHtml }),
    async () => {
      const result = await lookupSku({ sku: '55555', category: 'wine' });
      assert.equal(result.title, 'Josh Cellars Cabernet Sauvignon');
    }
  );
});

// ================================================================
// enrichWineDescriptionFromStore - the Scan UPC tab's Wine/Spirits
// description enrichment (see the module comment above it). Unlike
// lookupSku's Untappd enrichment, this is matched by store SKU rather than
// a title search, so a single store-search + product-page fetch pair is
// all it ever needs.
// ================================================================

test('enrichWineDescriptionFromStore replaces a local export description with the store page\'s own description', async () => {
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="55555" />
        <a class="product-link" href="/Josh-Cellars-Cabernet-55555-1055555/">
          <span class="productnameTitle">Josh Cellars Cabernet Sauvignon</span>
        </a>
      </div>
    `,
  });
  const storeProductHtml = page({
    body: `
      <h1 itemprop="name">Josh Cellars Cabernet Sauvignon</h1>
      <div id="description"><div class="text-product-desc">Rich, full-bodied with notes of dark fruit and oak.</div></div>
    `,
  });
  await withMockFetch(
    async (url) => mockResponse({ status: 200, body: url.includes('/store/search.asp') ? storeSearchHtml : storeProductHtml }),
    async () => {
      const result = await enrichWineDescriptionFromStore({
        title: 'Josh Cellars Cabernet Sauvignon', sku: '55555', description: 'internal note: reorder soon',
      });
      assert.equal(result.description, 'Rich, full-bodied with notes of dark fruit and oak.');
      assert.equal(result.descriptionSourceError, undefined);
    }
  );
});

test('enrichWineDescriptionFromStore is a no-op when the product has no store SKU to look up', async () => {
  let called = false;
  await withMockFetch(
    async () => { called = true; return mockResponse({ status: 200 }); },
    async () => {
      const result = await enrichWineDescriptionFromStore({ title: 'Some Wine', sku: '', description: 'kept as-is' });
      assert.equal(result.description, 'kept as-is');
      assert.equal(result.descriptionSourceError, undefined);
    }
  );
  assert.equal(called, false, 'no SKU means no request should be made at all');
});

test('enrichWineDescriptionFromStore keeps the local description and reports why when the store has no match for that SKU', async () => {
  const storeSearchHtml = page({ body: '' }); // No matching .product-list-item card.
  await withMockFetch(
    async () => mockResponse({ status: 200, body: storeSearchHtml }),
    async () => {
      const result = await enrichWineDescriptionFromStore({ title: 'Some Wine', sku: '99999', description: 'kept as-is' });
      assert.equal(result.description, 'kept as-is');
      assert.match(result.descriptionSourceError, /No product found for SKU "99999"/);
    }
  );
});

test('enrichWineDescriptionFromStore keeps the local description when the store site blocks the request', async () => {
  await withMockFetch(
    async () => mockResponse({ status: 403 }),
    async () => {
      const result = await enrichWineDescriptionFromStore({ title: 'Some Wine', sku: '55555', description: 'kept as-is' });
      assert.equal(result.description, 'kept as-is');
      assert.match(result.descriptionSourceError, /blocked this automated request/);
    }
  );
});

test('enrichWineDescriptionFromStore falls back to the local description when the store page has none of its own', async () => {
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="55555" />
        <a class="product-link" href="/Josh-Cellars-Cabernet-55555-1055555/">
          <span class="productnameTitle">Josh Cellars Cabernet Sauvignon</span>
        </a>
      </div>
    `,
  });
  const storeProductHtml = page({ body: '<h1 itemprop="name">Josh Cellars Cabernet Sauvignon</h1>' });
  await withMockFetch(
    async (url) => mockResponse({ status: 200, body: url.includes('/store/search.asp') ? storeSearchHtml : storeProductHtml }),
    async () => {
      const result = await enrichWineDescriptionFromStore({
        title: 'Josh Cellars Cabernet Sauvignon', sku: '55555', description: 'from the export file',
      });
      assert.equal(result.description, 'from the export file');
      assert.equal(result.descriptionSourceError, undefined);
    }
  );
});

// ================================================================
// enrichBeerScanFromStore - the Scan UPC tab's beer counterpart to
// enrichWineDescriptionFromStore above. Same matched-by-store-SKU shape,
// but pulls the whole store product (title/brand/size/price/description),
// not just price - then runs the exact same Untappd step lookupSku's beer
// path does, off of that store-sourced product rather than the raw local
// export. That's the whole point: a WinePOS export's Title/Brand columns
// are often too abbreviated for Untappd's own search to match, where the
// store's page usually isn't (see the first test below, which reproduces a
// real reported miss).
// ================================================================

test('enrichBeerScanFromStore searches Untappd with the store\'s title, not the export\'s abbreviated one - fixes a real miss', async () => {
  // A real WinePOS export's title/brand for this item, abbreviated store
  // shorthand that Untappd's own search can't match at all.
  const rawExportProduct = {
    title: 'MSB MANSKIRT THE GREAT PORTER CAN', brand: 'MSB', sku: '77777', size: '16OZ', price: '11.99', salePrice: '', description: 'reorder',
  };
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="77777" />
        <a class="product-link" href="/Manskirt-77777-1077777/">
          <span class="productnameTitle">The Great Porter</span>
        </a>
      </div>
    `,
  });
  const storeProductHtml = page({
    body: '<h1 itemprop="name">The Great Porter</h1>'
      + '<h6><a href="/brand/manskirt">Manskirt Brewing</a></h6>'
      + '<div class="pricingDetails"><span class="priceFull">$12.99</span></div>',
  });
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'manskirt-the-great-porter', bid: 555, beer_name: 'The Great Porter', brewery_name: 'Manskirt Brewing' },
  ]);
  const untappdBeerHtml = page({
    head: '<meta property="og:title" content="The Great Porter by Manskirt Brewing | Untappd" />',
    body: '<p class="brewery"><a href="#">Manskirt Brewing</a></p><p class="style">Porter</p>',
  });
  let algoliaRequestBody;
  await withMockFetch(
    async (url, opts) => {
      if (url.includes('/store/search.asp')) return mockResponse({ status: 200, body: storeSearchHtml });
      if (url.includes('liquoroutletwinecellars.com/Manskirt')) return mockResponse({ status: 200, body: storeProductHtml });
      if (url.includes('algolia.net')) {
        algoliaRequestBody = JSON.parse(opts.body);
        return mockResponse({ status: 200, body: algoliaBody });
      }
      return mockResponse({ status: 200, body: untappdBeerHtml });
    },
    async () => {
      const result = await enrichBeerScanFromStore(rawExportProduct);
      // The displayed title keeps "Porter" - only the query sent to
      // Untappd (below) has it stripped (see buildUntappdSearchQuery).
      assert.equal(result.title, 'Manskirt Brewing The Great Porter');
      assert.equal(result.brewery, 'Manskirt Brewing');
      assert.equal(result.style, 'Porter');
      assert.equal(result.untappdError, undefined);
    }
  );
  // The query actually sent to Untappd came from the store's title/brand,
  // not the export's "MSB MANSKIRT..." text - and, per
  // buildUntappdSearchQuery, has "Porter" itself stripped out too, even
  // though it happens to be part of this beer's own real Untappd name (see
  // that function's own comment for why that's still safe: "Manskirt
  // Brewing The Great" alone is plenty distinctive, so nothing here was
  // ever at risk of *not* finding the right beer for lack of that word).
  assert.match(algoliaRequestBody.requests[0].params, /query=Manskirt%20Brewing%20The%20Great(&|$)/);
});

test('enrichBeerScanFromStore pulls title/size/price/description from the store when the SKU matches', async () => {
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="09144" />
        <a class="product-link" href="/Michelob-ULTRA-09144-1009144/">
          <span class="productnameTitle">Michelob ULTRA</span>
        </a>
      </div>
    `,
  });
  const storeProductHtml = page({
    body: '<h1 itemprop="name">Michelob ULTRA</h1>'
      + '<div class="pricingDetails"><span class="priceFull">$9.99</span></div>'
      + '<table><tr><th>Size</th><td>12pk-12oz Cans</td></tr></table>'
      + '<div id="description"><div class="text-product-desc">Store\'s own generic description.</div></div>',
  });
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'anheuser-busch-michelob-ultra', bid: 1234, beer_name: 'Michelob ULTRA', brewery_name: 'Anheuser-Busch' },
  ]);
  const untappdBeerHtml = page({
    head: '<meta property="og:title" content="Michelob ULTRA by Anheuser-Busch | Untappd" />',
    body: '<p class="brewery"><a href="#">Anheuser-Busch</a></p><p class="style">Light Lager</p>'
      + '<div class="details"><p class="abv">4.20% ABV</p></div>',
  });
  await withMockFetch(
    async (url) => {
      if (url.includes('/store/search.asp')) return mockResponse({ status: 200, body: storeSearchHtml });
      if (url.includes('liquoroutletwinecellars.com/Michelob')) return mockResponse({ status: 200, body: storeProductHtml });
      if (url.includes('algolia.net')) return mockResponse({ status: 200, body: algoliaBody });
      return mockResponse({ status: 200, body: untappdBeerHtml });
    },
    async () => {
      // As read straight from a local WinePOS export - stale price/size, a
      // short internal note for a description.
      const result = await enrichBeerScanFromStore({
        title: 'MICHELOB ULTRA CAN', brand: 'AB', sku: '09144', size: '12PK',
        price: '7.49', salePrice: '', description: 'internal note: reorder soon',
      });
      assert.equal(result.price, '9.99', 'price should come from the store site');
      assert.equal(result.size, '12pk-12oz Cans', 'size should come from the store site, not the export');
      assert.equal(result.brewery, 'Anheuser-Busch', 'brewery should come from Untappd');
      assert.equal(result.style, 'Light Lager');
      assert.equal(result.abv, '4.2%');
      // Untappd was found, so its own (blank) description replaces the
      // export's internal note - same behavior enrichBeerFromUntappd already
      // has for a SKU lookup, see the "leaves the description blank" test
      // above.
      assert.equal(result.description, '');
      assert.equal(result.untappdError, undefined);
      assert.equal(result.storeSourceError, undefined);
    }
  );
});

test('enrichBeerScanFromStore still tries Untappd with the local title when there is no store SKU to look up', async () => {
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'anheuser-busch-michelob-ultra', bid: 1234, beer_name: 'Michelob ULTRA', brewery_name: 'Anheuser-Busch' },
  ]);
  const untappdBeerHtml = page({
    head: '<meta property="og:title" content="Michelob ULTRA by Anheuser-Busch | Untappd" />',
    body: '<p class="brewery"><a href="#">Anheuser-Busch</a></p><p class="style">Light Lager</p>',
  });
  const requestedUrls = [];
  await withMockFetch(
    async (url) => {
      requestedUrls.push(url);
      if (url.includes('algolia.net')) return mockResponse({ status: 200, body: algoliaBody });
      return mockResponse({ status: 200, body: untappdBeerHtml });
    },
    async () => {
      const result = await enrichBeerScanFromStore({ title: 'Michelob ULTRA', sku: '', price: '8.49', salePrice: '' });
      assert.equal(result.price, '8.49', 'price should stay whatever the export had - no SKU means no store lookup at all');
      assert.equal(result.brewery, 'Anheuser-Busch');
      assert.equal(result.storeSourceError, undefined);
    }
  );
  assert.ok(requestedUrls.every((u) => !u.includes('/store/search.asp')), 'no SKU means no store request should be made at all');
});

test('enrichBeerScanFromStore keeps the export\'s own description when the store page and Untappd both have none of their own', async () => {
  const storeSearchHtml = page({
    body: `
      <div class="product-list-item">
        <input class="product-code" type="hidden" value="09144" />
        <a class="product-link" href="/Michelob-ULTRA-09144-1009144/">
          <span class="productnameTitle">Michelob ULTRA</span>
        </a>
      </div>
    `,
  });
  // No #description div at all on this store page - a real, common case
  // (not every product page has one), distinct from a SKU the store
  // doesn't recognize at all (see the "no match" test below).
  const storeProductHtml = page({
    body: '<h1 itemprop="name">Michelob ULTRA</h1><div class="pricingDetails"><span class="priceFull">$9.99</span></div>',
  });
  await withMockFetch(
    async (url) => {
      if (url.includes('/store/search.asp')) return mockResponse({ status: 200, body: storeSearchHtml });
      if (url.includes('algolia.net')) return mockResponse({ status: 200, body: algoliaHitsResponse([]) }); // Untappd: no match either
      return mockResponse({ status: 200, body: storeProductHtml });
    },
    async () => {
      const result = await enrichBeerScanFromStore({
        title: 'Michelob ULTRA', sku: '09144', price: '7.49', salePrice: '', description: 'internal note: reorder soon',
      });
      assert.equal(result.price, '9.99', 'price should still come from the store');
      // Neither the store page nor Untappd had a description of their own -
      // the export's internal note survives instead of being blanked out by
      // the store's empty one.
      assert.equal(result.description, 'internal note: reorder soon');
      assert.equal(result.storeSourceError, undefined);
      assert.match(result.untappdError, /Could not find/);
    }
  );
});

test('enrichBeerScanFromStore falls back to the local product and still tries Untappd when the store has no match for that SKU', async () => {
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'anheuser-busch-michelob-ultra', bid: 1234, beer_name: 'Michelob ULTRA', brewery_name: 'Anheuser-Busch' },
  ]);
  const untappdBeerHtml = page({
    head: '<meta property="og:title" content="Michelob ULTRA by Anheuser-Busch | Untappd" />',
    body: '<p class="brewery"><a href="#">Anheuser-Busch</a></p><p class="style">Light Lager</p>',
  });
  await withMockFetch(
    async (url) => {
      if (url.includes('/store/search.asp')) return mockResponse({ status: 200, body: page({ body: '' }) }); // no match
      if (url.includes('algolia.net')) return mockResponse({ status: 200, body: algoliaBody });
      return mockResponse({ status: 200, body: untappdBeerHtml });
    },
    async () => {
      const result = await enrichBeerScanFromStore({
        title: 'Michelob ULTRA', sku: '99999', price: '7.49', salePrice: '', description: '',
      });
      assert.equal(result.price, '7.49', 'a failed store lookup should keep the local export\'s own price');
      assert.match(result.storeSourceError, /No product found for SKU "99999"/);
      // Untappd still ran, off the local export's own title (the only one
      // available once the store lookup failed) - a store-lookup failure
      // doesn't also skip the Untappd step.
      assert.equal(result.brewery, 'Anheuser-Busch');
      assert.equal(result.untappdError, undefined);
    }
  );
});

test('enrichBeerScanFromStore keeps the local product when the store site blocks the request, and still tries Untappd', async () => {
  await withMockFetch(
    async (url) => {
      if (url.includes('/store/search.asp')) return mockResponse({ status: 403 });
      return mockResponse({ status: 200, body: algoliaHitsResponse([]) }); // Untappd: no match either, best-effort
    },
    async () => {
      const result = await enrichBeerScanFromStore({ title: 'Some Beer', sku: '09144', price: '8.49', salePrice: '' });
      assert.equal(result.price, '8.49');
      assert.match(result.storeSourceError, /blocked this automated request/);
      assert.match(result.untappdError, /Could not find/);
    }
  );
});

test('composeProducerTitle prepends the brand, strips the size, and leaves brand-less titles untouched', () => {
  assert.equal(
    composeProducerTitle({ title: 'Cabernet Sauvignon 750mL', brand: 'Josh Cellars', size: '750mL' }),
    'Josh Cellars Cabernet Sauvignon'
  );
  assert.equal(
    composeProducerTitle({ title: 'Josh Cellars Cabernet Sauvignon', brand: 'Josh Cellars', size: '' }),
    'Josh Cellars Cabernet Sauvignon'
  );
  assert.equal(
    composeProducerTitle({ title: 'Cabernet Sauvignon', brand: '', size: '' }),
    'Cabernet Sauvignon'
  );
  assert.equal(
    composeProducerTitle({ title: 'Grey Goose 1L', brand: 'Grey Goose', size: '1L' }),
    'Grey Goose'
  );
});

// A real beer's scraped title/h1 sometimes carries this junk verbatim,
// distinct from - and in addition to - the dedicated Size/Pack Size spec
// rows that already have their own fields: the store's "Not Specified"
// spec-table placeholder (see the Year/Pack Size handling in
// parseStoreProductHtml) and an abbreviated pack count ("4pk", not the
// "4-pack"/"4 pack" SIZE_PATTERN already caught). Neither belongs in the
// Beer Name/Product Title field a shopper would see.
test('composeProducerTitle strips a "Not Specified" placeholder and an abbreviated pack count out of the title', () => {
  assert.equal(
    composeProducerTitle({ title: 'Hazy IPA Not Specified', brand: 'New Anthem Beer Project', size: '' }),
    'New Anthem Beer Project Hazy IPA'
  );
  assert.equal(
    composeProducerTitle({ title: 'Hazy IPA 4pk', brand: 'New Anthem Beer Project', size: '' }),
    'New Anthem Beer Project Hazy IPA'
  );
  assert.equal(
    composeProducerTitle({ title: 'Hazy IPA 16oz 4-pk', brand: 'New Anthem Beer Project', size: '' }),
    'New Anthem Beer Project Hazy IPA'
  );
});

// buildUntappdSearchQuery - see its own comment in productImport.js for the
// full reasoning. Regression coverage for the real Oakflower Augury miss
// (style words diluting an otherwise-correct match), plus the deliberate
// choice not to touch macro-brand differentiators like "Light".
test('buildUntappdSearchQuery strips style category words and modifiers but leaves the rest of the title alone', () => {
  assert.equal(buildUntappdSearchQuery('Oakflower Augury Dry Irish Stout'), 'Oakflower Augury');
  assert.equal(
    buildUntappdSearchQuery('New Anthem Beer Project Trapped In A Sunbeam Hazy Double IPA'),
    'New Anthem Beer Project Trapped In A Sunbeam'
  );
  assert.equal(buildUntappdSearchQuery('Anheuser-Busch Michelob ULTRA'), 'Anheuser-Busch Michelob ULTRA');
});

// "Wit" (short for Witbier - a Belgian-style wheat beer) is a common enough
// standalone style suffix in its own right ("Allagash Wit", "Hoegaarden
// Wit") that having only the longer "witbier" form in the pattern missed
// it entirely.
test('buildUntappdSearchQuery strips a standalone "Wit" the same as "Witbier"', () => {
  assert.equal(buildUntappdSearchQuery('Allagash Wit'), 'Allagash');
  assert.equal(buildUntappdSearchQuery('Hoegaarden Belgian Wit'), 'Hoegaarden');
});

test('buildUntappdSearchQuery leaves ambiguous macro-brand words like "Light" alone', () => {
  // "Light" is often the only thing telling two real, separately-listed
  // Untappd beers from the same brewery apart (Coors Light vs. Coors
  // Banquet) - stripping it would risk a confident wrong match, not just a
  // missed one, so it's deliberately not in BEER_STYLE_WORD_PATTERN.
  assert.equal(buildUntappdSearchQuery('Coors Light'), 'Coors Light');
  assert.equal(buildUntappdSearchQuery('Michelob Golden Draft'), 'Michelob Golden Draft');
});

test('buildUntappdSearchQuery falls back to the original title rather than searching an empty string', () => {
  assert.equal(buildUntappdSearchQuery('IPA'), 'IPA');
  assert.equal(buildUntappdSearchQuery(''), '');
});

// Container/packaging codes (see CONTAINER_WORD_PATTERN's own comment in
// productImport.js) - none of these carry any Untappd search signal, so
// they're stripped the same way style words are, but left in the displayed
// Product Title (composeProducerTitle never touches them).
test('buildUntappdSearchQuery strips container/packaging codes (NR, Can/CN, KEG, 1/6, 1/4)', () => {
  assert.equal(buildUntappdSearchQuery('Downtown Brown NR'), 'Downtown Brown');
  assert.equal(buildUntappdSearchQuery('Downtown Brown 12pk CN'), 'Downtown Brown 12pk');
  assert.equal(buildUntappdSearchQuery('Oakflower Augury Cans'), 'Oakflower Augury');
  assert.equal(buildUntappdSearchQuery('Fest Beer KEG 1/6'), 'Fest Beer');
  assert.equal(buildUntappdSearchQuery('Fest Beer KEG 1/4'), 'Fest Beer');
});

test('lookupSkuFromHtml parses pasted store HTML and still runs Untappd enrichment for beer', async () => {
  const storeProductHtml = page({
    body: '<h1 itemprop="name">Michelob ULTRA</h1><div class="pricingDetails"><span class="priceFull">$8.99</span></div>',
  });
  const algoliaBody = algoliaHitsResponse([
    { beer_slug: 'anheuser-busch-michelob-ultra', bid: 1234, beer_name: 'Michelob ULTRA', brewery_name: 'Anheuser-Busch' },
  ]);
  const untappdBeerHtml = page({
    head: '<meta property="og:title" content="Michelob ULTRA by Anheuser-Busch | Untappd" />',
    body: '<p class="brewery"><a href="#">Anheuser-Busch</a></p>',
  });
  await withMockFetch(
    async (url) => mockResponse({ status: 200, body: url.includes('algolia.net') ? algoliaBody : untappdBeerHtml }),
    async () => {
      const result = await lookupSkuFromHtml({
        html: storeProductHtml,
        url: 'https://www.liquoroutletwinecellars.com/Michelob-ULTRA-09144-1009144/',
        category: 'beer',
      });
      assert.equal(result.title, 'Michelob ULTRA');
      assert.equal(result.brewery, 'Anheuser-Busch');
    }
  );
});

test('lookupSkuFromHtml rejects an empty paste without attempting any request', async () => {
  let calls = 0;
  await withMockFetch(
    async () => { calls += 1; return mockResponse({ status: 200 }); },
    async () => {
      await assert.rejects(() => lookupSkuFromHtml({ html: '  ', category: 'wine' }), /Paste the page's HTML first\./);
    }
  );
  assert.equal(calls, 0);
});

// ================================================================
// untappdBeerFromUrl / untappdBeerFromHtml - the manual fallback for when
// enrichBeerFromUntappd's own search comes back empty (confirmed via a real
// beer, see composeProducerTitle's comment above, to be because Untappd's
// search-results page renders client-side). Staff search Untappd
// themselves and hand this the beer's own page instead.
// ================================================================

test('untappdBeerFromUrl fetches a beer page directly and merges its fields onto the current ones', async () => {
  const untappdBeerHtml = page({
    head: '<meta property="og:title" content="Daylily by Autodidact Beer | Untappd" />'
      + '<meta property="og:description" content="A hazy pale ale." />',
    body: '<p class="brewery"><a href="#">Autodidact Beer</a></p><p class="style">Pale Ale - New England / Hazy</p>'
      + '<div class="details"><p class="abv">5.80% ABV</p></div>',
  });
  await withMockFetch(
    async () => mockResponse({ status: 200, body: untappdBeerHtml }),
    async () => {
      const current = { description: 'Store description.', brewery: 'Autodidact', style: '', abv: '', ibu: '', untappdRating: '', untappdRatingCount: '', location: '' };
      const fields = await untappdBeerFromUrl(current, 'https://untappd.com/b/autodidact-beer-daylily/9999');
      assert.equal(fields.description, 'A hazy pale ale.');
      assert.equal(fields.brewery, 'Autodidact Beer');
      assert.equal(fields.style, 'Pale Ale - New England / Hazy');
      assert.equal(fields.abv, '5.8%');
    }
  );
});

test('untappdBeerFromUrl keeps the current field wherever the Untappd page has nothing for it', async () => {
  const untappdBeerHtml = page({ body: '<div class="name"><h1>Daylily</h1></div>' });
  await withMockFetch(
    async () => mockResponse({ status: 200, body: untappdBeerHtml }),
    async () => {
      const current = {
        description: 'Store description.', brewery: 'Autodidact', style: 'Pale Ale',
        abv: '5%', ibu: '20', untappdRating: '4.2', untappdRatingCount: '100', location: 'Wilmington, NC',
      };
      const fields = await untappdBeerFromUrl(current, 'https://untappd.com/b/autodidact-beer-daylily/9999');
      assert.equal(fields.brewery, 'Autodidact');
      assert.equal(fields.style, 'Pale Ale');
      assert.equal(fields.abv, '5%');
      assert.equal(fields.location, 'Wilmington, NC');
    }
  );
});

test('untappdBeerFromUrl rejects a blank URL without attempting any request', async () => {
  let calls = 0;
  await withMockFetch(
    async () => { calls += 1; return mockResponse({ status: 200 }); },
    async () => {
      await assert.rejects(() => untappdBeerFromUrl({}, '   '), /Enter the beer's Untappd URL first\./);
    }
  );
  assert.equal(calls, 0);
});

// Regression test for a real user report: the manual URL fallback filled
// in brewery/style/ABV/rating correctly but left location blank even
// though the pasted beer had one on Untappd. Root cause was that
// untappdBeerFromUrl called bare parseBeerHtml, which - as
// fillBeerLocation's own comment above explains - never has location on
// the beer's own page; only extractBeer was following the brewery link for
// it. Same gap existed in searchUntappd below, covered separately there.
test('untappdBeerFromUrl follows the brewery link and fills in location, same as extractBeer does', async () => {
  const beerHtml = page({
    head: '<meta property="og:title" content="Daylily by Autodidact Beer | Untappd" />',
    body: '<p class="brewery"><a href="/w/autodidact-beer/432029">Autodidact Beer</a></p>',
  });
  const breweryHtml = page({
    body: '<div class="basic"><div class="name"><h1>Autodidact Beer</h1>'
      + '<p class="brewery">Wilmington, NC United States</p></div></div>',
  });
  await withMockFetch(
    async (url) => (url.includes('/w/autodidact-beer/432029')
      ? mockResponse({ status: 200, body: breweryHtml })
      : mockResponse({ status: 200, body: beerHtml })),
    async () => {
      const fields = await untappdBeerFromUrl({}, 'https://untappd.com/b/autodidact-beer-daylily/9999');
      assert.equal(fields.brewery, 'Autodidact Beer');
      assert.equal(fields.location, 'Wilmington, NC United States');
    }
  );
});

test('untappdBeerFromHtml parses pasted Untappd beer HTML without any network request when there is no brewery link to follow', async () => {
  const untappdBeerHtml = page({
    head: '<meta property="og:title" content="Daylily by Autodidact Beer | Untappd" />',
    body: '<p class="brewery-name">Autodidact Beer</p><p class="style">Pale Ale - New England / Hazy</p>',
  });
  let calls = 0;
  await withMockFetch(
    async () => { calls += 1; return mockResponse({ status: 200 }); },
    async () => {
      const fields = await untappdBeerFromHtml(
        { brewery: '', style: '' },
        { html: untappdBeerHtml, url: 'https://untappd.com/b/autodidact-beer-daylily/9999' }
      );
      assert.equal(fields.brewery, 'Autodidact Beer');
      assert.equal(fields.style, 'Pale Ale - New England / Hazy');
    }
  );
  assert.equal(calls, 0, 'no .brewery a link in the pasted HTML means nothing to follow - must not make any request');
});

test('untappdBeerFromHtml rejects an empty paste', async () => {
  await assert.rejects(() => untappdBeerFromHtml({}, { html: '   ' }), /Paste the beer's Untappd page HTML first\./);
});
