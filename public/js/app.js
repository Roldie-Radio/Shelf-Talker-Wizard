(function () {
  const STORAGE_KEY = 'shelfTalkerQueue.v1';
  const REVIEWERS_KEY = 'shelfTalkerReviewers.v1';
  const DEFAULT_REVIEWERS = ['Wine Enthusiast', 'Wine Spectator', 'Wine Advocate', 'James Suckling', 'Jim Murray'];
  const CARDS_PER_SHEET = 6;
  // Matches the print sheet's card width (--w: 2.8in) on an 11in-wide
  // landscape Letter page - see the @media print rules in styles.css.
  const SHEET_CARD_RATIO = 2.8 / 11;

  /** @type {Array<object>} */
  let queue = loadQueue();

  /** @type {Array<string>} */
  let reviewers = loadReviewers();

  /** Ratings currently attached to whatever's in the form (not yet in queue). */
  let currentRatings = [];

  let previewMode = 'single'; // 'single' | 'sheet'
  let sheetPage = 0;

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

    form: document.getElementById('talkerForm'),
    editId: document.getElementById('editId'),
    title: document.getElementById('fTitle'),
    description: document.getElementById('fDescription'),
    size: document.getElementById('fSize'),
    theme: document.getElementById('fTheme'),
    price: document.getElementById('fPrice'),
    salePrice: document.getElementById('fSalePrice'),
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
    previewToggleBtns: document.querySelectorAll('.toggle-btn'),
    sheetPagination: document.getElementById('sheetPagination'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    pageIndicator: document.getElementById('pageIndicator'),
    queueGrid: document.getElementById('queueGrid'),
    queueCount: document.getElementById('queueCount'),
    clearQueueBtn: document.getElementById('clearQueueBtn'),
    printBtn: document.getElementById('printBtn'),
    printRoot: document.getElementById('printRoot'),
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

  // ---------- Form <-> talker object ----------

  function readForm() {
    return {
      title: els.title.value.trim(),
      description: els.description.value.trim(),
      size: els.size.value.trim(),
      theme: els.theme.value,
      price: els.price.value.trim(),
      salePrice: els.salePrice.value.trim(),
      talkerType: els.talkerType.value,
      ratings: currentRatings.slice(),
    };
  }

  function fillForm(talker) {
    els.title.value = talker.title || '';
    els.description.value = talker.description || '';
    els.size.value = talker.size || '';
    els.theme.value = talker.theme || 'amber';
    els.price.value = talker.price || '';
    els.salePrice.value = talker.salePrice || '';
    els.talkerType.value = talker.talkerType || 'standard';
    currentRatings = Array.isArray(talker.ratings) ? talker.ratings.slice() : [];
    renderRatingsList();
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
    const card = buildCardElement(talker);
    els.previewStage.appendChild(card);
    requestAnimationFrame(() => fitCardText(card));
  }

  // A scaled-down stand-in for a printed Letter-landscape sheet, showing the
  // whole queue 6-up (see .sheet-preview in styles.css, and the matching
  // @media print rules it mirrors).
  function renderSheetPreview() {
    const totalPages = Math.max(1, Math.ceil(queue.length / CARDS_PER_SHEET));
    sheetPage = Math.min(Math.max(sheetPage, 0), totalPages - 1);

    els.previewStage.innerHTML = '';

    if (queue.length === 0) {
      els.previewStage.innerHTML = '<p class="empty-hint">No shelf talkers queued yet. Add one on the left to see the full page here.</p>';
      els.sheetPagination.hidden = true;
      return;
    }

    const sheetDiv = document.createElement('div');
    sheetDiv.className = 'sheet-preview';
    const items = queue.slice(sheetPage * CARDS_PER_SHEET, sheetPage * CARDS_PER_SHEET + CARDS_PER_SHEET);
    items.forEach((talker) => sheetDiv.appendChild(buildCardElement(talker)));
    els.previewStage.appendChild(sheetDiv);

    // Card font sizes are driven by --w (see card.js/styles.css); compute it
    // in px from the sheet's actual rendered width so text scales correctly
    // at whatever size the preview panel happens to be.
    requestAnimationFrame(() => {
      const containerWidth = sheetDiv.getBoundingClientRect().width;
      const cardWidthPx = containerWidth * SHEET_CARD_RATIO;
      const cards = sheetDiv.querySelectorAll('.card');
      cards.forEach((card) => card.style.setProperty('--w', `${cardWidthPx}px`));
      requestAnimationFrame(() => cards.forEach((card) => fitCardText(card)));
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
    els.queueCount.textContent = String(queue.length);
    els.printBtn.disabled = queue.length === 0;

    if (queue.length === 0) {
      els.queueGrid.innerHTML = '<p class="empty-hint">No shelf talkers yet. Add one on the left to get started.</p>';
      return;
    }

    els.queueGrid.innerHTML = '';
    queue.forEach((talker) => {
      const item = document.createElement('div');
      item.className = 'queue-item';
      const priceLabel = talker.salePrice && Number(talker.salePrice) > 0
        ? `${formatMoney(talker.salePrice)} (was ${formatMoney(talker.price)})`
        : formatMoney(talker.price);

      item.innerHTML = `
        <div class="queue-item__swatch" data-theme="${talker.theme}"></div>
        <div class="queue-item__body">
          <div class="queue-item__title">${escapeHtml(talker.title || 'Untitled')}</div>
          <div class="queue-item__meta">${escapeHtml(talker.size || '')} ${talker.size ? '&middot;' : ''} ${priceLabel}</div>
        </div>
        <div class="queue-item__actions">
          <button type="button" data-action="edit" title="Edit">Edit</button>
          <button type="button" data-action="duplicate" title="Duplicate">Copy</button>
          <button type="button" data-action="delete" title="Delete">Delete</button>
        </div>
      `;

      item.querySelector('[data-action="edit"]').addEventListener('click', () => startEdit(talker.id));
      item.querySelector('[data-action="duplicate"]').addEventListener('click', () => duplicateTalker(talker.id));
      item.querySelector('[data-action="delete"]').addEventListener('click', () => deleteTalker(talker.id));

      els.queueGrid.appendChild(item);
    });
  }

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
    saveQueue();
    renderQueue();
    refreshPreview();
  }

  els.clearQueueBtn.addEventListener('click', () => {
    if (queue.length === 0) return;
    if (!confirm('Remove all shelf talkers from the queue?')) return;
    queue = [];
    saveQueue();
    renderQueue();
    refreshPreview();
  });

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
        talkerType: ['closeout', 'supersale', 'super sale'].includes(typeRaw)
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

  els.printBtn.addEventListener('click', () => {
    if (queue.length === 0) return;
    els.printRoot.innerHTML = '';

    const perSheet = 6;
    for (let i = 0; i < queue.length; i += perSheet) {
      const sheet = document.createElement('div');
      sheet.className = 'sheet';
      queue.slice(i, i + perSheet).forEach((talker) => {
        sheet.appendChild(buildCardElement(talker));
      });
      els.printRoot.appendChild(sheet);
    }

    // Cards need to be laid out at print size before we can measure/shrink text.
    requestAnimationFrame(() => {
      els.printRoot.querySelectorAll('.card').forEach((card) => fitCardText(card));
      requestAnimationFrame(triggerPrint);
    });
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

  renderReviewerSelect();
  renderQueue();
  renderPreview();
})();
