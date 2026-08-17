(function () {
  const STORAGE_KEY = 'shelfTalkerQueue.v1';
  const REVIEWERS_KEY = 'shelfTalkerReviewers.v1';
  // Must match the key the inline pre-paint script in index.html reads.
  const THEME_KEY = 'shelfTalkerTheme.v1';
  // Same, for the Settings -> Change Theme accent choice (Amber/Purple) -
  // see applyAccent below. Deliberately a separate key/attribute from
  // THEME_KEY/data-theme above: this picks the UI's own accent colour, not
  // light vs dark.
  const ACCENT_KEY = 'shelfTalkerAccent.v1';
  // Same, for Settings -> Menu Bar Size (see applyMenuSize below). Must
  // match the key the inline pre-paint script in index.html reads.
  const MENU_SIZE_KEY = 'shelfTalkerMenuSize.v1';
  // App bar switch, next to History - shows/hides the Queue column so Live
  // Preview's own 1fr track can claim the freed width. Must match the key
  // the inline pre-paint script in index.html reads.
  const QUEUE_COLUMN_KEY = 'shelfTalkerQueueColumnVisible.v1';
  const MENU_SIZES = ['compact', 'comfortable', 'large', 'xlarge'];
  // Settings -> Experimental Features -> Wine Food Pairings: gates the Food
  // Pairing Suggestions field (see applyExperimentalPairings below) and the
  // "Pairs Well With" block it prints (buildPairingsHtml in card.js). Off
  // by default - this is a new, unreviewed suggestion engine
  // (WINE_PAIRING_RULES in card.js), so it stays opt-in rather than showing
  // up for every store the moment it ships.
  const EXPERIMENTAL_PAIRINGS_KEY = 'shelfTalkerExperimentalPairings.v1';
  // Settings -> Experimental Features -> Wine Profile: gates the Wine
  // Profile field (see applyExperimentalWineProfile below) and the 1-5 dot
  // meter strip it prints (buildWineProfileHtml in card.js). Off by
  // default, same reasoning as Bourbon/Pairings above - Suggest Profile's
  // varietal values (the `profile` field on WINE_PAIRING_RULES in card.js)
  // are representative, not gospel, so this stays opt-in.
  const EXPERIMENTAL_PROFILE_KEY = 'shelfTalkerExperimentalProfile.v1';
  // Settings -> Experimental Features -> Find Tasting Notes: gates the Find
  // Tasting Notes button under Description (see
  // applyExperimentalTastingNotes below). Off by default, same reasoning as
  // Pairings/Profile above - it's a new, unreviewed lookup against
  // Wine.com/Vivino/Distiller.com, so it stays opt-in rather than showing
  // up for every store the moment it ships.
  const EXPERIMENTAL_TASTING_NOTES_KEY = 'shelfTalkerExperimentalTastingNotes.v1';
  const DEFAULT_REVIEWERS = ['Wine Enthusiast', 'Wine Spectator', 'Wine Advocate', 'James Suckling', 'Jim Murray'];

  // The newest version this PC has shown a "What's New" popup for (see
  // checkWhatsNew) - kept separate from THEME_KEY/STORAGE_KEY's per-browser
  // storage in the same way, so each PC/profile tracks its own.
  const WHATS_NEW_SEEN_KEY = 'shelfTalkerWhatsNewSeen.v1';

  // One entry per release worth telling staff about, newest first. Add a
  // new entry here whenever a release has something worth mentioning -
  // checkWhatsNew (below, near Init) compares the server's reported version
  // (see /api/app-version) against WHATS_NEW_SEEN_KEY and shows whichever
  // entries are newer than what this PC last saw, so nothing here needs to
  // be pruned by hand as it ages.
  const WHATS_NEW_ENTRIES = [
    {
      version: '4.3.7',
      items: [
        'Changed: Tools → Mash Bill Library… is gone - the Bourbon Library sidebar screen now owns adding, editing, and deleting entries directly (an Add Bourbon button, and Edit/Delete on a profile page), instead of a separate management dialog duplicating its own search and list. Sync Now and Check GitHub for New Bourbons (Server PC only) moved onto the Bourbon Library page too.',
        'New: a Price row on the Bourbon Library profile page, filled in live from whatever the currently configured WinePOS export has on file for that entry\'s SKU - not a stored price, so it reflects today\'s shelf price rather than whatever it was when the SKU was typed in.',
        'New: both Bourbon Library search bars now match on SKU too, not just title/distillery/parent company.',
        'Changed: Find Tasting Notes moved behind a new Settings → Experimental Features toggle, off by default, same as Wine Food Pairings/Wine Profile - it\'s a new, unreviewed lookup, so it stays opt-in rather than showing up for every store the moment it ships.',
        'Changed: reverts 4.3.6\'s Search tab Bourbon Library preview - the second results panel under the smart search box for Bourbon Product Type is gone; Search by Name/SKU Lookup/Scan UPC are unaffected.',
      ],
    },
    {
      version: '4.3.6',
      items: [
        'Changed: Bourbon is now a Product Type of its own (alongside Wine / Spirits and Beer), not a Settings → Experimental Features toggle - picking it on any tab shows Store Pick, Mash Bill, and Nose/Palate/Finish automatically, with a Distiller.com source in Find Tasting Notes and Tools → Mash Bill Library… following the same switch. Nothing already on a talker is affected; the old toggle is gone from Settings.',
        'New: with Product Type set to Bourbon, the Search tab\'s search box also previews matches from the Bourbon Library underneath it - by title or by the SKU saved on that entry - alongside whatever Search by Name/SKU Lookup/Scan UPC already does with the same typed text. Picking a result fills Product Title, Mash Bill, and Nose/Palate/Finish; Price/Size/Description still come from SKU Lookup/Scan UPC/typing by hand, since the Library doesn\'t have those.',
        'Fixed: Store Pick is now a toggle switch (matching Also Available Chilled) instead of a plain checkbox with a description underneath - it was misaligned, and the description wasn\'t needed.',
      ],
    },
    {
      version: '4.3.5',
      items: [
        'New: the Mash Bill recall banner (Bourbon Library match on Product Title) now also offers Nose/Palate/Finish, not just the grain chips - a row per field the matched entry actually has, each with its own Use button plus a combined Use All. A mash bill that\'s still just an unresearched placeholder shows "Not yet researched" instead of offering it as a real suggestion. A matching "Save this Nose/Palate/Finish to the Bourbon Library" checkbox sits on the flavor fields, next to the existing "Save this mash bill to the Mash Bill Library" one.',
        'New: a Mash Bill Confidence badge (Confirmed/Reported/Estimated/Unknown) now prints on the shelf talker itself, next to the Mash Bill label, whenever that mash bill came from the Bourbon Library recall banner rather than being typed by hand - hand-editing the grains afterward clears it, since it no longer describes what\'s actually on the card.',
      ],
    },
    {
      version: '4.3.4',
      items: [
        'New: a Card/List switch and a Sort dropdown for the Bourbon Library\'s main grid - List packs more bourbons on screen at once (title, distillery, and one metric per row); Sort groups Alphabetical, Confidence, Grain % (Most Corn/Rye/Wheat/Malted Barley), Recipe complexity (fewest → most grains), and SKU. Whichever field you\'re sorting by shows up as a small chip on every card/row - "Most Wheat %" shows each bourbon\'s actual wheat percentage, "SKU" shows its SKU. Both choices are remembered per PC, so they stay put next time the Library is opened.',
      ],
    },
    {
      version: '4.3.3',
      items: [
        'Fixed: the Mash Bill donut chart showed "100% Corn" for bourbons whose mash bill genuinely hasn\'t been researched yet - that single-grain entry was always a schema placeholder, not a real finding, but the chart displayed it as confidently as a sourced recipe. Those entries (flagged "Unknown" confidence with a "Placeholder only" note) now show the same dashed "Not yet researched" ring the isolated mockup proposed, N/A instead of a percentage, and a short note explaining why - the Compare to bar button is hidden too, since there\'s nothing real to compare. Genuine 100%-single-grain whiskeys (New Riff\'s single malt, Woodinville\'s 100% rye, etc.) are unaffected.',
      ],
    },
    {
      version: '4.3.2',
      items: [
        'New: a bourbon\'s profile page Mash Bill block now shows a donut chart with the exact percentage printed on any slice wide enough to hold it, plus a numeric legend beside it and a dominant-grain callout in the center - a "Compare to bar" button still shows today\'s plain proportion bar alongside it, since that\'s what actually prints on the shelf talker. Hovering a slice highlights its legend row and vice versa. The grain color palette also grew to cover every grain name in the Bourbon Library\'s research data, not just the printed talker\'s own 6-grain builder list, so grains like Red Winter Wheat or Honey Malted Barley get their own color instead of a shared grey.',
        'New: Browse the Bourbon Library by parent company - click the "Parent companies" number in the library\'s stats row to see every company (Beam Suntory, Sazerac, and 60+ others) sized by how many bourbons it owns, then click into one to see its full lineup. Search and sort (Most bourbons / A–Z) included. Opening a bourbon from a company\'s list and clicking back returns to that company, not the full grid.',
      ],
    },
    {
      version: '4.3.1',
      items: [
        'New: the Server PC can now check GitHub for new bourbons added to the Bourbon Library\'s curated list since it was first seeded, without needing a new installer or the CLI script - Tools → Mash Bill Library… → "Check GitHub for New Bourbons" (Server PC only). Only ever adds titles that aren\'t already in the library, so it can\'t overwrite a correction or an entry staff typed in themselves.',
      ],
    },
    {
      version: '4.3.0',
      items: [
        'New: Bourbon Library entries can now carry a SKU (Manage Mash Bill Library dialog, and shown on the profile page under Distillery & Ownership) so staff can look a bottle\'s SKU up straight from its library entry when building a talker.',
        'New: the Bourbon Library\'s pre-loaded starting set grows from 26 to 279 bourbons, covering effectively every bourbon, rye, and American whiskey product this store carries - researched and confidence-graded individually (Confirmed/Reported/Estimated/Unknown, per bottle) rather than assumed. A PC that already auto-seeded an earlier set won\'t pick these up on its own (auto-seed only ever fills a completely empty library) - run `npm run db:seed-bourbon-library` again to add them.',
        'Fixed: Bourbon Library citations (References & Sources) saved through the seed data script weren\'t actually reaching the app - they were written to a field upsertMashBill never reads. Existing entries\' citations are repaired as part of this release\'s seed data; new saves have always gone to the right place.',
      ],
    },
    {
      version: '4.2.3',
      items: [
        'Changed: the Search by Name/SKU Lookup/Scan UPC toggle is gone, along with the separate "Product Name" field it used to show - the single Search field above now handles typing a product name directly, with the matching results dropdown right underneath it.',
      ],
    },
    {
      version: '4.2.2',
      items: [
        'New: the Search tab now opens with one Search field above Search by Name/SKU Lookup/Scan UPC - type a product name, a SKU, or scan a UPC and it detects which and switches to (and runs) the matching lookup automatically, so picking a method first is no longer required day to day. The three panels and their toggle are still there underneath as a manual override.',
        'New: that field also recognizes our own internal UPC labels ("A" followed by a 7-digit item number, e.g. A0042420) and looks them up as the SKU they encode (42420) rather than treating them as a manufacturer UPC.',
      ],
    },
    {
      version: '4.2.1',
      items: [
        'New: the beer Untappd fallback (SKU Lookup and Scan UPC, shown when the automatic search comes up empty) now has a Search Untappd box above the URL field - type a beer or brewery name and it opens Untappd\'s own search in a new tab, pre-filled with whatever title the automatic search already tried, instead of requiring a trip to untappd.com first.',
        'New (experimental, off by default): Wine Profile for Wine/Spirits Shelf Talkers - five 1-5 dot meters (Fruit, Body, Dry, Acidity, Alcohol) printed under the description, in the same dot style as the Untappd Rating widget on Beer talkers. Click Suggest Profile to prefill all five from the varietal detected in the Product Title (the same varietal list Wine Food Pairings\' Suggest Pairings already uses), then adjust any dot by hand - click a dot to set that category\'s score, or click it again to clear it back to unrated. Turn it on in Settings → Experimental Features → Wine Profile.',
        'New: an app bar switch next to History shows/hides the Queue column - Live Preview now covers the same ground the Queue column used to, so hiding it lets Live Preview claim the freed width. The choice is remembered per PC.',
        'Fixed: Search by Name could come back "Could not find on Untappd" for a beer that SKU Lookup found fine, when the WinePOS export\'s title spelled its style out in full (e.g. "Cream Ale") - the extra style word wasn\'t being stripped from the Untappd search query the way "Ale" alone already was.',
        'Fixed: the Bourbon Library profile page\'s "back to all bourbons" link was easy to miss - small text tucked in the top-right of the header, gone once you scrolled past it. It\'s now a "Bourbon Library / [name]" breadcrumb right above the title.',
      ],
    },
    {
      version: '4.1.2',
      items: [
        'Added: Hard Seltzer now gets its own color-coded style badge (cyan/teal) instead of falling back to the generic gray "Other" badge, so it reads at a glance same as any beer style.',
      ],
    },
    {
      version: '4.1.1',
      items: [
        'New: Bourbon Library entries now have a References & Sources section - citations (name, link, and which part of the entry they back: Mash Bill, Tasting Notes, Distillery & Ownership, or Other) live in one unified list per bourbon instead of only inside the Mash Bill Confidence block. The profile page drops a numbered marker next to each sourced heading that jumps straight to its citation.',
      ],
    },
    {
      version: '4.1.0',
      items: [
        'Fixed: the Shelf Talker/Bourbon Library/Pairing Atlas icons in the left sidebar rail were drawn with the same fixed dark ink used for printed shelf talkers, which nearly disappeared against the rail\'s own dark background in Dark Mode. Each icon now sits on its own light backdrop chip so it stays legible in both themes.',
      ],
    },
    {
      version: '4.0.4',
      items: [
        'Fixed: the Bourbon Library\'s auto-seed on first launch (4.0.1) relied entirely on reaching GitHub over the network - a store PC where that\'s blocked (firewall, content filter, no internet at that moment) was left with a permanently empty library instead of ever getting the pre-loaded bourbons. It now falls back to the same seed data bundled directly into the installer whenever the GitHub fetch fails, so a fresh install always ends up populated regardless of network access - GitHub is only ever a nice-to-have for picking up a newer curated list between releases.',
      ],
    },
    {
      version: '4.0.2',
      items: [
        'New: the Bourbon Library\'s pre-loaded starting set nearly doubles, from 14 to 26 bourbons - adding Eagle Rare, W.L. Weller Special Reserve, Larceny, Old Grand-Dad Bonded, Angel\'s Envy, 1792 Small Batch, Rebel Yell, George Dickel Bourbon, Evan Williams Black Label, Old Ezra 7 Year, Wilderness Trail Bottled-in-Bond Wheated, and Very Old Barton. A PC that already auto-seeded the original 14 won\'t pick these up on its own (auto-seed only ever fills a completely empty library) - run `npm run db:seed-bourbon-library` again to add them.',
      ],
    },
    {
      version: '4.0.1',
      items: [
        'Fixed: the Bourbon Library now arrives pre-loaded with 14 popular bourbons (Buffalo Trace, Four Roses Single Barrel, Maker\'s Mark, Woodford Reserve, and others) the first time it launches on a PC, instead of showing up empty. It auto-seeds itself from this project\'s own GitHub repo in the background on startup - no manual setup step, and it never touches a library that already has entries (including one you\'ve cleared out on purpose).',
      ],
    },
    {
      version: '4.0.0',
      items: [
        'New: Bourbon Library - a permanent sidebar section for browsing every bourbon in the shared Mash Bill Library, with Mash Bill Confidence scoring and a profile page per bottle.',
        'New: The Pairing Atlas - a permanent sidebar section for browsing wine varietals and their food pairings as illustrated infographics, grouped and filterable by color (Red, White, Rosé, Sparkling, Fortified & Dessert). Built on the same Wine Food Pairings data Suggest Pairings and Tools > Wine Pairing Rules… already use, so it can\'t drift out of sync with what those already offer.',
        'Changed: Navigation moves to a persistent icon rail on the left - Shelf Talker, Bourbon Library, and The Pairing Atlas each get their own icon, with Settings folded in at the bottom - replacing the separate Settings/Queue/History buttons that used to live in the app bar.',
      ],
    },
    {
      version: '3.3.21',
      items: [
        'New: Large Display Signs now have a Case Price field (optional) - prints bottom-right in the same Verdana 11pt bold styling as Regular Price. Not shown for Shelf Talkers or Small Display Signs, which have no room for it.',
      ],
    },
    {
      version: '3.3.20',
      items: [
        'New: Tools → Wine Pairing Rules… now has a filter box - type a varietal, region, or keyword to narrow the list down instead of scrolling through all 30+ entries. Matches against every region and sweetness refinement too, not just each rule\'s own name, so searching "Chablis" or "Trocken" finds the Chardonnay or Riesling rule that keyword belongs to.',
      ],
    },
    {
      version: '3.3.19',
      items: [
        'New (Wine Food Pairings, experimental): Suggest Pairings now covers Australia, Greece, and South Africa. Australia adds a new Semillon varietal plus region refinements across several existing rules (Hunter Valley and McLaren Vale for Shiraz, Coonawarra for Cabernet Sauvignon, Clare/Eden Valley for Riesling, McLaren Vale for Garnacha/Grenache). South Africa adds Pinotage and Chenin Blanc (with its own Stellenbosch/Swartland vs. Loire Valley split) plus a Stellenbosch refinement for Cabernet Sauvignon. Greece adds Assyrtiko, Agiorgitiko, Xinomavro, and Retsina, matched by appellation (Santorini, Nemea, Naoussa) as well as grape.',
      ],
    },
    {
      version: '3.3.18',
      items: [
        'New (Wine Food Pairings, experimental): Suggest Pairings now covers Portugal - Vinho Verde, Douro Red (Touriga Nacional/Touriga Franca), and Port all join the varietal list. A title naming both a grape and Vinho Verde (e.g. "Alvarinho, Vinho Verde") still resolves to the more specific Albariño match added a few releases back; a bare "Vinho Verde" with no grape named now matches on its own instead of going unmatched.',
      ],
    },
    {
      version: '3.3.17',
      items: [
        'New (Wine Food Pairings, experimental): Suggest Pairings now tells Bordeaux and Burgundy styles apart, and can match them even when the title never says the grape - real Bordeaux/Burgundy is labeled by chateau/village, not varietal. Cabernet Sauvignon\'s Bordeaux match now specifically means the Cabernet-dominant Left Bank (Médoc, Pauillac, Margaux, Saint-Julien, Saint-Estèphe); Merlot gains its own Right Bank match (Saint-Émilion, Pomerol) it never had before. Pinot Noir\'s Burgundy match splits into Côte de Nuits vs. Côte de Beaune, and Chardonnay gains its first Burgundy matches (Chablis, plus Côte de Beaune whites like Meursault and Puligny-Montrachet) alongside its existing California ones.',
      ],
    },
    {
      version: '3.3.16',
      items: [
        'New (Wine Food Pairings, experimental): Suggest Pairings now tells domestic sub-regions apart by climate instead of lumping them under one state-wide match. Cabernet Sauvignon splits Napa Valley from cooler Sonoma County, plus new Paso Robles and Washington State refinements. Chardonnay and Zinfandel each gain their own warmer-vs-cooler California split for the first time (Napa Valley vs. Sonoma Coast/Russian River Valley for Chardonnay; Lodi vs. Dry Creek Valley for Zinfandel), and Merlot gains a California vs. Washington State refinement. A bare "California" on a Cabernet or Merlot still falls back to its most recognized region (Napa) rather than going unmatched.',
      ],
    },
    {
      version: '3.3.15',
      items: [
        'New (Wine Food Pairings, experimental): Riesling\'s region matching now tells apart Rheingau, Pfalz, and Nahe (previously all lumped into "Mosel, Germany"), and gains a second, independent refinement tier for Germany\'s own Pradikatswein sweetness classification (Trocken, Kabinett, Spätlese, Auslese and beyond) - the thing that actually swings what food a Riesling pairs with. A title carrying both a region and a sweetness level (e.g. "Spätlese Pfalz") gets both refinements at once ("Riesling — Pfalz, Germany, Spätlese").',
      ],
    },
    {
      version: '3.3.14',
      items: [
        'New (Wine Food Pairings, experimental): Suggest Pairings now covers Spanish classifications - Albariño, Tempranillo, Garnacha/Grenache, and Verdejo join the varietal list. Region refinements deepen Albariño (Rías Baixas, Spain vs. Vinho Verde, Portugal - same grape, different country), Tempranillo (Rioja vs. Ribera del Duero), and Garnacha (Priorat); Champagne/Sparkling also gains a Cava, Catalonia refinement.',
      ],
    },
    {
      version: '3.3.13',
      items: [
        'New (Wine Food Pairings, experimental): Suggest Pairings now covers six more Italian classifications - Nebbiolo, Sangiovese, Montepulciano d\'Abruzzo, Primitivo, and Barbera join the varietal list, and Pinot Grigio/Gris and Champagne/Sparkling gain Italian region refinements (Alto Adige, Prosecco, Franciacorta). Region matching also deepens for Nebbiolo (Barolo vs. Barbaresco), Sangiovese (Chianti Classico vs. Brunello di Montalcino), and Barbera (d\'Alba vs. d\'Asti). A title reading "Vino Nobile di Montepulciano" correctly matches Sangiovese, not the unrelated Montepulciano grape.',
      ],
    },
    {
      version: '3.3.12',
      items: [
        'Fixed: Beer Name\'s Auto-size toggle wasn\'t actually defaulting on for beer scanned/looked up via Scan UPC, SKU Lookup, Search by Name, or Import - filling the form from a lookup was silently forcing it off (even after picking a beer from the "Pick the Right Beer" dialog), overriding the on-by-default behavior added in 3.3.3. It now defaults on for beer through every one of those paths, same as starting a beer entry from Manual Entry already did.',
        'Fixed: SKU Lookup and Search by Name (Beer) now go straight to the queue after picking a beer from the "Pick the Right Beer" dialog (Recommended or one of the alternates), instead of stopping for a manual "Add to Queue" click - matches Scan UPC\'s own behavior from 3.2.6.',
      ],
    },
    {
      version: '3.3.11',
      items: [
        'Fixed: Scan UPC and SKU Lookup could silently switch Product Type from Beer to Wine/Spirits after clicking "Use This Match" on the Confirm Untappd Match popup - the export file\'s (or store page\'s) own category/department text was getting merged into the form under the same field Product Type uses, and almost never spelled "beer" exactly.',
        'Changed: on a Large Display sign with no Sale Price, the Regular Price now takes over the Sale Price\'s larger font size and left-hand position instead of staying in its small, right-aligned secondary spot.',
      ],
    },
    {
      version: '3.3.10',
      items: [
        'Changed: Also Available Chilled is now a switch instead of a checkbox, and no longer shows on Beer talkers (already sold cold out of a cooler).',
      ],
    },
    {
      version: '3.3.9',
      items: [
        'New: Also Available Chilled is now its own checkbox, independent of Talker Style - it used to be a 4th Talker Style option, mutually exclusive with Standard/Closeout/Super Sale. It now combines with any of them, so a Closeout or Super Sale talker can also say Also Available Chilled.',
      ],
    },
    {
      version: '3.3.8',
      items: [
        'New (Bourbon Shelf Talkers, experimental): Mash Bill Library - save a researched mash bill once and it\'s suggested automatically the next time you type that same Product Title, shared across every register once one PC is marked Server PC (Advanced → Server PC…). "Save this mash bill to the Mash Bill Library" sits right on the Mash Bill field; Tools → Mash Bill Library… manages every saved entry directly (search, add, edit, delete).',
      ],
    },
    {
      version: '3.3.7',
      items: [
        'Fixed: the Size field\'s "ml"/"oz" unit now always prints lowercase on the Shelf Talker card and both Display Sign sizes, regardless of how the store export or product page cased it (e.g. "750ML" and "16OZ" now print as "750ml"/"16oz").',
      ],
    },
    {
      version: '3.3.6',
      items: [
        'New (Wine Food Pairings, experimental): Suggest Pairings now also picks up on a country/region in the title/description for Cabernet Sauvignon, Malbec, Syrah/Shiraz, Pinot Noir, Sauvignon Blanc, and Riesling (e.g. "Mendoza, Argentina") - swaps in one more specific pairing and adds the region to the match ("Malbec — Mendoza, Argentina"). A title with no region wording still gets exactly the same pairings as before.',
        'New: Tools → Wine Pairing Rules… (shown while Wine Food Pairings is on) lists every varietal Suggest Pairings can match, its candidate pairings, and any region refinements - a live reference, not a static doc.',
      ],
    },
    {
      version: '3.3.5',
      items: [
        'Fixed: on Super Sale talkers/signs, the price number under "Super Sale Price!!!" now always renders at the same font size as that lettering - it used to run smaller by default, and didn\'t resize at all when you typed a size into the Super Sale Price!!! Font Size box.',
      ],
    },
    {
      version: '3.3.4',
      items: [
        'New: Full Page Live Preview is now the print preview, too - the separate Print Preview dialog is gone. Auto-arrange and the sheet summary sit right above the sheets, and the same button that jumps you to Full Page relabels to Print Now once you\'re looking at it.',
        'New: Auto-arrange is out of Beta, now that it lives on the Full Page panel instead of being buried in a dialog.',
        'New: Live Preview now opens on Full Page by default instead of Current Talker, so you land on the print-accurate view of the queue right away.',
      ],
    },
    {
      version: '3.3.3',
      items: [
        'New: Full Page Live Preview now shows the whole queue at once, stacked in a scrollable list like Print Preview - Shelf Talkers, Half/Quarter Size, and Large/Small Display Signs all together, instead of one sheet at a time filtered to whichever type/size the form happened to be set to. Cards/signs stay click-to-edit.',
        'New: Beer Name\'s Auto-size toggle now defaults on when composing a new beer entry, since beer titles (brewery + beer + container) tend to run longer and clip more often than wine/spirits titles - mirrors how the Theme select already defaults to purple for beer.',
        'Fixed: Scan UPC, SKU Lookup, and Search by Name now recognize beer/wine titles written in a non-Latin script (Cyrillic, etc.) - a title like "Львівське 1715" previously produced zero match tokens, so the lookup failed with "Could not find..." even though the real Untappd match was sitting right there in the results.',
      ],
    },
    {
      version: '3.3.2',
      items: [
        'Fixed: Scan UPC (and SKU Lookup/Search by Name) for beer could double the brewery name in the Beer Name field (e.g. "Slack Tide Brewing Company Slack Tide Flounder Pounder Can") when the store\'s own product title only used the brewery\'s shorter, everyday name instead of its full legal one.',
        'Fixed: a trailing container word like "Can" left over in the composed Beer Name is now dropped once Untappd confirms the beer\'s real name doesn\'t include it.',
      ],
    },
    {
      version: '3.3.1',
      items: [
        'New: on the Full Page Live Preview, you can now click any talker or sign right on the sheet to jump straight into editing it - hover to see the edit badge, then click (or Tab + Enter). Same as choosing Edit from that item\'s Queue row menu, just without having to find the matching row first.',
      ],
    },
    {
      version: '3.3.0',
      items: [
        'Removed the product cache and the Advanced > View Database dialog (a broken duplicate of History that never actually showed the cached-product counts it claimed to) - SKU Lookup, Scan UPC, and Search by Name (Beer) are now live-only, with a real error on a failed lookup instead of a stale cached fallback. Print History is unaffected.',
        'Fixed: the "Pick the Right Beer" dialog could open with the recommended pick\'s card, "Use Recommended Pick" button, and other-match rows already greyed out and unclickable. That happened if a previous pick was cancelled (Cancel/Escape/backdrop) while its own lookup was still in flight - the leftover disabled state stuck around on the next, unrelated tie. Every open now starts from a clean, clickable state, and a cancelled pick\'s in-flight lookup no longer applies its fields after the fact.',
      ],
    },
    {
      version: '3.2.6',
      items: [
        'Fixed: Scan UPC (Beer) no longer stops for a manual "Add to Queue" click after picking a beer from the "Pick the Right Beer" dialog (Recommended or one of the alternates) - a pick made there is now treated the same as any other confirmed scan and goes straight to the queue, so scanning can keep going item to item.',
      ],
    },
    {
      version: '3.2.5',
      items: [
        'New: Advanced menu → View Export File now has a search box that filters to rows containing whatever you type, anywhere in the row, across the whole file - not just the ones already on screen - so you can check whether a specific item is actually in the export.',
      ],
    },
    {
      version: '3.2.4',
      items: [
        'The Confirm Untappd Match popup (Scan UPC, SKU Lookup, Search by Name) now shows the matched beer\'s own name as its heading, with brewery demoted to a secondary line underneath - previously it only showed the brewery, which read like a generic label when the brewery\'s own name happened to look like a beer name (e.g. "Autodidact Beer").',
      ],
    },
    {
      version: '3.2.3',
      items: [
        'Fixed: after clicking Clear All in the Queue and confirming, the form could become unclickable until switching windows, minimizing/restoring, or restarting the app. The Clear Queue confirmation no longer uses the native dialog that caused it.',
      ],
    },
    {
      version: '3.2.2',
      items: [
        'New: the "Pick the Right Beer" dialog (Scan UPC, SKU Lookup, Search by Name) now highlights a Recommended pick, with up to 2 other options below it and any further tie folded behind a "+N more" toggle - instead of a flat, undifferentiated list. The recommendation starts as Untappd\'s own top-ranked candidate and re-ranks itself by check-in count as each candidate\'s own page loads in the background.',
      ],
    },
    {
      version: '3.2.1',
      items: [
        'The Type and Product Type dropdowns (Edit Talker, Website, and Search tabs) now open as a floating panel styled like the menu bar\'s own dropdowns, instead of the browser\'s plain native list.',
      ],
    },
    {
      version: '3.2.0',
      items: [
        'Beer shelf talkers: dropped the country-letter caption ("US", "MX", "UK"...) under both the brewery-country flag and the country silhouette badge - the graphic already identifies the country, so the label was redundant. The US-state badge (e.g. "NC") is unaffected.',
      ],
    },
    {
      version: '3.1.5',
      items: [
        'Fixed: Search by Name and Scan UPC no longer fold a WinePOS export\'s "Vendor" column (a short distributor code like "KOH") into the Brand field for beer - same vendor-code bug as 3.1.4\'s SKU Lookup fix, just coming from the local export file instead of the store website.',
      ],
    },
    {
      version: '3.1.4',
      items: [
        'Fixed: SKU Lookup no longer folds a short store vendor/distributor code (e.g. "AB") into the Brand field for beer - it was getting prepended onto the title and sent to Untappd as part of the search, breaking the match and showing the code as the Brewery.',
        'Fixed: Untappd search now strips container/packaging codes ("NR", "Can"/"Cans", "CN", "KEG", "1/6", "1/4") out of the query, the same way it already strips raw sizes and style words - none of these tell Untappd anything about which beer it is.',
      ],
    },
    {
      version: '3.1.3',
      items: [
        'New: Scan UPC, SKU Lookup, and Search by Name (Beer) now show a confirmation dialog for every Untappd match before applying its brewery/style/ABV/rating - not just when there\'s a genuine tie - so a wrong-but-confident match doesn\'t reach the printed talker unreviewed.',
        'Fixed: Live Preview no longer jumps back to Current Talker mode on every lookup - Full Page preview now stays put while scanning item after item.',
        'Fixed: Untappd search now strips a standalone "Wit" from the query, not just "Witbier" - catches more real misses for Witbier-style beers.',
        'Fixed: Scan UPC now recognizes a WinePOS export UPC that lost its leading zero and picked up a spurious trailing ".0" from being stored as a float (e.g. "88586001895.0") - a real scan of that item used to come back "not found" even though it was in the file.',
      ],
    },
    {
      version: '3.1.2',
      items: [
        "Fixed: SKU Lookup, Scan UPC, and Search by Name no longer serve a cached result to skip a fresh check - every lookup now always pulls current data. A lookup that fails outright (site or Untappd blocked) still falls back to the last good data, clearly marked as possibly stale, instead of a hard error.",
      ],
    },
    {
      version: '3.1.1',
      items: [
        'Fixed: Untappd search for Scan UPC, SKU Lookup, and Search by Name (Beer) now strips a beer\'s style words (like "IPA" or "Stout") out of the search itself, not just when matching the results - catches more real misses than 3.1.0\'s fix alone, especially for beers with a longer brewery name.',
        'New: when Untappd search turns up two or more equally-likely matches for the same beer (e.g. "Coors Light" vs. "Coors Banquet"), a "Pick the Right Beer" dialog now lets you choose instead of the app guessing.',
      ],
    },
    {
      version: '3.1.0',
      items: [
        'New (experimental, off by default): Food Pairing Suggestions for Wine/Spirits Shelf Talkers — click Suggest Pairings next to Description to match the varietal detected in the title/description against a short list of food pairings, then pick up to 3 to print under the description. Turn it on in Settings → Experimental Features → Wine Food Pairings.',
        'Also new under Bourbon Shelf Talkers (Settings → Experimental Features): a Mash Bill proportion bar (add each grain with its percentage) and a Store Pick corner ribbon, independent of Talker Style so it can still show up alongside Closeout.',
        'Export File Settings gained a Sync Now button, so a client PC can pull the latest WinePOS export from the Server PC right away instead of waiting for the next auto-sync.',
        "Fixed: beers Untappd hasn't rated yet now show no rating instead of 0.00, matching how Untappd's own page displays them.",
        'Fixed: Untappd search for Scan UPC and Search by Name (Beer) no longer fails on longer titles just because the beer\'s own Untappd page leaves out style words (like "IPA" or "Stout") the title has.',
        'Desktop app: swapped the Advanced and Help menu positions in the menu bar.',
      ],
    },
    {
      version: '3.0.0',
      items: [
        'Search by Name: picking a Beer result now also searches Untappd for the brewery, style, ABV, IBU, and rating, same as SKU Lookup and Scan UPC already do for beer.',
        'New (experimental, off by default): Nose / Palate / Finish fields for Wine/Spirits Shelf Talkers, printed under the description, plus a Distiller.com source in "Find Tasting Notes" that fills them in automatically. Turn it on in Settings → Experimental Features → Bourbon Shelf Talkers.',
        'Desktop app: the File / Tools / Help / Advanced menu is now built into the app itself, with a new Menu Bar Size setting (Compact/Comfortable/Large/Extra Large) under Tools → Settings.',
        'New: Find Queue… (Ctrl+F, on the Tools menu) jumps straight to a talker in a long queue by title, description, SKU, or size.',
        'Settings gained a new Experimental Features section — home to opt-in features like Bourbon Shelf Talkers above.',
        "The What's New history's See Previous Updates button now toggles open and closed in place, instead of just expanding.",
      ],
    },
    {
      version: '2.5.0',
      items: [
        "New: this “What's New” popup shows once after an update, and is always reachable from the What's New button next to Help (or the desktop app's Help menu).",
        "New: the desktop app has a Tools › Settings menu with a Change Theme option, to switch the app's own accent color between Amber and Purple.",
        'Website tab: added an explicit Add to Queue button, and importing now keeps you on the tab instead of jumping away — paste another URL and keep going.',
        'Edit Talker, Website, and Search now call out Type / Product Type as the first thing to set.',
        'Super Sale Price now defaults to 23pt on Small Display signs.',
      ],
    },
    {
      version: '2.4.2',
      items: [
        'Search by Name: choose Unit or Pack pricing for beer results, same as Scan UPC already offers.',
        "Store website URLs now route straight to the store's own page parser for Size/Price.",
        'Container size (e.g. "750mL") is stripped out of the title when importing from the store website.',
      ],
    },
    {
      version: '2.4.1',
      items: [
        'Tab labels renamed for clarity: "Manual Entry" → "Edit Talker", "Import from Website" → "Website".',
        'The Edit Talker / Website / Search tab bar is now centered.',
      ],
    },
    {
      version: '2.4.0',
      items: [
        'The Search tab is consolidated: Search by Name, SKU Lookup, and Scan UPC now share one Type / Product Type picker instead of asking separately.',
        '"Scan UPC" dropped its Beta label.',
      ],
    },
    {
      version: '2.3.3',
      items: [
        'The WinePOS export file used by Scan UPC and Search by Name now auto-syncs to other store PCs on the network, so every register stays current.',
      ],
    },
    {
      version: '2.3.2',
      items: [
        'Beer talkers no longer show "Not Specified" as Brand/title text; the Untappd Rating now reads "N/A" instead of being hidden when a beer has no numeric rating.',
      ],
    },
    {
      version: '2.3.1',
      items: [
        "Scan UPC (Beer) now searches Untappd using the store's own cleaned-up product title instead of the export file's abbreviated one, and no longer auto-adds a scan to the queue when something failed to resolve.",
        'Fixed the tab bar wrapping mid-word once Search by Name made five tabs share the panel.',
      ],
    },
    {
      version: '2.3.0',
      items: [
        'New: a "Search by Name" tab looks up a product by partial title from the local WinePOS export file, no network request needed.',
        'Scan UPC (Beer) now pulls live pricing from the store website and enrichment (brewery/style/ABV/IBU/rating) from Untappd, and a successful scan is added to the queue automatically so scanning can go item to item.',
      ],
    },
    {
      version: '2.2.12',
      items: [
        "Scan UPC now pulls Wine/Spirits descriptions from the store website instead of relying on the export file's own note.",
        'Marking a PC as the main store PC now lets other PCs on the network see it (Advanced menu → Server PC).',
      ],
    },
    {
      version: '2.2.11',
      items: [
        'Looking up a SKU as Beer now always re-runs the Untappd search, even when that SKU was recently cached under Wine/Spirits.',
      ],
    },
    {
      version: '2.2.10',
      items: [
        'The Add to Queue button now sits next to Look Up SKU / Look Up UPC instead of below the status message.',
      ],
    },
    {
      version: '2.2.9',
      items: [
        'The CLOSEOUT!! badge is bolder: switched to Arial Black at weight 900.',
      ],
    },
    {
      version: '2.2.8',
      items: [
        'New: a Ratings Font Size control, for wine ratings on Shelf Talkers and Large Display Signs.',
      ],
    },
    {
      version: '2.2.7',
      items: [
        'Fixed three Scan UPC bugs found against a real WinePOS export file: an unrecognized UPC column name, missing leading zeros on UPC values, and a stray character from the file\'s byte-order mark.',
      ],
    },
    {
      version: '2.2.6',
      items: [
        "Scan UPC's export file settings moved from an inline box on the tab to Advanced menu → Export File Settings.",
      ],
    },
    {
      version: '2.2.5',
      items: [
        'New: an Advanced menu (desktop app) with View Export File, View Database, and Server PC, for confirming Scan UPC setup and store data without leaving the app.',
      ],
    },
    {
      version: '2.2.4',
      items: [
        'New: Print History, a permanent searchable record of every talker actually printed, plus a local product cache that speeds up repeat SKU/UPC lookups.',
      ],
    },
    {
      version: '2.2.3',
      items: [
        'New: a font size control for CLOSEOUT!! badges, matching the existing Title/Description/Super Sale Price controls.',
      ],
    },
    {
      version: '2.2.2',
      items: [
        'Scan UPC is marked Beta.',
      ],
    },
    {
      version: '2.2.1',
      items: [
        'New: a Scan UPC tab looks products up offline by scanning the manufacturer UPC against a local WinePOS export file.',
      ],
    },
    {
      version: '2.2.0',
      items: [
        'Cleaned up scraped beer titles: strips "Not Specified" placeholder text and abbreviated pack counts (e.g. "4pk") that were leaking into the Beer Name field.',
      ],
    },
    {
      version: '2.1.14',
      items: [
        'Beer Shelf Talkers now show the Store SKU in the footer band.',
        'SKU Lookup now pulls Pack Size (e.g. "4-Pack") separately from Size when the store page lists them apart.',
      ],
    },
    {
      version: '2.1.13',
      items: [
        'Quarter Size Shelf Talkers simplified to Title/Size/Price only - the smaller format was too crowded for vintage, ratings, beer info, and badges to stay legible.',
        'Selected text in the Live Preview (desktop app) can now be copied via right-click.',
        'New: an Add to Queue button directly on the SKU Lookup tab, no need to switch to Edit Talker first.',
      ],
    },
    {
      version: '2.1.12',
      items: [
        'Halved the gap between the header band and the product title on Shelf Talkers.',
      ],
    },
    {
      version: '2.1.11',
      items: [
        'New: a Super Sale Price!!! font size box, matching Title/Description.',
      ],
    },
    {
      version: '2.1.10',
      items: [
        'Super Sale Price text pushed further to fill its available width.',
      ],
    },
    {
      version: '2.1.9',
      items: [
        'New: a Title Auto Size toggle; finalized Super Sale Price sizing (larger, no more overlap with the price below).',
      ],
    },
    {
      version: '2.1.8',
      items: [
        'New: an Auto Size toggle for description text (off by default).',
      ],
    },
    {
      version: '2.1.7',
      items: [
        'Tightened edge margins about 20% on Shelf Talkers and Display Signs, freeing up more room for content.',
      ],
    },
    {
      version: '2.1.6',
      items: [
        'Description text no longer auto-scales; it now clips with an ellipsis instead, so the point size you set is always what prints.',
      ],
    },
    {
      version: '2.1.5',
      items: [
        'Enlarged the Super Sale Price!!! callout text and tightened the gap to the price below it.',
      ],
    },
    {
      version: '2.1.4',
      items: [
        'Dropped the redundant "United States" text from beer talker Location - domestic breweries already get their own flag/state badge.',
      ],
    },
    {
      version: '2.1.3',
      items: [
        'Tightened beer Shelf Talker spacing to give the description more room to grow.',
      ],
    },
    {
      version: '2.1.2',
      items: [
        "SKU Lookup: beer Description is now left blank when Untappd has no description for a match, instead of falling back to the store's generic blurb.",
      ],
    },
    {
      version: '2.1.1',
      items: [
        'Fixed SKU Lookup showing "Not Specified" in the Vintage field for non-vintage wines, and dropping the producer name from beer titles.',
      ],
    },
    {
      version: '2.1.0',
      items: [
        '"About the Shelf Talker" renamed to "Beer Talker Info", now shown with the purple theme in its preview.',
      ],
    },
    {
      version: '2.0.7',
      items: [
        'Fixed the automatic Untappd search for beer SKU lookups (a live 403 from a missing request header).',
      ],
    },
    {
      version: '2.0.6',
      items: [
        "Fixed the automatic Untappd search for beer SKU lookups, which had never actually worked - it now searches via Untappd's own API instead of a page that needs JavaScript to render results.",
      ],
    },
    {
      version: '2.0.5',
      items: [
        'SKU Lookup no longer auto-switches to Edit Talker, so staff can see and use the beer fallback options before moving on.',
        'Fixed beer Location never getting filled in when pulling data from Untappd.',
      ],
    },
    {
      version: '2.0.4',
      items: [
        'New: a manual Untappd fallback for beer SKU lookups, for when the automatic search comes back empty.',
      ],
    },
    {
      version: '2.0.3',
      items: [
        'Beer SKU lookups now include the brewery name in the Untappd search, so short or common beer names are more likely to match.',
      ],
    },
    {
      version: '2.0.2',
      items: [
        'Beer SKU lookups now strip container size (e.g. "16OZ") out of the title, and Untappd search failures are shown instead of failing silently.',
      ],
    },
    {
      version: '2.0.1',
      items: [
        "Wine/Spirits SKU lookups now compose the producer name into the title and pull the vintage year, instead of just using the store page's title as-is.",
      ],
    },
    {
      version: '2.0.0',
      items: [
        'New: SKU Lookup replaces Bulk CSV Import - look up a product by the store\'s own SKU number to pull title/size/price (and, for beer, Untappd details) automatically.',
        'New: Title Font Size and Description Font Size controls on Edit Talker, for both Shelf Talkers and Display Signs.',
        'Widened the Beer Talker Info preview so the guide renders at full size.',
      ],
    },
  ];

  // Print-sheet geometry and the sheet/auto-arrange packing live in
  // layout.js, apart from this file's DOM wiring so they can be unit tested
  // against the @media print rules they have to agree with.
  const {
    SIGN_LAYOUTS,
    printWidthCss,
    layoutKeyFor,
    buildSheets,
    buildAutoArrangedPages,
  } = window.ShelfTalkerLayout;

  // Starting point sizes shown in the Title/Description Font Size boxes for
  // a fresh item, before anyone types over them - one pair per sign type,
  // not per Talker/Sign sub-size, since Full/Half/Quarter Shelf Talkers
  // already share one title/description ratio in styles.css (see
  // card.js's fontSizeOverrideAttr) and Large/Small Display Signs are close
  // enough to each other that a single sign default is good enough for
  // testing. Matches the *effective* point size the CSS ratios already
  // produce today (card__title's 0.0595 * 72 * 2.8in ≈ 12pt, etc.), so
  // leaving the boxes untouched renders identically to before this feature.
  // superSalePrice matches the "Super Sale Price!!!" callout's current
  // effective size the same way - card__supersale-text's 0.11 * 72 * 2.8in
  // ≈ 22pt. sign__supersale-text's (small-sign-only) CSS ratio works out to
  // ≈ 17pt, but the default here is set to 23pt instead, by request (see
  // fSuperSaleFontSize/superSaleFontSizeField, shown only for Super Sale
  // talkers/Small Display Signs - Large Display Signs fold this text into
  // the regular sale-price line instead, see buildSignPriceRowHtml in
  // card.js).
  // closeoutBadge matches the "CLOSEOUT!!" badge's current effective size
  // the same way (see fCloseoutFontSize/closeoutFontSizeField, shown for
  // any Closeout talker, unlike Super Sale above - the badge itself renders
  // on the Shelf Talker card and both Display Sign sizes, see
  // buildPricingHtml/buildSignMetaRowHtml/buildSmallSignBodyHtml in
  // card.js): card__closeout-badge's 0.115 * 72 * 2.8in ≈ 23pt,
  // sign__closeout-badge's (shared by both sign sizes; using Large's own
  // --sign-text, same as the Title/Description sign defaults above) 0.026 *
  // 1.4 * 72 * 8.5in ≈ 22.5pt.
  // ratings matches the Ratings list's current effective size the same way
  // (see fRatingsFontSize, part of the Ratings field itself - shown
  // whenever Ratings is, on Shelf Talkers and Large Display Signs alike;
  // Large is the only sign size that renders a rating row at all, see
  // buildLargeSignBodyHtml in card.js): card__ratings' 0.0645 * 72 *
  // 2.8in ≈ 13pt for Shelf Talkers. sign.ratings is set directly to 22pt
  // (rather than derived from sign__rating's current CSS ratio) since
  // Large Display Signs are its only consumer and 22pt is the desired
  // default there.
  const DEFAULT_FONT_SIZE_PT = {
    talker: { title: 12, description: 10.5, superSalePrice: 22, closeoutBadge: 23, ratings: 13 },
    sign: { title: 20, description: 10, superSalePrice: 23, closeoutBadge: 22.5, ratings: 22 },
  };

  // Human-readable names for the queue list's meta line (see renderQueue).
  const SIZE_LABELS = { full: 'Full', half: 'Half', quarter: 'Quarter' };
  // 'chilled' isn't a Talker Style value going forward (see the isChilled
  // migration in fillForm), but a leftover legacy value still falls through
  // this same lookup by key, same as closeout/supersale - kept so renderQueue
  // below doesn't need its own separate legacy-value handling.
  const STYLE_LABELS = {
    closeout: 'Closeout',
    supersale: 'Super Sale',
    chilled: 'Also Available Chilled',
  };

  /** @type {Array<object>} */
  let queue = loadQueue();

  /** @type {Array<string>} */
  let reviewers = loadReviewers();

  /** Ratings currently attached to whatever's in the form (not yet in queue). */
  let currentRatings = [];

  /** Food pairings ([{icon, food}], up to 3) currently attached to whatever's in the form. */
  let currentPairings = [];

  /** Mash Bill grains currently attached to whatever's in the form (not yet
      in queue) - [{grain, pct}], same "build a list, one Add click at a
      time" pattern as currentRatings above. */
  let currentMashBill = [];

  /** Which Mash Bill Confidence tier (see CONFIDENCE_TIER_META further
      down) the grains above came from, if any - set alongside
      currentMashBill whenever the Bourbon Library recall banner's "Use"/
      "Use All" (Mash Bill row) fills it in, so the printed card can show
      the same tier the Library rated it. null for a mash bill that was
      typed by hand and never autofilled - there's no Library rating to
      show for that. Cleared the moment the chip list is hand-edited after
      an autofill (see addMashBillGrain/the remove-mashbill handler below),
      since at that point the composition on the card may no longer be
      exactly what the Library's tier was rating. */
  let currentMashBillConfidence = null;

  /** Wine Profile dot values currently attached to whatever's in the form -
      one 0-5 integer per WINE_PROFILE_CATEGORIES entry (card.js), 0 meaning
      "not rated yet". Always carries all five keys (never partial) so
      renderProfilePicker below can render every row unconditionally. */
  function emptyWineProfile() {
    const profile = {};
    WINE_PROFILE_CATEGORIES.forEach((cat) => { profile[cat.id] = 0; });
    return profile;
  }
  let currentProfile = emptyWineProfile();

  let currentSignType = 'talker'; // 'talker' | 'sign'
  let currentSignSize = 'large'; // 'small' | 'large' (Display Signs only)
  let currentTalkerSize = 'full'; // 'full' | 'half' | 'quarter' (Shelf Talkers only)
  let currentCategory = 'wine'; // 'wine' | 'bourbon' | 'beer'

  // Settings -> Experimental Features -> Wine Food Pairings - read once at
  // load, then kept in sync with the checkbox from there on.
  let experimentalPairingsEnabled = false;
  try {
    experimentalPairingsEnabled = localStorage.getItem(EXPERIMENTAL_PAIRINGS_KEY) === 'true';
  } catch {
    // Same as reviewers/queue below - an unavailable store just means this
    // stays at its off-by-default value.
  }

  // Settings -> Experimental Features -> Wine Profile - same pattern as
  // experimentalPairingsEnabled right above.
  let experimentalProfileEnabled = false;
  try {
    experimentalProfileEnabled = localStorage.getItem(EXPERIMENTAL_PROFILE_KEY) === 'true';
  } catch {
    // Same as above - stays at its off-by-default value.
  }

  // Settings -> Experimental Features -> Find Tasting Notes - same pattern
  // as experimentalPairingsEnabled above.
  let experimentalTastingNotesEnabled = false;
  try {
    experimentalTastingNotesEnabled = localStorage.getItem(EXPERIMENTAL_TASTING_NOTES_KEY) === 'true';
  } catch {
    // Same as above - stays at its off-by-default value.
  }

  // Full Page is the default so staff land on the print-accurate view of
  // the queue rather than a single blank/sample card - see the
  // setPreviewMode('sheet') call in init below, which also keeps this in
  // sync with the toggle buttons, sheet controls, and Print button label.
  let previewMode = 'sheet'; // 'single' | 'sheet'

  // Auto-arrange, opt-in from the Full Page Live Preview's controls (see
  // previewSheetControls/renderSheetPreview) - off by default. Affects both
  // that preview and the actual print output (see buildAutoArrangedPages /
  // buildPrintDom), which stay in sync since both read this same flag.
  let autoArrangeEnabled = false;

  // Queue item ids whose title is expanded to show the full text instead
  // of truncating - toggled by clicking the title (see renderQueue).
  let expandedQueueItemIds = new Set();

  // Which queue item's "more actions" menu (#queueItemMenu, shared by every
  // row) is currently open, if any - see openQueueMenu/closeQueueMenu.
  let queueMenuTalkerId = null;

  // ---------- Persistence ----------

  // Anything read back from localStorage or a saved queue file is untrusted:
  // it may predate a version of the app, or have been hand-edited. Parsing
  // succeeding doesn't mean the shape is usable - a stored object rather
  // than an array used to make every later queue.forEach throw, leaving the
  // app rendering nothing with no way to recover from the UI.
  function normalizeQueue(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((t) => t && typeof t === 'object')
      .map((t) => ({ ...t, id: t.id || makeId() }));
  }

  function loadQueue() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalizeQueue(JSON.parse(raw)) : [];
    } catch {
      return [];
    }
  }

  function saveQueue() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch (err) {
      // Storage being full or unavailable (private browsing) shouldn't take
      // the whole app down mid-render - the queue still works for this
      // session, it just won't survive a refresh.
      console.warn('Could not save the queue to browser storage.', err);
    }
  }

  function loadReviewers() {
    try {
      const raw = localStorage.getItem(REVIEWERS_KEY);
      const list = raw ? JSON.parse(raw) : null;
      return Array.isArray(list) && list.length ? list : [...DEFAULT_REVIEWERS];
    } catch {
      return [...DEFAULT_REVIEWERS];
    }
  }

  function saveReviewers() {
    localStorage.setItem(REVIEWERS_KEY, JSON.stringify(reviewers));
  }

  function makeId() {
    return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ---------- Elements ----------

  const els = {
    // Persistent rail (Shelf Talker / Library / Atlas / Beer Bible /
    // Settings) and the screens it switches between - see the "Rail"
    // section further down for the click handling.
    rail: document.getElementById('rail'),
    railShelfTalkerBtn: document.getElementById('railShelfTalkerBtn'),
    railLibraryBtn: document.getElementById('railLibraryBtn'),
    railAtlasBtn: document.getElementById('railAtlasBtn'),
    railBeerBibleBtn: document.getElementById('railBeerBibleBtn'),
    railSettingsBtn: document.getElementById('railSettingsBtn'),
    appBar: document.getElementById('appBar'),
    shelfTalkerView: document.getElementById('shelfTalkerView'),
    libraryView: document.getElementById('libraryView'),
    librarySyncDot: document.getElementById('librarySyncDot'),
    librarySyncStatus: document.getElementById('librarySyncStatus'),
    librarySyncNowBtn: document.getElementById('librarySyncNowBtn'),
    libraryAddBtn: document.getElementById('libraryAddBtn'),
    libraryGithubSyncRow: document.getElementById('libraryGithubSyncRow'),
    libraryGithubSyncStatus: document.getElementById('libraryGithubSyncStatus'),
    libraryGithubSyncBtn: document.getElementById('libraryGithubSyncBtn'),
    libraryFilterInput: document.getElementById('libraryFilterInput'),
    libraryChips: document.getElementById('libraryChips'),
    libraryStats: document.getElementById('libraryStats'),
    libraryBody: document.getElementById('libraryBody'),
    atlasView: document.getElementById('atlasView'),
    atlasBackLink: document.getElementById('atlasBackLink'),
    atlasFilterInput: document.getElementById('atlasFilterInput'),
    atlasChips: document.getElementById('atlasChips'),
    atlasStats: document.getElementById('atlasStats'),
    atlasBody: document.getElementById('atlasBody'),
    beerBibleView: document.getElementById('beerBibleView'),
    beerBibleAddBtn: document.getElementById('beerBibleAddBtn'),
    beerBibleGithubSyncRow: document.getElementById('beerBibleGithubSyncRow'),
    beerBibleGithubSyncStatus: document.getElementById('beerBibleGithubSyncStatus'),
    beerBibleGithubSyncBtn: document.getElementById('beerBibleGithubSyncBtn'),
    beerBibleFilterInput: document.getElementById('beerBibleFilterInput'),
    beerBibleStats: document.getElementById('beerBibleStats'),
    beerBibleBody: document.getElementById('beerBibleBody'),

    tabs: document.querySelectorAll('.tab'),
    panels: document.querySelectorAll('.tab-panel'),

    // Search's three sub-panels (Search by Name / SKU Lookup / Scan UPC) -
    // one level down from the three tabs above. Which one is visible inside
    // the Search tab-panel is decided automatically from what's typed into
    // smartSearchInput - see setActiveMethodPanel/runSmartSearch below.
    methodPanels: document.querySelectorAll('.method-panel'),
    smartSearchInput: document.getElementById('smartSearchInput'),
    smartSearchHint: document.getElementById('smartSearchHint'),

    // Type and Product Type - repeated once per top-level tab (see the
    // shared .type-select/.product-type-select note in index.html) rather
    // than one instance each, so every querySelectorAll here returns one
    // <select> per tab, all kept in sync with currentSignType/
    // currentSignSize/currentCategory by applyFormMode below.
    typeSelects: document.querySelectorAll('.type-select'),
    productTypeSelects: document.querySelectorAll('.product-type-select'),
    titleLabel: document.getElementById('fTitleLabel'),
    descriptionField: document.getElementById('descriptionField'),
    tastingNotesRow: document.getElementById('tastingNotesRow'),
    findTastingNotesBtn: document.getElementById('findTastingNotesBtn'),
    tastingNotesStatus: document.getElementById('tastingNotesStatus'),
    tastingNotesOverlay: document.getElementById('tastingNotesOverlay'),
    tastingNotesModalCloseBtn: document.getElementById('tastingNotesModalCloseBtn'),
    tastingNotesCancelBtn: document.getElementById('tastingNotesCancelBtn'),
    tastingNotesSearchBtn: document.getElementById('tastingNotesSearchBtn'),
    tastingNotesConfirmBtn: document.getElementById('tastingNotesConfirmBtn'),
    tastingNotesSourceSelect: document.getElementById('tastingNotesSourceSelect'),
    tastingNotesQueryLabel: document.getElementById('tastingNotesQueryLabel'),
    tastingNotesModalStatus: document.getElementById('tastingNotesModalStatus'),
    tastingNotesPreview: document.getElementById('tastingNotesPreview'),
    tastingNotesFlavorPreview: document.getElementById('tastingNotesFlavorPreview'),
    tastingNotesNosePreview: document.getElementById('tastingNotesNosePreview'),
    tastingNotesPalatePreview: document.getElementById('tastingNotesPalatePreview'),
    tastingNotesFinishPreview: document.getElementById('tastingNotesFinishPreview'),
    untappdPickerOverlay: document.getElementById('untappdPickerOverlay'),
    untappdPickerCloseBtn: document.getElementById('untappdPickerCloseBtn'),
    untappdPickerCancelBtn: document.getElementById('untappdPickerCancelBtn'),
    untappdPickerQueryLabel: document.getElementById('untappdPickerQueryLabel'),
    untappdPickerRecCard: document.getElementById('untappdPickerRecCard'),
    untappdPickerOthersBlock: document.getElementById('untappdPickerOthersBlock'),
    untappdPickerUseRecBtn: document.getElementById('untappdPickerUseRecBtn'),
    untappdPickerStatus: document.getElementById('untappdPickerStatus'),
    untappdConfirmOverlay: document.getElementById('untappdConfirmOverlay'),
    untappdConfirmCloseBtn: document.getElementById('untappdConfirmCloseBtn'),
    untappdConfirmRejectBtn: document.getElementById('untappdConfirmRejectBtn'),
    untappdConfirmAcceptBtn: document.getElementById('untappdConfirmAcceptBtn'),
    untappdConfirmTitleText: document.getElementById('untappdConfirmTitleText'),
    untappdConfirmBrewery: document.getElementById('untappdConfirmBrewery'),
    untappdConfirmMeta: document.getElementById('untappdConfirmMeta'),
    untappdConfirmDescription: document.getElementById('untappdConfirmDescription'),
    vintageField: document.getElementById('vintageField'),
    vintage: document.getElementById('fVintage'),
    wineRatingsField: document.getElementById('wineRatingsField'),
    storePickField: document.getElementById('storePickField'),
    storePick: document.getElementById('fStorePick'),
    mashBillField: document.getElementById('mashBillField'),
    mashBillGrain: document.getElementById('fMashBillGrain'),
    mashBillPct: document.getElementById('fMashBillPct'),
    addMashBillBtn: document.getElementById('addMashBillBtn'),
    mashBillList: document.getElementById('mashBillList'),
    mashBillRecallBanner: document.getElementById('mashBillRecallBanner'),
    mashBillSaveCheckbox: document.getElementById('mashBillSaveCheckbox'),
    mashBillSaveRow: document.getElementById('mashBillSaveRow'),
    mashBillSaveDistillery: document.getElementById('mashBillSaveDistillery'),
    mashBillSaveBtn: document.getElementById('mashBillSaveBtn'),
    mashBillSaveStatus: document.getElementById('mashBillSaveStatus'),
    flavorFields: document.getElementById('flavorFields'),
    nose: document.getElementById('fNose'),
    palate: document.getElementById('fPalate'),
    finish: document.getElementById('fFinish'),
    tastingNotesSaveCheckbox: document.getElementById('tastingNotesSaveCheckbox'),
    tastingNotesSaveRow: document.getElementById('tastingNotesSaveRow'),
    tastingNotesSaveBtn: document.getElementById('tastingNotesSaveBtn'),
    tastingNotesSaveStatus: document.getElementById('tastingNotesSaveStatus'),
    profileField: document.getElementById('profileField'),
    suggestProfileBtn: document.getElementById('suggestProfileBtn'),
    profileSuggestStatus: document.getElementById('profileSuggestStatus'),
    profilePicker: document.getElementById('profilePicker'),
    pairingsField: document.getElementById('pairingsField'),
    suggestPairingsBtn: document.getElementById('suggestPairingsBtn'),
    pairingsSuggestStatus: document.getElementById('pairingsSuggestStatus'),
    pairingsSuggestions: document.getElementById('pairingsSuggestions'),
    pairingsList: document.getElementById('pairingsList'),
    pairingCustomInput: document.getElementById('pairingCustomInput'),
    addPairingBtn: document.getElementById('addPairingBtn'),
    awardsField: document.getElementById('awardsField'),
    awards: document.getElementById('fAwards'),
    awardsColor: document.getElementById('fAwardsColor'),
    beerFields: document.getElementById('beerFields'),
    sku: document.getElementById('fSku'),
    brewery: document.getElementById('fBrewery'),
    location: document.getElementById('fLocation'),
    style: document.getElementById('fStyle'),
    abv: document.getElementById('fAbv'),
    ibu: document.getElementById('fIbu'),
    untappdRating: document.getElementById('fUntappdRating'),
    untappdRatingCount: document.getElementById('fUntappdRatingCount'),

    form: document.getElementById('talkerForm'),
    editId: document.getElementById('editId'),
    title: document.getElementById('fTitle'),
    titleFontSize: document.getElementById('fTitleFontSize'),
    titleAutoSize: document.getElementById('fTitleAutoSize'),
    description: document.getElementById('fDescription'),
    descriptionFontSize: document.getElementById('fDescriptionFontSize'),
    descriptionAutoSize: document.getElementById('fDescriptionAutoSize'),
    size: document.getElementById('fSize'),
    theme: document.getElementById('fTheme'),
    price: document.getElementById('fPrice'),
    salePrice: document.getElementById('fSalePrice'),
    casePriceField: document.getElementById('casePriceField'),
    casePrice: document.getElementById('fCasePrice'),
    talkerSizeField: document.getElementById('talkerSizeField'),
    talkerSize: document.getElementById('fTalkerSize'),
    talkerType: document.getElementById('fTalkerType'),
    talkerTypeSupersaleOption: document.getElementById('talkerTypeSupersaleOption'),
    chilledField: document.getElementById('chilledField'),
    chilled: document.getElementById('fChilled'),
    closeoutFontSizeField: document.getElementById('closeoutFontSizeField'),
    closeoutFontSize: document.getElementById('fCloseoutFontSize'),
    superSaleFontSizeField: document.getElementById('superSaleFontSizeField'),
    superSaleFontSize: document.getElementById('fSuperSaleFontSize'),
    ratingsFontSize: document.getElementById('fRatingsFontSize'),
    ratingReviewer: document.getElementById('fRatingReviewer'),
    ratingScore: document.getElementById('fRatingScore'),
    addRatingBtn: document.getElementById('addRatingBtn'),
    ratingsList: document.getElementById('ratingsList'),
    manageReviewersToggle: document.getElementById('manageReviewersToggle'),
    reviewerManager: document.getElementById('reviewerManager'),
    newReviewerName: document.getElementById('newReviewerName'),
    addReviewerBtn: document.getElementById('addReviewerBtn'),
    reviewerManagerList: document.getElementById('reviewerManagerList'),
    saveBtn: document.getElementById('saveBtn'),
    cancelEditBtn: document.getElementById('cancelEditBtn'),
    clearFormBtn: document.getElementById('clearFormBtn'),
    formError: document.getElementById('formError'),

    importHelpText: document.getElementById('importHelpText'),
    importUrlLabel: document.getElementById('importUrlLabel'),
    importUrl: document.getElementById('importUrl'),
    importBtn: document.getElementById('importBtn'),
    importSaveBtn: document.getElementById('importSaveBtn'),
    importStatus: document.getElementById('importStatus'),
    importHtmlToggle: document.getElementById('importHtmlToggle'),
    importHtmlSection: document.getElementById('importHtmlSection'),
    importHtmlInput: document.getElementById('importHtmlInput'),
    importHtmlBtn: document.getElementById('importHtmlBtn'),

    nameSearchSpinner: document.getElementById('nameSearchSpinner'),
    nameSearchResults: document.getElementById('nameSearchResults'),
    nameSearchSelectedWrap: document.getElementById('nameSearchSelectedWrap'),
    nameSearchSaveBtn: document.getElementById('nameSearchSaveBtn'),
    nameSearchStatus: document.getElementById('nameSearchStatus'),

    skuHelpText: document.getElementById('skuHelpText'),
    skuInput: document.getElementById('skuInput'),
    skuLookupBtn: document.getElementById('skuLookupBtn'),
    skuStatus: document.getElementById('skuStatus'),
    skuSaveBtn: document.getElementById('skuSaveBtn'),
    skuHtmlToggle: document.getElementById('skuHtmlToggle'),
    skuHtmlSection: document.getElementById('skuHtmlSection'),
    skuHtmlUrl: document.getElementById('skuHtmlUrl'),
    skuHtmlInput: document.getElementById('skuHtmlInput'),
    skuHtmlBtn: document.getElementById('skuHtmlBtn'),
    skuUntappdSection: document.getElementById('skuUntappdSection'),
    skuUntappdSearchInput: document.getElementById('skuUntappdSearchInput'),
    skuUntappdSearchBtn: document.getElementById('skuUntappdSearchBtn'),
    skuUntappdUrl: document.getElementById('skuUntappdUrl'),
    skuUntappdBtn: document.getElementById('skuUntappdBtn'),
    skuUntappdStatus: document.getElementById('skuUntappdStatus'),
    skuUntappdHtmlToggle: document.getElementById('skuUntappdHtmlToggle'),
    skuUntappdHtmlSection: document.getElementById('skuUntappdHtmlSection'),
    skuUntappdHtmlInput: document.getElementById('skuUntappdHtmlInput'),
    skuUntappdHtmlBtn: document.getElementById('skuUntappdHtmlBtn'),

    scanUpcInput: document.getElementById('scanUpcInput'),
    scanUpcLookupBtn: document.getElementById('scanUpcLookupBtn'),
    scanUpcStatus: document.getElementById('scanUpcStatus'),
    scanUpcSaveBtn: document.getElementById('scanUpcSaveBtn'),
    scanUpcUntappdSection: document.getElementById('scanUpcUntappdSection'),
    scanUpcUntappdSearchInput: document.getElementById('scanUpcUntappdSearchInput'),
    scanUpcUntappdSearchBtn: document.getElementById('scanUpcUntappdSearchBtn'),
    scanUpcUntappdUrl: document.getElementById('scanUpcUntappdUrl'),
    scanUpcUntappdBtn: document.getElementById('scanUpcUntappdBtn'),
    scanUpcUntappdStatus: document.getElementById('scanUpcUntappdStatus'),
    scanUpcUntappdHtmlToggle: document.getElementById('scanUpcUntappdHtmlToggle'),
    scanUpcUntappdHtmlSection: document.getElementById('scanUpcUntappdHtmlSection'),
    scanUpcUntappdHtmlInput: document.getElementById('scanUpcUntappdHtmlInput'),
    scanUpcUntappdHtmlBtn: document.getElementById('scanUpcUntappdHtmlBtn'),

    exportSettingsOverlay: document.getElementById('exportSettingsOverlay'),
    exportSettingsCloseBtn: document.getElementById('exportSettingsCloseBtn'),
    exportSettingsCloseFooterBtn: document.getElementById('exportSettingsCloseFooterBtn'),
    exportSettingsPathInput: document.getElementById('exportSettingsPathInput'),
    exportSettingsBrowseBtn: document.getElementById('exportSettingsBrowseBtn'),
    exportSettingsSaveBtn: document.getElementById('exportSettingsSaveBtn'),
    exportSettingsStatus: document.getElementById('exportSettingsStatus'),
    exportSettingsAutoSyncCheckbox: document.getElementById('exportSettingsAutoSyncCheckbox'),
    exportSettingsSyncNowBtn: document.getElementById('exportSettingsSyncNowBtn'),
    exportSettingsSyncStatus: document.getElementById('exportSettingsSyncStatus'),

    beerBibleImportOverlay: document.getElementById('beerBibleImportOverlay'),
    beerBibleImportCloseBtn: document.getElementById('beerBibleImportCloseBtn'),
    beerBibleImportCloseFooterBtn: document.getElementById('beerBibleImportCloseFooterBtn'),
    beerBibleImportSetup: document.getElementById('beerBibleImportSetup'),
    beerBibleImportPathInput: document.getElementById('beerBibleImportPathInput'),
    beerBibleImportBrowseBtn: document.getElementById('beerBibleImportBrowseBtn'),
    beerBibleImportStartBtn: document.getElementById('beerBibleImportStartBtn'),
    beerBibleImportSetupStatus: document.getElementById('beerBibleImportSetupStatus'),
    beerBibleImportProgress: document.getElementById('beerBibleImportProgress'),
    beerBibleImportProgressBar: document.getElementById('beerBibleImportProgressBar'),
    beerBibleImportProgressLine: document.getElementById('beerBibleImportProgressLine'),
    beerBibleImportCurrentTitle: document.getElementById('beerBibleImportCurrentTitle'),
    beerBibleImportCancelBtn: document.getElementById('beerBibleImportCancelBtn'),
    beerBibleImportStartOverBtn: document.getElementById('beerBibleImportStartOverBtn'),

    previewStage: document.getElementById('previewStage'),
    previewToggleBtns: document.querySelectorAll('.preview-toggle .toggle-btn'),
    queueGrid: document.getElementById('queueGrid'),
    queueCount: document.getElementById('queueCount'),
    clearQueueBtn: document.getElementById('clearQueueBtn'),
    saveQueueBtn: document.getElementById('saveQueueBtn'),
    queueItemMenu: document.getElementById('queueItemMenu'),

    clearQueueConfirmOverlay: document.getElementById('clearQueueConfirmOverlay'),
    clearQueueConfirmCloseBtn: document.getElementById('clearQueueConfirmCloseBtn'),
    clearQueueConfirmCancelBtn: document.getElementById('clearQueueConfirmCancelBtn'),
    clearQueueConfirmAcceptBtn: document.getElementById('clearQueueConfirmAcceptBtn'),

    findQueueOverlay: document.getElementById('findQueueOverlay'),
    findQueueInput: document.getElementById('findQueueInput'),
    findQueueCount: document.getElementById('findQueueCount'),
    findQueueResults: document.getElementById('findQueueResults'),
    findQueueCloseBtn: document.getElementById('findQueueCloseBtn'),

    themeToggle: document.getElementById('themeToggle'),
    queueColumnToggle: document.getElementById('queueColumnToggle'),
    printBtn: document.getElementById('printBtn'),
    printRoot: document.getElementById('printRoot'),

    previewSheetControls: document.getElementById('previewSheetControls'),
    previewSheetSummary: document.getElementById('previewSheetSummary'),
    autoArrangeToggle: document.getElementById('autoArrangeToggle'),

    guidePreviewOverlay: document.getElementById('guidePreviewOverlay'),
    guidePreviewStage: document.getElementById('guidePreviewStage'),
    guidePreviewCloseBtn: document.getElementById('guidePreviewCloseBtn'),
    guidePreviewCancelBtn: document.getElementById('guidePreviewCancelBtn'),
    guidePreviewConfirmBtn: document.getElementById('guidePreviewConfirmBtn'),

    winePairingRulesMenuItem: document.getElementById('winePairingRulesMenuItem'),
    winePairingRulesOverlay: document.getElementById('winePairingRulesOverlay'),
    winePairingRulesCloseBtn: document.getElementById('winePairingRulesCloseBtn'),
    winePairingRulesFilterInput: document.getElementById('winePairingRulesFilterInput'),
    winePairingRulesFilterStatus: document.getElementById('winePairingRulesFilterStatus'),
    winePairingRulesList: document.getElementById('winePairingRulesList'),

    helpBtn: document.getElementById('helpBtn'),
    helpOverlay: document.getElementById('helpOverlay'),
    helpCloseBtn: document.getElementById('helpCloseBtn'),
    helpCloseFooterBtn: document.getElementById('helpCloseFooterBtn'),

    whatsNewOverlay: document.getElementById('whatsNewOverlay'),
    whatsNewBody: document.getElementById('whatsNewBody'),
    whatsNewShowAllBtn: document.getElementById('whatsNewShowAllBtn'),
    whatsNewCloseBtn: document.getElementById('whatsNewCloseBtn'),
    whatsNewCloseFooterBtn: document.getElementById('whatsNewCloseFooterBtn'),

    historyBtn: document.getElementById('historyBtn'),
    historyOverlay: document.getElementById('historyOverlay'),
    historyCloseBtn: document.getElementById('historyCloseBtn'),
    historyCloseFooterBtn: document.getElementById('historyCloseFooterBtn'),
    historySearchInput: document.getElementById('historySearchInput'),
    historyStatus: document.getElementById('historyStatus'),
    historyList: document.getElementById('historyList'),
    historyPagination: document.getElementById('historyPagination'),
    historyPrevBtn: document.getElementById('historyPrevBtn'),
    historyNextBtn: document.getElementById('historyNextBtn'),
    historyPageIndicator: document.getElementById('historyPageIndicator'),

    mashBillLibraryOverlay: document.getElementById('mashBillLibraryOverlay'),
    mashBillLibraryCloseBtn: document.getElementById('mashBillLibraryCloseBtn'),
    mashBillLibraryCloseFooterBtn: document.getElementById('mashBillLibraryCloseFooterBtn'),
    mashBillLibraryFormTitle: document.getElementById('mashBillLibraryFormTitle'),
    mashBillLibraryFormTitleInput: document.getElementById('mashBillLibraryFormTitleInput'),
    mashBillLibraryFormDistilleryInput: document.getElementById('mashBillLibraryFormDistilleryInput'),
    mashBillLibraryFormParentCompanyInput: document.getElementById('mashBillLibraryFormParentCompanyInput'),
    mashBillLibraryFormCategoryInput: document.getElementById('mashBillLibraryFormCategoryInput'),
    mashBillLibraryFormSkuInput: document.getElementById('mashBillLibraryFormSkuInput'),
    mashBillLibraryFormGrain: document.getElementById('mashBillLibraryFormGrain'),
    mashBillLibraryFormPct: document.getElementById('mashBillLibraryFormPct'),
    mashBillLibraryFormAddGrainBtn: document.getElementById('mashBillLibraryFormAddGrainBtn'),
    mashBillLibraryFormGrainList: document.getElementById('mashBillLibraryFormGrainList'),
    mashBillLibraryFormNoseInput: document.getElementById('mashBillLibraryFormNoseInput'),
    mashBillLibraryFormPalateInput: document.getElementById('mashBillLibraryFormPalateInput'),
    mashBillLibraryFormFinishInput: document.getElementById('mashBillLibraryFormFinishInput'),
    mashBillLibraryFormTastingSourceInput: document.getElementById('mashBillLibraryFormTastingSourceInput'),
    mashBillLibraryFormConfidenceTier: document.getElementById('mashBillLibraryFormConfidenceTier'),
    mashBillLibraryFormConfidenceNoteInput: document.getElementById('mashBillLibraryFormConfidenceNoteInput'),
    mashBillLibraryFormConfidenceVerifiedInput: document.getElementById('mashBillLibraryFormConfidenceVerifiedInput'),
    mashBillLibraryFormSourceLabel: document.getElementById('mashBillLibraryFormSourceLabel'),
    mashBillLibraryFormSourceUrl: document.getElementById('mashBillLibraryFormSourceUrl'),
    mashBillLibraryFormSourceTags: document.getElementById('mashBillLibraryFormSourceTags'),
    mashBillLibraryFormAddSourceBtn: document.getElementById('mashBillLibraryFormAddSourceBtn'),
    mashBillLibraryFormSourceList: document.getElementById('mashBillLibraryFormSourceList'),
    mashBillLibraryFormSaveBtn: document.getElementById('mashBillLibraryFormSaveBtn'),
    mashBillLibraryFormCancelBtn: document.getElementById('mashBillLibraryFormCancelBtn'),
    mashBillLibraryFormDeleteBtn: document.getElementById('mashBillLibraryFormDeleteBtn'),
    mashBillLibraryFormStatus: document.getElementById('mashBillLibraryFormStatus'),

    beerBibleOverlay: document.getElementById('beerBibleOverlay'),
    beerBibleCloseBtn: document.getElementById('beerBibleCloseBtn'),
    beerBibleCloseFooterBtn: document.getElementById('beerBibleCloseFooterBtn'),
    beerBibleFormTitle: document.getElementById('beerBibleFormTitle'),
    beerBibleFormTitleInput: document.getElementById('beerBibleFormTitleInput'),
    beerBibleFormBreweryInput: document.getElementById('beerBibleFormBreweryInput'),
    beerBibleFormLocationInput: document.getElementById('beerBibleFormLocationInput'),
    beerBibleFormStyleInput: document.getElementById('beerBibleFormStyleInput'),
    beerBibleFormSkuInput: document.getElementById('beerBibleFormSkuInput'),
    beerBibleFormAbvInput: document.getElementById('beerBibleFormAbvInput'),
    beerBibleFormIbuInput: document.getElementById('beerBibleFormIbuInput'),
    beerBibleFormRatingInput: document.getElementById('beerBibleFormRatingInput'),
    beerBibleFormRatingCountInput: document.getElementById('beerBibleFormRatingCountInput'),
    beerBibleFormDescriptionInput: document.getElementById('beerBibleFormDescriptionInput'),
    beerBibleFormSaveBtn: document.getElementById('beerBibleFormSaveBtn'),
    beerBibleFormCancelBtn: document.getElementById('beerBibleFormCancelBtn'),
    beerBibleFormDeleteBtn: document.getElementById('beerBibleFormDeleteBtn'),
    beerBibleFormStatus: document.getElementById('beerBibleFormStatus'),

    exportPreviewOverlay: document.getElementById('exportPreviewOverlay'),
    exportPreviewCloseBtn: document.getElementById('exportPreviewCloseBtn'),
    exportPreviewCloseFooterBtn: document.getElementById('exportPreviewCloseFooterBtn'),
    exportPreviewSettingsBtn: document.getElementById('exportPreviewSettingsBtn'),
    exportPreviewSearchInput: document.getElementById('exportPreviewSearchInput'),
    exportPreviewStatus: document.getElementById('exportPreviewStatus'),
    exportPreviewTableWrap: document.getElementById('exportPreviewTableWrap'),

    serverPcOverlay: document.getElementById('serverPcOverlay'),
    serverPcCloseBtn: document.getElementById('serverPcCloseBtn'),
    serverPcCloseFooterBtn: document.getElementById('serverPcCloseFooterBtn'),
    serverPcAddresses: document.getElementById('serverPcAddresses'),
    serverPcHistoryCount: document.getElementById('serverPcHistoryCount'),
    serverPcDiscovered: document.getElementById('serverPcDiscovered'),
    serverPcCheckbox: document.getElementById('serverPcCheckbox'),
    serverPcStatus: document.getElementById('serverPcStatus'),
    serverPcSaveBtn: document.getElementById('serverPcSaveBtn'),

    settingsOverlay: document.getElementById('settingsOverlay'),
    settingsCloseBtn: document.getElementById('settingsCloseBtn'),
    settingsCloseFooterBtn: document.getElementById('settingsCloseFooterBtn'),
    settingsNavButtons: [...document.querySelectorAll('#settingsOverlay .settings-sidebar__item')],
    settingsPanels: [...document.querySelectorAll('#settingsOverlay .settings-panel')],
    settingsAccentButtons: [...document.querySelectorAll('#settingsOverlay [data-accent]')],
    settingsMenuSizeButtons: [...document.querySelectorAll('#settingsOverlay [data-menu-size]')],
    experimentalPairingsCheckbox: document.getElementById('experimentalPairingsCheckbox'),
    experimentalProfileCheckbox: document.getElementById('experimentalProfileCheckbox'),
    experimentalTastingNotesCheckbox: document.getElementById('experimentalTastingNotesCheckbox'),

    menuBar: document.getElementById('menuBar'),
  };

  // ---------- Theme ----------

  // Dark mode covers the application chrome only. Shelf talkers and display
  // signs keep the print palette (see the note above .card in styles.css) -
  // they are pictures of something that gets printed on white paper, so
  // theming them would break the guarantee that the preview shows exactly
  // what comes out of the printer.
  //
  // The attribute itself is set by an inline script in index.html so the
  // theme is already correct on the first painted frame; this only handles
  // switching it afterwards and remembering the choice.
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    const dark = theme === 'dark';
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    if (els.themeToggle) {
      els.themeToggle.setAttribute('aria-pressed', String(dark));
      els.themeToggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
      els.themeToggle.querySelector('.theme-toggle__icon').textContent = dark ? '☀' : '☽';
      els.themeToggle.querySelector('.theme-toggle__label').textContent = dark ? 'Light' : 'Dark';
    }
  }

  if (els.themeToggle) {
    els.themeToggle.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // Same as the queue: an unavailable store shouldn't break the click,
        // the choice just won't survive a restart.
      }
    });
  }

  // Follow the OS only while the user hasn't expressed a preference of their
  // own - once they've picked, their choice sticks.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      let saved = null;
      try { saved = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
      if (!saved) applyTheme(e.matches ? 'dark' : 'light');
    });
  }

  // ---------- Accent (Settings -> Change Theme) ----------

  // Amber vs. Purple for the app's own text/buttons - independent of dark
  // mode above, and independent of the per-talker Amber/Purple Theme picker
  // on the form (that one colours the printed shelf talker/sign itself; see
  // the note at the top of styles.css on why the print and UI palettes are
  // kept apart). Same before-first-paint handling as dark mode: the
  // attribute is set by the inline script in index.html so a saved Purple
  // choice doesn't flash Amber for a frame on launch; this only handles
  // switching it afterwards and remembering the choice.
  function currentAccent() {
    return document.documentElement.getAttribute('data-accent') === 'purple' ? 'purple' : 'amber';
  }

  function applyAccent(accent) {
    const purple = accent === 'purple';
    if (purple) document.documentElement.setAttribute('data-accent', 'purple');
    else document.documentElement.removeAttribute('data-accent');
    els.settingsAccentButtons.forEach((btn) => {
      const isActive = btn.dataset.accent === (purple ? 'purple' : 'amber');
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-checked', String(isActive));
    });
  }

  els.settingsAccentButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.accent === 'purple' ? 'purple' : 'amber';
      applyAccent(next);
      try {
        localStorage.setItem(ACCENT_KEY, next);
      } catch {
        // Same as theme/queue: an unavailable store shouldn't break the
        // click, the choice just won't survive a restart.
      }
    });
  });

  // ---------- Queue column toggle (app bar switch, by History) ----------

  // Same before-first-paint handling as theme/accent above (see the inline
  // script in index.html): the attribute is already correct on the first
  // painted frame, this only handles switching it afterwards, remembering
  // the choice, and re-scaling Live Preview into the width the Queue
  // column's track just gave up or reclaimed.
  function queueColumnVisible() {
    return document.documentElement.getAttribute('data-queue-hidden') !== 'true';
  }

  function applyQueueColumnVisible(visible) {
    if (visible) document.documentElement.removeAttribute('data-queue-hidden');
    else document.documentElement.setAttribute('data-queue-hidden', 'true');
    if (els.queueColumnToggle) els.queueColumnToggle.checked = visible;
    rescalePreviewStage();
  }

  if (els.queueColumnToggle) {
    els.queueColumnToggle.checked = queueColumnVisible();
    els.queueColumnToggle.addEventListener('change', () => {
      const visible = els.queueColumnToggle.checked;
      applyQueueColumnVisible(visible);
      try {
        localStorage.setItem(QUEUE_COLUMN_KEY, String(visible));
      } catch {
        // Same as theme/accent: an unavailable store shouldn't break the
        // click, the choice just won't survive a restart.
      }
    });
  }

  // ---------- Menu Bar Size (Settings -> Menu Bar Size) ----------

  // Drives --menubar-h/--menubar-fs in styles.css via [data-menu-size] on
  // <html> - same before-first-paint handling as accent above (see the
  // inline script in index.html), and the same "everything else is em
  // units off the menu bar's own font-size" trick the menu-bar-size mockup
  // this was built from used, so one attribute resizes the whole bar
  // (labels, dropdowns, items) together.
  function currentMenuSize() {
    const attr = document.documentElement.getAttribute('data-menu-size');
    return MENU_SIZES.includes(attr) ? attr : 'comfortable';
  }

  function applyMenuSize(size) {
    const resolved = MENU_SIZES.includes(size) ? size : 'comfortable';
    if (resolved === 'comfortable') document.documentElement.removeAttribute('data-menu-size');
    else document.documentElement.setAttribute('data-menu-size', resolved);
    els.settingsMenuSizeButtons.forEach((btn) => {
      const isActive = btn.dataset.menuSize === resolved;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-checked', String(isActive));
    });
  }

  els.settingsMenuSizeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = MENU_SIZES.includes(btn.dataset.menuSize) ? btn.dataset.menuSize : 'comfortable';
      applyMenuSize(next);
      try {
        localStorage.setItem(MENU_SIZE_KEY, next);
      } catch {
        // Same as accent/theme/queue: an unavailable store shouldn't break
        // the click, the choice just won't survive a restart.
      }
    });
  });

  // ---------- Experimental Features (Settings -> Wine Food Pairings) ----------
  //
  // Published onto window.ShelfTalkerSettings so card.js - a separate
  // script, sharing this page's global scope the same way it already
  // shares window.ShelfTalkerLayout with layout.js - can gate printing the
  // instant a toggle here is switched off, even for a talker that already
  // has that data from before. Nothing here is ever deleted: fillForm/
  // readForm don't check these flags at all, so a hidden field's value
  // round-trips through a save untouched, and switching a toggle back on
  // immediately shows/prints it again. (Bourbon Shelf Talkers used to be
  // one of these too - it's a real Product Type now instead, see
  // applyFormMode's isBourbon.)
  window.ShelfTalkerSettings = window.ShelfTalkerSettings || {};

  // One switch gates the Food Pairing Suggestions field (applyFormMode's
  // pairingsField line) and, via window.ShelfTalkerSettings, whether
  // card.js prints the "Pairs Well With" block (buildPairingsHtml).
  // Nothing here is ever deleted:
  // readForm/fillForm don't check this flag, so pairings already picked on
  // a talker round-trip through a save untouched and reappear the instant
  // the toggle goes back on. Also hides/shows Tools > Wine Pairing Rules…
  // (see winePairingRulesModal) - that reference describes a field staff
  // can't see while this is off, so the menu item disappears with it
  // rather than just greying out (see enabledDropdownItemsOf's [hidden]
  // check, added alongside this menu item, for why hidden and not
  // aria-disabled).
  function applyExperimentalPairings(enabled) {
    experimentalPairingsEnabled = enabled;
    window.ShelfTalkerSettings.experimentalPairings = enabled;
    els.experimentalPairingsCheckbox.checked = enabled;
    els.winePairingRulesMenuItem.hidden = !enabled;
    applyFormMode();
    if (previewMode === 'single') renderPreview();
  }

  els.experimentalPairingsCheckbox.addEventListener('change', () => {
    applyExperimentalPairings(els.experimentalPairingsCheckbox.checked);
    try {
      localStorage.setItem(EXPERIMENTAL_PAIRINGS_KEY, String(els.experimentalPairingsCheckbox.checked));
    } catch {
      // Same as theme/accent above - the choice just won't survive a restart.
    }
  });

  // ---------- Experimental Features (Settings -> Wine Profile) ----------
  //
  // Same shape as applyExperimentalPairings right above: one switch gates
  // the Wine Profile field (applyFormMode's profileField line) and, via
  // window.ShelfTalkerSettings, whether card.js prints the Wine Profile
  // dot strip (buildWineProfileHtml). Nothing here is ever deleted:
  // readForm/fillForm don't check this flag, so dots already picked on a
  // talker round-trip through a save untouched and reappear the instant
  // the toggle goes back on.
  function applyExperimentalWineProfile(enabled) {
    experimentalProfileEnabled = enabled;
    window.ShelfTalkerSettings.experimentalWineProfile = enabled;
    els.experimentalProfileCheckbox.checked = enabled;
    applyFormMode();
    if (previewMode === 'single') renderPreview();
  }

  els.experimentalProfileCheckbox.addEventListener('change', () => {
    applyExperimentalWineProfile(els.experimentalProfileCheckbox.checked);
    try {
      localStorage.setItem(EXPERIMENTAL_PROFILE_KEY, String(els.experimentalProfileCheckbox.checked));
    } catch {
      // Same as theme/accent above - the choice just won't survive a restart.
    }
  });

  // ---------- Experimental Features (Settings -> Find Tasting Notes) ----------
  //
  // Same shape as applyExperimentalPairings/applyExperimentalWineProfile
  // above, minus the window.ShelfTalkerSettings publish - unlike Pairings/
  // Profile, Find Tasting Notes never prints onto the .card, so card.js has
  // no need to see this flag. Nothing here is ever deleted: a description
  // (or Nose/Palate/Finish) already filled in via the button stays on the
  // talker untouched if the toggle goes back off.
  function applyExperimentalTastingNotes(enabled) {
    experimentalTastingNotesEnabled = enabled;
    els.experimentalTastingNotesCheckbox.checked = enabled;
    applyFormMode();
  }

  els.experimentalTastingNotesCheckbox.addEventListener('change', () => {
    applyExperimentalTastingNotes(els.experimentalTastingNotesCheckbox.checked);
    try {
      localStorage.setItem(EXPERIMENTAL_TASTING_NOTES_KEY, String(els.experimentalTastingNotesCheckbox.checked));
    } catch {
      // Same as theme/accent above - the choice just won't survive a restart.
    }
  });

  // ---------- Tabs ----------

  function activateTab(tab) {
    els.tabs.forEach((t) => {
      const isActive = t === tab;
      t.classList.toggle('is-active', isActive);
      // Roving tabindex: only the selected tab is in the tab order, and the
      // arrow keys move between them - the pattern role="tab" implies.
      t.setAttribute('aria-selected', String(isActive));
      t.tabIndex = isActive ? 0 : -1;
    });
    els.panels.forEach((p) => p.classList.toggle('is-active', p.dataset.panel === tab.dataset.tab));
    // If Search is the tab being switched to and Scan UPC happens to be its
    // currently-picked method, focus the UPC field the same way switching
    // straight to Scan UPC below does - see focusScanIfActive.
    if (tab.dataset.tab === 'search') focusScanIfActive();
  }

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const list = [...els.tabs];
      const next = list[(list.indexOf(tab) + dir + list.length) % list.length];
      activateTab(next);
      next.focus();
    });
  });

  // ---------- Search's panel switching ----------

  // Search by Name, SKU Lookup, and Scan UPC used to be three separate
  // top-level tabs (each its own .tab/.tab-panel, handled by activateTab
  // above), then a manually-picked radiogroup of buttons one level down;
  // there's no manual picker anymore, so which .method-panel is visible is
  // decided entirely by smart search's own detection below.
  let activeSearchMethod = 'searchName';

  function setActiveMethodPanel(method) {
    activeSearchMethod = method;
    els.methodPanels.forEach((p) => p.classList.toggle('is-active', p.dataset.methodPanel === method));
  }

  // Scan UPC is meant for walking up and scanning immediately - put the
  // cursor in the UPC field whenever it's the active method and Search is
  // the visible tab (switching methods, and switching to the Search tab
  // while Scan UPC is already picked, both funnel through here) so the very
  // first scan lands in the field with no extra click. No other method
  // needs this: a scanner is the only "device" that starts typing without
  // clicking anything first.
  function focusScanIfActive() {
    const searchTabActive = document.querySelector('.tab[data-tab="search"]').classList.contains('is-active');
    if (searchTabActive && activeSearchMethod === 'scan') els.scanUpcInput.focus();
  }

  // ---------- Smart search (routes to the panel above automatically) ----------

  // The only entry point into Search - guesses which of the three lookups
  // below applies, so day-to-day use doesn't require picking a method: any
  // letters means a product name, a short all-digit string is a SKU, a long
  // one is a UPC. It drives the three panels below rather than replacing
  // them - see the comment on #smartSearchFieldWrap in index.html for why.
  const SMART_SEARCH_UPC_MIN_DIGITS = 8; // UPC-A/EAN-13 run 12-13 digits, UPC-E 8 - store SKUs here are shorter
  // Our own self-printed labels barcode the store's SKU as "A" + that SKU
  // zero-padded to 7 digits (e.g. A0042420 for item 42420) rather than a
  // real manufacturer UPC, so it needs unwrapping back to a plain SKU
  // before it can go through the same SKU Lookup a typed 42420 would.
  const INTERNAL_UPC_RE = /^A(\d{7})$/i;
  const SMART_SEARCH_HINTS = {
    name: 'Searching by name…',
    sku: 'Looks like a SKU. Press Enter, or Look Up SKU below, to search it.',
    upc: 'Looks like a UPC. Press Enter, or scan again, to look it up.',
  };

  function detectSmartSearchMode(raw) {
    const value = raw.trim();
    if (!value) return null;
    if (INTERNAL_UPC_RE.test(value)) return 'internalUpc';
    const digitsOnly = value.replace(/[\s-]/g, '');
    if (!/^\d+$/.test(digitsOnly)) return 'name';
    return digitsOnly.length >= SMART_SEARCH_UPC_MIN_DIGITS ? 'upc' : 'sku';
  }

  function runSmartSearch(rawValue) {
    const mode = detectSmartSearchMode(rawValue);
    if (mode === 'internalUpc') {
      const itemNumber = String(parseInt(rawValue.trim().match(INTERNAL_UPC_RE)[1], 10));
      els.smartSearchHint.textContent = `Internal UPC for item ${itemNumber}. Press Enter, or Look Up SKU below, to search it.`;
    } else {
      els.smartSearchHint.textContent = mode ? SMART_SEARCH_HINTS[mode] : ' ';
    }
    if (mode !== 'name') {
      // Leaving name mode (or clearing the field) - any in-flight/rendered
      // name search is now stale, same as if the old separate Product Name
      // field had been cleared.
      clearTimeout(nameSearchDebounce);
      if (nameSearchSelectedProduct) clearNameSearchSelection();
      closeNameSearchResults();
    }
    if (!mode) return;
    const targetMethod = mode === 'upc' ? 'scan' : mode === 'sku' || mode === 'internalUpc' ? 'sku' : 'searchName';
    if (targetMethod !== activeSearchMethod) setActiveMethodPanel(targetMethod);
    if (mode === 'name') {
      // Picking a result sets this field's value to that product's title too
      // (see selectNameSearchProduct) - without clearing the prior selection
      // here, editing that text afterward would leave a stale "selected"
      // product (and an enabled Add to Queue button) that no longer matches
      // what's actually typed.
      if (nameSearchSelectedProduct) clearNameSearchSelection();
      clearTimeout(nameSearchDebounce);
      nameSearchDebounce = setTimeout(() => runNameSearch(rawValue), 200);
    } else if (mode === 'sku') {
      els.skuInput.value = rawValue.trim();
    } else if (mode === 'internalUpc') {
      els.skuInput.value = String(parseInt(rawValue.trim().match(INTERNAL_UPC_RE)[1], 10));
    } else {
      els.scanUpcInput.value = rawValue.trim();
    }
  }

  els.smartSearchInput.addEventListener('input', () => runSmartSearch(els.smartSearchInput.value));

  els.smartSearchInput.addEventListener('focus', () => {
    if (nameSearchResults.length && detectSmartSearchMode(els.smartSearchInput.value) === 'name') {
      renderNameSearchResults();
    }
  });

  // A barcode scanner types its code fast and finishes with Enter (see
  // wireEnterTriggersClick below) - it may land in this field rather than
  // Scan UPC's own, so Enter here needs to trigger the matching lookup
  // button itself when scanning/SKU. When Search by Name's results dropdown
  // is open, arrow keys move through it and Enter picks the highlighted row
  // instead - the same keyboard nav the old separate Product Name field had.
  els.smartSearchInput.addEventListener('keydown', (e) => {
    const resultsOpen = !els.nameSearchResults.hidden && nameSearchResults.length;
    if (resultsOpen && e.key === 'ArrowDown') {
      e.preventDefault();
      nameSearchFocusIndex = Math.min(nameSearchFocusIndex + 1, nameSearchResults.length - 1);
      renderNameSearchResults();
      return;
    }
    if (resultsOpen && e.key === 'ArrowUp') {
      e.preventDefault();
      nameSearchFocusIndex = Math.max(nameSearchFocusIndex - 1, 0);
      renderNameSearchResults();
      return;
    }
    if (resultsOpen && e.key === 'Escape') {
      closeNameSearchResults();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (resultsOpen && nameSearchResults[nameSearchFocusIndex]) {
      selectNameSearchProduct(nameSearchResults[nameSearchFocusIndex]);
      return;
    }
    const mode = detectSmartSearchMode(els.smartSearchInput.value);
    runSmartSearch(els.smartSearchInput.value);
    if (mode === 'sku' || mode === 'internalUpc') els.skuLookupBtn.click();
    else if (mode === 'upc') els.scanUpcLookupBtn.click();
  });

  // ---------- Form mode (Shelf Talker/Display Sign x Small/Large x Wine/Beer) ----------

  // Single source of truth for what the form should look like, driven by
  // the three toggles together - e.g. a Small Display Sign has no room for
  // a description/rating, regardless of category, so those fields
  // disappear only in that combination.
  // The toggle rows are role="radiogroup"; keeping aria-checked in step with
  // the .is-active styling is what makes the current choice readable to a
  // screen reader instead of being conveyed by colour alone.
  function setToggleState(buttons, isSelected) {
    buttons.forEach((b) => {
      const selected = isSelected(b);
      b.classList.toggle('is-active', selected);
      b.setAttribute('aria-checked', String(selected));
    });
  }

  // Keeps every repeated Type/Product Type <select> (one per top-level tab -
  // see the shared .type-select/.product-type-select note in index.html)
  // showing the same value, since they're all views onto the same
  // currentSignType/currentSignSize/currentCategory rather than independent
  // per-tab settings. Setting .value directly here (rather than going
  // through a user gesture) doesn't fire 'change', so each select's own
  // custom dropdown (see initFieldSelects below) wouldn't otherwise know
  // its displayed label just went stale - _fieldSelectRefresh is that
  // dropdown's own re-render, stashed on the select by initFieldSelects.
  function syncSelects(selects, value) {
    selects.forEach((s) => {
      s.value = value;
      if (s._fieldSelectRefresh) s._fieldSelectRefresh();
    });
  }

  // The Type dropdown's three options fold two separate pieces of state
  // (currentSignType, and currentSignSize when currentSignType is 'sign')
  // into one flat value; this is that combination's other direction, used
  // by applyFormMode below to keep the dropdowns themselves in sync, and by
  // the dropdowns' own change handler further down to unpack a picked value
  // back into the two.
  function typeSelectValue() {
    return currentSignType === 'talker' ? 'talker' : currentSignSize;
  }

  function applyFormMode() {
    const isBeer = currentCategory === 'beer';
    const isBourbon = currentCategory === 'bourbon';
    const isSign = currentSignType === 'sign';
    const isSmallSign = isSign && currentSignSize === 'small';

    syncSelects(els.typeSelects, typeSelectValue());
    syncSelects(els.productTypeSelects, currentCategory);

    els.titleLabel.textContent = isBeer ? 'Beer Name *' : (isSign ? 'Product Name *' : 'Product Title *');
    els.size.placeholder = isBeer ? '16oz Can / 4-pack' : '750ml / Each / 6-pack';

    els.talkerSizeField.hidden = isSign;
    els.talkerSize.value = currentTalkerSize;
    els.descriptionField.hidden = isSmallSign;
    // Wine.com wouldn't have anything for a beer, and Beer already has its
    // own tasting-note source (the Untappd import tab) - only show the
    // button for Wine/Spirits/Bourbon, and only once Settings ->
    // Experimental Features -> Find Tasting Notes is turned on (see
    // applyExperimentalTastingNotes).
    els.tastingNotesRow.hidden = isBeer || !experimentalTastingNotesEnabled;
    els.vintageField.hidden = isBeer || isSmallSign;
    els.wineRatingsField.hidden = isBeer || isSmallSign;
    // Shelf Talkers only, unlike Ratings above (which Large Display Signs
    // also show) - Awards only ever renders onto the .card printout, so
    // showing the field for a sign would offer input with no visible
    // effect there.
    els.awardsField.hidden = isBeer || isSign;
    // Same rule as Awards right above, and for the same reason - Store
    // Pick/Mash Bill/Nose/Palate/Finish only ever render onto the .card
    // printout (see buildStorePickRibbonHtml/buildMashBillHtml/
    // buildFlavorHtml in card.js), so a Display Sign would offer input with
    // no visible effect. Tied to Product Type = Bourbon (isSign already
    // rules out isBeer here, since a talker can't be both) rather than a
    // separate experimental toggle - these are just what a Bourbon Shelf
    // Talker has, the same way Beer Fields further down are just what a
    // Beer one has.
    els.storePickField.hidden = isSign || !isBourbon;
    els.mashBillField.hidden = isSign || !isBourbon;
    els.flavorFields.hidden = isSign || !isBourbon;
    // Mash Bill field just changed visibility (or the Product Title may
    // have too, on the fillForm() call path) - re-check whether the recall
    // banner should be showing (see refreshMashBillRecall below).
    refreshMashBillRecall();
    // Same rule/reasoning as Nose/Palate/Finish right above - printed onto
    // the .card only (see buildPairingsHtml in card.js), and gated behind
    // its own Settings -> Experimental Features -> Wine Food Pairings
    // toggle (see applyExperimentalPairings).
    els.pairingsField.hidden = isBeer || isSign || !experimentalPairingsEnabled;
    // Same rule/reasoning again - printed onto the .card only
    // (buildWineProfileHtml in card.js), gated behind its own Settings ->
    // Experimental Features -> Wine Profile toggle (see
    // applyExperimentalWineProfile).
    els.profileField.hidden = isBeer || isSign || !experimentalProfileEnabled;
    els.beerFields.hidden = !isBeer || isSmallSign;

    // The store never runs a Super Sale on beer, so the option isn't just
    // hidden for beer - a value of 'supersale' left over from switching
    // category (or from an older saved item, see fillForm) is actively
    // cleared back to Standard rather than kept around invisibly selected.
    els.talkerTypeSupersaleOption.hidden = isBeer;
    if (isBeer && els.talkerType.value === 'supersale') els.talkerType.value = 'standard';

    // Also Available Chilled doesn't apply to beer (already sold cold out
    // of a cooler, not a special case worth calling out) - same
    // hide-and-clear treatment as Super Sale right above, so a checked box
    // left over from switching category doesn't stay invisibly on.
    els.chilledField.hidden = isBeer;
    if (isBeer && els.chilled.checked) els.chilled.checked = false;

    // The "Super Sale Price!!!" callout only renders on the Shelf Talker
    // card and the Small Display Sign (see buildPricingHtml/
    // buildSmallSignBodyHtml in card.js) - Large Display Signs fold the
    // same text into the regular sale-price line instead, so the box would
    // have nothing to adjust there.
    const isLargeSign = isSign && !isSmallSign;
    els.superSaleFontSizeField.hidden = els.talkerType.value !== 'supersale' || isLargeSign;

    // Case Price only ever prints on a Large Display Sign (see
    // buildSignPriceRowHtml in card.js) - Shelf Talkers and Small Display
    // Signs have no bottom-right slot for it, so the field stays out of the
    // way for those, same as Awards/Store Pick/etc. above.
    els.casePriceField.hidden = !isLargeSign;

    // The "CLOSEOUT!!" badge renders on the Shelf Talker card and on both
    // Display Sign sizes (see buildPricingHtml/buildSignMetaRowHtml/
    // buildSmallSignBodyHtml in card.js), so unlike Super Sale above there's
    // no sign-size exclusion here.
    els.closeoutFontSizeField.hidden = els.talkerType.value !== 'closeout';

    applyImportMode();
    applySkuMode();
  }

  // The SKU Lookup method's copy - follows the same Product Type dropdown
  // as every other tab (see the shared .product-type-select note in
  // index.html), since a beer SKU lookup adds a second, Untappd-driven step
  // the wine/spirits path doesn't have.
  function applySkuMode() {
    const isBeer = currentCategory === 'beer';
    els.skuHelpText.textContent = isBeer
      ? 'Enter the store SKU number. We\'ll look it up on liquoroutletwinecellars.com for the title, size, and pricing, then search Untappd using that title for the description, brewery, style, ABV, IBU, and rating.'
      : 'Enter the store SKU number. We\'ll look it up on liquoroutletwinecellars.com and pull the title, size, and pricing automatically - review the fields before adding it to your queue.';
  }

  // The Import tab's copy - what it asks for and what it promises to fill
  // in - follows the same Product Type dropdown as every other tab (see the
  // shared .product-type-select note in index.html), since beer import is
  // aimed at Untappd rather than a retail product page and pulls a
  // different set of fields (no price - Untappd doesn't sell anything).
  function applyImportMode() {
    const isBeer = currentCategory === 'beer';
    els.importUrlLabel.textContent = isBeer ? 'Untappd Beer Page URL' : 'Product Page URL';
    els.importUrl.placeholder = isBeer
      ? 'https://untappd.com/b/brewery-name-beer-name/12345'
      : 'https://www.liquoroutletwinecellars.com/products/...';
    els.importHelpText.textContent = isBeer
      ? 'Paste a beer\'s Untappd page URL. We\'ll try to pull the brewery, location, style, ABV, IBU, rating, and description automatically - you\'ll still need to add the price and size yourself.'
      : 'Paste a product page URL from your website. We\'ll try to pull the title, description, and price automatically - review the fields before adding it to your queue.';
    els.importBtn.textContent = isBeer ? 'Fetch Beer Data' : 'Fetch Product Data';
  }

  // Re-stamps the Title/Description Font Size boxes with the type-
  // appropriate default from DEFAULT_FONT_SIZE_PT. Only called for a new
  // (not mid-edit) item - same guard as the Theme auto-pick in setCategory
  // below, so switching Shelf Talker/Display Sign while editing an already-
  // saved item doesn't silently overwrite a font size that item's owner
  // chose on purpose.
  function applyFontSizeDefaults() {
    const defaults = DEFAULT_FONT_SIZE_PT[currentSignType];
    els.titleFontSize.value = defaults.title;
    els.descriptionFontSize.value = defaults.description;
    els.superSaleFontSize.value = defaults.superSalePrice;
    els.closeoutFontSize.value = defaults.closeoutBadge;
    els.ratingsFontSize.value = defaults.ratings;
  }

  // Unpacks the Type dropdown's picked value back into
  // currentSignType/currentSignSize (see typeSelectValue's own note above
  // for the other direction). Font-size defaults only get re-stamped when
  // sign type itself actually changes (Shelf Talker <-> a Display Sign) -
  // DEFAULT_FONT_SIZE_PT has no separate small-vs-large entry, so toggling
  // between the two Display Sign sizes alone has nothing new to apply.
  function setType(value) {
    const nextSignType = value === 'talker' ? 'talker' : 'sign';
    const nextSignSize = value === 'small' ? 'small' : 'large';
    const signTypeChanged = nextSignType !== currentSignType;
    currentSignType = nextSignType;
    currentSignSize = nextSignSize;
    if (signTypeChanged && !els.editId.value) applyFontSizeDefaults();
    applyFormMode();
  }

  function setTalkerSize(talkerSize) {
    currentTalkerSize = ['half', 'quarter'].includes(talkerSize) ? talkerSize : 'full';
    applyFormMode();
  }

  // 'wine' is the fallback for anything unrecognized - a value from a save
  // that predates Bourbon becoming its own category, or a corrupt one -
  // same "assume it's the common case" default currentCategory always had
  // for beer/not-beer, just extended to a third real value. Shared between
  // setCategory and fillForm below so the two can't drift apart on what
  // counts as a valid category.
  function normalizeCategory(value) {
    return value === 'beer' || value === 'bourbon' ? value : 'wine';
  }

  function setCategory(category) {
    currentCategory = normalizeCategory(category);
    // Purple reads as the store's beer theme, amber as wine/spirits/bourbon
    // - only while composing a new entry, though. Switching category
    // mid-edit (editId set) must not silently overwrite an already-saved
    // item's deliberately-chosen theme just because someone toggled the
    // label.
    if (!els.editId.value) els.theme.value = currentCategory === 'beer' ? 'purple' : 'amber';
    // Beer Name tends to run longer than a wine/spirits/bourbon Product
    // Title (brewery + beer + container all crammed in), so it clips more
    // often - default its Auto-size toggle on for beer the same way, and
    // only while composing new (same guard as Theme above).
    if (!els.editId.value) els.titleAutoSize.checked = currentCategory === 'beer';
    applyFormMode();
    // Distiller.com's place in the Find Tasting Notes source list depends
    // on category now too (see renderTastingNotesSourceOptions) - re-check
    // it every time category changes, not just when the dialog opens.
    renderTastingNotesSourceOptions();
  }

  els.typeSelects.forEach((select) => {
    select.addEventListener('change', () => {
      if (select.value === typeSelectValue()) return;
      setType(select.value);
      refreshPreview();
    });
  });

  els.talkerSize.addEventListener('change', () => {
    setTalkerSize(els.talkerSize.value);
    refreshPreview();
  });

  els.productTypeSelects.forEach((select) => {
    select.addEventListener('change', () => {
      if (select.value === currentCategory) return;
      setCategory(select.value);
      refreshPreview();
    });
  });

  // Only field visibility depends on Talker Style (see applyFormMode's
  // superSaleFontSizeField/closeoutFontSizeField toggles above) - the
  // preview itself already re-renders off els.form's own 'input' listener
  // below.
  els.talkerType.addEventListener('change', applyFormMode);

  // ---------- Form <-> talker object ----------

  function readForm() {
    return {
      signType: currentSignType,
      signSize: currentSignSize,
      talkerSize: currentTalkerSize,
      category: currentCategory,
      title: els.title.value.trim(),
      titleFontSize: els.titleFontSize.value.trim(),
      titleAutoSize: els.titleAutoSize.checked,
      vintage: els.vintage.value.trim(),
      description: els.description.value.trim(),
      descriptionFontSize: els.descriptionFontSize.value.trim(),
      descriptionAutoSize: els.descriptionAutoSize.checked,
      size: els.size.value.trim(),
      theme: els.theme.value,
      price: els.price.value.trim(),
      salePrice: els.salePrice.value.trim(),
      casePrice: els.casePrice.value.trim(),
      talkerType: els.talkerType.value,
      isChilled: els.chilled.checked,
      superSaleFontSize: els.superSaleFontSize.value.trim(),
      closeoutFontSize: els.closeoutFontSize.value.trim(),
      ratingsFontSize: els.ratingsFontSize.value.trim(),
      ratings: currentRatings.slice(),
      awards: els.awards.value.trim(),
      awardsColor: els.awardsColor.value,
      isStorePick: els.storePick.checked,
      mashBill: currentMashBill.slice(),
      mashBillConfidence: currentMashBillConfidence,
      nose: els.nose.value.trim(),
      palate: els.palate.value.trim(),
      finish: els.finish.value.trim(),
      pairings: currentPairings.slice(),
      wineProfile: { ...currentProfile },
      sku: els.sku.value.trim(),
      brewery: els.brewery.value.trim(),
      location: els.location.value.trim(),
      style: els.style.value.trim(),
      abv: els.abv.value.trim(),
      ibu: els.ibu.value.trim(),
      untappdRating: els.untappdRating.value.trim(),
      untappdRatingCount: els.untappdRatingCount.value.trim().replace(/,/g, ''),
    };
  }

  function fillForm(talker) {
    currentSignType = talker.signType === 'sign' ? 'sign' : 'talker';
    currentSignSize = talker.signSize === 'small' ? 'small' : 'large';
    currentTalkerSize = ['half', 'quarter'].includes(talker.talkerSize) ? talker.talkerSize : 'full';
    currentCategory = normalizeCategory(talker.category);
    applyFormMode();
    renderTastingNotesSourceOptions();
    els.title.value = talker.title || '';
    els.titleFontSize.value = talker.titleFontSize || DEFAULT_FONT_SIZE_PT[currentSignType].title;
    // Same beer default as setCategory/resetForm (see their own comments) -
    // a freshly-looked-up product (UPC/SKU/name-search/import/Untappd
    // picker) never includes this key, so `undefined` means "not specified"
    // and falls back to the category default here too, same as those two.
    // An explicit true/false (a saved/edited talker's own readForm()
    // snapshot, always a real boolean) is honored as-is either way.
    els.titleAutoSize.checked = talker.titleAutoSize === undefined
      ? currentCategory === 'beer'
      : !!talker.titleAutoSize;
    els.vintage.value = talker.vintage || '';
    els.description.value = talker.description || '';
    els.descriptionFontSize.value = talker.descriptionFontSize || DEFAULT_FONT_SIZE_PT[currentSignType].description;
    els.descriptionAutoSize.checked = !!talker.descriptionAutoSize;
    els.size.value = talker.size || '';
    els.theme.value = talker.theme || 'amber';
    els.price.value = talker.price || '';
    els.salePrice.value = talker.salePrice || '';
    els.casePrice.value = talker.casePrice || '';
    // 'chilled' used to be a 4th Talker Style option, mutually exclusive
    // with Closeout/Super Sale (see the isChilled migration just below) -
    // an older saved/imported talker carrying that value maps onto plain
    // Standard here, same as any other unrecognised value would via the
    // || 'standard' fallback.
    els.talkerType.value = talker.talkerType === 'chilled' ? 'standard' : (talker.talkerType || 'standard');
    // applyFormMode's own supersale-vs-beer clamp ran above, before this
    // line existed to overwrite it - re-check here so loading an older
    // saved beer item that predates this rule doesn't restore Super Sale.
    if (currentCategory === 'beer' && els.talkerType.value === 'supersale') els.talkerType.value = 'standard';
    els.superSaleFontSize.value = talker.superSaleFontSize || DEFAULT_FONT_SIZE_PT[currentSignType].superSalePrice;
    els.closeoutFontSize.value = talker.closeoutFontSize || DEFAULT_FONT_SIZE_PT[currentSignType].closeoutBadge;
    els.ratingsFontSize.value = talker.ratingsFontSize || DEFAULT_FONT_SIZE_PT[currentSignType].ratings;
    // Talker Style is now known, so the boxes' own visibility (hidden for
    // non-Super Sale/Large Display Sign, or non-Closeout) needs a second
    // pass - applyFormMode ran above before els.talkerType.value was set to
    // this talker's value.
    applyFormMode();
    currentRatings = Array.isArray(talker.ratings) ? talker.ratings.slice() : [];
    renderRatingsList();
    els.awards.value = talker.awards || '';
    els.awardsColor.value = /^#[0-9a-fA-F]{6}$/.test(talker.awardsColor) ? talker.awardsColor : '#171717';
    els.storePick.checked = !!talker.isStorePick;
    // Also carries the legacy Talker Style = 'chilled' value (see above) so
    // a talker saved before this became its own field still prints its
    // badge after being reloaded/edited.
    els.chilled.checked = !!talker.isChilled || talker.talkerType === 'chilled';
    // applyFormMode's own beer clamp ran above, before this line existed to
    // overwrite it - re-check here so loading an older beer item saved
    // with isChilled/talkerType 'chilled' (from before beer was excluded)
    // doesn't restore a checkbox the form no longer shows for beer.
    if (currentCategory === 'beer') els.chilled.checked = false;
    currentMashBill = Array.isArray(talker.mashBill) ? talker.mashBill.slice() : [];
    currentMashBillConfidence = CONFIDENCE_TIER_META[talker.mashBillConfidence] ? talker.mashBillConfidence : null;
    renderMashBillList();
    // Same reasoning as resetForm() above - "Save to Library" is per-
    // editing-session state, not something a loaded talker carries.
    els.mashBillSaveCheckbox.checked = false;
    els.mashBillSaveRow.hidden = true;
    els.mashBillSaveStatus.textContent = '';
    els.tastingNotesSaveCheckbox.checked = false;
    els.tastingNotesSaveRow.hidden = true;
    els.tastingNotesSaveStatus.textContent = '';
    mashBillRecallDismissedFor = '';
    els.nose.value = talker.nose || '';
    els.palate.value = talker.palate || '';
    els.finish.value = talker.finish || '';
    currentPairings = Array.isArray(talker.pairings) ? talker.pairings.slice() : [];
    renderPairingsList();
    // A fresh Suggest Pairings run is for the talker now loaded, not
    // whatever the previous one left showing.
    renderPairingSuggestions(null);
    els.pairingsSuggestStatus.textContent = 'Type a Product Title, then click Suggest Pairings.';
    // Same "always all five keys, default to 0/unrated" shape emptyWineProfile
    // establishes - a talker saved before this field existed (or one with a
    // partial/malformed wineProfile) just falls back to 0 per missing key.
    currentProfile = { ...emptyWineProfile(), ...(talker.wineProfile || {}) };
    renderProfilePicker();
    els.profileSuggestStatus.textContent = 'Type a Product Title, then click Suggest Profile.';
    els.sku.value = talker.sku || '';
    els.brewery.value = talker.brewery || '';
    els.location.value = talker.location || '';
    els.style.value = talker.style || '';
    els.abv.value = talker.abv || '';
    els.ibu.value = talker.ibu || '';
    els.untappdRating.value = talker.untappdRating || '';
    const countNum = Number(talker.untappdRatingCount);
    els.untappdRatingCount.value = talker.untappdRatingCount && Number.isFinite(countNum)
      ? countNum.toLocaleString('en-US')
      : (talker.untappdRatingCount || '');
  }

  function resetForm() {
    els.form.reset();
    // form.reset() snaps every control back to its markup default, including
    // the Talker Size <select> - but currentTalkerSize (the value readForm
    // actually uses) lives outside the form and isn't touched, so without
    // this the dropdown would read "Full Size" while the next talker added
    // silently kept the previous Half/Quarter size. Re-applying the mode
    // puts the control back in sync with the state, which also keeps the
    // selected size across a batch of entries.
    applyFormMode();
    // Same idea for Theme: form.reset() always snaps it back to Amber (the
    // markup's first <option>), which would silently un-purple every beer
    // after the first one in a batch. currentCategory persists across a
    // reset the same way currentTalkerSize does, so re-derive the default
    // from it here too.
    els.theme.value = currentCategory === 'beer' ? 'purple' : 'amber';
    // And again for the title's Auto-size toggle (see setCategory) -
    // form.reset() always snaps it back to unchecked, which would silently
    // turn Auto off for every beer after the first one in a batch.
    els.titleAutoSize.checked = currentCategory === 'beer';
    applyFontSizeDefaults();
    els.editId.value = '';
    els.saveBtn.textContent = 'Add to Queue';
    els.cancelEditBtn.hidden = true;
    currentRatings = [];
    renderRatingsList();
    currentPairings = [];
    renderPairingsList();
    renderPairingSuggestions(null);
    els.pairingsSuggestStatus.textContent = 'Type a Product Title, then click Suggest Pairings.';
    currentProfile = emptyWineProfile();
    renderProfilePicker();
    els.profileSuggestStatus.textContent = 'Type a Product Title, then click Suggest Profile.';
    currentMashBill = [];
    currentMashBillConfidence = null;
    renderMashBillList();
    // "Save to Library" is per-editing-session state, not part of the
    // talker itself - form.reset() above already unchecks the checkbox
    // (a native control) but doesn't fire its 'change' listener, so the
    // row it reveals needs hiding by hand.
    els.mashBillSaveRow.hidden = true;
    els.mashBillSaveStatus.textContent = '';
    els.tastingNotesSaveRow.hidden = true;
    els.tastingNotesSaveStatus.textContent = '';
    mashBillRecallDismissedFor = '';
    hideError();
    refreshPreview();
  }

  function showError(msg) {
    els.formError.textContent = msg;
    els.formError.hidden = false;
  }
  function hideError() {
    els.formError.hidden = true;
  }

  // ---------- Ratings & reviewers ----------

  function renderReviewerSelect() {
    const current = els.ratingReviewer.value;
    els.ratingReviewer.innerHTML = reviewers.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
    if (reviewers.includes(current)) els.ratingReviewer.value = current;
  }

  function renderReviewerManagerList() {
    if (reviewers.length === 0) {
      els.reviewerManagerList.innerHTML = '<p class="empty-hint">No reviewers yet.</p>';
      return;
    }
    els.reviewerManagerList.innerHTML = reviewers.map((r, i) => `
      <div class="rating-chip" data-reviewer-index="${i}">
        <span>${escapeHtml(r)}</span>
        <button type="button" data-action="remove-reviewer" title="Remove">&times;</button>
      </div>
    `).join('');
  }

  function renderRatingsList() {
    if (currentRatings.length === 0) {
      els.ratingsList.innerHTML = '';
      return;
    }
    els.ratingsList.innerHTML = currentRatings.map((r, i) => `
      <div class="rating-chip" data-rating-index="${i}">
        <span>${escapeHtml(r.score)} Pts ${escapeHtml(r.reviewer)}</span>
        <button type="button" data-action="remove-rating" title="Remove">&times;</button>
      </div>
    `).join('');
  }

  function addRating() {
    const reviewer = els.ratingReviewer.value;
    const score = els.ratingScore.value.trim();
    if (!reviewer || !score) return;
    currentRatings.push({ reviewer, score });
    els.ratingScore.value = '';
    renderRatingsList();
    refreshPreview();
  }

  els.addRatingBtn.addEventListener('click', addRating);
  els.ratingScore.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addRating(); }
  });

  els.ratingsList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove-rating"]');
    if (!btn) return;
    const idx = Number(btn.closest('[data-rating-index]').dataset.ratingIndex);
    currentRatings.splice(idx, 1);
    renderRatingsList();
    refreshPreview();
  });

  // ---------- Mash Bill (Bourbon Shelf Talkers) ----------

  // Same "build a list, one Add click at a time" pattern as Ratings above,
  // just grain+percent instead of reviewer+score - no "manage grains"
  // equivalent to Manage Reviewers, since the *grain vocabulary* itself
  // (Corn/Rye/Wheat/... - #fMashBillGrain's own <option>s in index.html) is
  // a small fixed set, not something a store customizes. The Bourbon
  // Library further down (see els.libraryAddBtn) is a different kind of
  // "manage" - saved title -> grains compositions, not this dropdown's own
  // options.
  function renderMashBillList() {
    if (currentMashBill.length === 0) {
      els.mashBillList.innerHTML = '';
      return;
    }
    els.mashBillList.innerHTML = currentMashBill.map((m, i) => `
      <div class="rating-chip" data-mashbill-index="${i}">
        <span>${escapeHtml(m.pct)}% ${escapeHtml(m.grain)}</span>
        <button type="button" data-action="remove-mashbill" title="Remove">&times;</button>
      </div>
    `).join('');
  }

  // Both hand-edit paths below clear currentMashBillConfidence - see its
  // own declaration further up for why a hand edit invalidates whatever
  // tier an earlier autofill brought in.
  function addMashBillGrain() {
    const grain = els.mashBillGrain.value;
    const pct = els.mashBillPct.value.trim();
    if (!grain || !pct) return;
    currentMashBill.push({ grain, pct });
    currentMashBillConfidence = null;
    els.mashBillPct.value = '';
    renderMashBillList();
    refreshPreview();
  }

  els.addMashBillBtn.addEventListener('click', addMashBillGrain);
  els.mashBillPct.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addMashBillGrain(); }
  });

  els.mashBillList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove-mashbill"]');
    if (!btn) return;
    const idx = Number(btn.closest('[data-mashbill-index]').dataset.mashbillIndex);
    currentMashBill.splice(idx, 1);
    currentMashBillConfidence = null;
    renderMashBillList();
    refreshPreview();
  });

  // ---------- Mash Bill Library: recall + Save to Library ----------
  //
  // A shared, Server-PC-hosted table of researched grain compositions (see
  // server/db.js's mash_bills table and server/mashBillSync.js) - so a mash
  // bill researched once for a product can be suggested again on the next
  // talker made for that same bottle, instead of re-typed from scratch.
  // Managing the library itself (add/edit/delete without an open talker)
  // happens on the Bourbon Library page (see els.libraryAddBtn further
  // down); this section is just the two touch points that live on this
  // field:
  //  - a recall banner that appears when the current Product Title exactly
  //    matches a saved entry, and
  //  - a "Save to Library" action that stores whatever's in the chip list
  //    above under the current Product Title.
  //
  // `mashBillLibraryCache` is this client's own copy of the shared library,
  // refreshed on load and after any write this client makes - not on a
  // recurring poll, since the server side already keeps every PC's data
  // current every ~30s regardless (see mashBillSync.js) and recall only
  // needs to be "current as of a moment ago", not live-updating while
  // staff are mid-edit.
  let mashBillLibraryCache = [];
  // Which Product Title the recall banner was last dismissed for ("Use It"
  // counts as a dismissal too, once the chips reflect the match) - reset
  // whenever the title changes to something else, or a different/blank
  // talker is loaded (see fillForm/resetForm), so the same title can always
  // bring the banner back if staff type it again later.
  let mashBillRecallDismissedFor = '';

  // A fresh install (or a genuinely single-PC store) has no Server PC
  // marked yet, so every read/write here 502s with mashBillSync.js's own
  // "No Server PC found on this network yet." - accurate, but it doesn't
  // say what to actually do about it. Unlike the WinePOS export (which a
  // single-PC store just points straight at the local file, no Server PC
  // needed), this feature has no non-networked path - even one PC needs to
  // mark *itself* Server PC once before its own local library works. This
  // appends that missing next step onto the same message rather than
  // inventing a new one, so the underlying error text everywhere else
  // (recall, save, the Manage dialog) still matches mashBillSync.js's own.
  function withServerPcHint(message) {
    if (!message || !/No Server PC found/.test(message)) return message;
    return `${message} Mark this PC (or another one) as the Server PC first - Advanced > Server PC…, even for a single-PC store.`;
  }

  function describeMashBillGrains(grains) {
    return (grains || []).map((g) => `${g.pct}% ${g.grain}`).join(', ');
  }

  async function fetchMashBillLibrary() {
    try {
      const resp = await fetch('/api/mashbills');
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not load the Mash Bill Library.');
      mashBillLibraryCache = Array.isArray(data.mashBills) ? data.mashBills : [];
      return data;
    } catch {
      // Keep whatever was already cached rather than clearing it - same
      // graceful-degradation spirit as the rest of this app's sync
      // fallbacks. This quiet failure just means recall (and the Bourbon
      // Library page, which shows a stale sync dot in this case - see
      // updateLibrarySyncUI further down) works off a possibly-stale cache
      // instead of blocking on one bad request.
      return null;
    }
  }

  function findMashBillMatch(title) {
    const needle = (title || '').trim().toLowerCase();
    if (!needle) return null;
    return mashBillLibraryCache.find((m) => (m.title || '').trim().toLowerCase() === needle) || null;
  }

  // Exact-title match only, deliberately - no distillery-level fallback.
  // A distillery's own products don't all share one mash bill (Four Roses
  // alone runs ten different recipe codes across its lineup), so a
  // wrong-but-confident suggestion risks a worse mistake on the printed
  // talker than just showing nothing.
  //
  // One row per field the matched entry actually has - Mash Bill (guarded
  // against isPlaceholderMashBill, so one of the Library's unresearched
  // placeholder entries shows "Not yet researched" instead of offering a
  // fake composition), Nose, Palate, Finish. Each row's own "Use" applies
  // just that field; "Use All" applies everything the entry has at once.
  // Banner is fully rebuilt (innerHTML) on every render, since which rows
  // exist varies per entry - the click listener further down is delegated
  // on the banner container itself so it keeps working across rebuilds.
  function flavorFieldEl(field) {
    return { nose: els.nose, palate: els.palate, finish: els.finish }[field];
  }

  function mashBillRecallMashRowHtml(match) {
    const hasMash = Array.isArray(match.grains) && match.grains.length > 0 && !isPlaceholderMashBill(match);
    if (!hasMash) {
      return `
        <div class="af-row af-row--muted">
          <div class="af-label">Mash Bill</div>
          <div class="af-value af-value--muted">Not yet researched</div>
        </div>`;
    }
    return `
      <div class="af-row">
        <div class="af-label">Mash Bill ${confidenceBadgeHtml(match.confidence.tier)}</div>
        <div class="af-value">${escapeHtml(describeMashBillGrains(match.grains))}</div>
        <button type="button" class="btn btn--small" data-recall-action="use-mash">Use</button>
      </div>`;
  }

  function mashBillRecallFlavorRowHtml(match, field, label) {
    const value = match[field];
    if (!value) {
      return `
        <div class="af-row af-row--muted">
          <div class="af-label">${label}</div>
          <div class="af-value af-value--muted">Not yet researched</div>
        </div>`;
    }
    return `
      <div class="af-row">
        <div class="af-label">${label}</div>
        <div class="af-value">${escapeHtml(value)}</div>
        <button type="button" class="btn btn--small" data-recall-action="use-flavor" data-field="${field}">Use</button>
      </div>`;
  }

  function refreshMashBillRecall() {
    if (els.mashBillField.hidden) { els.mashBillRecallBanner.hidden = true; return; }
    const title = els.title.value.trim();
    if (!title || title === mashBillRecallDismissedFor) { els.mashBillRecallBanner.hidden = true; return; }
    const match = findMashBillMatch(title);
    if (!match) { els.mashBillRecallBanner.hidden = true; return; }

    const hasMash = Array.isArray(match.grains) && match.grains.length > 0 && !isPlaceholderMashBill(match);
    const hasTasting = !!(match.nose || match.palate || match.finish);

    if (!hasMash && !hasTasting) {
      els.mashBillRecallBanner.innerHTML = `
        <div class="mashbill-recall__title">📚 "${escapeHtml(match.title)}" is in the Bourbon Library, but nothing's been researched yet.</div>
        <div class="mashbill-recall__meta">Add what you know from the Bourbon Library in the sidebar.</div>
      `;
      els.mashBillRecallBanner.hidden = false;
      return;
    }

    const rows = [
      mashBillRecallMashRowHtml(match),
      ...FLAVOR_ROWS.map(([label, field]) => mashBillRecallFlavorRowHtml(match, field, label)),
    ].join('');
    const updated = match.updatedAt ? formatHistoryTimestamp(match.updatedAt) : '';
    const metaBits = [`Source: ${escapeHtml(match.source || 'Manual')}`];
    if (updated) metaBits.push(`Updated ${updated}`);
    if (match.tastingSource) metaBits.push(escapeHtml(match.tastingSource));

    els.mashBillRecallBanner.innerHTML = `
      <div class="mashbill-recall__title">📚 Bourbon Library match found for "${escapeHtml(match.title)}"</div>
      <div class="af-rows">${rows}</div>
      <div class="mashbill-recall__meta">${metaBits.join(' &middot; ')}</div>
      <div class="mashbill-recall__actions">
        <button type="button" class="btn btn--small btn--primary" data-recall-action="use-all">Use All</button>
        <button type="button" class="btn btn--small btn--ghost" data-recall-action="dismiss">Not This One</button>
      </div>
    `;
    els.mashBillRecallBanner.hidden = false;
  }

  els.title.addEventListener('input', () => {
    mashBillRecallDismissedFor = '';
    refreshMashBillRecall();
  });

  // One combined confirmation covers every flavor field a click would
  // overwrite - same "Replace the current tasting notes with these?"
  // pattern Find Tasting Notes' own confirm step already uses further down,
  // not a separate popup per field. Mash Bill's own chip list has never
  // asked this before "Use" overwrites it, so it still doesn't here either.
  function applyMashBillRecallFlavorField(match, field) {
    const value = match[field];
    if (!value) return;
    const el = flavorFieldEl(field);
    if (el.value.trim() && el.value.trim() !== value.trim()
        && !confirm(`Replace the current ${field} with the Bourbon Library's?`)) return;
    el.value = value;
    refreshPreview();
  }

  function applyMashBillRecallAll(match) {
    const hasMash = Array.isArray(match.grains) && match.grains.length > 0 && !isPlaceholderMashBill(match);
    const flavorTargets = ['nose', 'palate', 'finish'].filter((f) => match[f]);
    const overwriting = flavorTargets.some((f) => {
      const el = flavorFieldEl(f);
      return el.value.trim() && el.value.trim() !== match[f].trim();
    });
    if (overwriting && !confirm('Replace the current tasting notes with the Bourbon Library\'s?')) return;
    if (hasMash) {
      currentMashBill = match.grains.map((g) => ({ grain: g.grain, pct: String(g.pct) }));
      currentMashBillConfidence = match.confidence.tier;
      renderMashBillList();
    }
    flavorTargets.forEach((f) => { flavorFieldEl(f).value = match[f]; });
    refreshPreview();
  }

  els.mashBillRecallBanner.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-recall-action]');
    if (!btn) return;
    const title = els.title.value.trim();
    const match = findMashBillMatch(title);
    if (!match) return;
    const { recallAction: action, field } = btn.dataset;
    if (action === 'use-mash') {
      // Same {grain, pct} shape addMashBillGrain() itself builds (pct as
      // the string the chip UI already expects) - still fully editable
      // afterward, same as any other chip added by hand.
      currentMashBill = match.grains.map((g) => ({ grain: g.grain, pct: String(g.pct) }));
      currentMashBillConfidence = match.confidence.tier;
      renderMashBillList();
      refreshPreview();
    } else if (action === 'use-flavor') {
      applyMashBillRecallFlavorField(match, field);
    } else if (action === 'use-all') {
      applyMashBillRecallAll(match);
      mashBillRecallDismissedFor = title;
      els.mashBillRecallBanner.hidden = true;
      return;
    } else if (action === 'dismiss') {
      mashBillRecallDismissedFor = title;
      els.mashBillRecallBanner.hidden = true;
      return;
    }
    // A single-row "Use" (mash, or one flavor field) applies just that
    // field and leaves the banner open, in case staff wants another row
    // too - only "Use All"/"Not This One" above actually dismiss the whole
    // match. Re-renders regardless (harmless - same match, same HTML) to
    // match the mutate-then-re-render pattern the rest of this file uses.
    refreshMashBillRecall();
  });

  els.mashBillSaveCheckbox.addEventListener('change', () => {
    els.mashBillSaveRow.hidden = !els.mashBillSaveCheckbox.checked;
  });

  // Upserts by title (see server/db.js's upsertMashBill) - safe to click
  // again after fixing a typo in the chips, updates the same entry in
  // place rather than erroring or creating a duplicate.
  els.mashBillSaveBtn.addEventListener('click', async () => {
    const title = els.title.value.trim();
    if (!title) {
      els.mashBillSaveStatus.textContent = 'Enter a Product Title first.';
      return;
    }
    if (!currentMashBill.length) {
      els.mashBillSaveStatus.textContent = 'Add at least one grain first.';
      return;
    }
    els.mashBillSaveBtn.disabled = true;
    els.mashBillSaveStatus.textContent = 'Saving...';
    try {
      const resp = await fetch('/api/mashbills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          distillery: els.mashBillSaveDistillery.value.trim(),
          grains: currentMashBill.map((m) => ({ grain: m.grain, pct: Number(m.pct) })),
          source: 'Manual',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not save to the Mash Bill Library.');
      await fetchMashBillLibrary();
      // It's now exactly what's saved - no reason to also suggest itself
      // back as a "found" recall for the rest of this editing session.
      mashBillRecallDismissedFor = title;
      els.mashBillSaveStatus.textContent = `Saved "${title}" to the Mash Bill Library.`;
    } catch (err) {
      els.mashBillSaveStatus.textContent = withServerPcHint(err.message) || 'Could not save to the Mash Bill Library.';
    } finally {
      els.mashBillSaveBtn.disabled = false;
    }
  });

  els.tastingNotesSaveCheckbox.addEventListener('change', () => {
    els.tastingNotesSaveRow.hidden = !els.tastingNotesSaveCheckbox.checked;
  });

  // Closes the loop the other direction from the Mash Bill save button
  // above: saves Nose/Palate/Finish onto the same title's Bourbon Library
  // entry. Two different endpoints depending on whether that entry already
  // exists, because they have different requirements around grains:
  //  - updateMashBillById (PUT by id, server/db.js) falls back to whatever
  //    grains are already on the row when grains is omitted from the
  //    request, so an existing entry can be updated with just tasting
  //    notes - its mash bill (real, placeholder, or absent) is left alone.
  //  - upsertMashBill (POST, title-keyed) has no such fallback - it always
  //    validates grains on every write, even one only meant to touch
  //    tasting notes - so creating a brand-new entry this way needs the
  //    Mash Bill chip list above to have at least one grain in it already.
  els.tastingNotesSaveBtn.addEventListener('click', async () => {
    const title = els.title.value.trim();
    if (!title) {
      els.tastingNotesSaveStatus.textContent = 'Enter a Product Title first.';
      return;
    }
    const nose = els.nose.value.trim();
    const palate = els.palate.value.trim();
    const finish = els.finish.value.trim();
    if (!nose && !palate && !finish) {
      els.tastingNotesSaveStatus.textContent = 'Add a Nose, Palate, or Finish note first.';
      return;
    }
    const existing = findMashBillMatch(title);
    if (!existing && !currentMashBill.length) {
      els.tastingNotesSaveStatus.textContent = `"${title}" isn't in the Bourbon Library yet - add at least one Mash Bill grain first, or this can't be saved on its own.`;
      return;
    }
    els.tastingNotesSaveBtn.disabled = true;
    els.tastingNotesSaveStatus.textContent = 'Saving...';
    try {
      const resp = existing
        ? await fetch(`/api/mashbills/${existing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nose, palate, finish }),
        })
        : await fetch('/api/mashbills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            grains: currentMashBill.map((m) => ({ grain: m.grain, pct: Number(m.pct) })),
            nose,
            palate,
            finish,
            source: 'Manual',
          }),
        });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not save to the Bourbon Library.');
      await fetchMashBillLibrary();
      // Same reasoning as the Mash Bill save button above - it's now
      // exactly what's saved, no reason to also suggest itself back.
      mashBillRecallDismissedFor = title;
      els.tastingNotesSaveStatus.textContent = `Saved "${title}"'s tasting notes to the Bourbon Library.`;
    } catch (err) {
      els.tastingNotesSaveStatus.textContent = withServerPcHint(err.message) || 'Could not save to the Bourbon Library.';
    } finally {
      els.tastingNotesSaveBtn.disabled = false;
    }
  });

  els.manageReviewersToggle.addEventListener('click', () => {
    els.reviewerManager.hidden = !els.reviewerManager.hidden;
    els.manageReviewersToggle.setAttribute('aria-expanded', String(!els.reviewerManager.hidden));
    if (!els.reviewerManager.hidden) renderReviewerManagerList();
  });

  els.addReviewerBtn.addEventListener('click', () => {
    const name = els.newReviewerName.value.trim();
    if (!name) return;
    if (!reviewers.includes(name)) {
      reviewers.push(name);
      saveReviewers();
      renderReviewerSelect();
      renderReviewerManagerList();
    }
    els.newReviewerName.value = '';
  });

  els.reviewerManagerList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove-reviewer"]');
    if (!btn) return;
    const idx = Number(btn.closest('[data-reviewer-index]').dataset.reviewerIndex);
    reviewers.splice(idx, 1);
    saveReviewers();
    renderReviewerSelect();
    renderReviewerManagerList();
  });

  // ---------- Food Pairing Suggestions (Settings -> Experimental Features
  // -> Wine Food Pairings) ----------
  //
  // WINE_PAIRING_RULES/detectWinePairings are plain globals defined in
  // card.js (same convention as buildCardElement/fitCardText, which this
  // file already calls directly - card.js's <script> tag loads before this
  // one's, see index.html), so no import/require is needed here.
  //
  // detectWinePairings folds in optional second-tier matches (country/
  // region and, for Riesling, Germany's own sweetness classification) -
  // see the WINE_PAIRING_RULES comment block in card.js. Nothing below
  // this comment needs to know that: a tier match just shows up as a
  // longer rule.label ("Malbec — Mendoza, Argentina", "Riesling — Mosel,
  // Germany, Kabinett") and already-swapped candidates in rule.pairings.

  // Renders the currently-selected pairings (currentPairings) as removable
  // chips - same markup/behavior as renderRatingsList above, just a
  // different backing array and a 3-item cap enforced in addPairing below.
  function renderPairingsList() {
    if (currentPairings.length === 0) {
      els.pairingsList.innerHTML = '';
      return;
    }
    els.pairingsList.innerHTML = currentPairings.map((p, i) => `
      <div class="rating-chip" data-pairing-index="${i}">
        <span>${escapeHtml(p.icon || '')} ${escapeHtml(p.food)}</span>
        <button type="button" data-action="remove-pairing" title="Remove">&times;</button>
      </div>
    `).join('');
  }

  // The clickable "+ icon food" row offered after Suggest Pairings runs -
  // cleared (rule === null) whenever there's nothing to suggest right now
  // (no title typed yet, no varietal matched, or the form was just reset/
  // loaded with a different talker - see fillForm/resetForm above).
  function renderPairingSuggestions(rule) {
    if (!rule) {
      els.pairingsSuggestions.innerHTML = '';
      return;
    }
    els.pairingsSuggestions.innerHTML = rule.pairings.map((p) => `
      <button type="button" class="pairing-suggestion-chip" data-icon="${escapeHtml(p.icon)}" data-food="${escapeHtml(p.food)}">
        + ${escapeHtml(p.icon)} ${escapeHtml(p.food)}
      </button>
    `).join('');
  }

  // Shared by a suggestion click and the custom-pairing Add button below.
  // Silently no-ops on a duplicate; returns false (without an error) once
  // the 3-item cap (what a Full Size talker's width comfortably fits - see
  // buildPairingsHtml in card.js) is hit, so callers can decide how loudly
  // to say so.
  function addPairing(pairing) {
    if (currentPairings.length >= 3) return false;
    if (currentPairings.some((p) => p.food.toLowerCase() === pairing.food.toLowerCase())) return false;
    currentPairings.push(pairing);
    renderPairingsList();
    refreshPreview();
    return true;
  }

  function suggestPairings() {
    const haystack = `${els.title.value} ${els.description.value}`;
    const rule = detectWinePairings(haystack);
    renderPairingSuggestions(rule);
    if (rule) {
      els.pairingsSuggestStatus.textContent = `Detected ${rule.label} - click a suggestion below to add it (up to 3).`;
    } else if (els.title.value.trim()) {
      els.pairingsSuggestStatus.textContent = 'No matching varietal found in the title/description - add pairings manually below.';
    } else {
      els.pairingsSuggestStatus.textContent = 'Type a Product Title, then click Suggest Pairings.';
    }
  }
  els.suggestPairingsBtn.addEventListener('click', suggestPairings);

  els.pairingsSuggestions.addEventListener('click', (e) => {
    const btn = e.target.closest('.pairing-suggestion-chip');
    if (!btn) return;
    const added = addPairing({ icon: btn.dataset.icon, food: btn.dataset.food });
    if (!added && currentPairings.length >= 3) {
      els.pairingsSuggestStatus.textContent = 'Up to 3 pairings print on a talker - remove one below to add another.';
    }
  });

  function addCustomPairing() {
    const food = els.pairingCustomInput.value.trim();
    if (!food) return;
    const added = addPairing({ icon: '🍽️', food });
    if (added) {
      els.pairingCustomInput.value = '';
    } else if (currentPairings.length >= 3) {
      els.pairingsSuggestStatus.textContent = 'Up to 3 pairings print on a talker - remove one below to add another.';
    }
  }
  els.addPairingBtn.addEventListener('click', addCustomPairing);
  els.pairingCustomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addCustomPairing(); }
  });

  els.pairingsList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove-pairing"]');
    if (!btn) return;
    const idx = Number(btn.closest('[data-pairing-index]').dataset.pairingIndex);
    currentPairings.splice(idx, 1);
    renderPairingsList();
    refreshPreview();
  });

  // ---------- Wine Profile (Settings -> Experimental Features -> Wine
  // Profile) ----------
  //
  // WINE_PROFILE_CATEGORIES/suggestWineProfile are plain globals defined in
  // card.js (same convention as WINE_PAIRING_RULES/detectWinePairings right
  // above, which this file already calls directly) - card.js's <script>
  // tag loads before this one's, see index.html.

  // Builds all 5 rows fresh from WINE_PROFILE_CATEGORIES every time
  // currentProfile changes, rather than patching individual dots in place -
  // simpler, and cheap enough at 5 rows x 5 dots. Delegated click handling
  // below (one listener on the container, not one per dot) is what keeps a
  // full re-render from needing to re-wire anything.
  function renderProfilePicker() {
    els.profilePicker.innerHTML = WINE_PROFILE_CATEGORIES.map((cat) => {
      const val = currentProfile[cat.id] || 0;
      const dotsHtml = Array.from({ length: 5 }, (_, i) => {
        const n = i + 1;
        return `<button type="button" class="wine-profile-dot ${n <= val ? 'is-on' : ''}" data-cat="${cat.id}" data-val="${n}" aria-label="${escapeHtml(cat.name)} ${n} of 5"></button>`;
      }).join('');
      return `
        <div class="wine-profile-row">
          <div class="wine-profile-row__name">${escapeHtml(cat.name)}</div>
          <div class="wine-profile-row__dots">${dotsHtml}</div>
          <div class="wine-profile-row__scale"><span>${escapeHtml(cat.low)}</span><span>${escapeHtml(cat.high)}</span></div>
        </div>
      `;
    }).join('');
  }

  els.profilePicker.addEventListener('click', (e) => {
    const btn = e.target.closest('.wine-profile-dot');
    if (!btn) return;
    const cat = btn.dataset.cat;
    const val = Number(btn.dataset.val);
    // Clicking the dot that's already the top of the current rating clears
    // that category back to 0 (unrated) instead of just re-confirming the
    // same value - the only way to get back to "not rated" once a category
    // has been set, short of re-suggesting or resetting the whole form.
    currentProfile[cat] = currentProfile[cat] === val ? 0 : val;
    renderProfilePicker();
    refreshPreview();
  });

  function suggestProfile() {
    const rule = suggestWineProfile(els.title.value);
    if (rule) {
      currentProfile = { ...rule.profile };
      renderProfilePicker();
      refreshPreview();
      els.profileSuggestStatus.textContent = `Detected ${rule.label} - adjust any dot below, or click Suggest Profile again after changing the title.`;
    } else if (els.title.value.trim()) {
      els.profileSuggestStatus.textContent = 'No matching varietal found in the title - set the dots manually below.';
    } else {
      els.profileSuggestStatus.textContent = 'Type a Product Title, then click Suggest Profile.';
    }
  }
  els.suggestProfileBtn.addEventListener('click', suggestProfile);

  // ---------- Preview ----------

  // Wraps an element that has been laid out at true print size so it can be
  // shrunk to fit on screen. The transform is purely visual - the element
  // keeps its printed dimensions for layout, line breaking and fitCardText -
  // which is what makes a preview an exact copy of the printed page rather
  // than a separate rendering at a different size that merely looks similar.
  function makeScaler(inner) {
    const scaler = document.createElement('div');
    scaler.className = 'preview-scaler';
    scaler.appendChild(inner);
    return scaler;
  }

  // Sizing a scaler is deliberately separate from building its contents:
  // rescaling on a window resize is just a new multiplier, with no re-layout
  // and no re-fitting, so the preview can never drift from the print output
  // just because the window changed size.
  function scalePreview(scaler, availableWidth, availableHeight) {
    const inner = scaler.firstElementChild;
    if (!inner) return;
    inner.style.transform = 'none';
    const naturalWidth = inner.offsetWidth;
    const naturalHeight = inner.offsetHeight;
    if (!naturalWidth || !naturalHeight || !availableWidth) return;
    // Deliberately allowed to magnify past 1, not just shrink: a 2.8in card
    // is small on a 1440px screen, and scaling a print-size layout up is
    // just as faithful as scaling it down - the line breaks and fitted font
    // sizes are the printed ones either way, only the viewing size changes.
    const scale = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight);
    inner.style.transform = `scale(${scale})`;
    scaler.style.width = `${naturalWidth * scale}px`;
    scaler.style.height = `${naturalHeight * scale}px`;
  }

  // Height the preview stage can use before running off the bottom of the
  // window. In the stacked layout the stage can be scrolled well out of
  // view, where its viewport-relative top is not a meaningful budget - fall
  // back to the full window there.
  function previewAvailableHeight() {
    const stageTop = els.previewStage.getBoundingClientRect().top;
    const headroom = stageTop > 0 && stageTop < window.innerHeight ? stageTop : 0;
    return Math.max(240, window.innerHeight - headroom - 40);
  }

  // Scales every sheet inside a vertical stack of full printed sheets to
  // fit the container's width - height is deliberately left generous
  // (the container itself scrolls, see .preview-stage--sheets) rather than
  // being divided up between sheets.
  function rescaleStackedSheets(container) {
    const width = container.clientWidth
      - parseFloat(getComputedStyle(container).paddingLeft || 0)
      - parseFloat(getComputedStyle(container).paddingRight || 0);
    container.querySelectorAll('.preview-scaler').forEach((scaler) => {
      scalePreview(scaler, width, window.innerHeight);
    });
  }

  function rescalePreviewStage() {
    if (previewMode === 'sheet') {
      rescaleStackedSheets(els.previewStage);
      return;
    }
    const scaler = els.previewStage.querySelector('.preview-scaler');
    if (scaler) scalePreview(scaler, els.previewStage.clientWidth, previewAvailableHeight());
  }

  function renderPreview() {
    els.previewStage.classList.remove('preview-stage--sheets');
    const talker = readForm();
    els.previewStage.innerHTML = '';
    const card = buildPrintableElement(talker);
    // Lay the card out at the exact width it will be printed at, so the text
    // fitting below produces the same result the printer will get.
    card.style.setProperty('--w', printWidthCss(layoutKeyFor(talker)));
    const scaler = makeScaler(card);
    els.previewStage.appendChild(scaler);
    requestAnimationFrame(() => {
      fitCardText(card);
      rescalePreviewStage();
    });
  }

  // A scaled-down stand-in for every sheet the current queue will print,
  // stacked top to bottom - this *is* the print preview now (see
  // setPreviewMode below, which is how the app bar's Print button gets
  // here), so it branches on autoArrangeEnabled exactly like the actual
  // print DOM does (see buildPrintDom) rather than only ever showing the
  // grouped layout. Both branches share buildSheetPreviewElement /
  // buildAutoSheetPreviewElement with buildPrintDom so this can't drift
  // from what "Print Now" produces.
  function renderSheetPreview() {
    els.previewStage.classList.add('preview-stage--sheets');
    els.previewStage.innerHTML = '';

    if (queue.length === 0) {
      els.previewStage.innerHTML = '<p class="empty-hint">No shelf talkers queued yet. Add one using the form to see the full page here.</p>';
      els.previewSheetSummary.textContent = '';
      return;
    }

    if (autoArrangeEnabled) renderAutoArrangeSheetPreview();
    else renderGroupedSheetPreview();
  }

  // Default (non-Auto-arrange) mode: one sheet per uniform layout - Shelf
  // Talkers, Half/Quarter Size, and Large/Small Display Signs never share a
  // sheet (see buildSheets).
  function renderGroupedSheetPreview() {
    const sheets = buildSheets(queue);
    const partialCount = sheets.filter((s) => s.items.length < SIGN_LAYOUTS[s.layoutKey].perSheet).length;

    els.previewSheetSummary.textContent = `${sheets.length} sheet${sheets.length === 1 ? '' : 's'} will print.`
      + (partialCount ? ` ${partialCount} of them ${partialCount === 1 ? 'is' : 'are'} only partially filled - add more items first to use less paper, try Auto-arrange above, or print as-is.` : '');

    const sheetGrids = sheets.map((sheet, i) => {
      const layout = SIGN_LAYOUTS[sheet.layoutKey];
      const isPartial = sheet.items.length < layout.perSheet;

      const wrap = document.createElement('div');
      wrap.className = 'print-preview-sheet';
      wrap.innerHTML = `
        <div class="print-preview-sheet__label">
          <span>Sheet ${i + 1} of ${sheets.length} &mdash; ${layout.label}</span>
          <span class="print-preview-sheet__fill ${isPartial ? 'is-partial' : ''}">${sheet.items.length} of ${layout.perSheet} slots used</span>
        </div>
      `;
      const sheetDiv = buildSheetPreviewElement(sheet);
      makeSheetPreviewEditable(sheetDiv, sheet.items);
      sheetDiv.classList.add('print-preview-sheet__grid');
      wrap.appendChild(makeScaler(sheetDiv));
      els.previewStage.appendChild(wrap);
      return sheetDiv;
    });

    requestAnimationFrame(() => {
      sheetGrids.forEach((grid) => grid.querySelectorAll('.card, .sign').forEach((el) => fitCardText(el)));
      rescalePreviewStage();
    });
  }

  // Auto-arrange mode: pages of mixed-size rows that can save paper
  // by stacking different sign types on shared sheets (see
  // buildAutoArrangedPages).
  function renderAutoArrangeSheetPreview() {
    const groupedSheets = buildSheets(queue);
    const pages = buildAutoArrangedPages(queue);
    const savedSheets = groupedSheets.length - pages.length;

    els.previewSheetSummary.textContent = `${pages.length} sheet${pages.length === 1 ? '' : 's'} will print with Auto-arrange.`
      + (savedSheets > 0
        ? ` That's ${savedSheets} fewer sheet${savedSheets === 1 ? '' : 's'} than printing each type separately.`
        : ' Sign types are stacked onto shared sheets where they fit.');

    const pageGrids = pages.map((page, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'print-preview-sheet';
      wrap.innerHTML = `
        <div class="print-preview-sheet__label">
          <span>Sheet ${i + 1} of ${pages.length} &mdash; Auto-arranged</span>
        </div>
      `;
      const sheetDiv = buildAutoSheetPreviewElement(page);
      makeSheetPreviewEditable(sheetDiv, page.rows.flatMap((row) => row.items));
      sheetDiv.classList.add('print-preview-sheet__grid');
      wrap.appendChild(makeScaler(sheetDiv));
      els.previewStage.appendChild(wrap);
      return sheetDiv;
    });

    requestAnimationFrame(() => {
      pageGrids.forEach((grid) => grid.querySelectorAll('.card, .sign').forEach((el) => fitCardText(el)));
      rescalePreviewStage();
    });
  }

  // One 11in x 8.5in sheet, built at its literal printed size with each item
  // at its own printed width. Shared with buildPrintDom so the preview can't
  // drift from the real print DOM.
  function buildSheetPreviewElement(sheet) {
    const layout = SIGN_LAYOUTS[sheet.layoutKey];
    const sheetDiv = document.createElement('div');
    sheetDiv.className = 'sheet-preview';
    sheetDiv.style.setProperty('--cols', layout.cols);
    sheetDiv.style.setProperty('--rows', layout.rows);
    sheet.items.forEach((talker) => {
      const el = buildPrintableElement(talker);
      el.style.setProperty('--w', printWidthCss(sheet.layoutKey));
      sheetDiv.appendChild(el);
    });
    return sheetDiv;
  }

  // Turns a freshly-built sheet's cards/signs into click-to-edit targets, so
  // staff can jump straight into editing whatever they spot on the preview
  // instead of hunting for the matching row in the Queue list below. items
  // must be in the same order sheetDiv's .card/.sign descendants appear in
  // the DOM - true for both buildSheetPreviewElement (cards/signs are direct
  // children) and buildAutoSheetPreviewElement (cards/signs nested one level
  // down inside .sheet-preview__row), since querySelectorAll walks the DOM
  // in document order either way.
  function makeSheetPreviewEditable(sheetDiv, items) {
    const targets = sheetDiv.querySelectorAll('.card, .sign');
    items.forEach((talker, i) => {
      const el = targets[i];
      if (!el) return;
      el.classList.add('is-editable');
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      const label = `Edit ${talker.title || 'this talker'}`;
      el.setAttribute('aria-label', label);
      el.title = label;
      const badge = document.createElement('span');
      badge.className = 'card__edit-badge';
      badge.textContent = '✎ Edit';
      badge.setAttribute('aria-hidden', 'true');
      el.appendChild(badge);
      el.addEventListener('click', () => startEdit(talker.id));
      el.addEventListener('keydown', (e) => {
        if (e.target !== el) return; // ignore bubbling from the delete/confirm buttons below
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        startEdit(talker.id);
      });

      const deleteLabel = `Delete ${talker.title || 'this talker'}`;
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'card__delete-badge';
      deleteBtn.setAttribute('aria-label', deleteLabel);
      deleteBtn.title = deleteLabel;
      deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18"/></svg>';

      const confirm = document.createElement('div');
      confirm.className = 'card__delete-confirm';
      const confirmText = document.createElement('p');
      confirmText.textContent = `Delete "${talker.title || 'this talker'}"?`;
      const confirmRow = document.createElement('div');
      confirmRow.className = 'card__delete-confirm-row';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'card__delete-confirm-cancel';
      cancelBtn.textContent = 'Cancel';
      const confirmDeleteBtn = document.createElement('button');
      confirmDeleteBtn.type = 'button';
      confirmDeleteBtn.className = 'card__delete-confirm-delete';
      confirmDeleteBtn.textContent = 'Delete';
      confirmRow.append(cancelBtn, confirmDeleteBtn);
      confirm.append(confirmText, confirmRow);

      // Every click target here stops propagation so it never bubbles up to
      // el's own click-to-edit listener above.
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirm.classList.add('is-open');
        el.classList.add('is-confirming-delete');
      });
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirm.classList.remove('is-open');
        el.classList.remove('is-confirming-delete');
      });
      confirmDeleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTalker(talker.id);
      });
      confirm.addEventListener('click', (e) => e.stopPropagation());

      el.append(deleteBtn, confirm);
    });
  }

  // The auto-arrange equivalent: a vertical stack of rows that can each mix
  // item types/sizes, so --w is set per item rather than per sheet.
  function buildAutoSheetPreviewElement(page) {
    const sheetDiv = document.createElement('div');
    sheetDiv.className = 'sheet-preview sheet-preview--auto';
    page.rows.forEach((row) => {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'sheet-preview__row';
      row.items.forEach((talker) => {
        const el = buildPrintableElement(talker);
        el.style.setProperty('--w', printWidthCss(layoutKeyFor(talker)));
        rowDiv.appendChild(el);
      });
      sheetDiv.appendChild(rowDiv);
    });
    return sheetDiv;
  }

  function refreshPreview() {
    if (previewMode === 'sheet') renderSheetPreview();
    else renderPreview();
  }

  // Resizing the window (or changing Windows display scaling) only changes
  // how far the preview is scaled down - never how it is laid out - so this
  // is a cheap recompute rather than a re-render. Without it the transform
  // kept a multiplier calculated for the old window size.
  let resizeDebounce;
  window.addEventListener('resize', () => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      rescalePreviewStage();
      rescaleGuidePreview();
    }, 100);
  });

  let previewDebounce;
  function schedulePreview() {
    if (previewMode !== 'single') return;
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(renderPreview, 120);
  }

  els.form.addEventListener('input', schedulePreview);
  els.theme.addEventListener('change', () => { if (previewMode === 'single') renderPreview(); });

  // Switches Live Preview between Current Talker and Full Page, keeping the
  // toggle buttons, the Full Page-only controls (Auto-arrange toggle + sheet
  // summary), and the app bar's Print button all in sync with it. Full Page
  // is also the print preview (see renderSheetPreview) - see printBtn's own
  // click handler below, which uses this to jump here before printing.
  function setPreviewMode(mode) {
    previewMode = mode;
    setToggleState(els.previewToggleBtns, (b) => b.dataset.preview === mode);
    els.previewSheetControls.hidden = mode !== 'sheet';
    els.printBtn.textContent = mode === 'sheet' ? 'Print Now' : 'Print Sheet(s)…';
    refreshPreview();
  }

  els.previewToggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.preview === previewMode) return;
      setPreviewMode(btn.dataset.preview);
    });
  });

  // ---------- Queue rendering ----------

  function renderQueue() {
    closeQueueMenu();
    els.queueCount.textContent = String(queue.length);
    els.printBtn.disabled = queue.length === 0;
    els.saveQueueBtn.disabled = queue.length === 0;

    if (queue.length === 0) {
      els.queueGrid.innerHTML = '<p class="empty-hint">No shelf talkers yet. Add one using the form to get started.</p>';
      return;
    }

    els.queueGrid.innerHTML = '';
    queue.forEach((talker) => {
      const item = document.createElement('div');
      const isExpanded = expandedQueueItemIds.has(talker.id);
      item.className = `queue-item${isExpanded ? ' is-expanded' : ''}`;
      // Lets Find Queue (see jumpToQueueItem below) locate this row again by
      // id after a re-render, to scroll to and flash it.
      item.dataset.id = talker.id;
      const priceLabel = talker.salePrice && Number(talker.salePrice) > 0
        ? `${formatMoney(talker.salePrice)} (was ${formatMoney(talker.price)})`
        : formatMoney(talker.price);
      // The meta line is the only place staff can catch a talker that was
      // queued with the wrong size or style, so it spells out everything
      // that changes what comes out of the printer - not just "Shelf
      // Talker". Parts are joined rather than concatenated so a missing
      // field (size is optional) can't leave a stray separator behind.
      const typeLabel = talker.signType === 'sign'
        ? (talker.signSize === 'small' ? 'Small Display Sign' : 'Large Display Sign')
        : `${SIZE_LABELS[talker.talkerSize] || 'Full'} Shelf Talker`;
      const metaParts = [typeLabel];
      if (talker.category === 'beer') metaParts.push('Beer');
      // 'chilled' is excluded here (handled by the isChilled line right
      // below instead) so a legacy talker saved before it became its own
      // field doesn't print "Also Available Chilled" twice.
      if (talker.talkerType && talker.talkerType !== 'standard' && talker.talkerType !== 'chilled') {
        metaParts.push(STYLE_LABELS[talker.talkerType] || talker.talkerType);
      }
      if (talker.isChilled || talker.talkerType === 'chilled') metaParts.push('Also Available Chilled');
      if (talker.size) metaParts.push(escapeHtml(talker.size));
      metaParts.push(priceLabel);

      item.innerHTML = `
        <div class="queue-item__swatch" data-theme="${talker.theme}" title="${talker.theme === 'purple' ? 'Purple' : 'Amber'} theme"></div>
        <div class="queue-item__body">
          <button type="button" class="queue-item__title" data-action="toggle-expand" title="Click to ${isExpanded ? 'collapse' : 'show full title'}">
            <span class="queue-item__title-text">${escapeHtml(talker.title || 'Untitled')}</span>
            <span class="queue-item__expand-icon" aria-hidden="true">${isExpanded ? '▾' : '▸'}</span>
          </button>
          <div class="queue-item__meta">${metaParts.join(' &middot; ')}</div>
        </div>
        <div class="queue-item__actions">
          <button type="button" class="queue-item__menu-btn" data-action="toggle-menu" aria-haspopup="true" aria-expanded="false" title="More actions">&#8942;</button>
        </div>
      `;

      item.querySelector('[data-action="toggle-expand"]').addEventListener('click', () => {
        if (isExpanded) expandedQueueItemIds.delete(talker.id);
        else expandedQueueItemIds.add(talker.id);
        renderQueue();
      });
      const menuBtn = item.querySelector('[data-action="toggle-menu"]');
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (queueMenuTalkerId === talker.id) closeQueueMenu();
        else openQueueMenu(talker.id, menuBtn);
      });

      els.queueGrid.appendChild(item);
    });
  }

  // The "more actions" (Edit/Copy/Delete) menu is a single element shared
  // by every queue row (#queueItemMenu in index.html), repositioned via JS
  // to whichever row's kebab button was clicked, rather than one dropdown
  // nested per-row - .queue-grid scrolls (overflow-y: auto), which would
  // clip a per-row absolutely-positioned dropdown the moment that row is
  // close enough to the bottom of the visible list.
  function openQueueMenu(talkerId, buttonEl) {
    queueMenuTalkerId = talkerId;
    const idx = queue.findIndex((t) => t.id === talkerId);
    els.queueItemMenu.querySelector('[data-action="move-up"]').disabled = idx <= 0;
    els.queueItemMenu.querySelector('[data-action="move-down"]').disabled = idx === -1 || idx >= queue.length - 1;
    const rect = buttonEl.getBoundingClientRect();
    els.queueItemMenu.style.top = `${rect.bottom + 4}px`;
    els.queueItemMenu.style.right = `${window.innerWidth - rect.right}px`;
    els.queueItemMenu.hidden = false;
    buttonEl.setAttribute('aria-expanded', 'true');
  }

  function closeQueueMenu() {
    queueMenuTalkerId = null;
    els.queueItemMenu.hidden = true;
    els.queueGrid.querySelectorAll('.queue-item__menu-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }

  els.queueItemMenu.querySelector('[data-action="move-up"]').addEventListener('click', () => {
    const id = queueMenuTalkerId;
    closeQueueMenu();
    moveTalker(id, -1);
  });
  els.queueItemMenu.querySelector('[data-action="move-down"]').addEventListener('click', () => {
    const id = queueMenuTalkerId;
    closeQueueMenu();
    moveTalker(id, 1);
  });
  els.queueItemMenu.querySelector('[data-action="edit"]').addEventListener('click', () => {
    const id = queueMenuTalkerId;
    closeQueueMenu();
    startEdit(id);
  });
  els.queueItemMenu.querySelector('[data-action="duplicate"]').addEventListener('click', () => {
    const id = queueMenuTalkerId;
    closeQueueMenu();
    duplicateTalker(id);
  });
  els.queueItemMenu.querySelector('[data-action="delete"]').addEventListener('click', () => {
    const id = queueMenuTalkerId;
    closeQueueMenu();
    deleteTalker(id);
  });
  document.addEventListener('click', closeQueueMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeQueueMenu();
  });
  els.queueGrid.addEventListener('scroll', closeQueueMenu);

  function startEdit(id) {
    const talker = queue.find((t) => t.id === id);
    if (!talker) return;
    fillForm(talker);
    els.editId.value = id;
    els.saveBtn.textContent = 'Save Changes';
    els.cancelEditBtn.hidden = false;
    document.querySelector('.tab[data-tab="manual"]').click();
    setPreviewMode('single');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Queue order is print order: buildSheets keeps each layout group's
  // existing order when it chunks it into sheets, so moving an item changes
  // which sheet - and where on it - the talker lands.
  function moveTalker(id, delta) {
    const idx = queue.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const target = idx + delta;
    if (target < 0 || target >= queue.length) return;
    [queue[idx], queue[target]] = [queue[target], queue[idx]];
    saveQueue();
    renderQueue();
    refreshPreview();
  }

  function duplicateTalker(id) {
    const talker = queue.find((t) => t.id === id);
    if (!talker) return;
    queue.push({ ...talker, id: makeId() });
    saveQueue();
    renderQueue();
    refreshPreview();
  }

  function deleteTalker(id) {
    queue = queue.filter((t) => t.id !== id);
    expandedQueueItemIds.delete(id);
    saveQueue();
    renderQueue();
    refreshPreview();
  }

  // Uses an in-app modal instead of window.confirm() - see the note on
  // clearQueueConfirmOverlay in index.html for why: the native dialog can
  // leave clicks (including picking a form to fill) unresponsive until the
  // window regains OS focus.
  const clearQueueConfirmModal = createModal({
    overlay: els.clearQueueConfirmOverlay,
    closeBtns: [els.clearQueueConfirmCloseBtn, els.clearQueueConfirmCancelBtn],
  });

  els.clearQueueBtn.addEventListener('click', () => {
    if (queue.length === 0) return;
    clearQueueConfirmModal.open();
  });

  els.clearQueueConfirmAcceptBtn.addEventListener('click', () => {
    clearQueueConfirmModal.close();
    queue = [];
    expandedQueueItemIds.clear();
    saveQueue();
    renderQueue();
    refreshPreview();
  });

  // Shared export shape for the current queue - a manual backup/archive
  // separate from the automatic localStorage persistence (see saveQueue),
  // for moving a queue to another computer or keeping a copy of a batch
  // outside the browser. Used by both the in-page Save Queue button (browser
  // download, below) and the menu bar's own File > Save Queue (see
  // runMenuAction's 'save-queue' case), which uses the native save dialog
  // instead when running in Electron.
  function buildQueueExportPayload() {
    return {
      app: 'Shelf Talker Wizard',
      exportedAt: new Date().toISOString(),
      queue,
    };
  }

  function saveQueueToFile() {
    if (queue.length === 0) return;
    const blob = new Blob([JSON.stringify(buildQueueExportPayload(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shelf-talker-queue-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  els.saveQueueBtn.addEventListener('click', saveQueueToFile);

  // File > Open Queue… (see runMenuAction's 'open-queue' case) asks the main
  // process to show a native "open file" dialog (see electron/main.js);
  // once it's read and parsed the chosen file, it hands the queue back here
  // the same way, regardless of what triggered the request.
  if (window.shelfTalker && window.shelfTalker.onQueueOpened) {
    window.shelfTalker.onQueueOpened((openedQueue) => {
      if (queue.length > 0 && !confirm('Opening a queue file will replace your current queue. Continue?')) {
        return;
      }
      queue = normalizeQueue(openedQueue);
      expandedQueueItemIds.clear();
      saveQueue();
      renderQueue();
      refreshPreview();
    });
  }

  // ---------- Find Queue ----------

  // Tools menu "Find Queue…" (see electron/main.js) - a quick way to locate
  // one talker in a long queue without scrolling the whole panel by hand.
  // Reachable via Tools > Find Queue… in the menu bar (see runMenuAction's
  // 'find-queue' case) in both Electron and a plain browser tab; its
  // Ctrl+F accelerator only fires inside Electron, though - see the menu
  // bar section's note on why accelerators are gated that way.
  //
  // Matches title, description, SKU, and size - broader than History's own
  // search (title/SKU only, see server/db.js), since this runs client-side
  // against whatever's already in the small in-memory queue rather than a
  // LIKE query against the whole printed-talkers table.
  let findQueueMatches = [];
  let findQueueActiveIndex = -1;

  function findQueueMatchesFor(query) {
    const q = query.trim().toLowerCase();
    if (!q) return queue.slice();
    return queue.filter((talker) => [talker.title, talker.description, talker.sku, talker.size]
      .some((field) => field && String(field).toLowerCase().includes(q)));
  }

  // Wraps the first case-insensitive match of `query` in `text` with <mark>,
  // HTML-escaping everything else - same escape-then-wrap approach as the
  // rest of this file's innerHTML building (see renderQueue above). Returns
  // the escaped text untouched (no <mark>) when there's no match, so it's
  // safe to call unconditionally on fields that might not be the hit.
  function highlightMatch(text, query) {
    const safe = escapeHtml(text || '');
    const q = query.trim();
    if (!q) return safe;
    const idx = (text || '').toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return safe;
    const before = escapeHtml(text.slice(0, idx));
    const hit = escapeHtml(text.slice(idx, idx + q.length));
    const after = escapeHtml(text.slice(idx + q.length));
    return `${before}<mark>${hit}</mark>${after}`;
  }

  // Same idea as highlightMatch, but for a field that isn't otherwise shown
  // in the result row (description, SKU) - trims to a short window around
  // the hit with an ellipsis on either truncated side, rather than dumping
  // the whole field in. Returns null when `text` doesn't contain `query`,
  // so callers can tell "no snippet" apart from "matched at position 0".
  function snippetHit(text, query, radius = 30) {
    const str = text || '';
    const q = query.trim();
    const idx = str.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return null;
    const start = Math.max(0, idx - radius);
    const end = Math.min(str.length, idx + q.length + radius);
    const before = (start > 0 ? '&hellip;' : '') + escapeHtml(str.slice(start, idx));
    const hit = escapeHtml(str.slice(idx, idx + q.length));
    const after = escapeHtml(str.slice(idx + q.length, end)) + (end < str.length ? '&hellip;' : '');
    return `${before}<mark>${hit}</mark>${after}`;
  }

  function renderFindQueueResults(query) {
    findQueueMatches = findQueueMatchesFor(query);
    findQueueActiveIndex = findQueueMatches.length ? 0 : -1;
    const q = query.trim();
    els.findQueueCount.textContent = q ? `${findQueueMatches.length} of ${queue.length}` : '';

    if (!findQueueMatches.length) {
      els.findQueueResults.innerHTML = q
        ? `<p class="find-modal__empty">No matches for &ldquo;${escapeHtml(q)}&rdquo;.</p>`
        : '<p class="find-modal__empty">No shelf talkers in the queue yet.</p>';
      els.findQueueInput.removeAttribute('aria-activedescendant');
      return;
    }

    els.findQueueResults.innerHTML = findQueueMatches.map((talker, i) => {
      const priceLabel = talker.salePrice && Number(talker.salePrice) > 0
        ? `${formatMoney(talker.salePrice)} (was ${formatMoney(talker.price)})`
        : formatMoney(talker.price);
      const metaParts = [];
      if (talker.size) metaParts.push(highlightMatch(talker.size, q));
      metaParts.push(escapeHtml(priceLabel));

      // Title and size are always visible, so highlighting a hit in either
      // is enough to show why a result matched. Description and SKU aren't
      // otherwise shown at all - without this, a result matching only on
      // (say) a beer's description would show up with nothing visibly
      // matching anywhere in the row. Checked in this order since it's the
      // order fields are shown top-to-bottom.
      const visibleHasHit = q && [talker.title, talker.size]
        .some((f) => f && f.toLowerCase().includes(q.toLowerCase()));
      let hitLine = '';
      if (q && !visibleHasHit) {
        const descHit = snippetHit(talker.description, q);
        const skuHit = talker.sku && talker.sku.toLowerCase().includes(q.toLowerCase())
          ? `SKU ${highlightMatch(talker.sku, q)}`
          : null;
        const shown = descHit || skuHit;
        if (shown) hitLine = `<div class="find-modal__result-hit">${shown}</div>`;
      }

      return `
        <div
          class="find-modal__result${i === findQueueActiveIndex ? ' is-active' : ''}"
          id="findQueueResult-${i}"
          role="option"
          aria-selected="${i === findQueueActiveIndex}"
          data-id="${talker.id}"
        >
          <div class="queue-item__swatch" data-theme="${talker.theme}"></div>
          <div class="find-modal__result-body">
            <div class="find-modal__result-title">${highlightMatch(talker.title || 'Untitled', q)}</div>
            <div class="find-modal__result-meta">${metaParts.join(' &middot; ')}</div>
            ${hitLine}
          </div>
        </div>
      `;
    }).join('');

    updateFindQueueActiveDescendant();
    els.findQueueResults.querySelectorAll('.find-modal__result').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        findQueueActiveIndex = findQueueMatches.findIndex((t) => t.id === el.dataset.id);
        renderFindQueueActiveState();
      });
      el.addEventListener('click', () => jumpToQueueItem(el.dataset.id));
    });
  }

  function renderFindQueueActiveState() {
    els.findQueueResults.querySelectorAll('.find-modal__result').forEach((el, i) => {
      const isActive = i === findQueueActiveIndex;
      el.classList.toggle('is-active', isActive);
      el.setAttribute('aria-selected', String(isActive));
    });
    updateFindQueueActiveDescendant();
  }

  function updateFindQueueActiveDescendant() {
    if (findQueueActiveIndex === -1) {
      els.findQueueInput.removeAttribute('aria-activedescendant');
    } else {
      els.findQueueInput.setAttribute('aria-activedescendant', `findQueueResult-${findQueueActiveIndex}`);
      els.findQueueResults.querySelector(`#findQueueResult-${findQueueActiveIndex}`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }

  function moveFindQueueActive(delta) {
    if (!findQueueMatches.length) return;
    findQueueActiveIndex = (findQueueActiveIndex + delta + findQueueMatches.length) % findQueueMatches.length;
    renderFindQueueActiveState();
  }

  // Closes the modal, scrolls the matching row into view in the real Queue
  // panel, and flashes it - same "which one did it mean" feedback as the
  // Find Queue mockup this was built from.
  function jumpToQueueItem(id) {
    findQueueModal.close();
    const row = els.queueGrid.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('is-find-target', 'is-find-flash');
    setTimeout(() => row.classList.remove('is-find-target', 'is-find-flash'), 1200);
  }

  const findQueueModal = createModal({
    overlay: els.findQueueOverlay,
    closeBtns: [els.findQueueCloseBtn],
    onOpen: () => {
      els.findQueueInput.value = '';
      renderFindQueueResults('');
    },
    onClose: () => { els.findQueueResults.innerHTML = ''; },
  });

  els.findQueueInput.addEventListener('input', () => renderFindQueueResults(els.findQueueInput.value));
  els.findQueueInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFindQueueActive(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFindQueueActive(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (findQueueActiveIndex !== -1) jumpToQueueItem(findQueueMatches[findQueueActiveIndex].id);
    }
  });

  els.cancelEditBtn.addEventListener('click', resetForm);
  els.clearFormBtn.addEventListener('click', resetForm);

  // ---------- Add / Save ----------

  function validate(talker) {
    if (!talker.title) return 'Please enter a product title.';
    if (!talker.size) return 'Please enter a size/unit.';
    if (!talker.price || Number.isNaN(Number(talker.price))) return 'Please enter a valid regular price.';
    if (talker.salePrice && Number.isNaN(Number(talker.salePrice))) return 'Sale price must be a number.';
    if (talker.casePrice && Number.isNaN(Number(talker.casePrice))) return 'Case price must be a number.';
    return null;
  }

  // ---------- Beer Bible auto-save ----------
  //
  // Closes the loop the Bourbon Library's own manual "Save this mash bill/
  // Nose-Palate-Finish to the library" checkboxes leave for Beer: no
  // checkbox to remember, no button to click - every Beer talker added to
  // the queue (or an existing one re-saved) is upserted into the Beer
  // Bible automatically, keyed by title, the instant staff finish filling
  // it in. Hooked into the form's own submit handler below (the single
  // path every "Add to Queue" entry point - Manual Entry, SKU Lookup, Scan
  // UPC, Search by Name, Import - already funnels through via
  // requestSubmit(), see those handlers' own comments), so nothing else
  // needs to call this directly.
  //
  // Fire-and-forget and best-effort, same "never blocks the actual task"
  // spirit as Print History's own silent write on Print Now
  // (recordPrintedTalkers in server/db.js) - a failure here (network
  // hiccup, server not reachable) is logged to the console only, never
  // surfaced to staff or allowed to interrupt Add to Queue/Save Changes.
  // Deliberately as silent on success as Print History is, too - see this
  // section's own note in README.md.
  //
  // Only fields the talker actually has are sent (see beerAutoSaveFields
  // below) - upsertBeer's own "omitted (undefined) leaves whatever's
  // already there alone" rule (server/db.js) means a talker with, say,
  // just a title and ABV filled in can't accidentally blank out a
  // brewery/style/rating a fuller entry already has on file.
  function beerAutoSaveFields(talker) {
    const fields = {};
    ['brewery', 'location', 'style', 'abv', 'ibu', 'untappdRating', 'untappdRatingCount', 'description', 'sku'].forEach((key) => {
      if (talker[key]) fields[key] = talker[key];
    });
    return fields;
  }

  function autoSaveBeerToBible(talker) {
    fetch('/api/beers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: talker.title, source: 'Shelf Talker', ...beerAutoSaveFields(talker) }),
    }).catch((err) => {
      console.warn('Beer Bible auto-save failed:', err.message);
    });
  }

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const talker = readForm();
    const err = validate(talker);
    if (err) {
      showError(err);
      return;
    }
    hideError();

    const editingId = els.editId.value;
    if (editingId) {
      const idx = queue.findIndex((t) => t.id === editingId);
      if (idx !== -1) queue[idx] = { ...talker, id: editingId };
    } else {
      queue.push({ ...talker, id: makeId() });
    }
    saveQueue();
    renderQueue();
    resetForm();
    if (talker.category === 'beer' && talker.title) autoSaveBeerToBible(talker);
  });

  // SKU Lookup's own "Add to Queue" - saves whatever the lookup (or its
  // fallbacks) just filled into the shared form fields without making
  // staff switch to Manual Entry first, unlike Import (which always
  // switches there - see applyImportedProduct) since SKU Lookup is meant
  // to support rapid repeat lookups in place (see applySkuLookupProduct's
  // own note on staying put). Reuses the form's real submit handler via
  // requestSubmit() - same validate/save/resetForm path as clicking "Add
  // to Queue" on Manual Entry, not a second copy of that logic. Pulled into
  // its own function, rather than living only in skuSaveBtn's click handler
  // below, so a beer picked from the "Pick the Right Beer" dialog (see
  // els.skuLookupBtn/els.skuHtmlBtn below) can trigger it automatically,
  // same as Scan UPC's addScannedUpcToQueue. `message` (optional) is the
  // auto-add path's own success text; the manual button below has no pick
  // of its own to describe, so it falls back to the plain default. Returns
  // whether the add actually went through, same as addScannedUpcToQueue.
  function addSkuLookupToQueue(message) {
    els.form.requestSubmit();
    if (!els.formError.hidden) {
      // The form's own error banner lives on the Manual Entry tab-panel,
      // not visible from here - mirror it into this tab's own status line
      // instead of switching tabs away from the SKU workflow.
      els.skuStatus.textContent = els.formError.textContent;
      return false;
    }
    // Saved successfully - resetForm() already cleared the shared fields
    // (title/size/price/etc.), but the SKU-specific bits above live
    // outside <form> and need their own reset so the tab is ready for the
    // next SKU instead of still showing the one that was just added.
    els.skuInput.value = '';
    els.skuStatus.textContent = message || 'Added to queue! Enter another SKU to look up the next one.';
    els.skuUntappdSection.hidden = true;
    return true;
  }

  els.skuSaveBtn.addEventListener('click', () => addSkuLookupToQueue());

  // ---------- Scan UPC ----------

  // Looks products up by the manufacturer UPC printed on the bottle - a
  // different number from the store's own SKU that SKU Lookup above
  // searches liquoroutletwinecellars.com for (see the note in
  // server/upcCatalog.js). This never makes a network request: the server
  // reads a product file WinePOS exports locally on this PC, configured via
  // the desktop app's Advanced -> Export File Settings... menu (see that
  // section further down) rather than anything on this tab itself.

  wireEnterTriggersClick(els.scanUpcInput, els.scanUpcLookupBtn);
  wireUntappdSearch(els.scanUpcUntappdSearchInput, els.scanUpcUntappdSearchBtn);

  // Fills the same fields applySkuLookupProduct does. Wine/Spirits gets
  // whatever columns the export file happened to have (see upcCatalog.js's
  // FIELD_ALIASES) plus a store-sourced description (see
  // enrichWineDescriptionFromStore in productImport.js). Beer now goes
  // through the same two-source pipeline SKU Lookup's own beer path uses -
  // see enrichBeerScanFromStore in productImport.js - so `data` already
  // carries current store pricing and Untappd's brewery/location/style/
  // ABV/IBU/rating by the time it gets here, the same shape
  // applySkuLookupProduct's own beer branch fills in from.
  function applyUpcScanProduct(data, isBeer) {
    const fields = {
      // See applyNameSearchProduct's comment on the same line - falling back
      // to currentCategory (not a flat 'wine') keeps Bourbon from reverting
      // to Wine/Spirits on every scan.
      category: isBeer ? 'beer' : currentCategory,
      title: data.title,
      description: data.description,
      size: data.size,
      price: data.price,
      salePrice: data.salePrice,
      theme: els.theme.value,
    };
    if (isBeer) {
      Object.assign(fields, {
        sku: data.sku || els.scanUpcInput.value.trim(),
        brewery: data.brewery,
        location: data.location,
        style: data.style,
        abv: data.abv,
        ibu: data.ibu,
        untappdRating: data.untappdRating,
        untappdRatingCount: data.untappdRatingCount,
      });
    } else {
      fields.vintage = data.vintage;
    }
    fillForm(fields);
    // Whichever preview mode staff already had selected (Current Talker or
    // Full Page) stays selected - a scan-and-add workflow with Full Page up
    // to watch the sheet fill in used to get yanked back to Current Talker
    // on every single scan, which is exactly the opposite of what that view
    // is for. refreshPreview() re-renders whichever mode is actually active
    // instead of forcing single like a bare renderPreview() call would.
    refreshPreview();

    // Untappd's own search only ever fails for beer (see untappdError's
    // origin in enrichBeerFromUntappd) - offer the manual "paste the beer's
    // Untappd URL/HTML" fallback below only then, and clear out anything
    // left over from a previous scan's attempt at it. Same pattern as
    // applySkuLookupProduct's own skuUntappdSection handling above.
    els.scanUpcUntappdSection.hidden = !(isBeer && data.untappdError);
    els.scanUpcUntappdSearchInput.value = data.title || '';
    els.scanUpcUntappdUrl.value = '';
    els.scanUpcUntappdStatus.textContent = '';
    els.scanUpcUntappdHtmlInput.value = '';
    els.scanUpcUntappdHtmlSection.hidden = true;
    els.scanUpcUntappdHtmlToggle.setAttribute('aria-expanded', 'false');
  }

  // Collects whichever best-effort enrichment step didn't pan out, so staff
  // still learn why a field looks unchanged instead of guessing:
  // data.storeSourceError/data.untappdError (Beer - see
  // enrichBeerScanFromStore in productImport.js) or
  // data.descriptionSourceError (Wine/Spirits - see
  // enrichWineDescriptionFromStore). A non-empty result here is also what
  // decides whether a scan gets auto-queued below - see
  // els.scanUpcLookupBtn's own handler.
  function scanUpcProblems(data) {
    const problems = [];
    if (data.storeSourceError) problems.push(`Store: ${data.storeSourceError}`);
    if (data.untappdError) problems.push(`Untappd: ${data.untappdError}`);
    if (data.descriptionSourceError) problems.push(`Description: ${data.descriptionSourceError}`);
    return problems.join(' ');
  }

  // Same "Add to Queue" pattern as SKU Lookup/Search by Name's own save
  // buttons (see els.skuSaveBtn's note above), reusing the form's real
  // submit handler via requestSubmit() rather than a fourth copy of
  // validate/save. Pulled into its own function, rather than living only in
  // scanUpcSaveBtn's click handler below, so a successful, fully-resolved
  // scan can trigger it automatically (see els.scanUpcLookupBtn's own
  // handler) without staff clicking Add to Queue by hand after every single
  // item - the whole point of a barcode scanner is walking the aisle and
  // scanning one after another, hands-free. `message` (optional) is the
  // auto-add path's own success text; the manual button below has no scan
  // of its own to describe, so it falls back to the plain default. Returns
  // whether the add actually went through - validation can still fail here
  // (e.g. a price neither the export nor the store could supply), and a
  // caller needs to tell that apart from success rather than assume a scan
  // always ends up queued.
  function addScannedUpcToQueue(message) {
    els.form.requestSubmit();
    if (!els.formError.hidden) {
      // The fields stay exactly as filled in, ready for a manual fix (on
      // Manual Entry) and a manual click here to retry - same fallback the
      // pre-automatic version of this always had.
      els.scanUpcStatus.textContent = els.formError.textContent;
      return false;
    }
    els.scanUpcInput.value = '';
    els.scanUpcStatus.textContent = message || 'Added to queue! Scan the next one.';
    els.scanUpcUntappdSection.hidden = true;
    els.scanUpcInput.focus();
    return true;
  }

  els.scanUpcLookupBtn.addEventListener('click', async () => {
    const isBeer = currentCategory === 'beer';
    const upc = els.scanUpcInput.value.trim();
    if (!upc) {
      els.scanUpcStatus.textContent = 'Scan or type a UPC first.';
      return;
    }
    els.scanUpcLookupBtn.disabled = true;
    els.scanUpcStatus.textContent = isBeer ? 'Looking up UPC...' : 'Looking up UPC and checking the store site for a description...';

    try {
      const resp = await fetch('/api/upc-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upc, category: isBeer ? 'beer' : 'wine' }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const err = new Error(data.error || 'UPC lookup failed.');
        err.code = data.code;
        throw err;
      }

      // Untappd itself couldn't safely pick one of two or more real,
      // separately-listed beers (see openUntappdPicker's own comment) -
      // ask instead of guessing. Once staff actually make a pick (Recommended
      // or one of the alternates), that's the same explicit sign-off
      // confirmBeerUntappdMatch's "Use This Match" would give, so it rejoins
      // the hands-free auto-queue flow below rather than stopping to wait for
      // a manual "Add to Queue" click - the whole point of this tab is
      // scanning one item after another. Backing out of the dialog without
      // picking anything is the only case left unresolved, so that one still
      // stops for a manual review/click.
      if (isBeer && data.untappdCandidates && data.untappdCandidates.length) {
        applyUpcScanProduct(data, isBeer);
        const picked = await openUntappdPicker(data.untappdCandidates, data.title || upc);
        if (picked) {
          addScannedUpcToQueue('Added to queue! Scan the next one.');
        } else {
          // None of the offered candidates were right (or staff just backed
          // out) - reveal the same manual "paste an Untappd URL" fallback a
          // plain miss already offers below, rather than leaving no way
          // forward but Manual Entry.
          els.scanUpcUntappdSection.hidden = false;
          els.scanUpcStatus.textContent = 'Found it. Untappd had more than one possible match and none was picked - '
            + 'try the Untappd URL box below, or review the fields and add it as-is.';
        }
        return;
      }

      // A single, confident Untappd match still needs a staff sign-off
      // before its brewery/style/ABV/rating reach the printed talker - see
      // confirmBeerUntappdMatch's own comment for why this isn't optional
      // just because Untappd itself wasn't torn between two candidates.
      if (isBeer && !data.untappdError) {
        const confirmed = await confirmBeerUntappdMatch(data, (d) => applyUpcScanProduct(d, isBeer));
        // untappdError is falsy in this branch already - only a
        // store/description error could still show up here.
        const otherProblems = scanUpcProblems(data);
        const suffix = otherProblems ? ` ${otherProblems}` : '';
        if (confirmed) {
          els.scanUpcStatus.textContent = `Found it!${suffix} Review the fields, then click "Add to Queue".`;
        } else {
          els.scanUpcUntappdSection.hidden = false;
          els.scanUpcStatus.textContent = `Found it. Not the right beer - brewery/style/ABV/rating left blank.${suffix} `
            + 'Try the Untappd URL box below, or review the fields and add it as-is.';
        }
        return;
      }

      applyUpcScanProduct(data, isBeer);
      const problems = scanUpcProblems(data);
      if (problems) {
        // A best-effort enrichment step (store lookup, Untappd, store
        // description) came back with nothing, or failed outright - don't
        // silently queue a result staff haven't had a chance to see was
        // incomplete. The fields stay filled in with whatever did resolve;
        // Add to Queue below still works once they've been reviewed.
        els.scanUpcStatus.textContent = `Found it. ${problems} Review the fields, then click "Add to Queue".`;
      } else {
        // Every field the lookup needed is filled, with nothing left
        // unresolved - add it straight to the queue instead of waiting for
        // a manual click.
        addScannedUpcToQueue('Added to queue! Scan the next one.');
      }
    } catch (err) {
      els.scanUpcStatus.textContent = err.message || 'Something went wrong looking up that UPC.';
      // A missing/unconfigured export file is the one failure staff can fix
      // right here - open Export File Settings automatically instead of
      // leaving them to find it in the Advanced menu themselves. A plain
      // "not found" (the file loaded fine, this UPC just isn't in it) isn't
      // a settings problem, so it doesn't open anything. This works even in
      // the plain browser dev copy, unlike the Advanced menu item itself -
      // exportSettingsModal (defined further down) is just a DOM modal, not
      // an Electron-only feature; only its usual entry point is.
      const isSettingsProblem = err.code === 'NO_EXPORT_PATH' || err.code === 'EXPORT_NOT_FOUND' || err.code === 'EXPORT_UNREADABLE';
      if (isSettingsProblem && els.exportSettingsOverlay.hidden) {
        exportSettingsModal.open();
      }
    } finally {
      els.scanUpcLookupBtn.disabled = false;
    }
  });

  // Manual fallback for whenever the automatic add above didn't happen (a
  // validation error the lookup itself couldn't have known about, or the
  // fields were hand-edited after a scan) - same addScannedUpcToQueue,
  // just with no per-scan enrichment note to fold in.
  els.scanUpcSaveBtn.addEventListener('click', () => addScannedUpcToQueue());

  // Manual fallback for a scan whose automatic Untappd search came back
  // empty (see applyUpcScanProduct's untappdError check above) - same
  // "paste the beer's Untappd URL" pattern as SKU Lookup's own
  // skuUntappdBtn handler, reusing the same /api/untappd-lookup endpoint
  // and applyUntappdFields merge.
  els.scanUpcUntappdBtn.addEventListener('click', async () => {
    const untappdUrl = els.scanUpcUntappdUrl.value.trim();
    if (!untappdUrl) {
      els.scanUpcUntappdStatus.textContent = "Enter the beer's Untappd URL first.";
      return;
    }
    els.scanUpcUntappdBtn.disabled = true;
    els.scanUpcUntappdStatus.textContent = 'Reading that Untappd page...';

    try {
      const resp = await fetch('/api/untappd-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: readForm(), untappdUrl }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not read that Untappd page.');

      applyUntappdFields(data);
      els.scanUpcUntappdStatus.textContent = 'Filled in from Untappd! Review the fields, then click "Add to Queue".';
    } catch (err) {
      els.scanUpcUntappdStatus.textContent = err.message || 'Something went wrong reading that Untappd page.';
    } finally {
      els.scanUpcUntappdBtn.disabled = false;
    }
  });

  // "Untappd blocking that too? Paste the beer page's HTML instead" - same
  // paste-HTML pattern as skuUntappdHtmlToggle above, for Scan UPC.
  els.scanUpcUntappdHtmlToggle.addEventListener('click', () => {
    els.scanUpcUntappdHtmlSection.hidden = !els.scanUpcUntappdHtmlSection.hidden;
    els.scanUpcUntappdHtmlToggle.setAttribute('aria-expanded', String(!els.scanUpcUntappdHtmlSection.hidden));
  });

  els.scanUpcUntappdHtmlBtn.addEventListener('click', async () => {
    const html = els.scanUpcUntappdHtmlInput.value;
    if (!html.trim()) {
      els.scanUpcUntappdStatus.textContent = "Paste the beer page's HTML first.";
      return;
    }
    els.scanUpcUntappdHtmlBtn.disabled = true;
    els.scanUpcUntappdStatus.textContent = 'Reading pasted HTML...';

    try {
      const resp = await fetch('/api/untappd-lookup-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: readForm(), html, url: els.scanUpcUntappdUrl.value.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not read that pasted HTML.');

      applyUntappdFields(data);
      els.scanUpcUntappdStatus.textContent = 'Filled in from pasted HTML! Review the fields, then click "Add to Queue".';
    } catch (err) {
      els.scanUpcUntappdStatus.textContent = err.message || 'Something went wrong reading that HTML.';
    } finally {
      els.scanUpcUntappdHtmlBtn.disabled = false;
    }
  });

  // ---------- Find tasting notes (Wine/Spirits) ----------

  // Unlike the website importer below, this has no URL to paste - it
  // searches using whatever's already in the Product Title/Vintage fields,
  // the same way a person would type a product name into a search box. The
  // dialog (not just a status line) exists because a single site can be
  // blocked or wrong for a given product - staff need to see what actually
  // came back, try another source, or tweak the text, before it lands in
  // the form (see createModal below, shared with Print Preview/Help).

  // "Any source" isn't a real provider name from the server - sending no
  // `source` at all is what tells findTastingNotes (server-side) to try
  // every provider in order, same as before this dialog existed.
  const ANY_TASTING_NOTES_SOURCE = 'Any source (recommended)';
  let tastingNotesSourceNames = [];
  // Which of the above only make sense for Product Type = Bourbon
  // (Distiller, today - see the server's own
  // TASTING_NOTE_EXPERIMENTAL_PROVIDER_NAMES) - read from the server rather
  // than hardcoded, same reasoning as tastingNotesSourceNames itself below.
  // "Experimental" in these names is legacy from when this list was gated
  // by the Bourbon Shelf Talkers toggle rather than Product Type itself -
  // the server's own naming (TASTING_NOTE_EXPERIMENTAL_PROVIDER_NAMES)
  // didn't change, since the underlying idea (sources that don't apply to
  // every product) is the same either way.
  let tastingNotesExperimentalSourceNames = [];
  let tastingNotesSourcesLoaded = false;

  function renderTastingNotesSourceOptions() {
    const current = els.tastingNotesSourceSelect.value;
    // Bourbon-only sources (Distiller) only show up in the dropdown while
    // Product Type is Bourbon - the server enforces this too (see
    // findTastingNotes in productImport.js), this is just keeping staff
    // from picking an option that would immediately error.
    const visibleNames = currentCategory === 'bourbon'
      ? tastingNotesSourceNames
      : tastingNotesSourceNames.filter((name) => !tastingNotesExperimentalSourceNames.includes(name));
    const options = [ANY_TASTING_NOTES_SOURCE, ...visibleNames];
    els.tastingNotesSourceSelect.innerHTML = options
      .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
      .join('');
    // A source that just got hidden (toggle switched off while it was
    // selected) falls back to "Any source" rather than leaving the select
    // showing a value with no matching <option>.
    els.tastingNotesSourceSelect.value = options.includes(current) ? current : ANY_TASTING_NOTES_SOURCE;
  }

  // Fetched once per page load rather than hardcoded, so a provider added to
  // TASTING_NOTE_PROVIDERS server-side (see productImport.js) shows up here
  // without an app.js change.
  async function ensureTastingNotesSourcesLoaded() {
    if (tastingNotesSourcesLoaded) return;
    tastingNotesSourcesLoaded = true; // don't retry every open - a failure here just leaves "Any source" as the only option
    try {
      const resp = await fetch('/api/tasting-notes/sources');
      const data = await resp.json();
      if (resp.ok && Array.isArray(data.sources)) tastingNotesSourceNames = data.sources;
      if (resp.ok && Array.isArray(data.experimental)) tastingNotesExperimentalSourceNames = data.experimental;
    } catch {
      // Fall through with "Any source" only - the search itself still tries
      // every provider server-side regardless of whether this list loaded.
    }
    renderTastingNotesSourceOptions();
  }

  // Every field this dialog can fill, paired with the target form field it
  // writes to on Confirm (see els.tastingNotesConfirmBtn's handler below).
  // Wine.com/Vivino only ever return `description`; Distiller.com (the one
  // structured source - see TASTING_NOTE_PROVIDERS in productImport.js)
  // returns nose/palate/finish instead, and sometimes a plain description
  // too (whichever fallback its own product page happened to expose) - see
  // findTastingNotes. Listed once here so search, reset, and the confirm
  // enable/disable check all walk the same four instead of drifting.
  const TASTING_NOTES_FIELDS = [
    { preview: 'tastingNotesPreview', target: 'description', max: 600 },
    { preview: 'tastingNotesNosePreview', target: 'nose', max: 200 },
    { preview: 'tastingNotesPalatePreview', target: 'palate', max: 200 },
    { preview: 'tastingNotesFinishPreview', target: 'finish', max: 200 },
  ];

  function updateTastingNotesConfirmState() {
    els.tastingNotesConfirmBtn.disabled = !TASTING_NOTES_FIELDS.some((f) => els[f.preview].value.trim());
  }

  async function runTastingNotesSearch() {
    const title = els.title.value.trim();
    if (!title) {
      els.tastingNotesModalStatus.textContent = 'Enter a product title first.';
      return;
    }
    const vintage = els.vintage.value.trim();
    const selected = els.tastingNotesSourceSelect.value;
    const source = selected && selected !== ANY_TASTING_NOTES_SOURCE ? selected : undefined;

    els.tastingNotesSearchBtn.disabled = true;
    els.tastingNotesModalStatus.textContent = source ? `Searching ${source}...` : 'Searching...';

    try {
      const resp = await fetch('/api/tasting-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, vintage, source, allowExperimental: currentCategory === 'bourbon' }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not find tasting notes.');

      // Respects each field's own maxlength, which only guards user typing,
      // not a value assigned from here.
      els.tastingNotesPreview.value = (data.description || '').slice(0, 600);
      els.tastingNotesNosePreview.value = (data.nose || '').slice(0, 200);
      els.tastingNotesPalatePreview.value = (data.palate || '').slice(0, 200);
      els.tastingNotesFinishPreview.value = (data.finish || '').slice(0, 200);
      // Only reveal the Nose/Palate/Finish rows when this result actually
      // has at least one - keeps a plain Wine.com/Vivino description result
      // looking exactly like it always has, no empty spirits-only fields
      // tacked on.
      els.tastingNotesFlavorPreview.hidden = !(data.nose || data.palate || data.finish);
      els.tastingNotesModalStatus.textContent = `Found via ${data.sourceName || source || 'the web'}.`;
      updateTastingNotesConfirmState();
    } catch (err) {
      els.tastingNotesModalStatus.textContent = err.message || 'Something went wrong finding tasting notes.';
    } finally {
      els.tastingNotesSearchBtn.disabled = false;
    }
  }

  const tastingNotesModal = createModal({
    overlay: els.tastingNotesOverlay,
    closeBtns: [els.tastingNotesModalCloseBtn, els.tastingNotesCancelBtn],
    onOpen: () => {
      const title = els.title.value.trim();
      const vintage = els.vintage.value.trim();
      // Mirrors buildTastingNotesQuery's own rule server-side (productImport.js)
      // so this label shows the query that will actually be sent, instead of
      // a misleading double year when the title already carries one (e.g.
      // "...Cabernet Sauvignon 2025" plus a separate Vintage of "2022").
      const showVintage = vintage && !/\b\d{4}\b/.test(title);
      els.tastingNotesQueryLabel.textContent = `Searching for: ${title}${showVintage ? ` ${vintage}` : ''}`;
      TASTING_NOTES_FIELDS.forEach((f) => { els[f.preview].value = ''; });
      els.tastingNotesFlavorPreview.hidden = true;
      els.tastingNotesModalStatus.textContent = '';
      els.tastingNotesConfirmBtn.disabled = true;
      renderTastingNotesSourceOptions();
      els.tastingNotesSourceSelect.value = ANY_TASTING_NOTES_SOURCE;
      ensureTastingNotesSourcesLoaded().then(() => {
        els.tastingNotesSourceSelect.value = ANY_TASTING_NOTES_SOURCE;
        runTastingNotesSearch();
      });
    },
  });

  els.findTastingNotesBtn.addEventListener('click', () => {
    if (!els.title.value.trim()) {
      els.tastingNotesStatus.textContent = 'Enter a product title first.';
      return;
    }
    els.tastingNotesStatus.textContent = '';
    tastingNotesModal.open();
  });

  els.tastingNotesSearchBtn.addEventListener('click', runTastingNotesSearch);

  // Switching sources doesn't search automatically - without this, the
  // status line would keep reading "Found via Wine.com" after switching the
  // dropdown to a different source, misleadingly describing a search that
  // was never run against it.
  els.tastingNotesSourceSelect.addEventListener('change', () => {
    els.tastingNotesModalStatus.textContent = 'Click "Search Again" to search this source.';
  });

  TASTING_NOTES_FIELDS.forEach((f) => {
    els[f.preview].addEventListener('input', updateTastingNotesConfirmState);
  });

  els.tastingNotesConfirmBtn.addEventListener('click', () => {
    const updates = TASTING_NOTES_FIELDS
      .map((f) => ({ el: els[f.target], value: els[f.preview].value.trim(), max: f.max }))
      .filter((u) => u.value);
    if (!updates.length) return;
    // One combined confirmation covers every field this would overwrite,
    // rather than a separate popup per field (description, then nose, then
    // palate...) for a single Distiller result.
    const overwriting = updates.some((u) => {
      const existing = u.el.value.trim();
      return existing && existing !== u.value;
    });
    if (overwriting && !confirm('Replace the current tasting notes with these?')) return;
    updates.forEach((u) => { u.el.value = u.value.slice(0, u.max); });
    tastingNotesModal.close();
    if (previewMode === 'single') renderPreview();
  });

  // ---------- Import from website ----------

  // Shared by both the live fetch below and the "paste page HTML" fallback
  // further down - once product data has been obtained, either way, filling
  // the form is identical.
  function applyImportedProduct(data, isBeer) {
    // Carries over whatever Type (Shelf Talker/Small Display/Large Display)
    // and Talker Size were already picked at the top of the tab before the
    // fetch ran - fillForm falls back to Shelf Talker/Full Size for any of
    // these it isn't given, which would otherwise silently override a
    // Display Sign selection every time product data loads.
    const currentType = { signType: currentSignType, signSize: currentSignSize, talkerSize: currentTalkerSize };
    if (isBeer) {
      // No price/salePrice/size here - Untappd is a rating and check-in
      // site, not a retailer, so it has no price to pull. Staff still add
      // those two fields by hand; everything else (name, brewery,
      // location, style, ABV, IBU, rating, description) comes from the
      // page.
      fillForm({
        ...currentType,
        category: 'beer',
        title: data.title,
        description: data.description,
        brewery: data.brewery,
        location: data.location,
        style: data.style,
        abv: data.abv,
        ibu: data.ibu,
        untappdRating: data.untappdRating,
        untappdRatingCount: data.untappdRatingCount,
        theme: els.theme.value,
      });
    } else {
      fillForm({
        ...currentType,
        // Same reasoning as applyNameSearchProduct's category line - without
        // this, fillForm's normalizeCategory(undefined) defaults to 'wine'
        // and Bourbon reverts to Wine/Spirits on every import.
        category: currentCategory,
        title: data.title,
        description: data.description,
        size: data.size,
        price: data.price,
        salePrice: data.salePrice,
        theme: els.theme.value,
      });
    }
    // Preserves whichever preview mode staff already had selected - see the
    // comment above applyUpcScanProduct's own refreshPreview() call.
    refreshPreview();
    // Deliberately stays on the Website tab instead of switching to Edit
    // Talker - same reasoning as applySkuLookupProduct's own note below: the
    // Live Preview panel already updates live regardless of which tab is
    // active, and staff can review the fetched fields and click "Add to
    // Queue" right here (see els.importSaveBtn) without losing their place.
  }

  els.importBtn.addEventListener('click', async () => {
    const isBeer = currentCategory === 'beer';
    const url = els.importUrl.value.trim();
    if (!url) {
      els.importStatus.textContent = isBeer ? 'Enter an Untappd beer URL first.' : 'Enter a product URL first.';
      return;
    }
    els.importBtn.disabled = true;
    els.importStatus.textContent = isBeer ? 'Fetching beer data...' : 'Fetching product data...';

    try {
      const resp = await fetch('/api/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, category: currentCategory }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Import failed.');

      applyImportedProduct(data, isBeer);
      els.importStatus.textContent = isBeer
        ? 'Loaded! Add the price and size, double-check the rest, then click "Add to Queue".'
        : 'Loaded! Review the fields, then click "Add to Queue".';
    } catch (err) {
      els.importStatus.textContent = err.message || 'Something went wrong fetching that page.';
    } finally {
      els.importBtn.disabled = false;
    }
  });

  // Website's own "Add to Queue" - saves whatever the fetch (or the
  // pasted-HTML fallback below) just filled into the shared form fields
  // without making staff switch to Edit Talker first. Same pattern as
  // els.skuSaveBtn/els.scanUpcSaveBtn: reuses the form's real submit handler
  // via requestSubmit() rather than a third copy of validate/save.
  els.importSaveBtn.addEventListener('click', () => {
    els.form.requestSubmit();
    if (!els.formError.hidden) {
      // The form's own error banner lives on the Edit Talker tab-panel, not
      // visible from here - mirror it into this tab's own status line
      // instead of switching tabs away from the Website workflow.
      els.importStatus.textContent = els.formError.textContent;
      return;
    }
    // Saved successfully - resetForm() already cleared the shared fields
    // (title/size/price/etc.); the URL box lives outside <form> and needs
    // its own reset so the tab is ready for the next product instead of
    // still showing the one that was just added.
    els.importUrl.value = '';
    els.importStatus.textContent = 'Added to queue! Paste another URL to fetch the next one.';
  });

  // "Site blocking the fetch? Paste the page's HTML instead" - the fallback
  // for when the fetch above keeps getting blocked (e.g. wine.com's bot
  // protection). Staff open the same page in their own browser, which
  // already gets past the block, copy its HTML source, and paste it here;
  // /api/import-html parses it the exact same way a successful fetch would
  // have, with no network request of its own.
  els.importHtmlToggle.addEventListener('click', () => {
    els.importHtmlSection.hidden = !els.importHtmlSection.hidden;
    els.importHtmlToggle.setAttribute('aria-expanded', String(!els.importHtmlSection.hidden));
  });

  els.importHtmlBtn.addEventListener('click', async () => {
    const isBeer = currentCategory === 'beer';
    const html = els.importHtmlInput.value;
    if (!html.trim()) {
      els.importStatus.textContent = "Paste the page's HTML first.";
      return;
    }
    els.importHtmlBtn.disabled = true;
    els.importStatus.textContent = 'Reading pasted HTML...';

    try {
      const resp = await fetch('/api/import-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, url: els.importUrl.value.trim(), category: currentCategory }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not read product data from that HTML.');

      applyImportedProduct(data, isBeer);
      els.importStatus.textContent = isBeer
        ? 'Loaded from pasted HTML! Add the price and size, double-check the rest, then click "Add to Queue".'
        : 'Loaded from pasted HTML! Review the fields, then click "Add to Queue".';
    } catch (err) {
      els.importStatus.textContent = err.message || 'Something went wrong reading that HTML.';
    } finally {
      els.importHtmlBtn.disabled = false;
    }
  });

  // A USB/Bluetooth barcode scanner types its code like a fast keyboard and
  // finishes with an Enter keystroke - wiring that Enter to the lookup
  // button is what makes a scan land a completed lookup with no click in
  // between. Used for both the SKU field below and the Scan UPC field
  // further down, since a scanner is just as likely to be used for either.
  function wireEnterTriggersClick(input, button) {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      button.click();
    });
  }

  // "Search Untappd" box on the manual fallback (SKU Lookup and Scan UPC
  // both have one - see skuUntappdSection/scanUpcUntappdSection in
  // index.html) - just opens Untappd's own search in a new tab. No network
  // request of its own: Untappd's search results only render client-side,
  // so this app can't read them back either way (same reason the "paste
  // the beer's Untappd URL" field sits right below it).
  function wireUntappdSearch(input, button) {
    button.addEventListener('click', () => {
      const query = input.value.trim();
      if (!query) {
        input.focus();
        return;
      }
      window.open(`https://untappd.com/search?q=${encodeURIComponent(query)}`, '_blank', 'noopener');
    });
    wireEnterTriggersClick(input, button);
  }

  // ---------- SKU lookup ----------

  wireEnterTriggersClick(els.skuInput, els.skuLookupBtn);
  wireUntappdSearch(els.skuUntappdSearchInput, els.skuUntappdSearchBtn);

  // Fills the same fields the Import tab's applyImportedProduct fills, plus
  // price/size for a beer entry - unlike Untappd (a rating/check-in site
  // with nothing to sell), the store lookup this feeds from always has a
  // price and size regardless of category, so there's no "beer never gets
  // price" split here the way applyImportedProduct has.
  function applySkuLookupProduct(data, isBeer) {
    const fields = {
      // See applyNameSearchProduct's comment on the same line - falling back
      // to currentCategory (not a flat 'wine') keeps Bourbon from reverting
      // to Wine/Spirits on every lookup.
      category: isBeer ? 'beer' : currentCategory,
      title: data.title,
      description: data.description,
      size: data.size,
      price: data.price,
      salePrice: data.salePrice,
      theme: els.theme.value,
    };
    if (isBeer) {
      Object.assign(fields, {
        // Not part of `data` (the API response) - this is the number
        // staff themselves typed into the Store SKU box above to run the
        // lookup, carried over onto the talker now that there's somewhere
        // to keep it (see #fSku/beerFields in index.html). Beer only, per
        // request - a wine/spirits lookup leaves the shared field alone.
        sku: els.skuInput.value.trim(),
        brewery: data.brewery,
        location: data.location,
        style: data.style,
        abv: data.abv,
        ibu: data.ibu,
        untappdRating: data.untappdRating,
        untappdRatingCount: data.untappdRatingCount,
      });
    } else {
      fields.vintage = data.vintage;
    }
    fillForm(fields);
    // Preserves whichever preview mode staff already had selected - see the
    // comment above applyUpcScanProduct's own refreshPreview() call.
    refreshPreview();
    // Unlike applyImportedProduct, deliberately stays on the SKU Lookup tab
    // instead of switching to Manual Entry - the Live Preview panel already
    // updates live regardless of which tab is active, and for beer, staying
    // put keeps the Untappd fallback section (right below) in view so staff
    // can use it immediately instead of switching tabs first.

    // Untappd's own search only ever fails for beer (see untappdError's
    // origin in enrichBeerFromUntappd) - offer the manual "paste the beer's
    // Untappd URL/HTML" fallback below only then, and clear out anything
    // left over from a previous SKU's attempt at it.
    els.skuUntappdSection.hidden = !(isBeer && data.untappdError);
    els.skuUntappdSearchInput.value = data.title || '';
    els.skuUntappdUrl.value = '';
    els.skuUntappdStatus.textContent = '';
    els.skuUntappdHtmlInput.value = '';
    els.skuUntappdHtmlSection.hidden = true;
    els.skuUntappdHtmlToggle.setAttribute('aria-expanded', 'false');
  }

  // Merges Untappd fields (from the manual URL/HTML fallback below) into
  // whatever's already in the form - readForm()/fillForm() round-trip
  // rather than a fresh applySkuLookupProduct call, since by this point
  // staff may have already hand-edited fields the initial lookup filled in,
  // and those edits shouldn't be discarded. Also stays on the SKU Lookup
  // tab, same reasoning as applySkuLookupProduct above.
  function applyUntappdFields(fields) {
    fillForm({ ...readForm(), ...fields });
    // Preserves whichever preview mode staff already had selected - see the
    // comment above applyUpcScanProduct's own refreshPreview() call.
    refreshPreview();
  }

  // Shown instead of auto-filling when a beer lookup's `untappdCandidates`
  // comes back set (see enrichBeerFromUntappd/UntappdAmbiguousMatchError in
  // productImport.js) - two or more real, separately-listed Untappd beers
  // scored identically, so picking one automatically risks a
  // confident-looking WRONG match rather than just a missed one. Shared by
  // Scan UPC, SKU Lookup, and Search by Name (see each tab's own lookup
  // handler below) rather than three copies: every path ends up with the
  // same {url, brewery, beerName} candidate list, and resolving a pick
  // always ends the same way - fetch that one beer's own page and merge it
  // in, exactly what the manual "paste an Untappd URL" fallback above
  // already does (reuses the same /api/untappd-lookup endpoint and
  // applyUntappdFields).
  //
  // One candidate is put forward as a Recommended pick, with up to 2 others
  // shown below it - staff shouldn't have to read every tied row just to
  // find the one actually on the shelf. matchUntappdCandidates on the
  // server deliberately does NOT fetch any candidate's own page before
  // throwing the tie (a real regression test pins that down), so there's no
  // ABV/style/rating to rank by yet when this dialog first opens - it
  // starts with the Recommended slot as whichever candidate Untappd's own
  // search ranked first, then fires a preview-only fetch (same
  // /api/untappd-lookup endpoint the final pick below uses, just with an
  // empty `current` so nothing gets merged/applied) for each of the up-to-3
  // candidates actually on screen. As those come back, the visible set
  // re-ranks itself by Untappd's own check-in count ("N ratings") - the
  // widely-distributed core-lineup beer in a tie is almost always logged
  // far more than a seasonal/regional one tied with it on name alone. A
  // candidate folded behind "+N more" is never fetched unless staff expand
  // it - no point spending a request on a row they may never look at.
  //
  // Returns a Promise resolving to true once a pick was applied to the
  // form, or false if staff closed the dialog without picking one - each
  // caller uses that to decide its own status message/whether it's safe to
  // auto-add-to-queue.
  let untappdPickerResolve = null;

  // Max candidates shown before "+N more" - the request behind this dialog
  // asked for a recommended pick plus up to 2 other options.
  const UNTAPPD_PICKER_VISIBLE = 3;

  function untappdMetaParts(c) {
    const parts = [];
    if (c.style) parts.push(escapeHtml(c.style));
    if (c.abv) parts.push(`${escapeHtml(c.abv)} ABV`);
    if (c.untappdRating) {
      parts.push(`${escapeHtml(c.untappdRating)} &#9733;${c.untappdRatingCount ? ` (${escapeHtml(c.untappdRatingCount)} ratings)` : ''}`);
    }
    return parts;
  }

  const untappdPickerModal = createModal({
    overlay: els.untappdPickerOverlay,
    closeBtns: [els.untappdPickerCloseBtn, els.untappdPickerCancelBtn],
    // Fires for every close, including the one openUntappdPicker triggers
    // itself right after a successful pick (see below) - that path already
    // resolves and nulls out untappdPickerResolve *before* calling
    // .close(), so this only ever actually resolves anything for a
    // backdrop click/Escape/Cancel, i.e. staff closing it without picking.
    onClose: () => {
      if (untappdPickerResolve) {
        const resolveFn = untappdPickerResolve;
        untappdPickerResolve = null;
        resolveFn(false);
      }
    },
  });

  function openUntappdPicker(candidates, queryTitle) {
    return new Promise((resolve) => {
      untappdPickerResolve = resolve;
      // Defensive reset: if the *previous* dialog was closed (Cancel/Escape/
      // backdrop, or the close-btn/backdrop path in general - see onClose
      // above) while a selectCandidate fetch it kicked off was still in
      // flight, that fetch's own success path leaves the rec
      // card/button/alt-rows disabled forever, since it assumes the dialog
      // is still open and about to be closed by itself (see selectCandidate
      // below). Those are shared, reused DOM nodes, so without this reset a
      // brand-new tie for a completely unrelated scan would open already
      // greyed-out and unclickable, with no error message explaining why.
      setAllDisabled(false);
      const count = candidates.length;
      const otherCount = count - 1;
      els.untappdPickerQueryLabel.textContent = `Untappd found ${count} equally-likely matches for `
        + `"${queryTitle}" - review the recommended pick below, or ${otherCount} other option${otherCount === 1 ? '' : 's'}.`;
      els.untappdPickerStatus.textContent = '';

      // `order` starts as Untappd's own tie order and only ever reshuffles
      // within the visible window as preview fetches resolve (see
      // reorderByPopularity below) - the hidden tail behind "+N more" stays
      // in that original order until/unless it's expanded.
      let order = candidates.slice();
      let visibleCount = Math.min(UNTAPPD_PICKER_VISIBLE, order.length);
      // url -> { loading } | { error: true } | full /api/untappd-lookup fields.
      const details = new Map();
      // True while a candidate's real (apply-to-form) fetch is in flight -
      // freezes re-rendering/reordering so the dialog doesn't shuffle out
      // from under a click staff already made.
      let selecting = false;

      function reorderByPopularity() {
        const shown = order.slice(0, visibleCount);
        const rest = order.slice(visibleCount);
        const ratingCountOf = (c) => {
          const d = details.get(c.url);
          if (!d || d.loading || d.error) return -1;
          const n = Number(String(d.untappdRatingCount || '').replace(/,/g, ''));
          return Number.isFinite(n) && n > 0 ? n : -1;
        };
        // Stable sort (Array.prototype.sort) - a candidate whose preview
        // hasn't resolved yet (ratingCountOf -1) keeps its original
        // position relative to other still-loading ones.
        const rankedShown = shown
          .map((c, i) => ({ c, i }))
          .sort((a, b) => ratingCountOf(b.c) - ratingCountOf(a.c) || a.i - b.i)
          .map((x) => x.c);
        order = [...rankedShown, ...rest];
      }

      function fetchPreview(candidate) {
        if (details.has(candidate.url)) return;
        details.set(candidate.url, { loading: true });
        fetch('/api/untappd-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Empty `current` (nothing to merge/apply) - this is a read-only
          // preview fetch for the card, not the "staff picked this one"
          // fetch selectCandidate below does with the real form contents.
          body: JSON.stringify({ current: {}, untappdUrl: candidate.url }),
        })
          .then((resp) => resp.json().then((data) => ({ ok: resp.ok, data })))
          .then(({ ok, data }) => details.set(candidate.url, ok ? { loading: false, ...data } : { loading: false, error: true }))
          .catch(() => details.set(candidate.url, { loading: false, error: true }))
          .then(() => {
            if (selecting) return;
            reorderByPopularity();
            render();
          });
      }

      function setAllDisabled(disabled) {
        els.untappdPickerRecCard.disabled = disabled;
        els.untappdPickerUseRecBtn.disabled = disabled;
        els.untappdPickerOthersBlock.querySelectorAll('.alt-row').forEach((b) => { b.disabled = disabled; });
      }

      async function selectCandidate(candidate) {
        selecting = true;
        setAllDisabled(true);
        els.untappdPickerStatus.textContent = 'Loading that beer...';
        try {
          const resp = await fetch('/api/untappd-lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current: readForm(), untappdUrl: candidate.url }),
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'Could not read that Untappd page.');
          // Close/Cancel/backdrop/Escape aren't covered by setAllDisabled
          // above, so staff can back out of the dialog while this fetch is
          // still in flight - that already resolved openUntappdPicker's
          // promise with false via onClose, which reassigns
          // untappdPickerResolve (see below) or nulls it out. If it no
          // longer points at *this* invocation's own resolve fn, staff
          // already backed out: applying these fields now would silently
          // overwrite the form after the fact, and closing/resolving would
          // step on whatever opened next. Bail out quietly instead.
          if (untappdPickerResolve !== resolve) return;
          applyUntappdFields(data);
          untappdPickerResolve = null;
          untappdPickerModal.close();
          resolve(true);
        } catch (err) {
          if (untappdPickerResolve !== resolve) return;
          selecting = false;
          els.untappdPickerStatus.textContent = err.message || 'Something went wrong loading that beer.';
          setAllDisabled(false);
        }
      }

      function render() {
        const [rec, ...rest] = order;
        const shownOthers = rest.slice(0, visibleCount - 1);
        const hiddenCount = order.length - visibleCount;
        const recDetails = details.get(rec.url);

        const recMeta = untappdMetaParts(recDetails || {});
        // reorderByPopularity only ever promotes `rec` to this slot once its
        // own check-in count is the highest among the *currently resolved*
        // shown candidates - so once recDetails itself has a positive count,
        // that promotion is a real, checkable fact worth telling staff, not
        // just a guess. A candidate still stays Recommended (Untappd's own
        // tie order) before that's known; this line just doesn't claim
        // anything until it's true.
        const recCount = recDetails && !recDetails.loading && !recDetails.error
          ? Number(String(recDetails.untappdRatingCount || '').replace(/,/g, ''))
          : 0;
        els.untappdPickerRecCard.innerHTML = `
          <span class="untappd-rec-card__badge">&#9733; Recommended</span>
          <span>
            <span class="untappd-rec-card__title">${escapeHtml(rec.beerName || rec.title || 'Untitled')}</span>
            <span class="untappd-rec-card__brewery">${escapeHtml(rec.brewery || '')}</span>
          </span>
          ${recDetails && !recDetails.loading
            ? (recMeta.length ? `<span class="untappd-rec-card__meta">${recMeta.join(' &middot; ')}</span>` : '')
              + (recCount > 0 ? '<span class="untappd-rec-card__why">Most checked-in match on Untappd</span>' : '')
              + (recDetails.description ? `<p class="untappd-rec-card__desc">${escapeHtml(recDetails.description)}</p>` : '')
            : '<span class="untappd-rec-card__meta untappd-rec-card__meta--loading">Loading Untappd details&hellip;</span>'}
        `;
        els.untappdPickerRecCard.onclick = () => selectCandidate(rec);

        const rows = shownOthers.map((c) => {
          const d = details.get(c.url);
          const meta = [escapeHtml(c.brewery || '')];
          if (d && !d.loading && d.style) meta.push(escapeHtml(d.style));
          if (d && !d.loading && d.abv) meta.push(`${escapeHtml(d.abv)} ABV`);
          const stat = d && !d.loading && d.untappdRating
            ? `<span class="alt-row__stat">${escapeHtml(d.untappdRating)}&#9733;${d.untappdRatingCount ? ` (${escapeHtml(d.untappdRatingCount)})` : ''}</span>`
            : '';
          return `
            <button type="button" class="alt-row" data-url="${escapeHtml(c.url)}">
              <span>
                <span class="alt-row__title">${escapeHtml(c.beerName || c.title || 'Untitled')}</span>
                <span class="alt-row__meta">${meta.filter(Boolean).join(' &middot; ')}</span>
              </span>
              ${stat}
            </button>
          `;
        }).join('');

        els.untappdPickerOthersBlock.innerHTML = shownOthers.length ? `
          <div class="untappd-others-divider"><span>Other match${shownOthers.length === 1 && !hiddenCount ? '' : 'es'} Untappd found</span></div>
          <div class="alt-list">${rows}</div>
          ${hiddenCount > 0 ? `<button type="button" class="untappd-more-toggle" id="untappdMoreToggle">+${hiddenCount} more match${hiddenCount === 1 ? '' : 'es'}</button>` : ''}
        ` : '';

        els.untappdPickerOthersBlock.querySelectorAll('.alt-row').forEach((btn) => {
          btn.addEventListener('click', () => {
            const candidate = order.find((c) => c.url === btn.dataset.url);
            if (candidate) selectCandidate(candidate);
          });
        });
        const moreToggle = document.getElementById('untappdMoreToggle');
        if (moreToggle) {
          moreToggle.addEventListener('click', () => {
            const newlyShown = order.slice(visibleCount);
            visibleCount = order.length;
            render();
            newlyShown.forEach(fetchPreview);
          });
        }
      }

      els.untappdPickerUseRecBtn.onclick = () => selectCandidate(order[0]);

      render();
      untappdPickerModal.open();
      order.slice(0, visibleCount).forEach(fetchPreview);
    });
  }

  // Client-side mirror of enrichBeerFromUntappd's own untappdError fallback
  // shape (productImport.js: brewery falls back to `brand`, everything else
  // blank) - what the form shows while a confirm dialog is up (see
  // openUntappdConfirm below) or after staff reject the match, without
  // needing a second round trip to ask the server for it.
  function stripUntappdFields(data) {
    return {
      ...data,
      brewery: data.brand || '',
      location: '',
      style: '',
      abv: '',
      ibu: '',
      untappdRating: '',
      untappdRatingCount: '',
      description: '',
    };
  }

  // Shown after EVERY beer lookup that resolves a single, confident Untappd
  // match - not just a genuine tie (openUntappdPicker above already covers
  // that). Before this existed, a wrong-but-confident match had no review
  // step at all: Scan UPC's own "problems" check (scanUpcProblems) only
  // ever flagged an outright miss, so a beer Untappd matched to the wrong
  // listing would sail straight through to the printed talker unnoticed.
  // `data` already carries everything needed to show staff what would be
  // applied (brewery/style/ABV/rating/description) - unlike
  // openUntappdPicker's candidates, there's no second fetch needed here,
  // since a confident single match already came back with full details.
  let untappdConfirmResolve = null;

  const untappdConfirmModal = createModal({
    overlay: els.untappdConfirmOverlay,
    closeBtns: [els.untappdConfirmCloseBtn, els.untappdConfirmRejectBtn],
    // Same ordering rule as untappdPickerModal's own onClose above: the
    // Accept handler below nulls out untappdConfirmResolve and resolves
    // *before* calling .close(), so this only ever actually resolves
    // anything for a genuine reject (Reject button, backdrop click, Escape).
    onClose: () => {
      if (untappdConfirmResolve) {
        const resolveFn = untappdConfirmResolve;
        untappdConfirmResolve = null;
        resolveFn(false);
      }
    },
  });

  // Returns a Promise resolving to true if staff confirmed the match
  // (Use This Match), false if they rejected it (Not the Right Beer, or
  // closed the dialog any other way).
  function openUntappdConfirm(data) {
    return new Promise((resolve) => {
      untappdConfirmResolve = resolve;
      // data.beerName is Untappd's own name for the matched beer (see
      // mergeUntappdBeer's comment) - shown here instead of data.title
      // (the store-sourced Product Title, already visible on the form/
      // preview behind this dialog) so staff can actually see what beer
      // Untappd matched to, not just its brewery.
      els.untappdConfirmTitleText.textContent = data.beerName || data.title || 'Unknown beer';
      els.untappdConfirmBrewery.textContent = data.brewery || 'Unknown brewery';
      const metaParts = [];
      if (data.style) metaParts.push(data.style);
      if (data.abv) metaParts.push(`${data.abv} ABV`);
      if (data.untappdRating) {
        metaParts.push(`${data.untappdRating} ★${data.untappdRatingCount ? ` (${data.untappdRatingCount} ratings)` : ''}`);
      }
      els.untappdConfirmMeta.textContent = metaParts.join(' · ');
      els.untappdConfirmDescription.textContent = data.description || '';
      els.untappdConfirmDescription.hidden = !data.description;
      untappdConfirmModal.open();
    });
  }

  els.untappdConfirmAcceptBtn.addEventListener('click', () => {
    // Null out (and grab) untappdConfirmResolve before closing - same
    // ordering rule as everywhere else this pattern shows up in this file.
    const resolveFn = untappdConfirmResolve;
    untappdConfirmResolve = null;
    untappdConfirmModal.close();
    if (resolveFn) resolveFn(true);
  });

  // Shared strip-apply-confirm-merge sequence behind every beer lookup that
  // resolves a single confident Untappd match (Scan UPC, SKU Lookup + its
  // pasted-HTML fallback, Search by Name) - each of those four call sites
  // has its own tab-specific `applyFn` (already applies non-Untappd fields
  // the same way it always has) and its own status-message wording, but the
  // strip/confirm/merge sequence itself is identical, so it lives here once
  // instead of four times. Returns whether staff confirmed the match.
  async function confirmBeerUntappdMatch(data, applyFn) {
    applyFn(stripUntappdFields(data));
    const confirmed = await openUntappdConfirm(data);
    // `data` is the raw lookup response, which for a Scan UPC/SKU Lookup hit
    // can carry its own `category` field - not the app's 'beer'/'wine'
    // enum, but whatever literal department/class text the WinePOS export
    // (or scraped store page) happened to have in that column (see
    // FIELD_ALIASES.category in upcCatalog.js and enrichBeerFromUntappd's
    // `...product` spread). applyFn above already set Product Type
    // correctly from the tab staff are actually on; merging that stray
    // field back in via applyUntappdFields's `{...readForm(), ...fields}`
    // would silently overwrite it (almost never literally the string
    // "beer", so fillForm's `talker.category === 'beer'` check falls
    // through to 'wine') the moment staff click "Use This Match".
    if (confirmed) {
      const { category, ...untappdFields } = data;
      applyUntappdFields(untappdFields);
    }
    return confirmed;
  }

  // data.untappdError is only ever set for a beer lookup whose Untappd step
  // failed (blocked, no match, etc) - see enrichBeerFromUntappd in
  // productImport.js. The store lookup itself still succeeded, so the form
  // is filled either way; this just tells staff why brewery/style/ABV/IBU
  // came back store-only instead of leaving them to guess.
  function skuLookupLoadedMessage(data, loadedFrom) {
    if (data.untappdError) {
      return `Loaded from ${loadedFrom}. Untappd: ${data.untappdError}`;
    }
    return `Loaded from ${loadedFrom}! Review the fields, then click "Add to Queue".`;
  }

  els.skuLookupBtn.addEventListener('click', async () => {
    const isBeer = currentCategory === 'beer';
    const sku = els.skuInput.value.trim();
    if (!sku) {
      els.skuStatus.textContent = 'Enter a SKU first.';
      return;
    }
    els.skuLookupBtn.disabled = true;
    els.skuStatus.textContent = isBeer ? 'Looking up SKU and searching Untappd...' : 'Looking up SKU...';

    try {
      const resp = await fetch('/api/sku-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, category: currentCategory }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'SKU lookup failed.');

      // Same disambiguation step Scan UPC's own handler takes above - see
      // openUntappdPicker's comment for why this can't just auto-pick one.
      // Once staff actually make a pick (Recommended or one of the
      // alternates), that's the same explicit sign-off "Use This Match"
      // would give, so it goes straight to the queue too - see Scan UPC's
      // own comment on addScannedUpcToQueue above for why.
      if (isBeer && data.untappdCandidates && data.untappdCandidates.length) {
        applySkuLookupProduct(data, isBeer);
        const picked = await openUntappdPicker(data.untappdCandidates, data.title || sku);
        if (picked) {
          addSkuLookupToQueue('Loaded from the store and added to queue! Enter another SKU to look up the next one.');
        } else {
          // None of the offered candidates were right (or staff just backed
          // out) - reveal the same manual "paste an Untappd URL" fallback a
          // plain miss already offers below, rather than leaving no way
          // forward but Manual Entry.
          els.skuUntappdSection.hidden = false;
          els.skuStatus.textContent = 'Loaded from the store. Untappd had more than one possible match and none was picked - '
            + 'try the Untappd URL box below, or review the fields and add it as-is.';
        }
        return;
      }

      // A single, confident Untappd match still needs a staff sign-off -
      // see confirmBeerUntappdMatch's own comment.
      if (isBeer && !data.untappdError) {
        const confirmed = await confirmBeerUntappdMatch(data, (d) => applySkuLookupProduct(d, isBeer));
        if (confirmed) {
          els.skuStatus.textContent = 'Loaded from the store! Review the fields, then click "Add to Queue".';
        } else {
          els.skuUntappdSection.hidden = false;
          els.skuStatus.textContent = 'Loaded from the store. Not the right beer - brewery/style/ABV/rating left blank. '
            + 'Try the Untappd URL box below, or review the fields and add it as-is.';
        }
        return;
      }

      applySkuLookupProduct(data, isBeer);
      els.skuStatus.textContent = skuLookupLoadedMessage(data, 'the store');
    } catch (err) {
      els.skuStatus.textContent = err.message || 'Something went wrong looking up that SKU.';
    } finally {
      els.skuLookupBtn.disabled = false;
    }
  });

  // "Site blocking the lookup? Paste the product page's HTML instead" - the
  // fallback for when the store site blocks the fetch above. Staff search
  // the SKU themselves and open the matching product page, which already
  // gets past the block, copy its HTML source, and paste it here;
  // /api/sku-lookup-html parses it the exact same way a successful fetch
  // would have, with no network request of its own (beyond the Untappd
  // search for a beer entry).
  els.skuHtmlToggle.addEventListener('click', () => {
    els.skuHtmlSection.hidden = !els.skuHtmlSection.hidden;
    els.skuHtmlToggle.setAttribute('aria-expanded', String(!els.skuHtmlSection.hidden));
  });

  els.skuHtmlBtn.addEventListener('click', async () => {
    const isBeer = currentCategory === 'beer';
    const html = els.skuHtmlInput.value;
    if (!html.trim()) {
      els.skuStatus.textContent = "Paste the page's HTML first.";
      return;
    }
    els.skuHtmlBtn.disabled = true;
    els.skuStatus.textContent = 'Reading pasted HTML...';

    try {
      const resp = await fetch('/api/sku-lookup-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, url: els.skuHtmlUrl.value.trim(), category: currentCategory }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not read product data from that HTML.');

      if (isBeer && data.untappdCandidates && data.untappdCandidates.length) {
        applySkuLookupProduct(data, isBeer);
        const picked = await openUntappdPicker(data.untappdCandidates, data.title || 'that product');
        if (picked) {
          addSkuLookupToQueue('Loaded from pasted HTML and added to queue! Enter another SKU to look up the next one.');
        } else {
          els.skuUntappdSection.hidden = false;
          els.skuStatus.textContent = 'Loaded from pasted HTML. Untappd had more than one possible match and none was picked - '
            + 'try the Untappd URL box below, or review the fields and add it as-is.';
        }
        return;
      }

      if (isBeer && !data.untappdError) {
        const confirmed = await confirmBeerUntappdMatch(data, (d) => applySkuLookupProduct(d, isBeer));
        if (confirmed) {
          els.skuStatus.textContent = 'Loaded from pasted HTML! Review the fields, then click "Add to Queue".';
        } else {
          els.skuUntappdSection.hidden = false;
          els.skuStatus.textContent = 'Loaded from pasted HTML. Not the right beer - brewery/style/ABV/rating left blank. '
            + 'Try the Untappd URL box below, or review the fields and add it as-is.';
        }
        return;
      }

      applySkuLookupProduct(data, isBeer);
      els.skuStatus.textContent = skuLookupLoadedMessage(data, 'pasted HTML');
    } catch (err) {
      els.skuStatus.textContent = err.message || 'Something went wrong reading that HTML.';
    } finally {
      els.skuHtmlBtn.disabled = false;
    }
  });

  // Manual fallback for a beer lookup whose automatic Untappd search came
  // back empty (see applySkuLookupProduct's untappdError check above) -
  // confirmed against a real beer that Untappd's search results only
  // render client-side (an Algolia widget), so this app can never scrape
  // them directly no matter the query. The beer's own page is a normal
  // server-rendered page, though, so staff search Untappd themselves and
  // hand this that page's URL.
  els.skuUntappdBtn.addEventListener('click', async () => {
    const untappdUrl = els.skuUntappdUrl.value.trim();
    if (!untappdUrl) {
      els.skuUntappdStatus.textContent = "Enter the beer's Untappd URL first.";
      return;
    }
    els.skuUntappdBtn.disabled = true;
    els.skuUntappdStatus.textContent = 'Reading that Untappd page...';

    try {
      const resp = await fetch('/api/untappd-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: readForm(), untappdUrl }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not read that Untappd page.');

      applyUntappdFields(data);
      els.skuUntappdStatus.textContent = 'Filled in from Untappd! Review the fields, then click "Add to Queue".';
    } catch (err) {
      els.skuUntappdStatus.textContent = err.message || 'Something went wrong reading that Untappd page.';
    } finally {
      els.skuUntappdBtn.disabled = false;
    }
  });

  // "Untappd blocking that too? Paste the beer page's HTML instead" - same
  // paste-HTML pattern as skuHtmlToggle above, one level deeper.
  els.skuUntappdHtmlToggle.addEventListener('click', () => {
    els.skuUntappdHtmlSection.hidden = !els.skuUntappdHtmlSection.hidden;
    els.skuUntappdHtmlToggle.setAttribute('aria-expanded', String(!els.skuUntappdHtmlSection.hidden));
  });

  els.skuUntappdHtmlBtn.addEventListener('click', async () => {
    const html = els.skuUntappdHtmlInput.value;
    if (!html.trim()) {
      els.skuUntappdStatus.textContent = "Paste the beer page's HTML first.";
      return;
    }
    els.skuUntappdHtmlBtn.disabled = true;
    els.skuUntappdStatus.textContent = 'Reading pasted HTML...';

    try {
      const resp = await fetch('/api/untappd-lookup-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: readForm(), html, url: els.skuUntappdUrl.value.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not read that pasted HTML.');

      applyUntappdFields(data);
      els.skuUntappdStatus.textContent = 'Filled in from pasted HTML! Review the fields, then click "Add to Queue".';
    } catch (err) {
      els.skuUntappdStatus.textContent = err.message || 'Something went wrong reading that HTML.';
    } finally {
      els.skuUntappdHtmlBtn.disabled = false;
    }
  });

  // ---------- Search by Name ----------

  // Looks products up by (partial) title instead of a SKU/UPC - useful when
  // staff know roughly what they're after but not its number. Same local
  // WinePOS export file Scan UPC reads above (see searchByName in
  // server/upcCatalog.js), so this never touches the network either - just
  // a debounced request per keystroke against the local file, ranked
  // server-side, with a short list of candidates rendered as a dropdown
  // under the field for staff to pick from (mouse, or Up/Down + Enter).

  let nameSearchResults = [];
  let nameSearchFocusIndex = -1;
  let nameSearchSelectedProduct = null;
  // 'unit' or 'pack' - which of the selected product's prices goes on the
  // talker (see the price-choice control in renderNameSearchSelected below).
  // Only ever matters when the selected product actually has a pack price
  // to offer (see productHasPackPrice) - reset to the right default every
  // time a new product is picked, see selectNameSearchProduct.
  let nameSearchPriceMode = 'unit';
  // Cancels a still-in-flight search when a newer keystroke starts another
  // one, so a slow response to an old (now-stale) query can't land after a
  // faster response to what's actually in the box and clobber it - a real
  // risk here since, unlike the click-triggered lookups elsewhere on this
  // tab bar, every keystroke fires its own request.
  let nameSearchAbortController = null;
  let nameSearchDebounce;
  // Bumped on every pick (see selectNameSearchProduct) so a slow
  // /api/name-search-select response for an earlier pick can't land after a
  // faster one for whatever staff picked next and clobber it - same
  // "newest wins" guard nameSearchAbortController gives the ranked list
  // above, but that AbortController is about to be reused for a fresh
  // keystroke search the moment a result's clicked (see runSmartSearch's
  // clearNameSearchSelection() call above), so this pick's own in-flight
  // Untappd request needs a guard that isn't tied to it.
  let nameSearchSelectToken = 0;

  // Below this many characters, a search isn't run at all - a 1-character
  // query against a store's full inventory would return a huge, mostly
  // meaningless result set. searchByName's own 25-result cap on the server
  // is a backstop for a broad-but-not-tiny query, not a substitute for this.
  const NAME_SEARCH_MIN_CHARS = 2;

  function closeNameSearchResults() {
    els.nameSearchResults.hidden = true;
    els.nameSearchResults.innerHTML = '';
    els.smartSearchInput.setAttribute('aria-expanded', 'false');
    els.smartSearchInput.removeAttribute('aria-activedescendant');
    nameSearchFocusIndex = -1;
  }

  function renderNameSearchResults() {
    if (!nameSearchResults.length) {
      els.nameSearchResults.innerHTML = `<div class="search-results__empty">No matches for &ldquo;${escapeHtml(els.smartSearchInput.value.trim())}&rdquo; in the export file. Try a different spelling, or add it on Edit Talker.</div>`;
      els.nameSearchResults.hidden = false;
      els.smartSearchInput.setAttribute('aria-expanded', 'true');
      return;
    }
    els.nameSearchResults.innerHTML = nameSearchResults.map((p, i) => {
      const metaParts = [];
      if (p.size) metaParts.push(escapeHtml(p.size));
      if (p.vintage) metaParts.push(escapeHtml(p.vintage));
      if (p.sku) metaParts.push(`SKU ${escapeHtml(p.sku)}`);
      return `
        <div class="search-result${i === nameSearchFocusIndex ? ' is-focused' : ''}" id="nameSearchResult-${i}" data-index="${i}" role="option" aria-selected="${i === nameSearchFocusIndex}">
          <div class="search-result__main">
            <div class="search-result__title">${escapeHtml(p.title || 'Untitled')}</div>
            <div class="search-result__meta">${metaParts.join(' &middot; ')}</div>
          </div>
          <div class="search-result__price">${escapeHtml(formatMoney(p.price))}</div>
        </div>
      `;
    }).join('');
    els.nameSearchResults.hidden = false;
    els.smartSearchInput.setAttribute('aria-expanded', 'true');
    if (nameSearchFocusIndex >= 0) {
      els.smartSearchInput.setAttribute('aria-activedescendant', `nameSearchResult-${nameSearchFocusIndex}`);
    } else {
      els.smartSearchInput.removeAttribute('aria-activedescendant');
    }
  }

  async function runNameSearch(rawQuery) {
    const q = rawQuery.trim();
    if (nameSearchAbortController) nameSearchAbortController.abort();

    if (q.length < NAME_SEARCH_MIN_CHARS) {
      nameSearchResults = [];
      els.nameSearchSpinner.hidden = true;
      closeNameSearchResults();
      return;
    }

    const controller = new AbortController();
    nameSearchAbortController = controller;
    els.nameSearchSpinner.hidden = false;

    try {
      const resp = await fetch(`/api/name-search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      const data = await resp.json();
      if (!resp.ok) {
        nameSearchResults = [];
        els.nameSearchResults.innerHTML = `<div class="search-results__error">${escapeHtml(data.error || 'Could not search the export file.')}</div>`;
        els.nameSearchResults.hidden = false;
        // Same "open Settings for them" behavior as Scan UPC's own
        // NO_EXPORT_PATH/EXPORT_NOT_FOUND/EXPORT_UNREADABLE handling below -
        // a missing/broken export is the one failure staff can fix right
        // here instead of hunting for the Advanced menu themselves.
        const isSettingsProblem = data.code === 'NO_EXPORT_PATH' || data.code === 'EXPORT_NOT_FOUND' || data.code === 'EXPORT_UNREADABLE';
        if (isSettingsProblem && els.exportSettingsOverlay.hidden) exportSettingsModal.open();
        return;
      }
      nameSearchResults = data.results || [];
      nameSearchFocusIndex = nameSearchResults.length ? 0 : -1;
      renderNameSearchResults();
    } catch (err) {
      if (err.name === 'AbortError') return; // superseded by a newer keystroke - not a real failure
      nameSearchResults = [];
      els.nameSearchResults.innerHTML = '<div class="search-results__error">Something went wrong searching the export file.</div>';
      els.nameSearchResults.hidden = false;
    } finally {
      if (nameSearchAbortController === controller) {
        nameSearchAbortController = null;
        els.nameSearchSpinner.hidden = true;
      }
    }
  }

  // A WinePOS export's own `price` column is priced per single bottle/can
  // (see packPrice's comment in upcCatalog.js) - this is true whether or not
  // the export also has a pack price to offer, so it's true for any
  // product, not just beer. Only beer's search results actually surface the
  // Unit/Pack choice below, but this stays category-agnostic so that isn't
  // hardcoded in two places.
  function productHasPackPrice(p) {
    return !!(p && p.packPrice && Number(p.packPrice) > 0);
  }

  // Fills the same fields applySkuLookupProduct/applyUpcScanProduct do -
  // picking a search result is just a third way to load a product onto the
  // shared form (see the note on applyUpcScanProduct in the Scan UPC
  // section above for why beer/wine split the same way here). `priceMode`
  // ('unit' or 'pack') picks which of the product's prices lands on the
  // talker - see the price-choice control in renderNameSearchSelected,
  // which is the only thing that ever passes 'pack'.
  function applyNameSearchProduct(product, isBeer, priceMode = 'unit') {
    const usePack = priceMode === 'pack' && productHasPackPrice(product);
    const fields = {
      // Not just `isBeer ? 'beer' : 'wine'` - that collapsed Bourbon back to
      // Wine/Spirits on every pick, since isBeer only distinguishes beer
      // from "not beer". Falling back to currentCategory instead preserves
      // whichever non-beer Product Type was selected before the search.
      category: isBeer ? 'beer' : currentCategory,
      title: product.title,
      description: product.description,
      size: product.size,
      price: usePack ? product.packPrice : product.price,
      // The export has no separate "pack sale price" to offer (see
      // packPrice's comment in upcCatalog.js) - the unit sale price doesn't
      // apply to the pack price, so carrying it over as-is would put a
      // misleading "was $X" (a per-unit figure) under a pack price on the
      // talker. Left blank for staff to fill in by hand if the pack itself
      // is genuinely on sale.
      salePrice: usePack ? '' : product.salePrice,
      theme: els.theme.value,
    };
    if (isBeer) {
      Object.assign(fields, {
        sku: product.sku,
        // Once /api/name-search-select's Untappd step (see
        // selectNameSearchProduct below) comes back, product.brewery is
        // Untappd's own brewery name - falls back to the export's own Brand
        // column (same as before that step existed) whenever Untappd didn't
        // have one, or hasn't answered yet.
        brewery: product.brewery || product.brand,
        location: product.location,
        style: product.style,
        abv: product.abv,
        ibu: product.ibu,
        untappdRating: product.untappdRating,
        untappdRatingCount: product.untappdRatingCount,
      });
    } else {
      fields.vintage = product.vintage;
    }
    fillForm(fields);
    // Preserves whichever preview mode staff already had selected - see the
    // comment above applyUpcScanProduct's own refreshPreview() call.
    refreshPreview();
  }

  // The Unit/Pack price-choice control shown on a beer's selected-product
  // card below - only rendered when the product actually has a pack price
  // to offer (see productHasPackPrice). Defaults to Pack (see
  // selectNameSearchProduct) since beer at this store is mostly shelved and
  // shopped by the pack/case, not the single can/bottle; one click switches
  // it to Unit for a talker that's meant for singles.
  function priceChoiceHtml(p) {
    const packQtyLabel = p.packQty ? ` (${escapeHtml(String(p.packQty))})` : '';
    return `
      <div class="price-choice">
        <div class="price-choice__prompt">Which price goes on the talker?</div>
        <div class="price-choice__group" role="radiogroup" aria-label="Unit or pack price">
          <button type="button" class="price-choice__opt${nameSearchPriceMode === 'unit' ? ' is-active' : ''}" data-mode="unit" role="radio" aria-checked="${nameSearchPriceMode === 'unit'}">
            <span class="price-choice__opt-label"><span class="price-choice__opt-check"></span>Unit</span>
            <span class="price-choice__opt-price">${escapeHtml(formatMoney(p.price))}</span>
          </button>
          <button type="button" class="price-choice__opt${nameSearchPriceMode === 'pack' ? ' is-active' : ''}" data-mode="pack" role="radio" aria-checked="${nameSearchPriceMode === 'pack'}">
            <span class="price-choice__opt-label"><span class="price-choice__opt-check"></span>Pack${packQtyLabel}</span>
            <span class="price-choice__opt-price">${escapeHtml(formatMoney(p.packPrice))}</span>
          </button>
        </div>
        <div class="price-choice__note">Beer defaults to Pack Price. Switch to Unit if this talker's for singles.</div>
      </div>
    `;
  }

  // The form's own fields aren't visible from this tab (same reasoning as
  // SKU Lookup/Scan UPC staying put instead of switching to Manual Entry -
  // see applySkuLookupProduct's note above), so this small summary is what
  // confirms which product got picked before staff click Add to Queue.
  function renderNameSearchSelected() {
    const p = nameSearchSelectedProduct;
    if (!p) {
      els.nameSearchSelectedWrap.innerHTML = '';
      return;
    }
    const isBeer = currentCategory === 'beer';
    const showPriceChoice = isBeer && productHasPackPrice(p);
    const activePrice = showPriceChoice && nameSearchPriceMode === 'pack' ? p.packPrice : p.price;

    const metaParts = [];
    if (p.size) metaParts.push(escapeHtml(p.size));
    if (p.vintage) metaParts.push(`Vintage ${escapeHtml(p.vintage)}`);
    if (p.sku) metaParts.push(`SKU ${escapeHtml(p.sku)}`);
    metaParts.push(isBeer ? 'Beer' : 'Wine / Spirits');
    els.nameSearchSelectedWrap.innerHTML = `
      <div class="selected-card">
        <div style="flex:1; min-width:0;">
          <div class="selected-card__title">${escapeHtml(p.title || 'Untitled')}</div>
          <div class="selected-card__meta">${metaParts.join(' &middot; ')}</div>
          ${showPriceChoice ? priceChoiceHtml(p) : ''}
        </div>
        <div class="selected-card__price-row">
          <div class="selected-card__price">${escapeHtml(formatMoney(activePrice))}</div>
          <button type="button" class="selected-card__clear" id="nameSearchClearBtn" title="Clear selection">&times;</button>
        </div>
      </div>
    `;
    document.getElementById('nameSearchClearBtn').addEventListener('click', clearNameSearchSelection);
    if (showPriceChoice) {
      els.nameSearchSelectedWrap.querySelectorAll('.price-choice__opt').forEach((btn) => {
        btn.addEventListener('click', () => {
          nameSearchPriceMode = btn.dataset.mode;
          applyNameSearchProduct(p, isBeer, nameSearchPriceMode);
          renderNameSearchSelected();
        });
      });
    }
  }

  function clearNameSearchSelection() {
    // Bumped so a still-in-flight /api/name-search-select response for the
    // pick being cleared can't land afterward and silently repopulate the
    // form/status line out from under whatever staff do next (see
    // selectNameSearchProduct's own token check).
    nameSearchSelectToken++;
    nameSearchSelectedProduct = null;
    nameSearchPriceMode = 'unit';
    els.nameSearchSaveBtn.disabled = true;
    renderNameSearchSelected();
  }

  // Search by Name's own "Add to Queue" - same requestSubmit() pattern as
  // SKU Lookup's addSkuLookupToQueue/Scan UPC's addScannedUpcToQueue above,
  // pulled into its own function so a beer picked from the "Pick the Right
  // Beer" dialog (see selectNameSearchProduct below) can trigger it
  // automatically instead of just leaving a "click Add to Queue" status.
  // `message` (optional) is the auto-add path's own success text, same as
  // those two. Returns whether the add actually went through.
  function addNameSearchToQueue(message) {
    els.form.requestSubmit();
    if (!els.formError.hidden) {
      els.nameSearchStatus.textContent = els.formError.textContent;
      return false;
    }
    // Saved successfully - resetForm() already cleared the shared fields;
    // clearNameSearchSelection() (bumps nameSearchSelectToken, clears the
    // selection, disables Save) is the same reset the manual click below
    // always did by hand, plus the token bump - needed here so
    // selectNameSearchProduct's own in-flight try/finally (still unwinding
    // after this returns, from the auto-add-on-pick path) doesn't
    // re-enable Save for a selection that no longer exists.
    clearNameSearchSelection();
    nameSearchResults = [];
    els.smartSearchInput.value = '';
    els.nameSearchStatus.textContent = message || 'Added to queue! Search for the next product.';
    els.smartSearchInput.focus();
    return true;
  }

  // Picking a result fills the form immediately from the export's own
  // columns (title/size/price/etc - no network needed for those), then
  // always kicks off a best-effort background call to
  // /api/name-search-select, which runs enrichSalePriceFromStore
  // (productImport.js) against the export's own SKU to pick up a sale price
  // from liquoroutletwinecellars.com - the local export commonly has no
  // sale/promo price column of its own (see FIELD_ALIASES.salePrice in
  // upcCatalog.js), even when the store's site is actually showing one, and
  // Search by Name used to never touch the store site at all, unlike SKU
  // Lookup/Scan UPC. For beer, that same call also runs a best-effort
  // Untappd search for the brewery/location/style/ABV/IBU/rating the export
  // file doesn't carry - the same enrichment step SKU Lookup and Scan UPC
  // already run for beer, just reached from a picked export row instead of
  // a typed SKU or scanned UPC.
  async function selectNameSearchProduct(product) {
    const myToken = ++nameSearchSelectToken;
    nameSearchSelectedProduct = product;
    els.smartSearchInput.value = product.title;
    closeNameSearchResults();
    els.nameSearchSaveBtn.disabled = false;
    const isBeer = currentCategory === 'beer';
    // Beer defaults to Pack Price whenever the export has one to offer -
    // see priceChoiceHtml's note. Anything else (no pack price, or not
    // beer) defaults to Unit, same as before this control existed.
    nameSearchPriceMode = isBeer && productHasPackPrice(product) ? 'pack' : 'unit';
    applyNameSearchProduct(product, isBeer, nameSearchPriceMode);
    renderNameSearchSelected();

    els.nameSearchSpinner.hidden = false;
    els.nameSearchSaveBtn.disabled = true;
    els.nameSearchStatus.textContent = isBeer ? 'Found it! Searching Untappd...' : 'Found it! Checking for a sale price...';
    try {
      const resp = await fetch('/api/name-search-select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product, category: isBeer ? 'beer' : 'wine' }),
      });
      const data = await resp.json();
      // Superseded by a newer pick while this was in flight - leave
      // whatever that pick already put on the form/status line alone.
      if (myToken !== nameSearchSelectToken) return;
      if (!resp.ok) {
        throw new Error(data.error || (isBeer ? 'Could not search Untappd for that beer.' : 'Could not check for a sale price.'));
      }
      nameSearchSelectedProduct = data;

      if (!isBeer) {
        applyNameSearchProduct(data, false, nameSearchPriceMode);
        renderNameSearchSelected();
        els.nameSearchStatus.textContent = 'Found it! Review the fields, then click "Add to Queue".';
        return;
      }

      // Same disambiguation step Scan UPC/SKU Lookup take above - see
      // openUntappdPicker's own comment for why this can't just auto-pick
      // one. The modal traps focus while open, so there's no real way for
      // staff to pick a *different* search result out from under it - the
      // myToken check below is just the same defensive habit the rest of
      // this function already has, not covering a reachable race.
      if (data.untappdCandidates && data.untappdCandidates.length) {
        applyNameSearchProduct(data, true, nameSearchPriceMode);
        renderNameSearchSelected();
        const picked = await openUntappdPicker(data.untappdCandidates, data.title || product.title);
        if (myToken !== nameSearchSelectToken) return;
        if (picked) {
          // Same explicit sign-off "Use This Match" would give - goes
          // straight to the queue, same as Scan UPC/SKU Lookup's own
          // picker branches above.
          addNameSearchToQueue('Found it and added to queue! Search for the next product.');
        } else {
          els.nameSearchStatus.textContent = 'Found it! Untappd had more than one possible match and none was picked - review the fields, then click "Add to Queue".';
        }
        return;
      }

      // A single, confident Untappd match still needs a staff sign-off -
      // see confirmBeerUntappdMatch's own comment. `isBeer` is already
      // guaranteed true past the wine/spirits early return above.
      if (!data.untappdError) {
        const confirmed = await confirmBeerUntappdMatch(data, (d) => {
          applyNameSearchProduct(d, true, nameSearchPriceMode);
          renderNameSearchSelected();
        });
        if (myToken !== nameSearchSelectToken) return;
        els.nameSearchStatus.textContent = confirmed
          ? 'Found it! Review the fields, then click "Add to Queue".'
          : 'Found it! Not the right beer - brewery/style/ABV/rating left blank. Review the fields, then click "Add to Queue".';
        return;
      }

      applyNameSearchProduct(data, true, nameSearchPriceMode);
      renderNameSearchSelected();
      els.nameSearchStatus.textContent = `Found it! Untappd: ${data.untappdError}`;
    } catch (err) {
      if (myToken !== nameSearchSelectToken) return;
      els.nameSearchStatus.textContent = isBeer
        ? `Found it! Untappd: ${err.message || 'Something went wrong searching Untappd.'}`
        : `Found it! ${err.message || 'Something went wrong checking for a sale price.'}`;
    } finally {
      if (myToken === nameSearchSelectToken) {
        els.nameSearchSpinner.hidden = true;
        els.nameSearchSaveBtn.disabled = false;
      }
    }
  }

  // Typing, focus, and arrow/Enter/Escape keyboard nav for this combobox are
  // all wired on els.smartSearchInput itself now (see runSmartSearch and its
  // neighboring focus/keydown listeners above) - this field is the only
  // entry point, there's no separate Product Name input anymore.

  els.nameSearchResults.addEventListener('click', (e) => {
    const row = e.target.closest('.search-result');
    if (!row) return;
    const product = nameSearchResults[Number(row.dataset.index)];
    if (product) selectNameSearchProduct(product);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#smartSearchFieldWrap')) closeNameSearchResults();
  });

  els.nameSearchSaveBtn.addEventListener('click', () => addNameSearchToQueue());

  // ---------- Print ----------

  // Builds the actual hidden print DOM (#printRoot) from the current queue.
  // Grouped mode: one .sheet per print-preview sheet, sized/shaped per
  // SIGN_LAYOUTS. Auto-arrange mode: one .sheet--auto per auto-arranged
  // page, each holding a vertical stack of .sheet__row elements (see
  // buildAutoArrangedPages) - since a shelf can mix item types/sizes,
  // --print-w is set per item instead of per row.
  function buildPrintDom() {
    els.printRoot.innerHTML = '';
    if (autoArrangeEnabled) {
      buildAutoArrangedPages(queue).forEach((page) => {
        const sheetEl = document.createElement('div');
        sheetEl.className = 'sheet sheet--auto';
        page.rows.forEach((row) => {
          const rowEl = document.createElement('div');
          rowEl.className = 'sheet__row';
          row.items.forEach((talker) => {
            const el = buildPrintableElement(talker);
            el.style.setProperty('--print-w', printWidthCss(layoutKeyFor(talker)));
            rowEl.appendChild(el);
          });
          sheetEl.appendChild(rowEl);
        });
        els.printRoot.appendChild(sheetEl);
      });
    } else {
      buildSheets(queue).forEach(({ layoutKey, items }) => {
        const layout = SIGN_LAYOUTS[layoutKey];
        const sheetEl = document.createElement('div');
        sheetEl.className = 'sheet';
        sheetEl.style.setProperty('--cols', layout.cols);
        sheetEl.style.setProperty('--rows', layout.rows);
        sheetEl.style.setProperty('--print-w', printWidthCss(layoutKey));
        items.forEach((talker) => sheetEl.appendChild(buildPrintableElement(talker)));
        els.printRoot.appendChild(sheetEl);
      });
    }
  }

  function printNow() {
    recordHistoryForPrint();
    buildPrintDom();
    // Cards/signs need to be laid out at print size before we can
    // measure/shrink text - and #printRoot is `display: none` outside
    // @media print, where scrollHeight/clientHeight both read 0. That made
    // every one of fitCardText's fit checks false, so it silently shrank
    // nothing and the printer got unfitted cards (titles truncated with an
    // ellipsis, the price block pushed off the bottom of the card) even
    // though the on-screen Print Preview - which *is* laid out - showed them
    // fitting fine. `.is-measuring` lays the same DOM out off-screen at true
    // print width just long enough to measure it; the font sizes fitCardText
    // sets are inline styles, so they survive the class coming back off.
    els.printRoot.classList.add('is-measuring');
    requestAnimationFrame(() => {
      els.printRoot.querySelectorAll('.card, .sign').forEach((el) => fitCardText(el));
      els.printRoot.classList.remove('is-measuring');
      requestAnimationFrame(triggerPrint);
    });
  }

  // ---------- "How to Read" guide ----------

  // Fixed sample data for the diagram - a beer talker exercises every
  // callout (origin badges, style pill, rating, ABV/IBU, description, size,
  // price), which a wine/spirits example wouldn't. Not read from the queue;
  // this is a fixed reference document, not tied to what's currently loaded.
  const GUIDE_SAMPLE_TALKER = {
    signType: 'talker',
    category: 'beer',
    theme: 'purple',
    talkerSize: 'full',
    talkerType: 'standard',
    title: 'Daylily',
    description: "Daylily is brewed with loads of Citra and Mosaic hops. This one is perfect for drinking all year 'round. Bold citrus notes are rounded out by a clean bitterness. This beer is for great times with close friends. Enjoy it in good company.",
    size: '16oz',
    price: 15.99,
    brewery: 'Autodidact Beer',
    location: 'Morris Plains, NJ United States',
    style: 'Pale Ale - New England / Hazy',
    abv: '5.8%',
    ibu: 'N/A',
    untappdRating: 4.00,
    untappdRatingCount: 2352,
  };

  const GUIDE_LEGEND = [
    { title: "Where it's from", body: "A small flag and/or state outline shows the brewery's home, when we know it — either or both may appear." },
    { title: 'Style, color-coded', body: 'The colored badge is the beer style at a glance — match its color to the key.' },
    { title: 'Community rating', body: "Untappd's average score out of 5, and how many people rated it." },
    { title: 'Brewery &amp; details', body: 'Who makes it and where, plus ABV (alcohol %) and IBU (bitterness — higher IBU means more bitter).' },
    { title: 'Tasting notes', body: "Our staff's own description of what to expect." },
    { title: 'Size', body: 'Bottle, can, or pack size.' },
    { title: 'Price', body: "Regular price in black. A red price means it's on sale." },
  ];

  // [background, text color, pill label, plain-English description] - the
  // colors/order mirror BEER_STYLE_COLORS in card.js (pale-to-dark malt
  // axis, then the non-malt breaks: sour/cider/mead), so this key visually
  // matches how the style pill actually gets colored.
  const GUIDE_COLOR_KEY = [
    ['#e8d887', '#3b2415', 'LAGER', 'Crisp, light, easy-drinking'],
    ['#ddac3c', '#3b2415', 'PALE ALE', 'Balanced, mildly hoppy'],
    ['#ccc566', '#3b2415', 'WHEAT', 'Smooth, fruity or spiced'],
    ['#f3a23f', '#3b2415', 'HAZY IPA', 'Juicy, soft, low bitterness'],
    ['#de6e12', '#ffffff', 'IPA', 'Hoppy, citrus &amp; pine'],
    ['#af461d', '#ffffff', 'DOUBLE IPA', 'Extra hoppy, higher ABV'],
    ['#952e23', '#ffffff', 'RED ALE', 'Malty, toasty'],
    ['#593622', '#ffffff', 'BROWN ALE', 'Nutty, roasted'],
    ['#311f16', '#ffffff', 'STOUT', 'Dark, full-bodied'],
    ['#b03b6c', '#ffffff', 'SOUR', 'Tart, tangy, fruited'],
    ['#58913b', '#ffffff', 'CIDER', 'Crisp apple, not a beer'],
    ['#653b72', '#ffffff', 'MEAD', 'Honey wine, not a beer'],
    ['#189aad', '#ffffff', 'HARD SELTZER', 'Light, fizzy, not a beer'],
    ['#ddd6cc', '#3b2415', 'OTHER', 'Unique or mixed styles'],
  ];

  // Which real .card element each legend number points at, and which
  // corner of it to pin the callout to - 'tr' for anything right-aligned
  // (.card__beer-style-value, .card__state-badge, .card__size) so the
  // number lands in the empty margin outside the card's own text instead
  // of overlapping whatever sits above it (a right-aligned element's own
  // rect.left falls mid-card, not at the margin). Both origin badges share
  // callout 1 since either or both can appear for a given location.
  const GUIDE_CALLOUTS = [
    { sel: '.card__country-badge', num: 1, corner: 'tl' },
    { sel: '.card__state-badge', num: 1, corner: 'tr' },
    { sel: '.card__beer-style-value', num: 2, corner: 'tr' },
    { sel: '.card__beer-rating-detail', num: 3, corner: 'tl' },
    { sel: '.card__beer-table', num: 4, corner: 'tl' },
    { sel: '.card__description', num: 5, corner: 'tl' },
    { sel: '.card__size', num: 6, corner: 'tr' },
    { sel: '.card__prices', num: 7, corner: 'tl' },
  ];

  // Builds a standalone guide DOM tree - not attached anywhere, and not
  // yet size-fitted (caller must lay it out, call fitCardText on the
  // returned card, then placeGuideCallouts, same order as every other
  // printable element in this app). Called once for the on-screen preview
  // and again for the real #printRoot copy when the user confirms Print
  // Now - two separate DOM trees rather than moving one, since a preview
  // node lives inside a .preview-scaler transform that the print copy must
  // not inherit.
  function buildGuideElement() {
    const guide = document.createElement('div');
    guide.className = 'guide';
    guide.innerHTML = `
      <div class="guide__header">
        <img class="guide__logo" src="assets/logo.png" alt="" />
        <div class="guide__header-text">
          <h2>Beer Talker Info</h2>
          <p>Every price tag on our shelves carries the same information, laid out the same way. Here's what each part means.</p>
        </div>
      </div>
      <div class="guide__rule"></div>
      <div class="guide__body">
        <div class="guide__diagram"></div>
        <div class="guide__legend">
          ${GUIDE_LEGEND.map((item, i) => `
            <div class="guide__legend-item">
              <span class="guide__legend-num">${i + 1}</span>
              <div class="guide__legend-text">
                <h3>${item.title}</h3>
                <p>${item.body}</p>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="guide__key">
          <h3>Beer Style Color Key</h3>
          <div class="guide__keygrid">
            ${GUIDE_COLOR_KEY.map(([bg, fg, label, desc]) => `
              <div class="guide__swatch">
                <span class="guide__swatch-pill" style="background:${bg};color:${fg}">${label}</span>
                <span class="guide__swatch-desc">${desc}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="guide__footer"><span>Liquor Outlet Wine Cellars &middot; www.liquoroutletwinecellars.com</span></div>
    `;

    const diagramWrap = guide.querySelector('.guide__diagram');
    const card = buildCardElement(GUIDE_SAMPLE_TALKER);
    card.style.setProperty('--w', '1.85in');
    diagramWrap.appendChild(card);

    return { guide, diagramWrap, card };
  }

  // Positions each numbered callout against the real rendered .card's own
  // child geometry (must run after fitCardText, since that can resize/
  // reflow everything below the title/description) - see the corner-choice
  // note on GUIDE_CALLOUTS above.
  function placeGuideCallouts(diagramWrap, card) {
    const wrapRect = diagramWrap.getBoundingClientRect();
    const GAP = 4;
    GUIDE_CALLOUTS.forEach((spec) => {
      const el = card.querySelector(spec.sel);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const badge = document.createElement('div');
      badge.textContent = spec.num;
      if (spec.corner === 'tl') {
        badge.className = 'guide__callout-num guide__callout-num--tl';
        badge.style.left = `${rect.left - wrapRect.left - GAP}px`;
        badge.style.top = `${rect.top - wrapRect.top - GAP}px`;
      } else {
        badge.className = 'guide__callout-num guide__callout-num--tr';
        badge.style.left = `${rect.right - wrapRect.left + GAP}px`;
        badge.style.top = `${rect.top - wrapRect.top - GAP}px`;
      }
      diagramWrap.appendChild(badge);
    });
  }

  // Rebuilds the guide into #printRoot (clearing whatever was there before -
  // the guide and shelf-talker sheets never print at once, so reusing the
  // same root rather than a second .print-only container guarantees that)
  // and sends it to the system print dialog. Only reached from the guide
  // preview modal's "Print Now", never directly from the Tools menu item
  // that opens the preview - see guidePreviewModal below.
  function printGuide() {
    els.printRoot.innerHTML = '';
    const { guide, diagramWrap, card } = buildGuideElement();
    els.printRoot.appendChild(guide);
    els.printRoot.classList.add('is-measuring');
    requestAnimationFrame(() => {
      fitCardText(card);
      placeGuideCallouts(diagramWrap, card);
      els.printRoot.classList.remove('is-measuring');
      requestAnimationFrame(triggerPrint);
    });
  }

  // On-screen preview of the guide, laid out and scaled exactly like the
  // shelf-talker Print Preview above (same makeScaler/scalePreview
  // helpers) - so what's shown here really is what Print Now sends to the
  // printer, not a separate approximation of it.
  function renderGuidePreviewContents() {
    els.guidePreviewStage.innerHTML = '';
    const { guide, diagramWrap, card } = buildGuideElement();
    const scaler = makeScaler(guide);
    els.guidePreviewStage.appendChild(scaler);
    requestAnimationFrame(() => {
      fitCardText(card);
      placeGuideCallouts(diagramWrap, card);
      rescaleGuidePreview();
    });
  }

  function rescaleGuidePreview() {
    const scaler = els.guidePreviewStage.querySelector('.preview-scaler');
    if (scaler) scalePreview(scaler, els.guidePreviewStage.clientWidth, window.innerHeight * 0.75);
  }

  // Shared accessible-dialog behavior for every full-screen overlay in the
  // app (Print Preview, Help): Tab cycles within it instead of escaping
  // into controls hidden behind the backdrop, Escape and a backdrop click
  // both close it, and focus moves onto the dialog's own close button on
  // open and back to whatever had it beforehand on close. Written once
  // rather than per-dialog now that there are two.
  //
  // Assumes each overlay's first focusable element in DOM order is a close
  // button, which is true for both dialogs today (the header's &times;
  // button always comes before any footer buttons) - a future dialog that
  // wants something else focused first would need its own opening logic.
  function createModal({ overlay, closeBtns = [], onOpen, onClose }) {
    let returnFocus = null;

    function focusable() {
      return [...overlay.querySelectorAll('button, input, [href], select, textarea')]
        .filter((el) => !el.disabled && el.offsetParent !== null);
    }

    function open() {
      returnFocus = document.activeElement;
      overlay.hidden = false;
      if (onOpen) onOpen();
      focusable()[0]?.focus();
    }

    function close() {
      overlay.hidden = true;
      if (onClose) onClose();
      if (returnFocus && returnFocus.isConnected) returnFocus.focus();
      returnFocus = null;
    }

    overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    closeBtns.forEach((btn) => btn.addEventListener('click', close));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay.hidden) close();
    });

    return { open, close };
  }

  // Same preview-before-printing pattern the shelf-talker/sign flow used to
  // use its own modal for (see renderSheetPreview above, which now folds
  // that flow into the Live Preview panel's Full Page mode instead) - kept
  // as an actual modal here since the one-page guide has no equivalent
  // always-on panel to live in.
  const guidePreviewModal = createModal({
    overlay: els.guidePreviewOverlay,
    closeBtns: [els.guidePreviewCloseBtn, els.guidePreviewCancelBtn],
    onOpen: renderGuidePreviewContents,
    onClose: () => { els.guidePreviewStage.innerHTML = ''; },
  });

  // Reachable via Tools > Wine Pairing Rules… - a read-only reference
  // built straight from WINE_PAIRING_RULES (a plain global defined in
  // card.js, same as detectWinePairings itself - see the Food Pairing
  // Suggestions comment block near suggestPairings below). Renders on
  // every open rather than once at startup so it always reflects
  // whatever's currently in that array, same as Suggest Pairings would
  // see if it ran right now. A rule's optional `regions` and/or
  // `sweetness` lists (see the WINE_PAIRING_RULES comment block in
  // card.js) each render as their own nested section, one row per entry,
  // showing which pairing slot it swaps and with what - reading straight
  // from the same data detectWinePairings matches against, so this can't
  // describe a swap that doesn't actually happen. renderRefinementList
  // below builds either section from a rule + one of its two lists, since
  // they're identical in shape (id/label/test/swapIndex/swap) and differ
  // only in the heading above them.
  function renderRefinementList(rule, list, heading) {
    if (!list || !list.length) return '';
    return `
      <div class="pairing-rule-row__regions">
        <div class="pairing-rule-row__regions-label">${escapeHtml(heading)} (only checked once ${escapeHtml(rule.label)} itself matches)</div>
        ${list.map((entry) => `
          <div class="pairing-region-row">
            <div class="pairing-region-row__name">${escapeHtml(entry.label)}</div>
            <div class="pairing-region-row__keywords">matches <code>${escapeHtml(entry.test.toString())}</code></div>
            <div class="pairing-region-row__swap">
              slot ${entry.swapIndex + 1}:
              <span class="pairing-rule-chip pairing-rule-chip--swapped-out">${escapeHtml(rule.pairings[entry.swapIndex].icon)} ${escapeHtml(rule.pairings[entry.swapIndex].food)}</span>
              <span class="pairing-region-row__arrow">&rarr;</span>
              <span class="pairing-rule-chip">${escapeHtml(entry.swap.icon)} ${escapeHtml(entry.swap.food)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Matches a filter query against a rule's own label/pattern and every
  // one of its region/sweetness sub-entries' labels/patterns, not just the
  // rule's own top-level name - so typing "Chablis" or "Trocken" surfaces
  // the varietal that sub-entry belongs to (Chardonnay, Riesling) even
  // though neither word appears in that rule's own label or top-level
  // test. Matching against `test.source` (the regex body, not the
  // /pattern/flags wrapper `test.toString()` prints) means the filter
  // finds a varietal by any keyword Suggest Pairings itself would match on,
  // including ones not spelled out in the rule's label.
  function pairingRuleMatchesQuery(rule, query) {
    if (!query) return true;
    const haystacks = [rule.label, rule.test.source];
    (rule.regions || []).forEach((r) => haystacks.push(r.label, r.test.source));
    (rule.sweetness || []).forEach((s) => haystacks.push(s.label, s.test.source));
    return haystacks.some((h) => h.toLowerCase().includes(query));
  }

  function renderPairingRulesReference() {
    const rawQuery = els.winePairingRulesFilterInput.value.trim();
    const query = rawQuery.toLowerCase();
    const matches = WINE_PAIRING_RULES.filter((rule) => pairingRuleMatchesQuery(rule, query));
    els.winePairingRulesFilterStatus.textContent = query
      ? `${matches.length} of ${WINE_PAIRING_RULES.length} varietals match "${rawQuery}".`
      : '';
    els.winePairingRulesList.innerHTML = matches.length ? matches.map((rule) => `
      <div class="pairing-rule-row">
        <div class="pairing-rule-row__name">${escapeHtml(rule.label)}</div>
        <div class="pairing-rule-row__keywords">matches <code>${escapeHtml(rule.test.toString())}</code></div>
        <div class="pairing-rule-row__pairings">${rule.pairings.map((p) => `
          <span class="pairing-rule-chip">${escapeHtml(p.icon)} ${escapeHtml(p.food)}</span>
        `).join('')}</div>
        ${renderRefinementList(rule, rule.regions, 'Region refinements')}
        ${renderRefinementList(rule, rule.sweetness, 'Sweetness refinements')}
      </div>
    `).join('') : '<p class="help-text">No varietals match that filter.</p>';
  }

  const winePairingRulesModal = createModal({
    overlay: els.winePairingRulesOverlay,
    closeBtns: [els.winePairingRulesCloseBtn],
    onOpen: () => {
      els.winePairingRulesFilterInput.value = '';
      renderPairingRulesReference();
    },
  });

  els.winePairingRulesFilterInput.addEventListener('input', renderPairingRulesReference);

  // First click jumps to the print preview (Full Page mode - see
  // setPreviewMode); once it's showing, the button relabels itself "Print
  // Now" (also set in setPreviewMode) and this same click prints. No
  // separate confirm step beyond that: Full Page already renders exactly
  // what buildPrintDom will send to the printer.
  els.printBtn.addEventListener('click', () => {
    if (queue.length === 0) return;
    if (previewMode !== 'sheet') {
      setPreviewMode('sheet');
      els.previewStage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    printNow();
  });
  els.autoArrangeToggle.addEventListener('change', () => {
    autoArrangeEnabled = els.autoArrangeToggle.checked;
    if (previewMode === 'sheet') renderSheetPreview();
  });
  els.guidePreviewConfirmBtn.addEventListener('click', () => {
    guidePreviewModal.close();
    printGuide();
  });

  // Reachable via Tools > Beer Talker Info in the menu bar (see
  // runMenuAction's 'beer-talker-info' case) - no app-bar button of its
  // own.

  // ---------- Help ----------

  const helpModal = createModal({
    overlay: els.helpOverlay,
    closeBtns: [els.helpCloseBtn, els.helpCloseFooterBtn],
  });
  els.helpBtn.addEventListener('click', helpModal.open);

  // Save/Open Queue are Electron-only (see the File menu note above) - the
  // help text mentioning them is written directly into index.html but kept
  // hidden by default (see [data-electron-only] in styles.css) so it isn't
  // shown - and doesn't reference menu items that don't exist - in a plain
  // browser tab.
  if (window.shelfTalker) {
    document.querySelectorAll('[data-electron-only]').forEach((el) => { el.style.display = ''; });
  }

  // Also reachable via Help > Help in the menu bar (see runMenuAction's
  // 'help' case) - one help doc, reachable two ways.

  // ---------- What's New ----------

  // Renders a list of entries into the popup body. Internal - callers go
  // through showWhatsNewEntries below, which also drives the "See Previous
  // Updates" / "Hide Previous Updates" toggle button.
  function renderWhatsNewEntries(entries) {
    if (!entries.length) {
      els.whatsNewBody.innerHTML = '<p class="whats-new-empty">Nothing new to report yet.</p>';
      return;
    }
    els.whatsNewBody.innerHTML = entries.map((entry) => `
      <div class="whats-new-entry">
        <h3>Version ${escapeHtml(entry.version)}</h3>
        <ul>${entry.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
    `).join('');
  }

  // The "current" (non-expanded) slice of entries the popup was opened
  // with - see checkWhatsNew below (unseen-only) and runMenuAction's
  // 'whats-new' case (everything). Remembered so the "Hide Previous
  // Updates" toggle has something to collapse back to.
  let whatsNewBaseEntries = [];
  let whatsNewExpanded = false;

  // Shared by the automatic launch check and the menu bar's Help > What's
  // New item, which just show a different slice of the list (unseen-only
  // vs. everything). Resets the collapse toggle back to
  // whatever `entries` is each time the popup is (re)opened with a fresh
  // slice, so a previous expand doesn't leak into the next launch popup.
  function showWhatsNewEntries(entries) {
    whatsNewBaseEntries = entries;
    whatsNewExpanded = false;
    updateWhatsNewView();
  }

  // Renders whichever slice is currently selected (base vs. full history)
  // and keeps the toggle button's visibility/label in sync with it. "See
  // Previous Updates" only makes sense when there's older history not
  // currently shown, so it hides itself once the base slice already covers
  // the whole list; once expanded, the same button flips to "Hide Previous
  // Updates" so the popup can collapse back to that base slice in place.
  function updateWhatsNewView() {
    renderWhatsNewEntries(whatsNewExpanded ? WHATS_NEW_ENTRIES : whatsNewBaseEntries);
    els.whatsNewShowAllBtn.hidden = whatsNewBaseEntries.length >= WHATS_NEW_ENTRIES.length;
    els.whatsNewShowAllBtn.textContent = whatsNewExpanded ? 'Hide Previous Updates' : 'See Previous Updates';
  }

  const whatsNewModal = createModal({
    overlay: els.whatsNewOverlay,
    closeBtns: [els.whatsNewCloseBtn, els.whatsNewCloseFooterBtn],
  });

  // Lets someone looking at just the "since you last opened this" slice
  // (see checkWhatsNew below) expand in place to the full history, and
  // collapse back to that slice again, without having to close the popup
  // and reopen it from Help > What's New.
  els.whatsNewShowAllBtn.addEventListener('click', () => {
    whatsNewExpanded = !whatsNewExpanded;
    updateWhatsNewView();
  });

  // Help > What's New in the menu bar (see runMenuAction's 'whats-new'
  // case) opens this popup with the full list, regardless of what this PC
  // has already seen - unlike the automatic launch popup below, this is
  // someone deliberately asking "what's changed lately", not a change
  // notification.

  // Breaks "2.4.10" > "2.4.9" ties correctly, unlike a plain string
  // compare - returns negative/zero/positive same as a normal comparator.
  function compareVersions(a, b) {
    const partsA = String(a).split('.').map(Number);
    const partsB = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i += 1) {
      const diff = (partsA[i] || 0) - (partsB[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  // Shows the popup once per PC after an update: asks the server what
  // version is actually running (see /api/app-version - works the same
  // whether this is the plain browser dev copy or Electron's own local
  // server) and compares it against the newest version this PC has already
  // shown a popup for. A PC that's never seen one only gets the latest
  // entry, not the entire history - staff opening the app for the first
  // time don't need the full changelog, just the button to find one if
  // they want it. Silently does nothing if the request fails or
  // localStorage is unavailable (private/locked-down browser profile) -
  // this is a nice-to-have, not something worth an error state over.
  async function checkWhatsNew() {
    let lastSeen;
    try {
      lastSeen = localStorage.getItem(WHATS_NEW_SEEN_KEY);
    } catch {
      return;
    }

    let version;
    try {
      const resp = await fetch('/api/app-version');
      ({ version } = await resp.json());
      if (!version) return;
    } catch {
      return;
    }

    if (lastSeen === version) return;

    const entries = lastSeen
      ? WHATS_NEW_ENTRIES.filter((entry) => compareVersions(entry.version, lastSeen) > 0)
      : WHATS_NEW_ENTRIES.slice(0, 1);

    try { localStorage.setItem(WHATS_NEW_SEEN_KEY, version); } catch { /* ignore */ }
    if (!entries.length) return;

    showWhatsNewEntries(entries);
    whatsNewModal.open();
  }

  // ---------- History ----------

  // A permanent, searchable record of every talker actually printed (see
  // server/db.js) - separate from, and never written to by, the live Queue
  // in localStorage above. Paging state lives here rather than in the DOM,
  // same reasoning as previewMode/currentCategory elsewhere in this file.
  const HISTORY_PAGE_SIZE = 20;
  let historyQuery = '';
  let historyPage = 0;
  let historyTotal = 0;
  let historySearchTimer = null;

  function formatHistoryTimestamp(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }

  function renderHistoryList(rows) {
    if (!rows.length) {
      els.historyList.innerHTML = historyQuery
        ? '<p class="empty-hint">No printed talkers match that search.</p>'
        : '<p class="empty-hint">Nothing printed yet - printed talkers show up here automatically.</p>';
      return;
    }

    els.historyList.innerHTML = '';
    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      const priceLabel = row.salePrice && Number(row.salePrice) > 0
        ? `${formatMoney(row.salePrice)} (was ${formatMoney(row.price)})`
        : formatMoney(row.price);
      const metaParts = [formatHistoryTimestamp(row.printedAt)];
      if (row.category === 'beer') metaParts.push('Beer');
      if (row.size) metaParts.push(escapeHtml(row.size));
      metaParts.push(priceLabel);

      item.innerHTML = `
        <div class="history-item__body">
          <div class="history-item__title">${escapeHtml(row.title || 'Untitled')}</div>
          <div class="history-item__meta">${metaParts.filter(Boolean).join(' &middot; ')}</div>
        </div>
        <div class="history-item__actions">
          <button type="button" class="btn btn--small" data-action="reprint">Reprint</button>
          <button type="button" class="btn btn--small btn--ghost" data-action="delete" title="Remove from History">Delete</button>
        </div>
      `;

      item.querySelector('[data-action="reprint"]').addEventListener('click', () => reprintHistoryEntry(row.id));
      item.querySelector('[data-action="delete"]').addEventListener('click', () => deleteHistoryEntryById(row.id));
      els.historyList.appendChild(item);
    });
  }

  async function runHistorySearch() {
    els.historyStatus.textContent = 'Loading...';
    try {
      const params = new URLSearchParams({
        limit: String(HISTORY_PAGE_SIZE),
        offset: String(historyPage * HISTORY_PAGE_SIZE),
      });
      if (historyQuery) params.set('q', historyQuery);
      const resp = await fetch(`/api/history?${params}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not load print history.');

      historyTotal = data.total;
      renderHistoryList(data.rows);

      const totalPages = Math.max(Math.ceil(historyTotal / HISTORY_PAGE_SIZE), 1);
      els.historyStatus.textContent = historyTotal
        ? `${historyTotal} printed talker${historyTotal === 1 ? '' : 's'}${historyQuery ? ' match' : ''}.`
        : '';
      els.historyPagination.hidden = totalPages <= 1;
      els.historyPageIndicator.textContent = `Page ${historyPage + 1} of ${totalPages}`;
      els.historyPrevBtn.disabled = historyPage <= 0;
      els.historyNextBtn.disabled = historyPage + 1 >= totalPages;
    } catch (err) {
      els.historyStatus.textContent = err.message || 'Could not load print history.';
      els.historyList.innerHTML = '';
      els.historyPagination.hidden = true;
    }
  }

  // Adds a fresh copy of a past printed talker back into the live Queue for
  // review - deliberately doesn't print it immediately or touch History
  // itself, same "review before it hits the printer" rule as every other
  // way of adding a talker in this app.
  async function reprintHistoryEntry(id) {
    els.historyStatus.textContent = 'Loading...';
    try {
      const resp = await fetch(`/api/history/${id}`);
      const entry = await resp.json();
      if (!resp.ok) throw new Error(entry.error || 'Could not load that talker.');

      // historyId/printedAt are this lookup's own bookkeeping, not talker
      // fields - stripped so they don't end up carried onto the new queue
      // item (which gets its own fresh id from makeId() below).
      const { historyId, printedAt, id: _oldId, ...talkerFields } = entry;
      queue.push({ ...talkerFields, id: makeId() });
      saveQueue();
      renderQueue();
      els.historyStatus.textContent = `Added "${entry.title || 'that talker'}" to the queue.`;
    } catch (err) {
      els.historyStatus.textContent = err.message || 'Could not reprint that talker.';
    }
  }

  async function deleteHistoryEntryById(id) {
    try {
      const resp = await fetch(`/api/history/${id}`, { method: 'DELETE' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not delete that entry.');
      // Deleting the last row on a page beyond the first would otherwise
      // leave that page showing nothing - step back a page rather than
      // leaving staff looking at an empty page with results still above it.
      if (els.historyList.children.length === 1 && historyPage > 0) historyPage -= 1;
      runHistorySearch();
    } catch (err) {
      els.historyStatus.textContent = err.message || 'Could not delete that entry.';
    }
  }

  const historyModal = createModal({
    overlay: els.historyOverlay,
    closeBtns: [els.historyCloseBtn, els.historyCloseFooterBtn],
    onOpen: () => {
      historyPage = 0;
      els.historySearchInput.value = historyQuery;
      runHistorySearch();
    },
  });
  els.historyBtn.addEventListener('click', historyModal.open);

  // Live search rather than a separate button - a read-only query against a
  // local SQLite index is cheap enough to run on every keystroke, debounced
  // just enough to not fire mid-word.
  els.historySearchInput.addEventListener('input', () => {
    clearTimeout(historySearchTimer);
    historySearchTimer = setTimeout(() => {
      historyQuery = els.historySearchInput.value.trim();
      historyPage = 0;
      runHistorySearch();
    }, 250);
  });

  els.historyPrevBtn.addEventListener('click', () => {
    if (historyPage <= 0) return;
    historyPage -= 1;
    runHistorySearch();
  });
  els.historyNextBtn.addEventListener('click', () => {
    historyPage += 1;
    runHistorySearch();
  });

  // ---------- Bourbon Library add/edit form ----------
  //
  // Manages the shared library directly (add/edit/delete) - opened from the
  // Bourbon Library page's own Add Bourbon button or a profile page's Edit
  // button (see the "Bourbon Library (rail view)" section below). Recalling
  // a saved entry onto a talker happens from Edit Talker's own Mash Bill
  // field instead (see refreshMashBillRecall above), not from here. Reuses
  // .settings-section/.reviewer-manager__add for the form itself, same as
  // other add-a-thing forms in this app.

  // null while adding a new entry; the entry's id while editing an
  // existing one (see loadMashBillLibraryEntryIntoForm) - one form serves
  // both, switching label/button text based on which mode this is in.
  let mashBillLibraryEditingId = null;
  let mashBillLibraryFormGrains = [];
  let mashBillLibraryFormReferences = [];

  function renderMashBillLibraryFormGrainList() {
    els.mashBillLibraryFormGrainList.innerHTML = mashBillLibraryFormGrains.map((g, i) => `
      <div class="rating-chip" data-mashbill-form-index="${i}">
        <span>${escapeHtml(String(g.pct))}% ${escapeHtml(g.grain)}</span>
        <button type="button" data-action="remove-mashbill-form-grain" title="Remove">&times;</button>
      </div>
    `).join('');
  }

  // Same rating-chip pattern as the grain list above, just for the
  // References & Sources citations ({label, url, tags} - see
  // normalizeReferences in server/db.js).
  function renderMashBillLibraryFormReferenceList() {
    els.mashBillLibraryFormSourceList.innerHTML = mashBillLibraryFormReferences.map((r, i) => `
      <div class="rating-chip" data-mashbill-form-source-index="${i}">
        <span>${escapeHtml(r.label || r.url)}${r.tags && r.tags.length ? ` &middot; ${escapeHtml(r.tags.join(', '))}` : ''}</span>
        <button type="button" data-action="remove-mashbill-form-source" title="Remove">&times;</button>
      </div>
    `).join('');
  }

  // Clears the tag picker back to "nothing selected" - called after each
  // Add (the next source starts untagged) and when the form resets/loads a
  // different entry (existing references keep their own tags; the picker
  // only ever drives the *next* one to add).
  function resetMashBillLibraryFormSourceTags() {
    els.mashBillLibraryFormSourceTags.querySelectorAll('.toggle-btn').forEach((btn) => btn.classList.remove('is-active'));
  }

  function resetMashBillLibraryForm() {
    mashBillLibraryEditingId = null;
    mashBillLibraryFormGrains = [];
    mashBillLibraryFormReferences = [];
    els.mashBillLibraryFormTitleInput.value = '';
    els.mashBillLibraryFormDistilleryInput.value = '';
    els.mashBillLibraryFormParentCompanyInput.value = '';
    els.mashBillLibraryFormCategoryInput.value = '';
    els.mashBillLibraryFormSkuInput.value = '';
    els.mashBillLibraryFormPct.value = '';
    els.mashBillLibraryFormNoseInput.value = '';
    els.mashBillLibraryFormPalateInput.value = '';
    els.mashBillLibraryFormFinishInput.value = '';
    els.mashBillLibraryFormTastingSourceInput.value = '';
    els.mashBillLibraryFormConfidenceTier.value = 'unknown';
    els.mashBillLibraryFormConfidenceNoteInput.value = '';
    els.mashBillLibraryFormConfidenceVerifiedInput.value = '';
    els.mashBillLibraryFormSourceLabel.value = '';
    els.mashBillLibraryFormSourceUrl.value = '';
    resetMashBillLibraryFormSourceTags();
    renderMashBillLibraryFormGrainList();
    renderMashBillLibraryFormReferenceList();
    els.mashBillLibraryFormTitle.textContent = 'Add an entry manually';
    els.mashBillLibraryFormSaveBtn.textContent = 'Add Entry';
    els.mashBillLibraryFormCancelBtn.hidden = true;
    els.mashBillLibraryFormDeleteBtn.hidden = true;
    els.mashBillLibraryFormStatus.textContent = '';
  }

  function loadMashBillLibraryEntryIntoForm(entry) {
    mashBillLibraryEditingId = entry.id;
    mashBillLibraryFormGrains = entry.grains.map((g) => ({ grain: g.grain, pct: g.pct }));
    mashBillLibraryFormReferences = (entry.references || []).map((r) => ({ label: r.label, url: r.url, tags: r.tags || [] }));
    els.mashBillLibraryFormTitleInput.value = entry.title;
    els.mashBillLibraryFormDistilleryInput.value = entry.distillery || '';
    els.mashBillLibraryFormParentCompanyInput.value = entry.parentCompany || '';
    els.mashBillLibraryFormCategoryInput.value = entry.category || '';
    els.mashBillLibraryFormSkuInput.value = entry.sku || '';
    els.mashBillLibraryFormNoseInput.value = entry.nose || '';
    els.mashBillLibraryFormPalateInput.value = entry.palate || '';
    els.mashBillLibraryFormFinishInput.value = entry.finish || '';
    els.mashBillLibraryFormTastingSourceInput.value = entry.tastingSource || '';
    els.mashBillLibraryFormConfidenceTier.value = entry.confidence.tier || 'unknown';
    els.mashBillLibraryFormConfidenceNoteInput.value = entry.confidence.note || '';
    els.mashBillLibraryFormConfidenceVerifiedInput.value = entry.confidence.verifiedAt || '';
    resetMashBillLibraryFormSourceTags();
    renderMashBillLibraryFormGrainList();
    renderMashBillLibraryFormReferenceList();
    els.mashBillLibraryFormTitle.textContent = `Edit "${entry.title}"`;
    els.mashBillLibraryFormSaveBtn.textContent = 'Save Changes';
    els.mashBillLibraryFormCancelBtn.hidden = false;
    els.mashBillLibraryFormDeleteBtn.hidden = false;
    els.mashBillLibraryFormStatus.textContent = '';
    els.mashBillLibraryFormTitleInput.scrollIntoView({ block: 'nearest' });
  }

  // Describes the puller's own sync status (see mashBillSync.js's
  // getStatus) - not gated behind an "autoSync" flag the way
  // describeSyncStatus (the UPC export's own version, above) is, since
  // Mash Bill Library sync always runs, on every PC, unconditionally (see
  // that file's header comment for why).
  function describeMashBillSyncStatus(sync) {
    if (!sync) return '';
    if (sync.isServer) return 'This PC is the Server PC - this is the shared library other registers sync from.';
    const parts = [];
    parts.push(sync.lastSyncedAt
      ? `Last synced from ${sync.syncedFrom || 'the Server PC'} at ${formatHistoryTimestamp(sync.lastSyncedAt)}.`
      : 'Waiting for the first sync from the Server PC...');
    if (sync.lastError) parts.push(`⚠ ${withServerPcHint(sync.lastError)}`);
    return parts.join(' ');
  }

  // Deletes an entry from the Bourbon Library, then closes this form and
  // refreshes the library page underneath it (see the "Bourbon Library
  // (rail view)" section below) - the entry being deleted is always the one
  // currently open in this form (see els.mashBillLibraryFormDeleteBtn's own
  // click handler), so there's nothing left to keep editing once it
  // succeeds. If the deleted entry was the one currently open on the
  // profile page, that page falls back to the grid rather than showing a
  // profile for an entry that no longer exists.
  async function deleteMashBillLibraryEntry(id) {
    try {
      const resp = await fetch(`/api/mashbills/${id}`, { method: 'DELETE' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not delete that entry.');
      mashBillLibraryModal.close();
      await fetchMashBillLibrary();
      if (librarySelectedId === id) {
        librarySelectedId = null;
        libraryViewMode = 'grid';
      }
      renderLibraryChipsAndStats();
      renderLibraryBody();
    } catch (err) {
      els.mashBillLibraryFormStatus.textContent = withServerPcHint(err.message) || 'Could not delete that entry.';
    }
  }

  els.mashBillLibraryFormDeleteBtn.addEventListener('click', () => {
    if (mashBillLibraryEditingId === null) return;
    const title = els.mashBillLibraryFormTitleInput.value.trim();
    if (!confirm(`Delete "${title}" from the Bourbon Library? This can't be undone.`)) return;
    deleteMashBillLibraryEntry(mashBillLibraryEditingId);
  });

  const mashBillLibraryModal = createModal({
    overlay: els.mashBillLibraryOverlay,
    closeBtns: [els.mashBillLibraryCloseBtn, els.mashBillLibraryCloseFooterBtn],
    onOpen: resetMashBillLibraryForm,
  });

  els.libraryAddBtn.addEventListener('click', () => mashBillLibraryModal.open());

  function addMashBillLibraryFormGrain() {
    const grain = els.mashBillLibraryFormGrain.value;
    const pct = Number(els.mashBillLibraryFormPct.value.trim());
    if (!grain || !pct) return;
    mashBillLibraryFormGrains.push({ grain, pct });
    els.mashBillLibraryFormPct.value = '';
    renderMashBillLibraryFormGrainList();
  }
  els.mashBillLibraryFormAddGrainBtn.addEventListener('click', addMashBillLibraryFormGrain);
  els.mashBillLibraryFormPct.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addMashBillLibraryFormGrain(); }
  });

  els.mashBillLibraryFormGrainList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove-mashbill-form-grain"]');
    if (!btn) return;
    const idx = Number(btn.closest('[data-mashbill-form-index]').dataset.mashbillFormIndex);
    mashBillLibraryFormGrains.splice(idx, 1);
    renderMashBillLibraryFormGrainList();
  });

  function addMashBillLibraryFormReference() {
    const label = els.mashBillLibraryFormSourceLabel.value.trim();
    const url = els.mashBillLibraryFormSourceUrl.value.trim();
    if (!url) return;
    const tags = [...els.mashBillLibraryFormSourceTags.querySelectorAll('.toggle-btn.is-active')].map((btn) => btn.dataset.tag);
    mashBillLibraryFormReferences.push({ label, url, tags });
    els.mashBillLibraryFormSourceLabel.value = '';
    els.mashBillLibraryFormSourceUrl.value = '';
    resetMashBillLibraryFormSourceTags();
    renderMashBillLibraryFormReferenceList();
  }
  els.mashBillLibraryFormAddSourceBtn.addEventListener('click', addMashBillLibraryFormReference);
  els.mashBillLibraryFormSourceUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addMashBillLibraryFormReference(); }
  });

  els.mashBillLibraryFormSourceTags.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    btn.classList.toggle('is-active');
  });

  els.mashBillLibraryFormSourceList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove-mashbill-form-source"]');
    if (!btn) return;
    const idx = Number(btn.closest('[data-mashbill-form-source-index]').dataset.mashbillFormSourceIndex);
    mashBillLibraryFormReferences.splice(idx, 1);
    renderMashBillLibraryFormReferenceList();
  });

  els.mashBillLibraryFormCancelBtn.addEventListener('click', resetMashBillLibraryForm);

  els.mashBillLibraryFormSaveBtn.addEventListener('click', async () => {
    const title = els.mashBillLibraryFormTitleInput.value.trim();
    if (!title) {
      els.mashBillLibraryFormStatus.textContent = 'A product title is required.';
      return;
    }
    if (!mashBillLibraryFormGrains.length) {
      els.mashBillLibraryFormStatus.textContent = 'Add at least one grain first.';
      return;
    }
    els.mashBillLibraryFormSaveBtn.disabled = true;
    els.mashBillLibraryFormStatus.textContent = 'Saving...';
    try {
      const payload = {
        title,
        distillery: els.mashBillLibraryFormDistilleryInput.value.trim(),
        grains: mashBillLibraryFormGrains,
        source: 'Manual',
        parentCompany: els.mashBillLibraryFormParentCompanyInput.value.trim(),
        category: els.mashBillLibraryFormCategoryInput.value.trim(),
        sku: els.mashBillLibraryFormSkuInput.value.trim(),
        nose: els.mashBillLibraryFormNoseInput.value.trim(),
        palate: els.mashBillLibraryFormPalateInput.value.trim(),
        finish: els.mashBillLibraryFormFinishInput.value.trim(),
        tastingSource: els.mashBillLibraryFormTastingSourceInput.value.trim(),
        confidence: {
          tier: els.mashBillLibraryFormConfidenceTier.value,
          note: els.mashBillLibraryFormConfidenceNoteInput.value.trim(),
          verifiedAt: els.mashBillLibraryFormConfidenceVerifiedInput.value,
        },
        references: mashBillLibraryFormReferences,
      };
      const resp = mashBillLibraryEditingId
        ? await fetch(`/api/mashbills/${mashBillLibraryEditingId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
        : await fetch('/api/mashbills', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not save that entry.');
      mashBillLibraryModal.close();
      await fetchMashBillLibrary();
      // Jumps straight to the saved entry's profile page rather than back
      // to the grid - useful feedback either way (confirms an edit stuck,
      // shows off a new entry right after adding it) and works for both
      // since data.id is the same row whether this was a POST or a PUT.
      librarySelectedId = data.id;
      libraryViewMode = 'profile';
      renderLibraryChipsAndStats();
      renderLibraryBody();
    } catch (err) {
      els.mashBillLibraryFormStatus.textContent = withServerPcHint(err.message) || 'Could not save that entry.';
    } finally {
      els.mashBillLibraryFormSaveBtn.disabled = false;
    }
  });

  // ---------- Bourbon Library (rail view) ----------
  //
  // A browse/profile screen over the shared mash_bills data - search, a
  // confidence-tier filter, a card grid, and a profile page per entry.
  // Adding/editing/deleting goes through the form modal above (opened via
  // #libraryAddBtn below, or the profile page's own Edit button); this
  // section itself never writes anything, only reads mashBillLibraryCache
  // and re-fetches it after the form modal changes something.

  const CONFIDENCE_TIER_META = {
    confirmed: {
      label: 'Confirmed', dots: 4, colorVar: '--ui-good', tintVar: '--ui-good-tint',
    },
    reported: {
      label: 'Reported', dots: 3, colorVar: '--ui-warn', tintVar: '--ui-warn-tint',
    },
    estimated: {
      label: 'Estimated', dots: 2, colorVar: '--ui-low', tintVar: '--ui-low-tint',
    },
    unknown: {
      label: 'Unknown', dots: 0, colorVar: '--ui-muted', tintVar: '--ui-code-bg',
    },
  };

  function confidenceTierMeta(tier) {
    return CONFIDENCE_TIER_META[tier] || CONFIDENCE_TIER_META.unknown;
  }

  function confidenceBadgeHtml(tier) {
    const meta = confidenceTierMeta(tier);
    return `<span class="conf-badge" style="color:var(${meta.colorVar});background:var(${meta.tintVar});">${escapeHtml(meta.label)}</span>`;
  }

  function confidenceMeterHtml(tier) {
    const meta = confidenceTierMeta(tier);
    const dots = [0, 1, 2, 3].map((i) => `<span class="${i < meta.dots ? 'is-on' : ''}"></span>`).join('');
    return `<span class="conf-meter" style="color:var(${meta.colorVar});">${dots}</span>`;
  }

  // Extended grain color palette for the Bourbon Library (bar, donut chart,
  // legend) - deliberately separate from MASH_BILL_GRAIN_COLORS in card.js,
  // which is a closed 6-grain list matched against the Mash Bill builder's
  // own <select> for the printed talker. Library research entries carry
  // real-world grain names outside that list (wheat/barley sub-types, a
  // smoked malt), grouped here by family so a legend full of "malted X"
  // entries still reads as related rather than falling back to one grey
  // swatch that makes several different grains indistinguishable.
  const LIBRARY_GRAIN_COLORS = {
    Corn: '#d9a441',
    Rye: '#8a3a2c',
    Wheat: '#c9b464',
    'Malted Barley': '#a67c3d',
    'Malted Rye': '#6e2a1f',
    Oat: '#ddd0ad',
    Oats: '#ddd0ad',
    Barley: '#c7b78f',
    'Red Winter Wheat': '#b89a4e',
    'Texas Winter Wheat': '#cfa646',
    'Malted Wheat': '#e0c583',
    'Honey Malted Barley': '#c99a4a',
    'Caramel Malted Barley': '#8f6a30',
    "6-Row Distiller's Malt": '#b6903f',
    'Mesquite Smoked Malt': '#5f4a37',
  };
  const LIBRARY_GRAIN_FALLBACK_COLOR = '#b8ab98';

  function libraryGrainColor(grain) {
    return LIBRARY_GRAIN_COLORS[grain] || LIBRARY_GRAIN_FALLBACK_COLOR;
  }

  function grainBarHtml(grains) {
    if (!grains || !grains.length) return '<div class="grain-bar grain-bar--empty"></div>';
    const segs = grains.map((g) => `<span style="width:${g.pct}%;background:${libraryGrainColor(g.grain)}"></span>`).join('');
    return `<div class="grain-bar">${segs}</div>`;
  }

  // A handful of "Unknown"-tier entries carry a single 100%-corn grain row
  // as a schema placeholder rather than a real finding (see the seed data's
  // own confidence notes - "Placeholder only, not a finding"), for products
  // whose actual mash bill/sourcing isn't disclosed anywhere (KBD/Willett
  // labels, undisclosed specialty barrels, etc.). A single grain at 100% is
  // also how a handful of *real* single-grain whiskeys are recorded (New
  // Riff's single malt, Woodinville's 100% rye), so the tier is what
  // separates the two - every real single-grain entry in the library is
  // Confirmed/Reported/Estimated, never Unknown.
  function isPlaceholderMashBill(entry) {
    return entry.confidence.tier === 'unknown'
      && Array.isArray(entry.grains) && entry.grains.length === 1 && entry.grains[0].pct === 100;
  }

  function polarToXY(cx, cy, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function mashBillArcPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
    const large = endAngle - startAngle > 180 ? 1 : 0;
    const p1 = polarToXY(cx, cy, rOuter, startAngle);
    const p2 = polarToXY(cx, cy, rOuter, endAngle);
    const p3 = polarToXY(cx, cy, rInner, endAngle);
    const p4 = polarToXY(cx, cy, rInner, startAngle);
    return [
      `M ${p1.x} ${p1.y}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x} ${p2.y}`,
      `L ${p3.x} ${p3.y}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${p4.x} ${p4.y}`,
      'Z',
    ].join(' ');
  }

  // Donut chart for a Mash Bill's grain list, on the profile page only (the
  // printed talker keeps buildMashBillHtml's stacked bar in card.js - see
  // "Compare to bar" below). The center callout shows the dominant grain's
  // own percentage/name, and any slice wide enough to hold a label (>=14%)
  // prints its exact percentage directly on it, since a legend alone forces
  // a reader to match colors by eye across the chart.
  function mashBillDonutHtml(grains, isPlaceholder) {
    const cx = 84;
    const cy = 84;
    const rOuter = 78;
    const rInner = 46;
    if (isPlaceholder) {
      return `
        <div class="donut-wrap">
          <svg viewBox="0 0 168 168"><circle cx="${cx}" cy="${cy}" r="${(rOuter + rInner) / 2}" fill="none" stroke="var(--ui-border)" stroke-width="${rOuter - rInner}" stroke-dasharray="5 6" opacity="0.7"></circle></svg>
          <div class="donut-center">
            <div class="donut-center__pct" style="font-size:0.8rem;color:var(--ui-muted);">Not yet<br>researched</div>
          </div>
        </div>
      `;
    }
    let angle = 0;
    const dominant = grains.reduce((a, b) => (b.pct > a.pct ? b : a), grains[0]);
    const slices = grains.map(({ grain, pct }) => {
      const start = angle;
      const end = angle + (pct / 100) * 360;
      angle = end;
      const mid = (start + end) / 2;
      const labelPos = polarToXY(cx, cy, (rOuter + rInner) / 2, mid);
      const showLabel = pct >= 14;
      return `<path class="donut-slice" data-grain="${escapeHtml(grain)}" d="${mashBillArcPath(cx, cy, rOuter, rInner, start, end)}" fill="${libraryGrainColor(grain)}"></path>
        ${showLabel ? `<text class="donut-slice-label" x="${labelPos.x}" y="${labelPos.y}">${pct}%</text>` : ''}`;
    }).join('');
    return `
      <div class="donut-wrap">
        <svg viewBox="0 0 168 168">${slices}</svg>
        <div class="donut-center">
          <div class="donut-center__pct">${dominant.pct}%</div>
          <div class="donut-center__grain">${escapeHtml(dominant.grain)}</div>
        </div>
      </div>
    `;
  }

  function mashBillLegendHtml(grains, isPlaceholder) {
    return grains.map(({ grain, pct }) => `
      <div class="grain-legend2__row" data-grain="${escapeHtml(grain)}">
        <span class="grain-legend2__swatch" style="background:${isPlaceholder ? 'var(--ui-border)' : libraryGrainColor(grain)}"></span>
        <span class="grain-legend2__name">${escapeHtml(grain)}</span>
        <span class="grain-legend2__pct">${isPlaceholder ? 'N/A' : `${pct}%`}</span>
      </div>
    `).join('');
  }

  function mashBillVizHtml(grains, isPlaceholder) {
    if (!grains || !grains.length) return grainBarHtml(grains);
    return `
      <div class="mashbill-viz">
        ${mashBillDonutHtml(grains, isPlaceholder)}
        <div class="grain-legend2">${mashBillLegendHtml(grains, isPlaceholder)}</div>
      </div>
      ${isPlaceholder ? '<div class="placeholder-note">&#9888; This entry\'s mash bill hasn\'t been researched yet - the grain listed is a schema placeholder, not a real recipe. See its confidence note below.</div>' : ''}
    `;
  }

  // Grain FAMILIES, not literal grain strings - classic wheated bourbons
  // (Weller, Maker's Mark) record their secondary grain as "Red Winter
  // Wheat", not "Wheat", so a literal match on "Wheat" would silently miss
  // every one of them. Each family sums every matching grain row's
  // percentage per entry, for the "Most X %" sorts below.
  const LIBRARY_GRAIN_FAMILIES = {
    corn: ['Corn'],
    rye: ['Rye', 'Malted Rye'],
    wheat: ['Wheat', 'Malted Wheat', 'Red Winter Wheat', 'Texas Winter Wheat'],
    barley: ['Barley', 'Malted Barley', 'Honey Malted Barley', 'Caramel Malted Barley', "6-Row Distiller's Malt"],
  };
  function libraryFamilyPct(entry, family) {
    const names = LIBRARY_GRAIN_FAMILIES[family];
    return (entry.grains || []).reduce((sum, g) => (names.includes(g.grain) ? sum + g.pct : sum), 0);
  }
  function libraryGrainCount(entry) {
    return (entry.grains || []).length;
  }

  const CONFIDENCE_TIER_RANK = {
    confirmed: 0, reported: 1, estimated: 2, unknown: 3,
  };
  // Sort options for the library grid, grouped for the dropdown. `metric`
  // (when set) picks which adaptive chip librarySortMetricHtml shows on
  // every card/row - the field actually being sorted on, not just the
  // resulting order. Alphabetical/Confidence sorts have no metric, so they
  // fall back to the confidence badge, the library's existing at-a-glance
  // signal.
  const LIBRARY_SORTS = [
    { group: 'Alphabetical', key: 'name-asc', label: 'Name (A–Z)', cmp: (a, b) => a.title.localeCompare(b.title) },
    { group: 'Alphabetical', key: 'name-desc', label: 'Name (Z–A)', cmp: (a, b) => b.title.localeCompare(a.title) },
    { group: 'Alphabetical', key: 'distillery-asc', label: 'Distillery (A–Z)', cmp: (a, b) => (a.distillery || '').localeCompare(b.distillery || '') || a.title.localeCompare(b.title) },
    { group: 'Confidence', key: 'conf-best', label: 'Confirmed first', cmp: (a, b) => CONFIDENCE_TIER_RANK[a.confidence.tier] - CONFIDENCE_TIER_RANK[b.confidence.tier] || a.title.localeCompare(b.title) },
    { group: 'Confidence', key: 'conf-needs', label: 'Needs verification first', cmp: (a, b) => CONFIDENCE_TIER_RANK[b.confidence.tier] - CONFIDENCE_TIER_RANK[a.confidence.tier] || a.title.localeCompare(b.title) },
    { group: 'Grain %', key: 'most-corn', label: 'Most Corn %', metric: 'corn', cmp: (a, b) => libraryFamilyPct(b, 'corn') - libraryFamilyPct(a, 'corn') || a.title.localeCompare(b.title) },
    { group: 'Grain %', key: 'most-rye', label: 'Most Rye %', metric: 'rye', cmp: (a, b) => libraryFamilyPct(b, 'rye') - libraryFamilyPct(a, 'rye') || a.title.localeCompare(b.title) },
    { group: 'Grain %', key: 'most-wheat', label: 'Most Wheat %', metric: 'wheat', cmp: (a, b) => libraryFamilyPct(b, 'wheat') - libraryFamilyPct(a, 'wheat') || a.title.localeCompare(b.title) },
    { group: 'Grain %', key: 'most-barley', label: 'Most Malted Barley %', metric: 'barley', cmp: (a, b) => libraryFamilyPct(b, 'barley') - libraryFamilyPct(a, 'barley') || a.title.localeCompare(b.title) },
    { group: 'Recipe', key: 'simplest', label: 'Simplest recipe (fewest grains)', metric: 'grains', cmp: (a, b) => libraryGrainCount(a) - libraryGrainCount(b) || a.title.localeCompare(b.title) },
    { group: 'Recipe', key: 'complex', label: 'Most complex recipe (most grains)', metric: 'grains', cmp: (a, b) => libraryGrainCount(b) - libraryGrainCount(a) || a.title.localeCompare(b.title) },
    { group: 'SKU', key: 'sku-asc', label: 'SKU (Low–High)', metric: 'sku', cmp: (a, b) => (Number(a.sku) || Infinity) - (Number(b.sku) || Infinity) || a.title.localeCompare(b.title) },
  ];
  const LIBRARY_SORTS_BY_KEY = Object.fromEntries(LIBRARY_SORTS.map((s) => [s.key, s]));

  // Card/List and the chosen sort persist per PC (localStorage), the same
  // spirit as QUEUE_COLUMN_KEY above - staff shouldn't have to reselect
  // List + Most Rye every time they open the Library.
  const LIBRARY_GRID_VIEW_KEY = 'shelfTalkerLibraryGridView.v1';
  const LIBRARY_SORT_KEY = 'shelfTalkerLibrarySortKey.v1';
  function loadLibraryGridView() {
    try {
      return localStorage.getItem(LIBRARY_GRID_VIEW_KEY) === 'list' ? 'list' : 'card';
    } catch {
      return 'card';
    }
  }
  function loadLibrarySortKey() {
    try {
      const saved = localStorage.getItem(LIBRARY_SORT_KEY);
      return LIBRARY_SORTS_BY_KEY[saved] ? saved : 'name-asc';
    } catch {
      return 'name-asc';
    }
  }

  let libraryFilterQuery = '';
  let libraryTierFilter = 'all';
  let libraryViewMode = 'grid';
  let librarySelectedId = null;
  let librarySyncPollTimer = null;
  let libraryShowGrainBar = false;
  let libraryGridView = loadLibraryGridView();
  let librarySortKey = loadLibrarySortKey();

  // Parent Company browse (renderCompaniesView/renderCompanyResults/
  // renderCompanyDetail below) - two more libraryViewMode values
  // ('companies', 'companyDetail') alongside the existing 'grid'/'profile'
  // pair, reached via the "Parent companies" stat becoming a button (see
  // renderLibraryChipsAndStats).
  let libraryCompanyQuery = '';
  let libraryCompanySort = 'count'; // 'count' | 'alpha'
  let librarySelectedCompany = null;
  // Where a bourbon profile's "back" breadcrumb should return to - set
  // whenever something navigates into 'profile' mode, so opening a bourbon
  // from inside a company's own bourbon list returns there instead of
  // always landing back on the full grid.
  let libraryProfileReturnTo = { mode: 'grid', company: null };

  // Bucket thresholds for the three company tiers below - static cutoffs
  // chosen against the library's shape when this shipped (Beam Suntory's
  // 30 down to Diageo's 13 for Featured, down to 5 for Major) rather than
  // computed proportionally, so five tiles don't become fifteen (or zero)
  // the next time the library's overall size changes. Revisit these if the
  // library's size or its spread across companies shifts a lot.
  const COMPANY_FEATURED_MIN = 13;
  const COMPANY_MAJOR_MIN = 5;

  function libraryMatchesFilter(entry) {
    const tier = entry.confidence.tier;
    if (libraryTierFilter === 'confirmed') return tier === 'confirmed';
    if (libraryTierFilter === 'reported') return tier === 'reported';
    if (libraryTierFilter === 'needs') return tier === 'estimated' || tier === 'unknown';
    return true;
  }

  function libraryMatchesSearch(entry) {
    const q = libraryFilterQuery.trim().toLowerCase();
    if (!q) return true;
    return (entry.title || '').toLowerCase().includes(q)
      || (entry.distillery || '').toLowerCase().includes(q)
      || (entry.parentCompany || '').toLowerCase().includes(q)
      || (entry.sku || '').toLowerCase().includes(q);
  }

  function renderLibraryChipsAndStats() {
    const counts = {
      all: mashBillLibraryCache.length,
      confirmed: mashBillLibraryCache.filter((m) => m.confidence.tier === 'confirmed').length,
      reported: mashBillLibraryCache.filter((m) => m.confidence.tier === 'reported').length,
      needs: mashBillLibraryCache.filter((m) => m.confidence.tier === 'estimated' || m.confidence.tier === 'unknown').length,
    };
    const chips = [
      { key: 'all', label: `All bourbons (${counts.all})` },
      { key: 'confirmed', label: `Confirmed (${counts.confirmed})` },
      { key: 'reported', label: `Reported (${counts.reported})` },
      { key: 'needs', label: `Needs verification (${counts.needs})` },
    ];
    els.libraryChips.innerHTML = chips.map((c) => `
      <button type="button" class="toggle-btn ${libraryTierFilter === c.key ? 'is-active' : ''}" data-tier="${c.key}">${escapeHtml(c.label)}</button>
    `).join('');
    els.libraryChips.querySelectorAll('button[data-tier]').forEach((btn) => {
      btn.addEventListener('click', () => {
        libraryTierFilter = btn.dataset.tier;
        libraryViewMode = 'grid';
        renderLibraryChipsAndStats();
        renderLibraryBody();
      });
    });
    const companyCount = new Set(mashBillLibraryCache.map((m) => m.parentCompany).filter(Boolean)).size;
    els.libraryStats.innerHTML = `
      <div class="library-stat"><b>${mashBillLibraryCache.length}</b><span>Bourbons</span></div>
      <div class="library-stat"><b>${new Set(mashBillLibraryCache.map((m) => m.distillery).filter(Boolean)).size}</b><span>Distilleries</span></div>
      <button type="button" class="library-stat library-stat--link" id="libraryCompaniesStatBtn">
        <span class="library-stat__main"><b>${companyCount}</b><span>Parent companies</span></span>
        <span class="library-stat__chevron" aria-hidden="true">&rsaquo;</span>
      </button>
      <div class="library-stat"><b>${counts.needs}</b><span>Need verification</span></div>
    `;
    document.getElementById('libraryCompaniesStatBtn').addEventListener('click', () => {
      libraryViewMode = 'companies';
      renderLibraryBody();
    });
  }

  // The metric chip shown on every card/row - whichever field the active
  // sort is actually ordering by, not just the resulting order.
  function librarySortMetricHtml(entry, sort) {
    if (sort.metric === 'corn' || sort.metric === 'rye' || sort.metric === 'wheat' || sort.metric === 'barley') {
      const pct = libraryFamilyPct(entry, sort.metric);
      const names = LIBRARY_GRAIN_FAMILIES[sort.metric];
      const swatchGrain = (entry.grains || []).find((g) => names.includes(g.grain));
      const color = swatchGrain ? libraryGrainColor(swatchGrain.grain) : 'var(--ui-border)';
      return `<span class="sort-metric"><span class="sort-metric__swatch" style="background:${color}"></span>${pct}%</span>`;
    }
    if (sort.metric === 'grains') {
      const n = libraryGrainCount(entry);
      return `<span class="sort-metric">${n} grain${n === 1 ? '' : 's'}</span>`;
    }
    if (sort.metric === 'sku') {
      return `<span class="sort-metric">${entry.sku ? `SKU ${escapeHtml(entry.sku)}` : 'No SKU'}</span>`;
    }
    return confidenceBadgeHtml(entry.confidence.tier);
  }

  function bourbonCardHtml(entry, sort) {
    return `
      <button type="button" class="bourbon-card" data-id="${entry.id}">
        <div class="bourbon-card__title">${escapeHtml(entry.title)}</div>
        <div class="bourbon-card__sub">${escapeHtml(entry.distillery || 'Distillery unknown')}</div>
        ${grainBarHtml(entry.grains)}
        <div class="bourbon-card__footer">
          <span class="bourbon-card__sub">${escapeHtml(entry.category || '')}</span>
          ${librarySortMetricHtml(entry, sort)}
        </div>
      </button>
    `;
  }

  function bourbonRowHtml(entry, sort) {
    return `
      <button type="button" class="bourbon-row" data-id="${entry.id}">
        <div>
          <div class="bourbon-row__title">${escapeHtml(entry.title)}</div>
          <div class="bourbon-row__sub">${escapeHtml(entry.distillery || 'Distillery unknown')}${entry.category ? ` &middot; ${escapeHtml(entry.category)}` : ''}</div>
        </div>
        ${librarySortMetricHtml(entry, sort)}
        <span class="bourbon-row__chevron" aria-hidden="true">&rsaquo;</span>
      </button>
    `;
  }

  function librarySortDropdownHtml() {
    const groups = [];
    LIBRARY_SORTS.forEach((s) => {
      if (!groups.length || groups[groups.length - 1].group !== s.group) groups.push({ group: s.group, items: [] });
      groups[groups.length - 1].items.push(s);
    });
    return groups.map((g) => `
      <div class="field-select__group-label">${escapeHtml(g.group)}</div>
      ${g.items.map((s) => `
        <button type="button" class="field-select__option" role="option" data-sort="${s.key}" aria-selected="${s.key === librarySortKey}">
          <span class="field-select__option-check" aria-hidden="true">&#10003;</span>
          <span class="field-select__option-label">${escapeHtml(s.label)}</span>
        </button>
      `).join('')}
    `).join('');
  }

  function renderLibraryGrid() {
    const rows = mashBillLibraryCache.filter((m) => libraryMatchesFilter(m) && libraryMatchesSearch(m));
    const sort = LIBRARY_SORTS_BY_KEY[librarySortKey];
    rows.sort(sort.cmp);

    const toolbarHtml = `
      <div class="results-toolbar">
        <span class="results-toolbar__count">${rows.length} bourbon${rows.length === 1 ? '' : 's'}</span>
        <div class="results-toolbar__controls">
          <div class="preview-toggle" role="group" aria-label="Grid layout">
            <button type="button" class="toggle-btn ${libraryGridView === 'card' ? 'is-active' : ''}" data-view="card">Card</button>
            <button type="button" class="toggle-btn ${libraryGridView === 'list' ? 'is-active' : ''}" data-view="list">List</button>
          </div>
          <div class="field-select" id="librarySortSelect">
            <button type="button" class="field-select__trigger" id="librarySortTrigger" aria-haspopup="listbox" aria-expanded="false">
              <span class="field-select__value">${escapeHtml(sort.label)}</span>
              <svg class="field-select__chevron" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div class="field-select__dropdown" role="listbox">${librarySortDropdownHtml()}</div>
          </div>
        </div>
      </div>
    `;

    if (!rows.length) {
      els.libraryBody.innerHTML = `${toolbarHtml}<p class="help-text">No bourbons match this search/filter.</p>`;
    } else {
      const resultsHtml = libraryGridView === 'list'
        ? `<div class="bourbon-list">${rows.map((e) => bourbonRowHtml(e, sort)).join('')}</div>`
        : `<div class="bourbon-grid">${rows.map((e) => bourbonCardHtml(e, sort)).join('')}</div>`;
      els.libraryBody.innerHTML = toolbarHtml + resultsHtml;
    }

    els.libraryBody.querySelectorAll('.bourbon-card[data-id], .bourbon-row[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        librarySelectedId = Number(btn.dataset.id);
        libraryProfileReturnTo = { mode: 'grid', company: null };
        libraryViewMode = 'profile';
        libraryShowGrainBar = false;
        renderLibraryBody();
      });
    });
    els.libraryBody.querySelectorAll('.preview-toggle button[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        libraryGridView = btn.dataset.view;
        try { localStorage.setItem(LIBRARY_GRID_VIEW_KEY, libraryGridView); } catch { /* choice just won't survive a restart */ }
        renderLibraryGrid();
      });
    });
    const sortTrigger = document.getElementById('librarySortTrigger');
    if (sortTrigger) {
      sortTrigger.addEventListener('click', () => {
        const wrap = document.getElementById('librarySortSelect');
        const isOpen = wrap.classList.toggle('is-open');
        sortTrigger.setAttribute('aria-expanded', String(isOpen));
      });
    }
    els.libraryBody.querySelectorAll('.field-select__option[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        librarySortKey = btn.dataset.sort;
        try { localStorage.setItem(LIBRARY_SORT_KEY, librarySortKey); } catch { /* choice just won't survive a restart */ }
        renderLibraryGrid();
      });
    });
  }

  // Numbered <a class="cite"> markers for a profile-page heading, one per
  // reference tagged with that section - each jumps down to its numbered
  // row in referencesSectionHtml's list below. References are numbered by
  // their position in entry.references, so the same reference always gets
  // the same marker/anchor regardless of which heading is asking.
  function citeMarkersHtml(references, tag) {
    return references
      .map((r, i) => ({ r, n: i + 1 }))
      .filter(({ r }) => (r.tags || []).includes(tag))
      .map(({ n }) => `<a class="cite" href="#ref-${n}" title="Jump to source ${n}">${n}</a>`)
      .join('');
  }

  // The unified "References & Sources" section - every citation on the
  // entry (regardless of which field(s) it backs, see REFERENCE_TAGS in
  // server/db.js) in one list, so where an entry's information comes from
  // is never hidden a level down inside just the Mash Bill block.
  function referencesSectionHtml(entry) {
    const refs = entry.references || [];
    if (!refs.length) return '';
    const rows = refs.map((r, i) => `
      <div class="ref-row" id="ref-${i + 1}">
        <div class="ref-row__n">${i + 1}</div>
        <div class="ref-row__main">
          ${r.url
    ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.label || r.url)}</a>
             <span class="ref-row__url">${escapeHtml(r.url)}</span>`
    : `<span>${escapeHtml(r.label)}</span>`}
          ${r.tags && r.tags.length ? `<div class="ref-row__tags">${r.tags.map((t) => `<span class="ref-row__tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
    `).join('');
    return `
      <div class="block refs">
        <div class="refs__head">
          <h3>References &amp; Sources</h3>
          <span>${refs.length} source${refs.length === 1 ? '' : 's'} cited</span>
        </div>
        ${rows}
      </div>
    `;
  }

  function renderBourbonProfile() {
    const entry = mashBillLibraryCache.find((m) => m.id === librarySelectedId);
    if (!entry) {
      libraryViewMode = 'grid';
      renderLibraryBody();
      return;
    }
    const siblings = mashBillLibraryCache.filter((m) => m.id !== entry.id && entry.distillery && m.distillery === entry.distillery);
    const refs = entry.references || [];
    const tastingHtml = (entry.nose || entry.palate || entry.finish) ? `
      <div class="block">
        <h3>Tasting Notes${citeMarkersHtml(refs, 'Tasting Notes')}</h3>
        <div class="tasting-grid">
          <div class="tasting-card"><h4>Nose</h4><p>${escapeHtml(entry.nose || '—')}</p></div>
          <div class="tasting-card"><h4>Palate</h4><p>${escapeHtml(entry.palate || '—')}</p></div>
          <div class="tasting-card"><h4>Finish</h4><p>${escapeHtml(entry.finish || '—')}</p></div>
        </div>
        ${entry.tastingSource ? `<div class="tasting-source">Source: ${escapeHtml(entry.tastingSource)}</div>` : ''}
      </div>` : '';

    const returnToCompany = libraryProfileReturnTo.mode === 'companyDetail' && libraryProfileReturnTo.company;
    const backLabel = returnToCompany ? libraryProfileReturnTo.company : 'Bourbon Library';
    const isPlaceholder = isPlaceholderMashBill(entry);

    els.libraryBody.innerHTML = `
      <div class="library-crumb">
        <button type="button" id="libraryCrumbBack"><span aria-hidden="true">&larr;</span> ${escapeHtml(backLabel)}</button>
        <span class="library-crumb__sep">/</span>
        <span class="library-crumb__current">${escapeHtml(entry.title)}</span>
      </div>
      <div class="profile-head">
        <div>
          <h2>${escapeHtml(entry.title)}</h2>
          <p class="profile-head__by">${escapeHtml(entry.distillery || 'Distillery unknown')}${entry.parentCompany ? ` &middot; <strong>${escapeHtml(entry.parentCompany)}</strong>` : ''}</p>
          ${entry.category ? `<div class="profile-tags"><span class="tag">${escapeHtml(entry.category)}</span></div>` : ''}
        </div>
        <button type="button" class="btn btn--small" id="libraryEditBtn">Edit</button>
      </div>
      <div class="profile-grid">
        <div>
          <div class="block">
            <h3>Mash Bill${citeMarkersHtml(refs, 'Mash Bill')}</h3>
            ${mashBillVizHtml(entry.grains, isPlaceholder)}
            <div class="conf-block">
              <div class="conf-block__row">
                ${confidenceBadgeHtml(entry.confidence.tier)}
                ${confidenceMeterHtml(entry.confidence.tier)}
                ${entry.grains && entry.grains.length && !isPlaceholder ? `<button type="button" class="btn btn--small" id="libraryToggleBarBtn" style="margin-left:auto;">${libraryShowGrainBar ? 'Hide' : 'Compare to'} bar</button>` : ''}
              </div>
              ${libraryShowGrainBar && entry.grains && entry.grains.length && !isPlaceholder ? `
                <span class="compare-strip__label">Today's bar, for comparison:</span>
                ${grainBarHtml(entry.grains)}
              ` : ''}
              ${entry.confidence.note ? `<p class="conf-block__note">${escapeHtml(entry.confidence.note)}</p>` : ''}
              ${entry.confidence.verifiedAt ? `<div class="conf-block__verified">Last verified ${escapeHtml(entry.confidence.verifiedAt)}</div>` : ''}
            </div>
          </div>
          ${tastingHtml}
        </div>
        <div class="block info-card">
          <h3>Distillery &amp; Ownership${citeMarkersHtml(refs, 'Distillery & Ownership')}</h3>
          <dl>
            <div><dt>Distillery</dt><dd>${escapeHtml(entry.distillery || 'Unknown')}</dd></div>
            ${entry.parentCompany ? `<div><dt>Parent company</dt><dd>${escapeHtml(entry.parentCompany)}</dd></div>` : ''}
            ${entry.category ? `<div><dt>Style</dt><dd>${escapeHtml(entry.category)}</dd></div>` : ''}
            ${entry.sku ? `<div><dt>SKU</dt><dd>${escapeHtml(entry.sku)}</dd></div>` : ''}
            ${entry.sku ? `<div><dt>Price</dt><dd id="libraryPriceValue" class="help-text" role="status" aria-live="polite">Checking the WinePOS export&hellip;</dd></div>` : ''}
          </dl>
          ${siblings.length ? `
            <dt class="info-card__siblings-label">Other ${escapeHtml(entry.distillery)} entries</dt>
            <div class="sibling-list">
              ${siblings.map((s) => `<button type="button" class="sibling-btn" data-id="${s.id}"><span>${escapeHtml(s.title)}</span>${confidenceBadgeHtml(s.confidence.tier)}</button>`).join('')}
            </div>` : ''}
        </div>
      </div>
      ${referencesSectionHtml(entry)}
    `;
    document.getElementById('libraryEditBtn').addEventListener('click', () => {
      mashBillLibraryModal.open();
      loadMashBillLibraryEntryIntoForm(entry);
    });
    document.getElementById('libraryCrumbBack').addEventListener('click', () => {
      librarySelectedId = null;
      if (returnToCompany) {
        librarySelectedCompany = libraryProfileReturnTo.company;
        libraryViewMode = 'companyDetail';
      } else {
        libraryViewMode = 'grid';
      }
      renderLibraryBody();
    });
    els.libraryBody.querySelectorAll('.sibling-btn[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        librarySelectedId = Number(btn.dataset.id);
        libraryShowGrainBar = false;
        renderBourbonProfile();
      });
    });
    const toggleBarBtn = document.getElementById('libraryToggleBarBtn');
    if (toggleBarBtn) {
      toggleBarBtn.addEventListener('click', () => {
        libraryShowGrainBar = !libraryShowGrainBar;
        renderBourbonProfile();
      });
    }
    // Hovering a donut slice highlights its legend row and vice versa, so a
    // reader can match a color to its exact percentage either direction.
    const donutWrap = els.libraryBody.querySelector('.donut-wrap');
    const legendWrap = els.libraryBody.querySelector('.grain-legend2');
    if (donutWrap && legendWrap) {
      const setHotGrain = (grain, on) => {
        donutWrap.querySelectorAll(`.donut-slice[data-grain="${CSS.escape(grain)}"]`).forEach((el) => el.classList.toggle('is-hot', on));
        legendWrap.querySelectorAll(`.grain-legend2__row[data-grain="${CSS.escape(grain)}"]`).forEach((el) => el.classList.toggle('is-hot', on));
      };
      donutWrap.querySelectorAll('.donut-slice').forEach((el) => {
        el.addEventListener('mouseenter', () => setHotGrain(el.dataset.grain, true));
        el.addEventListener('mouseleave', () => setHotGrain(el.dataset.grain, false));
      });
      legendWrap.querySelectorAll('.grain-legend2__row').forEach((el) => {
        el.addEventListener('mouseenter', () => setHotGrain(el.dataset.grain, true));
        el.addEventListener('mouseleave', () => setHotGrain(el.dataset.grain, false));
      });
    }
    if (entry.sku) loadBourbonLibraryPrice(entry);
  }

  // Fills in the Price row renderBourbonProfile leaves as "Checking the
  // WinePOS export..." - a live lookup (see /api/export-price ->
  // lookupSkuInExport in upcCatalog.js) against the entry's own `sku`
  // rather than a price stored on the library entry itself, since a bottle's
  // shelf price drifts and this is meant to reflect what's on the shelf
  // today, not what it cost when the SKU was typed in. Checks
  // librarySelectedId (rather than just patching the DOM blind) before
  // applying the result, so a slow request that resolves after staff have
  // already clicked into a different bourbon can't overwrite that entry's
  // own Price row with this one's answer.
  async function loadBourbonLibraryPrice(entry) {
    let data;
    try {
      const res = await fetch(`/api/export-price?sku=${encodeURIComponent(entry.sku)}`);
      data = await res.json();
      if (!res.ok) throw data;
    } catch (err) {
      if (librarySelectedId !== entry.id) return;
      const el = document.getElementById('libraryPriceValue');
      if (!el) return;
      el.textContent = err && err.code === 'SKU_NOT_FOUND'
        ? 'Not found in the current WinePOS export.'
        : (err && err.error) || 'Could not check the WinePOS export.';
      return;
    }
    if (librarySelectedId !== entry.id) return;
    const el = document.getElementById('libraryPriceValue');
    if (!el) return;
    const onSale = data.salePrice && Number(data.salePrice) > 0;
    el.textContent = onSale
      ? `${formatMoney(data.salePrice)} (was ${formatMoney(data.price)})`
      : formatMoney(data.price) || 'No price on file for this SKU.';
  }

  // ---------- Parent Company browse ----------
  //
  // Groups mashBillLibraryCache by parentCompany - free text on each entry
  // (see mash_bills in db.js), so this is a straight string match, not a
  // join against any real company table. Two entries meaning the same real
  // company but spelled differently (a genuine bug this view caught once
  // already - two different "Luxco" strings in the seed data) show up as
  // two separate companies here rather than one; worth normalizing into a
  // real lookup if that keeps happening.
  function companyStats() {
    const map = new Map();
    mashBillLibraryCache.forEach((entry) => {
      const key = entry.parentCompany || 'Independently Owned / Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    });
    return Array.from(map.entries()).map(([name, bourbons]) => ({ name, count: bourbons.length, bourbons }));
  }

  function companyTileHtml(c, tierClass, maxCount) {
    if (tierClass === 'featured') {
      const barPct = Math.round((c.count / maxCount) * 100);
      return `
        <button type="button" class="company-tile company-tile--featured" data-company="${escapeHtml(c.name)}">
          <div class="company-tile__count">${c.count}</div>
          <div class="company-tile__name">${escapeHtml(c.name)}</div>
          <div class="company-tile__meta">bourbons in the library</div>
          <div class="company-tile__bar"><span style="width:${barPct}%"></span></div>
        </button>
      `;
    }
    if (tierClass === 'major') {
      return `
        <button type="button" class="company-tile company-tile--major" data-company="${escapeHtml(c.name)}">
          <div class="company-tile__count">${c.count}</div>
          <div class="company-tile__name">${escapeHtml(c.name)}</div>
        </button>
      `;
    }
    return `
      <button type="button" class="company-tile company-tile--standard" data-company="${escapeHtml(c.name)}">
        <span class="company-tile__name">${escapeHtml(c.name)}</span>
        <span class="company-tile__count">${c.count}</span>
      </button>
    `;
  }

  // Renders the crumb + toolbar (search/sort) once per entry into this
  // view, then hands off to renderCompanyResults for the tier grids -
  // keeping the search input out of the region that re-renders on every
  // keystroke is what lets it keep focus while typing.
  function renderCompaniesView() {
    els.libraryBody.innerHTML = `
      <div class="library-crumb">
        <button type="button" id="libraryCrumbBack"><span aria-hidden="true">&larr;</span> Bourbon Library</button>
        <span class="library-crumb__sep">/</span>
        <span class="library-crumb__current">Parent Companies</span>
      </div>
      <div class="company-toolbar">
        <input type="search" id="companySearchInput" aria-label="Search parent companies" placeholder="Search parent companies&hellip;" value="${escapeHtml(libraryCompanyQuery)}" />
        <div class="company-toolbar__sort">
          <span>Sort:</span>
          <button type="button" class="toggle-btn ${libraryCompanySort === 'count' ? 'is-active' : ''}" data-sort="count">Most bourbons</button>
          <button type="button" class="toggle-btn ${libraryCompanySort === 'alpha' ? 'is-active' : ''}" data-sort="alpha">A&ndash;Z</button>
        </div>
      </div>
      <div id="companyResultsBody"></div>
    `;

    document.getElementById('libraryCrumbBack').addEventListener('click', () => {
      libraryViewMode = 'grid';
      renderLibraryBody();
    });
    document.getElementById('companySearchInput').addEventListener('input', (e) => {
      libraryCompanyQuery = e.target.value;
      renderCompanyResults();
    });
    els.libraryBody.querySelectorAll('.company-toolbar__sort [data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        libraryCompanySort = btn.dataset.sort;
        els.libraryBody.querySelectorAll('.company-toolbar__sort [data-sort]').forEach((b) => {
          b.classList.toggle('is-active', b.dataset.sort === libraryCompanySort);
        });
        renderCompanyResults();
      });
    });

    renderCompanyResults();
  }

  function renderCompanyResults() {
    const container = document.getElementById('companyResultsBody');
    if (!container) return;

    const companies = companyStats();
    const q = libraryCompanyQuery.trim().toLowerCase();
    const filtered = q ? companies.filter((c) => c.name.toLowerCase().includes(q)) : companies;
    filtered.sort((a, b) => (libraryCompanySort === 'alpha'
      ? a.name.localeCompare(b.name)
      : b.count - a.count || a.name.localeCompare(b.name)));

    if (!filtered.length) {
      container.innerHTML = '<p class="help-text">No parent companies match this search.</p>';
      return;
    }

    const maxCount = Math.max(...companies.map((c) => c.count), 1);
    const featured = filtered.filter((c) => c.count >= COMPANY_FEATURED_MIN);
    const major = filtered.filter((c) => c.count >= COMPANY_MAJOR_MIN && c.count < COMPANY_FEATURED_MIN);
    const standard = filtered.filter((c) => c.count < COMPANY_MAJOR_MIN);

    const tierBlockHtml = (label, sub, rows, tierClass, gridClass) => (rows.length ? `
      <div class="tier-block">
        <div class="tier-block__head"><h3>${label}</h3><span>${sub}</span></div>
        <div class="${gridClass}">${rows.map((c) => companyTileHtml(c, tierClass, maxCount)).join('')}</div>
      </div>
    ` : '');

    container.innerHTML = [
      tierBlockHtml('Featured', `${COMPANY_FEATURED_MIN}+ bourbons &middot; ${featured.length} compan${featured.length === 1 ? 'y' : 'ies'}`, featured, 'featured', 'tier-grid--featured'),
      tierBlockHtml('Major', `${COMPANY_MAJOR_MIN}&ndash;${COMPANY_FEATURED_MIN - 1} bourbons &middot; ${major.length} compan${major.length === 1 ? 'y' : 'ies'}`, major, 'major', 'tier-grid--major'),
      tierBlockHtml('Everyone else', `1&ndash;${COMPANY_MAJOR_MIN - 1} bourbons &middot; ${standard.length} compan${standard.length === 1 ? 'y' : 'ies'}`, standard, 'standard', 'tier-grid--standard'),
    ].join('');

    container.querySelectorAll('.company-tile[data-company]').forEach((btn) => {
      btn.addEventListener('click', () => {
        librarySelectedCompany = btn.dataset.company;
        libraryViewMode = 'companyDetail';
        renderLibraryBody();
      });
    });
  }

  function renderCompanyDetail() {
    const company = companyStats().find((c) => c.name === librarySelectedCompany);
    if (!company) {
      libraryViewMode = 'companies';
      renderLibraryBody();
      return;
    }
    const distilleries = new Set(company.bourbons.map((b) => b.distillery).filter(Boolean));
    const confirmed = company.bourbons.filter((b) => b.confidence.tier === 'confirmed').length;
    const rows = company.bourbons.slice().sort((a, b) => a.title.localeCompare(b.title)).map((b) => `
      <button type="button" class="bourbon-row" data-id="${b.id}">
        <div>
          <div class="bourbon-row__title">${escapeHtml(b.title)}</div>
          <div class="bourbon-row__sub">${escapeHtml(b.distillery || 'Distillery unknown')}${b.category ? ` &middot; ${escapeHtml(b.category)}` : ''}</div>
        </div>
        ${confidenceBadgeHtml(b.confidence.tier)}
        <span class="bourbon-row__chevron" aria-hidden="true">&rsaquo;</span>
      </button>
    `).join('');

    els.libraryBody.innerHTML = `
      <div class="library-crumb">
        <button type="button" id="libraryCrumbBack"><span aria-hidden="true">&larr;</span> Parent Companies</button>
        <span class="library-crumb__sep">/</span>
        <span class="library-crumb__current">${escapeHtml(company.name)}</span>
      </div>
      <div class="profile-head">
        <div>
          <h2>${escapeHtml(company.name)}</h2>
          <p class="profile-head__by">${company.count} bourbon${company.count === 1 ? '' : 's'} across ${distilleries.size} distiller${distilleries.size === 1 ? 'y' : 'ies'}</p>
        </div>
      </div>
      <div class="library-stats">
        <div class="library-stat"><b>${company.count}</b><span>Bourbons</span></div>
        <div class="library-stat"><b>${distilleries.size}</b><span>Distilleries</span></div>
        <div class="library-stat"><b>${confirmed}</b><span>Confirmed recipes</span></div>
      </div>
      <div class="bourbon-list">${rows}</div>
    `;

    document.getElementById('libraryCrumbBack').addEventListener('click', () => {
      libraryViewMode = 'companies';
      renderLibraryBody();
    });
    els.libraryBody.querySelectorAll('.bourbon-row[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        librarySelectedId = Number(btn.dataset.id);
        libraryProfileReturnTo = { mode: 'companyDetail', company: librarySelectedCompany };
        libraryViewMode = 'profile';
        libraryShowGrainBar = false;
        renderLibraryBody();
      });
    });
  }

  function renderLibraryBody() {
    if (libraryViewMode === 'profile') renderBourbonProfile();
    else if (libraryViewMode === 'companies') renderCompaniesView();
    else if (libraryViewMode === 'companyDetail') renderCompanyDetail();
    else renderLibraryGrid();
  }

  els.libraryFilterInput.addEventListener('input', (e) => {
    libraryFilterQuery = e.target.value;
    libraryViewMode = 'grid';
    renderLibraryBody();
  });

  // Registered once (not inside renderLibraryGrid, which rebuilds
  // #librarySortSelect on every render) - same pattern as
  // #smartSearchFieldWrap's own outside-click-to-close listener above,
  // re-looking up the element by id on every click so it always finds
  // whichever copy the most recent render created.
  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('librarySortSelect');
    if (wrap && !e.target.closest('#librarySortSelect')) wrap.classList.remove('is-open');
  });

  // Reflects mashBillSync.js's own status directly on the Library screen's
  // header band. The Server PC itself has nothing to pull, so it gets the
  // dot but no Sync Now button - it gets the GitHub sync row instead (see
  // #libraryGithubSyncBtn below), since that's the one sync direction only
  // the Server PC can do anything about.
  function updateLibrarySyncUI(sync) {
    els.librarySyncStatus.textContent = describeMashBillSyncStatus(sync);
    const isServer = !!(sync && sync.isServer);
    const isCurrent = !isServer && sync && sync.lastSyncedAt && !sync.lastError;
    els.librarySyncDot.classList.toggle('is-stale', !isServer && !isCurrent);
    els.librarySyncNowBtn.hidden = isServer;
    els.libraryGithubSyncRow.hidden = !isServer;
  }

  // Forces an immediate pull instead of waiting up to ~30s for the puller's
  // own interval.
  els.librarySyncNowBtn.addEventListener('click', async () => {
    els.librarySyncNowBtn.disabled = true;
    els.librarySyncDot.classList.add('is-syncing');
    els.librarySyncStatus.textContent = 'Syncing...';
    try {
      const resp = await fetch('/api/mashbills/sync-now', { method: 'POST' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not sync right now.');
      mashBillLibraryCache = Array.isArray(data.mashBills) ? data.mashBills : [];
      renderLibraryChipsAndStats();
      renderLibraryBody();
      updateLibrarySyncUI(data.sync);
    } catch (err) {
      els.librarySyncStatus.textContent = withServerPcHint(err.message) || 'Could not sync right now.';
    } finally {
      els.librarySyncDot.classList.remove('is-syncing');
      els.librarySyncNowBtn.disabled = false;
    }
  });

  // Server PC only (see updateLibrarySyncUI above, which hides this whole
  // row otherwise) - pulls in whatever's been added to the curated GitHub
  // list since this library was first seeded. Additive only server-side
  // (see syncNewBourbonLibraryEntries in bourbonLibrarySeed.js), so this
  // never overwrites an existing entry, however it got there.
  els.libraryGithubSyncBtn.addEventListener('click', async () => {
    els.libraryGithubSyncBtn.disabled = true;
    els.libraryGithubSyncStatus.textContent = 'Checking GitHub...';
    try {
      const resp = await fetch('/api/mashbills/sync-library', { method: 'POST' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not check GitHub right now.');
      mashBillLibraryCache = Array.isArray(data.mashBills) ? data.mashBills : [];
      renderLibraryChipsAndStats();
      renderLibraryBody();
      els.libraryGithubSyncStatus.textContent = data.added
        ? `Added ${data.added} new bourbon${data.added === 1 ? '' : 's'} from ${data.source}.`
        : `Already up to date - nothing new on ${data.source === 'GitHub' ? 'GitHub' : 'the bundled list'}.`;
    } catch (err) {
      els.libraryGithubSyncStatus.textContent = err.message || 'Could not check GitHub right now.';
    } finally {
      els.libraryGithubSyncBtn.disabled = false;
    }
  });

  // Called every time the rail switches to Library (see setActiveView
  // above) - re-fetches so the screen reflects the shared library's actual
  // current state rather than whatever this client happened to have cached
  // from the last recall banner check.
  function renderLibraryView() {
    fetchMashBillLibrary().then((data) => {
      libraryViewMode = 'grid';
      librarySelectedId = null;
      libraryShowGrainBar = false;
      librarySelectedCompany = null;
      libraryCompanyQuery = '';
      libraryCompanySort = 'count';
      libraryProfileReturnTo = { mode: 'grid', company: null };
      els.libraryFilterInput.value = '';
      libraryFilterQuery = '';
      renderLibraryChipsAndStats();
      renderLibraryBody();
      updateLibrarySyncUI(data && data.sync);
    });
  }

  // ---------- The Beer Bible (rail view) ----------
  //
  // A browse/profile screen over the shared `beers` data (see server/db.js)
  // - search, a card grid, and a per-beer profile page - mirroring the
  // Bourbon Library above but without its confidence tiers or
  // parent-company browse (nothing analogous exists for Beer: its numbers
  // come from a store's own Untappd export or a manual entry, not
  // conflicting industry sources, so there's nothing to arbitrate the way
  // Mash Bill Confidence does). Adding/editing/deleting goes through the
  // form modal below (opened via #beerBibleAddBtn, or the profile page's
  // own Edit button); this section itself never writes anything beyond
  // what that form does, only reads beerBibleCache and re-fetches it after
  // the form modal changes something.
  //
  // Two things the Bourbon Library also has that this deliberately doesn't
  // yet: cross-register sync (this PC's own data.db is always the only
  // copy - contrast with mash_bills' Server PC/mashBillSync.js) and an Edit
  // Talker recall banner reading from this table (contrast with
  // refreshMashBillRecall above). Both are natural next steps once this is
  // in real use.

  let beerBibleCache = [];
  let beerBibleFilterQuery = '';
  // 'grid' (search + card grid) or 'profile' (one beer's own page) - same
  // two-mode shape as libraryViewMode/atlasViewMode above. beerBibleSelectedId
  // is only meaningful while in 'profile'.
  let beerBibleViewMode = 'grid';
  let beerBibleSelectedId = null;

  async function fetchBeerBible() {
    try {
      const resp = await fetch('/api/beers');
      const data = await resp.json();
      beerBibleCache = Array.isArray(data.beers) ? data.beers : [];
    } catch {
      beerBibleCache = [];
    }
    return beerBibleCache;
  }

  function beerMatchesSearch(entry) {
    const q = beerBibleFilterQuery.trim().toLowerCase();
    if (!q) return true;
    return (entry.title || '').toLowerCase().includes(q)
      || (entry.brewery || '').toLowerCase().includes(q)
      || (entry.style || '').toLowerCase().includes(q)
      || (entry.sku || '').toLowerCase().includes(q);
  }

  function renderBeerBibleStats() {
    const breweries = new Set(beerBibleCache.map((b) => b.brewery).filter(Boolean)).size;
    const styles = new Set(beerBibleCache.map((b) => b.style).filter(Boolean)).size;
    els.beerBibleStats.innerHTML = `
      <div class="library-stat"><b>${beerBibleCache.length}</b><span>Beers</span></div>
      <div class="library-stat"><b>${breweries}</b><span>Breweries</span></div>
      <div class="library-stat"><b>${styles}</b><span>Styles</span></div>
    `;
  }

  // The rating dot meter (grid cards, profile "At a Glance", sibling list)
  // - the same half-fill-dot idea as the printed shelf talker's own
  // Untappd Rating widget (buildBeerRatingHtml in card.js), redrawn small
  // for the app chrome rather than reusing that widget's print-scaled
  // .card__beer-dot classes directly (those are sized in calc(var(--w)...)
  // card-width units, meaningless outside the printed card). A rating of
  // exactly 0 is treated as "no rating" same as that widget, since it's
  // Untappd's own sentinel for "no computed average yet", not a real score.
  function ratingDotsHtml(rating) {
    const num = Number(rating);
    const hasRating = rating != null && String(rating).trim() !== '' && Number.isFinite(num) && num > 0;
    const clamped = hasRating ? Math.max(0, Math.min(5, num)) : 0;
    const dots = Array.from({ length: 5 }, (_, i) => {
      const fill = clamped - i;
      const cls = fill >= 1 ? 'is-full' : fill > 0 ? 'is-half' : '';
      return `<span class="rating-dot ${cls}"></span>`;
    }).join('');
    const title = hasRating ? `${clamped.toFixed(2)} / 5 on Untappd` : 'No Untappd rating on file';
    return `<span class="rating-dots" title="${title}">${dots}</span>`;
  }

  // Reuses .bourbon-grid/.bourbon-card as-is (see styles.css) - the same
  // generic card grid the Bourbon Library and The Pairing Atlas's own wine
  // cards already share, just without a grain bar in the middle.
  function beerCardHtml(entry) {
    // Escape each piece individually, then join with a raw (already-safe)
    // &middot; entity - escaping the joined string instead would turn that
    // entity's own & into &amp;, printing the literal text "&middot;"
    // rather than a middle dot (same reasoning as bourbonRowHtml's own
    // distillery/category join above).
    const metaBits = [entry.brewery, entry.style].filter(Boolean).map(escapeHtml).join(' &middot; ');
    const statBits = [];
    if (entry.abv) statBits.push(`${escapeHtml(entry.abv)} ABV`);
    if (entry.ibu) statBits.push(`${escapeHtml(entry.ibu)} IBU`);
    return `
      <button type="button" class="bourbon-card" data-id="${entry.id}">
        <div class="bourbon-card__title">${escapeHtml(entry.title)}</div>
        <div class="bourbon-card__sub">${metaBits || 'Brewery unknown'}</div>
        <div class="bourbon-card__footer">
          <span class="bourbon-card__sub">${statBits.join(' &middot; ')}</span>
          ${entry.untappdRating ? ratingDotsHtml(entry.untappdRating) : ''}
        </div>
      </button>
    `;
  }

  function renderBeerBibleGrid() {
    const rows = beerBibleCache.filter(beerMatchesSearch).slice().sort((a, b) => a.title.localeCompare(b.title));
    if (!rows.length) {
      els.beerBibleBody.innerHTML = beerBibleCache.length
        ? '<p class="empty-hint">No beers match this search.</p>'
        : '<p class="empty-hint">No beers yet - click Add Beer to research your first one.</p>';
      return;
    }
    els.beerBibleBody.innerHTML = `<div class="bourbon-grid">${rows.map((entry) => beerCardHtml(entry)).join('')}</div>`;
    els.beerBibleBody.querySelectorAll('.bourbon-card[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        beerBibleSelectedId = Number(btn.dataset.id);
        beerBibleViewMode = 'profile';
        renderBeerBibleBody();
      });
    });
  }

  // One stat tile for the profile page's "At a Glance" block (ABV, IBU) -
  // the Untappd Rating tile is its own function below since it also needs
  // the dot meter and rating count, not just a plain value.
  function beerStatCardHtml(label, value) {
    return `
      <div class="beer-stat-card">
        <div class="beer-stat-card__label">${escapeHtml(label)}</div>
        ${value ? `<div class="beer-stat-card__value">${escapeHtml(value)}</div>` : '<div class="beer-stat-card__value beer-stat-card__value--empty">Not on file</div>'}
      </div>
    `;
  }

  function beerRatingStatCardHtml(entry) {
    const num = Number(entry.untappdRating);
    const hasRating = entry.untappdRating != null && String(entry.untappdRating).trim() !== '' && Number.isFinite(num) && num > 0;
    const count = Number(entry.untappdRatingCount);
    const hasCount = entry.untappdRatingCount != null && String(entry.untappdRatingCount).trim() !== '' && Number.isFinite(count);
    return `
      <div class="beer-stat-card">
        <div class="beer-stat-card__label">Untappd Rating</div>
        <div class="beer-stat-card__value ${hasRating ? '' : 'beer-stat-card__value--empty'}">${hasRating ? num.toFixed(2) : 'Not on file'}</div>
        <div class="beer-stat-card__sub">
          ${ratingDotsHtml(entry.untappdRating)}
          ${hasCount ? `<span class="rating-num">${count.toLocaleString('en-US')} rating${count === 1 ? '' : 's'}</span>` : ''}
        </div>
      </div>
    `;
  }

  // Human-readable version of the `source` values upsertBeer/importBeers
  // actually write (see server/db.js and server/beerBibleImport.js) - shown
  // under Tasting Notes so staff can tell an Untappd-sourced description
  // apart from one they typed in themselves.
  const BEER_SOURCE_LABELS = {
    Manual: 'Typed in by staff',
    Import: 'Pulled in from a product export',
    Export: 'From the curated Beer Bible list on GitHub',
  };

  // The Beer Bible's profile page (renderBeerBibleGrid's card click, or the
  // sibling list below) - a read-focused layout over one `beers` row, the
  // same "view, not a new editing surface" relationship
  // renderBourbonProfile/renderAtlasProfile above have to their own data:
  // every field here still lives in the `beers` table and is still edited
  // through the same add/edit form (loadBeerBibleEntryIntoForm), reached
  // here via the Edit button instead of a card click.
  function renderBeerBibleProfile() {
    const entry = beerBibleCache.find((b) => b.id === beerBibleSelectedId);
    if (!entry) {
      beerBibleViewMode = 'grid';
      renderBeerBibleBody();
      return;
    }
    const siblings = beerBibleCache.filter((b) => b.id !== entry.id && entry.brewery && b.brewery === entry.brewery);

    els.beerBibleBody.innerHTML = `
      <div class="library-crumb">
        <button type="button" id="beerBibleCrumbBack"><span aria-hidden="true">&larr;</span> The Beer Bible</button>
        <span class="library-crumb__sep">/</span>
        <span class="library-crumb__current">${escapeHtml(entry.title)}</span>
      </div>
      <div class="profile-head">
        <div>
          <h2>${escapeHtml(entry.title)}</h2>
          <p class="profile-head__by">${escapeHtml(entry.brewery || 'Brewery unknown')}${entry.location ? ` &middot; <strong>${escapeHtml(entry.location)}</strong>` : ''}</p>
          ${entry.style ? `<div class="profile-tags"><span class="tag">${escapeHtml(entry.style)}</span></div>` : ''}
        </div>
        <button type="button" class="btn btn--small" id="beerBibleEditBtn">Edit</button>
      </div>
      <div class="profile-grid">
        <div>
          <div class="block">
            <h3>At a Glance</h3>
            <div class="beer-stat-grid">
              ${beerStatCardHtml('ABV', entry.abv)}
              ${beerStatCardHtml('IBU', entry.ibu)}
              ${beerRatingStatCardHtml(entry)}
            </div>
          </div>
          <div class="block desc-block">
            <h3>Tasting Notes</h3>
            ${entry.description ? `<p>${escapeHtml(entry.description)}</p>` : '<p class="help-text">No description on file yet - add one from the edit form.</p>'}
            ${entry.description ? `<div class="desc-source">Source: ${escapeHtml(BEER_SOURCE_LABELS[entry.source] || entry.source)}</div>` : ''}
          </div>
        </div>
        <div class="block info-card">
          <h3>Beer &amp; Brewery</h3>
          <dl>
            <div><dt>Brewery</dt><dd>${escapeHtml(entry.brewery || 'Unknown')}</dd></div>
            ${entry.location ? `<div><dt>Location</dt><dd>${escapeHtml(entry.location)}</dd></div>` : ''}
            ${entry.style ? `<div><dt>Style</dt><dd>${escapeHtml(entry.style)}</dd></div>` : ''}
            ${entry.sku ? `<div><dt>SKU</dt><dd>${escapeHtml(entry.sku)}</dd></div>` : ''}
          </dl>
          ${siblings.length ? `
            <dt class="info-card__siblings-label">Other ${escapeHtml(entry.brewery)} entries</dt>
            <div class="sibling-list">
              ${siblings.map((s) => `<button type="button" class="sibling-btn" data-id="${s.id}"><span>${escapeHtml(s.title)}</span>${s.untappdRating ? ratingDotsHtml(s.untappdRating) : ''}</button>`).join('')}
            </div>` : ''}
        </div>
      </div>
    `;
    document.getElementById('beerBibleEditBtn').addEventListener('click', () => {
      beerBibleModal.open();
      loadBeerBibleEntryIntoForm(entry);
    });
    document.getElementById('beerBibleCrumbBack').addEventListener('click', () => {
      beerBibleSelectedId = null;
      beerBibleViewMode = 'grid';
      renderBeerBibleBody();
    });
    els.beerBibleBody.querySelectorAll('.sibling-btn[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        beerBibleSelectedId = Number(btn.dataset.id);
        renderBeerBibleProfile();
      });
    });
  }

  // Dispatcher - grid vs profile, same shape as renderLibraryBody/
  // renderAtlasBody above. Every place that used to call renderBeerBibleGrid
  // directly after a save/delete/GitHub sync now calls this instead, so
  // saving from the profile's own Edit button re-renders that same profile
  // with the fresh data instead of dropping back to the grid - and deleting
  // (or a sibling-list beer somehow having vanished) falls back to the grid
  // automatically, since renderBeerBibleProfile above does that itself when
  // beerBibleSelectedId no longer matches anything in beerBibleCache.
  function renderBeerBibleBody() {
    if (beerBibleViewMode === 'profile') renderBeerBibleProfile();
    else renderBeerBibleGrid();
  }

  els.beerBibleFilterInput.addEventListener('input', (e) => {
    beerBibleFilterQuery = e.target.value;
    beerBibleViewMode = 'grid';
    renderBeerBibleGrid();
  });

  // Called every time the rail switches to Beer Bible (see setActiveView
  // below) - re-fetches so the screen reflects the table's actual current
  // state rather than whatever this client happened to have cached from
  // earlier in the session.
  function renderBeerBibleView() {
    fetchBeerBible().then(() => {
      els.beerBibleFilterInput.value = '';
      beerBibleFilterQuery = '';
      beerBibleViewMode = 'grid';
      beerBibleSelectedId = null;
      renderBeerBibleStats();
      renderBeerBibleBody();
    });
  }

  // ---------- Beer Bible add/edit form ----------
  //
  // Manages the `beers` table directly (add/edit/delete) - opened from the
  // Beer Bible page's own Add Beer button or a card's click. Reuses
  // .settings-section/.reviewer-manager__add for the form itself, same
  // pattern as the Bourbon Library's own add/edit form above.

  // null while adding a new entry; the entry's id while editing an existing
  // one (see loadBeerBibleEntryIntoForm) - one form serves both, switching
  // label/button text based on which mode this is in.
  let beerBibleEditingId = null;

  function resetBeerBibleForm() {
    beerBibleEditingId = null;
    els.beerBibleFormTitleInput.value = '';
    els.beerBibleFormBreweryInput.value = '';
    els.beerBibleFormLocationInput.value = '';
    els.beerBibleFormStyleInput.value = '';
    els.beerBibleFormSkuInput.value = '';
    els.beerBibleFormAbvInput.value = '';
    els.beerBibleFormIbuInput.value = '';
    els.beerBibleFormRatingInput.value = '';
    els.beerBibleFormRatingCountInput.value = '';
    els.beerBibleFormDescriptionInput.value = '';
    els.beerBibleFormTitle.textContent = 'Add an entry manually';
    els.beerBibleFormSaveBtn.textContent = 'Add Entry';
    els.beerBibleFormCancelBtn.hidden = true;
    els.beerBibleFormDeleteBtn.hidden = true;
    els.beerBibleFormStatus.textContent = '';
  }

  function loadBeerBibleEntryIntoForm(entry) {
    beerBibleEditingId = entry.id;
    els.beerBibleFormTitleInput.value = entry.title;
    els.beerBibleFormBreweryInput.value = entry.brewery || '';
    els.beerBibleFormLocationInput.value = entry.location || '';
    els.beerBibleFormStyleInput.value = entry.style || '';
    els.beerBibleFormSkuInput.value = entry.sku || '';
    els.beerBibleFormAbvInput.value = entry.abv || '';
    els.beerBibleFormIbuInput.value = entry.ibu || '';
    els.beerBibleFormRatingInput.value = entry.untappdRating || '';
    els.beerBibleFormRatingCountInput.value = entry.untappdRatingCount || '';
    els.beerBibleFormDescriptionInput.value = entry.description || '';
    els.beerBibleFormTitle.textContent = `Edit "${entry.title}"`;
    els.beerBibleFormSaveBtn.textContent = 'Save Changes';
    els.beerBibleFormCancelBtn.hidden = false;
    els.beerBibleFormDeleteBtn.hidden = false;
    els.beerBibleFormStatus.textContent = '';
    els.beerBibleFormTitleInput.scrollIntoView({ block: 'nearest' });
  }

  // Deletes an entry from the Beer Bible, then closes this form and
  // refreshes the grid underneath it. The entry being deleted is always the
  // one currently open in this form (see els.beerBibleFormDeleteBtn's own
  // click handler below), so there's nothing left to keep editing once it
  // succeeds.
  async function deleteBeerBibleEntry(id) {
    try {
      const resp = await fetch(`/api/beers/${id}`, { method: 'DELETE' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not delete that entry.');
      beerBibleModal.close();
      // The deleted entry can't have a profile page anymore - always back
      // to the grid, rather than leaving it to renderBeerBibleProfile's own
      // "entry not found" fallback.
      beerBibleViewMode = 'grid';
      beerBibleSelectedId = null;
      await fetchBeerBible();
      renderBeerBibleStats();
      renderBeerBibleBody();
    } catch (err) {
      els.beerBibleFormStatus.textContent = err.message || 'Could not delete that entry.';
    }
  }

  els.beerBibleFormDeleteBtn.addEventListener('click', () => {
    if (beerBibleEditingId === null) return;
    const title = els.beerBibleFormTitleInput.value.trim();
    if (!confirm(`Delete "${title}" from the Beer Bible? This can't be undone.`)) return;
    deleteBeerBibleEntry(beerBibleEditingId);
  });

  // Always resets to a blank "Add an entry manually" form on open - the
  // Edit path (the profile page's own Edit button, in renderBeerBibleProfile
  // above) opens first, then calls loadBeerBibleEntryIntoForm afterward to
  // fill it back in, same order the Bourbon Library's own libraryEditBtn
  // handler uses.
  const beerBibleModal = createModal({
    overlay: els.beerBibleOverlay,
    closeBtns: [els.beerBibleCloseBtn, els.beerBibleCloseFooterBtn],
    onOpen: resetBeerBibleForm,
  });

  els.beerBibleAddBtn.addEventListener('click', () => beerBibleModal.open());
  els.beerBibleFormCancelBtn.addEventListener('click', resetBeerBibleForm);

  els.beerBibleFormSaveBtn.addEventListener('click', async () => {
    const title = els.beerBibleFormTitleInput.value.trim();
    if (!title) {
      els.beerBibleFormStatus.textContent = 'A beer name is required.';
      return;
    }
    els.beerBibleFormSaveBtn.disabled = true;
    els.beerBibleFormStatus.textContent = 'Saving...';
    try {
      const payload = {
        title,
        brewery: els.beerBibleFormBreweryInput.value.trim(),
        location: els.beerBibleFormLocationInput.value.trim(),
        style: els.beerBibleFormStyleInput.value.trim(),
        sku: els.beerBibleFormSkuInput.value.trim(),
        abv: els.beerBibleFormAbvInput.value.trim(),
        ibu: els.beerBibleFormIbuInput.value.trim(),
        untappdRating: els.beerBibleFormRatingInput.value.trim(),
        untappdRatingCount: els.beerBibleFormRatingCountInput.value.trim(),
        description: els.beerBibleFormDescriptionInput.value.trim(),
        source: 'Manual',
      };
      const resp = beerBibleEditingId
        ? await fetch(`/api/beers/${beerBibleEditingId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
        : await fetch('/api/beers', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not save that entry.');
      beerBibleModal.close();
      await fetchBeerBible();
      renderBeerBibleStats();
      // beerBibleSelectedId/beerBibleViewMode are untouched by opening this
      // form, so a save made from an existing beer's profile page (Edit
      // button) lands back on that same profile with the fresh data -
      // Add Entry only ever opens from the grid, so that path still lands
      // back on the grid same as before.
      renderBeerBibleBody();
    } catch (err) {
      els.beerBibleFormStatus.textContent = err.message || 'Could not save that entry.';
    } finally {
      els.beerBibleFormSaveBtn.disabled = false;
    }
  });

  // Turns a POST /api/beers/sync-library response into the one-line status
  // message under the button. `merged` (see syncNewBeerBibleEntries in
  // beerBibleSeed.js) means a curated entry matched an existing row by SKU
  // under a different title and was folded into it instead of adding a
  // second row for the same product - called out separately from `added` so
  // "nothing new" doesn't read the same as "found some duplicates and
  // cleaned them up".
  function describeBeerBibleSyncResult(data) {
    const parts = [];
    if (data.added) parts.push(`added ${data.added} new beer${data.added === 1 ? '' : 's'}`);
    if (data.merged) parts.push(`merged ${data.merged} duplicate${data.merged === 1 ? '' : 's'} into existing entries`);
    if (!parts.length) {
      return `Already up to date - nothing new on ${data.source === 'GitHub' ? 'GitHub' : 'the bundled list'}.`;
    }
    const sentence = `${parts.join(', and ')} from ${data.source}.`;
    return sentence[0].toUpperCase() + sentence.slice(1);
  }

  // Backs the Beer Bible page's "Check GitHub for New Beers" button - pulls
  // in whatever's been added to the curated GitHub list since this PC's
  // Beer Bible was last synced. Additive-or-merge only server-side (see
  // syncNewBeerBibleEntries in beerBibleSeed.js), so this never overwrites
  // an existing entry's own fields, however it got there. Unlike the Bourbon
  // Library's own #libraryGithubSyncBtn, this isn't gated behind Server PC -
  // see the #beerBibleGithubSyncRow comment in index.html for why.
  els.beerBibleGithubSyncBtn.addEventListener('click', async () => {
    els.beerBibleGithubSyncBtn.disabled = true;
    els.beerBibleGithubSyncStatus.textContent = 'Checking GitHub...';
    try {
      const resp = await fetch('/api/beers/sync-library', { method: 'POST' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not check GitHub right now.');
      beerBibleCache = Array.isArray(data.beers) ? data.beers : [];
      renderBeerBibleStats();
      // Additive-or-merge only (see the comment above) - a beer open on the
      // profile page is never touched by this, so renderBeerBibleBody keeps
      // whichever view was already showing rather than forcing back to grid.
      renderBeerBibleBody();
      els.beerBibleGithubSyncStatus.textContent = describeBeerBibleSyncResult(data);
    } catch (err) {
      els.beerBibleGithubSyncStatus.textContent = err.message || 'Could not check GitHub right now.';
    } finally {
      els.beerBibleGithubSyncBtn.disabled = false;
    }
  });

  // ---------- The Pairing Atlas (rail view) ----------
  //
  // A read-focused browse/profile screen over WINE_PAIRING_RULES (a plain
  // global defined in card.js - same array Suggest Pairings and Tools >
  // Wine Pairing Rules... already match/render against, so this can't
  // drift out of sync with what that button actually offers - see the
  // WINE_PAIRING_RULES comment block in card.js). Unlike that modal, which
  // is a developer-facing reference (raw match patterns, one flat list),
  // this is the consumer-facing version: a color-grouped varietal grid and
  // a per-varietal profile page that renders its pairings as an
  // infographic instead of a list. Entirely client-side - WINE_PAIRING_RULES
  // is a static array already loaded with the page, so unlike
  // renderLibraryView above there's no fetch, and unlike the Bourbon
  // Library this never writes anything either.
  //
  // Filter matching reuses pairingRuleMatchesQuery, defined above for the
  // Wine Pairing Rules modal's own filter box - same "matches this
  // varietal's own label/pattern, or any of its region/sweetness
  // sub-entries'" semantics, so typing "Chablis" or "Trocken" here finds
  // the same varietal it would in that modal.

  const ATLAS_COLORS = ['Red', 'White', 'Rosé', 'Sparkling', 'Fortified & Dessert'];

  let atlasFilterQuery = '';
  let atlasColorFilter = 'all';
  let atlasViewMode = 'grid';
  let atlasSelectedId = null;

  function atlasMatchesFilter(rule) {
    return atlasColorFilter === 'all' || rule.color === atlasColorFilter;
  }

  function atlasMatchesSearch(rule) {
    return pairingRuleMatchesQuery(rule, atlasFilterQuery.trim().toLowerCase());
  }

  function renderAtlasChipsAndStats() {
    const counts = { all: WINE_PAIRING_RULES.length };
    ATLAS_COLORS.forEach((color) => {
      counts[color] = WINE_PAIRING_RULES.filter((r) => r.color === color).length;
    });
    const chips = [{ key: 'all', label: `All varietals (${counts.all})` }]
      .concat(ATLAS_COLORS.filter((color) => counts[color] > 0).map((color) => ({ key: color, label: `${color} (${counts[color]})` })));
    els.atlasChips.innerHTML = chips.map((c) => `
      <button type="button" class="toggle-btn ${atlasColorFilter === c.key ? 'is-active' : ''}" data-color="${c.key}">${escapeHtml(c.label)}</button>
    `).join('');
    els.atlasChips.querySelectorAll('button[data-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        atlasColorFilter = btn.dataset.color;
        renderAtlasChipsAndStats();
        renderAtlasBody();
      });
    });
    const twists = WINE_PAIRING_RULES.reduce((sum, r) => sum + (r.regions ? r.regions.length : 0) + (r.sweetness ? r.sweetness.length : 0), 0);
    const pairingsCharted = WINE_PAIRING_RULES.reduce((sum, r) => sum + r.pairings.length, 0);
    els.atlasStats.innerHTML = `
      <div class="library-stat"><b>${WINE_PAIRING_RULES.length}</b><span>Varietals</span></div>
      <div class="library-stat"><b>${new Set(WINE_PAIRING_RULES.map((r) => r.color)).size}</b><span>Wine Colors</span></div>
      <div class="library-stat"><b>${twists}</b><span>Regional/Sweetness Twists</span></div>
      <div class="library-stat"><b>${pairingsCharted}</b><span>Pairings Charted</span></div>
    `;
  }

  function wineCardHtml(rule) {
    const regionCount = (rule.regions ? rule.regions.length : 0) + (rule.sweetness ? rule.sweetness.length : 0);
    return `
      <button type="button" class="bourbon-card wine-card" data-id="${rule.id}">
        <div class="bourbon-card__title">${escapeHtml(rule.label)}</div>
        <div class="wine-card__pairings" aria-hidden="true">${rule.pairings.map((p) => `<span title="${escapeHtml(p.food)}">${escapeHtml(p.icon)}</span>`).join('')}</div>
        <div class="bourbon-card__footer">
          <span class="tag">${escapeHtml(rule.color)}</span>
          <span class="bourbon-card__sub">${regionCount ? `${regionCount} twist${regionCount === 1 ? '' : 's'}` : ''}</span>
        </div>
      </button>
    `;
  }

  function renderAtlasGrid() {
    const rows = WINE_PAIRING_RULES.filter((r) => atlasMatchesFilter(r) && atlasMatchesSearch(r));
    if (!rows.length) {
      els.atlasBody.innerHTML = '<p class="help-text">No varietals match this search/filter.</p>';
      return;
    }
    els.atlasBody.innerHTML = `<div class="bourbon-grid">${rows.map(wineCardHtml).join('')}</div>`;
    els.atlasBody.querySelectorAll('.wine-card[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        atlasSelectedId = btn.dataset.id;
        atlasViewMode = 'profile';
        renderAtlasBody();
      });
    });
  }

  // The infographic itself: the same 4 pairings Suggest Pairings offers,
  // laid out as a 2x2 poster (big icon over its food label) instead of the
  // Wine Pairing Rules modal's flat chip row - this is the "browse for
  // ideas" surface, that one's the "check what a button will do" surface.
  function pairingInfographicHtml(rule) {
    return `
      <div class="block">
        <h3>Pairing Infographic</h3>
        <div class="pairing-infographic">
          ${rule.pairings.map((p) => `
            <div class="pairing-infographic__item">
              <div class="pairing-infographic__icon">${escapeHtml(p.icon)}</div>
              <div class="pairing-infographic__food">${escapeHtml(p.food)}</div>
            </div>
          `).join('')}
        </div>
        <p class="help-text">The same 4 candidates Suggest Pairings (Edit Talker &rarr; Food Pairing Suggestions) offers for ${escapeHtml(rule.label)} - pick up to 3 to print.</p>
      </div>
    `;
  }

  // Regions and sweetness tiers render with the same markup - both are
  // "narrow down to this sub-entry, swap one slot of the base 4" (see the
  // WINE_PAIRING_RULES comment block in card.js) - just a different
  // heading and, for a rule like Riesling that carries both, two separate
  // blocks rather than one merged list.
  function atlasRefinementListHtml(rule, list, heading) {
    if (!list || !list.length) return '';
    return `
      <div class="block">
        <h3>${escapeHtml(heading)}</h3>
        <div class="atlas-region-list">
          ${list.map((entry) => `
            <div class="atlas-region-item">
              <div class="atlas-region-item__label">${escapeHtml(entry.label)}</div>
              <div class="atlas-region-item__swap">
                <span class="pairing-infographic__icon">${escapeHtml(entry.swap.icon)}</span>
                <span>${escapeHtml(entry.swap.food)}</span>
                <span class="atlas-region-item__was">in place of ${escapeHtml(rule.pairings[entry.swapIndex].food)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderAtlasProfile() {
    const rule = WINE_PAIRING_RULES.find((r) => r.id === atlasSelectedId);
    if (!rule) {
      atlasViewMode = 'grid';
      renderAtlasBody();
      return;
    }
    const siblings = WINE_PAIRING_RULES.filter((r) => r.id !== rule.id && r.color === rule.color);
    els.atlasBody.innerHTML = `
      <div class="profile-head">
        <div>
          <h2>${escapeHtml(rule.label)}</h2>
          <div class="profile-tags"><span class="tag">${escapeHtml(rule.color)}</span></div>
        </div>
      </div>
      <div class="profile-grid">
        <div>
          ${pairingInfographicHtml(rule)}
          ${atlasRefinementListHtml(rule, rule.regions, 'Regional Twists')}
          ${atlasRefinementListHtml(rule, rule.sweetness, 'Sweetness Refinements')}
        </div>
        <div class="block info-card">
          <h3>At a Glance</h3>
          <dl>
            <div><dt>Color</dt><dd>${escapeHtml(rule.color)}</dd></div>
            ${rule.regions ? `<div><dt>Regional twists</dt><dd>${rule.regions.length}</dd></div>` : ''}
            ${rule.sweetness ? `<div><dt>Sweetness tiers</dt><dd>${rule.sweetness.length}</dd></div>` : ''}
          </dl>
          ${siblings.length ? `
            <dt class="info-card__siblings-label">Other ${escapeHtml(rule.color)} varietals</dt>
            <div class="sibling-list">
              ${siblings.map((s) => `<button type="button" class="sibling-btn" data-id="${s.id}"><span>${escapeHtml(s.label)}</span></button>`).join('')}
            </div>` : ''}
        </div>
      </div>
    `;
    els.atlasBody.querySelectorAll('.sibling-btn[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        atlasSelectedId = btn.dataset.id;
        renderAtlasProfile();
      });
    });
  }

  function renderAtlasBody() {
    els.atlasBackLink.hidden = atlasViewMode !== 'profile';
    if (atlasViewMode === 'profile') renderAtlasProfile();
    else renderAtlasGrid();
  }

  els.atlasFilterInput.addEventListener('input', (e) => {
    atlasFilterQuery = e.target.value;
    atlasViewMode = 'grid';
    renderAtlasBody();
  });
  els.atlasBackLink.addEventListener('click', (e) => {
    e.preventDefault();
    atlasViewMode = 'grid';
    atlasSelectedId = null;
    renderAtlasBody();
  });

  // Called every time the rail switches to Atlas (see setActiveView
  // above). No fetch to await (see the section comment above), so unlike
  // renderLibraryView this resets and renders synchronously.
  function renderAtlasView() {
    atlasViewMode = 'grid';
    atlasSelectedId = null;
    atlasColorFilter = 'all';
    els.atlasFilterInput.value = '';
    atlasFilterQuery = '';
    renderAtlasChipsAndStats();
    renderAtlasBody();
  }

  // Fired once, right as printing is confirmed (see printNow() below) with
  // whatever's in the Queue at that moment - that's exactly what's about to
  // be laid out on the sheet(s). Best-effort: a failure here (e.g. History's
  // database is somehow unavailable) shouldn't block or interrupt the print
  // itself, which has its own success/failure handling in triggerPrint().
  function recordHistoryForPrint() {
    if (!queue.length) return;
    fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ talkers: queue }),
    }).catch(() => {});
  }

  // ---------- Advanced menu dialogs (Electron only) ----------

  // Used by the Export File preview dialog below - builds a plain HTML
  // table from a header row + array-of-arrays data rows. Used instead of a
  // fancier grid component since a read-only troubleshooting preview
  // doesn't need sorting/filtering/etc., just to show what's there.
  function renderPreviewTable(container, headers, rows) {
    if (!headers.length) {
      container.innerHTML = '<p class="empty-hint">Nothing to show.</p>';
      return;
    }
    const headHtml = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    const bodyHtml = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
    container.innerHTML = `
      <table class="preview-table">
        <thead><tr>${headHtml}</tr></thead>
        <tbody>${bodyHtml || `<tr><td colspan="${headers.length}">No rows yet.</td></tr>`}</tbody>
      </table>
    `;
  }

  // Configures the WinePOS export file path the Scan UPC tab reads from -
  // previously an inline "Settings" box on that tab itself; moved here (see
  // main.js's Advanced menu) so the tab stays focused on scanning and setup
  // is a one-time admin task instead. Reuses the same /api/upc-settings
  // routes the old inline box used - only where this lives in the UI
  // changed, not the underlying config.
  //
  // Also hosts the auto-sync checkbox (see server/exportSync.js): a register
  // that doesn't have WinePOS itself can pull the export file over the
  // network from whichever PC is currently marked Server PC instead of a
  // manually-typed local path. `settings.exportPath` describes whichever of
  // the two is actually in effect (see getUpcSettings in upcCatalog.js);
  // `settings.configuredPath` is always the manually-typed one, which is
  // what the path input itself shows/edits, so switching auto-sync back off
  // restores it instead of leaving the field blank or full of the internal
  // synced-copy path.
  function describeExportSettings(settings) {
    if (settings.autoSync) {
      if (settings.error) return `⚠ ${settings.error}`;
      const count = settings.itemCount === null ? 'an unknown number of' : settings.itemCount.toLocaleString('en-US');
      const updated = settings.lastModified ? new Date(settings.lastModified).toLocaleString() : 'an unknown time';
      return `Loaded ${count} item${settings.itemCount === 1 ? '' : 's'} synced from the Server PC (last updated ${updated}).`;
    }
    if (settings.error) return `⚠ ${settings.error}`;
    if (!settings.configuredPath) return 'No export file location is set yet - enter one below and click "Save Location".';
    if (!settings.fileExists) return `No file found yet at ${settings.configuredPath}.`;
    const count = settings.itemCount === null ? 'an unknown number of' : settings.itemCount.toLocaleString('en-US');
    const updated = settings.lastModified ? new Date(settings.lastModified).toLocaleString() : 'an unknown time';
    return `Loaded ${count} item${settings.itemCount === 1 ? '' : 's'} from ${settings.configuredPath} (last updated ${updated}).`;
  }

  // Describes the auto-sync puller's own status (see exportSync.js's
  // getStatus) - separate from describeExportSettings above, which is about
  // the resulting catalog (how many items, when the file itself last
  // changed); this is about the network fetch that produced it (when it
  // last succeeded, who it synced from, why it might be failing).
  function describeSyncStatus(data) {
    if (!data.autoSync) return '';
    if (!data.sync) return '';
    const { lastSyncedAt, lastError, syncedFrom } = data.sync;
    const parts = [];
    parts.push(lastSyncedAt
      ? `Last synced from ${syncedFrom || 'the Server PC'} at ${formatHistoryTimestamp(lastSyncedAt)}.`
      : 'Waiting for the first sync from the Server PC...');
    if (lastError) parts.push(`⚠ ${lastError}`);
    return parts.join(' ');
  }

  // Manual path entry only makes sense while auto-sync is off - disabling
  // it (rather than hiding it) keeps the field visible so staff can still
  // see/copy whatever it was last set to. Sync Now is the mirror image: it
  // only does anything while auto-sync is on (see the /api/upc-settings/
  // sync-now route in server/index.js), so it's disabled the rest of the
  // time rather than hidden, same reasoning.
  function updateExportSettingsManualControlsDisabled(autoSync) {
    els.exportSettingsPathInput.disabled = autoSync;
    els.exportSettingsSaveBtn.disabled = autoSync;
    els.exportSettingsBrowseBtn.disabled = autoSync;
    els.exportSettingsSyncNowBtn.disabled = !autoSync;
  }

  let exportSettingsSyncPollTimer = null;

  async function loadExportSettings() {
    els.exportSettingsStatus.textContent = 'Checking...';
    els.exportSettingsSyncStatus.textContent = '';
    try {
      const resp = await fetch('/api/upc-settings');
      const settings = await resp.json();
      els.exportSettingsPathInput.value = settings.configuredPath || '';
      els.exportSettingsAutoSyncCheckbox.checked = !!settings.autoSync;
      updateExportSettingsManualControlsDisabled(!!settings.autoSync);
      els.exportSettingsStatus.textContent = describeExportSettings(settings);
      els.exportSettingsSyncStatus.textContent = describeSyncStatus(settings);
    } catch {
      els.exportSettingsStatus.textContent = 'Could not check the export file settings.';
    }
  }

  // Keeps the sync status line live while the dialog stays open, since a
  // successful/failed sync can happen in the background on its own 30s
  // timer (see exportSync.js) at any point while staff are looking at this
  // dialog - same "poll one line, don't touch the rest" pattern the Server
  // PC dialog uses for its own "Main store PC on this network" line.
  async function refreshExportSyncStatus() {
    try {
      const resp = await fetch('/api/upc-settings');
      const settings = await resp.json();
      if (!resp.ok) return;
      els.exportSettingsSyncStatus.textContent = describeSyncStatus(settings);
      if (settings.autoSync) els.exportSettingsStatus.textContent = describeExportSettings(settings);
    } catch {
      // ignore - loadExportSettings already surfaces a real failure on open/save
    }
  }

  const exportSettingsModal = createModal({
    overlay: els.exportSettingsOverlay,
    closeBtns: [els.exportSettingsCloseBtn, els.exportSettingsCloseFooterBtn],
    onOpen: () => {
      loadExportSettings();
      exportSettingsSyncPollTimer = setInterval(refreshExportSyncStatus, 5000);
    },
    onClose: () => {
      clearInterval(exportSettingsSyncPollTimer);
      exportSettingsSyncPollTimer = null;
    },
  });

  els.exportSettingsSaveBtn.addEventListener('click', async () => {
    els.exportSettingsSaveBtn.disabled = true;
    els.exportSettingsStatus.textContent = 'Saving...';
    try {
      const resp = await fetch('/api/upc-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exportPath: els.exportSettingsPathInput.value.trim() }),
      });
      const settings = await resp.json();
      if (!resp.ok) throw new Error(settings.error || 'Could not save that location.');
      els.exportSettingsStatus.textContent = describeExportSettings(settings);
    } catch (err) {
      els.exportSettingsStatus.textContent = err.message || 'Could not save that location.';
    } finally {
      els.exportSettingsSaveBtn.disabled = false;
    }
  });

  els.exportSettingsAutoSyncCheckbox.addEventListener('change', async () => {
    const autoSync = els.exportSettingsAutoSyncCheckbox.checked;
    els.exportSettingsAutoSyncCheckbox.disabled = true;
    els.exportSettingsSyncStatus.textContent = 'Saving...';
    try {
      const resp = await fetch('/api/upc-settings/auto-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSync }),
      });
      const settings = await resp.json();
      if (!resp.ok) throw new Error(settings.error || 'Could not save that setting.');
      updateExportSettingsManualControlsDisabled(!!settings.autoSync);
      els.exportSettingsStatus.textContent = describeExportSettings(settings);
      els.exportSettingsSyncStatus.textContent = describeSyncStatus(settings);
    } catch (err) {
      els.exportSettingsAutoSyncCheckbox.checked = !autoSync;
      els.exportSettingsSyncStatus.textContent = err.message || 'Could not save that setting.';
    } finally {
      els.exportSettingsAutoSyncCheckbox.disabled = false;
    }
  });

  // Forces an immediate pull from the Server PC instead of waiting up to
  // ~30s for the puller's own interval (see exportSync.js's syncOnce) -
  // only enabled while auto-sync is on (see updateExportSettingsManualControlsDisabled
  // above). Reuses describeExportSettings/describeSyncStatus so the result
  // reads exactly the same as a background sync completing on its own.
  els.exportSettingsSyncNowBtn.addEventListener('click', async () => {
    els.exportSettingsSyncNowBtn.disabled = true;
    els.exportSettingsSyncStatus.textContent = 'Syncing...';
    try {
      const resp = await fetch('/api/upc-settings/sync-now', { method: 'POST' });
      const settings = await resp.json();
      if (!resp.ok) throw new Error(settings.error || 'Could not sync right now.');
      els.exportSettingsStatus.textContent = describeExportSettings(settings);
      els.exportSettingsSyncStatus.textContent = describeSyncStatus(settings);
    } catch (err) {
      els.exportSettingsSyncStatus.textContent = err.message || 'Could not sync right now.';
    } finally {
      els.exportSettingsSyncNowBtn.disabled = !els.exportSettingsAutoSyncCheckbox.checked;
    }
  });

  // The desktop app can offer a native file picker (see electron/main.js);
  // the plain browser dev copy has no equivalent, so the button only shows
  // up when that bridge actually exists (see preload.js) - typing/pasting
  // the path is always available either way.
  if (window.shelfTalker && window.shelfTalker.pickUpcExportFile) {
    els.exportSettingsBrowseBtn.hidden = false;
    els.exportSettingsBrowseBtn.addEventListener('click', async () => {
      const filePath = await window.shelfTalker.pickUpcExportFile();
      if (!filePath) return;
      els.exportSettingsPathInput.value = filePath;
      els.exportSettingsSaveBtn.click();
    });
  }

  // ---------- Import Beer Bible from Export File… (Advanced menu) ----------
  //
  // In-app counterpart to scripts/populate-beer-bible-from-export.js, run
  // via server/beerBibleImport.js's job (see that module's own header for
  // why this exists as a separate thing from that script). This section
  // only ever talks to /api/beers/import/*; the actual Untappd matching and
  // file parsing all happen server-side.

  let beerBibleImportPollTimer = null;

  // Renders whichever of #beerBibleImportSetup/#beerBibleImportProgress
  // matches the job's current state - called on open and after every poll,
  // so reopening the dialog mid-import (or after it finished while closed)
  // shows the right thing immediately rather than the stale "not started"
  // view for a beat.
  function renderBeerBibleImportStatus(status) {
    const started = status.running || status.processed > 0 || status.total > 0;
    els.beerBibleImportSetup.hidden = started;
    els.beerBibleImportProgress.hidden = !started;
    if (!started) return;

    els.beerBibleImportProgressBar.max = status.total || 1;
    els.beerBibleImportProgressBar.value = status.processed;
    els.beerBibleImportProgressLine.textContent = `${status.processed}/${status.total} - `
      + `matched ${status.matched}, no Untappd match ${status.noMatch}, ambiguous ${status.ambiguous}, `
      + `error ${status.errored}, already saved ${status.skipped}`;
    els.beerBibleImportCurrentTitle.textContent = status.running ? `Checking "${status.currentTitle}"...` : '';
    els.beerBibleImportCancelBtn.hidden = !status.running;
    els.beerBibleImportStartOverBtn.hidden = status.running;

    if (!status.running) {
      const finishedLine = status.cancelled ? 'Cancelled.' : status.fatalError ? `Stopped: ${status.fatalError}` : 'Done.';
      els.beerBibleImportProgressLine.textContent = `${finishedLine} ${els.beerBibleImportProgressLine.textContent}`;
    }
  }

  async function pollBeerBibleImportStatus() {
    try {
      const resp = await fetch('/api/beers/import/status');
      const status = await resp.json();
      renderBeerBibleImportStatus(status);
      // Once the job stops, one more render already happened above with
      // running:false - no need to keep polling until Start is clicked
      // again.
      if (!status.running) {
        clearInterval(beerBibleImportPollTimer);
        beerBibleImportPollTimer = null;
      }
    } catch {
      // A transient fetch failure just waits for the next poll tick -
      // nothing to surface staff can act on mid-poll.
    }
  }

  function startBeerBibleImportPolling() {
    if (beerBibleImportPollTimer) return;
    pollBeerBibleImportStatus();
    beerBibleImportPollTimer = setInterval(pollBeerBibleImportStatus, 1000);
  }

  const beerBibleImportModal = createModal({
    overlay: els.beerBibleImportOverlay,
    closeBtns: [els.beerBibleImportCloseBtn, els.beerBibleImportCloseFooterBtn],
    onOpen: async () => {
      els.beerBibleImportPathInput.value = '';
      els.beerBibleImportSetupStatus.textContent = '';
      // Always check current status on open, even if nothing here started
      // it - a job kicked off before this dialog was last closed is still
      // running server-side (see this section's own header comment).
      const resp = await fetch('/api/beers/import/status');
      const status = await resp.json();
      renderBeerBibleImportStatus(status);
      if (status.running) startBeerBibleImportPolling();
    },
    onClose: () => {
      clearInterval(beerBibleImportPollTimer);
      beerBibleImportPollTimer = null;
    },
  });

  els.beerBibleImportStartBtn.addEventListener('click', async () => {
    const filePath = els.beerBibleImportPathInput.value.trim();
    if (!filePath) {
      els.beerBibleImportSetupStatus.textContent = 'Enter or browse to a file path first.';
      return;
    }
    els.beerBibleImportStartBtn.disabled = true;
    els.beerBibleImportSetupStatus.textContent = 'Starting...';
    try {
      const resp = await fetch('/api/beers/import/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
      const status = await resp.json();
      if (!resp.ok) throw new Error(status.error || 'Could not start the import.');
      renderBeerBibleImportStatus(status);
      startBeerBibleImportPolling();
    } catch (err) {
      els.beerBibleImportSetupStatus.textContent = err.message || 'Could not start the import.';
    } finally {
      els.beerBibleImportStartBtn.disabled = false;
    }
  });

  els.beerBibleImportCancelBtn.addEventListener('click', async () => {
    els.beerBibleImportCancelBtn.disabled = true;
    try {
      const resp = await fetch('/api/beers/import/cancel', { method: 'POST' });
      renderBeerBibleImportStatus(await resp.json());
    } finally {
      els.beerBibleImportCancelBtn.disabled = false;
    }
  });

  // Goes back to the path/Start view for a second file - the job itself
  // already stopped (this button is only shown once !status.running, see
  // renderBeerBibleImportStatus), so this is just resetting the dialog's
  // own view, not touching anything server-side.
  els.beerBibleImportStartOverBtn.addEventListener('click', () => {
    els.beerBibleImportPathInput.value = '';
    els.beerBibleImportSetupStatus.textContent = '';
    els.beerBibleImportSetup.hidden = false;
    els.beerBibleImportProgress.hidden = true;
  });

  if (window.shelfTalker && window.shelfTalker.pickBeerBibleImportFile) {
    els.beerBibleImportBrowseBtn.hidden = false;
    els.beerBibleImportBrowseBtn.addEventListener('click', async () => {
      const filePath = await window.shelfTalker.pickBeerBibleImportFile();
      if (!filePath) return;
      els.beerBibleImportPathInput.value = filePath;
    });
  }

  // Also reachable via Advanced > Export File Settings… in the menu bar
  // (see runMenuAction's 'export-settings' case).

  const exportPreviewModal = createModal({
    overlay: els.exportPreviewOverlay,
    closeBtns: [els.exportPreviewCloseBtn, els.exportPreviewCloseFooterBtn],
    // Starts from a blank search every time the dialog is opened, rather
    // than whatever was typed the last time it was open - "reopen this
    // dialog" should mean "look at the file fresh", not "still filtered
    // from ten minutes ago".
    onOpen: () => {
      els.exportPreviewSearchInput.value = '';
      loadExportPreview('');
    },
  });

  // Bumped on every call so a slow response to an old keystroke can't land
  // after a faster response to a newer one and clobber it with stale
  // results - same "newest wins" guard as Search by Name's own
  // nameSearchSelectToken.
  let exportPreviewToken = 0;

  async function loadExportPreview(query) {
    els.exportPreviewStatus.textContent = 'Loading...';
    els.exportPreviewTableWrap.innerHTML = '';
    const token = (exportPreviewToken += 1);
    try {
      const q = (query || '').trim();
      const url = q ? `/api/export-preview?limit=200&q=${encodeURIComponent(q)}` : '/api/export-preview?limit=200';
      const resp = await fetch(url);
      const data = await resp.json();
      if (token !== exportPreviewToken) return; // superseded by a newer search
      if (!resp.ok) {
        const err = new Error(data.error || 'Could not read the export file.');
        err.code = data.code;
        throw err;
      }
      // While auto-sync is on, data.exportPath is this PC's own internal
      // synced-copy file (see upcCatalog.js's syncedExportFilePath) - not
      // something staff would recognize, so name the source they'd actually
      // expect instead.
      const source = data.autoSync ? 'the file synced from the Server PC' : data.exportPath;
      els.exportPreviewStatus.textContent = q
        ? `Showing ${data.rows.length} of ${data.matchedRows.toLocaleString('en-US')} row${data.matchedRows === 1 ? '' : 's'} matching “${q}” (${data.totalRows.toLocaleString('en-US')} total) from ${source}`
        : `Showing ${data.rows.length} of ${data.totalRows.toLocaleString('en-US')} row${data.totalRows === 1 ? '' : 's'} from ${source}`;
      renderPreviewTable(els.exportPreviewTableWrap, data.headers, data.rows);
    } catch (err) {
      if (token !== exportPreviewToken) return;
      els.exportPreviewStatus.textContent = err.message || 'Could not read the export file.';
    }
  }

  // Filters the table above to rows containing this text anywhere in the
  // row - a plain substring match run server-side over the *whole* file
  // (see previewExport's own note on why), debounced the same 200ms as
  // Search by Name so a fast typist doesn't fire a request per keystroke.
  let exportPreviewSearchDebounce;
  els.exportPreviewSearchInput.addEventListener('input', () => {
    clearTimeout(exportPreviewSearchDebounce);
    const { value } = els.exportPreviewSearchInput;
    exportPreviewSearchDebounce = setTimeout(() => loadExportPreview(value), 200);
  });

  // Closes this dialog and opens Export File Settings directly - lets
  // someone go straight from "the export file isn't set up" to fixing it,
  // instead of hunting for the Advanced menu item themselves.
  els.exportPreviewSettingsBtn.addEventListener('click', () => {
    exportPreviewModal.close();
    exportSettingsModal.open();
  });

  let serverPcPollTimer = null;

  const serverPcModal = createModal({
    overlay: els.serverPcOverlay,
    closeBtns: [els.serverPcCloseBtn, els.serverPcCloseFooterBtn],
    onOpen: () => {
      loadServerPcStatus();
      // Keeps "Main store PC on this network" live while the dialog is open,
      // e.g. if staff open it on a second PC right after marking the first
      // one - without this they'd have to close and reopen to see it appear.
      // Only refreshes that one line (see refreshDiscoveredServer), so it
      // can't clobber an in-progress checkbox edit or Save.
      serverPcPollTimer = setInterval(refreshDiscoveredServer, 5000);
    },
    onClose: () => {
      clearInterval(serverPcPollTimer);
      serverPcPollTimer = null;
    },
  });

  // Renders data.discoveredServer (see server/discovery.js) into the
  // dialog's "Main store PC on this network" line.
  function describeDiscoveredServer(data) {
    if (data.discoveredServer) {
      const { hostname, addresses, confirmedAt } = data.discoveredServer;
      const where = addresses && addresses.length ? addresses.join(', ') : 'address unknown';
      const confirmed = confirmedAt ? `, confirmed ${formatHistoryTimestamp(confirmedAt)}` : '';
      return `${hostname} (${where})${confirmed}`;
    }
    if (data.isServer) return 'This PC — no other PC on this network is currently announcing one.';
    return 'None seen yet on this network.';
  }

  async function loadServerPcStatus() {
    els.serverPcStatus.textContent = 'Loading...';
    try {
      const resp = await fetch('/api/server-status');
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not check this PC\'s status.');

      els.serverPcAddresses.textContent = data.addresses.length ? data.addresses.join(', ') : 'Not connected to a network';
      els.serverPcHistoryCount.textContent = data.stats.printedTalkers.toLocaleString('en-US');
      els.serverPcDiscovered.textContent = describeDiscoveredServer(data);
      els.serverPcCheckbox.checked = data.isServer;
      els.serverPcStatus.textContent = data.isServer && data.confirmedAt
        ? `Marked as the main store PC on ${formatHistoryTimestamp(data.confirmedAt)}.`
        : '';
    } catch (err) {
      els.serverPcStatus.textContent = err.message || 'Could not check this PC\'s status.';
    }
  }

  // Background refresh while the dialog stays open (see onOpen above) -
  // deliberately touches only the discovered-server line, not the checkbox,
  // counts, or save status, so it can't stomp on something the user is in
  // the middle of doing. Errors are swallowed: loadServerPcStatus() already
  // surfaces a real failure message when the dialog is opened or saved.
  async function refreshDiscoveredServer() {
    try {
      const resp = await fetch('/api/server-status');
      const data = await resp.json();
      if (resp.ok) els.serverPcDiscovered.textContent = describeDiscoveredServer(data);
    } catch {
      // ignore - see comment above
    }
  }

  els.serverPcSaveBtn.addEventListener('click', async () => {
    els.serverPcSaveBtn.disabled = true;
    els.serverPcStatus.textContent = 'Saving...';
    try {
      const resp = await fetch('/api/server-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isServer: els.serverPcCheckbox.checked }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not save.');
      els.serverPcStatus.textContent = data.isServer
        ? `Marked as the main store PC on ${formatHistoryTimestamp(data.confirmedAt)}.`
        : 'This PC is no longer marked as the main store PC.';
    } catch (err) {
      els.serverPcStatus.textContent = err.message || 'Could not save.';
    } finally {
      els.serverPcSaveBtn.disabled = false;
    }
  });

  // These two, and Settings below, are reachable via the menu bar's
  // Advanced/Tools items (see runMenuAction's 'view-export'/'server-pc'/
  // 'settings' cases) in both Electron and a plain browser tab -
  // each panel's own content comes from the same-origin API either way.

  // Settings' left-hand sidebar (see .settings-sidebar/.settings-panel in
  // index.html) - swaps which .settings-panel is visible rather than
  // stacking every settings group into one long scroll, so a new group
  // later is a new nav button + panel, not more scrolling. Panel/button
  // pairing is by data-settings-panel/data-settings-panel-content, not
  // array position, so the two lists don't have to stay in lockstep order.
  function activateSettingsPanel(name) {
    els.settingsNavButtons.forEach((btn) => {
      const isActive = btn.dataset.settingsPanel === name;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-current', String(isActive));
    });
    els.settingsPanels.forEach((panel) => {
      panel.hidden = panel.dataset.settingsPanelContent !== name;
    });
  }
  els.settingsNavButtons.forEach((btn) => {
    btn.addEventListener('click', () => activateSettingsPanel(btn.dataset.settingsPanel));
  });

  // onOpen re-syncs the toggle buttons rather than relying on applyAccent's
  // own initial call (below) to have kept them current - harmless either
  // way, but this is the one place that has to be right every time the
  // dialog opens. Also resets the sidebar back to General each time, so the
  // dialog never reopens on whatever panel it was left on last.
  const settingsModal = createModal({
    overlay: els.settingsOverlay,
    closeBtns: [els.settingsCloseBtn, els.settingsCloseFooterBtn],
    onOpen: () => {
      activateSettingsPanel('general');
      applyAccent(currentAccent());
      applyMenuSize(currentMenuSize());
      els.experimentalPairingsCheckbox.checked = experimentalPairingsEnabled;
      els.experimentalProfileCheckbox.checked = experimentalProfileEnabled;
    },
  });

  // ---------- Rail (Shelf Talker / Library / Pairing Atlas / Settings) ----------
  //
  // Settings isn't a fourth screen - its rail button just opens the same
  // settingsModal above, unchanged. Shelf Talker, Library, Atlas, and Beer
  // Bible are real screens: exactly one of els.shelfTalkerView (the
  // existing .layout three-column form/preview/queue grid, untouched) /
  // els.libraryView / els.atlasView / els.beerBibleView is visible at a
  // time, toggled here rather than with the tabs' full role="tablist"
  // machinery (see activateTab) - this is a whole-screen swap, not adjacent
  // panels of one form.
  let activeRailView = 'shelfTalker';

  function setActiveView(view) {
    activeRailView = view;
    clearInterval(librarySyncPollTimer);
    librarySyncPollTimer = null;
    els.railShelfTalkerBtn.classList.toggle('is-active', view === 'shelfTalker');
    els.railLibraryBtn.classList.toggle('is-active', view === 'library');
    els.railAtlasBtn.classList.toggle('is-active', view === 'atlas');
    els.railBeerBibleBtn.classList.toggle('is-active', view === 'beerBible');
    els.shelfTalkerView.hidden = view !== 'shelfTalker';
    els.libraryView.hidden = view !== 'library';
    els.atlasView.hidden = view !== 'atlas';
    els.beerBibleView.hidden = view !== 'beerBible';
    // The Library, Atlas, and Beer Bible screens render their own header
    // band (name, search, stats) the moment they're shown - the "Shelf
    // Talker Wizard" app bar above it would just be a second, redundant
    // header, so it only shows on the Shelf Talker screen that actually
    // needs it.
    els.appBar.hidden = view !== 'shelfTalker';
    if (view === 'shelfTalker') {
      // The preview stage reads 0 for its own width while
      // els.shelfTalkerView is hidden (display:none), so scalePreview
      // silently no-ops on it - but the global window resize handler below
      // still fires no matter which screen is showing, leaving the cached
      // scale stale for whenever this screen becomes visible again. Same
      // fix as an actual window resize: just rescale now that it's visible.
      rescalePreviewStage();
    } else if (view === 'library') {
      renderLibraryView();
      // Keeps the sync status line (dot + timestamp) live while staff stay
      // on this screen, since a sync can happen in the background on its
      // own ~30s timer at any point - same "poll while open" pattern Export
      // File Settings uses for its own sync status line. Doesn't re-render
      // the grid itself, so browsing/a selected profile isn't disrupted
      // mid-poll.
      librarySyncPollTimer = setInterval(async () => {
        const data = await fetchMashBillLibrary();
        if (data) updateLibrarySyncUI(data.sync);
      }, 5000);
    } else if (view === 'atlas') {
      renderAtlasView();
    } else if (view === 'beerBible') {
      // No sync status to poll for here (unlike Library above) - the Beer
      // Bible has no cross-register sync yet, see its own rail-view section
      // further up.
      renderBeerBibleView();
    }
  }

  els.railShelfTalkerBtn.addEventListener('click', () => setActiveView('shelfTalker'));
  els.railLibraryBtn.addEventListener('click', () => setActiveView('library'));
  els.railAtlasBtn.addEventListener('click', () => setActiveView('atlas'));
  els.railBeerBibleBtn.addEventListener('click', () => setActiveView('beerBible'));
  els.railSettingsBtn.addEventListener('click', () => settingsModal.open());

  // ---------- Menu bar ----------
  //
  // Replaces Electron's native File/Tools/Help/Advanced menu (see
  // electron/main.js) with our own, so its size is something Settings can
  // actually control (see applyMenuSize above) instead of inheriting
  // whatever Windows' own menu font/DPI setting happens to be. Renders in
  // both Electron and a plain browser tab; items that need real OS access
  // (native file dialogs, DevTools, checking for updates, the About
  // dialog's app version) are marked [data-requires-electron] in
  // index.html and disabled below when window.shelfTalker doesn't exist.
  //
  // Keyboard accelerators (Ctrl+O/S/F, Ctrl+Shift+I) are bound ONLY inside
  // Electron - binding them unconditionally would hijack a plain browser
  // tab's own Ctrl+F/Ctrl+S, exactly what Find Queue's own matching was
  // already careful to avoid. Every accelerator-bound action is still
  // reachable by clicking the menu regardless of context.

  // Routes a clicked/activated menu item to its real behavior. Items that
  // just open an in-page modal call it directly (no IPC needed at all -
  // that's the whole point of owning the menu now); items needing native
  // OS access go through window.shelfTalker (see preload.js), which is
  // undefined outside Electron, so those quietly no-op there instead of
  // throwing (the items are also visibly disabled - see initMenuBar).
  function runMenuAction(action) {
    switch (action) {
      case 'open-queue':
        window.shelfTalker?.openQueueFile();
        break;
      case 'save-queue':
        if (queue.length === 0) return;
        if (window.shelfTalker) window.shelfTalker.saveQueueToFile(buildQueueExportPayload());
        else saveQueueToFile();
        break;
      case 'exit':
        window.shelfTalker?.quitApp();
        break;
      case 'find-queue':
        findQueueModal.open();
        break;
      case 'beer-talker-info':
        guidePreviewModal.open();
        break;
      case 'wine-pairing-rules':
        winePairingRulesModal.open();
        break;
      case 'settings':
        settingsModal.open();
        break;
      case 'help':
        helpModal.open();
        break;
      case 'whats-new':
        showWhatsNewEntries(WHATS_NEW_ENTRIES);
        whatsNewModal.open();
        break;
      case 'check-updates':
        window.shelfTalker?.checkForUpdates();
        break;
      case 'about':
        window.shelfTalker?.showAbout();
        break;
      case 'toggle-devtools':
        window.shelfTalker?.toggleDevTools();
        break;
      case 'export-settings':
        exportSettingsModal.open();
        break;
      case 'view-export':
        exportPreviewModal.open();
        break;
      case 'server-pc':
        serverPcModal.open();
        break;
      case 'beer-bible-import':
        beerBibleImportModal.open();
        break;
      default:
        break;
    }
  }

  // Progressively enhances every Type/Product Type <select> (see the
  // shared .type-select/.product-type-select note in index.html) into a
  // custom button+listbox dropdown that looks and behaves like the menu
  // bar's own dropdowns below (initMenuBar), instead of the browser's
  // native select popup. The <select> itself stays in the DOM - just
  // hidden - and remains the single source of truth: this widget only
  // ever reads its .options/.value and, on a pick, sets .value and
  // dispatches 'change' on it, so every existing change listener,
  // applyFormMode, and syncSelects call elsewhere in this file (which is
  // what keeps every tab's copy of these two dropdowns showing the same
  // value) keeps working untouched. syncSelects calls back into this via
  // select._fieldSelectRefresh after it sets .value programmatically,
  // since that doesn't fire 'change' on its own.
  (function initFieldSelects() {
    const selects = [...document.querySelectorAll('.type-select, .product-type-select')];
    if (!selects.length) return;

    const instances = [];

    function closeAll({ except } = {}) {
      instances.forEach((inst) => {
        if (inst === except || !inst.root.classList.contains('is-open')) return;
        inst.root.classList.remove('is-open');
        inst.trigger.setAttribute('aria-expanded', 'false');
      });
    }

    selects.forEach((select) => {
      // The <span> caption next to the select (see the div.field note
      // above .type-product-row in index.html) - its id becomes the
      // custom trigger/listbox's accessible name in place of the
      // <select>'s own aria-label, which goes along for the ride once
      // hidden but is otherwise unused now that nothing points a <label>
      // at the select anymore.
      const labelEl = select.closest('.field')?.querySelector('span[id]');

      const root = document.createElement('div');
      root.className = 'field-select';

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'field-select__trigger';
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');

      const valueEl = document.createElement('span');
      valueEl.className = 'field-select__value';
      if (labelEl) {
        // Combines the field's own caption ("Type") with the currently
        // picked value's id, so the accessible name reads like "Type,
        // Shelf Talker" - close to what a native select announces -
        // and stays current on its own since it's the same element
        // refresh() below re-labels on every change.
        valueEl.id = `${labelEl.id}-value`;
        trigger.setAttribute('aria-labelledby', `${labelEl.id} ${valueEl.id}`);
      }
      trigger.appendChild(valueEl);

      const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chevron.setAttribute('class', 'field-select__chevron');
      chevron.setAttribute('viewBox', '0 0 12 8');
      chevron.setAttribute('aria-hidden', 'true');
      chevron.innerHTML = '<path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
      trigger.appendChild(chevron);

      const listbox = document.createElement('div');
      listbox.className = 'field-select__dropdown';
      listbox.setAttribute('role', 'listbox');
      if (labelEl) listbox.setAttribute('aria-labelledby', labelEl.id);

      const options = [...select.options].map((opt) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'field-select__option';
        item.setAttribute('role', 'option');
        item.dataset.value = opt.value;
        const check = document.createElement('span');
        check.className = 'field-select__option-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = '✓';
        const label = document.createElement('span');
        label.className = 'field-select__option-label';
        label.textContent = opt.textContent;
        item.append(check, label);
        listbox.appendChild(item);
        return item;
      });

      root.append(trigger, listbox);
      select.insertAdjacentElement('afterend', root);
      // Stays in the DOM (so .value/dispatchEvent keep working exactly as
      // before) but out of the layout and off the a11y tree - the custom
      // trigger/listbox above is the only thing anyone actually sees,
      // clicks, or tabs to now.
      select.hidden = true;

      function refresh() {
        const opt = select.options[select.selectedIndex];
        valueEl.textContent = opt ? opt.textContent : '';
        options.forEach((item) => {
          item.setAttribute('aria-selected', String(item.dataset.value === select.value));
        });
      }
      select._fieldSelectRefresh = refresh;
      refresh();

      const inst = { root, trigger };
      instances.push(inst);

      function open({ focusSelected = false } = {}) {
        closeAll({ except: inst });
        root.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        if (focusSelected) {
          (options.find((o) => o.getAttribute('aria-selected') === 'true') || options[0])?.focus();
        }
      }
      function close({ refocus = false } = {}) {
        if (!root.classList.contains('is-open')) return;
        root.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
        if (refocus) trigger.focus();
      }
      function pick(item) {
        if (select.value !== item.dataset.value) {
          select.value = item.dataset.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        refresh();
        close({ refocus: true });
      }

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (root.classList.contains('is-open')) close({ refocus: true });
        else open({ focusSelected: true });
      });
      trigger.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open({ focusSelected: true });
        } else if (e.key === 'Escape' && root.classList.contains('is-open')) {
          e.preventDefault();
          close({ refocus: true });
        }
      });

      options.forEach((item) => {
        item.addEventListener('click', (e) => { e.stopPropagation(); pick(item); });
        item.addEventListener('mouseenter', () => item.focus());
        item.addEventListener('keydown', (e) => {
          // Same reasoning as the equivalent stopPropagation in
          // initMenuBar below - without it this would also reach the
          // trigger's own keydown listener above and immediately re-open
          // on top of whatever this handler just did.
          e.stopPropagation();
          const idx = options.indexOf(item);
          if (e.key === 'ArrowDown') { e.preventDefault(); (options[idx + 1] || options[0]).focus(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); (options[idx - 1] || options[options.length - 1]).focus(); }
          else if (e.key === 'Home') { e.preventDefault(); options[0].focus(); }
          else if (e.key === 'End') { e.preventDefault(); options[options.length - 1].focus(); }
          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(item); }
          else if (e.key === 'Escape') { e.preventDefault(); close({ refocus: true }); }
        });
      });
    });

    document.addEventListener('click', () => closeAll());
    // A dropdown left open shouldn't trap Tab - once focus actually leaves
    // its own root for good, close it, same as initMenuBar's identical
    // guard below.
    instances.forEach((inst) => {
      inst.root.addEventListener('focusout', (e) => {
        if (!inst.root.contains(e.relatedTarget)) closeAll();
      });
    });
  })();

  // Open/close, hover-to-switch, and full keyboard navigation for the menu
  // bar - the same behavior Windows' native menu used to give for free
  // (see the "what we'd own" side of the menu-bar-size conversation this
  // was built from). Wrapped in its own IIFE purely to scope the handful
  // of helper closures below without leaking them into the rest of the
  // file.
  (function initMenuBar() {
    const bar = els.menuBar;
    if (!bar) return;

    const topItems = [...bar.querySelectorAll(':scope > .menubar__item')];

    // Outside Electron, gray out (rather than hide) anything that needs
    // real OS access - still visible, so someone testing the plain
    // browser dev copy can see what the desktop app offers, but inert.
    if (!window.shelfTalker) {
      bar.querySelectorAll('[data-requires-electron]').forEach((el) => {
        el.setAttribute('aria-disabled', 'true');
        el.title = 'Only available in the desktop app';
      });
    }

    function dropdownItemsOf(topItem) {
      return [...topItem.querySelectorAll('.menubar__dropdown-item')];
    }
    function enabledDropdownItemsOf(topItem) {
      // Excludes both requires-electron greyed-out items (aria-disabled)
      // and conditionally-hidden ones like Wine Pairing Rules (hidden
      // while its experimental feature is off, see applyExperimentalPairings)
      // - without the hidden check, arrow-key/Home/End navigation would
      // still count a hidden item as a stop and try to .focus() it, a
      // silent no-op that leaves the roving focus stuck.
      return dropdownItemsOf(topItem).filter((el) => el.getAttribute('aria-disabled') !== 'true' && !el.hidden);
    }

    function closeAllMenus({ refocus = false } = {}) {
      topItems.forEach((item) => {
        delete item.dataset.justHoverOpened;
        if (!item.classList.contains('is-open')) return;
        item.classList.remove('is-open');
        item.setAttribute('aria-expanded', 'false');
        if (refocus) item.focus();
      });
    }

    // Roving tabindex across the top-level items (File/Tools/Help/
    // Advanced) - only one is ever a Tab stop at a time; arrow keys move
    // it, same keyboard model as a real menu bar.
    function setRovingFocus(target) {
      topItems.forEach((item) => item.setAttribute('tabindex', item === target ? '0' : '-1'));
      target.focus();
    }

    function openMenu(topItem, { focusFirst = false } = {}) {
      closeAllMenus();
      topItem.classList.add('is-open');
      topItem.setAttribute('aria-expanded', 'true');
      setRovingFocus(topItem);
      if (focusFirst) enabledDropdownItemsOf(topItem)[0]?.focus();
    }

    function isAnyMenuOpen() {
      return topItems.some((item) => item.classList.contains('is-open'));
    }

    function adjacentTopItem(current, delta) {
      const idx = topItems.indexOf(current);
      return topItems[(idx + delta + topItems.length) % topItems.length];
    }

    function activateDropdownItem(el) {
      if (el.getAttribute('aria-disabled') === 'true') return;
      closeAllMenus();
      runMenuAction(el.dataset.action);
    }

    topItems.forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        // A hover-switch (below) already opened this item a moment ago,
        // as part of the same gesture that's now clicking it - without
        // this check, the click's own toggle logic would see "already
        // open" and immediately close what the hover just opened, which
        // looks like the menu never responded to the click at all.
        if (item.dataset.justHoverOpened) {
          delete item.dataset.justHoverOpened;
          return;
        }
        if (item.classList.contains('is-open')) closeAllMenus({ refocus: true });
        else openMenu(item);
      });
      // Switches which menu is open on hover, but only once one is
      // already open via a click - hovering the bar with nothing open
      // shouldn't pop a menu open on its own, same as a real menu bar.
      item.addEventListener('mouseenter', () => {
        if (isAnyMenuOpen() && !item.classList.contains('is-open')) {
          openMenu(item, { focusFirst: true });
          item.dataset.justHoverOpened = '1';
        }
      });
      item.addEventListener('mouseleave', () => { delete item.dataset.justHoverOpened; });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const next = adjacentTopItem(item, e.key === 'ArrowRight' ? 1 : -1);
          if (item.classList.contains('is-open')) openMenu(next, { focusFirst: true });
          else setRovingFocus(next);
        } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openMenu(item, { focusFirst: true });
        } else if (e.key === 'Escape' && item.classList.contains('is-open')) {
          e.preventDefault();
          closeAllMenus({ refocus: true });
        }
      });
    });

    bar.querySelectorAll('.menubar__dropdown-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        activateDropdownItem(el);
      });
      el.addEventListener('mouseenter', () => el.focus());
      el.addEventListener('keydown', (e) => {
        // Without this, every key here would also reach the ancestor
        // top-level item's own keydown listener (keydown bubbles, and a
        // dropdown item is a descendant of its .menubar__item) - which
        // has its own handling for the same keys and would immediately
        // undo whatever this handler just did (e.g. ArrowDown moving
        // focus to the next item, only for the top-level handler to reset
        // it back to the first item a moment later).
        e.stopPropagation();
        const topItem = el.closest('.menubar__item');
        const items = enabledDropdownItemsOf(topItem);
        const idx = items.indexOf(el);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          (items[idx + 1] || items[0])?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          (items[idx - 1] || items[items.length - 1])?.focus();
        } else if (e.key === 'Home') {
          e.preventDefault();
          items[0]?.focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          items[items.length - 1]?.focus();
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          openMenu(adjacentTopItem(topItem, e.key === 'ArrowRight' ? 1 : -1), { focusFirst: true });
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activateDropdownItem(el);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeAllMenus({ refocus: true });
        }
      });
    });

    document.addEventListener('click', () => closeAllMenus());
    // A menu left open shouldn't trap Tab - once focus actually leaves the
    // bar for good (not just moving from one of its own items to another),
    // close everything so nothing is left showing.
    bar.addEventListener('focusout', (e) => {
      if (!bar.contains(e.relatedTarget)) closeAllMenus();
    });
  })();

  if (window.shelfTalker) {
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'o') {
        e.preventDefault();
        runMenuAction('open-queue');
      } else if (key === 's') {
        e.preventDefault();
        runMenuAction('save-queue');
      } else if (key === 'f') {
        e.preventDefault();
        runMenuAction('find-queue');
      } else if (e.shiftKey && key === 'i') {
        e.preventDefault();
        runMenuAction('toggle-devtools');
      }
    });
  }

  function triggerPrint() {
    // Inside the packaged desktop app, print through the main process (see
    // electron/main.js) instead of window.print() - Electron's renderer-side
    // print doesn't reliably apply our page size or print backgrounds.
    if (window.shelfTalker && window.shelfTalker.print) {
      window.shelfTalker.print().then((result) => {
        if (result && result.success === false && result.failureReason !== 'cancelled') {
          alert(`Printing failed: ${result.failureReason || 'unknown error'}`);
        }
      });
    } else {
      window.print();
    }
  }

  // ---------- Init ----------

  applyTheme(currentTheme());
  applyAccent(currentAccent());
  // Sets up the form's initial field visibility (Bourbon fields included -
  // no separate opt-in needed for those anymore, see applyFormMode's
  // isBourbon) and syncs the Type/Product Type dropdowns to match.
  applyFormMode();
  renderTastingNotesSourceOptions();
  // Warms the Mash Bill Library cache on load rather than waiting for
  // Product Type to be switched to Bourbon for the first time, so the
  // recall banner can already show something the moment it does.
  fetchMashBillLibrary().then(refreshMashBillRecall);
  applyExperimentalPairings(experimentalPairingsEnabled);
  applyExperimentalWineProfile(experimentalProfileEnabled);
  applyExperimentalTastingNotes(experimentalTastingNotesEnabled);
  // Unlike pairingsList/ratingsList (legitimately empty until something's
  // added), the Wine Profile picker always shows all 5 rows - needs one
  // explicit render on load, since resetForm()/fillForm() (the only other
  // callers of renderProfilePicker) don't run until the form is actually
  // submitted or a queued talker is opened for editing.
  renderProfilePicker();
  applyFontSizeDefaults();
  renderReviewerSelect();
  renderQueue();
  // Syncs the toggle buttons/sheet controls/Print button label to
  // previewMode's default ('sheet') and renders it - see setPreviewMode.
  setPreviewMode(previewMode);
  checkWhatsNew();
})();
