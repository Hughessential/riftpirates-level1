import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { launchRun } from './helpers/start-run.mjs';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => localStorage.setItem('riftpirates-level1-v1', JSON.stringify({
    pilotName: 'VISUAL TEST', pilotNameConfirmed: true, tutorialComplete: true, music: 0, sfx: 0,
  })));
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await launchRun(page);
  await page.evaluate(async () => {
    const { STATE } = await import('/src/core/GameState.js');
    const g = window.RIFT;
    g.director.go(STATE.TRAVERSAL_1);
    g.player.frozen = false;
  });
  await page.waitForFunction(() => window.RIFT.player.reticle.visible, { timeout: 10000 });
  const flight = await page.evaluate(() => {
    const g = window.RIFT;
    return {
      visible: g.player.reticle.visible,
      hasGlow: g.player.reticle.children.some(child => child.isSprite),
      scale: g.player.reticle.scale.x,
      activeTrail: g.player.exhaust.activeCount,
    };
  });
  assert.deepEqual({ visible: flight.visible, hasGlow: flight.hasGlow, scale: flight.scale },
    { visible: true, hasGlow: false, scale: 1 });

  const stateVisibility = await page.evaluate(async () => {
    const { STATE } = await import('/src/core/GameState.js');
    const g = window.RIFT;
    Object.assign(g, { running: true, paused: false, _terminalOutcome: null });
    Object.assign(g.player, { alive: true, frozen: false });
    g.death.active = false;
    g.director.intro.active = false;
    g.director.inUpgrade = false;
    g.upgradeScreen.open = false;
    g.upgradeScreen.closing = false;
    g.testing.panelOpen = false;
    const sample = state => {
      g.director.state = state;
      g.player.setReticleActive(g._reticleShouldBeActive());
      return g.player.reticle.visible;
    };
    return {
      traversal: sample(STATE.TRAVERSAL_1), combat: sample(STATE.TOWER_2_COMBAT),
      escape: sample(STATE.ESCAPE), nexusCinema: sample(STATE.NEXUS_TRANSITION),
      bossIntro: sample(STATE.BOSS_INTRO), upgrade: sample(STATE.UPGRADE_3),
      victory: sample(STATE.VICTORY), results: sample(STATE.RESULTS),
    };
  });
  assert.deepEqual(stateVisibility, {
    traversal: true, combat: true, escape: true, nexusCinema: false,
    bossIntro: false, upgrade: false, victory: false, results: false,
  }, 'Sight exists only during valid traversal, combat and escape flight states');
  await page.evaluate(async () => {
    const { STATE } = await import('/src/core/GameState.js');
    RIFT.director.state = STATE.TRAVERSAL_1;
  });

  await page.keyboard.down('Shift');
  await page.waitForFunction(() => window.RIFT.player.boosting && window.RIFT.player.exhaust.boostMix > .9, { timeout: 5000 });
  const boost = await page.evaluate(() => ({
    mix: RIFT.player.exhaust.boostMix,
    trailScale: RIFT.player.trail.scale.x,
    red: RIFT.player.engines[0].material.color.r,
    blue: RIFT.player.engines[0].material.color.b,
  }));
  await page.keyboard.up('Shift');
  assert.ok(boost.mix > .9 && boost.trailScale > 2 && boost.red > boost.blue,
    'Live boost uses the long hot flare and red/orange engine palette');

  await page.evaluate(() => RIFT.togglePause());
  await page.waitForFunction(() => !window.RIFT.player.reticle.visible);
  assert.equal(await page.evaluate(() => RIFT.player.reticle.visible), false, 'Pause hides the flight sight');
  await page.evaluate(() => RIFT.togglePause());
  await page.waitForFunction(() => window.RIFT.player.reticle.visible);
  assert.equal(await page.evaluate(() => RIFT.player.reticle.scale.x), 1, 'Resume restores the flat non-pulsing sight');

  console.log('PASS: real browser shows flat always-on flight sight, pause hiding, and hot long boost ignition.');
} finally {
  await browser.close();
}
