import * as THREE from 'three';
import { buildMesh } from 'three/addons/loaders/VOXLoader.js';
import { readFleetVoxData } from './FleetVoxData.js';
import { fetchAssetBuffer } from '../core/AssetLoader.js';

/** Hull identity only. These records intentionally contain no gameplay stats. */
export const PLAYER_SHIPS = Object.freeze([
  { id: 'rift-talon', name: 'RIFT TALON', tagline: 'Six fins. One bad intention.' },
  { id: 'void-corsair', name: 'VOID CORSAIR', tagline: 'Twin booms. Pirate soul.' },
  { id: 'neon-wraith', name: 'NEON WRAITH', tagline: 'A sharp silhouette in the dark.' },
  { id: 'black-manta', name: 'BLACK MANTA', tagline: 'Wide wings. Wild colors.' },
  { id: 'gold-revenant', name: 'GOLD REVENANT', tagline: 'Plunder written in neon.' },
  { id: 'star-vandal', name: 'STAR VANDAL', tagline: 'Built to leave an impression.' },
].map(Object.freeze));

const prototypes = new Map();
const metrics = new Map();
let loading;

// Retain the artist's panel layout, assigning its eight palette channels to
// pirate metal, violet armor, turquoise trim, gold, acid paint and hot engines.
const PAINT = {
  249: 0x49316e,
  250: 0x167f85,
  251: 0x101321,
  255: 0x05090f,
  241: 0xf0bc4e,
  242: 0xb8ed40,
  233: 0xe63bff,
  234: 0x8cfff1,
};
const PRIMARIES = [0x49316e, 0x245e69, 0x5c368b, 0x27394f, 0x4b386a, 0x30455e];
const engineColor = new THREE.Color(PAINT[233]);
const lampColor = new THREE.Color(PAINT[234]);

const material = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.52, metalness: 0.4,
});
material.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 fleetEmission;\nvarying vec3 vFleetEmission;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFleetEmission = fleetEmission;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFleetEmission;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vFleetEmission;');
};
material.customProgramCacheKey = () => 'rift-player-fleet-emission-v1';

export function isPlayerShipId(id) {
  return PLAYER_SHIPS.some((ship) => ship.id === id);
}

function packedRGBA(hex) {
  return (0xff000000 | ((hex & 0xff) << 16) | (hex & 0x00ff00) | ((hex >>> 16) & 0xff)) >>> 0;
}

function isColor(attribute, index, color) {
  return Math.abs(attribute.getX(index) - color.r) < 1e-5
    && Math.abs(attribute.getY(index) - color.g) < 1e-5
    && Math.abs(attribute.getZ(index) - color.b) < 1e-5;
}

/** Also used by the asset test; parsing never requires a browser or WebGL. */
export function registerPlayerFleet(buffer) {
  if (prototypes.size === PLAYER_SHIPS.length) return getPlayerFleetStats();
  const chunks = readFleetVoxData(buffer);
  if (chunks.length !== PLAYER_SHIPS.length) {
    throw new Error('The supplied player fleet must contain six separate hulls');
  }
  // The authored scene lays the ships beside one another. Build each source
  // model independently so those presentation translations never affect play.
  PLAYER_SHIPS.forEach((ship, index) => {
    const chunk = chunks[index];
    const palette = Uint32Array.from(chunk.palette);
    for (const [slot, color] of Object.entries(PAINT)) palette[slot] = packedRGBA(color);
    palette[249] = packedRGBA(PRIMARIES[index]);
    const mesh = buildMesh({ ...chunk, palette });
    mesh.material.dispose();
    mesh.material = material;
    mesh.name = ship.name;

    const geometry = mesh.geometry;
    // Source engine-blue cells lie at high VOX Y, which VOXLoader maps to -Z.
    // Turn the mesh so its nose is -Z and its engines face the player's camera.
    geometry.rotateY(Math.PI);
    geometry.center();
    geometry.computeBoundingBox();
    const dimensions = geometry.boundingBox.getSize(new THREE.Vector3());
    const extent = Math.max(dimensions.x, dimensions.y, dimensions.z);
    if (!Number.isFinite(extent) || extent <= 0) throw new Error(`Invalid hull: ${ship.id}`);

    const colors = geometry.getAttribute('color');
    const emission = new Float32Array(colors.count * 3);
    let emissiveVertices = 0;
    for (let i = 0; i < colors.count; i++) {
      const strength = isColor(colors, i, engineColor) ? 2.7 : isColor(colors, i, lampColor) ? 1.7 : 0;
      if (!strength) continue;
      emission[i * 3] = colors.getX(i) * strength;
      emission[i * 3 + 1] = colors.getY(i) * strength;
      emission[i * 3 + 2] = colors.getZ(i) * strength;
      emissiveVertices++;
    }
    geometry.setAttribute('fleetEmission', new THREE.BufferAttribute(emission, 3));
    geometry.scale(1 / extent, 1 / extent, 1 / extent);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    prototypes.set(ship.id, mesh);
    metrics.set(ship.id, {
      id: ship.id, sourceModel: index,
      voxels: chunk.data.length / 4,
      triangles: geometry.index.count / 3,
      dimensions: dimensions.toArray(), emissiveVertices,
    });
  });
  return getPlayerFleetStats();
}

export function preloadPlayerFleet(onProgress = () => {}) {
  if (loading) return loading;
  loading = (async () => {
    try {
      const buffer = await fetchAssetBuffer(`${import.meta.env?.BASE_URL || './'}voxels/player-fleet/spaceships.vox`);
      registerPlayerFleet(buffer);
    } catch (error) {
      console.warn(`Using original player hull fallback: ${error.message}`);
    } finally {
      onProgress(1, 1);
    }
    return getPlayerFleetStats();
  })();
  return loading;
}

/** Centered Y-up hull, nose -Z. Geometry/material are shared; do not dispose them. */
export function createPlayerShip(id, { size = 5.8, castShadow = true, receiveShadow = true } = {}) {
  const prototype = prototypes.get(id);
  if (!prototype) return null;
  const group = new THREE.Group();
  const hull = prototype.clone();
  hull.scale.setScalar(size);
  hull.castShadow = castShadow;
  hull.receiveShadow = receiveShadow;
  group.add(hull);
  group.name = prototype.name;
  group.userData.shipId = id;
  group.userData.cosmetic = true;
  group.userData.voxelCount = metrics.get(id).voxels;
  group.userData.triangles = metrics.get(id).triangles;
  return group;
}

export function getPlayerFleetStats() {
  return [...metrics.values()].map((entry) => ({ ...entry, dimensions: [...entry.dimensions] }));
}
