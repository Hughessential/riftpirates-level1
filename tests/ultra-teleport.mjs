import assert from 'node:assert/strict';
import * as THREE from 'three';
import puppeteer from 'puppeteer-core';
import { UltraTeleport } from '../src/player/UltraTeleport.js';
import { EngineTrail } from '../src/effects/EngineTrail.js';
import { launchRun } from './helpers/start-run.mjs';

// Camera-frustum fitting is independent of the world arena's width. Check the
// entire rolling hull, including its near corners, at wide and portrait aspects.
const finder = new UltraTeleport();
for (const aspect of [.7, 1.6, 2.4]) {
  for (const originX of [-12, 0, 12]) {
    for (const direction of [-1, 1]) {
      const camera = new THREE.PerspectiveCamera(68, aspect, .1, 500);
      camera.position.set(originX * .4, 7.3, 16);
      camera.lookAt(originX * .6, 1.55, -16);
      camera.updateMatrixWorld();
      const group = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 5.8), new THREE.MeshBasicMaterial());
      group.add(hull); group.position.set(originX, 1, 0); group.rotation.z = 2.2;
      const player = { x: originX, y: 1, group, hull };
      const side = finder.oppositeSide(player, camera, direction);
      assert.equal(side, originX === 0 ? direction : -Math.sign(originX));
      const destination = finder.destination(player, camera, { minX: -22, maxX: 22 }, side);
      assert.ok(destination >= -22 && destination <= 22);
      group.position.x = destination; group.updateWorldMatrix(true, true);
      assert.equal(Math.sign(new THREE.Vector3(destination, 1, 0).project(camera).x), side);
      for (const rotation of [0, 1, 2, 3, 4, 5, 6]) {
        group.rotation.z = rotation; group.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(hull);
        for (const x of [bounds.min.x, bounds.max.x]) {
          for (const y of [bounds.min.y, bounds.max.y]) {
            for (const z of [bounds.min.z, bounds.max.z]) {
              assert.ok(Math.abs(new THREE.Vector3(x, y, z).project(camera).x) <= 1,
                `Hull fits at aspect ${aspect}, origin ${originX}, rotation ${rotation}`);
            }
          }
        }
      }
      hull.geometry.dispose(); hull.material.dispose();
    }
  }
}

{
  const scene = new THREE.Scene(), group = new THREE.Group();
  scene.add(group);
  const engines = Array.from({ length: 3 }, () => new THREE.Object3D());
  group.add(...engines);
  const player = { group, engines, alive: true, boosting: false, braking: false, vx: 0, vy: 0 };
  const camera = new THREE.PerspectiveCamera(68, 1.6, .1, 500);
  camera.position.z = 16;
  const exhaust = new EngineTrail(scene);
  exhaust.update(.1, player, camera);
  const residue = exhaust.particles.filter(p => p.life).length;
  group.position.x = 15;
  exhaust.breakTrail(); exhaust.update(.1, player, camera);
  const live = exhaust.particles.filter(p => p.life);
  assert.ok(live.length > residue && live.some(p => p.x < 1), 'Old exhaust remains at the departure position');
  assert.ok(live.some(p => p.x > 14), 'New exhaust originates at the arrival');
  assert.ok(live.every(p => p.x < 1 || p.x > 14), 'No interpolated exhaust bridge across the screen');
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    window.WebSocket = class extends EventTarget { send() {} close() {} };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [] });
    localStorage.setItem('riftpirates-level1-v1', JSON.stringify({
      pilotName: 'ULTRA ROLL TEST', pilotNameConfirmed: true, tutorialComplete: true, music: 0, sfx: 0,
    }));
  });
  await page.goto(process.env.RIFT_TEST_URL || 'http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await launchRun(page);
  await page.evaluate(async () => {
    const g = RIFT;
    g.director.go('TESTING'); g.player.frozen = false;
    window.__step = g.update.bind(g); g.update = () => {}; g.renderFrame = () => {};
    window.__input = (await import('/src/core/Input.js')).Input;
    window.__audio = (await import('/src/core/AudioManager.js')).Audio2;
    window.__teleportCues = 0; window.__arrivals = 0;
    const play = __audio.playUltraTeleport.bind(__audio);
    __audio.playUltraTeleport = (...args) => { __teleportCues++; return play(...args); };
    const arrival = g.ultraUltimate.effect.onTeleport.bind(g.ultraUltimate.effect);
    g.ultraUltimate.effect.onTeleport = (...args) => { __arrivals++; return arrival(...args); };
    window.__advance = seconds => { for (let i = 0; i < Math.round(seconds * 100); i++) __step(.01); };
    window.__ready = (x = 0, active = true) => {
      const p = g.player, u = g.ultraUltimate;
      u.reset(); p.rollT = p.rollCd = 0; p.boost = p.stats.boostCapacity;
      p.x = x; p.y = 1; p.vx = p.vy = p.kx = p.ky = 0;
      p.group.position.set(x, 1, 0); p.group.rotation.set(0, 0, 0);
      __input._rollQueue = 0; __input._resetRollTaps();
      g.camera3.reset(); g.camera3.update(10, p, false);
      if (active) u.activate();
      __teleportCues = __arrivals = 0;
    };
    window.__roll = direction => { __input._rollQueue = direction; __step(.01); };
  });

  for (const [width, height] of [[1440, 900], [630, 900]]) {
    await page.setViewport({ width, height });
    for (const [x, dir] of [[-8, -1], [8, 1], [0, -1], [0, 1]]) {
      const result = await page.evaluate(({ x, dir }) => {
        __ready(x); __roll(dir);
        const p = RIFT.player;
        const initial = { x: p.x, boost: p.boost, cooldown: p.rollCd, dir: p.rollDir, timer: p.rollT };
        __advance(.10); const before = { x: p.x, arrivals: __arrivals };
        __advance(.05); const after = { x: p.x, y: p.y, z: p.group.position.z, arrivals: __arrivals, cues: __teleportCues };
        const arrivalX = p.x;
        __advance(.3);
        return { initial, before, after, endX: p.x, arrivalX, arrivals: __arrivals, cues: __teleportCues };
      }, { x, dir });
      assert.equal(result.initial.x, x, 'No lateral dash before the transfer');
      assert.equal(result.initial.boost, 76, 'Exactly one existing roll cost');
      assert.equal(result.initial.cooldown, .7);
      assert.equal(result.initial.dir, dir);
      assert.ok(Math.abs(result.initial.timer - .41) < .0001);
      assert.equal(result.before.x, x);
      assert.equal(result.before.arrivals, 0);
      assert.ok(Math.abs(result.after.x - x) > 2, 'The ship changes screen side in under 180 ms');
      assert.equal(result.after.y, 1); assert.equal(result.after.z, 0);
      assert.equal(result.after.arrivals, 1); assert.equal(result.after.cues, 1);
      assert.equal(result.arrivals, 1); assert.equal(result.cues, 1);
      assert.equal(result.endX, result.arrivalX, 'Remaining spin adds no normal roll displacement');
    }
  }

  const guards = await page.evaluate(() => {
    const p = RIFT.player, u = RIFT.ultraUltimate;
    __ready(-5); p.boost = 0; __roll(1); const empty = [__arrivals, __teleportCues, p.rollT];
    __ready(-5); __roll(1); __roll(-1); __advance(.2); const repeat = [__arrivals, __teleportCues];
    __ready(-5); __roll(1); __advance(.04); u.cancel(); __advance(.5);
    const cancelBefore = [p.x, __arrivals, p.hull.visible, p._teleportPending];
    __ready(-5); __roll(1); __advance(.2); const arrived = p.x; u.cancel(); __advance(.3);
    const cancelAfter = [p.x === arrived, __arrivals, p.hull.visible];
    __ready(0, false); __roll(1); __advance(.2);
    const normal = [p.x > 0 && p.x < 8, __arrivals, __teleportCues];
    __ready(-5); __roll(1); RIFT.togglePause({ showMenu: false }); __advance(.3);
    const pause = [p.x, __arrivals]; RIFT.togglePause({ showMenu: false }); __advance(.2);
    const resume = [__arrivals, __teleportCues];
    return { empty, repeat, cancelBefore, cancelAfter, normal, pause, resume };
  });
  assert.deepEqual(guards.empty, [0, 0, 0]);
  assert.deepEqual(guards.repeat, [1, 1]);
  assert.deepEqual(guards.cancelBefore, [-5, 0, true, false]);
  assert.deepEqual(guards.cancelAfter, [true, 1, true]);
  assert.deepEqual(guards.normal, [true, 0, 0]);
  assert.deepEqual(guards.pause, [-5, 0]);
  assert.deepEqual(guards.resume, [1, 1]);
  const stalled = await page.evaluate(() => {
    __ready(-5); __roll(1);
    __step(.05, .15);
    return { arrivals: __arrivals, x: RIFT.player.x, roll: RIFT.player.rollT,
      presentation: RIFT.ultraUltimate.presentationTime };
  });
  assert.equal(stalled.arrivals, 1, 'A slow frame still transfers within the authored real-time window');
  assert.ok(stalled.x > -5);
  assert.ok(Math.abs(stalled.roll - .36) < 1e-6, 'The simulation roll/protection timer is still capped');
  assert.ok(Math.abs(stalled.presentation - .16) < 1e-6);
  assert.deepEqual(errors, []);
  console.log('Ultra teleport PASS: viewport/hull fit, timing, cost/cooldown, opposite halves/center, one transfer/cue, cancellation, pause and ordinary rolls.');
} finally { await browser.close(); }
