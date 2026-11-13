import { Save, AUDIO_DEFAULTS, clampAudioVolume } from './SaveSystem.js';
import { rand } from './Utils.js';
import { fetchAssetBuffer, mapConcurrent } from './AssetLoader.js';

/**
 * SFX are decoded into WebAudio buffers (short, fired constantly, need pitch
 * variation). Music streams through <audio> elements routed into the graph so
 * we can crossfade layers without decoding megabytes up front (spec §40).
 *
 * Everything degrades to silence rather than throwing: audio must never be able
 * to block a run from starting.
 */

const SFX_FILES = {
  player_shot: 'player_shot.wav',
  player_shot_alt: 'player_shot_alt.wav',
  enemy_shot: 'enemy_shot.wav',
  heavy_shot: 'heavy_shot.wav',
  laser_fire: 'laser_fire.wav',
  anchor_launch: 'anchor_launch.wav',
  hit: 'hit.wav',
  crit: 'crit.wav',
  player_hurt: 'player_hurt.wav',
  enemy_death: 'enemy_death.wav',
  weakpoint_death: 'weakpoint_death.wav',
  tower_death: 'tower_death.wav',
  boss_death: 'boss_death.wav',
  phase_change: 'phase_change.wav',
  player_death: 'player_death.wav',
  scrap: 'scrap.wav',
  scrap_burst: 'scrap_burst.wav',
  upgrade: 'upgrade.wav',
  levelup: 'levelup.wav',
  perfect_dodge: 'perfect_dodge.wav',
  ui_select: 'ui_select.wav',
  ui_move: 'ui_move.wav',
  laser_warning: 'laser_warning.wav',
  low_health: 'low_health.wav',
  overload: 'overload.wav',
  shield_break: 'shield_break.wav',
  boost: 'boost.wav',
  boss_taunt: 'boss_taunt.wav',
};

/** Distinct original samples from the supplied Juhani Junkala CC0 pack. */
export const WEAPON_AUDIO = {
  pulse: { volume: .28, duration: .25, gap: .1, rate: 1.04, priority: 0 },
  twin: { volume: .34, duration: .11, gap: .12, rate: 1.35, priority: 1 },
  broadsides: { volume: .46, duration: .4, gap: .22, rate: .8, priority: 2 },
  helix: { volume: .4, duration: .26, gap: .2, rate: 1.12, priority: 2 },
  prism: { volume: .5, duration: .54, gap: .3, rate: .94, priority: 3 },
  scatter: { volume: .48, duration: .34, gap: .25, rate: .82, priority: 2 },
  seeker: { volume: .44, duration: .44, gap: .3, rate: 1.2, priority: 2 },
  mortar: { volume: .52, duration: .66, gap: .4, rate: .68, priority: 3 },
  orbital: { volume: .32, duration: .28, gap: .22, rate: 1.5, priority: 1 },
  echo: { volume: .27, duration: .15, gap: .16, rate: 1.05, priority: 1 },
  wake: { volume: .42, duration: .12, gap: .24, rate: 1.32, priority: 2 },
  capacitor: { volume: .5, duration: .5, gap: .3, rate: .78, priority: 3 },
  tesla: { volume: .42, duration: .25, gap: .18, rate: 1.25, priority: 3 },
  blast: { volume: .35, duration: .25, gap: .18, rate: .82, priority: 2 },
  retaliation: { volume: .5, duration: .48, gap: .3, rate: .7, priority: 3, file: 'revenge' },
  siphon: { volume: .42, duration: .4, gap: .3, rate: 1.05, priority: 2 },
  fragment: { volume: .3, duration: .2, gap: .2, rate: 1.4, priority: 1 },
  singularity: { volume: .48, duration: .7, gap: .45, rate: .66, priority: 3 },
};
for (const [kind, profile] of Object.entries(WEAPON_AUDIO)) SFX_FILES[`weapon_${kind}`] = `mayhem/${profile.file || kind}.wav`;

// Source filenames are authoritative; the embedded MP3 titles differ.
export const MUSIC_FILES = Object.freeze({
  title: 'Rift Pirates OFFICIAL Main Title Theme.mp3',
  battle: 'Boss Battle OFFICAL soundtrack.mp3',
  escape: 'The Very Very End.mp3',
  arcade: 'arcade.mp3',
  astral: 'astral.mp3',
  neondrift: 'neondrift.mp3',
  pixelatedvoid: 'pixelatedvoid.mp3',
  thepirateking: 'thepirateking.mp3',
  defeat: 'sorryyoudied.mp3',
  victory: 'Afterthefinalescape.mp3',
});
export const GAMEPLAY_MUSIC = Object.freeze(['arcade', 'astral', 'neondrift', 'pixelatedvoid', 'thepirateking']);
const THEME_TAIL = 1.4; // Deliberate end fade, not a claimed seamless musical loop.
export const AUDIO_OUTPUT = Object.freeze({ threshold: -3, ratio: 20, headroom: .95, musicSmoothing: .012 });
const ASSET_BASE = import.meta.env?.BASE_URL || './';

export class AudioManagerImpl {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.buffers = {};
    this.music = {};
    this.currentMusic = null;
    this.musicVol = clampAudioVolume(Save.data.musicVolume, AUDIO_DEFAULTS.musicVolume);
    this.sfxVol = clampAudioVolume(Save.data.sfxVolume, AUDIO_DEFAULTS.sfxVolume);
    this._fades = [];
    this.musicOwner = null;
    this._generation = 0;
    this._desired = null;
    this._pauseReasons = new Set();
    this._shuffleBag = [];
    this._gameplayTrack = null;
    this._lastGameplay = null;
    this._unavailable = new Set();
    // Rate-limits identical sounds fired in the same frame — a 20-projectile
    // barrage should not stack 20 copies of one sample into a clipping wall.
    this._lastPlay = {};
    this._weaponVoices = 0;
    this._weaponLast = {};
    this._weaponActive = [];
    this._weaponTrim = {};
  }

  async init({ loadSfx = true } = {}) {
    if (this.ctx) {
      if (loadSfx) await this._ensureSfx();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch { return; }
    // Save.load runs after this singleton is constructed. Read the persisted
    // mixer at audio unlock, including edits made before the first gesture.
    this.musicVol = clampAudioVolume(Save.data.musicVolume, AUDIO_DEFAULTS.musicVolume);
    this.sfxVol = clampAudioVolume(Save.data.sfxVolume, AUDIO_DEFAULTS.sfxVolume);

    this.master = this.ctx.createGain();
    this.master.gain.value = 1;

    // Both buses need headroom at their final sum. Compressing SFX alone cannot
    // protect a loud explosion + soundtrack from clipping the device output.
    this.mixBus = this.ctx.createGain();
    this.mixBus.gain.value = 1;
    this.mixLimiter = this.ctx.createDynamicsCompressor();
    this.mixLimiter.threshold.value = AUDIO_OUTPUT.threshold;
    this.mixLimiter.knee.value = 0;
    this.mixLimiter.ratio.value = AUDIO_OUTPUT.ratio;
    this.mixLimiter.attack.value = .003;
    this.mixLimiter.release.value = .08;
    this.outputGain = this.ctx.createGain();
    this.outputGain.gain.value = AUDIO_OUTPUT.headroom;
    this.mixBus.connect(this.mixLimiter);
    this.mixLimiter.connect(this.outputGain);
    this.outputGain.connect(this.ctx.destination);

    // Death sequence sweeps the SFX mix; official music retains its original
    // frequency range as well as its original tempo throughout the ending.
    this.warpFilter = this.ctx.createBiquadFilter();
    this.warpFilter.type = 'lowpass';
    this.warpFilter.frequency.value = 22050;
    this.master.connect(this.warpFilter);
    this.warpFilter.connect(this.mixBus);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = Save.data.sfx ? this.sfxVol : 0;
    this.sfxLimiter = this.ctx.createDynamicsCompressor();
    this.sfxLimiter.threshold.value = -14;
    this.sfxLimiter.knee.value = 12;
    this.sfxLimiter.ratio.value = 6;
    this.sfxLimiter.attack.value = .003;
    this.sfxLimiter.release.value = .12;
    this.sfxGain.connect(this.sfxLimiter);
    this.sfxLimiter.connect(this.master);
    this.weaponGain = this.ctx.createGain();
    this.weaponGain.gain.value = 1;
    this.weaponGain.connect(this.sfxGain);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = Save.data.music ? this.musicVol : 0;
    this.musicGain.connect(this.mixBus);

    this.ready = true;
    if (this._desired) this._startCurrent();
    if (loadSfx) await this._ensureSfx();
  }

  _ensureSfx() { return this._sfxLoad ||= this._loadSfx(); }

  async _loadSfx() {
    // First interaction should make the primary gun, impact and menu audible
    // before decoding every rare weapon/boss sample. Four workers keep the
    // soundtrack and geometry uploads from competing with 46 simultaneous jobs.
    const first = ['weapon_pulse', 'player_shot', 'ui_select', 'player_hurt', 'hit', 'enemy_shot'];
    const keys = [...first, ...Object.keys(SFX_FILES).filter(key => !first.includes(key))];
    await mapConcurrent(keys, 4, async (key) => {
      try {
        const arr = await fetchAssetBuffer(`${ASSET_BASE}sfx/${SFX_FILES[key]}`);
        this.buffers[key] = await this.ctx.decodeAudioData(arr);
        if (key.startsWith('weapon_')) {
          const samples = this.buffers[key].getChannelData(0);
          let energy = 0;
          for (const sample of samples) energy += sample * sample;
          // Match perceived level between the supplied samples, without editing
          // their source files or flattening the dynamics of the soundtrack.
          const rms = Math.sqrt(energy / Math.max(1, samples.length));
          this._weaponTrim[key] = Math.min(2.2, Math.max(.65, .19 / Math.max(.02, rms)));
        }
      } catch {
        /* a missing sample just means that cue is silent */
      }
    });
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    const current = this.currentMusic && this.music[this.currentMusic];
    if (current?.el.ended && !this._pauseReasons.size && Save.data.music) this._finishTrack(current);
    else if (current?.el.paused) this._playEntry(current);
  }

  play(name, vol = 1, rate = 1, jitter = 0) {
    if (!this.ready || !Save.data.sfx) return;
    const buf = this.buffers[name];
    if (!buf) return;

    const now = this.ctx.currentTime;
    if (this._lastPlay[name] && now - this._lastPlay[name] < 0.03) return;
    this._lastPlay[name] = now;
    if (this.weaponGain && ['laser_warning', 'low_health', 'player_hurt', 'shield_break', 'phase_change'].includes(name)) {
      const gain = this.weaponGain.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(.28, now + .015);
      gain.setValueAtTime(.28, now + .16);
      gain.linearRampToValueAtTime(1, now + .34);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = jitter ? rate * rand(1 - jitter, 1 + jitter) : rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(this.sfxGain);
    src.start();
    src.onended = () => { src.disconnect(); g.disconnect(); };
  }

  /** Prioritized weapon voices give rare guns room; danger cues duck this bus. */
  playWeapon(kind, power = 1, { strength = 1, priority } = {}) {
    if (!this.ready || !Save.data.sfx) return;
    const profile = WEAPON_AUDIO[kind] || WEAPON_AUDIO.pulse;
    const buffer = this.buffers[`weapon_${kind}`];
    if (!buffer) return;
    const now = this.ctx.currentTime;
    if (now - (this._weaponLast[kind] ?? -Infinity) < profile.gap) return;
    const importance = priority ?? profile.priority;
    // Repeated base fire must not crowd out a new lance, swarm or reactor burst.
    if (importance === 0 && this._weaponVoices >= 7) return;
    if (this._weaponVoices >= 18) {
      const expendable = this._weaponActive.find(voice => voice.priority < importance && !voice.stopping);
      if (!expendable) return;
      expendable.stopping = true;
      expendable.gain.gain.cancelScheduledValues(now);
      expendable.gain.gain.setValueAtTime(0, now);
      expendable.source.stop(now);
      // Reclaim synchronously: WebAudio's ended event arrives on a later task.
      // A full salvo in this task must never allocate a second bank of tails.
      expendable.release();
    }
    this._weaponLast[kind] = now;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const depth = Math.min(8, Math.max(0, Number(power) - 1));
    source.playbackRate.value = profile.rate / (1 + depth * .025);
    const gain = this.ctx.createGain();
    const duration = Math.min(buffer.duration / source.playbackRate.value, profile.duration * (1 + depth * .025));
    const trim = this._weaponTrim[`weapon_${kind}`] || 1;
    const volume = profile.volume * trim * Math.min(1.3, 1 + depth * .04)
      * Math.max(0, Math.min(1.25, strength)) / Math.sqrt(1 + this._weaponVoices * .075);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + .003);
    gain.gain.setValueAtTime(volume, now + Math.max(.004, duration - .045));
    gain.gain.linearRampToValueAtTime(0, now + duration);
    source.connect(gain);
    gain.connect(this.weaponGain || this.sfxGain);
    const voice = { source, gain, priority: importance, stopping: false, kind, released: false };
    this._weaponActive.push(voice);
    this._weaponVoices++;
    voice.release = () => {
      if (voice.released) return;
      voice.released = true;
      this._weaponVoices = Math.max(0, this._weaponVoices - 1);
      const index = this._weaponActive.indexOf(voice);
      if (index >= 0) this._weaponActive.splice(index, 1);
      source.disconnect(); gain.disconnect();
    };
    source.onended = voice.release;
    source.start(now);
    source.stop(now + duration + .005);
  }

  // ---- music ----------------------------------------------------------------

  _el(name) {
    if (this.music[name]) return this.music[name];
    const file = MUSIC_FILES[name];
    if (!file) return null;
    const el = new Audio(`${ASSET_BASE}music/${encodeURIComponent(file)}`);
    el.loop = false;
    el.preload = 'auto';
    el.volume = 0;
    const entry = { name, el, gain: null, node: null, level: 0, tail: 1, generation: 0 };
    if (this.ctx) {
      try {
        entry.gain = this.ctx.createGain();
        entry.gain.gain.value = 0;
        entry.node = this.ctx.createMediaElementSource(el);
        entry.node.connect(entry.gain);
        entry.gain.connect(this.musicGain);
        el.volume = 1;
      } catch {
        // The fallback includes the user's music volume/mute, just like WebAudio.
        entry.gain = null;
      }
    }
    this.music[name] = entry;
    return entry;
  }

  _applyLevel(entry, { immediate = false } = {}) {
    const volume = Math.max(0, Math.min(1, entry.level * entry.tail));
    if (entry.gain) {
      if (entry._levelTarget === volume && !immediate) return;
      entry._levelTarget = volume;
      const param = entry.gain.gain;
      if (!immediate && typeof param.setTargetAtTime === 'function') {
        // Frame-stepped gain assignments can click when the renderer stalls.
        // Let the audio clock interpolate each small crossfade/tail adjustment.
        param.cancelScheduledValues(this.ctx.currentTime);
        param.setTargetAtTime(volume, this.ctx.currentTime, AUDIO_OUTPUT.musicSmoothing);
      } else {
        param.cancelScheduledValues?.(this.ctx?.currentTime || 0);
        param.value = volume;
      }
    }
    else entry.el.volume = Save.data.music ? volume * this.musicVol : 0;
  }

  _playEntry(entry) {
    if (this._pauseReasons.size || !Save.data.music || entry.name !== this.currentMusic) return;
    const token = this._generation;
    try {
      const promise = entry.el.play();
      promise?.then(() => {
        // A delayed browser unlock must never resurrect a discarded track.
        if (token !== this._generation || entry.name !== this.currentMusic || this._pauseReasons.size || !Save.data.music) {
          if (entry.generation === token) entry.el.pause();
        }
      }).catch(() => {});
    } catch { /* Missing/blocked music never blocks gameplay. */ }
  }

  _startCurrent() {
    const selection = this._desired;
    if (!this.ready || !selection || !selection.name) return;
    const entry = this._el(selection.name);
    if (!entry) return;
    const token = this._generation;
    entry.generation = token;
    entry.tail = 1;
    entry.el.loop = false;
    entry.el.playbackRate = 1;
    if (!selection.resume) {
      try { entry.el.currentTime = 0; } catch { /* Metadata can arrive after selection. */ }
    }
    entry.el.onended = () => {
      if (token !== this._generation || entry.name !== this.currentMusic || !entry.el.ended) return;
      if (this._pauseReasons.size) return; // Resume handles a track paused exactly at its end.
      this._finishTrack(entry);
    };
    entry.el.onerror = () => {
      if (token !== this._generation || entry.name !== this.currentMusic) return;
      if (!this._unavailable.has(entry.name)) {
        console.warn(`Music unavailable: ${MUSIC_FILES[entry.name]}`);
      }
      this._unavailable.add(entry.name);
      if (this.musicOwner === 'gameplay') this._advanceGameplay();
      // Dedicated themes remain owned by their scene even if the file is unavailable.
    };
    this._fadeTo(entry, 1, selection.fade, false);
    this._playEntry(entry);
  }

  _select(name, owner, fade, repeat, { restart = false, resume = false } = {}) {
    // Unknown or obsolete cues cannot replace the currently owned soundtrack.
    if (name && !Object.hasOwn(MUSIC_FILES, name)) return;
    if (this.currentMusic === name && this.musicOwner === owner && !restart) return;
    const prev = this.currentMusic && this.music[this.currentMusic];
    this._generation++;
    this.currentMusic = name;
    this.musicOwner = owner;
    this._desired = name ? { name, fade, repeat, resume } : null;
    this._pauseReasons.delete('game');
    // At most one outgoing crossfade and one current recording can be playing.
    for (const entry of Object.values(this.music)) {
      if (entry !== prev || entry.name === name) {
        this._fades = this._fades.filter(f => f.entry !== entry);
        entry.el.pause();
        entry.level = 0;
        this._applyLevel(entry, { immediate: true });
      }
    }
    if (prev && prev.name !== name) this._fadeTo(prev, 0, fade, true);
    if (name) this._startCurrent();
  }

  _nextGameplay() {
    const available = GAMEPLAY_MUSIC.filter(name => !this._unavailable.has(name));
    if (!available.length) return null;
    this._shuffleBag = this._shuffleBag.filter(name => available.includes(name));
    if (!this._shuffleBag.length) {
      this._shuffleBag = available.slice();
      for (let i = this._shuffleBag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this._shuffleBag[i], this._shuffleBag[j]] = [this._shuffleBag[j], this._shuffleBag[i]];
      }
      if (this._shuffleBag.length > 1 && this._shuffleBag.at(-1) === this._lastGameplay) {
        [this._shuffleBag[0], this._shuffleBag[this._shuffleBag.length - 1]] =
          [this._shuffleBag.at(-1), this._shuffleBag[0]];
      }
    }
    this._lastGameplay = this._shuffleBag.pop();
    return this._lastGameplay;
  }

  _advanceGameplay() {
    this._gameplayTrack = this._nextGameplay();
    this._select(this._gameplayTrack, 'gameplay', .8, false, { restart: true });
  }

  _finishTrack(entry) {
    if (this.musicOwner === 'gameplay') this._advanceGameplay();
    else if (this._desired?.repeat) {
      // Play the complete source again, with a softened restart; never route a
      // long boss/escape/results session into the ordinary gameplay shuffle.
      this._select(entry.name, this.musicOwner, THEME_TAIL, true, { restart: true });
    }
  }

  playGameplay(fade = 1.5) {
    const previous = this._gameplayTrack;
    const media = previous && this.music[previous]?.el;
    const completed = media && (media.ended || (Number.isFinite(media.duration) && media.currentTime >= media.duration));
    if (!previous || completed || this._unavailable.has(previous)) this._gameplayTrack = this._nextGameplay();
    this._select(this._gameplayTrack, 'gameplay', fade, false, { resume: previous === this._gameplayTrack });
  }

  playTitle(fade = 1.5) { this._select('title', 'title', fade, true); }
  playBattle(fade = 1.5, { restart = false } = {}) { this._select('battle', 'battle', fade, true, { restart }); }
  playEscape(fade = .7, { restart = true } = {}) { this._select('escape', 'escape', fade, true, { restart }); }
  playDeath(fade = .35) { this._select('defeat', 'death', fade, true); }
  playVictory(fade = .45) { this._select('victory', 'victory', fade, true); }

  /** The escape simulation owns its deadline, even without working audio. */
  syncEscapeTime(elapsed) {
    const current = this.music.escape;
    if (this.musicOwner !== 'escape' || !current) return;
    const duration = current.el.duration;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(elapsed)) return;
    // Rendering and simulation may slow down while the audio device keeps
    // playing. Seeking a live recording to every >1s discrepancy caused
    // repeated audible rewinds during heavy escape combat. Only silent lab
    // frame-study follows a manually advanced simulation timeline.
    if (!this._pauseReasons.has('escape-study') || !current.el.paused) return;
    const target = Math.max(0, elapsed) % duration;
    if (Math.abs(current.el.currentTime - target) > .25) {
      try { current.el.currentTime = target; } catch { /* Media may still be seeking. */ }
    }
  }

  /** Compatibility only; each scene still owns its explicit approved recording. */
  playMusic(name, fade = 1.2) {
    if (['level1_a', 'level1_b', 'level1_c'].includes(name)) return this.playGameplay(fade);
    if (GAMEPLAY_MUSIC.includes(name)) return this.playGameplay(fade);
    if (name === 'title') return this.playTitle(fade);
    if (name === 'battle' || name === 'boss') return this.playBattle(fade);
    if (name === 'escape') return this.playEscape(fade, { restart: false });
    if (name === 'defeat' || name === 'death') return this.playDeath(fade);
    if (name === 'victory') return this.playVictory(fade);
    if (name === null) this.stopMusic(fade);
  }

  stopMusic(fade = .8) { this._select(null, null, fade, false); }

  _fadeTo(entry, target, dur, stopAtEnd) {
    this._fades = this._fades.filter(f => f.entry !== entry);
    if (dur <= 0) {
      entry.level = target;
      this._applyLevel(entry, { immediate: true });
      if (stopAtEnd) entry.el.pause();
      return;
    }
    this._fades.push({ entry, from: entry.level, to: target, t: 0, dur: Math.max(.01, dur), stopAtEnd,
      clock: this.ctx?.state === 'running' ? this.ctx.currentTime : null });
  }

  /** Death-sequence SFX smear: 0 = clean, 1 = fully muffled. */
  warp(amount) {
    if (!this.ready) return;
    const f = 22050 * Math.pow(1 - 0.985 * amount, 2.2);
    this.warpFilter.frequency.setTargetAtTime(Math.max(180, f), this.ctx.currentTime, 0.05);
    // Preserve the official soundtrack; only the SFX filter warps.
  }

  resetWarp() {
    if (!this.ready) return;
    this.warpFilter.frequency.setTargetAtTime(22050, this.ctx.currentTime, 0.05);
    for (const k of Object.keys(this.music)) this.music[k].el.playbackRate = 1;
  }

  update(dt) {
    if (this._pauseReasons.size) return;
    const clock = this.ctx?.state === 'running' ? this.ctx.currentTime : null;
    for (let i = this._fades.length - 1; i >= 0; i--) {
      const f = this._fades[i];
      // Simulation dt is capped for safe movement. Music runs in real time, so
      // a slow frame must not stretch a short crossfade into several seconds of
      // competing songs. Explicit pause/resume resets this clock below.
      const audioElapsed = clock !== null && f.clock !== null ? Math.max(0, clock - f.clock) : 0;
      f.clock = clock;
      f.t += Math.max(Math.max(0, dt), audioElapsed);
      const k = Math.min(1, f.t / f.dur);
      f.entry.level = f.from + (f.to - f.from) * k;
      this._applyLevel(f.entry);
      if (k >= 1) {
        if (f.stopAtEnd) f.entry.el.pause();
        this._fades.splice(i, 1);
      }
    }
    const current = this.currentMusic && this.music[this.currentMusic];
    if (current) {
      const remaining = current.el.duration - current.el.currentTime;
      current.tail = Number.isFinite(remaining) ? Math.min(1, Math.max(0, remaining / THEME_TAIL)) : 1;
      this._applyLevel(current);
    }
  }

  setMusicEnabled(on) {
    Save.data.music = on ? 1 : 0;
    Save.save();
    if (this.musicGain) this.musicGain.gain.value = on ? this.musicVol : 0;
    for (const entry of Object.values(this.music)) {
      this._applyLevel(entry);
      if (!on) entry.el.pause();
    }
    if (on) this.resume();
  }

  setSfxEnabled(on) {
    Save.data.sfx = on ? 1 : 0;
    Save.save();
    if (this.sfxGain) this.sfxGain.gain.value = on ? this.sfxVol : 0;
  }

  setMusicVolume(value) {
    this.musicVol = clampAudioVolume(value, AUDIO_DEFAULTS.musicVolume);
    Save.data.musicVolume = this.musicVol;
    Save.save();
    if (this.musicGain) this.musicGain.gain.value = Save.data.music ? this.musicVol : 0;
    for (const entry of Object.values(this.music)) this._applyLevel(entry);
  }

  setSfxVolume(value) {
    this.sfxVol = clampAudioVolume(value, AUDIO_DEFAULTS.sfxVolume);
    Save.data.sfxVolume = this.sfxVol;
    Save.save();
    if (this.sfxGain) this.sfxGain.gain.value = Save.data.sfx ? this.sfxVol : 0;
  }

  setMusicPaused(reason, paused) {
    if (this._pauseReasons.has(reason) === Boolean(paused)) return;
    if (paused) this._pauseReasons.add(reason);
    else this._pauseReasons.delete(reason);
    if (this._pauseReasons.size) {
      for (const entry of Object.values(this.music)) entry.el.pause();
    } else {
      for (const fade of this._fades) fade.clock = this.ctx?.state === 'running' ? this.ctx.currentTime : null;
      const current = this.currentMusic && this.music[this.currentMusic];
      if (current?.el.ended) this._finishTrack(current);
      else if (current) this._playEntry(current);
      // An outgoing fade stays paused after a pause/resume, avoiding duplicate
      // tails; its gain still settles to zero on the following updates.
    }
  }

  pauseMusic() { this.setMusicPaused('game', true); }
  resumeMusic() { this.setMusicPaused('game', false); }
}

export const Audio2 = new AudioManagerImpl();
