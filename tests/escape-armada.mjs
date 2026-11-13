import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EscapeArmada } from '../src/encounters/EscapeArmada.js';
import { escapeIntensity } from '../src/config/escapeIntensity.js';
import { EnemySpawner } from '../src/enemies/EnemySpawner.js';
import { createEscapeRoute } from '../src/config/finalEscapeRoute.js';

const scene = new THREE.Scene(), shots = [];
const game = {
  targets: [], hazards: [], director: { state: 'ESCAPE', inCombat: true },
  player: { x: 0, y: 3, vx: 0, vy: 0, alive: true, stats: {}, refundBoost() {} },
  projectiles: { enemy: [], fireEnemy: shot => shots.push(shot) },
  stats: { maxOnscreen: 0, kills: 0 }, fx: { explode() {}, jet() {} },
  scrap: { burst() {} }, score: { add() {} }, heat: { onKill() {} }, xp: { add() {} },
  hud: { toast() {} }, addHazard() {},
};
game.escape = { elapsed: 0, distance: 0, speed: 50, routeLength: 6350, route: createEscapeRoute(),
  get progress() { return this.distance / this.routeLength; },
  get distanceLeft() { return this.routeLength - this.distance; },
  get intensity() { return escapeIntensity(this.progress, this.elapsed); } };
game.enemies = new EnemySpawner(scene, game);
let deaths = 0;
game.escape.carnage = { onEnemyDestroyed() { deaths++; } };
const fleet = new EscapeArmada(game, game.escape);
const step = (seconds) => {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) {
    game.escape.elapsed += 1 / 60; game.escape.distance += 50 / 60;
    fleet.update(1 / 60); game.enemies.update(1 / 60);
    game.targets = game.targets.filter(t => t.alive);
  }
};
step(10);
assert.equal(fleet.snapshot().capacity, 12);
assert.equal(fleet.snapshot().alive, 12);
assert.ok(shots.length > 0, 'Early fleet fires real enemy projectiles');
assert.ok(game.enemies.active.every(e => e.target.targetable && e.target.hp > 0));
assert.equal(game.hazards.length, 0, 'The armada never blankets escape openings with area-denial specials');
const victim = game.enemies.active[0];
victim.target.damage(1e6); step(1 / 60);
assert.equal(deaths, 1, 'A real enemy kill triggers the bounded destruction spectacle');
assert.equal(fleet.snapshot().destroyed, 1);
step(15);
assert.ok(fleet.snapshot().retired > 0, 'Overtaken ships retire instead of hovering forever');
assert.ok(fleet.snapshot().spawned > 12, 'New formations replace casualties and passed ships');

// A fixed late route creates a genuinely bigger fleet using the existing pool.
game.escape.elapsed = 113; game.escape.distance = 5700;
fleet.spawnAt = game.escape.elapsed; fleet.volleyAt = game.escape.elapsed;
step(8);
assert.equal(fleet.snapshot().capacity, 40);
assert.ok(fleet.snapshot().peakAlive >= 34);
assert.ok(fleet.snapshot().alive <= 40);
assert.equal(Object.values(game.enemies.pools).flat().length, 70, 'No runtime enemy pool growth');
assert.ok(game.enemies.active.every(e => Number.isFinite(e.x + e.y + e.z)));
assert.ok(game.enemies.active.every(e => e.z < -24 || e.escapeFlight.departing), 'No active close-range firing stations');

// Budget stays under the shared 512-bolt pool, including other spawned fire.
game.projectiles.enemy = Array.from({ length: 350 }, () => ({ active: true }));
fleet.update(.01);
assert.equal(fleet.allowShot({ x: 0, y: 3, z: -40, escapeFlight: { departing: false } }, { x: 15, y: 9 }, 35), false);
game.projectiles.enemy = [];
fleet._budget = 100;
game.escape.distance = 0; game.escape.elapsed = 0;
const shooter = { x: 0, y: 0, z: -50, escapeFlight: { departing: false } };
const arrival = 50 / (35 + 50 * .35);
game.escape.route = [{ distance: arrival * 50, x: 0, y: 0, halfWidth: 6, halfHeight: 4 }];
assert.equal(fleet.allowShot(shooter, { x: 0, y: 0 }, 35), false, 'Actual crossing remains open during the moving wall');
assert.equal(fleet.allowShot(shooter, { x: 35, y: 15 }, 35), true, 'Off-lane fire is still threatening');

const held = fleet.snapshot(); fleet.update(0);
assert.deepEqual(fleet.snapshot(), held, 'Paused or zero-time update cannot spawn/fire');
const oldMember = game.enemies.active.find(e => e.alive);
fleet.dispose(); assert.equal(fleet.snapshot().alive, 0);
assert.equal(fleet.active, false);
assert.ok(game.enemies.active.every(e => !e.alive));
game.director.state = 'TRAVERSAL_1';
const normal = game.enemies.spawn('gunship', 0, 3, -35);
assert.equal(normal.escapeFlight, null, 'Reused ordinary hulls lose all escape callbacks and flight behavior');
assert.ok(normal.fireT < 10);
const profile = escapeIntensity(.1, 130);
assert.equal(profile.tier, 5, 'Pressure grows on the fixed deadline even when the pilot falls behind');
console.log('PASS: escalating real 12→40 ship fleets, finite passes, reinforcements, target damage/death FX, live fire, aperture protection, projectile budget, pause and normal pooled reuse.');
