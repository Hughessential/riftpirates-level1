import assert from 'node:assert/strict';
import * as THREE from 'three';
import { UltraUltimateEffect } from '../src/effects/UltraUltimateEffect.js';
import { BlackSurfacePass, BLACK_SURFACE_LAYER } from '../src/render/BlackSurfacePass.js';

const scene = new THREE.Scene();
const group = new THREE.Group(), hull = new THREE.Group();
const geometry = new THREE.BoxGeometry(2, 1, 4);
const original = new THREE.MeshStandardMaterial({ color: '#32579b', metalness: .4 });
const trim = new THREE.MeshBasicMaterial({ color: '#18eece' });
const arrayMaterial = [original, trim];
const body = new THREE.Mesh(geometry, original);
const arrayHull = new THREE.Mesh(geometry, arrayMaterial);
arrayHull.position.set(2, 0, 0);
body.layers.enable(3); arrayHull.layers.enable(4);
hull.add(body, arrayHull); group.add(hull); scene.add(group);
// This separate mesh deliberately shares the hull's material and geometry.
const unrelated = new THREE.Mesh(geometry, original); scene.add(unrelated);
const player = { scene, group, hull, vx: 0, vy: 0, boosting: false };
const effect = new UltraUltimateEffect(player, {});
const originalColor = original.color.clone();
const originalMasks = [body.layers.mask, arrayHull.layers.mask];

function resourceIdentity() {
  const objects = [], geometries = new Set(), materials = new Set();
  scene.traverse(object => {
    objects.push(object.uuid);
    if (object.geometry) geometries.add(object.geometry.uuid);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      materials.add(material.uuid);
    }
  });
  return { objects: objects.sort(), geometries: [...geometries].sort(), materials: [...materials].sort() };
}

effect.activate();
assert.equal(body.material, effect.armorMaterial);
assert.equal(arrayHull.material[0], effect.armorMaterial);
assert.equal(arrayHull.material[1], trim, 'Non-armor material slots retain their existing appearance');
assert.equal(unrelated.material, original, 'Shared materials on unrelated objects remain intact');
assert.deepEqual(original.color.toArray(), originalColor.toArray());
assert.equal(body.geometry, geometry, 'The actual hull geometry is preserved');
assert.equal(arrayHull.position.x, 2, 'Coating does not change ship transforms');
assert.ok(body.layers.isEnabled(BLACK_SURFACE_LAYER));
assert.ok(body.layers.isEnabled(3) && arrayHull.layers.isEnabled(4), 'Existing rendering layers survive activation');
effect.expire();
assert.equal(body.material, original);
assert.equal(arrayHull.material, arrayMaterial, 'The exact original multi-material array is restored');
assert.deepEqual([body.layers.mask, arrayHull.layers.mask], originalMasks);

effect.activate();
const newerBuffMaterial = new THREE.MeshPhysicalMaterial({ color: '#ffdd55' });
body.material = newerBuffMaterial;
body.layers.enable(5);
effect.expire();
assert.equal(body.material, newerBuffMaterial, 'Expiration never overwrites a newer material owner');
assert.deepEqual([body.layers.mask, arrayHull.layers.mask], [originalMasks[0] | (1 << 5), originalMasks[1]],
  'Expiration removes only its own layer bit and preserves a newer effect\'s layers');
body.layers.disable(5);
body.material = original;

// Regression: a faded wake used to freeze for the entire cooldown, then reappear
// at the former ship position on the next activation.
effect.cancel(); effect.activate(); effect.update(.1, .1);
assert.ok(effect.wakeParticles.some(particle => particle.life > 0), 'The first activation emits a real pooled wake');
effect.expire();
for (let i = 0; i < 60 * 60; i++) effect.update(1 / 60, (i + 1) / 60);
assert.equal(effect.fade, 0);
group.position.x = 20;
effect.activate();
assert.equal(effect.wakeParticles.filter(particle => particle.life > 0).length, 0,
  'Reactivation after a full cooldown cannot resurrect the previous wake');
assert.equal(effect.wakeRoot.visible, false, 'No old world-space trail flashes on the activation frame');
effect.update(.1, 60.1);
assert.ok(effect.wakeParticles.some(particle => particle.life > 0 && particle.x > 10),
  'The next wake originates at the current ship position');
effect.cancel();
assert.equal(effect.wakeParticles.filter(particle => particle.life > 0).length, 0);
assert.equal(effect.root.visible, false);
assert.equal(effect.wakeRoot.visible, false);
const matrix = new THREE.Matrix4();
for (const mesh of [effect.wake, effect.wakeGlow]) {
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    assert.equal(matrix.elements[0], 0, 'Cancel removes the pooled wake from rendering');
  }
}

const restingResources = resourceIdentity();
const pools = {
  bolts: effect.bolts.length,
  particles: effect.wakeParticles.length,
  matrices: effect.cores.instanceMatrix.array,
  wakeMatrices: effect.wake.instanceMatrix.array,
};
const target = new THREE.Vector3(7, 3, -35);
for (let cycle = 0; cycle < 20; cycle++) {
  effect.activate();
  for (let hit = 0; hit < 40; hit++) effect.strike(target);
  player.boosting = cycle % 2 === 0;
  effect.update(.05, cycle, { reducedFlashing: cycle % 2 });
  effect.cancel();
}
assert.equal(effect.bolts.length, pools.bolts, 'Repeated strikes reuse the bounded bolt bank');
assert.equal(effect.wakeParticles.length, pools.particles, 'Boost trails reuse the bounded particle bank');
assert.equal(effect.cores.instanceMatrix.array, pools.matrices);
assert.equal(effect.wake.instanceMatrix.array, pools.wakeMatrices);
assert.deepEqual(resourceIdentity(), restingResources, 'Repeated activations add no scene objects, geometries, or materials');
assert.deepEqual([body.layers.mask, arrayHull.layers.mask], originalMasks);
assert.equal(body.material, original);
assert.equal(arrayHull.material, arrayMaterial);

// The pass must draw into the bloom input's existing depth attachment and then
// restore scene/camera/renderer state so ordinary rendering is unaffected.
const passScene = new THREE.Scene();
passScene.background = new THREE.Color('#190d30');
const background = passScene.background;
const light = new THREE.DirectionalLight(); passScene.add(light);
const camera = new THREE.PerspectiveCamera(); camera.layers.enable(2);
const cameraMask = camera.layers.mask;
const pass = new BlackSurfacePass(passScene, camera);
assert.equal(pass.enabled, false, 'Ordinary gameplay does not execute the private surface pass');
assert.equal(pass.needsSwap, false);
let rendered = 0, targetBuffer;
const renderer = {
  autoClear: true,
  shadowMap: { autoUpdate: true },
  setRenderTarget(buffer) { targetBuffer = buffer; },
  clear() { assert.fail('The restoration pass must preserve existing depth and color'); },
  clearDepth() { assert.fail('The restoration pass must preserve enemy occlusion depth'); },
  render(currentScene, currentCamera) {
    rendered++;
    assert.equal(currentScene, passScene);
    assert.equal(currentCamera, camera);
    assert.equal(currentScene.background, null, 'Scene background must not force an implicit clear');
    assert.equal(currentCamera.layers.mask, 1 << BLACK_SURFACE_LAYER);
    assert.equal(this.autoClear, false);
    assert.equal(this.shadowMap.autoUpdate, false, 'The surface pass reuses the original shadow map');
  },
};
const readBuffer = {}, writeBuffer = {};
pass.render(renderer, writeBuffer, readBuffer);
assert.equal(rendered, 1);
assert.equal(targetBuffer, readBuffer);
assert.equal(camera.layers.mask, cameraMask);
assert.equal(passScene.background, background);
assert.equal(renderer.shadowMap.autoUpdate, true);
assert.equal(renderer.autoClear, true);

console.log('Ultra effects PASS: no stale wake after cooldown, isolated materials and layer restoration, newer material ownership, bounded pools, and depth-preserving pass state.');
