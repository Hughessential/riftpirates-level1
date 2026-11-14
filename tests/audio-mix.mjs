/** Real WebAudio graph rendered offline: no speaker/listening claim. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 120000,
  args: ['--no-sandbox', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  // The test only needs the application's modules, not the WebGL scene.
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/src/main.js') {
      request.respond({ status: 200, contentType: 'application/javascript', body: '' });
    } else request.continue();
  });
  await page.evaluateOnNewDocument(() => {
    window.WebSocket = class extends EventTarget { send() {} close() {} };
  });
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded' });
  const report = await page.evaluate(async () => {
    const { AudioManagerImpl } = await import('/src/core/AudioManager.js');
    const { Save } = await import('/src/core/SaveSystem.js');
    const NativeContext = window.AudioContext;
    const rate = 48000, seconds = 2;
    const summaries = [];
    async function render({ legacy = false, musicVolume = 1, sfxVolume = 1, musicOnly = false, warped = false } = {}) {
      const context = new OfflineAudioContext(2, rate * seconds, rate);
      window.AudioContext = function () { return context; };
      Object.assign(Save.data, { music: 1, sfx: 1, musicVolume, sfxVolume });
      const manager = new AudioManagerImpl();
      manager._loadSfx = async () => {};
      try { await manager.init(); } finally { window.AudioContext = NativeContext; }
      if (!manager.mixLimiter || !manager.mixBus) throw new Error('The final mixed-output limiter is missing');
      if (legacy) {
        // Reproduce the previous wiring, keeping the exact existing SFX limiter.
        manager.musicGain.disconnect(); manager.warpFilter.disconnect();
        manager.musicGain.connect(context.destination);
        manager.warpFilter.connect(context.destination);
      }
      if (warped) manager.warp(1);
      const music = context.createBuffer(2, rate * seconds, rate);
      for (let channel = 0; channel < 2; channel++) {
        const data = music.getChannelData(channel);
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.sin(2 * Math.PI * 440 * i / rate) * (musicOnly ? .2 : .71)
            * Math.min(1, i / (rate * .01));
        }
      }
      const song = context.createBufferSource(); song.buffer = music;
      song.connect(manager.musicGain); song.start();
      if (!musicOnly) {
        const shot = context.createBuffer(2, rate * .12, rate);
        for (let channel = 0; channel < 2; channel++) {
          const data = shot.getChannelData(channel);
          for (let i = 0; i < data.length; i++) {
            const t = i / rate;
            const envelope = Math.min(1, t / .003, (.12 - t) / .018);
            data[i] = Math.sin(2 * Math.PI * 880 * t) * .48 * envelope;
          }
        }
        // Eighteen overlapping voices mirror the existing maximum weapon bank.
        // Additional combat cues share this same protected SFX path.
        for (const at of [.25, .6, .95, 1.3, 1.65]) for (let voice = 0; voice < 18; voice++) {
          const source = context.createBufferSource(); source.buffer = shot;
          source.connect(manager.sfxGain); source.start(at);
        }
      }
      const rendered = await context.startRendering();
      const data = rendered.getChannelData(0);
      let peak = 0, energy = 0, over = 0, nonfinite = 0;
      for (const sample of data) {
        if (!Number.isFinite(sample)) nonfinite++;
        peak = Math.max(peak, Math.abs(sample)); energy += sample * sample;
        if (Math.abs(sample) > 1) over++;
      }
      const summary = { legacy, musicVolume, sfxVolume, musicOnly, warped,
        peak, rms: Math.sqrt(energy / data.length), over, nonfinite };
      summaries.push(summary);
      return { data, summary };
    }
    const oldDefault = await render({ legacy: true, musicVolume: .75, sfxVolume: .75 });
    const safeDefault = await render({ musicVolume: .75, sfxVolume: .75 });
    const oldMaximum = await render({ legacy: true });
    const safeMaximum = await render();
    const cleanMusic = await render({ musicOnly: true });
    const deathMusic = await render({ musicOnly: true, warped: true });
    let warpDifference = 0;
    for (let i = 0; i < cleanMusic.data.length; i++) {
      warpDifference = Math.max(warpDifference, Math.abs(cleanMusic.data[i] - deathMusic.data[i]));
    }
    let risingCrossings = 0;
    for (let i = rate; i < 2 * rate; i++) if (cleanMusic.data[i - 1] <= 0 && cleanMusic.data[i] > 0) risingCrossings++;
    return { summaries, oldDefault: oldDefault.summary, safeDefault: safeDefault.summary,
      oldMaximum: oldMaximum.summary, safeMaximum: safeMaximum.summary, warpDifference, risingCrossings };
  });
  console.table(report.summaries.map(({ legacy, musicVolume, sfxVolume, musicOnly, warped, peak, over }) =>
    ({ legacy, musicVolume, sfxVolume, musicOnly, warped, peak: +peak.toFixed(4), over })));
  assert.ok(report.oldMaximum.peak > 1 && report.oldMaximum.over > 0,
    'The prior output graph reproduces clipped mixed samples under a dense barrage');
  assert.ok(report.safeMaximum.peak < 1 && report.safeMaximum.over === 0,
    'Maximum user levels retain output headroom during a dense barrage');
  assert.ok(report.safeDefault.peak < 1 && report.safeDefault.over === 0,
    'Default music and SFX levels remain below clipping');
  assert.ok(report.summaries.every(summary => summary.nonfinite === 0 && summary.rms > 0));
  assert.equal(report.warpDifference, 0, 'Death filtering cannot alter the music spectrum');
  assert.equal(report.risingCrossings, 440, 'The music signal keeps its original frequency and tempo');
  console.log('PASS: actual offline WebAudio mix, dense barrage headroom at default/max sliders, finite samples, unwarped music and unchanged playback frequency.');
} finally { await browser.close(); }
