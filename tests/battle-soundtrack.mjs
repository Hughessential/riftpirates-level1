import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => localStorage.setItem('riftpirates-level1-v1', JSON.stringify({
    pilotName: 'AUDIO TEST', pilotNameConfirmed: true,
  })));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled);
  const fleet = await page.evaluate(() => {
    // Inspect the active game instance, including during Vite's versioned HMR.
    const assets = new Map();
    window.RIFT.scene.traverse(object => {
      const { assetId, voxelCount, triangles } = object.userData;
      if (assetId) assets.set(assetId, { id: assetId, voxels: voxelCount, triangles });
    });
    return [...assets.values()];
  });
  assert.equal(fleet.length, 7, 'All seven supplied voxel models must load');
  assert.ok(fleet.every(asset => asset.voxels > 100 && asset.triangles > 100));
  await page.click('.menuKicker');
  await page.waitForFunction(() => window.RIFT.audio.music.title?.el.readyState >= 2);
  const title = await page.evaluate(() => ({
    owner: window.RIFT.audio.musicOwner,
    name: window.RIFT.audio.currentMusic,
    src: decodeURIComponent(window.RIFT.audio.music.title.el.currentSrc),
    duration: window.RIFT.audio.music.title.el.duration,
  }));
  assert.equal(title.owner, 'title');
  assert.equal(title.name, 'title');
  assert.ok(title.src.endsWith('/music/Rift Pirates OFFICIAL Main Title Theme.mp3'));
  assert.ok(title.duration > 268 && title.duration < 271);
  await page.click('#launchBtn');
  await page.evaluate(() => {
    const g = window.RIFT;
    g.renderFrame = () => {};
    g.update = () => {};
    g.player.takeDamage = () => false;
  });
  const encounters = [
    ['TOWER_1_INTRO', 'TOWER_1_COMBAT'], ['TOWER_2_INTRO', 'TOWER_2_COMBAT'],
    ['TOWER_3_INTRO', 'TOWER_3_COMBAT'], ['INHIBITOR_INTRO', 'INHIBITOR_COMBAT'],
    ['BOSS_INTRO', 'BOSS_COMBAT'],
  ];
  for (const [intro, combat] of encounters) {
    await page.evaluate(state => {
      const g = window.RIFT;
      if (g.encounter) g.encounter.dispose();
      g.encounter = null;
      // Force a new transition each time, just as approaches do in the run.
      g.audio.playMusic('level1_a', 0.01);
      g.director.go(state);
    }, intro);
    await page.waitForFunction(() => window.RIFT.audio.music.battle?.el.readyState >= 2);
    const audio = await page.evaluate(() => {
      const manager = window.RIFT.audio;
      const el = manager.music.battle.el;
      return { cue: manager.currentMusic, src: el.currentSrc || el.src,
        loop: el.loop, duration: el.duration, error: el.error?.code || null };
    });
    assert.equal(audio.cue, 'battle', `${intro} must use the new soundtrack`);
    assert.ok(decodeURIComponent(audio.src).endsWith('/music/Boss Battle OFFICAL soundtrack.mp3'));
    assert.equal(audio.loop, false, 'Full recordings use deliberate tail fades and same-theme restarts');
    assert.ok(audio.duration > 260 && audio.duration < 263, 'Official boss recording must decode as the supplied 261s track');
    assert.equal(audio.error, null);
    await page.evaluate(state => {
      window.RIFT.audio.music.battle.el.currentTime = 12;
      window.RIFT.director.go(state);
    }, combat);
    assert.ok(await page.evaluate(() => window.RIFT.audio.music.battle.el.currentTime >= 12),
      'Intro-to-combat must not restart the song');
    console.log(`${combat}: official boss theme continues from intro`);
  }
  await page.evaluate(() => window.RIFT.togglePause());
  assert.equal(await page.evaluate(() => window.RIFT.audio.music.battle.el.paused), true);
  await page.evaluate(() => window.RIFT.togglePause());
  await page.waitForFunction(() => !window.RIFT.audio.music.battle.el.paused);
  await page.evaluate(() => {
    const a = window.RIFT.audio;
    a.setMusicEnabled(false);
  });
  assert.equal(await page.evaluate(() => window.RIFT.audio.music.battle.el.paused), true);
  await page.evaluate(() => window.RIFT.audio.setMusicEnabled(true));
  await page.waitForFunction(() => !window.RIFT.audio.music.battle.el.paused);
  await page.evaluate(() => {
    const a = window.RIFT.audio;
    a.playBattle(.01, { restart: true });
    a.update(.02);
  });
  assert.ok(await page.evaluate(() => window.RIFT.audio.music.battle.el.currentTime < 1), 'New attempt restarts the official theme');
  await page.evaluate(() => window.RIFT.audio.playEscape(.01));
  await page.waitForFunction(() => window.RIFT.audio.music.escape?.el.readyState >= 2);
  const escape = await page.evaluate(() => {
    const a = window.RIFT.audio;
    const before = a.music.escape.el.currentTime;
    a.syncEscapeTime(50);
    const uninterrupted = Math.abs(a.music.escape.el.currentTime - before) < .1;
    a.setMusicPaused('escape-study', true);
    a.syncEscapeTime(50);
    a.setMusicPaused('escape-study', false);
    return { name: a.currentMusic, src: decodeURIComponent(a.music.escape.el.currentSrc),
      duration: a.music.escape.el.duration, rate: a.music.escape.el.playbackRate,
      time: a.music.escape.el.currentTime, uninterrupted };
  });
  assert.equal(escape.name, 'escape');
  assert.ok(escape.src.endsWith('/music/The Very Very End.mp3'));
  assert.ok(escape.duration > 139 && escape.duration < 141);
  assert.equal(escape.rate, 1);
  assert.equal(escape.uninterrupted, true, 'Live recording is not scrubbed to a slow simulation clock');
  assert.ok(Math.abs(escape.time - 50) < 1);
  await page.evaluate(() => document.getElementById('toTitleBtn').click());
  assert.equal(await page.evaluate(() => window.RIFT.audio.currentMusic), 'title', 'Return selects official title theme');
  assert.deepEqual(errors, []);
  console.log('PASS: seven real voxel assets; all five battle cues; song decode, deliberate continuation and pause/resume.');
} finally {
  await browser.close();
}
