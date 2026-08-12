import * as THREE from 'three';
import { P, DEBRIS } from '../core/Palette.js';
import { buildVoxels, glowSprite } from '../render/VoxelBuilder.js';
import { hopperVoxels } from '../render/Models.js';
import { Input } from '../core/Input.js';
import { Audio2 } from '../core/AudioManager.js';
import { clamp, lerp, rand, damp, TAU } from '../core/Utils.js';

/** Base stats. Upgrades mutate a *copy* of this — nothing persists across runs. */
export const BASE_STATS = () => ({
  maxHealth: 160, // generous by design (Player notes): threat comes from patterns, not fragility
  healthRegen: 6, // hull points/sec, passive — rewards disengaging after a hit
  regenDelay: 3.5, // seconds without damage before hull regen begins
  damage: 12,
  fireRate: 4.5,
  projectileSpeed: 95,
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
  shieldMax: 55, // passive shield — a limited energy bar the hull hides behind
  shieldRegen: 15, // energy/sec, recharges once you stop taking hits
  shieldDelay: 2.6, // seconds without damage before the shield rebuilds
  weakPointDamage: 1,
  // boolean upgrade flags
  broadsides: false,
  riftDrain: false,
  dodgeDrive: false,
  overcharge: false,
  heatSink: false,
  realityTear: false,
  secondWind: false,
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

export class Player {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;

    this.group = new THREE.Group();
    this.hull = buildVoxels(hopperVoxels(), 0.32);
    this.group.add(this.hull);

    this.engines = [];
    for (const ex of [-0.48, 0, 0.48]) {
      const gs = glowSprite(P.magenta, 1.4);
      gs.position.set(ex, -0.32, 2.4);
      this.group.add(gs);
      this.engines.push(gs);
    }

    // boost trail — stronger while boosting (spec §5)
    this.trail = glowSprite(P.cyan, 0, 0.85);
    this.trail.position.set(0, -0.2, 4.5);
    this.group.add(this.trail);

    // aim reticle — sits on the fire line ahead of the nose while the aim
    // trigger is held. A bright glowing red ring + crosshair; gold on lock.
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
    // soft red halo behind the ring + hot center dot, so it reads as glowing
    this.reticleGlow = glowSprite(P.red, 5.5, 0.55);
    this.reticleGlow.renderOrder = 39;
    this.reticleDot = glowSprite(P.red, 1.6, 1);
    this.reticleDot.renderOrder = 42;
    this.reticle.add(this.reticleRing, this.reticleGlow, this.reticleDot);
    this.reticle.position.set(0, 0.05, -26);
    this.reticle.visible = false;
    this.group.add(this.reticle);
    this.reticleLock = false;

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
    this.radius = 1.35;
    this.reset(BASE_STATS());
  }

  reset(stats) {
    this.stats = stats;
    this.x = 0;
    this.y = 1;
    this.vx = 0;
    this.vy = 0;
    this.health = stats.maxHealth;
    this.shield = stats.shieldMax; // passive shield starts charged
    this.boost = stats.boostCapacity;
    this.boosting = false;
    this.dodgeT = 0; // >0 while inside the perfect-dodge window
    this.dodgeUsed = false; // one dodge award per boost tap
    this.dodgePending = false; // a threat passed us inside the window
    this.dodgeSpoiled = false; // ...but we got hit, so it doesn't count
    this.rollT = 0; // >0 while a barrel roll is in progress
    this.rollCd = 0; // roll cooldown remaining
    this.rollDir = 0; // -1 left, +1 right
    this.invuln = 0;
    this.noDamageT = 0;
    this.buffT = 0; // dodge-drive speed/fire buff
    this.critBuffT = 0; // perfect-dodge weapon-power buff
    this.blocksLeft = stats.freeBlocks;
    this.alive = true;
    this.timeSinceHit = 99;
    this.lastKiller = '';
    this.group.position.set(0, 1, 0);
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
    this.group.scale.set(1, 1, 1);
    this.shieldMesh.material.opacity = 0;
    this.frozen = false;
    this.reticle.visible = false;
    this.reticleLock = false;
  }

  applyStats(stats) {
    // keep current health ratio when max health changes mid-run
    this.stats = stats;
    this.blocksLeft = stats.freeBlocks;
  }

  get pos() {
    return { x: this.x, y: this.y };
  }

  get moveSpeed() {
    return this.stats.moveSpeed * (this.buffT > 0 ? 1.4 : 1);
  }

  get fireRate() {
    return this.stats.fireRate * (this.buffT > 0 ? 1.4 : 1);
  }

  update(dt, ctx) {
    if (!this.alive) return;

    const inp = this.frozen ? { x: 0, y: 0, boost: false } : Input.read();

    // ---- boost ----
    const wantBoost = inp.boost && this.boost > 2;
    if (wantBoost && !this.boosting) {
      this.boosting = true;
      this.dodgeT = DODGE_WINDOW;
      this.dodgeUsed = false;
      this.dodgePending = false;
      this.dodgeSpoiled = false;
      Audio2.play('boost', 0.5, 1.4, 0.08);
    }
    if (!inp.boost) this.boosting = false;

    if (this.boosting) {
      this.boost = Math.max(0, this.boost - this.stats.boostDrain * dt);
      if (this.boost <= 0) this.boosting = false;
    } else {
      // recharges faster when not recently hit (spec §5)
      const rate = this.stats.boostRegen * (this.timeSinceHit > 2 ? 1.35 : 0.7);
      this.boost = Math.min(this.stats.boostCapacity, this.boost + rate * dt);
    }
    if (this.dodgeT > 0) this.dodgeT -= dt;

    // ---- barrel roll ----
    if (this.rollCd > 0) this.rollCd -= dt;
    const rollReq = Input.consumeRoll() * (this.frozen ? 0 : 1);
    if (rollReq && this.rollT <= 0 && this.rollCd <= 0 && this.boost >= ROLL_COST) {
      this.rollT = ROLL_TIME;
      this.rollDir = rollReq;
      this.rollCd = ROLL_CD;
      this.boost = Math.max(0, this.boost - ROLL_COST);
      // i-frames for the whole roll, and it opens the dodge window like a boost
      this.invuln = Math.max(this.invuln, ROLL_TIME);
      this.dodgeT = Math.max(this.dodgeT, ROLL_TIME);
      this.dodgeUsed = false;
      this.dodgePending = false;
      this.dodgeSpoiled = false;
      Audio2.play('boost', 0.55, 1.9, 0.05);
      this.fx.jet(this.x, this.y, 2.5, { x: this.rollDir, y: 0, z: 0 }, 4, [P.cyan, P.white]);
    }
    if (this.rollT > 0) this.rollT -= dt;

    // ---- motion ----
    // A high response rate is what makes the Star Hopper feel like a direct
    // extension of the stick — velocity chases the input almost immediately,
    // so direction changes read as instant without losing all inertia.
    // Braking (Y / C) slows the ship for precision flying; boost wins.
    const braking = !this.frozen && !this.boosting && Input.braking;
    const speed = (this.boosting ? this.stats.boostSpeed : this.moveSpeed) * (braking ? 0.45 : 1);
    const response = 13;
    this.vx = damp(this.vx, inp.x * speed, response, dt);
    this.vy = damp(this.vy, inp.y * speed * 0.9, response, dt);

    // barrel roll adds a decaying lateral dash on top of steering
    if (this.rollT > 0) {
      const k = this.rollT / ROLL_TIME; // 1 -> 0 across the roll (ease-out dash)
      this.x = clamp(this.x + this.rollDir * ROLL_DASH * k * dt, ARENA.minX, ARENA.maxX);
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
      const k = 1 - this.rollT / ROLL_TIME; // 0 -> 1
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
    if (this.stats.healthRegen > 0 && this.health < this.stats.maxHealth && this.timeSinceHit > this.stats.regenDelay) {
      this.health = Math.min(this.stats.maxHealth, this.health + this.stats.healthRegen * dt);
    }

    // ---- shield regen ----
    if (this.stats.shieldMax > 0) {
      if (this.timeSinceHit > this.stats.shieldDelay) {
        this.shield = Math.min(this.stats.shieldMax, this.shield + this.stats.shieldRegen * dt);
      }
      const s = this.shield / this.stats.shieldMax;
      this.shieldMesh.material.opacity = s * 0.32;
      this.shieldMesh.rotation.y += dt * 0.9;
      this.shieldMesh.rotation.x += dt * 0.4;
    }

    // ---- aim reticle ----
    const aiming = !this.frozen && Input.aiming;
    this.reticle.visible = aiming;
    if (aiming) {
      const col = this.reticleLock ? P.gold : P.red;
      this.reticleRing.material.color.set(col);
      this.reticleDot.material.color.set(col);
      this.reticleGlow.material.color.set(col);
      for (const t of this.reticleTicks) t.material.color.set(col);
      const pulse = 1 + (this.reticleLock ? 0.12 : 0.05) * Math.sin(ctx.time * (this.reticleLock ? 10 : 6));
      this.reticle.scale.setScalar(pulse);
    }

    // ---- visuals ----
    const boostGlow = this.boosting ? 1 : 0;
    this.engines.forEach((sp, i) => {
      const f = 1.15 + Math.sin(ctx.time * 31 + i) * 0.12 + boostGlow * 0.9;
      sp.scale.set(f, f * 1.6, 1);
    });
    const tScale = damp(this.trail.scale.x, this.boosting ? 5.5 : 0, 12, dt);
    this.trail.scale.set(tScale, tScale * 0.55, 1);

    if (this.boosting && Math.random() < dt * 40) {
      this.fx.jet(this.x, this.y - 0.2, 2.5, { x: 0, y: 0, z: 1 }, 2, [P.cyan, P.magenta, P.white]);
    }
  }

  /** Called by the dodge system when an attack was evaded inside the window. */
  awardDodge() {
    this.dodgeUsed = true;
    this.dodgePending = false;
    this.boost = Math.min(this.stats.boostCapacity, this.boost + 18); // energy refund
    this.critBuffT = 2.5; // brief weapon-power increase
    if (this.stats.dodgeDrive) this.buffT = 4;
    if (this.stats.riftDrain) {
      if (this.stats.shieldMax > 0 && this.shield < this.stats.shieldMax) {
        this.shield = Math.min(this.stats.shieldMax, this.shield + 10);
      } else {
        this.health = Math.min(this.stats.maxHealth, this.health + 8);
      }
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
    if (!this.alive || this.invuln > 0) return false;

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

    let dmg = amount * (1 - this.stats.damageReduction);

    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
      Audio2.play('shield_break', 0.6, 1.1);
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
    if (navigator.vibrate) {
      try {
        navigator.vibrate(60);
      } catch {
        /* ignore */
      }
    }

    if (this.health <= 0) {
      // Second Wind: one revive per run
      if (this.stats.secondWind) {
        this.stats.secondWind = false;
        this.health = this.stats.maxHealth * 0.5;
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
      this.health = 0;
      this.alive = false;
    }
    return true;
  }

  heal(amount) {
    this.health = Math.min(this.stats.maxHealth, this.health + amount);
  }

  refundBoost(amount) {
    this.boost = Math.min(this.stats.boostCapacity, this.boost + amount);
  }
}
