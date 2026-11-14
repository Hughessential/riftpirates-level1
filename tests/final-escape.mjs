import { launchRun } from './helpers/start-run.mjs';
/** Ending integration + honest escape difficulty. Uses a fresh Chrome profile. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { PILOT_IDENTITY_DEFAULTS } from '../src/core/PilotName.js';
import { AUDIO_DEFAULTS, UI_SCALE_DEFAULT } from '../src/core/SaveSystem.js';

const legacy = { scrapBanked: 321, bestScore: 1234567, bestTime: 900, bestGrade: 'S',
  runs: 11, clears: 4, music: 0, sfx: 1, seenIntro: 1, selectedShip: 'void-corsair' };
const migratedLegacy = { ...legacy, ...AUDIO_DEFAULTS, uiScale: UI_SCALE_DEFAULT, tutorialComplete: false,
  ...PILOT_IDENTITY_DEFAULTS, lastBankedRunId: '' };
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(data => localStorage.setItem('riftpirates-level1-v1', JSON.stringify(data)), legacy);
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  assert.deepEqual(await page.evaluate(() => window.RIFT.save.data), migratedLegacy, 'Existing progress and mute settings survive; new volume controls receive defaults');
  await launchRun(page);
  migratedLegacy.pilotNameConfirmed = true;
  await page.evaluate(async () => {
    const g = window.RIFT;
    window.__escapeStep = g.update.bind(g); window.__escapeRender = g.renderFrame.bind(g);
    g.update = () => {}; g.renderFrame = () => {};
    const inputUrl = performance.getEntriesByType('resource')
      .find(entry => /\/src\/core\/Input\.js(?:\?|$)/.test(entry.name)).name;
    window.__escapeInput = (await import(inputUrl)).Input;
    window.__escapeBankCalls = 0;
    const bank = g.save.bankRun.bind(g.save);
    g.save.bankRun = run => { window.__escapeBankCalls++; return bank(run); };
  });
  const step = seconds => page.evaluate(seconds => {
    for (let i = 0; i < Math.ceil(seconds * 60); i++) window.__escapeStep(1 / 60);
  }, seconds);
  const snapshot = () => page.evaluate(() => {
    const g = window.RIFT;
    return { state: g.director.state, running: g.running, alive: g.player.alive,
      save: { ...g.save.data }, bankCalls: window.__escapeBankCalls,
      resultVisible: !document.getElementById('resultsScreen').classList.contains('hidden'),
      escape: g.escape?.snapshot() ?? null };
  });

  // Exercise the real Admiral destruction callback, not a direct ending jump.
  await page.evaluate(() => {
    const g = window.RIFT;
    g.director.go('BOSS_INTRO'); g.director.go('BOSS_COMBAT');
    g.encounter.bossHp = 1; g.encounter._bossDamage(1e6);
  });
  await step(4.4);
  let s = await snapshot();
  assert.equal(s.state, 'ESCAPE', 'Admiral destruction enters the escape');
  assert.equal(s.resultVisible, false, 'Admiral defeat must not finalize victory');
  assert.equal(s.bankCalls, 0); assert.deepEqual(s.save, migratedLegacy);
  assert.equal(await page.evaluate(() => window.RIFT.audio.currentMusic), 'escape');
  assert.equal(await page.$eval('#objectiveName', e => e.textContent), 'REACH THE FINAL RIFT');
  assert.equal(await page.evaluate(() => window.RIFT.upgradeScreen.open), false);
  assert.deepEqual(await page.evaluate(() => ({ guardians: window.RIFT.worldShowcase.worldRoot.visible,
    ordinaryDebris: window.RIFT.env.livingDebris.group.visible })),
    { guardians: false, ordinaryDebris: false }, 'The escape clears ordinary scenery for readable collapse lanes');

  // Gameplay clock, route, shield lockout and sound all hold through pause.
  const pause = await page.evaluate(() => {
    const g = window.RIFT;
    g.player.shield = 0; g.player.shieldBroken = true; g.player.timeSinceHit = 0;
    g.togglePause();
    const before = [g.escape.elapsed, g.escape.distance, g.player.shieldRecoveryRemaining];
    for (let i = 0; i < 120; i++) window.__escapeStep(1 / 60);
    const after = [g.escape.elapsed, g.escape.distance, g.player.shieldRecoveryRemaining];
    const soundPaused = g.audio.music.escape.el.paused;
    g.togglePause();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const backgroundPaused = g.paused;
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
    const staysPaused = g.paused;
    g.togglePause();
    return { before, after, soundPaused, backgroundPaused, staysPaused };
  });
  assert.deepEqual(pause.after, pause.before);
  assert.ok(pause.soundPaused && pause.backgroundPaused && pause.staysPaused,
    'Background tabs pause music/time and require deliberate resume');

  // Reaching route distance outside the aperture is not victory; steering into
  // the actual rift is. This is a transition probe, separate from fair pilots below.
  const missed = await page.evaluate(() => {
    const g = window.RIFT, e = g.escape;
    e.distance = e.routeLength - .1;
    g.player.x = 20; g.player.y = -8; g.player.vx = g.player.vy = 0;
    window.__escapeStep(1 / 60);
    return { state: g.director.state, calls: window.__escapeBankCalls };
  });
  assert.equal(missed.state, 'ESCAPE'); assert.equal(missed.calls, 0);
  await page.evaluate(() => {
    const g = window.RIFT, rift = g.escape.snapshot().rift;
    g.player.x = rift.x; g.player.y = rift.y; g.player.vx = g.player.vy = 0;
    window.__escapeStep(1 / 60);
  });
  await step(3);
  s = await snapshot();
  assert.equal(s.state, 'VICTORY'); assert.equal(s.resultVisible, true);
  assert.equal(s.bankCalls, 1); assert.equal(s.save.runs, legacy.runs + 1); assert.equal(s.save.clears, legacy.clears + 1);
  const savedVictory = s.save;
  await page.evaluate(() => {
    const g = window.RIFT;
    g.onBossDefeated(); g.completeEscape(); g.showResults({ victory: true }); g.showResults({ victory: false });
  });
  assert.deepEqual((await snapshot()).save, savedVictory, 'Repeated ending callbacks cannot award again');
  assert.equal((await snapshot()).bankCalls, 1);

  // Deadline is a gameplay failure even with Second Wind; it is not an audio
  // event and cannot be survived by applying an arbitrarily large damage value.
  await page.evaluate(() => {
    const g = window.RIFT;
    g.startRun(); g.director.go('ESCAPE');
    g.player.stats.secondWind = 5;
    g.escape.elapsed = g.escape.deadline - .001;
    g.escape.distance = 0;
    window.__escapeStep(1 / 60);
  });
  await step(3.2);
  s = await snapshot();
  assert.equal(s.resultVisible, true); assert.equal(s.bankCalls, 2);
  assert.equal(s.save.clears, savedVictory.clears, 'Timeout never banks a clear');
  assert.equal(s.save.runs, savedVictory.runs + 1);
  assert.match(await page.$eval('#deathLine', e => e.textContent), /COLLAPSE|ESCAPE|RIFT/i);

  // Real hull death remains the existing failure path.
  await page.evaluate(() => {
    const g = window.RIFT;
    g.startRun(); g.director.go('ESCAPE');
    g.player.invuln = 0;
    g.player.takeDamage(1e6, 'ESCAPE TEST HULL FAILURE');
  });
  await step(3.2);
  assert.equal((await snapshot()).bankCalls, 3);
  assert.match(await page.$eval('#deathLine', e => e.textContent), /ESCAPE TEST HULL FAILURE/);

  const beforeLab = (await snapshot()).save;
  assert.ok(await page.$('#labScene option[value="escape"]'), 'The escape is selectable in the existing lab UI');
  await page.evaluate(() => {
    const g = window.RIFT, lab = g.testing;
    lab.enter(); lab.setShip('neon-wraith'); lab.setAugmentRank('prismLance', 2); lab.setXPLevel(8);
    lab.loadScene('escape'); lab.setPanelOpen(true);
  });
  const held = await page.evaluate(() => {
    const g = window.RIFT, before = g.escape.elapsed;
    for (let i = 0; i < 120; i++) window.__escapeStep(1 / 60);
    return { before, after: g.escape.elapsed, paused: g.audio.music.escape.el.paused };
  });
  assert.equal(held.after, held.before); assert.equal(held.paused, true);
  const retry = await page.evaluate(() => {
    const g = window.RIFT, lab = g.testing;
    const build = { ranks: { ...g.upgrades.ranks }, ship: g.player.shipId, level: g.xp.level };
    lab.setPanelOpen(false); lab.setSetting('godMode', false);
    g.player.takeDamage(1e6, 'LAB ESCAPE FAILURE');
    lab.restorePlayer();
    return { build, after: { ranks: { ...g.upgrades.ranks }, ship: g.player.shipId, level: g.xp.level },
      state: g.director.state, active: g.escape.active, elapsed: g.escape.elapsed, alive: g.player.alive };
  });
  assert.deepEqual(retry.after, retry.build);
  assert.equal(retry.state, 'ESCAPE'); assert.equal(retry.active, true); assert.equal(retry.elapsed, 0); assert.equal(retry.alive, true);
  const clocks = await page.evaluate(() => {
    const g = window.RIFT, lab = g.testing;
    lab.setSetting('timeScale', .5);
    const slowStart = g.escape.elapsed;
    for (let i = 0; i < 120; i++) window.__escapeStep(1 / 60);
    const slowElapsed = g.escape.elapsed - slowStart;
    const studyHeld = g.audio.music.escape.el.paused;
    const playbackRate = g.audio.music.escape.el.playbackRate;
    lab.setSetting('timeScale', 1);
    lab.setAugmentRank('timeDilation', 1);
    g.augmentEffects.onPerfectDodge();
    const dodgeStart = g.escape.elapsed;
    for (let i = 0; i < 60; i++) window.__escapeStep(1 / 60);
    const dodgeElapsed = g.escape.elapsed - dodgeStart;
    const dilationActive = g.augmentEffects.dilationT > 0;
    lab.setAugmentRank('timeDilation', 0);
    return { slowElapsed, studyHeld, playbackRate, dodgeElapsed, dilationActive };
  });
  assert.ok(Math.abs(clocks.slowElapsed - 1) < 1e-6);
  assert.ok(clocks.studyHeld); assert.equal(clocks.playbackRate, 1, 'Lab frame study does not repitch the recording');
  assert.ok(Math.abs(clocks.dodgeElapsed - 1) < 1e-6 && clocks.dilationActive,
    'Perfect Dodge projectile slow leaves the escape deadline at normal speed');

  const naturalLab = await page.evaluate(() => {
    const g = window.RIFT;
    g.testing.setBossPhase(4); g.testing.setPanelOpen(false);
    g.encounter.bossHp = 1; g.encounter._bossDamage(1e6);
    for (let i = 0; i < 270; i++) window.__escapeStep(1 / 60);
    return { state: g.director.state, scene: g.testing.sceneId, ship: g.player.shipId,
      rank: g.upgrades.rank('prismLance'), level: g.xp.level };
  });
  assert.deepEqual(naturalLab, { state: 'ESCAPE', scene: 'escape', ship: 'neon-wraith', rank: 2, level: 8 },
    'Natural lab Admiral defeat preserves the build and changes the retry destination to escape');
  await page.evaluate(() => {
    const g = window.RIFT;
    g.testing.setSetting('godMode', true); g.failEscape('GALAXY COLLAPSE');
  });
  await step(3.2);
  assert.deepEqual((await snapshot()).save, beforeLab, 'Lab failure never writes scores, scrap or clears');
  assert.equal((await snapshot()).bankCalls, 3);
  await page.evaluate(() => {
    window.RIFT.testing.loadScene('sandbox'); window.RIFT.testing.setPanelOpen(false);
    window.__escapeStep(1 / 60);
  });
  assert.deepEqual(await page.evaluate(() => ({ guardians: window.RIFT.worldShowcase.worldRoot.visible,
    ordinaryDebris: window.RIFT.env.livingDebris.group.visible })),
    { guardians: true, ordinaryDebris: true }, 'Leaving the escape restores ordinary scenery');
  assert.equal(await page.evaluate(() => window.RIFT.escape?.active || false), false, 'Scene changes dispose the escape');

  // 13 real augment picks, ordinary health and movement, no invulnerability,
  // infinite boost, frozen foes, unlimited rolls or damage overrides. This pilot
  // sees only the next visible aperture; it steers with bounded analog input.
  const builds = {
    balanced: ['rapidFire','twinFangs','hotshot','prismLance','seekerSwarm','armorPlating','hullBoost',
      'shieldRecharge','vectorThrusters','afterburner','reactorRecovery','repairSwarm','timeDilation'],
    arsenal: ['rapidFire','rapidFire','hotshot','twinFangs','helixVolley','prismLance','seekerSwarm',
      'scatterNova','teslaFork','fragmentation','voidMortar','armorPlating','hullBoost'],
    survival: ['hullBoost','hullBoost','armorPlating','shieldRecharge','repairSwarm','secondWind','riftDrain',
      'vectorThrusters','afterburner','reactorRecovery','rapidFire','seekerSwarm','hotshot'],
  };
  const reports = [];
  for (const [name, build] of Object.entries(builds)) {
    const report = await page.evaluate(({ name, build }) => {
      const g = window.RIFT, lab = g.testing, input = window.__escapeInput;
      lab.enter(); lab.applyPreset('empty'); lab.setXPLevel(8);
      for (const id of build) lab.setAugmentRank(id, g.upgrades.rank(id) + 1);
      for (const key of ['godMode','infiniteBoost','unlimitedRolls','autoFire','freezeEnemies']) lab.setSetting(key, false);
      lab.setSetting('timeScale', 1); lab.loadScene('escape'); lab.setPanelOpen(false);
      const oldRead = input.read.bind(input);
      let target = { x: 0, y: 2 }, nextSample = 0, boostedFrames = 0, peakHazards = 0, peakProjectiles = 0;
      let damagingHits = 0, shieldAndHullLost = 0;
      input.read = () => ({ x: Math.max(-1, Math.min(1, (target.x - g.player.x) * .55)),
        y: Math.max(-1, Math.min(1, (target.y - g.player.y) * .65)), boost: true });
      input._keys.Space = true;
      const startHealth = g.player.health, startDamage = g.stats.damageTaken;
      try {
        for (let frame = 0; frame < 142 * 60 && g.running; frame++) {
          if (g.director.state === 'ESCAPE' && frame >= nextSample) {
            const snap = g.escape.snapshot();
            target = snap.nextGate || snap.rift;
            nextSample = frame + 12; // 200ms observation / reaction cadence
          }
          const protection = g.player.health + g.player.shield;
          window.__escapeStep(1 / 60);
          const loss = protection - g.player.health - g.player.shield;
          if (loss > .01) { damagingHits++; shieldAndHullLost += loss; }
          if (g.player.boosting) boostedFrames++;
          peakHazards = Math.max(peakHazards, g.hazards.length);
          peakProjectiles = Math.max(peakProjectiles, g.projectiles.enemy.filter(b => b.active).length);
        }
      } finally { input.read = oldRead; input.reset(); }
      return { name, picks: g.upgrades.taken.length, state: g.director.state, alive: g.player.alive,
        startHealth, health: +g.player.health.toFixed(1), damage: +(g.stats.damageTaken - startDamage).toFixed(1),
        elapsed: g.escape.elapsed, remaining: g.escape.remaining, distance: g.escape.distance,
        boostedSeconds: +(boostedFrames / 60).toFixed(1), damagingHits, shieldAndHullLost: +shieldAndHullLost.toFixed(1),
        peakHazards, peakProjectiles,
        save: { ...g.save.data }, cheats: { ...lab.settings }, resultVisible: !document.getElementById('resultsScreen').classList.contains('hidden') };
    }, { name, build });
    assert.equal(report.picks, 13);
    assert.equal(report.cheats.godMode, false); assert.equal(report.cheats.infiniteBoost, false);
    assert.ok(report.peakHazards < 32, 'Escape hazards remain bounded');
    assert.deepEqual(report.save, beforeLab, 'A completed mortal lab escape never banks rewards');
    reports.push(report);
  }
  assert.ok(reports.some(r => r.state === 'VICTORY'), 'A representative legal build can reach the rift through real steering/collisions');
  const parked = await page.evaluate(() => {
    const g = window.RIFT, lab = g.testing;
    lab.loadScene('escape'); lab.setPanelOpen(false);
    window.__escapeInput.reset();
    for (let frame = 0; frame < 142 * 60 && g.running; frame++) window.__escapeStep(1 / 60);
    return { state: g.director.state, alive: g.player.alive, damage: g.stats.damageTaken,
      save: { ...g.save.data }, calls: window.__escapeBankCalls };
  });
  assert.notEqual(parked.state, 'VICTORY', 'Standing still is not an automatic win');
  assert.deepEqual(parked.save, beforeLab); assert.equal(parked.calls, 3);
  const cleanup = await page.evaluate(() => {
    const g = window.RIFT;
    g.testing.exit();
    const disposed = !g.escape.active && !g.scene.getObjectByName('final-escape');
    g.startRun();
    const before = g.player.shield;
    const hit = g.player.takeDamage(5, 'NORMAL RUN AFTER ESCAPE LAB');
    return { disposed, active: g.testing.active, hit, vulnerable: g.player.shield < before,
      ranks: Object.values(g.upgrades.ranks).filter(Boolean).length };
  });
  assert.deepEqual(cleanup, { disposed: true, active: false, hit: true, vulnerable: true, ranks: 0 },
    'Leaving the escape lab cleans up the ending and all cheats before a normal run');

  // A missing soundtrack cannot stop flight or select an unrelated song.
  // This separate tab also has isolated, synthetic save data.
  const silentPage = await browser.newPage();
  silentPage.on('pageerror', e => errors.push(e.message));
  await silentPage.evaluateOnNewDocument(data => localStorage.setItem('riftpirates-level1-v1',
    JSON.stringify({ ...data, music: 1 })), legacy);
  await silentPage.setCacheEnabled(false);
  await silentPage.setRequestInterception(true);
  let blockedFinale = 0;
  silentPage.on('request', req => {
    if (decodeURIComponent(req.url()).endsWith('/music/The Very Very End.mp3')) { blockedFinale++; req.abort(); }
    else req.continue();
  });
  await silentPage.goto('http://localhost:8000/?lab=unlock', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await silentPage.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled,
    { timeout: 120000 });
  await silentPage.click('#testingGroundsBtn');
  const silent = await silentPage.evaluate(() => {
    const g = window.RIFT;
    const update = g.update.bind(g); g.update = () => {}; g.renderFrame = () => {};
    g.testing.loadScene('escape'); g.testing.setPanelOpen(false);
    for (let i = 0; i < 180; i++) update(1 / 60);
    g.audio.music.escape.el.dispatchEvent(new Event('ended'));
    return { state: g.director.state, elapsed: g.escape.elapsed, running: g.running,
      cue: g.audio.currentMusic, music: g.save.data.music };
  });
  assert.equal(silent.state, 'ESCAPE'); assert.equal(silent.running, true);
  assert.ok(silent.elapsed >= 2.9); assert.equal(silent.cue, 'escape');
  assert.equal(silent.music, 1, 'Unavailable audio is distinct from muting music');
  await silentPage.waitForFunction(() => window.RIFT.audio._unavailable.has('escape'), { timeout: 30000 });
  assert.ok(blockedFinale > 0, 'The finale request was actually blocked');
  assert.equal(await silentPage.evaluate(() => window.RIFT.director.state), 'ESCAPE',
    'A confirmed audio failure cannot end the escape');
  await silentPage.close();

  console.table(reports.map(({ cheats, save, ...r }) => r));
  console.log('Parked:', JSON.stringify({ state: parked.state, alive: parked.alive, damage: parked.damage }));
  assert.deepEqual(errors, [], 'No runtime errors in the ending or test grounds');
  console.log('PASS: Admiral→escape, actual rift entry, timeout/death, once-only results, legacy saves, pause/background, lab retry/isolation, and legal-build movement pilots.');
} finally {
  const child = browser.process();
  const timer = setTimeout(() => { browser.disconnect(); child?.kill('SIGTERM'); }, 5000);
  try { await browser.close(); } finally { clearTimeout(timer); }
}
