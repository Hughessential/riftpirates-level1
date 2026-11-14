import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EnemySpawner } from '../src/enemies/EnemySpawner.js';
import { ENEMY_TYPES } from '../src/enemies/EnemyTypes.js';
import { ScrapSystem, LOOT_GLOW } from '../src/systems/ScrapSystem.js';

const scene = new THREE.Scene();
const pickups = [];
const game = {
  targets: [], hazards: [], director: { state: 'TOWER_1_COMBAT', inCombat: true },
  player: { x:0,y:0,alive:true,stats:{scrapRadius:4.5,scrapMultiplier:1,scrapYield:0,riftDrain:0},refundBoost(){} },
  projectiles:{fireEnemy(){}}, stats:{maxOnscreen:0,kills:0}, fx:{explode(){},jet(){}},
  score:{add(){}}, heat:{onKill(){},onScrapCollected(){}}, xp:{add(){}},
  augmentEffects:{onKill(){},onScrap(){}}, hud:{scrapPickup(amount,meta){pickups.push({amount,...meta});},toast(){}},
};
game.scrap = new ScrapSystem(scene,game);
game.enemies = new EnemySpawner(scene,game);

const expected = Object.values(ENEMY_TYPES).reduce((sum,type)=>sum+type.scrap*5,0);
for (const id of Object.keys(ENEMY_TYPES)) {
  const enemy = game.enemies.spawn(id,0,0,-20,{elite:id==='elite'});
  const sourceId = enemy.lootSourceId;
  enemy.target.damage(enemy.target.maxHp);
  assert.equal(enemy.killLootIssued,true,`${id} life attempts its reward exactly once`);
  assert.equal(enemy.killLootAuthorized,true,`${id} reward is authorized`);
  assert.ok(game.scrap.sources.has(sourceId),`${id} keeps its unique source ID`);
  enemy.target.damage(9999);
  enemy.die();
  assert.equal([...game.scrap.sources].filter(([key])=>key===sourceId).length,1,`${id} cannot pay twice`);
  game.enemies.update(0);
}
assert.equal(game.scrap.metrics.authorized,expected,'Ordinary and elite base rewards retain authored values');
assert.ok(game.scrap.pool.some(piece=>piece.active),'Authorized kills create visible physical loot');
assert.ok(LOOT_GLOW.haloOpacity>.3 && LOOT_GLOW.haloSize>3,'All physical loot uses the strengthened additive glow');
assert.ok(LOOT_GLOW.reducedPulseRate<LOOT_GLOW.pulseRate/3,'Reduced motion replaces rapid pulsing with a slower glow');

const sourcesBeforeCleanup = game.scrap.sources.size;
const cleanup = game.enemies.spawn('scout',0,0,-20);
cleanup.despawn(); game.enemies.update(0);
assert.equal(game.scrap.sources.size,sourcesBeforeCleanup,'Environmental/test cleanup never pays a kill reward');

game.enemies.clear(); game.scrap.reset();
for (let i=0;i<50;i++) {
  const enemy = game.enemies.spawn('scout',0,0,-20);
  enemy.target.damage(enemy.target.maxHp); game.enemies.update(0);
}
assert.equal(game.scrap.sources.size,48,'Authored combat farming budget remains intact');
assert.equal(game.scrap.metrics.rejectedSources,2,'Ineligible over-budget lives are rejected before authorization');
assert.equal(game.scrap.outstandingValue,48*ENEMY_TYPES.scout.scrap*5,'Every eligible kill keeps its physical reward value');

for (const piece of game.scrap.pool) if (piece.active) piece.x=piece.y=piece.z=0;
game.scrap.update(0,0);
assert.equal(pickups.reduce((sum,pickup)=>sum+pickup.amount,0),game.scrap.wallet.earned,
  'Pickup feedback exactly matches credited run-wallet scrap');

const previousMatchMedia=global.matchMedia;
global.matchMedia=()=>({matches:true});
const reducedGame={...game,player:{...game.player,stats:{...game.player.stats}},hud:null};
const reducedLoot=new ScrapSystem(new THREE.Scene(),reducedGame); reducedGame.scrap=reducedLoot;
reducedLoot.burst(5,5,-20,10,0,{sourceId:'reduced-glow'}); reducedLoot.update(.25,0);
assert.equal(reducedLoot.reducedMotion,true);
assert.ok(reducedLoot.pool.filter(piece=>piece.active).every(piece=>piece.sp.material.rotation===0),
  'Reduced-motion loot retains glow without rapid rotation');
global.matchMedia=previousMatchMedia;

console.log('PASS: eligible ordinary/elite kills pay once, cleanup pays never, budgets and exact pickup credit remain intact.');
