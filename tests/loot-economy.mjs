import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RunWallet } from '../src/systems/RunWallet.js';
import { ScrapSystem, splitLootValue, LOOT_POOL_SIZE, MAX_RUN_REWARDS } from '../src/systems/ScrapSystem.js';
import { buildTreasureRoute, MAIN_ROUTE_SCRAP, OUTER_APPROACH } from '../src/config/approaches.js';
import { augmentPrice } from '../src/systems/AugmentEconomy.js';

const wallet = new RunWallet();
assert.equal(wallet.spend(1),false);
assert.equal(wallet.credit(100),true);
assert.equal(wallet.credit(.5),false);
assert.equal(wallet.spend(-1),false);
assert.equal(wallet.spend(101),false);
assert.equal(wallet.spend(100),true);
assert.deepEqual([wallet.earned,wallet.spent,wallet.balance],[100,100,0]);
assert.equal(wallet.refund(100),true);
assert.equal(wallet.refund(1),false);
wallet.reset();
assert.deepEqual([wallet.earned,wallet.spent,wallet.balance],[0,0,0]);

function fixture(multiplier=1) {
  const callbacks = [], heat = [];
  const game = { player:{ x:0,y:0,alive:true,stats:{scrapRadius:4.5,scrapMultiplier:multiplier,scrapYield:0} },
    score:{add(){}},heat:{onScrapCollected(){heat.push(1);}},augmentEffects:{onScrap(amount,meta){callbacks.push({amount,...meta});}} };
  const scrap = new ScrapSystem(new THREE.Scene(),game);
  game.scrap = scrap;
  return {game,scrap,callbacks,heat};
}
function drain(scrap) {
  for (let passes=0; scrap.outstandingValue && passes<1000; passes++) {
    for (const o of scrap.pool) if(o.active) o.x=o.y=o.z=0;
    scrap.update(0,0);
  }
  assert.equal(scrap.outstandingValue,0);
}

for (const value of [1,2,7,20,25,100,250,900,1000000000]) {
  const pieces = splitLootValue(value);
  assert.equal(pieces.reduce((a,b)=>a+b,0),value);
  assert.ok(pieces.length<=32 && pieces.every(Number.isInteger));
}
{
  const {scrap,game}=fixture();
  game.augmentEffects.onScrap=()=>{throw Error('Simulated collection FX failure');};
  scrap.burst(0,0,0,100,0,{sourceId:'callback-failure',bundle:true});
  assert.throws(()=>scrap.update(0,0),/Simulated collection/);
  assert.equal(scrap.wallet.earned,100);
  scrap.update(0,0);
  assert.equal(scrap.wallet.earned,100,'A throwing post-credit effect cannot duplicate a pickup');
  assert.equal(scrap.outstandingValue,0);
}
{
  const {scrap,game}=fixture();
  game.augmentEffects.onScrap=(amount,event)=>{
    if(event.sourceId==='parent'&&event.firstCollection)
      scrap.burst(0,0,0,100,0,{sourceId:'secondary-kill'});
  };
  scrap.burst(0,0,0,25,0,{sourceId:'parent',bundle:true});
  scrap.update(0,0);
  assert.equal(scrap.wallet.earned+scrap.outstandingValue,125,'A pickup-triggered secondary kill may reuse the pool slot without erasing its new reward');
  drain(scrap);
  assert.equal(scrap.wallet.earned,125);
  assert.equal(scrap.sources.size,2);
}
{
  const {scrap,callbacks,heat}=fixture(1.25);
  assert.equal(scrap.burst(0,0,-20,7,0,{sourceId:'fractional'}),true);
  const pieces=scrap.pool.filter(o=>o.active);
  pieces[0].x=pieces[0].y=pieces[0].z=0;
  scrap.update(0,0);
  scrap.game.player.stats.scrapMultiplier=99;
  drain(scrap);
  assert.equal(scrap.wallet.earned,9,'A source rounds once cumulatively; fragments cannot amplify multipliers');
  assert.equal(callbacks.reduce((sum,event)=>sum+event.amount,0),9,'Amount-based legacy loot powers receive all earned value');
  assert.equal(callbacks.filter(event=>event.firstCollection).length,1);
  assert.equal(new Set(callbacks.map(event=>event.sourceId)).size,1,'New source-triggered powers can dedupe a shower');
  assert.equal(heat.length,1,'A shower grants one heat event');
  assert.equal(scrap.burst(0,0,0,7,0,{sourceId:'fractional'}),false,'Duplicate kill/source cannot pay twice');
}
{
  const {scrap,callbacks}=fixture();
  for(let i=0;i<400;i++) assert.equal(scrap.burst(0,0,-30,100,0,{sourceId:`stress:${i}`}),true);
  assert.equal(scrap.pool.filter(o=>o.active).length,LOOT_POOL_SIZE);
  assert.ok(scrap.pending.length>0 && scrap.pending.length<=MAX_RUN_REWARDS);
  assert.equal(scrap.outstandingValue,40000,'Saturated pool retains every authorized unit');
  drain(scrap);
  assert.equal(scrap.total,40000);
  assert.equal(new Set(callbacks.map(event=>event.sourceId)).size,400,'Queued rewards preserve original source attribution');
  assert.equal(scrap.metrics.expiredBase,0);
  const before=scrap.total; scrap.update(0,0); assert.equal(scrap.total,before,'Collected pool objects cannot pay twice');
  scrap.reset(); assert.equal(scrap.wallet.balance,0); assert.equal(scrap.sources.size,0); assert.equal(scrap.pending.length,0);
}
{
  const {scrap}=fixture();
  for(let i=0;i<8;i++) scrap.burst(0,0,-30,25,0,{sourceId:`add:${i}`,budgetGroup:'boss-adds',budgetLimit:3});
  assert.equal(scrap.sources.size,3); assert.equal(scrap.metrics.authorized,75);
  assert.equal(scrap.metrics.rejectedSources,5,'Farm cap rejects before authorizing money');
  drain(scrap); assert.equal(scrap.total,75);
  scrap.reset();
  for(let i=0;i<MAX_RUN_REWARDS;i++) assert.equal(scrap.burst(0,0,-30,2,0,{sourceId:`bounded:${i}`,bundle:true}),true);
  assert.equal(scrap.burst(0,0,-30,250,0,{sourceId:'over-budget'}),false);
  assert.equal(scrap.outstandingValue,MAX_RUN_REWARDS*2);
  assert.ok(scrap.pending.length<=MAX_RUN_REWARDS,'Worst-case pending storage is bounded');
}

// Authored budgets and a real pickup-flight simulation, with base movement speed
// and pickup radius. Steering collects six of ten opening trail gems, deliberately
// misses the rest, and pays successive ranks at the actual checkpoint times.
for(let sector=0;sector<4;sector++) {
  const route=buildTreasureRoute({sector,augmentAt:[22,54,88]});
  for(let checkpoint=0;checkpoint<3;checkpoint++) {
    const trail=route.filter(event=>event.type==='trail'&&event.sourceId.startsWith(`route:${sector}:${checkpoint}:`));
    assert.equal(trail.reduce((sum,event)=>sum+event.value,0),MAIN_ROUTE_SCRAP[sector]);
    assert.ok(trail.every(event=>event.at<=[22,54,88][checkpoint]-5));
  }
  assert.equal(new Set(route.map(event=>event.sourceId)).size,route.length);
}
{
  const {scrap,game}=fixture(); game.player.y=3;
  const checkpoints=[22,54,88], route=buildTreasureRoute({sector:0,augmentAt:checkpoints}).filter(event=>event.type==='trail');
  const desired=new Set([0,1,2,3,4,8]), collectedByShop=[], spentByShop=[];
  let eventIndex=0, shop=0;
  for(let frame=0;frame<=88*60;frame++) {
    const time=frame/60;
    while(eventIndex<route.length&&route[eventIndex].at<=time) {
      const event=route[eventIndex++];
      scrap.burst(event.x,event.y,-54,event.value,0,{sourceId:event.sourceId,bundle:true,kind:'route'});
    }
    const near=scrap.pool.filter(o=>o.active).sort((a,b)=>Math.abs(a.z)-Math.abs(b.z))[0];
    const index=near?Number(near.reward.sourceId.split(':').at(-1)):-1;
    const targetX=near&&desired.has(index)?near.x:15;
    game.player.x+=Math.max(-19/60,Math.min(19/60,targetX-game.player.x));
    const speed=OUTER_APPROACH.beats.findLast(beat=>time>=beat.at).speed;
    scrap.update(1/60,speed);
    if(shop<3&&time>=checkpoints[shop]) {
      const price=augmentPrice({},shop);
      assert.ok(scrap.wallet.canSpend(price),`Checkpoint ${shop+1} affordable before opening: ${JSON.stringify(scrap.wallet)}`);
      collectedByShop.push(scrap.wallet.earned); scrap.wallet.spend(price); spentByShop.push(price); shop++;
    }
  }
  assert.deepEqual(spentByShop,[100,130,150]);
  assert.ok(scrap.wallet.earned>=380 && scrap.wallet.earned<=MAIN_ROUTE_SCRAP[0]*3*.72,'A roughly 60% steering path funds all three purchases');
  assert.equal(scrap.wallet.balance,scrap.wallet.earned-380);
  console.log('Opening flight collection:',JSON.stringify({earnedAtCheckpoints:collectedByShop,spent:spentByShop,finalBalance:scrap.wallet.balance,available:660}));
}
console.log('PASS: integer wallet, cumulative source rounding, denomination conservation, pool saturation, source deduplication, bounded farming, finite routes and three funded pre-tower checkpoints.');

if (process.env.RIFT_LOOT_BROWSER === '1') {
  const { default:puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:true,protocolTimeout:180000,args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--mute-audio'] });
  const errors=[];
  try {
    const page=await browser.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://localhost:8000/',{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(()=>window.RIFT&&!document.getElementById('launchBtn').disabled,{timeout:120000});
    await page.click('#launchBtn');
    await page.evaluate(()=>{
      const g=RIFT; window.__stepLoot=g.update.bind(g); g.update=()=>{}; g.renderFrame=()=>{};
      g.enemies.update=()=>{}; g.collisions.update=()=>{}; g.player.takeDamage=()=>false;
      // Script a pilot with the base19-unit steering limit, leaving combat and
      // authored source spawning untouched; no magnet or economy grants.
      g.player.update=dt=>{
        const near=g.scrap.pool.filter(o=>o.active&&o.reward.kind==='route').sort((a,b)=>Math.abs(a.z)-Math.abs(b.z))[0];
        const index=near?Number(near.reward.sourceId.split(':').at(-1)):-1;
        const target=near&&[0,1,2,3,4,8].includes(index)?near.x:15;
        g.player.x+=Math.max(-19*dt,Math.min(19*dt,target-g.player.x)); g.player.y=3;
      };
      g.director.go('TRAVERSAL_1');
    });
    const checkpoints=[];
    for(let shop=0;shop<3;shop++) {
      for(let chunk=0;chunk<40;chunk++) {
        const open=await page.evaluate(()=>{
          for(let frame=0;frame<120&&!RIFT.upgradeScreen.open;frame++) __stepLoot(1/60);
          return RIFT.upgradeScreen.open;
        });
        if(open) break;
      }
      const state=await page.evaluate(()=>({open:RIFT.upgradeScreen.open,wallet:{...RIFT.scrap.wallet},time:RIFT.director.stateT,
        options:RIFT.upgradeScreen._offers.map(up=>({id:up.id,price:up.price,rarity:up.rarity}))}));
      assert.equal(state.open,true,'Real traversal opens each purchase checkpoint');
      assert.ok(state.wallet.balance>=100,`Collected treasure arrives before shop${shop+1}`);
      const before=await page.evaluate(()=>JSON.stringify(RIFT.scrap.pool.filter(o=>o.active).map(o=>[o.life,o.z])));
      await page.evaluate(()=>{for(let i=0;i<300;i++)__stepLoot(1/60);});
      assert.equal(await page.evaluate(()=>JSON.stringify(RIFT.scrap.pool.filter(o=>o.active).map(o=>[o.life,o.z]))),before,'A genuine shop pauses pickup lifetimes and positions');
      await page.evaluate(()=>{
        const up=RIFT.upgradeScreen._offers.filter(up=>up.price<=RIFT.scrap.wallet.balance).sort((a,b)=>a.price-b.price)[0];
        if(!up) throw Error('No affordable card despite funded Standard');
        document.querySelector(`[data-augment-id="${up.id}"]`).click();
        for(let i=0;i<30;i++)__stepLoot(1/60);
      });
      checkpoints.push(state);
    }
    const crate=await page.evaluate(()=>{
      const g=RIFT;
      const before=g.scrap.wallet.balance;
      const crate=g.env.spawnCrate({x:0,y:3,z:-12,value:100,sourceId:'test:shootable-cache'});
      if(!crate?.target) throw Error('Treasure did not register a shootable target');
      const target=crate.target; target.damage(999); target.damage(999);
      return {before,after:g.scrap.wallet.balance,authorized:g.scrap.sources.get('test:shootable-cache')?.baseValue,
        active:crate.active,outstanding:g.scrap.outstandingValue};
    });
    assert.equal(crate.before,crate.after,'Destroying a crate emits loot; it does not auto-credit the wallet');
    assert.equal(crate.authorized,100); assert.equal(crate.active,false); assert.ok(crate.outstanding>=100);
    const banking=await page.evaluate(()=>{
      const g=RIFT, before=g.save.data.scrapBanked, earned=g.scrap.wallet.earned,
        spent=g.scrap.wallet.spent,remainder=g.scrap.wallet.balance;
      g.quitRun();
      const after=g.save.data.scrapBanked;
      g.showResults({victory:false}); g.resultsScreen.show({victory:false,killedBy:'QA REPEAT'});
      const duplicate=g.save.data.scrapBanked;
      g.startRun();
      return {before,after,duplicate,earned,spent,remainder,reset:{...g.scrap.wallet},bankAfterReset:g.save.data.scrapBanked};
    });
    assert.ok(banking.spent>0,'Browser banking check follows real purchases');
    assert.equal(banking.after-banking.before,banking.remainder,'Only the unspent remainder is banked');
    assert.equal(banking.remainder,banking.earned-banking.spent);
    assert.equal(banking.duplicate,banking.after,'Repeated results never bank twice');
    assert.deepEqual(banking.reset,{earned:0,spent:0,balance:0});
    assert.equal(banking.bankAfterReset,banking.after,'Starting a run preserves the historical bank');
    const replay=await page.evaluate(()=>{
      const g=RIFT;
      g.testing.enter(); g.testing.setPanelOpen(false); g.testing.setAugmentRank('rapidFire',1);
      g.testing.loadScene('approach1'); g.director._openApproachAugment();
      const oldToken=g.upgradeScreen._offerToken;
      document.querySelector('.upSkip').click(); g.scheduler.update(.3);
      const completed=g.director.data.picks;
      g.testing.loadScene('approach1'); g.director._openApproachAugment();
      return {completed,open:g.upgradeScreen.open,offers:g.upgradeScreen._offers.length,
        awaiting:g.director.data.awaitingAugment,rank:g.upgrades.rank('rapidFire'),
        wallet:g.scrap.wallet.balance,oldToken,newToken:g.upgradeScreen._offerToken,
        rejectsOld:g.upgrades.skip(oldToken)===false};
    });
    assert.equal(replay.completed,1);
    assert.equal(replay.open,true,'Replaying a lab approach must reopen its completed first cache');
    assert.equal(replay.offers,3); assert.equal(replay.awaiting,true);
    assert.equal(replay.rank,1,'Scene replay preserves the tested build');
    assert.equal(replay.wallet,0,'Scene replay resets isolated test income');
    assert.notEqual(replay.newToken,replay.oldToken); assert.equal(replay.rejectsOld,true);
    const isolated=await page.evaluate(()=>{
      const before=RIFT.save.data.scrapBanked;
      RIFT.testing.creditTestScrap(5000); RIFT.quitRun();
      return {before,after:RIFT.save.data.scrapBanked};
    });
    assert.equal(isolated.after,isolated.before,'Test wallet grants cannot enter the historical bank');
    assert.deepEqual(errors,[]);
    console.log('PASS: real Chrome traversal reaches all3funded shops, shop pauses loot clocks, shootable crate emits one authorized reward, remainder banks once, lab replay and test-wallet isolation remain safe.');
    console.log('Browser checkpoints:',JSON.stringify(checkpoints));
  } finally { await browser.close(); }
}
