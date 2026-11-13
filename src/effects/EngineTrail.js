import * as THREE from 'three';

const CAPACITY = 1200;
const CYAN = new THREE.Color('#55fff2');
const BLUE = new THREE.Color('#487bff');
const VIOLET = new THREE.Color('#b14dff');
const PINK = new THREE.Color('#fa48cf');
const MINT = new THREE.Color('#c8fff0');

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
      size: 0, phase: 0, lane: 0, boost: false,
    }));
    this.origins = Array.from({ length: 3 }, () => new THREE.Vector3());
    this.previous = this.origins.map(() => new THREE.Vector3());
    this._position = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._transform = new THREE.Object3D();
    this._color = new THREE.Color();
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
    for (let i = 0; i < CAPACITY; i++) {
      this.particles[i].life = 0;
      this.core.setMatrixAt(i, this._zero);
      this.halo.setMatrixAt(i, this._zero);
    }
    this.core.visible = this.halo.visible = false;
    this.core.instanceMatrix.needsUpdate = this.halo.instanceMatrix.needsUpdate = true;
  }

  update(dt, player, camera, { emit = true } = {}) {
    if (!(dt > 0)) return;
    // A resumed/stalled frame must never dump a whole second's exhaust at once.
    dt = Math.min(dt, .1);
    this.time += dt;
    const emitting = emit && player.alive && player.group.visible;
    if (emitting) {
      player.group.updateWorldMatrix(true, true);
      player.engines.forEach((engine, i) => {
        this.origins[i].setFromMatrixPosition(engine.matrixWorld);
        if (!this.primed) this.previous[i].copy(this.origins[i]);
      });
      this._direction.set(0, -.025, 1).transformDirection(player.group.matrixWorld);
      this.carry += dt * (player.boosting ? 330 : 210);
      const count = Math.floor(this.carry);
      this.carry -= count;
      for (let i = 0; i < count; i++) {
        const p = this.particles[this.cursor];
        const lane = this.cursor % this.origins.length;
        this.cursor = (this.cursor + 1) % CAPACITY;
        this._position.lerpVectors(this.previous[lane], this.origins[lane], (i + 1) / count);
        const phase = Math.random() * Math.PI * 2;
        const velocity = player.boosting ? 7.2 : 5.2;
        Object.assign(p, {
          age: 0, life: 2.8 + Math.random() * .65,
          x: this._position.x + Math.cos(phase) * .075,
          y: this._position.y + Math.sin(phase) * .075,
          z: this._position.z + .08,
          vx: this._direction.x * velocity + player.vx * .025,
          vy: this._direction.y * velocity + player.vy * .025,
          vz: Math.max(3.5, this._direction.z * velocity),
          size: (.065 + Math.random() * .095) * (player.boosting ? 1.2 : 1),
          phase, lane, boost: player.boosting,
        });
      }
      this.origins.forEach((origin, i) => this.previous[i].copy(origin));
      this.primed = true;
    } else {
      this.primed = false;
      this.carry = 0;
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

      // Cyan ignition melts into electric blue, violet, then pink stardust.
      const hueAge = Math.min(1, age * 1.65 + p.lane * .09);
      if (hueAge < .34) this._color.lerpColors(CYAN, BLUE, hueAge / .34);
      else if (hueAge < .7) this._color.lerpColors(BLUE, VIOLET, (hueAge - .34) / .36);
      else this._color.lerpColors(VIOLET, PINK, (hueAge - .7) / .3);
      if (p.boost && age < .13) this._color.lerp(MINT, (1 - age / .13) * .65);
      const shimmer = .85 + .15 * Math.sin(this.time * 7 + p.phase);
      this._color.multiplyScalar((p.boost ? 2.2 : 1.85) * fade * shimmer);
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
