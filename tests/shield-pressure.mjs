import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player, BASE_STATS } from '../src/player/Player.js';
import { EnemySpawner } from '../src/enemies/EnemySpawner.js';
import { ENEMY_TYPES } from '../src/enemies/EnemyTypes.js';
import { Input } from '../src/core/Input.js';

Input.reset();
Input.enabled = false;
const fx = { explode() {}, jet() {} };
const player = new Player(new THREE.Scene(), fx);
const base = BASE_STATS();
assert.equal(base.shieldMax, 40);
assert.equal(base.shieldRegen, 4);
assert.equal(base.shieldDelay, 8);
assert.equal(base.shieldBreakDelay, 14);
assert.equal(base.healthRegen, 2);
const ctx = { hazards: [], time: 0 };
const step = (seconds) => {
  const frames = Math.ceil(seconds * 60);
  for (let i = 0; i < frames; i++) {
    ctx.time += seconds / frames;
    player.update(seconds / frames, ctx);
  }
};
let breaks = 0;
player.onShieldBreak = () => breaks++;

player.takeDamage(10);
assert.equal(player.shield, 30);
assert.equal(player.shieldBroken, false);
step(7.9);
assert.equal(player.shield, 30, 'Partial shield cannot recharge before eight clear seconds');
step(0.2);
assert.ok(player.shield > 30 && player.shield < 31);

player.reset(BASE_STATS());
player.takeDamage(40);
assert.equal(player.shield, 0);
assert.equal(player.health, 160, 'Exact shield depletion does not leak phantom hull damage');
assert.equal(player.shieldBroken, true);
assert.equal(breaks, 1, 'Exact depletion fires shield break once');
assert.equal(player.shieldRecoveryRemaining, 14);
step(13.9);
assert.equal(player.shield, 0, 'Depleted shield cannot recharge before fourteen clear seconds');
const hullBefore = player.health;
player.takeDamage(8);
assert.equal(player.health, hullBefore - 8, 'The ship is vulnerable while its shield is broken');
assert.equal(breaks, 1, 'Hull damage does not retrigger a broken shield');
assert.equal(player.shieldRecoveryRemaining, 14, 'Hull damage restarts the full lockout');
step(13.9);
assert.equal(player.shield, 0);
step(0.2);
assert.ok(player.shield > 0 && player.shield < 1, 'Recovery starts slowly, not with a full shield');
assert.equal(player.shieldBroken, false);

player.reset(BASE_STATS());
player.takeDamage(50);
assert.equal(breaks, 2);
assert.equal(player.health, 150, 'Excess damage crosses the depleted shield correctly');
player.stats.riftDrain = 3;
player.health = 100;
player.boost = 0;
player.awardDodge();
assert.equal(player.shield, 0, 'Rift Drain never bypasses shield downtime');
assert.equal(player.health, 124, 'Every Rift Drain stack heals eight hull');
assert.equal(player.boost, 36, 'Rift Drain adds six boost per stack to the normal dodge refund');
player.stats.dodgeDrive = 3;
player.awardDodge();
assert.equal(player.buffT, 6);
assert.equal(player.moveSpeed, player.stats.moveSpeed * 2.2);
assert.equal(player.fireRate, player.stats.fireRate * 2.2);

const protection = { ...BASE_STATS(), freeBlocks: 2, secondWind: 2 };
player.reset(protection);
player.takeDamage(10);
assert.equal(player.blocksLeft, 1);
player.applyStats(protection);
assert.equal(player.blocksLeft, 1, 'Unrelated stat application never refills spent blocks');
protection.freeBlocks += 1;
player.applyStats(protection);
assert.equal(player.blocksLeft, 2, 'Only the newly acquired protection adds a block');
player.blocksLeft = 0;
player.shield = 0;
for (let i = 0; i < 2; i++) {
  player.invuln = 0;
  player.takeDamage(1000);
  assert.equal(player.alive, true);
}
assert.equal(player.secondWindCharges, 0);
assert.equal(player.stats.secondWind, 2, 'Revives preserve acquired build rank');
player.stats.secondWind = 3;
assert.equal(player.secondWindCharges, 1, 'A new stack adds one charge without refunding spent ones');
player.invuln = 0;
player.takeDamage(1000);
assert.equal(player.alive, true);
assert.equal(player.secondWindCharges, 0);
player.invuln = 0;
player.takeDamage(1000);
assert.equal(player.alive, false, 'No charge means lethal damage remains lethal');
player.reset(BASE_STATS());
assert.equal(player.secondWindUsed, 0);
assert.equal(player.shieldBroken, false);

const shots = [];
const game = {
  targets: [], player: { x: 0, y: 3, vx: 0, vy: 0, stats: {}, refundBoost() {} },
  projectiles: { fireEnemy: (shot) => shots.push(shot) },
  stats: { maxOnscreen: 0, kills: 0 }, fx,
  scrap: { burst() {} }, score: { add() {} }, heat: { onKill() {} }, xp: { add() {} },
};
game.enemies = new EnemySpawner(new THREE.Scene(), game);
const counts = { scout: 3, gunship: 4, heavy: 7, shielder: 0, elite: 5 };
for (const [id, expected] of Object.entries(counts)) {
  game.player.x = 0;
  const enemy = game.enemies.spawn(id, 0, 3, -50, { fx: 0, fy: 3, fz: -30 });
  assert.equal(enemy.target.owner, enemy, 'Impact statuses can resolve an enemy from its target');
  shots.length = 0;
  enemy._shoot(game);
  assert.equal(shots.length, expected, `${id} has its intended projectile pattern`);
  assert.ok(shots.every((shot) => shot.speed <= 40 && shot.tz > shot.z));
  assert.ok(shots.every((shot) => shot.color === ENEMY_TYPES[id].shotColor));
  if (id === 'gunship') assert.deepEqual(shots.map((shot) => shot.tx), [-7, -2.2, 2.2, 7]);
  if (id === 'heavy') assert.equal(shots.filter((shot) => shot.heavy).length, 1, 'Only the central heavy shell uses the large danger silhouette');
  if (id === 'scout') {
    enemy.fireT = 0;
    enemy.burstLeft = 0;
    enemy.update(1 / 60, game);
    assert.equal(enemy.burstT, 0.32, 'New bursts begin with a warning window');
    const aim = { ...enemy.burstAim };
    game.player.x = 15;
    shots.length = 0;
    enemy._shoot(game);
    assert.equal(shots[1].tx, aim.x, 'Warnings lock the aim so a dodge is not tracked');
    const phase = enemy.phase;
    enemy.augmentSlowT = 2;
    enemy.augmentSlowFactor = 0.4;
    enemy.update(0.1, game);
    assert.ok(Math.abs(enemy.phase - phase - 0.04) < 1e-8, 'Slow affects enemy movement/action time');
    assert.equal(enemy.augmentSlowT, 1.9, 'Status duration expires in unscaled game time');
    enemy.despawn();
    game.enemies.spawn(id, 0, 3, -50);
    assert.equal(enemy.augmentSlowT, 0, 'Pooled ships never inherit a previous life’s slow');
    assert.equal(enemy.augmentSlowFactor, 1);
  }
}
let killHooks = 0;
game.augmentEffects = { onKill() { killHooks++; } };
const victim = game.enemies.active.find((enemy) => enemy.alive);
victim.die();
victim.die();
assert.equal(killHooks, 1, 'Kill procs trigger once per enemy life');
console.log('Shield pressure: 8s partial/14s broken recharge, damage resets, stackable defenses, readable enemy patterns, telegraph snapshot and status pooling passed.');
