export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;

/** Frame-rate independent damping: pulls `a` toward `b` at rate `k`. */
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

export const dist2 = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** Shortest distance from point p to the infinite line through `c` at angle `ang`. */
export function distToLine(px, py, cx, cy, ang) {
  const dx = px - cx;
  const dy = py - cy;
  return Math.abs(-Math.sin(ang) * dx + Math.cos(ang) * dy);
}

/** Signed distance along a line's direction — used to keep beams in front of their emitter. */
export function projOnLine(px, py, cx, cy, ang) {
  return Math.cos(ang) * (px - cx) + Math.sin(ang) * (py - cy);
}

export const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

export const $ = (id) => document.getElementById(id);

/** Shuffle a copy, take n. Used to deal upgrade cards. */
export function sample(arr, n) {
  const c = arr.slice();
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c.slice(0, n);
}
