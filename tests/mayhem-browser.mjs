import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { UPGRADES } from '../src/systems/UpgradeSystem.js';
import { WEAPON_AUDIO } from '../src/core/AudioManager.js';

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
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT?.augmentEffects && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await page.click('#launchBtn');
  await page.waitForFunction((kinds) => kinds.every((kind) => window.RIFT.audio.buffers[`weapon_${kind}`]?.duration > 0),
    { timeout: 120000 }, Object.keys(WEAPON_AUDIO));
  const audio = await page.evaluate(async (kinds) => {
    const values = [];
    for (const kind of kinds) {
      const file = kind === 'retaliation' ? 'revenge' : kind;
      const data = await (await fetch(`/sfx/mayhem/${file}.wav`)).arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', data);
      values.push({ kind, hash: [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join(''),
        duration: window.RIFT.audio.buffers[`weapon_${kind}`].duration });
    }
    return values;
  }, Object.keys(WEAPON_AUDIO));
  assert.equal(new Set(audio.map((v) => v.hash)).size, audio.length, 'Every gun uses its own real audio sample');
  await page.evaluate(() => {
    const g = window.RIFT;
    window.__mayhemStep = g.update.bind(g);
    window.__mayhemRender = g.renderFrame.bind(g);
    window.__mayhemDamage = g.player.takeDamage;
    g.update = () => {}; g.renderFrame = () => {};
    g.player.takeDamage = () => false;
    g.director.go('TRAVERSAL_1');
    g.player.frozen = false;
  });
  await page.keyboard.down('Space');
  const baseline = await page.evaluate(() => {
    const g = window.RIFT;
    for (let i = 0; i < 60; i++) window.__mayhemStep(1 / 60);
    return g.projectiles.player.filter((b) => b.active).length;
  });
  assert.ok(baseline >= 5, 'Manual primary fire works before augments');
  const build = ['broadsides', 'broadsides', 'twinFangs', 'helixVolley', 'prismLance',
    'scatterNova', 'seekerSwarm', 'voidMortar', 'echoBarrage', 'teslaFork', 'solarBurn', 'gravityWell', 'rapidFire'];
  const capture = await page.evaluate((ids) => {
    const g = window.RIFT;
    for (const id of ids) { g.upgrades.pendingOffers.add(id); if (!g.upgrades.pick(id)) throw new Error(`Cannot pick ${id}`); }
    g.enemies.clear(); g.targets.length = 0;
    for (let i = 0; i < 5; i++) {
      const enemy = g.enemies.spawn(i % 2 ? 'gunship' : 'heavy', (i - 2) * 7, 2 + i % 2 * 3, -45,
        { fx: (i - 2) * 7, fy: 2 + i % 2 * 3, fz: -45 });
      enemy.target.hp = enemy.target.maxHp = 1e7; enemy.fireT = .25 + i * .1;
    }
    for (let i = 0; i < 210; i++) window.__mayhemStep(1 / 60);
    // Add one authored, clearly separated enemy fan into the captured frame.
    for (let i = 0; i < 9; i++) g.projectiles.fireEnemy({ x: (i - 4) * 3.4, y: 4 + Math.cos(i) * 2, z: -21,
      tx: (i - 4) * 4.1, ty: 2, tz: 0, speed: 24, damage: 8, color: '#ff882a', radius: .72 });
    document.getElementById('banner').textContent = '';
    document.getElementById('titleCard').classList.add('hidden');
    g.player.hull.visible = true;
    window.__mayhemRender(1 / 60);
    return { player: g.projectiles.player.filter((b) => b.active).length,
      enemy: g.projectiles.enemy.filter((b) => b.active).length,
      weapons: [...new Set(g.projectiles.player.filter((b) => b.active).map((b) => b.weapon))],
      batches: [g.projectiles.playerCore, g.projectiles.playerGlow, g.projectiles.enemyCore, g.projectiles.enemyGlow].filter((m) => m.isInstancedMesh).length,
      saturation: g.projectiles.saturationCount };
  }, build);
  assert.ok(capture.player > baseline * 3, 'Stacked build visibly multiplies projectile output');
  assert.ok(capture.enemy >= 9 && capture.weapons.length >= 6, 'Both sides fill distinct projectile lanes');
  assert.equal(capture.batches, 4); assert.equal(capture.saturation, 0);
  await page.screenshot({ path: `${out}/mayhem-arsenal.png` });
  console.log('13-pick arsenal:', capture);

  await page.evaluate(() => {
    const g = window.RIFT;
    const target = g.enemies.active.find((e) => e.alive).target;
    target.syncPos();
    g.augmentEffects.onHit({ x: target.pos.x, y: target.pos.y, z: target.pos.z,
      damage: 30, procDepth: 0, splash: 0 }, target, 30);
    g.weapon.echoes.push({ delay: .5, side: 0, bolt: { x: 0, y: 1, z: -2, tx: 0, ty: 1, tz: -80, speed: 100, damage: 10, weapon: 'echo' } });
    window.__mayhemTimers = () => ({ fields: g.augmentEffects.fields.map((f) => f.life),
      burns: [...g.augmentEffects.burns.values()].map((b) => b.life), echoes: g.weapon.echoes.map((e) => e.delay),
      runTime: g.runTime });
  });
  await page.click('#pauseBtn');
  let before = await page.evaluate(() => window.__mayhemTimers());
  await page.evaluate(() => { for (let i = 0; i < 120; i++) window.__mayhemStep(1 / 60); });
  assert.deepEqual(await page.evaluate(() => window.__mayhemTimers()), before, 'Pause freezes effects and delayed weapon volleys');
  await page.click('#resumeBtn');
  await page.evaluate(() => window.RIFT.upgradeScreen.show({ sector: 0, checkpoint: 1 }, '#22d3ee', () => {}));
  before = await page.evaluate(() => window.__mayhemTimers());
  await page.evaluate(() => { for (let i = 0; i < 120; i++) window.__mayhemStep(1 / 60); });
  assert.deepEqual(await page.evaluate(() => window.__mayhemTimers()), before, 'Augment cards freeze effects and delayed volleys');
  await page.waitForFunction(() => [...document.querySelectorAll('.upCard')].every((card) => Number(getComputedStyle(card).opacity) >= .99));
  assert.equal(await page.$$eval('.upCard', (cards) => cards.every((card) => {
    const rect = card.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
      && card.querySelector('.upCategory').textContent.includes('STACKABLE')
      && card.querySelector('.upStackEffect').textContent.length > 0;
  })), true, 'Readable cards show category, next stack and actual stack benefit');
  await page.screenshot({ path: `${out}/mayhem-augments.png` });
  await page.evaluate(() => window.RIFT.upgradeScreen.hide());

  const stress = await page.evaluate((ids) => {
    const g = window.RIFT;
    for (const id of ids) { g.upgrades.pendingOffers.add(id); g.upgrades.pick(id); }
    for (let i = 0; i < 480; i++) window.__mayhemStep(1 / 60);
    window.__mayhemRender(1 / 60);
    return { finite: g.projectiles.player.concat(g.projectiles.enemy).filter((b) => b.active)
      .every((b) => Number.isFinite(b.x + b.y + b.z + b.damage)),
      fields: g.augmentEffects.fields.length, arcs: g.augmentEffects.arcs.length,
      playerCount: g.projectiles.player.length, enemyCount: g.projectiles.enemy.length };
  }, Object.keys(UPGRADES));
  assert.equal(stress.finite, true); assert.ok(stress.fields <= 6 && stress.arcs <= 48);
  assert.equal(stress.playerCount, 1024); assert.equal(stress.enemyCount, 512);
  await page.keyboard.up('Space');
  const clean = await page.evaluate(() => {
    const g = window.RIFT; g.startRun();
    g.player.takeDamage = window.__mayhemDamage;
    return { fields: g.augmentEffects.fields.length, burns: g.augmentEffects.burns.size,
      echoes: g.weapon.echoes.length, ranks: Object.keys(g.upgrades.ranks).length,
      charge: g.player.treasureCharge, projectiles: g.projectiles.player.filter((b) => b.active).length };
  });
  assert.deepEqual(clean, { fields: 0, burns: 0, echoes: 0, ranks: 0, charge: 0, projectiles: 0 }, 'Restart clears the entire augmented build');
  const shield = await page.evaluate(() => {
    const g = window.RIFT, p = g.player;
    p.invuln = 0; p.takeDamage(p.shield, 'SHIELD TEST');
    const atBreak = { shield: p.shield, wait: p.shieldRecoveryRemaining };
    const step = (n) => { for (let i = 0; i < n; i++) p.update(1 / 60, { time: i / 60, hazards: [] }); };
    step(360); p.invuln = 0; p.takeDamage(5, 'HULL DELAYS SHIELD');
    g.hud.update(.06); // pass the deliberate 20Hz DOM-update throttle
    const afterHit = { shield: p.shield, wait: p.shieldRecoveryRemaining,
      hud: document.getElementById('shieldStatus')?.textContent || document.getElementById('shieldRecovery')?.textContent || '' };
    step(780); const beforeRecovery = p.shield;
    step(120); const afterRecovery = p.shield;
    return { atBreak, afterHit, beforeRecovery, afterRecovery };
  });
  assert.equal(shield.atBreak.shield, 0); assert.equal(shield.atBreak.wait, 14);
  assert.equal(shield.afterHit.shield, 0); assert.equal(shield.afterHit.wait, 14);
  assert.equal(shield.beforeRecovery, 0); assert.ok(shield.afterRecovery > 0 && shield.afterRecovery < 8);
  assert.match(shield.afterHit.hud, /14|OFFLINE|REBOOT/i, 'HUD explains the shield vulnerability window');
  assert.deepEqual(errors, [], 'No browser, WebGL shader or audio errors');
  console.log(`PASS: ${audio.length} unique decoded weapon samples; real13pick build, all45 stress, pause/card freeze, restart and shield14-second reset.`, shield);
} finally {
  await browser.close();
}
