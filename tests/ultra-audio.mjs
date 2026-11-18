import assert from 'node:assert/strict';
import { UltraAudio, ULTRA_AUDIO, prepareUltraLoop, ultraAudioOffset } from '../src/core/UltraAudio.js';

class Buffer {
  constructor(duration = 88, rate = 100) {
    this.duration = duration; this.sampleRate = rate; this.numberOfChannels = 2;
    this.data = Array.from({ length: 2 }, (_, channel) => Float32Array.from(
      { length: Math.round(duration * rate) }, (_, i) => Math.sin(i * .17 + channel) * .1));
  }
  getChannelData(channel) { return this.data[channel]; }
}
class Param {
  constructor() { this.value = 0; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['ramp', value, time]); }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
}
class Context {
  constructor() { this.currentTime = 0; this.sources = []; this.gains = []; }
  createGain() {
    const gain = { gain: new Param(), connect(to) { this.to = to; }, disconnect() { this.disconnected = true; } };
    this.gains.push(gain); return gain;
  }
  createBufferSource() {
    const source = { playbackRate: { value: 0 }, connect(to) { this.to = to; },
      disconnect() { this.disconnected = true; }, start(when, offset) { this.started = { when, offset }; },
      stop(time) { this.stopped = time; } };
    this.sources.push(source); return source;
  }
  async decodeAudioData(file) { return new Buffer(file === ULTRA_AUDIO.teleport ? 4 : 88); }
}
const buffer = new Buffer(), original = buffer.data.map(data => data.slice());
assert.equal(prepareUltraLoop(buffer), true);
for (let channel = 0; channel < 2; channel++) {
  assert.deepEqual(buffer.data[channel].slice(0, 8590), original[channel].slice(0, 8590),
    'The complete transformation and initial sustained bed remain untouched');
  assert.equal(buffer.data[channel][8639], original[channel][3839],
    'The seam ends on the sample immediately preceding loopStart');
  assert.equal(buffer.data[channel][8590], original[channel][8590], 'Crossfade starts continuously');
}
assert.equal(prepareUltraLoop(new Buffer(15)), false, 'A truncated asset cannot loop the transformation');
assert.equal(ultraAudioOffset(14), 14);
assert.equal(ultraAudioOffset(86.4), 38.4);
assert.ok(Math.abs(ultraAudioOffset(200) - 56) < 1e-8);

const ctx = new Context(), manager = { ctx, ready: true, sfxGain: {} };
const audio = new UltraAudio(manager, async file => file);
await audio.preload();
assert.equal(ctx.sources.length, 0, 'Preloading cannot play anything');
audio.start(.8);
assert.equal(ctx.sources.length, 1);
assert.equal(audio.loopVoice.source.started.offset, 0);
assert.equal(audio.loopVoice.source.loop, true);
assert.deepEqual([audio.loopVoice.source.loopStart, audio.loopVoice.source.loopEnd], [38.4, 86.4]);
assert.equal(audio.loopVoice.source.playbackRate.value, 1);
assert.equal(audio.loopVoice.gain.to, manager.sfxGain, 'The aura passes through the existing SFX bus');
ctx.currentTime = 20; audio.sync(20);
assert.equal(ctx.sources.length, 1, 'Normal clock progress does not respawn sources');
audio.teleport(.8);
assert.equal(audio.teleports[0].voice.source.loop, false);
assert.equal(audio.teleports[0].voice.source.playbackRate.value, 1);
ctx.currentTime = 20.2; audio.sync(20.2);
const pausedSource = audio.loopVoice.source;
audio.sync(20.2, true);
assert.equal(pausedSource.stopped, 20.2);
assert.equal(audio.loopVoice, null);
assert.equal(audio.teleports[0].voice, null);
ctx.currentTime = 42; audio.sync(20.2, false);
assert.equal(audio.loopVoice.source.started.offset, 20.2, 'Pause does not advance the recording');
assert.ok(Math.abs(audio.teleports[0].voice.source.started.offset - .2) < 1e-8, 'Teleport tail resumes at its paused offset');
ctx.currentTime = 45; audio.sync(23.2, false, .4);
assert.equal(audio.loopVoice.level, .4 * ULTRA_AUDIO.auraTrim, 'Live tuning controls the owned aura gain');
for (let i = 0; i < 20; i++) audio.teleport();
assert.equal(audio.teleports.length, 6, 'Overlapping roll tails are bounded');
assert.ok(audio.retiring.size <= 8, 'Fading source ownership is bounded too');
ctx.currentTime = 211; audio.sync(189.2);
assert.ok(audio.loopVoice.source.started.offset === 20.2, 'The source loops without restarting during uninterrupted playback');
assert.equal(audio.teleports.length, 0, 'Finished teleport tails are removed');
audio.stop();
assert.equal(audio.active, false);
assert.equal(audio.loopVoice, null);
assert.equal(audio.teleports.length, 0);
const afterStop = ctx.sources.length;
audio.sync(200); audio.teleport();
assert.equal(ctx.sources.length, afterStop, 'Cancelled transports cannot restart or teleport');
audio.start();
assert.equal(audio.retiring.size, 0, 'Reactivation clears old fade ownership');
ctx.currentTime = 212; audio.sync(120);
assert.ok(Math.abs(audio.loopVoice.source.started.offset - 72) < 1e-8, 'Timeline correction joins the sustained loop, not the opening');
audio.stop(true);
assert.equal(audio.retiring.size, 0);

let release;
const lateContext = new Context();
const late = new UltraAudio({ ctx: lateContext, ready: true, sfxGain: {} },
  file => new Promise(resolve => { if (file === ULTRA_AUDIO.transformation) release = () => resolve(file); else resolve(file); }));
late.start(); late.sync(14); late.stop(true); release(); await late.preload();
assert.equal(lateContext.sources.length, 0, 'Late decode after cancellation does not resurrect audio');
late.start(); lateContext.currentTime = 2; late.sync(17);
assert.equal(late.loopVoice.source.started.offset, 17, 'Late clock synchronization does not replay the opening');
const unavailable = new UltraAudio({ ctx: new Context(), ready: true, sfxGain: {} }, async () => { throw Error('offline'); });
unavailable.start(); await unavailable.preload(); unavailable.sync(90);
assert.equal(unavailable.loopVoice, null, 'Missing assets degrade to silence');
assert.equal(unavailable.elapsed, 90, 'Missing audio cannot hold the presentation clock');
console.log('PASS: ultra loop seam, indefinite tail, original pitch, SFX routing, pause/resume, clock correction, bounded teleport voices, cancellation, and late/missing assets.');
