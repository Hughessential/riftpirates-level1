import * as THREE from 'three';
import { $ } from '../core/Utils.js';

/** Pooled DOM sprites projected from world space. Crits read differently (spec §17). */
const POOL = 26;

export class DamageNumbers {
  constructor(camera) {
    this.camera = camera;
    this.layer = $('dmgLayer');
    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'dmg';
      el.style.display = 'none';
      this.layer.appendChild(el);
      this.pool.push({ el, life: 0, pos: new THREE.Vector3(), rise: 0, drift: 0 });
    }
    this._v = new THREE.Vector3();
  }

  _free() {
    for (const o of this.pool) if (o.life <= 0) return o;
    return this.pool[0];
  }

  spawn(x, y, z, value, crit = false) {
    // A shotgun/chain build can land dozens of hits at one point. Sum nearby
    // hits in a brief fixed window instead of covering the target with labels.
    const recent = this.pool.find((o) => o.life > 0 && !o.blocked && o.crit === crit
      && o.max - o.life < .12 && (o.pos.x - x) ** 2 + (o.pos.y - y) ** 2 + (o.pos.z - z) ** 2 < 9);
    if (recent) {
      recent.value += value;
      recent.el.textContent = crit ? `${recent.value}!` : recent.value;
      return;
    }
    const o = this._free();
    o.pos.set(x, y, z);
    o.life = crit ? 0.95 : 0.65;
    o.max = o.life;
    o.rise = 0;
    o.drift = (Math.random() - 0.5) * 30;
    o.value = value;
    o.crit = crit;
    o.blocked = false;
    o.el.textContent = crit ? `${value}!` : value;
    o.el.className = crit ? 'dmg crit' : 'dmg';
    o.el.style.display = 'block';
  }

  spawnBlocked(x, y, z) {
    if (this.pool.some((o) => o.life > .2 && o.blocked
      && (o.pos.x - x) ** 2 + (o.pos.y - y) ** 2 + (o.pos.z - z) ** 2 < 16)) return;
    const o = this._free();
    o.blocked = true;
    o.pos.set(x, y, z);
    o.life = 0.5;
    o.max = 0.5;
    o.rise = 0;
    o.drift = 0;
    o.el.textContent = 'SHIELDED';
    o.el.className = 'dmg blocked';
    o.el.style.display = 'block';
  }

  update(dt) {
    for (const o of this.pool) {
      if (o.life <= 0) continue;
      o.life -= dt;
      o.rise += dt * 55;
      if (o.life <= 0) {
        o.el.style.display = 'none';
        continue;
      }
      this._v.copy(o.pos).project(this.camera);
      if (this._v.z > 1) {
        o.el.style.display = 'none';
        o.life = 0;
        continue;
      }
      o.el.style.left = `${(this._v.x * 0.5 + 0.5) * innerWidth + o.drift * (1 - o.life / o.max)}px`;
      o.el.style.top = `${(-this._v.y * 0.5 + 0.5) * innerHeight - o.rise}px`;
      o.el.style.opacity = Math.min(1, (o.life / o.max) * 2.5);
    }
  }

  reset() {
    for (const o of this.pool) {
      o.life = 0;
      o.el.style.display = 'none';
    }
  }
}
