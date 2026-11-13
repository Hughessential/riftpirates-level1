import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { IMPORTED_ASSETS, registerImportedAsset, createImportedModel, getImportedAssetStats } from '../src/render/ImportedAssets.js';
import { EnemySpawner } from '../src/enemies/EnemySpawner.js';

for (const [id, definition] of Object.entries(IMPORTED_ASSETS)) {
  const bytes = fs.readFileSync(new URL(`../assets/voxels/${definition.file}`, import.meta.url));
  const metrics = registerImportedAsset(id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.ok(metrics.voxels > 400);
  assert.ok(metrics.triangles < metrics.voxels * 12, `${id} must omit hidden faces`);
  assert.equal(metrics.meshes, 1, `${id} should cost one hull draw call`);
  const first = createImportedModel(id, { size: 8 });
  const second = createImportedModel(id, { size: 4 });
  const bounds = new THREE.Box3().setFromObject(first);
  const dims = bounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(Math.max(...dims.toArray()) - 8) < 1e-6);
  assert.ok(bounds.getCenter(new THREE.Vector3()).length() < 1e-6, `${id} target pivot must be centered`);
  let geometry;
  first.traverse((object) => { if (object.isMesh) geometry = object.geometry; });
  second.traverse((object) => {
    if (!object.isMesh) return;
    assert.equal(object.geometry, geometry, 'Pooled hull clones share their geometry');
    assert.equal(geometry.getAttribute('voxelEmission').count, geometry.getAttribute('position').count);
  });
}
assert.equal(createImportedModel('missing'), null);
assert.equal(getImportedAssetStats().length, 7);

const shots = [];
const game = {
  targets: [],
  player: { x: 0, y: 3, vx: 0, vy: 0 },
  projectiles: { fireEnemy: (shot) => shots.push(shot) },
  stats: { maxOnscreen: 0 },
};
game.enemies = new EnemySpawner(new THREE.Scene(), game);
for (const type of ['scout', 'gunship', 'heavy', 'shielder', 'elite']) {
  const enemy = game.enemies.spawn(type, 0, 3, -70, { fx: 0, fy: 3, fz: -30 });
  assert.ok(enemy.mesh.userData.assetId, `${type} must use a supplied asset`);
  assert.equal(enemy.target.object3D, enemy.mesh);
  if (type === 'gunship') {
    enemy._shoot(game);
    assert.equal(shots.length, 4, 'Dual Striker has four danger lanes from its paired cannons');
    assert.ok(shots[0].x < shots[2].x && shots[0].tx < shots[2].tx);
    assert.deepEqual(shots.map((shot) => shot.tx), [-7, -2.2, 2.2, 7], 'The volley leaves a readable center gap');
  }
}
// The director may reuse a killed/despawned hull before update prunes it.
const activeCount = game.enemies.active.length;
const retired = game.enemies.active[0];
retired.despawn();
const reused = game.enemies.spawn('scout', 0, 3, -70, { fx: 0, fy: 3, fz: -30 });
assert.equal(reused, retired, 'The inactive pooled hull should be reused');
assert.equal(game.enemies.active.length, activeCount, 'Reusing a listed hull must not duplicate it');
assert.equal(game.enemies.countAlive(), activeCount, 'Pooled reuse must not inflate live counts');
assert.equal(new Set(game.enemies.active).size, activeCount);
const initialPhase = reused.phase;
game.enemies.update(1 / 60);
assert.ok(Math.abs(reused.phase - initialPhase - 1 / 60) < 1e-9, 'Reused enemies must update once per frame');
for (let i = 0; i < 240; i++) game.enemies.update(1 / 60);
for (const enemy of game.enemies.active) {
  assert.ok(Number.isFinite(enemy.x + enemy.y + enemy.z));
  assert.ok(Math.abs(enemy.mesh.rotation.z) <= 0.4, 'Imported craft bank without endless spinning');
}
console.log('Imported assets: seven models, greedy geometry, centered bounds, shared hulls, five enemy roles and twin cannon lanes passed.');
