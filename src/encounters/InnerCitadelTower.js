import * as THREE from 'three';
import { P, IDENTITY } from '../core/Palette.js';
import { TowerEncounter } from './TowerEncounter.js';
import { buildInnerCitadel } from '../render/Structures.js';
import { Beam, Zone } from '../effects/Hazards.js';
import { INNER_CITADEL } from '../config/encounters.js';
import { Audio2 } from '../core/AudioManager.js';
import { rand, chance, clamp } from '../core/Utils.js';
import { ARENA } from '../player/Player.js';

/**
 * TOWER 3 — Elite Garrison (spec §16).
 * A fortress that owns the arena. The lesson is target priority: the keep is
 * nearly immune until both shield generators fall, and the room keeps shrinking.
 *
 *   Attack A  Shielded Walls   — body takes ~10% damage while generators live
 *   Attack B  Elite Defenders  — deployed from the dock; killing it slows them
 *   Attack C  Crossfire        — turrets carve fixed lanes across the arena
 *   Attack D  Hazard Zones     — squares of the arena go lethal
 */
export class InnerCitadelTower extends TowerEncounter {
  constructor(game) {
    super(game, INNER_CITADEL, IDENTITY.tower3);

    const model = buildInnerCitadel();
    this.attach(model, new THREE.Vector3(0, -5, -48));

    const c = this.config;
    const p = this.parts;

    this.addModule('shieldGenA', { part: p.shieldGenA, hp: c.shieldGenHealth, radius: 3.4, label: 'SHIELD GENERATOR A' });
    this.addModule('shieldGenB', { part: p.shieldGenB, hp: c.shieldGenHealth, radius: 3.4, label: 'SHIELD GENERATOR B' });
    this.addModule('dock', { part: p.dock, hp: c.dockHealth, radius: 4, label: 'ELITE DOCK' });
    this.addModule('turretL', { part: p.turretL, hp: c.turretHealth, radius: 2.8, label: 'CROSSFIRE TURRET A' });
    this.addModule('turretR', { part: p.turretR, hp: c.turretHealth, radius: 2.8, label: 'CROSSFIRE TURRET B' });

    // The core is shootable from the start, but shields make it pointless —
    // that's the lesson, and the "SHIELDED" popups teach it.
    this.addCore('core', {
      part: p.core,
      hp: c.coreHealth,
      radius: 4,
      damageScale: c.shieldedDamageScale,
      targetable: true,
    });

    this.eliteT = 6;
    this.crossfireT = 5;
    this.hazardT = 4;
    this.shieldsDown = false;

    // the arena visually tightens (spec §16 layout)
    this.bounds = {
      minX: ARENA.minX * c.arenaSquish,
      maxX: ARENA.maxX * c.arenaSquish,
    };
    this._buildBoundary();
  }

  /** Danger boundary rather than collision geometry — never trap the player. */
  _buildBoundary() {
    this.boundary = new THREE.Group();
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 30),
        new THREE.MeshBasicMaterial({
          color: P.red,
          transparent: true,
          opacity: 0.1,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      wall.position.set(sx * this.bounds.maxX, 2, -20);
      wall.rotation.y = Math.PI / 2;
      this.boundary.add(wall);
    }
    this.game.scene.add(this.boundary);
  }

  onModuleDestroyed(name) {
    // Killing both generators drops the shield — the whole fight opens up.
    if ((name === 'shieldGenA' || name === 'shieldGenB') && !this.shieldsDown) {
      if (!this.isModuleAlive('shieldGenA') && !this.isModuleAlive('shieldGenB')) {
        this.shieldsDown = true;
        this.core.damageScale = 1;
        this.parts.shieldDome.visible = false;
        Audio2.play('shield_break', 1, 0.8);
        Audio2.play('phase_change', 0.8, 1.1);
        this.game.camera3.shake(0.8);
        this.game.hud.banner('SHIELDS DOWN', P.red);
        this.game.hud.toast('CITADEL EXPOSED', 'CORE VULNERABLE', P.red);
        this.game.hud.setObjectiveWarning(true);

        const wp = new THREE.Vector3();
        this.parts.shieldDome.getWorldPosition(wp);
        this.game.fx.explode(wp.x, wp.y, wp.z, {
          count: 40,
          colors: [P.violet, P.white, P.pink],
          power: 26,
          gravity: 0,
          spread: 8,
          arcColor: P.violet,
          flashScale: 4,
        });
      }
    }
    // NOTE: no exposeCoreIfClear() here — the core is gated on shields, not on
    // every module dying.
  }

  onDestructionStart() {
    // banners tear away, turrets cook off
    for (const b of this.parts.banners.children) b.visible = false;
    const wp = new THREE.Vector3();
    this.parts.banners.getWorldPosition(wp);
    this.game.fx.explode(wp.x, wp.y + 4, wp.z, {
      count: 24,
      colors: [P.red, P.orange, P.gold],
      power: 14,
      gravity: 0,
      spread: 6,
    });
    if (this.boundary) {
      this.game.scene.remove(this.boundary);
      this.boundary = null;
    }
  }

  dispose() {
    if (this.boundary) this.game.scene.remove(this.boundary);
    super.dispose();
  }

  tick(dt) {
    const g = this.game;
    const p = g.player;
    const c = this.config;

    // shield dome shimmer while it holds
    if (!this.shieldsDown) {
      this.parts.shieldDome.rotation.y += dt * 0.25;
      this.parts.shieldDome.material.opacity = 0.13 + 0.06 * Math.sin(this.t * 3);
    }

    // --- boundary pushback: leave the arena and you get hurt, not walled in ---
    for (const sx of [-1, 1]) {
      const edge = sx * this.bounds.maxX;
      if (sx * p.x > sx * edge) {
        p.x = clamp(p.x, this.bounds.minX, this.bounds.maxX);
        p.knockback(edge * 1.3, p.y, 14);
        if (chance(dt * 2)) {
          p.takeDamage(9, 'CITADEL PERIMETER');
          g.hud.toast('PERIMETER', 'STAY IN THE ARENA', P.red);
        }
      }
    }
    if (this.boundary) {
      for (const w of this.boundary.children) {
        const near = Math.abs(Math.abs(p.x) - this.bounds.maxX) < 6;
        w.material.opacity = near ? 0.22 + 0.1 * Math.sin(this.t * 12) : 0.08;
      }
    }

    // --- Attack B: elite defenders ---
    const dockAlive = this.isModuleAlive('dock');
    this.eliteT -= dt;
    if (this.eliteT <= 0) {
      this.eliteT = dockAlive ? c.eliteInterval : c.eliteIntervalNoDock;
      if (g.enemies.countAlive() < c.maxElites + 2) {
        const wp = new THREE.Vector3();
        this.parts.dock.getWorldPosition(wp);
        g.enemies.spawn('elite', wp.x + rand(-4, 4), wp.y + 2, wp.z + 6, {
          fz: rand(-30, -20),
          elite: true,
        });
        // an elite rarely arrives alone
        if (chance(0.5)) {
          g.enemies.spawnOffscreen('gunship', { fz: rand(-34, -24) });
        }
        Audio2.play('laser_warning', 0.35, 0.8);
        g.hud.toast('ELITE DEFENDER', 'INBOUND', P.pink);
      }
    }

    // --- Attack C: crossfire turrets (each carves its own lane) ---
    const turrets = ['turretL', 'turretR'].filter((n) => this.isModuleAlive(n));
    if (turrets.length) {
      this.crossfireT -= dt;
      if (this.crossfireT <= 0) {
        this.crossfireT = rand(...c.crossfireCooldown) * (turrets.length === 1 ? 1.6 : 1);
        this._crossfire(turrets);
      }
    }

    // --- Attack D: hazard zones ---
    this.hazardT -= dt;
    if (this.hazardT <= 0) {
      this.hazardT = rand(...c.hazardCooldown);
      for (let i = 0; i < c.hazardCount; i++) {
        g.addHazard(
          new Zone({
            x: rand(this.bounds.minX + 4, this.bounds.maxX - 4),
            y: rand(-6, 11),
            r: 6.5,
            color: P.pink,
            damage: c.hazardDamage,
            warnTime: 1.2,
            activeTime: 1.4,
            square: true,
            label: 'CITADEL HAZARD ZONE',
          })
        );
      }
    }
  }

  /**
   * Left turret fires flat, right turret fires on a diagonal, leaving a safe
   * wedge between the lanes (spec §16 C).
   */
  _crossfire(turrets) {
    const g = this.game;
    const c = this.config;

    turrets.forEach((name, i) => {
      const wp = new THREE.Vector3();
      this.parts[name].getWorldPosition(wp);
      const flat = name === 'turretL';
      // aim across the arena: flat lane, or angled down through the middle
      const angle = flat
        ? (wp.x < 0 ? 0 : Math.PI)
        : (wp.x < 0 ? 0.42 : Math.PI - 0.42);

      g.after(i * 0.3, () => {
        if (!this.isModuleAlive(name) || this.state !== 'active') return;
        g.addHazard(
          new Beam({
            cx: wp.x,
            cy: wp.y,
            angle,
            length: 90,
            width: 1.7,
            color: P.red,
            damage: c.crossfireDamage,
            trackTime: 1.1,
            lockTime: 0.35,
            fireTime: 1.1,
            label: 'CROSSFIRE TURRET',
          })
        );
      });
    });
    Audio2.play('laser_warning', 0.45, 1.2);
  }
}
