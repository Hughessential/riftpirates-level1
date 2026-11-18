/** Original recording: 0–15s transformation followed by the authored aura bed.
 * A 48s tail period keeps the opening out of the loop. The final .5s crossfades
 * into the samples immediately preceding loopStart, so the wrap itself is
 * sample-contiguous. Measured full-rate stereo correlation there is .9644;
 * the blend changes RMS by about -.04dB. Linear blending avoids a gain bump.
 */
export const ULTRA_AUDIO = Object.freeze({
  transformation: 'secret-ultra-ulltimate-sfx.wav',
  teleport: 'telelportflashroll.wav',
  loopStart: 38.4, loopEnd: 86.4, crossfade: .5,
  auraTrim: .62, teleportTrim: .72, maxTeleports: 6,
});

export function prepareUltraLoop(buffer) {
  const { loopStart, loopEnd, crossfade } = ULTRA_AUDIO;
  if (buffer.duration < loopEnd) return false;
  const rate = buffer.sampleRate;
  const length = Math.round(crossfade * rate);
  const head = Math.round((loopStart - crossfade) * rate);
  const tail = Math.round((loopEnd - crossfade) * rate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const x = i / Math.max(1, length - 1);
      const mix = x * x * (3 - 2 * x);
      samples[tail + i] = samples[tail + i] * (1 - mix) + samples[head + i] * mix;
    }
  }
  return true;
}

export function ultraAudioOffset(elapsed) {
  const { loopStart, loopEnd } = ULTRA_AUDIO;
  return elapsed < loopEnd ? Math.max(0, elapsed)
    : loopStart + (elapsed - loopEnd) % (loopEnd - loopStart);
}

const volume = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : .82;

/** A transport owned by one ability. The game supplies its pause-aware clock;
 * this class never advances gameplay, starts a timer, or owns the audio context.
 */
export class UltraAudio {
  constructor(manager, load) {
    this.manager = manager;
    this.load = load;
    this.active = false;
    this.elapsed = 0;
    this.paused = false;
    this.volume = .82;
    this.buffers = {};
    this.loopVoice = null;
    this.teleports = [];
    this.retiring = new Set();
  }

  preload() {
    const { ctx, ready } = this.manager;
    if (!ctx || !ready) return Promise.resolve();
    if (!this.loading) {
      this.loading = Promise.allSettled([
        [ 'aura', ULTRA_AUDIO.transformation ], [ 'teleport', ULTRA_AUDIO.teleport ],
      ].map(async ([key, file]) => {
        const buffer = await ctx.decodeAudioData(await this.load(file));
        if (key === 'aura' && !prepareUltraLoop(buffer)) return;
        this.buffers[key] = buffer;
      }));
    }
    // Loading only caches. Playback is permitted solely by the next sync call,
    // preventing a late network response from reviving a cancelled activation.
    return this.loading;
  }

  start(level = .82) {
    this.stop(true);
    this.active = true;
    this.elapsed = 0;
    this.paused = false;
    this.volume = volume(level);
    this.preload();
    this.sync(0, false, level);
  }

  _voice(buffer, offset, level, loop = false) {
    const { ctx, sfxGain } = this.manager;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = 1;
    source.loop = loop;
    if (loop) {
      source.loopStart = ULTRA_AUDIO.loopStart;
      source.loopEnd = ULTRA_AUDIO.loopEnd;
    }
    source.connect(gain);
    gain.connect(sfxGain);
    const voice = { source, gain, level, startedAt: ctx.currentTime, offset, closed: false };
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(level, ctx.currentTime + .008);
    source.onended = () => {
      source.disconnect(); gain.disconnect();
      voice.closed = true;
      this.retiring.delete(voice);
    };
    source.start(0, offset);
    return voice;
  }

  _release(voice, fade = 0) {
    if (!voice || voice.closed) return;
    const now = this.manager.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.level, now);
    voice.gain.gain.linearRampToValueAtTime(0, now + fade);
    try { voice.source.stop(now + fade); } catch { /* Already finished. */ }
    if (fade) this.retiring.add(voice);
    else {
      voice.source.disconnect(); voice.gain.disconnect();
      voice.closed = true;
      this.retiring.delete(voice);
    }
    // Repeated test-arena toggles or repeated clock corrections stay bounded.
    while (this.retiring.size > 8) this._release(this.retiring.values().next().value);
  }

  _level(voice, level) {
    if (!voice || voice.level === level) return;
    const now = this.manager.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.level, now);
    voice.gain.gain.linearRampToValueAtTime(level, now + .02);
    voice.level = level;
  }

  sync(elapsed, paused = false, level = this.volume) {
    if (!this.active) return;
    this.elapsed = Math.max(0, Number.isFinite(elapsed) ? elapsed : this.elapsed);
    this.paused = Boolean(paused);
    this.volume = volume(level);
    const { ctx, ready, sfxGain } = this.manager;
    if (!ctx || !ready || !sfxGain) { this.preload(); return; }
    this.preload();
    if (this.paused) {
      this._release(this.loopVoice); this.loopVoice = null;
      for (const teleport of this.teleports) { this._release(teleport.voice); teleport.voice = null; }
      for (const voice of this.retiring) this._release(voice);
      return;
    }
    const buffer = this.buffers.aura;
    const drift = this.loopVoice
      ? Math.abs(this.elapsed - (this.loopVoice.timelineStart + ctx.currentTime - this.loopVoice.startedAt)) : 0;
    if (buffer && (!this.loopVoice || drift > .12)) {
      this._release(this.loopVoice, .012);
      this.loopVoice = this._voice(buffer, ultraAudioOffset(this.elapsed), this.volume * ULTRA_AUDIO.auraTrim, true);
      this.loopVoice.timelineStart = this.elapsed;
    }
    this._level(this.loopVoice, this.volume * ULTRA_AUDIO.auraTrim);
    for (let i = this.teleports.length - 1; i >= 0; i--) {
      const teleport = this.teleports[i], age = Math.max(0, this.elapsed - teleport.time);
      const clip = this.buffers.teleport;
      if (age >= (clip?.duration || 4)) {
        this._release(teleport.voice); this.teleports.splice(i, 1); continue;
      }
      const mismatch = teleport.voice
        ? Math.abs(age - (teleport.voice.offset + ctx.currentTime - teleport.voice.startedAt)) > .12 : false;
      if (clip && (!teleport.voice || mismatch)) {
        this._release(teleport.voice, .012);
        teleport.voice = this._voice(clip, age, teleport.level * ULTRA_AUDIO.teleportTrim);
      }
    }
  }

  teleport(level = this.volume) {
    if (!this.active || this.paused) return;
    if (this.teleports.length >= ULTRA_AUDIO.maxTeleports) this._release(this.teleports.shift().voice, .012);
    this.teleports.push({ time: this.elapsed, level: volume(level), voice: null });
    this.sync(this.elapsed, false);
  }

  stop(immediate = false) {
    this.active = false;
    for (const voice of this.retiring) this._release(voice);
    this._release(this.loopVoice, immediate ? 0 : .12);
    this.loopVoice = null;
    for (const teleport of this.teleports) this._release(teleport.voice, immediate ? 0 : .06);
    this.teleports.length = 0;
  }
}
