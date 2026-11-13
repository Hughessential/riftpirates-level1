import * as THREE from 'three';
import { VOXLoader, buildMesh } from 'three/addons/loaders/VOXLoader.js';

/** Curated original models from the user's asset archive, stored locally. */
export const IMPORTED_ASSETS = {
  redFighter: { file: 'red-fighter.vox', name: 'Red Fighter', source: 'Package-8/RedFighter.vox' },
  dualStriker: { file: 'dual-striker.vox', name: 'Dual Striker', source: 'Package-7/DualStriker.vox' },
  intruder: { file: 'intruder.vox', name: 'Ultraviolet Intruder', source: 'Package-6/UltravioletIntruder.vox' },
  camoJet: { file: 'camo-jet.vox', name: 'Camo Stellar Jet', source: 'Package-2/CamoStellarJet.vox' },
  microRecon: { file: 'micro-recon.vox', name: 'Micro Recon', source: 'Package-9/MicroRecon.vox' },
  mechaGolem: { file: 'mecha-golem.vox', name: 'Mecha Golem', source: 'Package-10/MechaGolem.vox' },
  companion: { file: 'companion.vox', name: 'Companion Bot', source: 'Package-15/Companion-bot.vox' },
};

const prototypes = new Map();
const metrics = new Map();
let loading = null;

// Greedy VOX meshes preserve authored color panels while omitting internal
// faces. A separate vertex emission channel lights engines/eyes without
// making all the painted hull panels glow or adding a material per color.
const material = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.64,
  metalness: 0.28,
});
material.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 voxelEmission;\nvarying vec3 vVoxelEmission;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVoxelEmission = voxelEmission;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vVoxelEmission;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vVoxelEmission;');
};
material.customProgramCacheKey = () => 'rift-authored-voxel-emission-v1';

/** Exported so the same parsing/bounds contract can be verified without a DOM. */
export function registerImportedAsset(id, buffer) {
  if (!IMPORTED_ASSETS[id]) throw new Error(`Unknown imported model: ${id}`);
  if (prototypes.has(id)) return metrics.get(id);
  const parsed = new VOXLoader().parse(buffer);
  if (!parsed?.chunks?.length) throw new Error(`Empty voxel model: ${id}`);
  let model = parsed.scene;
  if (!model) {
    model = new THREE.Group();
    for (const chunk of parsed.chunks) model.add(buildMesh(chunk));
  }
  let triangles = 0;
  let meshes = 0;
  model.traverse((object) => {
    if (!object.isMesh) return;
    const geometry = object.geometry;
    const colors = geometry.getAttribute('color');
    const emissive = new Float32Array(geometry.getAttribute('position').count * 3);
    if (colors) {
      for (let i = 0; i < colors.count; i++) {
        const r = colors.getX(i), g = colors.getY(i), b = colors.getZ(i);
        const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
        if (hi > 0.85 && hi - lo > 0.55) {
          emissive[i * 3] = r * 2.1;
          emissive[i * 3 + 1] = g * 2.1;
          emissive[i * 3 + 2] = b * 2.1;
        }
      }
    }
    geometry.setAttribute('voxelEmission', new THREE.BufferAttribute(emissive, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    object.material.dispose();
    object.material = material;
    object.castShadow = true;
    object.receiveShadow = true;
    triangles += (geometry.index?.count || geometry.getAttribute('position').count) / 3;
    meshes += 1;
  });
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const dimensions = bounds.getSize(new THREE.Vector3());
  const extent = Math.max(dimensions.x, dimensions.y, dimensions.z);
  if (!Number.isFinite(extent) || extent <= 0) throw new Error(`Invalid voxel bounds: ${id}`);
  // Normalise inside a wrapper: Enemy hit-flash changes its outer scale and
  // must never overwrite the authored model's own size or pivot correction.
  const centered = new THREE.Group();
  centered.add(model);
  model.position.sub(center);
  centered.scale.setScalar(1 / extent);
  prototypes.set(id, centered);
  const info = {
    id, voxels: parsed.chunks.reduce((n, chunk) => n + chunk.data.length / 4, 0),
    triangles, meshes, dimensions: dimensions.toArray(),
  };
  metrics.set(id, info);
  return info;
}

/** Loads once. Missing assets fall back to the existing procedural models. */
export function preloadImportedAssets(onProgress = () => {}) {
  if (loading) return loading;
  const entries = Object.entries(IMPORTED_ASSETS);
  let completed = 0;
  loading = Promise.all(entries.map(async ([id, asset]) => {
    try {
      const response = await fetch(`${import.meta.env?.BASE_URL || './'}voxels/${asset.file}`, {
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      registerImportedAsset(id, await response.arrayBuffer());
    } catch (error) {
      console.warn(`Using procedural fallback for ${asset.name}: ${error.message}`);
    } finally {
      completed += 1;
      onProgress(completed, entries.length);
    }
  })).then(() => getImportedAssetStats());
  return loading;
}

/** Centered Y-up model, front facing +Z; size is its maximum world dimension. */
export function createImportedModel(id, { size = 6, castShadow = true, receiveShadow = true } = {}) {
  const prototype = prototypes.get(id);
  if (!prototype) return null;
  const group = new THREE.Group();
  const model = prototype.clone(true);
  model.scale.multiplyScalar(size);
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = castShadow;
    object.receiveShadow = receiveShadow;
  });
  group.add(model);
  group.userData.assetId = id;
  group.userData.voxelCount = metrics.get(id).voxels;
  group.userData.triangles = metrics.get(id).triangles;
  group.name = IMPORTED_ASSETS[id].name;
  return group;
}

export function getImportedAssetStats() {
  return [...metrics.values()].map((entry) => ({ ...entry, dimensions: [...entry.dimensions] }));
}
