import assert from 'node:assert/strict';
import { PILOT_IDENTITY_DEFAULTS, PILOT_NAME_MAX, validatePilotName, safePilotName, pilotNameCharacters } from '../src/core/PilotName.js';

for (const name of ['PIRATE', 'Jean-Luc_7', '海賊 船長', 'Олена', 'محمد', 'Zoë', 'शिव', 'Captain 42']) {
  assert.equal(validatePilotName(name).valid, true, name);
}
assert.equal(validatePilotName('  Jose\u0301   海賊  ').name, 'José 海賊');
assert.equal(pilotNameCharacters('e\u0301').length, 1);
assert.equal(validatePilotName('e\u0301'.repeat(PILOT_NAME_MAX)).valid, true);
assert.equal(validatePilotName('A'.repeat(PILOT_NAME_MAX + 1)).valid, false);
for (const name of ['', '   ', '<img src=x onerror=alert(1)>', '🎮', 'A\nB', 'A\tB', 'A\u0000B', 'A\u200bB', 'A\u202eB', 'A\u034FB', 'A\uFE0FB', 'A\u00a0B', '\u0301', null, 42]) {
  assert.equal(validatePilotName(name).valid, false, String(name));
  assert.equal(safePilotName(name), 'PIRATE');
}
const key = 'riftpirates-level1-v1';
const legacy = { scrapBanked: 12345, bestScore: 8900, bestTime: 321, bestGrade: 'S', runs: 8, clears: 2, musicVolume: .74, sfxVolume: .83, selectedShip: 'neon-wraith' };
const saved = new Map([[key, JSON.stringify(legacy)]]);
globalThis.window = { localStorage: { getItem: k => saved.get(k) || null, setItem: (k, v) => saved.set(k, v) } };
const { Save } = await import('../src/core/SaveSystem.js?pilot-migration');
Save.load();
for (const [field, value] of Object.entries(legacy)) assert.equal(Save.data[field], value, field);
for (const [field, value] of Object.entries(PILOT_IDENTITY_DEFAULTS)) assert.equal(Save.data[field], value, field);
Object.assign(Save.data, { pilotName: 'José 海賊', pilotNameConfirmed: true });
Save.save();
const { Save: Reloaded } = await import('../src/core/SaveSystem.js?pilot-reloaded');
Reloaded.load();
assert.equal(Reloaded.data.pilotName, 'José 海賊');
assert.equal(Reloaded.data.pilotNameConfirmed, true);
assert.equal(Object.hasOwn(Reloaded.data, 'nameTagVisible'), false, 'Obsolete ship-tag preference is removed');
for (const [field, value] of Object.entries(legacy)) assert.equal(Reloaded.data[field], value);
saved.set(key, JSON.stringify({ ...legacy, pilotName: '<script>', pilotNameConfirmed: true, nameTagVisible: 'false' }));
const { Save: BadName } = await import('../src/core/SaveSystem.js?pilot-corrupt-name');
BadName.load();
assert.equal(BadName.data.pilotName, 'PIRATE');
assert.equal(BadName.data.pilotNameConfirmed, false);
assert.equal(Object.hasOwn(BadName.data, 'nameTagVisible'), false);
saved.set(key, '{ corrupt JSON');
const { Save: Corrupt } = await import('../src/core/SaveSystem.js?pilot-corrupt-storage');
assert.doesNotThrow(() => Corrupt.load());
assert.equal(Corrupt.data.pilotName, 'PIRATE');
window.localStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
const { Save: Private } = await import('../src/core/SaveSystem.js?pilot-private-storage');
Private.load();
Private.data.pilotName = 'PRIVATE PIRATE'; Private.data.pilotNameConfirmed = true; Private.save();
Private.data.pilotName = 'RESET'; Private.load();
assert.equal(Private.data.pilotName, 'PRIVATE PIRATE', 'Unavailable storage retains session fallback');
console.log('PASS: Unicode/grapheme validation, invisible/HTML rejection, additive legacy migration, preserved records, reload, corrupt and unavailable storage.');
