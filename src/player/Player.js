import * as THREE from 'three';
import { P, DEBRIS } from '../core/Palette.js';
import { buildVoxels, glowSprite } from '../render/VoxelBuilder.js';
import { hopperVoxels } from '../render/Models.js';
import { createPlayerShip, isPlayerShipId, PLAYER_SHIPS } from '../render/PlayerFleet.js';
import { Input } from '../core/Input.js';
import { EngineTrail } from '../effects/EngineTrail.js';
import { BlackArmorEffect } from '../effects/BlackArmorEffect.js';
import { Audio2 } from '../core/AudioManager.js';
import { clamp, lerp, rand, damp, TAU } from '../core/Utils.js';

/** Base stats. Upgrades mutate a *copy* of this — nothing persists across runs. */
export const BASE_STATS = () => ({
  maxHealth: 160, // generous by design (Player notes): threat comes from patterns, not fragility
  healthRegen: 2, // repair builds can improve this; base hull cannot erase pressure
  regenDelay: 6, // seconds without damage before hull regen begins
  damage: 18,
  fireRate: 6.5,
  projectileSpeed: 105,
  moveSpeed: 19, // snappier baseline (see update(): response is what really sells it)
  boostSpeed: 31,
  boostCapacity: 100,
  boostDrain: 42,
  boostRegen: 22,
  scrapRadius: 4.5,
  scrapMultiplier: 1,
  damageReduction: 0,
  criticalChance: 0,
  criticalMultiplier: 2.5,
  shieldMax: 40,
  shieldRegen: 4, // deliberately slow: ten seconds to rebuild the base shield
  shieldDelay: 8, // damage-free seconds after a partial shield hit
  shieldBreakDelay: 14, // depleted shields stay offline through a real danger window
  weakPointDamage: 1,
  // Stack counts; each acquisition adds another rank.
  broadsides: 0,
  riftDrain: 0,
  dodgeDrive: 0,
  overcharge: 0,
  heatSink: 0,
  realityTear: 0,
  secondWind: 0,
  freeBlocks: 0,
});

export const ARENA = { minX: -22, maxX: 22, minY: -9, maxY: 13 };
const DODGE_WINDOW = 0.22; // spec §6: 0.15–0.25s
const IFRAME = 0.8;

// Barrel roll — part of the dodge kit alongside boost/perfect-dodge.
const ROLL_TIME = 0.42; // spin + i-frame duration
const ROLL_CD = 0.7; // cooldown between rolls
const ROLL_COST = 24; // boost energy spent per roll
const ROLL_DASH = 30; // lateral dash speed at the start of the roll
const NORMAL_ENGINE = new THREE.Color('#43eaff');
const BOOST_ENGINE = new THREE.Color('#ff6a22');
const BRAKE_ENGINE = new THREE.Color('#55108f');
const BOOST_FLARE = new THREE.Color('#ffd34f');

export const BLACK_ARMOR_DEFAULTS = Object.freeze({
  duration: 5,
  cooldown: 60,
  glow: 2.8,
  bloom: 0.42,
  gloss: 0.94,
  specular: 1.45,
  lightningFrequency: 18,
  arcCount: 10,
  lightningLength: 1.05,
  lightningThickness: 0.055,
  lightningBrightness: 2.2,
  redBalance: 0.5,
  particles: 1.25,
  shimmer: 1.6,
  soundVolume: 0.82,
});

const BLACK_ARMOR_TUNING = Object.freeze({
  duration: 'blackArmorDuration', cooldown: 'blackArmorCooldown', glow: 'blackArmorGlow',
  bloom: 'blackArmorBloom', gloss: 'blackArmorGloss', specular: 'blackArmorSpecular',
  lightningFrequency: 'blackArmorLightningFrequency', arcCount: 'blackArmorArcCount',
  lightningLength: 'blackArmorLightningLength', lightningThickness: 'blackArmorLightningThickness',
  lightningBrightness: 'blackArmorLightningBrightness', redBalance: 'blackArmorRedBalance',
  particles: 'blackArmorParticles', shimmer: 'blackArmorShimmer', soundVolume: 'blackArmorSoundVolume',
});
const BLACK_ARMOR_TUNING_ENTRIES = Object.entries(BLACK_ARMOR_TUNING);

export class Player {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;

    this.group = new THREE.Group();
    this.hull = buildVoxels(hopperVoxels(), 0.32);
    this.fallbackHull = this.hull;
    this.shipHulls = new Map();
    this.group.add(this.hull);

    this.engines = [];
    for (const ex of [-0.48, 0, 0.48]) {
      const gs = glowSprite(NORMAL_ENGINE, 1.4, .45);
      gs.position.set(ex, -0.32, 2.4);
      this.group.add(gs);
      this.engines.push(gs);
    }

    // boost trail — stronger while boosting (spec §5)
    this.trail = glowSprite(BOOST_FLARE, 0, 0.3);
    this.trail.position.set(0, -0.2, 4.5);
    this.group.add(this.trail);

    // Flight reticle — a crisp flat sight line that stays readable without
    // bloom. Aim/lock changes only its restrained solid color.
    this.reticle = new THREE.Group();
    const retMat = (opacity = 1) =>
      new THREE.MeshBasicMaterial({
        color: P.red,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      });
    this.reticleRing = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.45, 32), retMat(1));
    this.reticleRing.renderOrder = 41;
    // four crosshair ticks reaching in from the ring toward the center
    this.reticleTicks = [];
    for (const [rx, ry, w, h] of [
      [0, 0.85, 0.14, 0.75],
      [0, -0.85, 0.14, 0.75],
      [0.85, 0, 0.75, 0.14],
      [-0.85, 0, 0.75, 0.14],
    ]) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(w, h), retMat(1));
      tick.position.set(rx, ry, 0);
      tick.renderOrder = 41;
      this.reticleTicks.push(tick);
      this.reticle.add(tick);
    }
    this.reticleDot = new THREE.Mesh(new THREE.CircleGeometry(.13, 16), retMat(1));
    this.reticleDot.renderOrder = 42;
    this.reticle.add(this.reticleRing, this.reticleDot);
    this.reticle.position.set(0, 0.05, -26);
    this.reticle.visible = false;
    this.group.add(this.reticle);
    this.reticleLock = false;
    this._boostVisual = 0;
    this._brakeVisual = 0;
    this._engineColor = new THREE.Color();

    // shield bubble (only visible with the Shield Recharge upgrade)
    this.shieldMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.4, 1),
      new THREE.MeshBasicMaterial({
        color: P.cyan,
        wireframe: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    this.group.add(this.shieldMesh);

    scene.add(this.group);
    this.exhaust = new EngineTrail(scene);
    this.blackArmorEffect = new BlackArmorEffect(this, fx);
    this._blackArmorValues = { ...BLACK_ARMOR_DEFAULTS };
    this.radius = 1.35;
    this.reset(BASE_STATS());
  }

  /** Hull selection only changes render geometry. Collision and weapons stay identical. */
  setShip(id) {
    const armorActive = this.blackArmorActive;
    this.blackArmorEffect.restoreHull();
    const shipId = isPlayerShipId(id) ? id : PLAYER_SHIPS[0].id;
    if (!this.shipHulls.has(shipId)) {
      const model = createPlayerShip(shipId, { size: 5.8 });
      if (model) this.shipHulls.set(shipId, model);
    }
    this.group.remove(this.hull);
    this.hull = this.shipHulls.get(shipId) || this.fallbackHull;
    this.hull.visible = true;
    this.shipId = shipId;
    this.shipName = PLAYER_SHIPS.find((ship) => ship.id === shipId).name;
    this.group.userData.shipId = shipId;
    // Keep the cosmetic exhaust attached to the rear of each silhouette.
    const bounds = new THREE.Box3().setFromObject(this.hull);
    const rear = bounds.max.z + 0.12;
    this.group.add(this.hull);
    for (const engine of this.engines) engine.position.z = rear;
    this.trail.position.z = rear + 1.4;
    this.exhaust.reset();
    if (armorActive) this.blackArmorEffect.coatHull();
  }

  reset(stats) {
    this.blackArmorEffect.cancel();
    this.exhaust.reset();
    this.stats = stats;
    this.x = 0;
    this.y = 1;
    this.vx = 0;
    this.vy = 0;
    this.health = stats.maxHealth;
    this.shield = stats.shieldMax; // passive shield starts charged
    this.shieldBroken = false;
    this.boost = stats.boostCapacity;
    this.boosting = false;
    this.braking = false;
    this.dodgeT = 0; // >0 while inside the perfect-dodge window
    this.dodgeUsed = false; // one dodge award per boost tap
    this.dodgePending = false; // a threat passed us inside the window
    this.dodgeSpoiled = false; // ...but we got hit, so it doesn't count
    this.rollT = 0; // >0 while a barrel roll is in progress
    this.rollCd = 0; // roll cooldown remaining
    this.rollDir = 0; // -1 left, +1 right
    this.invuln = 0;
    this.blackArmorTime = 0;
    this.blackArmorCooldown = 0;
    this.blackArmorDuration = BLACK_ARMOR_DEFAULTS.duration;
    this.blackArmorCooldownDuration = BLACK_ARMOR_DEFAULTS.cooldown;
    this.noDamageT = 0;
    this.buffT = 0; // dodge-drive speed/fire buff
    this.critBuffT = 0; // perfect-dodge weapon-power buff
    this.blocksLeft = stats.freeBlocks;
    this.blockCapacity = stats.freeBlocks;
    this.secondWindUsed = 0;
    this.alive = true;
    this.timeSinceHit = 99;
    this.lastKiller = '';
    this.group.position.set(0, 1, 0);
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
    this.hull.visible = true;
    this.group.scale.set(1, 1, 1);
    this.shieldMesh.material.opacity = 0;
    this.frozen = false;
    this.reticle.visible = false;
    this.reticleLock = false;
    this.reticle.scale.setScalar(1);
    this._boostVisual = 0;
    this._brakeVisual = 0;
  }

  applyStats(stats) {
    // Only newly acquired protection grants blocks. An unrelated augment must
    // not silently refill protections already spent during this encounter.
    this.blocksLeft += Math.max(0, stats.freeBlocks - this.blockCapacity);
    this.blockCapacity = stats.freeBlocks;
    this.stats = stats;
  }

  get pos() {
    return { x: this.x, y: this.y };
  }

  get moveSpeed() {
    return this.stats.moveSpeed * (this.testing?.getTuning('moveSpeed') ?? 1)
      * (this.buffT > 0 ? 1 + 0.4 * Number(this.stats.dodgeDrive) : 1) * (this.cosmicEffects?.moveMultiplier(false) || 1);
  }

  get fireRate() {
    return this.stats.fireRate * (this.testing?.getTuning('playerFireRate') ?? 1)
      * (this.buffT > 0 ? 1 + 0.4 * Number(this.stats.dodgeDrive) : 1) * (this.cosmicEffects?.fireMultiplier() || 1);
  }

  get shieldRecoveryRemaining() {
    const shieldMax = this.stats.shieldMax * (this.testing?.getTuning('shieldCapacity') ?? 1);
    if (this.shield >= shieldMax || shieldMax <= 0) return 0;
    const delay = this.shieldBroken ? this.stats.shieldBreakDelay : this.stats.shieldDelay;
    return Math.max(0, delay - this.timeSinceHit);
  }

  get secondWindCharges() {
    return Math.max(0, Number(this.stats.secondWind) - this.secondWindUsed);
  }

  get blackArmorActive() {
    return this.blackArmorTime > 0;
  }

  get blackArmorReady() {
    return this.alive && !this.blackArmorActive && this.blackArmorCooldown <= 0;
  }

  get blackArmorBloom() {
    return (this.blackArmorEffect?.fade || 0)
      * (this.testing?.getTuning('blackArmorBloom', BLACK_ARMOR_DEFAULTS.bloom) ?? BLACK_ARMOR_DEFAULTS.bloom);
  }

  _blackArmorTuning() {
    for (const [name, key] of BLACK_ARMOR_TUNING_ENTRIES) {
      this._blackArmorValues[name] = this.testing?.getTuning(key, BLACK_ARMOR_DEFAULTS[name]) ?? BLACK_ARMOR_DEFAULTS[name];
    }
    return this._blackArmorValues;
  }

  activateBlackArmor() {
    if (!this.blackArmorReady) return false;
    const tuning = this._blackArmorTuning();
    this.blackArmorDuration = tuning.duration;
    this.blackArmorCooldownDuration = tuning.cooldown;
    this.blackArmorTime = tuning.duration;
    this.blackArmorEffect.activate(tuning);
    Audio2.play('black_armor', tuning.soundVolume, 1, 0);
    return true;
  }

  resetBlackArmor({ cancel = true } = {}) {
    if (cancel) {
      this.blackArmorTime = 0;
      this.blackArmorEffect.cancel();
    }
    this.blackArmorCooldown = 0;
  }

  setReticleActive(active) {
    this.reticle.visible = Boolean(active && this.alive && this.group.visible);
  }

  update(dt, ctx) {
    if (!this.alive) return;
    const tune = key => this.testing?.getTuning(key) ?? 1;
    const boostCapacity = this.stats.boostCapacity * tune('boostCapacity');
    const maxHealth = this.stats.maxHealth * tune('maxHealth');
    const shieldMax = this.stats.shieldMax * tune('shieldCapacity');

    const inp = this.frozen ? { x: 0, y: 0, boost: false } : Input.read();

    // ---- Black Armor ----
    // Edge-triggered and completely orthogonal to steering, weapons, boost and
    // rolls. Its own flag protects the full five-second window without
    // overwriting shorter dodge/impact invulnerability timers.
    if (!this.frozen && Input.consumeBlackArmor()) this.activateBlackArmor();
    const armorWasActive = this.blackArmorActive;
    if (armorWasActive) {
      this.blackArmorTime = Math.max(0, this.blackArmorTime - dt);
      if (!this.blackArmorActive) {
        this.blackArmorEffect.expire();
        this.blackArmorCooldown = this.blackArmorCooldownDuration;
      }
    } else if (this.blackArmorCooldown > 0) {
      this.blackArmorCooldown = Math.max(0, this.blackArmorCooldown - dt);
    }
    this.blackArmorEffect.update(dt, ctx.time, this._blackArmorTuning());

    // ---- boost ----
    const wantBoost = inp.boost && this.boost > 2;
    if (wantBoost && !this.boosting) {
      this.boosting = true;
      this.dodgeT = DODGE_WINDOW;
      this.dodgeUsed = false;
      this.dodgePending = false;
      this.dodgeSpoiled = false;
      Audio2.play('boost', 0.5, 1.4, 0.08);
      this.cosmicEffects?.onDodgeStart(inp.x || 1, 'boost');
    }
    if (!inp.boost) this.boosting = false;

    if (this.boosting) {
      this.boost = Math.max(0, this.boost - this.stats.boostDrain * tune('boostDrain') * dt);
      if (this.boost <= 0) this.boosting = false;
    } else {
      // recharges faster when not recently hit (spec §5)
      const rate = this.stats.boostRegen * tune('boostRegen') * (this.timeSinceHit > 2 ? 1.35 : 0.7);
      this.boost = Math.min(boostCapacity, this.boost + rate * dt);
    }
    if (this.dodgeT > 0) this.dodgeT -= dt;

    // ---- barrel roll ----
    if (this.rollCd > 0) this.rollCd -= dt;
    const rollReq = Input.consumeRoll() * (this.frozen ? 0 : 1);
    if (rollReq && this.rollT <= 0 && this.rollCd <= 0 && this.boost >= ROLL_COST) {
      const rollTime = ROLL_TIME * tune('rollDuration');
      this.rollT = rollTime;
      this.rollDir = rollReq;
      this.rollCd = ROLL_CD * tune('rollCooldown');
      this.boost = Math.max(0, this.boost - ROLL_COST);
      // i-frames for the whole roll, and it opens the dodge window like a boost
      this.invuln = Math.max(this.invuln, rollTime);
      this.dodgeT = Math.max(this.dodgeT, rollTime);
      this.dodgeUsed = false;
      this.dodgePending = false;
      this.dodgeSpoiled = false;
      Audio2.play('boost', 0.55, 1.9, 0.05);
      this.fx.jet(this.x, this.y, 2.5, { x: this.rollDir, y: 0, z: 0 }, 4, [P.cyan, P.white]);
      this.cosmicEffects?.onDodgeStart(this.rollDir, 'roll');
    }
    if (this.rollT > 0) this.rollT -= dt;

    // ---- motion ----
    // A high response rate is what makes the Star Hopper feel like a direct
    // extension of the stick — velocity chases the input almost immediately,
    // so direction changes read as instant without losing all inertia.
    // Braking (Y / C) slows the ship for precision flying; boost wins.
    this.braking = !this.frozen && !this.boosting && Input.braking;
    const speed = (this.boosting ? this.stats.boostSpeed * tune('boostSpeed') * (this.cosmicEffects?.moveMultiplier(true) || 1) : this.moveSpeed)
      * (this.braking ? tune('brakeSpeed') : 1);
    const response = 13 * tune('handling');
    this.vx = damp(this.vx, inp.x * speed, response, dt);
    this.vy = damp(this.vy, inp.y * speed * 0.9, response, dt);

    // barrel roll adds a decaying lateral dash on top of steering
    if (this.rollT > 0) {
      const rollTime = ROLL_TIME * tune('rollDuration');
      const k = this.rollT / Math.max(.001, rollTime); // 1 -> 0 across the roll (ease-out dash)
      this.x = clamp(this.x + this.rollDir * ROLL_DASH * tune('rollDistance') * k * dt, ARENA.minX, ARENA.maxX);
    }

    // gravity wells nudge position directly — they never take away control
    const pull = { x: 0, y: 0 };
    for (const h of ctx.hazards) {
      if (h.pull) h.pull(this.x, this.y, dt, pull);
    }
    // boosting resists the pull, which is what makes wells a movement puzzle
    const resist = this.boosting ? 0.45 : 1;

    this.x = clamp(this.x + this.vx * dt + pull.x * resist, ARENA.minX, ARENA.maxX);
    this.y = clamp(this.y + this.vy * dt + pull.y * resist, ARENA.minY, ARENA.maxY);

    // knockback impulse decay
    if (this.kx || this.ky) {
      this.x = clamp(this.x + this.kx * dt, ARENA.minX, ARENA.maxX);
      this.y = clamp(this.y + this.ky * dt, ARENA.minY, ARENA.maxY);
      const d = Math.max(0, 1 - 4 * dt);
      this.kx *= d;
      this.ky *= d;
      if (Math.abs(this.kx) < 0.1) this.kx = 0;
      if (Math.abs(this.ky) < 0.1) this.ky = 0;
    }

    this.group.position.set(this.x, this.y, 0);
    if (this.rollT > 0) {
      // a full 360° roll around the travel axis over the roll's lifetime
      const k = 1 - this.rollT / Math.max(.001, ROLL_TIME * tune('rollDuration')); // 0 -> 1
      this.group.rotation.z = -this.rollDir * TAU * k;
    } else {
      this.group.rotation.z = lerp(this.group.rotation.z, -this.vx * 0.045, 0.2);
    }
    this.group.rotation.x = lerp(this.group.rotation.x, this.vy * 0.02, 0.2);

    // ---- timers ----
    this.timeSinceHit += dt;
    this.noDamageT += dt;
    if (this.invuln > 0) {
      this.invuln -= dt;
      // blink, but never hide the ship completely — you must always see yourself.
      // During a barrel roll we keep the hull solid so the spin stays readable.
      const blink = Math.floor(ctx.time * 16) % 2 === 0;
      this.hull.visible = this.rollT > 0 || blink;
    } else {
      this.hull.visible = true;
    }
    if (this.buffT > 0) this.buffT -= dt;
    if (this.critBuffT > 0) this.critBuffT -= dt;

    // ---- passive hull regen ----
    // Disengaging after a hit slowly repairs the Star Hopper. Threat still comes
    // from patterns (Player notes) — this only rewards buying yourself space.
    if (this.stats.healthRegen > 0 && this.health < maxHealth && this.timeSinceHit > this.stats.regenDelay) {
      this.health = Math.min(maxHealth, this.health + this.stats.healthRegen * tune('healthRegen') * dt);
    }

    // ---- shield regen ----
    if (shieldMax > 0) {
      const delay = this.shieldBroken ? this.stats.shieldBreakDelay : this.stats.shieldDelay;
      const rechargeDt = Math.min(dt, Math.max(0, this.timeSinceHit - delay));
      if (rechargeDt > 0) {
        this.shield = Math.min(shieldMax, this.shield + this.stats.shieldRegen * tune('shieldRegen') * rechargeDt * (this.cosmicEffects?.shieldRegenMultiplier() || 1));
        if (this.shield > 0) this.shieldBroken = false;
      }
      const s = this.shield / shieldMax;
      this.shieldMesh.material.opacity = s * 0.32;
      this.shieldMesh.rotation.y += dt * 0.9;
      this.shieldMesh.rotation.x += dt * 0.4;
    }

    // ---- aim reticle ----
    const col = this.reticleLock ? P.gold : P.red;
    this.reticleRing.material.color.set(col);
    this.reticleDot.material.color.set(col);
    for (const t of this.reticleTicks) t.material.color.set(col);
    this.reticle.scale.setScalar(1);

    // ---- visuals ----
    this._boostVisual = THREE.MathUtils.damp(this._boostVisual, this.boosting ? 1 : 0, 18, dt);
    this._brakeVisual = THREE.MathUtils.damp(this._brakeVisual, this.braking ? 1 : 0, 22, dt);
    this._engineColor.lerpColors(NORMAL_ENGINE, BOOST_ENGINE, this._boostVisual);
    this._engineColor.lerp(BRAKE_ENGINE, this._brakeVisual);
    this.engines.forEach((sp, i) => {
      sp.material.color.copy(this._engineColor);
      sp.material.opacity = .42 + this._boostVisual * .48 + this._brakeVisual * .16;
      const f = .72 + Math.sin(ctx.time * 31 + i) * .055 + this._boostVisual * 1.05;
      sp.scale.set(f, f * (1.35 + this._boostVisual * .8), 1);
    });
    this.trail.material.color.copy(BOOST_FLARE);
    this.trail.material.opacity = .15 + this._boostVisual * .65;
    const tScale = damp(this.trail.scale.x, this._boostVisual * 3, 16, dt);
    this.trail.scale.set(tScale, tScale * .42, 1);

  }

  /** Called by the dodge system when an attack was evaded inside the window. */
  awardDodge() {
    this.dodgeUsed = true;
    this.dodgePending = false;
    this.refundBoost(18); // energy refund
    this.critBuffT = 2.5; // brief weapon-power increase
    if (this.stats.dodgeDrive) this.buffT = 3 + Number(this.stats.dodgeDrive);
    if (this.stats.riftDrain) {
      const rank = Number(this.stats.riftDrain);
      this.heal(8 * rank);
      this.refundBoost(6 * rank);
    }
  }

  knockback(fromX, fromY, force) {
    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    this.kx = (dx / d) * force;
    this.ky = (dy / d) * force;
  }

  /** @returns {boolean} true if damage actually landed. */
  takeDamage(amount, source = 'UNKNOWN') {
    if (!this.alive || this.blackArmorActive || this.invuln > 0 || !(amount > 0)) return false;

    // Armor Plating grants a free block per encounter
    if (this.blocksLeft > 0) {
      this.blocksLeft -= 1;
      this.invuln = 0.5;
      Audio2.play('shield_break', 0.7, 1.3);
      this.fx.explode(this.x, this.y, 0, {
        count: 8,
        colors: [P.gold, P.white],
        power: 8,
        arcs: false,
      });
      return false;
    }

    let dmg = amount * (1 - clamp(this.stats.damageReduction, 0, 1)) * (1 - (this.cosmicEffects?.damageReduction() || 0));
    if (!(dmg > 0)) return false;
    // Both shield hits and hull hits restart the recovery clock. While broken,
    // that is the full fourteen-second lockout, not the partial-shield delay.
    this.timeSinceHit = 0;
    this.noDamageT = 0;

    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
      Audio2.play('shield_break', 0.6, 1.1);
      if (this.shield <= 0) {
        this.shield = 0;
        this.shieldBroken = true;
        this.onShieldBreak?.();
      }
      if (dmg <= 0) {
        this.invuln = 0.35;
        this.timeSinceHit = 0;
        return true;
      }
    }

    this.health -= dmg;
    this.invuln = IFRAME;
    this.timeSinceHit = 0;
    this.noDamageT = 0;
    this.lastKiller = source;
    Audio2.play('player_hurt', 0.9, 1, 0.05);
    if (globalThis.navigator?.vibrate) {
      try {
        navigator.vibrate(60);
      } catch {
        /* ignore */
      }
    }

    if (this.health <= 0) {
      // Acquired ranks are persistent build identity; spent charges are not.
      // Buying rank three after spending two grants exactly one new revive.
      if (this.secondWindCharges > 0) {
        this.secondWindUsed += 1;
        this.health = this.stats.maxHealth * (this.testing?.getTuning('maxHealth') ?? 1) * 0.5;
        this.invuln = 2.2;
        Audio2.play('levelup', 1, 0.8);
        this.fx.explode(this.x, this.y, 0, {
          count: 40,
          colors: [P.green, P.cyan, P.white],
          power: 16,
          arcColor: P.green,
        });
        return true;
      }
      if (this.cosmicEffects?.tryRescue(true)) return true;
      this.health = 0;
      this.alive = false;
    }
    return true;
  }

  heal(amount) {
    this.health = Math.min(this.stats.maxHealth * (this.testing?.getTuning('maxHealth') ?? 1), this.health + amount);
  }

  refundBoost(amount) {
    this.boost = Math.min(this.stats.boostCapacity * (this.testing?.getTuning('boostCapacity') ?? 1), this.boost + amount);
  }
}
