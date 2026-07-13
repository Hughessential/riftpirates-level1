import * as THREE from 'three';
import { P } from '../core/Palette.js';
import { glowSprite } from '../render/VoxelBuilder.js';

/**
 * Pooled projectiles (spec §35). Player bolts fly toward whatever the targeting
 * system picked; enemy shots fly toward where the player was (with light lead).
 */

const PLAYER_MAX = 90;
const ENEMY_MAX = 160;

export class ProjectilePool {
  constructor(scene) {
    this.scene = scene;

    // ---- player bolts ----
    const pGeo = new THREE.BoxGeometry(0.16, 0.16, 2.4);
    const pMat = new THREE.MeshBasicMaterial({ color: P.magenta });
    const critMat = new THREE.MeshBasicMaterial({ color: P.gold });
    this.critMat = critMat;
    this.normalMat = pMat;

    this.player = [];
    for (let i = 0; i < PLAYER_MAX; i++) {
      const m = new THREE.Mesh(pGeo, pMat);
      m.visible = false;
      scene.add(m);
      this.player.push({
        mesh: m, active: false,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        damage: 0, crit: false, radius: 0.7, life: 0,
      });
    }

    // ---- enemy shots ----
    const eGeo = new THREE.SphereGeometry(0.34, 6, 6);
    this.enemy = [];
    for (let i = 0; i < ENEMY_MAX; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: P.orange });
      const m = new THREE.Mesh(eGeo, mat);
      const halo = glowSprite(P.orange, 1.7, 0.9);
      m.add(halo);
      m.visible = false;
      scene.add(m);
      this.enemy.push({
        mesh: m, halo, active: false,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        damage: 10, radius: 0.85, life: 0, label: 'ENEMY FIRE', heavy: false,
      });
    }
  }

  _free(pool) {
    for (const o of pool) if (!o.active) return o;
    return null;
  }

  firePlayer({ x, y, z = 0, tx, ty, tz, speed, damage, crit }) {
    const o = this._free(this.player);
    if (!o) return null;
    const dx = tx - x;
    const dy = ty - y;
    const dz = tz - z;
    const d = Math.hypot(dx, dy, dz) || 1;
    o.active = true;
    o.x = x;
    o.y = y;
    o.z = z;
    o.vx = (dx / d) * speed;
    o.vy = (dy / d) * speed;
    o.vz = (dz / d) * speed;
    o.damage = damage;
    o.crit = crit;
    o.life = 2.2;
    o.mesh.material = crit ? this.critMat : this.normalMat;
    o.mesh.scale.setScalar(crit ? 1.6 : 1);
    o.mesh.visible = true;
    o.mesh.position.set(x, y, z);
    o.mesh.lookAt(tx, ty, tz);
    return o;
  }

  fireEnemy({ x, y, z, tx, ty, tz, speed, damage, color = P.orange, radius = 0.85, label = 'ENEMY FIRE', heavy = false }) {
    const o = this._free(this.enemy);
    if (!o) return null;
    const dx = tx - x;
    const dy = ty - y;
    const dz = tz - z;
    const d = Math.hypot(dx, dy, dz) || 1;
    o.active = true;
    o.x = x;
    o.y = y;
    o.z = z;
    o.vx = (dx / d) * speed;
    o.vy = (dy / d) * speed;
    o.vz = (dz / d) * speed;
    o.damage = damage;
    o.radius = radius;
    o.label = label;
    o.heavy = heavy;
    o.life = 6;
    o.mesh.material.color.set(color);
    o.halo.material.color.set(color);
    // Heavy shots are visually larger so they read differently from chip damage.
    const s = heavy ? 2.4 : 1;
    o.mesh.scale.setScalar(s);
    o.mesh.visible = true;
    o.mesh.position.set(x, y, z);
    return o;
  }

  update(dt, worldSpeed = 0) {
    for (const o of this.player) {
      if (!o.active) continue;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.z += o.vz * dt;
      o.life -= dt;
      if (o.life <= 0 || o.z < -140 || o.z > 30) {
        o.active = false;
        o.mesh.visible = false;
        continue;
      }
      o.mesh.position.set(o.x, o.y, o.z);
    }
    for (const o of this.enemy) {
      if (!o.active) continue;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.z += (o.vz + worldSpeed * 0.35) * dt;
      o.life -= dt;
      if (o.life <= 0 || o.z > 26 || Math.abs(o.x) > 70 || Math.abs(o.y) > 50) {
        o.active = false;
        o.mesh.visible = false;
        continue;
      }
      o.mesh.position.set(o.x, o.y, o.z);
    }
  }

  killPlayerBolt(o) {
    o.active = false;
    o.mesh.visible = false;
  }

  killEnemyBolt(o) {
    o.active = false;
    o.mesh.visible = false;
  }

  /** Reality Tear clears nearby enemy fire on a perfect dodge. */
  clearEnemyNear(x, y, r) {
    let n = 0;
    for (const o of this.enemy) {
      if (!o.active) continue;
      if (Math.hypot(o.x - x, o.y - y) < r && o.z > -30) {
        this.killEnemyBolt(o);
        n++;
      }
    }
    return n;
  }

  reset() {
    for (const o of this.player) {
      o.active = false;
      o.mesh.visible = false;
    }
    for (const o of this.enemy) {
      o.active = false;
      o.mesh.visible = false;
    }
  }
}
