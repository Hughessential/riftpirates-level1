import * as THREE from 'three';
import { P } from '../core/Palette.js';
import { buildVoxels, box, dedupe, glowSprite } from './VoxelBuilder.js';
import { clamp, TAU } from '../core/Utils.js';

export const LANE_GUIDE_COLOR = '#ff6a18';

const noise = (x, y = 0, z = 0) => {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return n - Math.floor(n);
};

/** Surface voxels only: hidden blocks add cost without adding a silhouette. */
function exposed(voxels) {
  const cells = new Set(voxels.map((v) => `${v.x},${v.y},${v.z}`));
  return voxels.filter(({ x, y, z }) => ![
    [x - 1, y, z], [x + 1, y, z], [x, y - 1, z],
    [x, y + 1, z], [x, y, z - 1], [x, y, z + 1],
  ].every((p) => cells.has(p.join(','))));
}

function rockReefVoxels() {
  const v = [];
  for (let x = -8; x <= 8; x++) {
    for (let y = -5; y <= 5; y++) {
      for (let z = -5; z <= 5; z++) {
        const edge = (x / 8) ** 2 + (y / 5) ** 2 + (z / 5) ** 2;
        if (edge > 0.84 + noise(x, y, z) * 0.28) continue;
        const grain = noise(x + 11, y, z);
        const c = grain < 0.06 ? P.stone : grain < 0.35 ? P.rock : P.rockDark;
        v.push({ x, y, z, c });
      }
    }
  }
  return exposed(v);
}

function ruinedBastionVoxels() {
  const v = [];
  box(v, -7, 7, -5, -3, -5, 5, P.stoneDark, (x, y, z) => {
    if (Math.hypot(x / 7, z / 5) > 1.1) return false;
    return noise(x, y, z) < 0.2 ? P.stone : P.rockDark;
  });
  box(v, -4, 4, -2, 12, -3, 3, P.stoneDark, (x, y, z) => {
    if (Math.abs(x) !== 4 && Math.abs(z) !== 3) return false;
    if (y > 5 + Math.round(noise(x, 0, z) * 8)) return false;
    if (y > 0 && noise(x, y, z) < 0.16) return false;
    return y === 2 && x % 3 === 0 ? P.teal : noise(x, y, z) < 0.25 ? P.steel : P.stoneDark;
  });
  for (const side of [-1, 1]) {
    box(v, side * 6, side * 6, -3, 3, 0, 2, P.steel);
    box(v, side * 5, side * 5, -9, -6, 0, 1, P.rockDark);
  }
  return exposed(dedupe(v));
}

function hulkVoxels() {
  const v = [];
  for (let z = -13; z <= 11; z++) {
    const halfWidth = Math.max(1, 4 - Math.floor(Math.abs(z) / 4));
    box(v, -halfWidth, halfWidth, -1, 2, z, z, P.stoneDark, (x, y) => {
      if (z > 5 && x > 0 && y > 0) return false;
      return noise(x, y, z) < 0.18 ? P.stone : P.stoneDark;
    });
  }
  for (const side of [-1, 1]) {
    for (let x = 3; x <= 9; x++) {
      box(v, side * x, side * x, 0, 0, x - 6, x - 2, x > 7 ? P.rockDark : P.steel);
    }
    box(v, side * 3, side * 3, 2, 5, 5, 7, P.stoneDark);
  }
  return exposed(dedupe(v));
}

function shardVoxels() {
  const v = [];
  box(v, -2, 2, -2, 2, -3, 3, P.rockDark, (x, y, z) => {
    if (Math.abs(x) + Math.abs(y) + Math.abs(z) > 4 + noise(x, y, z)) return false;
    return noise(x, y, z) < 0.25 ? P.stone : P.rockDark;
  });
  return exposed(v);
}

/**
 * Continuous scenery: thousands of blocks live in five instanced batches.
 * Only cluster transforms move each frame; no per-block matrix uploads. Near,
 * middle and distant bands move at different rates to sell forward flight.
 * Every cluster stays outside the ship's fighting corridor and has no target.
 */
export class LivingDebrisField {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.transform = new THREE.Object3D();
    this.time = 0;
    this.batches = [];
    this.blockCount = 0;
    this.triangleCount = 0;

    const types = [
      { name: 'reefs', voxels: rockReefVoxels(), count: 28, size: 0.9, rate: 1 },
      { name: 'bastions', voxels: ruinedBastionVoxels(), count: 12, size: 0.8, rate: 0.7 },
      { name: 'hulks', voxels: hulkVoxels(), count: 12, size: 0.65, rate: 0.85 },
      { name: 'shards', voxels: shardVoxels(), count: 60, size: 0.65, rate: 1.1 },
    ];
    for (let typeIndex = 0; typeIndex < types.length; typeIndex++) {
      const def = types[typeIndex];
      const proto = buildVoxels(def.voxels, def.size, {
        outline: 1,
        castShadow: false,
        receiveShadow: false,
        roughness: 0.88,
        metalness: def.name === 'hulks' ? 0.3 : 0.08,
      }).userData.mesh;
      const mesh = new THREE.InstancedMesh(proto.geometry, proto.material, def.count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Instances wrap independently; a fixed batch bound would become stale.
      mesh.frustumCulled = false;
      this.group.add(mesh);
      const entries = [];
      for (let i = 0; i < def.count; i++) {
        const seed = typeIndex * 137 + i * 13;
        const band = i % 3;
        const side = i % 2 ? -1 : 1;
        entries.push({
          // Even the largest near reef cannot intrude into x = ±22 gameplay.
          x: side * (42 + band * 25 + noise(seed) * (band === 0 ? 16 : 34)),
          y: -25 + noise(seed, 3) * (band === 2 ? 98 : 50),
          z: -285 + noise(seed, 5) * 298,
          ax: noise(seed, 7) * TAU,
          ay: noise(seed, 11) * TAU,
          az: noise(seed, 13) * TAU,
          spin: (noise(seed, 17) - 0.5) * (def.name === 'hulks' ? 0.08 : 0.24),
          scale: 0.65 + noise(seed, 19) * 0.9 + band * 0.25,
          rate: [0.75, 0.34, 0.12][band] * def.rate,
          phase: noise(seed, 23) * TAU,
        });
      }
      this.batches.push({ mesh, entries });
      this.blockCount += def.voxels.length * def.count;
      this.triangleCount += proto.geometry.attributes.position.count / 3 * def.count;
    }

    // A few inhabited silhouettes add motion independent of world scrolling.
    const ship = [];
    box(ship, -1, 1, -1, 1, -7, 7, P.stoneDark);
    box(ship, -2, 2, 2, 3, 0, 4, P.steel);
    for (const side of [-1, 1]) {
      box(ship, side * 4, side * 4, 0, 1, -3, 6, P.stone);
      box(ship, side * 3, side * 3, 0, 0, 1, 4, P.steel);
    }
    const shipVoxels = exposed(dedupe(ship));
    const shipProto = buildVoxels(shipVoxels, 0.48, { outline: 1, castShadow: false, receiveShadow: false });
    this.convoy = new THREE.InstancedMesh(shipProto.userData.mesh.geometry, shipProto.userData.mesh.material, 6);
    this.convoy.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.convoy.frustumCulled = false;
    this.group.add(this.convoy);
    const engines = [-4, 0, 4].map((x) => ({ x, y: 0, z: 8, c: P.white }));
    const engineProto = buildVoxels(engines, 0.48, { outline: 1, castShadow: false, receiveShadow: false });
    const engineMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.orange).multiplyScalar(2.5) });
    engineProto.userData.mesh.material.dispose();
    this.engines = new THREE.InstancedMesh(engineProto.userData.mesh.geometry, engineMaterial, 6);
    this.engines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.engines.frustumCulled = false;
    this.group.add(this.engines);
    this.blockCount += (shipVoxels.length + engines.length) * 6;
    this.triangleCount += (shipVoxels.length + engines.length) * 12 * 6;
    this.drawCalls = this.batches.length + 2;
    this.update(0, 0);
  }

  update(dt, speed) {
    this.time += dt;
    const t = this.transform;
    for (const { mesh, entries } of this.batches) {
      entries.forEach((entry, index) => {
        entry.z += speed * entry.rate * dt;
        if (entry.z > 28) entry.z -= 328;
        t.position.set(entry.x, entry.y + Math.sin(this.time * 0.12 + entry.phase) * 1.7, entry.z);
        t.rotation.set(entry.ax + this.time * entry.spin, entry.ay + this.time * entry.spin * 0.7, entry.az);
        t.scale.setScalar(entry.scale);
        t.updateMatrix();
        mesh.setMatrixAt(index, t.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? -1 : 1;
      const sweep = (this.time * (3 + i * 0.35) + i * 51) % 285;
      const approaching = i % 2 === 0;
      t.position.set(side * (46 + i * 5 + Math.sin(this.time * 0.06 + i) * 7), 8 + i * 5,
        approaching ? -290 + sweep : -5 - sweep);
      t.rotation.set(0.07 * Math.sin(this.time * 0.3 + i), (approaching ? Math.PI : 0) + side * 0.1, side * -0.08);
      t.scale.setScalar(0.9 + i * 0.12);
      t.updateMatrix();
      this.convoy.setMatrixAt(i, t.matrix);
      this.engines.setMatrixAt(i, t.matrix);
    }
    this.convoy.instanceMatrix.needsUpdate = true;
    this.engines.instanceMatrix.needsUpdate = true;
  }
}

/**
 * A lightweight, non-colliding landmark and navigation beacons for the Outer
 * Defense approach. The real tower is created by its encounter only. Geometry
 * is built once, then the same beacon meshes are reused throughout the flight.
 */
export class ApproachScenery {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.progress = 0;
    this.time = 0;
    this.color = new THREE.Color(P.cyan);
    scene.add(this.group);

    const stone = [];
    // A recognisable stepped fortress, kept sparse because it stays distant.
    for (const [width, bottom, top] of [[10, -4, 0], [7, 1, 7], [4, 8, 15], [1, 16, 23]]) {
      box(stone, -width, width, bottom, top, -3, 3, P.stoneDark, (x, y, z) => {
        if (Math.abs(x) !== width && z !== 3 && y !== top) return false;
        return (x + y + z) % 5 === 0 ? P.stone : P.stoneDark;
      });
    }
    for (const side of [-1, 1]) {
      box(stone, side * 12 - 1, side * 12 + 1, -3, 5, -1, 1, P.stoneDark);
      box(stone, side * 8 - 2, side * 8 + 2, 5, 6, 1, 4, P.stoneDark);
    }
    // Fractured underside of the floating foundation.
    for (let x = -9; x <= 9; x += 3) {
      box(stone, x, x + 1, -12 + Math.abs(x) * 0.5, -5, -1, 1, P.rockDark);
    }
    this.fortress = buildVoxels(dedupe(stone), 1, {
      outline: 1,
      castShadow: false,
      receiveShadow: false,
      roughness: 0.9,
    });
    this.group.add(this.fortress);

    const lights = [];
    for (const y of [2, 5, 10, 13]) {
      const width = y > 7 ? 3 : 6;
      for (let x = -width; x <= width; x += 3) {
        lights.push({ x, y, z: 3.6, c: P.white });
      }
    }
    box(lights, 0, 0, 24, 27, 0, 0, P.white);
    this.windows = buildVoxels(lights, 1, { outline: 1, castShadow: false, receiveShadow: false });
    this.energyMaterial = new THREE.MeshBasicMaterial({ color: this.color.clone().multiplyScalar(2.4), fog: false });
    this.windows.userData.mesh.material.dispose();
    this.windows.userData.mesh.material = this.energyMaterial;
    this.fortress.add(this.windows);
    this.halo = glowSprite(P.cyan, 33, 0.12);
    this.halo.material.fog = false;
    this.halo.position.set(0, 8, -2);
    this.fortress.add(this.halo);

    const beacon = [];
    box(beacon, -2, 2, -3, -2, -2, 2, P.stoneDark);
    box(beacon, -1, 1, -1, 4, -1, 1, P.stoneDark, (x, y, z) => {
      if (y > 1 && x !== 0 && z !== 0) return false;
      return y % 3 === 0 ? P.steel : P.stoneDark;
    });
    box(beacon, 0, 0, 5, 7, 0, 0, P.steel);
    const prototype = buildVoxels(beacon, 0.9, { outline: 1, castShadow: false, receiveShadow: false });
    const lampGeometry = new THREE.BoxGeometry(1.05, 2.5, 1.05);
    // Navigation fixtures keep a dedicated orange identity. They must never
    // inherit the cyan/encounter color used by loot, objectives and the distant
    // fortress, or the lane becomes visually ambiguous at combat speed.
    this.guideMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(LANE_GUIDE_COLOR).multiplyScalar(2.6),
      fog: false,
    });
    const lamp = new THREE.Mesh(lampGeometry, this.guideMaterial);
    lamp.position.y = 5.5;
    prototype.add(lamp);
    this.beaconRows = [];
    for (let row = 0; row < 4; row++) {
      const pair = new THREE.Group();
      for (const side of [-1, 1]) {
        const pylon = prototype.clone();
        pylon.position.set(side * 30, -8, 0);
        const flare = glowSprite(LANE_GUIDE_COLOR, 5, 0.34);
        flare.position.set(side * 30, -2.5, 0.7);
        pair.add(pylon, flare);
      }
      pair.position.z = -225 + row * 62;
      this.beaconRows.push(pair);
      this.group.add(pair);
    }
  }

  setProgress(progress, color) {
    if (!this.group.visible) {
      this.time = 0;
      this.beaconRows.forEach((pair, row) => { pair.position.z = -225 + row * 62; });
    }
    this.group.visible = true;
    this.progress = clamp(progress, 0, 1);
    this.color.set(color);
    this.energyMaterial.color.copy(this.color).multiplyScalar(2.4);
    this.halo.material.color.copy(this.color);
    // Destination grows naturally in perspective as the three caches are won.
    this.fortress.position.set(0, -16, -245 + this.progress * 122);
  }

  update(dt, speed) {
    if (!this.group.visible) return;
    this.time += dt;
    this.fortress.rotation.y = Math.sin(this.time * 0.08) * 0.07;
    this.halo.material.opacity = 0.11 + this.progress * 0.1 + Math.sin(this.time * 1.2) * 0.025;
    for (const pair of this.beaconRows) {
      pair.position.z += speed * dt * 0.8;
      if (pair.position.z > 20) pair.position.z -= 248;
    }
  }

  clear() {
    this.group.visible = false;
    this.progress = 0;
  }
}
