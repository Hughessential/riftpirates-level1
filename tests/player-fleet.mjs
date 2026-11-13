import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { PLAYER_SHIPS, registerPlayerFleet, createPlayerShip, isPlayerShipId, getPlayerFleetStats } from '../src/render/PlayerFleet.js';

assert.equal(createPlayerShip('rift-talon'), null, 'Loading failure permits the existing procedural fallback');
assert.equal(isPlayerShipId('unknown'), false);
assert.equal(PLAYER_SHIPS.length, 6);
assert.equal(new Set(PLAYER_SHIPS.map(({ id }) => id)).size, 6);
const file = readFileSync(new URL('../assets/voxels/player-fleet/spaceships.vox', import.meta.url));
registerPlayerFleet(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const geometrySet = new Set();
for (const ship of PLAYER_SHIPS) {
  assert.ok(isPlayerShipId(ship.id));
  assert.deepEqual(Object.keys(ship).sort(), ['id', 'name', 'tagline'], 'Hull metadata must not alter gameplay stats');
  const model = createPlayerShip(ship.id);
  const clone = createPlayerShip(ship.id, { size: 8, castShadow: false });
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(Math.max(size.x, size.y, size.z) - 5.8) < 1e-5, 'All hulls use the same visual envelope');
  assert.ok(bounds.getCenter(new THREE.Vector3()).length() < 1e-5, 'Centering must not inherit source scene offsets');
  const mesh = model.children[0];
  geometrySet.add(mesh.geometry);
  assert.equal(mesh.geometry, clone.children[0].geometry, 'Preview and player share cached geometry');
  assert.equal(mesh.material, clone.children[0].material, 'Preview and player share cached material');
  assert.equal(model.userData.shipId, ship.id);
  assert.equal(model.userData.cosmetic, true);
  assert.equal(mesh.castShadow, true);
  assert.equal(clone.children[0].castShadow, false);
  const colors = mesh.geometry.getAttribute('color');
  const positions = mesh.geometry.getAttribute('position');
  const emission = mesh.geometry.getAttribute('fleetEmission');
  let engineZ = 0, engines = 0;
  for (let i = 0; i < colors.count; i++) {
    assert.ok(Number.isFinite(colors.getX(i) + positions.getZ(i)));
    // Magenta engine faces must be aft, while pale cyan lamps stay separate.
    if (emission.getX(i) > 1 && emission.getY(i) < 0.3) {
      engineZ += positions.getZ(i); engines++;
    }
  }
  assert.ok(engines > 0, 'Each source ship has glowing engine cells');
  assert.ok(engineZ / engines > 0, 'Engine aft direction must be +Z; player nose is -Z');
}
assert.equal(geometrySet.size, 6, 'Each choice is a distinct supplied hull');
assert.ok(getPlayerFleetStats().every(({ triangles, emissiveVertices }) => triangles > 1000 && emissiveVertices > 0));
console.log('Player fleet: six authored hulls, pirate palette, aft engines, shared caches, equal size and cosmetic-only metadata passed.');
console.table(getPlayerFleetStats().map(({ id, voxels, triangles }) => ({ id, voxels, triangles })));
