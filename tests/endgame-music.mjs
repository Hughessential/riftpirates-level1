/** Real media decode and terminal gameplay routing; headless audio is muted. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

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
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => localStorage.setItem('riftpirates-level1-v1', JSON.stringify({
    pilotName: 'AUDIO TEST', pilotNameConfirmed: true, music: 1, sfx: 1, seenIntro: 1,
  })));
  await page.goto(process.env.RIFT_TEST_URL || 'http://localhost:8000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled);
  await page.click('#launchBtn');
  await page.waitForFunction(() => window.RIFT.running);
  await page.evaluate(() => {
    const g = window.RIFT;
    window.__audioStep = g.update.bind(g);
    g.update = () => {}; g.renderFrame = () => {};
    window.__audioBankCalls = 0;
    const bank = g.save.bankRun.bind(g.save);
    g.save.bankRun = run => { window.__audioBankCalls++; return bank(run); };
  });
  const snapshot = () => page.evaluate(() => {
    const g = window.RIFT, a = g.audio, el = a.music[a.currentMusic]?.el;
    return { state: g.director.state, terminal: g._terminalOutcome, cue: a.currentMusic,
      owner: a.musicOwner, generation: a._generation, time: el?.currentTime,
      source: decodeURIComponent(el?.currentSrc || el?.src || ''), duration: el?.duration,
      paused: el?.paused, alive: g.player.alive, bankCalls: window.__audioBankCalls,
      finalized: g._resultsFinalized, victorySaved: g.save.data.clears,
      resultVisible: !document.getElementById('resultsScreen').classList.contains('hidden') };
  });
  const begin = state => page.evaluate(state => {
    const g = window.RIFT;
    g.startRun();
    if (state === 'TOWER_1_COMBAT') g.director.go('TOWER_1_INTRO');
    if (state === 'BOSS_COMBAT') g.director.go('BOSS_INTRO');
    g.director.go(state);
  }, state);
  const decode = name => page.waitForFunction(name => {
    const el = window.RIFT.audio.music[name]?.el;
    return el?.readyState >= 2 && Number.isFinite(el.duration) && !el.error;
  }, { timeout: 30000 }, name);
  const settle = () => page.evaluate(() => {
    for (let frame = 0; frame < 210; frame++) window.__audioStep(1 / 60);
  });

  for (const state of ['TRAVERSAL_1', 'TOWER_1_COMBAT', 'ESCAPE']) {
    await begin(state);
    const before = await snapshot();
    assert.notEqual(before.owner, 'death');
    await page.evaluate(state => {
      const g = window.RIFT, p = g.player;
      window.__terminalEncounterTicks = 0;
      if (g.encounter) {
        const tick = g.encounter.update.bind(g.encounter);
        g.encounter.update = dt => { window.__terminalEncounterTicks++; return tick(dt); };
      }
      p.invuln = 0; p.shield = 0; p.blocksLeft = 0;
      if (state === 'TOWER_1_COMBAT') {
        // Environment collisions occur midway through _updateWorld. A death
        // here must prevent the later encounter update in this SAME frame.
        p.health = 1;
        g.env.spawnAsteroid(false, { x: p.x, y: p.y, z: 0 });
        g._updateWorld(1 / 60);
      } else p.takeDamage(1e6, 'AUDIO ROUTING TEST');
    }, state);
    let result = await snapshot();
    assert.equal(result.state, 'DYING', `${state}: the real hull damage path confirms death`);
    assert.equal(result.terminal, 'defeat');
    assert.equal(result.owner, 'death', `${state}: music changes before the death animation finishes`);
    assert.equal(result.cue, 'defeat');
    await decode('defeat');
    await page.evaluate(() => { window.RIFT.audio.music.defeat.el.currentTime = 12; });
    const dying = await snapshot();
    assert.ok(dying.source.endsWith('/music/DAMNYOUDEAD.mp3'));
    assert.ok(dying.duration > 216 && dying.duration < 218, 'The supplied new death recording decodes at its full duration');
    await settle();
    assert.equal(await page.evaluate(() => window.__terminalEncounterTicks), 0,
      'No encounter ticks may spawn new hostiles after terminal death, including the lethal environment frame');
    result = await snapshot();
    assert.equal(result.resultVisible, true);
    assert.equal(result.generation, dying.generation, 'Death-to-results never starts another recording');
    assert.ok(result.time >= 12, 'Failure review carries the same playback position');
    assert.equal(result.bankCalls, before.bankCalls + 1);
    await page.evaluate(() => {
      const g = window.RIFT;
      g.showResults({ victory: false }); g.showResults({ victory: true });
    });
    assert.equal((await snapshot()).bankCalls, result.bankCalls, 'Duplicate terminal callbacks do not settle twice');
  }

  await begin('TOWER_1_COMBAT');
  const beforeRevive = await snapshot();
  const revived = await page.evaluate(() => {
    const g = window.RIFT, p = g.player;
    p.stats.secondWind = 1; p.invuln = 0; p.shield = 0; p.blocksLeft = 0;
    p.takeDamage(1e6, 'REVIVAL AUDIO TEST');
    return { alive: p.alive, used: p.secondWindUsed, deathActive: g.death.active,
      terminal: g._terminalOutcome, cue: g.audio.currentMusic, generation: g.audio._generation };
  });
  assert.ok(revived.alive && !revived.deathActive);
  assert.equal(revived.used, 1); assert.equal(revived.terminal, null);
  assert.equal(revived.cue, beforeRevive.cue);
  assert.equal(revived.generation, beforeRevive.generation, 'A successful revival never selects the death recording');

  await begin('ESCAPE');
  const beforeRescue = await snapshot();
  const rescued = await page.evaluate(() => {
    const g = window.RIFT, p = g.player;
    p.stats.endOfFear = 1; p.invuln = 0; p.shield = 0; p.blocksLeft = 0;
    p.takeDamage(1e6, 'COSMIC RESCUE AUDIO TEST');
    return { alive: p.alive, used: p.cosmicEffects.endUsed, deathActive: g.death.active,
      terminal: g._terminalOutcome, cue: g.audio.currentMusic, generation: g.audio._generation };
  });
  assert.ok(rescued.alive && rescued.used && !rescued.deathActive);
  assert.equal(rescued.terminal, null); assert.equal(rescued.cue, 'escape');
  assert.equal(rescued.generation, beforeRescue.generation, 'End of Fear preserves the escape recording after a lethal rescue');

  await begin('BOSS_COMBAT');
  await page.evaluate(() => window.RIFT.onBossDefeated());
  let result = await snapshot();
  assert.equal(result.state, 'ESCAPE'); assert.equal(result.cue, 'escape');
  assert.equal(result.terminal, null); assert.equal(result.resultVisible, false);
  await page.evaluate(() => window.RIFT.showResults({ victory: true }));
  assert.equal((await snapshot()).finalized, false, 'A direct premature results call cannot bypass the final rift');
  await page.evaluate(() => {
    const g = window.RIFT, e = g.escape, rift = e.snapshot().rift;
    e.distance = e.routeLength; g.player.x = rift.x; g.player.y = rift.y;
    e.update(1 / 60);
  });
  result = await snapshot();
  assert.equal(result.state, 'VICTORY'); assert.equal(result.terminal, 'victory');
  assert.equal(result.owner, 'victory'); assert.equal(result.cue, 'victory');
  assert.equal(result.resultVisible, true, 'Rift success immediately opens the victory presentation with its recording');
  await decode('victory');
  await page.evaluate(() => { window.RIFT.audio.music.victory.el.currentTime = 18; });
  const celebrating = await snapshot();
  assert.ok(celebrating.source.endsWith('/music/Afterthefinalescape.mp3'), 'The supplied capital-A filename resolves');
  assert.ok(celebrating.duration > 10);
  await settle();
  result = await snapshot();
  assert.ok(result.resultVisible && result.finalized);
  assert.equal(result.generation, celebrating.generation);
  assert.ok(result.time >= 18, 'Victory review carries the celebration recording without restart');
  const won = result;
  await page.evaluate(() => {
    const g = window.RIFT;
    g.player.invuln = 0; g.player.takeDamage(1e6, 'STALE HOSTILE HIT');
    g._onPlayerDeath('STALE DEATH'); g.failEscape();
    g.completeEscape(); g.showResults({ victory: false }); g.showResults({ victory: true });
  });
  result = await snapshot();
  assert.equal(result.terminal, 'victory'); assert.equal(result.cue, 'victory');
  assert.equal(result.bankCalls, won.bankCalls); assert.equal(result.victorySaved, won.victorySaved);

  // Let the browser really reach the end of each supplied recording. This is a
  // source/decode/ownership check, not a claim of a manually auditioned seam.
  for (const name of ['victory', 'defeat']) {
    if (name === 'defeat') {
      await begin('TRAVERSAL_1');
      await page.evaluate(() => window.RIFT.showResults({ victory: false }));
    }
    await decode(name);
    const generation = await page.evaluate(name => {
      const a = window.RIFT.audio;
      a.update(2); a.music[name].el.currentTime = a.music[name].el.duration - .07;
      a.resume();
      return a._generation;
    }, name);
    await page.waitForFunction(generation => window.RIFT.audio._generation > generation, { timeout: 15000 }, generation);
    assert.equal((await snapshot()).cue, name, 'Track completion deliberately repeats the same ending theme');
    assert.ok((await snapshot()).time < 2);
  }

  await page.evaluate(() => window.RIFT.audio.setMusicEnabled(false));
  await begin('ESCAPE');
  await page.evaluate(() => {
    const g = window.RIFT;
    g.player.stats.secondWind = 3; g.player.stats.endOfFear = 1;
    g.failEscape();
  });
  result = await snapshot();
  assert.equal(result.alive, false, 'Missing the final escape deadline remains terminal despite unused rescue powers');
  assert.equal(result.cue, 'defeat'); assert.equal(result.paused, true, 'Muted endings still select the correct recording');
  await settle();
  await page.evaluate(() => window.RIFT.audio.setMusicEnabled(true));
  await page.waitForFunction(() => !window.RIFT.audio.music.defeat.el.paused);
  await page.evaluate(() => document.getElementById('toTitleBtn').click());
  assert.equal((await snapshot()).cue, 'title');
  await page.click('#launchBtn');
  assert.equal((await snapshot()).owner, 'gameplay');
  await page.evaluate(() => {
    const g = window.RIFT;
    g.showResults({ victory: false }); g.startRun();
    g.showResults({ victory: false }); document.getElementById('toTitleBtn').click();
    g.audio.update(2);
  });
  assert.equal((await snapshot()).cue, 'title', 'Rapid retries and menu return leave the title in control');
  assert.ok(await page.evaluate(() => Object.values(window.RIFT.audio.music).filter(entry => !entry.el.paused).length <= 1));
  assert.deepEqual(errors, []);
  console.log('PASS: real death/victory MP3 decode, traversal/boss/escape deaths, revival suppression, genuine rift success, continuous results, same-track endings, one-time settlement, mute and rapid retry/menu routing.');
} finally {
  await browser.close();
}
