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
- **wine-pairings-experimental-toggle.html** &mdash; follow-up to
  food-pairing-suggestions.html above: scopes that same feature behind a new
  **Wine Food Pairings** toggle switch under Settings &rarr; **Experimental
  Features** (targets the `2.6` branch, which already has that section, currently
  empty). Off by default &mdash; while off, the Edit Talker form, the card's
  "Pairs Well With" block, and the Pairing Rules panel are all absent, not just
  disabled. Flip the switch in the Settings modal (open by default) to see all
  three appear live, and back off to confirm nothing is left behind. Also
  introduces this app's first on/off switch component (`.switch`), since
  Settings today only has the toggle-btn pill-pair pattern (Change Theme, Menu
  Bar Size) &mdash; not the right shape for a single boolean feature flag.
- **wine-pairing-regions.html** &mdash; follow-up to food-pairing-suggestions.html
  above: deepens the pairing rules with an optional second matching tier.
  After a varietal rule matches (Cabernet Sauvignon, Malbec, Pinot Noir&hellip;),
  its own ordered list of country/region sub-rules (e.g. Napa Valley vs.
  Bordeaux for Cabernet) is checked against the same title/description text;
  a region match swaps in one more specific candidate pairing and appends
  the region to the printed label ("Malbec &mdash; Mendoza, Argentina"). Region
  is opt-in per rule and never required &mdash; only 6 of the 14 varietal
  rules carry region sub-rules here, and a title with no region wording
  still gets exactly today's base pairings. The **Pairing Rules** panel
  shows each varietal's nested region rules, with the currently active one
  (if any) highlighted; the sample wines on the left include several picked
  to trigger a swap and a few picked not to, so both cases are easy to
  compare.
- **mash-bill-library.html** &mdash; proposes a persistent **Mash Bill
  Library** behind the existing Bourbon Shelf Talkers mash bill chips, so a
  grain composition researched once can be recalled on later talkers instead
  of re-typed every time. Research stays exactly where it is today (manual
  chips) plus a new **Auto-Fill from Distiller.com** button using the same
  scrape-then-editable-preview pattern as Find Tasting Notes. A "Save this
  mash bill to the Library" option on the Mash Bill field stores it either
  under the exact product title or as a distillery-wide default; a new
  **Manage Mash Bill Library** dialog (styled like Manage Reviewers) lists,
  edits, and deletes saved entries. Confirmed as a real **shared database**
  scoped to one store's LAN: the Server PC's `data.db` holds the one
  authoritative `mash_bills` table, and every other register keeps only a
  synced read cache &mdash; the same single-writer-of-record shape
  `exportSync.js` already uses for the WinePOS export, extended with real
  `POST`/`PUT`/`DELETE` endpoints since (unlike that export) a mash bill can
  be researched at any register, not just the one WinePOS writes to. A
  "Preview: Server PC unreachable" toggle on the sync status row dramatizes
  the resilience story: recall keeps working off the last-synced cache,
  saving surfaces an honest inline error instead of a silent local
  fallback. A pill toggle at the top switches between the two ways a saved
  entry can be matched back to a talker &mdash; **Exact Expression** vs.
  **Distillery Default** &mdash; using Four Roses (one distillery, ten
  different recipe codes) to show live why an exact match is recommended as
  the primary strategy, with distillery-default only ever offered as a
  clearly-flagged fallback, never a silent auto-fill. **Implemented** in a
  follow-up to this mockup &mdash; see the README's own Mash Bill Library
  section for the shipped behavior, which stuck to exact-title matching
  only (see that section for why).
- **live-preview-talker-selection.html** &mdash; lets staff click a talker
  directly on the **Full Page** Live Preview to edit it, instead of having to
  find the matching row in the Queue list below and open its &#8942; menu.
  Hovering a talker on the sheet lifts it slightly and shows a small
  **&#9998; Edit** badge; clicking it (or Tab + Enter, since each talker is a
  real `<button>`) does exactly what the Queue row's existing Edit action
  already does &mdash; fills the Edit Talker form, switches Live Preview back
  to **Current Talker**, and scrolls to the top &mdash; just via a second,
  more visual entry point. Single-target click-to-edit only, not multi-select/
  bulk actions; Move/Duplicate/Delete stay in the Queue row's menu.
