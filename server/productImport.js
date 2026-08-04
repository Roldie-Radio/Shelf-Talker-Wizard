// cheerio's HTTP dependency (undici) references the global File class at
// module-load time (undici/lib/web/webidl/index.js), which Node only added
// to the global scope itself starting in the 20.x line - on Node 18 this
// throws "ReferenceError: File is not defined" the instant anything
// requires cheerio, before a single line of this file's own code runs.
// node:buffer has exported the same File class since well before that
// (confirmed present on 18.20.8), so re-exposing it as a global is a
// no-op on any Node that already has it and a real fix on any that don't -
// this has to run before the require('cheerio') below.
if (typeof globalThis.File === 'undefined') {
  globalThis.File = require('node:buffer').File;
}

const cheerio = require('cheerio');

const FETCH_TIMEOUT_MS = 10000;
const USER_AGENT = 'ShelfTalkerWizard/1.0 (+product data import)';
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Basic guard against pointing the importer at internal/private network addresses.
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i, // IPv6 unique-local (fc00::/7)
  /^\[?fe80:/i, // IPv6 link-local
  /\.local$/i,
];

function assertPublicUrl(url) {
  const { hostname } = new URL(url);
  if (BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(hostname))) {
    throw new Error('That address is not allowed.');
  }
}

async function fetchHtml(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Redirects are followed by hand (`redirect: 'manual'`) so that
    // assertPublicUrl runs on *every* hop. With redirect: 'follow' only the
    // URL typed into the form was ever checked, so a public-looking host
    // could 302 the fetch onto a private address (127.0.0.1, 10.x, ...) and
    // hand its contents back through the import fields - the guard cleared
    // the first URL and never saw the one actually read.
    let currentUrl = url;
    let resp;
    for (let hop = 0; ; hop++) {
      assertPublicUrl(currentUrl);
      resp = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          ...extraHeaders,
        },
      });
      if (!REDIRECT_STATUSES.has(resp.status)) break;

      const location = resp.headers.get('location');
      if (!location) {
        throw new Error(`The page responded with ${resp.status} but no redirect target.`);
      }
      if (hop >= MAX_REDIRECTS) {
        throw new Error('That page redirected too many times.');
      }
      currentUrl = new URL(location, currentUrl).toString();
      const { protocol } = new URL(currentUrl);
      if (protocol !== 'http:' && protocol !== 'https:') {
        throw new Error('That page redirected somewhere unsupported.');
      }
    }

    if (!resp.ok) {
      const err = new Error(`The page responded with ${resp.status} ${resp.statusText}.`);
      // Lets a caller distinguish "the site is actively blocking us" from
      // any other failure - extractBeer below uses this to decide whether
      // a second attempt with different headers is worth making.
      err.httpStatus = resp.status;
      throw err;
    }
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('html')) {
      throw new Error('That URL did not return an HTML page.');
    }
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

function money(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(num) ? num.toFixed(2) : undefined;
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return undefined;
}

// Pull every JSON-LD block, flattening @graph arrays, and return the first node
// whose @type is (or includes) "Product".
function findJsonLdProduct($) {
  const nodes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw || !raw.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && Array.isArray(item['@graph'])) {
          nodes.push(...item['@graph']);
        } else if (item) {
          nodes.push(item);
        }
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  });

  return nodes.find((node) => {
    const type = node && node['@type'];
    if (!type) return false;
    return Array.isArray(type) ? type.includes('Product') : type === 'Product';
  });
}

// Some retailers (e.g. wine.com) express list/sale pricing as a single
// offer's priceSpecification array (ListPrice/SalePrice) rather than as
// multiple offers - check that before falling back to the multi-offer logic.
function pricesFromPriceSpecification(offer) {
  const specs = offer && offer.priceSpecification;
  if (!Array.isArray(specs)) return {};
  const byType = (type) => specs.find((s) => s && typeof s.priceType === 'string' && s.priceType.endsWith(type));
  const listPrice = money(byType('ListPrice') && byType('ListPrice').price);
  const salePrice = money(byType('SalePrice') && byType('SalePrice').price);
  if (!listPrice || !salePrice || Number(salePrice) >= Number(listPrice)) return {};
  return { price: Number(listPrice).toFixed(2), salePrice: Number(salePrice).toFixed(2) };
}

function pricesFromOffers(offers) {
  if (!offers) return {};
  const list = Array.isArray(offers) ? offers : [offers];

  if (list.length === 1) {
    const fromSpec = pricesFromPriceSpecification(list[0]);
    if (fromSpec.price) return fromSpec;
  }

  const priceValues = list
    .map((o) => money(o && (o.price ?? o.lowPrice ?? o.highPrice)))
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);

  if (priceValues.length === 0) return {};
  if (priceValues.length === 1) return { price: priceValues[0].toFixed(2) };
  // Lowest = sale price, highest = regular/list price.
  return {
    salePrice: priceValues[0].toFixed(2),
    price: priceValues[priceValues.length - 1].toFixed(2),
  };
}

// Common markup patterns for a "was/now" price pair used by Shopify and
// WooCommerce themes, as a fallback when JSON-LD only has one price.
function pricesFromCommonSelectors($) {
  const saleSelectors = [
    '.price-item--sale',
    '.price__sale .price-item',
    'ins .amount',
    '.price ins',
  ];
  const regularSelectors = [
    '.price-item--regular',
    '.price__compare',
    '.compare-at-price',
    'del .amount',
    '.price del',
  ];

  const readFirst = (selectors) => {
    for (const sel of selectors) {
      const text = $(sel).first().text();
      const m = money(text);
      if (m) return m;
    }
    return undefined;
  };

  return { salePrice: readFirst(saleSelectors), price: readFirst(regularSelectors) };
}

// wine.com (and other schema.org-strict retailers) express size as a
// QuantitativeValue under hasMeasurement rather than a plain "size" string.
function sizeFromMeasurement(measurement) {
  if (!measurement || typeof measurement !== 'object') return undefined;
  const { value, unitText, unitCode } = measurement;
  const unit = unitText || unitCode;
  if (value == null || !unit) return undefined;
  return `${value}${unit}`;
}

// Best-effort guess at a size/unit descriptor (e.g. "750ml", "6-pack", "1L")
// by scanning the product name/description for a common pattern.
function guessSize(...texts) {
  const pattern = /\b(\d+(?:\.\d+)?\s?(?:ml|mL|l|L|oz|OZ)\b|\d+\s?-?\s?pack\b)/;
  for (const text of texts) {
    if (!text) continue;
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  return undefined;
}

// Best-effort guess at a 4-digit vintage year, the same fallback role
// guessSize plays for size when a page has no dedicated spec field for it.
function guessVintage(...texts) {
  const pattern = /\b(?:19|20)\d{2}\b/;
  for (const text of texts) {
    if (!text) continue;
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return undefined;
}

// Split out from extractProduct so the parsing half can also run against
// HTML the caller already has in hand - see parsePastedProduct below, the
// "paste page HTML" fallback for a site whose fetch keeps getting blocked
// (see the note above fetchProductHtml).
function parseProductHtml(html, url) {
  const $ = cheerio.load(html);

  const ld = findJsonLdProduct($) || {};
  const ldPrices = pricesFromOffers(ld.offers);
  const fallbackPrices = pricesFromCommonSelectors($);

  const title = firstNonEmpty(
    ld.name,
    $('meta[property="og:title"]').attr('content'),
    $('h1').first().text(),
    $('title').first().text()
  );

  const description = firstNonEmpty(
    ld.description,
    $('meta[property="og:description"]').attr('content'),
    $('meta[name="description"]').attr('content')
  );

  const price = firstNonEmpty(ldPrices.price, fallbackPrices.price);
  const salePrice = firstNonEmpty(ldPrices.salePrice, fallbackPrices.salePrice);

  const imageUrl = firstNonEmpty(
    ld.image && (Array.isArray(ld.image) ? ld.image[0] : ld.image && ld.image.url ? ld.image.url : ld.image),
    $('meta[property="og:image"]').attr('content')
  );

  const size = firstNonEmpty(
    ld.size,
    sizeFromMeasurement(ld.hasMeasurement),
    guessSize(title, description)
  );

  if (!title && !price) {
    throw new Error('Could not find product details on that page. Try a direct product page URL, or enter the details manually.');
  }

  return {
    title: title || '',
    description: description || '',
    price: price || '',
    salePrice: salePrice && salePrice !== price ? salePrice : '',
    size: size || '',
    imageUrl: imageUrl || '',
    sourceUrl: url,
  };
}

// Retail product pages (the "Import from website" tab's Wine/Spirits mode)
// get the same blocked-looking-response retry as the beer importer and the
// wine.com/Vivino tasting-notes lookups further down (see fetchHtmlResilient
// and BLOCKED_STATUSES below) - a plain fetch with no retry at all was the
// gap that let a wine.com product URL pasted here 403 immediately, even
// though the shared retry logic already existed and already worked for
// Untappd. Kept generic ("That site", not a named provider) since, unlike
// the catalog-search providers below, this path is meant to work against
// any retailer's product page, not one specific site.
async function fetchProductHtml(url) {
  try {
    return await fetchHtmlResilient(url);
  } catch (err) {
    if (BLOCKED_STATUSES.has(err.httpStatus)) {
      throw new Error(
        'That site blocked this automated request. This can happen from certain networks or '
        + 'hosting providers - try again in a bit, from a different network, paste the page\'s '
        + 'HTML instead, or enter the details manually.'
      );
    }
    throw err;
  }
}

async function extractProduct(url) {
  const html = await fetchProductHtml(url);
  return parseProductHtml(html, url);
}

// The "paste page HTML" fallback itself - for when even the retry above
// keeps getting blocked. There's no fetch here at all: the HTML is
// whatever the staff member copied out of their own browser (which already
// got past the block, being a real browser and not this app's fetch), so
// this just runs the same parsing extractProduct/extractBeer would have run
// against a successful response. `url` is optional and only used to label
// the result's sourceUrl - the page was never fetched by this app.
function parsePastedProduct({ html, url, category }) {
  if (!html || !html.trim()) {
    throw new Error("Paste the page's HTML first.");
  }
  const sourceUrl = typeof url === 'string' ? url.trim() : '';
  return category === 'beer' ? parseBeerHtml(html, sourceUrl) : parseProductHtml(html, sourceUrl);
}

// ================================================================
// Resilient fetch - retries a blocked-looking request once with a
// different, more browser-like header set. Originally built for the beer
// importer's Untappd requests below; wine.com and Vivino (see the tasting
// notes section further down) hit the same wall in real use, so this is
// shared infrastructure rather than something owned by any one provider.
// ================================================================

// Two header sets, tried in order (see fetchHtmlResilient below):
//
// 1. Plain: this app's own honest, self-identifying UA. This is what's
//    actually gotten data back from Untappd in real use.
// 2. Full-browser: a complete, internally-consistent set of headers a real
//    Chrome navigation sends together (UA + Accept-Language + the
//    sec-fetch-*/sec-ch-ua client hints). A bare User-Agent claiming to be
//    Chrome with none of the headers that normally travel with it is
//    itself a known bot signature - some WAFs treat that combination as
//    MORE suspicious than a plain script UA that isn't pretending to be
//    anything, which is the opposite of what an earlier version of this
//    file assumed. Kept as a second attempt rather than the default, since
//    it's an untested hypothesis, not confirmed against any of the three
//    live sites this now runs against.
const RESILIENT_HEADER_SETS = [
  {},
  {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  },
];

// Status codes worth spending a second round-trip on - a real block/rate
// limit, not a URL that's simply wrong or gone.
const BLOCKED_STATUSES = new Set([403, 429, 503]);

// Only moves on to the next header set when the previous attempt looks like
// a block, not for other failures (a bad URL, a timeout, a redirect loop) -
// those would fail identically on a second attempt and just cost the user
// extra time waiting for it.
async function fetchHtmlResilient(url, headerSets = RESILIENT_HEADER_SETS) {
  for (let i = 0; i < headerSets.length; i++) {
    try {
      return await fetchHtml(url, headerSets[i]);
    } catch (err) {
      const hasMoreAttempts = i < headerSets.length - 1;
      if (!hasMoreAttempts || !BLOCKED_STATUSES.has(err.httpStatus)) throw err;
    }
  }
  // Unreachable - the loop above always either returns or throws - but
  // keeps the function's control flow explicit rather than implying it
  // could fall off the end and return undefined.
  throw new Error('Could not fetch that page.');
}

// ================================================================
// Beer import - focused on Untappd beer pages (https://untappd.com/b/...),
// which is where staff are expected to paste links from for a Beer talker.
//
// This could not be verified against Untappd's live markup from the
// environment it was originally written in - every outbound request from
// there was blocked before it reached Untappd at all, regardless of
// headers, which is a property of that environment's network, not
// something this code can detect or reason about. The selectors here are
// best-effort, based on Untappd's long-documented classic page structure,
// but every one of them is optional and the parser leans harder on things
// far less likely to break if that markup has moved on: Open Graph tags
// (title/description are close to universal across site redesigns) and
// plain-text regex scans for the numeric facts (ABV/IBU/rating), rather
// than brittle class names. A field the parser can't find just comes back
// blank, same as the product importer above - staff review and fill in the
// rest either way.
// ================================================================

// Kept as its own name (rather than switching every beer call site to
// fetchHtmlResilient) since it's what the beer import's own tests and
// error handling below already refer to by name.
const fetchBeerHtml = fetchHtmlResilient;

// "8.00" -> "8", "5.50" -> "5.5" - matches the plain "8%" style already used
// by the manual entry form's own placeholder, instead of a raw regex capture
// like "8.00%".
function trimNumber(str) {
  const num = Number(str);
  return Number.isFinite(num) ? String(num) : str;
}

// Untappd's <title>/og:title has historically read "<Beer> by <Brewery>",
// sometimes with a " | Untappd" site-name suffix. Splitting on "by" lets one
// tag opportunistically supply both the beer name and, as a fallback if
// nothing more specific is found in the page body, the brewery name too.
function splitBeerTitle(ogTitle) {
  if (!ogTitle) return {};
  const cleaned = ogTitle.replace(/\s*[|–—-]\s*Untappd\s*$/i, '').trim();
  const byMatch = cleaned.match(/^(.*?)\s+by\s+(.+)$/i);
  return byMatch
    ? { name: byMatch[1].trim(), brewery: byMatch[2].trim() }
    : { name: cleaned };
}

function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return undefined;
}

// A bare decimal could be almost anything on a page that also lists related
// beers with their own ratings and check-in counts; only accept it as
// Untappd's own rating if it's actually shaped like one (0-5, one or two
// decimal places).
function asRating(text) {
  const trimmed = (text || '').trim();
  return /^[0-5](\.\d{1,2})?$/.test(trimmed) ? trimmed : undefined;
}

// Untappd's current beer page (confirmed via a user-supplied DevTools
// screenshot of a real page) no longer shows a precise rating anywhere in
// visible text at all - just a whole number rounded for display, in
// parentheses next to the 5-cap widget ("(4)"), which is why domRating and
// every ratingRaw pattern below started coming back empty: none of them
// scan anything but rendered text, and "(4)" has no decimal point for
// \(([\d]\.\d{1,2})\) to match. The actual precise value (e.g. "3.99866")
// lives in a data-rating attribute on that same widget
// (<div class="caps" data-rating="3.99866">), which nothing here ever read.
// Rounded to 2 decimals up front rather than passed through asRating() as-is,
// since that function's stricter "shaped like 0-5 with 1-2 decimals" check
// exists to filter unrelated numbers out of free-text scans - not a concern
// for a value read directly out of an attribute literally named
// "data-rating", but its shape (more than 2 raw decimal digits) would
// otherwise fail that check for an unrelated reason.
function asRatingAttr(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) && num >= 0 && num <= 5 ? num.toFixed(2) : undefined;
}

// Untappd formats large counts with thousands separators ("1,382"); strip
// those before validating so the stored value is always plain digits and
// callers never have to re-parse a locale-specific separator to format it.
function asCount(text) {
  const trimmed = (text || '').replace(/,/g, '').trim();
  return /^\d+$/.test(trimmed) ? trimmed : undefined;
}

// Untappd shows "N/A" in place of a number for a beer with no listed IBU
// (confirmed against a real page - see the note above ibuRaw below), which
// none of the digit-only patterns match. Regardless of which case the page
// happens to use ("N/A", "n/a"), display it the same way every time.
function normalizeIbu(raw) {
  if (!raw) return undefined;
  return /^n\/a$/i.test(raw) ? 'N/A' : raw;
}

// Untappd's real, brewery-written tasting note (confirmed against a real
// page via a user-supplied DevTools inspection, not assumed) sits in one of
// two sibling divs depending on whether the text needed a "show more"
// truncation: .beer-descrption-read-less (yes, Untappd's own typo, not
// ours) holds the full text and is shown by default, with a "Show Less"
// link inside it; its sibling .beer-descrption-read-more holds a truncated
// version with a "Show More" link and stays hidden until clicked. Both
// exist in the static HTML regardless of which is visible, so the full
// text is readable without running any JavaScript - tried in the order a
// visitor would actually see them (expanded first).
//
// This is a different, and better, source than the og:description meta tag
// this file already reads (see ogDescription above): that tag is an
// auto-generated SEO/link-preview summary Untappd writes itself
// ("<Beer> by <Brewery> is a <Style> which has a rating of N.N out of 5,
// with N,NNN ratings and reviews on Untappd."), not anything the brewery
// wrote - it's still useful as a last-resort fallback for a page whose
// markup has moved on, just not as the first choice when the real text is
// available.
function extractBeerDescriptionFromDom($) {
  for (const selector of ['.beer-descrption-read-less', '.beer-descrption-read-more']) {
    const el = $(selector).first();
    if (!el.length) continue;
    // The "Show Less"/"Show More" toggle is itself an <a> nested inside the
    // same div as the text (see the note above) - strip it before reading
    // the text, or every description would end with that link's own label
    // stuck onto it.
    const clone = el.clone();
    clone.find('a').remove();
    const text = clone.text().replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return undefined;
}

// The beer page's brewery name is itself a link to that brewery's own
// Untappd page (confirmed via a screenshot of the real Full Circle page:
// the "Autodidact Beer" text under the beer title sits inside the same
// .brewery element parseBeerHtml already reads for the name, wrapped in an
// <a> whose href goes to /w/autodidact-beer/<id>). Location isn't anywhere
// on the beer page itself - see parseBreweryHtml below - so getting it
// means following this link and fetching that second page too.
function extractBreweryUrl(html, sourceUrl) {
  const $ = cheerio.load(html);
  const href = $('.brewery a').first().attr('href');
  if (!href) return undefined;
  try {
    return new URL(href, sourceUrl).toString();
  } catch {
    return undefined;
  }
}

// A brewery's own Untappd page (confirmed via a user-supplied DevTools
// screenshot of Autodidact Beer's page) reuses the exact same ".brewery"
// class name the beer page uses for its brewery-name link, but for
// something completely different here: a plain-text location ("Morris
// Plains, NJ United States"), not a link to anything, sitting in the same
// .top .basic .name structure a beer page uses for its own title and
// brewery link.
function parseBreweryHtml(html) {
  const $ = cheerio.load(html);
  return firstNonEmpty($('.basic .name .brewery').first().text());
}

// Split out from extractBeer so it can be exercised directly against fixture
// HTML in tests - a real fetch to Untappd isn't available to test against
// (see the note above), so this is the part that can actually be pinned
// down and regression-tested.
function parseBeerHtml(html, sourceUrl) {
  const $ = cheerio.load(html);
  const bodyText = $('body').text().replace(/\s+/g, ' ');

  const ogTitle = $('meta[property="og:title"]').attr('content');
  const ogDescription = firstNonEmpty(
    $('meta[property="og:description"]').attr('content'),
    $('meta[name="description"]').attr('content')
  );
  const fromTitle = splitBeerTitle(ogTitle);

  const description = firstNonEmpty(extractBeerDescriptionFromDom($), ogDescription);

  const domName = $('.name h1, h1[itemprop="name"], .beer-details .name').first().text();
  const domBrewery = $('.brewery a, .brewery-name, [itemprop="brand"] [itemprop="name"]').first().text();
  const domLocation = $('.brewery-location, .brewery .location').first().text();
  const domStyle = $('.style, [itemprop="style"]').first().text();
  const domRating = $('.rating .num, [itemprop="ratingValue"]').first().text();
  const domRatingAttr = $('.caps[data-rating]').first().attr('data-rating');

  const title = firstNonEmpty(domName, fromTitle.name);
  const brewery = firstNonEmpty(domBrewery, fromTitle.brewery);
  const location = firstNonEmpty(domLocation);
  const style = firstNonEmpty(domStyle);

  const abvRaw = firstMatch(bodyText, [
    /([\d]{1,2}(?:\.\d{1,2})?)\s*%\s*ABV\b/i,
    /\bABV\b[:\s]*([\d]{1,2}(?:\.\d{1,2})?)\s*%/i,
  ]);
  // "N/A IBU" is a real value Untappd shows, not a missing one - a beer
  // with no listed IBU still has a page, it just has nothing to put here.
  // Tried after the digit patterns since a number is the far more common
  // case.
  const ibuRaw = firstMatch(bodyText, [
    /([\d]{1,3})\s*IBU\b/i,
    /\bIBU\b[:\s]*([\d]{1,3})\b/i,
    /\b(N\/A)\s*IBU\b/i,
    /\bIBU\b[:\s]*(N\/A)\b/i,
  ]);
  const ratingRaw = firstMatch(bodyText, [
    /Rated\s+([\d]\.\d{1,2})\b/i,
    /([\d]\.\d{1,2})\s*(?:out of 5|Caps)\b/i,
    // Untappd's actual beer-detail page (confirmed from a real page via a
    // user report, not assumed) shows the rating as a bare number in
    // parentheses next to the 5-dot widget, with none of the "Rated"/"out
    // of 5" phrasing the two patterns above look for. Tried last - a bare
    // parenthesized decimal is a weaker signal than an explicit phrase, and
    // asRating()'s 0-5/two-decimal shape below is the only thing standing
    // between this and an unrelated number elsewhere in parentheses on the
    // page.
    /\(([\d]\.\d{1,2})\)/,
    // Untappd's own auto-generated og:description reads "<Beer> by
    // <Brewery> is a <Style> which has a rating of N.N out of 5, with
    // N,NNN ratings..." - a real fallback when the rating isn't in the
    // visible page at all, but rounded to one decimal rather than the two
    // the on-page widget uses, so it's tried only after everything above.
  ]) || firstMatch(ogDescription || '', [/rating of\s+([\d]\.\d{1,2})\s*out of 5/i]);
  // The count of people who rated the beer sits next to the rating widget
  // on the page itself ("1,382 Ratings") and, as a fallback, in the same
  // auto-generated og:description sentence the rating fallback above reads
  // ("...has a rating of 4.2 out of 5, with 1,382 ratings and reviews on
  // Untappd.") - tried in that order for the same reason as the rating
  // fallback above: the real page text first, the SEO summary only when
  // nothing on the page has it.
  const ratingCountRaw = firstMatch(bodyText, [/([\d,]+)\s+Ratings?\b/i])
    || firstMatch(ogDescription || '', [/with\s+([\d,]+)\s+ratings/i]);

  const abv = abvRaw ? `${trimNumber(abvRaw)}%` : undefined;
  const ibu = normalizeIbu(ibuRaw);
  const untappdRating = firstNonEmpty(asRatingAttr(domRatingAttr), asRating(domRating), asRating(ratingRaw));
  const untappdRatingCount = asCount(ratingCountRaw);

  const imageUrl = $('meta[property="og:image"]').attr('content');

  if (!title && !brewery && !abv && !ibu && !untappdRating && !description) {
    throw new Error(
      'Could not find beer details on that page. Untappd may be blocking automated '
      + 'requests - try a direct beer page URL, or enter the details manually.'
    );
  }

  return {
    title: title || '',
    description: description || '',
    brewery: brewery || '',
    location: location || '',
    style: style || '',
    abv: abv || '',
    ibu: ibu || '',
    untappdRating: untappdRating || '',
    untappdRatingCount: untappdRatingCount || '',
    imageUrl: imageUrl || '',
    sourceUrl,
  };
}

async function extractBeer(url) {
  let html;
  try {
    html = await fetchBeerHtml(url);
  } catch (err) {
    if (BLOCKED_STATUSES.has(err.httpStatus)) {
      throw new Error(
        'Untappd blocked this request. This can happen from certain networks or hosting '
        + 'providers - try again in a bit, from a different network, or enter the beer\'s '
        + 'details manually.'
      );
    }
    throw err;
  }
  const result = parseBeerHtml(html, url);

  // Location is a second request away - following the brewery link found
  // above to that brewery's own page (see extractBreweryUrl/parseBreweryHtml
  // above). Best-effort only: the beer import itself already succeeded by
  // this point, so a brewery page that's blocked, missing, or shaped
  // differently just leaves location blank for manual entry rather than
  // failing the whole import over a field that was never guaranteed.
  if (!result.location) {
    const breweryUrl = extractBreweryUrl(html, url);
    if (breweryUrl) {
      try {
        const breweryHtml = await fetchBeerHtml(breweryUrl);
        const location = parseBreweryHtml(breweryHtml);
        if (location) result.location = location;
      } catch {
        // Swallow - see comment above.
      }
    }
  }

  return result;
}

// ================================================================
// Wine/spirits tasting notes lookup - the one-click "Find Tasting Notes"
// button next to the Description field on the Manual Entry form (see
// app.js). Unlike the product/beer importers above, there's no URL to
// paste here: the lookup is driven entirely by whatever's already typed
// into the Product Title (and Vintage, if set), the same way someone would
// type a product name into a search box.
//
// Structured as a list of providers (TASTING_NOTE_PROVIDERS below) tried in
// order, so a source can be added as one more entry rather than a rewrite -
// findTastingNotes just walks the list and returns the first provider that
// turns up something usable. Currently two: Wine.com and Vivino.
//
// As with the Untappd beer importer above, this was written and unit
// tested against hand-built fixture HTML only - the environment this was
// built in blocks every outbound request to wine.com and vivino.com before
// it arrives (see the note above RESILIENT_HEADER_SETS for the equivalent
// situation with Untappd), so none of the URL patterns or selectors below
// have been confirmed against the real sites. Confirmed in real-world use,
// though: both sites have been seen actively blocking this app's requests
// (a 403) rather than just having an unconfirmed URL/markup guess, so a
// second source existing at all - not just its specific implementation -
// is meaningfully useful here, not merely "nice to have." Every step
// degrades to "found nothing" rather than throwing on a shape it doesn't
// recognize, and the caller falls back to the next provider (and
// ultimately to "enter it by hand") instead of surfacing a confusing error.
// ================================================================

// wine.com's search results page - unconfirmed from this environment (see
// note above), based on the site's publicly known URL structure. If this
// pattern has changed, parseWineComSearchResults below just finds no
// candidates and the lookup reports "nothing found" rather than a wrong
// result.
function wineComSearchUrl(query) {
  return `https://www.wine.com/search/${encodeURIComponent(query)}`;
}

// A plain-text search query built from whatever's already in the form -
// staff never type anything new for this. Most manually-entered titles
// already include a vintage year (see the form's own placeholder, "Josh
// Cellars Cabernet Sauvignon 2025"), so the separate Vintage field is only
// appended when the title doesn't already carry a 4-digit year - otherwise
// a query like "...Cabernet Sauvignon 2025 2022" would read as two
// conflicting vintages to wine.com's own search.
function buildTastingNotesQuery(title, vintage) {
  const trimmedTitle = (title || '').trim();
  const trimmedVintage = (vintage || '').trim();
  if (trimmedVintage && !/\b\d{4}\b/.test(trimmedTitle)) {
    return `${trimmedTitle} ${trimmedVintage}`;
  }
  return trimmedTitle;
}

function tokenize(text) {
  return (text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

// Search results pages routinely list several unrelated products (other
// vintages, other bottlings from the same producer) alongside the actual
// match - picking "the first result" blindly risks pulling tasting notes
// for the wrong wine entirely. Candidates are scored by how many of the
// query's own words (title + vintage) appear in their listed title, and
// only accepted if at least half of them do - a weak or absent match
// returns nothing rather than a confident-looking wrong answer.
function pickBestMatch(candidates, query) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || candidates.length === 0) return undefined;
  const threshold = Math.max(1, Math.ceil(queryTokens.length / 2));

  let best;
  let bestScore = 0;
  for (const candidate of candidates) {
    const candidateTokens = new Set(tokenize(candidate.title));
    const score = queryTokens.reduce((n, t) => n + (candidateTokens.has(t) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= threshold ? best : undefined;
}

// schema.org ItemList JSON-LD, as emitted by many large e-commerce sites on
// search/category pages for search-engine rich results - the same
// @graph-flattening trick as findJsonLdProduct above, just looking for
// itemListElement instead of a Product node.
function findJsonLdItemListEntries($) {
  const entries = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw || !raw.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const graphNodes = Array.isArray(node && node['@graph']) ? node['@graph'] : [node];
        for (const graphNode of graphNodes) {
          if (Array.isArray(graphNode && graphNode.itemListElement)) {
            entries.push(...graphNode.itemListElement);
          }
        }
      }
    } catch {
      // Ignore malformed JSON-LD blocks, same as findJsonLdProduct above.
    }
  });
  return entries;
}

// Pulls candidate {url, title} product/wine links out of a catalog search
// results page. Tried in two tiers:
//
// 1. The ItemList JSON-LD above - far more stable than markup, since it's
//    meant to be machine-read rather than styled.
// 2. A plain scan for anchors whose href contains `hrefMarker` - each
//    provider's own stable, permanent link shape (wine.com's
//    `/product/<slug>/<id>`, Vivino's `/w/<id>`) rather than a CSS class,
//    so this survives a template/markup rename that would break a
//    selector-based scrape.
//
// Shared by every catalog-site provider below (wine.com, Vivino) since the
// approach - not the specific pattern - is what's common between them.
function parseGenericSearchResults(html, baseUrl, hrefMarker) {
  const $ = cheerio.load(html);
  const candidates = [];

  for (const entry of findJsonLdItemListEntries($)) {
    const item = entry && entry.item ? entry.item : entry;
    const url = item && (item.url || item['@id']);
    const title = item && (item.name || (entry && entry.name));
    if (!url || !title) continue;
    try {
      candidates.push({ url: new URL(url, baseUrl).toString(), title: String(title).trim() });
    } catch {
      // Skip an unparseable URL rather than failing the whole search.
    }
  }

  if (candidates.length === 0) {
    $(`a[href*="${hrefMarker}"]`).each((_, el) => {
      const href = $(el).attr('href');
      const title = $(el).text().replace(/\s+/g, ' ').trim();
      if (!href || !title) return;
      try {
        candidates.push({ url: new URL(href, baseUrl).toString(), title });
      } catch {
        // Skip an unparseable URL rather than failing the whole search.
      }
    });
  }

  return candidates;
}

function parseWineComSearchResults(html, baseUrl) {
  return parseGenericSearchResults(html, baseUrl, '/product/');
}

// Vivino wine pages are permalinked as `.../w/<numeric id>` regardless of
// locale or slug - the most stable part of the URL to key a fallback scan
// off of, same rationale as wine.com's `/product/` marker above.
function parseVivinoSearchResults(html, baseUrl) {
  return parseGenericSearchResults(html, baseUrl, '/w/');
}

// Extracts a description/tasting note from a catalog product page. Same
// tiered approach as extractProduct above - JSON-LD Product schema first,
// then Open Graph/meta description - since a standard retail/catalog
// storefront usually emits at least one of these for search-engine rich
// results, regardless of how much of the rest of the page needs JavaScript
// to render. Shared by every catalog-site provider below, unlike Untappd's
// bespoke beer-page parsing further up, which has a real dedicated
// tasting-note element to prefer over this.
function parseGenericProductDescription(html, url) {
  const $ = cheerio.load(html);
  const ld = findJsonLdProduct($) || {};
  const title = firstNonEmpty(ld.name, $('meta[property="og:title"]').attr('content'), $('h1').first().text());
  const description = firstNonEmpty(
    ld.description,
    $('meta[property="og:description"]').attr('content'),
    $('meta[name="description"]').attr('content')
  );
  return { title: title || '', description: description || '', sourceUrl: url };
}

function parseWineComProductHtml(html, url) {
  return parseGenericProductDescription(html, url);
}

function parseVivinoProductHtml(html, url) {
  return parseGenericProductDescription(html, url);
}

// Vivino's own search - unconfirmed from this environment, same caveat as
// wine.com above, but worth calling out specifically here: Vivino is a
// heavier single-page app than wine.com, so there's a real chance more of
// its content (search results, the tasting-note text itself) is filled in
// client-side after the initial HTML loads, which this plain HTTP fetch
// would never see - if this comes back empty even for wines that visibly
// have notes in a browser, that's the likely reason, and isn't fixable
// without actually rendering the page (e.g. a headless browser), which this
// app doesn't do.
function vivinoSearchUrl(query) {
  return `https://www.vivino.com/search/wines?q=${encodeURIComponent(query)}`;
}

// Both wine.com and Vivino have been seen actively blocking this app's
// requests (a 403) in real use - not just a hypothetical per the
// RESILIENT_HEADER_SETS comment above. fetchHtmlResilient already retries
// once with a more browser-like header set; if a block still gets through
// that, this turns the raw "403 Forbidden" into the same kind of
// actionable message extractBeer already gives for a blocked Untappd
// request, instead of a bare HTTP status staff have no way to act on.
async function fetchCatalogHtml(url, siteName) {
  try {
    return await fetchHtmlResilient(url);
  } catch (err) {
    if (BLOCKED_STATUSES.has(err.httpStatus)) {
      // Deliberately doesn't end with its own "...or enter it by hand" -
      // findTastingNotes's caller already appends that once for every
      // provider's error, single or combined; repeating it here read as a
      // stutter ("...enter the description by hand. Try a different title,
      // or enter the description by hand.").
      throw new Error(
        `${siteName} blocked this request. This can happen from certain networks or hosting `
        + 'providers - try again in a bit, from a different network, or pick a different source above.'
      );
    }
    throw err;
  }
}

// Shared search-and-extract flow for every catalog-site provider: build the
// query, search, pick the best match, then pull a description off the
// matched product page. Only the search URL, the two parsers, and the
// site's own name differ between wine.com and Vivino - see
// TASTING_NOTE_PROVIDERS below for where those get plugged in.
async function searchProductCatalog({ title, vintage, siteName, searchUrlFor, parseSearchResults, parseProductPage }) {
  const query = buildTastingNotesQuery(title, vintage);
  if (!query) throw new Error('Enter a product title first.');

  const searchUrl = searchUrlFor(query);
  const searchHtml = await fetchCatalogHtml(searchUrl, siteName);
  const candidates = parseSearchResults(searchHtml, searchUrl);
  const match = pickBestMatch(candidates, query);
  if (!match) {
    throw new Error(`Could not find "${title}" on ${siteName}.`);
  }

  const productHtml = await fetchCatalogHtml(match.url, siteName);
  const { description } = parseProductPage(productHtml, match.url);
  if (!description) {
    throw new Error(`Found "${match.title}" on ${siteName}, but it has no description to import.`);
  }

  return { description, sourceUrl: match.url, sourceName: siteName, matchedTitle: match.title };
}

function searchWineCom(title, vintage) {
  return searchProductCatalog({
    title,
    vintage,
    siteName: 'Wine.com',
    searchUrlFor: wineComSearchUrl,
    parseSearchResults: parseWineComSearchResults,
    parseProductPage: parseWineComProductHtml,
  });
}

function searchVivino(title, vintage) {
  return searchProductCatalog({
    title,
    vintage,
    siteName: 'Vivino',
    searchUrlFor: vivinoSearchUrl,
    parseSearchResults: parseVivinoSearchResults,
    parseProductPage: parseVivinoProductHtml,
  });
}

// ================================================================
// Store SKU lookup - backs the "SKU Lookup" tab (which replaced Bulk CSV
// Import): staff type in the store's own SKU number, this searches
// liquoroutletwinecellars.com for it, picks the exact matching result, then
// pulls title/size/price straight off that product page. For beer, a
// second step (see enrichBeerFromUntappd below) searches Untappd by the
// title just found and layers in the description/brewery/style/ABV/
// IBU/rating a retail page wouldn't have.
//
// Unlike the wine.com/Vivino tasting-notes lookup above, this was
// confirmed against real markup a staff member copied out of their own
// browser (both the search-results page for a real SKU and the product
// page it led to) - not a guess written against an environment that
// couldn't reach the site at all. The store runs on the WineCommerce
// platform (winepos.com): search is a plain GET
// (`/store/search.asp?keyword=<sku>*`), each result card carries its own
// SKU in a hidden `<input class="product-code">` so matching is an exact
// string compare rather than the fuzzy title scoring pickBestMatch does for
// wine.com/Vivino, and product pages carry schema.org microdata
// (`itemprop="name"`) plus Open Graph product tags (`og:upc` = SKU)
// alongside their own plain-text spec table (Varietal/Year/Size/SKU/Pack
// Size) - both read here so a template tweak that drops one still leaves
// the other.
// ================================================================

function storeSearchUrl(sku) {
  return `https://www.liquoroutletwinecellars.com/store/search.asp?keyword=${encodeURIComponent(sku)}*`;
}

// Each result card's hidden product-code input carries the exact SKU
// (confirmed from real search-results markup), which is what makes this an
// exact match instead of the fuzzy scoring pickBestMatch does above - the
// SKU staff typed in either appears verbatim on a card or it doesn't.
function parseStoreSearchResults(html, baseUrl) {
  const $ = cheerio.load(html);
  const candidates = [];
  $('.product-list-item').each((_, el) => {
    const card = $(el);
    const sku = card.find('.product-code').attr('value');
    const href = card.find('a.product-link').attr('href');
    const title = card.find('.productnameTitle').first().text().replace(/\s+/g, ' ').trim();
    const brand = card.find('h6').first().text().replace(/\s+/g, ' ').trim();
    if (!sku || !href) return;
    try {
      candidates.push({ sku: sku.trim(), url: new URL(href, baseUrl).toString(), title, brand });
    } catch {
      // Skip a card with an unparseable URL rather than failing the whole search.
    }
  });
  return candidates;
}

function pickSkuMatch(candidates, sku) {
  const target = String(sku || '').trim();
  return candidates.find((c) => c.sku === target);
}

// The product page's plain-text spec table (label/value rows for "SKU",
// "Size", "Varietal", "Year", "Pack Size" - confirmed present on a real
// product page) reads the same regardless of which element wraps each row,
// so this scans by visible label text rather than a specific tag/class.
function storeSpecValue($, label) {
  let value;
  $('th, td, dt, li, tr').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const match = text.match(new RegExp(`^${label}\\s*:?\\s*(.+)$`, 'i'));
    if (match) { value = match[1].trim(); return false; }
  });
  return value;
}

function parseStoreProductHtml(html, url) {
  const $ = cheerio.load(html);

  const title = firstNonEmpty(
    $('h1[itemprop="name"]').first().text(),
    $('meta[property="og:title"]').attr('content'),
    $('h1').first().text()
  );
  const brand = firstNonEmpty(
    $('h6 a').first().text(),
    $('meta[property="og:brand"]').attr('content')
  );
  const sku = firstNonEmpty(
    $('meta[property="og:upc"]').attr('content'),
    storeSpecValue($, 'SKU')
  );
  const size = firstNonEmpty(storeSpecValue($, 'Size'), guessSize(title));
  const vintage = firstNonEmpty(storeSpecValue($, 'Year'), guessVintage(title));
  const price = firstNonEmpty(
    money($('.pricingDetails .priceFull').first().text()),
    money($('meta[property="og:price:standard_amount"]').attr('content')),
    money($('meta[property="product:price:amount"]').attr('content'))
  );
  const salePrice = firstNonEmpty(money($('.pricingDetails .priceCurrent').first().text()));
  const description = firstNonEmpty(
    $('#description .text-product-desc').first().text().replace(/\s+/g, ' ').trim(),
    $('meta[property="og:description"]').attr('content')
  );

  if (!title) {
    throw new Error('Could not find product details on that page. Enter the details manually.');
  }

  return {
    title: title || '',
    brand: brand || '',
    sku: sku || '',
    size: size || '',
    vintage: vintage || '',
    price: price || '',
    salePrice: salePrice && salePrice !== price ? salePrice : '',
    description: description || '',
    sourceUrl: url,
  };
}

async function fetchStoreHtml(url) {
  try {
    return await fetchHtmlResilient(url);
  } catch (err) {
    if (BLOCKED_STATUSES.has(err.httpStatus)) {
      throw new Error(
        'The store site blocked this automated request. This can happen from certain networks or '
        + 'hosting providers - try again in a bit, paste the product page\'s HTML instead, or enter '
        + 'the details manually.'
      );
    }
    throw err;
  }
}

async function lookupStoreSku(sku) {
  const trimmed = String(sku || '').trim();
  if (!trimmed) throw new Error('Enter a SKU first.');

  const searchUrl = storeSearchUrl(trimmed);
  const searchHtml = await fetchStoreHtml(searchUrl);
  const candidates = parseStoreSearchResults(searchHtml, searchUrl);
  const match = pickSkuMatch(candidates, trimmed);
  if (!match) {
    throw new Error(`No product found for SKU "${trimmed}". Double-check the number, or enter the details manually.`);
  }

  const productHtml = await fetchStoreHtml(match.url);
  return parseStoreProductHtml(productHtml, match.url);
}

// The "paste page HTML" fallback for the SKU Lookup tab, same shape as
// parsePastedProduct above - for when the store site blocks the search or
// product-page fetch outright. Staff search the SKU themselves and paste
// the resulting product page's HTML; `url` is optional and only labels the
// result's sourceUrl.
function parsePastedStoreProduct({ html, url }) {
  if (!html || !html.trim()) {
    throw new Error("Paste the page's HTML first.");
  }
  return parseStoreProductHtml(html, typeof url === 'string' ? url.trim() : '');
}

// ================================================================
// Untappd search-by-name - the SKU lookup's beer-specific second step. The
// store site above has no idea what Untappd calls a beer, so this takes
// whatever title the SKU lookup just filled in and searches Untappd for
// it, the same search -> pick -> extract shape searchProductCatalog uses
// for wine.com/Vivino above, landing on the same parseBeerHtml this file
// already uses for a pasted Untappd URL.
//
// Unconfirmed from this environment, same caveat as the rest of the
// Untappd parsing further up (see the note above RESILIENT_HEADER_SETS) -
// built the same tiered way regardless: JSON-LD ItemList first, falling
// back to a scan for Untappd's own stable `/b/<slug>/<id>` beer-page link
// shape (the same shape extractBreweryUrl already follows from a beer
// page), so a markup change degrades to "found nothing" rather than a
// wrong match.
// ================================================================

function untappdSearchUrl(query) {
  return `https://untappd.com/search?q=${encodeURIComponent(query)}`;
}

function parseUntappdSearchResults(html, baseUrl) {
  return parseGenericSearchResults(html, baseUrl, '/b/');
}

async function searchUntappd(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) throw new Error('Enter a product title first.');

  const searchUrl = untappdSearchUrl(trimmed);
  const searchHtml = await fetchCatalogHtml(searchUrl, 'Untappd');
  const candidates = parseUntappdSearchResults(searchHtml, searchUrl);
  const match = pickBestMatch(candidates, trimmed);
  if (!match) {
    throw new Error(`Could not find "${trimmed}" on Untappd.`);
  }

  const beerHtml = await fetchCatalogHtml(match.url, 'Untappd');
  return parseBeerHtml(beerHtml, match.url);
}

const SIZE_PATTERN = /\b\d+(?:\.\d+)?\s?(?:ml|mL|l|L|oz|OZ)\b|\b\d+\s?-?\s?pack\b/gi;

// Strips a container size out of a scraped title - e.g. "Daylily 16OZ"
// becomes "Daylily", since size already has its own form field and staff
// don't want it duplicated in the product title. Also used to clean up the
// title before it's sent to Untappd as a search query below - the store's
// own title sometimes trails off with the container size (see the real
// SKU-lookup fixture that inspired this), which is dead weight a beer
// search doesn't have and can hurt the match.
function stripSize(title, size) {
  let name = title || '';
  if (size) name = name.split(size).join(' ');
  return name.replace(SIZE_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

// Composes "Producer Product Name" (size left out) from a scraped product -
// used two ways below: as the actual title field for wine/spirits SKU
// lookups, and as the Untappd search query for beer. The store's own title
// sometimes already leads with the producer name, so this only prepends the
// brand when the title doesn't already start with it, to avoid "Josh
// Cellars Josh Cellars Cabernet Sauvignon".
function composeProducerTitle({ title, brand, size }) {
  const name = stripSize(title, size);
  const trimmedBrand = (brand || '').trim();
  if (!trimmedBrand || name.toLowerCase().startsWith(trimmedBrand.toLowerCase())) {
    return name;
  }
  return `${trimmedBrand} ${name}`.trim();
}

// Layers Untappd's own description/brewery/style/ABV/IBU/rating on top of
// what the store page already gave lookupSku/lookupSkuFromHtml below - the
// store's generic manufacturer blurb (see parseStoreProductHtml) is kept as
// a fallback description only if Untappd search comes back empty, matching
// what was actually asked for ("descriptions pulled from other sources,
// such as untappd"). Searches Untappd with the brewery folded into the
// query (composeProducerTitle, same helper the wine/spirits title uses) -
// a bare one- or two-word beer name like "Daylily" is too weak a query on
// its own (confirmed against a real SKU lookup: searching just "Daylily"
// came back "Could not find... on Untappd", where the beer's own page is
// really titled "Daylily by Autodidact Beer"), but the displayed title
// field stays brewery-free since beer already has its own dedicated
// Brewery field on the shelf talker. Best-effort only, same as
// extractBeer's own bonus brewery-location fetch above: the store lookup
// already succeeded by this point, so a beer Untappd can't find (or that
// blocks this request) just leaves those fields blank/store-sourced for
// manual entry rather than failing the whole SKU lookup - but the reason
// still comes back as untappdError so the SKU Lookup tab can tell staff "we
// tried and Untappd had nothing" instead of leaving them to guess why the
// fields are empty.
async function enrichBeerFromUntappd(product) {
  const title = stripSize(product.title, product.size);
  const searchQuery = composeProducerTitle(product);
  try {
    const beer = await searchUntappd(searchQuery);
    return {
      ...product,
      title,
      description: firstNonEmpty(beer.description, product.description) || '',
      brewery: beer.brewery || product.brand || '',
      location: beer.location || '',
      style: beer.style || '',
      abv: beer.abv || '',
      ibu: beer.ibu || '',
      untappdRating: beer.untappdRating || '',
      untappdRatingCount: beer.untappdRatingCount || '',
    };
  } catch (err) {
    return { ...product, title, brewery: product.brand || '', untappdError: err.message || 'Untappd search failed.' };
  }
}

async function lookupSku({ sku, category }) {
  const product = await lookupStoreSku(sku);
  if (category === 'beer') return enrichBeerFromUntappd(product);
  return { ...product, title: composeProducerTitle(product) };
}

async function lookupSkuFromHtml({ html, url, category }) {
  const product = parsePastedStoreProduct({ html, url });
  if (category === 'beer') return enrichBeerFromUntappd(product);
  return { ...product, title: composeProducerTitle(product) };
}

// Ordered list of tasting-notes sources - see the module comment above.
// findTastingNotes tries each in order (unless a specific one was
// requested) and stops at the first that returns something; adding a third
// source later is just one more entry here.
const TASTING_NOTE_PROVIDERS = [
  { name: 'Wine.com', search: searchWineCom },
  { name: 'Vivino', search: searchVivino },
];

// Names only, for the "Find Tasting Notes" dialog's Source dropdown (see
// app.js) - lets the client build that list without duplicating it, and
// without exposing the provider objects' search functions.
const TASTING_NOTE_PROVIDER_NAMES = TASTING_NOTE_PROVIDERS.map((p) => p.name);

// `source` picks one named provider to search instead of the full ordered
// list - what the "Find Tasting Notes" dialog sends once staff choose a
// specific site from the dropdown, rather than the default "Any source"
// (which still tries them in order, same as before that dialog existed).
async function findTastingNotes({ title, vintage, source }) {
  if (!title || !title.trim()) {
    throw new Error('Enter a product title first.');
  }

  const providers = source
    ? TASTING_NOTE_PROVIDERS.filter((p) => p.name === source)
    : TASTING_NOTE_PROVIDERS;
  if (source && providers.length === 0) {
    throw new Error(`Unknown tasting notes source: "${source}".`);
  }

  const errors = [];
  for (const provider of providers) {
    try {
      return await provider.search(title, vintage);
    } catch (err) {
      errors.push({ provider: provider.name, message: err.message });
    }
  }

  const detail = errors.length === 1
    ? errors[0].message
    : errors.map((e) => `${e.provider}: ${e.message}`).join(' ');
  throw new Error(`${detail} Try a different title, or enter the description by hand.`);
}

module.exports = {
  extractProduct,
  parseProductHtml,
  parsePastedProduct,
  extractBeer,
  parseBeerHtml,
  fetchBeerHtml,
  parseBreweryHtml,
  extractBreweryUrl,
  findTastingNotes,
  TASTING_NOTE_PROVIDER_NAMES,
  buildTastingNotesQuery,
  pickBestMatch,
  parseWineComSearchResults,
  parseWineComProductHtml,
  wineComSearchUrl,
  parseVivinoSearchResults,
  parseVivinoProductHtml,
  vivinoSearchUrl,
  storeSearchUrl,
  parseStoreSearchResults,
  pickSkuMatch,
  parseStoreProductHtml,
  lookupStoreSku,
  parsePastedStoreProduct,
  untappdSearchUrl,
  parseUntappdSearchResults,
  searchUntappd,
  composeProducerTitle,
  lookupSku,
  lookupSkuFromHtml,
};
