import { escapeIntensity } from '../config/escapeIntensity.js';

const hash = value => { const v = Math.sin(value * 12.9898 + 4.12) * 43758.5453; return v - Math.floor(v); };
const SHOOTERS = ['scout', 'gunship', 'heavy', 'elite'];
const TYPES = [
  ['scout', 'gunship', 'scout', 'gunship'],
  ['scout', 'gunship', 'heavy', 'scout', 'gunship'],
  ['scout', 'gunship', 'elite', 'heavy', 'scout', 'gunship', 'shielder'],
  ['scout', 'elite', 'gunship', 'heavy', 'gunship', 'elite', 'scout', 'shielder'],
  ['elite', 'gunship', 'scout', 'heavy', 'elite', 'gunship', 'scout', 'heavy', 'gunship', 'shielder'],
];

/** Real, shootable fleets: bounded hulls, locked salvos, then an overtaken pass. */
export class EscapeArmada {
  constructor(game, escape) {
    this.game = game;
    this.escape = escape;
    this.active = true;
    this.members = new Map();
    this.spawnAt = .8;
    this.volleyAt = 2.8;
    this.wave = 0;
    this.sequence = 0;
    this.cohort = 0;
    this.spawned = this.retired = this.destroyed = this.shots = this.gapProtections = 0;
    this.peakAlive = this.peakProjectiles = 0;
    this._budget = 0;
    this._allowShot = (enemy, shot, speed) => this.allowShot(enemy, shot, speed);
  }

  get profile() { return this.escape.intensity || escapeIntensity(this.escape.progress, this.escape.elapsed); }

  update(dt) {
    if (!this.active || !(dt > 0)) return;
    const g = this.game;
    if (g.testing?.active && g.testing.settings.freezeEnemies) return;
    const profile = this.profile;
    const liveProjectiles = g.projectiles.enemy?.reduce((n, b) => n + Number(b.active), 0) || 0;
    this.peakProjectiles = Math.max(this.peakProjectiles, liveProjectiles);
    this._budget = Math.max(0, profile.projectileLimit - liveProjectiles);
    for (const [enemy, flight] of this.members) {
      if (enemy.escapeFlight !== flight || !enemy.active || !enemy.alive) {
        if (flight.retired) this.retired++;
        else if (enemy.escapeFlight === flight && enemy.target?.hp <= 0) this.destroyed++;
        this.members.delete(enemy);
      }
    }
    // New fighters continue entering until the final approach; those already
    // engaged keep attacking while the last rift becomes a physical target.
    if (this.escape.elapsed >= this.spawnAt && this.escape.distanceLeft > 125) {
      this.spawnAt = this.escape.elapsed + profile.spawnInterval;
      this.spawnWave(profile);
    }
    if (this.escape.elapsed >= this.volleyAt) {
      this.volleyAt = this.escape.elapsed + profile.volleyInterval;
      this.fireCohort(profile);
    }
    this.peakAlive = Math.max(this.peakAlive, this.members.size);
  }

  spawnWave(profile) {
    const g = this.game;
    const count = Math.max(0, Math.min(profile.waveSize, profile.capacity - g.enemies.countAlive()));
    const formation = this.wave % 4;
    for (let i = 0; i < count; i++) {
      const serial = this.sequence++;
      const side = serial % 2 ? -1 : 1;
      let type = TYPES[profile.index][i % TYPES[profile.index].length];
      if (type === 'shielder' && [...this.members.keys()].filter(e => e.alive && e.type.shieldRadius).length >= 2) type = 'gunship';
      // Diverse formations fill depth as well as width, avoiding a single
      // unreadable pile of overlapping hulls at the player's aim point.
      const lane = (serial % 7) - 3;
      const x = formation === 0 ? lane * 6
        : formation === 1 ? side * (9 + i % 4 * 4.4)
          : formation === 2 ? lane * 6.6 : Math.sin(serial * 1.3) * 21;
      const y = formation === 0 ? 2 + Math.abs(lane) * 1.7
        : formation === 1 ? -4 + i % 4 * 4.5
          : formation === 2 ? (serial % 2 ? 10 : -5) : 3 + Math.cos(serial * 1.3) * 8;
      const z = -42 - serial % 4 * 12;
      const flight = {
        age: 0, hold: 10 + hash(serial * 3) * 5 + profile.intensity * 3,
        side, seed: serial * 1.71, retired: false, departing: false,
        trigger: false, aim: null, allowShot: this._allowShot,
      };
      const hpScale = (type === 'heavy' || type === 'elite' ? .5 : .74) + profile.intensity * .18;
      const opts = { fx: x, fy: y, fz: z, hpScale, escapeFlight: flight, scrapScale: .7 };
      let enemy = g.enemies.spawn(type, side * (35 + i % 3 * 4), y, -112 - i * 6, opts);
      if (!enemy) {
        // Per-hull pools stay fixed at 14. Borrow a free combat hull rather than
        // allocating or letting a fully occupied type stall the whole wave.
        for (const fallback of SHOOTERS) {
          enemy = g.enemies.spawn(fallback, side * (35 + i % 3 * 4), y, -112 - i * 6, opts);
          if (enemy) break;
        }
      }
      if (!enemy) break;
      enemy.damagePressure = profile.damageScale;
      enemy.fireT = 999;
      this.members.set(enemy, enemy.escapeFlight);
      this.spawned++;
    }
    this.wave++;
  }

  fireCohort(profile) {
    const eligible = [...this.members.keys()].filter(e => e.alive && e.type.projectileDamage > 0
      && e.escapeFlight.age > 1.65 && !e.escapeFlight.departing && e.z < -26
      && e.burstLeft === 0 && !e.escapeFlight.trigger);
    if (!eligible.length) return;
    const count = Math.min(profile.shooters, eligible.length);
    for (let i = 0; i < count; i++) {
      const enemy = eligible[(this.cohort + i) % eligible.length];
      const p = this.game.player;
      enemy.escapeFlight.trigger = true;
      // The first charge locks intent. The later burst cannot follow a dodge.
      enemy.escapeFlight.aim = { x: p.x + p.vx * .1, y: p.y + p.vy * .1 };
      enemy.damagePressure = profile.damageScale;
    }
    this.cohort += count;
  }

  allowShot(enemy, shot, speed) {
    if (!this.active || this._budget <= 0 || enemy.escapeFlight?.departing || enemy.z > -24) return false;
    const escape = this.escape;
    const sx = shot.sourceX ?? enemy.x, sy = shot.sourceY ?? enemy.y, sz = shot.sourceZ ?? enemy.z;
    const dx = shot.x - sx, dy = shot.y - sy, dz = -sz;
    const length = Math.max(1, Math.hypot(dx, dy, dz));
    // Match ProjectilePool's world drift, including the actual point where a
    // diagonal bullet crosses the ship plane rather than its nominal target.
    const arrival = dz / Math.max(1, dz / length * speed + escape.speed * .35);
    const hitX = sx + dx / length * speed * arrival;
    const hitY = sy + dy / length * speed * arrival;
    const margin = .9 + (shot.radius || .55);
    // Protect only the short collision crossing, not the entire lane forever.
    // Fire elsewhere remains dangerous throughout the 135-second pursuit.
    for (const gate of escape.route) {
      const eta = (gate.distance - escape.distance) / Math.max(1, escape.speed);
      if (eta < -.6) continue;
      if (eta > arrival + .8) break;
      if (Math.abs(eta - arrival) < .72
        && Math.abs(hitX - gate.x) < gate.halfWidth + margin
        && Math.abs(hitY - gate.y) < gate.halfHeight + margin) {
        this.gapProtections++;
        return false;
      }
    }
    // At the final mouth, shots still attack the outside approaches. The one
    // necessary physical aperture cannot be sealed with converging projectiles.
    if (escape.distanceLeft / Math.max(1, escape.speed) < arrival + .7
      && Math.hypot(hitX, hitY - 2) < 6.6 + (shot.radius || .55)) {
      this.gapProtections++;
      return false;
    }
    this._budget--;
    this.shots++;
    return true;
  }

  snapshot() {
    return { active: this.active, tier: this.profile.tier, capacity: this.profile.capacity,
      alive: [...this.members.keys()].filter(e => e.active && e.alive).length,
      spawned: this.spawned, retired: this.retired, destroyed: this.destroyed, waves: this.wave,
      shots: this.shots, gapProtections: this.gapProtections, peakAlive: this.peakAlive,
      peakProjectiles: this.peakProjectiles, projectileLimit: this.profile.projectileLimit };
  }

  dispose() {
    if (!this.active) return;
    this.active = false;
    for (const [enemy, flight] of this.members) if (enemy.escapeFlight === flight) enemy.despawn();
    this.members.clear();
  }
}
