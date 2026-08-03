// Print-sheet geometry and the two sheet-packing strategies, kept apart from
// the DOM wiring in app.js so the numbers can be tested directly (see
// test/layout.test.js) - including against the @media print rules in
// styles.css, which have to agree with them exactly.
//
// Loaded as a plain <script> in the browser (exposes ShelfTalkerLayout as a
// global, same as card.js does with its helpers) and as a CommonJS module
// under Node for the tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShelfTalkerLayout = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // The printed page. PAGE_CONTENT_* are what's left of a landscape Letter
  // sheet after the @page margin on each side, and every other number here
  // is checked against that budget by the tests.
  // Rounded because binary floating point doesn't represent these cleanly -
  // 8.5 - 0.28 * 2 comes out as 7.9399999999999995, which is identical for
  // every practical purpose but stops the value from ever being compared
  // exactly against the 7.94in the stylesheet writes.
  const roundIn = (n) => Math.round(n * 1e4) / 1e4;

  const PAGE_WIDTH_IN = 11;
  const PAGE_HEIGHT_IN = 8.5;
  const PAGE_MARGIN_IN = 0.28;
  const PAGE_CONTENT_WIDTH_IN = roundIn(PAGE_WIDTH_IN - PAGE_MARGIN_IN * 2); // 10.44
  const PAGE_CONTENT_HEIGHT_IN = roundIn(PAGE_HEIGHT_IN - PAGE_MARGIN_IN * 2); // 7.94
  const ITEM_GAP_IN = 0.3;
  const ROW_GAP_IN = 0.2;

  // Print-sheet geometry per sign type/size, all sized to fit a single
  // landscape Letter sheet. printWidth is the element's --w (its own width,
  // matching how .card/.sign already scale everything off of --w);
  // printWidth/11 gives the same ratio used to size the on-screen sheet
  // preview at whatever pixel width it happens to be rendered at.
  const SIGN_LAYOUTS = {
    talker: { cols: 3, rows: 2, perSheet: 6, printWidth: 2.8, aspect: 830 / 1136, label: 'Shelf Talkers' },
    // Half Size keeps the same width as Full (same cols/printWidth) but is
    // cut to half the height, so more rows fit per sheet; Quarter Size
    // uniformly scales both dimensions to 50% of Full (same aspect ratio,
    // half the printWidth), so both cols and rows increase.
    'talker-half': { cols: 3, rows: 3, perSheet: 9, printWidth: 2.8, aspect: 830 / 568, label: 'Half Size Shelf Talkers' },
    'talker-quarter': { cols: 6, rows: 3, perSheet: 18, printWidth: 1.4, aspect: 830 / 1136, label: 'Quarter Size Shelf Talkers' },
    // Sized to match the in-store laminated signs (8.5in x 3.25in) rather
    // than filling most of the sheet width - a user compared a printed
    // Large Display Sign against the physical one already in use and asked
    // for it to come down to the same size.
    'sign-large': { cols: 1, rows: 2, perSheet: 2, printWidth: 8.5, aspect: 8.5 / 3.25, label: 'Large Display Signs' },
    // The source PDF template's background image measured 5.003in x
    // 2.48in (aspect 2.017, rounded to 2 below), but a user measured the
    // actual physical small signs the store prints and cuts out at
    // 4.75in x 2.3in (aspect 2.065) - a real, noticeably more compressed
    // shape than the template file assumed, the same kind of direct
    // physical comparison sign-large's printWidth/aspect below were
    // already corrected against.
    'sign-small': { cols: 2, rows: 3, perSheet: 6, printWidth: 4.75, aspect: 4.75 / 2.3, label: 'Small Display Signs' },
  };

  // CSS wants a length; the packing maths wants a number. Keeping the number
  // canonical and formatting here means the two can't disagree the way they
  // could when printWidth was the string '2.8in' and every consumer had to
  // remember to parseFloat it.
  function printWidthCss(layoutKey) {
    return `${SIGN_LAYOUTS[layoutKey].printWidth}in`;
  }

  // aspect is width/height (the same convention as the CSS aspect-ratio
  // property), so an item's real printed height is its printWidth divided
  // by its aspect.
  function itemHeightIn(layoutKey) {
    const layout = SIGN_LAYOUTS[layoutKey];
    return layout.printWidth / layout.aspect;
  }

  function layoutKeyFor(talker) {
    if (talker.signType === 'sign') return talker.signSize === 'small' ? 'sign-small' : 'sign-large';
    if (talker.talkerSize === 'half') return 'talker-half';
    if (talker.talkerSize === 'quarter') return 'talker-quarter';
    return 'talker';
  }

  function emptyLayoutGroups() {
    const groups = {};
    Object.keys(SIGN_LAYOUTS).forEach((key) => { groups[key] = []; });
    return groups;
  }

  // Groups the queue by print layout and chunks each group into sheets, so
  // a printed/previewed sheet never mixes different layouts (Shelf Talker
  // sizes, Display Sign sizes) with each other - their physical dimensions
  // don't match. Order matches SIGN_LAYOUTS' own key order.
  function buildSheets(items) {
    const groups = emptyLayoutGroups();
    items.forEach((t) => groups[layoutKeyFor(t)].push(t));
    const sheets = [];
    Object.keys(SIGN_LAYOUTS).forEach((key) => {
      const { perSheet } = SIGN_LAYOUTS[key];
      const groupItems = groups[key];
      for (let i = 0; i < groupItems.length; i += perSheet) {
        sheets.push({ layoutKey: key, items: groupItems.slice(i, i + perSheet) });
      }
    });
    return sheets;
  }

  // Auto-arrange (beta): a real 2D bin-packer, not just per-type grouping
  // (see buildSheets). Runs in two stages, the standard reduction from 2D
  // bin-packing to 1D bin-packing via "shelves":
  //
  // 1. packItemsIntoShelves - First-Fit Decreasing Height (FFDH): sort every
  //    item (any type, any size) tallest-first, then place each into the
  //    first existing shelf with enough leftover width, or start a new shelf
  //    if none fits. Sorting tallest-first guarantees a later item is never
  //    taller than a shelf it joins, so a shelf's height is always just its
  //    first item's height. This is what lets a row mix types/sizes (e.g. a
  //    Quarter Shelf Talker next to a Small Display Sign) instead of only
  //    ever stacking same-type rows.
  // 2. packShelvesIntoPages - greedily stacks the resulting shelves onto
  //    pages by height budget, same as before.
  //
  // FFDH is a well-known shelf-packing heuristic (provably within ~1.7x the
  // optimal area) that's simple enough to keep deterministic and cheap for
  // the handful of items a print queue realistically holds.
  function packItemsIntoShelves(items) {
    const rects = items
      .map((talker) => {
        const layoutKey = layoutKeyFor(talker);
        return { talker, width: SIGN_LAYOUTS[layoutKey].printWidth, height: itemHeightIn(layoutKey) };
      })
      .sort((a, b) => b.height - a.height);

    const shelves = [];
    rects.forEach((rect) => {
      const shelf = shelves.find((s) => s.usedWidth + ITEM_GAP_IN + rect.width <= PAGE_CONTENT_WIDTH_IN + 0.001);
      if (shelf) {
        shelf.usedWidth += ITEM_GAP_IN + rect.width;
        shelf.items.push(rect.talker);
      } else {
        shelves.push({ height: rect.height, usedWidth: rect.width, items: [rect.talker] });
      }
    });
    return shelves;
  }

  function packShelvesIntoPages(shelves) {
    const pages = [];
    let current = null;
    let usedHeight = 0;
    shelves.forEach((shelf) => {
      const fitsOnCurrent = current && (usedHeight + ROW_GAP_IN + shelf.height) <= PAGE_CONTENT_HEIGHT_IN + 0.001;
      if (fitsOnCurrent) {
        usedHeight += ROW_GAP_IN + shelf.height;
      } else {
        current = { rows: [] };
        pages.push(current);
        usedHeight = shelf.height;
      }
      current.rows.push(shelf);
    });
    return pages;
  }

  function buildAutoArrangedPages(items) {
    return packShelvesIntoPages(packItemsIntoShelves(items));
  }

  return {
    PAGE_WIDTH_IN,
    PAGE_HEIGHT_IN,
    PAGE_MARGIN_IN,
    PAGE_CONTENT_WIDTH_IN,
    PAGE_CONTENT_HEIGHT_IN,
    ITEM_GAP_IN,
    ROW_GAP_IN,
    SIGN_LAYOUTS,
    printWidthCss,
    itemHeightIn,
    layoutKeyFor,
    buildSheets,
    packItemsIntoShelves,
    packShelvesIntoPages,
    buildAutoArrangedPages,
  };
});
