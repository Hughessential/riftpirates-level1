import assert from 'node:assert/strict';

const KEY = 'riftpirates-level1-v1';
const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  },
  dispatchEvent() {},
};
globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options?.detail; } };

const { Save, AUDIO_DEFAULTS, UI_SCALE_DEFAULT, clampUIScale } = await import('../src/core/SaveSystem.js');
assert.deepEqual(AUDIO_DEFAULTS, { musicVolume: .75, sfxVolume: .75 });
Save.load();
assert.equal(Save.data.musicVolume, .75); assert.equal(Save.data.sfxVolume, .75);
assert.equal(Save.data.uiScale, UI_SCALE_DEFAULT); assert.equal(Save.data.tutorialComplete, false);

storage.set(KEY, JSON.stringify({ scrapBanked: 9123, bestScore: 456789, runs: 12, musicVolume: .31, sfxVolume: .82 }));
Save.load();
assert.equal(Save.data.scrapBanked, 9123); assert.equal(Save.data.bestScore, 456789); assert.equal(Save.data.runs, 12);
assert.equal(Save.data.musicVolume, .31); assert.equal(Save.data.sfxVolume, .82,
  'Existing users keep their exact saved audio levels');
assert.equal(Save.data.uiScale, 1.1); assert.equal(Save.data.tutorialComplete, false,
  'Legacy saves receive additive interface/tutorial defaults');

storage.set(KEY, JSON.stringify({ scrapBanked: 77, uiScale: 1.35, tutorialComplete: true, musicVolume: .46, sfxVolume: .57 }));
Save.load();
assert.equal(Save.data.uiScale, 1.35); assert.equal(Save.data.tutorialComplete, true);
assert.equal(Save.data.musicVolume, .46); assert.equal(Save.data.sfxVolume, .57);
assert.equal(clampUIScale(.79), .8); assert.equal(clampUIScale(1.41), 1.4);
assert.equal(clampUIScale(1.32), 1.3); assert.equal(clampUIScale('bad'), 1.1);

const properties = new Map();
globalThis.document = { documentElement: {
  dataset: {}, style: { setProperty: (key, value) => properties.set(key, value) },
} };
const { applyUIScale } = await import('../src/ui/UISettings.js');
assert.equal(applyUIScale(1.4), 1.4);
assert.equal(document.documentElement.dataset.uiScale, '1.4');
assert.equal(properties.get('--ui-user-scale'), '1.4');

const { displayMetrics, applyDisplayLayout } = await import('../src/render/DisplayLayout.js');
for (const [width, height] of [[1280, 800], [1920, 1080], [2560, 1440], [3840, 2160], [3440, 1440]]) {
  const metrics = displayMetrics(width, height, 2);
  applyDisplayLayout(metrics);
  assert.equal(Number(properties.get('--menu-scale')), Number((metrics.menuScale * 1.4).toFixed(4)));
  assert.ok(metrics.stageLeft >= 0 && metrics.stageWidth <= width);
}

console.log('PASS: additive save migration, exact existing audio, fresh 75% audio, 110% UI default, clamping and viewport/user scale composition.');
