(function () {
  const STORAGE_KEY = 'shelfTalkerQueue.v1';

  /** @type {Array<object>} */
  let queue = loadQueue();

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
    };
  }

  function fillForm(talker) {
    els.title.value = talker.title || '';
    els.description.value = talker.description || '';
    els.size.value = talker.size || '';
    els.theme.value = talker.theme || 'amber';
    els.price.value = talker.price || '';
    els.salePrice.value = talker.salePrice || '';
  }

  function resetForm() {
    els.form.reset();
    els.editId.value = '';
    els.saveBtn.textContent = 'Add to Queue';
    els.cancelEditBtn.hidden = true;
    hideError();
    renderPreview();
  }

  function showError(msg) {
    els.formError.textContent = msg;
    els.formError.hidden = false;
  }
  function hideError() {
    els.formError.hidden = true;
  }

  // ---------- Preview ----------

  function renderPreview() {
    const talker = readForm();
    els.previewStage.innerHTML = '';
    const card = buildCardElement(talker);
    els.previewStage.appendChild(card);
    requestAnimationFrame(() => fitCardText(card));
  }

  let previewDebounce;
  function schedulePreview() {
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(renderPreview, 120);
  }

  els.form.addEventListener('input', schedulePreview);
  els.theme.addEventListener('change', renderPreview);

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
    renderPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function duplicateTalker(id) {
    const talker = queue.find((t) => t.id === id);
    if (!talker) return;
    queue.push({ ...talker, id: makeId() });
    saveQueue();
    renderQueue();
  }

  function deleteTalker(id) {
    queue = queue.filter((t) => t.id !== id);
    saveQueue();
    renderQueue();
  }

  els.clearQueueBtn.addEventListener('click', () => {
    if (queue.length === 0) return;
    if (!confirm('Remove all shelf talkers from the queue?')) return;
    queue = [];
    saveQueue();
    renderQueue();
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
      queue.push({
        id: makeId(),
        title: rec.title,
        description: rec.description || '',
        size: rec.size || '',
        price: rec.price,
        salePrice: rec.saleprice || rec['sale price'] || '',
        theme: (rec.theme || 'amber').toLowerCase() === 'purple' ? 'purple' : 'amber',
      });
      added++;
    });

    saveQueue();
    renderQueue();
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

  renderQueue();
  renderPreview();
})();
