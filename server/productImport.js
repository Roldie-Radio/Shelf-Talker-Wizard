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

async function fetchHtml(url) {
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
      throw new Error(`The page responded with ${resp.status} ${resp.statusText}.`);
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

module.exports = { extractProduct };
