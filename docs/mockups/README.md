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
- **bourbon-profile-page.html** &mdash; follow-up to mash-bill-library.html
  above: proposes a read-focused **profile page** on top of each saved
  Mash Bill Library entry &mdash; distillery, parent company, tasting
  notes, and mash bill together, doubling as a staff reference instead of
  only feeding the Edit Talker form's recall banner. Introduces a
  **Mash Bill Confidence** section: a four-tier score (Confirmed / Reported
  / Estimated / Unknown) reflecting how directly a grain composition traces
  back to the distillery itself, since a lot of this data is
  industry-reported rather than officially disclosed. Each tier gets a
  color badge, a dot meter, a one-line rationale, and an expandable
  source-citation list; deliberately staff-only &mdash; it never prints on
  the shelf talker, only the grain bar does when one is known. The five
  sample entries (Buffalo Trace, Four Roses, Blanton's, Michter's,
  Redemption) are drawn from the public-source research behind the mash
  bill seed list, picked so all four tiers show up at least once instead of
  clustering in the middle. Not yet backed by real schema &mdash;
  <code>mash_bills</code> today has no parent-company, category,
  tasting-note, or confidence columns; this mockup is scoped to the page
  and scoring design, not the data-model changes it would need.
- **bourbon-library-app-shell.html** &mdash; follow-up to
  bourbon-profile-page.html above: confirms **Bourbon Shelf Talkers** (the
  mash bill chip builder, Nose/Palate/Finish, Store Pick) stays gated
  behind Settings &rarr; Experimental Features exactly as today, but takes
  the **Bourbon Library** itself out from under that toggle and out of
  Tools&hellip; into something that reads as its own space within the
  program. Compared three entry points and settled on a persistent
  **Sidebar Rail** &mdash; three icons: **Shelf Talker** (the entire
  existing app, renamed from an earlier "Build"), **Library**, and
  **Settings**. Queue and History never got their own icons because
  neither is a separate top-level screen today &mdash; Queue is already
  the side panel next to the form, History is already a button that opens
  a dialog &mdash; so both stay nested inside Shelf Talker exactly as they
  already work. Settings kept its own rail icon (an earlier pass folded
  it into Shelf Talker as a dialog, then un-folded it back onto the rail)
  since it's the one screen most likely to grow more settings over time.
  Two rail icons are drawn from the product itself instead of emoji:
  **Shelf Talker** is a small inline-SVG rendering of an actual printed
  talker (white card, dark border, a red price block, using the same
  fixed <code>--ink</code>/<code>--sale-red</code> print colors the real
  cards use), and **Bourbon Library** is a Glencairn glass redrawn (from a
  user-supplied reference image) as two stacked SVG paths &mdash; a
  solid-filled bowl/foot underneath, a stroke-only outline on top spanning
  rim to base &mdash; so the neck reads as glass and the bowl as contained
  liquid, no clip-path needed. Same technique on the rail icon (gold fill)
  and the Library header band's own icon (cream fill, so it reads against
  that icon's gold badge instead of disappearing into it). The rail's
  brand mark at the top is the real Liquor Outlet Wine Cellars logo
  (embedded inline, base64) now too, not a placeholder "STW" badge. Once
  inside the Library, it gets a distinct dark "reading
  room" header band (same fonts/radii/accent family as the rest of the
  app, just a different room) with search, a card grid (swaps the flat
  table for something more browsable), working confidence filter chips
  (All / Confirmed / Reported / **Needs verification**, the last one
  doubling as a real research to-do list), and the profile page from
  bourbon-profile-page.html re-chromed with a back-to-grid breadcrumb.
  Presentation only &mdash; storage/sync stays the existing Mash Bill
  Library design. Also surfaces and resolves a gap earlier passes missed
  entirely: the real app's Windows-style menu bar (File / Tools /
  Advanced / Help, above the app bar, see <code>#menuBar</code> in
  index.html) never appeared in this mockup before. **Decided:**
  Advanced (Export File Settings, View Export File, Server PC) and Help
  (What's New, Check for Updates, About) become two new sections on the
  Settings screen, alongside Experimental Features &mdash; Mash Bill
  Library and Settings itself had already dropped out of Tools since both
  have rail icons now. That leaves just File and Tools (Open/Save/Find
  Queue, Beer Talker Info, Wine Pairing Rules) as a working menu bar
  (native <code>&lt;details&gt;</code> dropdowns, no extra JS), and since
  both operate on the Queue &mdash; which persists no matter which rail
  icon is active &mdash; that bar now spans the **full width of the app,
  above the rail**, as permanent chrome rather than living inside the
  Shelf Talker screen. Flags one open question this raises: the Queue
  side panel itself still only renders on the Shelf Talker screen even
  though File &gt; Save Queue is now reachable from anywhere, which the
  notes call out rather than resolve. Fixes a second dropped piece too:
  the real Shelf Talker screen is a three-column layout (form, **Live
  Preview**, Queue, see <code>.layout</code> in styles.css) and this
  mockup had quietly collapsed to two columns, form and Queue only. Live
  Preview is back as its own column with the same Current Talker / Full
  Page toggle the real app uses. Its first pass looked nothing like the
  real thing, so the preview card and Queue rows were both redone against
  the actual CSS: the preview card now carries the amber
  <code>.card__band</code> strip, a 2px ink border, Verdana price type,
  and an ink-colored <strong>Regular Price</strong> (only a Sale Price is
  ever red on a real card); Full Page wraps its mini cards in a white
  sheet boundary instead of a bare grid; and Queue rows now have the
  colored theme swatch, bold truncating title, muted meta line, and
  &#8942; kebab button that <code>.queue-item</code> actually has, not a
  plain text line. Both still react to the rest of the screen's state
  &mdash; Bourbon Shelf Talkers on/off toggles the mash bill bar, and
  Full Page's cards come from the same queue data the Queue panel shows.
  Other open questions (a real "Add a bourbon" flow, grid vs. table at
  scale) also remain.
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
- **chilled-independent-toggle.html** &mdash; pulls **Also Available Chilled**
  out of the **Talker Style** dropdown (`#fTalkerType` in `public/index.html`),
  where it currently sits as a 4th option mutually exclusive with Standard/
  Closeout/Super Sale, into its own independent field below it &mdash; off by
  default, combinable with any Talker Style. Mirrors the shape the form
  already uses for **Store Pick** (`#fStorePick`), whose own help text and the
  `card.js` comment on it call out this exact problem by name. Two
  interchangeable control shapes (a checkbox row and an on/off switch) are
  wired to the same underlying state side by side, since the request asked
  for &ldquo;a toggle button or checkbox&rdquo; &mdash; flip **Control Style**
  above the field to compare them; ship one, not both. The live Shelf Talker
  card preview shows the CLOSEOUT!!/Super Sale badges stacking with the
  Chilled callout instead of being replaced by it, and a fixed **All
  Combinations** panel shows all three Talker Styles with Chilled on side by
  side for a quick sanity check.
