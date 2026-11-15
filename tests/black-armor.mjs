import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { launchRun } from './helpers/start-run.mjs';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 120000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'getGamepads', { value: () => [] });
    localStorage.setItem('riftpirates-level1-v1', JSON.stringify({
      pilotName: 'ARMOR TEST', pilotNameConfirmed: true, tutorialComplete: true, music: 0, sfx: 0,
    }));
  });
  await page.goto(process.env.RIFT_TEST_URL || 'http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await launchRun(page);
  await page.evaluate(async () => {
    const { STATE } = await import('/src/core/GameState.js');
    const g = window.RIFT;
    g.director.go(STATE.TRAVERSAL_1);
    g.player.frozen = false;
    window.__armorStep = g.update.bind(g);
    g.update = () => {};
  });

  await page.keyboard.press('1');
  await page.evaluate(() => { __armorStep(1 / 60); RIFT.hud.update(.06); });
  const activated = await page.evaluate(() => {
    const p = RIFT.player;
    return {
      active: p.blackArmorActive,
      time: p.blackArmorTime,
      duration: p.blackArmorDuration,
      cooldownDuration: p.blackArmorCooldownDuration,
      root: p.blackArmorEffect.root.visible,
      coated: p.blackArmorEffect.originalMaterials.length,
      aura: p.blackArmorEffect.aura.material.opacity,
      arcs: p.blackArmorEffect.arcs.flatMap(arc => arc.meshes).filter(mesh => mesh.visible).length,
      hud: document.getElementById('blackArmorHud').classList.contains('active'),
      hudText: document.querySelector('#blackArmorHud span').textContent,
    };
  });
  assert.equal(activated.active, true, '1 activates Black Armor on the next gameplay frame');
  assert.equal(activated.duration, 5, 'Production duration is exactly five seconds');
  assert.equal(activated.cooldownDuration, 20, 'Production cooldown is 20 seconds after expiration');
  assert.ok(activated.time < 5 && activated.time > 4.9);
  assert.ok(activated.root && activated.coated > 0 && activated.aura > 0 && activated.arcs > 0,
    `The coating, aura and pooled lightning activate together: ${JSON.stringify(activated)}`);
  assert.ok(activated.hud && activated.hudText.includes('INVULNERABLE'));
  if (process.env.ARMOR_SCREENSHOT) await page.screenshot({ path: process.env.ARMOR_SCREENSHOT });

  const immunity = await page.evaluate(() => {
    const p = RIFT.player;
    const before = { health: p.health, shield: p.shield, time: p.blackArmorTime };
    const results = [
      p.takeDamage(30, 'ENEMY PROJECTILE'), p.takeDamage(30, 'LASER GATE'),
      p.takeDamage(30, 'COLLISION'), p.takeDamage(30, 'EXPLOSION'),
      p.takeDamage(30, 'DAMAGE OVER TIME'), p.takeDamage(30, 'BOSS ATTACK'),
    ];
    return { before, health: p.health, shield: p.shield, time: p.blackArmorTime, results };
  });
  assert.deepEqual(immunity.results, Array(6).fill(false), 'Every damage route is rejected by the authoritative player gate');
  assert.equal(immunity.health, immunity.before.health);
  assert.equal(immunity.shield, immunity.before.shield);

  await page.keyboard.press('1');
  await page.evaluate(() => __armorStep(0.5));
  const repeated = await page.evaluate(() => RIFT.player.blackArmorTime);
  assert.ok(repeated < immunity.before.time - 0.45, 'A repeated 1 press cannot restart the active timer');

  const movement = await page.evaluate(() => {
    const p = RIFT.player;
    const beforeX = p.x;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }));
    __armorStep(0.1);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', bubbles: true }));
    return { beforeX, afterX: p.x, active: p.blackArmorActive };
  });
  assert.ok(movement.afterX > movement.beforeX && movement.active, 'Normal movement continues during the transformation');

  await page.keyboard.down('Space');
  await page.evaluate(() => __armorStep(.2));
  await page.keyboard.up('Space');
  assert.ok(await page.evaluate(() => RIFT.projectiles.player.some(bolt => bolt.active)),
    'Outgoing player fire continues during Black Armor');
  await page.keyboard.down('Shift');
  await page.evaluate(() => __armorStep(.05));
  assert.equal(await page.evaluate(() => RIFT.player.boosting && RIFT.player.blackArmorActive), true,
    'Boost remains available during Black Armor');
  await page.keyboard.up('Shift');
  await page.keyboard.press('q');
  await page.evaluate(() => __armorStep(1 / 60));
  assert.equal(await page.evaluate(() => RIFT.player.rollT > 0 && RIFT.player.blackArmorActive), true,
    'Barrel rolls remain available during Black Armor');

  const remaining = await page.evaluate(() => RIFT.player.blackArmorTime);
  await page.evaluate(remaining => __armorStep(remaining - 0.001), remaining);
  assert.equal(await page.evaluate(() => RIFT.player.blackArmorActive), true, 'Immunity remains through the final millisecond');
  await page.evaluate(() => __armorStep(0.002));
  const expired = await page.evaluate(() => {
    RIFT.hud.update(.06);
    const p = RIFT.player;
    const hullMaterialsRestored = p.blackArmorEffect.originalMaterials.length === 0
      && [...p.hull.children].every(child => !child.isMesh || child.material !== p.blackArmorEffect.armorMaterial);
    return {
      active: p.blackArmorActive,
      cooldown: p.blackArmorCooldown,
      restored: hullMaterialsRestored,
      hudCooldown: document.getElementById('blackArmorHud').classList.contains('cooldown'),
      damageLands: p.takeDamage(1, 'POST ARMOR'),
    };
  });
  assert.equal(expired.active, false);
  assert.ok(expired.cooldown > 19.99 && expired.cooldown <= 20, `Cooldown begins after expiration: ${expired.cooldown}`);
  assert.ok(expired.restored && expired.hudCooldown, 'Original hull materials and cooldown HUD are restored');
  assert.equal(expired.damageLands, true, 'Damage immunity ends immediately with the five-second effect');

  await page.keyboard.press('1');
  await page.evaluate(() => __armorStep(1 / 60));
  assert.equal(await page.evaluate(() => RIFT.player.blackArmorActive), false, 'Cooldown prevents reactivation');

  const ships = await page.evaluate(() => {
    const ids = ['rift-talon', 'void-corsair', 'neon-wraith', 'black-manta', 'gold-revenant', 'star-vandal'];
    const output = [];
    const p = RIFT.player;
    p.resetBlackArmor();
    for (const id of ids) {
      p.setShip(id);
      const started = p.activateBlackArmor();
      output.push({ id, started, coated: p.blackArmorEffect.originalMaterials.length });
      p.resetBlackArmor();
    }
    return output;
  });
  assert.ok(ships.every(ship => ship.started && ship.coated > 0), `All playable hulls accept and restore the coating: ${JSON.stringify(ships)}`);
  assert.deepEqual(errors, [], `No browser/runtime errors: ${errors.join('\n')}`);
  console.log('PASS: Black Armor input, exact duration, 20s post-effect cooldown, total immunity, movement, visuals, HUD, restoration and all six hulls.');
} finally {
  await browser.close();
}
