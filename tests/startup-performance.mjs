import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});

try {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const started = performance.now();
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT?.hangar && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  const readyMs = performance.now() - started;
  const startup = await page.evaluate(() => ({
    rendererDeferred: RIFT.hangar.renderer == null,
    thumbnails: RIFT.hangar.thumbnails.size,
    hangarCanvases: document.querySelectorAll('.hangarCanvas canvas').length,
    imagesReady: [...document.querySelectorAll('.shipOption img,.selectedShipThumb')]
      .every((image) => image.complete && image.naturalWidth > 0),
    realHullPreviews: [...RIFT.hangar.thumbnails.entries()].every(([id, url]) =>
      new URL(url).pathname.endsWith(`/images/ships/${id}.webp`)),
    previewDimensions: [...document.querySelectorAll('.shipOption img,.selectedShipThumb')]
      .every((image) => image.naturalWidth === 560 && image.naturalHeight === 360),
  }));

  assert.equal(startup.rendererDeferred, true, 'The optional hangar WebGL context is deferred');
  assert.equal(startup.thumbnails, 6, 'All six instant ship thumbnails are ready');
  assert.equal(startup.imagesReady, true, 'Title and grid thumbnails are immediately usable');
  assert.equal(startup.realHullPreviews, true, 'Every thumbnail uses its real pre-rendered VOX hull');
  assert.equal(startup.previewDimensions, true, 'Every optimized hull preview decodes at its authored dimensions');
  assert.equal(startup.hangarCanvases, 0, 'Startup does not create the optional hangar canvas');
  // SwiftShader startup varies heavily by host. The structural checks above
  // prevent the removed second WebGL warm-up from returning; this ceiling
  // catches a genuine startup stall without treating software-GPU boot as a
  // product regression.
  assert.ok(readyMs < 8000, `Cold menu startup should stay below 8s in software rendering (measured ${Math.round(readyMs)}ms)`);

  await page.click('#shipSelectBtn');
  assert.equal(await page.$eval('#shipHangarDialog', (dialog) => dialog.open), true, 'Ship picker opens immediately');
  await page.waitForFunction(() => Boolean(RIFT.hangar.renderer), { timeout: 30000 });
  assert.equal(await page.$eval('.hangarCanvas', (host) => host.classList.contains('ready')), true,
    'The full rotating 3D hull replaces the instant preview after opening');
  assert.deepEqual(errors, [], 'No startup errors');
  console.log(`PASS: cold main menu ready in ${Math.round(readyMs)}ms; optional 3D hangar remained lazy.`);
} finally {
  await browser.close();
}
