import * as THREE from 'three';
import { P, DEBRIS } from '../core/Palette.js';
import { Target, PRIORITY } from '../combat/Target.js';
import { Audio2 } from '../core/AudioManager.js';
import { SCORE } from '../systems/ScoreSystem.js';
import { rand, chance, TAU } from '../core/Utils.js';

/**
 * Shared machinery for every objective (spec §38). Subclasses supply a model,
 * a weak-point list and an attack set; this class owns health, module
 * destruction, the objective bar, and the destruction sequence.
 *
 * The rule that makes these fights readable: destroying a module disables the
 * attack it powers. Players learn to read a tower as a set of systems, not a
 * health bar.
 */
export class TowerEncounter {
  constructor(game, config, identity) {
    this.game = game;
    this.config = config;
    this.identity = identity;
    this.modules = new Map(); // name -> { target, part, onDestroy }
    this.targets = [];
    this.state = 'idle'; // idle | active | dying | dead
    this.t = 0;
    this.deathT = 0;
    this.noDamageTaken = true;
    this.group = null;
    this.core = null;
    this.startedAt = 0;
  }

  // --- construction --------------------------------------------------------

  /** @param {{group: THREE.Group, parts: object}} model */
  attach(model, position) {
    this.group = model.group;
    this.parts = model.parts;
    this.group.position.copy(position);
    this.game.scene.add(this.group);
  }

  addModule(name, { part, hp, radius = 3, offset = null, onDestroy = null, label = null }) {
    const t = new Target({
      object3D: part,
      hp,
      radius,
      priority: PRIORITY.WEAK_POINT,
      kind: 'weakpoint',
      label: label || name,
      scrap: this.config.weakPointScrap ?? 30,
      score: SCORE.WEAK_POINT,
      xp: 60,
      offset,
      onDamage: (d, crit) => this._flash(part),
      onDeath: () => this._destroyModule(name),
    });
    this.modules.set(name, { target: t, part, onDestroy });
    this.targets.push(t);
    this.game.targets.push(t);
    return t;
  }

  addCore(name, { part, hp, radius = 4, offset = null, damageScale = 1, targetable = false }) {
    const t = new Target({
      object3D: part,
      hp,
      radius,
      priority: PRIORITY.BODY,
      kind: 'core',
      label: this.identity.name,
      scrap: this.config.coreScrap ?? 120,
      score: 0, // the tower award is granted by onDefeated instead
      xp: 200,
      offset,
      damageScale,
      onDamage: () => this._flash(part),
      onDeath: () => this.beginDestruction(),
    });
    t.targetable = targetable;
    this.core = t;
    this.coreName = name;
    this.targets.push(t);
    this.game.targets.push(t);
    return t;
  }

  _flash(part) {
    part.userData.flash = 0.12;
  }

  // --- health --------------------------------------------------------------

  get maxHp() {
    return this.targets.reduce((a, t) => a + t.maxHp, 0);
  }

  get hp() {
    return this.targets.reduce((a, t) => a + t.hp, 0);
  }

  get healthPct() {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  /** How much of the *core* remains — drives Overcharge-style phase thresholds. */
  get corePct() {
    return this.core ? this.core.healthPct : 1;
  }

  isModuleAlive(name) {
    const m = this.modules.get(name);
    return !!m && m.target.alive;
  }

  aliveModules() {
    let n = 0;
    for (const m of this.modules.values()) if (m.target.alive) n++;
    return n;
  }

  _destroyModule(name) {
    const m = this.modules.get(name);
    if (!m) return;
    const g = this.game;

    const p = new THREE.Vector3();
    m.part.getWorldPosition(p);

    g.fx.explode(p.x, p.y, p.z, {
      count: 30,
      colors: DEBRIS[this.identity.key] ?? DEBRIS.enemy,
      power: 18,
      gravity: 0,
      spread: 1.5,
      scale: 1.3,
      arcColor: this.identity.main,
      flashColor: new THREE.Color(this.identity.main).getHex(),
      flashScale: 1.6,
    });
    Audio2.play('weakpoint_death', 0.85, 1, 0.06);
    g.camera3.shake(0.45);
    g.scrap.burst(p.x,p.y,p.z,m.target.scrap,1.2,{sourceId:`module:${this.identity.key}:${name}`,kind:'module',life:24});
    g.score.add(SCORE.WEAK_POINT, 'WEAK POINT');
    g.heat.onWeakPointDestroyed();
    g.xp.add(m.target.xp);
    g.stats.weakPoints += 1;
    g.hud.toast('MODULE DESTROYED', m.target.label, this.identity.main);

    m.part.visible = false;
    if (m.onDestroy) m.onDestroy();

    this.onModuleDestroyed(name);
  }

  /** Subclass hook — usually used to expose the core. */
  onModuleDestroyed() {
    this.exposeCoreIfClear();
  }

  /** Once the external modules are gone, the core becomes shootable (spec §10). */
  exposeCoreIfClear() {
    if (!this.core || this.core.targetable) return;
    if (this.aliveModules() > 0) return;
    this.core.targetable = true;
    this.core.damageScale = 1;
    this.game.hud.toast('CORE EXPOSED', 'ALL SYSTEMS DOWN', this.identity.main);
    Audio2.play('overload', 0.8, 1.2);
    this.game.hud.setObjectiveWarning(true);
  }

  // --- lifecycle -----------------------------------------------------------

  begin() {
    this.state = 'active';
    this.t = 0;
    this.startedAt = this.game.runTime;
  }

  beginDestruction() {
    if (this.state === 'dying' || this.state === 'dead') return;
    this.state = 'dying';
    this.deathT = 0;

    const g = this.game;
    // stop everything: no attack may land during a destruction sequence (spec §36)
    for (const h of g.hazards) h.done = true;
    for (const t of this.targets) t.targetable = false;

    g.score.add(this.config.destroyScore ?? SCORE.TOWER, 'OBJECTIVE');
    g.heat.onObjectiveDestroyed();
    g.xp.add(400);
    g.stats.towers += 1;

    if (this.noDamageTaken) {
      g.score.add(SCORE.NO_DAMAGE_ENCOUNTER, 'NO-DAMAGE CLEAR');
      g.hud.toast('FLAWLESS', 'NO DAMAGE TAKEN', P.gold);
    }

    Audio2.play('tower_death', 1, 0.85);
    g.camera3.shake(1);
    g.hud.banner(this.config.defeatBanner ?? 'OBJECTIVE DESTROYED', this.identity.main);
    this.onDestructionStart();
  }

  onDestructionStart() {}

  /** Chain-explode the whole structure over ~1.6s, then release the loot. */
  _destructionTick(dt) {
    this.deathT += dt;
    const g = this.game;
    const pos = this.group.position;

    // sections tear apart in sequence
    if (chance(dt * 22)) {
      g.fx.explode(
        pos.x + rand(-9, 9),
        pos.y + rand(-2, 16),
        pos.z + rand(-4, 6),
        {
          count: 16,
          colors: DEBRIS[this.identity.key] ?? DEBRIS.rock,
          power: 16,
          gravity: 0,
          arcColor: this.identity.main,
        }
      );
      g.camera3.shake(0.12);
    }

    // the structure sags and cracks apart
    this.group.rotation.z += dt * 0.35 * (this.deathT / 1.6);
    this.group.position.y -= dt * 2.2 * this.deathT;
    const s = Math.max(0, 1 - this.deathT * 0.25);
    this.group.scale.setScalar(s);

    if (this.deathT > 1.6) {
      // final blast + the scrap payout
      g.fx.explode(pos.x, pos.y + 6, pos.z, {
        count: 80,
        colors: DEBRIS[this.identity.key] ?? DEBRIS.rock,
        power: 34,
        gravity: 0,
        spread: 6,
        scale: 1.8,
        arcColor: this.identity.main,
        flashColor: new THREE.Color(this.identity.main).getHex(),
        flashScale: 6,
        flashTime: 0.5,
        life: 1.8,
      });
      Audio2.play('tower_death', 1, 0.6);
      g.camera3.shake(1.1);
      g.scrap.burst(pos.x,pos.y+4,pos.z+10,this.config.scrapReward??220,3,{sourceId:`objective:${this.identity.key}`,kind:'boss',life:26});
      this.group.visible = false;
      this.state = 'dead';
      this.onDestroyed();
    }
  }

  onDestroyed() {}

  get isDefeated() {
    return this.state === 'dead';
  }

  onPlayerDamaged() {
    this.noDamageTaken = false;
  }

  // --- per-frame -----------------------------------------------------------

  update(dt) {
    if (!this.group) return;
    this.t += dt;

    // module hit-flash decay
    for (const m of this.modules.values()) {
      if (m.part.userData.flash > 0) {
        m.part.userData.flash -= dt;
        const k = Math.max(0, m.part.userData.flash) / 0.12;
        m.part.scale.setScalar(1 + k * 0.08);
      }
    }

    for (const t of this.targets) t.syncPos();

    if (this.state === 'dying') {
      this._destructionTick(dt);
      return;
    }
    if (this.state !== 'active') return;

    // idle animation: structures breathe and their rubble tumbles
    if (this.parts.rubble) {
      for (const r of this.parts.rubble.children) {
        r.rotation.x += r.userData.spin.x * dt;
        r.rotation.y += r.userData.spin.y * dt;
      }
      this.parts.rubble.rotation.y += dt * 0.05;
    }
    if (this.core && this.parts[this.coreName]?.userData?.halo) {
      const halo = this.parts[this.coreName].userData.halo;
      const pulse = this.core.targetable ? 1.3 + 0.5 * Math.sin(this.t * 8) : 0.9;
      halo.scale.setScalar((this.core.targetable ? 9 : 7) * pulse * 0.5);
    }

    this.tick(dt);
  }

  /** Subclass attack logic. */
  tick() {}

  dispose() {
    if (this.group) this.game.scene.remove(this.group);
    for (const t of this.targets) {
      t.alive = false;
      t.targetable = false;
    }
    this.targets.length = 0;
    this.modules.clear();
  }
}
