import { launchRun } from './helpers/start-run.mjs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
try {
  for (const mode of ['missing', 'transient']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    const errors = [], requests = new Map();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = request.url();
      if (!url.includes('/voxels/') || !url.endsWith('.vox')) return request.continue();
      const count = (requests.get(url) || 0) + 1;
      requests.set(url, count);
      if (mode === 'missing' || count === 1) {
        return request.respond({ status: mode === 'missing' ? 404 : 503, body: 'Simulated asset failure' });
      }
      return request.continue();
    });
    await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
    assert.equal(requests.size, 8, 'All seven scenery/enemy models and the player fleet are attempted');
    assert.ok([...requests.values()].every(count => count === (mode === 'missing' ? 1 : 2)), 'Retry only transient failures');
    const loaded = await page.evaluate(() => {
      const ids = new Set();
      window.RIFT.scene.traverse(object => { if (object.userData.assetId) ids.add(object.userData.assetId); });
      return ids.size;
    });
    assert.equal(loaded, mode === 'missing' ? 0 : 7, 'Fallback or full authored models match the network outcome');
    await launchRun(page);
    assert.equal(await page.evaluate(() => window.RIFT.running), true, 'Asset failure cannot leave Launch locked');
    assert.deepEqual(errors, [], 'No startup/gameplay exceptions after asset failure');
    console.log(`PASS: ${mode} voxel requests still reach a playable game`);
    await page.close();
  }
} finally { await browser.close(); }
