import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { PLAYER_SHIPS } from '../src/render/PlayerFleet.js';
import { BASE_STATS } from '../src/player/Player.js';
import { UPGRADES } from '../src/systems/UpgradeSystem.js';

const OUT = fileURLToPath(new URL('../shots/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const errors = [];
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || /THREE\.WebGLProgram.*(?:error|invalid)|VALIDATE_STATUS.*false|Shader Error/i.test(message.text())) {
      errors.push(message.text());
    }
  });

  async function ready() {
    await page.waitForFunction(() => window.RIFT?.hangar && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
    // The test advances gameplay explicitly; the hangar keeps its real UI loop.
    await page.evaluate(() => {
      const g = window.RIFT;
      window.__shipTestUpdate = g.update.bind(g);
      window.__shipTestRender = g.renderFrame.bind(g);
      g.update = () => {};
      g.renderFrame = () => {};
      window.__shipTestRender(1 / 60);
    });
  }

  async function titleFromRun() {
    await page.evaluate(() => window.RIFT.quitRun());
    await page.click('#toTitleBtn');
    assert.equal(await page.$eval('#titleScreen', (el) => !el.classList.contains('hidden')), true);
  }

  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready();
  await page.mouse.move(900, 150);
  assert.equal(await page.$eval('#menuCursorStar', (el) => el.classList.contains('visible')), true, 'Voxel pointer star is active on the title');
  assert.equal(await page.$$eval('.shipOption', (els) => els.length), 6, 'All six original hulls are selectable');
  await page.waitForFunction(() => [...document.querySelectorAll('.shipOption img,.selectedShipThumb')]
    .every((image) => image.complete && image.naturalWidth > 0));

  let referenceCadence;
  for (const [index, ship] of PLAYER_SHIPS.entries()) {
    await page.click('#shipSelectBtn');
    assert.equal(await page.$eval('#shipHangarDialog', (el) => el.open), true);
    await page.click(`[data-ship-id="${ship.id}"]`);
    assert.equal(await page.$eval(`[data-ship-id="${ship.id}"]`, (el) => el.getAttribute('aria-pressed')), 'true');
    assert.equal(await page.$eval('#selectedShipName', (el) => el.textContent), ship.name);
    if (index === 2) await page.screenshot({ path: `${OUT}/ship-hangar.png` });
    await page.click('#hangarConfirm');
    assert.equal(await page.$eval('#shipHangarDialog', (el) => el.open), false);
    await page.click('#launchBtn');
    const actual = await page.evaluate(() => {
      const g = window.RIFT;
      return { running: g.running, id: g.player.shipId, renderedId: g.player.hull.userData.shipId,
        radius: g.player.radius, stats: g.player.stats, hull: g.player.health,
        shield: g.player.shield, fireRate: g.player.fireRate,
        cursorVisible: document.getElementById('menuCursorStar').classList.contains('visible') };
    });
    assert.equal(actual.running, true);
    assert.equal(actual.id, ship.id);
    assert.equal(actual.renderedId, ship.id, 'Gameplay uses the chosen supplied mesh, not a display-only selection');
    const unaugmentedStats = { ...BASE_STATS(), ...Object.fromEntries(Object.keys(UPGRADES).map((id) => [id, 0])) };
    assert.deepEqual(actual.stats, unaugmentedStats, 'All cosmetic hulls begin with exactly the same unaugmented stats');
    assert.equal(actual.radius, 1.35, 'Cosmetic hulls retain one collision radius');
    assert.equal(actual.hull, BASE_STATS().maxHealth);
    assert.equal(actual.shield, BASE_STATS().shieldMax);
    assert.equal(actual.fireRate, BASE_STATS().fireRate);
    assert.equal(actual.cursorVisible, false, 'Decorative pointer disappears during gameplay');

    await page.keyboard.down('Space');
    const cadence = await page.evaluate(() => {
      const g = window.RIFT;
      g.player.frozen = false;
      g.weapon.reset();
      g.projectiles.reset();
      const firedAt = [];
      for (let frame = 0; frame < 120; frame++) {
        const before = g.weapon.shots;
        g.weapon.update(1 / 60, { targets: [], heat: g.heat });
        if (g.weapon.shots > before) firedAt.push(frame);
      }
      return firedAt;
    });
    await page.keyboard.up('Space');
    assert.ok(cadence.length > 0, 'The actual manual-fire input produces shots');
    if (!referenceCadence) referenceCadence = cadence;
    assert.deepEqual(cadence, referenceCadence, 'Every hull fires on identical simulation frames');

    await page.click('#pauseBtn');
    assert.equal(await page.evaluate(() => window.RIFT.paused), true);
    assert.equal(await page.$eval('#pauseScreen', (el) => !el.classList.contains('hidden')), true);
    await page.click('#resumeBtn');
    assert.equal(await page.evaluate(() => window.RIFT.paused), false);
    assert.equal(await page.evaluate(() => window.RIFT.player.hull.userData.shipId), ship.id);
    console.log(`${ship.name}: chosen mesh, base stats, hitbox, firing cadence and pause/resume pass`);

    if (index === PLAYER_SHIPS.length - 1) {
      await page.evaluate(() => {
        const g = window.RIFT;
        g.weapon.reset();
        g.projectiles.reset();
        // Keep the presentation capture out of the transient damage flash.
        const takeDamage = g.player.takeDamage;
        g.player.takeDamage = () => false;
        g.director.go('TRAVERSAL_1');
        for (let i = 0; i < 480; i++) window.__shipTestUpdate(1 / 60);
        g.player.takeDamage = takeDamage;
        window.__shipTestRender(1 / 60);
      });
      await page.waitForFunction(() => !document.getElementById('banner').classList.contains('show'), { timeout: 5000 });
      await page.screenshot({ path: `${OUT}/selected-ship-flight.png` });
    }
    await titleFromRun();
  }

  const savedId = PLAYER_SHIPS.at(-1).id;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  assert.equal(await page.evaluate(() => window.RIFT.hangar.selectedId), savedId, 'Selected hull persists across reloads');
  assert.equal(await page.evaluate(() => window.RIFT.player.hull.userData.shipId), savedId);

  await page.click('#shipSelectBtn');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => window.RIFT.hangar.selectedId), PLAYER_SHIPS[0].id, 'Right arrow wraps through all six hulls');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => window.RIFT.hangar.selectedId), savedId, 'Left arrow wraps backwards');
  await page.keyboard.press('2');
  assert.equal(await page.evaluate(() => window.RIFT.hangar.selectedId), PLAYER_SHIPS[1].id, 'Number keys select hulls');
  await page.keyboard.press('Enter');
  assert.equal(await page.$eval('#shipHangarDialog', (el) => el.open), false, 'Enter confirms the current selection');
  await page.click('#shipSelectBtn');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#shipHangarDialog', (el) => el.open), false, 'Escape closes the native modal');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'shipSelectBtn', 'Modal closure restores focus');

  await page.evaluate(() => {
    const key = 'riftpirates-level1-v1';
    const save = JSON.parse(localStorage.getItem(key));
    save.selectedShip = 'deleted-or-invalid-hull';
    localStorage.setItem(key, JSON.stringify(save));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  assert.equal(await page.evaluate(() => window.RIFT.hangar.selectedId), PLAYER_SHIPS[0].id, 'Invalid saved hull safely defaults');
  assert.equal(await page.evaluate(() => window.RIFT.player.hull.userData.shipId), PLAYER_SHIPS[0].id);
  assert.deepEqual(errors, [], 'No startup, UI or shader errors');
  console.log('PASS: six cosmetic selections, live hulls, identical combat, persistence, invalid-save recovery, keyboard navigation, thumbnails and cursor visibility.');
} finally {
  await browser.close();
}
