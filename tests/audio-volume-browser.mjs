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
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded' }); await ready();
  assert.equal(await page.$eval('#musicVolume', e => e.value), '65');
  assert.equal(await page.$eval('#sfxVolume', e => e.value), '85');
  assert.equal(await page.$eval('#musicVolume', e => e.labels[0].textContent), 'Music volume');
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
  assert.deepEqual(title, { level: .99, gain: .99, mirrored: '99', valueText: '99 percent', keys: [] });
  await page.focus('#musicTgl'); await page.keyboard.press('Space');
  assert.equal(await page.$eval('#musicTgl2', e => e.getAttribute('aria-pressed')), 'false');
  assert.equal(await page.evaluate(() => window.RIFT.audio.musicGain.gain.value), 0);
  await page.keyboard.press('Space');
  assert.ok(Math.abs(await page.evaluate(() => window.RIFT.audio.musicGain.gain.value) - .99) < 1e-6);

  // Dragging the fader is a real pointer interaction, not a synthetic setter.
  const rect = await page.$eval('#sfxVolume', e => {
    const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.mouse.click(rect.x + rect.width * .4, rect.y + rect.height * .5);
  const sfx = await page.evaluate(() => ({
    saved: window.RIFT.save.data.sfxVolume,
    title: Number(document.getElementById('sfxVolume').value),
    pause: Number(document.getElementById('sfxVolume2').value),
  }));
  assert.ok(sfx.saved > .3 && sfx.saved < .5); assert.equal(sfx.title, sfx.pause);
  assert.equal(Math.round(sfx.saved * 100), sfx.title);
  const bounds = await page.evaluate(() => {
    const mixer = document.querySelector('.menuAudio').getBoundingClientRect();
    return { bottom: mixer.bottom, footer: document.querySelector('.menuFooter').getBoundingClientRect().top, right: mixer.right };
  });
  assert.ok(bounds.bottom < bounds.footer && bounds.right <= 1280, 'Title mixer fits above the route footer');

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
  assert.equal(await page.$eval('#musicVolume', e => e.value), '98');
  assert.equal(await page.$eval('#sfxVolume', e => Number(e.value)), sfx.title);
  assert.equal(await page.$eval('#sfxTgl', e => e.getAttribute('aria-pressed')), 'false');
  await page.click('#sfxTgl');
  assert.ok(Math.abs(await page.evaluate(() => window.RIFT.audio.sfxGain.gain.value) - sfx.saved) < 1e-6, 'Unmute restores the saved level after reload');
  assert.deepEqual(errors, []);
  console.log('PASS: native keyboard and pointer volume controls, mirrored percentages, no gameplay key leakage, independent mute, reload persistence, pause timing and menu bounds.');
} finally { await browser.close(); }
