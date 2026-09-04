// The one text-fitting pass on a beer Large Display Sign that no other test
// can reach: regrowSignDescriptionLines in public/js/card.js, which decides
// how many lines of the Description its column actually shows.
//
// It runs against a real browser layout (getComputedStyle, clientHeight,
// scrollHeight), so these tests load card.js into a vm with a small stand-in
// for the two elements it measures - one that models -webkit-line-clamp the
// way a browser does, which is the whole point: clientHeight is what the
// clamp RENDERS (that many lines, or fewer if that's all the text there is)
// while scrollHeight is the height the description would have if nothing
// were clamped at all. Measuring the wrong one shipped a beer sign whose
// Description printed a single line and an ellipsis with most of its own
// column empty underneath - see the "fills the column" test below.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CARD_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'card.js'), 'utf8');

/**
 * Loads card.js the way the browser does (a plain script, layout.js already
 * on window) and hands back its top-level functions.
 */
function loadCard() {
  const context = {
    window: { ShelfTalkerLayout: require('../public/js/layout.js') },
    // Only ever read for the line-clamp ceiling the stylesheet declares -
    // the element stand-in below carries its own.
    getComputedStyle: (el) => el.computedStyle,
  };
  vm.createContext(context);
  vm.runInContext(CARD_SRC, context);
  return context;
}

const LINE_H = 20;

/**
 * A beer Large Display Sign's right-hand column, reduced to what the regrow
 * pass measures.
 *
 * @param {object} opts
 * @param {number} opts.fullLines - how many lines the description's text
 *   needs if nothing clamps it.
 * @param {number} opts.columnLines - how many lines fit in the column.
 * @param {number} opts.cssMaxLines - the stylesheet's own line-clamp ceiling.
 * @param {string} opts.startClamp - the inline clamp
 *   clampDescriptionToAvailableSpace left behind ('' for none).
 * @param {boolean} [opts.bodyStuckOverflowing] - the sign is over-full for
 *   some reason of its own (a tall facts column at the --price-fit floor),
 *   no matter what the description does.
 */
function makeSign({ fullLines, columnLines, cssMaxLines, startClamp, bodyStuckOverflowing = false }) {
  const description = {
    textContent: 'x'.repeat(20),
    style: { webkitLineClamp: startClamp, lineClamp: startClamp },
    computedStyle: { webkitLineClamp: String(cssMaxLines) },
    get lines() {
      const clamp = parseInt(this.style.webkitLineClamp, 10) || cssMaxLines;
      return Math.min(clamp, fullLines);
    },
    // What the clamp renders...
    get clientHeight() { return this.lines * LINE_H; },
    // ...versus the whole description, clamp or no clamp.
    get scrollHeight() { return fullLines * LINE_H; },
  };
  const colRight = {
    clientHeight: columnLines * LINE_H,
    querySelector: () => description,
  };
  // Once the description outgrows its column, the columns row grows with it
  // and the sign as a whole overflows - the same escape hatch the real body
  // gives the regrow loop.
  const body = {
    clientHeight: 100,
    get scrollHeight() {
      const spill = Math.max(0, description.clientHeight - colRight.clientHeight);
      return 100 + spill + (bodyStuckOverflowing ? 50 : 0);
    },
  };
  const cardEl = { querySelector: (sel) => (sel === '.sign__col-right' ? colRight : null) };
  return { cardEl, body, description, visibleLines: () => description.lines };
}

test('regrowSignDescriptionLines', async (t) => {
  const { regrowSignDescriptionLines } = loadCard();

  // The confirmed bug: a description longer than its own column (the common
  // case for a real Untappd write-up) was measured with scrollHeight - the
  // full text's height - which already exceeds the column at the very first
  // step, so the loop broke immediately and left the description wherever
  // clampDescriptionToAvailableSpace had put it: one line and an ellipsis,
  // with five empty lines' worth of column underneath.
  await t.test('fills the column when the description is longer than it', () => {
    const sign = makeSign({ fullLines: 11, columnLines: 6, cssMaxLines: 9, startClamp: '1' });
    regrowSignDescriptionLines(sign.cardEl, sign.body);
    assert.equal(sign.visibleLines(), 6, 'should show every line the column has room for');
  });

  await t.test('grows a description that fits back to its full text', () => {
    const sign = makeSign({ fullLines: 3, columnLines: 6, cssMaxLines: 9, startClamp: '1' });
    regrowSignDescriptionLines(sign.cardEl, sign.body);
    assert.equal(sign.visibleLines(), 3, 'nothing should be cut off a description this short');
    assert.ok(sign.description.clientHeight >= sign.description.scrollHeight,
      'a description that fits must not read as truncated');
  });

  // No inline clamp means clampDescriptionToAvailableSpace never narrowed
  // anything (it returns early when the sign already fits), so there is
  // nothing to give back and the stylesheet's own ceiling still stands.
  await t.test('leaves a description it never narrowed alone', () => {
    const sign = makeSign({ fullLines: 4, columnLines: 6, cssMaxLines: 9, startClamp: '' });
    regrowSignDescriptionLines(sign.cardEl, sign.body);
    assert.equal(sign.description.style.webkitLineClamp, '', 'should not write an inline clamp');
    assert.equal(sign.visibleLines(), 4);
  });

  // Same case, but with the sign over-full for a reason the description
  // can't fix - growing has to stay off, and (with no clamp of its own to
  // restore) the description must not be cut to one line on the way out.
  await t.test('leaves it alone even when the sign is still overflowing', () => {
    const sign = makeSign({ fullLines: 4, columnLines: 6, cssMaxLines: 9, startClamp: '', bodyStuckOverflowing: true });
    regrowSignDescriptionLines(sign.cardEl, sign.body);
    assert.equal(sign.description.style.webkitLineClamp, '');
    assert.equal(sign.visibleLines(), 4);
  });

  await t.test('never grows past the column, however much text there is', () => {
    const sign = makeSign({ fullLines: 40, columnLines: 4, cssMaxLines: 9, startClamp: '1' });
    regrowSignDescriptionLines(sign.cardEl, sign.body);
    assert.equal(sign.visibleLines(), 4);
    assert.ok(sign.body.scrollHeight <= sign.body.clientHeight, 'the sign must not be left overflowing');
  });

  await t.test('never grows past the stylesheet ceiling', () => {
    const sign = makeSign({ fullLines: 20, columnLines: 30, cssMaxLines: 9, startClamp: '2' });
    regrowSignDescriptionLines(sign.cardEl, sign.body);
    assert.equal(sign.visibleLines(), 9);
  });

  await t.test('does nothing on a sign with no description column', () => {
    const cardEl = { querySelector: () => null };
    assert.doesNotThrow(() => regrowSignDescriptionLines(cardEl, { clientHeight: 100, scrollHeight: 120 }));
  });
});
