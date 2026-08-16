# UI mockups

Standalone, self-contained HTML mockups for proposed UI changes &mdash; not part of
the running app, just click-through prototypes for review. Open one directly in a
browser.

- **mash-bill-pie-chart.html** &mdash; proposes replacing the Bourbon Library
  profile page's Mash Bill stacked bar with a **donut chart**, the exact
  percentage printed directly on any slice wide enough to hold it (roughly
  &ge;12%), plus a numeric legend beside it so every grain's percentage is
  always visible regardless of slice size. The center of the donut callouts
  the dominant grain's own percentage and name. Hovering a slice highlights
  its legend row and vice versa. The old bar isn't removed &mdash; a
  **Compare to bar** toggle in the block header still shows it, since it's
  what actually prints on the shelf talker (`buildMashBillHtml` in
  `card.js`); the chart is a profile-page-only addition. The eight sample
  bourbons are real library entries chosen to cover a 2-grain rye, a wheated
  bourbon, a 4-grain "triple malt" recipe, an all-non-corn mash bill
  (Ransom Emerald), a smoked-malt specialty grain (Bulleit Mesquite Smoked
  Malt), and the "Unknown"-tier placeholder case (Heaven Hill Grain to
  Glass), which renders as a dashed, half-opacity ring with a "not yet
  researched" note instead of presenting its schema-required placeholder
  grain as a real recipe. Also proposes an **extended grain color
  palette** &mdash; `MASH_BILL_GRAIN_COLORS` in `card.js` only covers six
  grains today, but the Bourbon Library's 279 researched entries introduced
  real grain names outside that list (Red Winter Wheat, Malted Wheat,
  Honey/Caramel Malted Barley, 6-Row Distiller's Malt, Mesquite Smoked
  Malt, plain "Barley", "Oats") that currently all collapse to one grey
  fallback swatch; the mockup's design notes include a full proposed
  palette table (family-grouped tints, one deliberately distinct color for
  the smoked malt) that needs sign-off before implementation. **Implemented**
  in a follow-up to this mockup (`mashBillVizHtml`/`LIBRARY_GRAIN_COLORS` in
  `app.js`) &mdash; the donut, legend, hover-sync, Compare to bar toggle, and
  extended palette all shipped as described; the palette itself dropped
  the "Oat" vs. "Oats" split from the mockup's proposal (both map to the
  same tint, since one's the printed talker's own spelling and the other's
  the library's) but is otherwise unchanged. The dashed "Not yet researched"
  ring did ship, in a second pass, but keyed off a narrower signal than the
  mockup's plain "unknown"-tier check: real "unknown"-tier entries don't
  consistently use a placeholder grain list the way the mockup's one example
  did (some, like Angel's Envy Rye Finished Caribbean Cask, carry a specific
  researched percentage split despite the tier), so `isPlaceholderMashBill`
  in `app.js` only treats an entry as a placeholder when it's both
  "Unknown"-tier *and* a single 100%-of-one-grain row &mdash; the exact
  schema-default shape the seed data's own "Placeholder only, not a
  finding" entries use, verified against every real single-grain entry in
  the library (New Riff's single malt, Woodinville's 100% rye, etc.) to
  confirm none of those are ever tiered "Unknown". Placeholder entries also
  show "N/A" in place of a percentage and drop the Compare to bar button,
  since there's nothing real to compare either.
- **parent-company-browse.html** &mdash; proposes a second Bourbon Library
  browse mode, alongside the existing bourbon grid: a **company view**
  listing all 66 parent companies (a real duplicate-naming bug this mockup
  surfaced &mdash; "Luxco (MGP Ingredients)" vs. "Luxco/MGP Ingredients"
  for the same company &mdash; was fixed in the seed data as a result,
  dropping the count from 67), tiered by bourbon count into **Featured**
  (13+, currently the top 5 &mdash; Beam Suntory, Sazerac, Heaven Hill,
  Brown-Forman, Diageo), **Major** (5&ndash;12), and everyone else
  (1&ndash;4), each tier rendered at its own card size/density rather than
  a literal proportional treemap (unreadable at 66 items with company
  names as long as "Latitude Beverage Co. (Liquor Barn private label)").
  Sort toggle (Most bourbons / A&ndash;Z, defaulting to count-descending)
  plus a live company-name search. Clicking any company (any tier) drills
  into a detail view listing every one of its bourbons with a breadcrumb
  back &mdash; the same grid&rarr;profile&rarr;back relationship
  `libraryViewMode` already gives the bourbon grid, proposed here as a
  third mode on that same state machine rather than a separate screen.
  All company counts and bourbon lists are the real, current library data
  (embedded directly from `scripts/bourbon-library-seed-data.json`), not
  placeholders.
- **parent-company-entry-point.html** &mdash; follow-up to parent-company-browse.html
  above: shows the real, current Bourbon Library home screen (rail, header
  band, search/chips/stats, bourbon grid) with one addition &mdash; the
  existing **"Parent companies" stat** in the stats row becomes a button
  (hover state, chevron) rather than a new toolbar control living
  somewhere else, since that stat is already advertising the number every
  time staff open the library. Clicking it swaps `#libraryBody` into the
  company browse view from the previous mockup, exactly the way switching
  to a bourbon's own profile page already works today; the rail's Bourbon
  Library icon is the way back, always one click away.
- **mash-bill-pie-chart-profile-page.html** &mdash; follow-up to
  mash-bill-pie-chart.html above: drops the same donut chart into the
  **real, complete profile page** &mdash; breadcrumb, tags, the Mash Bill
  block's confidence badge/meter/note and citation markers, the Tasting
  Notes block, the Distillery &amp; Ownership sidebar with its sibling-entry
  list, and the References &amp; Sources section &mdash; instead of the
  isolated component view the first mockup showed. Only the plain
  `.grain-bar` at the top of the Mash Bill block is replaced; everything
  else is untouched real `renderBourbonProfile` markup, reused verbatim
  down to class names. Four real sample bourbons cover the cases that
  matter in context: Buffalo Trace Bourbon (11 siblings at its distillery,
  clicking one re-renders the whole profile, chart included), Rabbit Hole
  Cavehill Bourbon (the 4-grain case with a real citation), Sazerac
  Straight Rye Whiskey (zero siblings, so the sidebar's sibling list is
  absent entirely rather than shown empty), and Heaven Hill Grain to Glass
  Specialty Barrel Bourbon (the "Unknown"-tier placeholder case, a dashed
  ring plus its 17-entry sibling list, most of which fall outside this
  mockup's small sample set and render as disabled rows saying so rather
  than broken links). **Implemented** in a follow-up to this mockup, in the
  real `renderBourbonProfile` &mdash; see the "Implemented" note on
  mash-bill-pie-chart.html above for exactly which entries the dashed
  "Not yet researched" ring applies to.
- **bourbon-library-sort-view.html** &mdash; adds a **Card / List** view
  switch and a **Sort** dropdown to the Bourbon Library's main grid, in a
  new toolbar row above the results &mdash; the same spot the Parent
  Company browse view's own search+sort toolbar already established. Both
  controls reuse existing components rather than introducing new ones: the
  view switch is the app's `.preview-toggle`/`.toggle-btn` segmented
  control (already used for Live Preview's Current Talker/Full Page
  switch), and Sort is the app's own `.field-select` dropdown (every form
  field in the app already looks like this), grouped into Alphabetical,
  Confidence, **Grain %** (Most Corn/Rye/Wheat/Malted Barley), Recipe
  (Simplest/Most complex by grain count), and SKU. List view reuses
  `.bourbon-list`/`.bourbon-row` from the Parent Company drill-down
  verbatim, extended with a metric slot + chevron. Whichever field the
  active sort orders by shows up as a small chip on every card/row in
  either view, not just the resulting order &mdash; e.g. "Most Corn %"
  shows each entry's actual corn percentage, "SKU (Low&ndash;High)" shows
  its SKU. The grain-% sorts sum grain **families**, not literal grain
  strings &mdash; classic wheated bourbons (Weller, Maker's Mark) record
  their secondary grain as "Red Winter Wheat," not "Wheat," so a literal
  match would have silently missed every one of them; verified live
  against all 279 real entries (embedded directly, trimmed to just the
  fields this view needs), which is also how this caught that the wheat
  family had to include three other spellings before "Most Wheat %" was
  trustworthy. Design notes suggested remembering the last-picked view/sort
  per PC (localStorage) &mdash; incorrectly citing Full Page/Current
  Talker's own toggle as already doing that; it doesn't persist at all
  (`previewMode` just resets to `'sheet'` on every load). **Implemented**
  in a follow-up to this mockup, in the real `renderLibraryGrid` &mdash;
  the sort dropdown, grain-family logic, list view, and adaptive metric
  chip all shipped as described, and the persistence idea shipped too,
  modeled on the toggle that actually does persist (`QUEUE_COLUMN_KEY`,
  the Queue column's own show/hide switch) instead of the mockup's
  mistaken citation.
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
- **wine-profile-infographic.html** &mdash; proposes an optional **Wine
  Profile** block for Wine / Spirits Shelf Talkers: five small at-a-glance
  meters &mdash; **Fruit, Body, Dry, Acidity, Alcohol** &mdash; each scored
  1&ndash;5 with filled dots, reusing the same visual language the app
  already uses for the Untappd Rating widget on Beer talkers
  (`.card__beer-dot`), just applied across five categories instead of one
  overall score. Sits directly under Description, above Ratings/Awards
  &mdash; its own line with a top divider, the same treatment
  `.card__flavor` (Nose/Palate/Finish) and `.card__pairings` (Pairs Well
  With) already use. Laid out as one horizontal strip (label over its own
  row of 5 dots, 5 equal columns) rather than 5 stacked full-width rows,
  since a wine talker can already be carrying Ratings, Awards, and Food
  Pairing chips underneath it &mdash; the strip trades a little column
  width for a lot of vertical space back. Staff set each score by clicking
  dots by hand, plus a **Suggest Profile** button next to the field that
  prefills all five from a small varietal keyword table matched against
  Product Title &mdash; the same pattern **Suggest Pairings** already uses
  for Food Pairing Suggestions, with suggested values staying fully
  editable and a status line tracking whether the current values came from
  a suggestion or were hand-edited. The six sample wines (Cabernet
  Sauvignon, Zinfandel, Sangiovese/Chianti, Pinot Grigio, Riesling,
  Moscato) are picked to show genuinely different shapes side by side. Not
  gated behind a real Experimental Features toggle here (see
  `wine-pairings-experimental-toggle.html` for that switch pattern) &mdash;
  this mockup uses a plain **Show Wine Profile on this shelf talker**
  checkbox instead, to keep the focus on the block itself. **Implemented**
  in a follow-up to this mockup &mdash; see the README's own Wine Profile
  section for the shipped behavior. It landed a plain Settings &rarr;
  Experimental Features &rarr; **Wine Profile** toggle (not the checkbox
  above) and dropped the mockup's separate keyword table in favor of
  attaching a `profile` object straight onto each existing
  `WINE_PAIRING_RULES` entry in `card.js`, so Suggest Profile and Suggest
  Pairings share one varietal match instead of two lists that could drift
  apart &mdash; the extension that `color` field's own comment had already
  flagged as coming later.
- **bourbon-library-autofill.html** &mdash; follow-up to mash-bill-library.html
  and bourbon-profile-page.html above: extends the shipped Mash Bill Library
  recall banner (`#mashBillRecallBanner`, exact-title match against
  `mashBillLibraryCache` &mdash; see `refreshMashBillRecall` in `app.js`) to
  also offer **Nose/Palate/Finish**, not just the grain chips. The Bourbon
  Library's `mash_bills` row has carried tasting notes and a Mash Bill
  Confidence tier since the profile-page work above shipped, but none of it
  flows onto a talker today &mdash; staff either retype it by hand or reach
  for the unrelated Find Tasting Notes external scrape instead. A pill
  toggle compares two banner layouts against the same five real Library
  entries: a single **Unified** banner (recommended) with a row per
  populated field, each individually "Use"-able plus one combined "Use
  All", versus **Two scoped banners** (the existing Mash Bill banner left
  exactly as it ships today, plus a near-identical new one above
  Nose/Palate/Finish). The five samples are real, current entries from
  `scripts/bourbon-library-seed-data.json`, chosen to cover the dataset's
  actual shape (279 entries: 239 fully researched, 39 placeholder-only, and
  one genuine outlier &mdash; WhistlePig Snout to Tail 10YR, whose tasting
  notes are fully sourced but whose mash bill is still the single-grain,
  100%, Unknown-tier placeholder shape) rather than invented cases.
  Surfaces a real gap in the shipped code along the way: `findMashBillMatch`
  matches on title alone and never checks `isPlaceholderMashBill` the way
  the Library's own donut-chart profile view already does (see
  mash-bill-pie-chart.html above), so the recall banner today already
  offers "Use It" on 40 entries' worth of fake placeholder compositions;
  this mockup's banner reuses the same placeholder check to show "Not yet
  researched" instead &mdash; try the Heaven Hill sample. Confidence
  surfaces on the Mash Bill row specifically, not the banner's title line,
  since `confidence_tier` is scored against the grain composition only
  (WhistlePig is the one entry where a whole-banner badge would have been
  actively wrong about the tasting notes). Overwrite safety on the two text
  fields reuses Find Tasting Notes' own one-combined-confirmation prompt
  verbatim; a "simulate staff already typed notes" checkbox pre-fills the
  fields first so the guard is easy to trigger and see. Also proposes
  closing the loop the other direction: a "Save this Nose/Palate/Finish to
  the Bourbon Library" checkbox next to the flavor fields, mirroring the
  existing "Save this mash bill to the Mash Bill Library" row &mdash;
  needed because nothing today saves tasting notes from a talker back into
  the Library (the only path in is the standalone Manage Mash Bill Library
  dialog). No new merge logic would be needed for it either:
  `upsertMashBill`'s title-keyed upsert already treats every optional
  column as "omit it to leave whatever's there alone." Deliberately scoped
  away from Distillery/Parent Company/Category/SKU/References, since none
  of those has a matching field on the printed talker itself to autofill
  into. Purely a `public/js/app.js` + `public/index.html` proposal &mdash;
  `rowToMashBill` in `server/db.js` already returns every column the banner
  needs, so no server or schema changes. **Implemented** in a follow-up to
  this mockup &mdash; the unified banner (not the two-scoped alternative),
  the placeholder guard, the Mash-Bill-row confidence badge, and the
  combined-confirmation overwrite guard on the flavor fields all shipped
  as described, verified against the real, running 279-entry seeded
  library rather than just the five samples here. The "Save this
  Nose/Palate/Finish to the Bourbon Library" checkbox shipped too, but the
  mockup's own claim that `upsertMashBill`'s "omit to leave alone"
  convention meant "no new merge logic needed" turned out to only be true
  of the *optional* columns (nose/palate/finish, etc.) &mdash;
  `upsertMashBill` itself still validates grains as required on every
  write, even one that only touches tasting notes, so it can't be used
  to add notes to an existing entry without also resending its grains.
  The real save button works around this the other way: PUT
  `/api/mashbills/:id` (`updateMashBillById`) falls back to whatever
  grains are already on the row when grains is omitted from the request,
  so saving onto a title the Library already has an entry for goes
  through that endpoint instead, touching nose/palate/finish only. POST
  (create) is still used for a title with no existing entry, which still
  needs the Edit Talker form's own Mash Bill chip list to have at least
  one grain in it first, exactly as the mockup assumed &mdash; saving is
  disabled with an explanation rather than attempting a doomed request
  when neither an existing entry nor any chips exist yet.
- **mash-bill-certainty-badge.html** &mdash; follow-up to
  bourbon-library-autofill.html above: Mash Bill Confidence
  (Confirmed/Reported/Estimated/Unknown) shows up in the recall banner and
  the Library's own profile page, but has never printed on an actual shelf
  talker &mdash; a shopper reading a mash bill percentage off the shelf has
  no way to know whether that's a distillery-published fact or a
  trade-press estimate. Proposes a small marker on the printed Mash Bill
  block, and works out what it would actually take to get a confidence
  value onto an individual talker rather than just a Library entry: a new
  `talker.mashBillConfidence` field, set alongside `currentMashBill`
  whenever the autofill banner's "Use"/"Use All" (Mash Bill row) is
  clicked, and cleared the moment the chip list is hand-edited afterward
  (`addMashBillGrain` or the `remove-mashbill` handler) since the rating no
  longer describes what's actually on the card &mdash; a hand-typed mash
  bill that was never autofilled carries no confidence and shows no badge
  under any style, since there's no honest basis for one. Stored on the
  talker itself rather than re-derived from the Library at render time, to
  match Print History's existing snapshot philosophy (a reprint months
  later shouldn't change because the Library entry it came from was since
  edited or deleted). A pill toggle compares three print treatments against
  four real/realistic samples (Buffalo Trace: Reported, Four Roses Single
  Barrel: Confirmed, Blanton's: Estimated, a hand-typed "Store Brand
  Kentucky Bourbon": no badge under any style) &mdash; **A: always show the
  tier** as plain text next to the label, **B: a dot meter** matching the
  staff UI's own `.conf-meter` language, and **C: quiet, only if not
  Confirmed** (recommended) &mdash; nothing extra on the common case, a
  small &dagger; plus one short footnote line otherwise. Recommendation
  reasons from two angles a mockup could easily gloss over: Confirmed/
  Reported/Estimated/Unknown are staff research-methodology terms, not
  shopper vocabulary, so printing "ESTIMATED" verbatim reads as a defect
  notice rather than a research footnote (Style C collapses all
  non-Confirmed tiers into one plain-language line instead); and dots read
  clearly in the app's own UI where staff already know the convention, but
  are meaningless to a shopper with no legend in front of them, which is
  why Style B isn't the pick despite being the most visually consistent
  with the rest of the app. All three styles stay inside the card's
  existing fixed print palette (`--ink`/`--muted` only, reusing the Mash
  Bill label's own colors) rather than bringing the staff badge's
  green/amber/red tint onto paper, which the mockup calls out as a real
  expansion of `public/css/styles.css`'s deliberately small, fixed print
  color set if it were ever proposed. Explicitly out of scope: no manual
  confidence picker for a hand-typed mash bill, no retroactive badges on
  talkers already printed/queued before this would ship (an absent
  `mashBillConfidence` already reads as "no badge"), and Quarter Size
  talkers never show the Mash Bill block at all regardless.
  **Implemented**, with one deliberate change from the recommendation
  above: always show the tier (Style A's behavior, including Confirmed),
  styled as an actual `.conf-badge`-shaped pill rather than plain text -
  the real request was "always show, but in the same badge style as the
  Bourbon Library," not Style C. The pill can't literally reuse
  `.conf-badge`'s own CSS as-is, though, since that badge reads its colors
  from the themed `--ui-good`/`--ui-warn`/`--ui-low`/`--ui-muted` tokens,
  which re-point with dark mode and the accent theme - fine for a
  staff-facing screen element, wrong for something that's supposed to
  print the same regardless of how the app happens to look on screen right
  now. `MASH_BILL_CONFIDENCE_PRINT_META` in `card.js` and
  `.card__mashbill-tier--*` in `styles.css` carry the same four tiers with
  fixed hex values instead, anchored to those tokens' own light-mode/
  default colors so the two badges still read as the same color family.
  Data model shipped exactly as designed: a new `talker.mashBillConfidence`
  field, set alongside `currentMashBill` by the recall banner's "Use"/"Use
  All" (Mash Bill row), cleared by `addMashBillGrain`/the `remove-mashbill`
  handler the moment the chip list is hand-edited afterward, and carried
  through `readForm`/`fillForm`/the Queue's own JSON serialization exactly
  like every other talker field - verified end to end against the real,
  running app (not just this mockup's samples), including a
  save-to-queue-and-reload round trip.
- **bourbon-sku-lookup-options.html** &mdash; follow-up to
  bourbon-library-autofill.html above, picking up the gap that mockup
  explicitly deferred: "Deliberately scoped away from
  Distillery/Parent Company/Category/SKU/References, since none of those
  has a matching field on the printed talker itself to autofill into."
  Store SKU does exist as a talker field, but only for Beer
  (`#beerFields` in index.html) - Wine/Spirits and Bourbon have no SKU
  field at all, and the Bourbon Library's own `sku` column (added since
  the autofill mockup shipped) is purely reference data today: staff read
  it off the profile page and retype it elsewhere by hand. `findMashBillMatch`
  also still only ever matches on an exact Product Title. Compares three
  ways to let a Library SKU drive the same autofill, all reusing
  `mashBillLibraryCache` and the existing Use/Use All actions rather than
  proposing a new data source: **A: extend the recall banner** (add a
  Store SKU field to Bourbon talkers, let `findMashBillMatch` check it
  alongside title - smallest change, same banner component, but passively
  discoverable); **B: a "Search Bourbon Library" picker** next to Product
  Title (a searchable-by-name-or-SKU overlay over the same list the Manage
  dialog already renders; picking a row fills Title/SKU/Mash Bill/flavor
  fields at once - more UI, but an explicit, browsable entry point for
  when staff don't already know the exact title or SKU); **C: a 4th
  Search-tab method** alongside Search by Name/SKU Lookup/Scan UPC,
  looking a SKU up against the Library instead of the WinePOS export -
  most consistent with the existing SKU Lookup mental model, but the
  least code reuse of the three, and the only one that doesn't build on
  top of the other two. All three demoed against the same real seed-data
  entry (Buffalo Trace Bourbon, SKU 15614) for continuity, with Four
  Roses Single Barrel and Blanton's as the extra picker rows in B.
  **Implemented**, as a variant of C: the existing single smart search box
  on the Search tab (`#smartSearchInput`) now also searches the Bourbon
  Library, by title or `sku`, whenever Product Type is Bourbon - shown as
  a live preview list underneath the box (`#bourbonSearchResults`) rather
  than a 4th method-panel pill, since staff shouldn't have to pick a mode
  first for something that already auto-detects name vs. SKU vs. UPC.
  Deliberately additive rather than a replacement for any of C's three
  panels: `detectSmartSearchMode`'s routing, and Search by Name/SKU
  Lookup/Scan UPC underneath it, keep working completely unchanged for a
  Bourbon product exactly as they already do for Wine/Spirits - typing a
  SKU still activates SKU Lookup and pulls price/size from WinePOS same as
  before, the Library preview just shows up alongside it. Entirely
  client-side against the already-fetched `mashBillLibraryCache` (a plain
  array filter, exact-SKU matches sorted first), no new endpoint. Picking
  a result fills Product Title plus whatever the recall banner's "Use All"
  already fills (Mash Bill, Nose/Palate/Finish) - overwriting outright
  rather than the banner's per-field confirm-before-overwrite, since
  picking a search result is a deliberate, one-shot choice, same as every
  other Search-tab result pick. Price/size/description stay blank (the
  Library has none to offer), called out explicitly in the confirmation
  message rather than left silently unexplained. Option A (a Store SKU
  field on Bourbon talkers) and Option B (a dedicated picker overlay)
  weren't needed to satisfy this - the existing search box and result-list
  pattern already covered it once SKU became a second match key instead of
  only title.
