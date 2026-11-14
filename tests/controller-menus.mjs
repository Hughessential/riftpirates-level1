import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  protocolTimeout: 180000, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    window.__pads = [];
    Object.defineProperty(navigator, 'getGamepads', { value: () => window.__pads });
  });
  await page.goto(process.env.RIFT_TEST_URL || 'http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await page.evaluate(async () => {
    const inputUrl = performance.getEntriesByType('resource').find(entry => /\/src\/core\/Input\.js(?:\?|$)/.test(entry.name)).name;
    window.__input = (await import(inputUrl)).Input;
    window.RIFT.update = () => {};
    window.__tick = () => { __input.pollGamepad(); RIFT.controllerMenus.update(); RIFT.upgradeScreen.update(); };
    window.__pad = { id: 'OHSNAP MCON / virtual standard layout', index: 0, connected: true, mapping: 'standard', axes: [0,0,0,0], buttons: Array.from({length: 18}, () => ({pressed: false, value: 0})) };
    window.__press = i => { __pad.buttons[i] = {pressed: true, value: 1}; __tick(); __pad.buttons[i] = {pressed: false, value: 0}; __tick(); };
    window.__go = selector => {
      for (let n = 0; n < 250; n++) {
        if (document.activeElement.matches(selector)) return;
        __press(13);
      }
      throw new Error(`Cannot reach ${selector}; focus=${document.activeElement.outerHTML.slice(0,180)}`);
    };
    __pad.buttons[0] = {pressed: true, value: 1}; __pads = [__pad]; __tick();
  });
  assert.equal(await page.evaluate(() => RIFT.running), false, 'Wake/reconnect confirm is ignored');
  await page.evaluate(() => { __pad.buttons[0] = {pressed: false, value: 0}; __tick(); __press(13); });
  const focusDebug = await page.evaluate(() => ({root:RIFT.controllerMenus.root?.id,focus:RIFT.controllerMenus.focused?.outerHTML,active:RIFT.controllerMenus.active,pad:__input._padId,bind:__input.bindings}));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'optionsBtn', JSON.stringify(focusDebug));
  await page.evaluate(() => { __press(0); __go('#musicTgl'); });
  assert.equal(await page.$eval('#optionsDialog', el => el.open), true, 'Controller opens title Options');
  const reservedConfirm = await page.evaluate(() => {
    // A custom map is allowed to contain button 0, but physical A remains the
    // contextual menu confirm instead of also becoming Back/cancel.
    const originalCancel = __input.bindings.cancel;
    const originalBrake = __input.bindings.brake;
    __input.bindings.cancel = 0;
    __input.bindings.brake = 1;
    const before = RIFT.save.data.music;
    __press(0);
    const after = RIFT.save.data.music;
    __input.bindings.cancel = originalCancel;
    __input.bindings.brake = originalBrake;
    __press(0); // Restore the test's music setting for the remaining scenarios.
    return { before, after, focus: document.activeElement.id };
  });
  assert.notEqual(reservedConfirm.after, reservedConfirm.before, 'Physical A still confirms when cancel is mapped to button 0');
  assert.equal(reservedConfirm.focus, 'musicTgl');
  const mix = await page.evaluate(() => { __go('#musicVolume'); const before = Number(document.activeElement.value); __press(14); return {before, after:Number(document.activeElement.value)}; });
  assert.equal(mix.after, mix.before - 5);
  const scale = await page.evaluate(() => { __go('#uiScale'); const before = Number(document.activeElement.value); __press(15); return {before, after:Number(document.activeElement.value), saved:RIFT.save.data.uiScale}; });
  assert.equal(scale.after, scale.before + 5, 'Controller adjusts UI size inside Options');
  assert.equal(scale.saved, scale.after / 100);
  await page.evaluate(() => { __press(14); __press(1); });
  assert.equal(await page.$eval('#optionsDialog', el => el.open), false, 'Controller Back closes Options');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'optionsBtn', 'Controller returns to Options');
  await page.evaluate(() => { __go('#shipSelectBtn'); __press(0); });
  assert.equal(await page.evaluate(() => RIFT.hangar.dialog.open), true);
  const ship = await page.evaluate(() => { const before=RIFT.hangar.selectedId; __press(15); return {before, after:RIFT.hangar.selectedId}; });
  assert.notEqual(ship.before, ship.after, 'Controller browsing changes the visible cosmetic ship');
  await page.evaluate(() => { __go('#hangarConfirm'); __press(0); });
  assert.equal(await page.evaluate(() => RIFT.hangar.dialog.open), false);
  await page.evaluate(() => { __go('#launchBtn'); __press(0); });
  assert.equal(await page.evaluate(() => RIFT.pilotIdentity.dialog.open), true, 'First flight offers pilot creation');
  await page.evaluate(() => { __go('#pilotNameInput'); __press(0); __go('[data-key="clear"]'); __press(0); __go('[data-key="A"]'); __press(0); __go('[data-key="-"]'); __press(0); __go('[data-key="1"]'); __press(0); __press(1); __go('#pilotNameConfirm'); __press(0); });
  assert.equal(await page.evaluate(() => RIFT.runPilotName), 'A-1', 'Controller keyboard creates and snapshots a pilot name');
  assert.equal(await page.evaluate(() => RIFT.running), true);
  await page.evaluate(() => { RIFT.tutorial.start({force:true}); RIFT.tutorial.showStep(3); __input.enabled=true; RIFT.controllerMenus.setActive(false); __tick(); });
  await page.evaluate(() => __press(0));
  assert.equal(await page.evaluate(() => RIFT.tutorial.active), true, 'Gameplay A remains brake and cannot immediately skip the tutorial');
  await page.evaluate(() => __press(13));
  assert.equal(await page.evaluate(() => document.activeElement.matches('#openingTutorial button')), true, 'D-pad deliberately focuses tutorial Skip');
  await page.evaluate(() => __press(0));
  assert.equal(await page.evaluate(() => RIFT.tutorial.active), false, 'Physical A activates the focused tutorial Skip');
  const defaults = await page.evaluate(() => {
    __input.enabled = true;
    __tick(); // Release the menu-to-flight carryover guards.
    const held = index => {
      __pad.buttons[index] = {pressed:true,value:1}; __tick();
      const state = {fire:__input.firing,boost:__input.read().boost,brake:__input.braking,aim:__input.aiming};
      __pad.buttons[index] = {pressed:false,value:0}; __tick(); return state;
    };
    const fire=held(7), boost=held(6), brake=held(0), aim=held(2);
    __input._resetRollTaps(); __press(14); __press(14); const dpadRoll=__input.consumeRoll();
    __input._resetRollTaps(); __pad.axes[0]=-1; __tick(); __tick();
    const heldRoll=__input.consumeRoll(); __pad.axes[0]=0; __tick(); __pad.axes[0]=-1; __tick();
    __pad.axes[0]=0; __tick(); __pad.axes[0]=-1; __tick(); const stickRoll=__input.consumeRoll(); __pad.axes[0]=0; __tick();
    return {bindings:{...__input.bindings},fire,boost,brake,aim,dpadRoll,heldRoll,stickRoll};
  });
  assert.deepEqual(defaults.bindings, { fire:7,cancel:1,brake:0,rollLeft:4,rollRight:5,aim:2,boost:6,view:8,pause:9,up:12,down:13,left:14,right:15 });
  assert.equal(defaults.fire.fire, true); assert.equal(defaults.boost.boost, true);
  assert.equal(defaults.brake.brake, true); assert.equal(defaults.aim.aim, true);
  assert.equal(defaults.dpadRoll, -1, 'Released d-pad double-tap rolls left');
  assert.equal(defaults.heldRoll, 0, 'Held stick cannot count as two flicks');
  assert.equal(defaults.stickRoll, -1, 'Two neutral-separated stick flicks roll left');
  const pauseOnA = await page.evaluate(() => {
    const originalPause = __input.bindings.pause;
    const originalBrake = __input.bindings.brake;
    __input.bindings.pause = 0;
    __input.bindings.brake = originalPause;
    __press(0);
    const paused = RIFT.paused;
    const focused = document.activeElement.id;
    __press(0);
    const resumed = !RIFT.paused;
    __input.bindings.pause = originalPause;
    __input.bindings.brake = originalBrake;
    return { paused, focused, resumed };
  });
  assert.deepEqual(pauseOnA, { paused:true, focused:'resumeBtn', resumed:true },
    'A saved pause-on-A mapping works in flight while physical A still confirms the pause menu');
  await page.evaluate(async () => {
    RIFT.scrap.wallet.credit(5000); RIFT.upgradeScreen.show(1, '#22ffee', () => {}); __input.enabled=false; __tick(); __press(15);
    __pad.buttons[0]={pressed:true,value:1}; __tick(); await new Promise(resolve=>setTimeout(resolve,650)); __tick();
    __pad.buttons[0]={pressed:false,value:0}; __tick();
  });
  assert.equal(await page.evaluate(() => RIFT.upgrades.taken.length), 1, 'Augment selection installs exactly one upgrade');
  await page.evaluate(() => { RIFT.upgradeScreen.hide(); RIFT.save.data.seenIntro=1; RIFT.director.go('TOWER_1_INTRO'); RIFT.director.update(1); __tick(); __tick(); __pad.buttons[0]={pressed:true,value:1}; __tick(); RIFT.director.update(.016); __pad.buttons[0]={pressed:false,value:0}; __tick(); });
  assert.equal(await page.evaluate(() => RIFT.director.state), 'TOWER_1_COMBAT', 'Fresh confirm skips an eligible boss intro');
  await page.evaluate(() => __press(9));
  assert.equal(await page.evaluate(() => RIFT.paused), true);
  await page.evaluate(() => { __go('#sfxVolume2'); __press(14); __press(1); });
  assert.equal(await page.evaluate(() => RIFT.paused), false, 'Back resumes the pause menu');
  // Holding confirm across a menu close must not accidentally shoot.
  const held = await page.evaluate(() => {
    __press(9); __go('#resumeBtn'); __pad.buttons[0] = {pressed:true,value:1}; __tick(); __tick();
    const firing=__input.firing; __pad.buttons[0]={pressed:false,value:0}; __tick(); return firing;
  });
  assert.equal(held, false);
  await page.evaluate(() => { __pads=[]; __tick(); });
  assert.equal(await page.evaluate(() => RIFT.paused), true, 'Disconnect pauses active flight');
  await page.evaluate(() => { __pad.buttons[9]={pressed:true,value:1}; __pads=[__pad]; __tick(); });
  assert.equal(await page.evaluate(() => RIFT.paused), true, 'Reconnect with held Start cannot resume');
  await page.evaluate(() => { __pad.buttons[9]={pressed:false,value:0}; __tick(); __press(1); RIFT.quitRun(); __tick(); });
  await page.evaluate(() => { __go('#againBtn'); __press(0); });
  assert.equal(await page.evaluate(() => RIFT.running), true, 'Results replay works');
  await page.evaluate(() => { RIFT.quitRun(); __tick(); __go('#toTitleBtn'); __press(0); });
  assert.equal(await page.evaluate(() => RIFT.titleMode), true, 'Results title return works');

  // Every testing-ground control class is reachable and editable without a mouse.
  await page.evaluate(() => { RIFT.testingPanel._setUnlocked(true, {quiet:true}); __go('#testingGroundsBtn'); __press(0); });
  assert.equal(await page.evaluate(() => RIFT.testing.panelOpen), true);
  const god = await page.evaluate(() => { __go('[data-setting="godMode"]'); const before=document.activeElement.checked; __press(0); return {before,after:document.activeElement.checked}; });
  assert.notEqual(god.before, god.after);
  const speed = await page.evaluate(() => { __go('#labTimeScale'); const before=document.activeElement.value; __press(15); return {before,after:document.activeElement.value}; });
  assert.notEqual(speed.before, speed.after, 'Native select changes via left/right');
  await page.evaluate(() => __press(5));
  assert.equal(await page.evaluate(() => RIFT.testingPanel.activeTab), 'augments', 'Shoulders switch lab tabs');
  await page.evaluate(() => { __go('#labAugmentSearch'); __press(0); });
  assert.equal(await page.evaluate(() => document.getElementById('controllerKeyboard').open), true);
  await page.evaluate(() => { __press(0); __press(1); });
  assert.equal(await page.$eval('#labAugmentSearch', el=>el.value), 'A', 'Controller search keyboard enters text');
  // Clear search via its controller keyboard, then edit a stack count.
  await page.evaluate(() => { __go('#labAugmentSearch'); __press(0); __go('[data-key="clear"]'); __press(0); __press(1); __go('[data-rank-input]'); __press(15); });
  assert.equal(await page.evaluate(() => Number(document.activeElement.value)), 1, 'Augment rank input responds');
  await page.evaluate(() => __press(5));
  assert.equal(await page.evaluate(() => RIFT.testingPanel.activeTab), 'arena');
  await page.evaluate(() => { __go('#labScene'); __press(15); __go('[data-action="scene"]'); __press(0); });
  assert.equal(await page.evaluate(() => RIFT.testing.sceneId), 'approach1');
  await page.evaluate(() => __press(5));
  assert.equal(await page.evaluate(() => RIFT.testingPanel.activeTab), 'effects');
  await page.evaluate(() => { __go('#labBloom'); __press(15); __go('[data-sound]'); __press(0); __go('#labExit'); __press(0); });
  assert.equal(await page.evaluate(() => RIFT.testing.active), false);

  // South skips the celebratory reveal before becoming the retry action.
  await page.evaluate(() => { __go('#testingGroundsBtn'); __press(0); __go('#labTab-arena'); __press(0); __go('[data-action="victory"]'); __press(0); });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'victorySkip', 'Controller starts on the reveal skip action');
  await page.evaluate(() => __press(0));
  assert.equal(await page.evaluate(() => RIFT.resultsScreen.presentation.revealing), false);
  assert.equal(await page.evaluate(() => RIFT.running), false, 'Skipping reveal does not start a new run');
  await page.evaluate(() => __press(1));

  // Gameplay fire can move to Back without moving physical-A menu confirmation.
  await page.evaluate(() => { __go('#controllerSettingsBtn'); __press(0); __go('[data-bind="fire"]'); __press(0); __press(1); });
  assert.deepEqual(await page.evaluate(() => [__input.bindings.fire, __input.bindings.cancel]), [1,7]);
  await page.evaluate(() => { __go('#controllerReset'); __press(0); __press(1); });
  // Raw/nonstandard devices can bind real button indices and persist them.
  await page.evaluate(() => { __go('#controllerSettingsBtn'); __press(0); __go('[data-bind="fire"]'); __press(0); __press(2); });
  assert.equal(await page.evaluate(() => __input.bindings.fire), 2);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('riftpirates-controller-v1'))[__pad.id].buttons.fire), 2);
  await page.evaluate(() => { __pads=[]; __tick(); __pads=[__pad]; __tick(); __pad.buttons[0]={pressed:false,value:0}; __tick(); });
  assert.equal(await page.evaluate(() => __input.bindings.fire), 2, 'Existing per-device gameplay mapping survives reconnect');
  await page.evaluate(() => { __press(1); __go('#launchBtn'); __press(0); });
  assert.equal(await page.evaluate(() => RIFT.running), true, 'Physical A launches after gameplay fire is remapped');
  await page.evaluate(() => { RIFT.quitRun(); __tick(); __press(1); __pad.id='DualSense Wireless Controller'; __pad.index=2; __pad.mapping='standard'; __pads=[null,null,__pad]; __tick(); });
  assert.equal(await page.evaluate(() => __input.bindings.fire), 7, 'New controller gets the new trigger-fire default');
  await page.evaluate(() => { __pad.axes[1]=.8; __tick(); __pad.axes[1]=0; __tick(); });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'optionsBtn', 'Analog stick navigates');
  await page.evaluate(() => { __go('#launchBtn'); __press(0); const other={...__pad,id:'Xbox Controller',index:0,buttons:__pad.buttons.map(()=>({pressed:false,value:0}))}; __pads=[other,null,__pad]; __tick(); });
  assert.equal(await page.evaluate(() => __input._padId), 'DualSense Wireless Controller', 'An idle second pad cannot steal control');
  await page.evaluate(() => { __pads=__pads.slice(0,1); __tick(); });
  assert.equal(await page.evaluate(() => RIFT.paused), true, 'Losing active pad pauses even when a spare pad is connected');
  assert.deepEqual(errors, []);
  console.log('PASS: virtual MCON/standard layouts, title/hangar/volume/pause/results/lab tabs and controls, search keyboard, remapping, analog navigation, disconnect pause and reconnect/carryover safety.');
} finally { await browser.close(); }
