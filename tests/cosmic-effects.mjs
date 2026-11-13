import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AugmentEffects } from '../src/combat/AugmentEffects.js';
import { Target } from '../src/combat/Target.js';
import { ProjectilePool } from '../src/combat/ProjectilePool.js';
import { Player, BASE_STATS } from '../src/player/Player.js';
import { PlayerWeapon } from '../src/player/PlayerWeapon.js';
import { Input } from '../src/core/Input.js';
import { COSMIC_AUGMENTS } from '../src/systems/CosmicAugments.js';

function fixture(stats={}){
  const shots=[];
  const p={alive:true,x:0,y:0,z:0,vx:0,vy:0,radius:1.35,shield:0,health:100,boost:100,invuln:0,
    stats:{...BASE_STATS(),...stats},heal(n){this.health=Math.min(this.stats.maxHealth,this.health+n);}};
  const g={scene:new THREE.Scene(),player:p,targets:[],projectileBlockers:[],enemies:{active:[]},
    heat:{multiplier:1,onDealDamage(){}},fx:{explode(){}},damageNumbers:{spawn(){}},
    director:{state:'TRAVERSAL_1',inCombat:true},targeting:{current:null},testing:{active:false},
    projectiles:{player:[],enemy:[],firePlayer(b){const o={...b,active:true,hitTargets:new Set()};shots.push(o);return o;},
      killEnemyBolt(b){b.active=false;},clearEnemyNear(){}},
  };
  const effects=new AugmentEffects(g);g.augmentEffects=effects;const c=effects.cosmic;
  const target=(x=0,y=0,z=-8,hp=1e7,kind='enemy',elite=false)=>{
    const object=new THREE.Object3D();object.position.set(x,y,z);
    const t=new Target({object3D:object,hp,kind,radius:1});g.targets.push(t);
    if(kind==='enemy'){
      const e={alive:true,x,y,z,type:{asset:elite?'redFighter':'microRecon'},elite,mesh:object,target:t};
      t.owner=e;g.enemies.active.push(e);t.onDeath=()=>{e.alive=false;effects.onKill(e);};
    }
    return t;
  };
  const tick=(dt=.1,active=true)=>effects.update(dt,{active});
  const kill=()=>{const t=target(20,10,-60,10);t.damage(20);return t;};
  Input.enabled=true;Input._padAim=false;Input._padFire=false;Input._keys={};
  return {g,p,c,effects,shots,target,tick,kill};
}
const direct=(extra={})=>({x:0,y:0,z:-8,damage:100,procDepth:0,...extra});

// Each canonical effect is exercised at low, medium and dense test ranks.
for(const r of [1,5,50]){
  {
    const {c,shots,tick}=fixture({blackwakeRounds:r});
    let b;for(let i=0;i<8;i++){b=direct();c.onPrimaryShot(b);}
    assert.equal(b.color,'#ad42ff');assert.equal(typeof b.onEnd,'function');
    b.onEnd(b,'expired');tick();assert.equal(shots.length,Math.min(18,6+2*(r-1)));
    assert.ok(shots.every(b=>b.procDepth===1&&Number.isFinite(b.damage)));
  }
  {
    const {c,p,target,g}=fixture({riftstepSurge:r});const t=target(3,0,0);
    c.onDodgeStart(1);assert.ok(p.x>0&&p.x<=8);assert.ok(t.hp<t.maxHp);
    p.x=0;g.projectileBlockers=[{blocks:x=>x>=2}];c.onDodgeStart(1);assert.ok(p.x<2);
    p.x=0;g.projectileBlockers=[];g.hazards=[{live:true,definition:{distance:1},hits:x=>x>=1}];c.onDodgeStart(1);assert.ok(p.x<1,'Blink cannot cross a live escape wall');
  }
  {
    const {c,shots,tick,target}=fixture({lootstormHalo:r,scrapTyphoon:r,diamondApocalypse:r});const t=target(0,0,-3),crystalTarget=target(0,0,-12);
    for(let i=0;i<10;i++)c.onScrap(25,{sourceId:i});
    assert.equal(c.gems,Math.min(6,r+2));assert.equal(c.blades.length,Math.min(8,r+2));
    const count=c.pickupCount;c.onScrap(25,{sourceId:9});assert.equal(c.pickupCount,count);
    assert.ok(crystalTarget.hp<crystalTarget.maxHp,'Illusion blasts damage, never award currency');
    const bolt={active:true};assert.equal(c.intercept(bolt),true);assert.equal(bolt.active,false);
    assert.equal(shots.length,5);assert.ok(shots.every(b=>b.procDepth===1));
    const before=t.hp;tick(.5);assert.ok(t.hp<before,'Scrap blades inflict contact damage');
  }
  {
    const {c,target}=fixture({emperorsPressure:r});const t=target(),elite=target(1,0,-8,1e7,'enemy',true);
    elite.damageScale=.3;elite.owner.specialShieldT=4;c.pressure();
    assert.ok(t.owner.cosmicStunT>0&&t.owner.cosmicStunT<=1.6);
    assert.equal(elite.owner.cosmicStunT,undefined);assert.equal(elite.owner.cosmicShieldCrackT,2);
  }
  {
    const {c,tick,shots}=fixture({phantomBroadside:r});c.onVolley(direct(),{x:0,y:0,z:-50});
    tick(.1);assert.equal(shots.length,0);tick(.03);assert.equal(shots.length,2);
    assert.ok(shots.every(b=>b.procDepth===1));
  }
  {
    const {c,target}=fixture({voltageCrown:r});const core=target(0,0,-8,1e7,'weakpoint');const enemy=target(2,0,-8);
    c.onHit(direct(),core,100);assert.ok(enemy.hp<enemy.maxHp);const hp=enemy.hp;
    c.onHit(direct({procDepth:1}),core,100);assert.equal(enemy.hp,hp);
    c.timers.voltage=0;const body=target(0,0,-8,1e7,'body');c.onHit(direct(),body,100);assert.equal(enemy.hp,hp,'Body hits are not weak-point triggers');
  }
  {
    const {c,p}=fixture({nebulaSkin:r});assert.equal(c.shieldRegenMultiplier(),1);p.vx=12;assert.ok(c.shieldRegenMultiplier()>1);
  }
  {
    const {c,kill,target,tick}=fixture({dreadwakeEngine:r,voidDominion:r});tick();for(let i=0;i<4;i++)kill();
    assert.ok(c.moveMultiplier()>1);assert.equal(c.timers.dominion,8);
    const t=target(0,0,2),hp=t.hp;tick(.5);assert.ok(t.hp<hp);
    assert.ok(c.hostileDamageFactor({x:0,y:0,z:0})<1);
  }
  {
    const {c,target}=fixture({predatorsGaze:r});const t=target();c.onAim(t,.2);assert.equal(c.critBonus(t).chance,0);
    c.onAim(t,.21);assert.ok(c.critBonus(t).chance>0&&c.critBonus(t).chance<=1);
  }
  {
    const {c,g,tick,target}=fixture({conquerorsCircuit:r});const t=target(),hp=t.hp;
    c.onPerfectDodge();assert.ok(t.hp<hp);g.projectiles.enemy.push({active:true,x:0,y:0,z:-8});tick();
    assert.equal(g.projectiles.enemy[0].augmentTimeScale,.35);
  }
  {
    const {c,p,target}=fixture({leviathanPulse:r});const t=target();Input._padAim=true;c.onVolley(direct(),{x:0,y:0,z:-50});
    assert.equal(p.boost,76);assert.ok(t.hp<t.maxHp);const hp=t.hp;c.onVolley(direct(),{x:0,y:0,z:-50});assert.equal(t.hp,hp);
    Input._padAim=false;
  }
  {
    const {c,p,target,tick,shots}=fixture({starbreakerChoir:r,riftSovereign:r,eclipseArsenal:r});
    const t=target();Input._padFire=true;c.onAugmentInstalled();tick(.1);tick(.1);assert.ok(t.hp<t.maxHp);
    assert.ok(c.fireMultiplier()>1&&c.damageReduction()>0);assert.ok(shots.length>0);
    for(let i=0;i<4;i++)tick(3.01);assert.equal(new Set(shots.map(b=>b.weapon)).size,4);
    assert.ok(c.timers.sovereign>=0);Input._padFire=false;
  }
  {
    const {c,target,tick}=fixture({throneOfThunder:r});const t=target();tick(1.21);assert.ok(t.hp<t.maxHp);assert.ok(c.timers.thunder>0);
  }
  {
    const {c,p,g,target,tick}=fixture({overlordsReflex:r});target();c.onPlayerDamaged();g.projectiles.enemy.push({active:true,x:0,y:0,z:-8});tick();
    assert.equal(g.projectiles.enemy[0].augmentTimeScale,.15);assert.equal(g.enemies.active[0].cosmicSlowFactor,.15);
    assert.ok(p.invuln>0&&p.invuln<=1.5);
  }
  {
    const {c,p,target,tick}=fixture({blackFlagAscension:r});tick();p.health=20;tick();assert.ok(c.fireMultiplier()>1);
    const t=target(),hp=p.health;c.onHit(direct(),t,100);assert.ok(p.health>hp);
  }
  {
    const {c,target}=fixture({emperorOfTheRift:r});const t=target(0,0,-8,100),elite=target(2,0,-8,1e7,'enemy',true);
    const protectedBoss=target(0,0,-10,1e7,'boss');protectedBoss.damageScale=0;
    const exposed=target(0,0,-11,1e7,'weakpoint');c.pressure(true);
    assert.equal(t.alive,false);assert.ok(elite.alive&&elite.hp<elite.maxHp);
    assert.equal(protectedBoss.hp,protectedBoss.maxHp);assert.equal(protectedBoss.cosmicVulnerableUntil,undefined);
    assert.equal(exposed.cosmicVulnerableUntil,2);
  }
  {
    const {c,tick,shots}=fixture({godspeedMarauder:r});assert.ok(c.moveMultiplier(true)>1);c.onDodgeStart(1,'boost');tick(.5);
    assert.ok(c.clones.length<=5&&shots.length>0);assert.ok(shots.every(b=>b.procDepth===1));
  }
  {
    const {c,g,tick,kill,target}=fixture({singularityPalace:r});tick();for(let i=0;i<16;i++)kill();
    const t=target(0,0,-14);g.projectiles.enemy=Array.from({length:5},()=>({active:true,x:0,y:0,z:-14}));
    tick(.1);assert.ok(t.hp<t.maxHp);assert.equal(g.projectiles.enemy.filter(b=>!b.active).length,1);
    tick(.1);assert.equal(g.projectiles.enemy.filter(b=>!b.active).length,1);
    tick(.5);assert.equal(g.projectiles.enemy.filter(b=>!b.active).length,2);
  }
  {
    const {c,target}=fixture({celestialExecution:r});const t=target();for(let i=0;i<11;i++)c.onHit(direct(),t,100);
    assert.equal(t.hp,t.maxHp);c.onHit(direct(),t,100);assert.ok(t.hp<t.maxHp);
  }
  {
    const {c,g,tick,shots,target}=fixture({kingsCataclysm:r,absoluteOvercharge:r});const t=target();g.heat.multiplier=8;tick();
    assert.ok(t.hp<t.maxHp);assert.equal(shots.length,Math.min(24,12+4*(r-1)));assert.ok(c.directDamageMultiplier()>1);
    const n=shots.length;tick();assert.equal(shots.length,n,'Staying hot never repeats a threshold proc');
  }
  {
    const {c,g,tick,shots}=fixture({infiniteArmada:r});g.encounter={};tick();assert.ok(shots.length>0);assert.ok(c.armadaCount<=5);
    const n=shots.length;c.summonArmada();tick(.1);assert.equal(shots.length,n);
  }
  {
    const {c,p,tick,target}=fixture({endOfFear:r});tick();p.health=-5;assert.equal(c.tryRescue(),true);assert.equal(p.health,1);
    assert.equal(c.tryRescue(),false);const t=target();tick(4.1);assert.ok(t.hp<t.maxHp);
  }
  {
    const {target,tick,c}=fixture({stormTyrantHalo:r,crownOfTheLastPirate:r});const t=target();tick();assert.ok(t.hp<t.maxHp);assert.ok(c.mesh.count<=64);
  }
}

// Pool reuse cannot carry an expiry callback into the next projectile or reset.
{
  const pool=new ProjectilePool(new THREE.Scene());let calls=0;
  const b=pool.firePlayer({});b.onEnd=()=>calls++;pool.killPlayerBolt(b);pool.killPlayerBolt(b);assert.equal(calls,1);
  const c=pool.firePlayer({});c.onEnd=()=>calls++;pool.reset();assert.equal(calls,2,'Reset notifies cancellation once');
  assert.ok(pool.player.every(b=>!b.active&&!b.onEnd));
}
// Lockout and rescue priority use the actual Player damage/recovery methods.
{
  const {p,c}=fixture({nebulaSkin:50,endOfFear:1,secondWind:1});
  p.cosmicEffects=c;p.vx=20;p.stats.shieldBreakDelay=14;p.stats.shieldDelay=8;p.shieldBroken=true;p.shield=0;p.timeSinceHit=13;
  Object.setPrototypeOf(p,Player.prototype);p.secondWindUsed=0;p.blocksLeft=0;p.invuln=0;p.health=10;p.fx={explode(){}};
  p.takeDamage(999);assert.equal(p.secondWindUsed,1);assert.equal(c.endUsed,false,'Death Warrant retains priority');
  p.invuln=0;p.takeDamage(999);assert.equal(c.endUsed,true);assert.equal(p.alive,true);
  assert.equal(p.shieldRecoveryRemaining,14,'A rescue never erases shield lockout');
}
// Pause/intermission does not catch up timers; reset removes all transient state.
{
  const {c,tick,g}=fixture(Object.fromEntries(Object.keys(COSMIC_AUGMENTS).map(id=>[id,50])));
  c.onAugmentInstalled();tick();const time=c.time, timers={...c.timers};tick(100,false);
  assert.equal(c.time,time);assert.deepEqual(c.timers,timers);assert.equal(c.mesh.count,0);
  g.director.state='ESCAPE';const before=g.director.state;tick();assert.equal(g.director.state,before);
  c.reset();assert.equal(c.mesh.count,0);assert.equal(c.gems,0);assert.equal(c.pending.length,0);assert.equal(c.clones.length,0);
}
Input.reset();
// Channel damage integrates the full duration at different frame rates.
for(const hz of [30,60,120]){
  const {target,tick}=fixture({starbreakerChoir:1});const t=target();Input._padFire=true;tick(1/hz);Input._padFire=false;
  for(let i=0;i<hz;i++)tick(1/hz);
  assert.ok(Math.abs(t.maxHp-t.hp-210)<1e-5,`Choir DPS is stable at ${hz}Hz`);
}
Input.reset();
const overchargeTotals=[];
for(const hz of [30,60,144]){
  const {p,g,c,shots}=fixture({absoluteOvercharge:1});
  p.pos={x:0,y:0};p.fireRate=p.stats.fireRate;p.critBuffT=0;
  const weapon=new PlayerWeapon(p,g.projectiles,{update:()=>null,reset(){}});
  c.timers.overcharge=10;Input._padFire=true;
  for(let i=0;i<hz*2;i++)weapon.update(1/hz,g);
  assert.ok(shots.length<=91,`Absolute retains45Hz emission cap at${hz}`);
  overchargeTotals.push(shots.reduce((sum,b)=>sum+b.damage,0));
}
assert.ok(Math.max(...overchargeTotals)/Math.min(...overchargeTotals)<1.02,'Absolute damage varies less than2% across30/60/144Hz');
Input.reset();
console.log('PASS cosmic effects: all30 triggers at rank1/5/50, pooled cap64, secondary guards, boss immunity, exact loot events, lockout/rescue priority and pause/reset.');
