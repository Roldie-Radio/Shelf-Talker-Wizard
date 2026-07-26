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

function pricesFromOffers(offers) {
  if (!offers) return {};
  const list = Array.isArray(offers) ? offers : [offers];
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

async function extractProduct(url) {
  const html = await fetchHtml(url);
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

// Two header sets, tried in order (see fetchBeerHtml below):
//
// 1. Plain: the product importer's own honest, self-identifying UA. This
//    is what's actually gotten data back from Untappd in real use.
// 2. Full-browser: a complete, internally-consistent set of headers a real
//    Chrome navigation sends together (UA + Accept-Language + the
//    sec-fetch-*/sec-ch-ua client hints). A bare User-Agent claiming to be
//    Chrome with none of the headers that normally travel with it is
//    itself a known bot signature - some WAFs treat that combination as
//    MORE suspicious than a plain script UA that isn't pretending to be
//    anything, which is the opposite of what an earlier version of this
//    file assumed. Kept as a second attempt rather than the default, since
//    it's an untested hypothesis, not confirmed against the live site.
const BEER_HEADER_SETS = [
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
async function fetchBeerHtml(url) {
  for (let i = 0; i < BEER_HEADER_SETS.length; i++) {
    try {
      return await fetchHtml(url, BEER_HEADER_SETS[i]);
    } catch (err) {
      const hasMoreAttempts = i < BEER_HEADER_SETS.length - 1;
      if (!hasMoreAttempts || !BLOCKED_STATUSES.has(err.httpStatus)) throw err;
    }
  }
  // Unreachable - the loop above always either returns or throws - but
  // keeps the function's control flow explicit rather than implying it
  // could fall off the end and return undefined.
  throw new Error('Could not fetch that page.');
}

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

  const domName = $('.name h1, h1[itemprop="name"], .beer-details .name').first().text();
  const domBrewery = $('.brewery a, .brewery-name, [itemprop="brand"] [itemprop="name"]').first().text();
  const domLocation = $('.brewery-location, .brewery .location').first().text();
  const domStyle = $('.style, [itemprop="style"]').first().text();
  const domRating = $('.rating .num, [itemprop="ratingValue"]').first().text();

  const title = firstNonEmpty(domName, fromTitle.name);
  const brewery = firstNonEmpty(domBrewery, fromTitle.brewery);
  const location = firstNonEmpty(domLocation);
  const style = firstNonEmpty(domStyle);

  const abvRaw = firstMatch(bodyText, [
    /([\d]{1,2}(?:\.\d{1,2})?)\s*%\s*ABV\b/i,
    /\bABV\b[:\s]*([\d]{1,2}(?:\.\d{1,2})?)\s*%/i,
  ]);
  const ibuRaw = firstMatch(bodyText, [
    /([\d]{1,3})\s*IBU\b/i,
    /\bIBU\b[:\s]*([\d]{1,3})\b/i,
  ]);
  const ratingRaw = firstMatch(bodyText, [
    /Rated\s+([\d]\.\d{1,2})\b/i,
    /([\d]\.\d{1,2})\s*(?:out of 5|Caps)\b/i,
  ]);

  const abv = abvRaw ? `${trimNumber(abvRaw)}%` : undefined;
  const ibu = firstNonEmpty(ibuRaw);
  const untappdRating = firstNonEmpty(asRating(domRating), asRating(ratingRaw));

  const imageUrl = $('meta[property="og:image"]').attr('content');

  if (!title && !brewery && !abv && !ibu && !untappdRating && !ogDescription) {
    throw new Error(
      'Could not find beer details on that page. Untappd may be blocking automated '
      + 'requests - try a direct beer page URL, or enter the details manually.'
    );
  }

  return {
    title: title || '',
    description: ogDescription || '',
    brewery: brewery || '',
    location: location || '',
    style: style || '',
    abv: abv || '',
    ibu: ibu || '',
    untappdRating: untappdRating || '',
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
  return parseBeerHtml(html, url);
}

module.exports = { extractProduct, extractBeer, parseBeerHtml, fetchBeerHtml };
