import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  const result = await page.evaluate(() => {
    const g = window.RIFT;
    const update = g.update.bind(g);
    g.update = () => {};
    g.startRun();
    g.hud.update(.06);
    const observer = new MutationObserver(() => {});
    observer.observe(document.getElementById('hud'), { childList: true, subtree: true, characterData: true });
    for (let i = 0; i < 120; i++) g.hud.update(.06);
    const hudTextMutations = observer.takeRecords().length;
    observer.disconnect();

    const aspect = g.camera.aspect;
    const fullRatio = g.display.pixelRatio;
    g.adaptiveResolution.scale = .65;
    g._resize();
    const reducedRatio = g.renderer.getPixelRatio();
    const cssWidth = g.renderer.domElement.style.width;
    const sameAspect = g.camera.aspect === aspect;
    g.renderFrame(.016);
    const resolution = g.presentation.signalPass.uniforms.resolution.value.toArray();
    g.adaptiveResolution.scale = 1;
    g._resize();

    let disposedMaterials = 0, disposedGeometry = 0;
    g.openNexusRift(g.camera.position.clone());
    for (const object of g.rift.children) {
      object.material.addEventListener('dispose', () => disposedMaterials++);
      if (object.isMesh && !object.isSprite) object.geometry.addEventListener('dispose', () => disposedGeometry++);
    }
    g.closeNexusRift();
    const originalRender = g.presentation.render;
    let backgroundRenders = 0;
    g.presentation.render = () => backgroundRenders++;
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const time = g.time;
    update(.05);
    const frozenTime = g.time === time;
    delete document.hidden;
    g.presentation.render = originalRender;
    g.renderFrame(.016);
    return { hudTextMutations, fullRatio, reducedRatio, cssWidth, sameAspect, resolution,
      passes: g.presentation.composer.passes.length, disposedMaterials, disposedGeometry,
      backgroundRenders, frozenTime };
  });
  assert.equal(result.hudTextMutations, 0, 'Unchanged HUD does not rebuild text nodes');
  assert.equal(result.passes, 4, 'Vignette and signal share one HDR pass');
  assert.equal(result.reducedRatio, result.fullRatio * .65);
  assert.equal(result.cssWidth, '1440px');
  assert.equal(result.sameAspect, true, 'Adaptive resolution never stretches the camera');
  assert.equal(result.resolution[0], 1440 * result.reducedRatio);
  assert.equal(result.disposedMaterials, 3, 'Every temporary portal material is released');
  assert.equal(result.disposedGeometry, 1, 'Only owned portal geometry is released');
  assert.equal(result.backgroundRenders, 0, 'Hidden tabs skip rendering');
  assert.equal(result.frozenTime, true, 'Hidden tabs skip world simulation');
  assert.deepEqual(errors, []);
  console.log('PASS: four compositor passes, zero stable HUD text mutations, scale/aspect, hidden-tab suspension and portal cleanup.');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
