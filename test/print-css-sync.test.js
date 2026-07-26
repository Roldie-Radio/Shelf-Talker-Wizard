// The print geometry lives in two places that cannot see each other: the
// numbers in public/js/layout.js (which auto-arrange packs against) and the
// @media print rules in public/css/styles.css (which the browser actually
// lays the page out with). Nothing at runtime notices if they drift - the
// packer would happily fit six items onto a page that CSS then renders seven
// across, and the overflow just silently clips.
//
// These tests read the real numbers back out of the stylesheet and assert
// they still agree with the JS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const L = require('../public/js/layout.js');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'styles.css'), 'utf8');

/** Pulls the body of the first `selector { ... }` block out of the stylesheet. */
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = CSS.match(new RegExp(`(^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  assert.ok(match, `could not find a "${selector} { ... }" rule in styles.css`);
  return match[2];
}

/** Reads a single declaration's value out of a rule body. */
function declaration(selector, prop) {
  const body = ruleBody(selector);
  const match = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'm'));
  assert.ok(match, `"${selector}" has no "${prop}" declaration`);
  return match[1].trim();
}

/** "0.28in" -> 0.28 */
function inches(value) {
  const match = String(value).trim().match(/^(-?[\d.]+)in$/);
  assert.ok(match, `expected an inch value, got "${value}"`);
  return parseFloat(match[1]);
}

// Real drift between the CSS and the JS is orders of magnitude larger than
// this; the tolerance only absorbs binary floating point noise so a value
// like 8.5 - 0.28 * 2 can still be compared against the "7.94in" in the
// stylesheet.
function assertSameLength(cssValue, jsValue, message) {
  assert.ok(Math.abs(inches(cssValue) - jsValue) < 1e-6,
    `${message} (stylesheet says ${cssValue}, JS says ${jsValue}in)`);
}

/** "830 / 1136" or "2.7" -> a width/height number */
function ratio(value) {
  const parts = String(value).split('/').map((n) => parseFloat(n.trim()));
  assert.ok(parts.every(Number.isFinite), `expected an aspect-ratio, got "${value}"`);
  return parts.length === 2 ? parts[0] / parts[1] : parts[0];
}

test('@page margin matches PAGE_MARGIN_IN', () => {
  assertSameLength(declaration('@page', 'margin'), L.PAGE_MARGIN_IN,
    'the @page margin and PAGE_MARGIN_IN disagree, so the content area the packer '
    + 'budgets for is not the one the browser prints into');
});

test('@page size is landscape Letter', () => {
  assert.equal(declaration('@page', 'size'), 'letter landscape',
    `PAGE_WIDTH_IN/PAGE_HEIGHT_IN assume ${L.PAGE_WIDTH_IN}in x ${L.PAGE_HEIGHT_IN}in landscape Letter`);
});

test('.sheet height matches PAGE_CONTENT_HEIGHT_IN', () => {
  assertSameLength(declaration('.sheet', 'height'), L.PAGE_CONTENT_HEIGHT_IN,
    'the printed sheet height and the height budget auto-arrange packs against disagree');
});

test('.sheet gap matches ROW_GAP_IN / ITEM_GAP_IN', () => {
  // Shorthand is `gap: <row> <column>`.
  const [row, column] = declaration('.sheet', 'gap').split(/\s+/);
  assertSameLength(row, L.ROW_GAP_IN, '.sheet row-gap disagrees with ROW_GAP_IN');
  assertSameLength(column, L.ITEM_GAP_IN, '.sheet column-gap disagrees with ITEM_GAP_IN');
});

test('auto-arrange print rules use the same gaps as the packer', () => {
  assertSameLength(declaration('.sheet--auto', 'gap'), L.ROW_GAP_IN,
    '.sheet--auto stacks rows, so its gap is the row gap packShelvesIntoPages budgets for');
  assertSameLength(declaration('.sheet__row', 'gap'), L.ITEM_GAP_IN,
    '.sheet__row lays items across, so its gap is the item gap packItemsIntoShelves budgets for');
});

test('the --print-w fallback matches the default Shelf Talker width', () => {
  // .sheet .card/.sign resolve --w from --print-w, which JS sets per sheet
  // or per item; the fallback is what a sheet with no --print-w would use.
  const value = declaration('.sheet .card,\n.sheet .sign', '--w');
  const match = value.match(/var\(--print-w,\s*([\d.]+in)\)/);
  assert.ok(match, `expected "--w: var(--print-w, <length>)", got "${value}"`);
  assertSameLength(match[1], L.SIGN_LAYOUTS.talker.printWidth,
    'the --print-w fallback should be the standard Shelf Talker width');
});

test('card and sign aspect ratios match SIGN_LAYOUTS', () => {
  const cases = [
    ['.card', 'talker'],
    ['.card[data-size="half"]', 'talker-half'],
    ['.sign[data-size="large"]', 'sign-large'],
    ['.sign[data-size="small"]', 'sign-small'],
  ];
  for (const [selector, layoutKey] of cases) {
    const css = ratio(declaration(selector, 'aspect-ratio'));
    const js = L.SIGN_LAYOUTS[layoutKey].aspect;
    assert.ok(Math.abs(css - js) < 1e-9,
      `${selector} renders at ${css} but SIGN_LAYOUTS['${layoutKey}'].aspect is ${js}; `
      + 'the packer would reserve the wrong height for it');
  }
  // Quarter Size has no aspect-ratio rule of its own - it deliberately
  // inherits .card's and just gets a smaller --w.
  assert.equal(L.SIGN_LAYOUTS['talker-quarter'].aspect, L.SIGN_LAYOUTS.talker.aspect);
});

test('the off-screen measuring pass is wide enough for a full sheet', () => {
  // printNow() lays the print DOM out under .is-measuring so fitCardText can
  // measure it. If that box were narrower than the page content area, the
  // widest sign would wrap and be measured at the wrong size.
  const width = inches(declaration('.print-only.is-measuring', 'width'));
  assert.ok(width >= L.PAGE_CONTENT_WIDTH_IN - 1e-9,
    `.is-measuring is ${width}in wide but a sheet's content area is ${L.PAGE_CONTENT_WIDTH_IN}in`);
  const widest = Math.max(...Object.values(L.SIGN_LAYOUTS).map((l) => l.printWidth));
  assert.ok(width >= widest, `.is-measuring must fit the widest item (${widest}in)`);
});

test('the print DOM is hidden except while measuring', () => {
  assert.match(ruleBody('.print-only'), /display:\s*none/,
    'the print DOM must not be visible in the app');
  assert.match(ruleBody('.print-only.is-measuring'), /display:\s*block/,
    'fitCardText cannot measure a display:none element - this is the bug that '
    + 'sent unfitted cards to the printer');
  assert.match(ruleBody('.print-only.is-measuring'), /position:\s*absolute/,
    'the measuring pass must stay out of the document flow');
});
