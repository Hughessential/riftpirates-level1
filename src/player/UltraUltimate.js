import * as THREE from 'three';
import { ULTRA_ULTIMATE_DEFAULTS, ULTRA_TUNING_KEYS, ULTRA_ACTIVATION_AUDIO, hasUltraUltimateAccess } from '../config/abilities.js';
import { primaryWeaponOutput } from '../config/weapons.js';
import { Audio2 } from '../core/AudioManager.js';
import { UltraUltimateEffect } from '../effects/UltraUltimateEffect.js';

const TUNING = Object.entries(ULTRA_TUNING_KEYS);
const HOSTILE_KINDS = new Set(['enemy', 'weakpoint', 'body', 'core']);
const finite = (value, fallback, min = 0, max = 1e12) => Number.isFinite(value)
  ? Math.max(min, Math.min(max, value)) : fallback;

/** Separate ownership of protection, coating, pulse clock and weapon modifier.
 * Never mutates ship stats or the independent Black Armor/roll protection. */
export class UltraUltimate {
  #active = false;
  constructor(game) {
    this.game = game;
    this.player = game.player;
    this.#active = false;
    this.cooldown = 0;
    this.cooldownDuration = ULTRA_ULTIMATE_DEFAULTS.cooldown;
    this.elapsed = 0;
    this.pulseClock = 0;
    this.baseDps = 0;
    this.hullLength = 5.8;
    this.fieldRadius = 5.8 * ULTRA_ULTIMATE_DEFAULTS.hullLengths;
    this.values = { ...ULTRA_ULTIMATE_DEFAULTS };
    this._targets = new Map();
    this._strikePosition = new THREE.Vector3();
    // No GPU allocation or effect creation for public/unauthorized visitors.
    this.effect = this.authorized ? new UltraUltimateEffect(this.player, game.fx, game.camera) : null;
    this.measureHull();
  }

  get active() { return this.#active; }
  get authorized() { return hasUltraUltimateAccess(); }
  get bloom() { return (this.effect?.fade || 0) * this.tuning().bloom; }

  measureHull() {
    const hull = this.player.hull;
    if (!hull) return;
    // Measure only the actual hull in ship-local space: no exhaust, aura, or roll.
    hull.updateWorldMatrix(true, true);
    const inverse = new THREE.Matrix4().copy(this.player.group.matrixWorld).invert();
    const box = new THREE.Box3().makeEmpty();
    const bounds = new THREE.Box3();
    const matrix = new THREE.Matrix4();
    hull.traverse(object => {
      if (!object.isMesh || !object.geometry) return;
      object.geometry.computeBoundingBox();
      matrix.multiplyMatrices(inverse, object.matrixWorld);
      bounds.copy(object.geometry.boundingBox).applyMatrix4(matrix);
      box.union(bounds);
    });
    this.hullLength = finite(box.max.z - box.min.z, 5.8, .1, 100);
    this.fieldRadius = this.hullLength * ULTRA_ULTIMATE_DEFAULTS.hullLengths;
  }

  tuning() {
    for (const [name, key] of TUNING) {
      this.values[name] = finite(this.game.testing?.getTuning(key, ULTRA_ULTIMATE_DEFAULTS[name])
        ?? ULTRA_ULTIMATE_DEFAULTS[name], ULTRA_ULTIMATE_DEFAULTS[name]);
    }
    this.values.pulseInterval = Math.max(.02, this.values.pulseInterval);
    this.values.fieldRadius = this.values.fieldRadius || this.hullLength * ULTRA_ULTIMATE_DEFAULTS.hullLengths;
    this.values.areaDps = this.values.areaDps || this.baseDps * this.values.areaDpsMultiplier;
    this.fieldRadius = this.values.fieldRadius;
    return this.values;
  }

  activate() {
    const g = this.game, p = this.player;
    // This is the activation entry point for keyboard AND developer actions.
    if (!this.authorized || this.active || this.cooldown > 0 || !p.alive
      || !g.running || g._terminalOutcome || !g.director?.inCombat || p.frozen || g.paused) return false;
    const absolute = p.cosmicEffects?.timers.overcharge > 0;
    const output = primaryWeaponOutput(p.stats, { fireRate: absolute ? Math.max(45, p.fireRate) : p.fireRate,
      critBuffT: p.critBuffT, heatMultiplier: g.heat.multiplier, shield: p.shield, treasureCharge: p.treasureCharge });
    const critChance = Math.min(1, p.stats.criticalChance + (g.testing?.getTuning('criticalChance', 0) || 0));
    const critMultiplier = p.stats.criticalMultiplier * (g.testing?.getTuning('criticalDamage') ?? 1);
    this.baseDps = finite(output.damage * output.fireRate
      * (g.testing?.getTuning('playerDamage') ?? 1) * (p.cosmicEffects?.directDamageMultiplier() || 1)
      * (1 + critChance * Math.max(0, critMultiplier - 1)), 117);
    this.measureHull();
    const tuning = this.tuning();
    this.#active = true; // protection and guns precede visual/audio work
    this.elapsed = 0;
    this.pulseClock = tuning.pulseInterval;
    this.cooldownDuration = tuning.cooldown;
    g.testRun = true; // existing no-banking / no-best-score path, sticky until reset
    p.blackArmorEffect.restoreHull();
    this.effect.activate(tuning);
    p.hull.visible = true;
    Audio2.play(ULTRA_ACTIVATION_AUDIO, tuning.soundVolume, 1, 0);
    this.pulse(tuning);
    return true;
  }

  toggle() {
    if (!this.authorized) return false;
    if (this.active) return this.cancel({ cooldown: true });
    return this.activate();
  }

  cancel({ cooldown = true, immediate = false } = {}) {
    const wasActive = this.active;
    this.#active = false;
    this.pulseClock = 0;
    if (immediate) this.effect?.cancel();
    else this.effect?.expire();
    if (wasActive && this.player.blackArmorActive) this.player.blackArmorEffect.coatHull();
    if (wasActive && cooldown) {
      this.cooldown = this.cooldownDuration;
      this._cooldownJustStarted = true;
    }
    return wasActive;
  }

  reset() {
    this.cancel({ cooldown: false, immediate: true });
    this.cooldown = 0;
    this.elapsed = 0;
    this._cooldownJustStarted = false;
    this._targets.clear();
  }

  resetCooldown() {
    if (!this.authorized || !this.game.testing?.active) return false;
    this.cooldown = 0;
    return true;
  }

  update(dt) {
    if (!this.authorized) return;
    if (!this.player.alive || this.game._terminalOutcome) { this.reset(); return; }
    const tuning = this.tuning();
    if (this.active) {
      this.elapsed += dt;
      this.pulseClock -= dt;
      while (this.pulseClock <= 1e-8) {
        this.pulseClock += tuning.pulseInterval;
        this.pulse(tuning);
      }
    } else if (this._cooldownJustStarted) this._cooldownJustStarted = false;
    else this.cooldown = Math.max(0, this.cooldown - dt);
  }

  updateEffects(dt) {
    if (this.authorized) this.effect.update(dt, this.game.time, this.tuning());
  }

  pulse(tuning = this.tuning()) {
    if (!this.authorized || !this.active || !this.game.director.inCombat) return;
    const g = this.game, p = this.player;
    this._targets.clear();
    for (const t of g.targets) {
      if (!t.alive || !t.targetable || !HOSTILE_KINDS.has(t.kind) || t.friendly
        || (t.team && t.team !== 'enemy' && t.team !== 'hostile')) continue;
      t.syncPos();
      if (Math.hypot(t.pos.x - p.x, t.pos.y - p.y, t.pos.z) > tuning.fieldRadius) continue;
      // Several colliders may feed one shared HP pool (Admiral body/core).
      const key = t.damageGroup || t.id || t;
      const previous = this._targets.get(key);
      if (!previous || t.damageScale > previous.damageScale) this._targets.set(key, t);
    }
    const amount = finite(tuning.areaDps * tuning.pulseInterval, 0);
    for (const t of this._targets.values()) {
      if (!t.alive || !t.targetable) continue;
      this._strikePosition.copy(t.pos); // death callbacks may recycle/remove hull
      const dealt = g.augmentEffects.damageTarget(t, amount, false, true);
      this.effect.strike(this._strikePosition, tuning);
      if (dealt > 0) {
        g.heat.onDealDamage(dealt);
        g.damageNumbers.spawn(this._strikePosition.x, this._strikePosition.y, this._strikePosition.z, Math.round(dealt), false);
      }
    }
  }
}
