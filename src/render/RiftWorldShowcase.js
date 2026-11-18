import * as THREE from 'three';
import { createImportedModel } from './ImportedAssets.js';

const TAU = Math.PI * 2;
const STATUE_RING_AMBER = 0x7a460c;

function fallbackModel(id, size) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x59246f, roughness: 0.56, metalness: 0.32 });
  const energy = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x42f4dc).multiplyScalar(1.8) });
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const add = (x, y, z, sx, sy, sz, material = mat) => {
    const mesh = new THREE.Mesh(cube, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    group.add(mesh);
  };
  if (id === 'mechaGolem' || id === 'companion') {
    add(0, 0, 0, 2.6, 3.4, 1.6);
    add(0, 2.6, 0.1, 2, 1.6, 1.5);
    for (const side of [-1, 1]) {
      add(side * 2, 0.3, 0, 1.1, 3.5, 1.2);
      add(side * 0.8, -2.8, 0, 1.2, 2.2, 1.4);
      add(side * 0.5, 2.7, 0.9, 0.42, 0.28, 0.2, energy);
    }
    add(0, 0.7, 0.9, 0.8, 0.8, 0.3, energy);
    group.scale.setScalar(size / 7.3);
  } else {
    add(0, 0, 0, 1.3, 0.8, 4.2);
    for (const side of [-1, 1]) {
      add(side * 1.9, 0, -0.4, 2.7, 0.3, 2.2);
      add(side * 1.2, 0, -2.2, 0.55, 0.55, 0.5, energy);
    }
    group.scale.setScalar(size / 6.5);
  }
  return group;
}

function model(id, size) {
  const group = createImportedModel(id, { size }) || fallbackModel(id, size);
  // These are ornamental inhabitants, so they never register targets or
  // expensive moving shadow casters among the actual enemy combatants.
  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
  return group;
}

/** One instanced batch per ring; no per-frame block uploads. */
function voxelOrbit(radius, count, blockSize) {
  const geometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize);
  const material = new THREE.MeshStandardMaterial({
    color: STATUE_RING_AMBER,
    emissive: STATUE_RING_AMBER,
    emissiveIntensity: 0.08,
    metalness: 0.2,
    roughness: 0.8,
  });
  const ring = new THREE.InstancedMesh(geometry, material, count);
  const transform = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const angle = i / count * TAU;
    transform.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, Math.sin(angle * 5) * 0.2);
    transform.rotation.set(0, 0, angle + Math.PI / 4);
    transform.scale.set(1, i % 4 === 0 ? 1.8 : 1, 1);
    transform.updateMatrix();
    ring.setMatrixAt(i, transform.matrix);
  }
  ring.instanceMatrix.needsUpdate = true;
  ring.computeBoundingSphere();
  return ring;
}

function citadelPlanet() {
  const root = new THREE.Group();
  const hull = [], energy = [];
  const block = (x, y, z, color, lit = false, sx = 0.54, sy = sx, sz = sx) =>
    (lit ? energy : hull).push({ x, y, z, color, sx, sy, sz });
  const hash = (x, y, z) => {
    const n = Math.sin(x * 41.31 + y * 73.17 + z * 23.79) * 47143.37;
    return n - Math.floor(n);
  };
  // Obsidian plates leave black space between the cyan conduits and violet
  // armor. Gold is reserved for the tiny pirate insignia and orbiting loot.
  const dark = [0x05070c, 0x090c15, 0x100a1b, 0x151021];
  const purple = [0x3b075f, 0x5b128c, 0x8618bd, 0x290a49];
  const teal = [0x055a64, 0x087d82, 0x08b8b4, 0x073b47];
  const rail = [0x10353e, 0x087c83, 0x20d9d4];
  const radius = 15;
  // Only the exposed shell is built: thousands of small readable plates,
  // three shared draw calls, and no invisible solid voxel interior.
  for (let x = -radius; x <= radius; x++) for (let y = -radius; y <= radius; y++) {
    for (let z = -radius; z <= radius; z++) {
      const d = x * x + y * y + z * z;
      if (d > radius * radius || d < (radius - 1.15) ** 2) continue;
      const noise = hash(x, y, z);
      const patch = hash(Math.floor(x / 4), Math.floor(y / 3), Math.floor(z / 4));
      const palette = patch > 0.82 ? teal : patch > 0.49 ? purple : dark;
      const color = palette[Math.floor(noise * palette.length)];
      const conduit = (y === -3 || y === 6) && noise > 0.54;
      const seam = Math.abs(x) === 10 && y % 4 === 0 && noise > 0.74;
      block(x * 0.57, y * 0.57, z * 0.57,
        conduit || seam ? 0x19f9ec : noise > 0.984 ? 0xca25ef : color,
        conduit || seam);
    }
  }

  // A pirate dock is embedded in the face of the planetoid, with fortified
  // turrets, cyan windows, dark metal railwork and a voxel skull pennant.
  for (const side of [-1, 1]) {
    for (let x = 0; x < 5; x++) for (let y = 0; y < 12; y++) for (let z = 0; z < 4; z++) {
      if (x > 0 && x < 4 && z > 0 && z < 3 && y < 11) continue;
      if (y === 11 && x % 2 === 1) continue;
      const px = side * 3.2 + (x - 2) * 0.57;
      const py = -3.6 + y * 0.57;
      const pz = 6.5 + z * 0.57;
      const window = z === 3 && y % 5 === 2 && x > 0 && x < 4;
      const trim = z === 3 && y === 9 && x % 2 === 0;
      block(px, py, pz, window || trim ? 0x20fff0 : y === 9 ? 0x10353e : purple[(x + y + z) % 4], window || trim);
    }
    for (let y = 0; y < 10; y++) {
      block(side * 3.2, 3 + y * 0.3, 7.1, y === 9 ? 0x46fff2 : 0x17343f, y === 9, 0.14, 0.28, 0.14);
    }
  }
  for (let x = -8; x <= 8; x++) for (let y = -7; y <= -5; y++) {
    block(x * 0.57, y * 0.57, 8.55, y === -5 ? rail[(x + 9) % 3] : dark[(x + 9) % 4], y === -5 && (x + 9) % 3 === 2);
  }
  for (let y = 0; y < 10; y++) for (let x = -3; x <= 3; x++) {
    if (y === 9 && Math.abs(x) === 2) continue;
    block(x * 0.4, 2.1 - y * 0.4, 8.65, y === 0 ? 0x981ad6 : 0x4b097c, false, 0.39, 0.39, 0.13);
  }
  const skull = ['0111110', '1111111', '1001001', '1001001', '1111111', '0110110', '0101010'];
  skull.forEach((row, y) => [...row].forEach((bit, x) => {
    if (bit === '1') block((x - 3) * 0.23, 1.28 - y * 0.23, 8.78, 0xf6ce63, false, 0.21, 0.21, 0.12);
  }));
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const transform = new THREE.Object3D(), color = new THREE.Color();
  for (const [cells, bright] of [[hull, false], [energy, true]]) {
    const material = bright
      ? new THREE.MeshBasicMaterial()
      : new THREE.MeshStandardMaterial({ roughness: 0.43, metalness: 0.48 });
    const mesh = new THREE.InstancedMesh(cube, material, cells.length);
    cells.forEach((cell, i) => {
      transform.position.set(cell.x, cell.y, cell.z);
      transform.scale.set(cell.sx, cell.sy, cell.sz);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      color.setHex(cell.color);
      // Keep cyan tiles near the bloom threshold so the halo never buries
      // the obsidian plates or washes the energy channels into white.
      if (bright) color.multiplyScalar(1.08);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  // Bounds of the gold insignia only, in planet-local coordinates. Testing
  // one box avoids raycasting the thousands of instanced hull voxels.
  root.userData.skullBounds = new THREE.Box3(
    new THREE.Vector3(-0.795, -0.205, 8.72), new THREE.Vector3(0.795, 1.385, 8.84));
  root.userData.radius = radius * 0.57 + 0.27;
  root.userData.voxelCount = hull.length + energy.length;
  return root;
}

function orbitalJewels() {
  const root = new THREE.Group();
  const rings = [], jewels = [];
  for (const [i, radius, tint, tilt] of [[0, 11.1, 0x11fff0, 0.7], [1, 12.3, 0xd52bff, -0.55]]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.018, 3, 128),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(1.4), transparent: true, opacity: 0.72 })
    );
    ring.rotation.set(tilt, i ? 0.4 : -0.3, i ? 0.38 : -0.5);
    root.add(ring);
    rings.push(ring);
  }
  for (let i = 0; i < 6; i++) {
    const tint = [0x18fff0, 0xc22bff, 0xffc94d][i % 3];
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(i % 3 === 0 ? 0.55 : 0.32),
      new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.8, roughness: 0.24, metalness: 0.5 })
    );
    const phase = i / 6 * TAU;
    root.add(gem);
    jewels.push({ gem, phase, radius: i % 2 ? 11.1 : 12.3 });
  }
  root.userData.rings = rings;
  root.userData.jewels = jewels;
  return root;
}

/**
 * Imported characters make the rift feel inhabited. The title vignette and
 * in-world shrines share cached geometry; they add no targets or collisions.
 * Caller owns scene timing and passes menu=true only while the title is shown.
 */
export class RiftWorldShowcase {
  constructor(scene) {
    this.time = 0;
    this.menu = false;
    this.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
    this.menuRoot = new THREE.Group();
    this.menuRoot.position.set(16, 7.5, -22);
    this.menuRoot.visible = false;
    this.worldRoot = new THREE.Group();
    scene.add(this.menuRoot, this.worldRoot);

    this.menuPlanet = citadelPlanet();
    this.menuPlanet.rotation.set(0.08, -0.3, -0.06);
    this.menuRoot.add(this.menuPlanet);
    this.menuOrbitals = orbitalJewels();
    this.menuRoot.add(this.menuOrbitals);

    const menuKey = new THREE.PointLight(0x9afff4, 190, 45, 2);
    menuKey.position.set(-5, 9, 14);
    const menuRim = new THREE.PointLight(0xc42aff, 115, 40, 2);
    menuRim.position.set(7, 3, 8);
    this.menuRoot.add(menuKey, menuRim);
    this.skullRay = new THREE.Raycaster();
    this.skullPointer = new THREE.Vector2();
    this.planetInverse = new THREE.Matrix4();
    this.haloCenter = new THREE.Vector3();
    this.haloScale = new THREE.Vector3();
    this.haloBounds = { x: 0, y: 0, width: 0, height: 0 };

    // Guarding the sides of the route, these monuments are deliberately well
    // outside x=±22. Their slow drift gives each fly-by a sense of huge scale.
    this.guardians = [];
    const guardianDefs = [
      { id: 'mechaGolem', x: -43, y: 2, z: -105, size: 22, rate: 0.24 },
      { id: 'companion', x: 39, y: 6, z: -175, size: 16, rate: 0.19 },
      { id: 'mechaGolem', x: 58, y: -5, z: -265, size: 28, rate: 0.15 },
      { id: 'companion', x: -61, y: 15, z: -320, size: 19, rate: 0.12 },
    ];
    for (const [i, def] of guardianDefs.entries()) {
      const root = new THREE.Group();
      const character = model(def.id, def.size);
      character.rotation.y = def.x > 0 ? -0.55 : 0.55;
      root.add(character);
      const crown = voxelOrbit(def.size * 0.62, 36, def.size * 0.035);
      crown.position.set(0, 0, -3);
      crown.rotation.x = 0.13;
      const dais = voxelOrbit(def.size * 0.35, 24, def.size * 0.055);
      dais.rotation.x = -Math.PI / 2;
      dais.position.y = -def.size * 0.52;
      root.add(crown, dais);
      root.position.set(def.x, def.y, def.z);
      this.worldRoot.add(root);
      this.guardians.push({ ...def, root, crown, dais, phase: i * 1.7, startZ: def.z });
    }

    // A small convoy of recognisable supplied ships moves independently of the
    // scenery; hostile versions of the same hulls belong to EnemySpawner.
    this.convoy = [];
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? -1 : 1;
      const ship = model(['intruder', 'camoJet', 'redFighter'][i % 3], 5 + i * 0.7);
      this.worldRoot.add(ship);
      this.convoy.push({ ship, side, phase: i * 51, y: -6 + (i % 3) * 12, x: side * (31 + (i % 3) * 7) });
    }
    this.update(0, 0, { menu: false });
  }

  /** Project the planet's spherical silhouette, including its off-axis
   * perspective shift. The DOM halo follows the same camera as the voxels. */
  getMenuPlanetScreenBounds(camera, viewport) {
    camera.updateWorldMatrix(true, false);
    this.menuPlanet.getWorldPosition(this.haloCenter);
    this.menuPlanet.getWorldScale(this.haloScale);
    this.haloCenter.applyMatrix4(camera.matrixWorldInverse);
    const { x, y } = this.haloCenter;
    const depth = -this.haloCenter.z;
    const radius = this.menuPlanet.userData.radius * this.haloScale.x;
    const denominator = depth * depth - radius * radius;
    const projection = camera.projectionMatrix.elements;
    const bounds = this.haloBounds;
    bounds.x = viewport.width * (1 + x * depth / denominator * projection[0]) / 2;
    bounds.y = viewport.height * (1 - y * depth / denominator * projection[5]) / 2;
    bounds.width = viewport.width * radius * Math.sqrt(depth * depth + x * x - radius * radius) / denominator * projection[0];
    bounds.height = viewport.height * radius * Math.sqrt(depth * depth + y * y - radius * radius) / denominator * projection[5];
    return bounds;
  }

  isPointerOverSkull(x, y, camera, viewport) {
    if (!this.menu || !viewport.width || !viewport.height) return false;
    this.skullPointer.set((x - viewport.left) / viewport.width * 2 - 1,
      1 - (y - viewport.top) / viewport.height * 2);
    if (Math.abs(this.skullPointer.x) > 1 || Math.abs(this.skullPointer.y) > 1) return false;
    camera.updateWorldMatrix(true, false);
    this.menuPlanet.updateWorldMatrix(true, false);
    this.skullRay.setFromCamera(this.skullPointer, camera);
    this.planetInverse.copy(this.menuPlanet.matrixWorld).invert();
    return this.skullRay.ray.applyMatrix4(this.planetInverse).intersectsBox(this.menuPlanet.userData.skullBounds);
  }

  setMenu(menu) {
    this.menu = Boolean(menu);
    this.menuRoot.visible = this.menu;
    this.worldRoot.visible = !this.menu;
  }

  /** Keep the menu hero at 76% viewport width as the desktop window changes. */
  resize(aspect) {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.6;
    // Keep the hero inside the same centered composition on ultra-wide screens.
    const stageFraction = Math.min(1, 1.9 / safeAspect);
    this.menuRoot.position.x = 0.52 * stageFraction * 33 * Math.tan(68 * Math.PI / 360) * safeAspect;
    this.menuRoot.scale.setScalar(Math.min(1, Math.max(0.55, safeAspect / 1.35)));
  }

  update(dt, worldSpeed = 0, { menu = false } = {}) {
    if (menu !== this.menu) this.setMenu(menu);
    this.time += Math.max(0, dt);
    const t = this.reducedMotion ? 0 : this.time;
    if (this.menu) {
      this.menuPlanet.position.y = Math.sin(t * 0.38) * 0.18;
      this.menuPlanet.rotation.y = -0.3 + Math.sin(t * 0.08) * 0.12;
      this.menuOrbitals.userData.jewels.forEach(({ gem, phase, radius }, i) => {
        const angle = phase + t * (i % 2 ? -0.027 : 0.02);
        gem.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.62, Math.sin(angle * 2) * 4);
        gem.rotation.y = t * 0.18 + phase;
      });
      return;
    }

    for (const guardian of this.guardians) {
      guardian.root.position.z += Math.max(0, worldSpeed) * guardian.rate * dt;
      if (guardian.root.position.z > 28) guardian.root.position.z -= 380;
      guardian.root.position.y = guardian.y + Math.sin(t * 0.28 + guardian.phase) * 1.2;
      guardian.crown.rotation.z = t * 0.055 + guardian.phase;
      guardian.dais.rotation.z = -t * 0.045;
    }
    this.convoy.forEach(({ ship, side, phase, x, y }, i) => {
      const progress = (t * (6 + i * 0.55) + phase) % 310;
      ship.position.set(x + Math.sin(t * 0.17 + phase) * 3, y + Math.sin(t * 0.31 + phase) * 2,
        side > 0 ? -300 + progress : 10 - progress);
      ship.rotation.set(0.08 * Math.sin(t * 0.4 + i), side > 0 ? 0 : Math.PI,
        Math.sin(t * 0.3 + i) * 0.08);
    });
  }

  reset() {
    this.time = 0;
    for (const guardian of this.guardians) guardian.root.position.set(guardian.x, guardian.y, guardian.startZ);
    this.setMenu(false);
    this.update(0, 0, { menu: false });
  }
}
