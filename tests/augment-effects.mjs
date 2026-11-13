import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AugmentEffects, blockedBetween } from '../src/combat/AugmentEffects.js';
import { CollisionSystem, segmentSphereTime } from '../src/combat/CollisionSystem.js';
import { Target } from '../src/combat/Target.js';

function fixture(stats = {}) {
  const shots = [];
  const game = {
    scene: new THREE.Scene(), targets: [], projectileBlockers: [], hazards: [],
    player: { alive: true, x: 0, y: 0, radius: 1.35, shield: 0, health: 50,
      dodgeT: 0, dodgePending: false, stats: { projectileSpeed: 105, ...stats },
      heal(n) { this.health += n; }, takeDamage() { return false; } },
    enemies: { active: [] }, fx: { explode() {} }, heat: { onDealDamage() {} },
    damageNumbers: { spawn() {}, spawnBlocked() {} },
    projectiles: {
      player: [], enemy: [],
      firePlayer(data) { const b = { ...data, active: true, hitTargets: new Set() }; shots.push(b); return b; },
      killPlayerBolt(b) { b.active = false; }, killEnemyBolt(b) { b.active = false; },
      clearEnemyNear(x, y, r) {
        let n = 0;
        for (const b of this.enemy) if (b.active && b.z > -30 && Math.hypot(b.x - x, b.y - y) < r) { b.active = false; n++; }
        return n;
      },
    },
  };
  const effects = new AugmentEffects(game);
  game.augmentEffects = effects;
  const target = (x, y, z, hp = 1000) => {
    const object = new THREE.Object3D();
    object.position.set(x, y, z);
    const t = new Target({ object3D: object, hp, radius: 1, kind: 'enemy' });
    game.targets.push(t);
    return t;
  };
  const enemy = (x, y, z, hp = 1000) => {
    const t = target(x, y, z, hp);
    const e = { x, y, z, alive: true, target: t, mesh: t.object3D, augmentSlowFactor: 1, augmentSlowT: 0 };
    t.owner = e;
    t.onDeath = () => { e.alive = false; effects.onKill(e); };
    game.enemies.active.push(e);
    return e;
  };
  return { game, effects, shots, target, enemy };
}

const bolt = (patch = {}) => ({
  active: true, x: 0, y: 0, z: -20, px: 0, py: 0, pz: 0,
  vx: 0, vy: 0, vz: -100, speed: 100, life: 2, radius: 0.4,
  damage: 20, crit: false, procDepth: 0, pierce: 0, splash: 0,
  hitTargets: new Set(), color: '#45cfff', mesh: new THREE.Object3D(), ...patch,
});

// Swept collision keeps accelerated rail shots honest, in front-to-back order.
assert.ok(Math.abs(segmentSphereTime({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -40 }, { x: 0, y: 0, z: -20 }, 1) - 0.475) < 1e-10);
assert.equal(segmentSphereTime({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -40 }, { x: 4, y: 0, z: -20 }, 1), null);
{
  const { game, target } = fixture();
  const far = target(0, 0, -25), near = target(0, 0, -10);
  const b = bolt({ z: -40, pierce: 1 });
  game.projectiles.player.push(b);
  new CollisionSystem(game).update(1 / 60);
  assert.equal(near.hp, 980);
  assert.equal(far.hp, 980);
  assert.equal(b.hitTargets.size, 2);
  assert.equal(b.active, false);
}
{
  const { game, target } = fixture({ fragmentation: 2, teslaFork: 2, solarBurn: 2 });
  const front = target(0, 0, -8), behind = target(0, 0, -23);
  game.projectileBlockers.push({ blocks: (_x, _y, z) => z < -14 && z > -17 });
  const b = bolt({ z: -40, pierce: 3 });
  game.projectiles.player.push(b);
  new CollisionSystem(game).update(1 / 60);
  assert.equal(front.hp, 980, 'A shield behind a target does not protect it');
  assert.equal(behind.hp, 1000, 'Neither fast piercing bolts nor Tesla chains bypass a shield slab');
  assert.equal(b.active, false);
  assert.equal(blockedBetween(game, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -40 }), true);
}

// Every impact rank gives measurable value, while blocked impacts do nothing.
for (const r of [1, 2, 5]) {
  const { game, effects, shots, enemy, target } = fixture({ teslaFork: r, fragmentation: r, cryoRounds: r, solarBurn: r, gravityWell: r });
  const primary = enemy(0, 0, -20);
  const neighbor = target(3, 0, -20);
  const protectedTarget = target(4, 1, -20);
  protectedTarget.targetable = false;
  effects.onHit(bolt(), primary.target, 0);
  assert.equal(shots.length, 0);
  assert.equal(effects.fields.length, 0);
  effects.onHit(bolt(), primary.target, 20);
  assert.equal(neighbor.hp, 1000 - 7 * r, 'Tesla damage scales with every rank');
  assert.equal(protectedTarget.hp, 1000);
  assert.equal(shots.length, Math.min(8, r * 2));
  assert.ok(Math.abs(shots.reduce((n, s) => n + s.damage, 0) - 14 * r) < 1e-10, 'Fragment visual cap preserves total rank damage');
  assert.ok(shots.every((s) => s.procDepth === 1 && s.tz < s.z && s.hitTargets.has(primary.target)));
  assert.equal(primary.augmentSlowFactor, 1 / (1 + 0.28 * r));
  assert.equal(primary.augmentSlowT, 1.6 + 0.4 * r);
  assert.equal(effects.burns.get(primary.target).damage, 20 * 0.22 * r);
  assert.equal(effects.fields[0].radius, 4 + 1.2 * r);
  const fieldCount = effects.fields.length;
  effects.onHit(bolt({ procDepth: 1 }), primary.target, 20);
  assert.equal(effects.fields.length, fieldCount, 'Child impacts cannot recursively create fields or fragments');
  const before = primary.target.hp;
  effects.update(0.25);
  assert.ok(primary.target.hp < before, 'Burn and well apply real damage over game time');
  primary.target.targetable = false;
  const shieldedHp = primary.target.hp;
  effects.update(0.25);
  assert.equal(primary.target.hp, shieldedHp, 'Invulnerable targets remain protected from persistent effects');
  effects.reset();
  assert.equal(effects.fields.length, 0);
  assert.equal(effects.burns.size, 0);
  assert.equal(primary.augmentSlowT, 0);
}

// Ricochets choose a new target and never hit an already-visited one again.
{
  const { game, effects, enemy } = fixture({ solarBurn: 2, gravityWell: 2, treasureMunitions: 2 });
  const e = enemy(0, 0, -20);
  effects.onHit(bolt(), e.target, 20);
  effects.onScrap(8);
  game.projectiles.enemy.push({ active: true, x: 0, y: 0, z: -10, augmentTimeScale: 0.4 });
  const hp = e.target.hp;
  effects.update(1, { active: false });
  assert.equal(e.target.hp, hp, 'Intermission never applies pending DoT or field damage');
  assert.equal(effects.burns.size, 0);
  assert.equal(effects.fields.length, 0);
  assert.equal(e.augmentSlowT, 0);
  assert.equal(game.projectiles.enemy[0].augmentTimeScale, 1);
  effects.update(1, { active: true });
  assert.equal(e.target.hp, hp, 'Reactivation cannot catch up discarded intermission damage');
  assert.equal(game.player.treasureCharge, 24);
}

{
  const { effects, target } = fixture({ ricochet: 2 });
  const first = target(0, 0, -20), next = target(5, 1, -25);
  target(1, 0, 5); // enemy that passed behind the player is ineligible
  const b = bolt({ ricochetsRemaining: 2 });
  b.hitTargets.add(first);
  assert.equal(effects.redirect(b, first), true);
  assert.equal(b.target, next);
  assert.equal(b.ricochetsRemaining, 1);
  assert.ok(b.vx > 0 && b.vz < 0);
  b.hitTargets.add(next);
  assert.equal(effects.redirect(b, next), false);
}

// Kills are deduplicated per target-life, snapshots survive pooling, and
// secondary damage cannot recurse into an unbounded explosion/kill cycle.
{
  const { game, effects, enemy } = fixture({ chainReaction: 2, singularity: 2, bloodReactor: 2 });
  const victim = enemy(2, 0, -20, 10);
  effects.damageTarget(victim.target, 20, false, false);
  effects.onKill(victim);
  assert.equal(effects.killQueue.length, 1);
  assert.equal(game.player.health, 54, 'Kill heal applies once');
  victim.x = 100;
  assert.equal(effects.killQueue[0].x, 2, 'Queued blast captures position before enemy reuse');
  const secondaryVictim = enemy(3, 0, -20, 1);
  effects.update(0.1);
  assert.equal(secondaryVictim.alive, false);
  assert.equal(effects.killQueue.length, 0, 'Chain victims do not queue further chains');
  for (let i = 0; i < 3; i++) {
    const e = enemy(30 + i, 0, -30, 1);
    effects.damageTarget(e.target, 20, false, false);
  }
  effects.update(0.1);
  assert.equal(effects.fields.length, 1, 'Every fourth primary kill creates a singularity');
  assert.equal(effects.fields[0].damage, 48);
}

for (const r of [1, 2, 13]) {
  const { game, effects, shots, enemy } = fixture({ bulletSiphon: r, timeDilation: r, revengeMatrix: r, treasureMunitions: r, realityTear: r });
  const closeEnemy = enemy(0, 0, -10, 10000);
  game.projectiles.enemy.push({ active: true, x: 1, y: 0, z: -5 });
  effects.onPerfectDodge();
  assert.ok(closeEnemy.target.hp < 10000, 'Dodge detonation actually damages targets');
  assert.equal(shots.length, Math.min(24, 2 * r + 1), 'Siphon converts bullets before Reality Tear clears them');
  assert.ok(shots.every((b) => b.procDepth === 1 && b.tz < b.z));
  game.projectiles.enemy.push({ active: true, x: 1, y: 0, z: -12 });
  effects.update(0.1);
  assert.equal(game.projectiles.enemy.at(-1).augmentTimeScale, 1 / (1 + 0.35 * r));
  effects.onScrap(10);
  assert.equal(game.player.treasureCharge, 15 * r);
  const n = shots.length;
  effects.onShieldBreak();
  const revenge = shots.slice(n);
  assert.ok(Math.abs(revenge.reduce((sum, b) => sum + b.damage, 0) - (8 + r) * 14 * r) < 1e-7);
  effects.update(0.1, { active: false });
  assert.equal(effects.fields.length, 0, 'Intermissions discard stale damage fields');
  assert.equal(game.player.treasureCharge, 15 * r, 'Intermissions preserve stored treasure power');
  effects.reset();
  assert.equal(game.player.treasureCharge, 0);
  assert.equal(game.projectiles.enemy.at(-1).augmentTimeScale, 1);
}

console.log('Augment effects: ranked damage/status/dodge/loot reactions, finite chains, swept hits, shield occlusion, target eligibility and reset pass.');
