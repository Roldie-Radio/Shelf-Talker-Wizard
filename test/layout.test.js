const test = require('node:test');
const assert = require('node:assert/strict');

const L = require('../public/js/layout.js');

const {
  PAGE_CONTENT_WIDTH_IN,
  PAGE_CONTENT_HEIGHT_IN,
  ITEM_GAP_IN,
  ROW_GAP_IN,
  SIGN_LAYOUTS,
  itemHeightIn,
  layoutKeyFor,
  buildSheets,
  packItemsIntoShelves,
  buildAutoArrangedPages,
} = L;

// Inches don't divide cleanly in binary, so every comparison against the
// page budget needs the same slack the packing code itself uses.
const EPSILON = 0.001;

const LAYOUT_KEYS = Object.keys(SIGN_LAYOUTS);

/** Builds a queue item that layoutKeyFor will classify as `layoutKey`. */
function itemFor(layoutKey, id) {
  const base = { id, title: `Item ${id}`, price: '9.99' };
  switch (layoutKey) {
    case 'sign-large': return { ...base, signType: 'sign', signSize: 'large' };
    case 'sign-small': return { ...base, signType: 'sign', signSize: 'small' };
    case 'talker-half': return { ...base, signType: 'talker', talkerSize: 'half' };
    case 'talker-quarter': return { ...base, signType: 'talker', talkerSize: 'quarter' };
    default: return { ...base, signType: 'talker', talkerSize: 'full' };
  }
}

function itemsFor(layoutKey, count) {
  return Array.from({ length: count }, (_, i) => itemFor(layoutKey, `${layoutKey}-${i}`));
}

test('layoutKeyFor maps every queue item shape to a layout', async (t) => {
  await t.test('classifies each kind', () => {
    assert.equal(layoutKeyFor({ signType: 'talker', talkerSize: 'full' }), 'talker');
    assert.equal(layoutKeyFor({ signType: 'talker', talkerSize: 'half' }), 'talker-half');
    assert.equal(layoutKeyFor({ signType: 'talker', talkerSize: 'quarter' }), 'talker-quarter');
    assert.equal(layoutKeyFor({ signType: 'sign', signSize: 'large' }), 'sign-large');
    assert.equal(layoutKeyFor({ signType: 'sign', signSize: 'small' }), 'sign-small');
  });

  // Queue items saved by older versions of the app predate signType and
  // talkerSize, so the fallback has to stay a real full-size Shelf Talker.
  await t.test('falls back to a full Shelf Talker for legacy/blank items', () => {
    assert.equal(layoutKeyFor({}), 'talker');
    assert.equal(layoutKeyFor({ title: 'from a v1 CSV import' }), 'talker');
    assert.equal(layoutKeyFor({ signType: 'talker' }), 'talker');
    assert.equal(layoutKeyFor({ signType: 'talker', talkerSize: 'nonsense' }), 'talker');
    // signSize only means anything for signs; large is the documented default.
    assert.equal(layoutKeyFor({ signType: 'sign' }), 'sign-large');
  });
});

// The invariant that actually protects the printed page: a grid of
// cols x rows items at printWidth has to physically fit inside the content
// area, gaps included. Anyone adding a size or retuning a grid gets caught
// here rather than by a ruined print run.
test('every layout physically fits on a landscape Letter sheet', async (t) => {
  for (const key of LAYOUT_KEYS) {
    const layout = SIGN_LAYOUTS[key];
    await t.test(key, () => {
      const usedWidth = layout.cols * layout.printWidth + (layout.cols - 1) * ITEM_GAP_IN;
      const usedHeight = layout.rows * itemHeightIn(key) + (layout.rows - 1) * ROW_GAP_IN;

      assert.ok(
        usedWidth <= PAGE_CONTENT_WIDTH_IN + EPSILON,
        `${key}: ${layout.cols} cols of ${layout.printWidth}in need ${usedWidth.toFixed(3)}in, `
        + `page has ${PAGE_CONTENT_WIDTH_IN}in`
      );
      assert.ok(
        usedHeight <= PAGE_CONTENT_HEIGHT_IN + EPSILON,
        `${key}: ${layout.rows} rows of ${itemHeightIn(key).toFixed(3)}in need ${usedHeight.toFixed(3)}in, `
        + `page has ${PAGE_CONTENT_HEIGHT_IN}in`
      );
      assert.equal(layout.perSheet, layout.cols * layout.rows,
        `${key}: perSheet must equal cols x rows, or buildSheets will over- or under-fill a sheet`);
      assert.ok(layout.printWidth > 0 && Number.isFinite(layout.printWidth), `${key}: printWidth must be a positive number of inches`);
      assert.ok(layout.aspect > 0 && Number.isFinite(layout.aspect), `${key}: aspect must be a positive width/height ratio`);
      assert.ok(layout.label, `${key}: needs a label for the Print Preview`);
    });
  }
});

test('the documented size relationships hold', async (t) => {
  await t.test('Half Size is Full width and half Full height', () => {
    assert.equal(SIGN_LAYOUTS['talker-half'].printWidth, SIGN_LAYOUTS.talker.printWidth);
    assert.ok(Math.abs(itemHeightIn('talker-half') - itemHeightIn('talker') / 2) < 0.01);
  });

  await t.test('Quarter Size is Full scaled uniformly to 50%', () => {
    assert.equal(SIGN_LAYOUTS['talker-quarter'].printWidth, SIGN_LAYOUTS.talker.printWidth / 2);
    assert.equal(SIGN_LAYOUTS['talker-quarter'].aspect, SIGN_LAYOUTS.talker.aspect);
    assert.ok(Math.abs(itemHeightIn('talker-quarter') - itemHeightIn('talker') / 2) < 0.01);
  });
});

test('buildSheets', async (t) => {
  await t.test('returns nothing for an empty queue', () => {
    assert.deepEqual(buildSheets([]), []);
  });

  await t.test('never mixes layouts on one sheet', () => {
    const mixed = [
      ...itemsFor('talker', 4),
      ...itemsFor('sign-small', 3),
      ...itemsFor('talker-quarter', 2),
      ...itemsFor('sign-large', 1),
      ...itemsFor('talker-half', 5),
    ];
    for (const sheet of buildSheets(mixed)) {
      const keys = new Set(sheet.items.map(layoutKeyFor));
      assert.equal(keys.size, 1, 'a sheet held more than one layout');
      assert.equal([...keys][0], sheet.layoutKey, "sheet.layoutKey disagreed with its items");
    }
  });

  await t.test('never puts more than perSheet items on a sheet', () => {
    for (const key of LAYOUT_KEYS) {
      const perSheet = SIGN_LAYOUTS[key].perSheet;
      const sheets = buildSheets(itemsFor(key, perSheet * 2 + 1));
      assert.equal(sheets.length, 3, `${key}: expected 3 sheets`);
      assert.deepEqual(sheets.map((s) => s.items.length), [perSheet, perSheet, 1]);
    }
  });

  await t.test('fills exactly one sheet at the perSheet boundary', () => {
    for (const key of LAYOUT_KEYS) {
      const sheets = buildSheets(itemsFor(key, SIGN_LAYOUTS[key].perSheet));
      assert.equal(sheets.length, 1, `${key}: a full sheet should not spill onto a second`);
    }
  });

  await t.test('keeps every item exactly once, in queue order', () => {
    const items = [
      ...itemsFor('talker', 7),
      ...itemsFor('sign-small', 2),
    ];
    const placed = buildSheets(items).flatMap((s) => s.items);
    assert.equal(placed.length, items.length);
    assert.deepEqual(new Set(placed.map((i) => i.id)).size, items.length, 'an item was duplicated or dropped');

    // Order within a layout is what makes Move Up/Move Down meaningful.
    const talkerIds = placed.filter((i) => layoutKeyFor(i) === 'talker').map((i) => i.id);
    assert.deepEqual(talkerIds, itemsFor('talker', 7).map((i) => i.id));
  });
});

test('auto-arrange packing', async (t) => {
  const mixedQueue = [
    ...itemsFor('talker', 5),
    ...itemsFor('talker-half', 4),
    ...itemsFor('talker-quarter', 7),
    ...itemsFor('sign-small', 3),
    ...itemsFor('sign-large', 2),
  ];

  await t.test('no shelf is wider than the page', () => {
    for (const shelf of packItemsIntoShelves(mixedQueue)) {
      const width = shelf.items.reduce(
        (sum, item) => sum + SIGN_LAYOUTS[layoutKeyFor(item)].printWidth,
        0
      ) + ITEM_GAP_IN * (shelf.items.length - 1);
      assert.ok(width <= PAGE_CONTENT_WIDTH_IN + EPSILON,
        `shelf of ${shelf.items.length} items needs ${width.toFixed(3)}in, page has ${PAGE_CONTENT_WIDTH_IN}in`);
    }
  });

  // FFDH's correctness rests on this: because items are placed
  // tallest-first, nothing joining a shelf can be taller than the shelf's
  // first item, so shelf.height is a safe stand-in for the whole row.
  await t.test('no item is taller than the shelf it was placed on', () => {
    for (const shelf of packItemsIntoShelves(mixedQueue)) {
      for (const item of shelf.items) {
        assert.ok(itemHeightIn(layoutKeyFor(item)) <= shelf.height + EPSILON,
          'an item ended up taller than its shelf, so the row will overflow');
      }
    }
  });

  await t.test('no page is taller than the page budget', () => {
    for (const page of buildAutoArrangedPages(mixedQueue)) {
      const height = page.rows.reduce((sum, row) => sum + row.height, 0)
        + ROW_GAP_IN * (page.rows.length - 1);
      assert.ok(height <= PAGE_CONTENT_HEIGHT_IN + EPSILON,
        `page of ${page.rows.length} rows needs ${height.toFixed(3)}in, page has ${PAGE_CONTENT_HEIGHT_IN}in`);
    }
  });

  await t.test('keeps every item exactly once', () => {
    const placed = buildAutoArrangedPages(mixedQueue).flatMap((p) => p.rows).flatMap((r) => r.items);
    assert.equal(placed.length, mixedQueue.length);
    assert.deepEqual(
      placed.map((i) => i.id).sort(),
      mixedQueue.map((i) => i.id).sort()
    );
  });

  await t.test('never uses more sheets than plain grouping', () => {
    // The whole point of the feature - if it ever came out worse, the
    // "That's N fewer sheets" summary in the Print Preview would be a lie.
    assert.ok(buildAutoArrangedPages(mixedQueue).length <= buildSheets(mixedQueue).length);
  });

  await t.test('is deterministic', () => {
    const once = JSON.stringify(buildAutoArrangedPages(mixedQueue));
    const twice = JSON.stringify(buildAutoArrangedPages(mixedQueue));
    assert.equal(once, twice);
  });

  await t.test('handles an empty queue and a single item', () => {
    assert.deepEqual(buildAutoArrangedPages([]), []);
    const single = buildAutoArrangedPages(itemsFor('sign-large', 1));
    assert.equal(single.length, 1);
    assert.equal(single[0].rows.length, 1);
    assert.equal(single[0].rows[0].items.length, 1);
  });
});
