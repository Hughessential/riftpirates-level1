import { launchRun } from './helpers/start-run.mjs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', error => errors.push(error.message));
  const ready = async () => {
    await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
    await page.evaluate(() => { window.RIFT.renderFrame = () => {}; });
  };
  await page.goto(process.env.RIFT_TEST_URL || 'http://localhost:8000/', { waitUntil: 'domcontentloaded' }); await ready();
  assert.equal(await page.$eval('#optionsDialog', e => e.open), false, 'Title settings start tucked away');
  await page.click('#optionsBtn');
  assert.equal(await page.$eval('#optionsDialog', e => e.open), true);
  assert.equal(await page.$eval('#musicTgl', e => getComputedStyle(e).outlineStyle), 'none',
    'Pointer-opened Options does not draw a keyboard focus box around Music');
  assert.equal(await page.$eval('#masterVolume', e => e.value), '100');
  assert.equal(await page.$eval('#musicVolume', e => e.value), '75');
  assert.equal(await page.$eval('#sfxVolume', e => e.value), '75');
  assert.equal(await page.$eval('#musicVolume', e => e.labels[0].textContent), 'Music volume');
  await page.click('#musicTgl');
  assert.deepEqual(await page.evaluate(async () => {
    const duplicateImport = (await import('/src/core/AudioManager.js?music-off-regression=one')).Audio2;
    duplicateImport.playTitle(0);
    duplicateImport.resume();
    await new Promise(resolve => setTimeout(resolve, 50));
    const title = window.RIFT.audio.music.title;
    return {
      shared: duplicateImport === window.RIFT.audio,
      saved: window.RIFT.save.data.music,
      gain: window.RIFT.audio.musicGain.gain.value,
      paused: title.el.paused,
      pressed: document.getElementById('musicTgl').getAttribute('aria-pressed'),
      mirrored: document.getElementById('musicTgl2').getAttribute('aria-pressed'),
    };
  }), {
    shared: true,
    saved: 0,
    gain: 0,
    paused: true,
    pressed: 'false',
    mirrored: 'false',
  }, 'Clicking Music Off silences the title and later title/resume requests cannot bypass it');
  await page.click('#musicTgl');
  await page.waitForFunction(() => !window.RIFT.audio.music.title.el.paused);
  await page.$eval('#masterVolume', slider => {
    slider.value = '50';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.deepEqual(await page.evaluate(() => ({
    saved: window.RIFT.save.data.masterVolume,
    gain: Number(window.RIFT.audio.outputGain.gain.value.toFixed(6)),
    mirrored: document.getElementById('masterVolume2').value,
  })), { saved: .5, gain: .2375, mirrored: '50' });
  await page.evaluate(() => {
    window.__audioKeysLeaked = [];
    window.addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Space'].includes(event.code)) window.__audioKeysLeaked.push(event.code);
    });
  });
  await page.focus('#musicVolume');
  await page.keyboard.press('Home');
  assert.equal(await page.$eval('#musicVolumeValue', e => e.value), '0%');
  await page.keyboard.press('End'); await page.keyboard.press('ArrowLeft');
  const title = await page.evaluate(() => ({
    level: window.RIFT.save.data.musicVolume, gain: Number(window.RIFT.audio.musicGain.gain.value.toFixed(6)),
    mirrored: document.getElementById('musicVolume2').value,
    valueText: document.getElementById('musicVolume').getAttribute('aria-valuetext'),
    keys: window.__audioKeysLeaked,
  }));
  assert.deepEqual(title, { level: .99, gain: .735075, mirrored: '99', valueText: '99 percent', keys: [] });
  await page.focus('#musicTgl'); await page.keyboard.press('Space');
  assert.equal(await page.$eval('#musicTgl2', e => e.getAttribute('aria-pressed')), 'false');
  assert.equal(await page.evaluate(() => window.RIFT.audio.musicGain.gain.value), 0);
  await page.keyboard.press('Space');
  assert.ok(Math.abs(await page.evaluate(() => window.RIFT.audio.musicGain.gain.value) - .99 ** 2 * .75) < 1e-6);

  // Dragging the fader is a real pointer interaction, not a synthetic setter.
  const rect = await page.$eval('#sfxVolume', e => {
    const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const faderHit = await page.evaluate(rect => document.elementFromPoint(
    rect.x + rect.width * .4, rect.y + rect.height * .5)?.id, rect);
  assert.equal(faderHit, 'sfxVolume', 'Options keeps the SFX fader clickable above the title');
  await page.mouse.click(rect.x + rect.width * .4, rect.y + rect.height * .5);
  const sfx = await page.evaluate(() => ({
    saved: window.RIFT.save.data.sfxVolume,
    title: Number(document.getElementById('sfxVolume').value),
    pause: Number(document.getElementById('sfxVolume2').value),
  }));
  assert.ok(sfx.saved > .3 && sfx.saved < .5, `SFX fader pointer update: ${JSON.stringify({rect,sfx})}`); assert.equal(sfx.title, sfx.pause);
  assert.equal(Math.round(sfx.saved * 100), sfx.title);
  const bounds = await page.evaluate(() => {
    const mixer = document.querySelector('#optionsDialog .audioMixer').getBoundingClientRect();
    return { top: mixer.top, bottom: mixer.bottom, left: mixer.left, right: mixer.right };
  });
  assert.ok(bounds.top >= 0 && bounds.left >= 0 && bounds.bottom <= 800 && bounds.right <= 1280,
    `Options mixer fits within the viewport: ${JSON.stringify(bounds)}`);
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#optionsDialog', e => e.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'optionsBtn', 'Escape restores focus to Options');

  await launchRun(page); await page.click('#pauseBtn');
  const paused = await page.evaluate(() => ({ time: window.RIFT.runTime, owner: window.RIFT.audio.musicOwner }));
  await page.focus('#musicVolume2'); await page.keyboard.press('ArrowLeft');
  await page.focus('#sfxTgl2'); await page.keyboard.press('Space');
  await new Promise(resolve => setTimeout(resolve, 150));
  const updated = await page.evaluate(() => {
    const g = window.RIFT, r = document.querySelector('.pauseConsole').getBoundingClientRect();
    return { paused: g.paused, time: g.runTime, owner: g.audio.musicOwner,
      level: g.save.data.musicVolume, sfx: g.save.data.sfx, gain: g.audio.sfxGain.gain.value,
      top: r.top, bottom: r.bottom, hiddenTitleLevel: document.getElementById('musicVolume').value };
  });
  assert.equal(updated.paused, true); assert.equal(updated.time, paused.time); assert.equal(updated.owner, paused.owner);
  assert.equal(updated.level, .98); assert.equal(updated.hiddenTitleLevel, '98');
  assert.equal(updated.sfx, 0); assert.equal(updated.gain, 0);
  assert.ok(updated.top >= 0 && updated.bottom <= 800, 'Pause mixer stays inside the viewport');
  await page.focus('#musicVolume2'); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.RIFT.paused), false, 'Escape remains available while adjusting audio');

  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  assert.equal(await page.$eval('#masterVolume', e => e.value), '50');
  assert.equal(await page.$eval('#musicVolume', e => e.value), '98');
  assert.equal(await page.$eval('#sfxVolume', e => Number(e.value)), sfx.title);
  assert.equal(await page.$eval('#sfxTgl', e => e.getAttribute('aria-pressed')), 'false');
  await page.click('#optionsBtn');
  await page.click('#sfxTgl');
  assert.ok(Math.abs(await page.evaluate(() => window.RIFT.audio.sfxGain.gain.value) - sfx.saved ** 2) < 1e-6,
    'Unmute restores the perceptually scaled saved level after reload');
  assert.deepEqual(errors, []);
  console.log('PASS: native keyboard and pointer volume controls, mirrored percentages, no gameplay key leakage, independent mute, reload persistence, pause timing and menu bounds.');
} finally { await browser.close(); }
