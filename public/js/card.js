// Builds shelf-talker card DOM elements and shrinks title/description text
// so it always fits the standardized card size, no matter how much the
// store staff type in.

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return `$${num.toFixed(2)}`;
}

function buildRatingsHtml(talker) {
  if (!Array.isArray(talker.ratings) || !talker.ratings.length) return '';
  const lines = talker.ratings
    .filter((r) => r && (r.reviewer || r.score))
    .map((r) => `${escapeHtml(r.score || '')} Pts ${escapeHtml(r.reviewer || '')}`.trim());
  if (!lines.length) return '';
  return `<div class="card__ratings">${lines.join('<br>')}</div>`;
}

// Untappd-style rating callout: a big circled score (e.g. "94") next to a
// 5-dot rating with its decimal value (e.g. "4.27"). Either half can be
// left off if the field wasn't filled in.
function buildBeerRatingHtml(talker) {
  const score = talker.untappdScore != null ? String(talker.untappdScore).trim() : '';
  const ratingNum = Number(talker.untappdRating);
  const hasRating = talker.untappdRating != null && String(talker.untappdRating).trim() !== '' && Number.isFinite(ratingNum);
  if (!score && !hasRating) return '';

  const scoreHtml = score ? `<div class="card__beer-score">${escapeHtml(score)}</div>` : '';

  let detailHtml = '';
  if (hasRating) {
    const clamped = Math.max(0, Math.min(5, ratingNum));
    const dots = Array.from({ length: 5 }, (_, i) => {
      const fill = clamped - i;
      const cls = fill >= 1 ? 'is-full' : fill > 0 ? 'is-half' : 'is-empty';
      return `<span class="card__beer-dot ${cls}"></span>`;
    }).join('');
    detailHtml = `
      <div class="card__beer-rating-detail">
        <div class="card__beer-rating-label">Untappd Rating</div>
        <div class="card__beer-dots-row">${dots}<span class="card__beer-rating-num">${clamped.toFixed(2)}</span></div>
      </div>
    `;
  }

  return `<div class="card__beer-rating">${scoreHtml}${detailHtml}</div>`;
}

// Brewery/Location/Style/ABV/IBU info table, matching an Untappd product
// page. Rows with no value (IBU is often not on file) are left out rather
// than shown blank.
function buildBeerTableHtml(talker) {
  const rows = [
    ['Brewery', talker.brewery],
    ['Location', talker.location],
    ['Style', talker.style],
    ['ABV', talker.abv],
    ['IBU', talker.ibu],
  ].filter(([, value]) => value && String(value).trim() !== '');
  if (!rows.length) return '';
  return `
    <div class="card__beer-table">
      ${rows.map(([label, value]) => `
        <div class="card__beer-table-row">
          <div class="card__beer-table-label">${escapeHtml(label)}</div>
          <div class="card__beer-table-value">${escapeHtml(value)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function buildPricingHtml(talker) {
  const talkerType = talker.talkerType || 'standard';

  if (talkerType === 'supersale') {
    // Matches the store's existing "Super Sale" talkers: a stylized callout
    // in place of any numeric price.
    return `<div class="card__supersale-text">Super Sale Price!!!</div>`;
  }

  // Both "closeout" and "standard" show the same regular/sale price layout;
  // closeout just adds the "CLOSEOUT!!" badge above it.
  const badge = talkerType === 'closeout' ? '<div class="card__closeout-badge">CLOSEOUT!!</div>' : '';
  const hasSale = talker.salePrice && Number(talker.salePrice) > 0 && Number(talker.salePrice) !== Number(talker.price);
  return `
    ${badge}
    <div class="card__prices">
      ${hasSale ? `<div class="card__sale-price">Sale Price ${formatMoney(talker.salePrice)}</div>` : ''}
      <div class="card__regular-price ${hasSale ? 'is-struck' : ''}">${hasSale ? formatMoney(talker.price) : `Regular Price ${formatMoney(talker.price)}`}</div>
    </div>
  `;
}

/**
 * @param {object} talker - { category, title, description, size, price,
 *   salePrice, theme, talkerType, ratings: [{reviewer, score}], brewery,
 *   location, style, abv, ibu, untappdScore, untappdRating }
 * @returns {HTMLElement} a .card element, not yet size-fitted
 */
function buildCardElement(talker) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.theme = talker.theme === 'purple' ? 'purple' : 'amber';
  const isBeer = talker.category === 'beer';

  card.innerHTML = `
    <div class="card__band">
      <img class="card__logo" src="assets/logo.png" alt="" />
    </div>
    <div class="card__body">
      <div class="card__title" data-fit="title">${escapeHtml(talker.title || (isBeer ? 'Beer Name' : 'Product Title'))}</div>
      ${isBeer ? buildBeerRatingHtml(talker) : ''}
      ${isBeer ? buildBeerTableHtml(talker) : ''}
      <div class="card__description" data-fit="description">${escapeHtml(talker.description || '')}</div>
      ${isBeer ? '' : buildRatingsHtml(talker)}
      <div class="card__spacer"></div>
      ${talker.size ? `<div class="card__size">${escapeHtml(talker.size)}</div>` : ''}
      ${buildPricingHtml(talker)}
    </div>
    <div class="card__band card__band--footer">
      <span class="card__footer-text">www.liquoroutletwinecellars.com</span>
    </div>
  `;

  return card;
}

/**
 * Shrinks the title/description font sizes (in place) until their content
 * fits within the allotted band, down to a sensible minimum. Must be called
 * after the card element is attached to the document (needs real layout).
 */
function fitCardText(cardEl) {
  const targets = cardEl.querySelectorAll('[data-fit]');
  targets.forEach((el) => {
    const minPx = el.dataset.fit === 'title' ? 10 : 8;
    let fontSize = parseFloat(getComputedStyle(el).fontSize);
    let guard = 40;
    while (el.scrollHeight > el.clientHeight + 1 && fontSize > minPx && guard > 0) {
      fontSize -= 0.5;
      el.style.fontSize = `${fontSize}px`;
      guard -= 1;
    }
  });

  // The Super Sale callout and the Closeout badge run noticeably larger
  // than the standard regular/sale price lines. On a long title/description
  // that combined block can still be taller than the space left on the
  // talker, which - since .card__body doesn't scroll - shoves (and clips)
  // whatever's below it. Scale the whole pricing block down (all parts
  // together, so their relative sizes stay the same) until it fits.
  const body = cardEl.querySelector('.card__body');
  if (!body) return;
  let priceFit = 1;
  let priceGuard = 40;
  while (body.scrollHeight > body.clientHeight + 1 && priceFit > 0.5 && priceGuard > 0) {
    priceFit = Math.round((priceFit - 0.03) * 100) / 100;
    body.style.setProperty('--price-fit', priceFit);
    priceGuard -= 1;
  }
}

function renderFittedCard(talker) {
  const card = buildCardElement(talker);
  // fitCardText needs layout, so caller should append `card` to the DOM,
  // then call fitCardText(card) on the next frame.
  return card;
}
