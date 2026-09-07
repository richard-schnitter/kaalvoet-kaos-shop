/* ==========================================================================
   KAALVOET KAOS MERCH — order page
   Details capture, EFT instructions, proof-of-payment upload, submission.
   No card details are ever collected or transmitted.
   ========================================================================== */

(function () {
  'use strict';

  const { $, $$, esc, money, cart, buyer, CFG } = window.KK;

  const state = {
    delivery: CFG.delivery[0],
    popFile: null,      // { name, size, type, dataUrl }
    submitting: false,
    lastOrder: null,
  };

  /* --- Boot --------------------------------------------------------------- */

  async function init() {
    window.KK.renderChrome();
    $$('[data-contact-name]').forEach((el) => { el.textContent = CFG.contact.contactName; });

    try {
      await window.KK.loadProducts();
    } catch (err) {
      document.querySelector('main').innerHTML =
        '<div class="empty" style="margin:60px auto;max-width:560px"><h3>Could not load the shop</h3><p>' +
        esc(err.message) + '</p></div>';
      return;
    }

    cart.reconcile();

    if (!cart.count()) {
      show('empty');
      return;
    }

    show('form');
    renderDelivery();
    renderBank();
    renderSummary();
    prefill();
    bind();
  }

  function show(which) {
    $('[data-empty-state]').hidden = which !== 'empty';
    $('[data-form-state]').hidden = which !== 'form';
    $('[data-confirm-state]').hidden = which !== 'confirm';
  }

  /* --- Rendering ---------------------------------------------------------- */

  function renderDelivery() {
    $('[data-delivery-options]').innerHTML = CFG.delivery.map((d, i) =>
      '<label class="radio-card">' +
        '<input type="radio" name="delivery" value="' + esc(d.id) + '"' + (i === 0 ? ' checked' : '') + '>' +
        '<span class="radio-card__dot"></span>' +
        '<span class="grow">' +
          '<span class="radio-card__title">' + esc(d.label) +
            '<span class="radio-card__price">' + (d.price > 0 ? money(d.price) : 'Free') + '</span>' +
          '</span>' +
          '<span class="radio-card__note">' + esc(d.note || '') + '</span>' +
        '</span>' +
      '</label>'
    ).join('');
  }

  /** True only once real banking details have been filled into config.js. */
  function bankingReady() {
    const b = CFG.banking || {};
    if (b.ready === false) return false;
    // Belt and braces: an empty or all-zero account number is never real.
    const acc = String(b.accountNumber || '').replace(/[^0-9]/g, '');
    return acc.length >= 6 && /[1-9]/.test(acc);
  }

  function renderBank() {
    const b = CFG.banking;

    if (!bankingReady()) {
      // No account number on screen until it is real, so nobody can pay the
      // wrong account and the POP step stops pretending to be mandatory.
      $('[data-pay-title]').textContent = 'Payment';
      $('[data-pay-note]').textContent =
        'Banking details are sent with your order confirmation, not shown here. Submit this order and ' +
        CFG.contact.contactName + ' will WhatsApp you the account to pay into, with your order number ' +
        'as the reference.';
      $('[data-bank-grid]').hidden = true;
      $('[data-ref-hint]').hidden = true;
      $('[data-pay-extra]').textContent =
        'Nothing is charged now, and nothing is owed until you have the details and are happy with the order.';
      $('[data-pop-note]').textContent =
        'Only if you have already arranged payment with ' + CFG.contact.contactName + '. Otherwise skip it ' +
        'and send the proof on WhatsApp once you have paid.';
      return;
    }

    $('[data-bank-grid]').hidden = false;
    $('[data-ref-hint]').hidden = false;
    const cells = [
      ['Account name', b.accountName],
      ['Bank', b.bank],
      ['Account number', b.accountNumber],
      ['Branch code', b.branchCode],
      ['Account type', b.accountType],
    ].filter((c) => c[1]);

    $('[data-bank-grid]').innerHTML = cells.map((c) =>
      '<div class="bank-cell">' +
        '<div class="bank-cell__k">' + esc(c[0]) + '</div>' +
        '<div class="bank-cell__v">' + esc(c[1]) + '</div>' +
        '<button class="copy-btn" data-copy="' + esc(c[1]) + '" type="button">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          'Copy</button>' +
      '</div>'
    ).join('');

    $('[data-ref-hint]').textContent = b.referenceHint;
  }

  function renderSummary() {
    const items = cart.detailed();

    $('[data-summary-items]').innerHTML = items.map((d) =>
      '<div class="summary-item">' +
        '<div class="summary-item__media"><img src="' + esc(window.KK.imageFor(d.product)) + '" alt="" loading="lazy"></div>' +
        '<div class="grow">' +
          '<div class="summary-item__name">' + esc(d.product.name) + '</div>' +
          '<div class="summary-item__meta">' + esc(d.product.sku) +
            (d.variant ? ' · ' + esc(d.variant) : '') +
            (d.qty > 1 ? ' · x' + d.qty : '') + '</div>' +
        '</div>' +
        '<div class="summary-item__price">' + money(d.subtotal) + '</div>' +
      '</div>'
    ).join('');

    const sub = cart.subtotal();
    const del = state.delivery ? state.delivery.price : 0;

    $('[data-summary-subtotal]').textContent = money(sub);
    $('[data-summary-delivery-label]').textContent = state.delivery ? state.delivery.label : 'Delivery';
    $('[data-summary-delivery]').textContent = del > 0 ? money(del) : 'Free';
    $('[data-summary-total]').textContent = money(sub + del);
  }

  function prefill() {
    const saved = buyer.get();
    Object.keys(saved).forEach((k) => {
      const el = document.querySelector('[name="' + k + '"]');
      if (el && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'file') el.value = saved[k];
    });
  }

  /* --- Validation --------------------------------------------------------- */

  const CELL_RE = /^(\+?27|0)[6-8][0-9]{8}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function fieldOf(input) { return input.closest('[data-field]'); }

  function setError(input, on) {
    const f = fieldOf(input);
    if (f) f.classList.toggle('has-error', !!on);
  }

  function validateField(input) {
    const v = (input.value || '').trim();

    if (input.hasAttribute('required') && !v) { setError(input, true); return false; }
    if (input.id === 'cell' && v && !CELL_RE.test(v.replace(/[\s\-()]/g, ''))) { setError(input, true); return false; }
    if (input.type === 'email' && v && !EMAIL_RE.test(v)) { setError(input, true); return false; }

    setError(input, false);
    return true;
  }

  function validateAll() {
    const form = $('[data-order-form]');
    const inputs = $$('input[required], select[required], textarea[required]', form)
      .filter((el) => el.offsetParent !== null || el.type === 'checkbox');

    let ok = true;
    let firstBad = null;

    inputs.forEach((el) => {
      if (el.type === 'checkbox') {
        if (!el.checked) { ok = false; firstBad = firstBad || el; }
        return;
      }
      if (!validateField(el)) { ok = false; firstBad = firstBad || el; }
    });

    // Address is conditionally required.
    if (state.delivery && state.delivery.needsAddress) {
      const addr = $('#address');
      if (!addr.value.trim()) { setError(addr, true); ok = false; firstBad = firstBad || addr; }
      else setError(addr, false);
    }

    if (firstBad) {
      firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      try { firstBad.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
      if (firstBad.type === 'checkbox') window.KK.toast('Please tick the confirmation box', 'bad');
      else window.KK.toast('Please check the highlighted fields', 'bad');
    }
    return ok;
  }

  /* --- Proof of payment --------------------------------------------------- */

  function humanSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function acceptPop(file) {
    if (!file) return;

    const maxBytes = (CFG.orders.maxPopSizeMb || 8) * 1024 * 1024;
    const okType = file.type.indexOf('image/') === 0 || file.type === 'application/pdf';

    if (!okType) { window.KK.toast('Please attach an image or a PDF', 'bad'); return; }
    if (file.size > maxBytes) {
      window.KK.toast('That file is ' + humanSize(file.size) + ' — max is ' + CFG.orders.maxPopSizeMb + ' MB', 'bad');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      state.popFile = { name: file.name, size: file.size, type: file.type, dataUrl: reader.result };
      renderPop();
      window.KK.toast('Proof of payment attached');
    };
    reader.onerror = () => window.KK.toast('Could not read that file', 'bad');
    reader.readAsDataURL(file);
  }

  function renderPop() {
    const host = $('[data-pop-preview]');
    if (!state.popFile) { host.hidden = true; host.innerHTML = ''; return; }

    const f = state.popFile;
    const isImg = f.type.indexOf('image/') === 0;

    host.hidden = false;
    host.innerHTML =
      '<div class="file-chip">' +
        '<div class="file-chip__thumb">' +
          (isImg ? '<img src="' + esc(f.dataUrl) + '" alt="Proof of payment preview">' : 'PDF') +
        '</div>' +
        '<div class="grow">' +
          '<div class="file-chip__name">' + esc(f.name) + '</div>' +
          '<div class="file-chip__size">' + humanSize(f.size) + ' · attached</div>' +
        '</div>' +
        '<button class="icon-btn" data-pop-remove type="button" aria-label="Remove attachment">' +
          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
      '</div>';
  }

  /* --- Order assembly ------------------------------------------------------ */

  function collect() {
    const form = $('[data-order-form]');
    const fd = new FormData(form);
    const get = (k) => (fd.get(k) || '').toString().trim();

    const items = cart.detailed().map((d) => ({
      sku: d.product.sku,
      name: d.product.name,
      variant: d.variant || null,
      qty: d.qty,
      unitPrice: d.product.price,
      total: d.subtotal,
    }));

    const subtotal = cart.subtotal();
    const deliveryFee = state.delivery ? state.delivery.price : 0;

    return {
      ref: window.KK.orderRef(),
      placedAt: new Date().toISOString(),
      customer: {
        firstName: get('firstName'),
        lastName: get('lastName'),
        cell: get('cell'),
        email: get('email'),
        team: get('team'),
        province: get('province'),
        city: get('city'),
      },
      delivery: {
        method: state.delivery ? state.delivery.label : '',
        methodId: state.delivery ? state.delivery.id : '',
        fee: deliveryFee,
        address: get('address'),
      },
      notes: get('notes'),
      marketingOptIn: !!fd.get('marketing'),
      items: items,
      totals: { subtotal: subtotal, delivery: deliveryFee, total: subtotal + deliveryFee },
      pop: state.popFile
        ? { name: state.popFile.name, size: state.popFile.size, type: state.popFile.type }
        : null,
    };
  }

  function plainText(order) {
    const L = [];
    L.push('*NEW ORDER — ' + CFG.brand.shopName + '*');
    L.push('Order: ' + order.ref);
    L.push('');
    L.push('*Buyer*');
    L.push(order.customer.firstName + ' ' + order.customer.lastName);
    L.push('Cell: ' + order.customer.cell);
    if (order.customer.email) L.push('Email: ' + order.customer.email);
    L.push('Team: ' + order.customer.team);
    L.push('Based: ' + order.customer.city + ', ' + order.customer.province);
    L.push('');
    L.push('*Items*');

    const shown = order.items.slice(0, 25);
    shown.forEach((it) => {
      L.push('• ' + it.name + (it.variant ? ' (' + it.variant + ')' : '') +
             (it.qty > 1 ? ' x' + it.qty : '') + ' — ' + money(it.total));
    });
    if (order.items.length > shown.length) {
      L.push('• …and ' + (order.items.length - shown.length) + ' more items');
    }

    L.push('');
    L.push('Subtotal: ' + money(order.totals.subtotal));
    L.push('Delivery (' + order.delivery.method + '): ' +
           (order.totals.delivery > 0 ? money(order.totals.delivery) : 'Free'));
    L.push('*TOTAL: ' + money(order.totals.total) + '*');

    if (order.delivery.address) {
      L.push('');
      L.push('*Deliver to*');
      L.push(order.delivery.address);
    }
    if (order.notes) {
      L.push('');
      L.push('*Notes*');
      L.push(order.notes);
    }

    L.push('');
    L.push(order.pop ? 'Proof of payment: attached on the website (' + order.pop.name + ')'
                     : 'Proof of payment: to follow');
    if (!bankingReady()) {
      L.push('');
      L.push('_Please send me the banking details for this order._');
    }
    return L.join('\n');
  }

  function whatsappLink(order) {
    return 'https://wa.me/' + CFG.contact.whatsapp + '?text=' + encodeURIComponent(plainText(order));
  }

  async function postToEndpoint(order) {
    const url = CFG.orders.endpointUrl;
    if (!url) return { skipped: true };

    const payload = Object.assign({}, order, {
      shop: CFG.brand.shopName,
      summaryText: plainText(order),
      popDataUrl: state.popFile ? state.popFile.dataUrl : null,
    });

    // text/plain avoids a CORS preflight, which Google Apps Script cannot answer.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Endpoint returned ' + res.status);
    return { ok: true };
  }

  /* --- Submit -------------------------------------------------------------- */

  async function submit(e) {
    e.preventDefault();
    if (state.submitting) return;
    if (!validateAll()) return;

    const btn = $('[data-submit]');
    state.submitting = true;
    btn.disabled = true;
    btn.textContent = 'Sending your order…';

    const order = collect();
    state.lastOrder = order;

    // Remember the buyer for next time (never the proof of payment).
    buyer.save(order.customer);

    const mode = CFG.orders.mode;
    let endpointFailed = false;

    if (mode === 'endpoint' || mode === 'both') {
      try {
        await postToEndpoint(order);
      } catch (err) {
        endpointFailed = true;
        console.error('[KK] order endpoint failed:', err);
      }
    }

    finish(order, endpointFailed);
  }

  function finish(order, endpointFailed) {
    show('confirm');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    $('[data-confirm-ref]').textContent = order.ref;
    $('[data-confirm-wa]').href = whatsappLink(order);

    let note = CFG.orders.confirmationNote;
    if (endpointFailed) {
      note = 'Your order could not be saved automatically — please tap the WhatsApp button below so it reaches ' +
             CFG.contact.contactName + '. Nothing is lost, the details are all in the message.';
      window.KK.toast('Send it on WhatsApp to make sure I get it', 'bad');
    } else if (CFG.orders.mode === 'whatsapp') {
      note = 'One more step: tap the button below to send the order to ' + CFG.contact.contactName +
             ' on WhatsApp' + (order.pop ? ' and attach your proof of payment there' : '') + '. ' +
             (bankingReady()
               ? CFG.orders.confirmationNote
               : CFG.contact.contactName + ' will reply with the banking details and confirm the hand-over.');
    }
    $('[data-confirm-note]').textContent = note;

    $('[data-confirm-copy]').onclick = () =>
      window.KK.copy(plainText(order).replace(/\*/g, ''), 'Order summary copied');

    // The bag has done its job.
    cart.clear();
  }

  /* --- Events -------------------------------------------------------------- */

  function bind() {
    const form = $('[data-order-form]');

    form.addEventListener('submit', submit);

    // Live validation once a field has been touched.
    $$('input, select, textarea', form).forEach((el) => {
      el.addEventListener('blur', () => {
        if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file') return;
        if (el.value.trim() || el.hasAttribute('required')) validateField(el);
      });
      el.addEventListener('input', () => {
        const f = fieldOf(el);
        if (f && f.classList.contains('has-error')) validateField(el);
      });
    });

    // Delivery choice
    $('[data-delivery-options]').addEventListener('change', (e) => {
      const input = e.target.closest('input[name="delivery"]');
      if (!input) return;
      state.delivery = CFG.delivery.find((d) => d.id === input.value) || CFG.delivery[0];
      $('[data-address-block]').hidden = !state.delivery.needsAddress;
      const addr = $('#address');
      if (state.delivery.needsAddress) addr.setAttribute('required', '');
      else { addr.removeAttribute('required'); setError(addr, false); }
      renderSummary();
    });

    // Copy bank details
    $('[data-bank-grid]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-copy]');
      if (b) window.KK.copy(b.dataset.copy, 'Copied to clipboard');
    });

    // POP upload
    const dz = $('[data-dropzone]');
    const input = $('[data-pop-input]');

    dz.addEventListener('click', () => input.click());
    dz.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', () => acceptPop(input.files[0]));

    ['dragenter', 'dragover'].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-over'); })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-over'); })
    );
    dz.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files.length) acceptPop(e.dataTransfer.files[0]);
    });

    $('[data-pop-preview]').addEventListener('click', (e) => {
      if (e.target.closest('[data-pop-remove]')) {
        state.popFile = null;
        input.value = '';
        renderPop();
      }
    });

    // Keep the rail honest if another tab changes the bag.
    document.addEventListener('cart:change', () => {
      if (!cart.count() && $('[data-confirm-state]').hidden) show('empty');
      else renderSummary();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
