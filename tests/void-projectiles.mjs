import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerWeapon } from '../src/player/PlayerWeapon.js';
import { ProjectilePool } from '../src/combat/ProjectilePool.js';
import { CollisionSystem } from '../src/combat/CollisionSystem.js';
import { Target } from '../src/combat/Target.js';
import { Input } from '../src/core/Input.js';
import { Audio2 } from '../src/core/AudioManager.js';

function fixture(active = false, extra = {}, pool = null) {
  const stats = { damage: 36, fireRate: 9, projectileSpeed: 105, criticalChance: 0,
    criticalMultiplier: 2.5, weakPointDamage: 1, ...extra };
  const player = { stats, alive: true, frozen: false, x: 0, y: 1,
    pos: new THREE.Vector3(0, 1, 0), vx: 0, vy: 0, shield: 30, critBuffT: 0,
    get fireRate() { return stats.fireRate; },
    ultraUltimate: { active, tuning: () => ({ projectileMultiplier: 100,
      projectileTrails: 1, impactEffects: 1, reducedFlashing: false }) } };
  const bolts = [];
  const weapon = new PlayerWeapon(player, pool || { firePlayer(bolt) { bolts.push(bolt); return bolt; } },
    { reset() {}, update() { return null; } });
  const ctx = { targets: [], heat: { multiplier: 1 } };
  const step = frames => { for (let i = 0; i < frames; i++) weapon.update(1 / 60, ctx); };
  return { player, stats, bolts, weapon, ctx, step };
}

const sound = Audio2.playWeapon;
Audio2.playWeapon = () => {};
Input.enabled = true;
Input._keys.Space = true;
try {
  const normal = fixture(false, { twinFangs: 2, broadsides: 1, echoBarrage: 1 });
  const ultra = fixture(true, { twinFangs: 2, broadsides: 1, echoBarrage: 1 });
  normal.step(600); ultra.step(600);
  assert.equal(ultra.weapon.shots, normal.weapon.shots, 'Ultra preserves the exact cannon cadence');
  assert.equal(ultra.bolts.length, normal.bolts.length, 'Ultra adds no automatic or continuous attacks');
  for (let i = 0; i < normal.bolts.length; i++) {
    const a = normal.bolts[i], b = ultra.bolts[i];
    const cannon = ['pulse', 'capacitor', 'twin'].includes(a.weapon);
    assert.equal(b.damage, a.damage * (cannon ? 100 : 1), `${a.weapon} gets the intended one-time multiplier`);
    assert.equal(Boolean(b.visual.voidBeam), cannon);
  }
  assert.deepEqual(normal.stats, ultra.stats, 'No damage multiplier mutates player upgrade stats');

  const crit = fixture(true, { criticalChance: 1, kineticCapacitor: 2 });
  crit.weapon.charge = 1;
  crit.step(1);
  assert.equal(crit.bolts[0].damage, 36 * 2.5 * (1 + 2 * 2.5) * 100,
    'Ultra multiplies the fully critical, capacitor-adjusted primary damage once');
  ultra.player.ultraUltimate.active = false;
  const firstRestored = ultra.bolts.length;
  ultra.step(12);
  const restored = ultra.bolts.slice(firstRestored).filter(bolt => bolt.weapon === 'pulse');
  assert.ok(restored.length > 0);
  assert.ok(restored.every(bolt => bolt.damage === 36 && !bolt.visual.voidBeam),
    'The first post-cancel cannon shot restores normal damage and appearance');

  const scene = new THREE.Scene();
  const pool = new ProjectilePool(scene);
  const f = fixture(true, {}, pool);
  f.step(1);
  const beam = pool.player.find(bolt => bolt.active);
  const voidVisual = { ...beam.visual };
  assert.ok(beam.voidBeam);
  assert.ok(beam.visual.length >= 7.5 && beam.visual.length <= 11, 'Void shots stay discrete and bounded');
  const firstColor = new THREE.Color();
  pool.playerCore.getColorAt(beam.index * 3, firstColor);
  for (let frame = 0; frame < 30; frame++) pool.update(1 / 60);
  const nextColor = new THREE.Color();
  pool.playerCore.getColorAt(beam.index * 3, nextColor);
  assert.notDeepEqual(firstColor.toArray(), nextColor.toArray(), 'Projectile rainbow changes throughout flight');
  assert.equal(beam.damage, 3600, 'Flight and render updates never reapply the multiplier');
  assert.equal(scene.children.length, 4, 'Ultra projectiles retain the existing four GPU batches');

  pool.reset();
  const fresh = pool.firePlayer({ x: 0, y: 0 });
  assert.equal(fresh.voidBeam, false, 'Pooled normal shots never inherit ultra metadata');
  pool.reset();

  // Exercise actual target damage, kill credit callback, effects, and the
  // swept collision system across a complete target in a single update.
  let deaths = 0, hits = 0;
  const target = new Target({ hp: 2000, radius: .5, onDeath: () => deaths++, onDamage: () => hits++ });
  target.pos.set(0, 1, -10);
  const bursts = [];
  const game = { player: { alive: true, x: 0, y: 1, radius: 1.35, dodgeT: 0 },
    projectiles: pool, targets: [target], hazards: [], enemies: { active: [] },
    damageNumbers: { spawn() {}, spawnBlocked() {} }, heat: { onDealDamage() {} },
    fx: { explode(...args) { bursts.push(args); } } };
  const sweep = pool.firePlayer({ x: 0, y: 1, z: -1, speed: 2000, damage: 3600,
    visual: { ...voidVisual, reducedFlashing: true } });
  pool.update(1 / 60);
  assert.ok(sweep.z < target.pos.z - target.radius);
  new CollisionSystem(game).update(1 / 60);
  assert.equal(hits, 1, 'Fast Void Beam hits through the existing swept segment exactly once');
  assert.equal(deaths, 1, 'Target death and kill callback are preserved');
  assert.equal(sweep.active, false);
  assert.equal(bursts[0][3].flashScale, 0, 'Reduced-flashing impacts omit the glow flash');
  assert.ok(bursts[0][3].sparkColors.length >= 5, 'Void impacts retain their prismatic burst');

  // A second shot against a protected core remains blocked through the same
  // legitimate damage scale, even at the intentionally overwhelming power.
  const core = new Target({ hp: 2000, radius: .5, damageScale: 0 });
  core.pos.set(0, 1, -10); game.targets = [core];
  const blocked = pool.firePlayer({ x: 0, y: 1, z: -1, speed: 2000, damage: 3600,
    visual: { ...voidVisual } });
  pool.update(1 / 60); new CollisionSystem(game).update(1 / 60);
  assert.equal(core.hp, 2000, 'Ultra shots respect encounter shield and phase protections');
  assert.equal(blocked.active, false);
  assert.equal(bursts.length, 1, 'Blocked shots do not spawn damaging hit reactions');
} finally {
  Input.reset();
  Audio2.playWeapon = sound;
}
console.log('Void projectiles PASS: exact 100x upgraded cannon damage, unchanged cadence, restoration, bounded rainbow pooling, fast swept hits, protected phases, reduced flashing.');
