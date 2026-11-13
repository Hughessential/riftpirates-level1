/** Results rendering, controls and bounded celebration with real hull previews. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const artifacts = '/tmp/riftpirates-victory';
await mkdir(artifacts, { recursive: true });
const errors = [];
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, hasTouch: true });
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    window.WebSocket = class extends EventTarget { readyState = 0; send() {} close() {} };
    window.__pads = [];
    Object.defineProperty(navigator, 'getGamepads', { value: () => __pads });
    localStorage.setItem('riftpirates-level1-v1', JSON.stringify({ pilotName: 'Zoë-銀', pilotNameConfirmed: true, music: 0, bestScore: 1300000, scrapBanked: 777, runs: 12, selectedShip: 'void-corsair' }));
  });
  await page.goto(process.env.RIFT_TEST_URL || 'http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await page.evaluate(async () => {
    const loaded = path => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith(path))?.name;
    window.__Input = (await import(loaded('/src/core/Input.js'))).Input;
    RIFT.update = () => {}; RIFT.renderFrame = () => {};
    window.__saveBefore = JSON.stringify(RIFT.save.data);
    RIFT.testing.enter();
    window.__ranks = { rapidFire: 3, twinFangs: 2, prismLance: 4, orbitals: 1, seekerSwarm: 2 };
    window.__preview = (victory = true) => {
      if (RIFT._terminalOutcome) RIFT.testing.loadScene('sandbox');
      RIFT.runPilotName = 'Zoë-銀';
      RIFT.score.total = 1234567; RIFT.runTime = 1199;
      RIFT.stats.kills = 413; RIFT.stats.perfectDodges = 17; RIFT.stats.towers = 5; RIFT.stats.bossPhases = 4;
      RIFT.upgrades.ranks = { ...__ranks };
      RIFT.scrap.wallet.earned = 12500; RIFT.scrap.wallet.spent = 10250; RIFT.scrap.wallet.balance = 2250;
      RIFT.testing.previewEnding(victory);
      if (!victory) RIFT.showResults({ victory: false });
    };
    __preview();
    window.__tick = seconds => { for (let i = 0; i < Math.ceil(seconds * 60); i++) RIFT.resultsScreen.update(1 / 60); };
    window.__layout = () => {
      const faults = [];
      for (const id of ['resultsTitle', 'resultsPilotName', 'resultsShipName', 'scoreRow', 'resultsGrid', 'againBtn', 'toTitleBtn']) {
        const element = document.getElementById(id), rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) faults.push(`${id}: invisible`);
        if (rect.left < -1 || rect.right > innerWidth + 1) faults.push(`${id}: horizontal overflow`);
      }
      if (innerWidth >= 1000) for (const id of ['againBtn', 'toTitleBtn']) {
        const rect = document.getElementById(id).getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > innerHeight) faults.push(`${id}: not promptly visible`);
      }
      return faults;
    };
    await document.fonts.ready;
  });
  assert.equal(await page.$eval('#resultsTitle', el => el.getAttribute('aria-label')), 'GALAXY ESCAPED');
  assert.equal(await page.$eval('#resultsPilotName', el => el.textContent), 'Zoë-銀');
  assert.equal(await page.$eval('#resultsShipName', el => el.textContent), 'VOID CORSAIR');
  assert.ok(await page.$eval('#resultsShipImage', el => el.complete && el.naturalWidth > 0));
  assert.equal(await page.$eval('#newBest', el => el.classList.contains('hidden')), true);
  assert.equal(await page.$eval('#victorySkip', el => el.hidden), false);
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  assert.equal(await page.$eval('#scoreBig', el => el.textContent), '1,234,567', 'Keyboard immediately completes count-up');
  assert.equal(await page.$eval('#victorySkip', el => el.hidden), true);
  assert.equal(await page.evaluate(() => RIFT.running), false, 'Held keyboard confirm does not accidentally retry after skipping');
  assert.deepEqual(await page.evaluate(() => __layout()), []);
  await page.evaluate(() => __tick(.35));
  await page.screenshot({ path: `${artifacts}/victory-desktop.png` });

  for (const ship of ['rift-talon', 'void-corsair', 'neon-wraith', 'black-manta', 'gold-revenant', 'star-vandal']) {
    await page.evaluate(ship => { RIFT.testing.loadScene('sandbox'); RIFT.testing.setShip(ship); __preview(); }, ship);
    assert.equal(await page.evaluate(ship => document.getElementById('resultsShipImage').src === RIFT.hangar.thumbnails.get(ship), ship), true);
  }
  await page.tap('#victorySkip');
  assert.equal(await page.$eval('#scoreBig', el => el.textContent), '1,234,567', 'Touch skips presentation');

  await page.evaluate(() => {
    __preview();
    window.__pad = { id: 'OHSNAP MCON / ending test', index: 0, connected: true, mapping: 'standard', axes: [0,0,0,0], buttons: Array.from({length:18}, () => ({pressed:false,value:0})) };
    __pads = [__pad]; __Input.pollGamepad(); RIFT.controllerMenus.update();
    document.getElementById('victorySkip').focus();
    __pad.buttons[0] = { pressed:true,value:1 }; __Input.pollGamepad(); RIFT.controllerMenus.update();
    __pad.buttons[0] = { pressed:false,value:0 }; __Input.pollGamepad(); RIFT.controllerMenus.update();
  });
  assert.equal(await page.$eval('#scoreBig', el => el.textContent), '1,234,567', 'Gamepad confirm skips through the native button');
  await page.evaluate(() => { __pads = []; __Input.pollGamepad(); RIFT.controllerMenus.update(); });

  for (const viewport of [{width:2560,height:1440}, {width:1280,height:800}, {width:390,height:844}]) {
    await page.setViewport({ ...viewport, hasTouch: true });
    await page.evaluate(() => RIFT.resultsScreen.presentation.resize());
    assert.deepEqual(await page.evaluate(() => __layout()), [], `Responsive results at ${viewport.width}×${viewport.height}`);
    await page.screenshot({ path: `${artifacts}/victory-${viewport.width}.png` });
  }
  await page.setViewport({width:1440,height:900,hasTouch:true});
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluate(() => __preview());
  assert.deepEqual(await page.evaluate(() => ({revealing:RIFT.resultsScreen.presentation.revealing, particles:RIFT.resultsScreen.presentation.pool.filter(p=>p.life>0).length, text:document.getElementById('scoreBig').textContent})),
    {revealing:false,particles:0,text:'1,234,567'}, 'Reduced motion shows complete static results');
  await page.screenshot({path:`${artifacts}/victory-reduced-motion.png`});
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

  const bounded = await page.evaluate(() => {
    RIFT.adaptiveResolution.scale = .65; __preview();
    const before = JSON.stringify({ wallet:RIFT.scrap.wallet, score:RIFT.score.total, stats:RIFT.stats, save:RIFT.save.data });
    const pool = RIFT.resultsScreen.presentation.pool;
    __tick(80);
    const during = {cap:RIFT.resultsScreen.presentation.cap, count:pool.filter(p=>p.life>0).length, rings:RIFT.resultsScreen.presentation.rings.length};
    const after = JSON.stringify({ wallet:RIFT.scrap.wallet, score:RIFT.score.total, stats:RIFT.stats, save:RIFT.save.data });
    RIFT.resultsScreen.show({victory:true});
    const score = RIFT.score.total;
    RIFT.resultsScreen.hide();
    return { before, after, during, score, alive:pool.filter(p=>p.life>0).length, active:RIFT.resultsScreen.presentation.active, width:RIFT.resultsScreen.presentation.canvas.width, canvasCount:document.querySelectorAll('#victoryParticles').length, unchangedSave:JSON.stringify(RIFT.save.data)===__saveBefore };
  });
  assert.equal(bounded.before,bounded.after,'Fireworks cannot create score, loot, combat events or progress');
  assert.equal(bounded.during.cap,112); assert.ok(bounded.during.count<=112); assert.equal(bounded.during.rings,5);
  assert.equal(bounded.score,1234567); assert.equal(bounded.alive,0); assert.equal(bounded.active,false); assert.equal(bounded.width,1); assert.equal(bounded.canvasCount,1); assert.equal(bounded.unchangedSave,true);

  // A stacked laboratory build can exceed several screens on a narrow display.
  // Its explicit page buttons must expose every row to controller-only players.
  await page.setViewport({width:390,height:844,hasTouch:true});
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith('/src/systems/UpgradeSystem.js')).name;
    const { UPGRADES } = await import(url);
    __ranks = Object.fromEntries(Object.keys(UPGRADES).map(id => [id,3]));
    __preview(); RIFT.resultsScreen.presentation.skip();
  });
  assert.equal(await page.$eval('#resultsBuildToggle',el=>el.hidden),false);
  await page.click('#resultsBuildToggle');
  assert.equal(await page.$eval('.resultsBuildPaging',el=>el.hidden),false);
  const pagedBuild = await page.evaluate(() => {
    __pads = [__pad]; __Input.pollGamepad(); RIFT.controllerMenus.update();
    const build = document.getElementById('resultsBuild');
    const next = document.getElementById('resultsBuildNext');
    let pages = 0;
    while (!next.disabled && pages < 20) {
      next.focus();
      __pad.buttons[0] = {pressed:true,value:1}; __Input.pollGamepad(); RIFT.controllerMenus.update();
      __pad.buttons[0] = {pressed:false,value:0}; __Input.pollGamepad(); RIFT.controllerMenus.update();
      pages++;
    }
    __pads = []; __Input.pollGamepad(); RIFT.controllerMenus.update();
    return {pages,scroll:build.scrollTop,extent:build.scrollHeight-build.clientHeight,done:next.disabled,count:build.children.length};
  });
  assert.ok(pagedBuild.pages > 0 && pagedBuild.pages < 20 && pagedBuild.done);
  assert.ok(Math.abs(pagedBuild.scroll-pagedBuild.extent)<2);
  assert.equal(pagedBuild.count,75,'Every installed augment remains inspectable by gamepad');
  await page.setViewport({width:1440,height:900,hasTouch:true});
  await page.evaluate(()=> { __ranks = {rapidFire:3,twinFangs:2,prismLance:4,orbitals:1,seekerSwarm:2}; });

  await page.evaluate(() => __preview(false));
  assert.equal(await page.$eval('#resultsTitle',el=>el.textContent),'SHIP DESTROYED');
  assert.equal(await page.evaluate(()=>RIFT.resultsScreen.presentation.active),false);
  assert.equal(await page.$eval('#victoryParticles',el=>el.hidden),true);
  assert.ok((await page.$eval('#deathLine',el=>el.textContent)).includes('TEST PREVIEW'));
  await page.screenshot({path:`${artifacts}/death-desktop.png`});
  await page.click('#toTitleBtn');
  assert.equal(await page.$eval('#titleScreen',el=>el.classList.contains('hidden')),false);
  assert.equal(await page.evaluate(()=>RIFT.resultsScreen.presentation.active),false);
  assert.deepEqual(errors,[]);
  console.log('Victory presentation: all six hulls, keyboard/touch/gamepad skip, responsive layouts, reduced motion, fixed pools, truthful results and cleanup passed.');
  console.log(`Screenshots: ${artifacts}`);
} finally { await browser.close(); }
