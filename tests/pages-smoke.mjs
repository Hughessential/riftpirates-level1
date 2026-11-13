import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { readdirSync } from 'node:fs';

function runtimeAssets(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return runtimeAssets(new URL(`${entry.name}/`, directory), `${path}/`);
    return /\.(mp3|m4a|wav|vox|ttf)$/.test(path) ? [path.split('/').map(encodeURIComponent).join('/')] : [];
  });
}

const site = new URL(process.env.RIFT_URL || 'http://localhost:8000/riftpirates-level1/');
const base = site.href.endsWith('/') ? site.href : `${site.href}/`;
const errors = [];
const badResponses = [];
const loaded = new Set();
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    const url = response.url();
    if (!url.startsWith(base)) return;
    loaded.add(url);
    if (response.status() >= 400) badResponses.push(`${response.status()} ${url}`);
  });
  const response = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  assert.equal(response.status(), 200, 'Pages must serve the game entry point');
  await page.waitForFunction(() => Boolean(window.RIFT) && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('12px "Rift Pixel"')), true, 'Voxel font loads');
  assert.ok([...loaded].some(url => /\/assets\/index-[^/]+\.js$/.test(url)), 'Built JavaScript loads');
  assert.ok([...loaded].some(url => /\/assets\/index-[^/]+\.css$/.test(url)), 'Built stylesheet loads');
  assert.ok([...loaded].some(url => url.includes('/voxels/player-fleet/spaceships.vox')), 'Player ship fleet loads');
  assert.ok([...loaded].some(url => url.includes('/voxels/') && !url.includes('/player-fleet/')), 'Enemy voxel models load');

  const assets = runtimeAssets(new URL('../assets/', import.meta.url));
  const missing = await page.evaluate(async ({ base, assets }) => {
    const results = await Promise.all(assets.map(async path => {
      try {
        const response = await fetch(new URL(path, base), { method: 'HEAD' });
        return response.ok ? null : `${response.status} ${path}`;
      } catch (error) { return `${path}: ${error.message}`; }
    }));
    return results.filter(Boolean);
  }, { base, assets });
  assert.deepEqual(missing, [], 'Runtime font, audio and fleet files are available');

  await page.click('#launchBtn');
  assert.equal(await page.evaluate(() => window.RIFT.running), true, 'Launch starts the game');
  await page.click('#pauseBtn');
  assert.equal(await page.evaluate(() => window.RIFT.paused), true, 'Pause works');
  await page.click('#resumeBtn');
  assert.equal(await page.evaluate(() => window.RIFT.paused), false, 'Resume works');
  assert.deepEqual(errors, [], 'No browser exceptions');
  assert.deepEqual(badResponses, [], 'No missing runtime requests');
  console.log(`PASS: ${base} boot, assets, launch, pause and resume`);
} finally {
  await browser.close();
}
