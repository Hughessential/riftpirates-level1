import { Save } from './SaveSystem.js';
import { rand } from './Utils.js';

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

const MUSIC_FILES = {
  title: 'title.m4a',
  level1_a: 'level1_a.m4a',
  level1_b: 'level1_b.m4a',
  level1_c: 'level1_c.m4a',
  boss: 'boss.m4a',
  defeat: 'defeat.m4a',
  victory: 'victory.mp3',
};

class AudioManagerImpl {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.buffers = {};
    this.music = {};
    this.currentMusic = null;
    this.musicVol = 0.55;
    this._fades = [];
    // Rate-limits identical sounds fired in the same frame — a 20-projectile
    // barrage should not stack 20 copies of one sample into a clipping wall.
    this._lastPlay = {};
  }

  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 1;

    // Death sequence sweeps this filter down to smear the mix (Player notes).
    this.warpFilter = this.ctx.createBiquadFilter();
    this.warpFilter.type = 'lowpass';
    this.warpFilter.frequency.value = 22050;
    this.master.connect(this.warpFilter);
    this.warpFilter.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = Save.data.sfx ? 0.85 : 0;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = Save.data.music ? this.musicVol : 0;
    this.musicGain.connect(this.master);

    this.ready = true;
    await this._loadSfx();
  }

  async _loadSfx() {
    const jobs = Object.entries(SFX_FILES).map(async ([key, file]) => {
      try {
        const res = await fetch(`assets/sfx/${file}`);
        const arr = await res.arrayBuffer();
        this.buffers[key] = await this.ctx.decodeAudioData(arr);
      } catch {
        /* a missing sample just means that cue is silent */
      }
    });
    await Promise.all(jobs);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  play(name, vol = 1, rate = 1, jitter = 0) {
    if (!this.ready || !Save.data.sfx) return;
    const buf = this.buffers[name];
    if (!buf) return;

    const now = this.ctx.currentTime;
    if (this._lastPlay[name] && now - this._lastPlay[name] < 0.03) return;
    this._lastPlay[name] = now;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = jitter ? rate * rand(1 - jitter, 1 + jitter) : rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(this.sfxGain);
    src.start();
  }

  // ---- music ----------------------------------------------------------------

  _el(name) {
    if (this.music[name]) return this.music[name];
    const file = MUSIC_FILES[name];
    if (!file) return null;
    const el = new Audio(`assets/music/${file}`);
    el.loop = true;
    el.preload = 'auto';
    const entry = { el, gain: null, node: null };
    if (this.ctx) {
      try {
        entry.gain = this.ctx.createGain();
        entry.gain.gain.value = 0;
        entry.node = this.ctx.createMediaElementSource(el);
        entry.node.connect(entry.gain);
        entry.gain.connect(this.musicGain);
      } catch {
        // Safari can refuse createMediaElementSource; drive element volume instead.
        entry.gain = null;
        el.volume = 0;
      }
    }
    this.music[name] = entry;
    return entry;
  }

  /** Crossfade to a track. Passing null fades everything out. */
  playMusic(name, fade = 1.2, loop = true) {
    if (!this.ready) return;
    if (this.currentMusic === name) return;
    const prev = this.currentMusic;
    this.currentMusic = name;

    if (prev && this.music[prev]) this._fadeTo(this.music[prev], 0, fade, true);
    if (!name) return;

    const entry = this._el(name);
    if (!entry) return;
    entry.el.loop = loop;
    entry.el.currentTime = 0;
    const p = entry.el.play();
    if (p && p.catch) p.catch(() => {});
    this._fadeTo(entry, 1, fade, false);
  }

  stopMusic(fade = 0.8) {
    this.playMusic(null, fade);
  }

  _fadeTo(entry, target, dur, stopAtEnd) {
    this._fades = this._fades.filter((f) => f.entry !== entry);
    const from = entry.gain ? entry.gain.gain.value : entry.el.volume;
    this._fades.push({ entry, from, to: target, t: 0, dur: Math.max(0.01, dur), stopAtEnd });
  }

  /** Death-sequence audio smear: 0 = clean, 1 = fully muffled + pitched down. */
  warp(amount) {
    if (!this.ready) return;
    const f = 22050 * Math.pow(1 - 0.985 * amount, 2.2);
    this.warpFilter.frequency.setTargetAtTime(Math.max(180, f), this.ctx.currentTime, 0.05);
    const cur = this.currentMusic && this.music[this.currentMusic];
    if (cur) cur.el.playbackRate = Math.max(0.55, 1 - 0.45 * amount);
  }

  resetWarp() {
    if (!this.ready) return;
    this.warpFilter.frequency.setTargetAtTime(22050, this.ctx.currentTime, 0.05);
    for (const k of Object.keys(this.music)) this.music[k].el.playbackRate = 1;
  }

  update(dt) {
    if (!this._fades.length) return;
    for (let i = this._fades.length - 1; i >= 0; i--) {
      const f = this._fades[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const v = f.from + (f.to - f.from) * k;
      if (f.entry.gain) f.entry.gain.gain.value = v;
      else f.entry.el.volume = Math.max(0, Math.min(1, v));
      if (k >= 1) {
        if (f.stopAtEnd) f.entry.el.pause();
        this._fades.splice(i, 1);
      }
    }
  }

  setMusicEnabled(on) {
    Save.data.music = on ? 1 : 0;
    Save.save();
    if (this.musicGain) this.musicGain.gain.value = on ? this.musicVol : 0;
  }

  setSfxEnabled(on) {
    Save.data.sfx = on ? 1 : 0;
    Save.save();
    if (this.sfxGain) this.sfxGain.gain.value = on ? 0.85 : 0;
  }

  pauseMusic() {
    const cur = this.currentMusic && this.music[this.currentMusic];
    if (cur) cur.el.pause();
  }

  resumeMusic() {
    const cur = this.currentMusic && this.music[this.currentMusic];
    if (cur && Save.data.music) {
      const p = cur.el.play();
      if (p && p.catch) p.catch(() => {});
    }
  }
}

export const Audio2 = new AudioManagerImpl();
