/**
 * Visual verification. Every other test stubs out rendering; this one actually
 * draws frames and saves them, so the outlined-voxel look, the HUD, the
 * telegraphs and the screens can be checked by eye.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  protocolTimeout: 240000,
  args: [
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://localhost:8000/index.html', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 900));

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  ->', name);
};

// Title screen first, before anything is running.
await shot('00-title');

await page.click('#launchBtn');
await new Promise((r) => setTimeout(r, 500));

// Sim without rendering (swiftshader is far too slow to draw 60fps), then draw
// exactly one real frame before each capture.
await page.evaluate(() => {
  const g = window.RIFT;
  window.__render = g.renderer.render.bind(g.renderer);
  g.renderer.render = () => {};
  window.__draw = () => window.__render(g.scene, g.camera);
});
const step = async (seconds) => {
  let left = Math.round(seconds * 60);
  while (left > 0) {
    const chunk = Math.min(left, 600);
    await page.evaluate((n) => { for (let i = 0; i < n; i++) window.RIFT.update(1 / 60); }, chunk);
    left -= chunk;
  }
  await page.evaluate(() => window.__draw());
};

const god = () => page.evaluate(() => {
  window.__realTakeDamage = window.RIFT.player.takeDamage;
  window.RIFT.player.takeDamage = () => false;
});
const goTo = (s) => page.evaluate((st) => window.RIFT.director.go(st), s);

await god();

await step(2);
await shot('01-intro');

await step(25);
await shot('02-traversal-asteroids');

await goTo('TOWER_1_INTRO');
await step(6);
await shot('03-tower1-outer-defense');
await step(14);
await shot('04-tower1-combat');

await goTo('TOWER_2_INTRO');
await step(18);
await shot('05-tower2-gravity-wells');

await goTo('TOWER_3_INTRO');
await step(20);
await shot('06-tower3-citadel');

await goTo('INHIBITOR_INTRO');
await step(16);
await shot('07-inhibitor-shields');

// upgrade screen
await page.evaluate(() => window.RIFT.upgradeScreen.show(0, '#22d3ee', () => {}));
await new Promise((r) => setTimeout(r, 350));
await page.evaluate(() => window.__draw());
await shot('08-upgrade-cache');
await page.evaluate(() => {
  const b = document.querySelector('#upgradeCards .upCard');
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 350));

await goTo('BOSS_INTRO');
await step(9);
await shot('09-boss-intro');
await page.evaluate(() => { window.RIFT.encounter.phase = 2; });
await step(24);
await shot('10-boss-combat');

// core-open window: the one moment the boss is properly vulnerable
await page.evaluate(() => {
  const e = window.RIFT.encounter;
  e.ventPending = true;
  if (e._openCore) e._openCore();
});
await step(1.5);
await shot('11-boss-core-open');

// death spectacle, mid-implosion
await page.evaluate(() => {
  const g = window.RIFT;
  g.player.takeDamage = window.__realTakeDamage;
  g.player.stats.secondWind = false;
  g.player.invuln = 0;
  g.player.health = 1;
  g.player.takeDamage(500, 'RIFT ADMIRAL TENDRIL SWEEP');
});
await step(1.35);
await shot('12-death-overload');
await step(0.9);
await shot('13-death-implode');
await step(1.2);
await shot('14-results');

console.log('\nERRORS:', errors.length ? [...new Set(errors)].join('\n') : 'none');
await browser.close();
