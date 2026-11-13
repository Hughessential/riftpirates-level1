import { escapeIntensity } from './escapeIntensity.js';

/** Deterministic escape geometry. Distances are world units; clocks use game time. */
export const ESCAPE_CONFIG = Object.freeze({
  deadline: 135,
  routeLength: 6350,
  baseSpeed: 44,
  boostBonus: 16,
  lookAhead: 180,
  wallDepth: 2.4,
  riftRadius: 5.8,
  riftX: 0,
  riftY: 2,
});

export function createEscapeRoute() {
  const gates = [];
  let distance = 360;
  for (let i = 0; distance < ESCAPE_CONFIG.routeLength - 320; i++) {
    const progress = distance / ESCAPE_CONFIG.routeLength;
    const intensity = Math.min(1, progress / .9);
    const x = Math.sin(i * 1.73 + .4) * (9 + intensity * 4);
    const y = 2 + Math.sin(i * 1.19 - .6) * (3.4 + intensity * 2);
    gates.push(Object.freeze({
      index: i, distance, x, y,
      halfWidth: 7.2 - intensity * 2.4,
      halfHeight: 5.4 - intensity * 1.5,
      damage: 34 + intensity * 16,
    }));
    distance += 240 - intensity * 95;
  }
  return gates;
}

export function escapeSpeed(player) {
  return ESCAPE_CONFIG.baseSpeed + (player.boosting
    ? ESCAPE_CONFIG.boostBonus * Math.max(0, player.stats.boostSpeed / 31) : 0);
}

export function escapePhase(progress, elapsed = 0) { return escapeIntensity(progress, elapsed).name; }
