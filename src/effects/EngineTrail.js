import * as THREE from 'three';

const CAPACITY = 1200;
const CYAN = new THREE.Color('#55fff2');
const BLUE = new THREE.Color('#487bff');
const BOOST_RED = new THREE.Color('#ff302f');
const BOOST_ORANGE = new THREE.Color('#ff7a20');
const BOOST_GOLD = new THREE.Color('#ffd34f');
const BOOST_HOT = new THREE.Color('#fff2b5');
const BRAKE_PINK = new THREE.Color('#ff38c9');
const BRAKE_HOT = new THREE.Color('#ff9bea');

export const ENGINE_TRAIL_PROFILE = Object.freeze({
  normal: Object.freeze({ emission: 72, lifeMin: .58, lifeMax: .82, velocity: 3.6, sizeMin: .05, sizeMax: .095 }),
  boost: Object.freeze({ emission: 360, lifeMin: 2.15, lifeMax: 2.75, velocity: 11.5, sizeMin: .09, sizeMax: .17 }),
});

/** Persistent, world-space exhaust: steering draws three curling voxel ribbons. */
export class EngineTrail {
  constructor(scene) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    // Face shading keeps the particles recognizably cubic inside the bloom.
    const faceColors = new Float32Array(geometry.attributes.position.count * 3);
    const shades = [.72, .9, 1, .58, .84, .68];
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      faceColors.fill(shades[Math.floor(i / 4)], i * 3, i * 3 + 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(faceColors, 3));
    this.core = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({
      color: 0xffffff, vertexColors: true,
    }), CAPACITY);
    this.halo = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: .055,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }), CAPACITY);
    this.core.name = 'rift-engine-voxel-trail';
    this.halo.name = 'rift-engine-trail-glow';
    for (const mesh of [this.core, this.halo]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
    }
    this.particles = Array.from({ length: CAPACITY }, () => ({
      age: 0, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      size: 0, phase: 0, lane: 0, boostMix: 0,
    }));
    this.origins = Array.from({ length: 3 }, () => new THREE.Vector3());
    this.previous = this.origins.map(() => new THREE.Vector3());
    this._position = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._transform = new THREE.Object3D();
    this._color = new THREE.Color();
    this._boostColor = new THREE.Color();
    this._brakeColor = new THREE.Color();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    // Allocate instance color buffers once, including for an initially empty plume.
    for (let i = 0; i < CAPACITY; i++) {
      this.core.setColorAt(i, CYAN);
      this.halo.setColorAt(i, CYAN);
    }
    this.core.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.halo.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.reset();
  }

  reset() {
    this.cursor = 0;
    this.carry = 0;
    this.time = 0;
    this.activeCount = 0;
    this.primed = false;
    this.boostMix = 0;
    this.brakeMix = 0;
    for (let i = 0; i < CAPACITY; i++) {
      this.particles[i].life = 0;
      this.core.setMatrixAt(i, this._zero);
      this.halo.setMatrixAt(i, this._zero);
    }
    this.core.visible = this.halo.visible = false;
    this.core.instanceMatrix.needsUpdate = this.halo.instanceMatrix.needsUpdate = true;
  }

  /** A teleport breaks emission interpolation without deleting existing exhaust. */
  breakTrail() {
    this.primed = false;
    this.carry = 0;
  }

  update(dt, player, camera, { emit = true } = {}) {
    if (!(dt > 0)) return;
    // A resumed/stalled frame must never dump a whole second's exhaust at once.
    dt = Math.min(dt, .1);
    this.time += dt;
    const emitting = emit && player.alive && player.group.visible;
    this.brakeMix = THREE.MathUtils.damp(this.brakeMix, emitting && player.braking ? 1 : 0, 22, dt);
    if (emitting) {
      player.group.updateWorldMatrix(true, true);
      player.engines.forEach((engine, i) => {
        this.origins[i].setFromMatrixPosition(engine.matrixWorld);
        if (!this.primed) this.previous[i].copy(this.origins[i]);
      });
      this._direction.set(0, -.025, 1).transformDirection(player.group.matrixWorld);
      // A short ease makes ignition/decay feel physical without allowing a
      // stale boost plume to remain attached to the hull. Emitted cubes live
      // in world space and continue aft while the new compact plume takes over.
      this.boostMix = THREE.MathUtils.damp(this.boostMix, player.boosting ? 1 : 0, 18, dt);
      const profile = ENGINE_TRAIL_PROFILE;
      const emission = THREE.MathUtils.lerp(profile.normal.emission, profile.boost.emission, this.boostMix)
        * (this.testing?.getTuning('trailDensity') ?? 1);
      this.carry += dt * emission;
      const count = Math.floor(this.carry);
      this.carry -= count;
      for (let i = 0; i < count; i++) {
        const p = this.particles[this.cursor];
        const lane = this.cursor % this.origins.length;
        this.cursor = (this.cursor + 1) % CAPACITY;
        this._position.lerpVectors(this.previous[lane], this.origins[lane], (i + 1) / count);
        const phase = Math.random() * Math.PI * 2;
        const mix = this.boostMix;
        const velocity = THREE.MathUtils.lerp(profile.normal.velocity, profile.boost.velocity, mix);
        const lifeMin = THREE.MathUtils.lerp(profile.normal.lifeMin, profile.boost.lifeMin, mix);
        const lifeMax = THREE.MathUtils.lerp(profile.normal.lifeMax, profile.boost.lifeMax, mix);
        const sizeMin = THREE.MathUtils.lerp(profile.normal.sizeMin, profile.boost.sizeMin, mix);
        const sizeMax = THREE.MathUtils.lerp(profile.normal.sizeMax, profile.boost.sizeMax, mix);
        Object.assign(p, {
          age: 0, life: lifeMin + Math.random() * (lifeMax - lifeMin),
          x: this._position.x + Math.cos(phase) * .075,
          y: this._position.y + Math.sin(phase) * .075,
          z: this._position.z + .08,
          vx: this._direction.x * velocity + player.vx * .025,
          vy: this._direction.y * velocity + player.vy * .025,
          vz: Math.max(3.5, this._direction.z * velocity),
          size: sizeMin + Math.random() * (sizeMax - sizeMin),
          phase, lane, boostMix: mix,
        });
      }
      this.origins.forEach((origin, i) => this.previous[i].copy(origin));
      this.primed = true;
    } else {
      this.primed = false;
      this.carry = 0;
      this.boostMix = THREE.MathUtils.damp(this.boostMix, 0, 18, dt);
    }

    camera.updateMatrixWorld();
    this.activeCount = 0;
    for (let i = 0; i < CAPACITY; i++) {
      const p = this.particles[i];
      if (!p.life) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.life = 0;
        this.core.setMatrixAt(i, this._zero);
        this.halo.setMatrixAt(i, this._zero);
        continue;
      }
      this.activeCount++;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const age = p.age / p.life;
      const curl = (.06 + p.age * .13) * Math.sin(p.age * 3.2 + p.phase);
      const d = this._transform;
      d.position.set(p.x + curl, p.y + Math.cos(p.age * 2.6 + p.phase) * p.age * .09, p.z);
      this._view.copy(d.position).applyMatrix4(camera.matrixWorldInverse);
      // Fade before crossing the camera, including during right-stick orbit.
      const nearFade = THREE.MathUtils.smoothstep(-this._view.z, 1.3, 4.5);
      const fade = Math.pow(1 - age, .7) * nearFade;
      const size = p.size * (.35 + .65 * (1 - age)) * nearFade;
      d.rotation.set(p.phase + p.age * .6, p.phase * .7 + p.age * .4, p.phase + p.age * .9);
      d.scale.setScalar(size);
      d.updateMatrix();
      this.core.setMatrixAt(i, d.matrix);
      d.scale.multiplyScalar(2.15);
      d.updateMatrix();
      this.halo.setMatrixAt(i, d.matrix);

      // Normal thrust stays compact cyan/blue. Boost has its own unmistakable
      // hot-gold ignition, orange body and red cooling wake. Cutting thrust
      // recolors the live plume pink so its feedback is visible behind the ship.
      const normal = this._color.lerpColors(CYAN, BLUE, Math.min(1, age * 1.4));
      const boost = this._boostColor;
      if (age < .18) boost.lerpColors(BOOST_HOT, BOOST_GOLD, age / .18);
      else if (age < .55) boost.lerpColors(BOOST_GOLD, BOOST_ORANGE, (age - .18) / .37);
      else boost.lerpColors(BOOST_ORANGE, BOOST_RED, (age - .55) / .45);
      normal.lerp(boost, p.boostMix);
      const brake = this._brakeColor.lerpColors(BRAKE_HOT, BRAKE_PINK, Math.min(1, age * 1.5));
      normal.lerp(brake, this.brakeMix);
      const shimmer = .85 + .15 * Math.sin(this.time * 7 + p.phase);
      const intensity = THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.45, 2.25, p.boostMix), 1.9, this.brakeMix);
      this._color.multiplyScalar(intensity * fade * shimmer);
      this.core.setColorAt(i, this._color);
      this.halo.setColorAt(i, this._color);
    }
    this.core.visible = this.halo.visible = this.activeCount > 0;
    for (const mesh of [this.core, this.halo]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }
}
