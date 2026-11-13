import { launchRun } from './helpers/start-run.mjs';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { displayMetrics } from '../src/render/DisplayLayout.js';
import { ScrapSystem, LOOT_DENOMINATIONS } from '../src/systems/ScrapSystem.js';
import { augmentDelta } from '../src/ui/AugmentFeedback.js';
import { UpgradeSystem, UPGRADES } from '../src/systems/UpgradeSystem.js';
import * as THREE from 'three';

for (const [w, h, d] of [[1280, 800, 2], [2560, 1440, 1], [3840, 2160, 2], [5120, 1440, 1]]) {
  const m = displayMetrics(w, h, d);
  assert.equal(m.aspect, w / h);
  assert.ok(w * h * m.pixelRatio ** 2 <= 8500001, 'Render targets stay inside the pixel budget');
}
const g = { player: { x: 0, y: 0, alive: true, stats: { scrapRadius: 0, scrapMultiplier: 1 } },
  camera: new THREE.PerspectiveCamera(), heat: { onScrapCollected() {} }, score: { add() {} } };
const loot = new ScrapSystem(new THREE.Scene(), g);
loot.burst(0, 0, -20, 20, 0);
assert.deepEqual(new Set(loot.pool.filter(p => p.active).map(p => p.tint)), new Set([LOOT_DENOMINATIONS[0].color]));
assert.equal(loot.pool.filter(p => p.active).reduce((n, p) => n + p.value, 0), 20);
loot.update(0, 0);
assert.equal(loot.halos.count, 10);
for (const p of loot.pool.filter(p => p.active)) p.x = p.y = p.z = 0;
loot.update(0, 0);
assert.equal(loot.collected, 20, 'Denomination shards preserve their real pickup value');
assert.equal(loot.halos.count, 0);
loot.burst(0, 0, -20, 800, 0); loot.update(0, 0); loot.reset();
assert.equal(loot.halos.count, 0);
assert.ok(loot.pool.every(p => !p.active && !p.sp.visible));
const upgrades = new UpgradeSystem({ player: { heal() {}, stats: {}, boost: 0 } });
for (const [id, upgrade] of Object.entries(UPGRADES)) {
  const before = JSON.stringify(upgrades.stats);
  const text = augmentDelta({ id, ...upgrade }, upgrades.stats, 1);
  assert.match(text, /→/); assert.ok(!/NaN|undefined/.test(text), `${id} has real display values`);
  assert.equal(JSON.stringify(upgrades.stats), before, 'Card previews do not apply upgrades');
}
assert.match(augmentDelta({ id: 'hotshot', ...UPGRADES.hotshot }, upgrades.stats, 1), /18 → 22\.5/);

mkdirSync('shots', { recursive: true });
const errors = [];
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 240000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        if (protocols === 'vite-hmr') this.addEventListener('message', event => {
          const type = JSON.parse(event.data).type;
          if (type === 'update' || type === 'full-reload') event.stopImmediatePropagation();
        });
      }
    };
  });
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const g = window.RIFT; window.testRender = g.renderFrame.bind(g);
    g.update = () => {}; g.renderFrame = () => {};
  });
  for (const [width, height, dpr] of [[1440, 900, 1], [2560, 1280, 1], [2560, 1440, 1], [3840, 2160, 1], [3440, 1440, 1], [1440, 900, 2], [1440, 900, 1]]) {
    await page.setViewport({ width, height, deviceScaleFactor: dpr });
    // Exercise the real render entry point as the normal RAF loop would; this
    // also verifies the density fallback when a browser omits media events.
    await page.evaluate(() => window.testRender(0));
    await page.waitForFunction(d => window.RIFT.display.width === innerWidth && window.RIFT.display.height === innerHeight &&
      Math.abs(window.RIFT.renderer.getPixelRatio() - Math.min(d, 1.75, Math.sqrt(8500000 / (innerWidth * innerHeight)))) < .001, { timeout: 10000 }, dpr);
    const bounds = await page.evaluate(() => {
      const g = window.RIFT;
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      return { main: rect('.menuMain'), footer: rect('.menuFooter'), ship: rect('#shipSelectBtn'),
        launch: rect('#launchBtn'), logo: rect('.voxelLogo'), canvas: rect('#gameCanvas'),
        aspect: g.camera.aspect, canvasW: g.renderer.domElement.width, canvasH: g.renderer.domElement.height,
        targetW: g.presentation.composer.readBuffer.width, targetH: g.presentation.composer.readBuffer.height };
    });
    assert.equal(bounds.aspect, width / height);
    assert.equal(bounds.canvas.width, width); assert.equal(bounds.canvas.height, height);
    assert.ok(Math.abs(bounds.canvasW / bounds.canvasH - width / height) < .002);
    assert.equal(bounds.canvasW, bounds.targetW); assert.equal(bounds.canvasH, bounds.targetH);
    assert.ok(bounds.main.bottom < bounds.footer.y, `Main/footer clearance at ${width}×${height}`);
    assert.ok(bounds.ship.bottom < bounds.footer.y && bounds.ship.right <= width);
    assert.ok(bounds.launch.right <= width && bounds.launch.y > 0);
    if (width >= 2560) assert.ok(bounds.logo.width > 1000, 'Title grows proportionally on large displays');
    if ([2560, 3440].includes(width)) {
      await page.evaluate(() => window.testRender(0));
      await page.screenshot({ path: `shots/display-${width}x${height}.png` });
    }
    console.log(`${width}×${height} @${dpr}x: camera, canvas, postprocessing and menu aligned`);
  }
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await launchRun(page);
  await page.evaluate(() => {
    const g = window.RIFT; g.director.go('TRAVERSAL_1'); g.director.clearPresentation();
    g.enemies.clear(); g.clearHazards(); g.scrap.reset();
    g.camera3.reset(); g.camera3.update(.1, g.player, false); g.scrap.burst(0, 2, -15, 40, 5); g.scrap.update(.1, 0);
    g.hud.update(.1); window.testRender(.1);
  });
  await page.screenshot({ path: 'shots/loot-palette.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: external display aspect, density changes, proportionate menu, denomination loot/value/reset, real augment previews.');
} finally { await browser.close(); }
