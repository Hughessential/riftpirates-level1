import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { PLAYER_SHIPS } from '../src/render/PlayerFleet.js';
import { UPGRADES } from '../src/systems/UpgradeSystem.js';

const out = fileURLToPath(new URL('../shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const errors = [];
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT?.testing && !document.getElementById('launchBtn').disabled,
    { timeout: 120000 });
  const beforeSave = await page.evaluate(() => JSON.stringify(window.RIFT.save.data));
  await page.evaluate(() => {
    const g = window.RIFT;
    window.__labStep = g.update.bind(g);
    window.__labRender = g.renderFrame.bind(g);
    g.update = () => {}; g.renderFrame = () => {};
  });
  await page.click('#testingGroundsBtn');
  const boot = await page.evaluate(() => {
    const g = window.RIFT;
    return { active: g.testing.active, god: g.testing.settings.godMode,
      scene: g.testing.sceneId, panel: g.testing.panelOpen, targets: g.targets.filter(t => t.alive).length };
  });
  assert.deepEqual(boot, { active: true, god: true, scene: 'sandbox', panel: true, targets: 3 });
  for (const [width, height] of [[1440, 900], [1280, 800]]) {
    await page.setViewport({ width, height });
    assert.equal(await page.$$eval('#testingGroundsPanel, #labFly, #labExit', elements => elements.every(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0
        && rect.right <= innerWidth && rect.bottom <= innerHeight;
    })), true, 'Console and exit controls fit the desktop viewport');
  }
  await page.setViewport({ width: 1440, height: 900 });
  await page.click('#labTab-augments');
  await page.type('#labAugmentSearch', 'prism');
  assert.deepEqual(await page.$$eval('.labAugment:not([hidden])', rows => rows.map(row => row.dataset.augment)), ['prismLance']);
  await page.click('[data-augment="prismLance"] [data-rank-step="1"]');
  assert.equal(await page.evaluate(() => window.RIFT.upgrades.rank('prismLance')), 1, 'Augment plus control installs a real weapon');
  await page.select('#labAugmentCategory', 'SURVIVAL');
  assert.equal(await page.$$eval('.labAugment:not([hidden])', rows => rows.length), 0, 'Search and category filters compose');
  await page.click('#labAugmentSearch', { count: 3 });
  await page.keyboard.press('Backspace');
  assert.equal(await page.$eval('#labAugmentSearch', input => input.value), '', 'Search supports native keyboard editing');
  assert.ok(await page.$$eval('.labAugment:not([hidden])', rows => rows.length) > 0);
  await page.select('#labAugmentCategory', 'ALL');
  await page.click('#labTab-pilot');
  await page.keyboard.press('F2');
  assert.equal(await page.evaluate(() => window.RIFT.testing.panelOpen), false, 'F2 closes the lab console');
  await page.keyboard.press('F2');
  assert.equal(await page.evaluate(() => window.RIFT.testing.panelOpen), true, 'F2 reopens the same test session');

  const protection = await page.evaluate(() => {
    const g = window.RIFT, p = g.player, lab = g.testing;
    lab.setPanelOpen(false); p.invuln = 0;
    const before = [p.health, p.shield];
    const protectedHit = p.takeDamage(25, 'LAB GOD CHECK');
    const after = [p.health, p.shield];
    lab.setSetting('godMode', false); p.invuln = 0;
    const normalHit = p.takeDamage(25, 'LAB MORTAL CHECK');
    const vulnerable = p.shield < after[1] || p.health < after[0];
    lab.setSetting('godMode', true); lab.restorePlayer();
    lab.breakShield();
    const broken = p.shield === 0 && p.shieldRecoveryRemaining === 14;
    lab.restorePlayer();
    return { protectedHit, before, after, normalHit, vulnerable, broken };
  });
  assert.equal(protection.protectedHit, false);
  assert.deepEqual(protection.after, protection.before);
  assert.equal(protection.normalHit, true); assert.equal(protection.vulnerable, true);
  assert.equal(protection.broken, true, 'Deliberate shield test bypasses god mode');

  const movement = await page.evaluate(async () => {
    const { Input } = await import('/src/core/Input.js');
    const g = window.RIFT, p = g.player;
    g.testing.setSetting('infiniteBoost', true); g.testing.setSetting('unlimitedRolls', true);
    p.boost = 0; p.rollCd = 20;
    Input._keys.ShiftLeft = true;
    for (let i = 0; i < 120; i++) window.__labStep(1 / 60);
    Input.reset();
    return { boost: p.boost, capacity: p.stats.boostCapacity, rollCd: p.rollCd, alive: p.alive };
  });
  assert.ok(movement.boost > movement.capacity * .9, 'Infinite boost stays usable under sustained boost');
  assert.ok(movement.rollCd <= 0, 'Unlimited rolls clear the cooldown');
  assert.equal(movement.alive, true);

  const ships = await page.evaluate((ids) => ids.map(id => {
    const g = window.RIFT; g.testing.setShip(id);
    return { id: g.player.shipId, damage: g.player.stats.damage, radius: g.player.radius };
  }), PLAYER_SHIPS.map(s => s.id));
  assert.deepEqual(ships.map(s => s.id), PLAYER_SHIPS.map(s => s.id));
  assert.equal(new Set(ships.map(s => s.damage)).size, 1);
  assert.equal(new Set(ships.map(s => s.radius)).size, 1, 'Every cosmetic ship keeps identical combat rules');

  const rebuild = await page.evaluate(() => {
    const g = window.RIFT, lab = g.testing;
    lab.applyPreset('empty'); lab.setXPLevel(6);
    const base = { damage: g.player.stats.damage, maxHealth: g.player.stats.maxHealth, rate: g.player.stats.fireRate };
    lab.setAugmentRank('hotshot', 3); lab.setAugmentRank('hullBoost', 2); lab.setAugmentRank('rapidFire', 3);
    const upgraded = { damage: g.player.stats.damage, hull: g.player.stats.maxHealth, rate: g.player.stats.fireRate };
    lab.setAugmentRank('hotshot', 0); lab.setAugmentRank('hullBoost', 1); lab.setAugmentRank('rapidFire', 0);
    const reduced = { damage: g.player.stats.damage, maxHealth: g.player.stats.maxHealth, rate: g.player.stats.fireRate, level: g.xp.level };
    lab.applyPreset('all');
    const all = { ranks: { ...g.upgrades.ranks }, finite: Object.values(g.player.stats).filter(v => typeof v === 'number').every(Number.isFinite) };
    lab.applyPreset('empty');
    return { base, upgraded, reduced, all, cleared: Object.values(g.upgrades.ranks).every(r => r === 0) };
  });
  assert.ok(rebuild.upgraded.damage > rebuild.base.damage && rebuild.upgraded.rate > rebuild.base.rate);
  assert.equal(rebuild.upgraded.hull, rebuild.base.maxHealth + 120);
  assert.ok(Math.abs(rebuild.reduced.damage - rebuild.base.damage) < 1e-8);
  assert.equal(rebuild.reduced.maxHealth, rebuild.base.maxHealth + 60);
  assert.equal(rebuild.reduced.rate, rebuild.base.rate); assert.equal(rebuild.reduced.level, 6);
  assert.deepEqual(Object.keys(rebuild.all.ranks).sort(), Object.keys(UPGRADES).sort());
  assert.ok(Object.values(rebuild.all.ranks).every(r => r === 1));
  assert.equal(rebuild.all.finite, true); assert.equal(rebuild.cleared, true);

  const firing = await page.evaluate(async () => {
    const { Input } = await import('/src/core/Input.js');
    const g = window.RIFT, lab = g.testing;
    lab.clearArena(); lab.spawnDummies();
    const t = g.targets.find(t => t.alive && t.targetable && Math.abs(t.pos.x) < 1) || g.targets.find(t => t.alive);
    t.syncPos(); g.player.x = t.pos.x; g.player.y = t.pos.y;
    const before = lab.snapshot().dummyDamage;
    lab.setSetting('autoFire', true);
    for (let i = 0; i < 120; i++) window.__labStep(1 / 60);
    const after = lab.snapshot().dummyDamage;
    const shots = g.weapon.shots;
    lab.setAugmentRank('nexusBreaker', 2);
    Input._keys.KeyF = true;
    g.weapon.update(1 / 60, g);
    const aimed = { locked: g.player.reticleLock, damage: g.projectiles.player.find(b => b.active)?.damage,
      base: g.player.stats.damage, weakPointMultiplier: g.player.stats.weakPointDamage };
    Input.reset(); lab.setAugmentRank('nexusBreaker', 0);
    lab.setSetting('autoFire', false);
    return { before, after, alive: t.alive, shots, aimed };
  });
  assert.ok(firing.shots > 0 && firing.after > firing.before, 'Autofire weapons actually hit the immortal target dummies');
  assert.equal(firing.alive, true);
  assert.equal(firing.aimed.locked, true); assert.ok(firing.aimed.weakPointMultiplier > 1);
  assert.equal(firing.aimed.damage, firing.aimed.base, 'Aiming at a dummy must not apply the tower-only weak-point damage multiplier');

  const spawn = await page.evaluate(() => {
    const g = window.RIFT, lab = g.testing;
    lab.clearArena(); lab.spawnEnemy('scout', 2); lab.spawnEnemy('heavy', 1);
    lab.spawnBulletPattern(); lab.spawnScrap();
    const result = { enemies: g.enemies.countAlive(), bullets: g.projectiles.enemy.filter(b => b.active).length,
      scrap: g.scrap.pool.filter(s => s.active).length };
    lab.setSetting('freezeEnemies', true);
    const e = g.enemies.active.find(e => e.alive), before = [e.x, e.y, e.z, e.fireT];
    for (let i = 0; i < 60; i++) window.__labStep(1 / 60);
    result.frozen = before.every((v, i) => v === [e.x, e.y, e.z, e.fireT][i]);
    lab.setSetting('freezeEnemies', false);
    lab.clearArena();
    result.clear = { enemies: g.enemies.countAlive(), bullets: g.projectiles.enemy.filter(b => b.active).length,
      encounter: !!g.encounter, hazards: g.hazards.length };
    return result;
  });
  assert.equal(spawn.enemies, 3); assert.ok(spawn.bullets > 0 && spawn.scrap > 0);
  assert.equal(spawn.frozen, true);
  assert.deepEqual(spawn.clear, { enemies: 0, bullets: 0, encounter: false, hazards: 0 });

  const timing = await page.evaluate(() => {
    const g = window.RIFT, lab = g.testing;
    lab.setSetting('timeScale', .25); const start = g.time;
    for (let i = 0; i < 120; i++) window.__labStep(1 / 60);
    const slow = g.time - start;
    lab.setSetting('timeScale', 1); lab.setPanelOpen(true); const time = g.time, x = g.player.x;
    return { slow, time, x };
  });
  assert.ok(Math.abs(timing.slow - .5) < 1e-6, 'Quarter-speed advances simulation at one quarter normal time');
  await page.keyboard.down('d'); await page.keyboard.down('Space');
  const paused = await page.evaluate(() => {
    for (let i = 0; i < 120; i++) window.__labStep(1 / 60);
    return { time: window.RIFT.time, x: window.RIFT.player.x };
  });
  await page.keyboard.up('d'); await page.keyboard.up('Space');
  assert.equal(paused.time, timing.time); assert.equal(paused.x, timing.x, 'Panel input cannot fly or fire the ship');
  await page.evaluate(() => window.RIFT.testing.setPanelOpen(false));

  const visited = [];
  for (const id of ['approach1', 'approach2', 'approach3', 'approach4', 'tower1', 'tower2', 'tower3', 'inhibitor', 'boss']) {
    const scene = await page.evaluate((id) => {
      const g = window.RIFT, lab = g.testing;
      const oldTargets = [...g.targets];
      window.__staleLabTimer = false;
      g.after(.05, () => { window.__staleLabTimer = true; });
      lab.spawnBulletPattern(); lab.loadScene(id); lab.setPanelOpen(false);
      const cleanBullets = g.projectiles.enemy.every(b => !b.active);
      const cleanTargets = !g.targets.some(t => oldTargets.includes(t));
      for (let i = 0; i < 12; i++) window.__labStep(1 / 60);
      return { id: lab.sceneId, cleanBullets, cleanTargets, staleTimer: window.__staleLabTimer,
        combat: g.director.inCombat, encounter: g.encounter?.constructor.name || null,
        active: g.encounter?.state, ship: g.player.shipId, level: g.xp.level };
    }, id);
    assert.equal(scene.id, id); assert.equal(scene.cleanBullets, true); assert.equal(scene.cleanTargets, true);
    assert.equal(scene.staleTimer, false, 'Scene jumps cancel callbacks from the previous encounter');
    assert.equal(scene.combat, true); assert.equal(scene.ship, PLAYER_SHIPS.at(-1).id); assert.equal(scene.level, 6);
    if (id.startsWith('tower') || ['inhibitor', 'boss'].includes(id)) assert.equal(scene.active, 'active');
    visited.push(scene);
  }
  const phases = await page.evaluate(() => {
    const g = window.RIFT;
    return [1, 2, 3, 4, 1].map(n => { g.testing.setBossPhase(n); return { phase: g.encounter.phase + 1, alive: g.encounter.hp > 0 }; });
  });
  assert.deepEqual(phases.map(p => p.phase), [1, 2, 3, 4, 1]);
  assert.ok(phases.every(p => p.alive), 'Every boss phase is directly testable, including resetting phase four to phase one');

  const resurrection = await page.evaluate(() => {
    const g = window.RIFT, lab = g.testing;
    lab.setAugmentRank('prismLance', 3); lab.setAugmentRank('hotshot', 2);
    lab.setBossPhase(4); lab.setSetting('godMode', false); lab.setPanelOpen(false);
    const before = { ranks: { ...g.upgrades.ranks }, ship: g.player.shipId, level: g.xp.level,
      scene: lab.sceneId, phase: g.encounter.phase + 1 };
    g.player.invuln = 0;
    g.player.takeDamage(g.player.health + g.player.shield + 1, 'LAB LETHAL DAMAGE');
    const died = !g.player.alive && g.death.active;
    lab.restorePlayer();
    const after = { ranks: { ...g.upgrades.ranks }, ship: g.player.shipId, level: g.xp.level,
      scene: lab.sceneId, phase: g.encounter.phase + 1 };
    const ready = g.player.alive && !g.death.active && g.running && g.director.inCombat
      && g.player.health === g.player.stats.maxHealth && g.player.shield === g.player.stats.shieldMax;
    lab.setSetting('godMode', true);
    return { before, after, died, ready };
  });
  assert.equal(resurrection.died, true, 'God mode off allows the normal death sequence');
  assert.deepEqual(resurrection.after, resurrection.before, 'Restore after death preserves ship, ranks, XP, scene and boss phase');
  assert.equal(resurrection.ready, true, 'Restore cancels death and returns to a playable, fully repaired test fight');

  await page.evaluate(() => {
    const g = window.RIFT;
    g.testing.loadScene('sandbox'); g.testing.spawnDummies(); g.testing.applyPreset('arsenal');
    g.testing.setPanelOpen(true); window.__labRender(1 / 60);
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: `${out}/testing-grounds.png` });
  const saveIsolation = await page.evaluate(() => {
    const g = window.RIFT;
    g.scrap.wallet.credit(123456); g.score.total = 987654;
    g.testing.previewEnding(true);
    const afterResults = JSON.stringify(g.save.data);
    g.testing.exit();
    const afterExit = JSON.stringify(g.save.data);
    g.startRun(); g.player.invuln = 0; g.player.blocksLeft = 0;
    const shield = g.player.shield;
    const hit = g.player.takeDamage(5, 'NORMAL RUN AFTER LAB');
    return { afterResults, afterExit, active: g.testing.active, hit, normalDamage: g.player.shield < shield,
      ranks: Object.values(g.upgrades.ranks).filter(Boolean).length };
  });
  assert.equal(saveIsolation.afterResults, beforeSave, 'Testing scores, scrap, ship choices, and clears never modify the saved game');
  assert.equal(saveIsolation.afterExit, beforeSave);
  assert.equal(saveIsolation.active, false); assert.equal(saveIsolation.hit, true); assert.equal(saveIsolation.normalDamage, true);
  assert.equal(saveIsolation.ranks, 0, 'Normal runs start with a fresh build');
  assert.deepEqual(errors, [], 'No browser, WebGL, or audio errors');
  console.log('PASS: god mode, six ships, 75 ranks, XP rebuild, autofire/dummy damage, spawning, time controls, panel freeze, nine scenes, all boss phases, death/restore, cleanup and save isolation.');
  console.log('Destinations:', visited.map(s => `${s.id}: ${s.encounter || 'approach'}`).join('; '));
} finally {
  const child = browser.process();
  const timer = setTimeout(() => { browser.disconnect(); child?.kill('SIGTERM'); }, 5000);
  try { await browser.close(); } finally { clearTimeout(timer); }
}
