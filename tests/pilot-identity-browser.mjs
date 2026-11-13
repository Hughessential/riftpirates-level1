import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  protocolTimeout: 180000, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, hasTouch: true });
  page.on('pageerror', error => errors.push(error.message));
  const ready = async () => {
    await page.waitForFunction(() => window.RIFT?.pilotIdentity && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
    await page.evaluate(async () => {
      RIFT.update = () => {};
      const url = performance.getEntriesByType('resource').find(e => /\/src\/core\/Input\.js(?:\?|$)/.test(e.name)).name;
      window.__input = (await import(url)).Input;
    });
  };
  const enter = async name => page.$eval('#pilotNameInput', (el, text) => { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); }, name);
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready();
  await page.click('#launchBtn');
  assert.equal(await page.evaluate(() => RIFT.running), false, 'Launch waits for first identity confirmation');
  assert.equal(await page.$eval('#pilotIdentityDialog', el => el.open), true);
  await enter('<img src=x onerror=alert(1)>');
  await page.click('#pilotNameConfirm');
  assert.equal(await page.evaluate(() => RIFT.running), false);
  assert.equal(await page.$eval('#pilotNameInput', el => el.getAttribute('aria-invalid')), 'true');
  assert.equal(await page.$eval('#pilotNamePreview', el => el.childElementCount), 0);
  await enter('');
  await page.keyboard.type('QEP');
  await page.keyboard.press('F2');
  assert.equal(await page.evaluate(() => RIFT.testing.active), false, 'Name typing cannot enter the lab');
  assert.deepEqual(await page.evaluate(() => __input._keys), {}, 'Name typing never reaches gameplay keys');
  await enter('  Jose\u0301 海賊  ');
  assert.equal(await page.$eval('#pilotNamePreview', el => el.textContent), 'José 海賊');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => RIFT.runPilotName), 'José 海賊');
  assert.equal(await page.evaluate(() => RIFT.running), true);
  assert.equal(await page.evaluate(() => __input.firing), false, 'Confirmation does not fire into the new run');

  // The tag follows position, not cosmetic roll/size, for all six authored hulls.
  const tags = await page.evaluate(() => {
    const g = RIFT, original = g.player.shipId;
    g.player.group.position.set(0, 1, 0);
    g.camera.position.set(0, 4.6, 11); g.camera.lookAt(0, 3, -24); g.camera.updateMatrixWorld();
    const results = [...g.hangar.models.keys()].map((id, i) => {
      g.player.setShip(id); g.player.group.rotation.z = i; g.pilotIdentity.updateTag(g.camera, g.renderer.domElement);
      const el = document.getElementById('playerNameTag'), rect = el.getBoundingClientRect();
      return { id, hidden: el.hidden, text: el.textContent, x: rect.x, y: rect.y, width: rect.width, height: rect.height, pointer: getComputedStyle(el).pointerEvents };
    });
    g.player.setShip(original); g.player.group.rotation.z = 0;
    return results;
  });
  assert.equal(tags.length, 6);
  for (const tag of tags) {
    assert.equal(tag.hidden, false, tag.id); assert.match(tag.text, /José 海賊/);
    assert.equal(tag.pointer, 'none'); assert.ok(tag.width <= 201 && tag.height <= 40);
    assert.equal(tag.x, tags[0].x); assert.equal(tag.y, tags[0].y);
  }
  await page.evaluate(() => { RIFT.player.group.position.x = 10000; RIFT.pilotIdentity.updateTag(RIFT.camera, RIFT.renderer.domElement); });
  assert.equal(await page.$eval('#playerNameTag', el => el.hidden), true, 'Offscreen ships never leave detached tags');
  await page.evaluate(() => { RIFT.player.group.position.x = 0; RIFT.player.alive = false; RIFT.pilotIdentity.updateTag(RIFT.camera, RIFT.renderer.domElement); });
  assert.equal(await page.$eval('#playerNameTag', el => el.hidden), true, 'Dead ship hides its tag');
  await page.evaluate(() => { RIFT.player.alive = true; RIFT.quitRun(); });
  await page.click('#toTitleBtn');
  await page.click('#shipSelectBtn');
  await page.click('#hangarPilotName');
  await enter('NEW CAPTAIN');
  await page.click('#pilotNameTagVisible');
  await page.click('#pilotNameConfirm');
  assert.equal(await page.evaluate(() => RIFT.runPilotName), 'José 海賊', 'Editing never rewrites the completed run identity');
  await page.click('#hangarConfirm');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready();
  await page.click('#pilotIdentityBtn');
  assert.equal(await page.$eval('#pilotNameInput', el => el.value), 'NEW CAPTAIN');
  assert.equal(await page.$eval('#pilotNameTagVisible', el => el.checked), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#pilotIdentityDialog', el => el.open), false);
  assert.equal(await page.evaluate(() => RIFT.running), false, 'Cancel never launches');
  await page.click('#launchBtn');
  assert.equal(await page.evaluate(() => RIFT.runPilotName), 'NEW CAPTAIN');
  assert.equal(await page.$eval('#pilotIdentityDialog', el => el.open), false, 'Returning captains skip repeated name entry');
  await page.evaluate(() => RIFT.quitRun());
  await page.click('#toTitleBtn');

  const saved = await page.evaluate(() => localStorage.getItem('riftpirates-level1-v1'));
  await page.click('#testingGroundsBtn');
  await page.click('[data-action="identity"]');
  await enter('LAB GHOST');
  await page.click('#pilotNameTagVisible');
  await page.click('#pilotNameConfirm');
  assert.equal(await page.evaluate(() => RIFT.runPilotName), 'LAB GHOST');
  assert.equal(await page.evaluate(() => localStorage.getItem('riftpirates-level1-v1')), saved, 'Lab identity and visibility never persist');
  await page.click('#labExit');
  assert.equal(await page.evaluate(() => RIFT.pilotIdentity.currentName()), 'NEW CAPTAIN');
  assert.equal(await page.evaluate(() => RIFT.pilotIdentity.tagVisible()), false);

  // A touch user can recover an empty name using the explicit default choice.
  await page.click('#pilotIdentityBtn'); await enter('');
  const point = await page.$eval('#pilotNameDefault', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.touchscreen.tap(point.x, point.y);
  assert.equal(await page.evaluate(() => RIFT.save.data.pilotName), 'PIRATE');
  assert.deepEqual(errors, []);
  console.log('PASS: first-use flow, safe Unicode live preview, keyboard isolation, six stable hull tags, frustum/death cleanup, hangar edit, reload, snapshots, cancellation, touch default and lab isolation.');
} finally { await browser.close(); }
