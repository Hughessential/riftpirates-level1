import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    // A deterministic test must not reload midway when parallel work saves files.
    window.WebSocket = class extends EventTarget { send() {} close() {} };
    window.__pads = [];
    Object.defineProperty(navigator, 'getGamepads', { value: () => window.__pads });
    localStorage.setItem('riftpirates-level1-v1', JSON.stringify({
      pilotName: 'ULTRA UI TEST', pilotNameConfirmed: true, tutorialComplete: true, music: 0, sfx: 0,
    }));
  });
  await page.goto(new URL('?lab=unlock', process.env.RIFT_TEST_URL || 'http://localhost:8000/').href,
    { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT?.ultraUltimate && !document.getElementById('launchBtn').disabled,
    { timeout: 120000 });
  await page.evaluate(async () => {
    const g = window.RIFT;
    const inputUrl = performance.getEntriesByType('resource').find(entry => /\/src\/core\/Input\.js(?:\?|$)/.test(entry.name)).name;
    window.__input = (await import(inputUrl)).Input;
    window.__step = g.update.bind(g);
    window.__render = g.renderFrame.bind(g);
    g.update = () => {}; g.renderFrame = () => {};
  });
  await page.click('#testingGroundsBtn');
  await page.click('#labTab-ultra');
  assert.deepEqual(await page.$$eval('#labUltraTuning [data-tuning-category]', nodes => nodes.map(node => node.dataset.tuningCategory)),
    ['ultraGameplay', 'ultraAura', 'ultraLightning', 'ultraPresentation']);
  assert.equal(await page.$eval('[data-ultra-setting="ultraReducedFlashing"]', input => input.checked), false);
  assert.equal(await page.$eval('[data-ultra-setting="ultraShowRadius"]', input => input.checked), false);
  for (const [key, value] of [['ultraCooldown', 12], ['ultraFieldRadius', 42], ['ultraAuraIntensity', 2.5], ['ultraCoreWidth', .4], ['ultraArmorShine', 1.7]]) {
    await page.$eval(`[data-tuning-number="${key}"]`, (input, value) => {
      input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    assert.equal(await page.evaluate(key => RIFT.testing.getTuning(key), key), value, `${key} applies live`);
  }
  for (const key of ['ultraReducedFlashing', 'ultraShowRadius']) {
    await page.$eval(`[data-ultra-setting="${key}"]`, input => input.click());
    assert.equal(await page.evaluate(key => RIFT.testing.getTuning(key), key), 1, `${key} toggles its runtime setting`);
  }
  await page.click('[data-action="ultraActivate"]');
  assert.equal(await page.evaluate(() => RIFT.ultraUltimate.active), true, 'Panel activates the real ability');
  assert.equal(await page.$eval('[data-action="ultraActivate"]', button => button.disabled), true);
  assert.match(await page.$eval('#labUltraStatus', element => element.textContent), /ACTIVE.*RANGE 42\.0/);

  const layouts = [];
  for (const [width, height] of [[1440, 900], [960, 600]]) {
    await page.setViewport({ width, height });
    layouts.push(await page.evaluate(() => {
      RIFT.testingPanel.selectTab('ultra');
      const elements = ['#testingGroundsPanel', '#labTab-ultra', '#labFly', '#labExit'].map(selector => {
        const el = document.querySelector(selector), rect = el.getBoundingClientRect();
        return { selector, fits: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1 };
      });
      return { width: innerWidth, height: innerHeight, elements, horizontalOverflow: document.querySelector('.labPages').scrollWidth > document.querySelector('.labPages').clientWidth + 1 };
    }));
  }
  assert.ok(layouts.every(layout => layout.elements.every(item => item.fits) && !layout.horizontalOverflow), JSON.stringify(layouts));
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.querySelector('.labPages').scrollTop = 0;
    RIFT.ultraUltimate.updateEffects(1 / 60); __render(1 / 60);
  });
  mkdirSync(new URL('../shots/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../shots/ultra-panel.png', import.meta.url)) });

  await page.click('[data-action="ultraCancel"]');
  const canceled = await page.evaluate(() => ({ active: RIFT.ultraUltimate.active, cooldown: RIFT.ultraUltimate.cooldown }));
  assert.deepEqual(canceled, { active: false, cooldown: 12 });
  await page.click('[data-action="ultraReset"]');
  assert.equal(await page.evaluate(() => RIFT.ultraUltimate.cooldown), 0);

  // Shoulder navigation discovers the authorized tab alongside the existing tabs.
  const controllerTabs = await page.evaluate(() => {
    window.__pad = { id: 'ULTRA UI virtual standard pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })) };
    window.__tick = () => { __input.pollGamepad(); RIFT.controllerMenus.update(); };
    window.__press = i => { __pad.buttons[i] = { pressed: true, value: 1 }; __tick(); __pad.buttons[i] = { pressed: false, value: 0 }; __tick(); };
    __pads = [__pad]; __tick(); __press(13);
    RIFT.testingPanel.selectTab('pilot');
    const visited = [];
    for (let i = 0; i < 7; i++) { __press(5); visited.push(RIFT.testingPanel.activeTab); }
    __pads = []; __input.pollGamepad();
    return visited;
  });
  assert.deepEqual(controllerTabs, ['augments', 'arena', 'effects', 'tuning', 'debug', 'ultra', 'pilot']);
  await page.evaluate(() => { RIFT.testingPanel.selectTab('ultra'); RIFT.paused = false; });
  await page.click('[data-action="ultraActivate"]');
  await page.click('#labFly');
  for (const [width, height] of [[1440, 900], [960, 600]]) {
    await page.setViewport({ width, height });
    const hud = await page.evaluate(() => {
      RIFT.hud.update(.06);
      const lane = document.querySelector('#ultraUltimateHud'), box = lane.getBoundingClientRect();
      const labels = [...lane.querySelectorAll('.ultraUltimateReadout > *')].map(el => {
        const rect = el.getBoundingClientRect();
        return { text: el.textContent, fits: rect.left >= box.left && rect.right <= box.right + 1 && rect.top >= box.top && rect.bottom <= box.bottom + 1 };
      });
      return { width: innerWidth, active: lane.classList.contains('active'), onScreen: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, labels };
    });
    assert.ok(hud.active && hud.onScreen && hud.labels.every(label => label.fits), JSON.stringify(hud));
    assert.match(hud.labels[1].text, /ON.*2 TO END/);
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('PASS: authorized Ultra panel, four tuning groups, live tuning, reduced-flashing/radius switches, activate/cancel/cooldown, seven controller tabs and HUD fit at 1440×900 and 960×600.');
} finally {
  const child = browser.process();
  const timer = setTimeout(() => { browser.disconnect(); child?.kill('SIGTERM'); }, 5000);
  try { await browser.close(); } finally { clearTimeout(timer); }
}
