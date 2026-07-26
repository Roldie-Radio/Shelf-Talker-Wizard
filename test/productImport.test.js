// extractBeer's HTML parsing (Untappd-focused import) is split out as
// parseBeerHtml specifically so it can be tested here against fixture HTML.
// A real fetch to Untappd isn't something these tests can rely on - Untappd
// returned HTTP 403 to every attempt while this was being built (see the
// comment above parseBeerHtml in productImport.js), which is itself a sign
// the site actively blocks non-browser traffic. These fixtures encode the
// best-effort assumptions the parser makes about Untappd's markup, so a
// future change to those assumptions shows up here instead of silently
// changing what an import fills in.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBeerHtml } = require('../server/productImport');

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
