import { launchRun } from './helpers/start-run.mjs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { voxelWordSVG } from '../src/ui/VoxelTitle.js';

assert.ok(voxelWordSVG('M', 'launch').includes('<rect '), 'Start Game has a visible M voxel glyph');

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

  for (const [width, height] of [[1440, 900], [1280, 800], [1280, 720], [1598, 802], [2560, 1296], [3440, 1440]]) {
    await page.setViewport({ width, height });
    for (const scale of [.8, 1.1, 1.4]) {
    await page.evaluate(async scale => (await import('/src/ui/UISettings.js')).applyUIScale(scale), scale);
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
        masthead: rect('.menuMasthead'),
        options: rect('#optionsBtn'),
        motto: rect('.menuMotto'),
        svgCount: document.querySelectorAll('[data-voxel-text] svg').length,
        label: document.querySelector('h1').getAttribute('aria-label'),
      };
    });
    assert.equal(layout.svgCount, 4, 'Logo, launch and pause titles use voxel glyphs');
    assert.equal(layout.label, 'Rift Pirates');
    assert.ok(layout.launch.x >= 0 && layout.launch.right <= width, 'Launch stays horizontally visible');
    assert.ok(layout.launch.y >= 0 && layout.launch.bottom <= height, 'Launch stays vertically visible');
    assert.ok(layout.main.bottom + 12 < layout.footer.y,
      `Hero retains footer breathing room at ${width}×${height}/${scale}: ${JSON.stringify(layout)}`);
    assert.ok(layout.main.y > layout.masthead.bottom + 16, 'Hero keeps a clear gap below the masthead');
    assert.ok(layout.logo.width < Math.min(width, height * 1.9) * .51, 'Decorative title stays within the reference left column');
    assert.ok(layout.motto.bottom < layout.launch.y && layout.launch.bottom < layout.options.y,
      'Slogan, Start Game and Options retain their visual hierarchy');
    assert.equal(await page.$eval('#launchBtn', el => el.getAttribute('aria-label')), 'Start game');
    const shipCard = await page.$eval('#shipSelectBtn', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, right: r.right, bottom: r.bottom };
    });
    assert.ok(shipCard.x >= 0 && shipCard.right <= width && shipCard.bottom < layout.footer.y, 'Ship picker fits above route footer');
    if (scale === 1.1) await page.screenshot({ path: `${out}/menu-${width}.png` });
    }
    // A returning player's real stats add a row above Options. Reserve space
    // for long earned values at the largest scale, not just a fresh profile.
    await page.evaluate(() => {
      Object.assign(RIFT.save.data, { runs:4, bestScore:123456789, scrapBanked:1234567, clears:12 });
      document.getElementById('toTitleBtn').click();
    });
    const statsLayout = await page.evaluate(() => {
      const bounds = id => document.getElementById(id).getBoundingClientRect();
      return { stats:bounds('titleStats').bottom, options:bounds('optionsBtn').top,
        end:bounds('optionsBtn').bottom, footer:document.querySelector('.menuFooter').getBoundingClientRect().top };
    });
    assert.ok(statsLayout.options >= statsLayout.stats && statsLayout.end + 12 < statsLayout.footer,
      `Saved stats and Options remain clear of the footer: ${JSON.stringify(statsLayout)}`);
    await page.evaluate(() => { RIFT.save.data.runs = 0; document.getElementById('toTitleBtn').click(); });
    console.log(`${width}×${height}: uncluttered title fits at 80%, 110% and 140% UI size`);
  }
  await page.setViewport({ width:1440, height:900 });
  await page.evaluate(async () => (await import('/src/ui/UISettings.js')).applyUIScale(1.1));

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const animations = await page.evaluate(() => [...document.querySelectorAll('.menuSpectrum,.riftHalo,.riftOrbit,.riftShard')]
    .map((el) => getComputedStyle(el).animationName));
  assert.ok(animations.every((name) => name === 'none'), 'Menu motion honors reduced motion');
  await launchRun(page);
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
    g.scrap.wallet.credit(7);
    g.quitRun();
  });
  assert.equal(await page.$eval('#resultsTitle', (el) => el.textContent), 'SHIP DESTROYED', 'Failure results stay distinct from victory');
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
  await launchRun(page);
  assert.equal(await page.evaluate(() => window.RIFT.env.livingDebris.group.visible), true, 'Relaunch restores populated scenery');
  assert.deepEqual(errors, [], 'No menu startup errors');
  console.log('PASS: desktop layout, voxel lettering, reduced motion, launch and return to title.');
} finally {
  await browser.close();
}
