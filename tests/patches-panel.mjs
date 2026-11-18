import assert from 'node:assert/strict';
import { mkdirSync, existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { sanitizePatchesState, clampPatchesRect } from '../src/ui/PatchesState.js';
import { ANNOUNCEMENTS, publishedAnnouncements } from '../src/config/announcements.js';
import { launchRun } from './helpers/start-run.mjs';

assert.equal(sanitizePatchesState({ schema: 1, expanded: 'yes', tab: 'bad', rect: { x: Infinity } }).expanded, false);
assert.equal(sanitizePatchesState({ schema: 1, rect: { x: Infinity } }).rect, null);
assert.equal(sanitizePatchesState({ schema: 9, expanded: true }).expanded, false);
assert.deepEqual(clampPatchesRect({ x: -900, y: 9999, width: 9000, height: 9000 }, 800, 600), { x: 12, y: 12, width: 776, height: 576 });
assert.equal(publishedAnnouncements([{ id: 'draft', category: 'patch', title: 'Draft' }, { id: 'future', published: true, category: 'patch', title: 'Future', date: '2999-01-01' }]).length, 0);

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: process.env.RIFT_BROWSER_PATH || (existsSync(chrome) ? chrome : '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'),
  headless: true, protocolTimeout: 180000,
  args: ['--no-sandbox', '--mute-audio', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const url = process.env.RIFT_TEST_URL || 'http://localhost:8000/';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
mkdirSync(new URL('../shots/', import.meta.url), { recursive: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await page.evaluate(() => { RIFT.update = () => {}; RIFT.renderFrame(1); });
  assert.equal(await page.$eval('#patchesToggle', el => el.getAttribute('aria-expanded')), 'false');
  assert.equal(await page.$eval('.patchesNew', el => el.hidden), publishedAnnouncements(ANNOUNCEMENTS).length === 0, 'NEW reflects the published feed');
  await page.focus('#patchesToggle');
  await page.keyboard.press('Space');
  await pause(350);
  assert.equal(await page.$eval('#patchesPanel', el => el.inert), false, 'Space opens without being swallowed by gameplay');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.$eval('[role=tab][aria-selected=true]', el => el.dataset.patchesTab), 'upcoming');
  await page.keyboard.press('End');
  assert.equal(await page.$eval('[role=tab][aria-selected=true]', el => el.dataset.patchesTab), 'roadmap');
  const rect = () => page.$eval('#patchesPanel', el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; });
  const initial = await rect();
  await page.mouse.move(initial.x + 170, initial.y + 22);
  await page.mouse.down(); await page.mouse.move(initial.x + 90, initial.y + 100, { steps: 8 }); await page.mouse.up();
  const moved = await rect();
  assert.ok(Math.abs(moved.x - initial.x + 80) < 2 && Math.abs(moved.y - initial.y - 78) < 2, `Header drag follows pointer: ${JSON.stringify({initial,moved})}`);
  for (const [edge, dx, dy] of [['right', 65, 0], ['bottom', 0, 45], ['corner', 35, 25]]) {
    const before = await rect();
    const x = edge === 'bottom' ? before.x + 100 : before.x + before.width - 2;
    const y = edge === 'right' ? before.y + 100 : before.y + before.height - 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, {steps:5}); await page.mouse.up();
    const after = await rect();
    assert.ok(Math.abs(after.width - before.width - dx) < 2 && Math.abs(after.height - before.height - dy) < 2, `Resize ${edge}`);
  }
  const customized = await rect();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.RIFT);
  await page.evaluate(() => { RIFT.update = () => {}; RIFT.renderFrame(1); });
  await pause(350);
  assert.deepEqual(await rect(), customized, 'Layout survives reload');
  assert.equal(await page.$eval('[role=tab][aria-selected=true]', el => el.dataset.patchesTab), 'roadmap');
  assert.equal(await page.$eval('#patchesToggle', el => el.getAttribute('aria-expanded')), 'true');
  await page.click('.patchesReset');
  await page.click('[data-patches-tab=patch]');
  for (const [width, height] of [[1663,946], [1280,720], [1024,768], [820,1180], [390,844], [375,667], [844,390]]) {
    await page.setViewport({ width, height }); await pause(150);
    await page.evaluate(() => RIFT.renderFrame(1));
    const bounds = await rect();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1, `Panel fits ${width}x${height}`);
    const overflow = await page.$eval('.patchesContent', el => el.scrollWidth > el.clientWidth + 1);
    assert.equal(overflow, false, `No horizontal content overflow at ${width}`);
    const header = await page.evaluate(() => {
      const a=document.querySelector('.menuBrand').getBoundingClientRect(), b=document.querySelector('#patchesToggle').getBoundingClientRect(), c=document.querySelector('.menuEdition').getBoundingClientRect();
      const overlaps=(x,y)=>x.left<y.right&&x.right>y.left&&x.top<y.bottom&&x.bottom>y.top;
      return {overlap:overlaps(a,b)||overlaps(b,c), fits:b.right<=innerWidth&&b.left>=0};
    });
    assert.equal(header.overlap, false, 'Masthead controls do not overlap'); assert.ok(header.fits);
    console.log(`PASS viewport ${width}x${height}`);
    await page.screenshot({ path:new URL(`../shots/patches-${width}.png`,import.meta.url).pathname });
  }
  await page.setViewport({ width:1440,height:900 });
  await page.click('.patchesReset');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.id), 'patchesToggle', 'Escape restores launcher focus');
  await page.reload({waitUntil:'domcontentloaded'}); await page.waitForFunction(()=>window.RIFT);
  await page.evaluate(() => { RIFT.update = () => {}; RIFT.renderFrame(1); });
  assert.equal(await page.$eval('#patchesPanel', el => el.inert), true, 'Collapsed preference survives reload');
  // Fixture transmissions are injected only into this test page, never the shipping feed.
  await page.evaluate(async () => {
    const { PatchesPanel } = await import('/src/ui/PatchesPanel.js');
    RIFT.patchesPanel.destroy(); RIFT.save.data.patchesWindow = null;
    const entries = [
      { id:'test-patch',category:'patch',published:true,title:'TEST PATCH',version:'TEST',summary:'A test-only announcement.',highlights:['Feature highlight'],details:'Expanded test notes.',fixes:['A test fix'],image:'images/ships/gold-revenant.webp' },
      ...Array.from({length:8}, (_,i)=>({id:`test-upcoming-${i}`,category:'upcoming',published:true,title:`TEST PREVIEW ${i}`,summary:'This fixture is not a development commitment.',status:'planned',details:'Test detail.'})),
      {id:'test-roadmap',category:'roadmap',published:true,title:'TEST MILESTONE',status:'testing',summary:'Fixture milestone.'},
    ];
    RIFT.patchesPanel = new PatchesPanel(RIFT,entries);
  });
  assert.equal(await page.$eval('.patchesNew',el=>el.hidden), false);
  await page.click('#patchesToggle');
  await page.waitForFunction(() => RIFT.patchesPanel.state.seen.includes('test-patch'), {timeout:10000}).catch(async error => {
    console.log(await page.evaluate(() => { const p=RIFT.patchesPanel; const t=document.querySelector('.patchesReadTarget'); const r=t.getBoundingClientRect(); return {visible:p.isVisible(), expanded:p.state.expanded, intersections:p.intersections.size, timers:p.readTimers.size, rect:r.toJSON(), hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML, dialogs:document.querySelectorAll('dialog[open]').length}; }));
    throw error;
  });
  assert.deepEqual(await page.evaluate(()=>RIFT.patchesPanel.state.seen), ['test-patch'], 'Only visible announcement marked read');
  await page.click('.patchesDetailsToggle');
  assert.equal(await page.$eval('.patchesDetails',el=>el.hidden), false);
  await page.click('[data-patches-tab=upcoming]');
  await page.waitForFunction(() => RIFT.patchesPanel.state.seen.includes('test-upcoming-0'));
  const seen = await page.evaluate(()=>RIFT.patchesPanel.state.seen);
  assert.ok(seen.includes('test-upcoming-0') && !seen.includes('test-upcoming-7'), 'Offscreen announcements stay unread');
  await page.$eval('.patchesContent',el=>{el.scrollTop=el.scrollHeight;});
  await page.waitForFunction(() => RIFT.patchesPanel.state.seen.includes('test-upcoming-7'));
  assert.ok(await page.evaluate(()=>RIFT.patchesPanel.state.seen.includes('test-upcoming-7')), 'Scrolling an announcement into view marks it read');
  await page.click('[data-patches-tab=roadmap]'); await page.keyboard.press('Escape'); await pause(1100);
  assert.equal(await page.evaluate(()=>RIFT.patchesPanel.state.seen.includes('test-roadmap')), false, 'Quick open/close never marks unseen content');
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled:true, maxTouchPoints:1 });
  await page.setViewport({width:820,height:1180});
  await page.click('#patchesToggle'); await pause(350);
  const tablet = await rect();
  const dragTouch = await page.touchscreen.touchStart(tablet.x + 120, tablet.y + 24);
  await dragTouch.move(tablet.x + 80, tablet.y + 70); await dragTouch.end();
  assert.ok(Math.abs((await rect()).y - tablet.y - 46) < 2, 'Touch drags tablet header');
  await page.setViewport({width:390,height:844}); await pause(150);
  await page.click('[data-patches-tab=upcoming]');
  const scrollRect = await page.$eval('.patchesContent',el=>el.getBoundingClientRect().toJSON());
  const scrollTouch = await page.touchscreen.touchStart(scrollRect.x+scrollRect.width/2,scrollRect.bottom-25);
  for(let step=1;step<=5;step++) { await scrollTouch.move(scrollRect.x+scrollRect.width/2,scrollRect.bottom-25-step*25); await pause(30); }
  await scrollTouch.end();
  assert.ok(await page.$eval('.patchesContent',el=>el.scrollTop > 0), 'Mobile sheet supports native touch scrolling');
  await cdp.send('Emulation.setTouchEmulationEnabled', {enabled:false});
  await page.setViewport({width:1440,height:900});
  await page.click('.patchesReset');
  await page.click('[data-patches-tab=roadmap]');
  await page.keyboard.press('Escape');
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  assert.equal(await page.$eval('#patchesToggle',el=>getComputedStyle(el).animationName),'none');
  // Exercise the same physical-controller polling path as the controller suite.
  await page.evaluate(async () => {
    const { Input } = await import('/src/core/Input.js'); window.__input=Input;
    RIFT.update=()=>{};
    window.__pad={id:'Patch panel test pad',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:18},()=>({pressed:false,value:0}))};
    Object.defineProperty(navigator,'getGamepads',{value:()=>[__pad],configurable:true});
    window.__tick=()=>{Input.pollGamepad();RIFT.controllerMenus.update();};
    window.__press=i=>{__pad.buttons[i]={pressed:true,value:1};__tick();__pad.buttons[i]={pressed:false,value:0};__tick();};
    __tick(); __press(13);
    for(let i=0;i<25&&document.activeElement.id!=='patchesToggle';i++)__press(13);
    __press(0);
  });
  assert.equal(await page.$eval('#patchesToggle',el=>el.getAttribute('aria-expanded')),'true', 'Controller reaches and opens panel');
  await page.evaluate(()=>__press(5));
  assert.equal(await page.evaluate(()=>RIFT.patchesPanel.state.tab),'patch','Controller shoulder cycles tabs');
  await page.evaluate(()=>{ __press(5); RIFT.controllerMenus.focus(RIFT.patchesPanel.content); __press(13); });
  assert.ok(await page.$eval('.patchesContent',el=>el.scrollTop > 0), 'Controller scrolls long channels');
  await page.evaluate(()=>__press(1));
  assert.equal(await page.evaluate(()=>document.activeElement.id),'patchesToggle','Controller Back closes and restores focus');
  // Existing title controls remain usable while the nonmodal panel is open.
  await page.click('#patchesToggle');
  await page.click('#optionsBtn'); assert.equal(await page.$eval('#optionsDialog',el=>el.open),true);
  await page.evaluate(()=>RIFT.optionsMenu.close());
  await page.click('#pilotIdentityBtn'); assert.equal(await page.evaluate(()=>RIFT.pilotIdentity.dialog.open),true);
  await page.evaluate(()=>RIFT.pilotIdentity.close());
  await page.click('#shipSelectBtn'); assert.equal(await page.evaluate(()=>RIFT.hangar.dialog.open),true);
  await page.evaluate(()=>RIFT.hangar.close());
  const globe=await page.evaluate(()=>{
    const world=RIFT.worldShowcase, before=world.menuPlanet.rotation.y;
    world.update(1,0,{menu:true});
    return {visible:world.menuRoot.visible,animated:world.menuPlanet.rotation.y!==before};
  }); assert.deepEqual(globe,{visible:true,animated:true});
  await launchRun(page); assert.equal(await page.evaluate(()=>RIFT.running),true);
  assert.equal(await page.evaluate(()=>RIFT.patchesPanel.isVisible()),false,'Panel disappears with title on launch');
  assert.deepEqual(errors,[],'No browser errors or missing assets');
  console.log('PASS: patches keyboard, drag, three resize handles, persistence, seven viewport layouts, unread visibility, reduced motion, controller and title control regressions.');
} finally { await browser.close(); }
