import { PRIORITY } from './Target.js';

/**
 * Autofire target selection (spec §8). Deliberately simple: no predictive aim
 * for the player. Re-evaluated on a short interval rather than every frame so
 * the turret doesn't jitter between equidistant targets.
 */

const RANGE = 90;
const THREAT_RANGE = 22; // an enemy this close outranks any structure

export class TargetingSystem {
  constructor() {
    this.current = null;
    this.t = 0;
  }

  update(dt, playerPos, targets) {
    this.t -= dt;

    // Drop a target the moment it dies, even mid-interval.
    if (this.current && (!this.current.alive || !this.current.targetable)) {
      this.current = null;
      this.t = 0;
    }
    if (this.t > 0 && this.current) return this.current;
    this.t = 0.1;

    let best = null;
    let bestKey = Infinity;

    for (const tg of targets) {
      if (!tg.alive || !tg.targetable) continue;
      const dx = tg.pos.x - playerPos.x;
      const dy = tg.pos.y - playerPos.y;
      const dz = tg.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > RANGE) continue;

      let prio = tg.priority;
      // "Immediate dangerous enemies" beat everything else
      if (tg.kind === 'enemy' && d < THREAT_RANGE) prio = PRIORITY.THREAT;

      // rank on priority first, distance second
      const key = prio * 1000 + d;
      if (key < bestKey) {
        bestKey = key;
        best = tg;
      }
    }

    this.current = best;
    return best;
  }

  reset() {
    this.current = null;
    this.t = 0;
  }
}
