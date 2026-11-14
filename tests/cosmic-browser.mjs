/** Real game/render coverage for the full75-power build. GPU timings here are
 * software-rendered smoke measurements, not a hardware FPS certification. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

await mkdir('/tmp/rift-cosmic',{recursive:true});
const errors=[];
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless:true,protocolTimeout:240000,args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--mute-audio']});
try{
  const page=await browser.newPage();await page.setViewport({width:1440,height:900});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.RIFT_TEST_URL||'http://localhost:8000/?lab=unlock',{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.RIFT&&!document.getElementById('launchBtn').disabled,{timeout:120000});
  await page.click('#testingGroundsBtn');
  await page.evaluate(async()=>{
    const g=RIFT;window.__cosmicStep=g.update.bind(g);window.__cosmicRender=g.renderFrame.bind(g);
    g.update=()=>{};g.renderFrame=()=>{};
    const loaded=path=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname.endsWith(path))?.name;
    window.__cosmicInput=(await import(loaded('/src/core/Input.js'))).Input;
    window.__allPowers=(await import(loaded('/src/systems/UpgradeSystem.js'))).UPGRADES;
    window.__savedBefore=JSON.stringify(g.save.data);
    g.testingPanel.close();g.testing.setSetting('autoFire',true);g.testing.setSetting('freezeEnemies',true);
  });
  for(const rank of [1,5,50]){
    const state=await page.evaluate(rank=>{
      const g=RIFT,lab=g.testing;lab.loadScene('sandbox');lab._rebuild(Object.fromEntries(Object.keys(__allPowers).map(id=>[id,rank])));
      lab.setPanelOpen(false);lab.setSetting('autoFire',true);lab.setSetting('godMode',true);lab.setSetting('freezeEnemies',true);
      lab.restorePlayer();g.player.shield=0;lab.spawnDummies();
      const c=g.augmentEffects.cosmic;g.heat.heat=.8;
      c.onAugmentInstalled();c.onDodgeStart(1,'boost');c.onPerfectDodge();
      for(let i=0;i<10;i++)g.augmentEffects.onScrap(25,{sourceId:`stress-${rank}-${i}`});
      c.summonArmada();c.timers.palace=12;c.timers.reflex=2;
      __cosmicInput._padAim=true;
      let peakPlayer=0,peakEnemy=0,peakCosmic=0,peakArcs=0;const started=performance.now();
      for(let frame=0;frame<180;frame++){
        if(frame%10===0)for(let i=0;i<12;i++)g.projectiles.fireEnemy({x:(i-6)*3,y:2,z:-25,tx:(i-6)*3,ty:1,tz:0,speed:20,damage:9});
        __cosmicStep(1/60);
        peakPlayer=Math.max(peakPlayer,g.projectiles.player.filter(b=>b.active).length);
        peakEnemy=Math.max(peakEnemy,g.projectiles.enemy.filter(b=>b.active).length);
        peakCosmic=Math.max(peakCosmic,c.mesh.count);peakArcs=Math.max(peakArcs,g.augmentEffects.arcs.length);
      }
      const simulationMs=performance.now()-started;g.renderer.info.autoReset=false;g.renderer.info.reset();__cosmicRender(1/60);
      const drawCalls=g.renderer.info.render.calls;g.renderer.info.autoReset=true;
      return {rank,installed:Object.keys(g.upgrades.ranks).length,peakPlayer,peakEnemy,peakCosmic,peakArcs,drawCalls,simulationMs,
        damage:lab.dummyDamage,finite:g.projectiles.player.concat(g.projectiles.enemy).filter(b=>b.active).every(b=>Number.isFinite(b.x+b.y+b.z+b.damage)),
        statsFinite:Object.values(g.player.stats).filter(v=>typeof v==='number').every(Number.isFinite),
        fieldCount:g.augmentEffects.fields.length,particleCount:g.fx.pool?.length,
        wallet:g.scrap.wallet.balance,saveUnchanged:JSON.stringify(g.save.data)===__savedBefore};
    },rank);
    assert.equal(state.installed,75);assert.ok(state.finite&&state.statsFinite&&state.saveUnchanged);
    assert.ok(state.damage>0&&state.peakPlayer>0&&state.peakEnemy>0);
    assert.ok(state.peakPlayer<=1024&&state.peakEnemy<=512&&state.peakCosmic<=64&&state.peakArcs<=48&&state.fieldCount<=6);
    await page.screenshot({path:`/tmp/rift-cosmic/all75-rank${rank}.png`});console.log('Full build stress',state);
  }
  const guards=await page.evaluate(()=>{
    const g=RIFT,lab=g.testing;lab.loadScene('boss');lab.setPanelOpen(false);lab.setSetting('autoFire',false);
    const boss=g.encounter,core=boss.coreTarget;boss._closeCore();const hp=boss.bossHp,phase=boss.phase;
    g.augmentEffects.cosmic.pressure(true);
    const shieldedBefore=boss.bossHp;
    const blocked=g.augmentEffects.damageTarget(core,1e12,false,true);
    const protectedCore=blocked===0&&!core.targetable&&boss.phase===phase&&boss.bossHp===shieldedBefore;
    boss._openCore(2);const exposedBefore=boss.bossHp;
    const validHit=g.augmentEffects.damageTarget(core,10,false,true);
    const exposedDamage=validHit>0&&boss.bossHp<exposedBefore;
    lab.loadScene('escape');lab.setPanelOpen(false);lab.setSetting('godMode',true);lab.setSetting('autoFire',false);
    const c=g.augmentEffects.cosmic;c.timers.reflex=100;c.timers.conquerorSlow=100;c.timers.endWave=100;
    g.player.invuln=100;g.player.x=22;g.player.y=13;const before=g.escape.elapsed;
    for(let i=0;i<60;i++)__cosmicStep(1/60);
    const deadlineAdvanced=g.escape.elapsed-before;
    g.escape.elapsed=g.escape.deadline-.1;g.player.x=22;g.player.y=13;
    for(let i=0;i<12;i++)__cosmicStep(1/60);
    return {protectedCore,exposedDamage,deadlineAdvanced,outcome:g.escape.outcome,alive:g.player.alive,cleared:g._escapeCleared,
      saveUnchanged:JSON.stringify(g.save.data)===__savedBefore};
  });
  assert.ok(guards.protectedCore&&guards.exposedDamage);assert.ok(Math.abs(guards.deadlineAdvanced-1)<.02);
  assert.equal(guards.outcome,'timeout');assert.equal(guards.alive,false);assert.equal(guards.cleared,false);assert.ok(guards.saveUnchanged);
  assert.deepEqual(errors,[]);console.log('PASS real boss immunity, exposed core damage, unslowed escape deadline, timeout defeats god mode, isolated save.',guards);
}finally{await browser.close();}
