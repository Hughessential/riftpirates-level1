/** Decode the original WAVs and render three real WebAudio loop wraps offline.
 * This verifies transport/seam output numerically; it is not a listening test. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => new URL(request.url()).pathname === '/src/main.js'
    ? request.respond({ status: 200, contentType: 'application/javascript', body: '' }) : request.continue());
  await page.goto(process.env.RIFT_TEST_URL || 'http://localhost:8000/', { waitUntil: 'domcontentloaded' });
  const report = await page.evaluate(async () => {
    const { ULTRA_AUDIO, prepareUltraLoop, UltraAudio } = await import('/src/core/UltraAudio.js');
    const rate = 48000;
    const ctx = new OfflineAudioContext(2, rate * 98, rate);
    const load = async name => ctx.decodeAudioData(await (await fetch(`/sfx/${name}`)).arrayBuffer());
    const aura = await load(ULTRA_AUDIO.transformation), teleport = await load(ULTRA_AUDIO.teleport);
    prepareUltraLoop(aura);
    const source = ctx.createBufferSource(); source.buffer = aura;
    source.loop = true; source.loopStart = ULTRA_AUDIO.loopStart; source.loopEnd = ULTRA_AUDIO.loopEnd;
    source.connect(ctx.destination); source.start(0, ULTRA_AUDIO.loopEnd - .5);
    const output = await ctx.startRendering();
    const rendered = output.getChannelData(0), samples = aura.getChannelData(0);
    let error = 0;
    for (const wrap of [.5, 48.5, 96.5]) {
      for (let i = 0; i < 1000; i++) error = Math.max(error,
        Math.abs(rendered[Math.round(wrap * rate) + i] - samples[Math.round(ULTRA_AUDIO.loopStart * rate) + i]));
    }
    const live = new AudioContext({ sampleRate: rate });
    await live.resume();
    const bus = live.createGain(); bus.gain.value = 0; bus.connect(live.destination);
    const transport = new UltraAudio({ ctx: live, ready: true, sfxGain: bus }, async () => { throw Error('Unexpected load'); });
    transport.buffers = { aura, teleport }; transport.loading = Promise.resolve();
    transport.start(.8); transport.sync(17); transport.teleport();
    const clockJoin = transport.loopVoice.offset;
    transport.sync(17.2, true);
    const paused = !transport.loopVoice && !transport.teleports[0].voice;
    transport.sync(17.2, false);
    const resumed = transport.loopVoice.offset === 17.2 && Math.abs(transport.teleports[0].voice.offset - .2) < 1e-8;
    transport.sync(120);
    const beyond88 = Math.abs(transport.loopVoice.offset - 72) < 1e-8;
    transport.stop(true);
    const cancelled = !transport.active && !transport.loopVoice && !transport.teleports.length && !transport.retiring.size;
    await live.close();
    return { durations: [aura.duration, teleport.duration], channels: [aura.numberOfChannels, teleport.numberOfChannels],
      sampleRate: aura.sampleRate, wrapError: error, clockJoin, paused, resumed, beyond88, cancelled,
      auraPeak: samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) };
  });
  assert.deepEqual(report.durations, [88, 4]);
  assert.deepEqual(report.channels, [2, 2]);
  assert.equal(report.sampleRate, 48000);
  assert.equal(report.clockJoin, 17);
  for (const key of ['paused', 'resumed', 'beyond88', 'cancelled']) assert.equal(report[key], true, key);
  assert.ok(report.wrapError < 1e-5, 'Every real WebAudio wrap starts at the selected sustain sample');
  assert.ok(report.auraPeak <= 1, 'Preparing the seam introduces no over-full-scale samples');
  console.log('PASS: original stereo WAV decoding and three sample-accurate WebAudio aura wraps.', report);
} finally { await browser.close(); }
