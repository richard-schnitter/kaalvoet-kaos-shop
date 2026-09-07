/* ==========================================================================
   KAALVOET KAOS MERCH — the flying disc
   --------------------------------------------------------------------------
   The crest in the hero behaves like a disc in flight: it arcs across and
   away as you scroll, spins with the scroll, and banks toward your cursor
   when you get near it.

   All motion is transform-only and driven from a single rAF loop, so it
   stays cheap. Honours prefers-reduced-motion by sitting still.
   ========================================================================== */

(function () {
  'use strict';

  const disc = document.querySelector('[data-disc]');
  if (!disc) return;

  const hero = disc.closest('.hero');
  if (!hero) return;

  /* --- Extrude the side wall --------------------------------------------
     A real disc is mostly rim. Stacking a handful of circles down the Z
     axis gives genuine thickness that banks correctly in 3D, which a flat
     image cannot do.                                                      */
  (function buildRim() {
    const body = disc.querySelector('[data-disc-body]');
    const face = disc.querySelector('.disc__face');
    if (!body || !face) return;

    const LAYERS = 16;
    const DEPTH = 2.4;          // px between layers
    const frag = document.createDocumentFragment();

    for (let i = 0; i < LAYERS; i++) {
      const t = i / (LAYERS - 1);
      const el = document.createElement('span');
      el.className = 'disc__layer';
      // Darker and very slightly tucked in as it goes back, so the rim
      // curves under instead of reading as a flat cylinder.
      const shade = Math.round(150 - t * 110);
      const tuck = 1 - Math.pow(t, 2.2) * 0.07;
      el.style.setProperty('--layer-tint',
        'rgb(' + Math.round(shade * 0.62) + ',' + Math.round(shade * 0.34) + ',' + Math.round(shade * 0.20) + ')');
      el.style.transform = 'translateZ(' + (-(i + 1) * DEPTH).toFixed(2) + 'px) scale(' + tuck.toFixed(4) + ')';
      frag.appendChild(el);
    }
    body.insertBefore(frag, face);
  })();

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* --- Tunables ---------------------------------------------------------- */
  const FLY_X = -0.30;   // fraction of hero width travelled, per full scroll
  const FLY_Y = -0.52;   // fraction of hero height
  const ARC   = -0.14;   // extra lift at the middle of the flight
  const SPIN  = 340;     // degrees of spin across the flight
  const IDLE  = 2.2;     // degrees per second while sitting still
  const TILT  = 24;      // max bank toward the cursor, degrees
  const BASE  = 30;      // resting tilt, so the rim and thickness show
  const EASE  = 0.09;    // how quickly the disc catches up to its target

  /* --- Live state -------------------------------------------------------- */
  const target = { x: 0, y: 0, rx: 30, ry: 0, rz: 0, scale: 1 };
  const cur    = { x: 0, y: 0, rx: 30, ry: 0, rz: 0, scale: 1 };

  let pointer = { x: 0, y: 0, inside: false, near: 0 };
  let scrollP = 0;
  let idleSpin = 0;
  let lastT = performance.now();
  let running = false;

  /* --- Measurement ------------------------------------------------------- */

  function readScroll() {
    const r = hero.getBoundingClientRect();
    const h = r.height || 1;
    // 0 while the hero is fully in view, 1 once it has scrolled past.
    scrollP = Math.min(1, Math.max(0, -r.top / h));
  }

  function discCentre() {
    const r = disc.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
  }

  /* --- Input ------------------------------------------------------------- */

  function onPointerMove(e) {
    const c = discCentre();
    const dx = e.clientX - c.x;
    const dy = e.clientY - c.y;
    const dist = Math.hypot(dx, dy);

    // 1 when the cursor is dead centre, fading to 0 at twice the radius.
    pointer.near = Math.max(0, 1 - dist / (c.r * 2));
    pointer.inside = dist < c.r;
    pointer.x = Math.max(-1, Math.min(1, dx / c.r));
    pointer.y = Math.max(-1, Math.min(1, dy / c.r));

    disc.classList.toggle('is-hot', pointer.inside);
  }

  function onPointerLeave() {
    pointer.near = 0;
    pointer.inside = false;
    pointer.x = 0;
    pointer.y = 0;
    disc.classList.remove('is-hot');
  }

  /* --- Flick: a click sends it spinning ---------------------------------- */

  let flick = 0;
  function onClick() {
    if (!pointer.inside) return;
    flick += 360;
  }

  /* --- The loop ---------------------------------------------------------- */

  function applyTransform() {
    disc.style.transform =
      'translate3d(' + cur.x.toFixed(2) + 'px,' + cur.y.toFixed(2) + 'px,0)' +
      ' rotateX(' + cur.rx.toFixed(2) + 'deg)' +
      ' rotateY(' + cur.ry.toFixed(2) + 'deg)' +
      ' rotateZ(' + cur.rz.toFixed(2) + 'deg)' +
      ' scale(' + cur.scale.toFixed(3) + ')';
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    const w = hero.offsetWidth;
    const h = hero.offsetHeight;
    const p = scrollP;

    // Flight path: travels up and across, lifting slightly at the midpoint.
    target.x = FLY_X * w * p;
    target.y = FLY_Y * h * p + ARC * h * Math.sin(p * Math.PI);
    target.scale = 1 - p * 0.34 + pointer.near * 0.07;

    // Spin comes from the scroll, plus a slow idle turn and any flick.
    idleSpin += IDLE * dt * (1 + pointer.near * 3);
    target.rz = SPIN * p + idleSpin + flick;

    // Bank toward the cursor. Falls away as the disc flies off.
    const grip = pointer.near * (1 - p * 0.7);
    target.rx = BASE - pointer.y * TILT * grip - p * 16;
    target.ry = pointer.x * TILT * grip;

    // Ease everything so nothing snaps.
    cur.x += (target.x - cur.x) * EASE;
    cur.y += (target.y - cur.y) * EASE;
    cur.rx += (target.rx - cur.rx) * EASE;
    cur.ry += (target.ry - cur.ry) * EASE;
    cur.rz += (target.rz - cur.rz) * EASE;
    cur.scale += (target.scale - cur.scale) * EASE;

    applyTransform();

    // Stop drawing once the hero is well out of view and the disc has settled.
    if (p >= 1 && Math.abs(target.rz - cur.rz) < 0.4 && !pointer.near) {
      running = false;
      return;
    }
    requestAnimationFrame(frame);
  }

  function kick() {
    if (running || reduce.matches) return;
    running = true;
    lastT = performance.now();
    requestAnimationFrame(frame);
  }

  /* --- Wiring ------------------------------------------------------------ */

  function enable() {
    readScroll();
    window.addEventListener('scroll', () => { readScroll(); kick(); }, { passive: true });
    window.addEventListener('resize', () => { readScroll(); kick(); }, { passive: true });
    hero.addEventListener('pointermove', (e) => { onPointerMove(e); kick(); });
    hero.addEventListener('pointerleave', onPointerLeave);
    hero.addEventListener('click', onClick);
    applyTransform();
    disc.classList.add('is-live');
    kick();
  }

  function disable() {
    disc.style.transform = '';
    disc.classList.remove('is-live', 'is-hot');
    running = false;
  }

  if (reduce.matches) disable();
  else enable();

  // Respond if the viewer changes their motion preference mid-session.
  reduce.addEventListener('change', () => (reduce.matches ? disable() : kick()));
})();
