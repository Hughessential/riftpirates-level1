import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { launchRun } from './helpers/start-run.mjs';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => localStorage.setItem('riftpirates-level1-v1', JSON.stringify({
    music: 0, sfx: 0, uiScale: .8, pilotName: 'LAYOUT TEST', pilotNameConfirmed: true,
  })));
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await launchRun(page);
  await page.evaluate(() => RIFT.togglePause());

  for (const viewport of [
    { width: 2560, height: 1440 },
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewport(viewport);
    for (const scale of [.8, 1.1, 1.4]) {
      await page.evaluate((value) => {
        RIFT.save.data.uiScale = value;
        document.documentElement.style.setProperty('--ui-user-scale', String(value));
        document.documentElement.dataset.uiScale = String(value);
        dispatchEvent(new CustomEvent('rift-ui-scale', { detail: value }));
      }, scale);
      const layout = await page.evaluate(() => {
        const panel = document.querySelector('.pauseConsole');
        const rect = panel.getBoundingClientRect();
        const controls = [...panel.querySelectorAll('button,input')].filter((element) => getComputedStyle(element).display !== 'none');
        return {
          rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
          clientWidth: panel.clientWidth,
          scrollWidth: panel.scrollWidth,
          clientHeight: panel.clientHeight,
          scrollHeight: panel.scrollHeight,
          overflowX: getComputedStyle(panel).overflowX,
          overflowY: getComputedStyle(panel).overflowY,
          maxHeight: getComputedStyle(panel).maxHeight,
          height: getComputedStyle(panel).height,
          flexShrink: getComputedStyle(panel).flexShrink,
          padding: getComputedStyle(panel).padding,
          screen: (() => { const box = document.getElementById('pauseScreen').getBoundingClientRect(); return { width: box.width, height: box.height }; })(),
          controlsInside: controls.every((control) => {
            const box = control.getBoundingClientRect();
            return box.left >= rect.left - 1 && box.right <= rect.right + 1 && box.top >= rect.top - 1 && box.bottom <= rect.bottom + 1;
          }),
        };
      });
      assert.ok(layout.rect.left >= -1 && layout.rect.right <= viewport.width + 1,
        `${viewport.width}x${viewport.height} @ ${scale}: horizontal bounds ${JSON.stringify(layout)}`);
      assert.ok(layout.rect.top >= -1 && layout.rect.bottom <= viewport.height + 1,
        `${viewport.width}x${viewport.height} @ ${scale}: vertical bounds ${JSON.stringify(layout)}`);
      assert.equal(layout.overflowX, 'visible',
        `${viewport.width}x${viewport.height} @ ${scale}: panel is not a horizontal scroll container ${JSON.stringify(layout)}`);
      assert.equal(layout.overflowY, 'visible',
        `${viewport.width}x${viewport.height} @ ${scale}: panel is not a vertical scroll container ${JSON.stringify(layout)}`);
      assert.equal(layout.controlsInside, true,
        `${viewport.width}x${viewport.height} @ ${scale}: every pause control remains visible`);
    }
  }
  console.log('PASS: pause console stays scrollbar-free and every control remains visible at desktop, fullscreen, laptop and narrow layouts for all UI scales.');
} finally {
  await browser.close();
}
