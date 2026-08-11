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

// liquoroutletwinecellars.com's own product-page spec rows (Brand, Pack
// Size, Year) read the literal text "Not Specified" - not a blank row -
// when the store has nothing on file for that field. Used to keep that
// placeholder out of any field it's read into (parseStoreProductHtml
// below), rather than passing it straight through into a Product title or
// an Untappd search query as if it were real data.
function dropNotSpecified(value) {
  return /^not specified$/i.test((value || '').trim()) ? undefined : value;
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

// liquoroutletwinecellars.com's own product pages - reachable here via a
// URL pasted straight into "Import from website", not just via the SKU
// Lookup tab's search-by-SKU flow (see storeSearchUrl/lookupStoreSku below) -
// don't carry the schema.org/Open Graph markup parseProductHtml above looks
// for Size and Price in: no JSON-LD Product `offers`/`size`, no
// `product:price:amount` (or similarly-named) meta tag, and none of the
// Shopify/WooCommerce "was/now" price selectors pricesFromCommonSelectors
// checks. Size and Price instead live in this site's own plain-text spec
// table and `.pricingDetails` markup - exactly what parseStoreProductHtml
// already reads, and already has real-page-confirmed tests for (see the
// note above it). Nothing here throws on a generic-looking parse failure;
// Title and Description still come back fine either way (both sites emit
// Open Graph tags), so without this a store URL pasted into "Import from
// website" would quietly leave Size and Price blank instead of failing
// loudly. Any URL on this host is routed to that parser instead, both for a
// live fetch (extractProduct) and for the "paste page HTML" fallback
// (parsePastedProduct) below.
const STORE_HOSTNAMES = new Set(['liquoroutletwinecellars.com', 'www.liquoroutletwinecellars.com']);

function isStoreUrl(url) {
  try {
    return STORE_HOSTNAMES.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

// parseStoreProductHtml's own title is whatever's in the page's H1/og:title
// verbatim, container size and all (e.g. "Michelob ULTRA 12pk-12oz Cans") -
// fine for the SKU Lookup tab, which never uses that raw title directly
// either (lookupSku/lookupSkuFromHtml below both run it through
// composeProducerTitle first, the same size-stripping/brand-prepending step
// applied here). Without this, a store URL pasted into "Import from
// website" would end up with the container size duplicated in both the
// Product Title field and the new Size field this now fills in.
function parseStoreProductForImport(html, url) {
  const product = parseStoreProductHtml(html, url);
  return { ...product, title: composeProducerTitle(product) };
}

async function extractProduct(url) {
  if (isStoreUrl(url)) {
    const html = await fetchStoreHtml(url);
    return parseStoreProductForImport(html, url);
  }
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
  if (category === 'beer') return parseBeerHtml(html, sourceUrl);
  return isStoreUrl(sourceUrl) ? parseStoreProductForImport(html, sourceUrl) : parseProductHtml(html, sourceUrl);
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
//
// A bare "0"/"0.00" is excluded even though it's shaped like a rating: a
// real Untappd beer page (confirmed via a user-supplied screenshot) shows
// empty dots and "(N/A)" - not a zero score - for a beer with no computed
// average yet, even one with check-ins/"Ratings" already counted against
// it. No real average can land on exactly 0.00 anyway (the lowest single
// score Untappd allows is a quarter cap), so a literal 0 here always means
// "no rating", and importing it as "0.00" would misrepresent the beer as
// having the worst possible score instead of none at all.
function asRating(text) {
  const trimmed = (text || '').trim();
  if (!/^[0-5](\.\d{1,2})?$/.test(trimmed)) return undefined;
  return Number(trimmed) === 0 ? undefined : trimmed;
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
// Same "0 means no rating, not a real zero" rule as asRating() above
// applies here too - and this attribute is in fact where that 0 actually
// comes from: Untappd's own markup sets data-rating="0" on the caps widget
// for a beer with no computed average, which is what its page then renders
// as empty dots and "(N/A)" rather than a score.
function asRatingAttr(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) && num > 0 && num <= 5 ? num.toFixed(2) : undefined;
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

// A beer's own Untappd page never carries a location string on it at all
// (see parseBreweryHtml's comment above) - only a link to the brewery's own
// separate page, which does. Location is a second request away, following
// that link (extractBreweryUrl/parseBreweryHtml above). Best-effort only:
// the beer's own data already parsed fine by this point, so a brewery page
// that's blocked, missing, or shaped differently just leaves location blank
// for manual entry rather than failing the whole lookup over a field that
// was never guaranteed. Shared by every beer-enrichment path that ends up
// with a parsed beer object - extractBeer below, searchUntappd's automatic
// search, and the manual untappdBeerFromUrl/untappdBeerFromHtml fallbacks
// further down - since a bare parseBeerHtml call never fills this in on its
// own, no matter which of those got it there.
async function fillBeerLocation(beer, html, sourceUrl) {
  if (beer.location) return beer;
  const breweryUrl = extractBreweryUrl(html, sourceUrl);
  if (!breweryUrl) return beer;
  try {
    const breweryHtml = await fetchBeerHtml(breweryUrl);
    const location = parseBreweryHtml(breweryHtml);
    if (location) return { ...beer, location };
  } catch {
    // Swallow - see comment above.
  }
  return beer;
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
  return fillBeerLocation(parseBeerHtml(html, url), html, url);
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
// turns up something usable. Currently three: Wine.com, Vivino, and
// Distiller (see the Distiller-specific note further down, near
// parseDistillerProductHtml) - the first two only ever return one
// description blob; Distiller is the one that returns nose/palate/finish
// pre-split, since that's how its own spirit pages actually publish tasting
// notes (see buildFlavorHtml in card.js and the Nose/Palate/Finish fields in
// index.html for where those three end up).
//
// As with the Untappd beer importer above, this was written and unit
// tested against hand-built fixture HTML only - the environment this was
// built in blocks every outbound request to wine.com, vivino.com, and
// distiller.com before it arrives (see the note above RESILIENT_HEADER_SETS
// for the equivalent situation with Untappd), so none of the URL patterns
// or selectors below have been confirmed against the real sites. Confirmed
// in real-world use, though: wine.com and Vivino have both been seen
// actively blocking this app's requests (a 403) rather than just having an
// unconfirmed URL/markup guess, so a second (now third) source existing at
// all - not just its specific implementation - is meaningfully useful here,
// not merely "nice to have." Every step degrades to "found nothing" rather
// than throwing on a shape it doesn't recognize, and the caller falls back
// to the next provider (and ultimately to "enter it by hand") instead of
// surfacing a confusing error.
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
//
// That "half of the query's words" bar is sized off the query alone, which
// is fine for wine.com/Vivino/Distiller - a listed search-result title
// there is always at least as long as the query it's being matched
// against, so sizing off the query or the candidate comes to the same
// thing. Untappd (searchUntappd below) is the one caller where that stops
// being true: Algolia hands back a bare "<Brewery> <Beer Name>", with none
// of a store title's own style/descriptor words folded in. Confirmed
// against a real miss - a Scan UPC title of "Oakflower Augury Dry Irish
// Stout" (5 query words) scored only 2 against Untappd's own "Oakflower
// Brewing Company Augury": "Dry"/"Irish"/"Stout" have nowhere to match on
// a beer page that never repeats its own style in the name, and
// "Brewing"/"Company" have nowhere to match the other way - so a real,
// correct hit still fell 1 short of a threshold sized for a 5-word query,
// and the lookup failed until staff manually trimmed the title down to
// "Oakflower Augury". Sizing the bar off whichever of the query/candidate
// is *shorter* fixes that without loosening anything for a candidate at
// least as long as the query, where min() just returns the query length
// again - identical to the old behavior.
// The token-overlap scoring core behind pickBestMatch below, split out so
// searchUntappd's own tie-detection (matchUntappdCandidates further down -
// see its comment for why Untappd specifically needs to know about a tie,
// not just a winner) can reuse the exact same score/threshold math instead
// of a second copy that could quietly drift out of sync with this one.
// Sorted highest score first; Array.prototype.sort is a stable sort (has
// been since Node 11/V8 7.0), so two candidates that tie keep their
// original relative order from `candidates` - the same "first one in the
// list wins a tie" behavior pickBestMatch's own old, pre-refactor loop had.
function scoreCandidates(candidates, query) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  return candidates
    .map((candidate) => {
      const candidateTokens = new Set(tokenize(candidate.title));
      const score = queryTokens.reduce((n, t) => n + (candidateTokens.has(t) ? 1 : 0), 0);
      const threshold = Math.max(1, Math.ceil(Math.min(queryTokens.length, candidateTokens.size) / 2));
      return { candidate, score, passes: score >= threshold };
    })
    .sort((a, b) => b.score - a.score);
}

function pickBestMatch(candidates, query) {
  const passing = scoreCandidates(candidates, query).filter((s) => s.passes);
  return passing.length ? passing[0].candidate : undefined;
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
  // wine.com/Vivino's parseProductPage only ever returns `description`;
  // Distiller's (see parseDistillerProductHtml below) also returns nose/
  // palate/finish when its page has them pre-split. Whichever of the four
  // a given provider didn't set comes back undefined here and is normalized
  // to '' below, so findTastingNotes's callers (the "Find Tasting Notes"
  // dialog - see runTastingNotesSearch in app.js) can read all four off
  // every result the same way, regardless of which provider it came from.
  const { description, nose, palate, finish } = parseProductPage(productHtml, match.url);
  if (!description && !nose && !palate && !finish) {
    throw new Error(`Found "${match.title}" on ${siteName}, but it has no tasting notes to import.`);
  }

  return {
    description: description || '',
    nose: nose || '',
    palate: palate || '',
    finish: finish || '',
    sourceUrl: match.url,
    sourceName: siteName,
    matchedTitle: match.title,
  };
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
// Distiller.com - the third tasting-notes provider, and the only one of
// the three whose product pages already publish Nose/Palate/Finish
// pre-split rather than one description blob (spirits tasting notes are
// conventionally written that way - wine.com/Vivino above have no
// equivalent for wine). See the module comment above for the shared
// "unconfirmed against the real site" caveat; the one thing about
// Distiller that IS confirmed is the /spirits/<slug> product URL shape
// itself (seen in a search engine's indexed results for real bottles,
// e.g. distiller.com/spirits/buffalo-trace-bourbon - not a direct fetch,
// which this environment can't make), which is why it's used as
// parseDistillerSearchResults' href marker below, the same way
// parseWineComSearchResults/parseVivinoSearchResults use their own
// confirmed URL shapes.
//
// The search URL and the exact markup around a spirit's tasting notes are
// both genuine guesses, unlike that URL shape - extractFlavorNotes below
// is deliberately written against the page's plain rendered text instead
// of specific selectors, so a class/element rename that would break a
// CSS-selector scrape doesn't necessarily break this too. The tradeoff is
// noise: "Nose", "Palate", and "Finish" are ordinary English words that
// could turn up somewhere on the page unrelated to this bottle (nav
// chrome, a "you might also like" rail) - selectTastingNotesContainer
// narrows the scan to a likely tasting-notes container first to cut that
// risk down, and findTastingNotes's whole reason for being a review-
// before-you-accept dialog rather than a silent auto-fill (see
// runTastingNotesSearch in app.js) is the backstop for whatever noise
// still gets through.
// ================================================================

function distillerSearchUrl(query) {
  return `https://distiller.com/search?q=${encodeURIComponent(query)}`;
}

function parseDistillerSearchResults(html, baseUrl) {
  return parseGenericSearchResults(html, baseUrl, '/spirits/');
}

// A handful of phrases that show up right after a real tasting note ends
// on a typical product page (buy buttons, review prompts, cross-sell
// rails) - only used to trim the *last* label found (see extractFlavorNotes
// below), since that one has no following label of its own to stop at.
const FLAVOR_STOP_PATTERN = /\b(buy now|add to cart|shop now|write a review|related products?|you (?:may|might) also like|reviews?)\b/i;

// Prefers whichever element's own class/id hints at holding tasting notes
// ("tasting-notes", "flavor-profile", etc. - the common convention on
// review/spec sites) over scanning the whole page, for the noise reasons
// in the module comment above. Falls back to the full body when nothing
// hints at it, rather than finding nothing at all - a noisier match beats
// no match, given a human reviews this before it's used either way.
function selectTastingNotesContainer($) {
  let hinted;
  $('[class], [id]').each((_, el) => {
    if (hinted) return;
    const attrs = `${$(el).attr('class') || ''} ${$(el).attr('id') || ''}`.toLowerCase();
    if (/tasting|flavor|flavour/.test(attrs)) hinted = $(el);
  });
  return hinted && hinted.length ? hinted : $('body');
}

// cheerio's own .text() concatenates every element's text with nothing
// between them - fine for a single run of inline text, but
// "<h3>Nose</h3><p>Caramel corn...</p>" flattens to "NoseCaramel corn..."
// with no space at the tag boundary, which breaks the \b word-boundary
// extractFlavorNotes' labelPattern needs right after "Nose" below. Walking
// the tree by hand and padding a space around every element's own text
// avoids that, whether the notes are separate headings+paragraphs or one
// inline run - either way this comes out the same "words separated by
// whitespace" shape labelPattern expects.
function spacedText($, el) {
  let out = '';
  $(el).contents().each((_, node) => {
    if (node.type === 'text') out += node.data;
    else if (node.type === 'tag') out += ` ${spacedText($, node)} `;
  });
  return out;
}

// Finds "Nose"/"Palate"/"Finish" as whole words in the container's plain
// rendered text (not markup - see the module comment above for why), and
// takes whatever text runs from right after each label up to the next one
// - or, for whichever label comes last with nothing to bound it, up to the
// first stop phrase found or a fixed length cap. Works the same whether
// the three are separate headings+paragraphs or one inline run ("Nose:
// ... Palate: ... Finish: ..."), since neither shape matters to a scan
// over flattened text. A label with nothing usable after it (or not present
// at all) is simply left out of the returned object - each field is
// independent, same "found nothing rather than a wrong answer" rule as the
// rest of this file.
function extractFlavorNotes($) {
  const container = selectTastingNotesContainer($);
  const text = spacedText($, container.get(0)).replace(/\s+/g, ' ').trim();
  const labelPattern = /\b(nose|palate|finish)\b\s*:?\s*/gi;
  const matches = [...text.matchAll(labelPattern)];

  const notes = {};
  matches.forEach((m, i) => {
    const field = m[1].toLowerCase();
    if (notes[field]) return; // keep the first mention of each label
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : Math.min(text.length, start + 300);
    let value = text.slice(start, end).trim();
    const stopAt = value.search(FLAVOR_STOP_PATTERN);
    if (stopAt > 0) value = value.slice(0, stopAt).trim();
    value = value.replace(/[.,;:\-\s]+$/, '');
    if (value) notes[field] = value;
  });
  return notes;
}

// Same tiered fallback as parseGenericProductDescription (JSON-LD, then
// Open Graph/meta description) for `description`, plus the Nose/Palate/
// Finish extraction above - a Distiller page found via search but missing
// tasting notes (an unreviewed release, say) still comes back with
// whatever description it does have, rather than nothing at all.
function parseDistillerProductHtml(html, url) {
  const generic = parseGenericProductDescription(html, url);
  const $ = cheerio.load(html);
  const { nose, palate, finish } = extractFlavorNotes($);
  return { ...generic, nose: nose || '', palate: palate || '', finish: finish || '' };
}

function searchDistiller(title, vintage) {
  return searchProductCatalog({
    title,
    vintage,
    siteName: 'Distiller',
    searchUrlFor: distillerSearchUrl,
    parseSearchResults: parseDistillerSearchResults,
    parseProductPage: parseDistillerProductHtml,
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
  // Same "Not Specified" placeholder handling as Pack Size/Year below - the
  // store's own Brand link (or its og:brand fallback) reads that literal
  // text, rather than being blank, for a product with no manufacturer on
  // file. Dropped from each source individually, before firstNonEmpty picks
  // between them, so a real og:brand still wins if only the h6 link reads
  // the placeholder. Unlike the title (see stripSize's NOT_SPECIFIED_PATTERN),
  // nothing downstream ever strips it back out of the brand itself -
  // composeProducerTitle only skips prepending the brand when the title
  // already starts with it - so left unguarded here it would get prepended
  // straight onto the title ("Not Specified Hazy IPA") and sent to Untappd
  // as part of the search query too.
  const brand = firstNonEmpty(
    dropNotSpecified($('h6 a').first().text()),
    dropNotSpecified($('meta[property="og:brand"]').attr('content'))
  );
  const sku = firstNonEmpty(
    $('meta[property="og:upc"]').attr('content'),
    storeSpecValue($, 'SKU')
  );
  const size = firstNonEmpty(storeSpecValue($, 'Size'), guessSize(title));
  // Beer's own spec row, separate from Size (e.g. Size "16oz", Pack Size
  // "4-Pack") - see combineBeerSize below, which folds the two together
  // into one Size/Unit value ("16oz 4-Pack") for beer only. Same "Not
  // Specified" placeholder handling as Year right below: a single-item
  // product's Pack Size row reads that literal text rather than being
  // blank, so only accept it when it isn't that placeholder.
  const packSize = dropNotSpecified(storeSpecValue($, 'Pack Size'));
  // The store's own Year row reads "Not Specified" (not a blank row) for a
  // non-vintage product, since storeSpecValue just captures whatever text
  // follows the label - only accept it here when it actually looks like a
  // 4-digit year, so that placeholder text doesn't end up in the Vintage
  // field verbatim; guessVintage still gets a shot at the title either way.
  const yearRaw = dropNotSpecified(storeSpecValue($, 'Year'));
  const vintage = firstNonEmpty(/^(?:19|20)\d{2}$/.test((yearRaw || '').trim()) ? yearRaw : undefined, guessVintage(title));
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
    // Kept separate from `size` here rather than combined already - only
    // combineBeerSize (beer-only, see enrichBeerFromUntappd) folds it in,
    // so a wine/spirits lookup's Size/Unit field is completely unaffected
    // by this even if that page happened to have its own Pack Size row.
    packSize: packSize || '',
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
// Scan UPC store enrichment - the Scan UPC tab (see upcCatalog.js) looks a
// scanned bottle up entirely offline, in a WinePOS export file, so whatever
// that file happens to have in its own columns is what staff got before this
// existed - a Description/Tasting Notes column that's often blank or a short
// internal note (not the shopper-facing tasting notes on the store's own
// product page), and title/size/price only as fresh (and as well-formatted)
// as the last time that export was written. Both functions below pull the
// fresher version from liquoroutletwinecellars.com - the same product page
// the SKU Lookup tab already reads from (see lookupSku/lookupStoreSku
// above) - matched by the store SKU the WinePOS export carries for the item
// (FIELD_ALIASES.sku), a different number from the manufacturer UPC that
// was actually scanned.
//
// Both are best-effort, same shape as enrichBeerFromUntappd below: a row
// with no SKU column filled in, a SKU the store site doesn't recognize, or a
// blocked/failed request just leaves the export's own value in place
// (however blank) rather than failing a scan that already succeeded once,
// against the local file, over data that was never guaranteed - the
// `...SourceError` field each one sets carries the reason so the Scan UPC
// tab can tell staff a store lookup was attempted and didn't pan out,
// instead of leaving them to guess why nothing changed.
async function enrichWineDescriptionFromStore(product) {
  const sku = (product.sku || '').trim();
  if (!sku) return product;
  try {
    const storeProduct = await lookupStoreSku(sku);
    return { ...product, description: firstNonEmpty(storeProduct.description, product.description) || '' };
  } catch (err) {
    return { ...product, descriptionSourceError: err.message || 'Could not fetch a description from liquoroutletwinecellars.com.' };
  }
}

// ================================================================
// Untappd search-by-name - the SKU lookup's beer-specific second step. The
// store site above has no idea what Untappd calls a beer, so this takes
// whatever title the SKU lookup just filled in and searches Untappd for
// it, then lands on the same parseBeerHtml this file already uses for a
// pasted Untappd URL.
//
// Confirmed directly (a user's own DevTools, view-source and Network tab,
// not a guess) that Untappd's search page can't be scraped for this at
// all: its results are rendered by a client-side Algolia InstantSearch
// widget, so the raw HTML this app fetches has an empty results container
// no matter the query - the widget calls Algolia's own search API directly
// from the browser afterward, and that's what actually has the data. So
// this calls that same Algolia endpoint directly instead of Untappd's
// search page. The credentials below (an application ID and a
// "search-only" API key, plus the "beer" index name) are public: they're
// embedded in every page load and sent from any visitor's browser in
// plain sight of DevTools, the same way any Algolia InstantSearch
// integration works - not a secret this app is extracting, just reusing
// the same unauthenticated call Untappd's own front end already makes.
// Untappd/Algolia could still rotate or restrict this key without notice,
// though - if a search request ever starts failing because of that, it
// surfaces as the same "Could not find ... on Untappd" / network-error
// messages this function always threw on a real miss, and staff fall back
// to the SKU Lookup tab's manual "paste the beer's Untappd URL/HTML"
// section, same as they do for a genuine no-match today.
const UNTAPPD_ALGOLIA_APP_ID = '9WBO4RQ3HO';
const UNTAPPD_ALGOLIA_API_KEY = '61401542b9f2600ef4ae589e9ec97521';
const UNTAPPD_ALGOLIA_INDEX = 'beer';

// Only asks Algolia for enough to find the right beer and its page URL -
// the actual brewery/style/ABV/IBU/rating/location fields still come from
// fetching and parsing that beer's own Untappd page afterward (below),
// exactly like the manual URL fallback does, so this doesn't have to
// duplicate parseBeerHtml's field-mapping or guess at how Algolia's own
// field names/units line up with the on-page ones.
async function algoliaSearchBeerCandidates(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(
      `https://${UNTAPPD_ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/*/queries`
        + `?x-algolia-api-key=${UNTAPPD_ALGOLIA_API_KEY}&x-algolia-application-id=${UNTAPPD_ALGOLIA_APP_ID}`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          // A first attempt without these got a live 403 from Algolia
          // itself (confirmed by a user against the real endpoint, not
          // guessed) - the search-only key above is near-certainly locked
          // to Untappd's own site via Algolia's HTTP-referrer restriction
          // feature, which the real widget satisfies automatically (every
          // browser request carries its page's own Referer/Origin) but a
          // server-side fetch never sends unless told to. Reproducing
          // those two headers is what actually satisfies that restriction.
          Referer: 'https://untappd.com/',
          Origin: 'https://untappd.com',
        },
        body: JSON.stringify({
          requests: [{
            indexName: UNTAPPD_ALGOLIA_INDEX,
            params: `query=${encodeURIComponent(query)}&hitsPerPage=10&page=0`,
          }],
        }),
      }
    );
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const err = new Error(`Untappd's search isn't responding right now (${resp.status}).`);
    err.httpStatus = resp.status;
    throw err;
  }
  const data = await resp.json();
  const hits = (data && data.results && data.results[0] && data.results[0].hits) || [];
  // beer_slug + bid reconstruct the same /b/<slug>/<id> URL a beer's own
  // page lives at (confirmed against a real hit: beer_slug
  // "autodidact-beer-daylily" + bid 5251415 -> the exact URL a user
  // independently found by searching Untappd by hand). title folds the
  // brewery in, matching what composeProducerTitle already sends as the
  // query, for pickBestMatch below to score against. brewery/beerName keep
  // those same two confirmed fields un-folded too, alongside title - not
  // used for scoring, only so a disambiguation picker (see
  // matchUntappdCandidates/UntappdAmbiguousMatchError below) has something
  // cleaner to show staff than the combined string.
  return hits.map((hit) => ({
    url: `https://untappd.com/b/${hit.beer_slug}/${hit.bid}`,
    title: `${hit.brewery_name || ''} ${hit.beer_name || ''}`.trim(),
    brewery: (hit.brewery_name || '').trim(),
    beerName: (hit.beer_name || '').trim(),
  }));
}

// Thrown by searchUntappd below instead of a plain Error when two or more
// candidates are genuinely tied for the best score (see
// matchUntappdCandidates) - a distinct type so enrichBeerFromUntappd's own
// catch block can tell "ask staff which one" apart from an ordinary miss
// or network failure, which is treated completely differently (see its own
// comment). `candidates` is the tied set, in Algolia's own ranked order.
class UntappdAmbiguousMatchError extends Error {
  constructor(query, candidates) {
    super(`Found ${candidates.length} equally-likely matches for "${query}" on Untappd.`);
    this.name = 'UntappdAmbiguousMatchError';
    this.candidates = candidates;
  }
}

// pickBestMatch (used by every catalog-site provider - wine.com, Vivino,
// Distiller, and Untappd itself) always silently breaks a tie by taking
// whichever candidate came first from the site's own search results. That
// is a perfectly fine default for those other three, whose candidate
// titles are already the site's own full, disambiguated product title -
// two of them scoring identically is rare and, when it happens, is usually
// a near-duplicate listing rather than two genuinely different products.
//
// Untappd is different in a way that makes silent tie-breaking actively
// risky rather than just imprecise: BEER_STYLE_WORD_PATTERN above
// deliberately leaves words like "Light"/"Dark"/"Gold"/"Amber" out of the
// query-cleaning step specifically because, for a macro brand, that word
// is sometimes the ONLY thing separating two real, separately-listed
// Untappd beers from the same brewery ("Coors Light" vs. "Coors Banquet").
// If a query ever *did* end up missing that differentiator (a store title
// that just says "Coors" with no qualifier, say), both would score
// identically and a silent first-wins pick has a real chance of being the
// wrong beer - exactly the "confident-looking wrong answer" pickBestMatch's
// own comment says is worse than finding nothing. Surfacing the tie to
// enrichBeerFromUntappd (as UntappdAmbiguousMatchError above) instead of
// resolving it here is what lets a human make that one call instead of the
// scoring math guessing.
function matchUntappdCandidates(candidates, query) {
  const scored = scoreCandidates(candidates, query).filter((s) => s.passes);
  if (scored.length === 0) return { match: undefined, tied: [] };
  const topScore = scored[0].score;
  const tied = scored.filter((s) => s.score === topScore).map((s) => s.candidate);
  return tied.length > 1 ? { match: undefined, tied } : { match: scored[0].candidate, tied: [] };
}

async function searchUntappd(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) throw new Error('Enter a product title first.');

  const candidates = await algoliaSearchBeerCandidates(trimmed);
  const { match, tied } = matchUntappdCandidates(candidates, trimmed);
  if (tied.length > 1) {
    throw new UntappdAmbiguousMatchError(trimmed, tied);
  }
  if (!match) {
    throw new Error(`Could not find "${trimmed}" on Untappd.`);
  }

  const beerHtml = await fetchCatalogHtml(match.url, 'Untappd');
  return fillBeerLocation(parseBeerHtml(beerHtml, match.url), beerHtml, match.url);
}

// Pack count alternation covers both the spelled-out form ("4-pack",
// "4 pack") and the abbreviation a real product title sometimes uses
// instead ("4pk", "4-pk", "4 pk.") - both confirmed leaking into a scraped
// title verbatim (see stripSize below).
const SIZE_PATTERN = /\b\d+(?:\.\d+)?\s?(?:ml|mL|l|L|oz|OZ)\b|\b\d+\s?-?\s?(?:pack|pk\.?)\b/gi;

// The store's own spec-table placeholder for an unset field ("Not
// Specified" - see the Year/Pack Size handling in parseStoreProductHtml
// above) sometimes ends up baked into the product's own title/h1 text on
// the page, not just the spec row it belongs to - stripped here the same
// way a container size is, so it never lands in the Beer Name/Product
// Title field a shopper would see.
const NOT_SPECIFIED_PATTERN = /\bnot specified\b/gi;

// Strips a container size (and the junk above) out of a scraped title -
// e.g. "Daylily 16OZ" becomes "Daylily", since size already has its own
// form field and staff don't want it duplicated in the product title. Also
// used to clean up the title before it's sent to Untappd as a search query
// below - the store's own title sometimes trails off with the container
// size (see the real SKU-lookup fixture that inspired this), which is dead
// weight a beer search doesn't have and can hurt the match.
function stripSize(title, size) {
  let name = title || '';
  if (size) name = name.split(size).join(' ');
  return name
    .replace(SIZE_PATTERN, ' ')
    .replace(NOT_SPECIFIED_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A WinePOS beer title routinely trails off with the beer's own style
// ("Augury Dry Irish Stout") the same way it sometimes trails off with a
// container size (see SIZE_PATTERN/stripSize above) - dead weight for an
// Untappd search, since Untappd's own beer name is just "<Brewery> <Beer
// Name>" and never repeats its own style there (confirmed against a real
// miss - see pickBestMatch's own comment for the full story of how that
// dead weight used to sink an otherwise-correct match's score). Stripped
// from the search QUERY only (see buildUntappdSearchQuery below) - never
// from composeProducerTitle's own return value, which is what actually
// fills the Product Title field a shopper sees, and where staff expect the
// style to stay.
//
// Deliberately narrow: only well-established style *category* words (IPA,
// Stout, Porter, ...) and modifiers that are essentially never a brand's
// own differentiator (Hazy, Double, Session, Dry, Irish, ...). Left out on
// purpose: Light/Lite, Dark, Gold/Golden, Amber, Red, Blonde, Draft/
// Draught - for a macro brand these are routinely the ONLY thing telling
// two real, separately-listed Untappd beers apart ("Coors Light" vs. plain
// "Coors Banquet", "Michelob Golden Draft" vs. "Michelob AmberBock").
// Stripping one of those risks a confident-looking WRONG match instead of
// no match at all - exactly what pickBestMatch's own "found nothing beats
// a wrong answer" rule exists to prevent. A style-category word carries no
// equivalent risk: Untappd doesn't use "Stout"/"IPA"/... to tell two beers
// from the same brewery apart the way it uses "Light", so removing one
// never costs real matching signal - not exhaustive (new styles keep
// showing up), just a safe, common core; a miss still falls back to the
// untappdError staff already review before queuing a talker.
const BEER_STYLE_WORD_PATTERN = new RegExp(
  '\\b(' + [
    'ipa', 'dipa', 'neipa', 'ale', 'lager', 'stout', 'porter', 'pilsner', 'pils',
    'saison', 'gose', 'k[oö]lsch', 'witbier', 'hefeweizen', 'weissbier', 'weizen',
    'dunkel', 'm[aä]rzen', 'helles', 'barleywine', 'lambic', 'bock', 'doppelbock',
    'schwarzbier', 'rauchbier', 'kellerbier', 'tripel', 'dubbel', 'quad', 'quadrupel',
    'esb', 'sour', 'farmhouse', 'wheat', 'hazy', 'double', 'imperial', 'triple',
    'session', 'dry', 'irish', 'belgian', 'german',
  ].join('|') + ')\\b',
  'gi'
);

// Cleans a beer title down to just what's worth sending Untappd as a
// search query (see BEER_STYLE_WORD_PATTERN above). Guards against
// stripping a title down to nothing - a rare SKU literally titled just
// "IPA" would otherwise search Untappd with an empty string instead of the
// original, still-noisy-but-non-empty query.
function buildUntappdSearchQuery(title) {
  const stripped = (title || '').replace(BEER_STYLE_WORD_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return stripped || (title || '').trim();
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

// Folds the store page's separate Size ("16oz") and Pack Size ("4-Pack")
// spec rows into one Size/Unit value ("16oz 4-Pack") - beer-only (see
// enrichBeerFromUntappd below), matching how staff already write a
// multi-pack's size by hand elsewhere in the app. Applied after
// composeProducerTitle already ran on the un-combined `size` above, not
// before - stripSize there only needs to match what's actually still
// sitting in the scraped title (just the container size, confirmed from a
// real product page), not a phrase that includes the pack count too.
function combineBeerSize(size, packSize) {
  const base = (size || '').trim();
  const pack = (packSize || '').trim();
  if (!pack) return base;
  return base ? `${base} ${pack}` : pack;
}

// Layers Untappd's own description/brewery/style/ABV/IBU/rating on top of
// what the store page already gave lookupSku/lookupSkuFromHtml below - the
// store's generic manufacturer blurb (see parseStoreProductHtml) is kept as
// a fallback description only if Untappd search comes back empty, matching
// what was actually asked for ("descriptions pulled from other sources,
// such as untappd"). The displayed title is composeProducerTitle's
// "Producer Product Name" (same helper the wine/spirits title uses, and
// pulled from the store page only - never Untappd); the Untappd search
// query is that same title with its style words stripped (see
// buildUntappdSearchQuery above) - a bare one- or two-word beer name like
// "Daylily" is too weak a query on its own (confirmed against a real SKU
// lookup: searching just "Daylily" came back "Could not find... on
// Untappd", where the beer's own page is really titled "Daylily by
// Autodidact Beer"), so the brand still gets prepended same as before -
// only the style tail is gone.
// Best-effort only, same as
// extractBeer's own bonus brewery-location fetch above: the store lookup
// already succeeded by this point, so a beer Untappd can't find (or that
// blocks this request) just leaves those fields blank/store-sourced for
// manual entry rather than failing the whole SKU lookup - but the reason
// still comes back as untappdError so the SKU Lookup tab can tell staff "we
// tried and Untappd had nothing" instead of leaving them to guess why the
// fields are empty.
// Layers a parsed Untappd beer page's fields on top of whatever's already
// on file (the store's own scrape, or a prior fill), keeping the existing
// value wherever Untappd's own page didn't have one - shared by the
// automatic search step below and by the manual "paste the beer's Untappd
// URL/HTML" fallback in untappdBeerFromUrl/untappdBeerFromHtml, since both
// end up with a parsed beer object that needs merging the same way.
function mergeUntappdBeer(current, beer) {
  return {
    description: firstNonEmpty(beer.description, current.description) || '',
    brewery: beer.brewery || current.brewery || '',
    location: beer.location || current.location || '',
    style: beer.style || current.style || '',
    abv: beer.abv || current.abv || '',
    ibu: beer.ibu || current.ibu || '',
    untappdRating: beer.untappdRating || current.untappdRating || '',
    untappdRatingCount: beer.untappdRatingCount || current.untappdRatingCount || '',
  };
}

async function enrichBeerFromUntappd(product) {
  const title = composeProducerTitle(product);
  const size = combineBeerSize(product.size, product.packSize);
  // The displayed Product Title keeps its style suffix (`title` above,
  // unchanged) - only the string actually sent to Untappd has it stripped
  // (see buildUntappdSearchQuery's own comment for why).
  const searchQuery = buildUntappdSearchQuery(title);
  try {
    const beer = await searchUntappd(searchQuery);
    // mergeUntappdBeer's own description fallback (see its comment) is meant
    // for the manual "paste the Untappd URL/HTML" path further down, where
    // `current` is whatever staff already have in the form and is never
    // supposed to be cleared. Here `current` is the store's own generic
    // manufacturer blurb - once Untappd is found, its own (possibly blank)
    // description is what staff want to see, not that blurb, so this
    // overrides mergeUntappdBeer's fallback rather than reusing it.
    return { ...product, title, size, ...mergeUntappdBeer(product, beer), description: beer.description || '' };
  } catch (err) {
    // A genuine tie (see UntappdAmbiguousMatchError/matchUntappdCandidates
    // above) is not the same kind of failure as a miss or a blocked
    // request - there's a right answer, this code just can't safely pick
    // it alone. `untappdCandidates` carries the tied set (each already
    // shaped {url, title, brewery, beerName} - see algoliaSearchBeerCandidates)
    // for a client-side picker (see the Scan UPC/SKU Lookup/Search by Name
    // tabs in app.js) to resolve the same way the existing manual "paste an
    // Untappd URL" fallback already does: fetch that one beer's own page
    // via /api/untappd-lookup and merge it in. Deliberately no
    // `untappdError` alongside this - the two are meant to be mutually
    // exclusive so a caller can check one field to know which situation
    // it's looking at.
    if (err instanceof UntappdAmbiguousMatchError) {
      return { ...product, title, size, brewery: product.brand || '', untappdCandidates: err.candidates };
    }
    return { ...product, title, size, brewery: product.brand || '', untappdError: err.message || 'Untappd search failed.' };
  }
}

// The Scan UPC tab's full beer pipeline - matches lookupSku's own beer path
// (below) exactly once a store SKU is available: the whole product page
// (title, brand, size, pack size, price, description) from
// liquoroutletwinecellars.com, then Untappd off of *that*, not the raw
// WinePOS export's own Title/Brand columns.
//
// That's a deliberate change from an earlier, more surgical version of this
// that only pulled price and left title/size alone - confirmed against a
// real miss: a WinePOS export's title/brand are often abbreviated/all-caps
// store shorthand ("MSB MANSKIRT THE GREAT PORTER CAN"), which
// composeProducerTitle can only do so much with and makes for a much
// weaker Untappd search query than the store's own cleaned-up product page
// title - the exact same query SKU Lookup already builds from that same
// store page for a typed-in SKU. Using the store's fuller data here, not
// just its price, is what actually closes that gap.
//
// Still best-effort: no store SKU to look up, or a lookup that fails
// outright (no match, blocked), falls back to running Untappd off of
// whatever the local export had instead of failing the whole scan -
// `storeSourceError` carries why, same shape enrichWineDescriptionFromStore
// uses for `descriptionSourceError`. Description gets its own three-way
// fallback (Untappd's own > the store page's > the export's) rather than
// flatly taking the store's: a store product page with no description of
// its own (common - not every page has one) would otherwise blank out a
// genuinely useful local note the export did have, the one field here that
// isn't strictly "fresher from the store" the way title/size/price are.
async function enrichBeerScanFromStore(product) {
  const sku = (product.sku || '').trim();
  if (!sku) return enrichBeerFromUntappd(product);
  try {
    const storeProduct = await lookupStoreSku(sku);
    return enrichBeerFromUntappd({
      ...storeProduct,
      sku,
      description: firstNonEmpty(storeProduct.description, product.description) || '',
    });
  } catch (err) {
    return enrichBeerFromUntappd({
      ...product,
      storeSourceError: err.message || 'Could not fetch product details from liquoroutletwinecellars.com.',
    });
  }
}

// Manual fallback for when enrichBeerFromUntappd's own search comes back
// empty - confirmed (via a real SKU lookup, see composeProducerTitle above)
// to be because Untappd's search-results page renders its results with a
// client-side JS widget (Algolia InstantSearch): the raw HTML this app
// fetches never contains them, no matter how the query is worded, so no
// amount of query-tuning here can fix it. The beer's own page is a normal
// server-rendered page, though (it has to be, for link-preview unfurling to
// work at all) - so staff search Untappd themselves in a real browser,
// where the JS-rendered results work fine, and hand this either the
// beer page's URL (fetched directly) or, if even that gets blocked, its
// pasted HTML.
async function untappdBeerFromUrl(current, untappdUrl) {
  const trimmed = String(untappdUrl || '').trim();
  if (!trimmed) throw new Error("Enter the beer's Untappd URL first.");
  const html = await fetchCatalogHtml(trimmed, 'Untappd');
  const beer = await fillBeerLocation(parseBeerHtml(html, trimmed), html, trimmed);
  return mergeUntappdBeer(current || {}, beer);
}

async function untappdBeerFromHtml(current, { html, url }) {
  if (!html || !html.trim()) throw new Error("Paste the beer's Untappd page HTML first.");
  const sourceUrl = typeof url === 'string' ? url.trim() : '';
  const beer = await fillBeerLocation(parseBeerHtml(html, sourceUrl), html, sourceUrl);
  return mergeUntappdBeer(current || {}, beer);
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
// source later is just one more entry here. `experimental: true` marks a
// provider as gated behind the "Experimental Features -> Bourbon Shelf
// Talkers" toggle in Settings (see the client's own note in app.js) -
// Distiller is the one so far, since (unlike Wine.com/Vivino, which are at
// least confirmed to exist and confirmed-blocked) its scraper has never
// been confirmed against the live site at all. findTastingNotes below
// skips every experimental provider unless the caller explicitly opts in.
const TASTING_NOTE_PROVIDERS = [
  { name: 'Wine.com', search: searchWineCom },
  { name: 'Vivino', search: searchVivino },
  { name: 'Distiller', search: searchDistiller, experimental: true },
];

// Names only, for the "Find Tasting Notes" dialog's Source dropdown (see
// app.js) - lets the client build that list without duplicating it, and
// without exposing the provider objects' search functions.
const TASTING_NOTE_PROVIDER_NAMES = TASTING_NOTE_PROVIDERS.map((p) => p.name);

// Subset of the above that's experimental (see the note on
// TASTING_NOTE_PROVIDERS) - the client uses this to grey/filter those
// specific options out of the Source dropdown while the toggle is off,
// rather than hardcoding "Distiller" by name on the client side too.
const TASTING_NOTE_EXPERIMENTAL_PROVIDER_NAMES = TASTING_NOTE_PROVIDERS
  .filter((p) => p.experimental)
  .map((p) => p.name);

// `source` picks one named provider to search instead of the full ordered
// list - what the "Find Tasting Notes" dialog sends once staff choose a
// specific site from the dropdown, rather than the default "Any source"
// (which still tries them in order, same as before that dialog existed).
// `allowExperimental` is the server-side half of the Bourbon Shelf Talkers
// toggle (see app.js) - the client already keeps Distiller out of the
// dropdown and out of its own "Any source" expectations while the toggle
// is off, but this is what actually stops a request from reaching it: the
// client is what a browser's dev tools can edit, this function is not.
async function findTastingNotes({ title, vintage, source, allowExperimental }) {
  if (!title || !title.trim()) {
    throw new Error('Enter a product title first.');
  }

  let providers;
  if (source) {
    const named = TASTING_NOTE_PROVIDERS.find((p) => p.name === source);
    if (!named) throw new Error(`Unknown tasting notes source: "${source}".`);
    if (named.experimental && !allowExperimental) {
      throw new Error(
        `${source} is an experimental source - turn on Experimental Features `
        + '-> Bourbon Shelf Talkers in Settings first.'
      );
    }
    providers = [named];
  } else {
    providers = allowExperimental
      ? TASTING_NOTE_PROVIDERS
      : TASTING_NOTE_PROVIDERS.filter((p) => !p.experimental);
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
  TASTING_NOTE_EXPERIMENTAL_PROVIDER_NAMES,
  buildTastingNotesQuery,
  pickBestMatch,
  parseWineComSearchResults,
  parseWineComProductHtml,
  wineComSearchUrl,
  parseVivinoSearchResults,
  parseVivinoProductHtml,
  vivinoSearchUrl,
  distillerSearchUrl,
  parseDistillerSearchResults,
  parseDistillerProductHtml,
  extractFlavorNotes,
  selectTastingNotesContainer,
  storeSearchUrl,
  parseStoreSearchResults,
  pickSkuMatch,
  parseStoreProductHtml,
  lookupStoreSku,
  parsePastedStoreProduct,
  enrichWineDescriptionFromStore,
  algoliaSearchBeerCandidates,
  searchUntappd,
  matchUntappdCandidates,
  UntappdAmbiguousMatchError,
  composeProducerTitle,
  buildUntappdSearchQuery,
  enrichBeerFromUntappd,
  enrichBeerScanFromStore,
  untappdBeerFromUrl,
  untappdBeerFromHtml,
  lookupSku,
  lookupSkuFromHtml,
};
