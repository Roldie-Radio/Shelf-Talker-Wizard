# UI mockups

Standalone, self-contained HTML mockups for proposed UI changes &mdash; not part of
the running app, just click-through prototypes for review. Open one directly in a
browser.

- **search-tab-consolidation.html** &mdash; groups the **Search by Name**, **SKU
  Lookup**, and **Scan UPC** tabs under one new **Search** tab, cutting the form
  panel's top-level tab row from five tabs to three. Every top-level tab (Manual
  Entry, Import from Website, Search) now opens with the same two dropdowns:
  **Type** (Shelf Talker / Small Display / Large Display) and **Product Type**
  (Wine / Spirits / Beer), replacing the old Shelf Talkers/Display Signs +
  Large/Small toggle buttons and the Wine/Spirits/Beer pill toggle. Both are
  wired as shared state across tabs. Inside Search, a method chooser (Search by
  Name / SKU Lookup / Scan UPC) sits below Type/Product Type, styled as the same
  pill-button group used elsewhere in the form.
- **food-pairing-suggestions.html** &mdash; proposes an optional **Food Pairing
  Suggestions** block on Wine / Spirits talkers: up to 3 small icon+word pairings
  (e.g. "🥩 Grilled Steak") printed between the description and the price block.
  Pairings come from a small ordered list of varietal &rarr; pairings rules,
  matched by keyword against the Product Title/Description &mdash; the same
  pattern `public/js/card.js` already uses for `BEER_STYLE_COLORS`, just applied
  to wine varietals. Staff can accept the suggested pairings, toggle individual
  ones on/off, add a custom pairing, or hide the block entirely per talker. Try
  the sample wines in the left panel to see detection run against the rule list
  shown in the right panel; the live card preview in the center reuses the real
  card's proportions/fonts/logo so the new block can be judged in context.
