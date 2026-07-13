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

export class ScrapSystem {
  constructor(scene, game) {
    this.game = game;
    this.pool = [];
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
      this.pool.push({ sp, active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, value: 1, life: 0 });
    }
    this.reset();
  }

  reset() {
    this.collected = 0;
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
      o.sp.material.rotation += dt * 4;
    }

    if (picked > 0) {
      Audio2.play(picked > 4 ? 'scrap_burst' : 'scrap', 0.3, 1, 0.12);
    }
  }

  get total() {
    return Math.floor(this.collected);
  }
}
