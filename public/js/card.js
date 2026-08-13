// Builds shelf-talker card DOM elements. Both the title and the description
// render at their set point size by default (the type's own default, or
// whatever the Title/Description Font Size box overrides it to - see
// fontSizeOverrideAttr below) and simply show fewer lines, ending in an
// ellipsis, if there isn't room for all of it (see
// clampTitleToAvailableSpace/clampDescriptionToAvailableSpace). Checking
// the Auto Size box next to either font size field switches that field back
// to the old shrink-to-fit (title) or shrink-to-fit/grow-to-fill
// (description) behaviour instead (see shrinkDescriptionToFitBody/
// growDescriptionToFillSlack, and the title's own shrink loop in
// fitCardText) - opt-in, per talker and per field, for whoever would rather
// have the text resize than be truncated.

// layout.js's script tag runs before this one (see index.html), so
// window.ShelfTalkerLayout is already populated by the time this file's
// top-level code runs.
const { SIGN_LAYOUTS } = window.ShelfTalkerLayout;

// Turns a user-typed point size (Title/Description Font Size on the form)
// into the same var(--w)-relative fraction every built-in font-size in
// styles.css already uses (see e.g. .card__title's 0.0595) - ratio = pt /
// 72 / referenceWidthIn, then font-size: var(--w) * ratio. That keeps a
// typed size scaling exactly like the defaults it's overriding: same
// absolute point size on a Half Size talker as Full (same --w), half the
// points on Quarter (half --w), unchanged between on-screen preview and
// print (both set --w to the item's real physical width - see
// printWidthCss in layout.js).
//
// referenceWidthIn is what the typed number is measured against - the
// Full Shelf Talker's 2.8in for every Talker size, since Full/Half/Quarter
// already share one ratio today (this just keeps that true for custom
// sizes too), or that specific Display Sign size's own width, since Large
// and Small are separate templates rather than proportional shrinks of
// each other. includePriceFit matches whether the rule being overridden
// multiplies by --price-fit today: .sign__title never does (always has
// been fixed, unrelated to Auto Size); .card__title/.card__description/
// .sign__description only do when this particular talker has that field's
// Auto Size checked - see the titleStyle/descriptionStyle call sites below
// - since an unchecked field is never auto-scaled at all (see
// clampTitleToAvailableSpace/clampDescriptionToAvailableSpace below).
function fontSizeOverrideAttr(pt, referenceWidthIn, includePriceFit) {
  const value = parseFloat(pt);
  if (!Number.isFinite(value) || value <= 0) return '';
  const ratio = value / 72 / referenceWidthIn;
  const priceFit = includePriceFit ? ' * var(--price-fit, 1)' : '';
  return ` style="font-size: calc(var(--w) * ${ratio}${priceFit})"`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatMoney(value) {
  // An empty field is "no price yet", not zero - Number('') is 0, which made
  // the live preview of a blank form advertise "Regular Price $0.00".
  if (value === null || value === undefined || String(value).trim() === '') return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return `$${num.toFixed(2)}`;
}

// style is the Ratings Font Size box's override (see fontSizeOverrideAttr
// above and fRatingsFontSize in app.js) - '' renders at .card__ratings'
// own default size, same convention as the Closeout/Super Sale callouts.
function buildRatingsHtml(talker, style = '') {
  if (!Array.isArray(talker.ratings) || !talker.ratings.length) return '';
  const lines = talker.ratings
    .filter((r) => r && (r.reviewer || r.score))
    .map((r) => `${escapeHtml(r.score || '')} Pts ${escapeHtml(r.reviewer || '')}`.trim());
  if (!lines.length) return '';
  return `<div class="card__ratings"${style}>${lines.join('<br>')}</div>`;
}

// Free-text line(s) under the numeric Ratings list, for medals/honors that
// don't fit the reviewer+score format ("Gold Medal - SF Chronicle Wine
// Competition"). Printed in .card__ratings' exact font (see the shared
// font-size/weight in styles.css), just in a user-chosen color instead of
// a fixed ink color - validated here since it lands in a style attribute.
function buildAwardsHtml(talker) {
  const text = talker.awards ? String(talker.awards).trim() : '';
  if (!text) return '';
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return '';
  const color = /^#[0-9a-fA-F]{6}$/.test(talker.awardsColor || '') ? talker.awardsColor : '#171717';
  return `<div class="card__awards" style="color: ${color}">${lines.map(escapeHtml).join('<br>')}</div>`;
}

// Mash Bill grain -> proportion-bar segment color. Fixed palette, not
// user-configurable (unlike the beer style colors below, this is a small,
// well-known set of grains rather than open-ended free text) - matched
// against the exact value the Mash Bill builder's <select> sends (see
// #fMashBillGrain in index.html), case-sensitive, since that's a closed
// list too. An unrecognized value (a saved talker from before a grain was
// added/renamed, say) falls back to a neutral grey rather than guessing.
const MASH_BILL_GRAIN_COLORS = {
  Corn: '#d9a441',
  Rye: '#8a3a2c',
  Wheat: '#c9b464',
  'Malted Barley': '#a67c3d',
  'Malted Rye': '#6e2a1f',
  Oat: '#ddd0ad',
};
const MASH_BILL_GRAIN_FALLBACK_COLOR = '#b8ab98';

// Mash Bill - a stacked proportion bar (see .card__mashbill-bar in
// styles.css), the closest analog on a spirits talker to a wine's varietal:
// a shopper can read "mostly corn, sweeter" vs. "high rye, spicier" from the
// relative widths alone, the legend underneath carrying the exact
// percentages for anyone who stops to read. talker.mashBill is
// [{grain, pct}, ...] (see currentMashBill/addMashBillGrain in app.js) -
// entries with no grain or a non-positive/non-numeric percent are dropped
// rather than rendered as a zero-width sliver.
function buildMashBillHtml(talker) {
  const entries = (Array.isArray(talker.mashBill) ? talker.mashBill : [])
    .map((entry) => ({ grain: (entry && entry.grain ? String(entry.grain).trim() : ''), pct: Number(entry && entry.pct) }))
    .filter((entry) => entry.grain && Number.isFinite(entry.pct) && entry.pct > 0);
  if (!entries.length) return '';

  const barHtml = entries.map(({ grain, pct }) => {
    const color = MASH_BILL_GRAIN_COLORS[grain] || MASH_BILL_GRAIN_FALLBACK_COLOR;
    return `<div class="card__mashbill-seg" style="width: ${pct}%; background: ${color};"></div>`;
  }).join('');
  const legendHtml = entries.map(({ grain, pct }) => {
    const color = MASH_BILL_GRAIN_COLORS[grain] || MASH_BILL_GRAIN_FALLBACK_COLOR;
    return `
      <span>
        <span class="card__mashbill-swatch" style="background: ${color};"></span>
        ${pct}% ${escapeHtml(grain)}
      </span>
    `;
  }).join('');

  return `
    <div class="card__mashbill">
      <div class="card__mashbill-label">Mash Bill</div>
      <div class="card__mashbill-bar">${barHtml}</div>
      <div class="card__mashbill-legend">${legendHtml}</div>
    </div>
  `;
}

// Store Pick corner ribbon - a provenance claim ("we hand-picked this
// barrel"), not a pricing state, so it's a plain boolean (talker.isStorePick,
// see #fStorePick in index.html) independent of Talker Style rather than a
// fourth option alongside Closeout/Chilled/Super Sale - see
// .card__pick-ribbon in styles.css for why that separation matters (it can
// appear alongside a Closeout badge).
function buildStorePickRibbonHtml(talker) {
  if (!talker.isStorePick) return '';
  return '<div class="card__pick-ribbon">Store Pick</div>';
}

// Nose/Palate/Finish - spirits tasting notes, filled by hand or via "Find
// Tasting Notes" (Distiller.com is the source that actually returns these
// three pre-split; see findTastingNotes in productImport.js). Sits directly
// under the description, above Ratings - a row is skipped entirely rather
// than printed with an empty value, so a talker with only Nose filled in
// (say) shows one row, not three with two blank.
const FLAVOR_ROWS = [
  ['Nose', 'nose'],
  ['Palate', 'palate'],
  ['Finish', 'finish'],
];
function buildFlavorHtml(talker) {
  const rows = FLAVOR_ROWS
    .map(([label, field]) => [label, talker[field] ? String(talker[field]).trim() : ''])
    .filter(([, value]) => value);
  if (!rows.length) return '';
  const rowsHtml = rows.map(([label, value]) => `
    <div class="card__flavor-row">
      <div class="card__flavor-label">${escapeHtml(label)}</div>
      <div class="card__flavor-value">${escapeHtml(value)}</div>
    </div>
  `).join('');
  return `<div class="card__flavor">${rowsHtml}</div>`;
}

// Wine/Spirits varietal -> candidate food pairings, for the Food Pairing
// Suggestions field (Settings -> Experimental Features -> Wine Food
// Pairings). Matched by keyword against the Product Title (falling back to
// Description) - same shape and ordering convention as BEER_STYLE_COLORS
// right below (checked top to bottom, first/most-specific match wins), just
// food pairings instead of a color swatch as the payload. detectWinePairings
// is called from both here (rendering) and app.js's Suggest Pairings button
// (a plain global, like beerStyleColor/buildFlavorHtml - card.js's script
// tag loads before app.js's, see index.html), so the two always agree on
// what a given talker would suggest.
//
// Each rule offers 4 candidates; staff picks up to 3 to actually print (see
// buildPairingsHtml below and the 3-item cap in app.js's addPairing) - more
// choice than the card has room for, rather than a fixed take-the-first-3.
const WINE_PAIRING_RULES = [
  { id: 'cabernet', label: 'Cabernet Sauvignon', test: /cabernet|\bcab sauv/i,
    pairings: [
      { icon: '🥩', food: 'Grilled Steak' },
      { icon: '🧀', food: 'Aged Cheddar' },
      { icon: '🍫', food: 'Dark Chocolate' },
      { icon: '🍖', food: 'Braised Lamb' },
    ] },
  { id: 'malbec', label: 'Malbec', test: /malbec/i,
    pairings: [
      { icon: '🥩', food: 'Grilled Meats' },
      { icon: '🌶️', food: 'BBQ Ribs' },
      { icon: '🧀', food: 'Smoked Gouda' },
      { icon: '🫑', food: 'Chimichurri' },
    ] },
  { id: 'syrah', label: 'Syrah / Shiraz', test: /syrah|shiraz/i,
    pairings: [
      { icon: '🥩', food: 'Peppered Steak' },
      { icon: '🍖', food: 'Game Meats' },
      { icon: '🧀', food: 'Aged Gouda' },
      { icon: '🍄', food: 'Mushroom Ragout' },
    ] },
  { id: 'zinfandel', label: 'Zinfandel', test: /zinfandel|\bzin\b/i,
    pairings: [
      { icon: '🍖', food: 'BBQ Ribs' },
      { icon: '🌭', food: 'Spicy Sausage' },
      { icon: '🧀', food: 'Blue Cheese' },
      { icon: '🍕', food: 'Pepperoni Pizza' },
    ] },
  { id: 'merlot', label: 'Merlot', test: /merlot/i,
    pairings: [
      { icon: '🍗', food: 'Roast Chicken' },
      { icon: '🍄', food: 'Mushroom Risotto' },
      { icon: '🧀', food: 'Soft Cheeses' },
      { icon: '🍝', food: 'Tomato Pasta' },
    ] },
  { id: 'pinot-noir', label: 'Pinot Noir', test: /pinot noir/i,
    pairings: [
      { icon: '🦆', food: 'Roast Duck' },
      { icon: '🍄', food: 'Wild Mushrooms' },
      { icon: '🐟', food: 'Grilled Salmon' },
      { icon: '🧀', food: 'Brie' },
    ] },
  { id: 'red-blend', label: 'Red Blend', test: /red blend|meritage/i,
    pairings: [
      { icon: '🧀', food: 'Cheese Board' },
      { icon: '🥩', food: 'Grilled Meats' },
      { icon: '🍫', food: 'Dark Chocolate' },
      { icon: '🍕', food: 'Hearty Pizza' },
    ] },
  { id: 'chardonnay', label: 'Chardonnay', test: /chardonnay/i,
    pairings: [
      { icon: '🦞', food: 'Lobster' },
      { icon: '🍗', food: 'Roast Chicken' },
      { icon: '🍝', food: 'Creamy Pasta' },
      { icon: '🌽', food: 'Grilled Corn' },
    ] },
  { id: 'sauvignon-blanc', label: 'Sauvignon Blanc', test: /sauvignon blanc/i,
    pairings: [
      { icon: '🥗', food: 'Fresh Salad' },
      { icon: '🐐', food: 'Goat Cheese' },
      { icon: '🦪', food: 'Oysters' },
      { icon: '🌿', food: 'Herbed Fish' },
    ] },
  { id: 'pinot-grigio', label: 'Pinot Grigio / Gris', test: /pinot grigio|pinot gris/i,
    pairings: [
      { icon: '🐟', food: 'Light Seafood' },
      { icon: '🥗', food: 'Garden Salad' },
      { icon: '🍋', food: 'Citrus Dishes' },
      { icon: '🍤', food: 'Shrimp Scampi' },
    ] },
  { id: 'riesling', label: 'Riesling', test: /riesling/i,
    pairings: [
      { icon: '🌶️', food: 'Spicy Asian' },
      { icon: '🍑', food: 'Fruit & Cheese' },
      { icon: '🥓', food: 'Roast Pork' },
      { icon: '🍣', food: 'Sushi' },
    ] },
  { id: 'moscato', label: 'Moscato', test: /moscato/i,
    pairings: [
      { icon: '🍰', food: 'Light Dessert' },
      { icon: '🍑', food: 'Fresh Fruit' },
      { icon: '🧀', food: 'Mild Cheese' },
      { icon: '🥐', food: 'Pastries' },
    ] },
  { id: 'sparkling', label: 'Champagne / Sparkling', test: /champagne|sparkling|prosecco|\bcava\b/i,
    pairings: [
      { icon: '🍟', food: 'Fried Appetizers' },
      { icon: '🦪', food: 'Oysters' },
      { icon: '🍰', food: 'Light Desserts' },
      { icon: '🍓', food: 'Fresh Berries' },
    ] },
  { id: 'rose', label: 'Rosé', test: /ros[eé]/i,
    pairings: [
      { icon: '🧺', food: 'Charcuterie' },
      { icon: '🍤', food: 'Grilled Shrimp' },
      { icon: '🍉', food: 'Summer Fruit' },
      { icon: '🥗', food: 'Nicoise Salad' },
    ] },
];

function detectWinePairings(text) {
  const haystack = text ? String(text) : '';
  return WINE_PAIRING_RULES.find(({ test }) => test.test(haystack)) || null;
}

// Renders whatever's in talker.pairings ([{icon, food}], set by the Food
// Pairing Suggestions field - see addPairing in app.js), same "only ever
// renders what's already there, no detection of its own" split
// buildRatingsHtml/buildAwardsHtml below use. Capped at 3 even if more
// somehow ended up on the talker (e.g. an older save from before the cap
// existed) - that's what a Full Size talker's width comfortably fits.
function buildPairingsHtml(talker) {
  if (!Array.isArray(talker.pairings) || !talker.pairings.length) return '';
  const chipsHtml = talker.pairings.slice(0, 3)
    .map((p) => `<span class="card__pairing-chip"><span class="card__pairing-chip-icon">${escapeHtml(p.icon || '')}</span>${escapeHtml(p.food || '')}</span>`)
    .join('');
  if (!chipsHtml) return '';
  return `
    <div class="card__pairings">
      <div class="card__pairings-label">Pairs Well With</div>
      <div class="card__pairings-row">${chipsHtml}</div>
    </div>
  `;
}

// Beer style -> accent color for the pill behind the Style value below.
// Matched by keyword against the free-text Style field (typed by hand or
// scraped from Untappd, e.g. "IPA - Imperial / Double New England / Hazy"),
// so there's no fixed vocabulary to keep in sync with Untappd's. Order
// matters: checked top to bottom, so a style that could match two buckets
// (e.g. "India Pale Lager") takes the first/more specific one rather than
// whichever regex happens to be more general.
//
// Lager through Stout are genuinely all on the same yellow -> amber -> brown
// -> black axis in real life (that's the beer world's actual SRM color
// scale, not a design choice), so they can't be scattered across the color
// wheel without lying about what's in the glass - instead they're fanned out
// with much bigger lightness/saturation gaps than a same-hue-family palette
// would give you, so neighbors on that axis (e.g. Lager vs. Wheat, or Pale
// Ale vs. Hazy) stay easy to tell apart at a glance rather than blurring
// into "some shade of gold."
//
// IPA/Hazy/Double stay within that axis but as three shades of the same
// orange rather than three unrelated colors, so any IPA still reads as
// "IPA family" at a glance and the shade only tells you which kind.
// Hazy/New England is checked before Double/Imperial, so a style tagged as
// both (e.g. "Hazy Double IPA") renders as Hazy - swap the two if strength
// should win over haze.
//
// Sour, Cider, and Mead aren't defined by malt color at all - fruit, apple,
// and honey respectively - so that's where the palette's real hue variety
// lives: pink/berry, green, and purple, none of which any malt style above
// uses.
const BEER_STYLE_COLORS = [
  { test: /hazy|new england|neipa/i, bg: '#f3a23f', fg: '#3b2415' },
  { test: /double|imperial|dipa|triple ipa/i, bg: '#af461d', fg: '#ffffff' },
  { test: /ipa|india pale ale/i, bg: '#de6e12', fg: '#ffffff' },
  { test: /stout|porter/i, bg: '#311f16', fg: '#ffffff' },
  { test: /sour|wild|gose|lambic|fruited/i, bg: '#b03b6c', fg: '#ffffff' },
  { test: /lager|pilsner|pils\b|helles|m[aä]rzen|oktoberfest|bock/i, bg: '#e8d887', fg: '#3b2415' },
  { test: /wheat|hefeweizen|witbier|belgian|saison|tripel|dubbel/i, bg: '#ccc566', fg: '#3b2415' },
  { test: /red ale|amber ale|irish red/i, bg: '#952e23', fg: '#ffffff' },
  { test: /brown ale|dunkel|schwarzbier|dark ale/i, bg: '#593622', fg: '#ffffff' },
  { test: /pale ale|blonde|golden ale/i, bg: '#ddac3c', fg: '#3b2415' },
  { test: /cider/i, bg: '#58913b', fg: '#ffffff' },
  // Not a beer style, but meads get typed into this same free-text field.
  // Purple rather than another gold/amber - mead isn't on the malt-color
  // axis above to begin with, and craft meaderies tend toward jewel-tone
  // branding anyway, so it doubles as a "this isn't a beer style" signal.
  { test: /mead|melomel|cyser|pyment|metheglin|braggot/i, bg: '#653b72', fg: '#ffffff' },
];
const BEER_STYLE_FALLBACK_COLOR = { bg: '#ddd6cc', fg: '#3b2415' };

function beerStyleColor(style) {
  const found = style && BEER_STYLE_COLORS.find(({ test }) => test.test(style));
  return found || BEER_STYLE_FALLBACK_COLOR;
}

// Small solid-color silhouette of the brewery's home state, in the top-right
// corner of the card body - the same 'shape you recognize before you read
// it' idea as the style color above, sourced from the free-text Location
// field already on the talker (see buildBeerTableHtml/parseBreweryHtml).
// Simplified real U.S. Census state boundaries (via us-atlas), not
// stylized icons - a wrong-looking silhouette is worse than none. Alaska
// and Hawaii are relocated/rescaled the standard way any US choropleth map
// does it (Albers USA), which is how US audiences already expect to see
// them. No entry for Puerto Rico or other territories/outside-US
// breweries - stateAbbrFromLocation returning null just means no badge.
const US_STATE_SHAPES = {
  AK: 'M62.1,56.74L62.1,56.74L62.1,56.74ZM60.16,63.75L61.83,61.97L62.3,63.44ZM58.62,68.41L58.62,68.41L58.62,68.41ZM57.95,65.88L60.11,64.06L61.69,64.04L62.23,65.08L58.73,67.48ZM57.87,68.73L57.87,68.73L57.87,68.73ZM56.23,70.56L56.23,70.56L56.23,70.56ZM49.68,72.88L49.68,72.88L49.68,72.88ZM49.39,72.11L49.39,72.11L49.39,72.11ZM48.29,72.81L48.29,72.81L48.29,72.81ZM47.36,71.53L47.36,71.53L47.36,71.53ZM48.03,61.55L48.03,61.55L48.03,61.55ZM45.48,71.94L45.48,71.94L45.48,71.94ZM44.49,72.39L44.49,72.39L44.49,72.39ZM47.51,46.11L47.51,46.11L47.51,46.11ZM43.6,73.75L43.6,73.75L43.6,73.75ZM39.24,74.16L39.24,74.16L39.24,74.16ZM38.5,73.57L38.5,73.57L38.5,73.57ZM37.71,73.76L37.71,73.76L37.71,73.76ZM39.08,55.15L41.12,54.84L41.68,56.58L40.68,56.89ZM34.12,75.61L36.69,73.96L37.52,74.61L36.17,75.64ZM41.58,38.68L44.82,37.21L47.33,36.83L47.16,38.44L49.52,38.87L50.63,38.35L49.46,36.96L50.23,36.01L47.66,35.24L47.54,33.97L44.9,30.95L45.73,29.54L47.9,29.76L49.17,28.8L51.01,25.95L53.45,24.8L55.38,24.69L56.41,23.52L58.18,23.99L58.64,24.95L61.04,24.93L62.2,26.23L63.93,25.71L65.86,26.51L69.15,26.81L70.5,26.05L73.13,27.12L78.65,54.99L81.45,55.07L84.43,57.03L84.92,57.96L86.03,56.86L86.03,55.48L87.15,54.53L89.79,56.75L91.5,57.6L96.05,61.92L98.91,62.49L100,64.81L99.43,66.84L98.29,65.72L96.1,65.21L94.37,62.03L92.45,61.3L90.54,58.63L89.76,58.71L87.9,56.58L88.4,58.63L86.6,59.7L83.53,57.84L80.06,56.62L76.08,56.12L74.06,56.75L70.35,55.13L69.9,54.32L67.89,55.02L68.58,57.22L65.69,57.79L63.88,60.11L62.36,60.07L63.07,55.56L65.09,53.87L62.93,54.67L60.68,58.77L59.04,59.78L58.98,60.84L60.35,61.31L58.89,63.54L56.62,64.6L53.61,67.29L51.55,69.86L49.22,70.11L47.96,71.11L43.45,72.21L42.36,73.08L40.06,73.32L40.77,72.1L43.82,71.52L45.91,69.62L47.63,69.39L50.99,67.16L53.19,65.12L54.33,61.19L51.18,62.35L49.38,60.21L46.97,61.55L46.75,59.31L47.38,58.71L46.61,56.53L44.52,57.39L42.32,54.84L43.02,54.28L41.72,51.6L42.74,49.84L45.41,46.81L46.81,47.63L48.02,46.47L50.14,45.83L49.57,43.44L49.95,42.29L48.07,43.27L44.81,43.08L43.32,42.36L42.81,40.53L43.57,40.25ZM31.67,76.48L33.35,74.95L34.18,75.41ZM33.04,65.05L33.04,65.05L33.04,65.05ZM29.95,76.12L29.95,76.12L29.95,76.12ZM32.42,63.16L32.42,63.16L32.42,63.16ZM28.28,76.47L28.28,76.47L28.28,76.47ZM35.34,43.76L37.25,43.79L39.32,45.55L37.8,46.32ZM24.83,76.47L24.83,76.47L24.83,76.47ZM31.11,52.24L31.11,52.24L31.11,52.24ZM22.11,76.19L22.11,76.19L22.11,76.19ZM19.72,75.76L19.72,75.76L19.72,75.76ZM18.22,75.08L18.22,75.08L18.22,75.08ZM17.9,75.78L17.9,75.78L17.9,75.78ZM16.35,75.86L16.35,75.86L16.35,75.86ZM15.16,75.17L15.16,75.17L15.16,75.17ZM14.43,74.34L14.43,74.34L14.43,74.34ZM10.52,72.43L10.52,72.43L10.52,72.43ZM8.62,72.76L8.62,72.76L8.62,72.76ZM6.48,70.93L6.48,70.93L6.48,70.93ZM0.7,66.33L0.7,66.33L0.7,66.33ZM0,64.14L0,64.14L0,64.14ZM97.88,66.65L97.88,66.65L97.88,66.65ZM97.53,66.5L97.53,66.5L97.53,66.5ZM96.84,65.68L96.84,65.68L96.84,65.68ZM94.12,63.81L94.12,63.81L94.12,63.81ZM93.93,63.46L93.93,63.46L93.93,63.46ZM93.6,66.45L93.6,66.45L93.6,66.45ZM93.09,64.99L93.82,63.62L96.74,66.05L97.23,67.68L94.9,66.69ZM92.24,65.42L92.24,65.42L92.24,65.42ZM91.33,62.71L93.26,61.59L94.56,62.52L92.72,63.23L92.23,64.75ZM89.12,58.4L90.53,58.76L91.73,60.95L91.04,62.21ZM88.86,61.79L90.15,61.27L91.53,64.82ZM88.71,62.22L88.71,62.22L88.71,62.22ZM87.03,60.51L87.96,59.11L89.41,59.45L90.11,60.99L88.83,61.79ZM68.49,58.07L68.49,58.07L68.49,58.07ZM68.33,56.68L68.33,56.68L68.33,56.68Z',
  AL: 'M24.97,100L24.97,100L24.97,100ZM19.33,3.83L61.57,0L73.29,42L79.58,53.45L77.07,56.33L76.36,62.45L78.74,68.7L78.45,75.48L80.67,79L65.46,80.85L36.27,83.62L35.89,86.32L40.14,89.79L41.21,94.65L38.94,97.9L34.82,98.04L32.01,95.89L29.78,90.51L28.19,98.01L23.64,97.39L19.85,66.83L21.18,5.79Z',
  AR: 'M0,7.42L30.05,6.79L70.29,5.15L89.88,4.04L91.62,9.71L86.11,17.12L99.15,16.17L100,20.78L95.18,23.13L97.25,25.66L91.08,32.43L93.81,38.51L89.02,42.51L90.37,44.69L84.11,49.5L84.31,57.73L80.62,59.11L78.46,67.78L74.4,69.39L76.72,74.13L72,79.98L75.5,90.51L74.02,94.18L51.77,95.06L13.41,95.96L13.12,82.39L6.52,82.74L3.83,80.37L4.23,35.58Z',
  AZ: 'M9.14,65.58L11.77,65.48L12.71,61.22L10.77,60.71L11.21,54.83L14.26,53.02L15.3,46.99L17.37,44.58L21.52,42.2L19.45,39.41L16.96,32.02L17.38,30L18.68,27.63L18.34,22.23L19.54,12.42L24.19,12.72L26.55,15.12L28.4,12.7L30.79,0L49.46,3.43L75.08,7.69L92.78,10.26L80.32,100L53.27,95.97L27.79,81.26L7.22,68.85Z',
  CA: 'M44.56,86.75L46.15,87.8L45.26,88.36ZM43.57,90.76L43.57,90.76L43.57,90.76ZM39.7,80.3L39.7,80.3L39.7,80.3ZM36.91,86.75L36.91,86.75L36.91,86.75ZM36.24,78.96L38.67,80.36L36.35,79.91ZM33.66,79.01L35.23,79.09L34.33,80.2ZM32.27,78.31L32.27,78.31L32.27,78.31ZM26.52,0L47.19,6L53.98,7.78L47.03,34.63L76.8,79.42L76.56,80.58L78,84.86L79.19,86.48L76.8,87.85L75.6,89.25L75,92.74L73.23,93.78L72.98,97.18L74.1,97.48L73.55,99.94L72.03,100L53.59,97.82L52.96,96.4L53.27,92.18L52.39,89.97L48.3,84.93L46.56,84.72L46.38,81.96L44.22,81.69L41.53,79.64L39.63,76.61L35.53,74.99L33.08,74.59L32.12,73.06L33.46,68.07L31.91,66.61L32.48,65.28L30.16,62.05L28.37,56.55L27.42,55.11L28,52.22L29.38,50.97L28.82,49.14L27.53,49L26.05,46.26L26.11,43.14L26.78,40.83L27.6,40.77L27.37,42.81L28.9,44.58L28.93,42.53L27.83,39.37L29.19,38.97L28.54,37.84L26.78,40.46L25.22,38.3L23.93,37.85L24.77,36.55L24.29,33.64L23.2,32.21L21.47,27.93L22.05,27.11L21.99,24.08L22.88,22.56L23.06,19.91L22.06,16.98L20.81,15.07L20.98,13.41L24.1,9.64L24.55,7.68L25.97,5.24Z',
  CO: 'M9.53,10.39L52.42,15.62L74.05,17.57L100,19.48L98.88,36.95L95.66,89.61L82.51,88.59L64.2,87.22L38.75,84.72L0,79.87L2.86,57.67Z',
  CT: 'M0,20.94L88.62,0.69L88.98,1.78L100,43.87L98.5,51.62L71.82,62.91L43.67,67.37L34.52,80.96L9.35,99.31L3.63,91.93L14.68,80.78L9.64,75.72Z',
  DC: 'M0,11.54L100,16.7L53.48,88.46Z',
  DE: 'M33.58,14.12L34.14,15.8L33.58,14.12ZM19.66,10.16L24.95,1.55L38.71,0L35.38,9.48L34.1,25.37L45.15,35.46L51.52,53.34L72.53,68.38L80.34,92.76L44.56,100Z',
  FL: 'M94.34,86.02L94.34,86.02L94.34,86.02ZM93.2,86.95L93.2,86.95L93.2,86.95ZM89.96,88.8L89.96,88.8L89.96,88.8ZM81.57,92.01L85.72,87.99L88.54,89.49ZM79.06,92.75L79.06,92.75L79.06,92.75ZM77.12,92.75L77.12,92.75L77.12,92.75ZM71.64,63.92L71.64,63.92L71.64,63.92ZM67.25,93.2L67.25,93.2L67.25,93.2ZM36.79,25.36L36.79,25.36L36.79,25.36ZM30.88,9.18L32.97,12.98L64.51,10.83L65.45,13.64L66.89,13.36L66.31,7.5L67.1,6.81L73.29,7.52L74.91,13.41L77.48,19.88L82.32,28.06L89.15,36.61L88.47,38.8L89.46,41.66L92.48,46.14L97.66,55.37L99.37,61.35L100,73.85L98.77,73.34L98.18,76.94L99.1,78.82L97.48,80.9L89.65,83.14L88.65,80.25L85.8,75.85L81.21,73.64L80.48,74.37L76.55,66.97L73.32,64.53L74.01,62.13L71.69,63.02L64.93,54.5L67.8,48.6L63.82,46.52L65.49,49.23L63.85,50.99L62.13,48.72L62.13,44.98L63.16,38.74L62.13,34.48L60.28,31.37L57.92,31.26L54.8,28.29L52.45,27.26L51.99,25.17L48.94,22.56L43.96,20.16L41.05,20.6L40.44,23.48L38.2,23.57L34.24,26.66L31.51,27.08L32.63,28.75L28.84,28.17L27.77,24.39L21.72,21.18L17.44,19.84L12.49,19.61L2.1,22.2L3.67,19.97L2.94,16.62L0,14.22L0.27,12.36L20.39,10.45Z',
  GA: 'M2.36,5.85L25.3,3.09L46.93,0L43.81,7.64L50.42,11.45L53.02,11.42L60.09,21.97L66.14,25.29L67.61,27.98L73.36,31.4L77.03,37.21L82.5,39.8L85.12,47.94L87.89,49.15L91.79,54.6L92.42,58.34L96.99,59.49L97.64,60.85L93.54,67.07L92.3,78.89L89.33,84.5L91.16,90.24L81.28,89.09L80.02,90.19L80.95,99.57L78.65,100L77.13,95.51L26.75,98.96L23.4,92.87L20.95,89L21.28,81.53L18.65,74.64L19.44,67.9L22.2,64.72L15.27,52.11Z',
  HI: 'M76.97,66.24L81.18,60.51L80.7,55.9L91.49,60.85L94.96,64.05L94.81,66.24L100,70.25L96.95,73.81L91.11,75.48L87.25,78.02L84.18,82.34L80.28,80.03L80.15,74.15ZM65.05,43.29L67.03,41.1L69.19,43.79L71.96,42.7L77.89,45.69L76.97,48.45L71,49.95L69.4,45.99ZM65.01,50.86L65.01,50.86L65.01,50.86ZM58.37,43.61L63.03,45.46L60.12,46.91ZM53.81,39.77L54.68,37.44L64.87,38.65L61.79,40.79ZM36.06,30.42L41.75,27.85L44.07,32.78L47.55,35.92L39.07,35.82ZM8.42,21.43L12.65,17.66L16.49,17.92L16.8,22.87L11.78,24.14ZM0,24.85L0,24.85L0,24.85Z',
  IA: 'M2.83,18.75L26.17,18.67L57.17,18L82.21,16.94L84.91,21.98L83.22,24.68L85.53,32.89L90.75,34.67L92.1,37.4L96.32,43.15L99.98,45.23L100,51.87L97.86,56.57L93.14,59.51L87.09,60.93L86.24,64.56L89.02,67.49L86.73,76.64L83.21,78.11L82.34,83.06L77.21,78.31L53.03,79.9L31.35,80.57L13.41,80.43L11.46,77.32L12.61,74.19L10.54,64.57L8.21,60.06L8.63,54.63L6.15,50.59L2.85,40.08L0,34.19L3.05,26.76L0.62,18.73Z',
  ID: 'M31.62,38.27L31.75,32.55L39.14,0L47.48,1.81L44.71,14.75L46.77,18.91L45.88,22.1L49.06,25.23L53.72,34.35L56.33,34.77L53.31,42.14L53.55,44.79L51.96,45.51L51.56,48.27L53.25,49.95L56.97,47.41L59.29,55.51L59.74,59.09L62.47,60.83L62.88,65.18L68.52,66.22L69.71,64.83L77.16,66.31L78.86,64.29L80.85,67.94L75.75,100L47.3,95.1L19.15,89.15L24.36,65.97L26.53,61.83L24.35,59.91L24.09,58L26.68,54.15L34.58,44Z',
  IL: 'M22.9,41L23.64,36.81L26.62,35.57L28.56,27.82L26.2,25.34L26.92,22.26L32.04,21.06L36.04,18.58L37.85,14.6L37.83,8.98L34.73,7.21L31.16,2.35L55.31,1.04L68.12,0L67.97,3.43L72.96,13.66L76.62,55.84L75.43,59.21L77.52,62.86L77.83,67.47L71.12,82.31L72.22,84.14L70.59,86.75L71.92,90.04L66.58,92.03L67.64,96.21L66.07,97.78L60.44,95.37L57.5,98.08L57.95,99.97L55.9,100L52.16,94.85L52.37,89.32L46.88,84.11L46.13,84.8L39.49,79.02L39.45,75.94L42.11,67.43L37.37,65.59L34.52,66.52L33.31,60.72L24.16,52.61L22.18,47.18Z',
  IN: 'M23.48,6.15L30.67,7L35.57,3.79L70.77,0L70.95,1.52L77.96,63.01L78.97,70.61L72.73,73.66L67.55,74.22L68.68,77.53L64.91,83.22L61.83,84.77L58.72,92.76L53.03,88.63L50.25,94.29L44.81,93.43L39.14,98.87L30.15,95.1L22.49,100L21.03,97.57L29.96,77.8L29.55,71.66L26.77,66.81L28.36,62.33Z',
  KS: 'M3.16,22.92L24.62,24.13L56.4,25.18L90.32,25.44L95.24,27.3L93,33.36L96.75,38.96L99.61,40.48L100,76.95L74.63,77.08L52.03,76.77L32.22,76.13L0,74.6Z',
  KY: 'M4.93,67.05L4.5,65.23L7.33,62.61L12.75,64.94L14.26,63.43L13.24,59.4L18.39,57.49L17.11,54.31L18.67,51.8L24.21,48.25L30.71,50.98L34.81,47.04L38.75,47.66L40.76,43.57L44.88,46.56L47.12,40.78L49.35,39.66L52.08,35.54L51.26,33.15L55.01,32.74L59.52,30.54L58.8,25.04L63.33,24.21L67.37,29.22L72.12,29.47L74.91,31.35L76.68,29.81L80,31.18L84.78,27.78L85.9,30.6L89.53,32.96L89.92,38.17L95.33,45.26L100,46.89L95.52,52.31L90.97,55.5L89.42,59.75L86.3,62.73L79.35,66.14L67.63,67.69L50.14,69.24L43.31,69.49L22.73,71.69L19.72,71.17L20.21,74.27L1.66,75.66L4.15,74.26ZM0.74,75.75L0,75.79L0.74,75.75Z',
  LA: 'M100,69L100,69L100,69ZM91.21,69.51L91.21,69.51L91.21,69.51ZM86.54,81.46L86.54,81.46L86.54,81.46ZM72.71,91.79L72.71,91.79L72.71,91.79ZM69.2,92.32L69.2,92.32L69.2,92.32ZM65.52,93.37L65.52,93.37L65.52,93.37ZM40.52,82.74L46.41,83.26L43.92,85.06ZM0,7.82L33.56,7.03L53.04,6.26L54.93,8.73L54.55,17.8L58.87,21.03L53.99,24.2L56.14,25.71L48.14,39.32L48.35,44.99L46.05,45.29L46.41,51.22L82,49.18L80.61,56.85L87.54,67.06L82.13,70.47L81.89,72.65L86.58,73.77L88.5,69.25L90.94,72.81L90.07,78.53L85.64,79.13L89.05,84.6L95.03,85.03L97.47,88.88L96.71,92.81L86.66,86.88L82.71,86.51L75.68,92.14L71.31,86.59L64.35,93.74L61.31,90.83L53.97,88.6L53.29,83.88L51.35,84.93L47.99,79.2L43.03,79.92L42.76,77.21L38.5,79.53L38.76,82.3L34.69,84.29L29.04,83.3L18.1,79.56L12.38,79.75L5.46,81.66L3.77,78.86L7.84,73.55L7.11,62.03L10.27,56.39L10.16,48.36L4.47,39.33L4.69,35.44L0.47,30.51Z',
  MA: 'M94.52,75.4L94.52,75.4L94.52,75.4ZM78.91,77.98L83.87,71.54L89.37,75.33ZM0,43.52L21.79,38.85L53.23,31.88L58.64,24.04L64.19,22.02L67.01,28.3L72.24,28.18L64.19,40.36L76.77,49.52L84.63,60.3L96.41,55.99L100,58.77L81.75,69.7L78.19,63.07L74.05,72.92L69.68,74.79L65.89,68.79L64.75,67.69L57.51,57.46L46.34,60.82L46.15,60.26L0.25,70.74Z',
  MD: 'M82.98,74.61L81.86,74.85L82.98,74.61ZM79.82,70.35L79.82,70.35L79.82,70.35ZM0,40.11L41.92,32.32L76.85,25.04L86.35,59.31L100,56.55L98.52,69.11L89.89,73.21L85.18,74.96L80.33,63.07L77.65,67.43L72.57,61.33L73.1,57.84L78.69,57.88L69.67,51.64L70.02,43.07L72.8,33.81L66.94,36.58L66.29,42.43L68.37,47.29L66.28,54.73L71.26,67.32L75.53,73.61L68.79,70.1L64.27,70.39L58.46,65.58L54.88,68.75L52.79,65.68L54.99,60.84L56.04,56.13L58.21,52.78L53.55,52.54L44.11,49.06L44.78,45.85L38.84,44.35L34.78,39.59L27.29,35.84L22.22,41.81L14.77,40.78L12.29,45.88L9.14,45.62L2.29,54.41Z',
  ME: 'M65.14,66.15L65.14,66.15L65.14,66.15ZM63.41,67.41L63.41,67.41L63.41,67.41ZM61.85,63.68L61.85,63.68L61.85,63.68ZM57.88,67.3L57.88,67.3L57.88,67.3ZM59.14,75.66L59.14,75.66L59.14,75.66ZM57.08,70.36L57.08,70.36L57.08,70.36ZM55.89,67.54L55.89,67.54L55.89,67.54ZM36.78,100L31.36,95.24L18.28,54.24L22.07,54.94L21.55,51.22L27.04,38.66L25.28,35.22L25.23,29.22L26.92,26.83L26.15,20.77L32.67,1.71L35.44,1.63L38.98,6.2L42.9,2.59L48.7,0L55.5,3.76L64.13,32.66L69.75,32.63L71.23,39.47L74.43,42.06L76.86,40.49L81.72,46.95L79.76,51.35L77.6,50.61L75.16,57.31L71.85,56.02L69.06,61.83L64.32,65.05L62.73,61.26L61.27,68.8L57.6,65.67L56.77,61.61L55.09,71.56L55.95,73.85L44.35,81.57L39.26,88.68Z',
  MI: 'M66.53,32.46L66.53,32.46L66.53,32.46ZM57.01,34.08L57.01,34.08L57.01,34.08ZM56.24,37.86L56.24,37.86L56.24,37.86ZM55.21,35.77L55.21,35.77L55.21,35.77ZM53.72,40.6L53.72,40.6L53.72,40.6ZM52.21,45.59L52.21,45.59L52.21,45.59ZM51.4,47.75L51.4,47.75L51.4,47.75ZM44.49,38.78L44.49,38.78L44.49,38.78ZM48.94,100L51.13,97.64L53.62,91.61L54.59,84.06L53.81,79.39L49.28,69.78L50.25,66.89L48.92,63.21L51.23,58.38L51.05,52.64L52.57,49.29L55.39,48.29L57.08,44.33L57.32,49.97L58.86,51.13L60,48.09L59.67,42.7L64.49,40.19L61.92,37.69L65.33,33.78L69.01,35.52L71.75,35.46L73.18,37.35L80.23,38.8L83.42,43.72L81.66,45.09L84.06,48.59L84.19,54.56L82,56.66L81.96,59.41L79.34,60.83L78.4,64.77L81.8,66.9L85.76,60.23L89.44,58.17L93.14,61.5L95.75,70.87L97.57,74.6L97.14,80.62L93.9,80.33L93.1,85.3L91,87.41L91.26,89.8L88.3,95.93L72.62,98.48L72.5,97.47ZM13.65,5.61L19.73,1.01L22.15,0L19.74,3.02L15.11,6.25ZM2.43,27.02L8.41,23.02L13.07,21.94L25.66,11.29L29.72,10.7L23.45,19.14L23.6,22.5L25.67,19.64L32.45,20.92L35.77,25.46L43.16,25.85L48.87,21.55L55.98,20.67L61.57,18.61L61.41,23.24L66.08,23.71L70.94,21.28L71.64,25.92L75.65,29.2L77.79,27.43L78.36,30.18L72.22,29.91L69.41,31.01L66.11,29.49L64.54,32.55L62.4,30.66L56.58,29.97L55.23,32.09L49.4,32.78L47.84,35.69L44.27,38.29L45.92,34.88L43.13,35.04L42.72,37.28L39.13,38.58L35.32,47.94L33.59,46.88L34.33,44.14L31.75,43.77L32.39,39L28.29,37.03L28.52,35.38L21,34.49L17.39,32.81L5.91,30.44Z',
  MN: 'M6.17,6.41L29.68,6.49L29.62,0L33.34,1.48L35.03,8.36L36.72,11.39L44.65,12.48L45.26,14.38L51.89,12.07L59.98,15.09L61.71,18.86L62.84,16.54L69.21,18.91L71.03,21.45L74.64,20.6L79.21,17.73L80.23,20.06L87.43,19.42L90.56,21.35L93.83,21.47L83.19,26.59L76.17,32.69L74.12,35.49L65.86,42.98L66.83,44.33L63.61,45.19L63.99,55.2L59.97,57.75L57.37,61.52L57.28,63.94L60.11,65.91L58.94,68.74L58.65,77.97L61.89,80.97L64.35,81.08L69.62,84.69L70.32,86.9L75.89,90.17L78.37,93.86L78.93,98.53L58.61,99.39L33.45,99.94L14.51,100L14.66,69.27L9.86,63.98L13.4,58.4L13.02,51.68L10.72,45.96L10.24,30.29L6.94,20.45L7.59,11.7Z',
  MO: 'M0,8.11L16.26,8.25L35.91,7.64L57.82,6.2L62.47,10.51L61.7,17.12L63.82,22.93L73.62,31.62L74.92,37.82L77.96,36.83L83.04,38.8L80.19,47.92L80.24,51.21L87.35,57.4L88.15,56.66L94.03,62.24L93.8,68.16L97.8,73.67L100,73.64L99.14,81.66L96.36,83.21L95.34,83.31L94.52,83.36L95.12,85.62L92.34,88.54L94.17,90.52L92.22,93.09L82.41,93.8L86.56,88.22L85.25,83.96L70.5,84.8L40.21,86.03L17.59,86.51L17.46,76.9L17.02,36.13L13.83,34.44L9.64,28.18L12.14,21.41L6.64,19.33L2.21,13.32Z',
  MS: 'M77.05,97.95L77.05,97.95L77.05,97.95ZM72.43,97.73L72.43,97.73L72.43,97.73ZM68.68,98.61L68.68,98.61L68.68,98.61ZM65.64,98.37L65.64,98.37L65.64,98.37ZM27.6,44.07L28.78,41.11L25.97,32.64L29.76,27.93L27.9,24.11L31.17,22.82L32.91,15.84L35.88,14.73L35.71,8.1L40.75,4.23L39.67,2.48L74.46,0L76.33,1.98L74.99,63.76L78.83,94.69L76.99,95.82L69.57,94.91L59.34,100L52.96,90.6L54.24,83.55L21.5,85.42L21.17,79.97L23.29,79.7L23.1,74.48L30.45,61.96L28.47,60.57L32.96,57.65L28.99,54.68L29.34,46.34Z',
  MT: 'M2.62,18.22L21.58,22.08L39.3,25.21L59.65,28.26L80.14,30.8L100,32.74L96.86,70.11L95.76,81.78L79.5,80.28L57.22,77.56L38.16,74.91L35.16,74.32L34.19,80.78L32.3,77.33L30.69,79.24L23.65,77.84L22.52,79.16L17.19,78.18L16.79,74.05L14.22,72.41L13.79,69.02L11.6,61.36L8.08,63.76L6.48,62.17L6.85,59.56L8.36,58.88L8.13,56.38L10.99,49.4L8.52,49L4.11,40.38L1.1,37.42L1.95,34.4L0,30.47Z',
  NC: 'M99.08,35.7L99.08,35.7L99.08,35.7ZM98.45,49.1L98.45,49.1L98.45,49.1ZM28.02,38.86L44.22,36.95L64.97,33.33L83.42,29.69L95.52,27.05L99.95,35.23L98.91,34.71L96.12,28.99L93.62,28.07L95.84,31.68L88.06,38.04L93.67,35.98L98.43,35.84L100,39.2L96.13,45.62L90.82,45.84L85.22,45.03L92.52,47.41L90.08,53.12L92.88,51.22L95.74,51.64L98.22,49.3L93.43,56.62L90.66,56.41L85.73,58.81L81.89,62.69L79.62,66.76L78.93,71.59L76.14,71.2L71.96,72.95L55.88,61.36L42.48,63.37L42.38,61.63L38.77,58.96L24.04,60.44L14.52,64.8L0.05,66.86L0,63.3L3.05,61.86L3.14,59.7L5.53,57.52L8.91,56.99L16.41,49.44L18.43,49.65L22.6,46.19L24.89,46.4L27.7,41.59Z',
  ND: 'M4.89,18.57L28.21,20.35L62.53,22.1L91.85,22.8L93.45,28.77L92.71,38.64L96.43,49.73L96.97,67.4L99.56,73.85L100,81.43L75.23,81.02L35.05,79.22L0,76.7Z',
  NE: 'M2.6,25.02L28.53,26.97L48.99,27.98L64.22,28.48L70.24,32.14L71.1,30.79L77.44,30.76L84.3,34.23L86.99,36.64L89.39,44.28L91.2,47.22L90.89,51.17L92.58,54.45L94.09,61.44L93.25,63.72L94.68,65.98L96.45,70.15L100,74.98L69.58,74.75L41.09,73.8L21.85,72.72L22.83,57.35L0,55.67Z',
  NH: 'M35.21,13.01L36.02,4.52L42.8,0L64.65,68.48L73.7,76.43L72.6,83.83L67.26,85.77L62.06,93.3L31.88,100L28.98,97.65L26.3,69.49L30.4,48.97L28.3,40.89L38.02,31.53L34.38,23.02Z',
  NJ: 'M28.19,76L29.21,73.37L31.09,68.02L48.99,48.72L36.49,40.64L29.52,30.47L32.42,22.05L29.02,17.81L38.76,0L66.16,9.01L64.48,22.51L64.08,23.88L59.82,31.63L68.62,33.48L71.81,60.43L65.91,78.99L60.78,85.13L57.6,96.65L52.53,100L53.16,90.53L45.24,91.33L32.78,83.13L28.5,76.94Z',
  NM: 'M15.49,0L54.32,4.86L79.83,7.36L98.17,8.73L97.52,17.49L96.97,17.45L93.72,61.01L90.81,96.09L72.29,94.59L38.85,91.24L39.74,95.16L15.19,92.2L14.18,100L1.83,98.37Z',
  NV: 'M27.36,0L39.31,3.03L54.71,6.53L82.33,12.37L70.06,75.78L68.12,86.03L66.63,87.99L64.72,86.04L60.97,85.81L60,93.73L60.28,98.09L59.22,100L17.67,37.49Z',
  NY: 'M99.79,69.73L99.79,69.73L99.79,69.73ZM97.88,71.52L97.88,71.52L97.88,71.52ZM76.82,86L75.05,89.24L76.82,86ZM36.36,38.04L36.36,38.04L36.36,38.04ZM35.34,37.97L35.34,37.97L35.34,37.97ZM0,73.21L6.77,67.04L9.71,62.46L7.14,59.39L5.56,54.8L12.34,51.59L21.39,50.53L24.45,51.74L31.44,49.7L37.15,44.07L39.25,43.53L37.39,38.46L39.25,37.02L35.78,35.4L35.94,32.41L40.13,28.54L46.31,18.4L49.06,15.73L68.21,10.76L69.46,17.93L71.59,23L71.01,27.21L73.17,31.56L72.79,34.07L75.42,35.36L78.39,48.5L78.51,60.87L80.78,73.75L81.96,74.95L79.36,77.57L80.71,79.3L83.01,79.44L93.49,76.23L96.32,72.68L100,74.36L96.97,77.41L89.56,82.84L78.92,87.61L76.99,85.43L77.69,79.81L66.27,76.05L62.23,74.79L60.3,70.39L55.58,67.06L24.88,73.43L0.81,77.83Z',
  OH: 'M46.71,16.38L46.71,16.38L46.71,16.38ZM44.45,15.51L44.45,15.51L44.45,15.51ZM6.14,19.14L32.29,14.87L43.17,19.27L44.85,17.06L52.48,21.53L61.1,16.66L66.4,16.63L79.13,4.77L88.07,0L93.86,35.19L91.24,37.38L93.65,43.91L92.29,55.04L90.03,63.48L85.19,70.43L80.64,70.48L76.7,74.71L73.9,85.98L70.92,82.23L67.59,89.03L68.94,94.25L66.77,98.49L61.4,100L55.79,96.36L54.06,92.01L46.68,97.25L41.56,95.15L38.84,97.52L34.54,94.61L27.2,94.23L20.97,86.5L13.97,87.77Z',
  OK: 'M0.55,23.79L11.62,24.65L39.27,25.96L56.28,26.51L75.67,26.77L97.45,26.67L97.55,34.04L100,50.32L99.76,76.21L95.36,74.78L90.73,71.57L90.1,72.79L86.75,72.02L82.24,72.69L77.32,75.63L73.33,72.33L70.56,71.75L67.31,74.81L66.88,72.17L64.9,73.57L61.15,71.04L58.97,73.02L58.05,70.96L53.08,68.36L51.58,69.71L45.7,67.26L43.2,67.23L43.01,65.42L37.22,64.55L33.7,61.76L34.9,33.17L16.02,32.22L0,31.14Z',
  OR: 'M27.59,8.34L29.87,10.88L31.76,10.78L33.94,15.07L33.15,19.8L38.11,23.01L43.4,21.9L46.43,22.42L49.62,25.25L56.01,24.7L60.43,26.18L63.41,25.36L72.73,25.96L74.46,25.31L96.45,30.55L100,37.43L90.52,49.62L87.4,54.25L87.71,56.54L90.34,58.85L87.73,63.82L81.47,91.66L62.61,87.38L47.99,83.67L36.38,80.63L1.06,70.38L0,68.13L1.77,61.07L1.23,56.52L8.02,46.78L9.89,43.2L18.07,23.71L20.8,16.07L21.52,11.63L23.46,8.57Z',
  PA: 'M0,33.67L10.88,25.36L11.9,31.2L42.31,25.63L81.1,17.58L87.07,21.79L89.51,27.36L94.62,28.95L89.49,38.33L91.28,40.56L89.75,44.99L93.42,50.35L100,54.6L90.58,64.77L86.49,65.23L84.91,67.79L57.69,73.46L25.02,79.54L8.01,82.42L4.76,62.58Z',
  RI: 'M73.66,34L85.04,52.01L66.39,61.37ZM63.29,62.11L63.29,62.11L63.29,62.11ZM54.65,100L54.65,100L54.65,100ZM29.75,87.55L32.08,75.51L14.96,10.07L48.5,0L70.25,30.7L54.65,26.18L59.12,73.79Z',
  SC: 'M3.5,21.47L19.48,14.16L44.24,11.67L50.31,16.15L50.47,19.07L72.98,15.69L100,35.16L92.92,41.85L89.84,49.07L89.92,54.27L75.71,71.19L66.35,76.44L67.31,79.88L59.76,88.33L54.64,87.04L53.92,82.84L49.54,76.72L46.42,75.35L43.48,66.2L37.34,63.3L33.21,56.77L26.75,52.92L25.09,49.89L18.29,46.17L10.34,34.3L7.42,34.34L0,30.06Z',
  SD: 'M3.01,33.61L4.62,16.55L37.57,18.92L75.35,20.61L98.64,21L94.88,26.91L99.98,32.52L99.81,65.1L97.91,65.08L100,71.99L97.38,78.38L99.83,83.45L96.64,80.6L88.53,76.49L81.03,76.52L80.01,78.12L72.89,73.8L54.88,73.2L30.67,72L0,69.71Z',
  TN: 'M5.95,51.8L7.47,49.8L6.04,48.25L8.21,45.97L7.75,44.21L8.39,44.17L9.18,44.09L25.28,42.89L24.86,40.2L27.47,40.65L45.32,38.74L51.25,38.52L66.42,37.18L76.59,35.83L100,32.72L99.69,35.46L96.87,40.28L94.57,40.07L90.39,43.54L88.37,43.33L80.85,50.89L77.46,51.43L75.07,53.61L74.97,55.77L71.92,57.22L71.97,60.79L56.59,62.64L25.39,65.47L0,67.28L2.81,64.93L1.21,61.35L4.83,57.38L3.62,55.89L6.45,54.51Z',
  TX: 'M30.55,0.94L40.48,1.61L52.18,2.2L51.43,19.91L53.61,21.64L57.2,22.18L57.32,23.3L58.86,23.32L62.51,24.84L63.44,24L66.52,25.61L67.09,26.89L68.44,25.66L70.77,27.22L71.99,26.36L72.26,27.99L74.27,26.1L75.98,26.46L78.46,28.5L81.51,26.68L84.3,26.27L86.38,26.74L86.77,25.98L89.63,27.98L92.36,28.86L93.33,29.71L95.69,29.58L95.8,34.45L95.99,43.73L97.72,45.75L97.63,47.34L99.96,51.04L100,54.32L98.71,56.64L99.01,61.35L97.34,63.52L98.03,64.67L95.71,65.11L90.76,67.49L92.48,65.85L90.63,66.25L91.27,64.19L89.16,64.73L89.76,68.28L91.05,68.05L85.93,72.31L78.6,76.16L73.91,79.85L71.83,82.66L70.02,86.98L69.91,90.12L71.22,95.35L69.72,90.89L69.67,88.05L70.49,84.53L73.97,78.96L77.5,77.05L75.55,77.3L72.8,79.1L71.47,81.68L69.33,81.21L70.92,82.83L69.59,86.19L68.99,90.82L69.48,93.75L70.54,95.66L70.43,97.15L71.6,98.5L68.5,99.08L67.48,97.85L62.56,97.29L60.82,95.9L59.15,95.73L57.92,94.49L55.59,93.92L54.43,90.12L53.04,88.46L52.92,84.28L51.98,82.84L49.83,81.33L49.46,79.67L46.68,76.81L45.97,74.06L44.25,71.1L43.93,69.2L41.12,65.9L39.58,65.11L38.02,62.81L33.01,62.4L31.28,61.58L30.87,62.49L28.47,62.72L26.32,67.4L24.62,69.14L23.31,69.07L21.24,67.33L16.8,64.89L13.92,61.98L13.03,59.63L13.18,57.33L11.13,52.52L8.26,50.69L4.45,45.65L2.62,44.53L1.54,41.98L0.47,41.39L0,39.35L17.42,41.09L27.06,41.87L28.57,23.6L30.27,0.92Z',
  UT: 'M27.3,0L66.24,6.7L63.38,24.56L89.82,28.45L82.95,77.14L80.01,100L60.06,97.11L31.21,92.32L10.18,88.45Z',
  VA: 'M95.08,39.42L100,37.08L97.11,42.5L95.85,51.69L93.08,51.23L93.27,45.2ZM91.14,40.22L90.5,40.36L91.14,40.22ZM19.16,60.03L21.17,63.78L25,64.52L27.13,62.07L29.08,63.43L37.28,58.1L39.82,57.25L39.37,54.34L42.17,48.97L44.79,41.37L44.84,38.76L49.43,40.88L52.04,33.26L53.8,34.37L58.22,26.95L58.02,22.11L65.23,26.19L65.95,22.96L69.35,23.81L68.96,25.65L74.35,27.63L75.77,29.67L75.17,32.36L73.4,35.76L74.3,37.38L76.96,35.84L78.54,38.57L82.97,38.74L88.4,41.86L89.84,51.05L87.83,49.97L90.65,54.59L89.32,56.86L84.32,54.14L88.66,58.09L90.37,56.69L94.67,56.58L97.41,61.9L84.45,64.73L64.67,68.63L42.41,72.51L25.04,74.56L0,77.89L6.45,74.72L9.34,71.96L10.78,68.01L15.01,65.06Z',
  VT: 'M23.44,12.78L73.49,0L72.58,10.94L76.56,20.24L65.93,30.48L68.23,39.31L63.75,61.75L66.68,92.54L69.84,95.11L46.97,100L40.09,69.63L34.03,66.63L34.9,60.84L29.91,50.79L31.24,41.06L26.34,29.34Z',
  WA: 'M24.36,44.3L24.36,44.3L24.36,44.3ZM28.98,22.3L28.98,22.3L28.98,22.3ZM29.09,18.77L29.09,18.77L29.09,18.77ZM28.11,21.37L28.11,21.37L28.11,21.37ZM25.88,27.7L28.8,24.94L27.39,29.48ZM26.32,16.75L26.32,16.75L26.32,16.75ZM24.69,18.1L24.69,18.1L24.69,18.1ZM26.04,12.59L26.04,12.59L26.04,12.59ZM22.53,19.5L26.61,18.4L28.48,19.95L26.38,24.03ZM22.61,17.71L22.61,17.71L22.61,17.71ZM100,31.78L89.26,79.09L89.06,87.41L62.45,81.06L60.36,81.85L49.09,81.13L45.48,82.12L40.12,80.32L32.4,80.99L28.53,77.57L24.87,76.94L18.46,78.28L12.46,74.4L13.42,68.68L10.78,63.48L8.49,63.6L5.73,60.52L1.49,59.63L0,56.28L1.2,51.81L4.64,51.12L1.5,49.62L5.56,46.85L2.34,44.44L2.1,37.76L2.9,30.29L1.29,27L1.99,21.37L4.71,18.6L10.72,24.44L21.81,29.39L25.56,29.26L25.61,33.94L23.16,37.82L27.18,34.38L23.72,45.56L26.82,45.21L26.79,40.73L28.35,36.64L31.47,33.17L31.08,28.01L28.4,22.91L30.79,24.35L32.02,19.23L29.53,17.83L30.07,13.76L63.6,22.99Z',
  WI: 'M96.14,32.48L96.14,32.48L96.14,32.48ZM89.95,36.46L89.95,36.46L89.95,36.46ZM39.53,0.21L39.53,0.21L39.53,0.21ZM38.77,3.05L38.77,3.05L38.77,3.05ZM36.79,2.08L36.79,2.08L36.79,2.08ZM35.23,4.07L35.23,4.07L35.23,4.07ZM35.4,1.29L35.4,1.29L35.4,1.29ZM34.77,0L34.77,0L34.77,0ZM34.84,5.29L34.84,5.29L34.84,5.29ZM31.71,1.01L31.71,1.01L31.71,1.01ZM16.28,7.92L23.92,6.46L31.89,1.99L35.33,2.98L32.63,9.56L35.78,7.29L40.81,9.79L45.67,14.58L61.74,17.89L66.78,20.24L77.3,21.48L76.98,23.8L82.72,26.55L81.82,33.22L85.43,33.74L84.4,37.57L86.81,39.06L83.51,42.56L80.74,51.37L82.59,51.89L87,44.77L90.06,43.02L92.14,36.98L95.84,33.77L89.79,50.91L89.72,59.22L86.88,66.16L87.74,70.58L85.28,80.38L88.51,90.52L88.53,97.08L72.56,98.38L42.45,100L41.03,97.12L35.53,95.24L33.09,86.58L34.86,83.73L32.02,78.41L31.29,72.33L28.06,67.54L20.82,63.29L19.9,60.41L13.05,55.72L9.86,55.58L5.65,51.67L6.02,39.67L7.54,35.99L3.86,33.43L3.98,30.28L7.37,25.38L12.58,22.06L12.1,9.05Z',
  WV: 'M0,69.07L5.71,67.46L8.03,62.95L6.6,57.39L10.13,50.16L13.3,54.14L16.29,42.16L20.48,37.65L25.32,37.6L30.47,30.2L32.88,21.22L34.32,9.38L31.76,2.43L34.55,0.1L38.75,25.8L60.79,22.06L63.11,36.5L70.02,27.62L73.2,27.89L75.71,22.74L83.22,23.78L88.35,17.75L95.91,21.53L100,26.35L98.72,32.06L85.95,24.85L86.32,33.4L78.49,46.53L75.38,44.58L70.76,58.06L62.64,54.31L62.56,58.93L57.91,72.37L52.96,81.87L53.74,87.03L49.25,88.54L34.75,97.97L31.3,95.56L27.53,99.9L20.76,98.6L17.19,91.95L9.53,89.26L0.64,77.62Z',
  WY: 'M100,19.27L96.99,55.37L93.91,91.63L71.39,89.6L26.73,84.16L0,80.23L2.89,62.18L9.94,17.81L11.36,8.37L15.76,9.23L43.63,13.11L76.22,17.08Z',
};

// Full state name -> USPS abbreviation, for a hand-typed Location like
// 'Portland, Oregon' instead of the far more common 'Portland, OR' (see
// stateAbbrFromLocation). Sorted longest-name-first once at load so a scan
// for e.g. 'north carolina' doesn't stop early on a shorter unrelated
// match.
const STATE_NAME_TO_ABBR = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY',
};
const STATE_NAMES_BY_LENGTH_DESC = Object.keys(STATE_NAME_TO_ABBR).sort((a, b) => b.length - a.length);

// Pulls a USPS state abbreviation out of the free-text Location field (e.g.
// 'Toms River, NJ' typed by hand, or 'Morris Plains, NJ United States'
// scraped from Untappd - see parseBreweryHtml in productImport.js). Tries
// the comma-then-abbreviation pattern first since that's how both sources
// actually write it, then any standalone abbreviation token, then a full
// state name. A brewery outside the 50 states/D.C., or Location text that
// doesn't fit any of these, returns null rather than guessing.
function stateAbbrFromLocation(location) {
  const text = location ? String(location).trim() : '';
  if (!text) return null;

  const afterComma = text.match(/,\s*([A-Za-z]{2})\b/);
  if (afterComma && US_STATE_SHAPES[afterComma[1].toUpperCase()]) {
    return afterComma[1].toUpperCase();
  }

  const anyAbbr = text.match(/\b([A-Z]{2})\b/);
  if (anyAbbr && US_STATE_SHAPES[anyAbbr[1]]) {
    return anyAbbr[1];
  }

  const lower = text.toLowerCase();
  const nameMatch = STATE_NAMES_BY_LENGTH_DESC.find((name) => lower.includes(name));
  return nameMatch ? STATE_NAME_TO_ABBR[nameMatch] : null;
}

// US state silhouette when the Location resolves to one; otherwise falls
// back to a country silhouette (see COUNTRY_SHAPES below) for a resolvable
// non-US country, styled with its own --country modifier color so it
// doesn't read as a state. Neither can apply at once - countryCodeFromLocation
// only returns non-US codes when stateAbbrFromLocation already came up empty.
function buildRightBadgeHtml(talker) {
  const abbr = stateAbbrFromLocation(talker.location);
  const shape = abbr && US_STATE_SHAPES[abbr];
  if (shape) {
    return `
      <div class="card__state-badge">
        <svg viewBox="0 0 100 100" aria-hidden="true"><path d="${shape}"/></svg>
        <span class="card__state-badge-label">${abbr}</span>
      </div>
    `;
  }
  const code = countryCodeFromLocation(talker.location);
  const countryShape = code && COUNTRY_SHAPES[code];
  if (!countryShape) return '';
  // No country-letter label here either (see buildCountryFlagHtml's own
  // comment) - just the silhouette.
  return `
    <div class="card__state-badge card__state-badge--country">
      <svg viewBox="0 0 100 100" aria-hidden="true"><path d="${countryShape}"/></svg>
    </div>
  `;
}

// Country flag, top-left corner of the card body - mirrors the state
// silhouette badge above (same trigger: the free-text Location field, same
// size/position math, opposite corner). Flags are built from plain SVG
// primitives (rects/polygons/circles) rather than traced artwork, on a
// shared 60x40 (3:2) viewBox so every entry lines up the same way; a few
// helpers below cover the shapes that repeat across many flags (equal
// stripes, an offset Nordic cross, a five-point star) so each flag's own
// definition is just its colors/placements, not hand-typed coordinates.
// Only the countries a bottle shop is actually likely to stock show up
// here - an unresolvable or not-yet-covered country just means no badge,
// same fallback the state badge already uses.
function flagBase(color) {
  return `<rect x="0" y="0" width="60" height="40" fill="${color}"/>`;
}
function flagStripesH(colors) {
  const h = 40 / colors.length;
  return colors.map((c, i) => `<rect x="0" y="${(i * h).toFixed(2)}" width="60" height="${h.toFixed(2)}" fill="${c}"/>`).join('');
}
function flagStripesV(colors) {
  const w = 60 / colors.length;
  return colors.map((c, i) => `<rect x="${(i * w).toFixed(2)}" y="0" width="${w.toFixed(2)}" height="40" fill="${c}"/>`).join('');
}
function flagNordicCross(bg, crossColor, { barX = 18, barW = 8, barY = 16, barH = 8 } = {}) {
  return flagBase(bg) + `<rect x="${barX}" y="0" width="${barW}" height="40" fill="${crossColor}"/><rect x="0" y="${barY}" width="60" height="${barH}" fill="${crossColor}"/>`;
}
function flagStar(cx, cy, r, color, rotationDeg = -90) {
  const rot = (rotationDeg * Math.PI) / 180;
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const outer = rot + (i * 2 * Math.PI) / 5;
    const inner = outer + Math.PI / 5;
    pts.push(`${(cx + r * Math.cos(outer)).toFixed(1)},${(cy + r * Math.sin(outer)).toFixed(1)}`);
    pts.push(`${(cx + r * 0.38 * Math.cos(inner)).toFixed(1)},${(cy + r * 0.38 * Math.sin(inner)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${color}"/>`;
}
// Staggered star field for the US flag's canton - real long rows (6 stars)
// alternate with short rows offset by half a column (5 stars) 9 times over;
// a plain grid reads as dots rather than a starfield even at this icon
// size, so this keeps the same offset structure, just fewer rows.
function flagStarField(cantonW, cantonH, rows, colsLong, colsShort, r) {
  const marginX = cantonW * 0.11;
  const marginY = cantonH * 0.12;
  const usableW = cantonW - marginX * 2;
  const usableH = cantonH - marginY * 2;
  const rowH = usableH / (rows - 1);
  const colW = usableW / (colsLong - 1);
  let out = '';
  for (let row = 0; row < rows; row++) {
    const long = row % 2 === 0;
    const cols = long ? colsLong : colsShort;
    const xOffset = long ? 0 : colW / 2;
    for (let c = 0; c < cols; c++) {
      out += flagStar(marginX + xOffset + c * colW, marginY + row * rowH, r, '#fff');
    }
  }
  return out;
}
function flagUnionJackInner() {
  return flagBase('#00247D')
    + '<line x1="0" y1="0" x2="60" y2="40" stroke="#fff" stroke-width="7"/>'
    + '<line x1="60" y1="0" x2="0" y2="40" stroke="#fff" stroke-width="7"/>'
    + '<line x1="0" y1="0" x2="60" y2="40" stroke="#CF142B" stroke-width="3"/>'
    + '<line x1="60" y1="0" x2="0" y2="40" stroke="#CF142B" stroke-width="3"/>'
    + '<rect x="0" y="15" width="60" height="10" fill="#fff"/><rect x="25" y="0" width="10" height="40" fill="#fff"/>'
    + '<rect x="0" y="17" width="60" height="6" fill="#CF142B"/><rect x="27" y="0" width="6" height="40" fill="#CF142B"/>';
}

const COUNTRY_FLAGS = {
  US: {
    svg: flagStripesH(['#B22234', '#fff', '#B22234', '#fff', '#B22234', '#fff', '#B22234', '#fff', '#B22234', '#fff', '#B22234', '#fff', '#B22234'])
      + '<rect x="0" y="0" width="26" height="21.54" fill="#3C3B6E"/>'
      + flagStarField(26, 21.54, 5, 5, 4, 1.05),
  },
  MX: { svg: flagStripesV(['#006847', '#fff', '#CE1126']) + '<circle cx="30" cy="20" r="6" fill="#8B5A2B"/><circle cx="30" cy="20" r="3" fill="#2E7D32"/>' },
  CA: {
    svg: '<rect x="0" y="0" width="15" height="40" fill="#FF0000"/><rect x="15" y="0" width="30" height="40" fill="#fff"/><rect x="45" y="0" width="15" height="40" fill="#FF0000"/>'
      + '<path d="M30,8 L33,15 L40,13 L36,20 L42,24 L34,23 L35,31 L30,26 L25,31 L26,23 L18,24 L24,20 L20,13 L27,15 Z" fill="#FF0000"/>',
  },
  GB: { svg: flagUnionJackInner() },
  IE: { svg: flagStripesV(['#169B62', '#fff', '#FF883E']) },
  DE: { svg: flagStripesH(['#000000', '#DD0000', '#FFCE00']) },
  BE: { svg: flagStripesV(['#000000', '#FDDA24', '#EF3340']) },
  NL: { svg: flagStripesH(['#AE1C28', '#fff', '#21468B']) },
  FR: { svg: flagStripesV(['#0055A4', '#fff', '#EF4135']) },
  IT: { svg: flagStripesV(['#009246', '#fff', '#CE2B37']) },
  ES: { svg: '<rect x="0" y="0" width="60" height="40" fill="#AA151B"/><rect x="0" y="10" width="60" height="20" fill="#F1BF00"/>' },
  PT: { svg: '<rect x="0" y="0" width="24" height="40" fill="#046A38"/><rect x="24" y="0" width="36" height="40" fill="#DA291C"/><circle cx="24" cy="20" r="7" fill="#FFCC00" stroke="#046A38" stroke-width="1"/>' },
  CZ: { svg: '<rect x="0" y="0" width="60" height="40" fill="#fff"/><rect x="0" y="20" width="60" height="20" fill="#D7141A"/><polygon points="0,0 0,40 26,20" fill="#11457E"/>' },
  PL: { svg: flagStripesH(['#fff', '#DC143C']) },
  AT: { svg: flagStripesH(['#ED2939', '#fff', '#ED2939']) },
  CH: { svg: flagBase('#D52B1E') + '<rect x="24" y="10" width="12" height="20" fill="#fff"/><rect x="16" y="16" width="28" height="8" fill="#fff"/>' },
  DK: { svg: flagNordicCross('#C60C30', '#fff') },
  SE: { svg: flagNordicCross('#006AA7', '#FECC00') },
  NO: {
    svg: flagNordicCross('#EF2B2D', '#fff', { barX: 17, barW: 10, barY: 15, barH: 10 })
      + '<rect x="19" y="0" width="6" height="40" fill="#002868"/><rect x="0" y="17" width="60" height="6" fill="#002868"/>',
  },
  FI: { svg: flagNordicCross('#fff', '#003580') },
  JP: { svg: '<rect x="0" y="0" width="60" height="40" fill="#fff"/><circle cx="30" cy="20" r="12" fill="#BC002D"/>' },
  CN: {
    svg: flagBase('#DE2910') + flagStar(13, 10, 6, '#FFDE00') + flagStar(22, 5, 2, '#FFDE00') + flagStar(26, 9, 2, '#FFDE00') + flagStar(26, 15, 2, '#FFDE00') + flagStar(22, 19, 2, '#FFDE00'),
  },
  AU: {
    svg: flagBase('#00247D') + `<g transform="scale(0.5)">${flagUnionJackInner()}</g>`
      + flagStar(48, 10, 3, '#fff') + flagStar(44, 20, 2, '#fff') + flagStar(50, 26, 3, '#fff') + flagStar(40, 30, 2, '#fff') + flagStar(17, 30, 4.5, '#fff'),
  },
  BR: { svg: flagBase('#009639') + '<polygon points="30,4 56,20 30,36 4,20" fill="#FEDF00"/><circle cx="30" cy="20" r="9" fill="#002776"/>' },
};

// Small solid-color silhouette of the brewery's home country, in the same
// top-right corner the US state silhouette above uses - for a non-US
// Location there's no state to show, so this fills that corner instead
// (see buildRightBadgeHtml). Simplified real Natural Earth country
// boundaries (via world-atlas + topojson-client + d3-geo, fit to a 100x100
// box the same way the state shapes were), not stylized icons. Two
// countries needed a manual nudge: France's Natural Earth polygon includes
// French Guiana, and Norway's includes Svalbard - both thousands of km from
// the recognizable landmass, which would otherwise blow out the fitted
// bounding box and shrink the actual silhouette to a speck. Both are
// filtered out at generation time (see scratchpad, not checked in - this is
// baked static data like US_STATE_SHAPES, not a runtime map dependency). A
// country with a flag above but no entry here just means no right-side
// badge, same fallback the state badge already uses.
const COUNTRY_SHAPES = {
  MX: 'M0,20.63L3.75,20.37L7.94,20.01L7.64,20.66L12.61,22.26L20.14,24.59L26.7,24.56L29.32,24.56L29.32,23.2L35.03,23.2L36.24,24.37L37.93,25.41L39.89,26.86L40.98,28.59L41.8,30.4L43.51,31.4L46.24,32.39L48.32,29.78L51.02,29.72L53.34,31.03L54.99,33.29L56.13,35.22L58.08,37.1L58.81,39.41L59.73,40.96L62.31,41.99L64.65,42.71L65.93,42.61L64.66,45.51L64.08,47.88L63.84,52.3L63.52,53.91L64.09,55.71L65.11,57.32L65.78,59.88L67.96,62.33L68.73,64.22L70.03,65.84L73.53,66.72L74.88,68.1L77.78,67.17L80.3,66.84L82.77,66.25L84.85,65.68L86.94,64.34L87.73,62.41L87.99,59.64L88.56,58.68L90.8,57.81L94.29,57.05L97.21,57.16L99.22,56.88L100,57.58L99.89,59.17L98.12,61.13L97.34,63.14L97.95,63.72L97.45,65.14L96.63,67.72L95.78,66.87L95.1,66.92L94.47,66.97L93.29,68.96L92.69,68.57L92.29,68.72L92.32,69.21L89.27,69.17L86.19,69.17L86.18,71.03L84.69,71.04L85.92,72.14L87.14,72.9L87.51,73.62L88.04,73.82L87.96,74.94L83.72,74.95L82.14,77.64L82.6,78.26L82.22,79.03L82.14,79.99L78.41,76.44L76.7,75.37L74.02,74.5L72.17,74.74L69.52,75.99L67.85,76.31L65.53,75.44L63.06,74.82L59.97,73.3L57.5,72.84L53.77,71.31L51,69.73L50.17,68.85L48.33,68.65L44.96,67.61L43.58,66.1L40.03,64.23L38.38,62.15L37.6,60.54L38.7,60.22L38.36,59.28L39.12,58.43L39.13,57.29L38.02,55.8L37.73,54.49L36.61,52.83L33.71,49.55L30.39,46.97L28.79,44.91L25.96,43.57L25.35,42.76L25.85,40.72L24.17,39.95L22.22,38.35L21.4,36.05L19.63,35.78L17.71,34.04L16.16,32.44L16.02,31.41L14.25,28.92L13.07,26.4L13.13,25.13L10.75,23.82L9.64,23.96L7.75,23.05L7.23,24.39L7.78,25.98L8.1,28.46L9.23,29.81L11.67,32.08L12.22,32.86L12.72,33.09L13.16,34.23L13.74,34.18L14.4,36.31L15.41,37.15L16.11,38.32L18.18,39.99L19.27,43.07L20.26,44.51L21.17,46.06L21.35,47.8L22.94,47.91L24.27,49.4L25.46,50.88L25.39,51.47L24,52.68L23.42,52.66L22.54,50.66L20.39,48.78L18,47.18L16.32,46.34L16.42,43.93L15.92,42.15L14.36,41.12L12.09,39.65L11.65,40.07L10.82,39.21L8.79,38.42L6.84,36.5L7.08,36.25L8.44,36.44L9.67,35.21L9.79,33.72L7.24,31.36L5.31,30.45L4.1,28.39L2.87,26.23L1.34,23.59Z',
  CA: 'M20.55,65.23L20.4,65.23L18.21,64.11L17.4,63.63L15.35,63.16L14.72,62.16L14.88,61.46L13.43,60.98L13.24,60.07L11.87,59.24L11.84,58.66L12.47,58.12L12.44,57.4L10.51,56.68L9.36,55.39L8.65,54.58L7.61,54.07L6.85,53.6L6.25,53.02L5.11,53.39L4.01,54.02L3.01,53.27L2.22,52.78L1.11,52.46L0,52.43L0,45.99L0.01,41.79L2.12,42.06L3.91,42.6L5.09,42.71L6.08,42.23L7.45,41.88L9.13,42.02L10.83,41.52L12.68,41.24L13.46,41.71L14.3,41.44L14.56,40.91L15.34,41.03L17.25,42.05L18.76,41.28L18.91,42.14L20.3,41.95L20.73,41.62L22.1,41.69L23.83,42.16L26.48,42.58L28.04,42.77L29.15,42.7L30.67,43.27L29.08,43.83L31.13,44.08L34.18,43.94L35.15,43.75L36.35,44.42L37.58,43.85L36.43,43.37L37.16,42.98L38.54,42.93L39.44,42.82L40.36,43.09L41.49,43.7L42.76,43.61L44.76,44.12L46.51,43.94L48.16,43.97L48.03,43.27L49.04,43.07L50.8,43.45L50.79,44.52L51.51,43.62L52.42,43.65L52.93,42.51L51.72,41.82L50.4,41.36L50.49,40.11L51.83,39.28L53.32,39.47L54.46,39.97L56,41.24L55,41.8L57.1,42.03L57.1,43.19L58.61,42.3L59.97,43.03L59.63,43.87L60.72,44.63L61.91,43.81L62.73,42.84L62.79,41.59L64.4,41.68L66.07,41.85L67.59,42.41L67.66,42.97L66.82,43.57L67.62,44.18L67.47,44.73L65.25,45.52L63.68,45.7L62.51,45.35L62.17,45.92L61.08,46.88L60.75,47.37L59.44,48.14L57.82,48.21L56.93,48.69L56.85,49.43L55.54,49.57L54.15,50.49L52.92,51.76L52.48,52.65L52.42,53.97L54.09,54.16L54.59,55.22L55.12,56.08L56.71,55.85L58.81,56.34L59.94,56.77L60.75,57.31L62.17,57.62L63.37,58.09L65.24,58.16L66.47,58.27L66.29,59.25L66.64,60.39L67.45,61.65L69.14,62.73L70.01,62.36L70.63,61.2L70.03,59.41L69.24,58.81L71.05,58.28L72.33,57.49L72.96,56.7L72.86,55.95L72.1,54.98L70.72,54.13L72.06,52.95L71.56,51.92L71.18,50.15L71.97,49.89L73.91,50.2L75.08,50.31L76.02,50.01L77.07,50.4L78.46,51.05L78.81,51.49L80.82,51.58L80.79,52.53L81.17,53.96L82.2,54.13L83.02,54.8L84.66,54.17L85.74,52.92L86.49,52.4L87.37,53.41L88.85,54.85L90.1,56.21L89.64,56.92L91.15,57.56L92.17,58.21L93.97,58.5L94.7,58.86L95.15,59.82L96.03,59.97L96.48,60.4L96.57,61.67L95.74,62.09L94.93,62.49L93.07,62.89L91.64,63.82L89.73,64.01L87.31,63.77L85.61,63.76L84.44,63.84L83.49,64.65L82.05,65.15L80.41,66.65L79.11,67.69L80.07,67.51L81.89,66.02L84.26,65.08L85.95,64.97L86.96,65.52L85.89,66.28L86.25,67.5L86.62,68.36L88.09,68.92L89.96,68.76L91.09,67.48L91.17,68.31L91.9,68.72L90.5,69.46L88,70.13L86.87,70.59L85.61,71.4L84.75,71.32L84.7,70.36L86.67,69.43L84.86,69.46L83.6,69.6L82.86,68.96L82.86,67.42L82.36,67.09L81.6,67.28L81.22,66.99L80.36,67.84L80.02,68.72L79.61,69.24L79.13,69.41L78.77,69.47L78.66,69.75L76.57,69.75L74.85,69.76L74.34,69.96L73.14,70.78L73,70.87L72.64,71.31L71.6,71.31L70.49,71.31L69.98,71.49L70.16,71.71L70.26,72.06L70.24,72.18L68.76,72.74L67.6,72.92L66.28,73.52L66,73.52L65.61,73.34L65.49,73.18L65.51,73.06L65.76,72.67L66.29,72.04L66.62,71.37L66.4,70.39L66.16,69.36L64.97,68.83L65.12,68.63L64.95,68.49L64.64,68.49L64.41,68.31L64.35,68.05L64.13,68.16L63.83,68.13L63.9,68.01L63.63,67.9L63.52,67.61L62.64,67.24L61.73,66.87L60.62,66.43L59.56,66.02L58.55,66.34L58.18,66.35L56.78,66.05L55.87,66.2L54.77,65.85L53.61,65.67L52.82,65.6L52.47,65.41L52.27,64.79L51.89,64.79L51.89,65.23L49.54,65.23L45.67,65.23L41.82,65.23L38.42,65.23L35.03,65.23L31.69,65.23L28.24,65.23L27.13,65.23L23.77,65.23ZM64.52,50L65.36,49.48L66.92,49.49L66.89,49.71L65.57,50.33L64.77,50.31ZM69.3,38.29L68.05,37.69L68.1,37.28L68.64,37.21L71.23,37.33L73.18,37.95L73.29,38.26L72.08,38.23L70.86,38.2L69.62,38.36ZM68.69,50.42L69.12,50.08L69.59,50.1L69.87,50.34L69.43,50.93L68.93,50.83L68.63,50.5ZM53.63,35.82L53.02,36.26L51.38,36.18L50,35.88L50.61,35.37L52.23,35.07L53.22,35.47ZM53.38,32.95L52.86,32.98L50.74,32.91L50.44,32.59L52.72,32.61L53.51,32.82ZM50.08,31.54L51.43,31.93L51.12,32.34L49.45,32.57L48.53,32.31L48.04,31.89L47.95,31.42L49.42,31.46ZM59.82,36.49L57.99,36.35L54.98,35.98L54.59,35.36L54.45,34.8L53.32,34.31L50.98,34.17L49.66,33.82L50.09,33.35L52.42,33.42L53.68,33.79L55.91,33.79L56.88,34.16L56.62,34.58L57.92,34.84L58.65,35.11L60.17,35.16L61.82,35.25L63.62,35.01L65.93,34.91L67.76,34.99L68.98,35.42L69.23,35.89L68.52,36.19L66.83,36.43L65.39,36.29L62.14,36.47ZM33.65,32.23L35.25,32.41L34.87,32.75L32.76,33.07L31.09,32.71L32,32.35ZM34,31.49L35.47,31.72L34.09,31.94L32.21,31.94L32.23,31.78L33.39,31.44ZM96.66,62.61L96.06,63.32L95.31,64.31L96.04,63.93L96.81,64.17L96.41,64.56L97.41,64.87L97.93,64.6L99.06,64.95L98.71,65.78L99.5,65.58L99.65,66.18L100,66.89L99.52,67.88L99.01,67.92L98.27,67.71L98.51,66.78L98.2,66.64L96.89,67.62L96.21,67.58L97.01,67.05L95.92,66.78L94.71,66.84L92.51,66.81L92.34,66.47L93.04,66.08L92.55,65.77L93.5,65.09L94.67,63.28L95.37,62.64L96.35,62.25L96.88,62.3ZM64.65,46.99L65.89,47.38L67.18,47.74L67.28,48.27L68.11,48.19L68.93,48.56L67.92,48.92L66.16,48.65L65.52,48.14L64.4,48.74L62.79,49.32L62.4,48.66L60.87,48.77L61.85,48.21L61.99,47.32L62.38,46.28L63.2,46.38L63.41,46.87L63.99,46.7ZM70.43,38.8L71.51,38.35L74.02,38.92L75.58,39.46L75.72,39.95L77.82,39.7L79,40.42L81.73,40.87L82.72,41.32L83.79,42.38L81.71,42.91L84.38,43.65L86.17,43.9L87.8,44.94L89.59,45.01L89.23,45.8L87.25,47.12L85.85,46.64L84.07,45.55L82.61,45.69L82.47,46.34L83.66,47L85.19,47.52L85.66,47.82L86.39,48.94L86,49.75L84.58,49.44L81.74,48.54L83.34,49.51L84.52,50.2L84.7,50.59L81.63,50.14L79.2,49.48L77.83,48.93L78.22,48.61L76.54,48.03L74.89,47.48L74.91,47.81L71.64,47.99L70.68,47.6L71.42,46.77L73.55,46.75L75.88,46.6L75.5,46.2L75.89,45.64L77.36,44.53L77.05,44.03L76.61,43.64L74.88,43.1L72.58,42.71L73.31,42.42L72.11,41.72L71.11,41.66L70.22,41.27L69.61,41.61L67.56,41.75L63.45,41.5L61.05,41.16L59.22,40.99L58.27,40.6L59.46,40.08L57.85,40.08L57.49,38.93L58.36,37.92L59.53,37.46L62.45,37.15L61.62,37.89L62.51,38.59L63.55,37.68L66.42,37.21L68.36,38.39L68.19,39.13ZM52.63,36.78L54.99,36.82L57.15,37.09L55.45,38.1L54.11,38.32L52.89,39.17L51.6,39.13L50.89,38.13L50.91,37.57L51.5,37.09ZM20.53,34.54L22.46,33.69L24.78,32.96L26.52,32.97L28.07,32.81L27.91,33.68L27.04,34.07L25.99,34.12L23.88,34.61L22.07,34.78ZM9.38,59.52L10.47,59.43L10.13,60.72L11.11,61.63L10.66,61.63L9.98,61.11L9.56,60.59L8.99,60.24L8.78,59.74L8.85,59.38ZM40.19,30.93L42.41,31.09L45.47,31.5L46.34,32.04L46.78,32.51L44.93,32.38L43.07,32.02L40.54,31.97L41.64,31.64L40.27,31.37ZM19.8,65.78L19.23,65.94L17.37,65.43L17.02,65.03L16.01,64.63L15.81,64.31L14.65,64.1L14.21,63.49L14.31,63.23L15.49,63.47L16.19,63.64L17.25,63.76L17.64,64.15L18.2,64.69L19.33,65.16ZM22.02,36.42L23.64,36.66L26.53,36.72L27.63,37.05L28.85,37.53L27.42,37.81L24.65,38.61L23.25,39.4L23.25,39.89L20.27,40.44L19.67,39.94L17.06,39.34L17.54,38.87L18.32,38.04L19.31,37.3L18.2,36.6ZM37.55,34.84L38.56,34.65L39.75,34.7L39.95,35.26L39.26,35.8L35.43,35.97L32.57,36.46L30.85,36.49L30.7,36.12L33.06,35.62L27.94,35.75L26.36,35.55L27.9,34.44L28.97,34.13L32.15,34.51L34.16,35.18L36.14,35.26L34.52,34.18L35.56,33.77L36.73,33.9L37.11,34.44ZM39.02,37.98L40.29,38.43L41,39.54L41.35,40.34L43.25,40.9L45.3,41.43L45.17,41.93L43.31,42.02L44.04,42.46L43.65,42.87L41.6,42.69L39.66,42.39L38.34,42.46L36.22,42.84L33.35,43.01L31.34,43.12L30.72,42.58L29.18,42.27L28.17,42.4L26.78,41.5L27.53,41.39L29.28,41.19L30.88,41.24L32.35,41.04L30.16,40.78L27.74,40.87L26.14,40.85L25.54,40.43L28.17,39.98L26.42,39.99L24.45,39.7L25.39,38.85L26.18,38.4L29.21,37.71L30.37,37.93L29.8,38.46L32.32,38.12L33.89,38.69L35.17,38.11L36.21,38.48L37.13,39.59L37.7,39.12L36.9,37.96L37.9,37.8ZM45.91,38.4L44.66,37.66L46,37.11L47.35,37.35L49.37,37.2L49.66,37.53L48.61,38.07L50.32,38.56L50.12,39.58L48.26,40.02L47.17,39.92L46.39,39.49L43.58,38.62L43.6,38.26ZM38.94,37.39L40.45,37.34L41.31,37.59L40.32,38.34L38.55,37.54ZM48.1,33.85L48.97,34.38L49,34.96L48.49,35.8L46.62,35.92L45.41,35.74L45.43,35.07L43.57,35.16L43.5,34.29L44.72,34.32L46.42,33.94L48.01,34ZM50.92,29.46L51.7,29.11L52.86,29.03L52.36,28.78L54.99,28.72L56.44,29.32L58.35,29.56L60.2,29.78L61.1,30.53L62.46,30.89L60.91,31.23L58.82,32.08L56.81,32.16L54.47,32.02L53.25,31.56L53.27,31.14L54.16,30.84L52.09,30.85L50.85,30.47L50.13,29.96ZM55.93,28L57.61,27.78L58.93,27.74L61.15,27.56L62.82,27.14L64.22,27.2L65.44,27.52L66.3,26.9L67.8,26.72L69.83,26.6L73.29,26.55L73.89,26.67L77.16,26.48L79.61,26.55L82.06,26.62L85.08,26.71L87.52,26.86L89.59,27.17L89.54,27.47L86.77,27.96L84.04,28.19L83.01,28.44L85.48,28.44L82.8,29.12L80.96,29.44L79.02,30.37L76.69,30.56L75.97,30.79L72.54,30.91L74.1,31.05L73.32,31.25L74.26,31.81L73.18,32.2L71.43,32.52L70.89,32.96L69.31,33.3L69.47,33.56L71.41,33.51L71.43,33.79L68.41,34.47L65.45,34.16L62.13,34.33L60.44,34.19L58.3,34.13L58.16,33.59L60.25,33.34L59.69,32.52L60.39,32.44L63.41,32.93L61.86,32.2L60.03,31.98L60.95,31.55L62.95,31.28L63.27,30.88L61.68,30.44L61.2,29.86L64.29,29.91L65.19,30.03L66.95,29.61L64.4,29.48L60.44,29.56L58.44,29.17L57.5,28.71L56.18,28.38ZM74.46,44.35L73.72,44.69L72.45,44.74L72.17,44.19L72.65,43.56L73.69,43.4L74.57,43.71L74.58,44.2ZM50.64,42.04L51.33,42.47L50.63,42.87L49.1,42.52L48.18,42.65L46.63,42.14L47.63,41.79L48.42,41.3L49.62,41.62L50.3,41.82ZM86.57,64.24L86.96,64.15L88.44,64.43L89.6,64.9L89.63,65.11L89.08,65.13L87.62,64.77ZM87.14,67.45L87.53,68L88.35,68.15L89.4,68.12L88.84,68.59L88.43,68.66L86.99,68.18L86.71,67.8Z',
  GB: 'M14.86,54.64L6.69,52.41L0,52.57L2.22,46.77L0,40.98L9.06,40.54L20.65,47.21ZM48.39,59.65L48.43,59.65L49.98,53.37L42.75,46.72L42.59,46.57L29.48,44.67L26.92,41.74L30.84,36.92L27.27,33.94L21.47,39.04L20.81,28.63L15.36,23.13L19.29,11.96L27.69,3.18L36.33,4.04L49.36,3.14L37.81,14.83L48.81,13.34L60.64,13.4L57.84,22.2L48.11,31.89L59.28,32.58L60.13,33.72L69.78,46.46L77.17,48.2L83.82,60.51L86.89,64.77L100,66.83L98.68,73.75L93.15,76.91L97.47,82.49L87.75,88.16L73.32,88.05L54.92,91.03L49.86,88.91L42.75,93.95L32.75,92.73L25.17,96.86L19.41,94.7L35.24,83.35L44.92,81.02L44.85,81.01L27.97,79.21L24.89,74.92L36.21,71.57L30.3,65.74L32.32,58.66Z',
  IE: 'M95.8,38.16L100,56.26L80.84,78.91L35.86,93.88L0,90.07L20.53,63.6L7.3,37.82L41.79,17.96L60.95,6.12L66.15,19.72L60.95,33.31L76.64,32.93Z',
  DE: 'M90.07,21.06L92.62,26.68L89.55,29.64L93.58,33.58L96.33,39.5L95.46,43.33L100,50.39L95.06,51.56L92.15,50.28L89.35,52.4L81.38,54.54L77.27,57.29L69.22,59.71L71.17,63.01L72.37,67.68L77.99,70.34L84.25,75.1L80.34,80.2L76.36,81.61L77.95,88.82L76.91,90.7L73.44,88.43L68.14,88.09L60.21,90.08L50.44,89.61L48.88,92.54L43.26,89.46L39.95,90.08L28.07,86.69L25.8,89.09L16.39,89.01L17.78,81.12L23.37,73.55L7.42,71.5L2.19,68.6L2.83,63.74L0.6,61.25L1.87,53.75L0,42.15L6.66,42.15L9.45,37.98L12.2,27.84L10.17,24.09L12.32,21.75L21.57,21.15L23.64,23.59L31.14,18.13L28.63,13.97L28.11,7.69L36.48,9.15L43.58,7.47L43.74,11.74L54.94,14.33L54.83,18.26L66.11,16.18L72.33,13.15L84.81,17.51Z',
  BE: 'M100,41.71L96.84,60.29L89.72,61.31L86.76,76.69L62.75,64.19L48.62,66.33L29.45,53.37L16.7,42.36L3.95,41.89L0,32.28L21.94,26.84L42.1,29.02L67.49,23.31L84.88,35.3Z',
  NL: 'M95.14,14.93L100,23.89L93.42,48.14L86.75,58.09L70.83,58.09L75.31,85.83L60.72,79.65L43.95,68.08L19.45,73.6L0,71.49L13.63,64.23L36.89,25.28L73.12,14.17Z',
  FR: 'M76.16,27.39L79.5,29.24L89.67,30.55L86.11,35.38L85.22,40.41L83.26,41.62L80.06,40.98L80.29,42.77L75.12,46.74L74.99,49.93L78.38,48.83L80.79,51.93L80.51,53.93L82.6,56.58L80.13,58.74L81.96,64.2L85.81,65.1L84.99,68.16L78.58,72.16L64.64,70.24L54.36,72.54L53.55,76.79L45.36,77.71L37.4,74.51L34.83,76.03L21.83,72.83L19,70.08L22.67,65.84L24.01,51.76L16.71,44.35L11.5,40.77L0.71,38.06L0,32.9L9.16,31.36L21.01,33.18L18.77,25.18L25.46,28.22L41.9,22.7L44.04,16.91L50.22,15.49L51.23,17.97L54.52,18.09L57.8,20.92L62.73,24.26L66.37,23.71L72.55,26.92L74.13,27.55ZM94.25,75.7L98.8,72.99L100,79.06L97.66,84.51L94.45,83.08L92.83,78.32Z',
  IT: 'M31.48,7.17L36.67,8.38L37.65,6.75L46.06,5.28L47.96,8.24L60.17,10.44L59.22,14.64L61.28,18.26L54.5,17.02L47.56,20.05L48.02,24.28L46.98,26.7L49.77,31.04L57.78,35.34L62.07,42.38L71.56,49.25L78.21,49.21L80.3,51.08L77.91,52.78L85.55,55.87L91.81,58.44L99.11,62.88L100,64.48L98.4,67.53L93.68,63.55L86.25,62.15L82.69,67.66L88.83,70.82L87.82,75.28L84.26,75.78L79.72,83.08L76.16,83.74L76.19,81.13L77.94,76.56L79.78,74.74L76.47,69.81L73.86,65.51L70.33,64.44L67.81,60.76L62.32,59.22L58.64,55.79L52.32,55.24L45.66,51.39L37.86,45.85L32.07,40.94L29.43,32.5L25.19,31.52L18.26,28.71L14.33,29.86L9.39,33.81L5.86,34.43L6.84,30.74L2.21,29.66L0,23.07L2.98,20.47L0.46,17.27L0.8,14.86L4.48,16.68L8.59,16.27L13.38,13.39L14.85,14.74L18.9,14.47L20.74,11.02L27.06,12.1L30.81,10.66ZM68.3,81.74L74.78,81L71.71,87.71L72.97,90.35L71.19,94.72L64.65,91.52L60.33,90.6L48.45,86.27L49.62,81.88L59.59,82.66ZM16.72,58.25L20.99,55.61L26.08,61.66L24.89,72.94L21.02,72.39L17.55,75.23L14.33,72.98L13.99,62.7L12.03,57.82Z',
  ES: 'M15.61,72.11L14.94,69.46L17.92,66.44L19.02,64.25L16.24,61.86L18.47,56.58L15.26,51.75L18.73,51.1L19.05,47.28L20.35,46.11L20.44,39.84L24.18,37.66L21.92,33.63L17.23,33.35L15.87,34.37L11.12,34.37L9.09,30.43L5.82,31.6L2.9,33.65L3.3,27.93L0,24.43L11.38,18.63L21.22,20.08L32.02,20.03L40.59,21.41L47.25,20.99L60.25,21.25L63.46,24.38L78.26,28.02L81.18,26.3L90.24,29.93L99.57,28.88L100,33.56L92.39,38.91L82.08,40.62L81.36,43.32L76.4,47.77L73.31,54.32L76.43,58.92L71.8,62.5L70.06,67.73L63.98,69.34L58.28,75.52L48.09,75.64L40.42,75.49L35.38,78.33L32.31,81.37L28.37,80.7L25.39,77.99L23.1,73.36Z',
  PT: 'M30.22,7.34L36.9,2.68L44.38,0L49.01,8.99L59.86,8.99L62.97,6.66L73.69,7.31L78.85,16.52L70.31,21.49L70.11,35.83L67.14,38.51L66.41,47.22L58.47,48.71L65.81,59.75L60.72,71.82L67.07,77.26L64.56,82.27L57.74,89.18L59.26,95.24L51.85,100L42.19,97.42L32.73,99.44L35.51,85.07L33.79,73.78L25.59,72.07L21.16,65.1L22.61,53.1L29.95,46.41L31.28,38.97L35.11,27.93L34.72,20.16L31.01,13.56Z',
  CZ: 'M42.03,30.78L49.21,35.67L60.48,36.97L59.55,41.15L67.77,44.27L70.01,40.35L80.4,42.04L81.82,46.78L93.09,47.7L100,55.14L95.54,55.17L93.2,57.88L89.71,58.55L88.73,61.98L85.79,62.69L85.41,64.1L80.24,65.66L73.54,65.41L71.42,68.73L64.45,65.89L57.32,66.66L45.62,62.05L40.28,63.18L31.74,69.37L20.52,64.51L11.98,58.01L4.3,54.38L2.67,48L0,43.5L11,40.2L16.6,36.44L27.49,33.52L31.3,30.63L35.28,32.37Z',
  PL: 'M94.54,30.18L94.97,34.62L97.76,38.45L97.69,42.44L91.68,44.5L94.76,49.16L94.97,53.63L100,62.39L98.95,65.21L93.96,66.38L84.85,74.73L87.41,79.26L85.24,78.66L75.7,74.8L68.46,76.23L63.73,75.19L57.76,77.35L52.69,73.78L48.57,75.16L47.99,74.55L43.4,69.6L35.91,68.99L34.97,65.84L28.07,64.72L26.58,67.32L21.12,65.24L21.74,62.47L14.25,61.61L9.48,58.36L5.35,51.95L6.15,48.48L3.65,43.11L0,39.53L2.79,36.85L0.47,31.75L7.31,28.79L23,24.15L35.66,20.75L45.68,22.45L46.44,24.89L56.13,25.01L68.5,26.15L86.98,26L92.12,27.09Z',
  AT: 'M100,44.83L98.99,50.27L91.5,50.32L94.05,53.21L89.63,61.78L87.09,64.04L75.42,64.36L68.7,67.38L57.71,66.36L38.6,62.91L35.62,58.28L22.47,60.59L20.93,63.14L12.82,61.24L6,60.88L0,58.44L2.02,55.17L1.54,52.82L5.52,52.08L12.29,55.78L14.16,52.26L25.92,52.82L35.48,50.43L41.86,50.84L46.04,53.57L47.29,51.31L45.37,42.62L50.17,40.93L54.87,34.79L64.76,39.08L72.3,33.61L77,32.62L87.33,36.68L93.62,36.01L99.76,38.51L98.66,40.2Z',
  CH: 'M80.86,33.71L81.68,37.69L78.26,43.24L88.44,47.38L100,47.99L98.21,57.26L88.27,61.08L71.5,58.21L66.61,67.36L55.86,68.09L51.95,64.49L39.25,72.15L28.34,73.22L18.57,68.4L10.83,58.48L0,62L0.41,51.78L16.94,39.07L16.2,33.33L26.47,35.39L32.74,31.53L51.95,31.68L56.6,26.78Z',
  DK: 'M39.86,77.89L25.92,81.2L9.48,78.33L0.63,66.26L0,44.02L3.6,38.16L9.87,31.65L28.97,30.29L36.65,24.28L54.11,18.14L53.41,29.33L46.99,36.4L49.57,42.51L61.39,45.78L56.07,54L49.57,51.64L33.91,67.29ZM93.11,53.37L100,64.27L87,81.86L64.21,69.61L61.16,60.55Z',
  SE: 'M3.17,74.58L6.36,70.38L12.41,65.39L14.82,56.85L10.19,53.15L9.74,43.5L14.45,36.67L21.66,36.8L24.2,33.92L21.55,31.43L32.84,21.2L40.13,13.13L44.92,7.94L51.91,7.97L53.85,3.92L67.55,5.09L68.62,0.3L73.13,0L82.85,3.56L94.19,8.51L94.4,19.72L96.84,22.55L84.32,24.61L77.27,29.69L78.4,34.14L66.84,39.99L52.78,46.26L47.49,56.5L52.67,61.63L59.61,65.67L52.93,73.87L45.36,75.57L42.59,87.78L38.47,94.61L29.65,93.9L25.51,99.67L17.1,100L14.77,93.13L8.69,84.87Z',
  NO: 'M99.28,31.27L92.8,32.8L89.73,33.15L91.34,30.48L86.46,28.97L80.56,30.26L78.69,33.04L75.06,34.73L70.98,33.81L66.03,34L61.8,31.99L59.51,32.99L57.16,33.15L56.6,35.65L49.44,35.04L48.43,37.16L44.77,37.14L42.27,39.85L38.46,44.07L32.56,49.41L33.95,50.71L32.62,52.22L28.85,52.16L26.39,55.72L26.62,60.77L29.05,62.7L27.79,67.16L24.62,69.77L22.95,71.96L20.39,69.63L12.89,74.03L7.82,74.92L2.56,72.98L1.2,68.89L0,60.12L3.5,57.67L13.54,54.48L21.05,50.56L28,45.26L37.15,37.92L43.51,35.06L53.96,30.29L62.31,28.62L68.56,28.82L74.35,25.68L81.28,25.84L88.11,25.08L100,27.87L95.1,28.89Z',
  FI: 'M73.11,12.65L71.76,19.1L85.83,25.23L77.35,32.16L88.05,42.64L81.85,50.51L90.13,57.36L86.39,63.36L100,69.66L96.52,74.35L87.98,79.66L68.31,91.41L51.62,92.14L35.43,95.51L20.46,97.45L15.13,92.42L6.23,89.42L8.28,80.36L3.81,72.06L8.21,66.69L16.56,60.91L37.58,50.95L43.71,49.02L42.78,45.13L29.97,40.78L26.89,37.2L26.62,23.04L12.29,16.78L0,12.28L5.53,9.85L15.76,14.71L27.75,14.26L37.62,16.48L46.39,12.4L50.93,5.66L65.2,2.55L76.99,6.21Z',
  JP: 'M77.31,44.48L71.6,50.72L71.69,57.12L69.37,62.07L70.44,65.17L67.2,69.54L59.28,72.45L48.39,72.83L39.56,79.91L35.41,77.53L35.14,72.89L24.36,74.26L17.02,77.18L9.77,77.3L16.06,81.86L11.91,92.39L7.92,95L4.91,92.59L6.45,87L2.52,85.2L0,80.95L5.87,79.04L9.1,75.15L15.35,71.94L19.88,67.71L32.22,65.86L38.84,67.13L45.34,56.11L49.47,59.07L58.57,52.87L62.09,50.47L65.97,42.88L64.93,35.92L67.54,31.99L74.12,30.86L77.51,39.45ZM94.22,14.85L98.62,12.23L100,19.19L90.81,20.89L85.36,27.04L75.64,22.81L72.25,29.58L65.37,29.68L64.5,23.52L67.58,18.75L74.19,18.4L75.99,9.83L77.85,5L85.12,11.46L89.87,13.53ZM18.36,79.91L21.8,76.22L25.32,76.93L27.87,74.33L32.42,75.66L33.2,77.79L29.72,81.54L27.18,79.56L23.99,80.99L22.36,84.62L18.32,82.86Z',
  CN: 'M58.35,78.74L57.02,78.23L56.97,76.83L57.77,76.09L59.56,75.64L60.49,75.67L60.85,76.3L60.14,77.01L59.76,77.96ZM10.73,39.37L10.6,38.44L11.72,38.01L10.25,35.18L13.48,34.53L14.32,34.17L15.49,31.25L18.73,31.79L19.64,31.05L19.71,29.42L21.06,29.26L22.31,28.18L22.95,28.04L23.37,29.18L24.74,30.05L27.06,30.66L28.19,31.97L27.56,33.88L28.15,34.58L30.09,34.86L32.28,35.09L34.25,36.1L35.26,36.29L36,37.79L36.96,38.76L38.75,38.72L42.12,39.08L44.29,38.86L45.9,39.1L48.31,40.09L50.28,40.09L51,40.6L52.9,39.72L55.53,39.15L57.98,39.09L59.88,38.52L61.05,37.65L62.19,37.1L61.93,36.56L61.41,35.93L62.26,34.88L63.18,35.03L64.86,35.36L66.48,34.5L68.96,33.86L70.16,32.79L71.31,32.32L73.68,32.11L74.96,32.29L75.14,31.71L73.66,30.57L72.36,30.05L71.1,30.65L69.49,30.4L68.57,30.6L68.15,29.94L69.3,28.31L70.1,27.08L72.05,27.7L74.35,26.67L74.33,25.95L75.81,24.22L76.72,23.7L76.69,22.8L75.8,22.41L77.14,21.6L79.17,21.31L81.33,21.26L83.77,21.75L85.2,22.35L86.21,23.99L86.82,24.69L87.39,25.69L87.99,27.29L90.83,27.81L92.76,28.97L93.42,30.5L95.9,30.5L97.31,29.86L100,29.38L99.14,30.85L98.52,31.44L97.95,33.23L96.86,34.81L94.88,34.53L93.48,35.1L93.91,36.5L93.67,38.42L92.84,38.47L92.85,39.29L91.8,38.33L91.15,39.25L88.63,39.95L88.89,40.81L87.48,40.75L86.71,40.24L85.59,41.39L83.79,42.27L82.46,43.32L80.18,43.79L78.99,44.55L77.23,45L78.09,44.24L77.75,43.61L79.05,42.51L78.18,41.66L76.76,42.23L74.92,43.37L73.92,44.42L72.32,44.5L71.49,45.26L72.35,46.36L73.68,46.63L73.73,47.36L75.03,47.84L76.85,46.67L78.3,47.31L79.35,47.35L79.61,48.2L77.31,48.66L76.55,49.54L74.96,50.36L74.13,51.5L75.88,52.39L76.52,54L77.51,55.49L78.62,56.74L78.59,57.95L77.57,58.4L77.96,59.27L78.92,59.77L78.67,61.1L78.25,62.39L77.34,62.54L76.15,64.3L74.83,66.44L73.32,68.39L71.08,69.89L68.81,71.27L66.97,71.45L65.98,72.18L65.41,71.65L64.49,72.46L62.22,73.27L60.49,73.52L59.93,75.24L59.03,75.34L58.6,74.16L58.99,73.53L56.8,73.01L56.03,73.27L54.39,72.85L53.61,72.18L53.87,71.25L52.38,70.95L51.59,70.33L50.21,71.2L48.62,71.39L47.32,71.38L46.45,71.78L45.6,72.02L45.85,73.89L44.98,73.84L44.83,73.46L44.78,72.79L43.59,73.26L42.88,72.96L41.67,72.35L42.15,70.99L41.11,70.68L40.73,69.18L39.01,69.45L39.2,67.51L40.74,66.15L40.81,64.81L40.76,63.56L40.05,63.17L39.51,62.21L38.55,62.33L36.79,62.09L37.35,61.4L36.58,60.39L35.42,61.08L34.05,60.68L32.17,61.72L30.69,62.93L29.38,63.13L28.66,62.69L27.8,62.65L26.64,62.28L25.76,62.69L24.68,63.9L24.54,62.62L23.54,62.96L21.64,62.8L19.8,62.43L18.48,61.71L17.21,61.39L16.67,60.61L15.74,60.38L14.1,59.31L12.79,58.81L12.12,59.2L9.85,58.06L8.25,57.03L7.79,55.23L8.97,55.45L9.02,54.62L8.37,53.78L8.53,52.45L6.78,50.55L4.1,49.89L3.62,48.63L2.42,47.87L2.12,47.41L1.88,46.48L1.94,45.84L0.95,45.47L0.41,45.63L0,44.13L0.46,43.75L0.24,43.37L1.8,42.6L2.92,42.28L4.65,42.5L5.26,41.46L7.35,41.27L7.93,40.62L10.5,39.74Z',
  AU: 'M85.39,83.95L86.87,84.11L87.05,87.07L86.2,87.92L85.94,89.92L85.07,89.24L83.35,90.97L82.84,90.84L81.31,90.76L79.78,88.63L79.44,86.99L78,84.83L78.07,83.69L79.69,83.91L82.09,84.76L83.45,84.42ZM31.84,62.59L29.21,63.86L27.05,64.44L26.58,65.74L25.66,66.75L23.54,66.81L21.99,67.03L19.79,66.58L18,66.85L16.3,66.96L14.82,68.29L14.09,68.18L12.84,68.88L11.65,69.67L9.83,69.57L8.17,69.57L5.53,67.99L4.2,67.51L4.25,66.09L5.49,65.75L5.91,65.18L5.82,64.29L6.12,62.56L5.84,61.09L4.53,58.57L4.13,57.16L4.23,55.74L3.24,54.12L3.18,53.39L2.08,52.4L1.76,50.45L0.35,48.49L0,47.43L1.09,48.5L0.26,46.2L1.49,46.92L2.23,47.88L2.18,46.61L0.95,44.65L0.72,43.87L0.13,43.12L0.41,41.69L0.91,41.07L1.25,39.83L0.99,38.38L2.01,36.59L2.2,38.48L3.26,36.77L5.27,35.94L6.49,34.88L8.39,33.97L9.51,33.77L10.2,34.08L12.16,33.16L13.66,32.88L14.04,32.33L14.7,32.11L16.07,32.17L18.68,31.44L20.04,30.34L20.67,29.01L22.13,27.74L22.25,26.75L22.31,25.4L24.05,23.29L25.09,25.43L26.16,24.94L25.27,23.76L26.05,22.56L27.14,23.1L27.45,21.21L28.81,19.98L29.41,19L30.66,18.58L30.69,17.88L31.79,18.17L31.83,17.55L32.92,17.19L34.12,16.86L35.96,18L37.34,19.47L38.89,19.49L40.47,19.72L39.95,18.35L41.14,16.36L42.26,15.71L41.87,15.09L42.95,13.67L44.46,12.8L45.73,13.09L47.82,12.62L47.78,11.35L45.95,10.53L47.28,10.17L48.92,10.79L50.25,11.81L52.34,12.44L53.05,12.19L54.59,12.96L56.04,12.25L56.98,12.46L57.56,11.98L58.69,13.21L58.03,14.54L57.09,15.55L56.23,15.63L56.52,16.63L55.79,17.87L54.91,19.09L55.09,19.79L57.07,21.16L58.98,21.96L60.26,22.82L62.06,24.29L62.76,24.29L64.05,24.92L64.44,25.69L66.81,26.53L68.45,25.68L68.94,24.35L69.44,23.25L69.75,21.88L70.51,19.91L70.16,18.7L70.34,17.98L70.05,16.56L70.38,14.69L70.86,14.18L70.47,13.35L71.07,12.04L71.54,10.67L71.6,9.96L72.53,9.03L73.23,10.24L73.4,11.8L74.02,12.1L74.12,13.15L75.03,14.41L75.21,15.82L75.12,16.72L76.02,18.67L77.62,17.74L78.44,18.79L79.63,19.76L79.37,20.86L79.91,22.99L80.29,24.23L80.91,24.53L81.58,26.66L81.34,27.95L82.15,29.63L84.84,30.93L86.6,32.12L88.27,33.2L87.94,33.8L89.36,35.36L90.33,38.05L91.32,37.5L92.33,38.58L92.94,38.2L93.37,40.83L95.13,42.36L96.29,43.31L98.23,45.32L98.93,47.32L98.99,48.73L98.82,50.27L100,52.38L99.86,54.58L99.43,55.73L98.76,57.95L98.81,59.38L98.32,61.16L97.22,63.42L95.38,64.64L94.47,66.57L93.64,67.8L92.9,69.94L91.95,71.18L91.32,73.04L91,74.75L91.12,75.54L89.7,76.4L86.92,76.49L84.62,77.51L83.48,78.47L81.98,79.54L79.92,78.44L78.4,78L78.78,76.71L77.42,77.18L75.25,78.98L73.1,78.31L71.69,77.91L70.26,77.73L67.86,77.01L66.26,75.48L65.79,73.59L65.22,72.34L63.99,71.33L61.6,71.03L62.42,69.82L61.82,67.98L60.6,69.7L58.39,70.16L59.7,68.78L60.07,67.35L61.03,66.13L60.83,64.29L58.81,66.41L57.25,67.26L56.3,69.24L54.36,68.21L54.44,66.9L52.89,65.09L51.57,64.16L52.04,63.59L48.85,62.08L47.11,62.01L44.72,60.8L40.26,61.04L37.05,61.92L34.21,62.75Z',
  BR: 'M52.51,99.69L51.81,98.25L52.93,97.04L51.46,95.31L49.46,93.9L46.84,92.27L45.89,92.34L43.33,90.37L41.68,90.64L45.08,87.17L47.96,84.7L49.66,83.66L51.81,82.25L51.86,80.22L50.59,78.75L49.32,79.24L49.82,77.77L50.17,76.26L50.17,74.86L49.25,74.4L48.29,74.81L47.35,74.7L47.05,73.72L46.81,71.38L46.33,70.62L44.62,69.93L43.57,70.43L40.88,69.94L41.05,66.49L40.3,65.07L41.1,64.54L40.85,63.09L41.55,61.97L42,59.97L41.4,58.38L40.01,57.67L39.74,56.66L40.11,55.19L35.23,55.09L34.24,52.12L34.99,52.08L34.96,50.98L34.46,50.24L34.35,48.76L32.87,48.01L31.26,48.03L30.21,47.29L28.49,46.79L27.49,45.84L24.63,45.41L21.86,43.13L22.07,41.43L21.76,40.45L22.03,38.54L18.7,38.97L17.35,39.93L15.12,40.96L14.55,41.73L13.24,41.78L11.35,41.57L9.91,42.01L8.76,41.72L8.92,37.84L6.83,39.34L4.59,39.28L3.62,37.92L1.94,37.77L2.48,36.68L1.06,35.13L0,32.84L0.67,32.37L0.67,31.29L2.21,30.56L1.95,29.18L2.61,28.29L2.79,27.11L5.7,25.37L7.79,24.88L8.13,24.5L10.43,24.62L11.57,17.63L11.63,16.53L11.23,15.07L10.11,14.14L10.12,12.29L11.55,11.87L12.06,12.13L12.14,11.16L10.66,10.9L10.62,9.3L15.58,9.36L16.43,8.48L17.13,9.29L17.64,10.79L18.11,10.48L19.52,11.82L21.5,11.66L21.99,10.88L23.88,10.28L24.94,9.86L25.23,8.79L27.05,8.06L26.91,7.53L24.75,7.31L24.4,5.7L24.51,4L23.36,3.34L23.84,3.1L25.73,3.43L27.75,4.07L28.49,3.46L30.32,3.07L33.16,2.11L34.1,1.14L33.76,0.42L35.09,0.31L35.67,0.9L35.35,2.01L36.23,2.4L36.8,3.58L36.1,4.48L35.69,6.65L36.34,7.94L36.53,9.12L38.1,10.31L39.35,10.44L39.63,9.94L40.44,9.83L41.59,9.38L42.42,8.7L43.83,8.92L44.44,8.83L45.83,9.04L46.06,8.52L45.64,8.01L45.89,7.27L46.92,7.5L48.12,7.24L49.58,7.78L50.69,8.3L51.48,7.61L52.05,7.72L52.39,8.44L53.61,8.26L54.6,7.29L55.37,5.41L56.88,3.08L57.75,2.96L58.38,4.37L59.8,8.82L61.17,9.24L61.23,11L59.33,13.1L60.12,13.87L64.62,14.27L64.71,16.82L66.65,15.15L69.85,16.07L74.08,17.62L75.32,19.11L74.91,20.52L77.87,19.74L82.82,21.09L86.63,20.99L90.4,23.1L93.65,25.95L95.62,26.68L97.79,26.79L98.72,27.59L99.58,30.83L100,32.38L98.99,36.59L97.69,38.25L94.1,41.79L92.48,44.67L90.59,46.89L89.96,46.93L89.24,48.81L89.43,53.58L88.72,57.51L88.45,59.19L87.64,60.19L87.19,63.6L84.6,66.92L84.17,69.55L82.11,70.66L81.51,72.19L78.74,72.18L74.73,73.16L72.95,74.29L70.09,75.04L67.1,77.06L64.94,79.59L64.56,81.49L64.99,82.9L64.52,85.47L63.94,86.72L62.15,88.12L59.33,92.6L57.09,94.62L55.36,95.81L54.19,98.24Z',
};

// Country name -> flag key, for matching the same free-text Location field
// the state badge reads. Sorted longest-name-first so 'northern ireland'
// (-> UK) is checked before the shorter 'ireland' (-> IE) it contains, same
// precedence trick as STATE_NAMES_BY_LENGTH_DESC. Matched with word-ish
// boundaries (see countryNameMatches) rather than plain substring search,
// so short tokens like 'uk' don't fire inside an unrelated word (e.g.
// 'Milwaukee').
const COUNTRY_NAME_TO_CODE = {
  'united states of america': 'US', 'united states': 'US', 'u.s.a.': 'US', 'u.s.': 'US', usa: 'US',
  mexico: 'MX',
  canada: 'CA',
  'united kingdom': 'GB', 'great britain': 'GB', britain: 'GB', 'u.k.': 'GB', uk: 'GB',
  'northern ireland': 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  ireland: 'IE',
  germany: 'DE',
  belgium: 'BE',
  netherlands: 'NL', holland: 'NL',
  france: 'FR',
  italy: 'IT',
  spain: 'ES',
  portugal: 'PT',
  'czech republic': 'CZ', czechia: 'CZ',
  poland: 'PL',
  austria: 'AT',
  switzerland: 'CH',
  denmark: 'DK',
  sweden: 'SE',
  norway: 'NO',
  finland: 'FI',
  japan: 'JP',
  china: 'CN',
  australia: 'AU',
  brazil: 'BR',
};
const COUNTRY_NAMES_BY_LENGTH_DESC = Object.keys(COUNTRY_NAME_TO_CODE).sort((a, b) => b.length - a.length);

function countryNameMatches(lowerText, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`).test(lowerText);
}

// Same precedence as the state lookup: a resolvable US state means the
// country is the US, full stop, even when the Location text never spells
// out 'United States' (the common case for a hand-typed 'City, ST'). Only
// falls through to matching a country name when no US state was found, so
// a domestic 'Portland, ME' can never get shadowed by 'New England'-style
// text, and a US state name never collides with a same-named country.
function countryCodeFromLocation(location) {
  const text = location ? String(location).trim() : '';
  if (!text) return null;
  if (stateAbbrFromLocation(text)) return 'US';
  const lower = text.toLowerCase();
  const nameMatch = COUNTRY_NAMES_BY_LENGTH_DESC.find((name) => countryNameMatches(lower, name));
  return nameMatch ? COUNTRY_NAME_TO_CODE[nameMatch] : null;
}

// A US brewery's Location already gets its own green state-silhouette badge
// (see buildRightBadgeHtml above) or, lacking a resolvable state, still
// reads as domestic from context - either way, spelling out "United States"
// again in the Brewery/Location table (see buildBeerTableHtml below) is
// redundant in a way a non-US country never is, since every other country
// on the card gets its own flag badge instead of a second text mention.
// Untappd's own brewery pages are the actual source of the redundancy -
// they render a brewery's location as e.g. "Morris Plains, NJ United
// States" with no comma before the country (see parseBreweryHtml in
// productImport.js) - so the match below tolerates a missing comma same as
// a present one. Only strips a trailing US mention, and only from the
// display copy here - buildRightBadgeHtml/buildCountryFlagHtml above still
// read talker.location's original, unmodified text, so this can't affect
// which badge shows up.
const US_LOCATION_SUFFIX_RE = /,?\s*(united states of america|united states|u\.s\.a\.|usa)\.?\s*$/i;

function formatLocationForDisplay(location) {
  const text = location ? String(location).trim() : '';
  return text.replace(US_LOCATION_SUFFIX_RE, '').trim();
}

function buildCountryFlagHtml(talker) {
  const code = countryCodeFromLocation(talker.location);
  const flag = code && COUNTRY_FLAGS[code];
  if (!flag) return '';
  // No country-letter label under the flag (e.g. "US") - just the flag
  // itself. Unlike the state badge's silhouette (which needs its own "NJ"
  // label to be legible as a specific state), the flag graphic already
  // identifies the country on its own.
  return `
    <div class="card__country-badge">
      <div class="card__country-badge-image"><svg viewBox="0 0 60 40" aria-hidden="true">${flag.svg}</svg></div>
    </div>
  `;
}

// Untappd-style rating callout: a 5-dot rating with its decimal value (e.g.
// "4.27"), optionally next to the beer's style. includeStyle adds the
// style to the right of the rating, replacing its old spot as a plain row
// in buildBeerTableHtml - opt-in (Shelf Talkers only, not Display Signs,
// which don't call buildBeerTableHtml at all and were never asked about
// here) rather than baking it into every caller of this shared function.
function buildBeerRatingHtml(talker, { includeStyle = false } = {}) {
  const ratingNum = Number(talker.untappdRating);
  // A rating of exactly 0 is treated the same as no rating at all: it's
  // Untappd's own sentinel for "no computed average yet" (shown on the real
  // page as empty dots and "(N/A)", even alongside a nonzero check-in
  // count), not a real zero score - see the matching note on asRatingAttr
  // in server/productImport.js, which is what keeps a freshly-imported beer
  // from ever landing here with "0" in the first place. This check exists
  // as a safety net for talkers imported before that fix, or a "0" typed
  // straight into the rating field by hand.
  const hasRating = talker.untappdRating != null && String(talker.untappdRating).trim() !== '' && Number.isFinite(ratingNum) && ratingNum > 0;
  const style = includeStyle && talker.style ? String(talker.style).trim() : '';
  // Untappd's own beer page always renders this widget, showing empty dots
  // and "(N/A)" in place of a score for a beer with no ratings yet rather
  // than leaving the widget out (confirmed via a real screenshot of
  // Untappd's own display - the reference for the N/A styling below). So
  // the rating detail is shown whenever there's a real beer on file, not
  // only when it happens to have a numeric rating - `hasBeerData` reuses
  // the same brewery/style/ABV/IBU signal buildBeerTableHtml already checks
  // for "is there anything here at all", so an untouched blank Beer entry
  // (nothing looked up yet) still renders nothing, same as before.
  const hasBeerData = hasRating || !!style || ['brewery', 'style', 'abv', 'ibu']
    .some((key) => talker[key] && String(talker[key]).trim() !== '');
  if (!hasBeerData) return '';

  const clamped = hasRating ? Math.max(0, Math.min(5, ratingNum)) : 0;
  const dots = Array.from({ length: 5 }, (_, i) => {
    const fill = clamped - i;
    const cls = fill >= 1 ? 'is-full' : fill > 0 ? 'is-half' : 'is-empty';
    return `<span class="card__beer-dot ${cls}"></span>`;
  }).join('');
  const countNum = Number(talker.untappdRatingCount);
  const hasCount = talker.untappdRatingCount != null && String(talker.untappdRatingCount).trim() !== '' && Number.isFinite(countNum);
  const countHtml = hasCount
    ? `<div class="card__beer-rating-count">${countNum.toLocaleString('en-US')} Rating${countNum === 1 ? '' : 's'}</div>`
    : '';
  const scoreHtml = hasRating
    ? `<span class="card__beer-rating-num">${clamped.toFixed(2)}</span>`
    : '<span class="card__beer-rating-num card__beer-rating-num--na">(N/A)</span>';
  const detailHtml = `
    <div class="card__beer-rating-detail">
      <div class="card__beer-rating-label">Untappd Rating</div>
      <div class="card__beer-dots-row">${dots}${scoreHtml}</div>
      ${countHtml}
    </div>
  `;

  let styleHtml = '';
  if (style) {
    const swatch = beerStyleColor(style);
    styleHtml = `
      <div class="card__beer-style">
        <div class="card__beer-rating-label">Style</div>
        <div class="card__beer-style-value" style="background: ${swatch.bg}; color: ${swatch.fg}">${escapeHtml(style)}</div>
      </div>
    `;
  }

  return `<div class="card__beer-rating">${detailHtml}${styleHtml}</div>`;
}

function beerTableCellHtml(label, value) {
  return `
    <div class="card__beer-table-cell">
      <div class="card__beer-table-label">${escapeHtml(label)}</div>
      <div class="card__beer-table-value">${escapeHtml(value)}</div>
    </div>
  `;
}

// Brewery/Location/ABV/IBU info table, matching an Untappd product page.
// Style used to be a row here too; it's now called out next to the Untappd
// rating instead (see buildBeerRatingHtml's includeStyle) for more visual
// weight, so it isn't repeated here. Rows with no value (IBU is often not
// on file) are left out rather than shown blank. ABV and IBU share one row
// with a vertical divider between them instead of each getting a full-width
// row to themselves - both are short values, so a shared row reads as one
// glance instead of two, and frees a row's worth of height for the rest of
// the beer facts, which run larger now too (see the CSS this pairs with).
function buildBeerTableHtml(talker) {
  const simpleRows = [
    ['Brewery', talker.brewery],
    ['Location', formatLocationForDisplay(talker.location)],
  ].filter(([, value]) => value && String(value).trim() !== '');

  const abv = talker.abv && String(talker.abv).trim() !== '' ? talker.abv : '';
  const ibu = talker.ibu && String(talker.ibu).trim() !== '' ? talker.ibu : '';

  let abvIbuHtml = '';
  if (abv && ibu) {
    abvIbuHtml = `
      <div class="card__beer-table-row">
        ${beerTableCellHtml('ABV', abv)}
        <div class="card__beer-table-divider"></div>
        ${beerTableCellHtml('IBU', ibu)}
      </div>
    `;
  } else if (abv || ibu) {
    abvIbuHtml = `
      <div class="card__beer-table-row">
        <div class="card__beer-table-label">${abv ? 'ABV' : 'IBU'}</div>
        <div class="card__beer-table-value">${escapeHtml(abv || ibu)}</div>
      </div>
    `;
  }

  const simpleRowsHtml = simpleRows.map(([label, value]) => `
    <div class="card__beer-table-row">
      <div class="card__beer-table-label">${escapeHtml(label)}</div>
      <div class="card__beer-table-value">${escapeHtml(value)}</div>
    </div>
  `).join('');

  if (!simpleRowsHtml && !abvIbuHtml) return '';
  return `<div class="card__beer-table">${simpleRowsHtml}${abvIbuHtml}</div>`;
}

// plain forces the bare Regular/Sale Price layout regardless of Talker
// Style, skipping the Closeout/Chilled badge and the Super Sale callout -
// used for Quarter Size Shelf Talkers (see buildCardElement's isQuarter
// branch below), which only ever show Product Title/Size/Regular Price/
// Sale Price, no matter what Talker Style is selected.
function buildPricingHtml(talker, plain = false) {
  const talkerType = talker.talkerType || 'standard';
  const hasSale = talker.salePrice && Number(talker.salePrice) > 0 && Number(talker.salePrice) !== Number(talker.price);

  if (!plain && talkerType === 'supersale') {
    // Matches the store's printed Super Sale signs: a stylized "Super Sale
    // Price!!!" callout above the actual price (the sale price if one was
    // given, otherwise just the regular price), with the regular price
    // called out separately underneath when there's a sale price to compare
    // it to. The callout's own size is user-adjustable (Super Sale Price!!!
    // Font Size box) the same way Title/Description are - see
    // fontSizeOverrideAttr above. .card__supersale-text's base rule always
    // multiplies by --price-fit (unlike Title/Description, it has no Auto
    // Size checkbox of its own to gate that on), so includePriceFit is
    // unconditionally true here.
    // superSaleStyle is applied to both the callout text and the price
    // number below it (not just the text) so the price always renders at
    // the same size as the "Super Sale Price!!!" lettering, whether that's
    // the shared 0.11 default (see .card__supersale-text/-price in
    // styles.css) or a user-typed override - the two are meant to read as
    // one callout at one size, not a smaller number under bigger lettering.
    const bigPrice = hasSale ? talker.salePrice : talker.price;
    const superSaleStyle = fontSizeOverrideAttr(talker.superSaleFontSize, SIGN_LAYOUTS.talker.printWidth, true);
    return `
      <div class="card__supersale-text"${superSaleStyle}>Super Sale Price!!!</div>
      <div class="card__supersale-price"${superSaleStyle}>${formatMoney(bigPrice)}</div>
      ${hasSale ? `<div class="card__regular-price">Regular Price ${formatMoney(talker.price)}</div>` : ''}
    `;
  }

  // "closeout", "chilled" and "standard" all show the same regular/sale
  // price layout; closeout/chilled just add their own badge above it
  // (skipped entirely when plain). The badge's own size is user-adjustable
  // (CLOSEOUT!! Font Size box) the same way Super Sale Price!!! is above -
  // .card__closeout-badge's base rule always multiplies by --price-fit
  // (no Auto Size checkbox of its own), so includePriceFit is
  // unconditionally true here too.
  let badge = '';
  if (!plain) {
    if (talkerType === 'closeout') {
      const closeoutStyle = fontSizeOverrideAttr(talker.closeoutFontSize, SIGN_LAYOUTS.talker.printWidth, true);
      badge = `<div class="card__closeout-badge"${closeoutStyle}>CLOSEOUT!!</div>`;
    } else if (talkerType === 'chilled') badge = '<div class="card__chilled-badge">Also Available Chilled</div>';
  }
  const regular = formatMoney(talker.price);
  return `
    ${badge}
    <div class="card__prices">
      ${hasSale ? `<div class="card__sale-price">Sale Price ${formatMoney(talker.salePrice)}</div>` : ''}
      ${regular ? `<div class="card__regular-price">Regular Price ${regular}</div>` : ''}
    </div>
  `;
}

// ================================================================
// Display Signs - a second, landscape card format for the store's Small
// (6-up) and Large (2-up) printed display signs, distinct from the
// portrait Shelf Talker card above. Reuses the same talker fields (plus
// signSize), but lays title/price out in wide rows instead of a
// stacked block, and adds the header tagline + "SALE/PRICE" edge lettering
// the store's existing sign templates use.
// ================================================================

function buildSignRailHtml(side) {
  const saleCol = `<div class="sign__rail-col">${'SALE'.split('').map((ch) => `<span>${ch}</span>`).join('')}</div>`;
  const priceCol = `<div class="sign__rail-col">${'PRICE'.split('').map((ch) => `<span>${ch}</span>`).join('')}</div>`;
  // Always SALE-then-PRICE reading left-to-right, on both rails - matching
  // the store's printed signs, which don't mirror the right side (it reads
  // "SALE PRICE" there too, not "PRICE SALE").
  return `<div class="sign__rail sign__rail--${side}">${saleCol}${priceCol}</div>`;
}

// The edge lettering marks any kind of special pricing, not just a plain
// sale price - matches the store's reference signs, which show it on
// Closeout and Super Sale signs even when illustrated without a distinct
// sale price. "Chilled" isn't a discount, so it doesn't trigger the rails.
function signHasDiscount(talker) {
  const talkerType = talker.talkerType || 'standard';
  const hasSale = talker.salePrice && Number(talker.salePrice) > 0 && Number(talker.salePrice) !== Number(talker.price);
  return talkerType === 'closeout' || talkerType === 'supersale' || hasSale;
}

// Single-line version of the wine ratings list for the sign's rating/size
// row - only the first rating fits that row, matching the reference signs
// (which always show exactly one).
function buildRatingsInlineHtml(talker) {
  if (!Array.isArray(talker.ratings) || !talker.ratings.length) return '';
  const first = talker.ratings.find((r) => r && (r.reviewer || r.score));
  if (!first) return '';
  return `${escapeHtml(first.score || '')} Pts ${escapeHtml(first.reviewer || '')}`.trim();
}

// The rating/badge and size row. Sits directly above the price row at the
// bottom of the sign (see .sign__footer-block), so the rating lines up over
// the sale price and the size over the regular price, matching the store's
// printed Large signs. Only called for Large signs (see
// buildLargeSignBodyHtml below), so both the CLOSEOUT!! badge's and the
// rating's font-size overrides are measured against the Large sign's own
// printWidth - same user-adjustable boxes (CLOSEOUT!! Font Size, Ratings
// Font Size) as the Shelf Talker card's .card__closeout-badge/.card__ratings
// above, and .sign__closeout-badge's/.sign__rating's base rules always
// multiply by --price-fit too, so includePriceFit is true for both here.
function buildSignMetaRowHtml(talker, leftHtml) {
  const talkerType = talker.talkerType || 'standard';
  const ratingsStyle = fontSizeOverrideAttr(talker.ratingsFontSize, SIGN_LAYOUTS['sign-large'].printWidth, true);
  let left = leftHtml ? `<div class="sign__rating"${ratingsStyle}>${leftHtml}</div>` : '';
  if (talkerType === 'closeout') {
    const closeoutStyle = fontSizeOverrideAttr(talker.closeoutFontSize, SIGN_LAYOUTS['sign-large'].printWidth, true);
    left = `<div class="sign__closeout-badge"${closeoutStyle}>CLOSEOUT!!</div>`;
  } else if (talkerType === 'chilled') left = '<div class="sign__chilled-badge">Also Available Chilled</div>';
  if (!left && !talker.size) return '';
  return `
    <div class="sign__meta-row">
      <div class="sign__meta-row-left">${left}</div>
      ${talker.size ? `<div class="sign__size">${escapeHtml(talker.size)}</div>` : '<div></div>'}
    </div>
  `;
}

// Price row for Large signs: sale/super-sale price on the left, regular
// price on the right (or regular price alone, right-aligned, when there's
// no sale). Super Sale matches the reference sign's own printed layout
// exactly: same .sign__sale-price line as a normal sale, just with "Super"
// prepended - not a separate larger/centered price treatment (that's still
// what Small signs use; this is Large-only, same as the rest of this
// function).
function buildSignPriceRowHtml(talker) {
  const talkerType = talker.talkerType || 'standard';
  const hasSale = talker.salePrice && Number(talker.salePrice) > 0 && Number(talker.salePrice) !== Number(talker.price);
  const regular = formatMoney(talker.price);

  if (talkerType === 'supersale') {
    const bigPrice = hasSale ? talker.salePrice : talker.price;
    return `
      <div class="sign__price-row">
        <div class="sign__sale-price">Super Sale Price ${formatMoney(bigPrice)}</div>
        ${hasSale ? `<div class="sign__regular-price">Regular Price ${regular}</div>` : '<div></div>'}
      </div>
    `;
  }

  return `
    <div class="sign__price-row">
      ${hasSale ? `<div class="sign__sale-price">Sale Price ${formatMoney(talker.salePrice)}</div>` : '<div></div>'}
      ${regular ? `<div class="sign__regular-price">Regular Price ${regular}</div>` : '<div></div>'}
    </div>
  `;
}

function buildLargeSignBodyHtml(talker) {
  const isBeer = talker.category === 'beer';
  const ratingHtml = isBeer ? '' : buildRatingsInlineHtml(talker);
  const refWidthIn = SIGN_LAYOUTS['sign-large'].printWidth;
  const titleAutoSize = !!talker.titleAutoSize;
  const titleStyle = fontSizeOverrideAttr(talker.titleFontSize, refWidthIn, false);
  const descriptionAutoSize = !!talker.descriptionAutoSize;
  const descriptionStyle = fontSizeOverrideAttr(talker.descriptionFontSize, refWidthIn, descriptionAutoSize);
  return `
    <div class="sign__title"${titleStyle} data-fit="title" data-auto-size="${titleAutoSize}">${escapeHtml(talker.title || (isBeer ? 'Beer Name' : 'Product Name'))}</div>
    ${!isBeer && talker.vintage ? `<div class="sign__vintage">${escapeHtml(talker.vintage)}</div>` : ''}
    <div class="sign__description"${descriptionStyle} data-fit="description" data-auto-size="${descriptionAutoSize}">${escapeHtml(talker.description || '')}</div>
    ${isBeer ? buildBeerRatingHtml(talker) : ''}
    <div class="sign__footer-block">
      ${buildSignMetaRowHtml(talker, ratingHtml)}
      ${buildSignPriceRowHtml(talker)}
    </div>
  `;
}

// Small sign: just a name and a big price, no description/rating - matches
// the store's blank Small Display Sign template.
function buildSmallSignBodyHtml(talker) {
  const isBeer = talker.category === 'beer';
  const talkerType = talker.talkerType || 'standard';
  const hasSale = talker.salePrice && Number(talker.salePrice) > 0 && Number(talker.salePrice) !== Number(talker.price);
  const titleAutoSize = !!talker.titleAutoSize;
  const titleStyle = fontSizeOverrideAttr(talker.titleFontSize, SIGN_LAYOUTS['sign-small'].printWidth, false);

  let priceHtml;
  if (talkerType === 'supersale') {
    const bigPrice = hasSale ? talker.salePrice : talker.price;
    // Same user-adjustable callout size as the Shelf Talker card's
    // .card__supersale-text (see buildPricingHtml above) - .sign__supersale-
    // text's base rule also always multiplies by --price-fit, so
    // includePriceFit is true here too. --sign-text (Small vs Large's
    // shared text-scale multiplier) is left out of the override on purpose,
    // same as the title override two lines up - it's specific to the base
    // CSS rule this inline style replaces, not to the typed point size.
    const superSaleStyle = fontSizeOverrideAttr(talker.superSaleFontSize, SIGN_LAYOUTS['sign-small'].printWidth, true);
    priceHtml = `
      <div class="sign__supersale-text"${superSaleStyle}>Super Sale Price!!!</div>
      <div class="sign__small-price sign__supersale-price">${formatMoney(bigPrice)}</div>
    `;
  } else {
    // Same user-adjustable badge size as the Large sign's own
    // .sign__closeout-badge (see buildSignMetaRowHtml above) and the Shelf
    // Talker card's .card__closeout-badge (see buildPricingHtml above) -
    // measured against this Small sign's own printWidth, same reasoning as
    // the Super Sale callout's superSaleStyle just above.
    const closeoutStyle = talkerType === 'closeout'
      ? fontSizeOverrideAttr(talker.closeoutFontSize, SIGN_LAYOUTS['sign-small'].printWidth, true)
      : '';
    priceHtml = `
      ${talkerType === 'closeout' ? `<div class="sign__closeout-badge"${closeoutStyle}>CLOSEOUT!!</div>` : ''}
      ${talkerType === 'chilled' ? '<div class="sign__chilled-badge">Also Available Chilled</div>' : ''}
      <div class="sign__small-price ${hasSale ? 'is-sale' : ''}">${formatMoney(hasSale ? talker.salePrice : talker.price)}</div>
    `;
  }

  return `
    <div class="sign__title sign__title--small"${titleStyle} data-fit="title" data-auto-size="${titleAutoSize}">${escapeHtml(talker.title || (isBeer ? 'Beer Name' : 'Product Name'))}</div>
    ${priceHtml}
    <div class="sign__bottom-row">
      ${hasSale ? `<div class="sign__regular-price">Regular Price ${formatMoney(talker.price)}</div>` : '<div></div>'}
      ${talker.size ? `<div class="sign__size">${escapeHtml(talker.size)}</div>` : '<div></div>'}
    </div>
  `;
}

/**
 * @param {object} talker - same shape as buildCardElement, plus signSize
 *   ('small' | 'large').
 * @returns {HTMLElement} a .sign element, not yet size-fitted
 */
function buildSignElement(talker) {
  const sign = document.createElement('div');
  const size = talker.signSize === 'small' ? 'small' : 'large';
  sign.className = 'sign';
  sign.dataset.theme = talker.theme === 'purple' ? 'purple' : 'amber';
  sign.dataset.size = size;

  const bodyHtml = size === 'small' ? buildSmallSignBodyHtml(talker) : buildLargeSignBodyHtml(talker);
  const showRails = signHasDiscount(talker);

  sign.innerHTML = `
    <div class="sign__band">
      <div class="sign__tagline">Morris County's Largest Wine Discounter</div>
    </div>
    <div class="sign__body">
      ${showRails ? buildSignRailHtml('left') : ''}
      <div class="sign__content">${bodyHtml}</div>
      ${showRails ? buildSignRailHtml('right') : ''}
    </div>
    <div class="sign__band sign__band--footer">
      <span class="sign__footer-text">www.liquoroutletwinecellars.com</span>
      <img class="sign__logo" src="assets/logo.png" alt="" />
    </div>
  `;

  return sign;
}

/**
 * @param {object} talker - { category, title, description, size, price,
 *   salePrice, theme, talkerType, ratings: [{reviewer, score}],
 *   nose, palate, finish, mashBill: [{grain, pct}], isStorePick, brewery,
 *   location, style, abv, ibu, untappdRating, untappdRatingCount }
 * @returns {HTMLElement} a .card element, not yet size-fitted
 */
function buildCardElement(talker) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.theme = talker.theme === 'purple' ? 'purple' : 'amber';
  const talkerSize = ['half', 'quarter'].includes(talker.talkerSize) ? talker.talkerSize : 'full';
  card.dataset.size = talkerSize;
  // Quarter Size Shelf Talkers are a deliberately stripped-down format -
  // Product Title, Size, Regular Price and Sale Price only, nothing else
  // (see the isQuarter branch of bodyHtml below), so the vintage/ratings/
  // awards/beer-table/badge/description machinery is skipped entirely
  // rather than rendered and then hidden by CSS.
  const isQuarter = talkerSize === 'quarter';
  const isBeer = talker.category === 'beer';
  card.dataset.category = isBeer ? 'beer' : 'wine';
  // Settings -> Experimental Features -> Bourbon Shelf Talkers (see
  // applyExperimentalBourbon in app.js, which publishes this) - read fresh
  // on every render rather than cached, so switching the toggle off stops a
  // talker's Nose/Palate/Finish from printing immediately, even one that
  // already had that data from before the toggle existed or was last on.
  // window.ShelfTalkerSettings may not exist at all yet (e.g. a test harness
  // that loads card.js without app.js), hence the defensive check rather
  // than a bare property read.
  const experimentalBourbon = !!(window.ShelfTalkerSettings && window.ShelfTalkerSettings.experimentalBourbon);
  // Same gate, same reasoning, published by applyExperimentalPairings in
  // app.js - a talker that already has pairings picked stops printing them
  // the instant the toggle goes off, and shows them again the instant it
  // goes back on, same "hidden, never deleted" behavior as Bourbon above.
  const experimentalPairings = !!(window.ShelfTalkerSettings && window.ShelfTalkerSettings.experimentalPairings);
  const rightBadgeHtml = (isBeer && !isQuarter) ? buildRightBadgeHtml(talker) : '';
  const countryFlagHtml = (isBeer && !isQuarter) ? buildCountryFlagHtml(talker) : '';
  // Wine/Spirits-only, same experimentalBourbon/isQuarter guard as Mash
  // Bill/Nose-Palate-Finish below - beer never sets isStorePick (the
  // checkbox is hidden for beer, see applyFormMode in app.js), so this and
  // rightBadgeHtml above never both apply to the same talker even though
  // they share the badge-right corner.
  const storePickRibbonHtml = (!isBeer && !isQuarter && experimentalBourbon) ? buildStorePickRibbonHtml(talker) : '';
  const titleClasses = ['card__title'];
  if (rightBadgeHtml || storePickRibbonHtml) titleClasses.push('card__title--badge-right');
  if (countryFlagHtml) titleClasses.push('card__title--badge-left');
  // Quarter gets its own reference width (its own real 1.4in print width,
  // not Full/Half's shared 2.8in) - same trick .sign-small/.sign-large
  // already use to scale independently of each other (see
  // buildSmallSignBodyHtml/buildLargeSignBodyHtml below). Full/Half still
  // share 2.8in, unaffected. Without this, the Title Font Size box's own
  // default ("12", same for every talker size - see DEFAULT_FONT_SIZE_PT
  // in app.js) would render at half its typed point size on Quarter simply
  // because Quarter's --w is half of Full's, on top of Quarter now having
  // far more room per field than Full ever did - the opposite of
  // "formatted for" this stripped-down format.
  const refWidthIn = isQuarter ? SIGN_LAYOUTS['talker-quarter'].printWidth : SIGN_LAYOUTS.talker.printWidth;
  const titleAutoSize = !!talker.titleAutoSize;
  const titleStyle = fontSizeOverrideAttr(talker.titleFontSize, refWidthIn, titleAutoSize);
  const descriptionAutoSize = !!talker.descriptionAutoSize;
  const descriptionStyle = isQuarter ? '' : fontSizeOverrideAttr(talker.descriptionFontSize, refWidthIn, descriptionAutoSize);
  const ratingsStyle = isQuarter ? '' : fontSizeOverrideAttr(talker.ratingsFontSize, refWidthIn, true);
  const titleHtml = `<div class="${titleClasses.join(' ')}"${titleStyle} data-fit="title" data-auto-size="${titleAutoSize}">${escapeHtml(talker.title || (isBeer ? 'Beer Name' : 'Product Title'))}</div>`;
  const sizeHtml = talker.size ? `<div class="card__size">${escapeHtml(talker.size)}</div>` : '';

  const bodyHtml = isQuarter ? `
      ${titleHtml}
      <div class="card__spacer"></div>
      ${sizeHtml}
      ${buildPricingHtml(talker, true)}
  ` : `
      ${countryFlagHtml}
      ${rightBadgeHtml}
      ${storePickRibbonHtml}
      ${titleHtml}
      ${!isBeer && talker.vintage ? `<div class="card__vintage">${escapeHtml(talker.vintage)}</div>` : ''}
      ${isBeer ? buildBeerRatingHtml(talker, { includeStyle: true }) : ''}
      ${isBeer ? buildBeerTableHtml(talker) : ''}
      <div class="card__description"${descriptionStyle} data-fit="description" data-auto-size="${descriptionAutoSize}">${escapeHtml(talker.description || '')}</div>
      ${(isBeer || !experimentalBourbon) ? '' : buildMashBillHtml(talker)}
      ${(isBeer || !experimentalBourbon) ? '' : buildFlavorHtml(talker)}
      ${isBeer ? '' : buildRatingsHtml(talker, ratingsStyle)}
      ${isBeer ? '' : buildAwardsHtml(talker)}
      ${(isBeer || !experimentalPairings) ? '' : buildPairingsHtml(talker)}
      <div class="card__spacer"></div>
      ${sizeHtml}
      ${buildPricingHtml(talker)}
  `;

  // Store SKU: Beer only, and not on Quarter (which only ever shows Title/
  // Size/Regular Price/Sale Price - see the isQuarter branch above). Set
  // into the footer band next to the store URL rather than anywhere in
  // .card__body - it's inventory/restock information for staff, not part
  // of the shopper-facing pitch, so it belongs with the other "back of
  // house" line already down there instead of competing with the price or
  // description for room.
  const showSku = isBeer && !isQuarter && talker.sku;
  const footerClasses = ['card__band', 'card__band--footer'];
  if (showSku) footerClasses.push('card__band--footer--split');

  card.innerHTML = `
    <div class="card__band">
      <img class="card__logo" src="assets/logo.png" alt="" />
    </div>
    <div class="card__body">${bodyHtml}</div>
    <div class="${footerClasses.join(' ')}">
      ${showSku ? `<span class="card__sku">SKU ${escapeHtml(talker.sku)}</span>` : ''}
      <span class="card__footer-text">www.liquoroutletwinecellars.com</span>
    </div>
  `;

  return card;
}

/**
 * Settles the title and description, each either clipped to however many
 * lines fit at a fixed point size (the default), or shrunk (title) /
 * shrunk-and-grown (description) to fit, if this talker has that field's
 * Auto Size checked (see the data-auto-size attribute set in
 * buildCardElement/buildLargeSignBodyHtml/buildSmallSignBodyHtml). Works on
 * both the Shelf Talker (.card) and Display Sign (.sign) formats. Must be
 * called after the element is attached to the document (needs real layout).
 */
function fitCardText(cardEl) {
  const titleEl = cardEl.querySelector('[data-fit="title"]');
  const titleAutoSize = !!titleEl && titleEl.dataset.autoSize === 'true';

  if (titleAutoSize && titleEl) {
    // Both the floor and the step are relative to the element's own starting
    // size, not absolute pixels. The same card gets rendered at wildly
    // different scales - a ~120px-wide card in the Print Preview modal, a
    // 2.8in one on paper, a 10.1in Display Sign - and every font size in the
    // card is a fraction of --w, so a fixed 10px/8px floor meant a different
    // amount of shrink was available at each scale: the small previews were
    // already at (or under) the floor before shrinking started, and truncated
    // titles that print perfectly well.
    const startPx = parseFloat(getComputedStyle(titleEl).fontSize);
    const minPx = Math.max(startPx * 0.5, 4);
    let fontSize = startPx;
    let guard = 40;
    while (titleEl.scrollHeight > titleEl.clientHeight + 1 && fontSize > minPx && guard > 0) {
      fontSize *= 0.97;
      titleEl.style.fontSize = `${fontSize}px`;
      guard -= 1;
    }
  }
  // When titleAutoSize is false (the default), the title needs no pass here
  // at all yet - it just renders at its fixed point size, already bounded by
  // its own 3-line (2-line Display Sign) CSS clamp. See the escalation via
  // clampTitleToAvailableSpace below for what happens if that alone still
  // isn't enough room once the description has had its turn.

  const body = cardEl.querySelector('.card__body, .sign__body');
  if (!body) return;

  const description = cardEl.querySelector('[data-fit="description"]');
  const descriptionAutoSize = !!description && description.dataset.autoSize === 'true';
  // Captured before either path below touches anything, so the Auto Size
  // shrink pass has the description's true starting size (its set point
  // size, --price-fit included) to measure its own floor against.
  const descriptionNaturalPx = description ? parseFloat(getComputedStyle(description).fontSize) : 0;

  if (descriptionAutoSize) {
    // The title pass above only guarantees the title fits *itself*, not
    // whatever room its neighbors actually leave the description - a
    // description that's well within its own line-clamp box can still be
    // taller than the space left after the title/ratings/price block, since
    // it's the one piece of free text on the talker with no natural cap on
    // length. Keep shrinking just the description - not the title, badges,
    // ratings, or price block - so a long product description only ever
    // costs the description its own size.
    shrinkDescriptionToFitBody(description, descriptionNaturalPx, body);
  } else {
    // The description is the one piece of free text on the talker with no
    // natural cap on length, so it's the one that gives when there isn't
    // enough room left after the title/badges/ratings/price block above and
    // below it - not by shrinking its text, but by showing fewer of its
    // lines (ending in an ellipsis, via its own line-clamp CSS).
    clampDescriptionToAvailableSpace(description, body);
  }

  // Escalation, non-Auto-Size title only: a maxed-out three-line title
  // stacked with a full ratings/awards list can still be too tall even with
  // the description already clamped down to a single line. Rather than
  // jumping straight to the whole-block --price-fit shrink below (which
  // would also touch the price row), give the title the same treatment as
  // the description first - narrow its own visible lines - since it's still
  // just text taking up room, not the price block itself.
  if (!titleAutoSize) {
    clampTitleToAvailableSpace(titleEl, body);
  }

  // Last resort: something other than the title/description - e.g. a full
  // ratings/awards list alongside a title and description that are already
  // at their respective floors - is still too tall. Scale the whole block
  // together (all parts, so their relative sizes stay the same) until it
  // fits. This is the only path left that still touches the price row. With
  // Auto Size off, --price-fit is deliberately left out of the title's/
  // description's own font-size (see .card__title/.card__description/
  // .sign__description in styles.css), so this pass can't resize that text
  // itself in that case - only how many of its lines are visible was ever
  // eligible to change, and that was already settled above.
  let priceFit = 1;
  let priceGuard = 40;
  while (body.scrollHeight > body.clientHeight + 1 && priceFit > 0.35 && priceGuard > 0) {
    priceFit = Math.round((priceFit - 0.03) * 100) / 100;
    body.style.setProperty('--price-fit', priceFit);
    priceGuard -= 1;
  }

  if (descriptionAutoSize) growDescriptionToFillSlack(cardEl, body);
}

// Never resizes the title's font - only how many of its lines are visible.
// Used when this talker's title Auto Size box is unchecked (the default).
// Mirrors clampDescriptionToAvailableSpace below, but only ever engages as
// an escalation after the description has already been settled (see
// fitCardText above) - the title's own 3-line (2-line Display Sign) CSS
// clamp already bounds its natural height with no JS needed for the common
// case, so this only narrows further if the body is still overflowing even
// with the description already at its floor.
function clampTitleToAvailableSpace(titleEl, body) {
  if (!titleEl || !titleEl.textContent.trim()) return;
  if (body.scrollHeight <= body.clientHeight + 1) return;

  const maxLines = titleEl.classList.contains('sign__title') ? 2 : 3;
  let lines = maxLines;
  let guard = maxLines;
  while (body.scrollHeight > body.clientHeight + 1 && lines > 1 && guard > 0) {
    lines -= 1;
    titleEl.style.webkitLineClamp = String(lines);
    titleEl.style.lineClamp = String(lines);
    guard -= 1;
  }
}

// Never resizes the description's font - only how many of its lines are
// visible. Used when this talker's Auto Size box is unchecked (the
// default). Starts from the format's own line-clamp ceiling (12 for a Shelf
// Talker, 5 for a Display Sign - see .card__description/.sign__description
// in styles.css) and, only if the body is still overflowing at that point,
// narrows it one line at a time until it fits or hits a 1-line floor.
// Leaves the CSS-declared clamp untouched (no inline override at all) for
// the common case where the description already fits, so a short
// description just renders at its natural height with blank room left
// above the price block, instead of stretching to fill it.
function clampDescriptionToAvailableSpace(description, body) {
  if (!description || !description.textContent.trim()) return;
  if (body.scrollHeight <= body.clientHeight + 1) return;

  const maxLines = description.classList.contains('sign__description') ? 5 : 12;
  let lines = maxLines;
  let guard = maxLines;
  while (body.scrollHeight > body.clientHeight + 1 && lines > 1 && guard > 0) {
    lines -= 1;
    description.style.webkitLineClamp = String(lines);
    description.style.lineClamp = String(lines);
    guard -= 1;
  }
}

// Auto Size only: shrinks just the description (in place) until the body
// around it stops overflowing, well past the shared 50% floor the title
// gets in fitCardText above - the description is the one block on the
// talker with no natural cap on how much gets typed into it, so it needs
// more room to give before anything else does. Never touches the
// title/price/badges.
function shrinkDescriptionToFitBody(description, naturalPx, body) {
  if (!description || !naturalPx || !description.textContent.trim()) return;
  const floorPx = Math.max(naturalPx * 0.3, 4);
  let fontSize = parseFloat(getComputedStyle(description).fontSize);
  let guard = 60;
  while (body.scrollHeight > body.clientHeight + 1 && fontSize > floorPx && guard > 0) {
    fontSize *= 0.97;
    description.style.fontSize = `${fontSize}px`;
    guard -= 1;
  }
}

// Auto Size only: a short description (common on beer talkers, which have
// no vintage/ratings/awards blocks to take up the rest of the space) leaves
// a lot of blank room above the price block - still pinned to the very
// bottom via .card__spacer / .sign__footer-block's margin-top: auto so
// prices line up across a printed sheet regardless of how much each talker
// has to say. Grow the description into that slack instead of leaving it
// blank - mirrors the shrink loop above but in reverse. Capped at 2x its
// base size so a one- or two-word description doesn't balloon to fill the
// whole card on its own; anything longer naturally stops growing once it
// fills the available room, well under the cap.
function growDescriptionToFillSlack(cardEl, body) {
  const description = cardEl.querySelector('[data-fit="description"]');
  if (!description || !description.textContent.trim()) return;

  const startPx = parseFloat(getComputedStyle(description).fontSize);
  const maxPx = startPx * 2;

  let fontSize = startPx;
  let guard = 40;
  while (fontSize < maxPx && guard > 0) {
    const nextSize = Math.min(fontSize * 1.03, maxPx);
    description.style.fontSize = `${nextSize}px`;
    if (description.scrollHeight > description.clientHeight + 1 || body.scrollHeight > body.clientHeight + 1) {
      description.style.fontSize = `${fontSize}px`;
      break;
    }
    fontSize = nextSize;
    guard -= 1;
  }
}

/**
 * @param {object} talker
 * @returns {HTMLElement} a .card (signType 'talker') or .sign
 *   (signType 'sign') element, not yet size-fitted.
 */
function buildPrintableElement(talker) {
  return talker.signType === 'sign' ? buildSignElement(talker) : buildCardElement(talker);
}

function renderFittedCard(talker) {
  const card = buildPrintableElement(talker);
  // fitCardText needs layout, so caller should append `card` to the DOM,
  // then call fitCardText(card) on the next frame.
  return card;
}
