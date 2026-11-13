/** Real rendered escalation and bounded lifecycle checks. Capture pilot is immortal
 * only to inspect all stages without removing enemies; mortal pilots remain in
 * final-escape.mjs and use actual steering, firing, collisions and normal stats. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

mkdirSync('shots', { recursive: true });
const errors = [];
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 240000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => {
    // Fixed test seed makes repeated pressure/capture checks comparable.
    let seed = 301326;
    Math.random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        if (protocols === 'vite-hmr') this.addEventListener('message', event => {
          const type = JSON.parse(event.data).type;
          if (type === 'update' || type === 'full-reload') event.stopImmediatePropagation();
        });
      }
    };
  });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await page.click('#testingGroundsBtn');
  await page.evaluate(async () => {
    const g = window.RIFT, lab = g.testing;
    window.carnageStep = g.update.bind(g); window.carnageRender = g.renderFrame.bind(g);
    g.update = () => {}; g.renderFrame = () => {};
    window.carnageInput = (await import('/src/core/Input.js')).Input;
    window.carnageSave = JSON.stringify(g.save.data);
    lab.applyPreset('empty'); lab.setXPLevel(8);
    const build = ['rapidFire', 'twinFangs', 'hotshot', 'prismLance', 'seekerSwarm',
      'armorPlating', 'hullBoost', 'shieldRecharge', 'vectorThrusters', 'afterburner',
      'reactorRecovery', 'repairSwarm', 'timeDilation'];
    for (const id of build) lab.setAugmentRank(id, g.upgrades.rank(id) + 1);
    lab.setSetting('infiniteBoost', false); lab.setSetting('godMode', true);
    lab.setSetting('autoFire', false); lab.setSetting('freezeEnemies', false);
    lab.loadScene('escape'); lab.setPanelOpen(false);
    window.carnageTarget = { x: 0, y: 2 };
    window.carnageFrames = 0;
    window.carnageOldRead = window.carnageInput.read.bind(window.carnageInput);
    window.carnageInput.read = () => ({
      x: Math.max(-1, Math.min(1, (window.carnageTarget.x - g.player.x) * .55)),
      y: Math.max(-1, Math.min(1, (window.carnageTarget.y - g.player.y) * .65)), boost: true,
    });
    window.carnageWindow = [];
    window.carnageAdvance = until => {
      while (g.escape.elapsed < until && g.escape.active) {
        if (window.carnageFrames++ % 12 === 0) window.carnageTarget = g.escape.nextGate || g.escape.snapshot().rift;
        window.carnageStep(1 / 60);
        g._updateLighting(1 / 60); // Normally driven by the rendered RAF frame.
        const active = g.enemies.active.filter(e => e.active && e.alive);
        const hostile = g.projectiles.enemy.filter(b => b.active);
        window.carnageWindow.push({ time: g.escape.elapsed, enemies: active.length, shots: hostile.length,
          explosions: g.escape.carnage.snapshot().totalExplosions,
          debris: g.escape.carnage.snapshot().debrisCount,
          blasts: g.escape.carnage.snapshot().blastCount });
        while (window.carnageWindow.length && window.carnageWindow[0].time < g.escape.elapsed - 6) window.carnageWindow.shift();
        if (!active.every(e => e.target?.alive && e.target.targetable && Number.isFinite(e.x + e.y + e.z))) throw Error('Invalid swarm target');
        if (!hostile.every(b => Number.isFinite(b.x + b.y + b.z + b.damage))) throw Error('Invalid hostile projectile');
        if (hostile.length > 512 || active.length > 56) throw Error('Combat budget exceeded');
      }
    };
  });

  const stages = [];
  for (const [name, time] of [['early', 18], ['middle', 67], ['late', 115]]) {
    const stage = await page.evaluate(({ name, time }) => {
      const g = window.RIFT; window.carnageAdvance(time);
      const snap = g.escape.snapshot(), windowStats = window.carnageWindow;
      const average = key => windowStats.reduce((sum, r) => sum + r[key], 0) / windowStats.length;
      const peak = key => Math.max(...windowStats.map(r => r[key]));
      const first = windowStats[0], last = windowStats.at(-1);
      const explosionsPerSecond = (last.explosions - first.explosions) / Math.max(.1, last.time - first.time);
      const cameraBefore = g.camera.position.toArray();
      const autoReset = g.renderer.info.autoReset;
      g.renderer.info.autoReset = false; g.renderer.info.reset();
      window.carnageRender(1 / 60);
      const drawCalls = g.renderer.info.render.calls;
      g.renderer.info.autoReset = autoReset;
      return { name, elapsed: snap.elapsed, progress: snap.progress, phase: snap.phase,
        armada: snap.armada, carnage: snap.carnage, peakEnemies: peak('enemies'),
        averageEnemies: average('enemies'), peakHostileShots: peak('shots'),
        averageHostileShots: average('shots'), peakDebris: peak('debris'), peakBlasts: peak('blasts'),
        explosionsPerSecond, drawCalls,
        cameraFinite: cameraBefore.every(Number.isFinite), portalVisible: snap.rift.visible,
        hudVisible: !document.getElementById('hud').classList.contains('hidden') };
    }, { name, time });
    assert.ok(stage.cameraFinite && stage.hudVisible);
    assert.ok(stage.armada && stage.carnage, 'Escape exposes actual subsystem telemetry');
    assert.ok(stage.peakEnemies <= 56 && stage.peakHostileShots <= 512);
    assert.ok(stage.carnage.debrisCount <= stage.carnage.budgets.debris);
    assert.ok(stage.carnage.blastCount <= stage.carnage.budgets.blasts);
    assert.ok(stage.carnage.fleetCount <= stage.carnage.budgets.backgroundFleet);
    assert.ok(stage.carnage.capitalCount <= stage.carnage.budgets.capitalShips);
    assert.ok(stage.peakBlasts > 0 && stage.explosionsPerSecond > 0, 'Every phase includes actual destruction');
    await page.screenshot({ path: `shots/escape-${name}.png` });
    stages.push(stage);
    console.log(`${name}: ${stage.peakEnemies} enemies, ${stage.peakHostileShots} hostile bolts, ${stage.explosionsPerSecond.toFixed(2)} blasts/sec, ${stage.peakDebris} debris pieces`);
    if (name === 'middle') {
      const pause = await page.evaluate(() => {
        const g = window.RIFT;
        g.togglePause();
        const before = g.escape.snapshot();
        const matrices = () => {
          const root = g.escape.carnage.root;
          const rows = [];
          root?.traverse(o => { rows.push([...o.position.toArray(), ...o.rotation.toArray().slice(0, 3)]);
            if (o.isInstancedMesh) rows.push(Array.from(o.instanceMatrix.array)); });
          return JSON.stringify(rows);
        };
        const geometryBefore = matrices();
        for (let i = 0; i < 120; i++) window.carnageStep(1 / 60);
        window.carnageRender(1 / 60);
        const after = g.escape.snapshot();
        const geometryAfter = matrices();
        g.togglePause();
        return { before, after, geometryBefore, geometryAfter };
      });
      assert.deepEqual(pause.after, pause.before, 'Pause freezes armada, effects and route clocks');
      assert.equal(pause.geometryAfter, pause.geometryBefore, 'Pause freezes wrecks and blast geometry');
    }
  }
  assert.ok(stages[0].peakEnemies >= 10, 'The opening is already a real swarm');
  assert.ok(stages[1].peakEnemies >= 20 && stages[2].peakEnemies >= 30, 'The later escape grows into massive real hordes');
  assert.ok(stages[2].averageEnemies > stages[0].averageEnemies * 1.8, 'Sustained enemy pressure grows dramatically');
  assert.ok(stages[2].averageHostileShots > stages[0].averageHostileShots, 'Enemy projectile pressure rises');
  assert.ok(stages[2].explosionsPerSecond > stages[0].explosionsPerSecond * 1.5, 'Explosion frequency escalates');
  assert.ok(stages[2].carnage.fleetCount > stages[0].carnage.fleetCount, 'The surrounding fleet gets denser');
  assert.ok(stages[2].peakDebris > stages[0].peakDebris, 'Late collapse fills the world with wreckage');
  assert.equal(stages[2].portalVisible, true, 'Final rift remains visible through catastrophe');

  const fight = await page.evaluate(() => {
    const g = window.RIFT, before = g.stats.kills;
    window.carnageInput._keys.Space = true;
    window.carnageInput._keys.KeyF = true;
    window.carnageAdvance(g.escape.elapsed + 3);
    window.carnageInput._keys.Space = false;
    window.carnageInput._keys.KeyF = false;
    return { kills: g.stats.kills - before, live: g.enemies.countAlive(),
      playerShots: g.projectiles.player.filter(b => b.active).length,
      active: g.escape.active };
  });
  assert.ok(fight.kills > 0 && fight.playerShots > 0, 'The actual13-pick arsenal can destroy the horde with normal fire/lock-on');
  assert.ok(fight.active && fight.live > 0, 'Reinforcements sustain the last stand after kills');

  const cleanup = await page.evaluate(() => {
    const g = window.RIFT;
    window.carnageInput.read = window.carnageOldRead; window.carnageInput.reset();
    const oldArmada = g.escape.armada, oldCarnage = g.escape.carnage;
    const decor = oldCarnage.root;
    const decorativeTargets = g.targets.some(t => {
      let o = t.object3D;
      while (o) { if (o === decor) return true; o = o.parent; }
      return false;
    });
    g.testing.loadScene('sandbox'); g.testing.setPanelOpen(false);
    const sceneLeft = !g.escape.active && !g.scene.getObjectByName('final-escape');
    const dead = !oldArmada.snapshot().active && !oldCarnage.snapshot().active;
    const graphicsDetached = !decor?.parent;
    const activeEnemies = g.enemies.countAlive();
    for (let attempt = 0; attempt < 3; attempt++) {
      g.testing.loadScene('escape');
      g.testing.setPanelOpen(false);
      for (let i = 0; i < 60; i++) window.carnageStep(1 / 60);
      g.testing.loadScene('sandbox');
    }
    g.testing.exit();
    return { sceneLeft, dead, graphicsDetached, decorativeTargets, activeEnemies,
      cleanTitle: !g.escape.active && !g.scene.getObjectByName('final-escape'),
      saveUnchanged: JSON.stringify(g.save.data) === window.carnageSave };
  });
  assert.deepEqual(cleanup, { sceneLeft: true, dead: true, graphicsDetached: true,
    decorativeTargets: false, activeEnemies: 0, cleanTitle: true, saveUnchanged: true },
  'Scene changes/retries remove every escape-owned system without leaking targets or saves');
  assert.deepEqual(errors, []);
  writeFileSync('shots/escape-carnage-report.json', JSON.stringify({
    capturePilot: 'Seeded legal13-pick loadout; godmode enabled only for non-firing full-horde visual stress. Mortal solvability checked separately by final-escape.mjs.',
    stages, fight, cleanup, errors,
  }, null, 2) + '\n');
  console.log('PASS: real early/middle/late horde escalation, visible destruction, fixed budgets, pause, harmless background fleet and complete cleanup.');
} finally {
  const child = browser.process();
  const timer = setTimeout(() => { browser.disconnect(); child?.kill('SIGTERM'); }, 5000);
  try { await browser.close(); } finally { clearTimeout(timer); }
}
