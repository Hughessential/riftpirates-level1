import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerWeapon } from '../src/player/PlayerWeapon.js';
import { ProjectilePool } from '../src/combat/ProjectilePool.js';
import { WEAPON_STYLES, PROJECTILE_BUDGET } from '../src/config/weapons.js';
import { Input } from '../src/core/Input.js';
import { Audio2 } from '../src/core/AudioManager.js';

const defaults = () => ({ damage: 18, fireRate: 6.5, projectileSpeed: 105,
  criticalChance: 0, criticalMultiplier: 2.5, weakPointDamage: 1 });
function fixture(extra = {}, pool = null) {
  const stats = { ...defaults(), ...extra };
  const player = { stats, alive: true, frozen: false, x: 0, y: 1,
    pos: { x: 0, y: 1 }, vx: 16, vy: 0, shield: 0, boosting: true, critBuffT: 0,
    get fireRate() { return stats.fireRate; }, group: new THREE.Group() };
  const bolts = [], sounds = [];
  const projectiles = pool || { firePlayer(b) { bolts.push(b); return b; } };
  const weapon = new PlayerWeapon(player, projectiles, { reset() {}, update() { return null; } });
  const ctx = { targets: [], heat: { multiplier: 9 } };
  const update = (frames) => { for (let i = 0; i < frames; i++) weapon.update(1 / 60, ctx); };
  return { stats, player, bolts, weapon, ctx, update, sounds };
}
Input.enabled = true;
Input._keys.Space = true;
const originalSound = Audio2.playWeapon;
const soundKinds = new Set();
Audio2.playWeapon = (kind) => soundKinds.add(kind);

try {
  const patterns = {
    twinFangs: 'twin', broadsides: 'broadsides', helixVolley: 'helix', prismLance: 'prism',
    scatterNova: 'scatter', seekerSwarm: 'seeker', voidMortar: 'mortar', orbitals: 'orbital',
    echoBarrage: 'echo', shrapnelWake: 'wake', kineticCapacitor: 'capacitor',
  };
  for (const [augment, kind] of Object.entries(patterns)) {
    const results = [1, 2, 13].map((rank) => {
      const f = fixture({ [augment]: rank }); f.update(600);
      const specialized = f.bolts.filter((b) => b.weapon === kind);
      assert.ok(specialized.length > 0, `${augment} must fire its distinct gun`);
      assert.ok(f.bolts.every((b) => b.tz < b.z), `${augment} fires forward`);
      return specialized.reduce((sum, b) => sum + b.damage, 0);
    });
    assert.ok(results[1] > results[0], `${augment} second rank improves actual output`);
    assert.ok(results[2] > results[1], `${augment} high stacks still add power beyond visual caps`);
    assert.ok(soundKinds.has(kind), `${kind} has a distinct sound cue`);
  }
  assert.equal(new Set(Object.values(WEAPON_STYLES).map((s) => s.color)).size,
    Object.keys(WEAPON_STYLES).length, 'Every weapon style owns a distinct neon color');
  const cadences = [10, 11, 12, 13].map((rank) => {
    const f = fixture({ fireRate: 6.5 * (1 + rank * .35) });
    f.update(600);
    return f.weapon.shots;
  });
  assert.ok(cadences.every((n, i) => i === 0 || n > cadences[i - 1]), 'Every rapid-fire stack adds real shots at 60Hz, without a 30Hz plateau');

  {
    const f = fixture({ echoBarrage: 3 }); f.update(20);
    Input._keys.Space = false;
    const before = f.bolts.length; f.update(120);
    assert.equal(f.bolts.length, before, 'Releasing manual fire cancels scheduled echoes');
    assert.equal(f.weapon.echoes.length, 0);
    Input._keys.Space = true;
    f.player.treasureCharge = 40; f.weapon.cooldown = 0; f.weapon.update(1 / 60, f.ctx);
    assert.equal(f.bolts.at(-1).damage, 58, 'Treasure adds damage to the next primary salvo');
    assert.equal(f.player.treasureCharge, 0, 'Loot charge is consumed once');
    f.weapon.reset(); assert.equal(f.weapon.charge, 0); assert.equal(f.weapon.echoes.length, 0);
  }

  const scene = new THREE.Scene();
  const pool = new ProjectilePool(scene);
  assert.equal(scene.children.length, 4, 'All bullets share four GPU draw batches');
  assert.equal(pool.player.length, PROJECTILE_BUDGET.player);
  assert.equal(pool.enemy.length, PROJECTILE_BUDGET.enemy);
  const hit = {};
  let b = pool.firePlayer({ x: 0, y: 0, weapon: 'mortar', procDepth: 1, damage: 5,
    crit: true, splash: 7, pierce: 3, homing: 4, ricochetsRemaining: 3 });
  b.hitTargets.add(hit);
  assert.equal(b.color, WEAPON_STYLES.mortar.color, 'Critical hits preserve gun identity');
  pool.reset();
  b = pool.firePlayer({ x: 0, y: 0, damage: 5 });
  assert.equal(b.procDepth, 0); assert.equal(b.hitTargets.size, 0);
  assert.equal(b.pierce, 0); assert.equal(b.splash, 0); assert.equal(b.homing, 0);
  assert.equal(b.ricochetsRemaining, 0); assert.equal(b.color, WEAPON_STYLES.pulse.color);
  pool.update(.1);
  assert.equal(b.pz, 0); assert.ok(b.z < -10, 'Previous coordinates retain swept-collision segment');

  pool.reset();
  const front = { alive: true, targetable: true, pos: { x: 8, y: 0, z: -40 } };
  const behind = { alive: true, targetable: true, pos: { x: 0, y: 0, z: 8 } };
  b = pool.firePlayer({ x: 0, y: 0, weapon: 'seeker', homing: 5, target: behind });
  pool.update(.1, 0, { targets: [behind, front] });
  assert.equal(b.target, front); assert.ok(b.vx > 0 && b.vz < 0, 'Seekers acquire forward targets');
  front.alive = false;
  pool.update(.1, 0, { targets: [behind, front] });
  assert.equal(b.target, null); assert.ok(b.vz < 0, 'Dead locks cannot turn missiles toward the player');
  const e = pool.fireEnemy({ x: 0, y: 0, z: -20, tx: 0, ty: 0, tz: 0, speed: 20, damage: 5 });
  e.augmentTimeScale = .5; pool.update(.1);
  assert.equal(e.z, -19); assert.equal(e.pz, -20, 'Slow fields affect hostile motion and preserve sweep');
  pool.reset();
  const freshEnemy = pool.fireEnemy({ x: 0, y: 0, z: -20, tx: 0, ty: 0, speed: 20, damage: 5 });
  assert.equal(freshEnemy.augmentTimeScale, 1, 'Slow fields cannot leak across pooled enemies');

  pool.reset();
  const mixed = fixture({ twinFangs: 3, broadsides: 3, helixVolley: 2, seekerSwarm: 1,
    voidMortar: 1, scatterNova: 1, prismLance: 1, fireRate: 9 }, pool);
  let peak = 0;
  for (let frame = 0; frame < 1200; frame++) {
    mixed.weapon.update(1 / 60, mixed.ctx); pool.update(1 / 60, 0, mixed.ctx); pool.flush();
    peak = Math.max(peak, pool.player.filter((o) => o.active).length);
  }
  assert.ok(peak > 100, 'A real 13-pick build creates a dense arsenal');
  assert.equal(pool.saturationCount, 0, 'A normal stacked build does not silently lose shots');
  assert.equal(scene.children.length, 4, 'Sustained fire never adds draw objects');
  pool.reset();
  for (let i = 0; i < PROJECTILE_BUDGET.player + 100; i++) pool.firePlayer({ x: 0, y: 0, damage: 1 });
  assert.equal(pool.player.reduce((sum, o) => sum + o.damage, 0), PROJECTILE_BUDGET.player + 100,
    'Pathological saturation preserves additional damage without allocating');
  assert.equal(pool.saturationCount, 100);
  console.log(`Arsenal PASS: 11 gun augments scale through rank13; colors/audio/manual fire;4 GPU batches; ${peak} peak live player shots; pooling, forward homing and saturation.`);
} finally {
  Input.reset(); Audio2.playWeapon = originalSound;
}
