(function () {
  const STORAGE_KEY = 'shelfTalkerQueue.v1';
  const REVIEWERS_KEY = 'shelfTalkerReviewers.v1';
  const DEFAULT_REVIEWERS = ['Wine Enthusiast', 'Wine Spectator', 'Wine Advocate', 'James Suckling', 'Jim Murray'];

  // Print-sheet geometry per sign type/size, all sized to fit a single
  // landscape Letter sheet (11in x 8.5in, 0.28in @page margin - see the
  // @media print rules in styles.css). printWidth is the element's --w
  // (its own width, matching how .card/.sign already scale everything off
  // of --w); printWidth/11 gives the same ratio used to size the on-screen
  // sheet preview at whatever pixel width it happens to be rendered at.
  const SIGN_LAYOUTS = {
    talker: { cols: 3, rows: 2, perSheet: 6, printWidth: '2.8in', aspect: 830 / 1136, label: 'Shelf Talkers' },
    // Half Size keeps the same width as Full (same cols/printWidth) but is
    // cut to half the height, so more rows fit per sheet; Quarter Size
    // uniformly scales both dimensions to 50% of Full (same aspect ratio,
    // half the printWidth), so both cols and rows increase.
    'talker-half': { cols: 3, rows: 3, perSheet: 9, printWidth: '2.8in', aspect: 830 / 568, label: 'Half Size Shelf Talkers' },
    'talker-quarter': { cols: 6, rows: 3, perSheet: 18, printWidth: '1.4in', aspect: 830 / 1136, label: 'Quarter Size Shelf Talkers' },
    'sign-large': { cols: 1, rows: 2, perSheet: 2, printWidth: '10.1in', aspect: 2.7, label: 'Large Display Signs' },
    'sign-small': { cols: 2, rows: 3, perSheet: 6, printWidth: '4.9in', aspect: 2, label: 'Small Display Signs' },
  };

  // Page content area in inches (11in x 8.5in landscape Letter minus the
  // 0.28in @page margin on each side) and the row gap between sheet rows -
  // both must match the @media print rules in styles.css exactly, since
  // auto-arrange (below) packs rows onto pages using this same height budget.
  const PAGE_CONTENT_HEIGHT_IN = 7.94;
  const ROW_GAP_IN = 0.2;
  const PAGE_MARGIN_IN = 0.28;

  // aspect is width/height (the same convention as the CSS aspect-ratio
  // property), so an item's real printed height is its printWidth divided
  // by its aspect.
  function itemHeightIn(layoutKey) {
    const layout = SIGN_LAYOUTS[layoutKey];
    return parseFloat(layout.printWidth) / layout.aspect;
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

  // Auto-arrange (beta): rather than grouping every item by type into
  // same-type sheets (see buildSheets), this builds full-width "rows" - each
  // holding up to a type's own column count of same-type items, so a row
  // always has one fixed height - then greedily stacks rows onto pages by a
  // height budget. A page can mix rows of different types as long as every
  // row spans the full sheet width and keeps its own fixed height, so the
  // sheet still cuts cleanly with straight horizontal cuts (then vertical
  // cuts within a row) - avoiding full 2D bin-packing while still saving
  // paper vs. grouped mode whenever a queue has partial quantities of more
  // than one type.
  function buildRows(items) {
    const groups = emptyLayoutGroups();
    items.forEach((t) => groups[layoutKeyFor(t)].push(t));
    const rows = [];
    Object.keys(SIGN_LAYOUTS).forEach((key) => {
      const { cols } = SIGN_LAYOUTS[key];
      const groupItems = groups[key];
      for (let i = 0; i < groupItems.length; i += cols) {
        rows.push({ layoutKey: key, items: groupItems.slice(i, i + cols) });
      }
    });
    return rows;
  }

  function packRowsIntoPages(rows) {
    const pages = [];
    let current = null;
    let usedHeight = 0;
    rows.forEach((row) => {
      const rowHeight = itemHeightIn(row.layoutKey);
      const fitsOnCurrent = current && (usedHeight + ROW_GAP_IN + rowHeight) <= PAGE_CONTENT_HEIGHT_IN + 0.001;
      if (fitsOnCurrent) {
        usedHeight += ROW_GAP_IN + rowHeight;
      } else {
        current = { rows: [] };
        pages.push(current);
        usedHeight = rowHeight;
      }
      current.rows.push(row);
    });
    return pages;
  }

  function buildAutoArrangedPages(items) {
    return packRowsIntoPages(buildRows(items));
  }

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

  function loadQueue() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveQueue() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
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

  // ---------- Tabs ----------

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      els.tabs.forEach((t) => t.classList.remove('is-active'));
      els.panels.forEach((p) => p.classList.remove('is-active'));
      tab.classList.add('is-active');
      document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('is-active');
    });
  });

  // ---------- Form mode (Shelf Talker/Display Sign x Small/Large x Wine/Beer) ----------

  // Single source of truth for what the form should look like, driven by
  // the three toggles together - e.g. a Small Display Sign has no room for
  // a description/rating, regardless of category, so those fields
  // disappear only in that combination.
  function applyFormMode() {
    const isBeer = currentCategory === 'beer';
    const isSign = currentSignType === 'sign';
    const isSmallSign = isSign && currentSignSize === 'small';

    els.signTypeToggleBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.signtype === currentSignType));
    els.signSizeToggleWrap.hidden = !isSign;
    els.signSizeToggleBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.signsize === currentSignSize));
    els.categoryToggleBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.category === currentCategory));

    els.titleLabel.textContent = isBeer ? 'Beer Name *' : (isSign ? 'Product Name *' : 'Product Title *');
    els.size.placeholder = isBeer ? '16oz Can / 4-pack' : '750ml / Each / 6-pack';

    els.talkerSizeField.hidden = isSign;
    els.talkerSize.value = currentTalkerSize;
    els.descriptionField.hidden = isSmallSign;
    els.wineRatingsField.hidden = isBeer || isSmallSign;
    els.beerFields.hidden = !isBeer || isSmallSign;
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

  function renderPreview() {
    els.sheetPagination.hidden = true;
    const talker = readForm();
    els.previewStage.innerHTML = '';
    const card = buildPrintableElement(talker);
    els.previewStage.appendChild(card);
    requestAnimationFrame(() => fitCardText(card));
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
        ? '<p class="empty-hint">No shelf talkers queued yet. Add one on the left to see the full page here.</p>'
        : `<p class="empty-hint">No ${label} queued yet. Add one on the left, or switch Shelf Talkers/Display Signs above to see what else is queued.</p>`;
      els.sheetPagination.hidden = true;
      return;
    }

    const sheet = sheets[sheetPage];
    const layout = SIGN_LAYOUTS[sheet.layoutKey];

    const sheetDiv = document.createElement('div');
    sheetDiv.className = 'sheet-preview';
    sheetDiv.style.setProperty('--cols', layout.cols);
    sheetDiv.style.setProperty('--rows', layout.rows);
    sheet.items.forEach((talker) => sheetDiv.appendChild(buildPrintableElement(talker)));
    els.previewStage.appendChild(sheetDiv);

    // Card/sign font sizes are driven by --w (see card.js/styles.css);
    // compute it in px from the sheet's actual rendered width, using the
    // same ratio the print layout uses (its printWidth against the full
    // 11in sheet width), so text scales correctly at whatever size the
    // preview panel happens to be.
    requestAnimationFrame(() => {
      const containerWidth = sheetDiv.getBoundingClientRect().width;
      const widthPx = containerWidth * (parseFloat(layout.printWidth) / 11);
      const elements = sheetDiv.querySelectorAll('.card, .sign');
      elements.forEach((el) => el.style.setProperty('--w', `${widthPx}px`));
      requestAnimationFrame(() => elements.forEach((el) => fitCardText(el)));
    });

    els.sheetPagination.hidden = totalPages <= 1;
    els.pageIndicator.textContent = `Page ${sheetPage + 1} of ${totalPages}`;
  }

  function refreshPreview() {
    if (previewMode === 'sheet') renderSheetPreview();
    else renderPreview();
  }

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
      els.previewToggleBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
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
      els.queueGrid.innerHTML = '<p class="empty-hint">No shelf talkers yet. Add one on the left to get started.</p>';
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
      const typeLabel = talker.signType === 'sign'
        ? (talker.signSize === 'small' ? 'Small Display Sign' : 'Large Display Sign')
        : 'Shelf Talker';

      item.innerHTML = `
        <div class="queue-item__swatch" data-theme="${talker.theme}"></div>
        <div class="queue-item__body">
          <button type="button" class="queue-item__title" data-action="toggle-expand" title="Click to ${isExpanded ? 'collapse' : 'show full title'}">
            <span class="queue-item__title-text">${escapeHtml(talker.title || 'Untitled')}</span>
            <span class="queue-item__expand-icon" aria-hidden="true">${isExpanded ? '▾' : '▸'}</span>
          </button>
          <div class="queue-item__meta">${typeLabel} &middot; ${escapeHtml(talker.size || '')} ${talker.size ? '&middot;' : ''} ${priceLabel}</div>
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
    els.previewToggleBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.preview === 'single'));
    renderPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  // Exports the current queue as a downloadable JSON file - a manual
  // backup/archive separate from the automatic localStorage persistence
  // (see saveQueue), for moving a queue to another computer or keeping a
  // copy of a batch outside the browser.
  function saveQueueToFile() {
    if (queue.length === 0) return;
    const payload = {
      app: 'Shelf Talker Wizard',
      exportedAt: new Date().toISOString(),
      queue,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
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
    const url = els.importUrl.value.trim();
    if (!url) {
      els.importStatus.textContent = 'Enter a product URL first.';
      return;
    }
    els.importBtn.disabled = true;
    els.importStatus.textContent = 'Fetching product data...';

    try {
      const resp = await fetch('/api/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Import failed.');

      fillForm({
        title: data.title,
        description: data.description,
        size: data.size,
        price: data.price,
        salePrice: data.salePrice,
        theme: els.theme.value,
      });
      previewMode = 'single';
      els.previewToggleBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.preview === 'single'));
      renderPreview();
      document.querySelector('.tab[data-tab="manual"]').click();
      els.importStatus.textContent = 'Loaded! Review the fields, then click "Add to Queue".';
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
  // buildAutoArrangedPages) - --print-w is set per row instead of per sheet
  // since a page can mix row types.
  function buildPrintDom() {
    els.printRoot.innerHTML = '';
    if (autoArrangeEnabled) {
      buildAutoArrangedPages(queue).forEach((page) => {
        const sheetEl = document.createElement('div');
        sheetEl.className = 'sheet sheet--auto';
        page.rows.forEach((row) => {
          const layout = SIGN_LAYOUTS[row.layoutKey];
          const rowEl = document.createElement('div');
          rowEl.className = 'sheet__row';
          rowEl.style.setProperty('--print-w', layout.printWidth);
          row.items.forEach((talker) => rowEl.appendChild(buildPrintableElement(talker)));
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
        sheetEl.style.setProperty('--print-w', layout.printWidth);
        items.forEach((talker) => sheetEl.appendChild(buildPrintableElement(talker)));
        els.printRoot.appendChild(sheetEl);
      });
    }
  }

  function printNow() {
    buildPrintDom();
    // Cards/signs need to be laid out at print size before we can measure/shrink text.
    requestAnimationFrame(() => {
      els.printRoot.querySelectorAll('.card, .sign').forEach((el) => fitCardText(el));
      requestAnimationFrame(triggerPrint);
    });
  }

  // Shows every sheet that will be printed - grouped and shaped exactly
  // like the real print output - so staff can see how full each sheet is
  // (and whether it's worth queuing more items first) before committing to
  // the system print dialog. Also offers an opt-in "Auto-arrange (beta)"
  // mode that can stack different talker sizes and sign types on the same
  // sheet to save paper (see buildAutoArrangedPages) - off by default
  // since it's new.
  function openPrintPreview() {
    if (queue.length === 0) return;
    els.printPreviewOverlay.hidden = false;
    renderPrintPreviewContents();
  }

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
      const grid = document.createElement('div');
      grid.className = 'sheet-preview print-preview-sheet__grid';
      grid.style.setProperty('--cols', layout.cols);
      grid.style.setProperty('--rows', layout.rows);
      sheet.items.forEach((talker) => grid.appendChild(buildPrintableElement(talker)));
      wrap.appendChild(grid);
      els.printPreviewSheets.appendChild(wrap);
      return { grid, layout };
    });

    // Sizing needs the grids laid out first to know their real pixel width.
    requestAnimationFrame(() => {
      sheetEls.forEach(({ grid, layout }) => {
        const containerWidth = grid.getBoundingClientRect().width;
        const widthPx = containerWidth * (parseFloat(layout.printWidth) / 11);
        const elements = grid.querySelectorAll('.card, .sign');
        elements.forEach((el) => el.style.setProperty('--w', `${widthPx}px`));
      });
      requestAnimationFrame(() => {
        sheetEls.forEach(({ grid }) => grid.querySelectorAll('.card, .sign').forEach((el) => fitCardText(el)));
      });
    });
  }

  // Renders auto-arranged pages: each page is a vertical stack of full-width
  // rows (see buildAutoArrangedPages), and a row holds only one layout type
  // (a talker size or a sign type/size), so - unlike renderGroupedPreview,
  // where one --w fits an entire sheet - every row needs its own --w
  // computed from its own layout's printWidth.
  function renderAutoArrangePreview() {
    const groupedSheets = buildSheets(queue);
    const pages = buildAutoArrangedPages(queue);
    const savedSheets = groupedSheets.length - pages.length;

    els.printPreviewSummary.textContent = `${pages.length} sheet${pages.length === 1 ? '' : 's'} will print with Auto-arrange.`
      + (savedSheets > 0
        ? ` That's ${savedSheets} fewer sheet${savedSheets === 1 ? '' : 's'} than printing each type separately.`
        : ' Different sizes and types are stacked onto shared sheets where they fit.');

    const pageEls = [];
    pages.forEach((page, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'print-preview-sheet';
      wrap.innerHTML = `
        <div class="print-preview-sheet__label">
          <span>Sheet ${i + 1} of ${pages.length} &mdash; Auto-arranged</span>
        </div>
      `;
      const sheetDiv = document.createElement('div');
      sheetDiv.className = 'sheet-preview sheet-preview--auto print-preview-sheet__grid';
      const rowEls = [];
      page.rows.forEach((row) => {
        const layout = SIGN_LAYOUTS[row.layoutKey];
        const rowDiv = document.createElement('div');
        rowDiv.className = 'sheet-preview__row';
        row.items.forEach((talker) => rowDiv.appendChild(buildPrintableElement(talker)));
        sheetDiv.appendChild(rowDiv);
        rowEls.push({ rowDiv, layout });
      });
      wrap.appendChild(sheetDiv);
      els.printPreviewSheets.appendChild(wrap);
      pageEls.push({ sheetDiv, rowEls });
    });

    // Use the *sheet's* own rendered width (representing the full 11in page,
    // same as renderGroupedPreview) as the basis for each row's --w, not the
    // row's own width - the row sits inside the sheet's padded content box,
    // so its width is narrower than the true 11in-page reference.
    //
    // .sheet-preview's CSS padding is a percentage, which (per spec) always
    // resolves against its containing block's *width* - including for
    // top/bottom padding - and against the parent's width, not this box's
    // own max-width-capped width. Grid mode never notices, since its grid
    // rows/cols just auto-divide whatever content space is left; this flex
    // column can't, since row heights are computed from real inches
    // (matching PAGE_CONTENT_HEIGHT_IN) independent of the padding CSS
    // ends up producing, so the padding must be pinned to match: uniform
    // PAGE_MARGIN_IN on every side, in px, derived from this same width.
    requestAnimationFrame(() => {
      pageEls.forEach(({ sheetDiv, rowEls }) => {
        const containerWidth = sheetDiv.getBoundingClientRect().width;
        const pxPerIn = containerWidth / 11;
        sheetDiv.style.padding = `${pxPerIn * PAGE_MARGIN_IN}px`;
        rowEls.forEach(({ rowDiv, layout }) => {
          const widthPx = containerWidth * (parseFloat(layout.printWidth) / 11);
          const elements = rowDiv.querySelectorAll('.card, .sign');
          elements.forEach((el) => el.style.setProperty('--w', `${widthPx}px`));
        });
      });
      requestAnimationFrame(() => {
        pageEls.forEach(({ sheetDiv }) => sheetDiv.querySelectorAll('.card, .sign').forEach((el) => fitCardText(el)));
      });
    });
  }

  function closePrintPreview() {
    els.printPreviewOverlay.hidden = true;
    els.printPreviewSheets.innerHTML = '';
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

  applyFormMode();
  renderReviewerSelect();
  renderQueue();
  renderPreview();
})();
