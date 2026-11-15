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
  await page.goto(process.env.RIFT_TEST_URL || 'http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
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

  await page.evaluate(() => {
    const g = RIFT;
    g.hud.clearNotices();
    g.hud.banner('STANDARD GAMEPLAY BANNER', '#ff38c9');
    g.hud.toast('STANDARD NOTICE 1', 'LEFT-SIDE COMMS RAIL', '#ffc53d');
    g.hud.toast('STANDARD NOTICE 2', 'SEPARATE READABLE CARD', '#ff38c9');
    g.hud.toast('STANDARD NOTICE 3', 'NO CROSSHAIR COLLISION', '#27f5da');
    g.hud.toast('STANDARD NOTICE 4', 'OLDEST CARD IS RETIRED', '#b96bff');
    g.hud.toast('TUTORIAL POSITION CHECK', 'INSTRUCTION PLACEMENT IS UNCHANGED', '#27f5da',
      { category: 'instruction' });
    const card = document.getElementById('titleCard');
    card.classList.remove('hidden');
    card.classList.add('in');
  });
  await new Promise(resolve => setTimeout(resolve, 500));
  const noticeLayout = await page.evaluate(() => {
    const box = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: rect.width, height: rect.height };
    };
    return {
      width: innerWidth,
      banner: box('#banner'),
      briefs: [...document.querySelectorAll('.toast.brief')].map(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }),
      title: box('#titleCard'),
      instruction: box('.toast.instruction'),
      desktopPointer: matchMedia('(hover:hover) and (pointer:fine)').matches,
      boostDisplay: getComputedStyle(document.getElementById('boostBtn')).display,
      fireDisplay: getComputedStyle(document.getElementById('fireBtn')).display,
    };
  });
  assert.equal(noticeLayout.briefs.length, 3, 'Standard left-side notices stay bounded to three readable cards');
  const brief = noticeLayout.briefs[0];
  noticeLayout.brief = brief;
  for (const key of ['banner', 'brief', 'title']) {
    assert.ok(noticeLayout[key].left >= 0 && noticeLayout[key].right < noticeLayout.width * .4,
      `${key} stays in the left comms rail: ${JSON.stringify(noticeLayout)}`);
  }
  assert.ok(noticeLayout.banner.bottom + 8 <= noticeLayout.briefs[0].top,
    `Banner has a reserved lane above standard cards: ${JSON.stringify(noticeLayout)}`);
  for (let i = 1; i < noticeLayout.briefs.length; i++) {
    assert.ok(noticeLayout.briefs[i - 1].bottom + 8 <= noticeLayout.briefs[i].top,
      `Standard cards do not overlap: ${JSON.stringify(noticeLayout)}`);
  }
  assert.ok(noticeLayout.briefs.at(-1).bottom + 16 <= noticeLayout.title.top,
    `Encounter identity has a reserved lane below standard cards: ${JSON.stringify(noticeLayout)}`);
  assert.ok(Math.abs(noticeLayout.instruction.left + noticeLayout.instruction.width / 2 - noticeLayout.width / 2) < 2,
    `Tutorial/instruction placement remains centered and unchanged: ${JSON.stringify(noticeLayout)}`);
  if (noticeLayout.desktopPointer) {
    assert.deepEqual([noticeLayout.boostDisplay, noticeLayout.fireDisplay], ['none', 'none'],
      'Desktop hides redundant boost and fire touch controls');
  }
  await page.evaluate(() => {
    RIFT.hud.clearNotices();
    document.getElementById('titleCard').classList.add('hidden');
  });

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

  await page.keyboard.down('c');
  await page.waitForFunction(() => RIFT.player.braking && RIFT.player._brakeVisual > .9 &&
    RIFT.player.exhaust.brakeMix > .9 && document.getElementById('boostFill').classList.contains('braking'),
  { timeout: 5000 });
  const brake = await page.evaluate(() => {
    const exhaust = RIFT.player.exhaust;
    const index = exhaust.particles.findIndex(particle => particle.life > 0);
    return {
      red: RIFT.player.engines[0].material.color.r,
      green: RIFT.player.engines[0].material.color.g,
      blue: RIFT.player.engines[0].material.color.b,
      trailMix: exhaust.brakeMix,
      trailRed: exhaust.core.instanceColor.getX(index),
      trailGreen: exhaust.core.instanceColor.getY(index),
      trailBlue: exhaust.core.instanceColor.getZ(index),
      hud: document.getElementById('boostFill').classList.contains('braking'),
    };
  });
  assert.ok(brake.hud && brake.blue > brake.red * 1.4 && brake.red > brake.green * 2 &&
    brake.trailMix > .9 && brake.trailRed > brake.trailBlue && brake.trailBlue > brake.trailGreen * 2,
  `Cut thrust uses a deep-purple engine/HUD glow and pink particle trail: ${JSON.stringify(brake)}`);
  await page.keyboard.up('c');
  await page.waitForFunction(() => !RIFT.player.braking && RIFT.player._brakeVisual < .1 &&
    RIFT.player.exhaust.brakeMix < .1 && !document.getElementById('boostFill').classList.contains('braking'),
  { timeout: 5000 });

  await page.evaluate(() => RIFT.togglePause());
  await page.waitForFunction(() => !window.RIFT.player.reticle.visible);
  assert.equal(await page.evaluate(() => RIFT.player.reticle.visible), false, 'Pause hides the flight sight');
  await page.evaluate(() => RIFT.togglePause());
  await page.waitForFunction(() => window.RIFT.player.reticle.visible);
  assert.equal(await page.evaluate(() => RIFT.player.reticle.scale.x), 1, 'Resume restores the flat non-pulsing sight');

  console.log('PASS: real browser shows flat always-on flight sight, pause hiding, hot boost ignition and deep-purple/pink cut-thrust feedback.');
} finally {
  await browser.close();
}
