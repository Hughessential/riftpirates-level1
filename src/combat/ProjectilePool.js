import * as THREE from 'three';
import { P } from '../core/Palette.js';
import { PROJECTILE_BUDGET, WEAPON_STYLES, PROJECTILE_PARTS, projectileAppearance } from '../config/weapons.js';

/** Four instanced GPU batches draw all fire, irrespective of projectile count. */
export class ProjectilePool {
  constructor(scene) {
    this.scene = scene;
    this.cursor = { player: 0, enemy: 0 };
    this.saturationCount = 0;
    this.readabilityGain = 1;
    this._dummy = new THREE.Object3D();
    this._part = new THREE.Object3D();
    this._color = new THREE.Color();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const batch = (geometry, count, glow = false) => {
      const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: glow, opacity: glow ? .075 : 1,
        depthWrite: !glow, blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      }), count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      for (let i = 0; i < count; i++) {
        mesh.setMatrixAt(i, this._zero);
        mesh.setColorAt(i, this._color.setHex(0xffffff));
      }
      scene.add(mesh);
      return mesh;
    };
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.playerCore = batch(box, PROJECTILE_BUDGET.player * PROJECTILE_PARTS.core);
    this.playerGlow = batch(box, PROJECTILE_BUDGET.player * PROJECTILE_PARTS.glow, true);
    this.enemyCore = batch(new THREE.OctahedronGeometry(1), PROJECTILE_BUDGET.enemy);
    this.enemyGlow = batch(new THREE.OctahedronGeometry(1), PROJECTILE_BUDGET.enemy, true);
    this.player = this._slots(PROJECTILE_BUDGET.player, 'player');
    this.enemy = this._slots(PROJECTILE_BUDGET.enemy, 'enemy');
  }

  _slots(count, team) {
    return Array.from({ length: count }, (_, index) => {
      // Transform facade preserves collision/debug APIs without scene traversal.
      const mesh = new THREE.Object3D();
      mesh.visible = false;
      mesh.material = { color: new THREE.Color() };
      return { index, team, mesh, active: false, x: 0, y: 0, z: 0,
        px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, speed: 0,
        damage: 0, crit: false, radius: .7, life: 0, weapon: 'pulse', color: WEAPON_STYLES.pulse.color,
        pierce: 0, splash: 0, homing: 0, target: null, searchT: 0,
        procDepth: 0, hitTargets: new Set(), ricochetsRemaining: 0,
        augmentTimeScale: 1, heavy: false, age: 0, visual: null, label: 'ENEMY FIRE' };
    });
  }

  _free(team) {
    const pool = this[team];
    for (let i = 0; i < pool.length; i++) {
      const index = (this.cursor[team] + i) % pool.length;
      if (!pool[index].active) { this.cursor[team] = (index + 1) % pool.length; return pool[index]; }
    }
    return null;
  }

  firePlayer({ x, y, z = 0, tx = x, ty = y, tz = -90, speed = 105, damage = 18, crit = false,
    weapon = 'pulse', color, pierce = 0, splash = 0, homing = 0, target = null,
    procDepth = 0, ricochetsRemaining = 0, life = 2.6, radius, visual = null, rank = 1, power = 0 } = {}) {
    const style = WEAPON_STYLES[weapon] || WEAPON_STYLES.pulse;
    const speedScale = this.testing?.getTuning('playerProjectileSpeed') ?? 1;
    const lifeScale = this.testing?.getTuning('playerProjectileLife') ?? 1;
    const sizeScale = this.testing?.getTuning('playerProjectileSize') ?? 1;
    speed *= speedScale; life *= lifeScale;
    const appearance = visual || projectileAppearance(weapon, { rank, power, crit });
    const o = this._free('player');
    if (!o) {
      // A pathological build keeps its power without unbounded GPU allocation.
      this.saturationCount++;
      const existing = this.player.find((b) => b.active && b.weapon === weapon && b.procDepth === procDepth)
        || this.player[this.cursor.player];
      existing.damage += damage;
      return existing;
    }
    tz = Math.min(tz, z - .5);
    const dx = tx - x, dy = ty - y, dz = tz - z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const scaledAppearance = sizeScale === 1 ? appearance : {
      ...appearance,
      width: appearance.width * sizeScale,
      length: appearance.length * Math.max(.5, sizeScale),
    };
    Object.assign(o, { active: true, x, y, z, px: x, py: y, pz: z,
      vx: dx / d * speed, vy: dy / d * speed, vz: dz / d * speed,
      speed, damage, crit, life, weapon, color: color || scaledAppearance.color || style.color,
      radius: (radius ?? scaledAppearance.radius ?? style.radius) * sizeScale, pierce, splash, homing, target,
      searchT: 0, procDepth, ricochetsRemaining, augmentTimeScale: 1, age: 0, visual: scaledAppearance, onEnd: null });
    o.hitTargets.clear();
    o.mesh.visible = true; o.mesh.material.color.set(o.color);
    this._write(o);
    return o;
  }

  fireEnemy({ x, y, z, tx, ty, tz = 0, speed, damage, color = P.orange, radius = .85,
    label = 'ENEMY FIRE', heavy = false }) {
    const o = this._free('enemy');
    if (!o) return null;
    speed *= this.testing?.getTuning('enemyProjectileSpeed') ?? 1;
    damage *= this.testing?.getTuning('enemyDamage') ?? 1;
    const dx = tx - x, dy = ty - y, dz = tz - z;
    const d = Math.hypot(dx, dy, dz) || 1;
    Object.assign(o, { active: true, x, y, z, px: x, py: y, pz: z,
      vx: dx / d * speed, vy: dy / d * speed, vz: dz / d * speed,
      speed, damage, radius, label, heavy, life: 6, color,
      augmentTimeScale: 1, target: null, procDepth: 0, age: 0, visual: null });
    o.mesh.visible = true; o.mesh.material.color.set(color);
    this._write(o);
    return o;
  }

  _guide(o, dt, targets) {
    const valid = (t) => t?.alive && t.targetable && t.pos.z < o.z - .5
      && Math.hypot(t.pos.x - o.x, t.pos.y - o.y) < 42;
    o.searchT -= dt;
    if (!valid(o.target)) o.target = null;
    if (!o.target && o.searchT <= 0) {
      o.searchT = .15;
      let distance = 100;
      for (const t of targets || []) {
        if (!valid(t) || o.hitTargets.has(t)) continue;
        const d = Math.hypot(t.pos.x - o.x, t.pos.y - o.y, t.pos.z - o.z);
        if (d < distance) { distance = d; o.target = t; }
      }
    }
    if (!o.target) return;
    const dx = o.target.pos.x - o.x, dy = o.target.pos.y - o.y, dz = o.target.pos.z - o.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const k = Math.min(1, dt * o.homing);
    o.vx += (dx / d * o.speed - o.vx) * k;
    o.vy += (dy / d * o.speed - o.vy) * k;
    o.vz = Math.min(-o.speed * .12, o.vz + (dz / d * o.speed - o.vz) * k);
    const current = Math.hypot(o.vx, o.vy, o.vz) || 1;
    o.vx *= o.speed / current; o.vy *= o.speed / current; o.vz *= o.speed / current;
  }

  update(dt, worldSpeed = 0, game = null) {
    for (const o of this.player) {
      if (!o.active) continue;
      o.px = o.x; o.py = o.y; o.pz = o.z;
      o.age += dt;
      if (o.homing > 0) this._guide(o, dt, game?.targets);
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt; o.life -= dt;
      if (o.life <= 0 || o.z < -155 || o.z > 30 || Math.abs(o.x) > 95 || Math.abs(o.y) > 70) {
        this.killPlayerBolt(o, o.life <= 0 ? 'expired' : 'out-of-bounds'); continue;
      }
      this._write(o);
    }
    for (const o of this.enemy) {
      if (!o.active) continue;
      o.px = o.x; o.py = o.y; o.pz = o.z;
      const step = dt * Math.max(.1, Math.min(1, o.augmentTimeScale ?? 1));
      o.x += o.vx * step; o.y += o.vy * step; o.z += (o.vz + worldSpeed * .35) * step; o.life -= step;
      if (o.life <= 0 || o.z > 26 || Math.abs(o.x) > 70 || Math.abs(o.y) > 50) {
        this.killEnemyBolt(o); continue;
      }
      this._write(o);
    }
  }

  _write(o) {
    const d = this._dummy;
    const core = o.team === 'player' ? this.playerCore : this.enemyCore;
    const glow = o.team === 'player' ? this.playerGlow : this.enemyGlow;
    if (o.team === 'player') {
      const ci = o.index * PROJECTILE_PARTS.core, gi = o.index * PROJECTILE_PARTS.glow;
      if (!o.active) {
        for (let i = 0; i < PROJECTILE_PARTS.core; i++) core.setMatrixAt(ci + i, this._zero);
        for (let i = 0; i < PROJECTILE_PARTS.glow; i++) glow.setMatrixAt(gi + i, this._zero);
      } else {
        const v = o.visual;
        const w = v.width, l = v.length;
        d.position.set(o.x, o.y, o.z);
        d.lookAt(o.x + o.vx, o.y + o.vy, o.z + o.vz);
        d.scale.set(w, w, l);
        o.mesh.position.copy(d.position); o.mesh.quaternion.copy(d.quaternion); o.mesh.scale.copy(d.scale);
        const color = o.color;
        const accent = v.accent || color;
        const brightness = v.brightness * Math.sqrt(this.readabilityGain);
        // Parts share the bolt's flight transform; there are no extra scene
        // objects, colliders or damage events for the decorative silhouette.
        if (v.shape === 'orb') {
          this._put(core, ci, 0, 0, 0, w, w, w * 1.1, o.age * 2, color, brightness);
          const a = o.age * 6 + o.index;
          this._put(core, ci + 1, Math.cos(a) * w * .75, Math.sin(a) * w * .75, 0, w * .27, w * .27, w * .27, a, accent, brightness);
          this._put(core, ci + 2, -Math.cos(a) * w * .75, -Math.sin(a) * w * .75, 0, w * .27, w * .27, w * .27, a, accent, brightness);
        } else if (v.shape === 'missile') {
          this._put(core, ci, 0, 0, l * .1, w * .7, w * .7, l * .8, Math.PI / 4, color, brightness);
          for (const side of [-1, 1]) this._put(core, ci + (side < 0 ? 1 : 2), side * w * .68, 0, -l * .22, w * .8, w * .16, l * .42, 0, accent, brightness);
        } else if (v.shape === 'helix') {
          const a = o.age * 18 + o.index * .7;
          this._put(core, ci, 0, 0, 0, w * .5, w * .5, l, 0, color, brightness);
          for (const side of [-1, 1]) this._put(core, ci + (side < 0 ? 1 : 2), side * Math.cos(a) * w, side * Math.sin(a) * w, -l * .16, w * .35, w * .35, l * .65, a, accent, brightness);
        } else if (v.shape === 'double') {
          this._put(core, ci, 0, 0, l * .3, w * 1.8, w * .35, l * .13, 0, color, brightness);
          for (const side of [-1, 1]) this._put(core, ci + (side < 0 ? 1 : 2), side * w * .62, 0, -l * .05, w * .48, w * .7, l, 0, accent, brightness);
        } else if (v.shape === 'cleaver' || v.shape === 'pellet') {
          this._put(core, ci, 0, 0, 0, w * 1.8, w * .6, v.shape === 'pellet' ? w : l * .6, Math.PI / 4, color, brightness);
          for (const side of [-1, 1]) this._put(core, ci + (side < 0 ? 1 : 2), side * w * .7, 0, -l * .3, w * .45, w * .45, l * .35, -Math.PI / 4, accent, brightness);
        } else if (v.shape === 'lance') {
          this._put(core, ci, 0, 0, 0, w * .6, w * .6, l, 0, color, brightness);
          this._put(core, ci + 1, 0, 0, l * .28, w * 2.8, w * .22, l * .12, 0, accent, brightness);
          this._put(core, ci + 2, 0, 0, -l * .26, w * .22, w * 1.8, l * .13, 0, accent, brightness);
        } else {
          const twist = v.shape === 'shard' ? Math.PI / 4 + o.age * 5 : 0;
          this._put(core, ci, 0, 0, 0, w, w * .7, l, twist, color, brightness);
          for (const side of [-1, 1]) this._put(core, ci + (side < 0 ? 1 : 2), side * w * .72, 0, -l * .2, w * .2, w * .3, l * .6, twist, accent, brightness);
        }
        this._put(glow, gi, 0, 0, 0, w * 2.5, w * 2.5, l * 1.15, 0, color, brightness);
        this._put(glow, gi + 1, 0, 0, -l * .4 - v.trail * .5,
          w * .9, w * .9, v.trail, 0, accent, brightness * .8);
      }
    } else if (!o.active) {
      core.setMatrixAt(o.index, this._zero); glow.setMatrixAt(o.index, this._zero);
    } else {
      d.position.set(o.x, o.y, o.z);
      d.rotation.set(0, Math.PI / 4, Math.PI / 4);
      d.scale.setScalar(o.heavy ? .9 : Math.max(.3, o.radius * .52));
      d.updateMatrix(); core.setMatrixAt(o.index, d.matrix);
      o.mesh.position.copy(d.position); o.mesh.quaternion.copy(d.quaternion); o.mesh.scale.copy(d.scale);
      d.scale.multiplyScalar(o.team === 'player' ? 1.8 : 1.9);
      d.updateMatrix(); glow.setMatrixAt(o.index, d.matrix);
      this._color.set(o.color).multiplyScalar(o.team === 'player' ? 1.6 : 2);
      core.setColorAt(o.index, this._color); glow.setColorAt(o.index, this._color);
    }
    core.instanceMatrix.needsUpdate = true; glow.instanceMatrix.needsUpdate = true;
    core.instanceColor.needsUpdate = true; glow.instanceColor.needsUpdate = true;
  }

  _put(batch, index, x, y, z, width, height, length, twist, color, brightness) {
    const part = this._part, d = this._dummy;
    part.position.set(x, y, z).applyQuaternion(d.quaternion).add(d.position);
    part.quaternion.copy(d.quaternion);
    if (twist) part.rotateZ(twist);
    part.scale.set(width, height, length);
    part.updateMatrix();
    batch.setMatrixAt(index, part.matrix);
    batch.setColorAt(index, this._color.set(color).multiplyScalar(brightness));
  }

  /** Reconcile any proc redirect/color edits made after the movement step. */
  flush() {
    let live = 0;
    for (const o of this.player) if (o.active) live++;
    // Dense overlapping trails must not become a white wall. Reduce decorative
    // radiance, never projectile counts, opaque silhouettes, collision or power.
    this.readabilityGain = Math.max(.18, Math.min(1, 120 / Math.max(1,live)));
    this.playerGlow.material.opacity = .075 * this.readabilityGain;
    for (const o of this.player) if (o.active) this._write(o);
  }
  killPlayerBolt(o, reason = 'collision') {
    if (!o.active) return;
    const onEnd = o.onEnd; o.onEnd = null;
    // Snapshot before returning this slot to the pool: a shard may reuse it.
    const ended = onEnd ? { x: o.x, y: o.y, z: o.z, damage: o.damage } : null;
    o.active = false; o.mesh.visible = false; o.target = null; this._write(o);
    onEnd?.(ended, reason);
  }
  killEnemyBolt(o) { o.active = false; o.mesh.visible = false; this._write(o); }
  clearEnemyNear(x, y, radius) {
    let count = 0;
    for (const o of this.enemy) if (o.active && Math.hypot(o.x - x, o.y - y) < radius && o.z > -30) {
      this.killEnemyBolt(o); count++;
    }
    return count;
  }
  reset() {
    for (const o of this.player) { this.killPlayerBolt(o, 'reset'); o.hitTargets.clear(); }
    for (const o of this.enemy) this.killEnemyBolt(o);
    this.cursor.player = 0; this.cursor.enemy = 0; this.saturationCount = 0;
    this.readabilityGain = 1; this.playerGlow.material.opacity = .075;
  }
}
