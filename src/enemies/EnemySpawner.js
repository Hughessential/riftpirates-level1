import * as THREE from 'three';
import { P, DEBRIS } from '../core/Palette.js';
import { buildVoxels, glowSprite } from '../render/VoxelBuilder.js';
import { createImportedModel } from '../render/ImportedAssets.js';
import { ENEMY_TYPES } from './EnemyTypes.js';
import { Target, PRIORITY } from '../combat/Target.js';
import { Audio2 } from '../core/AudioManager.js';
import { rand, damp, clamp, TAU } from '../core/Utils.js';
import { ARENA } from '../player/Player.js';
import { EnemyAbilities, enemySector } from './EnemyAbilities.js';

/**
 * Enemies are pooled per type and driven by four scripted behaviours — no
 * pathfinding, no navmesh (spec §32). They fly to a formation point, hold, fire
 * bursts and reposition.
 */

const POOL_PER_TYPE = 14;

class Enemy {
  constructor(type, mesh, shieldRing) {
    this.type = type;
    this.typeName = type.name;
    this.mesh = mesh;
    this.shieldRing = shieldRing;
    this.active = false;
    this.alive = false;
    this.target = null;
  }

  spawn(game, x, y, z, opts = {}) {
    const t = this.type;
    this.game = game;
    this.active = true;
    this.alive = true;
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = 0;
    this.vy = 0;
    this.radius = t.radius;
    this.contactDamage = t.contactDamage;
    this.sector = enemySector(game.director?.state);
    this.hpScale = (opts.hpScale ?? 1) * (1 + this.sector * .12);
    this.damagePressure = 1 + this.sector * .08;
    this.firePressure = 1 - this.sector * .06;
    this.elite = opts.elite ?? false;
    // Only the final escape supplies a flight plan. A reused hull must shed
    // its previous fleet membership before ordinary encounters can use it.
    this.escapeFlight = opts.escapeFlight ? { ...opts.escapeFlight } : null;

    // formation point: where this enemy wants to sit and shoot from
    this.fx = opts.fx ?? rand(ARENA.minX + 4, ARENA.maxX - 4);
    this.fy = opts.fy ?? rand(-4, 10);
    this.fz = opts.fz ?? rand(-34, -20);

    this.fireT = rand(0.6, t.fireInterval);
    this.burstLeft = 0;
    this.burstT = 0;
    this.burstAim = null;
    this.shotSequence = 0;
    this.augmentSlowFactor = 1;
    this.augmentSlowT = 0;
    this.actionScale = 1;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.repositionT = rand(3, 6);
    this.phase = rand(0, TAU);
    this.shielded = false;

    this.mesh.visible = true;
    this.mesh.position.set(x, y, z);
    this.mesh.scale.setScalar(1);
    this.mesh.rotation.set(0, 0, 0);
    const charge = this.mesh.getObjectByName('enemy-charge-tell');
    if (charge) charge.material.opacity = 0;
    if (this.shieldRing) this.shieldRing.visible = false;

    this.target = new Target({
      object3D: this.mesh,
      hp: t.hp * this.hpScale,
      radius: t.radius,
      priority: t.highPriority ? PRIORITY.ENEMY - 4 : PRIORITY.ENEMY,
      kind: 'enemy',
      label: t.name,
      scrap: Math.round(t.scrap * (opts.scrapScale ?? 1)),
      score: t.score,
      xp: t.xp,
      onDamage: (dmg, crit) => {
        this.mesh.scale.setScalar(1.18);
      },
      onDeath: () => this.die(),
    });
    this.target.owner = this;
    game.targets.push(this.target);
    return this;
  }

  die() {
    if (!this.alive) return;
    this.game.enemies.abilities.cancel(this);
    this.alive = false;
    const g = this.game;
    const t = this.type;

    if (this.escapeFlight) g.escape?.carnage?.onEnemyDestroyed(this);

    g.fx.explode(this.x, this.y, this.z, {
      count: this.elite ? 26 : 14,
      colors: DEBRIS.enemy,
      power: this.elite ? 15 : 11,
      arcColor: t.color,
    });
    Audio2.play('enemy_death', 0.5, this.elite ? 0.8 : 1.05, 0.08);

    g.scrap.burst(this.x, this.y, this.z, this.target.scrap);
    g.score.add(t.score, this.elite ? 'ELITE KILL' : 'ENEMY KILL');
    g.heat.onKill();
    g.xp.add(t.xp);
    g.stats.kills += 1;

    // Rift Drain: kills top up boost energy
    if (g.player.stats.riftDrain) g.player.refundBoost(9 * Number(g.player.stats.riftDrain));
    g.augmentEffects?.onKill(this);

    this.active = false;
    this.mesh.visible = false;
    if (this.shieldRing) this.shieldRing.visible = false;
  }

  despawn() {
    this.game?.enemies?.abilities?.cancel(this);
    this.active = false;
    this.alive = false;
    this.mesh.visible = false;
    if (this.shieldRing) this.shieldRing.visible = false;
    if (this.target) {
      this.target.targetable = false;
      this.target.alive = false;
    }
  }

  update(dt, game) {
    if (!this.active || !this.alive) return;
    const t = this.type;
    const p = game.player;
    // Status duration expires in game time; only the affected enemy's action
    // clock slows, so cryo/gravity never change player input or the world clock.
    const slow = this.augmentSlowT > 0 ? clamp(this.augmentSlowFactor, 0.2, 1) : 1;
    this.actionScale = slow;
    this.augmentSlowT = Math.max(0, this.augmentSlowT - dt);
    if (!this.augmentSlowT) this.augmentSlowFactor = 1;
    dt *= slow;
    this.phase += dt;

    // --- movement ---
    if (this.escapeFlight) {
      const flight = this.escapeFlight;
      flight.age += dt;
      flight.departing = flight.age > flight.hold;
      const peeling = Math.max(0, flight.age - flight.hold);
      const oldX = this.x;
      this.x = damp(this.x, flight.departing ? flight.side * 37
        : this.fx + Math.sin(this.phase * 1.1 + flight.seed) * 2.1, flight.departing ? 3.4 : 1.15, dt);
      this.y = damp(this.y, this.fy + Math.cos(this.phase * .85 + flight.seed) * 1.2, 1.2, dt);
      // Peel away first, then allow the player to overtake the formation.
      // Passing ships cannot ram the only required gap or shoot at point blank.
      if (peeling > .85) this.z += (game.escape?.speed || 44) * .95 * dt;
      else this.z = damp(this.z, this.fz, 1.35, dt);
      this.mesh.rotation.z = damp(this.mesh.rotation.z,
        clamp((this.x - oldX) / Math.max(.001, dt) * -.025, -.48, .48), 6, dt);
      this.mesh.rotation.y = Math.sin(this.phase + flight.seed) * .13;
      if (this.z > 18 || peeling > 6) {
        flight.retired = true;
        this.despawn();
        return;
      }
    } else switch (t.behavior) {
      case 'intercept': {
        // Imported recon craft fly a banking figure-eight toward the player's
        // lane, then peel out. Their noses stay forward instead of drone-spinning.
        const tx = clamp(p.x * 0.6 + Math.sin(this.phase * 1.5) * 10, ARENA.minX + 3, ARENA.maxX - 3);
        const ty = clamp(p.y * 0.4 + 3 + Math.sin(this.phase * 2.1) * 4, -5, 11);
        const oldX = this.x;
        this.x = damp(this.x, tx, 1.2, dt);
        this.y = damp(this.y, ty, 1.1, dt);
        this.z = damp(this.z, this.fz + Math.sin(this.phase * 0.85) * 7, 1.4, dt);
        this.mesh.rotation.z = damp(this.mesh.rotation.z, clamp((this.x - oldX) / Math.max(dt, 0.001) * -0.028, -0.38, 0.38), 5, dt);
        this.mesh.rotation.y = Math.sin(this.phase * 1.5) * 0.12;
        this.mesh.rotation.x = Math.cos(this.phase * 2.1) * 0.08;
        break;
      }
      case 'dive': {
        // fast scout: closes toward the player, weaving
        const tx = p.x + Math.sin(this.phase * 1.4) * 6;
        const ty = p.y + Math.cos(this.phase * 1.1) * 4;
        this.x = damp(this.x, tx, 1.1, dt);
        this.y = damp(this.y, ty, 0.9, dt);
        this.z = damp(this.z, this.fz, 1.4, dt);
        this.mesh.rotation.y += dt * 3;
        break;
      }
      case 'hold': {
        // fly to the formation point and hover there
        this.x = damp(this.x, this.fx + Math.sin(this.phase * 0.8) * 2, 1.6, dt);
        this.y = damp(this.y, this.fy + Math.cos(this.phase * 0.6) * 1.5, 1.4, dt);
        this.z = damp(this.z, this.fz, 1.8, dt);
        this.repositionT -= dt;
        if (this.repositionT <= 0) {
          this.repositionT = rand(3.5, 6.5);
          this.fx = rand(ARENA.minX + 4, ARENA.maxX - 4);
          this.fy = rand(-4, 10);
        }
        break;
      }
      case 'strafe': {
        // elite: holds range and slides laterally, reversing at the arena edge
        this.fx += this.strafeDir * t.speed * dt;
        if (this.fx > ARENA.maxX - 3 || this.fx < ARENA.minX + 3) this.strafeDir *= -1;
        this.fx = clamp(this.fx, ARENA.minX + 3, ARENA.maxX - 3);
        this.x = damp(this.x, this.fx, 2.4, dt);
        this.y = damp(this.y, this.fy + Math.sin(this.phase * 1.3) * 2.5, 1.6, dt);
        this.z = damp(this.z, this.fz, 1.8, dt);
        this.mesh.rotation.z = -this.strafeDir * 0.25;
        break;
      }
      case 'guard': {
        // shield drone: parks in the middle of the pack it is protecting
        let cx = 0;
        let cy = 4;
        let n = 0;
        for (const e of game.enemies.active) {
          if (e === this || !e.alive || e.type.shieldRadius) continue;
          cx += e.x;
          cy += e.y;
          n++;
        }
        if (n > 0) {
          cx /= n;
          cy /= n;
        }
        this.x = damp(this.x, cx, 0.8, dt);
        this.y = damp(this.y, cy + 3, 0.8, dt);
        this.z = damp(this.z, this.fz, 1.2, dt);
        this.mesh.rotation.z = Math.sin(this.phase * 0.7) * 0.14;
        this.mesh.rotation.y = Math.sin(this.phase * 0.45) * 0.18;
        break;
      }
      default:
        break;
    }

    this.mesh.position.set(this.x, this.y, this.z);

    // --- firing ---
    if (t.projectileDamage > 0 && this.special?.phase !== 'windup') {
      if (this.burstLeft > 0) {
        this.burstT -= dt;
        if (this.burstT <= 0) {
          this._shoot(game);
          this.burstLeft -= 1;
          this.burstT = 0.16;
        }
      } else if (this.escapeFlight) {
        const flight = this.escapeFlight;
        if (flight.trigger && !flight.departing && this.z < -26) {
          flight.trigger = false;
          this.burstLeft = t.burst;
          this.burstAim = { ...flight.aim };
          this.burstT = .45;
        }
      } else {
        this.fireT -= dt;
        if (this.fireT <= 0) {
          this.fireT = t.fireInterval * this.firePressure * rand(0.85, 1.2) * (game.difficulty?.fireScale ?? 1);
          this.burstLeft = t.burst;
          // Snapshot the aim, then give the player a visible charge window.
          // A burst never tracks their dodge after the warning has started.
          this.burstAim = { x: p.x + p.vx * 0.12, y: p.y + p.vy * 0.12 };
          this.burstT = 0.32;
        }
      }
    }
    game.enemies.abilities.update(this, dt);

    // squash the hit-flash back down
    const s = damp(this.mesh.scale.x, 1, 12, dt);
    this.mesh.scale.setScalar(s);
    // The authored engines/eyes already have emissive voxels; one subtle
    // pulsing accent per pooled ship gives their silhouettes life at distance.
    const thruster = this.mesh.getObjectByName('enemy-engine-glow');
    if (thruster) thruster.material.opacity = 0.32 + Math.sin(this.phase * 12) * 0.08;
    const charge = this.mesh.getObjectByName('enemy-charge-tell');
    if (charge) {
      const warming = this.burstLeft === t.burst && this.burstT > 0;
      charge.material.opacity = this.special?.phase === 'windup'
        ? .5 + .5 * (this.special.t / t.special.warning)
        : warming ? 0.3 + 0.65 * (1 - this.burstT / (this.escapeFlight ? .45 : .32)) : 0;
    }

    // shield ring visual
    if (this.shieldRing) {
      this.shieldRing.position.set(this.x, this.y, this.z);
      this.shieldRing.rotation.z += dt * 2;
      this.shieldRing.scale.setScalar(this.specialShieldT > 0 ? 1.25 : 1);
      this.shieldRing.material.opacity = this.specialShieldT > 0 ? .36 : .16;
    }
  }

  _shoot(game) {
    const t = this.type;
    const p = game.player;
    if (!(t.projectileDamage > 0)) return;
    const aim = this.burstAim || { x: p.x + p.vx * 0.12, y: p.y + p.vy * 0.12 };
    const shots = [];
    if (t.attackPattern === 'twin') {
      // Four separated lanes leave a narrow safe channel through the middle.
      for (const lane of [-7, -2.2, 2.2, 7]) shots.push({ dx: lane, dy: 0, barrel: Math.sign(lane) });
    } else if (t.attackPattern === 'gappedRing') {
      // The omitted east/west ring cells form two broad exits. The heavier
      // central projectile is slow and visually larger, inviting a side-step.
      const angle = this.shotSequence * 0.23;
      for (let i = 0; i < 8; i++) {
        if (i === 0 || i === 4) continue;
        const theta = angle + i * TAU / 8;
        shots.push({ dx: Math.cos(theta) * 9, dy: Math.sin(theta) * 7, damageScale: 0.5 });
      }
      shots.push({ dx: 0, dy: 0, heavy: true, speed: 22 });
    } else if (t.attackPattern === 'rotatingFan') {
      const angle = Math.sin(this.shotSequence * 0.55) * 0.7;
      for (let lane = -2; lane <= 2; lane++) shots.push({ dx: Math.cos(angle) * lane * 5.2, dy: Math.sin(angle) * lane * 5.2 });
    } else {
      for (const lane of [-5, 0, 5]) shots.push({ dx: lane, dy: 0 });
    }
    this.shotSequence += 1;
    for (const shot of shots) {
      const tx = aim.x + shot.dx;
      const ty = aim.y + shot.dy;
      const speed = shot.speed || t.projectileSpeed;
      if (this.escapeFlight && !this.escapeFlight.allowShot(this,
        { x: tx, y: ty, sourceX: this.x + (shot.barrel || 0) * 1.15,
          sourceY: this.y, sourceZ: this.z + 1.1, radius: shot.heavy ? 1.1 : .55 }, speed)) continue;
      game.projectiles.fireEnemy({
        x: this.x + (shot.barrel || 0) * 1.15,
        y: this.y,
        z: this.z + 1.1,
        tx,
        ty,
        tz: 0,
        speed,
        damage: t.projectileDamage * this.damagePressure * (shot.damageScale ?? 1) * (game.difficulty?.damageScale ?? 1),
        color: t.shotColor || t.color,
        radius: shot.heavy ? 1.1 : 0.55,
        label: t.name,
        heavy: !!shot.heavy,
      });
    }
    Audio2.play(t.heavyShot ? 'heavy_shot' : 'enemy_shot', t.heavyShot ? 0.4 : 0.22, 1, 0.1);
  }
}

export class EnemySpawner {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.pools = {};
    this.active = [];
    this.abilities = new EnemyAbilities(game);

    for (const [key, t] of Object.entries(ENEMY_TYPES)) {
      const proto = createImportedModel(t.asset, { size: t.modelSize }) || buildVoxels(t.voxels(), t.scale);
      if (proto.userData.assetId) {
        const engine = glowSprite(t.color, t.modelSize * 0.28, 0.32);
        engine.name = 'enemy-engine-glow';
        engine.position.set(0, 0, -t.modelSize * 0.43);
        proto.add(engine);
      }
      if (t.projectileDamage > 0 || t.special) {
        const charge = glowSprite(t.shotColor || t.color, t.modelSize * 0.45, 0);
        charge.name = 'enemy-charge-tell';
        charge.position.set(0, 0, t.modelSize * 0.42);
        proto.add(charge);
      }
      this.pools[key] = [];
      for (let i = 0; i < POOL_PER_TYPE; i++) {
        const mesh = proto.clone();
        // Sprite brightness is animated independently for each ship. Geometry
        // and PBR materials remain shared between all pooled hulls.
        mesh.traverse((child) => { if (child.isSprite) child.material = child.material.clone(); });
        mesh.visible = false;
        scene.add(mesh);

        let ring = null;
        if (t.shieldRadius) {
          ring = new THREE.Mesh(
            new THREE.RingGeometry(t.shieldRadius - 0.4, t.shieldRadius, 32),
            new THREE.MeshBasicMaterial({
              color: P.cyan,
              transparent: true,
              opacity: 0.16,
              side: THREE.DoubleSide,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            })
          );
          ring.visible = false;
          scene.add(ring);
        }
        this.pools[key].push(new Enemy(t, mesh, ring));
      }
    }
  }

  spawn(typeKey, x, y, z, opts) {
    const pool = this.pools[typeKey];
    if (!pool) return null;
    const e = pool.find((o) => !o.active);
    if (!e) return null;
    e.spawn(this.game, x, y, z, opts);
    this.abilities.reset(e);
    // A kill can leave this pooled object listed until the next update.
    if (!this.active.includes(e)) this.active.push(e);
    return e;
  }

  /** Spawn just off-screen at a random edge, never on top of the player (spec §44). */
  spawnOffscreen(typeKey, opts = {}) {
    const x = rand(ARENA.minX, ARENA.maxX);
    const y = rand(0, 12);
    return this.spawn(typeKey, x, y, -95, opts);
  }

  get count() {
    return this.active.length;
  }

  countAlive() {
    let n = 0;
    for (const e of this.active) if (e.alive) n++;
    return n;
  }

  update(dt) {
    const g = this.game;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      if (!e.active) {
        this.active.splice(i, 1);
        continue;
      }
      e.update(dt, g);
    }

    // Shield drones grant damage reduction to everything inside their bubble.
    const shielders = this.active.filter((e) => e.alive && e.type.shieldRadius);
    for (const e of this.active) {
      if (!e.alive || !e.target) continue;
      if (e.type.shieldRadius) continue;
      let shielded = false, overcharged = false;
      for (const s of shielders) {
        if (Math.hypot(e.x - s.x, e.y - s.y, e.z - s.z) < s.type.shieldRadius * (s.specialShieldT > 0 ? 1.25 : 1)) {
          shielded = true;
          overcharged ||= s.specialShieldT > 0;
        }
      }
      e.shielded = shielded;
      e.target.damageScale = overcharged ? .18 : shielded ? 0.3 : 1;
    }
    for (const s of shielders) {
      if (s.shieldRing) s.shieldRing.visible = true;
    }

    if (this.active.length) g.stats.maxOnscreen = Math.max(g.stats.maxOnscreen, this.countAlive());
  }

  clear() {
    for (const e of this.active) e.despawn();
    this.active.length = 0;
  }
}
