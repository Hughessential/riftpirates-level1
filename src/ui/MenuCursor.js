/** The title cursor's comet stays decorative: no hit testing or game objects. */
export const MENU_CURSOR_TRAIL = Object.freeze({
  points: 128, spacing: 6, life: 1.8, drawHz: 30, maxPixelRatio: 1.5, maxPixels: 3_000_000,
});

export function initMenuCursor() {
  const title = document.getElementById('titleScreen');
  if (!title || document.getElementById('menuCursorStar')) return;
  const layer = document.createElement('div');
  layer.id = 'menuCursorLayer';
  layer.setAttribute('aria-hidden', 'true');
  layer.hidden = true;
  const canvas = document.createElement('canvas');
  canvas.id = 'menuCursorTrail';
  const ctx = canvas.getContext('2d', { alpha: true });
  const star = document.createElement('div');
  star.id = 'menuCursorStar';
  star.setAttribute('aria-hidden', 'true');
  star.innerHTML = `<svg viewBox="0 0 28 28" focusable="false" aria-hidden="true">
    <path fill="#8428e8" d="M12 2h4v8h8v4h-8v10h-4V14H2v-4h10z"/>
    <path fill="#21ffdc" d="M12 0h4v8h-4zM0 12h8v4H0zM20 12h8v4h-8zM12 20h4v8h-4z"/>
    <path fill="#b52aff" d="M8 8h12v12H8z"/>
    <path fill="#efffff" d="M11 6h6v5h5v6h-5v5h-6v-5H6v-6h5z"/>
    <path fill="#ffffff" d="M11 11h6v6h-6z"/>
  </svg>`;
  layer.append(canvas, star);
  document.body.append(layer);

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const points = Array.from({ length: MENU_CURSOR_TRAIL.points }, () => ({ x: 0, y: 0, at: 0 }));
  let start = 0, count = 0, lastPointer = false, previousX = 0, previousY = 0;
  let frame = 0, lastDraw = 0, width = 0, height = 0, dpr = 0;
  const dialogs = new Set();
  const dialogStack = [];

  function resize() {
    const nextDpr = Math.min(devicePixelRatio || 1, MENU_CURSOR_TRAIL.maxPixelRatio,
      Math.sqrt(MENU_CURSOR_TRAIL.maxPixels / Math.max(1, innerWidth * innerHeight)));
    if (width === innerWidth && height === innerHeight && dpr === nextDpr) return;
    width = innerWidth; height = innerHeight; dpr = nextDpr;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function clear() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; count = 0; start = 0; lastDraw = 0;
    ctx?.clearRect(0, 0, width, height);
  }
  function paintVisibility() {
    const visible = lastPointer && !title.classList.contains('hidden') && !document.hidden;
    layer.hidden = !visible;
    star.classList.toggle('visible', visible);
    if (!visible) clear();
    // A fixed decoration inside the latest native dialog joins its top layer.
    // This keeps both the star and its full-viewport tail above modal backdrops.
    const parent = dialogStack.findLast(dialog => dialog.open) || document.body;
    if (layer.parentElement !== parent) parent.append(layer);
    if (visible) resize();
  }
  function observeDialogs() {
    for (const dialog of document.querySelectorAll('dialog')) {
      if (dialogs.has(dialog)) continue;
      dialogs.add(dialog);
      const changed = () => {
        const index = dialogStack.indexOf(dialog);
        if (index >= 0) dialogStack.splice(index, 1);
        if (dialog.open) dialogStack.push(dialog);
        paintVisibility();
      };
      new MutationObserver(changed).observe(dialog, { attributes: true, attributeFilter: ['open'] });
      if (dialog.open) changed();
    }
  }
  function sample(x, y, now) {
    let slot;
    if (count < points.length) slot = (start + count++) % points.length;
    else { slot = start; start = (start + 1) % points.length; }
    const point = points[slot];
    point.x = x; point.y = y; point.at = now;
  }
  function draw(now) {
    resize();
    while (count && (now - points[start].at) / 1000 >= MENU_CURSOR_TRAIL.life) {
      start = (start + 1) % points.length; count--;
    }
    ctx.clearRect(0, 0, width, height);
    if (!count) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // Three narrow additive ribbons produce soft glow without a screen filter.
    ctx.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 3; pass++) {
      const color = ['#8935f3', '#28eacf', '#d4fff9'][pass];
      for (let i = 1; i < count; i++) {
        const a = points[(start + i - 1) % points.length], b = points[(start + i) % points.length];
        const life = Math.max(0, 1 - (now - b.at) / (MENU_CURSOR_TRAIL.life * 1000));
        const taper = (.15 + .85 * i / count) * life;
        ctx.globalAlpha = [.09, .18, .48][pass] * taper;
        ctx.strokeStyle = color; ctx.lineWidth = [16, 6, 1.3][pass] * taper;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    // Deterministic voxel glints shimmer gently along the recorded path. Their
    // fixed pool doubles as the path; no emitters, lights or DOM nodes grow.
    for (let i = 0; i < count; i += 3) {
      const point = points[(start + i) % points.length];
      const age = (now - point.at) / 1000, life = Math.max(0, 1 - age / MENU_CURSOR_TRAIL.life);
      const phase = point.at * .013;
      const glint = .65 + .35 * Math.sin(now * .004 + phase);
      const side = i % 2 ? -1 : 1;
      const x = point.x + Math.sin(phase) * (3 + age * 10);
      const y = point.y + side * (4 + age * 9);
      const size = (i % 9 === 0 ? 3 : 2) * life;
      ctx.globalAlpha = life * glint * .62;
      ctx.fillStyle = i % 2 ? '#b864ff' : '#58ffed';
      ctx.fillRect(Math.round(x), Math.round(y), size, size);
      if (i % 9 === 0) {
        ctx.globalAlpha *= .22;
        ctx.fillRect(x - 3, y - 3, size + 6, size + 6);
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function tick(now) {
    frame = 0;
    if (layer.hidden || motion.matches || !ctx) { clear(); return; }
    if (now - lastDraw >= 1000 / MENU_CURSOR_TRAIL.drawHz) { draw(now); lastDraw = now; }
    if (count) frame = requestAnimationFrame(tick);
  }
  document.addEventListener('pointermove', event => {
    lastPointer = event.pointerType !== 'touch';
    star.style.setProperty('--mouse-x', `${event.clientX + 15}px`);
    star.style.setProperty('--mouse-y', `${event.clientY + 16}px`);
    paintVisibility();
    if (layer.hidden || motion.matches || !ctx) return;
    const x = event.clientX + 26.5, y = event.clientY + 27.5, now = performance.now();
    if (!count) sample(x, y, now);
    else {
      const distance = Math.hypot(x - previousX, y - previousY);
      if (distance < MENU_CURSOR_TRAIL.spacing) return;
      const steps = Math.min(48, Math.ceil(distance / MENU_CURSOR_TRAIL.spacing));
      for (let i = 1; i <= steps; i++) sample(previousX + (x - previousX) * i / steps,
        previousY + (y - previousY) * i / steps, now);
    }
    previousX = x; previousY = y;
    if (!frame) frame = requestAnimationFrame(tick);
  }, { passive: true });
  document.addEventListener('pointerleave', () => { lastPointer = false; paintVisibility(); });
  window.addEventListener('blur', () => { lastPointer = false; paintVisibility(); });
  document.addEventListener('visibilitychange', paintVisibility);
  window.addEventListener('resize', () => { clear(); resize(); });
  motion.addEventListener('change', () => { clear(); paintVisibility(); });
  new MutationObserver(paintVisibility).observe(title, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(observeDialogs).observe(document.body, { childList: true });
  observeDialogs();
}
