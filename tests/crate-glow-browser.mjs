import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => localStorage.setItem('riftpirates-level1-v1', JSON.stringify({
    pilotName:'CACHE TEST', pilotNameConfirmed:true, tutorialComplete:true, musicVolume:0, sfxVolume:0,
  })));
  await page.goto(process.env.RIFT_TEST_URL || 'http://localhost:8000/', { waitUntil:'domcontentloaded', timeout:120000 });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout:120000 });

  const pooled = await page.evaluate(() => {
    const g = RIFT;
    g.env.clearAll();
    const spawned = Array.from({ length:6 }, (_, index) => g.env.spawnCrate({ x:20, y:12, z:-40-index, sourceId:`visual:${index}` }));
    const active = g.env.crates.filter(crate => crate.active);
    const first = active[0];
    const start = { halo:first.lootHalo.material.opacity, size:first.lootHalo.scale.x };
    g.time += Math.PI / 4.8;
    g.env._paintCrateGlow(first);
    const beat = { halo:first.lootHalo.material.opacity, size:first.lootHalo.scale.x };
    const localized = active.every(crate => crate.lootHalo.parent === crate.g && crate.lootCore.parent === crate.g);
    g.env.clearAll();
    return { pool:g.env.crates.length, created:spawned.filter(Boolean).length, active:active.length,
      sprites:first.g.children.filter(child => child.isSprite).length, localized, start, beat,
      released:g.env.crates.every(crate => !crate.active && !crate.g.visible && !crate.lootHalo.visible && !crate.lootCore.visible) };
  });
  assert.equal(pooled.pool, 5, 'Authored cache pool remains capped');
  assert.equal(pooled.created, 5, 'Sixth spawn reuses no active object and allocates nothing');
  assert.equal(pooled.active, 5);
  assert.equal(pooled.sprites, 2, 'Each cache owns only a localized gold halo and white core');
  assert.equal(pooled.localized, true);
  assert.notEqual(pooled.start.size, pooled.beat.size, 'Live cache glow changes across its beat');
  assert.equal(pooled.released, true, 'Pool release hides both glow sprites');

  await page.emulateMediaFeatures([{ name:'prefers-reduced-motion', value:'reduce' }]);
  const reduced = await page.evaluate(() => {
    const crate = RIFT.env.spawnCrate({ x:20, y:12, z:-40, sourceId:'reduced' });
    return { reduced:crate.lootGlowReduced, halo:crate.lootHalo.material.opacity, core:crate.lootCore.material.opacity };
  });
  assert.equal(reduced.reduced, true);
  assert.ok(reduced.halo >= .58 && reduced.core >= .66, 'Slow fallback stays bright and legible');
  console.log('PASS: cache glow is rhythmic, reduced-motion aware, localized and pool-safe.');
} finally {
  await browser.close();
}
