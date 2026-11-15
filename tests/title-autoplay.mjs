/** Test real browser autoplay policies, including playback before voxel loading. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const launchOptions = policy => ({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 120000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio',
    `--autoplay-policy=${policy}`, '--disable-features=MediaEngagementBypassAutoplayPolicies'],
});
for (const mode of ['allowed', 'blocked', 'muted']) {
  const browser = await puppeteer.launch(launchOptions(mode === 'blocked' ? 'document-user-activation-required' : 'no-user-gesture-required'));
  try {
    const page = await browser.newPage();
    const errors = [], held = [], sfxRequests = [], musicRequests = [];
    let holdVoxels = true;
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(mode => {
      window.WebSocket = class extends EventTarget { send() {} close() {} };
      localStorage.setItem('riftpirates-level1-v1', JSON.stringify({ music: mode === 'muted' ? 0 : 1, musicVolume: .37,
        pilotName: 'MUSIC TEST', pilotNameConfirmed: true }));
      window.__createdMusic = [];
      const NativeAudio = window.Audio;
      window.Audio = function (...args) {
        const media = new NativeAudio(...args);
        __createdMusic.push(media);
        return media;
      };
      const NativeContext = window.AudioContext;
      window.AudioContext = class extends NativeContext {
        constructor(...args) { super(...args); window.__titleContext = this; }
      };
    }, mode);
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.url().includes('/sfx/')) sfxRequests.push(req.url());
      if (req.url().includes('/music/')) musicRequests.push(req.url());
      if (holdVoxels && req.url().endsWith('.vox')) held.push(req);
      else req.continue();
    });
    await page.goto(process.env.RIFT_TEST_URL || 'http://localhost:8000/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(mode => __createdMusic.length === 1
      && (mode === 'muted' || __createdMusic[0].readyState >= 2), { timeout: 30000 }, mode);
    assert.ok(held.length > 0, 'Voxel loading is actually delayed');
    assert.equal(await page.evaluate(() => Boolean(window.RIFT)), false, 'Music starts independently of game/ship initialization');
    assert.equal(sfxRequests.length, 0, 'First-load music does not compete with SFX decoding');
    let snapshot = await page.evaluate(() => ({ paused: __createdMusic[0].paused, time: __createdMusic[0].currentTime,
      context: __titleContext.state, src: decodeURIComponent(__createdMusic[0].src) }));
    assert.ok(snapshot.src.endsWith('/music/Rift Pirates OFFICIAL Main Title Theme.mp3'));
    if (mode === 'allowed') {
      await page.waitForFunction(() => __titleContext.state === 'running' && !__createdMusic[0].paused && __createdMusic[0].currentTime > .15);
    } else if (mode === 'blocked') {
      assert.equal(snapshot.context, 'suspended', 'Restricted autoplay stays subject to browser policy');
      await page.mouse.click(30, 30);
      await page.waitForFunction(() => __titleContext.state === 'running' && !__createdMusic[0].paused && __createdMusic[0].currentTime > .15);
      assert.ok(sfxRequests.length > 0, 'The first genuine interaction starts deferred SFX loading');
    } else {
      assert.equal(snapshot.paused, true, 'Saved mute cannot be overridden by startup autoplay');
      assert.equal(musicRequests.length, 0, 'Saved mute does not preload the title recording');
    }
    const earlyTime = await page.evaluate(() => __createdMusic[0].currentTime);
    holdVoxels = false;
    await Promise.all(held.map(request => request.continue()));
    await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
    assert.equal(await page.evaluate(() => __createdMusic.length), 1, 'Rendering the title cannot duplicate its recording');
    assert.ok(await page.evaluate(time => __createdMusic[0].currentTime >= time, earlyTime), 'Completing boot cannot rewind the title theme');
    assert.equal(await page.evaluate(() => RIFT.audio.musicVol), .37, 'Early startup respects saved volume');
    if (mode === 'allowed') {
      const singleton = await page.evaluate(async () => {
        const first = (await import('/src/core/AudioManager.js?singleton-regression=one')).Audio2;
        const second = (await import('/src/core/AudioManager.js?singleton-regression=two')).Audio2;
        first.playTitle(0);
        await first.init({ loadSfx: false });
        second.playTitle(0);
        await second.init({ loadSfx: false });
        first.setMusicVolume(.2);
        second.setMasterVolume(.4);
        return {
          first: first === RIFT.audio,
          second: second === RIFT.audio,
          created: __createdMusic.length,
          active: __createdMusic.filter(media => !media.paused).length,
          musicGain: Number(RIFT.audio.musicGain.gain.value.toFixed(6)),
          masterGain: Number(RIFT.audio.outputGain.gain.value.toFixed(6)),
        };
      });
      assert.deepEqual(singleton, {
        first: true,
        second: true,
        created: 1,
        active: 1,
        musicGain: .03,
        masterGain: .152,
      }, 'Cache-busted module evaluations share the title player and its live mixer controls');
    }
    if (mode !== 'muted') {
      await page.mouse.click(30, 30);
      await page.waitForFunction(() => Boolean(RIFT.audio.buffers.ui_select), { timeout: 30000 });
      assert.ok(sfxRequests.length > 0);
      await page.click('#launchBtn');
      await page.waitForFunction(() => RIFT.running);
      assert.equal(await page.evaluate(() => RIFT.audio.musicOwner), 'gameplay');
      await page.evaluate(() => { RIFT.quitRun(); document.getElementById('toTitleBtn').click(); });
      assert.equal(await page.evaluate(() => RIFT.audio.currentMusic), 'title');
      assert.equal(await page.evaluate(() => RIFT.audio._sfxLoad != null), true);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: title startup ${mode}, before voxel loading; saved settings, one recording, gesture fallback and normal routing.`);
  } finally { await browser.close(); }
}
