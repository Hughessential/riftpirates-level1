import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless:true, protocolTimeout:180000,
  args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--mute-audio'],
});
const boundsInside = (rect, width, height, label) => {
  assert.ok(rect.width > 0 && rect.height > 0, `${label} paints`);
  assert.ok(rect.left >= -1 && rect.top >= -1 && rect.right <= width + 1 && rect.bottom <= height + 1,
    `${label} stays within ${width}×${height}: ${JSON.stringify(rect)}`);
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width:1280, height:800 });
  await page.evaluateOnNewDocument(() => localStorage.setItem('riftpirates-level1-v1', JSON.stringify({
    pilotName:'SCALE TEST', pilotNameConfirmed:true, nameTagVisible:true, tutorialComplete:true,
    uiScale:.8, musicVolume:0, sfxVolume:0,
  })));
  await page.goto('http://localhost:8000/', { waitUntil:'domcontentloaded', timeout:120000 });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout:120000 });

  const sample = () => page.evaluate(() => {
    const tag = document.getElementById('playerNameTag');
    tag.hidden = false; tag.style.transform = 'translate3d(640px,360px,0) translateX(-50%)';
    RIFT.controllerMenus.hint.hidden = false;
    RIFT.controllerMenus.audioHint.hidden = false;
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height };
    };
    return {
      main:rect('.menuMain'), launch:rect('#launchBtn'), footer:rect('.menuFooter'),
      boss:rect('#bossIntro'), bossTitle:rect('#bossIntroTitle'),
      pilot:rect('#playerNameTag'), controller:rect('.controllerHint'), audio:rect('.controllerAudioHint'),
    };
  });
  await page.evaluate(() => {
    const boss = document.getElementById('bossIntro');
    boss.hidden = false;
    boss.style.setProperty('--intro-in','1'); boss.style.setProperty('--intro-title','1');
    document.getElementById('bossIntroTitle').innerHTML = '<span>NEXUS</span><span>ADMIRAL</span>';
    const tag = document.getElementById('playerNameTag');
    tag.hidden = false; tag.querySelector('strong').textContent = 'SCALE TEST';
    tag.style.transform = 'translate3d(640px,360px,0) translateX(-50%)';
    RIFT.controllerMenus.hint.hidden = false;
    RIFT.controllerMenus.audioHint.hidden = false;
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const small = await sample();

  await page.evaluate(async () => (await import('/src/ui/UISettings.js')).applyUIScale(1.4));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const large = await sample();

  assert.ok(large.launch.width > small.launch.width * 1.6,
    `Saved UI scale materially changes the compact title (${small.launch.width} → ${large.launch.width})`);
  for (const [name, rect] of Object.entries({ main:large.main, launch:large.launch, footer:large.footer,
    boss:large.boss, bossTitle:large.bossTitle, pilot:large.pilot, controller:large.controller, audio:large.audio })) {
    boundsInside(rect, 1280, 800, name);
  }
  assert.ok(large.main.bottom < large.footer.top,
    `Scaled compact title keeps hero controls clear of route footer: ${JSON.stringify({ main:large.main, footer:large.footer })}`);
  assert.ok(Math.abs(large.boss.width - 1280) < 1 && Math.abs(large.boss.height - 800) < 1,
    'Scaled boss cinematic still covers exactly one viewport');
  assert.ok(large.bossTitle.height > small.bossTitle.height * 1.6, 'Boss cinematic typography honors UI scale');
  assert.ok(large.pilot.width > small.pilot.width * 1.45, 'Standalone pilot tag honors UI scale');
  assert.ok(large.controller.width > small.controller.width * 1.45, 'Controller hint honors UI scale');
  assert.ok(large.audio.width > small.audio.width * 1.45, 'Controller audio hint honors UI scale');

  await page.setViewport({ width:1024, height:768 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const narrow = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect();
      return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
    return { main:rect('.menuMain'), launch:rect('#launchBtn'), footer:rect('.menuFooter') };
  });
  for (const [name, rect] of Object.entries(narrow)) boundsInside(rect, 1024, 768, `narrow ${name}`);
  assert.ok(narrow.main.bottom < narrow.footer.top,
    `140% title stays separated on the narrowest desktop layout: ${JSON.stringify(narrow)}`);

  console.log('PASS: compact title and standalone overlays scale safely at 1280×800.');
} finally {
  await browser.close();
}
