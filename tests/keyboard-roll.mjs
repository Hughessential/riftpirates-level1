import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 120000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    window.WebSocket = class extends EventTarget { send() {} close() {} };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [] });
    localStorage.setItem('riftpirates-level1-v1', JSON.stringify({ pilotName: 'ROLL TEST', pilotNameConfirmed: true, music: 0 }));
  });
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled);
  await page.click('#launchBtn');
  await page.evaluate(async () => {
    const g = window.RIFT;
    const inputURL = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith('/src/core/Input.js')).name;
    window.__rollInput = (await import(inputURL)).Input;
    window.__rollStep = g.update.bind(g);
    g.update = () => {}; g.renderFrame = () => {};
    g.director.go('TRAVERSAL_1');
    window.__rollStep(1 / 60); // Finish the menu-to-flight input boundary.
  });
  const ready = () => page.evaluate(() => {
    const p = RIFT.player;
    p.rollT = p.rollCd = 0; p.boost = p.stats.boostCapacity;
    p.x = p.vx = 0; p.group.rotation.z = 0;
  });
  const step = (frames = 1) => page.evaluate(frames => {
    for (let i = 0; i < frames; i++) __rollStep(1 / 60);
    const p = RIFT.player;
    return { dir: p.rollDir, time: p.rollT, cooldown: p.rollCd, boost: p.boost,
      x: p.x, rotation: p.group.rotation.z, queued: __rollInput._rollQueue };
  }, frames);
  for (const [key, direction] of [['q', -1], ['e', 1]]) {
    await ready();
    await page.keyboard.down(key);
    const rolling = await step();
    assert.ok(rolling.time > 0, `${key.toUpperCase()} survives no-controller polling and starts a roll`);
    assert.equal(rolling.dir, direction);
    assert.equal(Math.sign(rolling.x), direction, 'The ship dashes in the requested direction');
    assert.equal(Math.sign(rolling.rotation), -direction, 'The hull visibly barrel-rolls');
    assert.ok(rolling.boost < 90, 'Rolling retains its existing boost cost');
    assert.equal(rolling.queued, 0, 'Each press is consumed once');
    await page.keyboard.down(key); // Native repeated keydown while held.
    const held = await step(150);
    assert.ok(held.time <= 0, 'Holding Q/E does not continuously roll');
    await page.keyboard.up(key);
  }
  await ready();
  await page.keyboard.press('q');
  const first = await step();
  await page.keyboard.press('e');
  const cooling = await step();
  assert.equal(cooling.dir, -1, 'An opposite press cannot bypass an active roll/cooldown');
  assert.ok(cooling.cooldown < first.cooldown);
  await ready();
  await page.evaluate(() => { RIFT.player.boost = 0; });
  await page.keyboard.press('e');
  assert.ok((await step()).time <= 0, 'An empty boost reserve cannot start a roll');
  await ready();
  await page.evaluate(() => RIFT.togglePause());
  await page.keyboard.press('q');
  await step();
  await page.evaluate(() => RIFT.togglePause());
  assert.ok((await step()).time <= 0, 'Paused Q/E input cannot leak into flight');
  await page.keyboard.down('e');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.ok((await step()).time <= 0, 'Losing focus clears an unconsumed keyboard roll');
  await page.keyboard.up('e');
  assert.deepEqual(errors, []);
  console.log('PASS: real keyboard Q/E with no controller, both dash/spin directions, one-shot presses, cooldown/energy guards, pause and blur safety.');
} finally { await browser.close(); }
