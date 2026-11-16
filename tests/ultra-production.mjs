import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

// Run against `npm run build` + `npm run preview -- --host 127.0.0.1 --port 8001`.
// Production starts locked; only the session Brimby signal enables the Easter egg.
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
  await page.evaluate(() => { RIFT.prepareTitle(); document.getElementById('titleScreen').classList.remove('hidden'); RIFT.testingPanel.globeTarget.click(); });
  await page.keyboard.type('wrong');
  assert.equal(await page.evaluate(() => RIFT.ultraUltimate.authorized), false);
  await page.keyboard.type('brimby');
  assert.deepEqual(await page.evaluate(() => ({ access: RIFT.ultraUltimate.authorized,
    effect: !!RIFT.ultraUltimate.effect, tabs: document.querySelectorAll('#labTab-ultra').length,
    groups: document.querySelectorAll('#labUltraTuning .labTuningCategory').length,
    hud: !!document.getElementById('ultraUltimateHud') })), { access: true, effect: true, tabs: 1, groups: 4, hud: true });
  await page.evaluate(() => { RIFT.testing.enter(); RIFT.testing.setPanelOpen(false); __productionStep(.016); });
  await page.keyboard.press('2');
  await page.evaluate(() => __productionStep(.016));
  assert.equal(await page.evaluate(() => RIFT.ultraUltimate.active), true, 'Signal unlock enables real keyboard activation');
  await page.evaluate(() => { for (let i = 0; i < 31; i++) __productionStep(1); });
  assert.equal(await page.evaluate(() => RIFT.ultraUltimate.active), true, 'Mode remains active beyond thirty seconds');
  await page.keyboard.press('2');
  await page.evaluate(() => __productionStep(.016));
  assert.deepEqual(await page.evaluate(() => ({ active: RIFT.ultraUltimate.active, cooldown: RIFT.ultraUltimate.cooldown })), { active: false, cooldown: 60 });
  await page.evaluate(() => {
    const input = document.querySelector('[data-tuning-number="ultraGlowIntensity"]');
    input.value = '4'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.evaluate(() => RIFT.ultraUltimate.tuning().glowIntensity), 4, 'Dynamically revealed tuning is wired');
  await page.evaluate(() => RIFT.startRun());
  assert.equal(await page.evaluate(() => RIFT.ultraUltimate.authorized), true, 'Unlock survives restarting a run');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.RIFT, { timeout: 120000 });
  assert.equal(await page.evaluate(() => RIFT.ultraUltimate.authorized), false, 'Reload starts a new locked session');
  assert.deepEqual(errors, []);
  console.log('PASS: production locked by default; real Brimby signal unlocks HUD, panel, tuning and indefinite key2 toggle; cooldown, restart and reload isolation verified.');
} finally { await browser.close(); }
