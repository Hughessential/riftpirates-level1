import assert from 'node:assert/strict';
import * as THREE from 'three';
import { weaponPowerSignature, primaryWeaponOutput, projectileAppearance, WEAPON_STYLES, PROJECTILE_PARTS } from '../src/config/weapons.js';
import { ProjectilePool } from '../src/combat/ProjectilePool.js';
import { AugmentEffects } from '../src/combat/AugmentEffects.js';
import { PlayerWeapon } from '../src/player/PlayerWeapon.js';
import { Input } from '../src/core/Input.js';
import { Audio2, AudioManagerImpl, WEAPON_AUDIO } from '../src/core/AudioManager.js';
import { Save } from '../src/core/SaveSystem.js';
import { augmentDelta } from '../src/ui/AugmentFeedback.js';
import { UpgradeSystem, UPGRADES } from '../src/systems/UpgradeSystem.js';

const stats = { damage: 18, fireRate: 6.5, projectileSpeed: 105, criticalChance: 0, criticalMultiplier: 2.5 };
const base = weaponPowerSignature(stats);
assert.equal(base.tier, 0);
const offensive = ['rapidFire', 'hotshot', 'railAccelerator', 'cryoRounds', 'solarBurn', 'gravityWell', 'teslaFork'];
for (const id of offensive) {
  const signature = weaponPowerSignature({ ...stats, [id]: 1 });
  assert.notEqual(signature.color, base.color, `${id} visibly changes primary fire`);
  assert.notEqual(signature.sound, base.sound, `${id} changes the primary voice`);
  assert.ok(signature.tier > base.tier);
}
const elemental = { ...stats, cryoRounds: 2, solarBurn: 1, teslaFork: 1 };
assert.equal(new Set([0, 1, 2].map(shot => weaponPowerSignature(elemental, { shot }).color)).size, 3,
  'Mixed elemental builds expose every active element across the salvo cadence');
const blood = weaponPowerSignature({ ...stats, bloodReactor: 2 }, { shield: 0 });
assert.equal(blood.modifiers[0].label, 'BLOOD');
assert.equal(weaponPowerSignature({ ...stats, bloodReactor: 2 }, { shield: 10 }).modifiers.length, 0);
assert.equal(weaponPowerSignature({ ...stats, hotshot: 13 }).tier, 4);
const reactorStats = { ...stats, overcharge: 2, bloodReactor: 2, weakPointDamage: 1.5 };
const output = primaryWeaponOutput(reactorStats, { fireRate: 90, critBuffT: 1,
  heatMultiplier: 8, shield: 0, treasureCharge: 40, weakPoint: true });
assert.equal(output.fireRate, 45);
assert.ok(Math.abs(output.damage - (18 * (90 * 1.35 / 45) * 1.25 * 2 * 1.7 * 1.5 + 40)) < 1e-9,
  'Live damage readout includes dodge, cadence overflow, heat, exposed hull, weakpoint and loaded treasure');
const preview = new UpgradeSystem({ player: {} });
for (const [id, upgrade] of Object.entries(UPGRADES)) {
  for (let rank = 1; rank <= 13; rank++) {
    const before = JSON.stringify(preview.stats);
    const label = augmentDelta({ id, ...upgrade }, preview.stats, rank);
    assert.match(label, /→/); assert.ok(!/NaN|undefined/.test(label));
    assert.equal(JSON.stringify(preview.stats), before, `${id} rank ${rank} preview must never mutate the build`);
    preview.stats[id] = rank; upgrade.apply(preview.stats, rank);
  }
}
const critLabel = augmentDelta({ id: 'criticalDamage', ...UPGRADES.criticalDamage }, preview.stats, 14);
assert.match(critLabel, /CRIT POWER/);
assert.ok(!critLabel.includes('%'), 'Capped crit odds are not advertised beyond 100%');

for (const kind of Object.keys(WEAPON_STYLES)) {
  const [first, second, stacked] = [1, 2, 13].map(rank => projectileAppearance(kind, { rank, power: rank }));
  for (const dimension of ['width', 'length', 'trail']) {
    assert.ok(second[dimension] > first[dimension], `${kind} rank 2 grows ${dimension}`);
    assert.ok(stacked[dimension] > second[dimension], `${kind} rank 13 grows ${dimension}`);
    assert.ok(stacked[dimension] < first[dimension] * 3, `${kind} avoids screen-filling geometry`);
  }
  assert.equal(stacked.color, first.color, `${kind} retains its color at high ranks`);
}

const scene = new THREE.Scene(), pool = new ProjectilePool(scene);
const bolt = pool.firePlayer({ x: 0, y: 0, z: -5, weapon: 'seeker', rank: 3 });
const coreMatrices = Array.from({ length: PROJECTILE_PARTS.core }, (_, i) => {
  const matrix = new THREE.Matrix4(); pool.playerCore.getMatrixAt(i, matrix); return matrix;
});
assert.equal(new Set(coreMatrices.map(matrix => matrix.toArray().join(','))).size, 3, 'Missile body and fins have separate transforms');
const trail = new THREE.Matrix4(); pool.playerGlow.getMatrixAt(1, trail);
assert.ok(trail.elements[14] > bolt.z, 'Trailing glow is behind the forward moving bolt');
pool.killPlayerBolt(bolt);
for (const [mesh, count] of [[pool.playerCore, 3], [pool.playerGlow, 2]]) {
  for (let i = 0; i < count; i++) { const matrix = new THREE.Matrix4(); mesh.getMatrixAt(i, matrix); assert.equal(matrix.elements[0], 0); }
}
assert.equal(scene.children.length, 4);

const effectGame = { scene: new THREE.Scene(), player: { stats: {}, x: 0, y: 0 }, targets: [],
  projectiles: { enemy: [] }, enemies: { active: [] } };
const effects = new AugmentEffects(effectGame);
const effectObjectCount = effects.visualRoot.children.length;
assert.equal(effects.cosmic.mesh.instanceMatrix.count, 64, 'Cosmic decoration has one bounded instance bank');
for (let i = 0; i < 60; i++) effects._arc({ x: i, y: 0, z: -20 }, { x: i + 3, y: 2, z: -30 }, '#428aff');
effects.update(.02);
assert.equal(effects.arcs.length, 48, 'Chain effects stay capped during dense hit reactions');
assert.equal(effects.arcMesh.count, 144, 'Visible lightning uses one fixed three-segment instance bank');
assert.equal(effects.visualRoot.children.length, effectObjectCount, 'Repeated proc events do not allocate scene objects');
effects.update(.2);
assert.equal(effects.arcMesh.count, 0, 'Lightning geometry retires after its short visible life');
effects.reset();
assert.equal(effects.arcMesh.count, 0);

const previousSound = Audio2.playWeapon;
const previousSfx = Save.data.sfx;
try {
  const sounds = [], bolts = [];
  Audio2.playWeapon = (...args) => sounds.push(args);
  const player = { stats: { ...stats, prismLance: 1 }, alive: true, x: 0, y: 0,
    pos: new THREE.Vector3(), shield: 30, group: new THREE.Group(), fireRate: 6.5 };
  const weapon = new PlayerWeapon(player, { firePlayer: bolt => bolts.push(bolt) }, { reset() {} });
  weapon.onAugmentInstalled('prismLance', 1);
  assert.equal(sounds.at(-1)[0], 'prism');
  assert.equal(sounds.at(-1)[2].priority, 4, 'New augment auditions get precedence');
  Input.enabled = true; Input._keys.Space = false;
  weapon.update(1 / 60, { heat: { multiplier: 1 } });
  assert.equal(bolts.length, 0, 'The preview does not auto-fire the ship');
  Input._keys.Space = true;
  weapon.update(1 / 60, { heat: { multiplier: 1 } });
  assert.ok(bolts.some(bolt => bolt.weapon === 'prism'), 'New slow cadence gun showcases on the very next trigger');
  assert.ok(bolts.some(bolt => bolt.weapon === 'pulse'), 'The new gun preserves the existing salvo');

  class Param {
    constructor() { this.value = 1; this.events = []; }
    setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
    linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['ramp', value, time]); }
    cancelScheduledValues(time) { this.events.push(['cancel', time]); }
  }
  const sources = [], gains = [];
  const ctx = { currentTime: 1,
    createGain() { const gain = { gain: new Param(), connect() {}, disconnect() {} }; gains.push(gain); return gain; },
    createBufferSource() { const source = { playbackRate: { value: 1 }, connect() {}, disconnect() {},
      start(time) { this.startTime = time; }, stop(time) { this.stopTime = time; } }; sources.push(source); return source; },
  };
  const audio = new AudioManagerImpl();
  Save.data.sfx = 1; audio.ready = true; audio.ctx = ctx;
  audio.sfxGain = ctx.createGain(); audio.weaponGain = ctx.createGain();
  audio.musicGain = ctx.createGain(); audio.musicGain.gain.value = .65;
  for (const kind of Object.keys(WEAPON_AUDIO)) audio.buffers[`weapon_${kind}`] = { duration: 3, kind };
  for (const kind of Object.keys(WEAPON_AUDIO)) audio.playWeapon(kind);
  assert.equal(new Set(sources.map(source => source.buffer.kind)).size, Object.keys(WEAPON_AUDIO).length,
    'Every configured weapon selects a different recording');
  assert.equal(audio._weaponVoices, 18);
  const oldSource = sources[0];
  ctx.currentTime += 1;
  audio.playWeapon('prism', 8, { priority: 4 });
  assert.equal(audio._weaponVoices, 18, 'Priority steal respects the hard voice cap in the same JS task');
  assert.equal(oldSource.stopTime, ctx.currentTime, 'New gun steals a low priority base pulse');
  oldSource.onended();
  assert.equal(audio._weaponVoices, 18, 'Delayed ended event cannot double decrement a stolen voice');
  const empowered = sources.at(-1);
  assert.ok(empowered.playbackRate.value < WEAPON_AUDIO.prism.rate, 'Stacked gun deepens its voice');
  assert.ok(empowered.stopTime - empowered.startTime > WEAPON_AUDIO.prism.duration, 'Stacked gun gains a longer release');
  const count = sources.length;
  audio.playWeapon('pulse');
  assert.equal(sources.length, count, 'Ordinary pulse yields to a busy upgraded arsenal');
  audio.buffers.laser_warning = { duration: .2 };
  audio.play('laser_warning');
  assert.ok(audio.weaponGain.gain.events.some(event => event[0] === 'ramp' && event[1] === .28), 'Danger signal ducks weapon bus');
  assert.equal(audio.musicGain.gain.value, .65, 'Weapon duck does not change soundtrack level');
  assert.equal(audio.musicGain.gain.events.length, 0, 'Weapon mix never takes music ownership');
  for (const source of sources) source.onended?.();
  assert.equal(audio._weaponVoices, 0);
  assert.equal(audio._weaponActive.length, 0);
} finally {
  Input.reset(); Audio2.playWeapon = previousSound; Save.data.sfx = previousSfx;
}
console.log('Weapon feedback PASS: evolving primary identity, 17 ranked silhouettes/trails, immediate gun showcase, four batches, 18 prioritized voices and danger-only ducking.');
