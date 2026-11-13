import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EnemySpawner } from '../src/enemies/EnemySpawner.js';
import { ENEMY_TYPES } from '../src/enemies/EnemyTypes.js';
import { enemySector } from '../src/enemies/EnemyAbilities.js';
import { TRAVERSAL } from '../src/config/encounters.js';

const scene = new THREE.Scene(), shots = [];
const game = {
  targets: [], hazards: [], director: { state: 'TRAVERSAL_1', inCombat: true },
  player: { x: 0, y: 3, vx: 0, vy: 0, alive: true, stats: {}, refundBoost() {} },
  projectiles: { fireEnemy: shot => shots.push(shot) },
  stats: { maxOnscreen: 0, kills: 0 }, fx: { explode() {}, jet() {} },
  scrap: { burst() {} }, score: { add() {} }, heat: { onKill() {} }, xp: { add() {} },
  hud: { toast() {} },
  addHazard(hazard) { hazard.addTo(scene); this.hazards.push(hazard); return hazard; },
  clearHazards() { for (const h of this.hazards) h.dispose(scene); this.hazards.length = 0; },
};
game.enemies = new EnemySpawner(scene, game);
const step = seconds => {
  const frames = Math.ceil(seconds * 120), dt = seconds / frames;
  for (let frame = 0; frame < frames; frame++) {
    game.enemies.update(dt);
    for (let i = game.hazards.length - 1; i >= 0; i--) {
      const h = game.hazards[i]; h.update(dt);
      if (h.done) { h.dispose(scene); game.hazards.splice(i, 1); }
    }
  }
};
const clear = () => { game.enemies.clear(); game.clearHazards(); shots.length = 0; game.targets.length = 0; };
const spawn = type => {
  const e = game.enemies.spawn(type, -11, 3, -30, { fx: -11, fy: 3, fz: -30 });
  e.fireT = 99; e.special.cooldown = 0;
  return e;
};

for (const [id, type] of Object.entries(ENEMY_TYPES)) {
  clear(); game.player.x = 0; game.player.y = 3;
  const enemy = spawn(id);
  step(1 / 120);
  assert.equal(enemy.special.phase, 'windup', `${id} starts a visible special`);
  assert.ok(enemy.special.hazards.length > 0, `${id} has an actual rendered warning`);
  assert.ok(enemy.special.hazards.every(h => h.objects.length && !h.live));
  assert.ok(type.special.warning >= .8);
  const lock = { ...enemy.special.lock };
  game.player.x = 18; game.player.y = -8;
  step(type.special.warning - .08);
  assert.deepEqual(enemy.special.lock, lock, `${id} never tracks the dodge after locking`);
  assert.ok(enemy.special.hazards.every(h => !h.live), `${id} cannot hurt before its full warning`);
  assert.equal(shots.filter(s => s.label === type.special.name).length, 0);
  const preBlink = enemy.x;
  step(.16);
  assert.equal(enemy.special.phase, 'recover');
  if (id === 'scout') {
    const specialShots = shots.filter(s => s.label === type.special.name);
    assert.equal(specialShots.length, 5);
    assert.equal(specialShots[2].tx, lock.x);
    assert.equal(specialShots[2].ty, lock.y);
  } else if (id === 'shielder') {
    assert.ok(enemy.specialShieldT > 3, 'Bulwark actively overcharges its protection');
    const ally = game.enemies.spawn('gunship', enemy.x + 1, enemy.y, enemy.z);
    ally.fireT = 99; ally.special.cooldown = 99;
    step(1 / 120);
    assert.equal(ally.target.damageScale, .18, 'Nearby allies get the announced overcharged shield');
    assert.equal(enemy.target.damageScale, 1, 'The shield source is always a vulnerable priority target');
    enemy.die(); step(1 / 120);
    assert.equal(ally.target.damageScale, 1, 'Destroying the source immediately breaks protection');
  } else {
    assert.ok(enemy.special.hazards.some(h => h.live && h.hits(lock.x, lock.y)), `${id} special actually threatens the locked point`);
    assert.ok(enemy.special.hazards.every(h => !h.hits(21, -8)), `${id} leaves a reachable exit`);
    if (id === 'elite') assert.ok(Math.abs(enemy.x - preBlink) > 10, 'Corsair really changes flank');
  }

  // Dead source ships cannot release attacks after their warning disappears.
  clear(); const doomed = spawn(id); step(1 / 120);
  const pending = [...doomed.special.hazards];
  doomed.die(); step(type.special.warning + .2);
  assert.equal(shots.filter(s => s.label === type.special.name).length, 0);
  assert.ok(pending.every(h => h.done && !h.live));

  // Upgrade cards clear threats. The resumed enemy must show a new warning.
  clear(); const interrupted = spawn(id); step(1 / 120);
  game.clearHazards(); step(.1);
  assert.equal(interrupted.special.phase, 'idle');
  assert.ok(interrupted.special.cooldown >= 1.8);
  assert.equal(shots.filter(s => s.label === type.special.name).length, 0);

  clear(); const reused = spawn(id); step(1 / 120);
  const old = [...reused.special.hazards]; reused.despawn();
  const fresh = game.enemies.spawn(id, 5, 5, -35);
  assert.equal(reused, fresh); assert.equal(fresh.special.phase, 'idle');
  for (const h of old) { h.update(10); assert.ok(h.done && !h.live, 'Old pooled-life warnings stay retired'); }
}

clear(); game.director.state = 'TRAVERSAL_3';
for (const id of ['heavy', 'heavy', 'heavy', 'heavy', 'heavy']) spawn(id);
step(1 / 120);
assert.equal(game.enemies.active.filter(e => e.special.phase === 'windup').length, 3, 'At most three late-sector specials overlap');
assert.equal(game.hazards.length, 9, 'Mine clusters stay inside the hazard budget');
game.director.inCombat = false;
step(.1);
assert.ok(game.enemies.active.every(e => e.special.phase === 'idle'), 'Cut scenes and safe states cancel enemy abilities');
assert.ok(game.hazards.every(h => !h.live));

clear(); game.director.inCombat = true; game.director.state = 'ESCAPE';
const pursuer = spawn('elite'); step(5);
assert.equal(pursuer.special.phase, 'idle');
assert.equal(game.hazards.length, 0, 'Escape pursuers cannot seal the only required route opening');

clear(); game.director.state = 'TRAVERSAL_1';
const early = spawn('gunship'); const earlyHP = early.target.maxHp;
clear(); game.director.state = 'INHIBITOR_APPROACH';
const late = spawn('gunship');
assert.ok(late.target.maxHp > earlyHP && late.firePressure < 1 && late.damagePressure > 1);
assert.equal(enemySector('BOSS_COMBAT'), 4); assert.equal(enemySector('TOWER_2_COMBAT'), 1);
assert.equal(enemySector('ESCAPE'), 0); assert.equal(enemySector(), 0);
assert.deepEqual(Object.values(TRAVERSAL).map(s => s.augmentAt.length), [3, 3, 3, 3]);
assert.deepEqual(Object.values(TRAVERSAL).map(s => s.maxEnemies), [7, 8, 9, 9]);
clear();
console.log('PASS: five distinct enemy specials, locked tells, real damage/protection/blink, death/card/pool cancellation, concurrency caps, sector pressure, safe intros and escape corridor preservation.');
