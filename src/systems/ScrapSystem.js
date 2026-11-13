import * as THREE from 'three';
import { P } from '../core/Palette.js';
import { Tex } from '../render/VoxelBuilder.js';
import { Audio2 } from '../core/AudioManager.js';
import { rand, damp } from '../core/Utils.js';

/**
 * Scrap (spec §29): drops from everything, collected by proximity, banked to
 * localStorage at the end of the run — kept even on death.
 */

const MAX = 260;
export const LOOT_COLORS = Object.freeze([0xf4f8ff, 0xffca43, 0xa956ff, 0x27f5da, 0xff53cb]);

export class ScrapSystem {
  constructor(scene, game) {
    this.game = game;
    this.pool = [];
    this.burstSerial = 0;
    // One shared halo batch; pickups never add hundreds of dynamic lights.
    this.halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: Tex.glow, transparent: true, opacity: .17,
        blending: THREE.AdditiveBlending, depthWrite: false }), MAX);
    this.halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halos.frustumCulled = false;
    this._transform = new THREE.Object3D();
    scene.add(this.halos);
    for (let i = 0; i < MAX; i++) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: Tex.diamond,
          transparent: true,
          depthWrite: false,
        })
      );
      sp.scale.set(0.9, 0.9, 1);
      sp.visible = false;
      scene.add(sp);
      this.pool.push({ sp, active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, value: 1, life: 0, tint: LOOT_COLORS[0], size: 1 });
    }
    this.reset();
  }

  reset() {
    this.collected = 0;
    this.halos.count = 0;
    for (const o of this.pool) {
      o.active = false;
      o.sp.visible = false;
    }
  }

  /** @param {number} value total scrap to scatter; split across visible pieces. */
  burst(x, y, z, value, spread = 1) {
    if (value <= 0) return;
    const pieces = Math.min(Math.max(1, Math.round(value / 2)), 40);
    const per = value / pieces;
    this.burstSerial++;
    let made = 0;
    for (const o of this.pool) {
      if (o.active) continue;
      o.active = true;
      o.x = x + rand(-spread, spread);
      o.y = y + rand(-spread, spread);
      o.z = z + rand(-spread, spread);
      o.vx = rand(-8, 8) * spread;
      o.vy = rand(-5, 9) * spread;
      o.vz = rand(3, 12);
      o.value = per;
      o.life = 14;
      // Presentation colors do not change the amount of earned scrap.
      o.tint = LOOT_COLORS[(this.burstSerial + made) % LOOT_COLORS.length];
      o.size = .95 + Math.min(.65, per * .025);
      o.sp.material.color.setHex(o.tint).multiplyScalar(1.7);
      o.sp.material.opacity = 1;
      o.sp.scale.setScalar(o.size);
      o.sp.visible = true;
      o.sp.position.set(o.x, o.y, o.z);
      made++;
      if (made >= pieces) break;
    }
  }

  update(dt, worldSpeed) {
    const g = this.game;
    const p = g.player;
    const radius = p.stats.scrapRadius;
    let picked = 0;
    let haloCount = 0;

    for (const o of this.pool) {
      if (!o.active) continue;

      o.life -= dt;
      o.vx *= 1 - dt * 2;
      o.vy *= 1 - dt * 2;
      o.vz *= 1 - dt * 2;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.z += (o.vz + worldSpeed * 0.8) * dt;

      const d = Math.hypot(o.x - p.x, o.y - p.y, o.z);

      // magnet pull
      if (d < radius && p.alive) {
        const pull = (38 * dt) / Math.max(d, 0.6);
        o.x += (p.x - o.x) * pull;
        o.y += (p.y - o.y) * pull;
        o.z += (0 - o.z) * pull;
      }

      if (d < 1.9 && p.alive) {
        o.active = false;
        o.sp.visible = false;
        const gained = o.value * p.stats.scrapMultiplier;
        this.collected += gained;
        g.augmentEffects?.onScrap(gained);
        if (p.stats.scrapYield > 0) g.score.add(gained * 12 * p.stats.scrapYield, 'PLUNDER');
        g.heat.onScrapCollected();
        picked++;
        continue;
      }

      if (o.life <= 0 || o.z > 22) {
        o.active = false;
        o.sp.visible = false;
        continue;
      }

      o.sp.position.set(o.x, o.y, o.z);
      o.sp.material.rotation += dt * 1.8;
      const shimmer = 1 + .09 * Math.sin(o.life * 8 + o.value);
      o.sp.scale.setScalar(o.size * shimmer);
      o.sp.material.opacity = Math.min(1, o.life);
      const transform = this._transform;
      transform.position.set(o.x, o.y, o.z);
      if (g.camera) transform.quaternion.copy(g.camera.quaternion);
      transform.scale.setScalar(o.size * (2.4 + .15 * Math.sin(o.life * 5)));
      transform.updateMatrix();
      this.halos.setMatrixAt(haloCount, transform.matrix);
      this.halos.setColorAt(haloCount++, o.sp.material.color);
    }
    this.halos.count = haloCount;
    this.halos.instanceMatrix.needsUpdate = true;
    if (this.halos.instanceColor) this.halos.instanceColor.needsUpdate = true;

    if (picked > 0) {
      Audio2.play(picked > 4 ? 'scrap_burst' : 'scrap', 0.3, 1, 0.12);
    }
  }

  get total() {
    return Math.floor(this.collected);
  }
}
