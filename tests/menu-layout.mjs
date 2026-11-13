import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const errors = [];
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => Boolean(window.RIFT) && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('12px "Rift Pixel"')), true, 'Local pixel font loads');
  // Render one settled menu frame, then freeze simulation for comparable captures.
  await page.evaluate(() => {
    const g = window.RIFT;
    window.__menuUpdate = g.update.bind(g);
    g.update = () => {};
    g.renderFrame(1);
  });

  for (const [width, height] of [[1440, 900], [1280, 800]]) {
    await page.setViewport({ width, height });
    // A resize clears the drawing buffer. Wait for the browser's resize event
    // before drawing the frozen scene, otherwise a valid layout captures black.
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.RIFT.renderFrame(1);
        resolve();
      }));
    }));
    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        launch: rect('#launchBtn'),
        logo: rect('.voxelLogo'),
        footer: rect('.menuFooter'),
        main: rect('.menuMain'),
        svgCount: document.querySelectorAll('[data-voxel-text] svg').length,
        label: document.querySelector('h1').getAttribute('aria-label'),
      };
    });
    assert.equal(layout.svgCount, 4, 'Logo, launch and pause titles use voxel glyphs');
    assert.equal(layout.label, 'Rift Pirates');
    assert.ok(layout.launch.x >= 0 && layout.launch.right <= width, 'Launch stays horizontally visible');
    assert.ok(layout.launch.y >= 0 && layout.launch.bottom <= height, 'Launch stays vertically visible');
    assert.ok(layout.main.bottom < layout.footer.y, 'Main content must not overlap the route footer');
    assert.ok(layout.logo.y > 60, 'Logo must not overlap the masthead');
    const shipCard = await page.$eval('#shipSelectBtn', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, right: r.right, bottom: r.bottom };
    });
    assert.ok(shipCard.x >= 0 && shipCard.right <= width && shipCard.bottom < layout.footer.y, 'Ship picker fits above route footer');
    await page.screenshot({ path: `${out}/menu-${width}.png` });
    console.log(`${width}×${height}: menu content fits; custom voxel glyphs rendered`);
  }

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const animations = await page.evaluate(() => [...document.querySelectorAll('.menuSpectrum,.riftHalo,.riftOrbit,.riftShard')]
    .map((el) => getComputedStyle(el).animationName));
  assert.ok(animations.every((name) => name === 'none'), 'Menu motion honors reduced motion');
  await page.click('#launchBtn');
  assert.equal(await page.evaluate(() => window.RIFT.running), true, 'Launch starts gameplay');
  assert.equal(await page.evaluate(() => document.getElementById('titleScreen').classList.contains('hidden')), true);
  await page.click('#pauseBtn');
  await page.screenshot({ path: `${out}/pause-menu.png` });
  assert.equal(await page.evaluate(() => window.RIFT.paused), true, 'Pause suspends gameplay');
  const pauseAboveToasts = await page.evaluate(() => Number(getComputedStyle(document.getElementById('pauseScreen')).zIndex) > Number(getComputedStyle(document.getElementById('toasts')).zIndex));
  assert.equal(pauseAboveToasts, true, 'Gameplay toasts stay behind pause console');
  await page.click('#resumeBtn');
  await page.evaluate(() => {
    const g = window.RIFT;
    g.scrap.burst(0, 0, -10, 12);
    g.scrap.collected = 7;
    g.quitRun();
  });
  assert.equal(await page.$eval('#resultsTitle', (el) => el.textContent), await page.evaluate(() => `${window.RIFT.player.shipName} DESTROYED`), 'Results identify the selected ship');
  await page.click('#toTitleBtn');
  const returned = await page.evaluate(() => {
    const g = window.RIFT;
    return {
      titleVisible: !document.getElementById('titleScreen').classList.contains('hidden'),
      running: g.running,
      activeScrap: g.scrap.pool.some((piece) => piece.active || piece.sp.visible),
      menuHero: g.worldShowcase.menuRoot.visible,
      world: g.worldShowcase.worldRoot.visible,
      debris: g.env.livingDebris.group.visible,
    };
  });
  assert.deepEqual(returned, {
    titleVisible: true, running: false, activeScrap: false,
    menuHero: true, world: false, debris: false,
  }, 'Returning from results restores the clean title vignette');
  await page.click('#launchBtn');
  assert.equal(await page.evaluate(() => window.RIFT.env.livingDebris.group.visible), true, 'Relaunch restores populated scenery');
  assert.deepEqual(errors, [], 'No menu startup errors');
  console.log('PASS: desktop layout, voxel lettering, reduced motion, launch and return to title.');
} finally {
  await browser.close();
}
