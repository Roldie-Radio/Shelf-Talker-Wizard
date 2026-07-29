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
  wineComSearchUrl, findTastingNotes, TASTING_NOTE_PROVIDER_NAMES,
} = require('../server/productImport');

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

test('TASTING_NOTE_PROVIDER_NAMES lists Wine.com - the Source dropdown in the Find Tasting Notes dialog reads straight from this', () => {
  assert.deepEqual(TASTING_NOTE_PROVIDER_NAMES, ['Wine.com']);
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
        () => findTastingNotes({ title: 'Josh Cellars Cabernet Sauvignon 2022', source: 'Vivino' }),
        /Unknown tasting notes source: "Vivino"/
      );
    }
  );
  assert.equal(calls, 0, 'an unrecognized source name should short-circuit before any fetch');
});
