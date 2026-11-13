/** Presentation-only pool: no world objects, loot, combat callbacks or timers.
 * The existing game loop drives it; one reusable canvas and glow atlas keep
 * decorative work bounded even after many retries. Values are centralized here. */
export const VICTORY_STYLE = Object.freeze({
  revealSeconds: 2.2,
  particles: 240,
  lowParticles: 112,
  rings: 5,
  drawHz: 30,
  maxPixelRatio: 1.25,
  fireworkInterval: 1.6,
  reviewInterval: 3.2,
});
const COLORS = ['#20ffe0', '#9e48ff', '#e348ff', '#bafff7', '#a4ff28', '#f8d97d'];

export class VictoryPresentation {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.canvas = root.querySelector('#victoryParticles');
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.score = root.querySelector('#scoreBig');
    this.skipButton = root.querySelector('#victorySkip');
    this.announcement = root.querySelector('#resultsAnnouncement');
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.pool = Array.from({ length: VICTORY_STYLE.particles }, () => ({ life: 0 }));
    this.rings = Array.from({ length: VICTORY_STYLE.rings }, () => ({ life: 0 }));
    this.cursor = 0;
    this.active = false;
    this.revealing = false;
    this.atlas = this.createAtlas();
    this.skipButton.addEventListener('click', () => this.skip());
    this.observer = new ResizeObserver(() => { if (this.active) this.resize(); });
    this.motion.addEventListener('change', () => {
      if (!this.active) return;
      this.root.classList.toggle('calmVictory', this.motion.matches);
      if (this.motion.matches) { this.skip(); this.clearPool(); }
      this.draw();
    });
  }

  createAtlas() {
    const atlas = document.createElement('canvas');
    atlas.width = COLORS.length * 40; atlas.height = 80;
    const ctx = atlas.getContext('2d');
    if (!ctx) return atlas;
    COLORS.forEach((color, index) => {
      for (let shape = 0; shape < 2; shape++) {
        ctx.save(); ctx.translate(index * 40 + 20, shape * 40 + 20);
        ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.fillStyle = color;
        if (shape) ctx.rotate(Math.PI / 4);
        ctx.fillRect(-3, -3, 6, 6); ctx.shadowBlur = 0;
        ctx.fillStyle = '#efffff'; ctx.fillRect(-1.5, -1.5, 2, 2);
        ctx.restore();
      }
    });
    return atlas;
  }

  show(result, { instant = false } = {}) {
    this.hide();
    this.result = result;
    this.root.classList.toggle('calmVictory', this.motion.matches);
    this.root.classList.remove('resultsRevealing');
    this.announcement.textContent = `${result.victory ? 'Victory. Galaxy escaped.' : 'Run terminated.'} ${result.pilotName}. Final score ${result.score.toLocaleString()}. Earned rank ${result.grade}.`;
    if (!result.victory) return;
    this.active = true;
    this.elapsed = 0; this.drawClock = 0; this.fireworkClock = .12; this.fountainClock = 0;
    this.cap = (this.game.adaptiveResolution?.scale ?? 1) < .85 ? VICTORY_STYLE.lowParticles : VICTORY_STYLE.particles;
    this.revealing = !instant && !this.motion.matches;
    this.root.classList.toggle('resultsRevealing', this.revealing);
    this.skipButton.hidden = !this.revealing;
    if (this.revealing) this.score.textContent = '0';
    this.canvas.hidden = false;
    this.resize();
    this.observer.observe(this.root);
    if (!this.motion.matches) {
      this.burst(.1, .27, 0); this.burst(.9, .16, 1); this.ring();
    }
    this.draw();
  }

  skip() {
    if (!this.result) return;
    this.score.textContent = this.result.score.toLocaleString();
    this.revealing = false;
    this.root.classList.remove('resultsRevealing');
    const focused = document.activeElement === this.skipButton;
    this.skipButton.hidden = true;
    if (focused) this.root.querySelector('#againBtn').focus({ preventScroll: true });
  }

  resize() {
    this.width = Math.max(1, this.root.clientWidth);
    this.height = Math.max(1, this.root.clientHeight);
    const dpr = Math.min(devicePixelRatio || 1, VICTORY_STYLE.maxPixelRatio);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  spawn(x, y, vx, vy, life, size, color, shape) {
    // Reuse fixed objects. At capacity we recycle an old decoration, never grow.
    const p = this.pool[this.cursor++ % this.cap];
    Object.assign(p, { x, y, vx, vy, life, maxLife: life, size, color, shape });
  }

  burst(x, y, color) {
    const count = this.cap < VICTORY_STYLE.particles ? 24 : 44;
    const power = Math.min(this.width, this.height) * .17;
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2;
      // Alternating lengths sketch a glowing eight-point pirate star.
      const speed = power * (.4 + .6 * Math.abs(Math.cos(angle * 4)));
      this.spawn(x * this.width, y * this.height, Math.cos(angle) * speed,
        Math.sin(angle) * speed, 1.7 + Math.random() * .8,
        1.1 + Math.random() * .8, i % 11 === 0 ? 3 : color, i % 3 === 0 ? 1 : 0);
    }
  }

  ring() {
    const ring = this.rings.find(r => r.life <= 0);
    if (ring) Object.assign(ring, { life: 2.8, maxLife: 2.8, x: this.width * .78, y: this.height * .26 });
  }

  update(rawDt) {
    if (!this.active || document.hidden) return;
    const dt = Math.max(0, Math.min(rawDt || 0, .05));
    this.elapsed += dt;
    if (this.revealing) {
      const progress = Math.min(1, this.elapsed / VICTORY_STYLE.revealSeconds);
      this.score.textContent = Math.round(this.result.score * (1 - (1 - progress) ** 3)).toLocaleString();
      if (progress >= 1) this.skip();
    }
    if (this.motion.matches) return;
    this.fireworkClock -= dt; this.fountainClock -= dt;
    if (this.fireworkClock <= 0) {
      const left = Math.random() > .5;
      this.burst(left ? .04 + Math.random() * .14 : .82 + Math.random() * .14, .1 + Math.random() * .28, left ? 0 : 1);
      this.ring();
      this.fireworkClock = this.elapsed < 5 ? VICTORY_STYLE.fireworkInterval : VICTORY_STYLE.reviewInterval;
    }
    if (this.fountainClock <= 0) {
      for (const side of [-1, 1]) {
        this.spawn(this.width * (side < 0 ? .03 : .97), this.height * .86,
          -side * (18 + Math.random() * 38), -85 - Math.random() * 120,
          3 + Math.random(), 1 + Math.random() * .6, side < 0 ? 0 : 2, 1);
      }
      this.fountainClock = this.cap < VICTORY_STYLE.particles ? .17 : .1;
    }
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - dt * .32; p.vy += dt * 24;
    }
    for (const ring of this.rings) ring.life -= dt;
    this.drawClock += dt;
    if (this.drawClock >= 1 / VICTORY_STYLE.drawHz) { this.drawClock %= 1 / VICTORY_STYLE.drawHz; this.draw(); }
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.active || !this.width) return;
    ctx.clearRect(0, 0, this.width, this.height);
    // Deterministic field prevents sparkle flicker; reduced motion keeps this
    // crystalline tableau with no moving particles, count-up or expanding rings.
    const stars = this.motion.matches ? 32 : 72;
    for (let i = 0; i < stars; i++) {
      const x = ((i * 7919 + 127) % 1000) / 1000 * this.width;
      const y = ((i * 3187 + 63) % 1000) / 1000 * this.height;
      ctx.globalAlpha = .25 + (i % 4) * .12;
      const color = i % 17 === 0 ? 5 : i % 3;
      const size = i % 9 === 0 ? 27 : 15;
      ctx.drawImage(this.atlas, color * 40, 40, 40, 40, x - size / 2, y - size / 2, size, size);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const ring of this.rings) {
      if (ring.life <= 0 || this.motion.matches) continue;
      const progress = 1 - ring.life / ring.maxLife;
      ctx.globalAlpha = Math.sin(progress * Math.PI) * .27;
      ctx.strokeStyle = '#6f4bdb'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(ring.x, ring.y, 40 + progress * this.width * .22,
        15 + progress * this.height * .13, -.35, 0, Math.PI * 2); ctx.stroke();
    }
    for (const p of this.pool) {
      if (p.life <= 0 || this.motion.matches) continue;
      ctx.globalAlpha = Math.min(1, p.life / .6) * .85;
      const size = 25 * p.size;
      ctx.drawImage(this.atlas, p.color * 40, p.shape * 40, 40, 40, p.x - size / 2, p.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  clearPool() {
    for (const p of this.pool) p.life = 0;
    for (const ring of this.rings) ring.life = 0;
    this.cursor = 0;
  }

  hide() {
    this.active = false; this.revealing = false;
    this.clearPool(); this.observer.disconnect();
    this.skipButton.hidden = true; this.canvas.hidden = true;
    this.canvas.width = 1; this.canvas.height = 1;
    this.root.classList.remove('resultsRevealing');
  }
}
