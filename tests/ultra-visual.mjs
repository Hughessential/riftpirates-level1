import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

// Real WebGL validation; optional deterministic motion capture for visual review.
const capture = process.env.ULTRA_VIDEO === '1';
const output = fileURLToPath(new URL('../shots/ultra-transformation/', import.meta.url));
mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error' && /THREE|shader|WebGL/i.test(msg.text())) errors.push(msg.text()); });
  await page.setViewport({ width: 960, height: 600 });
  await page.evaluateOnNewDocument(() => {
    window.WebSocket = class extends EventTarget { send() {} close() {} };
    localStorage.setItem('riftpirates-level1-v1', JSON.stringify({
      pilotName: 'ULTRA VISUAL', pilotNameConfirmed: true, tutorialComplete: true, music: 0, sfx: 0,
    }));
  });
  await page.goto(process.env.RIFT_TEST_URL || 'http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await page.evaluate(async () => {
    const g = RIFT;
    window.__ultraStep = g.update.bind(g);
    window.__ultraRender = g.renderFrame.bind(g);
    g.update = () => {}; g.renderFrame = () => {};
    g.testing.enter(); g.testing.setPanelOpen(false);
    g.player.frozen = false;
    window.__ships = (await import('/src/render/PlayerFleet.js')).PLAYER_SHIPS;
    window.__input = (await import('/src/core/Input.js')).Input;
    window.__advanceVisual = target => {
      while (g.ultraUltimate.presentationTime + 1e-7 < target) {
        __ultraStep(Math.min(1 / 60, target - g.ultraUltimate.presentationTime));
      }
      __ultraRender(1 / 60);
    };
    for (let i = 0; i < 120; i++) __ultraStep(1 / 60);
    g.ultraUltimate.activate();
  });
  const states = [];
  for (const time of [.27, 4.8, 5.49, 10.8, 12.2, 13.5, 14.07, 15.01, 25]) {
    states.push(await page.evaluate(time => {
      __advanceVisual(time);
      const u = RIFT.ultraUltimate;
      return { time: u.presentationTime, phase: u.effect.phase, armor: u.effect.armorProgress,
        sparkles: u.effect.sparkleCount, geometries: RIFT.renderer.info.memory.geometries };
    }, time));
    await page.screenshot({ path: `${output}phase-${time}.png` });
  }
  assert.equal(states.at(-1).armor, 1);
  assert.equal(states.at(-1).sparkles, 1);
  // Compile and render both intermediate and complete shaders on representative hulls.
  for (const [width, height] of process.env.ULTRA_KEYFRAMES_ONLY === '1' ? [] : [[960, 600], [600, 900]]) {
    await page.setViewport({ width, height });
    for (const index of [0, 2, 5]) {
      for (const reduced of [0, 1]) {
        await page.evaluate(({ index, reduced }) => {
          const g = RIFT;
          g.player.setShip(__ships[index].id);
          g.testing.setTuning('ultraReducedFlashing', reduced);
          g.ultraUltimate.activate(); __advanceVisual(13.5);
        }, { index, reduced });
        await page.screenshot({ path: `${output}ship-${index}-${width}-${reduced}.png` });
        await page.evaluate(() => __advanceVisual(15.1));
      }
    }
  }
  await page.setViewport({ width: 960, height: 600 });
  if (capture) {
    await page.evaluate(() => {
      RIFT.player.setShip(__ships[0].id); RIFT.testing.setTuning('ultraReducedFlashing', 0);
      RIFT.ultraUltimate.activate();
    });
    for (let frame = 0; frame <= 16 * 12; frame++) {
      await page.evaluate(time => __advanceVisual(time), frame / 12);
      await page.screenshot({ path: `${output}motion-${String(frame).padStart(4, '0')}.png` });
    }
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '12', '-i', `${output}motion-%04d.png`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `${output}transformation.mp4`]);
    await page.evaluate(() => {
      const p = RIFT.player;
      p.x = -5; p.vx = p.vy = 0; p.rollT = p.rollCd = 0; p.boost = p.stats.boostCapacity;
      __input._rollQueue = 1;
    });
    for (let frame = 0; frame < 45; frame++) {
      await page.evaluate(() => { __ultraStep(1 / 60); __ultraRender(1 / 60); });
      await page.screenshot({ path: `${output}teleport-${String(frame).padStart(3, '0')}.png` });
    }
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '60', '-i', `${output}teleport-%03d.png`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `${output}teleport.mp4`]);
  }
  writeFileSync(`${output}states.json`, JSON.stringify({ states, errors }, null, 2));
  assert.deepEqual(errors, [], 'No runtime or WebGL shader errors');
  console.log(`PASS: real WebGL phase captures${process.env.ULTRA_KEYFRAMES_ONLY === '1' ? '' : ', three hulls, two viewports and reduced flashing'}. Captures: ${output}`);
} finally { await browser.close(); }
