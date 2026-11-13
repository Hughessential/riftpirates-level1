import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const out = '/tmp/riftpirates-cursor';
await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    window.WebSocket = class extends EventTarget { readyState = 0; send() {} close() {} };
    localStorage.setItem('riftpirates-level1-v1', JSON.stringify({ pilotName: 'COMET', pilotNameConfirmed: true }));
  });
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled);
  await page.evaluate(() => { RIFT.renderFrame(.1); RIFT.update = () => {}; });
  const sweep = async () => {
    await page.mouse.move(180, 420);
    for (let i = 0; i <= 35; i++) await page.mouse.move(180 + i * 22, 420 + Math.sin(i / 7) * 90);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const state = () => page.evaluate(() => {
    const layer = document.getElementById('menuCursorLayer'), star = document.getElementById('menuCursorStar');
    const canvas = document.getElementById('menuCursorTrail'), rect = layer.getBoundingClientRect();
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0, minX = Infinity, maxX = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) {
      colored++;
      const x = ((i - 3) / 4) % canvas.width;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    }
    const sr = star.getBoundingClientRect();
    return { visible: !layer.hidden && star.classList.contains('visible'), parent: layer.parentElement.id || 'body',
      children: layer.childElementCount, width: rect.width, height: rect.height, x: rect.x, y: rect.y,
      canvasWidth: canvas.width, canvasPixels: canvas.width * canvas.height, span: (maxX - minX) / (canvas.width / innerWidth), colored,
      pointer: getComputedStyle(layer).pointerEvents,
      intercepted: document.elementFromPoint(sr.x + 11, sr.y + 11)?.closest('#menuCursorLayer') !== null };
  });
  await sweep();
  let s = await state();
  assert.ok(s.visible && s.colored > 1000 && s.span > 400, JSON.stringify(s));
  assert.equal(s.children, 2); assert.equal(s.canvasWidth, 2160, 'Decoration DPR is capped independently of game rendering');
  assert.equal(s.pointer, 'none'); assert.equal(s.intercepted, false);
  await page.screenshot({ path: `${out}/title-trail.png` });
  await page.setViewport({ width: 3840, height: 2160, deviceScaleFactor: 2 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // Send a single continuous sweep in browser time: CDP round-trips under
  // software-rendered 4K can otherwise outlast the intentional 1.8s tail.
  await page.evaluate(() => {
    for (let i = 0; i <= 35; i++) document.dispatchEvent(new PointerEvent('pointermove', {
      pointerType: 'mouse', clientX: 180 + i * 22, clientY: 420 + Math.sin(i / 7) * 90,
    }));
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  s = await state();
  assert.ok(s.canvasPixels <= 3_005_000, '4K cursor surface remains below three million backing pixels');
  assert.ok(s.visible && s.colored > 100 && s.span > 400, JSON.stringify(s));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  await page.click('#shipSelectBtn');
  await sweep(); s = await state();
  assert.equal(s.parent, 'shipHangarDialog'); assert.ok(s.visible && s.span > 400);
  assert.deepEqual([s.x, s.y, s.width, s.height], [0, 0, 1440, 900], 'Dialog trail stays in full viewport coordinates');
  await page.screenshot({ path: `${out}/hangar-trail.png` });
  await page.click('.hangarPilotIdentity');
  await sweep(); s = await state();
  assert.equal(s.parent, 'pilotIdentityDialog'); assert.ok(s.visible && s.colored > 1000);
  await page.click('#pilotNameClose');
  assert.equal((await state()).parent, 'shipHangarDialog', 'Closing nested menu restores its previous layer');
  await page.click('#hangarClose');
  await page.click('#controllerSettingsBtn');
  await sweep(); s = await state();
  assert.equal(s.parent, 'controllerSettings'); assert.ok(s.visible && s.colored > 1000);
  await page.evaluate(() => RIFT.controllerMenus.closeSettings());
  await page.click('#pilotIdentityBtn');
  await page.evaluate(() => {
    RIFT.controllerMenus.searchField = document.getElementById('pilotNameInput');
    RIFT.controllerMenus.keyboard.showModal();
  });
  await sweep(); s = await state();
  assert.equal(s.parent, 'controllerKeyboard'); assert.ok(s.visible);
  await page.evaluate(() => { RIFT.controllerMenus.closeKeyboard(); RIFT.pilotIdentity.close(); });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await sweep(); s = await state();
  assert.equal(s.visible, true); assert.equal(s.colored, 0, 'Reduced motion keeps the star without a moving tail');
  assert.equal(await page.$eval('#menuCursorStar svg', el => getComputedStyle(el).animationName), 'none');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await sweep();
  await page.click('#launchBtn');
  s = await state();
  assert.equal(s.visible, false); assert.equal(s.colored, 0, 'Gameplay clears the menu-only decoration');
  await page.evaluate(() => { RIFT.quitRun(); document.getElementById('toTitleBtn').click(); });
  await sweep(); assert.equal((await state()).visible, true);
  await page.evaluate(() => dispatchEvent(new Event('blur')));
  assert.equal((await state()).visible, false);
  assert.deepEqual(errors, []);
  console.log('PASS: long bounded shimmer trail, DPR cap, pointer transparency, title and four modal layers, nested return, reduced motion, launch/return and blur cleanup.');
  console.log('Screenshots:', out);
} finally { await browser.close(); }
