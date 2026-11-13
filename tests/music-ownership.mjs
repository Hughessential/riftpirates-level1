import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { AudioManagerImpl, GAMEPLAY_MUSIC, MUSIC_FILES } from '../src/core/AudioManager.js';
import { Save } from '../src/core/SaveSystem.js';

const approvedMusic = {
  title: 'Rift Pirates OFFICIAL Main Title Theme.mp3',
  battle: 'Boss Battle OFFICAL soundtrack.mp3',
  escape: 'The Very Very End.mp3',
  arcade: 'arcade.mp3', astral: 'astral.mp3', neondrift: 'neondrift.mp3',
  pixelatedvoid: 'pixelatedvoid.mp3', thepirateking: 'thepirateking.mp3',
  defeat: 'sorryyoudied.mp3', victory: 'Afterthefinalescape.mp3',
};
assert.deepEqual(MUSIC_FILES, approvedMusic, 'Every scene has its exact approved source recording');
assert.deepEqual(GAMEPLAY_MUSIC, ['arcade', 'astral', 'neondrift', 'pixelatedvoid', 'thepirateking']);
const warnings = [];
function failMedia(entry) {
  const warn = console.warn;
  console.warn = message => warnings.push(message);
  try { entry.el.onerror(); } finally { console.warn = warn; }
}

class FakeAudio {
  constructor(src) { this.src = src; this.currentTime = 0; this.duration = 270; this.volume = 1; this.paused = true; this.ended = false; this.playbackRate = 1; }
  play() { this.paused = false; this.ended = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  finish() { this.currentTime = this.duration; this.ended = true; this.paused = true; this.onended?.(); }
}
globalThis.Audio = FakeAudio;
Save.data.music = 1;
const a = new AudioManagerImpl();
a.playTitle(0);
assert.equal(a.currentMusic, 'title', 'Scene intent survives browser unlock delay');
assert.equal(Object.keys(a.music).length, 0, 'Do not create media until unlocked');
a.ready = true;
a._startCurrent();
a.update(1);
assert.ok(a.music.title.el.src.includes(encodeURIComponent(MUSIC_FILES.title)));
assert.equal(a.music.title.el.volume, .65, 'Element fallback honors the louder default music volume');
a.playGameplay(0);
a.update(1);
const first = a.currentMusic;
assert.ok(GAMEPLAY_MUSIC.includes(first));
a.music[first].el.currentTime = 73;
const bag = [...a._shuffleBag];
a.playBattle(0, { restart: true });
a.update(1);
assert.deepEqual(a._shuffleBag, bag, 'Battle does not consume ordinary shuffle entries');
a.playGameplay(0);
assert.equal(a.currentMusic, first);
assert.equal(a.music[first].el.currentTime, 73, 'Interrupted gameplay resumes its original position');
const staleEnd = a.music[first].el.onended;
a.playBattle(0, { restart: true });
a.music[first].el.ended = true;
staleEnd();
assert.equal(a.currentMusic, 'battle', 'Stale ending cannot steal boss ownership');
a.music.battle.el.currentTime = 99;
a.playBattle(0);
assert.equal(a.music.battle.el.currentTime, 99, 'Combat/phase continuity');
a.playBattle(0, { restart: true });
assert.equal(a.music.battle.el.currentTime, 0, 'Fresh attempt starts from beginning');
a.music.battle.el.finish();
assert.equal(a.currentMusic, 'battle', 'Long boss fights repeat the same recording');
assert.equal(a.music.battle.el.currentTime, 0);
assert.equal(a.music.battle.el.loop, false, 'A fade restart does not claim a seamless loop');
a.playGameplay(0);
assert.notEqual(a.currentMusic, first, 'A track completed during an outgoing fade advances on return');
const shuffle = new AudioManagerImpl();
shuffle.ready = true;
shuffle.playGameplay(0);
const songs = [shuffle.currentMusic];
for (let i = 0; i < 19; i++) { shuffle.music[shuffle.currentMusic].el.finish(); songs.push(shuffle.currentMusic); }
for (let i = 0; i < songs.length; i += 5) assert.equal(new Set(songs.slice(i, i + 5)).size, 5, 'Each complete bag contains all five tracks once');
for (let i = 1; i < songs.length; i++) assert.notEqual(songs[i], songs[i - 1], 'No immediate repeat at a bag boundary');
a.playEscape(0);
a.update(1);
a.music.escape.el.currentTime = 65;
a.syncEscapeTime(50);
assert.equal(a.music.escape.el.currentTime, 65, 'Slow simulation cannot rewind live escape music');
for (let i = 0; i < 120; i++) a.syncEscapeTime(50 + i / 60);
assert.equal(a.music.escape.el.currentTime, 65, 'Per-frame sync never repeatedly seeks a playing recording');
a.pauseMusic();
a.setMusicPaused('lab', true);
a.resumeMusic();
assert.equal(a.music.escape.el.paused, true, 'One pause reason cannot release another');
a.syncEscapeTime(80);
assert.equal(a.music.escape.el.currentTime, 65, 'Ordinary pause/resume preserves the recording position');
a.setMusicPaused('escape-study', true);
a.syncEscapeTime(80);
assert.equal(a.music.escape.el.currentTime, 80, 'Silent lab seeking maintains the simulation timeline');
a.setMusicPaused('escape-study', false);
a.setMusicPaused('lab', false);
assert.equal(a.music.escape.el.paused, false);
a.setMusicEnabled(false);
assert.equal(a.music.escape.el.volume, 0);
assert.equal(a.music.escape.el.paused, true);
a.setMusicEnabled(true);
assert.equal(a.music.escape.el.volume, .65);
assert.equal(a.music.escape.el.paused, false);
a.music.escape.el.finish();
assert.equal(a.currentMusic, 'escape', 'Finale never falls through to shuffle');
assert.equal(a.music.escape.el.playbackRate, 1);
a.playTitle(0);
a.update(1);
assert.equal(a.music.escape.el.paused, true);
assert.equal(a.music.title.el.paused, false);
assert.ok(Object.values(a.music).filter(entry => !entry.el.paused).length <= 1);

// A renderer limited to 5 FPS still performs a 1.5-second crossfade in 1.5
// real seconds. A long pause freezes that fade instead of jumping on resume.
const clocked = new AudioManagerImpl();
clocked.ready = true;
clocked.ctx = { state: 'running', currentTime: 0 };
clocked.playTitle(1.5);
clocked.ctx.currentTime = .6; clocked.update(.05);
assert.ok(Math.abs(clocked.music.title.level - .4) < 1e-9, 'Audio-clock progress survives capped simulation dt');
clocked.pauseMusic();
clocked.ctx.currentTime = 10; clocked.update(.05);
assert.ok(Math.abs(clocked.music.title.level - .4) < 1e-9);
clocked.resumeMusic();
clocked.ctx.currentTime = 10.5; clocked.update(.05);
assert.ok(Math.abs(clocked.music.title.level - 1.1 / 1.5) < 1e-9, 'Paused wall time is excluded from crossfades');
clocked.ctx.currentTime = 11; clocked.update(.05);
assert.equal(clocked.music.title.level, 1);
assert.equal(clocked._fades.length, 0);
a.playGameplay(0);
const failed = a.currentMusic;
failMedia(a.music[failed]);
assert.ok(GAMEPLAY_MUSIC.includes(a.currentMusic));
assert.notEqual(a.currentMusic, failed, 'Unavailable ordinary song advances safely');
a.playBattle(0, { restart: true });
failMedia(a.music.battle);
assert.equal(a.currentMusic, 'battle', 'Unavailable dedicated song does not steal scene ownership');

for (const [method, name, owner] of [['playDeath', 'defeat', 'death'], ['playVictory', 'victory', 'victory']]) {
  a[method](0); a.update(1);
  const entry = a.music[name];
  assert.equal(a.musicOwner, owner);
  assert.ok(entry.el.src.endsWith(encodeURIComponent(approvedMusic[name])));
  entry.el.currentTime = 37;
  const generation = a._generation;
  a[method](0);
  a.playMusic(name, 0, false);
  assert.equal(entry.el.currentTime, 37, 'Result rerenders and animation skips preserve the terminal recording position');
  assert.equal(a._generation, generation, 'Result continuity does not create another audio generation');
  a.setMusicPaused('background', true);
  entry.el.finish();
  assert.equal(entry.el.currentTime, entry.el.duration, 'An ended song waits while the tab is backgrounded');
  a.setMusicPaused('background', false);
  assert.equal(a.musicOwner, owner);
  assert.equal(entry.el.currentTime, 0, 'Returning from background repeats the same terminal recording');
  entry.el.finish();
  assert.equal(a.currentMusic, name, 'A long terminal screen never falls through to shuffle');
  assert.equal(entry.el.currentTime, 0);
  assert.equal(entry.el.playbackRate, 1);
  assert.equal(entry.el.loop, false, 'Complete files deliberately repeat through the existing tail-fade mechanism');
  a.playMusic('crystal-lake', 0);
  a.playMusic('not-an-approved-cue', 0);
  assert.equal(a.currentMusic, name, 'Unknown music cannot replace a scene soundtrack');
  failMedia(entry);
  assert.equal(a.currentMusic, name, 'A missing terminal recording stays silent instead of borrowing another theme');
  assert.equal(a.musicOwner, owner);
  const warned = warnings.length;
  failMedia(entry);
  assert.equal(warnings.length, warned, 'A missing recording is reported once, without console spam');
}
assert.deepEqual(warnings, [failed, 'battle', 'defeat', 'victory'].map(name => `Music unavailable: ${approvedMusic[name]}`),
  'Unavailable songs report their exact source filenames');

// No obsolete entry may regain ownership after browser unlock, media loading,
// or a promise from an earlier play of the SAME element finally resolves.
await Promise.resolve();
class DeferredAudio extends FakeAudio {
  constructor(src) { super(src); this.pending = []; }
  play() {
    return new Promise(resolve => this.pending.push(() => {
      this.paused = false; this.ended = false; resolve();
    }));
  }
  async release() { assert.ok(this.pending.length); this.pending.shift()(); await Promise.resolve(); }
}
globalThis.Audio = DeferredAudio;
const delayed = new AudioManagerImpl();
delayed.playBattle(0);
delayed.playDeath(0);
delayed.playTitle(0);
delayed.playVictory(0);
delayed.ready = true;
delayed._startCurrent();
assert.deepEqual(Object.keys(delayed.music), ['victory'], 'A late audio unlock creates only the current scene recording');
const delayedStaleEnd = delayed.music.victory.el.onended;
const delayedStaleError = delayed.music.victory.el.onerror;
delayed.playTitle(0);
await delayed.music.victory.el.release();
assert.equal(delayed.music.victory.el.paused, true, 'Late play fulfillment cannot revive a discarded terminal song');
delayed.music.victory.el.ended = true;
delayedStaleEnd(); delayedStaleError();
assert.equal(delayed.currentMusic, 'title', 'Late end/error callbacks cannot replace a newer scene');
assert.equal(delayed._unavailable.has('victory'), false, 'A stale error does not poison an approved recording');
delayed.playDeath(0);
delayed.playTitle(0);
await delayed.music.title.el.release();
assert.equal(delayed.music.title.el.paused, false, 'An old promise for a reselected element cannot pause its new playback');
await delayed.music.title.el.release();
await delayed.music.defeat.el.release();
assert.equal(delayed.music.defeat.el.paused, true);
delayed.playDeath(0);
delayed.setMusicEnabled(false);
await delayed.music.defeat.el.release();
assert.equal(delayed.music.defeat.el.paused, true, 'Mute wins over pending browser playback');
delayed.setMusicEnabled(true);
delayed.setMusicPaused('background', true);
await delayed.music.defeat.el.release();
assert.equal(delayed.music.defeat.el.paused, true, 'Background pause wins over pending browser playback');
delayed.setMusicPaused('background', false);
await delayed.music.defeat.el.release();
assert.equal(delayed.music.defeat.el.paused, false);
delayed.update(1);
assert.equal(Object.values(delayed.music).filter(entry => !entry.el.paused).length, 1, 'Rapid retry/menu transitions leave one authoritative recording');
assert.ok(delayed._fades.length <= 2, 'Crossfades remain bounded under rapid state changes');
globalThis.Audio = FakeAudio;
const shippedMusic = readdirSync(new URL('../assets/music/', import.meta.url))
  .filter(file => /\.(mp3|m4a|ogg|wav|flac|aac)$/i.test(file)).sort();
assert.deepEqual(shippedMusic, Object.values(approvedMusic).sort(), 'The public assets ship all ten approved songs and no legacy music');
console.log('PASS: exact official-only shipping and mapping, shuffle bags, terminal continuity/repeat, unlock/loading races, stale callbacks, mute/background priority and bounded crossfades.');
