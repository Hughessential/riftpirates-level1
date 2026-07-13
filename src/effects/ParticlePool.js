import * as THREE from 'three';
import { P } from '../core/Palette.js';
import { Tex } from '../render/VoxelBuilder.js';
import { rand, pick, TAU } from '../core/Utils.js';

/**
 * The destruction system. Three pooled layers stacked on every explosion:
 *   1. instanced voxel cubes (outlined, tumbling) — the chunky shatter
 *   2. additive spark points — the heat
 *   3. lightning arcs strung between live chunks — the rift energy
 * Nothing is allocated after boot (spec §35).
 */

const CHUNKS = 420;
const SPARKS = 700;
const ARC_BURSTS = 10;
const FLASHES = 8;

export class ParticlePool {
  constructor(scene) {
    this.scene = scene;

    // --- voxel chunks ---
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.chunkMesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      CHUNKS
    );
    this.chunkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CHUNKS * 3), 3);
    this.chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunkMesh.frustumCulled = false;

    const ogeo = new THREE.BoxGeometry(1.26, 1.26, 1.26);
    this.outlineMesh = new THREE.InstancedMesh(
      ogeo,
      new THREE.MeshBasicMaterial({ color: P.black, side: THREE.BackSide }),
      CHUNKS
    );
    this.outlineMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.outlineMesh.frustumCulled = false;

    this.zero = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
    this.chunks = [];
    for (let i = 0; i < CHUNKS; i++) {
      this.chunks.push({
        on: false, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0,
        rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0,
        s: 0.4, t: 0, T: 1, grav: 1, drift: 0,
      });
      this.chunkMesh.setMatrixAt(i, this.zero);
      this.outlineMesh.setMatrixAt(i, this.zero);
    }
    this.cursor = 0;
    scene.add(this.outlineMesh);
    scene.add(this.chunkMesh);

    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();

    // --- sparks ---
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    this.sparkPts = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        size: 0.55,
        map: Tex.glow,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.sparkPts.frustumCulled = false;
    scene.add(this.sparkPts);
    this.sparkVel = new Float32Array(SPARKS * 3);
    this.sparkLife = new Float32Array(SPARKS);
    this.sparkMax = new Float32Array(SPARKS);
    this.sparkBase = new Float32Array(SPARKS * 3);
    this.sparkCursor = 0;
    this.SPARK_COLS = [P.gold, P.orange, P.white, '#FFE8A3', P.cyan];

    // --- lightning arcs ---
    const ag = new THREE.BufferGeometry();
    this.arcPos = new Float32Array(ARC_BURSTS * 3 * 6 * 2 * 3);
    ag.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3));
    ag.setDrawRange(0, 0);
    this.arcLine = new THREE.LineSegments(
      ag,
      new THREE.LineBasicMaterial({
        color: P.cyan,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.arcLine.frustumCulled = false;
    scene.add(this.arcLine);
    this.arcBursts = [];
    this.arcTimer = 0;

    // --- flash sprites ---
    this.flashes = [];
    for (let i = 0; i < FLASHES; i++) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: Tex.glow,
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      sp.visible = false;
      scene.add(sp);
      this.flashes.push({ sp, t: 9, on: false, T: 0.22 });
    }
    this.flashCursor = 0;
  }

  /**
   * @param {object} o
   *  count   - chunk count
   *  colors  - debris palette
   *  power   - outward speed
   *  gravity - 0 for zero-g structure debris, 1 for arcing chunks
   *  arcColor- lightning tint
   */
  explode(x, y, z, o = {}) {
    const count = o.count ?? 16;
    const colors = o.colors ?? [P.orange, P.gold, '#FFE8A3', P.red];
    const power = o.power ?? 11;
    const gravity = o.gravity ?? 1;
    const spread = o.spread ?? 0.5;
    const scale = o.scale ?? 1;

    const col = this.chunkMesh.instanceColor.array;
    const n = Math.min(count, CHUNKS);
    const ids = [];

    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % CHUNKS;
      const b = this.chunks[i];
      ids.push(i);
      b.on = true;
      b.t = 0;
      b.T = rand(0.5, 1.2) * (o.life ?? 1);
      b.px = x + rand(-spread, spread);
      b.py = y + rand(-spread, spread);
      b.pz = z + rand(-spread, spread);

      const ph = rand(-1, 1);
      const th = rand(0, TAU);
      const xz = Math.sqrt(1 - ph * ph);
      const sp = rand(0.3, 1) * power;
      b.vx = Math.cos(th) * xz * sp;
      b.vy = ph * sp;
      b.vz = Math.sin(th) * xz * sp * 0.7;
      b.wx = rand(-8, 8);
      b.wy = rand(-8, 8);
      b.wz = rand(-8, 8);
      b.rx = rand(0, TAU);
      b.ry = rand(0, TAU);
      b.rz = rand(0, TAU);
      b.s = (rand(0.22, 0.6) + power * 0.012) * scale;
      b.grav = gravity;

      this._c.set(pick(colors));
      col[i * 3] = this._c.r;
      col[i * 3 + 1] = this._c.g;
      col[i * 3 + 2] = this._c.b;
    }
    this.chunkMesh.instanceColor.needsUpdate = true;

    // sparks
    const sN = Math.min(Math.round(n * 1.4) + 6, 60);
    const spa = this.sparkPts.geometry.attributes.position.array;
    for (let s = 0; s < sN; s++) {
      const si = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % SPARKS;
      const sh = rand(-1, 1);
      const st = rand(0, TAU);
      const sq = Math.sqrt(1 - sh * sh);
      const ss = rand(0.5, 1.35) * power * 1.25;
      this.sparkVel[si * 3] = Math.cos(st) * sq * ss;
      this.sparkVel[si * 3 + 1] = sh * ss;
      this.sparkVel[si * 3 + 2] = Math.sin(st) * sq * ss * 0.7;
      spa[si * 3] = x;
      spa[si * 3 + 1] = y;
      spa[si * 3 + 2] = z;
      this.sparkLife[si] = this.sparkMax[si] = rand(0.5, 1.1);
      this._c.set(pick(o.sparkColors ?? this.SPARK_COLS));
      this.sparkBase[si * 3] = this._c.r;
      this.sparkBase[si * 3 + 1] = this._c.g;
      this.sparkBase[si * 3 + 2] = this._c.b;
    }
    this.sparkPts.geometry.attributes.position.needsUpdate = true;

    if (o.arcs !== false) {
      this.arcBursts.push({ ids, t: 0, T: 0.5 });
      if (this.arcBursts.length > ARC_BURSTS) this.arcBursts.shift();
      this.arcLine.material.color.set(o.arcColor ?? P.cyan);
    }

    const f = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    f.on = true;
    f.t = 0;
    f.T = o.flashTime ?? 0.22;
    f.scale = o.flashScale ?? 1;
    f.sp.visible = true;
    f.sp.material.color.set(o.flashColor ?? 0xffffff);
    f.sp.position.set(x, y, z);
  }

  /** A big directional burst of sparks with no chunks — used for thruster/vent FX. */
  jet(x, y, z, dir, count, colors) {
    const spa = this.sparkPts.geometry.attributes.position.array;
    for (let s = 0; s < count; s++) {
      const si = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % SPARKS;
      const sp = rand(6, 20);
      this.sparkVel[si * 3] = dir.x * sp + rand(-3, 3);
      this.sparkVel[si * 3 + 1] = dir.y * sp + rand(-3, 3);
      this.sparkVel[si * 3 + 2] = dir.z * sp + rand(-3, 3);
      spa[si * 3] = x;
      spa[si * 3 + 1] = y;
      spa[si * 3 + 2] = z;
      this.sparkLife[si] = this.sparkMax[si] = rand(0.25, 0.6);
      this._c.set(pick(colors ?? this.SPARK_COLS));
      this.sparkBase[si * 3] = this._c.r;
      this.sparkBase[si * 3 + 1] = this._c.g;
      this.sparkBase[si * 3 + 2] = this._c.b;
    }
    this.sparkPts.geometry.attributes.position.needsUpdate = true;
  }

  update(dt, worldSpeed = 0) {
    let any = false;

    for (let i = 0; i < CHUNKS; i++) {
      const b = this.chunks[i];
      if (!b.on) continue;
      any = true;
      b.t += dt;
      if (b.t >= b.T) {
        b.on = false;
        this.chunkMesh.setMatrixAt(i, this.zero);
        this.outlineMesh.setMatrixAt(i, this.zero);
        continue;
      }
      const dr = Math.max(0, 1 - 1.7 * dt);
      b.vx *= dr;
      b.vy *= dr;
      b.vz *= dr;
      b.vy -= 3.2 * b.grav * dt;
      b.px += b.vx * dt;
      b.py += b.vy * dt;
      b.pz += (b.vz + worldSpeed) * dt;
      b.rx += b.wx * dt;
      b.ry += b.wy * dt;
      b.rz += b.wz * dt;

      const k = 1 - b.t / b.T;
      const s = b.s * (k > 0.35 ? 1 : k / 0.35);
      this._e.set(b.rx, b.ry, b.rz);
      this._q.setFromEuler(this._e);
      this._v.set(b.px, b.py, b.pz);
      this._s.set(s, s, s);
      this._m4.compose(this._v, this._q, this._s);
      this.chunkMesh.setMatrixAt(i, this._m4);
      this.outlineMesh.setMatrixAt(i, this._m4);
    }
    if (any) {
      this.chunkMesh.instanceMatrix.needsUpdate = true;
      this.outlineMesh.instanceMatrix.needsUpdate = true;
    }

    // flashes
    for (const f of this.flashes) {
      if (!f.on) continue;
      f.t += dt;
      const ft = f.t / f.T;
      if (ft >= 1) {
        f.on = false;
        f.sp.visible = false;
        continue;
      }
      const sc = (2.5 + 9 * ft) * (f.scale || 1);
      f.sp.scale.set(sc, sc, 1);
      f.sp.material.opacity = 0.85 * (1 - ft);
      f.sp.position.z += worldSpeed * dt;
    }

    // sparks
    let anySpark = false;
    const spa = this.sparkPts.geometry.attributes.position.array;
    const sca = this.sparkPts.geometry.attributes.color.array;
    for (let i = 0; i < SPARKS; i++) {
      if (this.sparkLife[i] <= 0) continue;
      anySpark = true;
      this.sparkLife[i] -= dt;
      if (this.sparkLife[i] <= 0) {
        sca[i * 3] = sca[i * 3 + 1] = sca[i * 3 + 2] = 0;
        continue;
      }
      const sk = this.sparkLife[i] / this.sparkMax[i];
      this.sparkVel[i * 3 + 1] -= 6.5 * dt;
      const sd = Math.max(0, 1 - 1.2 * dt);
      this.sparkVel[i * 3] *= sd;
      this.sparkVel[i * 3 + 1] *= sd;
      this.sparkVel[i * 3 + 2] *= sd;
      spa[i * 3] += this.sparkVel[i * 3] * dt;
      spa[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      spa[i * 3 + 2] += (this.sparkVel[i * 3 + 2] + worldSpeed) * dt;
      const tw = Math.random() < 0.22 ? 0.12 : 1;
      const br = (sk > 0.45 ? 1 : sk / 0.45) * tw;
      sca[i * 3] = this.sparkBase[i * 3] * br;
      sca[i * 3 + 1] = this.sparkBase[i * 3 + 1] * br * (0.35 + 0.65 * sk);
      sca[i * 3 + 2] = this.sparkBase[i * 3 + 2] * br * (0.2 + 0.8 * sk);
    }
    if (anySpark) {
      this.sparkPts.geometry.attributes.position.needsUpdate = true;
      this.sparkPts.geometry.attributes.color.needsUpdate = true;
    }

    // arcs
    for (let i = this.arcBursts.length - 1; i >= 0; i--) {
      this.arcBursts[i].t += dt;
      if (this.arcBursts[i].t >= this.arcBursts[i].T) this.arcBursts.splice(i, 1);
    }
    this.arcTimer -= dt;
    if (this.arcTimer <= 0) {
      this.arcTimer = 0.05;
      let vi = 0;
      for (const ab of this.arcBursts) {
        const live = ab.ids.map((i) => this.chunks[i]).filter((c) => c.on);
        if (!live.length) continue;
        const na = Math.min(3, Math.max(1, live.length >> 1));
        for (let a = 0; a < na; a++) {
          const c1 = pick(live);
          const c2 = pick(live);
          let ex = c2.px;
          let ey = c2.py;
          let ez = c2.pz;
          if (c2 === c1) {
            ex += rand(-2.2, 2.2);
            ey += rand(-2.2, 2.2);
            ez += rand(-2.2, 2.2);
          }
          let lx = c1.px;
          let ly = c1.py;
          let lz = c1.pz;
          for (let sg = 1; sg <= 6; sg++) {
            const tt = sg / 6;
            const j = sg < 6 ? 0.5 : 0;
            const nx = c1.px + (ex - c1.px) * tt + rand(-j, j);
            const ny = c1.py + (ey - c1.py) * tt + rand(-j, j);
            const nz = c1.pz + (ez - c1.pz) * tt + rand(-j, j);
            if (vi + 6 > this.arcPos.length) break;
            this.arcPos[vi++] = lx;
            this.arcPos[vi++] = ly;
            this.arcPos[vi++] = lz;
            this.arcPos[vi++] = nx;
            this.arcPos[vi++] = ny;
            this.arcPos[vi++] = nz;
            lx = nx;
            ly = ny;
            lz = nz;
          }
        }
      }
      this.arcLine.geometry.setDrawRange(0, vi / 3);
      this.arcLine.geometry.attributes.position.needsUpdate = true;
      this.arcLine.material.opacity = 0.5 + Math.random() * 0.45;
    }
  }

  reset() {
    for (let i = 0; i < CHUNKS; i++) {
      this.chunks[i].on = false;
      this.chunkMesh.setMatrixAt(i, this.zero);
      this.outlineMesh.setMatrixAt(i, this.zero);
    }
    this.chunkMesh.instanceMatrix.needsUpdate = true;
    this.outlineMesh.instanceMatrix.needsUpdate = true;
    this.sparkLife.fill(0);
    const sca = this.sparkPts.geometry.attributes.color.array;
    sca.fill(0);
    this.sparkPts.geometry.attributes.color.needsUpdate = true;
    this.arcBursts.length = 0;
    this.arcLine.geometry.setDrawRange(0, 0);
    for (const f of this.flashes) {
      f.on = false;
      f.sp.visible = false;
    }
  }
}
