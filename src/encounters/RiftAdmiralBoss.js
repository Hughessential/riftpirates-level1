import * as THREE from 'three';
import { P, IDENTITY, DEBRIS } from '../core/Palette.js';
import { TowerEncounter } from './TowerEncounter.js';
import { buildRiftAdmiral } from '../render/Structures.js';
import { Beam, Zone, Shockwave, VoidAnchor, CollapseField } from '../effects/Hazards.js';
import { RIFT_ADMIRAL } from '../config/encounters.js';
import { Target, PRIORITY } from '../combat/Target.js';
import { Audio2 } from '../core/AudioManager.js';
import { SCORE } from '../systems/ScoreSystem.js';
import { rand, chance, pick, clamp, TAU } from '../core/Utils.js';
import { ARENA } from '../player/Player.js';

/**
 * THE RIFT ADMIRAL (spec §22-§26).
 *
 * One boss, one health pool, four readable phases. The model never changes —
 * what changes is which weapons are live, how they combine, and how long the
 * core stays open.
 *
 * The core cycle (spec §25): survive a major attack -> the Admiral vents ->
 * the Nexus core irises open -> damage window at 3x -> it closes -> new pattern.
 * Killing a cannon battery forces a vent early, so aggression is rewarded.
 */
export class RiftAdmiralBoss extends TowerEncounter {
  constructor(game) {
    super(game, RIFT_ADMIRAL, IDENTITY.boss);

    const model = buildRiftAdmiral();
    this.attach(model, new THREE.Vector3(0, 4, -62));

    const c = this.config;
    const p = this.parts;

    // --- one health pool; body and core both feed it ---
    this.maxBossHp = c.maxHealth;
    this.bossHp = c.maxHealth;

    this.bodyTarget = new Target({
      object3D: p.body,
      hp: c.maxHealth,
      radius: 15,
      priority: PRIORITY.BODY,
      kind: 'body',
      label: 'RIFT ADMIRAL',
      damageScale: c.bodyDamageScale,
      onDamage: (d) => this._bossDamage(d),
    });
    this.bodyTarget.targetable = true;
    this.targets.push(this.bodyTarget);
    game.targets.push(this.bodyTarget);

    this.coreTarget = new Target({
      object3D: p.core,
      hp: c.maxHealth,
      radius: 6,
      priority: PRIORITY.WEAK_POINT - 5, // when open, it outranks everything
      kind: 'core',
      label: 'NEXUS CORE',
      damageScale: c.coreDamageScale,
      onDamage: (d) => this._bossDamage(d),
    });
    // Both colliders feed one health pool; area pulses must hit it only once.
    this.bodyTarget.damageGroup = this.coreTarget.damageGroup = this;
    this.coreTarget.targetable = false;
    this.targets.push(this.coreTarget);
    game.targets.push(this.coreTarget);

    // --- modules (change the fight, don't drain the pool) ---
    this.addModule('cannonL', { part: p.cannonL, hp: c.cannonHealth, radius: 4.5, label: 'LEFT CANNON BATTERY' });
    this.addModule('cannonR', { part: p.cannonR, hp: c.cannonHealth, radius: 4.5, label: 'RIGHT CANNON BATTERY' });
    this.addModule('tendrilControl', { part: p.tendrilControl, hp: c.tendrilControlHealth, radius: 3.6, label: 'TENDRIL CONTROLS' });

    // --- state ---
    this.phase = 0; // index into config.phases
    this.coreOpen = false;
    this.coreT = 0;
    this.ventPending = false;
    this.attackT = 3.5;
    this.artilleryT = 2.5;
    this.squadronT = 8;
    this.collapseT = 20;
    this.introDone = false;
    this.bobPhase = 0;
    this.portals = [];
  }

  // --- health --------------------------------------------------------------

  get healthPct() {
    return this.bossHp / this.maxBossHp;
  }

  get maxHp() {
    return this.maxBossHp;
  }

  get hp() {
    return this.bossHp;
  }

  _bossDamage(dealt) {
    if (this.state !== 'active') return;
    this.bossHp = Math.max(0, this.bossHp - dealt);

    // keep the two proxy targets alive; the boss pool is the real health
    this.bodyTarget.hp = this.bodyTarget.maxHp;
    this.coreTarget.hp = this.coreTarget.maxHp;

    const thresholds = this.config.phases;
    const pct = this.healthPct;
    if (this.phase < thresholds.length - 1 && pct <= thresholds[this.phase + 1]) {
      this._advancePhase();
    }
    if (this.bossHp <= 0) {
      // Killing him clears the phase he was standing in, so a win reads 4 / 4.
      this.game.stats.bossPhases += 1;
      this.beginDestruction();
    }
  }

  // --- phases --------------------------------------------------------------

  _advancePhase() {
    this.phase += 1;
    const g = this.game;
    const name = this.config.phaseNames[this.phase];

    // brief invulnerable beat so a phase change never feels like a cheap shot
    this.coreOpen = false;
    this._closeCore();
    for (const h of g.hazards) h.done = true;
    g.projectiles.enemy.forEach((b) => {
      if (b.active) g.projectiles.killEnemyBolt(b);
    });

    this.attackT = 2.2;
    this.artilleryT = 1.8;

    Audio2.play('phase_change', 1, 0.9);
    Audio2.play('boss_taunt', 0.55, 0.8);
    g.camera3.shake(1);
    g.hud.banner(name, P.magenta);
    g.hud.setBossPhase(this.phase + 1, name);
    g.score.add(SCORE.BOSS_PHASE, 'BOSS PHASE');
    g.heat.onWeakPointDestroyed();
    g.stats.bossPhases += 1;

    const wp = this.group.position;
    g.fx.explode(wp.x, wp.y, wp.z + 8, {
      count: 60,
      colors: DEBRIS.boss,
      power: 30,
      gravity: 0,
      spread: 12,
      arcColor: P.magenta,
      flashColor: 0xff2ed2,
      flashScale: 6,
    });

    // eyes and core burn brighter every phase
    const intensity = 1 + this.phase * 0.45;
    for (const e of this.parts.eyes) e.scale.setScalar(3.2 * intensity);

    // Phase 4: the Admiral starts coming apart before he dies
    if (this.phase === 3) {
      g.hud.toast('TOTAL DOMINION', 'HE IS UNSTABLE', P.gold);
    }
  }

  onModuleDestroyed(name) {
    // Breaking a battery forces the core open — aggression opens the window.
    if (name === 'cannonL' || name === 'cannonR') {
      this.game.hud.toast('BATTERY DESTROYED', 'THE CORE IS EXPOSED', P.gold);
      this._openCore(this.config.coreOpenTime * 0.8);
    }
    if (name === 'tendrilControl') {
      this.game.hud.toast('TENDRILS CRIPPLED', 'SWEEPS SLOWED', P.violet);
    }
    // deliberately NOT exposeCoreIfClear(): the core is on a cycle, not a gate
  }

  // --- the core window -----------------------------------------------------

  _openCore(duration = this.config.coreOpenTime) {
    if (this.coreOpen || this.state !== 'active') return;
    this.coreOpen = true;
    // Phase 4 keeps the core exposed longer (spec §23)
    this.coreT = duration * (this.phase >= 3 ? 1.6 : 1);

    this.coreTarget.targetable = true;
    Audio2.play('overload', 0.9, 1.1);
    this.game.hud.toast('NEXUS CORE OPEN', 'HIT IT', P.gold);
    this.game.hud.setObjectiveWarning(true);
    this.game.camera3.shake(0.4);
  }

  _closeCore() {
    if (!this.coreOpen) {
      this.coreTarget.targetable = false;
      return;
    }
    this.coreOpen = false;
    this.coreTarget.targetable = false;
    this.game.hud.setObjectiveWarning(false);
    Audio2.play('shield_break', 0.7, 0.9);
  }

  // --- attacks -------------------------------------------------------------

  /** Which attacks are live in the current phase (spec §23). */
  _attackPool() {
    const pool = ['laserBarrage', 'voidAnchor'];
    if (this.phase >= 1) pool.push('squadron', 'tendrilSweep');
    if (this.phase >= 2) pool.push('hazards', 'collapse', 'tendrilSweep');
    if (this.phase >= 3) pool.push('laserBarrage', 'collapse', 'voidAnchor');
    return pool;
  }

  _fireAttack() {
    const kind = pick(this._attackPool());
    switch (kind) {
      case 'laserBarrage':
        this._laserBarrage();
        break;
      case 'voidAnchor':
        this._voidAnchor();
        break;
      case 'squadron':
        this._squadron();
        break;
      case 'tendrilSweep':
        this._tendrilSweep();
        break;
      case 'hazards':
        this._hazards();
        break;
      case 'collapse':
        this._collapse();
        break;
      default:
        break;
    }
    // after every major pattern, the Admiral vents and the core opens
    this.ventPending = true;
  }

  /** Attack A: three vertical lanes of purple death, each with a warning line. */
  _laserBarrage() {
    const g = this.game;
    const c = this.config.laserBarrage;
    const lanes = c.lanes + (this.phase >= 3 ? 1 : 0);

    // lanes spread across the arena, leaving gaps to stand in
    const width = ARENA.maxX - ARENA.minX;
    const step = width / (lanes + 1);
    const jitter = rand(-step * 0.25, step * 0.25);

    for (let i = 0; i < lanes; i++) {
      const x = ARENA.minX + step * (i + 1) + jitter;
      g.after(i * 0.18, () => {
        if (this.state !== 'active') return;
        g.addHazard(
          new Beam({
            cx: x,
            cy: ARENA.minY - 12,
            angle: Math.PI / 2, // vertical column
            length: 70,
            width: 2.1,
            color: P.magenta,
            damage: c.damage,
            trackTime: 1.15,
            lockTime: 0.35,
            fireTime: 0.9,
            label: 'RIFT LASER BARRAGE',
          })
        );
      });
    }
    Audio2.play('laser_warning', 0.55, 0.9);
    g.after(1.5, () => Audio2.play('laser_fire', 0.7, 0.75));
  }

  /** Attack B: mark the player, drop an anchor, radial shockwave you can boost. */
  _voidAnchor() {
    const g = this.game;
    const c = this.config.voidAnchor;
    const p = g.player;

    g.addHazard(
      new VoidAnchor({
        x: p.x,
        y: p.y,
        markTime: c.markTime * (this.phase >= 3 ? 0.8 : 1),
        color: P.magenta,
        damage: c.damage,
        onImpact: (ix, iy) => {
          g.addHazard(
            new Shockwave({
              x: ix,
              y: iy,
              maxR: 34,
              speed: 26,
              thickness: 2.6,
              color: P.magenta,
              damage: c.damage,
              label: 'VOID ANCHOR SHOCKWAVE',
            })
          );
          g.fx.explode(ix, iy, 0, {
            count: 30,
            colors: [P.magenta, P.violet, P.white],
            power: 22,
            gravity: 0,
            arcColor: P.magenta,
            flashScale: 3,
          });
          g.camera3.shake(0.7);
          Audio2.play('phase_change', 0.6, 1.2);
        },
      })
    );
    Audio2.play('anchor_launch', 0.6, 1);
  }

  /** Attack C: rift portals disgorge a squadron — reuses the standard enemies. */
  _squadron() {
    const g = this.game;
    const c = this.config.squadron;
    const count = c.count + this.phase;

    for (let i = 0; i < 2; i++) {
      const px = rand(ARENA.minX + 6, ARENA.maxX - 6);
      const py = rand(0, 10);
      this._spawnPortal(px, py, -34);

      g.after(0.8, () => {
        if (this.state !== 'active') return;
        for (let k = 0; k < Math.ceil(count / 2); k++) {
          const type = this.phase >= 2 ? pick(['elite', 'gunship', 'heavy']) : pick(['scout', 'gunship']);
          g.enemies.spawn(type, px + rand(-3, 3), py + rand(-2, 2), -34, {
            fz: rand(-30, -18),
            elite: type === 'elite',
          });
        }
      });
    }
    g.hud.toast('RIFT SQUADRON', 'INBOUND', P.violet);
  }

  _spawnPortal(x, y, z) {
    const g = this.game;
    const portal = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 4, 24),
      new THREE.MeshBasicMaterial({
        color: P.violet,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    portal.position.set(x, y, z);
    this.game.scene.add(portal);
    this.portals.push({ mesh: portal, t: 0, life: 2.2 });
    Audio2.play('overload', 0.5, 1.5);
  }

  /** Attack F: mechanical arms sweep the arena on a telegraphed arc. */
  _tendrilSweep() {
    const g = this.game;
    const c = this.config.tendrilSweep;
    const slowed = !this.isModuleAlive('tendrilControl');
    const wp = this.group.position;

    const dir = chance(0.5) ? 1 : -1;
    g.addHazard(
      new Beam({
        cx: wp.x,
        cy: wp.y - 6,
        angle: dir > 0 ? Math.PI + 0.4 : -0.4,
        length: 80,
        width: 2.4,
        color: P.violet,
        damage: c.damage,
        trackTime: 1.2,
        lockTime: 0.3,
        fireTime: 3.4,
        sweep: dir * (slowed ? 0.28 : 0.5),
        label: 'TENDRIL SWEEP',
      })
    );
    this.tendrilLash = 1;
    Audio2.play('laser_warning', 0.4, 0.7);
  }

  /** Arena hazards appear from phase 3. */
  _hazards() {
    const g = this.game;
    for (let i = 0; i < 3; i++) {
      g.addHazard(
        new Zone({
          x: rand(ARENA.minX + 5, ARENA.maxX - 5),
          y: rand(-6, 11),
          r: 6.5,
          color: P.violet,
          damage: 22,
          warnTime: 1.2,
          activeTime: 1.3,
          square: true,
          label: 'NEXUS HAZARD',
        })
      );
    }
  }

  /** Attack D: Nexus Collapse — the whole arena but the safe islands. */
  _collapse() {
    const g = this.game;
    const c = this.config.collapse;

    // always at least two shelters, always visible for the full telegraph
    const spots = [];
    const n = this.phase >= 3 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      spots.push({
        x: rand(ARENA.minX + 7, ARENA.maxX - 7),
        y: rand(-4, 9),
        r: 6.5,
      });
    }

    g.addHazard(
      new CollapseField({
        safeSpots: spots,
        warnTime: 2.6,
        activeTime: 1.7,
        color: P.magenta,
        damage: c.damage,
      })
    );
    g.hud.banner('NEXUS COLLAPSE', P.magenta);
    g.hud.toast('NEXUS COLLAPSE', 'GET TO COVER', P.cyan);
    Audio2.play('boss_taunt', 0.5, 0.7);
    g.camera3.shake(0.5);

    // debris pulled inward as the core charges
    const wp = this.group.position;
    g.after(1.2, () => {
      g.fx.explode(wp.x, wp.y, wp.z + 10, {
        count: 20,
        colors: [P.magenta, P.violet],
        power: 12,
        gravity: 0,
        spread: 14,
        arcs: false,
      });
    });
  }

  /** Attack E: heavy artillery from the cannon batteries. */
  _artillery() {
    const g = this.game;
    const c = this.config.artillery;
    const guns = ['cannonL', 'cannonR'].filter((n) => this.isModuleAlive(n));
    if (!guns.length) return;

    for (const name of guns) {
      const wp = new THREE.Vector3();
      this.parts[name].getWorldPosition(wp);
      const shots = this.phase >= 2 ? 2 : 1;
      g.scheduler.repeat(0.3, shots, () => {
        if (!this.isModuleAlive(name) || this.state !== 'active') return;
        const p = g.player;
        g.projectiles.fireEnemy({
          x: wp.x,
          y: wp.y,
          z: wp.z + 10,
          tx: p.x + p.vx * 0.3,
          ty: p.y + p.vy * 0.3,
          tz: 0,
          speed: c.speed,
          damage: c.damage,
          color: P.magenta,
          radius: 1.8,
          label: 'HEAVY ARTILLERY',
          heavy: true,
        });
        Audio2.play('heavy_shot', 0.5, 0.85, 0.06);
        g.fx.jet(wp.x, wp.y, wp.z + 12, { x: 0, y: 0, z: 1 }, 6, [P.magenta, P.white]);
      }, 'encounter');
    }
  }

  // --- destruction ---------------------------------------------------------

  onDestructionStart() {
    const g = this.game;
    this._closeCore();
    g.hud.stopTimer();

    // Projectiles vanish; the official boss theme continues through destruction.
    for (const b of g.projectiles.enemy) if (b.active) g.projectiles.killEnemyBolt(b);
    g.enemies.clear();
    Audio2.play('boss_death', 1, 0.85);

    g.score.add(SCORE.BOSS_DEFEATED, 'BOSS DEFEATED');
    g.hud.banner('NEXUS BROKEN', P.gold);

    this.deathStage = 0;
  }

  /** The largest payoff in the game: a staged, 4-second dismantling. */
  _destructionTick(dt) {
    const g = this.game;
    this.deathT += dt;
    const wp = this.group.position;
    const t = this.deathT;

    // cannons -> arms -> hull -> collapse -> shockwave.
    // Fired stages are tracked on `this` — the array below is rebuilt each frame.
    this._fired = this._fired || new Set();
    const stages = [
      { at: 0.2, run: () => {
        for (const n of ['cannonL', 'cannonR']) {
          const m = this.modules.get(n);
          if (!m?.part.visible) continue;
          const p2 = new THREE.Vector3();
          m.part.getWorldPosition(p2);
          g.fx.explode(p2.x, p2.y, p2.z, { count: 34, colors: DEBRIS.boss, power: 24, gravity: 0, arcColor: P.magenta, flashScale: 2 });
          m.part.visible = false;
        }
        Audio2.play('tower_death', 0.8, 1.1);
        g.camera3.shake(0.7);
      }},
      { at: 1.0, run: () => {
        // mechanical arms detach
        for (const arm of this.parts.tendrils) {
          const p2 = new THREE.Vector3();
          arm.getWorldPosition(p2);
          g.fx.explode(p2.x, p2.y, p2.z, { count: 16, colors: DEBRIS.boss, power: 20, gravity: 0, arcColor: P.violet });
          arm.visible = false;
        }
        Audio2.play('tower_death', 0.8, 0.95);
        g.camera3.shake(0.8);
      }},
      { at: 1.9, run: () => {
        // the hat and the skull go
        this.parts.hat.visible = false;
        for (const e of this.parts.eyes) e.visible = false;
        const p2 = new THREE.Vector3();
        this.parts.skull.getWorldPosition(p2);
        g.fx.explode(p2.x, p2.y, p2.z, {
          count: 70, colors: [...DEBRIS.boss, P.gold, P.white], power: 30, gravity: 0,
          spread: 6, scale: 1.6, arcColor: P.gold, flashScale: 5,
        });
        this.parts.skull.visible = false;
        Audio2.play('boss_death', 0.9, 1.1);
        g.camera3.shake(1);
      }},
      { at: 3.0, run: () => {
        // the Nexus collapses inward, then lets go
        g.fx.explode(wp.x, wp.y, wp.z, {
          count: 140,
          colors: [...DEBRIS.boss, P.white],
          power: 52,
          gravity: 0,
          spread: 18,
          scale: 2.4,
          arcColor: P.magenta,
          flashColor: 0xffffff,
          flashScale: 12,
          flashTime: 0.7,
          life: 2.2,
        });
        g.addHazard(
          new Shockwave({ x: 0, y: 2, maxR: 80, speed: 60, thickness: 3, color: P.gold, damage: 0, label: 'NEXUS BREAK' })
        );
        g.scrap.burst(wp.x,wp.y,wp.z+20,this.config.scrapReward,4,{sourceId:'objective:admiral',kind:'boss',life:26});
        Audio2.play('boss_death', 1, 0.65);
        g.camera3.shake(1.2);
        this.group.visible = false;
      }},
    ];

    stages.forEach((s, i) => {
      if (!this._fired.has(i) && t >= s.at) {
        this._fired.add(i);
        s.run();
      }
    });

    // chaotic secondary explosions the whole way down
    if (this.group.visible && chance(dt * 26)) {
      g.fx.explode(
        wp.x + rand(-18, 18),
        wp.y + rand(-10, 18),
        wp.z + rand(-4, 8),
        { count: 12, colors: DEBRIS.boss, power: 16, gravity: 0, arcColor: P.magenta }
      );
      g.camera3.shake(0.1);
    }
    if (this.group.visible) {
      this.group.rotation.z += dt * 0.12;
      this.group.position.y -= dt * 1.2;
    }

    if (t > 4.2) {
      this.state = 'dead';
      this.onDestroyed();
    }
  }

  onDestroyed() {
    this.game.onBossDefeated();
  }

  // --- per-frame -----------------------------------------------------------

  tick(dt) {
    const g = this.game;
    const c = this.config;
    const p = g.player;

    // --- idle presence: he breathes, the eyes track you ---
    this.bobPhase += dt;
    this.group.position.y = 4 + Math.sin(this.bobPhase * 0.5) * 0.8;
    this.group.rotation.y = Math.sin(this.bobPhase * 0.3) * 0.06 + clamp(p.x * 0.004, -0.1, 0.1);

    for (const e of this.parts.eyes) {
      const flick = 1 + 0.12 * Math.sin(this.bobPhase * 9 + e.position.x);
      const base = 3.2 * (1 + this.phase * 0.45);
      e.scale.setScalar(base * flick);
    }

    // tendrils writhe; they lash harder right after a sweep
    const lash = this.tendrilLash ? this.tendrilLash : 0;
    if (this.tendrilLash) this.tendrilLash = Math.max(0, this.tendrilLash - dt);
    this.parts.tendrils.forEach((arm, i) => {
      if (!arm.visible) return;
      const b = arm.userData.base;
      const speed = this.phase >= 1 ? 1.4 : 0.6;
      arm.rotation.x = b.rx + Math.sin(this.bobPhase * speed + arm.userData.phase) * (0.18 + lash * 0.3);
      arm.rotation.y = b.ry + Math.cos(this.bobPhase * speed * 0.7 + arm.userData.phase) * (0.22 + lash * 0.35);
    });

    // --- the core iris ---
    const core = this.parts.core;
    const ud = core.userData;
    const openK = this.coreOpen ? 1 : 0;
    ud.plates.children.forEach((plate) => {
      const a = plate.userData.angle;
      const push = 3 + openK * 5.5;
      plate.position.x += (Math.cos(a) * push - plate.position.x) * Math.min(1, dt * 6);
      plate.position.y += (Math.sin(a) * push - plate.position.y) * Math.min(1, dt * 6);
    });
    ud.crystal.rotation.y += dt * (this.coreOpen ? 3 : 0.6);
    const cs = this.coreOpen ? 1.15 + 0.18 * Math.sin(this.t * 12) : 0.6;
    ud.crystal.scale.setScalar(cs);
    ud.halo.material.opacity += ((this.coreOpen ? 0.95 : 0.12) - ud.halo.material.opacity) * Math.min(1, dt * 5);
    ud.halo.scale.setScalar(this.coreOpen ? 18 : 8);

    // --- portals ---
    for (let i = this.portals.length - 1; i >= 0; i--) {
      const pt = this.portals[i];
      pt.t += dt;
      pt.mesh.rotation.z += dt * 3;
      const k = pt.t / pt.life;
      const s = Math.sin(Math.min(1, k) * Math.PI);
      pt.mesh.scale.setScalar(0.3 + s * 1.5);
      pt.mesh.material.opacity = s;
      if (pt.t >= pt.life) {
        this.game.scene.remove(pt.mesh);
        this.portals.splice(i, 1);
      }
    }

    // --- the core damage window ---
    if (this.coreOpen) {
      this.coreT -= dt;
      g.hud.updateTimer(this.coreT);
      if (chance(dt * 10)) {
        const wp = new THREE.Vector3();
        core.getWorldPosition(wp);
        g.fx.explode(wp.x + rand(-4, 4), wp.y + rand(-4, 4), wp.z, {
          count: 2, colors: [P.magenta, P.white], power: 6, gravity: 0, arcColor: P.magenta, flashScale: 0.4,
        });
      }
      if (this.coreT <= 0) {
        this._closeCore();
        g.hud.stopTimer();
      }
    }

    // --- attack director ---
    this.attackT -= dt;
    if (this.attackT <= 0) {
      // phase 4 fires faster, but the telegraphs stay the same length
      const base = this.phase >= 3 ? [3.4, 4.6] : this.phase >= 2 ? [4.2, 5.8] : [5.2, 7];
      this.attackT = rand(...base);

      if (this.ventPending) {
        // vent between patterns: the promised damage window
        this.ventPending = false;
        this._openCore();
        g.hud.startTimer(this.coreT, 'CORE EXPOSED');
        this.attackT = Math.max(this.attackT, this.coreT * 0.7);
      } else {
        this._fireAttack();
      }
    }

    // --- Attack E: artillery runs on its own clock alongside everything else ---
    this.artilleryT -= dt;
    if (this.artilleryT <= 0) {
      this.artilleryT = rand(...c.artillery.cooldown) * (this.phase >= 2 ? 0.75 : 1);
      this._artillery();
    }

    // --- phase 4: he's coming apart already ---
    if (this.phase >= 3 && chance(dt * 3)) {
      const wp = this.group.position;
      g.fx.explode(
        wp.x + rand(-20, 20),
        wp.y + rand(-8, 16),
        wp.z + rand(-2, 6),
        { count: 4, colors: [P.magenta, P.orange, P.white], power: 9, gravity: 0, arcColor: P.magenta, flashScale: 0.5 }
      );
    }
  }
}
