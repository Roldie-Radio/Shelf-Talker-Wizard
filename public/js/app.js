(function () {
  const STORAGE_KEY = 'shelfTalkerQueue.v1';
  const REVIEWERS_KEY = 'shelfTalkerReviewers.v1';
  // Must match the key the inline pre-paint script in index.html reads.
  const THEME_KEY = 'shelfTalkerTheme.v1';
  const DEFAULT_REVIEWERS = ['Wine Enthusiast', 'Wine Spectator', 'Wine Advocate', 'James Suckling', 'Jim Murray'];

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
  // ≈ 22pt, sign__supersale-text's (small-sign-only) 0.042 * 1.2 * 72 *
  // 4.75in ≈ 17pt (see fSuperSaleFontSize/superSaleFontSizeField, shown only
  // for Super Sale talkers/Small Display Signs - Large Display Signs fold
  // this text into the regular sale-price line instead, see
  // buildSignPriceRowHtml in card.js).
  const DEFAULT_FONT_SIZE_PT = {
    talker: { title: 12, description: 10.5, superSalePrice: 22 },
    sign: { title: 20, description: 10, superSalePrice: 17 },
  };

  // Human-readable names for the queue list's meta line (see renderQueue).
  const SIZE_LABELS = { full: 'Full', half: 'Half', quarter: 'Quarter' };
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

  let currentSignType = 'talker'; // 'talker' | 'sign'
  let currentSignSize = 'large'; // 'small' | 'large' (Display Signs only)
  let currentTalkerSize = 'full'; // 'full' | 'half' | 'quarter' (Shelf Talkers only)
  let currentCategory = 'wine'; // 'wine' | 'beer'

  let previewMode = 'single'; // 'single' | 'sheet'
  let sheetPage = 0;

  // Auto-arrange (beta), opt-in from the Print Preview modal - off by
  // default. Only affects the Print Preview modal and the actual print
  // output (see buildAutoArrangedPages); the Full Page live preview always
  // uses grouped sheets.
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
    tabs: document.querySelectorAll('.tab'),
    panels: document.querySelectorAll('.tab-panel'),

    signTypeToggleBtns: document.querySelectorAll('.signtype-toggle .toggle-btn'),
    signSizeToggleWrap: document.getElementById('signSizeToggle'),
    signSizeToggleBtns: document.querySelectorAll('.signsize-toggle .toggle-btn'),
    categoryToggleBtns: document.querySelectorAll('.category-toggle .toggle-btn'),
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
    vintageField: document.getElementById('vintageField'),
    vintage: document.getElementById('fVintage'),
    wineRatingsField: document.getElementById('wineRatingsField'),
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
    talkerSizeField: document.getElementById('talkerSizeField'),
    talkerSize: document.getElementById('fTalkerSize'),
    talkerType: document.getElementById('fTalkerType'),
    talkerTypeSupersaleOption: document.getElementById('talkerTypeSupersaleOption'),
    superSaleFontSizeField: document.getElementById('superSaleFontSizeField'),
    superSaleFontSize: document.getElementById('fSuperSaleFontSize'),
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
    importStatus: document.getElementById('importStatus'),
    importHtmlToggle: document.getElementById('importHtmlToggle'),
    importHtmlSection: document.getElementById('importHtmlSection'),
    importHtmlInput: document.getElementById('importHtmlInput'),
    importHtmlBtn: document.getElementById('importHtmlBtn'),

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
    skuUntappdUrl: document.getElementById('skuUntappdUrl'),
    skuUntappdBtn: document.getElementById('skuUntappdBtn'),
    skuUntappdStatus: document.getElementById('skuUntappdStatus'),
    skuUntappdHtmlToggle: document.getElementById('skuUntappdHtmlToggle'),
    skuUntappdHtmlSection: document.getElementById('skuUntappdHtmlSection'),
    skuUntappdHtmlInput: document.getElementById('skuUntappdHtmlInput'),
    skuUntappdHtmlBtn: document.getElementById('skuUntappdHtmlBtn'),

    previewStage: document.getElementById('previewStage'),
    previewToggleBtns: document.querySelectorAll('.preview-toggle .toggle-btn'),
    sheetPagination: document.getElementById('sheetPagination'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    pageIndicator: document.getElementById('pageIndicator'),
    queueGrid: document.getElementById('queueGrid'),
    queueCount: document.getElementById('queueCount'),
    clearQueueBtn: document.getElementById('clearQueueBtn'),
    saveQueueBtn: document.getElementById('saveQueueBtn'),
    queueItemMenu: document.getElementById('queueItemMenu'),
    themeToggle: document.getElementById('themeToggle'),
    printBtn: document.getElementById('printBtn'),
    printRoot: document.getElementById('printRoot'),
    guideBtn: document.getElementById('guideBtn'),

    printPreviewOverlay: document.getElementById('printPreviewOverlay'),
    printPreviewSummary: document.getElementById('printPreviewSummary'),
    printPreviewSheets: document.getElementById('printPreviewSheets'),
    printPreviewCloseBtn: document.getElementById('printPreviewCloseBtn'),
    printPreviewCancelBtn: document.getElementById('printPreviewCancelBtn'),
    printPreviewConfirmBtn: document.getElementById('printPreviewConfirmBtn'),
    autoArrangeToggle: document.getElementById('autoArrangeToggle'),

    guidePreviewOverlay: document.getElementById('guidePreviewOverlay'),
    guidePreviewStage: document.getElementById('guidePreviewStage'),
    guidePreviewCloseBtn: document.getElementById('guidePreviewCloseBtn'),
    guidePreviewCancelBtn: document.getElementById('guidePreviewCancelBtn'),
    guidePreviewConfirmBtn: document.getElementById('guidePreviewConfirmBtn'),

    helpBtn: document.getElementById('helpBtn'),
    helpOverlay: document.getElementById('helpOverlay'),
    helpCloseBtn: document.getElementById('helpCloseBtn'),
    helpCloseFooterBtn: document.getElementById('helpCloseFooterBtn'),
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

  function applyFormMode() {
    const isBeer = currentCategory === 'beer';
    const isSign = currentSignType === 'sign';
    const isSmallSign = isSign && currentSignSize === 'small';

    setToggleState(els.signTypeToggleBtns, (b) => b.dataset.signtype === currentSignType);
    els.signSizeToggleWrap.hidden = !isSign;
    setToggleState(els.signSizeToggleBtns, (b) => b.dataset.signsize === currentSignSize);
    setToggleState(els.categoryToggleBtns, (b) => b.dataset.category === currentCategory);

    els.titleLabel.textContent = isBeer ? 'Beer Name *' : (isSign ? 'Product Name *' : 'Product Title *');
    els.size.placeholder = isBeer ? '16oz Can / 4-pack' : '750ml / Each / 6-pack';

    els.talkerSizeField.hidden = isSign;
    els.talkerSize.value = currentTalkerSize;
    els.descriptionField.hidden = isSmallSign;
    // Wine.com wouldn't have anything for a beer, and Beer already has its
    // own tasting-note source (the Untappd import tab) - only show the
    // button for Wine/Spirits.
    els.tastingNotesRow.hidden = isBeer;
    els.vintageField.hidden = isBeer || isSmallSign;
    els.wineRatingsField.hidden = isBeer || isSmallSign;
    // Shelf Talkers only, unlike Ratings above (which Large Display Signs
    // also show) - Awards only ever renders onto the .card printout, so
    // showing the field for a sign would offer input with no visible
    // effect there.
    els.awardsField.hidden = isBeer || isSign;
    els.beerFields.hidden = !isBeer || isSmallSign;

    // The store never runs a Super Sale on beer, so the option isn't just
    // hidden for beer - a value of 'supersale' left over from switching
    // category (or from an older saved item, see fillForm) is actively
    // cleared back to Standard rather than kept around invisibly selected.
    els.talkerTypeSupersaleOption.hidden = isBeer;
    if (isBeer && els.talkerType.value === 'supersale') els.talkerType.value = 'standard';

    // The "Super Sale Price!!!" callout only renders on the Shelf Talker
    // card and the Small Display Sign (see buildPricingHtml/
    // buildSmallSignBodyHtml in card.js) - Large Display Signs fold the
    // same text into the regular sale-price line instead, so the box would
    // have nothing to adjust there.
    const isLargeSign = isSign && !isSmallSign;
    els.superSaleFontSizeField.hidden = els.talkerType.value !== 'supersale' || isLargeSign;

    applyImportMode();
    applySkuMode();
  }

  // The SKU Lookup tab's copy - follows the same Wine/Spirits-vs-Beer
  // toggle as Manual Entry and Import from Website (see the shared
  // .category-toggle note in index.html), since a beer SKU lookup adds a
  // second, Untappd-driven step the wine/spirits path doesn't have.
  function applySkuMode() {
    const isBeer = currentCategory === 'beer';
    els.skuHelpText.textContent = isBeer
      ? 'Enter the store SKU number. We\'ll look it up on liquoroutletwinecellars.com for the title, size, and pricing, then search Untappd using that title for the description, brewery, style, ABV, IBU, and rating.'
      : 'Enter the store SKU number. We\'ll look it up on liquoroutletwinecellars.com and pull the title, size, and pricing automatically - review the fields before adding it to your queue.';
  }

  // The Import tab's copy - what it asks for and what it promises to fill
  // in - follows the same Wine/Spirits-vs-Beer toggle as Manual Entry
  // (see the shared .category-toggle note in index.html), since beer
  // import is aimed at Untappd rather than a retail product page and pulls
  // a different set of fields (no price - Untappd doesn't sell anything).
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
  }

  function setSignType(signType) {
    currentSignType = signType === 'sign' ? 'sign' : 'talker';
    // The Full Page preview is scoped to this selection (see
    // renderSheetPreview), so switching it should land back on its first
    // page rather than keeping whatever page number the previous
    // selection's sheets happened to be on.
    sheetPage = 0;
    if (!els.editId.value) applyFontSizeDefaults();
    applyFormMode();
  }

  function setSignSize(signSize) {
    currentSignSize = signSize === 'small' ? 'small' : 'large';
    sheetPage = 0;
    applyFormMode();
  }

  function setTalkerSize(talkerSize) {
    currentTalkerSize = ['half', 'quarter'].includes(talkerSize) ? talkerSize : 'full';
    sheetPage = 0;
    applyFormMode();
  }

  function setCategory(category) {
    currentCategory = category === 'beer' ? 'beer' : 'wine';
    // Purple reads as the store's beer theme, amber as wine/spirits - only
    // while composing a new entry, though. Switching category mid-edit
    // (editId set) must not silently overwrite an already-saved item's
    // deliberately-chosen theme just because someone toggled the label.
    if (!els.editId.value) els.theme.value = currentCategory === 'beer' ? 'purple' : 'amber';
    applyFormMode();
  }

  els.signTypeToggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.signtype === currentSignType) return;
      setSignType(btn.dataset.signtype);
      refreshPreview();
    });
  });

  els.signSizeToggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.signsize === currentSignSize) return;
      setSignSize(btn.dataset.signsize);
      refreshPreview();
    });
  });

  els.talkerSize.addEventListener('change', () => {
    setTalkerSize(els.talkerSize.value);
    refreshPreview();
  });

  els.categoryToggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.category === currentCategory) return;
      setCategory(btn.dataset.category);
      refreshPreview();
    });
  });

  // Only field visibility depends on Talker Style (see applyFormMode's
  // superSaleFontSizeField toggle above) - the preview itself already
  // re-renders off els.form's own 'input' listener below.
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
      talkerType: els.talkerType.value,
      superSaleFontSize: els.superSaleFontSize.value.trim(),
      ratings: currentRatings.slice(),
      awards: els.awards.value.trim(),
      awardsColor: els.awardsColor.value,
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
    currentCategory = talker.category === 'beer' ? 'beer' : 'wine';
    applyFormMode();
    els.title.value = talker.title || '';
    els.titleFontSize.value = talker.titleFontSize || DEFAULT_FONT_SIZE_PT[currentSignType].title;
    els.titleAutoSize.checked = !!talker.titleAutoSize;
    els.vintage.value = talker.vintage || '';
    els.description.value = talker.description || '';
    els.descriptionFontSize.value = talker.descriptionFontSize || DEFAULT_FONT_SIZE_PT[currentSignType].description;
    els.descriptionAutoSize.checked = !!talker.descriptionAutoSize;
    els.size.value = talker.size || '';
    els.theme.value = talker.theme || 'amber';
    els.price.value = talker.price || '';
    els.salePrice.value = talker.salePrice || '';
    els.talkerType.value = talker.talkerType || 'standard';
    // applyFormMode's own supersale-vs-beer clamp ran above, before this
    // line existed to overwrite it - re-check here so loading an older
    // saved beer item that predates this rule doesn't restore Super Sale.
    if (currentCategory === 'beer' && els.talkerType.value === 'supersale') els.talkerType.value = 'standard';
    els.superSaleFontSize.value = talker.superSaleFontSize || DEFAULT_FONT_SIZE_PT[currentSignType].superSalePrice;
    // Talker Style is now known, so the box's own visibility (hidden for
    // non-Super Sale/Large Display Sign) needs a second pass - applyFormMode
    // ran above before els.talkerType.value was set to this talker's value.
    applyFormMode();
    currentRatings = Array.isArray(talker.ratings) ? talker.ratings.slice() : [];
    renderRatingsList();
    els.awards.value = talker.awards || '';
    els.awardsColor.value = /^#[0-9a-fA-F]{6}$/.test(talker.awardsColor) ? talker.awardsColor : '#171717';
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
    applyFontSizeDefaults();
    els.editId.value = '';
    els.saveBtn.textContent = 'Add to Queue';
    els.cancelEditBtn.hidden = true;
    currentRatings = [];
    renderRatingsList();
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

  function rescalePreviewStage() {
    const scaler = els.previewStage.querySelector('.preview-scaler');
    if (scaler) scalePreview(scaler, els.previewStage.clientWidth, previewAvailableHeight());
  }

  function renderPreview() {
    els.sheetPagination.hidden = true;
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

  // A scaled-down stand-in for a printed Letter-landscape sheet. Paginates
  // by *sheet* (see buildSheets) rather than by raw item count, since each
  // sheet is one uniform layout (grid shape + card size) - Shelf Talkers,
  // Large Display Signs and Small Display Signs never share a sheet.
  //
  // Scoped to whichever sign type/size is currently selected in the form,
  // the same way "Current Talker" mode already only shows the current
  // form's entry rather than the whole queue - otherwise, since Shelf
  // Talker sheets always sort first, switching the form to Display Signs
  // and adding one would still show existing Shelf Talker sheets here
  // instead of the sign just added. The Print Preview modal (opened from
  // "Print Sheet(s)") is what shows every sheet together.
  function renderSheetPreview() {
    const currentLayoutKey = layoutKeyFor({ signType: currentSignType, signSize: currentSignSize, talkerSize: currentTalkerSize });
    const relevantItems = queue.filter((t) => layoutKeyFor(t) === currentLayoutKey);
    const sheets = buildSheets(relevantItems);
    const totalPages = Math.max(1, sheets.length);
    sheetPage = Math.min(Math.max(sheetPage, 0), totalPages - 1);

    els.previewStage.innerHTML = '';

    if (relevantItems.length === 0) {
      const label = SIGN_LAYOUTS[currentLayoutKey].label;
      els.previewStage.innerHTML = queue.length === 0
        ? '<p class="empty-hint">No shelf talkers queued yet. Add one using the form to see the full page here.</p>'
        : `<p class="empty-hint">No ${label} queued yet. Add one using the form, or switch Shelf Talkers/Display Signs above to see what else is queued.</p>`;
      els.sheetPagination.hidden = true;
      return;
    }

    const sheet = sheets[sheetPage];
    const layout = SIGN_LAYOUTS[sheet.layoutKey];

    const sheetDiv = buildSheetPreviewElement(sheet);
    els.previewStage.appendChild(makeScaler(sheetDiv));
    requestAnimationFrame(() => {
      sheetDiv.querySelectorAll('.card, .sign').forEach((el) => fitCardText(el));
      rescalePreviewStage();
    });

    els.sheetPagination.hidden = totalPages <= 1;
    els.pageIndicator.textContent = `Page ${sheetPage + 1} of ${totalPages}`;
    els.prevPageBtn.disabled = sheetPage === 0;
    els.nextPageBtn.disabled = sheetPage >= totalPages - 1;
  }

  // One 11in x 8.5in sheet, built at its literal printed size with each item
  // at its own printed width. Shared by the Full Page preview and the Print
  // Preview modal so the two can't drift apart from each other or from the
  // real print DOM (see buildPrintDom, which builds the same shapes).
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
      rescalePrintPreviewSheets();
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

  els.previewToggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.preview === previewMode) return;
      previewMode = btn.dataset.preview;
      setToggleState(els.previewToggleBtns, (b) => b === btn);
      refreshPreview();
    });
  });

  els.prevPageBtn.addEventListener('click', () => {
    sheetPage = Math.max(0, sheetPage - 1);
    renderSheetPreview();
  });
  els.nextPageBtn.addEventListener('click', () => {
    sheetPage += 1;
    renderSheetPreview();
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
      if (talker.talkerType && talker.talkerType !== 'standard') {
        metaParts.push(STYLE_LABELS[talker.talkerType] || talker.talkerType);
      }
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
    previewMode = 'single';
    setToggleState(els.previewToggleBtns, (b) => b.dataset.preview === 'single');
    renderPreview();
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

  els.clearQueueBtn.addEventListener('click', () => {
    if (queue.length === 0) return;
    if (!confirm('Remove all shelf talkers from the queue?')) return;
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
  // download, below) and the Electron File menu's "Save Queue" (native save
  // dialog, see onSaveRequested below).
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

  // Electron's File menu "Open Queue…"/"Save Queue" (see electron/main.js) -
  // absent entirely outside Electron, where window.shelfTalker is never
  // injected (see preload.js), same guard pattern as print() above.
  if (window.shelfTalker && window.shelfTalker.onSaveRequested) {
    window.shelfTalker.onSaveRequested(() => {
      if (queue.length === 0) return;
      window.shelfTalker.saveQueueToFile(buildQueueExportPayload());
    });
  }
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

  els.cancelEditBtn.addEventListener('click', resetForm);
  els.clearFormBtn.addEventListener('click', resetForm);

  // ---------- Add / Save ----------

  function validate(talker) {
    if (!talker.title) return 'Please enter a product title.';
    if (!talker.size) return 'Please enter a size/unit.';
    if (!talker.price || Number.isNaN(Number(talker.price))) return 'Please enter a valid regular price.';
    if (talker.salePrice && Number.isNaN(Number(talker.salePrice))) return 'Sale price must be a number.';
    return null;
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
  });

  // SKU Lookup's own "Add to Queue" - saves whatever the lookup (or its
  // fallbacks) just filled into the shared form fields without making
  // staff switch to Manual Entry first, unlike Import (which always
  // switches there - see applyImportedProduct) since SKU Lookup is meant
  // to support rapid repeat lookups in place (see applySkuLookupProduct's
  // own note on staying put). Reuses the form's real submit handler via
  // requestSubmit() - same validate/save/resetForm path as clicking "Add
  // to Queue" on Manual Entry, not a second copy of that logic.
  els.skuSaveBtn.addEventListener('click', () => {
    els.form.requestSubmit();
    if (!els.formError.hidden) {
      // The form's own error banner lives on the Manual Entry tab-panel,
      // not visible from here - mirror it into this tab's own status line
      // instead of switching tabs away from the SKU workflow.
      els.skuStatus.textContent = els.formError.textContent;
      return;
    }
    // Saved successfully - resetForm() already cleared the shared fields
    // (title/size/price/etc.), but the SKU-specific bits above live
    // outside <form> and need their own reset so the tab is ready for the
    // next SKU instead of still showing the one that was just added.
    els.skuInput.value = '';
    els.skuStatus.textContent = 'Added to queue! Enter another SKU to look up the next one.';
    els.skuUntappdSection.hidden = true;
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
  let tastingNotesSourcesLoaded = false;

  function renderTastingNotesSourceOptions() {
    const current = els.tastingNotesSourceSelect.value;
    const options = [ANY_TASTING_NOTES_SOURCE, ...tastingNotesSourceNames];
    els.tastingNotesSourceSelect.innerHTML = options
      .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
      .join('');
    if (options.includes(current)) els.tastingNotesSourceSelect.value = current;
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
    } catch {
      // Fall through with "Any source" only - the search itself still tries
      // every provider server-side regardless of whether this list loaded.
    }
    renderTastingNotesSourceOptions();
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
        body: JSON.stringify({ title, vintage, source }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not find tasting notes.');

      // Respects the field's own maxlength, which only guards user typing,
      // not a value assigned from here.
      els.tastingNotesPreview.value = (data.description || '').slice(0, 600);
      els.tastingNotesModalStatus.textContent = `Found via ${data.sourceName || source || 'the web'}.`;
      els.tastingNotesConfirmBtn.disabled = !els.tastingNotesPreview.value.trim();
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
      els.tastingNotesPreview.value = '';
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

  els.tastingNotesPreview.addEventListener('input', () => {
    els.tastingNotesConfirmBtn.disabled = !els.tastingNotesPreview.value.trim();
  });

  els.tastingNotesConfirmBtn.addEventListener('click', () => {
    const text = els.tastingNotesPreview.value.trim();
    if (!text) return;
    const existing = els.description.value.trim();
    if (existing && existing !== text && !confirm('Replace the current description with this?')) {
      return;
    }
    els.description.value = text.slice(0, 600);
    tastingNotesModal.close();
    if (previewMode === 'single') renderPreview();
  });

  // ---------- Import from website ----------

  // Shared by both the live fetch below and the "paste page HTML" fallback
  // further down - once product data has been obtained, either way, filling
  // the form and switching to Manual Entry is identical.
  function applyImportedProduct(data, isBeer) {
    if (isBeer) {
      // No price/salePrice/size here - Untappd is a rating and check-in
      // site, not a retailer, so it has no price to pull. Staff still add
      // those two fields by hand; everything else (name, brewery,
      // location, style, ABV, IBU, rating, description) comes from the
      // page.
      fillForm({
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
        title: data.title,
        description: data.description,
        size: data.size,
        price: data.price,
        salePrice: data.salePrice,
        theme: els.theme.value,
      });
    }
    previewMode = 'single';
    setToggleState(els.previewToggleBtns, (b) => b.dataset.preview === 'single');
    renderPreview();
    document.querySelector('.tab[data-tab="manual"]').click();
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

  // ---------- SKU lookup ----------

  // Fills the same fields the Import tab's applyImportedProduct fills, plus
  // price/size for a beer entry - unlike Untappd (a rating/check-in site
  // with nothing to sell), the store lookup this feeds from always has a
  // price and size regardless of category, so there's no "beer never gets
  // price" split here the way applyImportedProduct has.
  function applySkuLookupProduct(data, isBeer) {
    const fields = {
      category: isBeer ? 'beer' : 'wine',
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
    previewMode = 'single';
    setToggleState(els.previewToggleBtns, (b) => b.dataset.preview === 'single');
    renderPreview();
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
    previewMode = 'single';
    setToggleState(els.previewToggleBtns, (b) => b.dataset.preview === 'single');
    renderPreview();
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
  // preview modal's "Print Now", never directly from the app bar button -
  // see guidePreviewModal below.
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

  // Shows every sheet that will be printed - grouped and shaped exactly
  // like the real print output - so staff can see how full each sheet is
  // (and whether it's worth queuing more items first) before committing to
  // the system print dialog. Also offers an opt-in "Auto-arrange (beta)"
  // mode that can stack different sign types on the same sheet to save
  // paper (see buildAutoArrangedPages) - off by default since it's new.
  const printPreviewModal = createModal({
    overlay: els.printPreviewOverlay,
    closeBtns: [els.printPreviewCloseBtn, els.printPreviewCancelBtn],
    onOpen: renderPrintPreviewContents,
    onClose: () => { els.printPreviewSheets.innerHTML = ''; },
  });

  function openPrintPreview() {
    if (queue.length === 0) return;
    printPreviewModal.open();
  }

  // Same preview-before-printing pattern as the shelf-talker Print Preview
  // above, for the one-page guide - see renderGuidePreviewContents/
  // printGuide.
  const guidePreviewModal = createModal({
    overlay: els.guidePreviewOverlay,
    closeBtns: [els.guidePreviewCloseBtn, els.guidePreviewCancelBtn],
    onOpen: renderGuidePreviewContents,
    onClose: () => { els.guidePreviewStage.innerHTML = ''; },
  });

  function renderPrintPreviewContents() {
    els.printPreviewSheets.innerHTML = '';
    if (autoArrangeEnabled) renderAutoArrangePreview();
    else renderGroupedPreview();
  }

  function renderGroupedPreview() {
    const sheets = buildSheets(queue);
    const partialCount = sheets.filter((s) => s.items.length < SIGN_LAYOUTS[s.layoutKey].perSheet).length;

    els.printPreviewSummary.textContent = `${sheets.length} sheet${sheets.length === 1 ? '' : 's'} will print.`
      + (partialCount ? ` ${partialCount} of them ${partialCount === 1 ? 'is' : 'are'} only partially filled - add more items first to use less paper, try Auto-arrange (beta) above, or print as-is.` : '');

    const sheetEls = sheets.map((sheet, i) => {
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
      const grid = buildSheetPreviewElement(sheet);
      grid.classList.add('print-preview-sheet__grid');
      const scaler = makeScaler(grid);
      wrap.appendChild(scaler);
      els.printPreviewSheets.appendChild(wrap);
      return grid;
    });

    requestAnimationFrame(() => {
      sheetEls.forEach((grid) => grid.querySelectorAll('.card, .sign').forEach((el) => fitCardText(el)));
      rescalePrintPreviewSheets();
    });
  }

  // The modal's sheets are laid out at full 11in width and scaled to whatever
  // the dialog can give them, same as the Full Page preview.
  function rescalePrintPreviewSheets() {
    const width = els.printPreviewSheets.clientWidth
      - parseFloat(getComputedStyle(els.printPreviewSheets).paddingLeft || 0)
      - parseFloat(getComputedStyle(els.printPreviewSheets).paddingRight || 0);
    els.printPreviewSheets.querySelectorAll('.preview-scaler').forEach((scaler) => {
      scalePreview(scaler, width, window.innerHeight);
    });
  }

  // Renders auto-arranged pages: each page is a vertical stack of full-width
  // shelves (see buildAutoArrangedPages), and a shelf can mix item
  // types/sizes.
  function renderAutoArrangePreview() {
    const groupedSheets = buildSheets(queue);
    const pages = buildAutoArrangedPages(queue);
    const savedSheets = groupedSheets.length - pages.length;

    els.printPreviewSummary.textContent = `${pages.length} sheet${pages.length === 1 ? '' : 's'} will print with Auto-arrange.`
      + (savedSheets > 0
        ? ` That's ${savedSheets} fewer sheet${savedSheets === 1 ? '' : 's'} than printing each type separately.`
        : ' Sign types are stacked onto shared sheets where they fit.');

    const pageEls = [];
    pages.forEach((page, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'print-preview-sheet';
      wrap.innerHTML = `
        <div class="print-preview-sheet__label">
          <span>Sheet ${i + 1} of ${pages.length} &mdash; Auto-arranged</span>
        </div>
      `;
      const sheetDiv = buildAutoSheetPreviewElement(page);
      sheetDiv.classList.add('print-preview-sheet__grid');
      wrap.appendChild(makeScaler(sheetDiv));
      els.printPreviewSheets.appendChild(wrap);
      pageEls.push(sheetDiv);
    });

    requestAnimationFrame(() => {
      pageEls.forEach((sheetDiv) => sheetDiv.querySelectorAll('.card, .sign').forEach((el) => fitCardText(el)));
      rescalePrintPreviewSheets();
    });
  }

  els.printBtn.addEventListener('click', openPrintPreview);
  els.autoArrangeToggle.addEventListener('change', () => {
    autoArrangeEnabled = els.autoArrangeToggle.checked;
    renderPrintPreviewContents();
  });
  els.printPreviewConfirmBtn.addEventListener('click', () => {
    printPreviewModal.close();
    printNow();
  });
  els.guideBtn.addEventListener('click', guidePreviewModal.open);
  els.guidePreviewConfirmBtn.addEventListener('click', () => {
    guidePreviewModal.close();
    printGuide();
  });

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

  // The Electron Help menu's own "Help" item (see main.js) opens this same
  // panel rather than a separate window - one help doc, reachable two ways.
  if (window.shelfTalker && window.shelfTalker.onShowHelpRequested) {
    window.shelfTalker.onShowHelpRequested(() => helpModal.open());
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
  applyFormMode();
  applyFontSizeDefaults();
  renderReviewerSelect();
  renderQueue();
  renderPreview();
})();
