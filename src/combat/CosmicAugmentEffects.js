import * as THREE from 'three';
import { Audio2 } from '../core/AudioManager.js';
import { Input } from '../core/Input.js';
import { cosmicRank, cosmicAmplification } from '../systems/CosmicAugments.js';
import { projectileAppearance } from '../config/weapons.js';

const TEAL = '#2affdc', VIOLET = '#ad42ff', PINK = '#ff58e0';
const point = p => ({ x: p.x || 0, y: p.y || 0, z: p.z || 0 });
const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));
const finite = n => Math.min(1e12, Math.max(0, Number(n) || 0));
const scaled = (r, start, extra) => finite(start + Math.max(0, r - 1) * extra);
const ordinary = e => e?.alive && !e.elite && !['elite', 'heavy', 'shielder'].includes(e.type)
  && !['redFighter','camoJet','intruder'].includes(e.type?.asset);

/** The thirty cosmic powers share the existing combat clock, target validation,
 * secondary-damage scope and effect pools. No timers use wall time or alter dt. */
export class CosmicAugmentEffects {
  constructor(effects) {
    this.fx = effects; this.game = effects.game;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .42,
        depthWrite: false, blending: THREE.AdditiveBlending }), 64);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.part = new THREE.Object3D(); this.color = new THREE.Color();
    effects.visualRoot.add(this.mesh);
    if (this.game.player) this.game.player.cosmicEffects = this;
    this.reset();
  }
  reset() {
    this.time = 0; this.timers = {}; this.lastEncounter = null; this.encounterState = null;
    this.seenKills = new WeakSet(); this.pickups = new Set(); this.marks = new WeakMap();
    this.killTimes = []; this.kills = 0; this.pickupCount = 0; this.primaryShots = 0; this.hits = 0;
    this.gems = 0; this.blades = []; this.pending = []; this.clones = []; this.fissures = [];
    this.armadaCount = 0; this.eclipse = 0; this.stillT = 0; this.lockT = 0; this.locked = null;
    this.lastHull = 1; this.lastHeat = false; this.endUsed = false; this.healBudget = 0;
    this.sovereignArmed = false; this.active = false; this.pressureReady = true; this.emperorReady = true;
    this.visualT = 0; this.mesh.count = 0;
  }
  rank(id) { return cosmicRank(this.game.player?.stats, id); }
  amp() { return cosmicAmplification(this.game.player?.stats); }
  origin(z = -8) { return { x: this.game.player.x, y: this.game.player.y, z }; }
  ready(id) { return !(this.timers[id] > 0); }
  ring(radius, color = VIOLET, time = .65, origin = this.origin()) { this.fx._ring(origin, Math.min(70, radius), color, time); }
  burst(radius, damage, color = VIOLET, origin = this.origin()) { this.fx._burst(origin, Math.min(100, radius), finite(damage), color); }
  sound(kind, rank = 1) { Audio2.playWeapon?.(kind, rank); }
  fire(origin, target, damage, weapon = 'prism', extras = {}) {
    const color = extras.color || TEAL;
    const visual = { ...projectileAppearance(weapon, { rank: extras.rank || 1, power: extras.rank || 1 }), color, accent: VIOLET };
    return this.game.projectiles.firePlayer({ ...point(origin), tx: target.x, ty: target.y, tz: target.z,
      speed: this.game.player.stats.projectileSpeed || 105, damage: finite(damage * this.amp()),
      weapon, visual, color, procDepth: 1, crit: false, ...extras });
  }
  fan(origin, count, damage, color = TEAL, weapon = 'fragment') {
    count = Math.min(24, Math.max(1, Math.round(count)));
    for (let i=0;i<count;i++) {
      const a=(i/Math.max(1,count-1)-.5)*1.7;
      this.fire(origin,{x:origin.x+Math.sin(a)*24,y:origin.y+Math.sin(a*2)*7,z:origin.z-45},damage,weapon,{color});
    }
  }
  onAugmentInstalled() {
    if (this.rank('riftSovereign')) this.sovereignArmed = true;
    this.ring(5, TEAL, .35, this.origin(-2));
  }
  onPrimaryShot(bolt) {
    if (!bolt || bolt.procDepth > 0) return;
    const r=this.rank('blackwakeRounds');
    if (!r) return;
    bolt.color=VIOLET;
    if (bolt.visual) bolt.visual={...bolt.visual,color:VIOLET,accent:TEAL,shape:'helix',trail:Math.max(5,bolt.visual.trail)};
    if (++this.primaryShots % 8 !== 0) return;
    bolt.onEnd = (ended, reason) => {
      if (!['collision','expired'].includes(reason)) return;
      if(this.fissures.length<16)this.fissures.push({origin:point(ended),count:Math.min(18,6+2*(r-1)),damage:ended.damage*scaled(r,.45,.05),r});
    };
  }
  onVolley(base, target, firing = true) {
    if (!firing) return;
    const r=this.rank('phantomBroadside');
    if (r && this.pending.length<16) this.pending.push({ delay:.12,damage:base.damage*scaled(r,.35,.15),target:point(target),r });
    const leviathan=this.rank('leviathanPulse'), p=this.game.player;
    // The shipped game has no secondary-fire binding. Aim + fire is the existing
    // alternate attack gesture; a pulse costs 24 boost and has an 8s cooldown.
    if (leviathan && Input.aiming && this.ready('leviathan') && p.boost>=24) {
      p.boost-=24; this.timers.leviathan=8;
      this.burst(scaled(leviathan,18,2),scaled(leviathan,250,100),TEAL);
      this.sound('capacitor',leviathan);
    }
  }
  onAim(target, dt) {
    if (target!==this.locked) { this.locked=target; this.lockT=0; }
    if (!target?.alive || !target.targetable || !this.rank('predatorsGaze')) return;
    this.lockT+=dt;
    if (this.lockT>=.4) this.marks.set(target,this.time+4);
  }
  critBonus(target) {
    const r=this.rank('predatorsGaze');
    return r && (this.marks.get(target)||0)>this.time ? {
      chance:Math.min(1,scaled(r,.25,.05)*this.amp()), multiplier:scaled(r,.4,.15)*this.amp(),
    } : {chance:0,multiplier:0};
  }
  onHit(bolt,target,dealt) {
    if (!(dealt>0) || bolt.procDepth>0) return;
    if (this.timers.flag>0) {
      const r=this.rank('blackFlagAscension'), heal=Math.min(this.healBudget,dealt*scaled(r,.04,.01)*this.amp());
      if (heal>0) { this.game.player.heal(heal); this.healBudget-=heal; }
    }
    const voltage=this.rank('voltageCrown');
    if (voltage && ['weakpoint','core'].includes(target.kind) && this.ready('voltage')) {
      this.timers.voltage=.08;
      let origin=point(target.pos); const seen=new Set([target]);
      for (let i=0;i<Math.min(8,3+voltage-1);i++) {
        const next=this.fx._near(origin,18,seen)[0]; if(!next)break;
        this.fx._damage(next,bolt.damage*scaled(voltage,.35,.05),origin,TEAL); seen.add(next);origin=point(next.pos);
      }
      this.sound('tesla',voltage);
    }
    const execution=this.rank('celestialExecution');
    if (execution && ++this.hits%12===0) {
      const origin=point(target.pos); this.burst(scaled(execution,5,1),scaled(execution,500,200),PINK,origin);
      this.fx._arc({...origin,y:origin.y+16},origin,TEAL);this.sound('prism',execution);
    }
    if (this.rank('crownOfTheLastPirate') && this.ready('crownPulse')) {
      this.timers.crownPulse=1;this.ring(3,TEAL,.3,point(target.pos));
    }
  }
  onKill(enemy, secondary = false) {
    if (!enemy?.target || this.seenKills.has(enemy.target)) return;
    this.seenKills.add(enemy.target);
    if (secondary) return;
    this.kills++;
    this.killTimes.push(this.time);this.killTimes=this.killTimes.filter(t=>this.time-t<=5).slice(-4);
    const dread=this.rank('dreadwakeEngine');
    if (dread && this.killTimes.length>=4 && this.ready('dreadCD')) {
      this.timers.dread= Math.min(5,3+(dread-1)*.2);this.timers.dreadCD=8;
      this.ring(6,VIOLET);this.sound('wake',dread);
    }
    if (this.rank('voidDominion')) this.timers.dominion=Math.min(8,(this.timers.dominion||0)+3);
    if (this.rank('singularityPalace') && this.kills%16===0 && this.ready('palace') && this.ready('palaceCD')) {
      this.timers.palace=12;this.timers.palaceCD=28;this.timers.absorb=0;this.sound('singularity',this.rank('singularityPalace'));
    }
    if (this.rank('infiniteArmada') && this.kills%10===0) this.summonArmada();
  }
  onScrap(amount,event={}) {
    if (!(amount>0) || event.decorative) return;
    if (event.sourceId!=null) {
      if(this.pickups.has(event.sourceId))return;
      this.pickups.add(event.sourceId);
    }
    const halo=this.rank('lootstormHalo'), typhoon=this.rank('scrapTyphoon');
    if(halo)this.gems=Math.min(Math.min(6,halo+2),this.gems+1);
    if(typhoon){
      if(this.blades.length>=Math.min(8,typhoon+2))this.blades.shift();
      this.blades.push(this.time+6);
    }
    const apocalypse=this.rank('diamondApocalypse');
    if(apocalypse && ++this.pickupCount%10===0){
      const count=Math.min(7,apocalypse+2);
      // Illusions are combat-only. Never enter ScrapSystem or emit pickup events.
      for(let i=0;i<count;i++){
        const a=i/count*Math.PI*2;
        const o={x:this.game.player.x+Math.cos(a)*7,y:this.game.player.y+Math.sin(a)*4,z:-12};
        this.burst(7,scaled(apocalypse,120,60),PINK,o);
      }
      this.sound('scatter',apocalypse);
    }
  }
  intercept(bolt) {
    if(!this.gems || !this.rank('lootstormHalo') || !bolt.active || bolt.heavy)return false;
    this.gems--;this.game.projectiles.killEnemyBolt(bolt);
    this.fan(this.origin(-2),5,scaled(this.rank('lootstormHalo'),24,8),TEAL);
    this.ring(3,TEAL,.25,this.origin(0));this.sound('siphon',this.rank('lootstormHalo'));return true;
  }
  hostileDamageFactor(bolt) {
    const r=this.rank('voidDominion');
    return r && this.timers.dominion>0 && dist(bolt,this.origin(0))<=7+r-1
      ? 1-Math.min(.6,scaled(r,.2,.05)*this.amp()) : 1;
  }
  onDodgeStart(direction,kind='roll') {
    const p=this.game.player,r=this.rank('riftstepSurge');
    if(r && kind==='roll'){
      const start=this.origin(0), max=Math.min(8,scaled(r,5,.75));
      let x=start.x;
      for(let n=1;n<=Math.ceil(max/.25);n++){
        const nx=Math.max(-22,Math.min(22,start.x+direction*Math.min(max,n*.25)));
        const blocked=(this.game.projectileBlockers||[]).some(b=>b.blocks(nx,p.y,0))
          || (this.game.hazards||[]).some(h=>h.live&&h.definition?.distance!=null&&h.hits(nx,p.y,0))
          || (this.game.targets||[]).some(t=>t.alive&&t.kind!=='enemy'&&dist(t.pos,{x:nx,y:p.y,z:0})<(t.radius||2)+p.radius);
        if(blocked)break;x=nx;
      }
      p.x=x;const end=this.origin(0);this.fx._arc(start,end,TEAL);
      for(const t of this.game.targets||[]){
        const nearX=Math.max(Math.min(start.x,end.x),Math.min(Math.max(start.x,end.x),t.pos.x));
        if(dist(t.pos,{x:nearX,y:p.y,z:0})<4)this.fx._damage(t,scaled(r,70,25),start,VIOLET);
      }
      this.ring(4,TEAL,.3,end);
    }
    const god=this.rank('godspeedMarauder');
    if(god){
      this.clones=Array.from({length:Math.min(5,god+2)},(_,i)=>({x:p.x+(i-(Math.min(5,god+2)-1)/2)*2,y:p.y,z:2+i,life:2,shot:.12*i}));
      this.sound('echo',god);
    }
  }
  onPerfectDodge() {
    const r=this.rank('conquerorsCircuit');
    if(r){this.burst(scaled(r,12,2),scaled(r,180,70),VIOLET);this.timers.conquerorSlow=2;this.sound('tesla',r);}
  }
  onPlayerDamaged() {
    const p=this.game.player,r=this.rank('overlordsReflex');
    if(r && this.ready('reflexCD')){
      this.timers.reflexCD=25;this.timers.reflex=scaled(r,1.2,.2);
      p.invuln=Math.max(p.invuln,Math.min(1.5,scaled(r,.55,.12)));this.ring(18,VIOLET,.8);
    }
    if(p.alive && p.health/p.stats.maxHealth<.15)this.tryRescue(false);
  }
  tryRescue(lethal = true) {
    const r=this.rank('endOfFear'),p=this.game.player;
    if(!r || this.endUsed)return false;
    this.endUsed=true;
    if(lethal)p.health=Math.max(1,p.health);
    const duration=Math.min(4,scaled(r,2.5,.25));
    p.invuln=Math.max(p.invuln,duration);this.timers.endWave=duration;
    this.ring(8,VIOLET,duration,this.origin(0));this.sound('singularity',r);return true;
  }
  moveMultiplier(boosting=false) {
    let bonus=0;
    if(this.timers.dread>0)bonus+=scaled(this.rank('dreadwakeEngine'),.3,.1);
    if(boosting && this.rank('godspeedMarauder'))bonus+=scaled(this.rank('godspeedMarauder'),.6,.1);
    return 1+bonus*this.amp();
  }
  fireMultiplier() {
    let bonus=0;
    if(this.timers.sovereign>0)bonus+=scaled(this.rank('riftSovereign'),1,.15);
    if(this.timers.flag>0)bonus+=scaled(this.rank('blackFlagAscension'),.8,.15);
    return 1+bonus*this.amp();
  }
  damageReduction() { return this.timers.sovereign>0 ? Math.min(.65,.35*this.amp()+.03*(this.rank('riftSovereign')-1)) : 0; }
  shieldRegenMultiplier() {
    const p=this.game.player,r=this.rank('nebulaSkin');
    return r && Math.hypot(p.vx||0,p.vy||0)>p.stats.moveSpeed*.3 ? 1+scaled(r,.6,.3)*this.amp() : 1;
  }
  directDamageMultiplier() { return this.timers.overcharge>0 ? 1+(scaled(this.rank('absoluteOvercharge'),2.5,.4)-1)*this.amp() : 1; }
  summonArmada(){
    const r=this.rank('infiniteArmada');if(!r || !this.ready('armadaCD'))return;
    this.armadaCount=Math.min(5,r+1);this.timers.armada=10;this.timers.armadaCD=24;this.timers.armadaShot=0;
    this.ring(14,TEAL,1);this.sound('broadsides',r);
  }
  pressure(imperial=false){
    const r=this.rank(imperial?'emperorOfTheRift':'emperorsPressure');if(!r)return;
    const origin=this.origin(-10),radius=imperial?scaled(r,22,4):scaled(r,10,2);
    this.ring(radius,VIOLET,.85,origin);this.sound('singularity',r);
    for(const t of this.fx._near(origin,Math.min(100,radius))){
      const e=t.owner;
      if(t.kind==='enemy' && ordinary(e)){
        if(imperial)this.fx._damage(t,t.hp/Math.max(.0001,t.damageScale||1),origin,VIOLET);
        else e.cosmicStunT=Math.max(e.cosmicStunT||0,Math.min(1.6,scaled(r,.8,.2)));
      }else if(t.kind==='enemy'){
        if(imperial)this.fx._damage(t,scaled(r,500,180),origin,VIOLET);
        else if(e && t.damageScale>0 && t.damageScale<1){
          e.cosmicShieldCrackT=2;
          if(e.specialShieldT>0)e.specialShieldT*=.85;
        }
      }else if(imperial && t.targetable && t.damageScale>=1){
        // Vulnerability only augments an already exposed target's damage;
        // never toggles targetable, shield state or scripted boss phases.
        t.cosmicVulnerableUntil=this.time+2;
      }
    }
  }
  update(dt,{active=true}={}) {
    const g=this.game,p=g.player;
    this.active=active && !!p.alive;
    if(!this.active){this.mesh.count=0;return;}
    const encounter=g.encounter||g.director?.state||'combat';
    if(encounter!==this.lastEncounter){
      this.lastEncounter=encounter;this.endUsed=false;this.kills=0;this.killTimes=[];
      this.pressureReady=true;this.emperorReady=true;
      if(g.encounter)this.summonArmada();
    }
    this.time+=dt;const oldEnd=this.timers.endWave||0;
    const oldChoir=this.timers.choir||0, oldPalace=this.timers.palace||0;
    for(const key of Object.keys(this.timers))this.timers[key]=Math.max(0,this.timers[key]-dt);
    if(oldEnd>0 && !this.timers.endWave)this.burst(14,scaled(this.rank('endOfFear'),550,180),VIOLET);
    if(this.sovereignArmed){this.sovereignArmed=false;this.timers.sovereign=scaled(this.rank('riftSovereign'),8,2);this.ring(9,VIOLET,1);}
    if(this.rank('emperorsPressure')&&(this.pressureReady||this.ready('pressure'))){this.pressureReady=false;this.timers.pressure=18;this.pressure();}
    if(this.rank('emperorOfTheRift')&&(this.emperorReady||this.ready('emperor'))){this.emperorReady=false;this.timers.emperor=35;this.pressure(true);}
    const hull=p.health/p.stats.maxHealth,flag=this.rank('blackFlagAscension');
    if(flag && hull<.3 && this.lastHull>=.3 && this.ready('flagCD')){this.timers.flag=7;this.timers.flagCD=35;this.ring(7,PINK,1);}
    this.lastHull=hull;
    this.healBudget=Math.min(scaled(flag,12,3),this.healBudget+scaled(flag,12,3)*dt);
    const infernal=(g.heat?.multiplier||0)>=8;
    if(infernal&&!this.lastHeat){
      const king=this.rank('kingsCataclysm');
      if(king&&this.ready('kingCD')){this.timers.kingCD=20;this.burst(16,scaled(king,600,180),VIOLET);this.fan(this.origin(-2),Math.min(24,12+4*(king-1)),60,TEAL);}
      const absolute=this.rank('absoluteOvercharge');
      if(absolute&&this.ready('overchargeCD')){this.timers.overchargeCD=22;this.timers.overcharge=Math.min(10,scaled(absolute,6,.6));this.ring(12,PINK,1);this.sound('capacitor',absolute);}
    }
    this.lastHeat=infernal;
    for(const fissure of this.fissures.splice(0,8)){
      this.fan(fissure.origin,fissure.count,fissure.damage,VIOLET);this.ring(3,VIOLET,.35,fissure.origin);this.sound('fragment',fissure.r);
    }
    for(const shot of this.pending)shot.delay-=dt;
    const due=this.pending.filter(x=>x.delay<=0);this.pending=this.pending.filter(x=>x.delay>0);
    for(const shot of due.slice(0,8))for(const side of [-1,1])this.fire({x:p.x+side*3,y:p.y,z:-2},shot.target,shot.damage,'echo',{color:side<0?TEAL:VIOLET,rank:shot.r});
    if(due.length)this.sound('echo',this.rank('phantomBroadside'));
    const firing=Input.firing || (g.testing?.active&&g.testing.settings.autoFire);
    const choir=this.rank('starbreakerChoir');
    let choirStep=Math.min(dt,oldChoir);
    if(choir&&firing&&this.ready('choirCD')){this.timers.choirCD=4;this.timers.choir=.7;choirStep=0;this.sound('prism',choir);}
    if(choirStep>0){
      const origin=this.origin(-2);
      for(const t of this.fx._near(origin,90))if(t.pos.z<-2&&Math.abs(t.pos.x-p.x)<3.5&&Math.abs(t.pos.y-p.y)<3.5)
        this.fx._damage(t,scaled(choir,300,130)*choirStep,origin,TEAL);
    }
    const eclipse=this.rank('eclipseArsenal');
    if(eclipse&&firing&&this.ready('eclipseCD')){
      this.timers.eclipseCD=3;const kind=this.eclipse++%4,dmg=scaled(eclipse,180,70),origin=this.origin(-2);
      const target=g.targeting?.current?.pos||{x:p.x,y:p.y,z:-70};
      if(kind===0){this.fire(origin,target,dmg,'mortar',{splash:7,color:PINK});}
      if(kind===1){for(const side of [-1,1])this.fire({...origin,x:p.x+side*2},{...target,x:target.x+side*9},dmg/2,'broadsides',{color:VIOLET,pierce:2});}
      if(kind===2)this.fire(origin,target,dmg,'prism',{pierce:12,color:TEAL});
      if(kind===3)for(let i=-1;i<=1;i++)this.fire({...origin,x:p.x+i*2},target,dmg/3,'seeker',{homing:7,target:g.targeting?.current,color:'#eb8aff'});
      this.sound(['mortar','broadsides','prism','seeker'][kind],eclipse);
    }
    const thunder=this.rank('throneOfThunder');
    if(thunder){
      this.stillT=Math.hypot(p.vx||0,p.vy||0)<p.stats.moveSpeed*.4?this.stillT+dt:0;
      if(this.stillT>=1.2&&this.ready('thunderCD')&&this.ready('thunder')){
        const duration=Math.min(9,scaled(thunder,6,1));this.timers.thunder=duration;this.timers.thunderCD=duration+8;this.stillT=0;
      }
      if(this.timers.thunder>0&&this.ready('thunderShot')){this.timers.thunderShot=.8;const t=this.fx._near(this.origin(),70)[0];if(t)this.fx._damage(t,scaled(thunder,140,55),{...t.pos,y:t.pos.y+12},TEAL);this.sound('tesla',thunder);}
    }
    if(this.ready('contactTick')){
      this.timers.contactTick=.5;this.blades=this.blades.filter(t=>t>this.time);
      const typhoon=this.rank('scrapTyphoon');
      if(typhoon&&this.blades.length)for(const t of this.fx._near(this.origin(-2),7))this.fx._damage(t,scaled(typhoon,24,8)*this.blades.length,this.origin(-2),TEAL);
      if(this.timers.dread>0)for(const t of this.fx._near(this.origin(2),7))this.fx._damage(t,scaled(this.rank('dreadwakeEngine'),25,10)*.5,this.origin(2),VIOLET);
    }
    const dominion=this.rank('voidDominion'),palace=this.rank('singularityPalace');
    for(const e of g.enemies?.active||[]){
      if(!ordinary(e)||!e.target?.targetable)continue;
      if(this.timers.reflex>0){e.cosmicSlowFactor=.15;e.cosmicSlowT=.1;}
      if(this.timers.dominion>0&&dist(e,this.origin(-8))<=scaled(dominion,7,1)){
        const pull=Math.min(.04,dt*.45);e.x+=(p.x-e.x)*pull;e.y+=(p.y-e.y)*pull;
        e.mesh?.position.set(e.x,e.y,e.z);e.target.syncPos?.();this.fx._slow(e,.8,.1);
      }
      if(oldPalace>0&&dist(e,this.origin(-14))<=scaled(palace,8,1))this.fx._damage(e.target,scaled(palace,90,35)*Math.min(dt,oldPalace),this.origin(-14),VIOLET);
    }
    let absorbed=false;
    for(const b of g.projectiles?.enemy||[]){
      if(!b.active)continue;
      if(this.timers.reflex>0)b.augmentTimeScale=Math.min(b.augmentTimeScale||1,.15);
      else if(this.timers.conquerorSlow>0&&dist(b,this.origin(-8))<=scaled(this.rank('conquerorsCircuit'),12,2))b.augmentTimeScale=Math.min(b.augmentTimeScale||1,.35);
      if(this.timers.palace>0&&!b.heavy&&!absorbed&&this.ready('absorb')&&dist(b,this.origin(-14))<=scaled(palace,8,1)){
        absorbed=true;this.timers.absorb=.5;g.projectiles.killEnemyBolt(b);
      }
    }
    const storm=this.rank('stormTyrantHalo');
    if(storm&&this.ready('stormSpear')){
      this.timers.stormSpear=.8;const targets=this.fx._near(this.origin(-5),32);const count=Math.min(8,storm+2);
      for(let i=0;i<count&&targets.length;i++)this.fx._damage(targets[i%targets.length],scaled(storm,65,25),this.origin(-3),TEAL);
    }
    if(storm&&this.ready('stormBeam')){this.timers.stormBeam=4;const t=this.fx._near(this.origin(-5),80)[0];if(t)this.fx._damage(t,scaled(storm,180,70),this.origin(-3),VIOLET);}
    if(this.timers.armada>0&&this.ready('armadaShot')){
      this.timers.armadaShot=1;const target=g.targeting?.current?.pos||{x:p.x,y:p.y,z:-80};
      for(let i=0;i<this.armadaCount;i++)this.fire({x:p.x+(i-(this.armadaCount-1)/2)*6,y:p.y+3,z:-4},target,scaled(this.rank('infiniteArmada'),50,25),'broadsides',{color:TEAL,pierce:1});
      this.sound('broadsides',this.rank('infiniteArmada'));
    }
    for(const clone of this.clones){clone.life-=dt;clone.shot-=dt;if(clone.life>0&&clone.shot<=0){clone.shot=.3;this.fire(clone,{x:p.x,y:p.y,z:-65},p.stats.damage*.5,'echo',{color:TEAL});}}
    this.clones=this.clones.filter(c=>c.life>0);
    this.draw(dt);
  }
  draw(dt){
    this.visualT+=dt;const p=this.game.player;let index=0;
    const voxel=(x,y,z,sx,sy,sz,color)=>{
      if(index>=64)return;const o=this.part;o.position.set(x,y,z);o.rotation.set(0,this.time*.4,this.time*.2);o.scale.set(sx,sy,sz);o.updateMatrix();
      this.mesh.setMatrixAt(index,o.matrix);this.mesh.setColorAt(index++,this.color.set(color).multiplyScalar(1.25));
    };
    const orbit=(n,r,z,color,s=.3)=>{for(let i=0;i<n;i++){const a=this.time*1.4+i/n*Math.PI*2;voxel(p.x+Math.cos(a)*r,p.y+Math.sin(a)*r*.6,z,s,s,s*1.8,color);}};
    orbit(this.gems,3.2,-1,TEAL,.35);orbit(this.blades.filter(t=>t>this.time).length,5,-2,VIOLET,.3);
    if(this.rank('stormTyrantHalo'))orbit(Math.min(8,this.rank('stormTyrantHalo')+2),4.2,-3,TEAL,.25);
    if(this.rank('nebulaSkin')&&p.shield>0)orbit(6,2.6,0,VIOLET,.13);
    if(this.timers.sovereign>0||this.timers.thunder>0||this.timers.overcharge>0)orbit(8,5.5,-3,PINK,.22);
    if(this.timers.palace>0)orbit(8,Math.min(16,7+this.rank('singularityPalace')),-14,VIOLET,.65);
    if(this.timers.choir>0){voxel(p.x-3,p.y,-3,.5,.4,1.2,TEAL);voxel(p.x+3,p.y,-3,.5,.4,1.2,TEAL);voxel(p.x,p.y,-36,.16,.16,64,VIOLET);}
    for(const c of this.clones){voxel(c.x,c.y,c.z,1.2,.35,3,TEAL);voxel(c.x,c.y,c.z,3,.18,.7,VIOLET);}
    if(this.timers.armada>0)for(let i=0;i<this.armadaCount;i++){
      const x=p.x+(i-(this.armadaCount-1)/2)*6;
      voxel(x,p.y+3,-4,1.3,.65,4,TEAL);voxel(x,p.y+3.5,-4,.3,1.5,1.2,VIOLET);voxel(x,p.y+3,-3,3,.3,1,TEAL);
    }
    this.mesh.count=index;this.mesh.instanceMatrix.needsUpdate=true;if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true;
  }
}
