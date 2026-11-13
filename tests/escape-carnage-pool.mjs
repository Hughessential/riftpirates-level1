import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EscapeCarnage, CARNAGE_BUDGET } from '../src/encounters/EscapeCarnage.js';
import { escapeIntensity } from '../src/config/escapeIntensity.js';

const escape = { progress: 0, elapsed: 0, speed: 50,
  get intensity() { return escapeIntensity(this.progress, this.elapsed); } };
const game = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), camera3: { shake() {} } };
const effects = new EscapeCarnage(game, escape);
const meshCount = effects.root.children.length;
let opening, ending;
for (let frame = 0; frame < 130 * 60; frame++) {
  escape.elapsed = frame / 60; escape.progress = escape.elapsed / 130;
  effects.update(1 / 60);
  if (frame === 10 * 60) opening = effects.snapshot();
  if (frame === 120 * 60) ending = effects.snapshot();
  assert.equal(effects.root.children.length, meshCount, 'Continuous destruction never creates scene objects');
  assert.ok(effects.debrisMesh.count <= CARNAGE_BUDGET.debris);
  assert.ok(effects.haloMesh.count <= CARNAGE_BUDGET.blasts);
}
assert.ok(ending.fleetCount > opening.fleetCount * 2, 'The distant fleet grows substantially through the route');
assert.ok(ending.shotCount > opening.shotCount * 2, 'Peripheral crossfire escalates with the actual phase');
assert.ok(ending.totalCapitalBreaks >= 20, 'Authored capital ships really disintegrate into pooled destruction');
assert.ok(ending.totalExplosions >= 200, 'The phase supports continuous layered chain blasts');
assert.ok(effects.debris.filter(p => p.live && !p.local).every(p => Math.abs(p.x) >= 28),
  'Decorative debris cannot drift into the mandatory escape lane');
for (const mesh of [effects.capitalMesh, effects.fleetMesh, effects.debrisMesh, effects.ringMesh]) {
  assert.ok([...mesh.instanceMatrix.array].every(Number.isFinite), 'High-density instance transforms remain finite');
}
const frozen = JSON.stringify(effects.snapshot());
const matrices = effects.debrisMesh.instanceMatrix.array.slice();
effects.update(0);
assert.equal(JSON.stringify(effects.snapshot()), frozen);
assert.deepEqual(effects.debrisMesh.instanceMatrix.array, matrices, 'A held simulation cannot advance destruction');
const total = effects.totalExplosions;
effects.onEnemyDestroyed({ x: 0, y: 2, z: -40 });
assert.equal(effects.totalExplosions, total + 1, 'Real kills receive a local detonation without new damage');
effects.dispose(); effects.dispose();
assert.equal(game.scene.children.length, 0);
assert.equal(effects.snapshot().active, false);
assert.equal(effects.snapshot().blastCount, 0);
assert.equal(effects.snapshot().debrisCount, 0);
console.log('PASS: escalating capital destruction, distant fleets/crossfire, fixed pools, finite geometry, clear lane, kill feedback, pause and disposal.');
