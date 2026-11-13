import assert from 'node:assert/strict';
import { AudioManagerImpl } from '../src/core/AudioManager.js';
import { Save, AUDIO_DEFAULTS } from '../src/core/SaveSystem.js';

const initial = { ...Save.data }, storage = new Map();
const KEY = 'riftpirates-level1-v1';
class FakeAudio {
  constructor() { this.paused = true; this.currentTime = 0; this.duration = 270; this.volume = 1; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}
const node = () => ({ connect() {}, gain: { value: 0 } });
class FakeContext {
  constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
  createGain() { return node(); }
  createBiquadFilter() { return { ...node(), frequency: { value: 0 } }; }
  createDynamicsCompressor() { return { ...node(), threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }; }
  createMediaElementSource() { return node(); }
}
globalThis.Audio = FakeAudio;
globalThis.window = {
  AudioContext: FakeContext,
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
};

// Existing saves gain independent levels without resetting mute or run records.
storage.set(KEY, JSON.stringify({ music: 0, sfx: 1, bestScore: 12345 }));
Save.load();
assert.equal(Save.data.music, 0); assert.equal(Save.data.bestScore, 12345);
assert.equal(Save.data.musicVolume, .65); assert.equal(Save.data.sfxVolume, .85);
storage.set(KEY, JSON.stringify({ musicVolume: 4, sfxVolume: -.5 }));
Save.load();
assert.equal(Save.data.musicVolume, 1); assert.equal(Save.data.sfxVolume, 0);
storage.set(KEY, JSON.stringify({ musicVolume: null, sfxVolume: 'loud' }));
Save.load();
assert.equal(Save.data.musicVolume, AUDIO_DEFAULTS.musicVolume);
assert.equal(Save.data.sfxVolume, AUDIO_DEFAULTS.sfxVolume);

// The singleton can exist before Save.load. Audio unlock still uses saved levels.
Save.data = { ...initial };
const webAudio = new AudioManagerImpl();
storage.set(KEY, JSON.stringify({ musicVolume: .31, sfxVolume: .22 }));
Save.load();
webAudio._loadSfx = async () => {};
await webAudio.init();
assert.equal(webAudio.musicGain.gain.value, .31);
assert.equal(webAudio.sfxGain.gain.value, .22);
webAudio.playBattle(0, { restart: true }); webAudio.update(1);
webAudio.music.battle.el.currentTime = 42;
webAudio.pauseMusic();
webAudio.setMusicVolume(.78);
webAudio.setSfxVolume(.43);
assert.equal(webAudio.musicGain.gain.value, .78); assert.equal(webAudio.sfxGain.gain.value, .43);
assert.equal(webAudio.musicOwner, 'battle'); assert.equal(webAudio.music.battle.el.currentTime, 42);
assert.equal(webAudio.music.battle.el.paused, true, 'Adjusting volume cannot unpause gameplay music');
webAudio.setMusicEnabled(false); webAudio.setSfxEnabled(false);
webAudio.setMusicVolume(.6); webAudio.setSfxVolume(.7);
assert.equal(webAudio.musicGain.gain.value, 0); assert.equal(webAudio.sfxGain.gain.value, 0);
webAudio.setMusicEnabled(true); webAudio.setSfxEnabled(true);
assert.equal(webAudio.musicGain.gain.value, .6); assert.equal(webAudio.sfxGain.gain.value, .7);
assert.equal(webAudio.music.battle.el.paused, true, 'Unmute preserves the game pause reason');
webAudio.resumeMusic();
assert.equal(webAudio.music.battle.el.currentTime, 42); assert.equal(webAudio.music.battle.el.paused, false);
Save.data = { ...initial }; Save.load();
assert.equal(Save.data.musicVolume, .6); assert.equal(Save.data.sfxVolume, .7);

// The media-element fallback applies the same level, independent of WebAudio.
const fallback = new AudioManagerImpl(); fallback.ready = true;
fallback.playTitle(0); fallback.update(1);
assert.equal(fallback.music.title.el.volume, .6);
fallback.setMusicVolume(.25);
assert.equal(fallback.music.title.el.volume, .25);
fallback.setMusicEnabled(false); fallback.setMusicVolume(.9);
assert.equal(fallback.music.title.el.volume, 0);
fallback.setMusicEnabled(true);
assert.equal(fallback.music.title.el.volume, .9);
fallback.setMusicVolume(0);
assert.equal(Save.data.music, 1, 'Zero level and mute remain independent');
fallback.setMusicVolume(Infinity); fallback.setSfxVolume(-2);
assert.equal(fallback.musicVol, .65); assert.equal(fallback.sfxVol, 0);
console.log('PASS: saved independent audio levels, legacy save migration, clamping, real bus gains, mute memory, media fallback, pause and soundtrack ownership.');
