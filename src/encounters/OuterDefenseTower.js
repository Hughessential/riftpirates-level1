import * as THREE from 'three';
import { P, IDENTITY } from '../core/Palette.js';
import { TowerEncounter } from './TowerEncounter.js';
import { buildOuterTower } from '../render/Structures.js';
import { Beam } from '../effects/Hazards.js';
import { OUTER_TOWER } from '../config/encounters.js';
import { Audio2 } from '../core/AudioManager.js';
import { rand, randi } from '../core/Utils.js';

/**
 * TOWER 1 — Border Skirmish (spec §10).
 * The teaching fight. Three attacks, four weak points, and a strict rule: every
 * attack telegraphs long enough to be read the first time you see it.
 *
 *   Attack A  Tracking Laser  — tracks, LOCKS (stops tracking), then fires
 *   Attack B  Turret Barrage  — burst of aimed shots from the cannon decks
 *   Attack C  Scout Drones    — deployed from the docks
 */
export class OuterDefenseTower extends TowerEncounter {
  constructor(game) {
    super(game, OUTER_TOWER, IDENTITY.tower1);

    const model = buildOuterTower();
    this.attach(model, new THREE.Vector3(0, -4, -46));

    const c = this.config;
    const p = this.parts;

    this.addModule('leftCannon', { part: p.leftCannon, hp: c.cannonHealth, radius: 3.2, label: 'LEFT CANNON DECK' });
    this.addModule('rightCannon', { part: p.rightCannon, hp: c.cannonHealth, radius: 3.2, label: 'RIGHT CANNON DECK' });
    this.addModule('emitter', { part: p.emitter, hp: c.emitterHealth, radius: 3, label: 'LASER EMITTER' });
    this.addModule('dockL', { part: p.dockL, hp: c.dockHealth, radius: 2.8, label: 'DRONE DOCK A' });
    this.addModule('dockR', { part: p.dockR, hp: c.dockHealth, radius: 2.8, label: 'DRONE DOCK B' });

    this.addCore('core', { part: p.core, hp: c.coreHealth, radius: 4 });

    // attack timers
    this.laserT = 3.5;
    this.turretT = 2.5;
    this.droneT = 5;
    this.drones = [];
  }

  onDestructionStart() {
    // cannons cook off independently before the tower goes
    for (const name of ['leftCannon', 'rightCannon', 'emitter']) {
      const m = this.modules.get(name);
      if (!m || !m.part.visible) continue;
      const wp = new THREE.Vector3();
      m.part.getWorldPosition(wp);
      this.game.fx.explode(wp.x, wp.y, wp.z, {
        count: 20,
        colors: [P.cyan, P.teal, P.white],
        power: 16,
        gravity: 0,
        arcColor: P.cyan,
      });
      m.part.visible = false;
    }
    // the cyan core flickers out
    if (this.parts.core.userData.halo) {
      this.parts.core.userData.halo.material.color.set(P.white);
    }
  }

  tick(dt) {
    const g = this.game;
    const p = g.player;

    // --- Attack A: tracking laser (dies with the emitter) ---
    if (this.isModuleAlive('emitter')) {
      this.laserT -= dt;
      if (this.laserT <= 0) {
        this.laserT = rand(...this.config.laserCooldown) + this.config.trackingDuration;
        const src = new THREE.Vector3();
        this.parts.emitter.getWorldPosition(src);

        const beam = new Beam({
          cx: src.x,
          cy: src.y,
          angle: Math.atan2(p.y - src.y, p.x - src.x),
          length: 90,
          width: 1.6,
          color: P.cyan,
          damage: this.config.laserDamage,
          trackTime: this.config.trackingDuration,
          lockTime: this.config.laserDelay,
          fireTime: this.config.laserDuration,
          // tracks the player, then locks: the beam must stop following before it fires
          tracker: () => ({ x: g.player.x, y: g.player.y }),
          label: 'TRACKING LASER',
        });
        g.addHazard(beam);
        Audio2.play('laser_warning', 0.45, 1.1);
        // the firing crack lands when the beam actually goes live
        g.after(this.config.trackingDuration + this.config.laserDelay, () =>
          Audio2.play('laser_fire', 0.6, 1)
        );
      }
    }

    // --- Attack B: light turret barrage (weakens as decks die) ---
    const decks = ['leftCannon', 'rightCannon'].filter((n) => this.isModuleAlive(n));
    if (decks.length > 0) {
      this.turretT -= dt;
      if (this.turretT <= 0) {
        this.turretT = rand(...this.config.turretCooldown) * (decks.length === 1 ? 1.5 : 1);
        for (const name of decks) {
          this._barrage(name);
        }
      }
    }

    // --- Attack C: scout drone support (stops when both docks die) ---
    const docks = ['dockL', 'dockR'].filter((n) => this.isModuleAlive(n));
    if (docks.length > 0) {
      this.droneT -= dt;
      if (this.droneT <= 0) {
        this.droneT = this.config.droneSpawnInterval * (docks.length === 1 ? 1.6 : 1);
        if (g.enemies.countAlive() < this.config.maxDrones) {
          for (const name of docks) {
            const wp = new THREE.Vector3();
            this.parts[name].getWorldPosition(wp);
            for (let i = 0; i < this.config.droneCount; i++) {
              g.enemies.spawn('scout', wp.x + rand(-2, 2), wp.y + rand(-1, 1), wp.z + 4, {
                fz: rand(-30, -18),
              });
            }
          }
        }
      }
    }

    // core halo pulse while it's still sealed
    if (this.parts.core.userData.halo && !this.core.targetable) {
      const s = 6 + Math.sin(this.t * 3) * 1.2;
      this.parts.core.userData.halo.scale.set(s, s, 1);
    }
  }

  /** Timed burst of aimed shots from one cannon deck. */
  _barrage(name) {
    const g = this.game;
    const part = this.parts[name];
    const wp = new THREE.Vector3();
    part.getWorldPosition(wp);
    const n = this.config.turretBurstCount;

    // clear spacing between shots (spec §10 B) so a burst is dodgeable
    g.scheduler.repeat(0.24, n, () => {
      if (!this.isModuleAlive(name) || this.state !== 'active') return;
      const p = g.player;
      g.projectiles.fireEnemy({
        x: wp.x,
        y: wp.y,
        z: wp.z + 4,
        tx: p.x + p.vx * 0.15,
        ty: p.y + p.vy * 0.15,
        tz: 0,
        speed: this.config.turretProjectileSpeed,
        damage: this.config.turretDamage,
        color: P.orange,
        label: 'TURRET BARRAGE',
      });
      Audio2.play('enemy_shot', 0.25, 1, 0.1);
    }, 'encounter');
  }
}
