import * as THREE from 'three';
import { buildVoxels, Tex } from '../render/VoxelBuilder.js';
import { Audio2 } from '../core/AudioManager.js';
import { escapeIntensity } from '../config/escapeIntensity.js';

const TAU = Math.PI * 2;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const hash = n => { const v = Math.sin(n * 12.9898 + 7.233) * 43758.5453; return v - Math.floor(v); };
export const CARNAGE_BUDGET = Object.freeze({ capitalShips: 12, backgroundFleet: 84, debris: 1700, blasts: 24, shots: 120 });
const HOT = ['#ff6e26', '#ffc05b', '#da36f7', '#7c3bff', '#ff398d'];
const HULL = ['#171326', '#30243c', '#4b3553', '#73526b', '#ffa560'];

// Shared voxel silhouettes are deliberately outside the playable corridor.
// They read as a capital fleet, rather than targetable ships in the firing lane.
function capitalGeometry() {
  const voxels = [];
  const add = (x, y, z, c) => voxels.push({ x, y, z, c });
  for (let z = -15; z <= 15; z++) {
    const w = z < -9 ? 1 + Math.floor((z + 15) / 2) : z > 10 ? 3 : 5;
    for (let x = -w; x <= w; x++) for (let y = -2; y <= 2; y++) {
      if (Math.abs(x) !== w && Math.abs(y) !== 2 && z !== -15 && z !== 15) continue;
      const stripe = Math.abs(x) === w && y === 0 && z % 4 === 0;
      add(x, y, z, stripe ? '#a23dff' : (x + z) % 5 ? '#2d2b42' : '#525063');
    }
  }
  for (const side of [-1, 1]) {
    for (let z = -6; z <= 12; z++) for (let x = 6; x <= 8; x++) {
      add(x * side, -1, z, z === 12 ? '#ff7d3a' : '#35334a');
      add(x * side, 0, z, z % 5 === 0 ? '#e331ad' : '#494359');
    }
    for (let z = -8; z <= 5; z += 6) {
      for (let y = 3; y <= 4; y++) for (let x = 2; x <= 3; x++) add(x * side, y, z, '#62536b');
      for (let dz = 1; dz <= 4; dz++) add(side * 2, 4, z - dz, dz === 4 ? '#ff7842' : '#302937');
    }
  }
  for (let y = 3; y <= 7; y++) for (let x = -2; x <= 2; x++) {
    for (let z = 3; z <= 7; z++) if (x === -2 || x === 2 || z === 3 || z === 7 || y === 7)
      add(x, y, z, y === 6 && z === 3 ? '#d640ec' : '#3c374d');
  }
  for (let z = 8; z <= 15; z++) add(0, 3, z, '#ff5e36');
  return buildVoxels(voxels, .73, { outline: 0, roughness: .56, metalness: .48,
    emissive: new Set(['#ff7d3a', '#ff7842', '#d640ec', '#e331ad', '#a23dff', '#ff5e36']) }).userData.mesh;
}

function fleetGeometry() {
  const voxels = [];
  for (let z = -4; z <= 4; z++) {
    const w = z < -2 ? 0 : z < 1 ? 1 : 3;
    for (let x = -w; x <= w; x++) {
      voxels.push({ x, y: 0, z, c: z === 4 ? '#d336ef' : Math.abs(x) === w ? '#544565' : '#292439' });
      if (Math.abs(x) <= 1 && z >= 0 && z <= 2) voxels.push({ x, y: 1, z, c: x === 0 ? '#a65bff' : '#3b344d' });
    }
  }
  return buildVoxels(voxels, .48, { outline: 0, emissive: new Set(['#d336ef', '#a65bff']) }).userData.mesh;
}

/**
 * A bounded, simulation-clock battlefield around the escape lane. These ships
 * are distant scenery; the Armada owns all real targets, shots and damage.
 * Explosions have a hot opening, expanding shock shell and lasting voxel wreckage.
 */
export class EscapeCarnage {
  constructor(game, escape) {
    this.game = game;
    this.escape = escape;
    this.active = true;
    this.elapsed = 0;
    this.totalExplosions = this.totalCapitalBreaks = 0;
    this.peakDebris = this.peakBlasts = 0;
    this.nextBattle = .2;
    this.nextRumble = 0;
    this.nextKillBurst = 0;
    this.burstSerial = 0;
    this.debrisCursor = this.blastCursor = 0;
    this.root = new THREE.Group();
    this.root.name = 'escape-carnage';
    game.scene.add(this.root);
    this.o = new THREE.Object3D();
    this.color = new THREE.Color();
    this.resources = [];
    this.profile = escapeIntensity(0, 0);
    const capital = capitalGeometry(), fighter = fleetGeometry();
    this.resources.push(capital.geometry, capital.material, fighter.geometry, fighter.material);
    this.capitalMesh = this._instances(capital.geometry, capital.material, CARNAGE_BUDGET.capitalShips);
    this.fleetMesh = this._instances(fighter.geometry, fighter.material, CARNAGE_BUDGET.backgroundFleet);
    this.cube = new THREE.BoxGeometry(1, 1, 1);
    this.debrisMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.debrisMesh = this._instances(this.cube, this.debrisMaterial, CARNAGE_BUDGET.debris);
    this.shotMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#b649ff').multiplyScalar(1.45),
      transparent: true, opacity: .62 });
    this.shotMesh = this._instances(this.cube, this.shotMaterial, CARNAGE_BUDGET.shots);

    this.plane = new THREE.PlaneGeometry(1, 1);
    this.ring = new THREE.RingGeometry(.9, 1, 56);
    this.haloMaterial = new THREE.MeshBasicMaterial({ map: Tex.glow, transparent: true, opacity: .3,
      blending: THREE.AdditiveBlending, depthWrite: false });
    this.coreMaterial = new THREE.MeshBasicMaterial({ map: Tex.glow, transparent: true, opacity: .68,
      blending: THREE.AdditiveBlending, depthWrite: false });
    this.ringMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: .46, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false });
    this.haloMesh = this._instances(this.plane, this.haloMaterial, CARNAGE_BUDGET.blasts);
    this.coreMesh = this._instances(this.plane, this.coreMaterial, CARNAGE_BUDGET.blasts);
    this.ringMesh = this._instances(this.ring, this.ringMaterial, CARNAGE_BUDGET.blasts);
    this.resources.push(this.cube, this.debrisMaterial, this.shotMaterial, this.plane, this.ring,
      this.haloMaterial, this.coreMaterial, this.ringMaterial);

    this.capitals = Array.from({ length: CARNAGE_BUDGET.capitalShips }, (_, i) => ({ index: i, cycle: 0, state: 0, t: 0, burst: 0 }));
    for (const ship of this.capitals) this._resetCapital(ship, true);
    this.fleet = Array.from({ length: CARNAGE_BUDGET.backgroundFleet }, (_, i) => this._newFighter(i));
    this.debris = Array.from({ length: CARNAGE_BUDGET.debris }, () => ({ live: false, t: 0, life: 1 }));
    this.blasts = Array.from({ length: CARNAGE_BUDGET.blasts }, () => ({ live: false, t: 0, life: 1 }));
    this.shots = Array.from({ length: CARNAGE_BUDGET.shots }, (_, i) => ({
      x: (i % 2 ? -1 : 1) * (35 + hash(i + 71) * 38), y: -22 + hash(i + 93) * 60,
      z: -320 + hash(i * 3 + 8) * 260, speed: 120 + hash(i + 4) * 90, length: 3 + hash(i) * 7,
    }));
    this._buildCollapseSky();
    this._render(0);
  }

  _instances(geometry, material, capacity) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.root.add(mesh);
    return mesh;
  }

  _newFighter(i) {
    const side = i % 2 ? -1 : 1;
    return { i, x: side * (32 + hash(i * 17) * 54), y: -26 + hash(i * 23) * 65,
      z: -360 + hash(i * 31) * 280, roll: (hash(i * 47) - .5) * .7,
      scale: .75 + hash(i * 59) * 1.3, speed: .32 + hash(i * 19) * .5 };
  }

  _resetCapital(ship, initial = false) {
    const n = ship.index * 431 + ship.cycle * 31;
    const side = ship.index % 2 ? -1 : 1;
    ship.x = side * (43 + hash(n + 7) * 25);
    ship.y = -17 + hash(n + 3) * 48;
    ship.z = initial ? -95 - ship.index * 25 : -300 - hash(n) * 100;
    ship.scale = 1.15 + hash(n + 11) * .45;
    ship.roll = side * (.16 + hash(n + 5) * .25);
    ship.state = 0; ship.t = 0; ship.burst = 0;
  }

  _buildCollapseSky() {
    // Broken galactic halo, placed behind all battle lanes with an open center.
    const positions = [];
    for (let arm = 0; arm < 16; arm++) {
      const angle = arm / 16 * TAU;
      let prior = null;
      for (let j = 0; j < 9; j++) {
        const radius = 85 + j * 11;
        const bent = angle + Math.sin(j * .8 + arm) * .07;
        const point = [Math.cos(bent) * radius, Math.sin(bent) * radius * .72 + 8, -330 + j * 4];
        if (prior) positions.push(...prior, ...point);
        prior = point;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.skyMaterial = new THREE.LineBasicMaterial({ color: '#ba318f', transparent: true, opacity: .14,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.skyCracks = new THREE.LineSegments(geometry, this.skyMaterial);
    this.root.add(this.skyCracks);
    this.resources.push(geometry, this.skyMaterial);
    // Two large, faint off-axis nebula lobes provide colored depth without a
    // full-screen filter or pulse. The center rift remains the brightest guide.
    this.nebulaMaterial = new THREE.MeshBasicMaterial({ map: Tex.swirl, transparent: true,
      opacity: .09, color: '#7c248f', blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.nebula = this._instances(this.plane, this.nebulaMaterial, 2);
    this.nebula.count = 2;
    for (let i = 0; i < 2; i++) {
      this.o.position.set(i ? -155 : 150, i ? -12 : 30, -370);
      this.o.rotation.set(0, 0, i ? -.5 : .7);
      this.o.scale.set(260, 220, 1); this.o.updateMatrix(); this.nebula.setMatrixAt(i, this.o.matrix);
    }
    this.nebula.instanceMatrix.needsUpdate = true;
    this.resources.push(this.nebulaMaterial);
  }

  /** Distant or local explosion, with finite pools and no secondary damage. */
  _explode(x, y, z, size, chunks, colorIndex = 0, local = false) {
    const serial = ++this.burstSerial;
    const tint = HOT[((colorIndex % HOT.length) + HOT.length) % HOT.length];
    const blast = this.blasts[this.blastCursor++ % this.blasts.length];
    Object.assign(blast, { live: true, x, y, z, t: 0, life: local ? .8 : 1.8,
      size, tint, local, seed: serial });
    this.totalExplosions++;
    for (let n = 0; n < chunks; n++) {
      const p = this.debris[this.debrisCursor++ % this.debris.length];
      const theta = hash(n * 17 + serial * 731) * TAU;
      const vertical = hash(n * 37 + serial * 53) * 2 - 1;
      const speed = size * (.55 + hash(n + serial * 113) * 1.4);
      Object.assign(p, { live: true, x, y, z, t: 0, life: (local ? 1 : 2.2) + hash(n + serial) * 1.8,
        vx: Math.cos(theta) * speed, vy: vertical * speed, vz: Math.sin(theta) * speed * .6,
        size: (local ? .15 : .45) + hash(n * 2 + serial) * (local ? .45 : 1.2),
        spin: hash(n * 11 + serial) * TAU, local, side: Math.sign(x),
        tint: n % 4 === 0 ? tint : HULL[n % HULL.length] });
    }
  }

  onEnemyDestroyed(enemy) {
    if (!this.active || this.elapsed < this.nextKillBurst || enemy.z > 2 || enemy.z < -130) return;
    this.nextKillBurst = this.elapsed + .1;
    const intensity = this.profile.intensity;
    this._explode(enemy.x, enemy.y, enemy.z, 2 + intensity * 1.2, 15 + Math.floor(intensity * 15),
      Math.floor(this.totalExplosions) % HOT.length, true);
  }

  _battlefieldEvent() {
    const q = this.profile.intensity;
    const serial = this.totalExplosions + 1;
    const side = serial % 2 ? -1 : 1;
    const x = side * (39 + hash(serial * 23) * 25);
    const y = -14 + hash(serial * 37) * 44;
    const z = -105 - hash(serial * 47) * 100;
    this._explode(x, y, z, 7 + q * 8, 24 + Math.floor(q * 46), serial % HOT.length);
    // Counter-fire shreds adjacent formations more often as the front closes.
    if (q > .45) this._explode(x + side * 12, y + 7, z - 18,
      4 + q * 5, 14 + Math.floor(q * 25), (serial + 2) % HOT.length);
    this.nextBattle = this.elapsed + 1.7 - q * 1.32;
    if (this.elapsed >= this.nextRumble) {
      this.nextRumble = this.elapsed + 3.7 - q * 1.4;
      Audio2.play(q > .6 ? 'tower_death' : 'weakpoint_death', .24 + q * .14, .65 + q * .15, .10);
      if (q > .3) this.game.camera3.shake(.035 + q * .055);
    }
  }

  update(dt) {
    if (!this.active || !(dt > 0)) return;
    this.elapsed += dt;
    this.profile = this.escape.intensity || escapeIntensity(this.escape.progress, this.escape.elapsed);
    const q = this.profile.intensity;
    this.capitalCount = Math.min(CARNAGE_BUDGET.capitalShips, 4 + Math.floor(q * 8));
    this.fleetCount = Math.min(CARNAGE_BUDGET.backgroundFleet, 24 + Math.floor(q * 60));
    const speed = this.escape.speed || 44;
    for (let i = 0; i < this.capitalCount; i++) {
      const ship = this.capitals[i];
      ship.z += speed * dt * (.22 + q * .1);
      ship.t += dt;
      if (ship.state === 0 && ship.z > -122 + hash(ship.index + ship.cycle) * 18) {
        ship.state = 1; ship.t = 0;
        this.totalCapitalBreaks++;
        this._explode(ship.x, ship.y + 3, ship.z - 5, 4.5, 22, 1);
      }
      if (ship.state === 1) {
        if (ship.t >= .65 && ship.burst === 0) {
          ship.burst = 1;
          this._explode(ship.x, ship.y, ship.z, 13 + q * 8, 110 + Math.floor(q * 55), 0);
          Audio2.play('tower_death', .27 + q * .13, .62, .12);
        }
        if (ship.t >= 1.35 && ship.burst === 1) {
          ship.burst = 2;
          this._explode(ship.x + Math.sign(ship.x) * 8, ship.y - 3, ship.z + 9, 9 + q * 6, 60, 2);
        }
        if (ship.t >= 2.15 && ship.burst === 2) {
          ship.burst = 3;
          this._explode(ship.x - Math.sign(ship.x) * 5, ship.y + 4, ship.z - 12, 7 + q * 5, 40, 4);
        }
        if (ship.t > 4.4) { ship.cycle++; this._resetCapital(ship); }
      }
    }
    for (let i = 0; i < this.fleetCount; i++) {
      const f = this.fleet[i];
      f.z += speed * dt * f.speed;
      if (f.z > -24) {
        if ((i + this.profile.tier) % 3 === 0) this._explode(f.x, f.y, -65, 3.8 + q * 2, 12, i % HOT.length);
        f.z -= 340;
      }
    }
    if (this.elapsed >= this.nextBattle) this._battlefieldEvent();
    for (const p of this.debris) {
      if (!p.live) continue;
      p.t += dt;
      if (p.t >= p.life || p.z > -10) { p.live = false; continue; }
      const drag = Math.max(0, 1 - dt * .6);
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += (p.vz + speed * .4) * dt;
      if (!p.local) p.x = p.side * Math.max(28, Math.abs(p.x));
      p.spin += dt * 1.8;
    }
    for (const b of this.blasts) {
      if (!b.live) continue;
      b.t += dt; b.z += speed * dt * .14;
      if (b.t >= b.life || b.z > -15) b.live = false;
    }
    const shotCount = 22 + Math.floor(q * 98);
    for (let i = 0; i < shotCount; i++) {
      const s = this.shots[i]; s.z += dt * s.speed;
      if (s.z > -28) s.z -= 300;
    }
    this.skyMaterial.opacity = .12 + q * .34;
    this.skyCracks.rotation.z = this.elapsed * .012;
    this.nebulaMaterial.opacity = .09 + q * .12;
    this.nebulaMaterial.color.set(q > .7 ? '#bb386c' : '#7c248f');
    this._render(shotCount);
  }

  _render(shotCount) {
    const o = this.o;
    let count = 0;
    for (let i = 0; i < (this.capitalCount || 4); i++) {
      const ship = this.capitals[i];
      if (ship.state === 1 && ship.t >= .65) continue;
      o.position.set(ship.x, ship.y, ship.z);
      o.rotation.set(.12, ship.index % 2 ? .15 : -.15, ship.roll + (ship.state ? ship.t * .2 : 0));
      o.scale.setScalar(ship.scale); o.updateMatrix(); this.capitalMesh.setMatrixAt(count++, o.matrix);
    }
    this.capitalMesh.count = count;
    count = 0;
    for (let i = 0; i < (this.fleetCount || 24); i++) {
      const f = this.fleet[i];
      o.position.set(f.x + Math.sin(this.elapsed * .3 + i) * 2, f.y, f.z);
      o.rotation.set(.15, i % 2 ? -.15 : .15, f.roll); o.scale.setScalar(f.scale);
      o.updateMatrix(); this.fleetMesh.setMatrixAt(count++, o.matrix);
    }
    this.fleetMesh.count = count;
    count = 0;
    for (const p of this.debris) {
      if (!p.live) continue;
      const fade = Math.min(1, (p.life - p.t) * 1.4) * clamp((-p.z - 10) / 20, 0, 1);
      o.position.set(p.x, p.y, p.z); o.rotation.set(p.spin, p.spin * .7, p.spin * .3);
      o.scale.set(p.size * fade, p.size * .65 * fade, p.size * 1.5 * fade); o.updateMatrix();
      this.debrisMesh.setMatrixAt(count, o.matrix);
      this.color.set(p.tint).multiplyScalar(p.t < .35 ? 1.7 : 1);
      this.debrisMesh.setColorAt(count++, this.color);
    }
    this.debrisMesh.count = count; this.peakDebris = Math.max(this.peakDebris, count);
    count = 0;
    for (const b of this.blasts) {
      if (!b.live) continue;
      const k = b.t / b.life, fade = Math.sin(Math.PI * Math.min(1, k)) * (1 - k);
      const radius = b.size * (.25 + k * 1.15);
      o.position.set(b.x, b.y, b.z);
      o.quaternion.copy(this.game.camera.quaternion);
      o.scale.setScalar(radius * 2); o.updateMatrix(); this.haloMesh.setMatrixAt(count, o.matrix);
      this.color.set(b.tint).multiplyScalar(fade * 1.3);
      this.haloMesh.setColorAt(count, this.color);
      o.scale.setScalar(b.size * (1.05 - k * .8)); o.updateMatrix(); this.coreMesh.setMatrixAt(count, o.matrix);
      this.color.set(k < .15 ? '#fff0b9' : b.tint).multiplyScalar((1 - k) * (1 - k) * 1.4);
      this.coreMesh.setColorAt(count, this.color);
      // Thin expanding shells communicate scale without an opaque flash sheet.
      o.scale.setScalar(radius * 1.2); o.rotation.z += b.seed;
      o.updateMatrix(); this.ringMesh.setMatrixAt(count, o.matrix);
      this.color.set(b.tint).multiplyScalar((1 - k) * .8);
      this.ringMesh.setColorAt(count++, this.color);
    }
    this.haloMesh.count = this.coreMesh.count = this.ringMesh.count = count;
    this.peakBlasts = Math.max(this.peakBlasts, count);
    for (let i = 0; i < shotCount; i++) {
      const s = this.shots[i];
      o.position.set(s.x, s.y, s.z); o.rotation.set(0, 0, 0); o.scale.set(.07, .07, s.length);
      o.updateMatrix(); this.shotMesh.setMatrixAt(i, o.matrix);
    }
    this.shotMesh.count = shotCount;
    for (const mesh of [this.capitalMesh, this.fleetMesh, this.debrisMesh, this.haloMesh, this.coreMesh, this.ringMesh, this.shotMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  snapshot() {
    return { active: this.active, elapsed: this.elapsed, tier: this.profile.tier,
      capitalCount: this.capitalMesh.count, fleetCount: this.fleetMesh.count,
      debrisCount: this.debrisMesh.count, blastCount: this.haloMesh.count, shotCount: this.shotMesh.count,
      totalExplosions: this.totalExplosions, totalCapitalBreaks: this.totalCapitalBreaks,
      peakDebris: this.peakDebris, peakBlasts: this.peakBlasts, budgets: CARNAGE_BUDGET };
  }

  dispose() {
    if (!this.active) return;
    this.active = false;
    this.root.removeFromParent();
    for (const mesh of [this.capitalMesh, this.fleetMesh, this.debrisMesh, this.haloMesh, this.coreMesh, this.ringMesh, this.shotMesh, this.nebula]) {
      mesh.count = 0; mesh.dispose();
    }
    for (const resource of this.resources) resource.dispose();
    for (const p of this.debris) p.live = false;
    for (const b of this.blasts) b.live = false;
  }
}
