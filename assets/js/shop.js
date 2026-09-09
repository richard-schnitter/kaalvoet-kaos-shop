/* ==========================================================================
   KAALVOET KAOS MERCH — shop page
   Grid rendering, filtering, quick view, cart drawer.
   ========================================================================== */

(function () {
  'use strict';

  const { $, $$, esc, money, debounce, cart, CFG } = window.KK;

  const state = {
    all: [],
    category: 'all',
    query: '',
    sort: 'featured',
    inStockOnly: true,
  };

  const CATEGORY_LABELS = {
    all: 'Everything',
    discs: 'Discs',
    apparel: 'Apparel',
    accessories: 'Accessories',
  };

  /* --- Boot --------------------------------------------------------------- */

  async function init() {
    window.KK.renderChrome();
    bindChrome();

    try {
      state.all = await window.KK.loadProducts();
    } catch (err) {
      $('[data-grid]').innerHTML =
        '<div class="empty"><h3>Could not load the shop</h3><p>' + esc(err.message) +
        '</p><p style="font-size:12.5px;margin-top:10px;color:var(--muted-2)">' +
        'If you opened this file directly from your computer, run a local server instead — ' +
        'browsers block loading data files from <code>file://</code>.</p></div>';
      return;
    }

    const removed = cart.reconcile();
    if (removed > 0) window.KK.toast(removed + ' item(s) in your bag are no longer available', 'info');

    renderStats();
    renderChips();
    render();
    renderCart();
  }

  /* --- Filtering ---------------------------------------------------------- */

  function visible() {
    let list = state.all.slice();

    if (state.category !== 'all') {
      list = list.filter((p) => p.category === state.category);
    }
    if (state.inStockOnly) {
      list = list.filter((p) => p.stock > 0);
    }
    if (state.query) {
      const q = state.query.toLowerCase();
      list = list.filter((p) =>
        [p.name, p.brand, p.subcategory, p.colorName, p.condition, p.sku, (p.tags || []).join(' ')]
          .join(' ').toLowerCase().indexOf(q) > -1
      );
    }

    switch (state.sort) {
      case 'price-asc':  list.sort((a, b) => a.price - b.price); break;
      case 'price-desc': list.sort((a, b) => b.price - a.price); break;
      case 'name':       list.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'newest':     list.reverse(); break;
      default:
        // Featured: photographed items first, then in stock, then deals.
        list.sort((a, b) => {
          const pa = window.KK.hasPhoto(a) ? 0 : 1;
          const pb = window.KK.hasPhoto(b) ? 0 : 1;
          if (pa !== pb) return pa - pb;
          const sa = a.stock > 0 ? 0 : 1;
          const sb = b.stock > 0 ? 0 : 1;
          if (sa !== sb) return sa - sb;
          return (b.compareAt ? 1 : 0) - (a.compareAt ? 1 : 0);
        });
    }
    return list;
  }

  /* --- Rendering ---------------------------------------------------------- */

  /* The hero deliberately carries no stock counts, but these hooks stay
     supported in case a count is ever wanted back in the markup. */
  function renderStats() {
    const discs = state.all.filter((p) => p.category === 'discs' && p.stock > 0);
    const el = $('[data-stat-discs]');
    if (el) el.textContent = discs.length;
    const from = $('[data-stat-from]');
    if (from && discs.length) from.textContent = money(Math.min.apply(null, discs.map((p) => p.price)));
  }

  function renderChips() {
    const host = $('[data-category-chips]');
    if (!host) return;

    const counts = { all: state.all.length };
    state.all.forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });

    const cats = ['all'].concat(
      Object.keys(counts).filter((c) => c !== 'all').sort((a, b) => counts[b] - counts[a])
    );

    host.innerHTML = cats.map((c) =>
      '<button class="chip' + (c === state.category ? ' is-active' : '') +
      '" data-cat="' + esc(c) + '" type="button" aria-pressed="' + (c === state.category) + '">' +
      esc(CATEGORY_LABELS[c] || (c.charAt(0).toUpperCase() + c.slice(1))) +
      '<span class="chip__n">' + counts[c] + '</span></button>'
    ).join('');

    host.onclick = (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      state.category = btn.dataset.cat;
      renderChips();
      render();
    };
  }

  function badgesFor(p) {
    const out = [];
    if (p.stock <= 0) out.push('<span class="badge badge--out">Sold</span>');
    else {
      if (p.unique) out.push('<span class="badge badge--unique">' + esc(CFG.shop.uniqueBadge) + '</span>');
      const tierBadge = p.tier && (CFG.shop.tierBadges || {})[p.tier];
      if (tierBadge) out.push('<span class="badge badge--new">' + esc(tierBadge) + '</span>');
      if (p.compareAt && p.compareAt > p.price) out.push('<span class="badge badge--deal">Deal</span>');
      if (!p.unique && p.stock <= CFG.shop.lowStockAt) {
        out.push('<span class="badge badge--low">Only ' + p.stock + ' left</span>');
      }
    }
    return out.join('');
  }

  function cardHtml(p) {
    const sold = p.stock <= 0;
    const specs = [];
    if (p.weight) specs.push(p.weight);
    if (p.brand && p.category === 'discs') specs.push(p.brand);
    if (p.colorName) specs.push(p.colorName);
    if (p.variants && p.variants.length) specs.push(p.variants.length + ' sizes');

    return (
      '<article class="card' + (sold ? ' is-out' : '') + '" data-id="' + esc(p.id) + '">' +
        '<button class="card__media" data-quick="' + esc(p.id) + '" type="button" aria-label="Quick view: ' + esc(p.name) + '">' +
          '<img src="' + esc(window.KK.imageFor(p)) + '" alt="' + esc(p.name) + '" loading="lazy" decoding="async">' +
          '<span class="card__badges">' + badgesFor(p) + '</span>' +
          '<span class="card__quick">Quick view</span>' +
        '</button>' +
        '<div class="card__body">' +
          '<div class="card__meta">' + esc(p.subcategory || p.category) +
            (p.condition && p.condition !== 'Brand new' ? ' · ' + esc(p.condition) : '') + '</div>' +
          '<h3 class="card__name">' + esc(p.name) + '</h3>' +
          '<div class="card__specs">' + specs.map((s) => '<span class="spec">' + esc(s) + '</span>').join('') + '</div>' +
          '<div class="card__foot">' +
            '<div class="price">' + money(p.price) +
              (p.compareAt && p.compareAt > p.price ? '<span class="price__was">' + money(p.compareAt) + '</span>' : '') +
            '</div>' +
            addButtonHtml(p) +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function addButtonHtml(p) {
    if (p.stock <= 0) {
      return '<button class="add-btn" disabled aria-label="Sold out">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>';
    }
    // Items with variants must go through quick view so a size gets chosen.
    if (p.variants && p.variants.length) {
      return '<button class="add-btn" data-quick="' + esc(p.id) + '" type="button" aria-label="Choose a size for ' + esc(p.name) + '">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>';
    }
    const inBag = cart.qtyOf(p.id) >= p.stock;
    return '<button class="add-btn' + (inBag ? ' is-added' : '') + '" data-add="' + esc(p.id) + '" type="button"' +
      (inBag ? ' disabled' : '') + ' aria-label="Add ' + esc(p.name) + ' to bag">' +
      (inBag
        ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
        : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>') +
      '</button>';
  }

  function render() {
    const list = visible();
    const grid = $('[data-grid]');

    if (!list.length) {
      grid.innerHTML =
        '<div class="empty"><h3>Nothing matches that</h3>' +
        '<p>Try a different search, or clear the filters.</p>' +
        '<button class="btn btn--ghost btn--sm" data-reset type="button" style="margin-top:16px">Reset filters</button></div>';
    } else {
      grid.innerHTML = list.map(cardHtml).join('');
    }

    const count = $('[data-count]');
    if (count) {
      count.textContent = list.length + ' of ' + state.all.length + ' items';
    }
  }

  /* --- Cart drawer -------------------------------------------------------- */

  function renderCart() {
    const body = $('[data-cart-body]');
    const foot = $('[data-cart-foot]');
    const items = cart.detailed();

    if (!items.length) {
      body.innerHTML =
        '<div class="empty" style="border:none;padding:56px 10px">' +
        '<h3>Your bag is empty</h3><p>Go grab a disc before someone else does.</p></div>';
      foot.hidden = true;
      return;
    }

    body.innerHTML = items.map((d) => {
      const p = d.product;
      return (
        '<div class="line-item">' +
          '<div class="line-item__media"><img src="' + esc(window.KK.imageFor(p)) + '" alt="" loading="lazy"></div>' +
          '<div class="line-item__info">' +
            '<div class="line-item__name">' + esc(p.name) + '</div>' +
            '<div class="line-item__sub">' + esc(p.sku) +
              (d.variant ? ' · ' + esc(d.variant) : '') +
              ' · ' + money(p.price) + ' each</div>' +
            '<div class="line-item__foot">' +
              (p.unique
                ? '<span class="line-item__sub" style="margin:0">One of one</span>'
                : '<div class="qty">' +
                    '<button data-dec="' + esc(p.id) + '" data-variant="' + esc(d.variant || '') + '" type="button" aria-label="Decrease quantity">&minus;</button>' +
                    '<span>' + d.qty + '</span>' +
                    '<button data-inc="' + esc(p.id) + '" data-variant="' + esc(d.variant || '') + '" type="button" aria-label="Increase quantity"' +
                      (d.qty >= p.stock ? ' disabled' : '') + '>+</button>' +
                  '</div>') +
              '<span class="line-item__price">' + money(d.subtotal) + '</span>' +
            '</div>' +
            '<button class="line-item__remove" data-remove="' + esc(p.id) + '" data-variant="' + esc(d.variant || '') + '" type="button" style="margin-top:7px">Remove</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    foot.hidden = false;
    $('[data-cart-subtotal]').textContent = money(cart.subtotal());
    $('[data-cart-total]').textContent = money(cart.subtotal());
  }

  function openCart() {
    $('[data-drawer]').classList.add('is-open');
    $('[data-drawer]').setAttribute('aria-hidden', 'false');
    $('[data-scrim]').classList.add('is-open');
    document.body.classList.add('is-locked');
    $('[data-close-cart]').focus();
  }

  function closeCart() {
    $('[data-drawer]').classList.remove('is-open');
    $('[data-drawer]').setAttribute('aria-hidden', 'true');
    if (!$('[data-modal]').classList.contains('is-open')) {
      $('[data-scrim]').classList.remove('is-open');
      document.body.classList.remove('is-locked');
    }
  }

  /* --- Quick view --------------------------------------------------------- */

  let modalProduct = null;
  let modalImageIndex = 0;

  function openModal(id) {
    const p = window.KK.findProduct(id);
    if (!p) return;
    modalProduct = p;
    modalImageIndex = 0;
    renderModal();
    const m = $('[data-modal]');
    m.classList.add('is-open');
    m.setAttribute('aria-hidden', 'false');
    $('[data-scrim]').classList.add('is-open');
    document.body.classList.add('is-locked');
    const close = $('[data-modal-close]');
    if (close) close.focus();
  }

  function closeModal() {
    const m = $('[data-modal]');
    m.classList.remove('is-open');
    m.setAttribute('aria-hidden', 'true');
    modalProduct = null;
    if (!$('[data-drawer]').classList.contains('is-open')) {
      $('[data-scrim]').classList.remove('is-open');
      document.body.classList.remove('is-locked');
    }
  }

  function p_currentImages() {
    const p = modalProduct;
    if (!p) return [];
    return p.images && p.images.length
      ? p.images.map(window.KK.versioned)
      : [window.KK.discArt(p)];
  }

  function renderModal() {
    const p = modalProduct;
    if (!p) return;

    const rows = [];
    if (p.brand) rows.push(['Brand', p.brand]);
    if (p.subcategory) rows.push(['Model', p.subcategory]);
    if (p.weight) rows.push(['Weight', p.weight]);
    if (p.colorName) rows.push(['Colourway', p.colorName]);
    if (p.stamp) rows.push(['Stamp', p.stamp]);
    if (p.condition) rows.push(['Condition', p.condition]);
    rows.push(['SKU', p.sku]);
    rows.push(['Availability', p.stock > 0 ? (p.unique ? 'One available' : p.stock + ' available') : 'Sold out']);

    const imgs = p.images && p.images.length
      ? p.images.map(window.KK.versioned)
      : [window.KK.discArt(p)];
    const hasVariants = p.variants && p.variants.length;

    $('[data-modal-panel]').innerHTML =
      '<button class="modal__close" data-modal-close type="button" aria-label="Close">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      '</button>' +
      '<div class="modal__media">' +
        '<img class="zoomable" data-zoom src="' + esc(imgs[modalImageIndex] || imgs[0]) +
          '" alt="' + esc(p.name) + '" title="Click to see it full size">' +
        (imgs.length > 1
          ? '<div class="modal__thumbs">' + imgs.map((src, i) =>
              '<button class="modal__thumb' + (i === modalImageIndex ? ' is-active' : '') +
              '" data-img="' + i + '" type="button" aria-label="View image ' + (i + 1) + '">' +
              '<img src="' + esc(src) + '" alt="" loading="lazy"></button>').join('') + '</div>'
          : '') +
      '</div>' +
      '<div class="modal__content">' +
        '<div class="card__badges" style="position:static;margin-bottom:-4px">' + badgesFor(p) + '</div>' +
        '<h2 class="modal__title">' + esc(p.name) + '</h2>' +
        '<div class="price" style="font-size:30px">' + money(p.price) +
          (p.compareAt && p.compareAt > p.price ? '<span class="price__was" style="font-size:14px">' + money(p.compareAt) + '</span>' : '') +
        '</div>' +
        '<p class="modal__desc">' + esc(p.description || '') + '</p>' +
        (hasVariants
          ? '<div class="field"><span class="field__label">' + esc(p.variantLabel || 'Option') + '<span class="req">*</span></span>' +
            '<div class="chips" data-variant-picker>' +
              p.variants.map((v, i) =>
                '<button class="chip' + (i === 0 ? ' is-active' : '') + '" data-variant-opt="' + esc(v) + '" type="button">' + esc(v) + '</button>'
              ).join('') +
            '</div></div>'
          : '') +
        '<div class="spec-table">' +
          rows.map((r) =>
            '<div class="spec-table__row"><div class="spec-table__k">' + esc(r[0]) + '</div><div>' + esc(r[1]) + '</div></div>'
          ).join('') +
        '</div>' +
        '<div style="margin-top:auto;padding-top:6px">' +
          (p.stock > 0
            ? '<button class="btn btn--primary btn--block btn--lg" data-modal-add="' + esc(p.id) + '" type="button">Add to bag · ' + money(p.price) + '</button>'
            : '<button class="btn btn--ghost btn--block btn--lg" disabled>Sold out</button>') +
          '<p style="font-size:11.5px;color:var(--muted-2);text-align:center;margin:11px 0 0">' +
            'No payment taken here. You pay by EFT and upload the proof on the order page.</p>' +
        '</div>' +
      '</div>';
  }

  /* --- Events -------------------------------------------------------------- */

  function bindChrome() {
    // Cart open/close
    $$('[data-open-cart]').forEach((b) => b.addEventListener('click', openCart));
    $('[data-close-cart]').addEventListener('click', closeCart);
    $('[data-scrim]').addEventListener('click', () => { closeModal(); closeCart(); });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('[data-modal]').classList.contains('is-open')) closeModal();
      else if ($('[data-drawer]').classList.contains('is-open')) closeCart();
    });

    // Search
    const search = $('[data-search]');
    const clear = $('[data-search-clear]');
    search.addEventListener('input', debounce(function () {
      state.query = this.value.trim();
      clear.classList.toggle('hidden', !this.value);
      render();
    }, 180));
    clear.addEventListener('click', () => {
      search.value = '';
      state.query = '';
      clear.classList.add('hidden');
      render();
      search.focus();
    });

    // Sort + stock toggle
    $('[data-sort]').addEventListener('change', function () { state.sort = this.value; render(); });
    $('[data-instock]').addEventListener('change', function () { state.inStockOnly = this.checked; render(); });

    // Grid delegation
    $('[data-grid]').addEventListener('click', (e) => {
      const quick = e.target.closest('[data-quick]');
      if (quick) { openModal(quick.dataset.quick); return; }

      const add = e.target.closest('[data-add]');
      if (add) {
        const p = window.KK.findProduct(add.dataset.add);
        cart.add(p.id, 1, null);
        window.KK.toast(p.name + ' added to your bag');
        render();
        renderCart();
        return;
      }

      const reset = e.target.closest('[data-reset]');
      if (reset) {
        state.query = ''; state.category = 'all'; state.inStockOnly = true;
        $('[data-search]').value = '';
        $('[data-search-clear]').classList.add('hidden');
        $('[data-instock]').checked = true;
        renderChips();
        render();
      }
    });

    // Drawer delegation
    $('[data-cart-body]').addEventListener('click', (e) => {
      const variantOf = (btn) => btn.dataset.variant || null;

      const inc = e.target.closest('[data-inc]');
      if (inc) { cart.setQty(inc.dataset.inc, variantOf(inc), cart.items.find((l) => l.id === inc.dataset.inc && (l.variant || '') === (inc.dataset.variant || '')).qty + 1); renderCart(); render(); return; }

      const dec = e.target.closest('[data-dec]');
      if (dec) { cart.setQty(dec.dataset.dec, variantOf(dec), cart.items.find((l) => l.id === dec.dataset.dec && (l.variant || '') === (dec.dataset.variant || '')).qty - 1); renderCart(); render(); return; }

      const rm = e.target.closest('[data-remove]');
      if (rm) { cart.remove(rm.dataset.remove, variantOf(rm)); renderCart(); render(); window.KK.toast('Removed from bag', 'info'); }
    });

    $('[data-clear-cart]').addEventListener('click', () => {
      if (!cart.count()) return;
      cart.clear();
      renderCart();
      render();
      window.KK.toast('Bag emptied', 'info');
    });

    // Modal delegation
    $('[data-modal]').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) { closeModal(); return; }

      if (e.target.closest('[data-modal-close]')) { closeModal(); return; }

      if (e.target.closest('[data-zoom]')) {
        const imgs = p_currentImages();
        window.KK.lightbox(imgs[modalImageIndex] || imgs[0], modalProduct ? modalProduct.name : '');
        return;
      }

      const thumb = e.target.closest('[data-img]');
      if (thumb) { modalImageIndex = Number(thumb.dataset.img); renderModal(); return; }

      const opt = e.target.closest('[data-variant-opt]');
      if (opt) {
        $$('[data-variant-opt]').forEach((b) => b.classList.remove('is-active'));
        opt.classList.add('is-active');
        return;
      }

      const add = e.target.closest('[data-modal-add]');
      if (add) {
        const p = window.KK.findProduct(add.dataset.modalAdd);
        const picked = $('[data-variant-opt].is-active');
        const variant = picked ? picked.dataset.variantOpt : null;

        if (p.variants && p.variants.length && !variant) {
          window.KK.toast('Choose a ' + (p.variantLabel || 'option').toLowerCase() + ' first', 'bad');
          return;
        }
        if (cart.qtyOf(p.id) >= p.stock && p.unique) {
          window.KK.toast('That one is already in your bag', 'info');
          return;
        }
        cart.add(p.id, 1, variant);
        window.KK.toast(p.name + ' added to your bag');
        closeModal();
        render();
        renderCart();
        openCart();
      }
    });

    document.addEventListener('cart:change', () => { renderCart(); });

    // Live claim counts arrive after the first paint; redraw when they do,
    // and drop anything from the bag that someone else has taken.
    document.addEventListener('stock:change', () => {
      const dropped = cart.reconcile();
      renderChips();
      render();
      renderCart();
      if (dropped > 0) {
        window.KK.toast(dropped + ' item(s) in your bag just sold out', 'bad');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
