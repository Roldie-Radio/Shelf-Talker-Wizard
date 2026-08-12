# Shelf Talker Wizard

A small web app for Liquor Outlet Wine Cellars to create print-ready shelf talkers without opening Photoshop. It reproduces the look of the existing amber/purple templates (same logo, layout, and card size) and adds:

- **Manual entry** form for title, description, size/unit, regular price, and sale price. For Wine / Spirits, a **Find Tasting Notes** button next to Description opens a dialog that searches Wine.com and/or Vivino using the Product Title (and Vintage, if set) and lets you preview and edit the result before it fills the field &mdash; no URL to paste, just a title to search with.
- **Bourbon Shelf Talkers** (experimental, off by default &mdash; Settings &rarr; Experimental Features) &mdash; adds three things to Wine / Spirits Shelf Talkers: Nose / Palate / Finish fields printed under the description (with a Distiller.com source in **Find Tasting Notes** that fills them in automatically &mdash; Distiller's scraper hasn't been confirmed against the live site, so always double-check what it finds before printing), a Mash Bill proportion bar (add each grain with its percentage and it prints as a stacked bar with a legend), and a Store Pick corner ribbon (independent of Talker Style, so it can still show up alongside a Closeout badge). Turning the toggle off hides all three again without deleting anything already on a talker.
- **Wine Food Pairings** (experimental, off by default &mdash; Settings &rarr; Experimental Features) &mdash; adds a **Food Pairing Suggestions** field to Wine / Spirits Shelf Talkers. Click **Suggest Pairings** to match the varietal detected in the Product Title/Description (e.g. Cabernet Sauvignon, Chardonnay) against a short built-in list of food pairings, then pick up to 3 to print under the description as a "Pairs Well With" line &mdash; or skip the suggestions and type your own. Turning the toggle off hides the field and the printed line again without deleting anything already on a talker.
- **Type and Product Type dropdowns on every tab** &mdash; **Type** (Shelf Talker / Small Display / Large Display) and **Product Type** (Wine / Spirits / Beer) sit at the top of Edit Talker, Website, and Search alike, and stay in sync with each other: change either one on any tab and it's still set that way when you switch tabs.
- **Import from website** &mdash; paste a product page URL and the app tries to pull the title, description, and price automatically (reads the page's structured product data), so you can review and tweak before adding it. Switch Product Type to Beer to pull from an Untappd beer page instead &mdash; brewery, location, style, ABV, IBU, rating, and description, since Untappd doesn't have a price to import.
- **Search** &mdash; one tab, three lookup methods so you don't have to type everything by hand: **Search by Name** matches by product title against a local product file, no internet needed to find the candidate list itself; **SKU Lookup** searches liquoroutletwinecellars.com by the store's own SKU number for the title, size, and price (plus, for Beer, an Untappd-sourced description, brewery, style, ABV, IBU, and rating); **Scan UPC** looks a bottle's manufacturer UPC up in a product file exported locally from WinePOS (a USB/Bluetooth barcode scanner just types it, like a keyboard) &mdash; a different number from the store's own SKU that SKU Lookup searches for. For Wine / Spirits, a UPC scan's Description is then filled from liquoroutletwinecellars.com (matched by the item's store SKU, if the export has one) rather than the export file's own Description column, which is often blank or just an internal note; Beer keeps whatever the export file has. Once a Beer result is picked, **Search by Name** also runs the same best-effort Untappd search SKU Lookup/Scan UPC use, off the export's own title, to fill in the brewery, style, ABV, IBU, and rating a WinePOS export doesn't carry. Only one PC needs WinePOS's own export &mdash; every other register can pull that file automatically over the network instead of it being copied around by hand (see "Sharing the export file across registers" below).
- **Standardized sizing** &mdash; every card is the same print dimensions as the original template, and title/description text automatically shrinks (or clamps with an ellipsis as a last resort) so it always fits, no manual formatting needed. The shrink-to-fit is applied to what actually prints, so the Print Preview and the paper agree.
- **Two brand themes** (Amber / Purple) matching the provided templates, mixable on the same print run.
- **Three talker styles**: Standard (regular/sale price), Closeout (yellow "CLOSEOUT!!" badge + a single sale price), and Super Sale (a stylized "Super Sale Price!!!" callout in place of a numeric price) &mdash; matching the store's existing Closeout/Super Sale templates.
- **Ratings** &mdash; an optional list of critic ratings (e.g. "95 Pts Jim Murray"). Reviewers are picked from a managed dropdown (seeded with Wine Enthusiast, Wine Spectator, Wine Advocate, James Suckling, Jim Murray) that you can add to or trim from the "Manage reviewers" link.
- **Full-page preview** &mdash; toggle the Live Preview between the single talker you're editing and a scaled Letter-landscape sheet showing the whole queue 6-up, with Prev/Next pagination past 6 items.
- **Print-ready sheets** &mdash; queue up talkers and print; they're laid out 6-up on Letter-size paper (3 columns &times; 2 rows), the same arrangement as the original template, paginating automatically if you have more than 6.
- Your queue is saved in the browser (localStorage) so it survives a refresh.
- **Print History** &mdash; every talker actually printed is kept in a permanent, searchable record (a local SQLite database), separate from the queue above. Search by title or SKU and click **Reprint** to add a past talker back into the queue without re-entering it.
- **Product cache** &mdash; SKU Lookup and Scan UPC both remember what they found for a given SKU/UPC and use it as a fallback: every lookup is live, but a *failed* one falls back to whatever's cached (clearly marked, however old) rather than a hard error.
- **In-app Help** &mdash; the Help button in the top right (and the desktop app's Help menu) opens a quick-reference panel covering every tab, SKU lookup, importing, History, and printing, so staff aren't sent looking for this README.
- **What's New** &mdash; a popup shows automatically the first time the app launches after an update, and the desktop app's Help menu reopens it anytime with the full history.

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

`better-sqlite3` (Print History/product cache, see below) is a native module, which needs
to be compiled against whichever runtime loads it. `npm install` builds it for plain
Node.js, which is all `npm start`/`npm test`/`npm run dev` ever need. `npm run dist:win`
(and CI's Windows installer build) handles rebuilding it for Electron's own Node version
automatically as part of packaging - electron-builder does this itself, no extra step
needed. The one case that needs a manual step is running the **unpacked** desktop shell
directly against your local `node_modules` (`npm run electron`): run
`npx electron-builder install-app-deps` first, or `better-sqlite3` will throw a Node
ABI mismatch error on startup. Afterwards, running `npm test`/`npm start` again needs
`npm rebuild better-sqlite3` to switch it back to the plain-Node build.

## Using the website import

Click **Website**, paste a product page URL from liquoroutletwinecellars.com, and click **Fetch Product Data**. The importer looks for (in order):

1. The page's `application/ld+json` Product schema (name, description, price) &mdash; most modern storefronts (Shopify, WooCommerce, BigCommerce, etc.) include this automatically.
2. Open Graph / meta description tags as a fallback.
3. Common "was / now" price markup (e.g. Shopify's `price-item--sale` / `price-item--regular` classes, or WooCommerce's `<del>`/`<ins>` price tags) to detect a sale price.

If a page doesn't expose any of this, the fields will come back blank and you can fill them in manually &mdash; the import is a shortcut, not a requirement.

If a site blocks the request outright (some, like wine.com, actively block automated fetches), the importer automatically retries once with a different set of request headers before giving up &mdash; same as the Untappd import below. If it's still blocked, click **Site blocking the fetch? Paste the page's HTML instead** under the Fetch button: open the same page in your own browser (which already gets past the block), copy its HTML source (right-click &rarr; View Page Source, or Ctrl/Cmd+U, then select all and copy), and paste it in. It's parsed exactly the same way a successful fetch would be, with no network request of its own.

### Finding tasting notes automatically

On Edit Talker, Wine / Spirits items have a **Find Tasting Notes** button under the Description field. Unlike the website importer above, there's no URL to paste: click it (with a Product Title already filled in) to open a dialog that searches using **Product Title** (plus **Vintage**, if set).

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

On the **Search** tab, pick **SKU Lookup**, set **Product Type** above to match the product, type in the store's SKU number, and click **Look Up SKU**. This searches liquoroutletwinecellars.com for that SKU, opens the matching product page, and pulls the title, size, and pricing from it &mdash; the SKU itself is matched exactly against each search result's own SKU, not by fuzzy title matching, so there's no "closest guess" to double-check.

For **Beer**, the lookup runs a second step automatically: it searches Untappd using the title just found and, if it finds a match, fills in the description, brewery, style, ABV, IBU, and rating from there instead of the store page's own generic description &mdash; matching what Untappd import already does for a pasted beer URL. If Untappd has nothing for that title, the store page's own description is used instead, and the rest of those fields are left blank for manual entry.

If the store site blocks the lookup, click **Site blocking the lookup? Paste the product page's HTML instead**: search the SKU yourself on the store's website, open the matching product page, copy its HTML source, and paste it in &mdash; same fallback as the website importer above, with no network request of its own (beyond the Untappd search for a beer entry).

### Scanning a UPC

The **Scan UPC** method (also on the **Search** tab) looks products up by the manufacturer UPC printed on the bottle itself &mdash; a different number from the store's own SKU that SKU Lookup above searches the website for. The UPC match itself never makes a network request: it reads a product file that WinePOS exports locally on the same PC, which means it works even with no internet connection.

For **Wine / Spirits**, once the local match is found, the app makes one more request: it takes the item's store SKU (if the export file has that column) and searches liquoroutletwinecellars.com for it &mdash; the same lookup the SKU Lookup method runs &mdash; and fills the Description field from that product page instead of the export file's own Description/Tasting Notes column, which tends to be blank or a short internal note rather than shopper-facing tasting notes. If the export has no store SKU for that item, or the store lookup fails or finds nothing, the export file's own description (if any) is left in place and the status line says why. **Beer** skips this step entirely and always uses whatever the export file has; use SKU Lookup instead for a beer description sourced from Untappd.

A USB or Bluetooth barcode scanner needs no special setup here &mdash; it types the scanned digits like a very fast keyboard, and pressing Enter (which every scanner does automatically at the end of a scan) triggers the lookup, the same as clicking **Look Up UPC**. Switching to the tab puts the cursor in the field automatically so staff can walk up and start scanning right away.

**One-time setup:** in the desktop app, use **Advanced &rarr; Export File Settings&hellip;** and point it at the product file WinePOS writes to disk (ask WinePOS support how to set up a scheduled export if one isn't already running &mdash; this is the same kind of feed their electronic shelf tag integrations use). The path is saved on this PC and the file is re-read automatically whenever it changes, so there's nothing to redo after WinePOS updates it. The dialog also shows how many items were loaded and when the file was last updated, which doubles as a quick way to confirm the export is actually running. If a scan fails because nothing's configured yet, this same dialog opens automatically.

The file can be comma- or tab-delimited (CSV or TSV), and its columns don't need to match an exact template &mdash; common header names are recognized automatically:

| Field | Recognized column headers |
| --- | --- |
| UPC *(required)* | UPC, UPC Code, Barcode, Bar Code, Scancode, EAN, EAN13, UPC Data |
| Title | Title, Description, Item Description, Product, Product Name, Item Name, Name |
| Brand | Brand, Supplier, Winery, Brewery, Manufacturer |
| Store SKU | SKU, Store SKU, Item Number, Item #, PLU |
| Size | Size, Unit Size, Bottle Size, Container Size |
| Vintage | Vintage, Year |
| Regular Price | Price, Regular Price, Retail Price, Reg Price, Unit Price, List Price |
| Sale Price | Sale Price, Promo Price, Special Price, Promotion Price |
| Description | Tasting Notes, Notes, Long Description, Web Description |
| Category | Category, Department, Class, Dept |

If the file has no column matching one of the UPC aliases, the lookup fails with an error listing whatever columns *were* found, so the export's UPC column can be renamed (or the alias list in `server/upcCatalog.js` extended) to match. A UPC not present in the file at all just means "not in this export" &mdash; enter that item manually instead. Both the 12-digit UPC-A and 13-digit EAN-13 forms of the same code are matched automatically, since scanners and exports don't always agree on which one to use &mdash; and if the export stores the UPC column as a number rather than text (common when it's built in Excel), a dropped leading zero is recovered the same way, and a spurious trailing ".0" (a whole-number UPC stored as a float) is stripped before matching, both confirmed against a real WinePOS export.

In the desktop app, **Browse&hellip;** opens a native file picker; in a plain browser (`npm start`), type or paste the path directly. The saved path lives in a small `config.json` outside the project folder (`%APPDATA%\Shelf Talker Wizard` on Windows), so it survives an app update.

### Sharing the export file across registers

WinePOS only writes its export file on the one PC it's installed on, but every register running this app can use it for Scan UPC and Search by Name. Rather than copying that file to every other PC by hand and keeping the copies up to date, a register can pull it automatically over the store's local network instead:

1. On the PC WinePOS actually writes the export to, mark it the **Server PC** (**Advanced &rarr; Server PC**, see below) and confirm **Export File Settings&hellip;** points at the real file.
2. On every *other* register, open **Advanced &rarr; Export File Settings&hellip;** and turn on **Automatically pull this file from the Server PC**.

From then on, each of those other registers fetches the Server PC's export file over the network about every 30 seconds and reads from that synced copy instead of a manually-configured local path &mdash; the manual path field is left alone (just not used) so switching auto-sync back off restores it exactly as it was. A register with auto-sync on finds the Server PC the same way the Server PC dialog does (see "Advanced menu" below): if none is currently marked, or this PC hasn't heard from it in a while, the dialog says so and Scan UPC/Search by Name keep working off whatever was last successfully synced rather than failing outright.

The dialog always shows a status line under the checkbox with the timestamp and source of the most recent successful sync (e.g. "Last synced from SERVER-PC at 2:14 PM"), so it's easy to confirm a register is actually staying current, plus whatever error is currently blocking a sync, if any. A **Sync Now** button next to the checkbox forces an immediate pull instead of waiting up to ~30 seconds for the next automatic one &mdash; handy right after changing the export on the Server PC, or when a register just came back on the network.

This only ever moves the export file itself &mdash; Print History and the product cache still aren't shared between PCs, and nothing on the Server PC's main app (its own web UI) becomes reachable from the network; only the export file itself is served, over its own small, read-only, single-purpose network port (41235 by default), the same spirit as the Server PC discovery beacon (41234/UDP) that's been there since the Server PC flag was introduced. Both may need a one-time "Allow" click in Windows Firewall the first time the app runs on a network profile that prompts for it.

## Printing

1. Add shelf talkers via Edit Talker, Website, or any of Search's three lookup methods.
2. Review them in the **Queue** panel. Each row's &vellip; menu can move it up or
   down (queue order is print order), edit it, copy it, or delete it.
3. Click **Print Sheet(s)**. A preview shows every sheet exactly as it will print
   &mdash; including how full each one is &mdash; before anything reaches the printer.
4. Click **Print Now**. This opens your browser's print dialog with pages already
   formatted for Letter paper, 6 talkers per sheet. Choose "Save as PDF" instead of a
   printer if you want a PDF file. Every talker in the queue at this point is also
   logged to Print History (see below) &mdash; whether or not the print dialog itself
   is completed or cancelled, since the app has no reliable way to tell the
   difference.

## Print History

The **History** button (top right) opens a permanent, searchable record of every
talker that's actually gone through **Print Now** &mdash; unlike the Queue above, items
here don't disappear once printed or once the browser's localStorage is cleared.

- **Search** by title or SKU; results are newest-first.
- **Reprint** adds a fresh copy of that talker back into the current Queue for
  review &mdash; it does not print immediately, and does not touch History itself.
- **Delete** removes a mistaken entry from History only; it has no effect on the
  Queue.

This is backed by a small local SQLite database (`data.db`), stored in the same
per-PC folder as the Scan UPC export-file setting (see below) &mdash; nothing here
is sent anywhere or shared between PCs.

### Product cache

SKU Lookup, Scan UPC, and Search by Name (Beer) all write whatever they find into
the same database, keyed by SKU or UPC &mdash; but every lookup is live; nothing
here is ever read back just to skip a network/file read. A repeat lookup of the
same SKU/UPC always re-runs, even seconds later, so a beer that missed on
Untappd (or came back ambiguous &mdash; see below) always gets a fresh attempt
instead of being stuck showing the same stale result. If a lookup fails outright
(site blocked, export file missing, etc.), the last cached copy for that SKU/UPC
is used as a fallback instead of a hard error, clearly marked as possibly stale
&mdash; a review-before-you-trust-it value beats nothing.

## Advanced menu (desktop app)

The desktop app's **Advanced** menu has four troubleshooting/admin dialogs, below
**Toggle Developer Tools**:

- **Export File Settings&hellip;** &mdash; where the Scan UPC method's export file path
  is configured (see "Scanning a UPC" above) &mdash; Scan UPC itself no
  longer has an inline Settings box; this menu item is the only normal way to it.
  It still opens itself automatically if a scan fails because nothing's
  configured yet, so staff aren't required to already know it's in this menu.
  Also has the **auto-sync** checkbox described in "Sharing the export file
  across registers" above, for every register except the one WinePOS itself
  writes to.
- **View Export File&hellip;** &mdash; a read-only preview of the export file in
  effect on this PC &mdash; the manually configured one, or, while auto-sync is
  on, the copy last pulled from the Server PC &mdash; shown exactly as written
  (real column headers, not run through Scan UPC's alias matching) so you can
  confirm it's actually hooked up right without leaving the app to go find and
  open the file yourself. A search box filters to rows containing whatever you
  type, anywhere in the row, across the *whole* file &mdash; not just the rows
  already on screen &mdash; so you can check whether a specific item is
  actually in the export without opening it elsewhere. If nothing's configured
  yet, **Open Export File Settings** jumps straight there.
- **View Database&hellip;** &mdash; counts for Print History and the product cache,
  plus a table of the most recently printed talkers, confirming this PC has real
  accumulated data.
- **Server PC&hellip;** &mdash; lets you mark a PC as the main store PC. Marking
  one makes it broadcast a small announcement on the local network every few
  seconds, so *other* PCs running the app can see which one it is (the dialog
  shows "Main store PC on this network" &mdash; its hostname and address &mdash;
  alongside this PC's own LAN IP address and database counts), and starts
  serving its own configured export file to other PCs' auto-sync (see "Sharing
  the export file across registers" above). Print History and the product
  cache still aren't shared between PCs &mdash; each keeps its own, and the
  main app itself still isn't reachable from the network; only the small
  discovery broadcast and the export file's own small, read-only network port
  leave the PC. Unmarking a PC (or closing the app) stops both; other PCs stop
  showing it within about 15 seconds, and their next auto-sync attempt just
  reports it can't find a Server PC right now.

## Project layout

```
server/
  index.js            Express app: serves the frontend and the URL-import/History/product-cache APIs
  productImport.js    Fetches a product/Untappd page and extracts title/description/price or beer details,
                      plus the Wine.com/Vivino tasting-notes search and the store SKU/Untappd lookup behind
                      the Find Tasting Notes button and SKU Lookup method
  upcCatalog.js       Reads a local WinePOS product export file (or, with auto-sync on, the local copy
                      exportSync.js's puller last wrote) and looks products up by UPC (Scan UPC method)/name
                      (Search by Name method) - no network request itself, unlike everything else in server/
  db.js               Local SQLite (better-sqlite3): the Print History log, the SKU/UPC product cache, and stats
  appData.js          Shared per-PC storage directory (SHELF_TALKER_CONFIG_DIR override) - used by
                      upcCatalog.js's config.json, db.js's data.db, and serverConfig.js's server-config.json,
                      so they all agree on where it lives
  serverConfig.js     Persisted "is this the main store PC" flag behind the Advanced menu's Server PC dialog
  discovery.js        LAN announcement so other PCs can see which one is currently marked as the main store PC
                      (see Server PC above) - a UDP broadcast, separate from and much smaller than the HTTP API
  exportSync.js       Lets other PCs automatically pull the export file from whichever PC is marked the
                      Server PC: a tiny read-only HTTP server on the Server PC's side, a polling fetch on
                      every other PC's side - both separate from, and much smaller than, the main HTTP API,
                      same spirit as discovery.js's own UDP beacon
public/
  index.html          Wizard UI
  css/styles.css      App styling + the shelf-talker card + print layout
  js/layout.js         Print-sheet geometry + sheet/auto-arrange packing (no DOM)
  js/card.js           Card rendering + auto text-fit
  js/app.js            Form, queue, import, SKU lookup, Scan UPC, History, and print wiring
  assets/logo.png      Brand logo (extracted from the provided template)
test/
  layout.test.js          Packing invariants: every layout fits a sheet, no item lost
  print-css-sync.test.js  Guards the JS geometry against the print CSS
  upcCatalog.test.js      CSV/TSV parsing, header-alias matching, UPC-A/EAN-13 lookup, config persistence, export preview -
                          including a real WinePOS export (see fixtures/) with a BOM, CRLF, and a dropped-leading-zero UPC
  db.test.js              Print History log + product cache: search/paginate/delete, cache keying, stats
  serverConfig.test.js    Server PC flag persistence
  discovery.test.js       LAN announcement wire format, staleness, self-filtering, and a real send/receive round trip
  exportSync.test.js      Export-serve HTTP server (real request/response round trip) and the auto-sync puller
                          (mocked fetch/discovered-server, since exportSync.js is the network boundary itself)
  fixtures/
    wine-pos-inventory-demo.csv  A real inventory export a store sent us, kept byte-for-byte - see upcCatalog.test.js
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
