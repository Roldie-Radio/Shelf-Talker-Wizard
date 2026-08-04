# Shelf Talker Wizard

A small web app for Liquor Outlet Wine Cellars to create print-ready shelf talkers without opening Photoshop. It reproduces the look of the existing amber/purple templates (same logo, layout, and card size) and adds:

- **Manual entry** form for title, description, size/unit, regular price, and sale price. For Wine / Spirits, a **Find Tasting Notes** button next to Description opens a dialog that searches Wine.com and/or Vivino using the Product Title (and Vintage, if set) and lets you preview and edit the result before it fills the field &mdash; no URL to paste, just a title to search with.
- **Import from website** &mdash; paste a product page URL and the app tries to pull the title, description, and price automatically (reads the page's structured product data), so you can review and tweak before adding it. Switch the Import tab to Beer to pull from an Untappd beer page instead &mdash; brewery, location, style, ABV, IBU, rating, and description, since Untappd doesn't have a price to import.
- **SKU lookup** &mdash; type in the store's own SKU number and the app searches liquoroutletwinecellars.com for it, pulling the title, size, and price from the matching product page. For Beer, it also searches Untappd using that title for the description, brewery, style, ABV, IBU, and rating.
- **Standardized sizing** &mdash; every card is the same print dimensions as the original template, and title/description text automatically shrinks (or clamps with an ellipsis as a last resort) so it always fits, no manual formatting needed. The shrink-to-fit is applied to what actually prints, so the Print Preview and the paper agree.
- **Two brand themes** (Amber / Purple) matching the provided templates, mixable on the same print run.
- **Three talker styles**: Standard (regular/sale price), Closeout (yellow "CLOSEOUT!!" badge + a single sale price), and Super Sale (a stylized "Super Sale Price!!!" callout in place of a numeric price) &mdash; matching the store's existing Closeout/Super Sale templates.
- **Ratings** &mdash; an optional list of critic ratings (e.g. "95 Pts Jim Murray"). Reviewers are picked from a managed dropdown (seeded with Wine Enthusiast, Wine Spectator, Wine Advocate, James Suckling, Jim Murray) that you can add to or trim from the "Manage reviewers" link.
- **Full-page preview** &mdash; toggle the Live Preview between the single talker you're editing and a scaled Letter-landscape sheet showing the whole queue 6-up, with Prev/Next pagination past 6 items.
- **Print-ready sheets** &mdash; queue up talkers and print; they're laid out 6-up on Letter-size paper (3 columns &times; 2 rows), the same arrangement as the original template, paginating automatically if you have more than 6.
- Your queue is saved in the browser (localStorage) so it survives a refresh.
- **In-app Help** &mdash; the Help button in the top right (and the desktop app's Help menu) opens a quick-reference panel covering every tab, SKU lookup, importing, and printing, so staff aren't sent looking for this README.

## Running it

Requires [Node.js](https://nodejs.org/) 18+ (for built-in `fetch`).

```bash
npm install
npm start
```

Then open http://localhost:3000 in a browser.

## Windows installer (for store PCs)

For running on the Dell OptiPlex / Windows 11 store PCs, this app is also packaged as a
standalone desktop app (Electron) with a normal Windows installer &mdash; Start Menu and
Desktop shortcuts, an uninstaller, no browser or command line required. Staff just double-click
"Shelf Talker Wizard" like any other program.

**Getting the installer:** a Windows `.exe` can't be built from a Mac/Linux machine, so it's
built by a GitHub Actions workflow (`.github/workflows/build-windows.yml`) instead. There are
two ways to trigger it:

- **One-off / testing a change:** in this repo on GitHub, go to
  **Actions &rarr; Build Windows Installer &rarr; Run workflow**. When it finishes (a couple of
  minutes), open the run and download the `ShelfTalkerWizard-Windows-Installer` artifact.
  Artifacts expire after 30 days and aren't versioned &mdash; use this for quick checks.
- **Shipping an actual update (recommended):** tag a version. This is the repeatable path for
  every future release:

  ```bash
  npm run release:patch   # bug fixes: 1.0.0 -> 1.0.1
  npm run release:minor   # new features: 1.0.0 -> 1.1.0
  npm run release:major   # breaking/major changes: 1.0.0 -> 2.0.0
  ```

  Each of these bumps the version in `package.json`, commits it, creates a git tag (e.g.
  `v1.0.1`), and pushes both. Pushing a `v*` tag automatically triggers the workflow, which
  builds the installer **and** publishes it as a permanent asset on the repo's
  [**Releases**](../../releases) page (named e.g. "Shelf Talker Wizard v1.0.1") &mdash; a stable
  link that won't expire, so that's the one to send to the store PCs.

Either way, copy the resulting installer to each OptiPlex and run it once to get it installed. No
Node.js or other dependencies needed on the PC; everything (including a private copy of Node) is
bundled inside. After that, the app checks for updates itself (a few seconds after launch, and via
**Help &gt; Check for Updates&hellip;**), downloads new releases in the background with a visible
progress window, and prompts to restart when one's ready &mdash; re-running the installer by hand
is only needed for the very first install on a PC.

`nsis.artifactName` in `package.json` is pinned to `Shelf-Talker-Wizard-Setup-${version}.exe`
(no spaces) on purpose: electron-builder's own auto-update metadata (`latest.yml`) references a
hyphenated filename regardless of what the installer itself is actually named, and GitHub
additionally mangles spaces in uploaded asset names into dots - leaving the default artifactName
(which does have spaces) means those three names disagree and the in-app updater 404s trying to
download the mismatch. Don't remove or reintroduce spaces into this without re-checking that a
real release's `latest.yml` and its uploaded `.exe` asset name still match exactly.

To build it yourself instead, on a Windows machine with Node 18+:

```bash
npm install
npm run dist:win
```

The installer is written to `dist/`.

### How it's packaged

- `electron/main.js` is the desktop app's entry point: it starts the same Express server
  in-process (on a fixed local port, `127.0.0.1` only) and opens it in a native window.
- `server/index.js` exports `start()` so both the plain CLI (`npm start`) and the Electron
  wrapper can launch the same server.
- `build/icon.ico` / `build/icon.png` are the app icon (a grape-cluster mark in the template's
  amber color, generated to match the brand).
- The `build` section of `package.json` configures `electron-builder` to produce an NSIS
  installer with Desktop/Start Menu shortcuts.

## Using the website import

Click **Import from Website**, paste a product page URL from liquoroutletwinecellars.com, and click **Fetch Product Data**. The importer looks for (in order):

1. The page's `application/ld+json` Product schema (name, description, price) &mdash; most modern storefronts (Shopify, WooCommerce, BigCommerce, etc.) include this automatically.
2. Open Graph / meta description tags as a fallback.
3. Common "was / now" price markup (e.g. Shopify's `price-item--sale` / `price-item--regular` classes, or WooCommerce's `<del>`/`<ins>` price tags) to detect a sale price.

If a page doesn't expose any of this, the fields will come back blank and you can fill them in manually &mdash; the import is a shortcut, not a requirement.

If a site blocks the request outright (some, like wine.com, actively block automated fetches), the importer automatically retries once with a different set of request headers before giving up &mdash; same as the Untappd import below. If it's still blocked, click **Site blocking the fetch? Paste the page's HTML instead** under the Fetch button: open the same page in your own browser (which already gets past the block), copy its HTML source (right-click &rarr; View Page Source, or Ctrl/Cmd+U, then select all and copy), and paste it in. It's parsed exactly the same way a successful fetch would be, with no network request of its own.

### Finding tasting notes automatically

On Manual Entry, Wine / Spirits items have a **Find Tasting Notes** button under the Description field. Unlike the website importer above, there's no URL to paste: click it (with a Product Title already filled in) to open a dialog that searches using **Product Title** (plus **Vintage**, if set).

- The **Source** dropdown picks which site to search &mdash; **Any source** (the default) tries each in order and stops at the first that finds something; picking a specific site searches only that one.
- Whatever's found shows in an editable preview box, so you can review or tweak it before it goes anywhere near the queue.
- **Use This Description** copies the preview into the form's Description field (asking first if you'd overwrite something already typed) and closes the dialog; **Cancel** closes it without changing anything.
- If a source blocks the request outright, it automatically retries once with a different set of request headers before giving up &mdash; same as the Untappd import below. If a source still can't be reached, or has nothing for that product, the dialog shows why right there, and you can pick a different source, click **Search Again**, or just type the description into the preview box by hand.

The lookup is written as an ordered list of providers (Wine.com and Vivino today) so another source can be added later without changing how the dialog works &mdash; it would just show up as another option in the Source dropdown.

### Importing a beer from Untappd

Switch the Import tab to **Beer**, paste an Untappd beer page URL (`https://untappd.com/b/...`), and click **Fetch Beer Data**. This fills in the beer name, brewery, location, style, ABV, IBU, Untappd rating, and description &mdash; not price or size, since Untappd doesn't sell anything; add those two by hand.

Untappd's page layout isn't something this project controls, so the importer leans on things unlikely to break even if it changes: the page's Open Graph tags for the name/description, and plain-text pattern matching for the ABV/IBU/rating numbers, rather than exact markup. Same as the product importer above, a field it can't find just comes back blank for you to fill in.

If Untappd blocks the request outright, the importer automatically retries once with a different set of request headers before giving up &mdash; you'll only see an error if both attempts are blocked. If that happens, wait a bit and try again, try from a different network, or just fill the fields in by hand.

Location isn't on the beer page itself &mdash; the importer follows the brewery name's link to that brewery's own Untappd page and pulls it from there, a second request made automatically after the first. If that second page can't be reached, the rest of the import still goes through; only location comes back blank.

### Looking up a product by SKU

Click **SKU Lookup**, switch between **Wine / Spirits** and **Beer** to match the product, type in the store's SKU number, and click **Look Up SKU**. This searches liquoroutletwinecellars.com for that SKU, opens the matching product page, and pulls the title, size, and pricing from it &mdash; the SKU itself is matched exactly against each search result's own SKU, not by fuzzy title matching, so there's no "closest guess" to double-check.

For **Beer**, the lookup runs a second step automatically: it searches Untappd using the title just found and, if it finds a match, fills in the description, brewery, style, ABV, IBU, and rating from there instead of the store page's own generic description &mdash; matching what Untappd import already does for a pasted beer URL. If Untappd has nothing for that title, the store page's own description is used instead, and the rest of those fields are left blank for manual entry.

If the store site blocks the lookup, click **Site blocking the lookup? Paste the product page's HTML instead**: search the SKU yourself on the store's website, open the matching product page, copy its HTML source, and paste it in &mdash; same fallback as the website importer above, with no network request of its own (beyond the Untappd search for a beer entry).

## Printing

1. Add shelf talkers via any of the three methods.
2. Review them in the **Queue** panel. Each row's &vellip; menu can move it up or
   down (queue order is print order), edit it, copy it, or delete it.
3. Click **Print Sheet(s)**. A preview shows every sheet exactly as it will print
   &mdash; including how full each one is &mdash; before anything reaches the printer.
4. Click **Print Now**. This opens your browser's print dialog with pages already
   formatted for Letter paper, 6 talkers per sheet. Choose "Save as PDF" instead of a
   printer if you want a PDF file.

## Project layout

```
server/
  index.js            Express app: serves the frontend and the URL-import API
  productImport.js    Fetches a product/Untappd page and extracts title/description/price or beer details,
                      plus the Wine.com/Vivino tasting-notes search and the store SKU/Untappd lookup behind
                      the Find Tasting Notes button and SKU Lookup tab
public/
  index.html          Wizard UI
  css/styles.css      App styling + the shelf-talker card + print layout
  js/layout.js         Print-sheet geometry + sheet/auto-arrange packing (no DOM)
  js/card.js           Card rendering + auto text-fit
  js/app.js            Form, queue, import, SKU lookup, and print wiring
  assets/logo.png      Brand logo (extracted from the provided template)
test/
  layout.test.js          Packing invariants: every layout fits a sheet, no item lost
  print-css-sync.test.js  Guards the JS geometry against the print CSS
```

## Tests

```bash
npm test
```

No dependencies and no install step needed &mdash; they use Node's built-in test
runner, and run on every push via `.github/workflows/test.yml`.

The print geometry lives in two places that can't see each other: the numbers in
`public/js/layout.js` (which the auto-arrange packer budgets against) and the
`@media print` rules in `public/css/styles.css` (which the browser actually lays
the page out with). If those drift apart nothing complains at runtime &mdash; the
packer will happily fit six items onto a page CSS then renders seven across, and
the overflow silently clips. `print-css-sync.test.js` reads the real values back
out of the stylesheet and fails if they stop agreeing, so **if you change a page
margin, gap, card size or aspect ratio, change it in both places** and let the
tests confirm it.

## Customizing

- **Card proportions and theme colors** live at the top of `public/css/styles.css` (the `.card` rules and `--amber-band` / `--purple-band` variables) &mdash; these were measured directly from the provided PSD templates.
- **Card fields/markup** are generated in `public/js/card.js`.
- To add a third theme, add a new `--yourtheme-band` CSS variable, a `.card[data-theme="yourtheme"]` rule, and add the option to the `<select id="fTheme">` in `index.html`.
