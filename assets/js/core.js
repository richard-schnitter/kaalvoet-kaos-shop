/* ==========================================================================
   KAALVOET KAOS MERCH — shared core
   Cart state, formatting, product loading, placeholder art, toasts.
   Loaded on every page. Depends on config.js.
   ========================================================================== */

(function () {
  'use strict';

  const CFG = window.KK_CONFIG;
  const CART_KEY = 'kk_cart_v1';
  const BUYER_KEY = 'kk_buyer_v1';

  /* --- Utilities --------------------------------------------------------- */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const money = (n) =>
    CFG.shop.currencySymbol + Number(n || 0).toLocaleString('en-ZA', {
      minimumFractionDigits: 0, maximumFractionDigits: 2,
    });

  const debounce = (fn, ms) => {
    let t;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), ms || 200);
    };
  };

  /** Deterministic 0..1 pseudo-random from a string seed. */
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return function () {
      h += 0x6d2b79f5;
      let t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* --- Storage (safe against private mode / blocked storage) ------------- */

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
    del(key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    },
  };

  /* --- Placeholder disc art ---------------------------------------------
     Any product with no photo gets a generated, brand-consistent graphic
     rather than a grey box. Deterministic per SKU, so it never flickers.  */

  function discArt(product) {
    const c1 = (product.colors && product.colors[0]) || '#ff4d2e';
    const c2 = (product.colors && product.colors[1]) || '#13161b';
    const rand = seeded(product.sku || product.id || product.name || 'kk');
    const rot = Math.floor(rand() * 360);
    const rings = 3 + Math.floor(rand() * 3);
    const isFlat = product.category !== 'discs';

    let inner = '';
    if (isFlat) {
      // Apparel / accessories: bold diagonal stripe field.
      const bars = 5 + Math.floor(rand() * 4);
      for (let i = 0; i < bars; i++) {
        const y = (i / bars) * 560 - 120;
        inner += `<rect x="-120" y="${y.toFixed(1)}" width="740" height="${(14 + rand() * 26).toFixed(1)}" fill="${c1}" opacity="${(0.12 + rand() * 0.3).toFixed(2)}"/>`;
      }
      inner = `<g transform="rotate(-24 200 200)">${inner}</g>`;
      inner += `<circle cx="200" cy="200" r="74" fill="none" stroke="${c1}" stroke-width="8" opacity=".85"/>`;
      inner += `<circle cx="200" cy="200" r="24" fill="${c1}"/>`;
    } else {
      // Discs: concentric flight rings with a rim highlight.
      inner += `<circle cx="200" cy="200" r="168" fill="${c1}"/>`;
      inner += `<circle cx="200" cy="200" r="168" fill="none" stroke="rgba(0,0,0,.30)" stroke-width="14"/>`;
      for (let i = 0; i < rings; i++) {
        const r = 142 - i * (20 + rand() * 16);
        if (r < 26) break;
        inner += `<circle cx="200" cy="200" r="${r.toFixed(1)}" fill="none" stroke="rgba(0,0,0,${(0.10 + rand() * 0.14).toFixed(2)})" stroke-width="${(3 + rand() * 7).toFixed(1)}"/>`;
      }
      inner += `<circle cx="200" cy="200" r="52" fill="rgba(0,0,0,.22)"/>`;
      inner += `<path d="M200 46 A154 154 0 0 1 340 152" fill="none" stroke="rgba(255,255,255,.34)" stroke-width="12" stroke-linecap="round"/>`;
      inner = `<g transform="rotate(${rot} 200 200)">${inner}</g>`;
      // Stamp text stays upright.
      inner += `<text x="200" y="207" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="34" letter-spacing="3" fill="rgba(255,255,255,.82)">KK</text>`;
    }

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img" aria-label="${esc(product.name)}">` +
      `<rect width="400" height="400" fill="${c2}"/>` +
      inner +
      `</svg>`;

    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /** Resolve the image to show for a product (real photo wins, art fallback). */
  function imageFor(product, index) {
    const imgs = product.images || [];
    const i = index || 0;
    if (imgs.length && imgs[i]) return imgs[i];
    if (imgs.length) return imgs[0];
    return discArt(product);
  }

  function hasPhoto(product) {
    return !!(product.images && product.images.length);
  }

  /* --- Product loading --------------------------------------------------- */

  let _catalogue = null;

  async function loadProducts() {
    if (_catalogue) return _catalogue;
    const res = await fetch(CFG.shop.productsUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load ' + CFG.shop.productsUrl + ' (' + res.status + ')');
    const data = await res.json();
    _catalogue = Array.isArray(data) ? data : (data.products || []);
    // Normalise a few fields so the rest of the app can trust them.
    _catalogue.forEach((p) => {
      p.price = Number(p.price) || 0;
      p.stock = p.stock == null ? 1 : Number(p.stock);
      p.images = p.images || [];
      p.tags = p.tags || [];
    });
    return _catalogue;
  }

  function findProduct(id) {
    return (_catalogue || []).find((p) => p.id === id);
  }

  /* --- Cart -------------------------------------------------------------- */
  /* A cart line is { id, qty, variant }. Product data is looked up live so
     price/stock edits in products.json always win over a stale cart.       */

  const cart = {
    items: store.get(CART_KEY, []),

    _save() {
      store.set(CART_KEY, this.items);
      document.dispatchEvent(new CustomEvent('cart:change', { detail: this.items }));
    },

    lineKey(id, variant) { return id + '::' + (variant || ''); },

    add(id, qty, variant) {
      qty = qty || 1;
      const key = this.lineKey(id, variant);
      const existing = this.items.find((l) => this.lineKey(l.id, l.variant) === key);
      const product = findProduct(id);
      const max = product ? product.stock : 99;

      if (existing) {
        existing.qty = Math.min(existing.qty + qty, max);
      } else {
        this.items.push({ id: id, qty: Math.min(qty, max), variant: variant || null });
      }
      this._save();
    },

    setQty(id, variant, qty) {
      const key = this.lineKey(id, variant);
      const line = this.items.find((l) => this.lineKey(l.id, l.variant) === key);
      if (!line) return;
      const product = findProduct(id);
      const max = product ? product.stock : 99;
      line.qty = Math.max(0, Math.min(qty, max));
      if (line.qty === 0) this.remove(id, variant);
      else this._save();
    },

    remove(id, variant) {
      const key = this.lineKey(id, variant);
      this.items = this.items.filter((l) => this.lineKey(l.id, l.variant) !== key);
      this._save();
    },

    clear() { this.items = []; this._save(); },

    has(id, variant) {
      const key = this.lineKey(id, variant);
      return this.items.some((l) => this.lineKey(l.id, l.variant) === key);
    },

    qtyOf(id) {
      return this.items.filter((l) => l.id === id).reduce((n, l) => n + l.qty, 0);
    },

    count() { return this.items.reduce((n, l) => n + l.qty, 0); },

    /** Cart lines joined to live product data. Drops items that vanished. */
    detailed() {
      return this.items
        .map((line) => {
          const p = findProduct(line.id);
          if (!p) return null;
          return {
            line: line,
            product: p,
            qty: line.qty,
            variant: line.variant,
            subtotal: p.price * line.qty,
          };
        })
        .filter(Boolean);
    },

    subtotal() { return this.detailed().reduce((n, d) => n + d.subtotal, 0); },

    /** Remove lines whose product disappeared or went out of stock. */
    reconcile() {
      const before = this.items.length;
      this.items = this.items.filter((line) => {
        const p = findProduct(line.id);
        if (!p || p.stock <= 0) return false;
        if (line.qty > p.stock) line.qty = p.stock;
        return true;
      });
      if (this.items.length !== before) this._save();
      return before - this.items.length;
    },
  };

  /* --- Buyer details (remembered between orders) ------------------------- */

  const buyer = {
    get() { return store.get(BUYER_KEY, {}); },
    save(data) { store.set(BUYER_KEY, data); },
    clear() { store.del(BUYER_KEY); },
  };

  /* --- Order reference ---------------------------------------------------- */

  function orderRef() {
    const d = new Date();
    const stamp =
      String(d.getFullYear()).slice(2) +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
    let tail = '';
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 4; i++) tail += alphabet[Math.floor(Math.random() * alphabet.length)];
    return (CFG.orders.orderPrefix || 'KK') + '-' + stamp + '-' + tail;
  }

  /* --- Toasts ------------------------------------------------------------ */

  let toastHost = null;
  function toast(message, kind) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'toasts';
      toastHost.setAttribute('role', 'status');
      toastHost.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastHost);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.textContent = message;
    el.style.pointerEvents = 'auto';
    toastHost.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 260);
    }, 2600);
  }

  /* --- Clipboard --------------------------------------------------------- */

  async function copy(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMessage || 'Copied');
      return true;
    } catch (e) {
      // Fallback for non-secure contexts (e.g. plain http on a LAN IP).
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      toast(ok ? (okMessage || 'Copied') : 'Could not copy — select it manually', ok ? '' : 'bad');
      return ok;
    }
  }

  /* --- Shared chrome (header cart button, footer, announcement) ---------- */

  function renderChrome() {
    // Announcement bar
    const ann = $('[data-announce]');
    if (ann) {
      if (CFG.shop.announcement) ann.textContent = CFG.shop.announcement;
      else ann.remove();
    }

    // Brand names
    $$('[data-brand-name]').forEach((el) => { el.textContent = CFG.brand.name; });
    $$('[data-shop-name]').forEach((el) => { el.textContent = CFG.brand.shopName; });
    $$('[data-tagline]').forEach((el) => { el.textContent = CFG.brand.tagline; });
    $$('[data-blurb]').forEach((el) => { el.textContent = CFG.brand.blurb; });
    $$('[data-domain]').forEach((el) => { el.textContent = CFG.brand.domain; });
    $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
    $$('[data-contact-email]').forEach((el) => {
      el.textContent = CFG.contact.email;
      if (el.tagName === 'A') el.href = 'mailto:' + CFG.contact.email;
    });
    $$('[data-contact-wa]').forEach((el) => {
      el.textContent = CFG.contact.whatsappDisplay;
      if (el.tagName === 'A') el.href = 'https://wa.me/' + CFG.contact.whatsapp;
    });
    $$('[data-instagram]').forEach((el) => {
      if (CFG.brand.instagram) el.href = CFG.brand.instagram;
      else el.closest('li') ? el.closest('li').remove() : el.remove();
    });
    $$('[data-main-site]').forEach((el) => {
      if (CFG.brand.mainSite) el.href = CFG.brand.mainSite;
      else el.closest('li') ? el.closest('li').remove() : el.remove();
    });

    updateCartButton();
  }

  function updateCartButton(animate) {
    const n = cart.count();
    $$('[data-cart-count]').forEach((el) => {
      el.textContent = n;
      el.classList.toggle('is-empty', n === 0);
      if (animate && n > 0) {
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
      }
    });
  }

  document.addEventListener('cart:change', () => updateCartButton(true));

  /* --- Public API -------------------------------------------------------- */

  window.KK = {
    CFG, $, $$, esc, money, debounce, seeded,
    store, cart, buyer,
    loadProducts, findProduct, imageFor, hasPhoto, discArt,
    orderRef, toast, copy, renderChrome, updateCartButton,
    get catalogue() { return _catalogue || []; },
    set catalogue(v) { _catalogue = v; },
  };
})();
