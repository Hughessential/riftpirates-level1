import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EngineTrail, ENGINE_TRAIL_PROFILE } from '../src/effects/EngineTrail.js';
import { Player } from '../src/player/Player.js';
import { P } from '../src/core/Palette.js';

const makeTrailFixture = boosting => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, .1, 200);
  camera.position.set(0, 4.6, 11);
  camera.lookAt(0, 1, -24);
  camera.updateMatrixWorld(true);
  const group = new THREE.Group();
  const engines = [-.48, 0, .48].map(x => {
    const engine = new THREE.Object3D();
    engine.position.set(x, -.32, 2.4);
    group.add(engine);
    return engine;
  });
  scene.add(group);
  const player = { alive: true, boosting, vx: 0, vy: 0, group, engines };
  const trail = new EngineTrail(scene);
  for (let i = 0; i < 60; i++) trail.update(1 / 60, player, camera);
  const active = trail.particles.filter(p => p.life > 0);
  return {
    trail,
    active,
    length: Math.max(...active.map(p => p.z)) - Math.min(...active.map(p => p.z)),
    meanMix: active.reduce((sum, p) => sum + p.boostMix, 0) / active.length,
  };
};

assert.ok(ENGINE_TRAIL_PROFILE.normal.emission < ENGINE_TRAIL_PROFILE.boost.emission / 4,
  'Normal thrust uses a substantially lower emission rate');
assert.ok(ENGINE_TRAIL_PROFILE.normal.lifeMax < ENGINE_TRAIL_PROFILE.boost.lifeMin / 2,
  'Normal cubes expire before the long boost wake');
assert.ok(ENGINE_TRAIL_PROFILE.normal.velocity < ENGINE_TRAIL_PROFILE.boost.velocity / 2,
  'Boost exhaust travels aft much faster');

const normal = makeTrailFixture(false);
const boost = makeTrailFixture(true);
assert.ok(normal.active.length > 0 && boost.active.length > normal.active.length * 4,
  'The pooled boost plume is visibly denser than normal thrust');
assert.ok(boost.length > normal.length * 2.5, 'Boost produces a much longer world-space trail');
assert.ok(normal.meanMix < .05 && boost.meanMix > .8, 'New particles retain their correct cyan or ignition palette state');
assert.equal(normal.trail.particles.length, boost.trail.particles.length, 'Both states retain the fixed particle budget');

const fx = { explode() {}, jet() {} };
const player = new Player(new THREE.Scene(), fx);
assert.equal(player.reticle.children.some(child => child.isSprite), false,
  'The reticle contains no additive glow sprites');
assert.ok(player.reticle.children.every(child => child.material?.blending === THREE.NormalBlending),
  'Every reticle element uses flat normal blending');
player.setReticleActive(true);
assert.equal(player.reticle.visible, true, 'The flight reticle can remain visible without aim input');
player.reticle.scale.setScalar(1.3);
player.update(1 / 60, { hazards: [], time: 1 });
assert.equal(player.reticle.scale.x, 1, 'The reticle never idle-pulses');
player.reticleLock = true;
player.update(1 / 60, { hazards: [], time: 2 });
assert.equal(player.reticleRing.material.color.getHex(), new THREE.Color(P.gold).getHex(),
  'Lock-on uses the restrained flat gold confirmation');
player.setReticleActive(false);
assert.equal(player.reticle.visible, false, 'Non-flight screens can hide the reticle immediately');

console.log('PASS: compact cyan normal exhaust, long hot boost wake, bounded pooling, and an always-ready flat reticle.');
