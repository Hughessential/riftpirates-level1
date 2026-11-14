import { launchRun } from './helpers/start-run.mjs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const shots = fileURLToPath(new URL('../shots/', import.meta.url));
mkdirSync(shots, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  // An isolated test must keep the loaded build while other collaborators save
  // files. Preserve the dev connection but ignore HMR replacement/navigation.
  await page.evaluateOnNewDocument(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        if (protocols === 'vite-hmr') this.addEventListener('message', event => {
          const type = JSON.parse(event.data).type;
          if (type === 'update' || type === 'full-reload') event.stopImmediatePropagation();
        });
      }
    };
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled);
  await launchRun(page);
  await page.evaluate(() => {
    const g = window.RIFT;
    window.__introStep = g.update.bind(g);
    window.__introRender = g.renderFrame.bind(g);
    g.update = () => {}; g.renderFrame = () => {};
    g.testRun = true;
  });
  const step = seconds => page.evaluate(seconds => {
    for (let i = 0; i < Math.ceil(seconds * 60); i++) window.__introStep(1 / 60);
  }, seconds);
  const defs = [
    ['TOWER_1_INTRO', 'TOWER_1_COMBAT', 'OUTER DEFENSE TOWER'],
    ['TOWER_2_INTRO', 'TOWER_2_COMBAT', 'MIDRIFT PRESSURE TOWER'],
    ['TOWER_3_INTRO', 'TOWER_3_COMBAT', 'INNER CITADEL TOWER'],
    ['INHIBITOR_INTRO', 'INHIBITOR_COMBAT', 'INHIBITOR CORE'],
    ['BOSS_INTRO', 'BOSS_COMBAT', 'THE RIFT ADMIRAL'],
  ];
  for (const [intro, combat, name] of defs) {
    if (intro === 'TOWER_1_INTRO') await page.keyboard.down('Space');
    await page.evaluate(state => {
      const g = window.RIFT;
      g.director._disposeEncounter();
      g.director.go(state);
    }, intro);
    const start = await page.evaluate(() => {
      const g = window.RIFT;
      return { hp: g.player.health, state: g.director.state,
        active: g.director.intro.active, frozen: g.player.frozen, music: g.audio.currentMusic };
    });
    assert.equal(start.active, true); assert.equal(start.frozen, true); assert.equal(start.music, 'battle');
    assert.equal(await page.evaluate(() => window.RIFT.director.intro.backdrop.visible), intro === 'BOSS_INTRO');
    assert.equal(await page.$eval('#bossIntroTitle', el => el.getAttribute('aria-label')), name);
    await step(1.4);
    if (intro === 'TOWER_1_INTRO') {
      await page.keyboard.down('Space'); // repeat of fire held before arrival
      await step(1 / 60);
      await page.keyboard.up('Space');
    }
    const middle = await page.evaluate(() => {
      const g = window.RIFT;
      return { hp: g.player.health, state: g.director.state, shots: g.projectiles.player.filter(b => b.active).length,
        foes: g.enemies.countAlive(), hazards: g.hazards.length,
        camera: g.camera.position.toArray(), elapsed: g.director.intro.elapsed };
    });
    assert.equal(middle.state, intro); assert.equal(middle.hp, start.hp);
    assert.equal(middle.shots, 0); assert.equal(middle.foes, 0); assert.equal(middle.hazards, 0);
    assert.equal(await page.$eval('#arsenalReadout', el => getComputedStyle(el).visibility), 'hidden', 'Combat readouts cannot obscure the boss title');
    await page.click('#bossIntroPause');
    await page.keyboard.press('Space'); // paused keys must not queue a skip
    await step(1);
    assert.deepEqual(await page.evaluate(() => ({
      elapsed: window.RIFT.director.intro.elapsed,
      camera: window.RIFT.camera.position.toArray(),
    })), { elapsed: middle.elapsed, camera: middle.camera }, 'Paused reveals hold their exact camera/title timeline');
    await page.click('#resumeBtn');
    await step(.9);
    assert.notDeepEqual(await page.evaluate(() => window.RIFT.camera.position.toArray()), middle.camera, 'Camera reveals the structure');
    if (intro === 'TOWER_1_INTRO' || intro === 'BOSS_INTRO') {
      await page.evaluate(() => window.__introRender(1 / 60));
      await page.screenshot({ path: `${shots}/intro-${intro === 'BOSS_INTRO' ? 'admiral' : 'outer'}.png` });
    }
    // Skip must preserve the same battle recording, clear cinematic controls,
    // and leave no stray Space shot/queued input behind it.
    await page.evaluate(() => { window.RIFT.audio.music.battle.el.currentTime = 12; });
    if (intro === 'TOWER_3_INTRO') await page.keyboard.press('Space');
    else await page.click('#bossIntroSkip');
    await step(1 / 60);
    const after = await page.evaluate(() => {
      const g = window.RIFT;
      return { state: g.director.state, active: g.director.intro.active, frozen: g.player.frozen,
        hidden: document.getElementById('bossIntro').hidden, music: g.audio.currentMusic,
        audioTime: g.audio.music.battle.el.currentTime, cameraOwned: Boolean(g.camera3.encounterReveal),
        visible: g.player.group.visible, halo: g.director.intro.backdrop.visible,
        shots: g.projectiles.player.filter(b => b.active).length };
    });
    assert.equal(after.state, combat); assert.equal(after.active, false); assert.equal(after.frozen, false);
    assert.equal(after.hidden, true); assert.equal(after.visible, true); assert.equal(after.cameraOwned, false);
    assert.equal(after.halo, false, 'The decorative rift clears before combat');
    assert.equal(after.shots, 0, 'Skip input must not leak into a combat shot');
    assert.equal(after.music, 'battle'); assert.ok(after.audioTime >= 12, 'Skip must not restart the boss music');
    if (intro === 'BOSS_INTRO') assert.equal(await page.evaluate(() => window.RIFT.encounter.group.position.z), -62);
    console.log(`${name}: cinematic, pause, safe controls, skip and battle continuity passed`);
  }

  // Full unskipped timeline, external-display layout, and reduced-motion path.
  await page.evaluate(() => {
    const g = window.RIFT;
    g.director._disposeEncounter(); g.director.go('TOWER_2_INTRO');
  });
  await step(2.6);
  for (const [width, height] of [[1280,800], [2560,1440], [3840,2160]]) {
    await page.setViewport({ width, height });
    const bounds = await page.evaluate(() => {
      const r = document.getElementById('bossIntroTitle').getBoundingClientRect();
      const button = document.getElementById('bossIntroSkip').getBoundingClientRect();
      return { left:r.left, right:r.right, bottom:r.bottom, top:r.top, buttonRight:button.right };
    });
    assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom < height);
    assert.ok(bounds.buttonRight <= width, 'Skip control stays on external displays');
  }
  await step(2.8);
  assert.equal(await page.evaluate(() => window.RIFT.director.state), 'TOWER_2_COMBAT', 'Unskipped arrival completes in game time');
  await page.setViewport({ width: 1440, height: 900 });
  await page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'reduce' }]);
  await page.evaluate(() => {
    const g = window.RIFT;
    g.director._disposeEncounter(); g.director.go('INHIBITOR_INTRO');
  });
  await step(1);
  const still = await page.evaluate(() => window.RIFT.camera.position.toArray());
  await step(1);
  assert.deepEqual(await page.evaluate(() => window.RIFT.camera.position.toArray()), still, 'Reduced motion keeps the reveal camera still');
  await page.evaluate(() => window.RIFT.prepareTitle());
  assert.equal(await page.$eval('#bossIntro', el => el.hidden), true, 'Title return clears every cinematic layer');
  assert.equal(await page.evaluate(() => document.body.classList.contains('bossIntroActive')), false);
  // Replaying from the held lab console must return live controls when the
  // reveal ends, even though input was disabled at the moment it began.
  const labReplay = await page.evaluate(async () => {
    const g = window.RIFT;
    const inputUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(url => new URL(url).pathname.endsWith('/src/core/Input.js')) || '/src/core/Input.js';
    const input = (await import(inputUrl)).Input;
    g.testing.enter();
    g.testing.loadScene('tower1', { introOnly: true });
    const held = g.director.intro.active && g.testing.panelOpen && !input.enabled;
    g.testing.setPanelOpen(false);
    for (let i = 0; i < 6 * 60; i++) window.__introStep(1 / 60);
    return { held, state:g.director.state, enabled:input.enabled, frozen:g.player.frozen };
  });
  assert.equal(labReplay.held, true);
  assert.equal(labReplay.state, 'TOWER_1_COMBAT');
  assert.equal(labReplay.enabled, true); assert.equal(labReplay.frozen, false);
  assert.deepEqual(errors, []);
  console.log('PASS: five boss intros, safe controls, continuous music, pause/skip, full timeline, 1280/2560/4K layout, reduced motion and title cleanup.');
} finally {
  await browser.close();
}
