import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});

const errors = [];
const ready = page => page.waitForFunction(
  () => window.RIFT && !document.getElementById('launchBtn').disabled,
  { timeout: 120000 },
);

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.RIFT_TEST_URL || 'http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready(page);

  const fresh = await page.evaluate(() => ({
    music: RIFT.save.data.musicVolume,
    sfx: RIFT.save.data.sfxVolume,
    uiScale: RIFT.save.data.uiScale,
    tutorialComplete: RIFT.save.data.tutorialComplete,
    titleScale: document.getElementById('uiScale').value,
    pauseScale: document.getElementById('uiScale2').value,
    rootScale: getComputedStyle(document.documentElement).getPropertyValue('--ui-user-scale').trim(),
    datasetScale: document.documentElement.dataset.uiScale,
    min: document.getElementById('uiScale').min,
    max: document.getElementById('uiScale').max,
    step: document.getElementById('uiScale').step,
  }));
  assert.deepEqual(fresh, {
    music: .75, sfx: .75, uiScale: 1.1, tutorialComplete: false,
    titleScale: '110', pauseScale: '110', rootScale: '1.1', datasetScale: '1.1',
    min: '80', max: '140', step: '5',
  }, 'Fresh players receive 75% audio and the 110% saved UI-scale default');
  const entry = await page.evaluate(() => {
    const button = document.getElementById('optionsBtn'), stats = document.getElementById('titleStats');
    return {
      belowStats: button.getBoundingClientRect().top >= stats.getBoundingClientRect().bottom,
      dialogOpen: document.getElementById('optionsDialog').open,
      titleHasSliders: !!document.querySelector('#titleScreen input[type="range"]'),
    };
  });
  assert.deepEqual(entry, { belowStats:true, dialogOpen:false, titleHasSliders:false },
    'Options sits beneath the title stats and keeps settings out of the title layout');

  // Every supported desktop shape keeps the title essentials inside the CSS
  // viewport. This catches double-scaling and external-monitor distortion.
  for (const [width, height] of [[1280, 800], [1920, 1080], [2560, 1440], [3840, 2160], [3440, 1440]]) {
    await page.setViewport({ width, height });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await page.evaluate(() => {
      const bounds = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        viewport: [innerWidth, innerHeight],
        canvas: bounds('#gameCanvas'),
        masthead: bounds('.menuMasthead'),
        main: bounds('.menuMain'),
        launch: bounds('#launchBtn'),
        footer: bounds('.menuFooter'),
      };
    });
    assert.deepEqual(layout.viewport, [width, height]);
    for (const [name, rect] of Object.entries(layout).filter(([name]) => name !== 'viewport')) {
      assert.ok(rect.width > 0 && rect.height > 0, `${name} renders at ${width}×${height}`);
      assert.ok(rect.left >= -1 && rect.right <= width + 1, `${name} stays horizontally visible at ${width}×${height}`);
      assert.ok(rect.top >= -1 && rect.bottom <= height + 1, `${name} stays vertically visible at ${width}×${height}`);
    }
  }

  await page.setViewport({ width: 1920, height: 1080 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const canvasBefore = await page.$eval('#gameCanvas', element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
  await page.focus('#optionsBtn');
  await page.keyboard.press('Enter');
  assert.equal(await page.$eval('#optionsDialog', el => el.open), true, 'Keyboard opens Options');
  await page.focus('#uiScale');
  await page.keyboard.press('End');
  const scaled = await page.evaluate(() => ({
    saved: RIFT.save.data.uiScale,
    root: getComputedStyle(document.documentElement).getPropertyValue('--ui-user-scale').trim(),
    title: document.getElementById('uiScale').value,
    pause: document.getElementById('uiScale2').value,
    titleOutput: document.getElementById('uiScaleValue').value,
    pauseOutput: document.getElementById('uiScale2Value').value,
    canvas: (() => { const r = document.getElementById('gameCanvas').getBoundingClientRect(); return { left:r.left, top:r.top, width:r.width, height:r.height }; })(),
    persisted: JSON.parse(localStorage.getItem('riftpirates-level1-v1')).uiScale,
  }));
  assert.deepEqual(scaled, {
    saved: 1.4, root: '1.4', title: '140', pause: '140', titleOutput: '140%', pauseOutput: '140%',
    canvas: canvasBefore, persisted: 1.4,
  }, 'Scale mirrors, persists and never resizes or offsets the WebGL surface');
  // The settings remain usable at the maximum supported scale, including the
  // constrained mobile viewport. Native dialog focus stays inside the panel.
  for (const [width, height] of [[1920,1080], [1280,720], [390,844]]) {
    await page.setViewport({ width, height });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const dialog = await page.$eval('#optionsDialog', el => {
      const r = el.getBoundingClientRect();
      return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height };
    });
    assert.ok(dialog.width > 0 && dialog.height > 0 && dialog.left >= -1 && dialog.top >= -1 && dialog.right <= width + 1 && dialog.bottom <= height + 1,
      `Options fits ${width}×${height} at 140%: ${JSON.stringify(dialog)}`);
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      // Chrome can temporarily move focus to its own chrome at the end of a
      // native modal's tab cycle; the next Tab must return to the modal.
      if (await page.evaluate(() => document.activeElement === document.body)) await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('#optionsDialog')), true,
        'Tab focus stays within Options');
    }
    if (width === 1920) await page.screenshot({ path:'shots/title-options.png' });
  }
  await page.setViewport({ width:1920, height:1080 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#optionsDialog', el => el.open), false, 'Escape closes Options');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'optionsBtn', 'Keyboard focus returns to Options');
  await page.keyboard.press('Space');
  assert.equal(await page.$eval('#optionsDialog', el => el.open), true, 'Space activates the Options button');
  await page.keyboard.press('Escape');
  const enlargedTitle = await page.evaluate(() => {
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { left:r.left, top:r.top, right:r.right, bottom:r.bottom };
    };
    return { main:rect('.menuMain'), footer:rect('.menuFooter'), launch:rect('#launchBtn') };
  });
  for (const [name, rect] of Object.entries(enlargedTitle)) {
    assert.ok(rect.left >= -1 && rect.right <= 1921 && rect.top >= -1 && rect.bottom <= 1081,
      `${name} remains reachable at the maximum 140% UI scale`);
  }
  assert.ok(enlargedTitle.main.bottom < enlargedTitle.footer.top,
    `Maximum title scale keeps hero settings clear of the route footer: ${JSON.stringify(enlargedTitle)}`);

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready(page);
  assert.deepEqual(await page.evaluate(() => [
    RIFT.save.data.uiScale,
    document.getElementById('uiScale').value,
    document.getElementById('uiScale2').value,
  ]), [1.4, '140', '140'], 'Saved UI scale survives reload');

  // Existing audio settings must survive the additive UI/tutorial migration.
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('riftpirates-level1-v1'));
    Object.assign(data, { musicVolume: .37, sfxVolume: .61, scrapBanked: 4321, tutorialComplete: true });
    localStorage.setItem('riftpirates-level1-v1', JSON.stringify(data));
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready(page);
  assert.deepEqual(await page.evaluate(() => ({
    music: RIFT.save.data.musicVolume,
    sfx: RIFT.save.data.sfxVolume,
    scrap: RIFT.save.data.scrapBanked,
    musicSlider: document.getElementById('musicVolume').value,
    sfxSlider: document.getElementById('sfxVolume').value,
  })), { music: .37, sfx: .61, scrap: 4321, musicSlider: '37', sfxSlider: '61' });

  // The replay setting is explicit and saved; it never silently clears loot or audio.
  await page.click('#optionsBtn');
  await page.click('#optionsDialog .tutorialReplayBtn');
  assert.deepEqual(await page.evaluate(() => {
    const disk = JSON.parse(localStorage.getItem('riftpirates-level1-v1'));
    return [RIFT.save.data.tutorialComplete, disk.tutorialComplete, disk.scrapBanked, disk.musicVolume, disk.sfxVolume];
  }), [false, false, 4321, .37, .61]);
  await page.click('#optionsDialog [data-options-close]');
  assert.equal(await page.$eval('#optionsDialog', el => el.open), false, 'Close button dismisses Options');

  // Production title: no visible lab entry and no raw shortcut backdoor.
  const productionLab = await page.evaluate(() => ({
    unlocked: RIFT.testingPanel.unlocked,
    titleHidden: document.getElementById('testingGroundsBtn').classList.contains('hidden'),
    pauseHidden: document.getElementById('testingGroundsPauseBtn').classList.contains('hidden'),
    titleDisplay: getComputedStyle(document.getElementById('testingGroundsBtn')).display,
    pauseDisplay: getComputedStyle(document.getElementById('testingGroundsPauseBtn')).display,
    globeLabel: document.getElementById('labGlobeUnlock').getAttribute('aria-label'),
  }));
  assert.deepEqual(productionLab, {
    unlocked: false, titleHidden: true, pauseHidden: true, titleDisplay: 'none', pauseDisplay: 'none',
    globeLabel: 'Mysterious rift globe',
  });
  await page.keyboard.press('F2');
  await page.keyboard.press('Backquote');
  assert.equal(await page.evaluate(() => RIFT.testing.active || RIFT.testingPanel.dialog.open), false,
    'F2/backquote are inert until the hidden lab is unlocked');

  // The passphrase cannot be captured while a player is typing in an editable field.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'labTypingGuard';
    document.getElementById('titleScreen').append(input);
    document.getElementById('labGlobeUnlock').click();
    input.focus();
  });
  await page.keyboard.type('brimby');
  assert.equal(await page.evaluate(() => RIFT.testingPanel.unlocked), false);
  await page.evaluate(() => document.getElementById('labTypingGuard').remove());

  const saveBeforeUnlock = await page.evaluate(() => localStorage.getItem('riftpirates-level1-v1'));
  await page.evaluate(() => document.getElementById('labGlobeUnlock').click());
  await page.keyboard.type('BrImBy');
  assert.deepEqual(await page.evaluate(() => ({
    unlocked: RIFT.testingPanel.unlocked,
    titleHidden: document.getElementById('testingGroundsBtn').classList.contains('hidden'),
    pauseHidden: document.getElementById('testingGroundsPauseBtn').classList.contains('hidden'),
    save: localStorage.getItem('riftpirates-level1-v1'),
  })), { unlocked: true, titleHidden: false, pauseHidden: false, save: saveBeforeUnlock },
  'Hidden globe + case-insensitive passphrase unlocks only the current session');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready(page);
  assert.equal(await page.evaluate(() => RIFT.testingPanel.unlocked), false, 'Secret unlock is not persisted');

  // Explicit developer URLs retain direct lab access for automated/manual QA.
  const labPage = await browser.newPage();
  await labPage.setViewport({ width: 1440, height: 900 });
  labPage.on('pageerror', error => errors.push(error.message));
  await labPage.goto(new URL('?lab=1', process.env.RIFT_TEST_URL || 'http://localhost:8000/').href,
    { waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready(labPage);
  assert.deepEqual(await labPage.evaluate(() => ({
    unlocked: RIFT.testingPanel.unlocked,
    active: RIFT.testing.active,
    open: RIFT.testingPanel.dialog.open,
    titleHidden: document.getElementById('testingGroundsBtn').classList.contains('hidden'),
  })), { unlocked: true, active: true, open: true, titleHidden: false });
  await labPage.keyboard.press('F2');
  assert.equal(await labPage.evaluate(() => RIFT.testingPanel.dialog.open), false);
  await labPage.keyboard.press('F2');
  assert.equal(await labPage.evaluate(() => RIFT.testingPanel.dialog.open), true);
  await labPage.close();

  assert.deepEqual(errors, []);
  console.log('PASS: 110% persisted UI scale, viewport/canvas safety, 75% fresh audio, exact legacy audio, replay setting, production lab secrecy, brimby unlock and ?lab=1 QA access.');
} finally {
  await browser.close();
}
