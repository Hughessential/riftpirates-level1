import * as THREE from 'three';
import { P, IDENTITY } from '../core/Palette.js';
import { TowerEncounter } from './TowerEncounter.js';
import { buildMidriftTower } from '../render/Structures.js';
import { Beam, Zone, GravityWell } from '../effects/Hazards.js';
import { MIDRIFT_TOWER } from '../config/encounters.js';
import { Audio2 } from '../core/AudioManager.js';
import { rand, chance, TAU } from '../core/Utils.js';
import { ARENA } from '../player/Player.js';

/**
 * TOWER 2 — Gravity and Fire (spec §13).
 * Area denial. Nothing here kills you outright; it takes away your *space* and
 * dares you to keep your combo alive while moving.
 *
 *   Attack A  Gravity Wells    — pull you off your line, resisted by boosting
 *   Attack B  Sweeping Lasers  — counter-rotating beams with a safe gap
 *   Attack C  Pressure Zones   — telegraphed rings that pulse and knock back
 *   Attack D  Rift Overcharge  — at 40% core, everything speeds up
 */
export class MidriftPressureTower extends TowerEncounter {
  constructor(game) {
    super(game, MIDRIFT_TOWER, IDENTITY.tower2);

    const model = buildMidriftTower();
    this.attach(model, new THREE.Vector3(0, -6, -50));

    const c = this.config;
    const p = this.parts;

    this.addModule('gravityGen', { part: p.gravityGen, hp: c.gravityGenHealth, radius: 3.6, label: 'GRAVITY GENERATOR' });
    this.addModule('leftDeck', { part: p.leftDeck, hp: c.deckHealth, radius: 3.2, label: 'LEFT WEAPON DECK' });
    this.addModule('rightDeck', { part: p.rightDeck, hp: c.deckHealth, radius: 3.2, label: 'RIGHT WEAPON DECK' });
    this.addModule('pressureGen', { part: p.pressureGen, hp: c.pressureGenHealth, radius: 3.4, label: 'PRESSURE GENERATOR' });

    this.addCore('core', { part: p.core, hp: c.coreHealth, radius: 4.2 });

    this.wellT = 4;
    this.sweepT = 7;
    this.pressureT = 5;
    this.enemyT = 6;
    this.overcharged = false;
    this.sweepBeams = [];
  }

  /** Overcharge scales every cooldown down (spec §13 D). */
  get rate() {
    return this.overcharged ? 0.62 : 1;
  }

  _enterOvercharge() {
    this.overcharged = true;
    const g = this.game;
    g.hud.banner('RIFT OVERCHARGE', P.violet);
    g.hud.toast('OVERCHARGE', 'THE TOWER IS UNSTABLE', P.violet);
    Audio2.play('overload', 1, 0.9);
    Audio2.play('phase_change', 0.8, 1);
    g.camera3.shake(0.7);

    // purple emissive intensity increases
    if (this.parts.core.userData.halo) {
      this.parts.core.userData.halo.material.color.set(P.magenta);
    }
    this.parts.riftBeam.material.opacity = 0.75;
  }

  onDestructionStart() {
    // rings spin up, then tear apart
    this.ringBlowT = 0;
  }

  _destructionTick(dt) {
    // rings spin faster and shatter before the tower collapses inward
    for (const r of this.parts.ringMeshes) {
      r.rotation.z += r.userData.speed * dt * 14;
      r.scale.multiplyScalar(1 + dt * 0.5);
    }
    this.parts.riftBeam.scale.x *= 1 + dt * 3;
    this.parts.riftBeam.scale.z *= 1 + dt * 3;
    if (this.parts.riftBeam.material.opacity > 0) {
      this.parts.riftBeam.material.opacity -= dt * 0.7;
    }
    super._destructionTick(dt);
  }

  tick(dt) {
    const g = this.game;
    const p = g.player;
    const c = this.config;

    // --- rings orbit; the tower breathes ---
    for (const r of this.parts.ringMeshes) {
      r.rotation.z += r.userData.speed * dt * (this.overcharged ? 2.6 : 1);
    }
    this.parts.riftBeam.material.opacity = (this.overcharged ? 0.7 : 0.4) + Math.sin(this.t * 4) * 0.08;

    // --- Attack D: Overcharge trigger ---
    if (!this.overcharged && this.corePct <= c.overchargeAt && this.core.targetable) {
      this._enterOvercharge();
    }

    // --- Attack A: gravity wells (fewer once the generator dies) ---
    if (this.isModuleAlive('gravityGen')) {
      this.wellT -= dt;
      if (this.wellT <= 0) {
        this.wellT = rand(...c.wellCooldown) * this.rate;
        const n = this.isModuleAlive('gravityGen') ? c.wellCount : 1;
        for (let i = 0; i < n; i++) {
          g.addHazard(
            new GravityWell({
              x: rand(ARENA.minX + 6, ARENA.maxX - 6),
              y: rand(-4, 10),
              r: c.wellRadius,
              force: c.wellForce,
              life: c.wellLife,
              color: P.violet,
            })
          );
        }
        Audio2.play('overload', 0.4, 1.4);
      }
    }

    // --- Attack B: sweeping rift lasers (counter-rotating, with a safe gap) ---
    this.sweepT -= dt;
    if (this.sweepT <= 0) {
      this.sweepT = rand(...c.sweepCooldown) * this.rate;
      this._sweep();
    }

    // --- Attack C: pressure zones (slower once the generator dies) ---
    const pressureAlive = this.isModuleAlive('pressureGen');
    this.pressureT -= dt;
    if (this.pressureT <= 0) {
      this.pressureT = rand(...c.pressureCooldown) * this.rate * (pressureAlive ? 1 : 2.2);
      // one zone lands on the player's position, one leads them
      const spots = [
        { x: p.x, y: p.y },
        { x: p.x + p.vx * 0.6 + rand(-5, 5), y: p.y + rand(-3, 3) },
      ];
      const count = pressureAlive ? spots.length : 1;
      for (let i = 0; i < count; i++) {
        g.addHazard(
          new Zone({
            x: spots[i].x,
            y: spots[i].y,
            r: c.pressureRadius,
            color: P.violet,
            damage: c.pressureDamage,
            warnTime: this.overcharged ? 0.85 : 1.15,
            activeTime: 0.5,
            knockback: c.pressureKnockback,
            label: 'PRESSURE PULSE',
          })
        );
      }
    }

    // --- weapon decks: projectile fire ---
    const decks = ['leftDeck', 'rightDeck'].filter((n) => this.isModuleAlive(n));
    if (decks.length) {
      this.deckT = (this.deckT ?? 2) - dt;
      if (this.deckT <= 0) {
        this.deckT = rand(1.9, 2.8) * this.rate;
        for (const name of decks) {
          const wp = new THREE.Vector3();
          this.parts[name].getWorldPosition(wp);
          g.scheduler.repeat(0.18, 3, () => {
            if (!this.isModuleAlive(name) || this.state !== 'active') return;
            g.projectiles.fireEnemy({
              x: wp.x,
              y: wp.y,
              z: wp.z + 4,
              tx: g.player.x + g.player.vx * 0.18,
              ty: g.player.y + g.player.vy * 0.18,
              tz: 0,
              speed: 42,
              damage: 13,
              color: P.orange,
              label: 'HEAVY WEAPON DECK',
            });
            Audio2.play('enemy_shot', 0.22, 0.9, 0.1);
          }, 'encounter');
        }
      }
    }

    // --- gunship support ---
    this.enemyT -= dt;
    if (this.enemyT <= 0) {
      this.enemyT = c.gunshipInterval * this.rate;
      if (g.enemies.countAlive() < c.maxEnemies) {
        g.enemies.spawnOffscreen(chance(0.5) ? 'gunship' : 'scout', { fz: rand(-32, -20) });
      }
    }
  }

  /**
   * One clockwise beam, one counter-clockwise beam, launched from the tower's
   * core with a readable gap between them (spec §13 B).
   */
  _sweep() {
    const g = this.game;
    const c = this.config;
    const src = new THREE.Vector3();
    this.parts.core.getWorldPosition(src);

    const start = rand(0, TAU);
    const dirs = this.overcharged ? [1, -1, 1] : [1, -1];

    dirs.forEach((dir, i) => {
      // stagger the launches so the gap between beams stays legible
      g.after(i * 0.35, () => {
        if (this.state !== 'active') return;
        g.addHazard(
          new Beam({
            cx: src.x,
            cy: src.y,
            angle: start + (i * TAU) / dirs.length,
            length: 95,
            width: 1.8,
            color: P.violet,
            damage: c.sweepDamage,
            trackTime: 0.9,
            lockTime: 0.3,
            fireTime: c.sweepDuration,
            sweep: dir * c.sweepSpeed * (this.overcharged ? 1.4 : 1),
            label: 'MIDRIFT SWEEPING LASER',
          })
        );
      });
    });

    Audio2.play('laser_warning', 0.5, 0.85);
    g.after(1.2, () => Audio2.play('laser_fire', 0.55, 0.8));
  }
}
