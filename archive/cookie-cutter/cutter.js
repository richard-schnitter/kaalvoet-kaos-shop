  /* ======================================================================
     Cookie cutter

     The automatic pass cannot separate every photo: a crease in the sweep
     lying against the rim looks exactly like disc plastic to it. Rather
     than guess harder and risk eating stock, those get flagged and cut by
     hand here. Drag a circle over the disc; everything outside becomes the
     backdrop, using the same colour rule as the automatic pass.
     ====================================================================== */

  const cutter = {
    path: null,      // image path being cut
    index: 0,        // its position in the product's images
    bitmap: null,    // full-size source
    shape: null,     // { cx, cy, rx, ry } in image pixels
    scale: 1,        // displayed px per image px
    drag: null,
  };

  /** Rough disc position, used as the cutter's starting circle. */
  function guessDisc(data, w, h, bg) {
    const cutoff = lum(bg.r, bg.g, bg.b) + BACKDROP.discBright;
    let sx = 0, sy = 0, n = 0;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      if (lum(data[i], data[i + 1], data[i + 2]) <= cutoff) continue;
      sx += p % w; sy += (p / w) | 0; n++;
    }
    if (!n) return { cx: w / 2, cy: h / 2, rx: Math.min(w, h) * 0.4, ry: Math.min(w, h) * 0.4 };
    const cx = sx / n, cy = sy / n;
    const r = Math.sqrt(n / Math.PI) * 1.04;
    return { cx: cx, cy: cy, rx: r, ry: r };
  }

  async function openCutter(index) {
    const p = editing;
    if (!p) return;
    const path = p.images[index];
    if (!path) return;

    let bmp;
    try {
      bmp = await sourceBitmap(path);
    } catch (e) {
      window.KK.toast('Could not open that photo', 'bad');
      return;
    }

    cutter.path = path;
    cutter.index = index;
    cutter.bitmap = bmp;

    // Read pixels once to place the starting circle.
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const cx2 = cv.getContext('2d');
    cx2.drawImage(bmp, 0, 0);
    const data = cx2.getImageData(0, 0, cv.width, cv.height).data;
    cutter.shape = guessDisc(data, cv.width, cv.height, edgeColour(data, cv.width, cv.height));

    $('[data-cutter-img]').src = cv.toDataURL('image/jpeg', 0.85);
    $('[data-cutter-file]').textContent = path.split('/').pop() + '  ' + bmp.width + ' x ' + bmp.height;
    $('[data-cutter]').classList.add('is-open');
    document.body.classList.add('is-locked');

    // Wait for layout so the displayed scale is known.
    const img = $('[data-cutter-img]');
    if (!img.complete) await new Promise((r) => { img.onload = r; });
    setTimeout(drawRing, 30);
  }

  function closeCutter() {
    $('[data-cutter]').classList.remove('is-open');
    if (cutter.bitmap && cutter.bitmap.close) cutter.bitmap.close();
    cutter.bitmap = null;
    cutter.path = null;
    if (!document.querySelector('.modal.is-open')) document.body.classList.remove('is-locked');
  }

  function drawRing() {
    const img = $('[data-cutter-img]');
    const ring = $('[data-cutter-ring]');
    if (!img.naturalWidth || !cutter.shape) return;

    cutter.scale = img.clientWidth / img.naturalWidth;
    const s = cutter.scale;
    const sh = cutter.shape;

    ring.style.left = (sh.cx - sh.rx) * s + 'px';
    ring.style.top = (sh.cy - sh.ry) * s + 'px';
    ring.style.width = sh.rx * 2 * s + 'px';
    ring.style.height = sh.ry * 2 * s + 'px';

    $('[data-cutter-size]').textContent =
      Math.round(sh.rx * 2) + ' x ' + Math.round(sh.ry * 2) + ' px';
  }

  function clampShape() {
    const img = $('[data-cutter-img]');
    const w = img.naturalWidth, h = img.naturalHeight;
    const sh = cutter.shape;
    sh.rx = Math.max(8, Math.min(w * 1.5, sh.rx));
    sh.ry = Math.max(8, Math.min(h * 1.5, sh.ry));
    sh.cx = Math.max(-sh.rx, Math.min(w + sh.rx, sh.cx));
    sh.cy = Math.max(-sh.ry, Math.min(h + sh.ry, sh.cy));
  }

  /** Replace everything outside the ring, matching the automatic pass. */
  async function applyCut() {
    const bmp = cutter.bitmap;
    const sh = cutter.shape;
    if (!bmp || !sh) return;

    const w = bmp.width, h = bmp.height;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);

    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;

    const mask = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      const dx = ((p % w) - sh.cx) / sh.rx;
      const dy = (((p / w) | 0) - sh.cy) / sh.ry;
      if (dx * dx + dy * dy > 1) mask[p] = 1;
    }

    const key = keyColour(data, mask, w, h);
    const hsl = rgbToHsl(key[0], key[1], key[2]);
    const back = hslToRgb(hsl[0], Math.min(0.62, Math.max(0.38, hsl[1])), 0.12);

    const FEATHER = BACKDROP.featherPx;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      if (mask[p]) {
        data[i] = back[0]; data[i + 1] = back[1]; data[i + 2] = back[2];
        continue;
      }
      // soften the last couple of pixels inside the ring
      const dx = ((p % w) - sh.cx) / sh.rx;
      const dy = (((p / w) | 0) - sh.cy) / sh.ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      const inset = (1 - d) * Math.min(sh.rx, sh.ry);
      if (inset > FEATHER) continue;
      const k = (1 - inset / FEATHER) * 0.7;
      data[i] += (back[0] - data[i]) * k;
      data[i + 1] += (back[1] - data[i + 1]) * k;
      data[i + 2] += (back[2] - data[i + 2]) * k;
    }
    ctx.putImageData(img, 0, 0);

    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', QUALITY));
    state.pending[cutter.path] = blob;
    setPreview(cutter.path, await thumbUrl(cv));
    state.dirty = true;

    // It has been dealt with, so drop the flag.
    if (editing) editing.flagged = false;

    closeCutter();
    renderEditor();
    render();
    window.KK.toast('Cut applied — press Save changes to write it');
  }

  function bindCutter() {
    const stage = $('[data-cutter-stage]');
    const ring = $('[data-cutter-ring]');

    const pointFromEvent = (e) => {
      const img = $('[data-cutter-img]');
      const r = img.getBoundingClientRect();
      return { x: (e.clientX - r.left) / cutter.scale, y: (e.clientY - r.top) / cutter.scale };
    };

    ring.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('[data-cutter-h]');
      const at = pointFromEvent(e);
      cutter.drag = {
        mode: handle ? handle.dataset.cutterH : 'move',
        startX: at.x, startY: at.y,
        cx: cutter.shape.cx, cy: cutter.shape.cy,
        rx: cutter.shape.rx, ry: cutter.shape.ry,
      };
      ring.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    ring.addEventListener('pointermove', (e) => {
      if (!cutter.drag) return;
      const at = pointFromEvent(e);
      const d = cutter.drag;
      if (d.mode === 'move') {
        cutter.shape.cx = d.cx + (at.x - d.startX);
        cutter.shape.cy = d.cy + (at.y - d.startY);
      } else if (d.mode === 'x' || d.mode === 'w') {
        // Either side drives the width, measured from the centre, so it
        // stays put while the oval widens or narrows.
        cutter.shape.rx = Math.abs(at.x - cutter.shape.cx);
      } else {   // 'y' or 'n'
        cutter.shape.ry = Math.abs(at.y - cutter.shape.cy);
      }
      clampShape();
      drawRing();
    });

    const endDrag = (e) => {
      if (!cutter.drag) return;
      cutter.drag = null;
      try { ring.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
    };
    ring.addEventListener('pointerup', endDrag);
    ring.addEventListener('pointercancel', endDrag);

    // Wheel grows or shrinks both radii together.
    stage.addEventListener('wheel', (e) => {
      if (!cutter.shape) return;
      e.preventDefault();
      const k = e.deltaY < 0 ? 1.05 : 0.952;
      cutter.shape.rx *= k;
      cutter.shape.ry *= k;
      clampShape();
      drawRing();
    }, { passive: false });

    $('[data-cutter-apply]').addEventListener('click', applyCut);
    $('[data-cutter-cancel]').addEventListener('click', closeCutter);
    $('[data-cutter-round]').addEventListener('click', () => {
      const r = (cutter.shape.rx + cutter.shape.ry) / 2;
      cutter.shape.rx = r; cutter.shape.ry = r;
      drawRing();
    });
    $('[data-cutter-auto]').addEventListener('click', async () => {
      if (!cutter.bitmap) return;
      const cv = document.createElement('canvas');
      cv.width = cutter.bitmap.width; cv.height = cutter.bitmap.height;
      const c2 = cv.getContext('2d');
      c2.drawImage(cutter.bitmap, 0, 0);
      const d = c2.getImageData(0, 0, cv.width, cv.height).data;
      cutter.shape = guessDisc(d, cv.width, cv.height, edgeColour(d, cv.width, cv.height));
      drawRing();
    });

    window.addEventListener('resize', () => {
      if ($('[data-cutter]').classList.contains('is-open')) drawRing();
    });

    document.addEventListener('keydown', (e) => {
      if (!$('[data-cutter]').classList.contains('is-open')) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeCutter(); }
      if (e.key === 'Enter') { e.preventDefault(); applyCut(); }
      const step = e.shiftKey ? 10 : 2;
      if (e.key === 'ArrowLeft')  { cutter.shape.cx -= step; clampShape(); drawRing(); e.preventDefault(); }
      if (e.key === 'ArrowRight') { cutter.shape.cx += step; clampShape(); drawRing(); e.preventDefault(); }
      if (e.key === 'ArrowUp')    { cutter.shape.cy -= step; clampShape(); drawRing(); e.preventDefault(); }
      if (e.key === 'ArrowDown')  { cutter.shape.cy += step; clampShape(); drawRing(); e.preventDefault(); }

      // Resize from the keyboard too: [ ] for width, - = for both.
      const grow = e.shiftKey ? 12 : 4;
      if (e.key === '[') { cutter.shape.rx -= grow; clampShape(); drawRing(); e.preventDefault(); }
      if (e.key === ']') { cutter.shape.rx += grow; clampShape(); drawRing(); e.preventDefault(); }
      if (e.key === ';') { cutter.shape.ry -= grow; clampShape(); drawRing(); e.preventDefault(); }
      if (e.key === "'") { cutter.shape.ry += grow; clampShape(); drawRing(); e.preventDefault(); }
      if (e.key === '-' || e.key === '_') {
        cutter.shape.rx -= grow; cutter.shape.ry -= grow; clampShape(); drawRing(); e.preventDefault();
      }
      if (e.key === '=' || e.key === '+') {
        cutter.shape.rx += grow; cutter.shape.ry += grow; clampShape(); drawRing(); e.preventDefault();
      }
    }, true);
  }


