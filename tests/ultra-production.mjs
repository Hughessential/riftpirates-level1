import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

// Run against `npm run build` + `npm run preview -- --host 127.0.0.1 --port 8001`.
// It must be a built artifact: even localhost production may not authorize ultra.
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 120000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 960, height: 600 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('riftpirates-level1-v1', JSON.stringify({
      pilotName: 'BRIMBY', pilotNameConfirmed: true, tutorialComplete: true, music: 0, sfx: 0,
      ultraAuthorized: true, godHaki: true,
    }));
  });
  await page.goto(process.env.RIFT_PRODUCTION_URL || 'http://127.0.0.1:8001/?lab=1&ultra=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT, { timeout: 120000 });
  const state = await page.evaluate(() => {
    const g = RIFT;
    window.__productionStep = g.update.bind(g);
    g.update = () => {}; g.renderFrame = () => {};
    g.testing.setPanelOpen(false);
    g.hud.update(.1);
    return { authorized: g.ultraUltimate.authorized,
      activation: g.ultraUltimate.activate(), toggle: g.ultraUltimate.toggle(),
      reset: g.ultraUltimate.resetCooldown(), active: g.ultraUltimate.active,
      effectsAllocated: !!g.ultraUltimate.effect,
      hud: !!document.querySelector('#ultraUltimateHud'),
      panel: !!document.querySelector('#labTab-ultra'),
      controls: document.querySelectorAll('[data-tuning-row^="ultra"],[data-ultra-setting]').length,
    };
  });
  assert.deepEqual(state, { authorized: false, activation: false, toggle: false, reset: false,
    active: false, effectsAllocated: false, hud: false, panel: false, controls: 0 });
  await page.keyboard.press('2');
  const input = await page.evaluate(() => { __productionStep(.1); return RIFT.ultraUltimate.active; });
  assert.equal(input, false, 'Key 2, pilot name, saved booleans, query flags and the developer panel grant no production access');
  assert.deepEqual(errors, []);
  console.log('PASS: built production rejects ultra activation/toggle/reset/key2, ignores pilot name/local flags, hides HUD/panel and allocates no ultra effects.');
} finally { await browser.close(); }
