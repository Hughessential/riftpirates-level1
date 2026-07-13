import * as THREE from 'three';
import { P, IDENTITY, DEBRIS } from '../core/Palette.js';
import { TowerEncounter } from './TowerEncounter.js';
import { buildInhibitor } from '../render/Structures.js';
import { Shockwave } from '../effects/Hazards.js';
import { INHIBITOR } from '../config/encounters.js';
import { Audio2 } from '../core/AudioManager.js';
import { rand, chance, TAU } from '../core/Utils.js';

/**
 * THE INHIBITOR CORE (spec §19). Not "Tower 4" — a machine to be dismantled in
 * sequence:
 *
 *   Destroy Conduit 1 -> 2 -> 3  ->  shields destabilise  ->  core exposed
 *   ->  OVERLOAD damage window   ->  destroy the core
 *
 *   Attack A  Overload Pulse   — expanding rings; the signature boost-through
 *   Attack B  Rotating Shields — physically eat your bolts; shoot the gaps
 *   Attack C  Conduit Discharge— directed bolts from each live conduit
 *   Attack D  System Overload  — the window. Miss it and the shields come back,
 *                                but only once (no infinite loop).
 */
export class InhibitorEncounter extends TowerEncounter {
  constructor(game) {
    super(game, INHIBITOR, IDENTITY.inhibitor);

    const model = buildInhibitor();
    this.attach(model, new THREE.Vector3(0, 2, -52));

    const c = this.config;
    const p = this.parts;

    for (let i = 0; i < 3; i++) {
      this.addModule(`conduit${i}`, {
        part: p[`conduit${i}`],
        hp: c.conduitHealth,
        radius: 3.4,
        label: `OVERLOAD CONDUIT ${i + 1}`,
      });
    }

    this.addCore('core', { part: p.core, hp: c.coreHealth, radius: 5 });

    this.pulseT = 4;
    this.dischargeT = 3;
    this.shieldsUp = true;
    this.overloading = false;
    this.overloadT = 0;
    this.recovered = false;

    // rotating shields eat player fire until the conduits are gone
    this.game.projectileBlockers.push(this);
  }

  /**
   * A bolt is eaten if it crosses the shield annulus *inside* an arc segment.
   * Threading a gap is the whole skill of this fight, so this test has to match
   * exactly what's drawn.
   */
  blocks(x, y, z) {
    if (!this.shieldsUp) return false;

    const c = this.group.position;
    // only inside the machine's z-slab
    if (z > c.z + 10 || z < c.z - 8) return false;

    const dx = x - c.x;
    const dy = y - c.y;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);

    for (const holder of this.parts.shieldArcs) {
      const inner = holder.userData.inner ? 6.5 : 9.5;
      const outer = holder.userData.inner ? 8.2 : 11.2;
      if (r < inner || r > outer) continue;

      const arcWidth = (TAU / 3) * 0.62;
      const rot = holder.rotation.z;
      for (let i = 0; i < 3; i++) {
        const a0 = (i / 3) * TAU + rot;
        // normalise the angular delta into [0, TAU)
        let d = (ang - a0) % TAU;
        if (d < 0) d += TAU;
        if (d < arcWidth) return true;
      }
    }
    return false;
  }

  onModuleDestroyed(name) {
    const g = this.game;
    const idx = Number(name.replace('conduit', ''));
    const live = this.aliveModules();

    g.hud.toast(`CONDUIT ${idx + 1} DOWN`, live > 0 ? `${live} REMAINING` : 'SHIELDS FAILING', P.orange);

    // orange arcs jump between the surviving conduits
    const wp = new THREE.Vector3();
    this.parts[name].getWorldPosition(wp);
    g.fx.explode(wp.x, wp.y, wp.z, {
      count: 26,
      colors: DEBRIS.inhibitor,
      power: 20,
      gravity: 0,
      arcColor: P.orange,
    });

    if (live === 0) this._destabilise();
  }

  /** All conduits down: shields collapse, the core opens, the clock starts. */
  _destabilise() {
    const g = this.game;
    this.shieldsUp = false;
    this.overloading = true;
    this.overloadT = this.config.overloadWindow;

    this.core.targetable = true;
    this.core.damageScale = 1;

    // shatter the rotating shields
    for (const holder of this.parts.shieldArcs) {
      for (const arc of holder.children) arc.visible = false;
    }
    const wp = this.group.position;
    g.fx.explode(wp.x, wp.y, wp.z + 4, {
      count: 50,
      colors: [P.orange, P.amber, P.white],
      power: 30,
      gravity: 0,
      spread: 9,
      arcColor: P.orange,
      flashScale: 5,
    });

    Audio2.play('overload', 1, 1);
    Audio2.play('phase_change', 0.9, 0.9);
    g.camera3.shake(1);
    g.hud.banner('SYSTEM OVERLOAD', P.orange);
    g.hud.toast('CORE EXPOSED', 'BREAK THE SEAL', P.orange);
    g.hud.setObjectiveWarning(true);
    g.hud.startTimer(this.overloadT, 'OVERLOAD WINDOW');
  }

  /** The window closed with the core alive. Shields recover — exactly once. */
  _recover() {
    const g = this.game;
    this.overloading = false;
    this.recovered = true;
    this.shieldsUp = true;

    this.core.targetable = false;
    this.core.damageScale = 0;

    for (const holder of this.parts.shieldArcs) {
      for (const arc of holder.children) arc.visible = true;
    }

    // bring back a single conduit at reduced health, so the retry is quick
    const m = this.modules.get('conduit0');
    m.target.alive = true;
    m.target.targetable = true;
    m.target.hp = this.config.conduitHealth * 0.5;
    m.target.maxHp = this.config.conduitHealth * 0.5;
    m.part.visible = true;

    Audio2.play('shield_break', 1, 0.7);
    g.hud.banner('SHIELDS RESTORED', P.orange);
    g.hud.toast('SEAL HOLDING', 'BREAK THE LAST CONDUIT', P.orange);
    g.hud.stopTimer();
    g.hud.setObjectiveWarning(false);
    g.camera3.shake(0.6);
  }

  onDestructionStart() {
    // braces break, shields shatter, the crystal cracks
    for (const b of this.parts.braces.children) b.visible = false;
    for (const holder of this.parts.shieldArcs) {
      for (const arc of holder.children) arc.visible = false;
    }
    this.game.hud.stopTimer();
    this.game.hud.banner('INHIBITOR DISABLED', P.orange);
    this.game.hud.toast('PATH TO THE NEXUS OPEN', '', P.magenta);
    Audio2.play('overload', 1, 0.7);
  }

  onDestroyed() {
    // the Nexus rift tears open behind the wreck — LevelDirector picks this up
    this.game.openNexusRift(this.group.position);
  }

  dispose() {
    const i = this.game.projectileBlockers.indexOf(this);
    if (i >= 0) this.game.projectileBlockers.splice(i, 1);
    this.game.hud.stopTimer();
    super.dispose();
  }

  tick(dt) {
    const g = this.game;
    const c = this.config;
    const p = g.player;

    // --- Attack B: rotating shields ---
    if (this.shieldsUp) {
      for (const holder of this.parts.shieldArcs) {
        holder.rotation.z += holder.userData.speed * dt;
      }
    }

    // --- the crystal ---
    const core = this.parts.core;
    core.userData.crystal.rotation.y += dt * 0.7;
    core.userData.crystal.rotation.x += dt * 0.4;
    core.userData.cage.rotation.y -= dt * 0.5;
    const beat = this.overloading ? 1.25 + 0.35 * Math.sin(this.t * 12) : 1 + 0.06 * Math.sin(this.t * 3);
    core.userData.crystal.scale.setScalar(beat);
    core.userData.halo.scale.setScalar((this.overloading ? 26 : 16) * (0.9 + 0.1 * Math.sin(this.t * 8)));

    // --- Attack D: the overload window ---
    if (this.overloading) {
      this.overloadT -= dt;
      g.hud.updateTimer(this.overloadT);

      // orange lightning fills the structure
      if (chance(dt * 14)) {
        const wp = this.group.position;
        g.fx.explode(
          wp.x + rand(-14, 14),
          wp.y + rand(-14, 14),
          wp.z + rand(-2, 4),
          { count: 3, colors: [P.orange, P.amber, P.white], power: 8, gravity: 0, arcColor: P.orange, flashScale: 0.4 }
        );
      }

      if (this.overloadT <= 0) {
        if (!this.recovered && c.shieldRecoverOnce) {
          this._recover();
        } else {
          // Second time through, the window simply never closes. No infinite loop.
          this.overloading = false;
          g.hud.stopTimer();
          g.hud.toast('SEAL BROKEN', 'CORE PERMANENTLY EXPOSED', P.orange);
        }
      }
    }

    // If a recovered conduit dies, destabilise again — this time for good.
    if (this.recovered && !this.overloading && this.aliveModules() === 0 && !this.core.targetable) {
      this._destabilise();
      // the window can't close a second time
      this.overloadT = 1e9;
      g.hud.stopTimer();
    }

    // --- Attack A: overload pulses (faster during overload) ---
    this.pulseT -= dt;
    if (this.pulseT <= 0) {
      this.pulseT = rand(...c.pulseCooldown) * (this.overloading ? 0.55 : 1);
      const wp = this.group.position;
      g.addHazard(
        new Shockwave({
          x: wp.x,
          y: wp.y,
          maxR: 46,
          speed: c.pulseSpeed,
          thickness: 2.4,
          color: P.orange,
          damage: c.pulseDamage,
          delay: 0.5,
          label: 'OVERLOAD PULSE',
        })
      );
      Audio2.play('overload', 0.5, 1.3);
    }

    // --- Attack C: conduit discharge ---
    const live = [...this.modules.entries()].filter(([, m]) => m.target.alive);
    if (live.length) {
      this.dischargeT -= dt;
      if (this.dischargeT <= 0) {
        this.dischargeT = rand(...c.dischargeCooldown);
        for (const [name] of live) {
          const wp = new THREE.Vector3();
          this.parts[name].getWorldPosition(wp);
          // visible charge-up, then a predictable bolt
          const halo = this.parts[name].userData.halo;
          if (halo) halo.material.color.set(P.white);
          g.after(0.6, () => {
            if (!this.isModuleAlive(name) || this.state !== 'active') return;
            if (halo) halo.material.color.set(P.orange);
            g.projectiles.fireEnemy({
              x: wp.x,
              y: wp.y,
              z: wp.z + 4,
              tx: g.player.x + g.player.vx * 0.2,
              ty: g.player.y + g.player.vy * 0.2,
              tz: 0,
              speed: 44,
              damage: c.dischargeDamage,
              color: P.amber,
              radius: 1.2,
              label: 'CONDUIT DISCHARGE',
              heavy: true,
            });
            Audio2.play('heavy_shot', 0.4, 1.2, 0.08);
          });
        }
      }
    }
  }
}
