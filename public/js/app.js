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
    wineRatingsField: document.getElementById('wineRatingsField'),
    beerFields: document.getElementById('beerFields'),
    brewery: document.getElementById('fBrewery'),
    location: document.getElementById('fLocation'),
    style: document.getElementById('fStyle'),
    abv: document.getElementById('fAbv'),
    ibu: document.getElementById('fIbu'),
    untappdScore: document.getElementById('fUntappdScore'),
    untappdRating: document.getElementById('fUntappdRating'),

    form: document.getElementById('talkerForm'),
    editId: document.getElementById('editId'),
    title: document.getElementById('fTitle'),
    description: document.getElementById('fDescription'),
    size: document.getElementById('fSize'),
    theme: document.getElementById('fTheme'),
    price: document.getElementById('fPrice'),
    salePrice: document.getElementById('fSalePrice'),
    talkerSizeField: document.getElementById('talkerSizeField'),
    talkerSize: document.getElementById('fTalkerSize'),
    talkerType: document.getElementById('fTalkerType'),
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

    csvInput: document.getElementById('csvInput'),
    csvImportBtn: document.getElementById('csvImportBtn'),
    csvStatus: document.getElementById('csvStatus'),

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

    printPreviewOverlay: document.getElementById('printPreviewOverlay'),
    printPreviewSummary: document.getElementById('printPreviewSummary'),
    printPreviewSheets: document.getElementById('printPreviewSheets'),
    printPreviewCloseBtn: document.getElementById('printPreviewCloseBtn'),
    printPreviewCancelBtn: document.getElementById('printPreviewCancelBtn'),
    printPreviewConfirmBtn: document.getElementById('printPreviewConfirmBtn'),
    autoArrangeToggle: document.getElementById('autoArrangeToggle'),
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
    els.wineRatingsField.hidden = isBeer || isSmallSign;
    els.beerFields.hidden = !isBeer || isSmallSign;

    applyImportMode();
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

  function setSignType(signType) {
    currentSignType = signType === 'sign' ? 'sign' : 'talker';
    // The Full Page preview is scoped to this selection (see
    // renderSheetPreview), so switching it should land back on its first
    // page rather than keeping whatever page number the previous
    // selection's sheets happened to be on.
    sheetPage = 0;
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

  // ---------- Form <-> talker object ----------

  function readForm() {
    return {
      signType: currentSignType,
      signSize: currentSignSize,
      talkerSize: currentTalkerSize,
      category: currentCategory,
      title: els.title.value.trim(),
      description: els.description.value.trim(),
      size: els.size.value.trim(),
      theme: els.theme.value,
      price: els.price.value.trim(),
      salePrice: els.salePrice.value.trim(),
      talkerType: els.talkerType.value,
      ratings: currentRatings.slice(),
      brewery: els.brewery.value.trim(),
      location: els.location.value.trim(),
      style: els.style.value.trim(),
      abv: els.abv.value.trim(),
      ibu: els.ibu.value.trim(),
      untappdScore: els.untappdScore.value.trim(),
      untappdRating: els.untappdRating.value.trim(),
    };
  }

  function fillForm(talker) {
    currentSignType = talker.signType === 'sign' ? 'sign' : 'talker';
    currentSignSize = talker.signSize === 'small' ? 'small' : 'large';
    currentTalkerSize = ['half', 'quarter'].includes(talker.talkerSize) ? talker.talkerSize : 'full';
    currentCategory = talker.category === 'beer' ? 'beer' : 'wine';
    applyFormMode();
    els.title.value = talker.title || '';
    els.description.value = talker.description || '';
    els.size.value = talker.size || '';
    els.theme.value = talker.theme || 'amber';
    els.price.value = talker.price || '';
    els.salePrice.value = talker.salePrice || '';
    els.talkerType.value = talker.talkerType || 'standard';
    currentRatings = Array.isArray(talker.ratings) ? talker.ratings.slice() : [];
    renderRatingsList();
    els.brewery.value = talker.brewery || '';
    els.location.value = talker.location || '';
    els.style.value = talker.style || '';
    els.abv.value = talker.abv || '';
    els.ibu.value = talker.ibu || '';
    els.untappdScore.value = talker.untappdScore || '';
    els.untappdRating.value = talker.untappdRating || '';
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

  // ---------- Import from website ----------

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
          theme: els.theme.value,
        });
        els.importStatus.textContent = 'Loaded! Add the price and size, double-check the rest, then click "Add to Queue".';
      } else {
        fillForm({
          title: data.title,
          description: data.description,
          size: data.size,
          price: data.price,
          salePrice: data.salePrice,
          theme: els.theme.value,
        });
        els.importStatus.textContent = 'Loaded! Review the fields, then click "Add to Queue".';
      }
      previewMode = 'single';
      setToggleState(els.previewToggleBtns, (b) => b.dataset.preview === 'single');
      renderPreview();
      document.querySelector('.tab[data-tab="manual"]').click();
    } catch (err) {
      els.importStatus.textContent = err.message || 'Something went wrong fetching that page.';
    } finally {
      els.importBtn.disabled = false;
    }
  });

  // ---------- CSV bulk import ----------

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { field += ch; }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  els.csvImportBtn.addEventListener('click', () => {
    const text = els.csvInput.value.trim();
    if (!text) {
      els.csvStatus.textContent = 'Paste some CSV data first.';
      return;
    }
    const rows = parseCsv(text);
    if (rows.length < 2) {
      els.csvStatus.textContent = 'No data rows found below the header row.';
      return;
    }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const required = ['title', 'price'];
    const missing = required.filter((r) => !header.includes(r));
    if (missing.length) {
      els.csvStatus.textContent = `Missing required column(s): ${missing.join(', ')}`;
      return;
    }

    let added = 0;
    let skipped = 0;
    rows.slice(1).forEach((cols) => {
      const rec = {};
      header.forEach((key, i) => { rec[key] = (cols[i] || '').trim(); });
      if (!rec.title || !rec.price || Number.isNaN(Number(rec.price))) { skipped++; return; }
      const typeRaw = (rec.type || rec['talker type'] || 'standard').toLowerCase();
      queue.push({
        id: makeId(),
        title: rec.title,
        description: rec.description || '',
        size: rec.size || '',
        price: rec.price,
        salePrice: rec.saleprice || rec['sale price'] || '',
        theme: (rec.theme || 'amber').toLowerCase() === 'purple' ? 'purple' : 'amber',
        talkerType: ['closeout', 'supersale', 'super sale', 'chilled'].includes(typeRaw)
          ? (typeRaw === 'super sale' ? 'supersale' : typeRaw)
          : 'standard',
        ratings: [],
      });
      added++;
    });

    saveQueue();
    renderQueue();
    refreshPreview();
    els.csvStatus.textContent = `Added ${added} shelf talker(s).${skipped ? ` Skipped ${skipped} row(s) missing title/price.` : ''}`;
    if (added) els.csvInput.value = '';
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

  // Shows every sheet that will be printed - grouped and shaped exactly
  // like the real print output - so staff can see how full each sheet is
  // (and whether it's worth queuing more items first) before committing to
  // the system print dialog. Also offers an opt-in "Auto-arrange (beta)"
  // mode that can stack different sign types on the same sheet to save
  // paper (see buildAutoArrangedPages) - off by default since it's new.
  // Focus moves into the dialog on open and back to the button that opened
  // it on close, and Tab cycles inside it while it's up - otherwise keyboard
  // focus stays behind on the page underneath, which for a modal means
  // tabbing through controls you can't see.
  let printPreviewReturnFocus = null;

  function focusableInModal() {
    return [...els.printPreviewOverlay.querySelectorAll('button, input, [href], select, textarea')]
      .filter((el) => !el.disabled && el.offsetParent !== null);
  }

  function openPrintPreview() {
    if (queue.length === 0) return;
    printPreviewReturnFocus = document.activeElement;
    els.printPreviewOverlay.hidden = false;
    renderPrintPreviewContents();
    els.printPreviewCloseBtn.focus();
  }

  els.printPreviewOverlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = focusableInModal();
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

  function closePrintPreview() {
    els.printPreviewOverlay.hidden = true;
    els.printPreviewSheets.innerHTML = '';
    if (printPreviewReturnFocus && printPreviewReturnFocus.isConnected) printPreviewReturnFocus.focus();
    printPreviewReturnFocus = null;
  }

  els.printBtn.addEventListener('click', openPrintPreview);
  els.printPreviewCloseBtn.addEventListener('click', closePrintPreview);
  els.printPreviewCancelBtn.addEventListener('click', closePrintPreview);
  els.printPreviewOverlay.addEventListener('click', (e) => {
    if (e.target === els.printPreviewOverlay) closePrintPreview();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.printPreviewOverlay.hidden) closePrintPreview();
  });
  els.autoArrangeToggle.addEventListener('change', () => {
    autoArrangeEnabled = els.autoArrangeToggle.checked;
    renderPrintPreviewContents();
  });
  els.printPreviewConfirmBtn.addEventListener('click', () => {
    closePrintPreview();
    printNow();
  });

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
  renderReviewerSelect();
  renderQueue();
  renderPreview();
})();
