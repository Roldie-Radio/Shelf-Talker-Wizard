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
  const hasSale = talker.salePrice && Number(talker.salePrice) > 0 && Number(talker.salePrice) !== Number(talker.price);

  if (talkerType === 'supersale') {
    // Matches the store's printed Super Sale signs: a stylized "Super Sale
    // Price!!!" callout above the actual price (the sale price if one was
    // given, otherwise just the regular price), with the regular price
    // called out separately underneath when there's a sale price to compare
    // it to.
    const bigPrice = hasSale ? talker.salePrice : talker.price;
    return `
      <div class="card__supersale-text">Super Sale Price!!!</div>
      <div class="card__supersale-price">${formatMoney(bigPrice)}</div>
      ${hasSale ? `<div class="card__regular-price">Regular Price ${formatMoney(talker.price)}</div>` : ''}
    `;
  }

  // "closeout", "chilled" and "standard" all show the same regular/sale
  // price layout; closeout/chilled just add their own badge above it.
  let badge = '';
  if (talkerType === 'closeout') badge = '<div class="card__closeout-badge">CLOSEOUT!!</div>';
  else if (talkerType === 'chilled') badge = '<div class="card__chilled-badge">Also Available Chilled</div>';
  return `
    ${badge}
    <div class="card__prices">
      ${hasSale ? `<div class="card__sale-price">Sale Price ${formatMoney(talker.salePrice)}</div>` : ''}
      <div class="card__regular-price">Regular Price ${formatMoney(talker.price)}</div>
    </div>
  `;
}

// ================================================================
// Display Signs - a second, landscape card format for the store's Small
// (6-up) and Large (2-up) printed display signs, distinct from the
// portrait Shelf Talker card above. Reuses the same talker fields (plus
// signSize), but lays title/price out in wide rows instead of a
// stacked block, and adds the header tagline + "SALE/PRICE" edge lettering
// the store's existing sign templates use.
// ================================================================

function buildSignRailHtml(side) {
  const saleCol = `<div class="sign__rail-col">${'SALE'.split('').map((ch) => `<span>${ch}</span>`).join('')}</div>`;
  const priceCol = `<div class="sign__rail-col">${'PRICE'.split('').map((ch) => `<span>${ch}</span>`).join('')}</div>`;
  // Always SALE-then-PRICE reading left-to-right, on both rails - matching
  // the store's printed signs, which don't mirror the right side (it reads
  // "SALE PRICE" there too, not "PRICE SALE").
  return `<div class="sign__rail sign__rail--${side}">${saleCol}${priceCol}</div>`;
}

// The edge lettering marks any kind of special pricing, not just a plain
// sale price - matches the store's reference signs, which show it on
// Closeout and Super Sale signs even when illustrated without a distinct
// sale price. "Chilled" isn't a discount, so it doesn't trigger the rails.
function signHasDiscount(talker) {
  const talkerType = talker.talkerType || 'standard';
  const hasSale = talker.salePrice && Number(talker.salePrice) > 0 && Number(talker.salePrice) !== Number(talker.price);
  return talkerType === 'closeout' || talkerType === 'supersale' || hasSale;
}

// Single-line version of the wine ratings list for the sign's rating/size
// row - only the first rating fits that row, matching the reference signs
// (which always show exactly one).
function buildRatingsInlineHtml(talker) {
  if (!Array.isArray(talker.ratings) || !talker.ratings.length) return '';
  const first = talker.ratings.find((r) => r && (r.reviewer || r.score));
  if (!first) return '';
  return `${escapeHtml(first.score || '')} Pts ${escapeHtml(first.reviewer || '')}`.trim();
}

// Top row: badge/rating/supersale-heading on the left, size on the right.
function buildSignTopRowHtml(talker, leftHtml) {
  const talkerType = talker.talkerType || 'standard';
  let left = leftHtml || '';
  if (talkerType === 'closeout') left = '<div class="sign__closeout-badge">CLOSEOUT!!</div>';
  else if (talkerType === 'supersale') left = '<div class="sign__supersale-text">Super Sale Price!!!</div>';
  else if (talkerType === 'chilled') left = '<div class="sign__chilled-badge">Also Available Chilled</div>';
  if (!left && !talker.size) return '';
  return `
    <div class="sign__top-row">
      <div class="sign__top-row-left">${left}</div>
      ${talker.size ? `<div class="sign__size">${escapeHtml(talker.size)}</div>` : '<div></div>'}
    </div>
  `;
}

// Price row for Large signs: sale/super-sale price on the left, regular
// price on the right (or regular price alone, right-aligned, when there's
// no sale).
function buildSignPriceRowHtml(talker) {
  const talkerType = talker.talkerType || 'standard';
  const hasSale = talker.salePrice && Number(talker.salePrice) > 0 && Number(talker.salePrice) !== Number(talker.price);

  if (talkerType === 'supersale') {
    const bigPrice = hasSale ? talker.salePrice : talker.price;
    return `
      <div class="sign__price-row">
        <div class="sign__supersale-price">${formatMoney(bigPrice)}</div>
        ${hasSale ? `<div class="sign__regular-price">Regular Price ${formatMoney(talker.price)}</div>` : '<div></div>'}
      </div>
    `;
  }

  return `
    <div class="sign__price-row">
      ${hasSale ? `<div class="sign__sale-price">Sale Price ${formatMoney(talker.salePrice)}</div>` : '<div></div>'}
      <div class="sign__regular-price">Regular Price ${formatMoney(talker.price)}</div>
    </div>
  `;
}

function buildLargeSignBodyHtml(talker) {
  const isBeer = talker.category === 'beer';
  const ratingHtml = isBeer ? '' : buildRatingsInlineHtml(talker);
  return `
    <div class="sign__title" data-fit="title">${escapeHtml(talker.title || (isBeer ? 'Beer Name' : 'Product Name'))}</div>
    <div class="sign__description" data-fit="description">${escapeHtml(talker.description || '')}</div>
    ${isBeer ? buildBeerRatingHtml(talker) : ''}
    ${buildSignTopRowHtml(talker, ratingHtml)}
    ${buildSignPriceRowHtml(talker)}
  `;
}

// Small sign: just a name and a big price, no description/rating - matches
// the store's blank Small Display Sign template.
function buildSmallSignBodyHtml(talker) {
  const isBeer = talker.category === 'beer';
  const talkerType = talker.talkerType || 'standard';
  const hasSale = talker.salePrice && Number(talker.salePrice) > 0 && Number(talker.salePrice) !== Number(talker.price);

  let priceHtml;
  if (talkerType === 'supersale') {
    const bigPrice = hasSale ? talker.salePrice : talker.price;
    priceHtml = `
      <div class="sign__supersale-text">Super Sale Price!!!</div>
      <div class="sign__small-price is-sale">${formatMoney(bigPrice)}</div>
    `;
  } else {
    priceHtml = `
      ${talkerType === 'closeout' ? '<div class="sign__closeout-badge">CLOSEOUT!!</div>' : ''}
      ${talkerType === 'chilled' ? '<div class="sign__chilled-badge">Also Available Chilled</div>' : ''}
      <div class="sign__small-price ${hasSale ? 'is-sale' : ''}">${formatMoney(hasSale ? talker.salePrice : talker.price)}</div>
    `;
  }

  return `
    <div class="sign__title sign__title--small" data-fit="title">${escapeHtml(talker.title || (isBeer ? 'Beer Name' : 'Product Name'))}</div>
    ${priceHtml}
    <div class="sign__bottom-row">
      ${hasSale ? `<div class="sign__regular-price">Regular Price ${formatMoney(talker.price)}</div>` : '<div></div>'}
      ${talker.size ? `<div class="sign__size">${escapeHtml(talker.size)}</div>` : '<div></div>'}
    </div>
  `;
}

/**
 * @param {object} talker - same shape as buildCardElement, plus signSize
 *   ('small' | 'large').
 * @returns {HTMLElement} a .sign element, not yet size-fitted
 */
function buildSignElement(talker) {
  const sign = document.createElement('div');
  const size = talker.signSize === 'small' ? 'small' : 'large';
  sign.className = 'sign';
  sign.dataset.theme = talker.theme === 'purple' ? 'purple' : 'amber';
  sign.dataset.size = size;

  const bodyHtml = size === 'small' ? buildSmallSignBodyHtml(talker) : buildLargeSignBodyHtml(talker);
  const showRails = signHasDiscount(talker);

  sign.innerHTML = `
    <div class="sign__band">
      <div class="sign__tagline">Morris County's Largest Wine Discounter</div>
    </div>
    <div class="sign__body">
      ${showRails ? buildSignRailHtml('left') : ''}
      <div class="sign__content">${bodyHtml}</div>
      ${showRails ? buildSignRailHtml('right') : ''}
    </div>
    <div class="sign__band sign__band--footer">
      <span class="sign__footer-text">www.liquoroutletwinecellars.com</span>
      <img class="sign__logo" src="assets/logo.png" alt="" />
    </div>
  `;

  return sign;
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
  card.dataset.size = ['half', 'quarter'].includes(talker.talkerSize) ? talker.talkerSize : 'full';
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
 * fits within the allotted band, down to a sensible minimum. Works on both
 * the Shelf Talker (.card) and Display Sign (.sign) formats. Must be called
 * after the element is attached to the document (needs real layout).
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
  // talker, which - since the body doesn't scroll - shoves (and clips)
  // whatever's below it. Scale the whole pricing block down (all parts
  // together, so their relative sizes stay the same) until it fits.
  const body = cardEl.querySelector('.card__body, .sign__body');
  if (!body) return;
  let priceFit = 1;
  let priceGuard = 40;
  while (body.scrollHeight > body.clientHeight + 1 && priceFit > 0.35 && priceGuard > 0) {
    priceFit = Math.round((priceFit - 0.03) * 100) / 100;
    body.style.setProperty('--price-fit', priceFit);
    priceGuard -= 1;
  }
}

/**
 * @param {object} talker
 * @returns {HTMLElement} a .card (signType 'talker') or .sign
 *   (signType 'sign') element, not yet size-fitted.
 */
function buildPrintableElement(talker) {
  return talker.signType === 'sign' ? buildSignElement(talker) : buildCardElement(talker);
}

function renderFittedCard(talker) {
  const card = buildPrintableElement(talker);
  // fitCardText needs layout, so caller should append `card` to the DOM,
  // then call fitCardText(card) on the next frame.
  return card;
}
