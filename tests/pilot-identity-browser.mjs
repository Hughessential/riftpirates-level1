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
  await page.goto(new URL('?lab=unlock', process.env.RIFT_TEST_URL || 'http://localhost:8000/').href,
    { waitUntil: 'domcontentloaded', timeout: 120000 });
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

  // Identity is fixed to the stats HUD and never follows the ship through play.
  const hudName = await page.$eval('#pilotHudName', el => {
    const rect = el.getBoundingClientRect();
    return { text: el.textContent, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  assert.match(hudName.text, /José 海賊/); assert.ok(hudName.width > 0 && hudName.height > 0);
  assert.deepEqual(await page.$$eval('.hudBarLabel', labels => labels.map(label => label.textContent)),
    ['SHIELD', 'BOOST'], 'Secondary stats identify both compact bars');
  await page.evaluate(() => { RIFT.player.group.position.x = 10000; });
  assert.equal(await page.$eval('#pilotHudName', el => el.textContent), 'José 海賊',
    'HUD identity remains readable when the ship leaves the viewport');
  assert.equal(await page.$('#playerNameTag'), null, 'No detached world-space name tag remains');
  assert.equal(await page.$('#pilotNameTagVisible'), null, 'Name-tag visibility setting is removed');
  await page.evaluate(() => RIFT.quitRun());
  await page.click('#toTitleBtn');
  await page.click('#shipSelectBtn');
  await page.click('#hangarPilotName');
  await enter('NEW CAPTAIN');
  await page.click('#pilotNameConfirm');
  assert.equal(await page.evaluate(() => RIFT.runPilotName), 'José 海賊', 'Editing never rewrites the completed run identity');
  await page.click('#hangarConfirm');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready();
  await page.click('#pilotIdentityBtn');
  assert.equal(await page.$eval('#pilotNameInput', el => el.value), 'NEW CAPTAIN');
  assert.equal(await page.$('#pilotNameTagVisible'), null);
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
  await page.click('#pilotNameConfirm');
  assert.equal(await page.evaluate(() => RIFT.runPilotName), 'LAB GHOST');
  assert.equal(await page.evaluate(() => localStorage.getItem('riftpirates-level1-v1')), saved, 'Lab identity and visibility never persist');
  await page.click('#labExit');
  assert.equal(await page.evaluate(() => RIFT.pilotIdentity.currentName()), 'NEW CAPTAIN');

  // There is no separate bypass; players confirm the default name in the field.
  await page.click('#pilotIdentityBtn'); await enter('');
  await page.click('#pilotNameConfirm');
  assert.equal(await page.$eval('#pilotIdentityDialog', el => el.open), true, 'Empty names remain invalid');
  assert.equal(await page.$('#pilotNameDefault'), null, 'Fly as Pirate shortcut is removed');
  await enter('PIRATE'); await page.click('#pilotNameConfirm');
  assert.equal(await page.evaluate(() => RIFT.save.data.pilotName), 'PIRATE');
  assert.deepEqual(errors, []);
  console.log('PASS: first-use flow, safe Unicode live preview, keyboard isolation, fixed HUD identity, hangar edit, reload, snapshots, cancellation, direct default confirmation and lab isolation.');
} finally { await browser.close(); }
