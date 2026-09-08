/* ==========================================================================
   KAALVOET KAOS MERCH — stock manager (admin, local only)

   Everything happens in the browser. With Chrome or Edge it writes photos and
   data/products.json straight into your project folder via the File System
   Access API. Everywhere else it falls back to downloads.
   ========================================================================== */

(function () {
  'use strict';

  const { $, $$, esc, money } = window.KK;

  const IMG_DIR = 'assets/img/products';
  const MAX_DIM = 1500;      // longest edge, px
  const QUALITY = 0.84;      // JPEG quality
  const THUMB_DIM = 240;     // preview thumbnails kept small on purpose

  /**
   * A small preview for the table and the editor tiles.
   *
   * Returns a blob: URL, not a data: URL. A base64 preview is ~6KB of text,
   * and with 64 of them the table markup carried 650KB of image data that the
   * browser re-parsed on every render -- a flag toggle blocked for 325ms.
   * A blob URL is about fifty characters.
   *
   * Encoding goes through toBlob rather than toDataURL because toDataURL is
   * synchronous: encoding 64 JPEGs that way froze the page for seconds at a
   * time while previews were being built.
   */
  const thumbUrls = [];

  function thumbCanvas(canvas) {
    const scale = Math.min(1, THUMB_DIM / Math.max(canvas.width, canvas.height));
    const t = document.createElement('canvas');
    t.width = Math.max(1, Math.round(canvas.width * scale));
    t.height = Math.max(1, Math.round(canvas.height * scale));
    const tc = t.getContext('2d');
    tc.imageSmoothingQuality = 'high';
    tc.drawImage(canvas, 0, 0, t.width, t.height);
    return t;
  }

  function thumbUrl(canvas) {
    return new Promise((resolve) => {
      thumbCanvas(canvas).toBlob((blob) => {
        if (!blob) { resolve(''); return; }
        const url = URL.createObjectURL(blob);
        thumbUrls.push(url);
        resolve(url);
      }, 'image/jpeg', 0.72);
    });
  }

  /** Replace a preview, releasing the one it supersedes. */
  function setPreview(path, url) {
    const old = state.previews[path];
    if (old && old.indexOf('blob:') === 0) {
      URL.revokeObjectURL(old);
      const i = thumbUrls.indexOf(old);
      if (i > -1) thumbUrls.splice(i, 1);
    }
    state.previews[path] = url;
  }

  const state = {
    products: [],
    tray: [],              // { id, file, name, dataUrl, blob, assigned }
    pending: {},           // path -> Blob, images waiting to be written
    previews: {},          // path -> dataUrl, so thumbnails work before saving
    rootHandle: null,
    selected: new Set(),
    filter: 'all',
    query: '',
    dirty: false,
  };

  const supportsFS = typeof window.showDirectoryPicker === 'function';
  // file:// pages have an opaque origin: the picker exists but always throws.
  const openedAsFile = location.protocol === 'file:';
  const secure = window.isSecureContext && !openedAsFile;

  /* ======================================================================
     Tiny ZIP writer (store, no compression — JPEGs are already compressed)
     ====================================================================== */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(d) {
    const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
    const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time: time, date: date };
  }

  async function makeZip(entries) {
    // entries: [{ path, blob }]
    const enc = new TextEncoder();
    const now = dosDateTime(new Date());
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = enc.encode(entry.path);
      const data = new Uint8Array(await entry.blob.arrayBuffer());
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);          // version needed
      lv.setUint16(6, 0, true);           // flags
      lv.setUint16(8, 0, true);           // method: store
      lv.setUint16(10, now.time, true);
      lv.setUint16(12, now.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      chunks.push(local, data);

      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, now.time, true);
      cv.setUint16(14, now.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + data.length;
    }

    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    return new Blob(chunks.concat(central, [end]), { type: 'application/zip' });
  }

  /* ======================================================================
     Image processing
     ====================================================================== */

  async function processImage(file) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      try { bitmap = await createImageBitmap(file); }
      catch (e2) { throw new Error('Could not read ' + file.name + ' — try saving it as JPG or PNG first.'); }
    }

    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    // Flat fill first so transparent PNGs do not turn black in JPEG.
    ctx.fillStyle = '#13161b';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close && bitmap.close();

    if (cleanBackdropOn()) replaceBackdrop(ctx, w, h);

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
    return { blob: blob, dataUrl: await thumbUrl(canvas), width: w, height: h };
  }

  /* ======================================================================
     Backdrop replacement

     The discs are shot on a flat grey sweep. This lifts the disc off it and
     drops in a dark tint taken from the disc's own strongest colour, which
     is what makes the grid look like a set rather than 64 grey squares.

     Approach: flood fill inward from the frame edge, so only backdrop that
     is actually connected to the border is replaced. A colour matching the
     backdrop *inside* the disc is untouched, because the fill cannot reach
     it. If the disc runs off the edge of the frame the fill would eat it,
     so anything that swallows too much of the picture is abandoned and the
     photo is left exactly as it was.
     ====================================================================== */

  const BACKDROP = {
    // The sweep is lit unevenly, so a single global threshold either leaves a
    // grey halo near the disc or eats into it. The fill walks the gradient
    // instead: a pixel joins the backdrop if it is close to the neighbour it
    // came from (localTol) and still broadly backdrop-ish (globalTol).
    localBase: 18,
    localSpread: 0.45,
    globalBase: 70,
    globalSpread: 2.2,
    globalMax: 150,

    // The guard that matters. Walking the gradient means that if the fill
    // ever slips through a soft rim it is then free to run across the disc,
    // because white-to-white steps are tiny. The disc is far brighter than
    // the sweep, so nothing appreciably brighter than the backdrop is ever
    // allowed in, no matter how smooth the path to it looked.
    lumCeiling: 40,
    lumCeilingSpread: 1.6,

    // The disc guard. Brightness alone cannot find the rim: the shadowed
    // underside of the disc blends continuously into the shadow it casts on
    // the sweep, so any threshold walks straight into it. Geometry can. The
    // disc is one convex blob near the middle, so we trace its outline as a
    // radius-per-angle hull and refuse to replace anything inside it.
    discBright: 55,      // above the backdrop, definitely disc
    hullBins: 720,       // angular resolution of the outline
    hullPad: 1.03,       // grow it slightly to cover the shadowed rim
    hullMaxBulge: 1.05,  // clamp spikes -- blobs stuck to the rim
    hullMinDent: 0.93,   // and dents, where the disc edge is dark
    hullMinArea: 0.03,   // ignore the guard if we cannot find a real disc

    // Leftover flares get swept up, but only if they are genuinely small.
    // Removing every island but the largest destroyed discs that a glare had
    // split in two.
    speckMax: 0.012,

    // The disc always sits in the middle of the frame, so backdrop in the
    // centre means the fill has breached. Abandon the photo rather than
    // return a half-erased disc.
    centreRadius: 0.17,
    centreTolerance: 0.02,

    featherPx: 2.5,     // soft band just inside the outline
    maxCover: 0.93,     // give up if the fill takes more than this
    minCover: 0.04,     // ...or if it found essentially nothing
    flatSpread: 5,      // already-processed photos have a perfectly flat edge
  };

  /** Perceived brightness, used throughout the backdrop pass. */
  function lum(r, g, b) { return r * 0.2126 + g * 0.7152 + b * 0.0722; }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
  }

  /** Average colour and unevenness of the frame's outer edge. */
  function edgeColour(data, w, h) {
    const px = [];
    const stepX = Math.max(1, Math.floor(w / 60));
    const stepY = Math.max(1, Math.floor(h / 60));
    const push = (x, y) => { const i = (y * w + x) * 4; px.push([data[i], data[i + 1], data[i + 2]]); };

    for (let x = 0; x < w; x += stepX) { push(x, 1); push(x, h - 2); }
    for (let y = 0; y < h; y += stepY) { push(1, y); push(w - 2, y); }

    const avg = px.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0])
      .map((n) => n / px.length);
    const spread = Math.sqrt(px.reduce((sum, v) =>
      sum + Math.pow(v[0] - avg[0], 2) + Math.pow(v[1] - avg[1], 2) + Math.pow(v[2] - avg[2], 2), 0) / px.length);

    return { r: avg[0], g: avg[1], b: avg[2], spread: spread };
  }

  /** The disc's most characteristic colour: the commonest saturated tone. */
  function keyColour(data, mask, w, h) {
    const bins = new Map();
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      if (mask[p]) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (!max) continue;
      const sat = (max - min) / max;
      const lum = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
      if (sat < 0.28 || lum < 0.10 || lum > 0.94) continue;   // skip white, grey, black
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bin = bins.get(key) || [0, 0, 0, 0];
      bin[0] += r; bin[1] += g; bin[2] += b; bin[3]++;
      bins.set(key, bin);
    }

    let best = null;
    bins.forEach((bin) => { if (!best || bin[3] > best[3]) best = bin; });

    // A plain white disc has no strong colour: fall back to the team plum.
    if (!best || best[3] < (w * h) * 0.0015) return [46, 19, 66];
    return [Math.round(best[0] / best[3]), Math.round(best[1] / best[3]), Math.round(best[2] / best[3])];
  }

  /**
   * Replace the connected backdrop with a dark tint of the disc's key colour.
   * Returns false and changes nothing if it does not look safe.
   */
  function replaceBackdrop(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    const bg = edgeColour(data, w, h);

    // A backdrop this even has already been replaced once. Doing it again
    // would sample the new backdrop as the "disc colour" and drift.
    if (bg.spread < BACKDROP.flatSpread) return false;

    const ceiling = lum(bg.r, bg.g, bg.b) +
      Math.max(BACKDROP.lumCeiling, bg.spread * BACKDROP.lumCeilingSpread);

    const localTol = BACKDROP.localBase + bg.spread * BACKDROP.localSpread;
    const localTol2 = localTol * localTol;
    const globalTol = Math.min(BACKDROP.globalMax, BACKDROP.globalBase + bg.spread * BACKDROP.globalSpread);
    const globalTol2 = globalTol * globalTol;
    const soft = globalTol * BACKDROP.feather;
    const soft2 = soft * soft;

    const mask = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    let discHull = null;

    const distGlobal2 = (i) => {
      const dr = data[i] - bg.r, dg = data[i + 1] - bg.g, db = data[i + 2] - bg.b;
      return dr * dr + dg * dg + db * db;
    };

    const distLocal2 = (i, j) => {
      const dr = data[i] - data[j], dg = data[i + 1] - data[j + 1], db = data[i + 2] - data[j + 2];
      return dr * dr + dg * dg + db * db;
    };

    // Seed only from the frame edge, and only where it really is backdrop.
    const tooBright = (i) => lum(data[i], data[i + 1], data[i + 2]) > ceiling;

    const seed = (p) => {
      const i = p * 4;
      if (mask[p] || tooBright(i) || distGlobal2(i) > globalTol2) return;
      mask[p] = 1;
      queue[tail++] = p;
    };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }

    // Grow along the gradient.
    const grow = (from, to) => {
      if (mask[to]) return;
      const i = to * 4;
      if (tooBright(i)) return;                       // never step onto the disc
      if (distGlobal2(i) > globalTol2) return;
      if (distLocal2(i, from * 4) > localTol2) return;
      mask[to] = 1;
      queue[tail++] = to;
    };

    while (head < tail) {
      const p = queue[head++];
      const x = p % w, y = (p / w) | 0;
      if (x > 0) grow(p, p - 1);
      if (x < w - 1) grow(p, p + 1);
      if (y > 0) grow(p, p - w);
      if (y < h - 1) grow(p, p + w);
    }

    let cover = tail / (w * h);
    if (cover > BACKDROP.maxCover || cover < BACKDROP.minCover) return false;

    // Pull the mask back out of the disc before anything is judged or drawn.
    (function protectTheDisc() {
      const bright = new Uint8Array(w * h);
      const cutoff = lum(bg.r, bg.g, bg.b) + BACKDROP.discBright;
      for (let p = 0, i = 0; p < w * h; p++, i += 4) {
        if (lum(data[i], data[i + 1], data[i + 2]) > cutoff) bright[p] = 1;
      }

      // Largest bright island = the disc face.
      const seen = new Uint8Array(w * h);
      const st = new Int32Array(w * h);
      let bestSize = 0, bestSeed = -1;
      for (let start = 0; start < w * h; start++) {
        if (!bright[start] || seen[start]) continue;
        let sp = 0, size = 0;
        st[sp++] = start; seen[start] = 1;
        while (sp) {
          const q = st[--sp]; size++;
          const x = q % w, y = (q / w) | 0;
          if (x > 0 && bright[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; st[sp++] = q - 1; }
          if (x < w - 1 && bright[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; st[sp++] = q + 1; }
          if (y > 0 && bright[q - w] && !seen[q - w]) { seen[q - w] = 1; st[sp++] = q - w; }
          if (y < h - 1 && bright[q + w] && !seen[q + w]) { seen[q + w] = 1; st[sp++] = q + w; }
        }
        if (size > bestSize) { bestSize = size; bestSeed = start; }
      }
      if (bestSeed < 0 || bestSize < w * h * BACKDROP.hullMinArea) return;

      // Walk it again to collect the island and its centroid.
      const island = new Uint8Array(w * h);
      seen.fill(0);
      let sp = 0, sx = 0, sy = 0, count = 0;
      st[sp++] = bestSeed; seen[bestSeed] = 1;
      while (sp) {
        const q = st[--sp];
        island[q] = 1;
        const x = q % w, y = (q / w) | 0;
        sx += x; sy += y; count++;
        if (x > 0 && bright[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; st[sp++] = q - 1; }
        if (x < w - 1 && bright[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; st[sp++] = q + 1; }
        if (y > 0 && bright[q - w] && !seen[q - w]) { seen[q - w] = 1; st[sp++] = q - w; }
        if (y < h - 1 && bright[q + w] && !seen[q + w]) { seen[q + w] = 1; st[sp++] = q + w; }
      }
      const cx = sx / count, cy = sy / count;

      // Outline: the furthest disc pixel at each angle.
      const BINS = BACKDROP.hullBins;
      const rad = new Float32Array(BINS);
      const TAU = Math.PI * 2;
      for (let p = 0; p < w * h; p++) {
        if (!island[p]) continue;
        const dx = (p % w) - cx, dy = ((p / w) | 0) - cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        let a = Math.atan2(dy, dx); if (a < 0) a += TAU;
        const bin = (a / TAU * BINS) | 0;
        if (r > rad[bin]) rad[bin] = r;
      }

      // A stray highlight can spike one bin, and a dark stamp reaching the
      // edge can leave one empty. Smooth with a small circular median.
      const smooth = new Float32Array(BINS);
      const win = [];
      for (let i = 0; i < BINS; i++) {
        win.length = 0;
        for (let k = -4; k <= 4; k++) win.push(rad[(i + k + BINS) % BINS]);
        win.sort((a, b) => a - b);
        smooth[i] = win[4];
      }

      // A disc is round. Anything bright stuck to its edge -- a crease in the
      // sweep, a reflection -- pushes those bins outward and would be
      // protected along with the disc, which is why grey blobs survived.
      // The median radius is the real disc, so spikes get clamped back to it.
      const sorted = Array.prototype.slice.call(smooth).sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1] || 0;
      if (median > 0) {
        const hi = median * BACKDROP.hullMaxBulge;
        const lo = median * BACKDROP.hullMinDent;
        for (let i = 0; i < BINS; i++) {
          smooth[i] = Math.max(lo, Math.min(hi, smooth[i]));
        }
      }

      // Geometry decides, not colour. Colour matching cannot tell white
      // plastic from a lit grey crease lying against it, and letting it
      // override the outline put the disc-eating back (8.5% loss when
      // tried). Outside the outline is backdrop; inside it is disc.
      for (let p = 0; p < w * h; p++) {
        const dx = (p % w) - cx, dy = ((p / w) | 0) - cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        let a = Math.atan2(dy, dx); if (a < 0) a += TAU;
        const edge = smooth[(a / TAU * BINS) | 0] * BACKDROP.hullPad;
        mask[p] = r > edge ? 1 : 0;
      }

      discHull = { cx: cx, cy: cy, rad: smooth, bins: BINS };
    })();

    // The disc owns the middle of the frame. If the fill reached it, it has
    // breached the rim and the result cannot be trusted.
    {
      const cx = w / 2, cy = h / 2;
      const rad = Math.min(w, h) * BACKDROP.centreRadius;
      let inside = 0, hit = 0;
      const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(w - 1, Math.ceil(cx + rad));
      const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(h - 1, Math.ceil(cy + rad));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy > rad * rad) continue;
          inside++;
          if (mask[y * w + x]) hit++;
        }
      }
      if (inside && hit / inside > BACKDROP.centreTolerance) return false;
    }

    // Small bright specks on the sweep -- a lamp flare, a crease -- are not
    // part of the disc. Only genuinely small islands are swept up: removing
    // every island but the largest destroyed discs a glare had split in two.
    (function sweepSpecks() {
      const seen = new Uint8Array(w * h);
      const stack = new Int32Array(w * h);
      const limit = w * h * BACKDROP.speckMax;

      for (let start = 0; start < w * h; start++) {
        if (mask[start] || seen[start]) continue;
        let sp = 0;
        stack[sp++] = start;
        seen[start] = 1;
        const members = [];
        let size = 0;

        // Always walk the whole island. Stopping early leaves the rest of it
        // unvisited, and the next scan picks those pixels up as fresh little
        // islands and erases them -- which drew stripes across the discs.
        while (sp) {
          const q = stack[--sp];
          size++;
          if (size <= limit) members.push(q);
          const x = q % w, y = (q / w) | 0;
          if (x > 0 && !mask[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack[sp++] = q - 1; }
          if (x < w - 1 && !mask[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack[sp++] = q + 1; }
          if (y > 0 && !mask[q - w] && !seen[q - w]) { seen[q - w] = 1; stack[sp++] = q - w; }
          if (y < h - 1 && !mask[q + w] && !seen[q + w]) { seen[q + w] = 1; stack[sp++] = q + w; }
        }

        // Anything sizeable is disc, and stays. Only specks get swept.
        if (size > limit) continue;
        for (let m = 0; m < members.length; m++) mask[members[m]] = 1;
      }
    })();

    // Recount after the guard pulled the mask out of the disc.
    let kept = 0;
    for (let p = 0; p < w * h; p++) if (mask[p]) kept++;
    cover = kept / (w * h);
    if (cover < BACKDROP.minCover) return false;

    const key = keyColour(data, mask, w, h);
    const hsl = rgbToHsl(key[0], key[1], key[2]);
    // Keep the hue, force it dark and richly tinted so the disc pops.
    const back = hslToRgb(hsl[0], Math.min(0.62, Math.max(0.38, hsl[1])), 0.12);

    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      if (mask[p]) {
        data[i] = back[0]; data[i + 1] = back[1]; data[i + 2] = back[2];
        continue;
      }
      // Feather the last couple of pixels inside the outline so the disc
      // does not read as a hard cut-out.
      if (!discHull) continue;
      const x = p % w, y = (p / w) | 0;
      const dx = x - discHull.cx, dy = y - discHull.cy;
      let a = Math.atan2(dy, dx); if (a < 0) a += Math.PI * 2;
      const edge = discHull.rad[(a / (Math.PI * 2) * discHull.bins) | 0] * BACKDROP.hullPad;
      const inset = edge - Math.sqrt(dx * dx + dy * dy);
      if (inset < 0 || inset > BACKDROP.featherPx) continue;
      const k = (1 - inset / BACKDROP.featherPx) * 0.7;
      data[i] += (back[0] - data[i]) * k;
      data[i + 1] += (back[1] - data[i + 1]) * k;
      data[i + 2] += (back[2] - data[i + 2]) * k;
    }

    ctx.putImageData(img, 0, 0);
    return true;
  }

  /* ======================================================================
     File system access
     ====================================================================== */

  /** Put a plain-language reason on screen instead of a vague toast. */
  function connectProblem(title, detail) {
    const box = $('[data-unsupported]');
    box.hidden = false;
    box.querySelector('.panel__title').textContent = title;
    box.querySelector('.panel__note').innerHTML = detail;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.KK.toast(title, 'bad');
  }

  async function connectFolder() {
    if (openedAsFile) {
      connectProblem(
        'Open this page through a local server, not straight off disk',
        'The address bar says <code style="color:var(--gold)">file:///…</code>. Browsers give ' +
        'file:// pages no origin, so they are not allowed to touch your folders — and the shop data ' +
        'will not load either.<br><br>Open a terminal in the project folder and run:<br>' +
        '<code style="color:var(--gold);display:inline-block;margin:8px 0">python -m http.server 8000</code>' +
        '<br>then use <a href="http://localhost:8000/manage.html" style="color:var(--gold)">' +
        'http://localhost:8000/manage.html</a>.'
      );
      return;
    }

    if (!secure) {
      connectProblem(
        'This page needs a secure connection',
        'Folder access only works on <code style="color:var(--gold)">https://</code> or ' +
        '<code style="color:var(--gold)">localhost</code>. You are on ' +
        '<code style="color:var(--gold)">' + esc(location.origin) + '</code>. Use ' +
        '<code style="color:var(--gold)">http://localhost:8000/manage.html</code> instead of a ' +
        'machine name or IP address.'
      );
      return;
    }

    if (!supportsFS) {
      connectProblem(
        'This browser cannot write files directly',
        'Direct folder saving needs Chrome or Edge on desktop. Firefox and Safari do not support it. ' +
        'Everything else here still works — use <strong>Download products.json</strong> and ' +
        '<strong>Download photos .zip</strong>, then unzip those over the project folder by hand.'
      );
      return;
    }

    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        connectProblem(
          'Write permission was declined',
          'The browser asked to edit files in that folder and the answer was no. Click ' +
          '<strong>Connect project folder</strong> again and choose <em>Edit files</em> ' +
          '(or <em>Save changes</em>) when Chrome or Edge asks.'
        );
        return;
      }

      // Sanity check: does this look like the shop project?
      let looksRight = true;
      try { await handle.getDirectoryHandle('data'); }
      catch (e) { looksRight = false; }

      if (!looksRight) {
        const go = confirm(
          'That folder has no "data" sub-folder, so it may not be the shop project.\n\n' +
          'Pick the folder containing index.html. Continue anyway?'
        );
        if (!go) return;
      }

      state.rootHandle = handle;
      updateFsStatus(handle.name);
      window.KK.toast('Connected to ' + handle.name);

      await loadFromFolder();
      $('[data-unsupported]').hidden = true;
    } catch (e) {
      if (e.name === 'AbortError') return;          // they just closed the picker

      console.error('[KK] folder connect failed:', e);

      if (e.name === 'SecurityError') {
        connectProblem(
          'The browser blocked access to that folder',
          'This usually means the page was not opened from ' +
          '<code style="color:var(--gold)">http://localhost</code>, or the folder is one the browser ' +
          'protects (Desktop, Downloads, Documents root, OneDrive, or a system folder). Try again and ' +
          'pick the <code style="color:var(--gold)">Kaalvoet_shop</code> folder itself.'
        );
      } else if (e.name === 'NotAllowedError') {
        connectProblem(
          'Permission was not granted',
          'Chrome and Edge only allow this straight after a click. Press ' +
          '<strong>Connect project folder</strong> and choose the folder without switching away ' +
          'from the window in between.'
        );
      } else {
        connectProblem(
          'Could not open that folder',
          'The browser reported: <code style="color:var(--gold)">' + esc(e.name + ' — ' + e.message) +
          '</code><br><br>You can still work here and use <strong>Download products.json</strong> ' +
          'and <strong>Download photos .zip</strong> instead.'
        );
      }
    }
  }

  function updateFsStatus(name) {
    const box = $('[data-fs-status]');
    box.classList.toggle('is-live', !!name);
    $('[data-fs-label]').textContent = name ? 'Writing to /' + name : 'Not connected';
  }

  async function dirFor(path, create) {
    let dir = state.rootHandle;
    for (const part of path.split('/')) {
      dir = await dir.getDirectoryHandle(part, { create: !!create });
    }
    return dir;
  }

  async function writeFile(path, blob) {
    const parts = path.split('/');
    const filename = parts.pop();
    const dir = parts.length ? await dirFor(parts.join('/'), true) : state.rootHandle;
    const handle = await dir.getFileHandle(filename, { create: true });
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
  }

  async function loadFromFolder() {
    try {
      const dir = await dirFor('data');
      const handle = await dir.getFileHandle('products.json');
      const text = await (await handle.getFile()).text();
      const data = JSON.parse(text);
      state.products = Array.isArray(data) ? data : data.products || [];
      normalise();
      render();
      warmThumbnails();
      window.KK.toast('Loaded ' + state.products.length + ' products from the folder');
    } catch (e) {
      window.KK.toast('Could not read data/products.json from that folder', 'bad');
    }
  }

  /* ======================================================================
     Catalogue
     ====================================================================== */

  function normalise() {
    state.products.forEach((p) => {
      p.images = p.images || [];
      p.tags = p.tags || [];
      p.price = Number(p.price) || 0;
      p.stock = p.stock == null ? 1 : Number(p.stock);
      p.flagged = !!p.flagged;
    });
    window.KK.catalogue = state.products;
  }

  async function loadCatalogue() {
    try {
      const res = await fetch(window.KK.CFG.shop.productsUrl + '?t=' + Date.now(), { cache: 'no-store' });
      state.products = (await res.json()).products || [];
      normalise();
      render();
      warmThumbnails();
    } catch (e) {
      window.KK.toast(
        openedAsFile
          ? 'Opened from disk — run a local server first (see the note above)'
          : 'Could not load products.json — connect your folder instead',
        'bad'
      );
      state.products = [];
      render();
    }
  }

  function tiers() {
    return (window.KK.CFG.shop.tiers || []).slice();
  }

  /** Remembered per-tier prices, so the boxes keep their values. */
  const tierPrices = {};

  function renderTiers() {
    const host = $('[data-tier-rows]');
    if (!host) return;

    const list = tiers();
    const counts = {};
    let untiered = 0;
    state.products.forEach((p) => {
      if (p.category !== 'discs') return;
      if (p.tier) counts[p.tier] = (counts[p.tier] || 0) + 1;
      else untiered++;
    });

    host.innerHTML = list.map((t) => {
      const n = counts[t] || 0;
      return '<div class="panel" style="padding:14px;background:var(--ink-3)">' +
        '<div class="row-between" style="margin-bottom:9px">' +
          '<strong style="font-size:13.5px">' + esc(t) + '</strong>' +
          '<span style="font-size:11.5px;color:var(--muted-2)">' + n + ' disc' + (n === 1 ? '' : 's') + '</span>' +
        '</div>' +
        '<div class="row" style="gap:8px">' +
          '<input class="cell-input" type="number" min="0" step="10" style="flex:1" ' +
            'data-tier-price="' + esc(t) + '" value="' + (tierPrices[t] == null ? '' : tierPrices[t]) + '" placeholder="R">' +
          '<button class="btn btn--ghost btn--sm" data-tier-set="' + esc(t) + '" type="button"' +
            (n ? '' : ' disabled') + '>Apply</button>' +
        '</div>' +
      '</div>';
    }).join('') +
    (untiered
      ? '<div class="panel" style="padding:14px;background:var(--ink-3);border-color:rgba(251,170,24,.35)">' +
        '<strong style="font-size:13.5px;display:block;margin-bottom:6px">No group yet</strong>' +
        '<span style="font-size:11.5px;color:var(--muted-2)">' + untiered + ' disc' + (untiered === 1 ? '' : 's') +
        ' still ungrouped</span></div>'
      : '');
  }

  function applyTierPrice(tier) {
    const input = $('[data-tier-price="' + tier.replace(/"/g, '\\"') + '"]');
    const value = Number(input && input.value);
    if (!input || !input.value.trim() || isNaN(value)) {
      window.KK.toast('Type a price for ' + tier + ' first', 'bad');
      return 0;
    }
    tierPrices[tier] = value;

    let n = 0;
    state.products.forEach((p) => {
      if (p.tier === tier) { p.price = value; n++; }
    });
    if (n) state.dirty = true;
    return n;
  }

  function nextSku(prefix) {
    let max = 0;
    state.products.forEach((p) => {
      const m = new RegExp('^' + prefix + '(\\d+)$').exec(p.sku || '');
      if (m) max = Math.max(max, Number(m[1]));
    });
    return prefix + String(max + 1).padStart(2, '0');
  }

  function serialise() {
    return JSON.stringify({
      // Full timestamp, not just the date: this doubles as the cache-busting
      // token for photo URLs, so saving twice in a day must change it.
      updated: new Date().toISOString(),
      currency: window.KK.CFG.shop.currency,
      products: state.products,
    }, null, 2) + '\n';
  }

  function cleanBackdropOn() {
    const box = $('[data-clean-bg]');
    return !box || box.checked;
  }

  /** Re-do the backdrop on photos that are already in the catalogue. */
  async function cleanExistingBackdrops() {
    const jobs = [];
    state.products.forEach((p) => (p.images || []).forEach((path) => jobs.push({ p: p, path: path })));
    if (!jobs.length) { window.KK.toast('No photos to work on yet', 'info'); return; }
    if (!confirm(
      'Redo the backdrop on all ' + jobs.length + ' photo(s)?\n\n' +
      'Each one gets the grey swept out and replaced with a dark tint of its own ' +
      'strongest colour. Nothing is written until you press Save changes.'
    )) return;

    const bar = $('[data-photo-bar]');
    const label = $('[data-photo-progress-label]');
    $('[data-photo-progress]').hidden = false;

    let done = 0, changed = 0, skipped = 0;
    for (const job of jobs) {
      label.textContent = 'Backdrop ' + (done + 1) + ' of ' + jobs.length + ' — ' + job.path.split('/').pop();
      try {
        const bmp = await sourceBitmap(job.path);
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        bmp.close && bmp.close();

        if (replaceBackdrop(ctx, canvas.width, canvas.height)) {
          const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
          state.pending[job.path] = blob;
          setPreview(job.path, await thumbUrl(canvas));
          changed++;
        } else {
          // Could not separate it safely -- flag it so it can be cut by hand.
          job.p.flagged = true;
          state.dirty = true;
          skipped++;
        }
      } catch (e) {
        job.p.flagged = true;
        state.dirty = true;
        skipped++;
        console.warn('[KK] backdrop failed for', job.path, e);
      }
      done++;
      bar.style.width = ((done / jobs.length) * 100).toFixed(1) + '%';
    }

    if (changed) state.dirty = true;
    label.textContent = changed + ' redone' +
      (skipped ? ', ' + skipped + ' flagged for cutting by hand' : '') +
      ' — press Save changes to write them';
    setTimeout(() => { $('[data-photo-progress]').hidden = true; bar.style.width = '0%'; }, 3200);
    render();
    window.KK.toast(changed + ' backdrop(s) redone' + (skipped ? ', ' + skipped + ' skipped' : ''),
      changed ? '' : 'bad');
  }

  /**
   * Build small previews for photos that are already on disk.
   *
   * Without this, every table row and editor tile points straight at the
   * 1500px file, so each re-render decodes 64 full-size JPEGs to paint
   * 52px squares. Decoding them once at 240px and caching costs a couple
   * of seconds on load and makes everything afterwards cheap.
   */
  async function warmThumbnails() {
    const jobs = [];
    state.products.forEach((p) => (p.images || []).forEach((path) => {
      if (!state.previews[path] && !state.pending[path]) jobs.push(path);
    }));
    if (!jobs.length) return;

    // Deliberately one at a time, with a yield between each. Running three
    // in parallel and encoding with toDataURL blocked the main thread for
    // 6s in total, in freezes of up to 2.8s, which is what made the editor
    // unusable while it loaded.
    let done = 0;
    const idle = window.requestIdleCallback
      ? (fn) => window.requestIdleCallback(fn, { timeout: 250 })
      : (fn) => setTimeout(fn, 0);

    for (const path of jobs) {
      try {
        const res = await fetch(path);
        if (!res.ok) throw new Error(res.status);
        // resizeWidth decodes straight to thumbnail size, off the main thread
        const bmp = await createImageBitmap(await res.blob(), {
          resizeWidth: THUMB_DIM, resizeQuality: 'medium',
        });
        const cv = document.createElement('canvas');
        cv.width = bmp.width; cv.height = bmp.height;
        cv.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close && bmp.close();
        setPreview(path, await thumbUrl(cv));
        refreshThumb(path);
      } catch (e) {
        /* leave it pointing at the file; it still displays */
      }
      done++;
      await new Promise((r) => idle(r));      // hand the thread back
    }
  }

  /** Point existing <img> tags at a new preview, without a re-render. */
  function refreshThumb(path) {
    const product = state.products.find((p) => (p.images || []).indexOf(path) === 0);
    if (!product) return;
    const row = document.querySelector('[data-row="' + cssEscape(product.id) + '"]');
    if (!row) return;
    const img = row.querySelector('.admin-thumb img');
    if (img) img.src = state.previews[path] || path;
  }

  function cssEscape(v) {
    return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&');
  }

  /* ======================================================================
     Photo tray
     ====================================================================== */

  async function ingest(files) {
    const list = Array.prototype.slice.call(files).filter((f) => f.type.indexOf('image/') === 0 || /\.(heic|heif)$/i.test(f.name));
    if (!list.length) { window.KK.toast('No images in that drop', 'bad'); return; }

    const bar = $('[data-photo-bar]');
    const label = $('[data-photo-progress-label]');
    $('[data-photo-progress]').hidden = false;

    let done = 0;
    let failed = 0;

    for (const file of list) {
      label.textContent = 'Processing ' + (done + 1) + ' of ' + list.length + ' — ' + file.name;
      try {
        const out = await processImage(file);
        state.tray.push({
          id: 'photo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          name: file.name,
          blob: out.blob,
          dataUrl: out.dataUrl,
          assigned: false,
        });
      } catch (e) {
        failed++;
        console.warn(e);
      }
      done++;
      bar.style.width = ((done / list.length) * 100).toFixed(1) + '%';
    }

    label.textContent = 'Done — ' + (list.length - failed) + ' ready' + (failed ? ', ' + failed + ' could not be read' : '');
    setTimeout(() => { $('[data-photo-progress]').hidden = true; bar.style.width = '0%'; }, 2200);

    if (failed) window.KK.toast(failed + ' photo(s) could not be read (HEIC often needs converting to JPG)', 'bad');
    renderTray();
  }

  function attach(photo, product) {
    const index = product.images.length + 1;
    const path = IMG_DIR + '/' + product.sku + '-' + index + '.jpg';

    state.pending[path] = photo.blob;
    state.previews[path] = photo.dataUrl;
    product.images.push(path);

    photo.assigned = true;
    state.dirty = true;
  }

  function autoMatch() {
    let n = 0;
    state.tray.filter((p) => !p.assigned).forEach((photo) => {
      const base = photo.name.replace(/\.[^.]+$/, '').toUpperCase();
      const hit = state.products.find((p) => p.sku && base.indexOf(p.sku.toUpperCase()) > -1);
      if (hit) { attach(photo, hit); n++; }
    });
    cleanTray();
    render();
    window.KK.toast(n ? n + ' photo(s) matched by filename' : 'No filenames matched a SKU', n ? '' : 'info');
  }

  function fillInOrder() {
    const waiting = state.tray.filter((p) => !p.assigned);
    const targets = state.products.filter((p) => p.category === 'discs' && !p.images.length);
    let n = 0;
    waiting.forEach((photo, i) => {
      if (!targets[i]) return;
      attach(photo, targets[i]);
      n++;
    });
    cleanTray();
    render();
    window.KK.toast(n ? n + ' photo(s) attached to discs without photos' : 'Every disc already has a photo', n ? '' : 'info');
  }

  function createFromPhotos() {
    const waiting = state.tray.filter((p) => !p.assigned);
    if (!waiting.length) return;

    waiting.forEach((photo) => {
      const sku = nextSku('KK-D');
      const product = {
        id: sku.toLowerCase(),
        sku: sku,
        name: photo.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || ('Disc ' + sku),
        category: 'discs',
        subcategory: 'Ultra-Star',
        brand: 'Discraft',
        price: 0,
        compareAt: null,
        stock: 1,
        unique: true,
        colors: ['#f57e25', '#2e1342'],
        colorName: '',
        weight: '175 g',
        condition: 'Brand new',
        stamp: '',
        tags: ['ultimate'],
        description: '',
        images: [],
      };
      state.products.push(product);
      attach(photo, product);
    });

    cleanTray();
    normalise();
    render();
    window.KK.toast(waiting.length + ' product(s) created — set their prices below', 'info');
  }

  function cleanTray() {
    state.tray = state.tray.filter((p) => !p.assigned);
    renderTray();
  }

  function renderTray() {
    const waiting = state.tray.filter((p) => !p.assigned);
    $('[data-tray-block]').hidden = !waiting.length;
    $('[data-tray-count]').textContent = waiting.length;

    $('[data-tray]').innerHTML = waiting.map((p) =>
      '<div class="photo-tile" draggable="true" data-photo="' + esc(p.id) + '" title="' + esc(p.name) + '">' +
        '<img src="' + esc(p.dataUrl) + '" alt="">' +
        '<button class="photo-tile__x" data-photo-remove="' + esc(p.id) + '" type="button" aria-label="Discard">&times;</button>' +
        '<span class="photo-tile__label">' + esc(p.name) + '</span>' +
      '</div>'
    ).join('');
  }

  /* ======================================================================
     Table
     ====================================================================== */

  function thumbSrc(p) {
    const first = p.images && p.images[0];
    if (first) return state.previews[first] || first;
    return window.KK.discArt(p);
  }

  function filtered() {
    let list = state.products.slice();
    if (state.filter === 'nophoto') list = list.filter((p) => !p.images.length);
    else if (state.filter === 'sold') list = list.filter((p) => p.stock <= 0);
    else if (state.filter === 'untiered') list = list.filter((p) => p.category === 'discs' && !p.tier);
    else if (state.filter === 'flagged') list = list.filter((p) => p.flagged);
    else if (state.filter !== 'all') list = list.filter((p) => p.category === state.filter);

    if (state.query) {
      const q = state.query.toLowerCase();
      list = list.filter((p) => (p.name + ' ' + p.sku + ' ' + p.subcategory + ' ' + p.brand).toLowerCase().indexOf(q) > -1);
    }
    return list;
  }

  /** One row's markup. Shared by a full render and a single-row refresh. */
  function rowHtml(p) {
    return ROW_TEMPLATE(p);
  }

  /** Repaint a single row in place. Used for flags and other one-off edits. */
  function updateRow(id) {
    const p = state.products.find((x) => x.id === id);
    const row = document.querySelector('[data-row="' + cssEscape(id) + '"]');
    if (!p || !row) { render(); return; }
    row.outerHTML = rowHtml(p);
    updateCounts();
  }

  function updateCounts() {
    const noPhoto = state.products.filter((p) => !p.images.length).length;
    const noPrice = state.products.filter((p) => !p.price).length;
    const flagged = state.products.filter((p) => p.flagged).length;
    $('[data-counts]').innerHTML =
      '<span class="admin-status__dot" style="background:' +
        (noPhoto || noPrice ? 'var(--warn)' : 'var(--ok)') + '"></span>' +
      state.products.length + ' products' +
      (noPhoto ? ' · ' + noPhoto + ' without photos' : '') +
      (noPrice ? ' · ' + noPrice + ' without a price' : '') +
      (flagged ? ' · ' + flagged + ' flagged to fix' : '');
    $('[data-export-zip]').hidden = Object.keys(state.pending).length === 0;
    $('[data-save]').textContent =
      state.dirty || Object.keys(state.pending).length ? 'Save changes •' : 'Save changes';
  }

  function render() {
    const list = filtered();

    // Rebuilding the table drops the scroll position, which made deleting a
    // row throw you back to the top of a 64-row list every time.
    const scroller = $('[data-table-scroll]');
    const keepTop = scroller ? scroller.scrollTop : 0;
    const keepPage = window.scrollY;

    $('[data-admin-rows]').innerHTML = list.map(rowHtml).join('');
    renderTiers();

    if (scroller) scroller.scrollTop = keepTop;
    if (window.scrollY !== keepPage) window.scrollTo({ top: keepPage, behavior: 'instant' });

    $('[data-bulk-bar]').hidden = state.selected.size === 0;
    $('[data-sel-count]').textContent = state.selected.size;
    updateCounts();
  }

  const ROW_TEMPLATE = (p) => (
      '<tr data-row="' + esc(p.id) + '"' + (p.flagged ? ' class="is-flagged"' : '') + '>' +
        '<td><input type="checkbox" data-sel="' + esc(p.id) + '"' + (state.selected.has(p.id) ? ' checked' : '') + '></td>' +
        '<td>' +
          '<div class="admin-thumb" data-images="' + esc(p.id) + '" data-drop-target="' + esc(p.id) + '" ' +
            'title="Click to edit, or use the magnifier to view full size">' +
            '<img src="' + esc(thumbSrc(p)) + '" alt="" width="52" height="52" loading="lazy" decoding="async">' +
            (p.images.length > 1 ? '<span class="admin-count-pill">' + p.images.length + '</span>' : '') +
          '</div>' +
        '</td>' +
        '<td><input class="cell-input" value="' + esc(p.name) + '" data-edit="name" data-id="' + esc(p.id) + '"></td>' +
        '<td><input class="cell-input" value="' + esc(p.sku) + '" data-edit="sku" data-id="' + esc(p.id) + '" style="font-family:var(--font-mono);font-size:12px"></td>' +
        '<td>' +
          '<select class="cell-input" data-edit="category" data-id="' + esc(p.id) + '">' +
            ['discs', 'apparel', 'accessories'].map((c) =>
              '<option value="' + c + '"' + (p.category === c ? ' selected' : '') + '>' + c + '</option>').join('') +
          '</select>' +
        '</td>' +
        '<td><input class="cell-input" value="' + esc(p.subcategory || '') + '" data-edit="subcategory" data-id="' + esc(p.id) + '"></td>' +
        '<td><input class="cell-input" type="number" min="0" step="10" value="' + p.price + '" data-edit="price" data-id="' + esc(p.id) + '"' +
          (p.price === 0 ? ' style="border-color:var(--warn)"' : '') + '></td>' +
        '<td><input class="cell-input" type="number" min="0" step="1" value="' + p.stock + '" data-edit="stock" data-id="' + esc(p.id) + '"></td>' +
        '<td><input class="cell-input" value="' + esc(p.condition || '') + '" data-edit="condition" data-id="' + esc(p.id) + '"></td>' +
        '<td>' +
          '<select class="cell-input" data-edit="tier" data-id="' + esc(p.id) + '">' +
            '<option value="">—</option>' +
            tiers().map((t) =>
              '<option value="' + esc(t) + '"' + (p.tier === t ? ' selected' : '') + '>' + esc(t) + '</option>'
            ).join('') +
          '</select>' +
        '</td>' +
        '<td>' +
          '<button class="flag-btn' + (p.flagged ? ' is-on' : '') + '" data-flag="' + esc(p.id) + '" ' +
            'type="button" title="' + (p.flagged ? 'Flagged - needs fixing by hand' : 'Flag this one for fixing') + '" ' +
            'aria-pressed="' + (p.flagged ? 'true' : 'false') + '">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="' + (p.flagged ? 'currentColor' : 'none') +
              '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></svg>' +
          '</button>' +
        '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="icon-btn" data-editrow="' + esc(p.id) + '" type="button" title="Edit details" aria-label="Edit ' + esc(p.name) + '">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>' +
          '</button>' +
          '<button class="icon-btn" data-delete="' + esc(p.id) + '" type="button" title="Delete" aria-label="Delete ' + esc(p.name) + '">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>' +
          '</button>' +
        '</td>' +
      '</tr>'
  );

  /* ======================================================================
     Product editor modal — photos plus every text field
     ====================================================================== */

  let editing = null;

  function openEditor(id) {
    editing = state.products.find((p) => p.id === id);
    if (!editing) return;
    renderEditor();
    $('[data-img-modal]').classList.add('is-open');
    $('[data-img-modal]').setAttribute('aria-hidden', 'false');
    $('[data-scrim]').classList.add('is-open');
    document.body.classList.add('is-locked');
  }

  function closeEditor() {
    $('[data-img-modal]').classList.remove('is-open');
    $('[data-img-modal]').setAttribute('aria-hidden', 'true');
    $('[data-scrim]').classList.remove('is-open');
    document.body.classList.remove('is-locked');
    editing = null;
    render();
  }

  function field(label, key, value, opts) {
    opts = opts || {};
    const id = 'f-' + key;
    let control;

    if (opts.textarea) {
      control = '<textarea class="input" id="' + id + '" data-edit-field="' + key + '" rows="' +
        (opts.rows || 4) + '" placeholder="' + esc(opts.placeholder || '') + '">' + esc(value || '') + '</textarea>';
    } else if (opts.options) {
      control = '<select class="select-full" id="' + id + '" data-edit-field="' + key + '">' +
        opts.options.map((o) =>
          '<option value="' + esc(o) + '"' + (String(value) === String(o) ? ' selected' : '') + '>' + esc(o) + '</option>'
        ).join('') + '</select>';
    } else if (opts.color) {
      control = '<input class="input" type="color" id="' + id + '" data-edit-field="' + key +
        '" value="' + esc(value || '#ff4d2e') + '" style="height:42px;padding:5px">';
    } else {
      control = '<input class="input" id="' + id + '" data-edit-field="' + key + '"' +
        (opts.number ? ' type="number" min="0" step="' + (opts.step || 1) + '"' : '') +
        ' value="' + esc(value == null ? '' : value) + '"' +
        ' placeholder="' + esc(opts.placeholder || '') + '">';
    }

    return '<div class="field">' +
      '<label class="field__label" for="' + id + '">' + esc(label) + '</label>' + control +
      (opts.hint ? '<span class="field__hint">' + esc(opts.hint) + '</span>' : '') +
      '</div>';
  }

  function renderEditor() {
    const p = editing;
    if (!p) return;

    const tool = (i, op, label, icon) =>
      '<button class="photo-tool" data-img-op="' + op + '" data-img-i="' + i + '" type="button" title="' +
      label + '" aria-label="' + label + '">' + icon + '</button>';

    const ROT_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h11a5 5 0 0 1 0 10h-3"/><path d="M6 5L3 8l3 3"/></svg>';
    const ROT_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8H10a5 5 0 0 0 0 10h3"/><path d="M18 5l3 3-3 3"/></svg>';
    const FLIP  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M8 7L3 12l5 5z"/><path d="M16 7l5 5-5 5z"/></svg>';

    const photos = p.images.length
      ? '<div class="photo-tray">' + p.images.map((src, i) =>
          '<div class="photo-tile" style="cursor:default">' +
            '<img class="zoomable" src="' + esc(state.previews[src] || src) + '" alt="" ' +
              'data-img-zoom="' + i + '" title="Click to see it full size" loading="lazy" decoding="async">' +
            '<button class="photo-tile__x" data-img-del="' + i + '" type="button" aria-label="Remove">&times;</button>' +
            '<span class="photo-tools">' +
              tool(i, 'rot-l', 'Rotate left', ROT_L) +
              tool(i, 'rot-r', 'Rotate right', ROT_R) +
              tool(i, 'flip', 'Flip', FLIP) +
            '</span>' +
            '<span class="photo-tile__label">' + (i === 0 ? 'Main photo' : 'Photo ' + (i + 1)) +
              (i > 0 ? ' · <button data-img-main="' + i + '" type="button" style="color:var(--gold);text-decoration:underline">make main</button>' : '') +
            '</span>' +
          '</div>').join('') + '</div>'
      : '<p style="color:var(--muted);font-size:13.5px;margin:0">No photos yet — add some below, or drag one ' +
        'onto this product\'s thumbnail in the table.</p>';

    $('[data-img-panel]').innerHTML =
      '<button class="modal__close" data-img-close type="button" aria-label="Close">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      '</button>' +
      '<div class="modal__content" style="gap:20px">' +

        '<div>' +
          '<h2 class="modal__title" style="font-size:25px">' + esc(p.name || 'Untitled') + '</h2>' +
          '<p style="font-size:12.5px;color:var(--muted-2);margin:5px 0 0">' + esc(p.sku) +
            ' · changes save when you press Save changes in the toolbar</p>' +
        '</div>' +

        /* ---- photos ---- */
        '<div class="stack" style="--gap:12px">' +
          '<div class="field__label">Photos</div>' +
          photos +
          '<input type="file" accept="image/*" multiple hidden data-img-input>' +
          '<button class="btn btn--gold btn--sm" data-img-add type="button">Add photos</button>' +
        '</div>' +

        /* ---- the words ---- */
        '<div class="stack" style="--gap:16px">' +
          field('Product name', 'name', p.name, { placeholder: 'Sunset Riot #07' }) +
          field('Description', 'description', p.description, {
            textarea: true, rows: 5,
            placeholder: 'What makes this disc worth having. Flight, feel, the stamp, any marks.',
            hint: 'Shown in the quick-view popup. Two or three sentences is plenty.',
          }) +
          '<div class="field-grid">' +
            field('Price (R)', 'price', p.price, { number: true, step: 10 }) +
            field('Was / compare-at (R)', 'compareAt', p.compareAt, {
              number: true, step: 10, hint: 'Blank for no strike-through price.' }) +
          '</div>' +
          '<div class="field-grid">' +
            field('Stock', 'stock', p.stock, { number: true, hint: '0 marks it sold out.' }) +
            field('Category', 'category', p.category, { options: ['discs', 'apparel', 'accessories'] }) +
          '</div>' +
          '<div class="field-grid">' +
            field('Brand', 'brand', p.brand, { placeholder: 'Discraft' }) +
            field('Model / type', 'subcategory', p.subcategory, { placeholder: 'Ultra-Star' }) +
          '</div>' +
          '<div class="field-grid">' +
            field('Weight', 'weight', p.weight, { placeholder: '175 g' }) +
            field('Condition', 'condition', p.condition, { placeholder: 'Brand new' }) +
          '</div>' +
          '<div class="field-grid">' +
            field('Stamp', 'stamp', p.stamp, { placeholder: 'Kaalvoet Kaos crest' }) +
            field('Colourway name', 'colorName', p.colorName, { placeholder: 'Sunset Riot' }) +
          '</div>' +
          field('Group (yours only, never shown to buyers)', 'tier', p.tier || '',
            { options: [''].concat(tiers()) }) +
          '<div class="field-grid">' +
            field('Main colour', 'color0', (p.colors || [])[0] || '#ff4d2e', {
              color: true, hint: 'Used for the placeholder art until a photo is added.' }) +
            field('Backdrop colour', 'color1', (p.colors || [])[1] || '#2b1a14', { color: true }) +
          '</div>' +
          field('Tags', 'tags', (p.tags || []).join(', '), {
            placeholder: 'ultimate, discraft, new', hint: 'Comma separated. Used by the shop search.' }) +
          '<div class="field-grid">' +
            field('Options label', 'variantLabel', p.variantLabel, {
              placeholder: 'Size', hint: 'Leave blank for one-off items like discs.' }) +
            field('Options', 'variants', (p.variants || []).join(', '), {
              placeholder: 'S, M, L, XL', hint: 'Comma separated. Buyer must pick one.' }) +
          '</div>' +
        '</div>' +

        '<div class="row" style="gap:10px;flex-wrap:wrap;padding-top:4px">' +
          '<button class="btn btn--primary" data-editor-done type="button">Done</button>' +
          '<button class="btn btn--ghost btn--sm" data-editor-delete type="button" style="color:var(--bad)">Delete this product</button>' +
        '</div>' +
      '</div>';
  }

  /** Apply one edited field back onto the product being edited. */
  function applyEditorField(key, value) {
    const p = editing;
    if (!p) return;

    if (key === 'price' || key === 'stock') {
      p[key] = Number(value) || 0;
      if (key === 'stock') p.unique = p.stock === 1 && p.category === 'discs';
    } else if (key === 'compareAt') {
      p.compareAt = value === '' ? null : Number(value) || null;
    } else if (key === 'tags' || key === 'variants') {
      const list = value.split(',').map((x) => x.trim()).filter(Boolean);
      if (key === 'variants' && !list.length) delete p.variants;
      else p[key] = list;
    } else if (key === 'color0' || key === 'color1') {
      p.colors = p.colors || ['#ff4d2e', '#2b1a14'];
      p.colors[key === 'color0' ? 0 : 1] = value;
    } else if (key === 'variantLabel' && !value.trim()) {
      delete p.variantLabel;
    } else {
      p[key] = value;
    }

    state.dirty = true;
    $('[data-save]').textContent = 'Save changes •';
  }

  /* --- Rotating and flipping a photo -------------------------------------
     Works on the full-quality pending blob when there is one, otherwise on
     the file already on disk, so repeated turns never soften the image.  */

  async function sourceBitmap(path) {
    if (state.pending[path]) return createImageBitmap(state.pending[path]);
    const res = await fetch(path + (path.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now());
    if (!res.ok) throw new Error('could not read ' + path);
    return createImageBitmap(await res.blob());
  }

  async function transformPhoto(index, op) {
    const p = editing;
    if (!p) return;
    const path = p.images[index];
    if (!path) return;

    let bmp;
    try {
      bmp = await sourceBitmap(path);
    } catch (e) {
      window.KK.toast('Could not load that photo to edit it', 'bad');
      return;
    }

    const quarter = op === 'rot-l' || op === 'rot-r';
    const canvas = document.createElement('canvas');
    canvas.width = quarter ? bmp.height : bmp.width;
    canvas.height = quarter ? bmp.width : bmp.height;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (op === 'rot-l') ctx.rotate(-Math.PI / 2);
    if (op === 'rot-r') ctx.rotate(Math.PI / 2);
    if (op === 'flip') ctx.scale(-1, 1);
    ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
    bmp.close && bmp.close();

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
    state.pending[path] = blob;
    setPreview(path, await thumbUrl(canvas));
    state.dirty = true;

    renderEditor();
    render();
  }


  /* ======================================================================
     Spreadsheet round trip

     Typing 64 names and prices into a web table is slow no matter how fast
     the table is. Export a CSV, fill it in in Excel or Sheets where the
     keyboard does the work, then import it back. Rows are matched on SKU,
     so ordering does not matter and nothing else about the product is
     touched -- photos, groups and flags all survive.
     ====================================================================== */

  const CSV_FIELDS = ['sku', 'name', 'price', 'stock', 'tier', 'brand', 'subcategory',
    'condition', 'weight', 'colorName', 'stamp', 'description'];

  function csvCell(v) {
    const t = v == null ? '' : String(v);
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }

  function toCsv() {
    const lines = [CSV_FIELDS.join(',')];
    state.products.forEach((p) => {
      lines.push(CSV_FIELDS.map((f) => csvCell(p[f])).join(','));
    });
    // BOM so Excel opens it as UTF-8 and does not mangle accents.
    return '\ufeff' + lines.join('\r\n') + '\r\n';
  }

  /** Minimal RFC-4180 parser: handles quotes, embedded commas and newlines. */
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = [];
    let row = [], cell = '', quoted = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else quoted = false;
        } else cell += ch;
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === ',') { row.push(cell); cell = ''; continue; }
      if (ch === '\r') continue;
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
      cell += ch;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  function importCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) { window.KK.toast('That file has no rows in it', 'bad'); return; }

    const head = rows[0].map((h) => h.trim());
    const skuAt = head.indexOf('sku');
    if (skuAt < 0) {
      window.KK.toast('The CSV needs a "sku" column to match rows up', 'bad');
      return;
    }

    const bySku = {};
    state.products.forEach((p) => { bySku[String(p.sku).trim().toUpperCase()] = p; });

    let changed = 0, unknown = 0, fields = 0;
    for (let r = 1; r < rows.length; r++) {
      const sku = String(rows[r][skuAt] || '').trim().toUpperCase();
      const p = bySku[sku];
      if (!p) { unknown++; continue; }

      let touched = false;
      head.forEach((col, i) => {
        if (col === 'sku' || CSV_FIELDS.indexOf(col) < 0) return;
        const raw = (rows[r][i] == null ? '' : String(rows[r][i])).trim();
        const next = (col === 'price' || col === 'stock') ? (Number(raw) || 0) : raw;
        if (String(p[col] == null ? '' : p[col]) === String(next)) return;
        p[col] = next;
        if (col === 'stock') p.unique = p.stock === 1 && p.category === 'discs';
        touched = true;
        fields++;
      });
      if (touched) changed++;
    }

    if (changed) { state.dirty = true; normalise(); render(); }
    window.KK.toast(
      changed + ' product(s) updated, ' + fields + ' field(s) changed' +
      (unknown ? ', ' + unknown + ' unknown SKU(s) skipped' : ''),
      changed ? '' : 'info'
    );
  }

  /* ======================================================================
     Saving / exporting
     ====================================================================== */

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function save() {
    const paths = Object.keys(state.pending);

    if (!state.rootHandle) {
      window.KK.toast('Not connected to a folder — using downloads instead', 'info');
      download(new Blob([serialise()], { type: 'application/json' }), 'products.json');
      if (paths.length) await exportZip();
      return;
    }

    const btn = $('[data-save]');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      for (let i = 0; i < paths.length; i++) {
        btn.textContent = 'Saving photo ' + (i + 1) + '/' + paths.length + '…';
        await writeFile(paths[i], state.pending[paths[i]]);
      }
      await writeFile('data/products.json', new Blob([serialise()], { type: 'application/json' }));

      state.pending = {};
      state.dirty = false;
      window.KK.toast('Saved ' + paths.length + ' photo(s) and products.json');
    } catch (e) {
      console.error(e);
      window.KK.toast('Save failed: ' + e.message, 'bad');
    } finally {
      btn.disabled = false;
      render();
    }
  }

  async function exportZip() {
    const paths = Object.keys(state.pending);
    if (!paths.length) { window.KK.toast('No new photos to export', 'info'); return; }
    window.KK.toast('Building zip…', 'info');
    const zip = await makeZip(paths.map((p) => ({ path: p, blob: state.pending[p] })));
    download(zip, 'kaalvoet-kaos-photos.zip');
  }

  /* ======================================================================
     Events
     ====================================================================== */

  function bind() {
    $('[data-connect]').addEventListener('click', connectFolder);
    $('[data-reload]').addEventListener('click', () => {
      if (state.dirty && !confirm('You have unsaved changes. Reload and lose them?')) return;
      state.pending = {}; state.previews = {}; state.dirty = false;
      if (state.rootHandle) loadFromFolder(); else loadCatalogue();
    });
    $('[data-save]').addEventListener('click', save);
    $('[data-export-json]').addEventListener('click', () =>
      download(new Blob([serialise()], { type: 'application/json' }), 'products.json'));

    $('[data-export-csv]').addEventListener('click', () => {
      download(new Blob([toCsv()], { type: 'text/csv;charset=utf-8' }), 'kaalvoet-kaos-stock.csv');
      window.KK.toast('Fill it in, then use Import spreadsheet');
    });

    $('[data-import-csv]').addEventListener('click', () => $('[data-csv-input]').click());
    $('[data-csv-input]').addEventListener('change', function () {
      const file = this.files && this.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => importCsv(String(reader.result));
      reader.onerror = () => window.KK.toast('Could not read that file', 'bad');
      reader.readAsText(file, 'utf-8');
      this.value = '';
    });
    $('[data-export-zip]').addEventListener('click', exportZip);

    // --- photo intake ---
    const drop = $('[data-photo-drop]');
    const input = $('[data-photo-input]');
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', () => { ingest(input.files); input.value = ''; });

    ['dragenter', 'dragover'].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) ingest(e.dataTransfer.files); });

    // Stop the whole window swallowing dropped files outside the zones.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    // --- tray ---
    $('[data-tray]').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-photo-remove]');
      if (rm) {
        state.tray = state.tray.filter((p) => p.id !== rm.dataset.photoRemove);
        renderTray();
      }
    });
    $('[data-tray]').addEventListener('dragstart', (e) => {
      const tile = e.target.closest('[data-photo]');
      if (!tile) return;
      e.dataTransfer.setData('text/plain', tile.dataset.photo);
      e.dataTransfer.effectAllowed = 'move';
    });

    $('[data-auto-match]').addEventListener('click', autoMatch);
    $('[data-fill-order]').addEventListener('click', fillInOrder);
    $('[data-create-from-photos]').addEventListener('click', createFromPhotos);
    $('[data-clean-existing]').addEventListener('click', cleanExistingBackdrops);

    $('[data-clear-tray]').addEventListener('click', () => {
      state.tray = state.tray.filter((p) => p.assigned);
      renderTray();
    });

    // --- table ---
    const rows = $('[data-admin-rows]');

    rows.addEventListener('input', (e) => {
      const el = e.target.closest('[data-edit]');
      if (!el) return;
      const p = state.products.find((x) => x.id === el.dataset.id);
      if (!p) return;
      const field = el.dataset.edit;
      p[field] = (field === 'price' || field === 'stock') ? Number(el.value) || 0 : el.value;
      if (field === 'stock') p.unique = p.stock === 1 && p.category === 'discs';
      // Re-render just the group panel, not the whole table, or the cell
      // being edited would lose focus mid-keystroke.
      if (field === 'tier') renderTiers();
      state.dirty = true;
      $('[data-save]').textContent = 'Save changes •';
    });

    rows.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-sel]');
      if (sel) {
        if (sel.checked) state.selected.add(sel.dataset.sel);
        else state.selected.delete(sel.dataset.sel);
        $('[data-bulk-bar]').hidden = state.selected.size === 0;
        $('[data-sel-count]').textContent = state.selected.size;
      }
    });

    rows.addEventListener('click', (e) => {
      const img = e.target.closest('[data-images]');
      if (img) { openEditor(img.dataset.images); return; }

      const ed = e.target.closest('[data-editrow]');
      if (ed) { openEditor(ed.dataset.editrow); return; }

      const flag = e.target.closest('[data-flag]');
      if (flag) {
        const p = state.products.find((x) => x.id === flag.dataset.flag);
        if (p) {
          p.flagged = !p.flagged;
          state.dirty = true;
          // One row, not the whole table: a full rebuild blocked for 325ms.
          if (state.filter === 'flagged') render();
          else updateRow(p.id);
        }
        return;
      }

      const del = e.target.closest('[data-delete]');
      if (del) {
        const p = state.products.find((x) => x.id === del.dataset.delete);
        if (!p || !confirm('Delete "' + p.name + '"? Its photo files stay on disk.')) return;
        state.products = state.products.filter((x) => x.id !== p.id);
        state.selected.delete(p.id);
        state.dirty = true;
        normalise();
        const row = document.querySelector('[data-row="' + cssEscape(p.id) + '"]');
        if (row) { row.remove(); renderTiers(); updateCounts(); }
        else render();
      }
    });

    // Drag a tray photo onto a row thumbnail.
    rows.addEventListener('dragover', (e) => {
      if (e.target.closest('[data-drop-target]')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    });
    rows.addEventListener('drop', (e) => {
      const target = e.target.closest('[data-drop-target]');
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      const photoId = e.dataTransfer.getData('text/plain');
      const photo = state.tray.find((p) => p.id === photoId);
      const product = state.products.find((p) => p.id === target.dataset.dropTarget);
      if (!photo || !product) return;
      attach(photo, product);
      cleanTray();
      render();
      window.KK.toast('Photo attached to ' + product.name);
    });

    $('[data-sel-all]').addEventListener('change', function () {
      const list = filtered();
      if (this.checked) list.forEach((p) => state.selected.add(p.id));
      else state.selected.clear();
      render();
    });

    $('[data-admin-search]').addEventListener('input', window.KK.debounce(function () {
      state.query = this.value.trim();
      render();
    }, 160));

    $('[data-admin-filter]').addEventListener('change', function () {
      state.filter = this.value;
      render();
    });

    $('[data-add-product]').addEventListener('click', () => {
      const sku = nextSku('KK-D');
      state.products.unshift({
        id: sku.toLowerCase(), sku: sku, name: 'New product', category: 'discs',
        subcategory: 'Ultra-Star', brand: 'Discraft', price: 0, compareAt: null,
        stock: 1, unique: true, colors: ['#f57e25', '#2e1342'], colorName: '',
        weight: '175 g', condition: 'Brand new', stamp: '', tags: ['ultimate'],
        description: '', images: [],
      });
      state.dirty = true;
      normalise();
      render();
    });

    // --- bulk ---
    $('[data-bulk-price-apply]').addEventListener('click', () => {
      const v = Number($('[data-bulk-price]').value);
      if (!v && v !== 0) { window.KK.toast('Enter a price first', 'bad'); return; }
      state.products.forEach((p) => { if (state.selected.has(p.id)) p.price = v; });
      state.dirty = true;
      render();
      window.KK.toast('Price set on ' + state.selected.size + ' products');
    });

    $('[data-bulk-stock-apply]').addEventListener('click', () => {
      const v = Number($('[data-bulk-stock]').value);
      state.products.forEach((p) => { if (state.selected.has(p.id)) p.stock = v; });
      state.dirty = true;
      render();
      window.KK.toast('Stock set on ' + state.selected.size + ' products');
    });

    $('[data-tier-rows]').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tier-set]');
      if (!btn) return;
      const tier = btn.dataset.tierSet;
      const n = applyTierPrice(tier);
      if (n) {
        render();
        window.KK.toast(tier + ': ' + n + ' disc' + (n === 1 ? '' : 's') + ' priced');
      } else if ($('[data-tier-price="' + tier + '"]').value.trim()) {
        window.KK.toast('No discs are in ' + tier + ' yet', 'info');
      }
    });

    $('[data-tier-rows]').addEventListener('input', (e) => {
      const box = e.target.closest('[data-tier-price]');
      if (box) tierPrices[box.dataset.tierPrice] = box.value;
    });

    $('[data-tier-apply-all]').addEventListener('click', () => {
      let total = 0;
      let used = 0;
      tiers().forEach((t) => {
        const box = $('[data-tier-price="' + t + '"]');
        if (!box || !box.value.trim()) return;
        used++;
        total += applyTierPrice(t);
      });
      if (!used) { window.KK.toast('Fill in at least one group price first', 'bad'); return; }
      render();
      window.KK.toast(total + ' disc' + (total === 1 ? '' : 's') + ' priced across ' + used + ' group(s)');
    });

    $('[data-bulk-field-apply]').addEventListener('click', () => {
      const field = $('[data-bulk-field]').value;
      const raw = $('[data-bulk-value]').value.trim();
      if (!state.selected.size) { window.KK.toast('Tick some products first', 'bad'); return; }
      if (!raw) { window.KK.toast('Type a value first', 'bad'); return; }

      let n = 0;
      state.products.forEach((p) => {
        if (!state.selected.has(p.id)) return;
        p[field] = raw;
        n++;
      });
      state.dirty = true;
      render();
      window.KK.toast(field + ' set to "' + raw + '" on ' + n + ' product(s)');
    });

    $('[data-clear-samples]').addEventListener('click', () => {
      const n = state.products.length;
      if (!n) { window.KK.toast('Nothing to clear', 'info'); return; }
      if (!confirm(
        'Remove all ' + n + ' products from the catalogue?\n\n' +
        'Use this once, to clear the sample stock before loading your real discs.\n' +
        'Photo files already on disk are left alone, and nothing is written until ' +
        'you press Save changes.'
      )) return;

      state.products = [];
      state.selected.clear();
      state.dirty = true;
      normalise();
      render();
      window.KK.toast('Catalogue cleared — now drop your photos in', 'info');
    });

    $('[data-bulk-delete]').addEventListener('click', () => {
      if (!confirm('Delete ' + state.selected.size + ' products?')) return;
      state.products = state.products.filter((p) => !state.selected.has(p.id));
      state.selected.clear();
      state.dirty = true;
      normalise();
      render();
    });

    // --- image modal ---
    $('[data-scrim]').addEventListener('click', closeEditor);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && editing) closeEditor();
    });

    // Text edits update the product live; the modal is deliberately not
    // re-rendered on keystrokes, or the caret would jump to the end.
    $('[data-img-panel]').addEventListener('input', (e) => {
      const el = e.target.closest('[data-edit-field]');
      if (el) applyEditorField(el.dataset.editField, el.value);
    });

    $('[data-img-panel]').addEventListener('click', async (e) => {
      if (e.target.closest('[data-img-close]') || e.target.closest('[data-editor-done]')) { closeEditor(); return; }

      if (e.target.closest('[data-editor-delete]')) {
        const p = editing;
        if (!p || !confirm('Delete "' + p.name + '"? Its photo files stay on disk.')) return;
        state.products = state.products.filter((x) => x.id !== p.id);
        state.selected.delete(p.id);
        state.dirty = true;
        closeEditor();
        normalise();
        render();
        return;
      }

      const del = e.target.closest('[data-img-del]');
      if (del) {
        const i = Number(del.dataset.imgDel);
        const path = editing.images[i];
        delete state.pending[path];
        editing.images.splice(i, 1);
        state.dirty = true;
        renderEditor();
        render();
        return;
      }

      const main = e.target.closest('[data-img-main]');
      if (main) {
        const i = Number(main.dataset.imgMain);
        const [moved] = editing.images.splice(i, 1);
        editing.images.unshift(moved);
        state.dirty = true;
        renderEditor();
        render();
        return;
      }

      // Show the real file, not the 240px preview the tile uses.
      const zoom = e.target.closest('[data-img-zoom]');
      if (zoom) {
        const path = editing.images[Number(zoom.dataset.imgZoom)];
        if (path) {
          const pending = state.pending[path];
          window.KK.lightbox(pending || (path + '?t=' + Date.now()), path.split('/').pop() +
            (pending ? ' (unsaved)' : ''));
        }
        return;
      }

      const op = e.target.closest('[data-img-op]');
      if (op) {
        const btn = op;
        btn.disabled = true;
        await transformPhoto(Number(btn.dataset.imgI), btn.dataset.imgOp);
        return;
      }

      if (e.target.closest('[data-img-add]')) $('[data-img-input]').click();
    });

    $('[data-img-panel]').addEventListener('change', async (e) => {
      const input = e.target.closest('[data-img-input]');
      if (!input || !input.files.length) return;
      const product = editing;
      for (const file of Array.prototype.slice.call(input.files)) {
        try {
          const out = await processImage(file);
          attach({ blob: out.blob, dataUrl: out.dataUrl }, product);
        } catch (err) { window.KK.toast(err.message, 'bad'); }
      }
      renderEditor();
      render();
    });

    // Guard against losing work.
    window.addEventListener('beforeunload', (e) => {
      if (state.dirty || Object.keys(state.pending).length) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  /* --- Boot ---------------------------------------------------------------- */

  async function init() {
    bind();

    // Warn up front about the two setups that cannot possibly work.
    if (openedAsFile) {
      connectProblem(
        'Open this page through a local server, not straight off disk',
        'The address bar says <code style="color:var(--gold)">file:///…</code>, so the browser will ' +
        'not let this page read your product data or write to your folders.<br><br>' +
        'Open a terminal in the project folder and run:<br>' +
        '<code style="color:var(--gold);display:inline-block;margin:8px 0">python -m http.server 8000</code>' +
        '<br>then use <a href="http://localhost:8000/manage.html" style="color:var(--gold)">' +
        'http://localhost:8000/manage.html</a>.'
      );
    } else if (!supportsFS) {
      connectProblem(
        'This browser cannot write files directly',
        'Direct folder saving needs Chrome or Edge on desktop. Everything else here still works — use ' +
        '<strong>Download products.json</strong> and <strong>Download photos .zip</strong>, then unzip ' +
        'those over the project folder by hand.'
      );
    } else {
      $('[data-unsupported]').hidden = true;
    }

    await loadCatalogue();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
