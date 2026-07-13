import * as THREE from 'three';
import { P, DEBRIS } from '../core/Palette.js';
import { buildVoxels, glowSprite } from '../render/VoxelBuilder.js';
import { ENEMY_TYPES } from './EnemyTypes.js';
import { Target, PRIORITY } from '../combat/Target.js';
import { Audio2 } from '../core/AudioManager.js';
import { rand, damp, clamp, TAU } from '../core/Utils.js';
import { ARENA } from '../player/Player.js';

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
    this.hpScale = opts.hpScale ?? 1;
    this.elite = opts.elite ?? false;

    // formation point: where this enemy wants to sit and shoot from
    this.fx = opts.fx ?? rand(ARENA.minX + 4, ARENA.maxX - 4);
    this.fy = opts.fy ?? rand(-4, 10);
    this.fz = opts.fz ?? rand(-34, -20);

    this.fireT = rand(0.6, t.fireInterval);
    this.burstLeft = 0;
    this.burstT = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.repositionT = rand(3, 6);
    this.phase = rand(0, TAU);
    this.shielded = false;

    this.mesh.visible = true;
    this.mesh.position.set(x, y, z);
    this.mesh.scale.setScalar(1);
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
    game.targets.push(this.target);
    return this;
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    const g = this.game;
    const t = this.type;

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
    if (g.player.stats.riftDrain) g.player.refundBoost(9);

    this.active = false;
    this.mesh.visible = false;
    if (this.shieldRing) this.shieldRing.visible = false;
  }

  despawn() {
    this.active = false;
    this.alive = false;
    this.mesh.visible = false;
    if (this.shieldRing) this.shieldRing.visible = false;
    if (this.target) this.target.targetable = false;
  }

  update(dt, game) {
    if (!this.active || !this.alive) return;
    const t = this.type;
    const p = game.player;
    this.phase += dt;

    // --- movement ---
    switch (t.behavior) {
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
        this.mesh.rotation.z += dt * 1.5;
        break;
      }
      default:
        break;
    }

    this.mesh.position.set(this.x, this.y, this.z);

    // --- firing ---
    if (t.projectileDamage > 0) {
      if (this.burstLeft > 0) {
        this.burstT -= dt;
        if (this.burstT <= 0) {
          this._shoot(game);
          this.burstLeft -= 1;
          this.burstT = 0.16;
        }
      } else {
        this.fireT -= dt;
        if (this.fireT <= 0) {
          this.fireT = t.fireInterval * rand(0.85, 1.2) * (game.difficulty?.fireScale ?? 1);
          this.burstLeft = t.burst;
          this.burstT = 0;
        }
      }
    }

    // squash the hit-flash back down
    const s = damp(this.mesh.scale.x, 1, 12, dt);
    this.mesh.scale.setScalar(s);

    // shield ring visual
    if (this.shieldRing) {
      this.shieldRing.position.set(this.x, this.y, this.z);
      this.shieldRing.rotation.z += dt * 2;
    }
  }

  _shoot(game) {
    const t = this.type;
    const p = game.player;
    // basic lead: aim slightly ahead of the player's velocity (spec §8)
    const lead = 0.12;
    game.projectiles.fireEnemy({
      x: this.x,
      y: this.y,
      z: this.z,
      tx: p.x + p.vx * lead,
      ty: p.y + p.vy * lead,
      tz: 0,
      speed: t.projectileSpeed,
      damage: t.projectileDamage * (game.difficulty?.damageScale ?? 1),
      color: t.color,
      radius: t.heavyShot ? 1.5 : 0.85,
      label: t.name,
      heavy: !!t.heavyShot,
    });
    Audio2.play(t.heavyShot ? 'heavy_shot' : 'enemy_shot', t.heavyShot ? 0.4 : 0.22, 1, 0.1);
  }
}

export class EnemySpawner {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.pools = {};
    this.active = [];

    for (const [key, t] of Object.entries(ENEMY_TYPES)) {
      const proto = buildVoxels(t.voxels(), t.scale);
      this.pools[key] = [];
      for (let i = 0; i < POOL_PER_TYPE; i++) {
        const mesh = proto.clone();
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
    this.active.push(e);
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
      let shielded = false;
      for (const s of shielders) {
        if (Math.hypot(e.x - s.x, e.y - s.y, e.z - s.z) < s.type.shieldRadius) {
          shielded = true;
          break;
        }
      }
      e.shielded = shielded;
      e.target.damageScale = shielded ? 0.3 : 1;
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
