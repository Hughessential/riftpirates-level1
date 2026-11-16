import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { launchRun } from './helpers/start-run.mjs';

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    // Same HMR isolation used by the project's existing keyboard browser test.
    window.WebSocket = class extends EventTarget { send() {} close() {} };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [] });
    localStorage.setItem('riftpirates-level1-v1', JSON.stringify({
      pilotName: 'ULTRA TEST', pilotNameConfirmed: true, tutorialComplete: true, music: 0, sfx: 0,
      scrapBanked: 1234, bestScore: 5678,
    }));
  });
  await page.goto(process.env.RIFT_TEST_URL || 'http://127.0.0.1:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await launchRun(page);
  await page.evaluate(async () => {
    window.__Input = (await import('/src/core/Input.js')).Input;
    window.__Target = (await import('/src/combat/Target.js')).Target;
    window.__Audio = (await import('/src/core/AudioManager.js')).Audio2;
    window.__Save = (await import('/src/core/SaveSystem.js')).Save;
    const g = RIFT;
    g.director.go('TESTING'); // stable real gameplay state, without enabling lab god mode
    g.player.frozen = false;
    window.__step = g.update.bind(g);
    g.update = () => {}; // deterministic steps; browser still renders actual initial frames
    window.__render = g.renderFrame.bind(g);
    g.renderFrame = () => {};
    window.__cues = 0;
    const play = __Audio.play.bind(__Audio);
    __Audio.play = (...args) => { if (args[0] === 'black_armor') __cues++; return play(...args); };
    window.__advance = seconds => {
      const frames = Math.round(seconds * 60);
      for (let i = 0; i < frames; i++) __step(1 / 60);
    };
  });
  assert.equal(await page.evaluate(() => RIFT.ultraUltimate.authorized), true, 'Loopback development permits private testing');
  assert.equal(await page.evaluate(() => RIFT.testRun), false);

  await page.keyboard.down('2');
  await page.evaluate(() => __step(1 / 60));
  const activated = await page.evaluate(() => {
    RIFT.hud.update(.1);
    const u = RIFT.ultraUltimate, p = RIFT.player;
    __render(1 / 60);
    return { active: u.active, cues: __cues, testRun: RIFT.testRun, baseDps: u.baseDps,
      radius: u.fieldRadius, hull: u.hullLength, cooldown: u.cooldown,
      coated: u.effect.originalMaterials.length, root: u.effect.root.visible,
      hud: document.getElementById('ultraUltimateHud')?.textContent || document.querySelector('.ultraUltimateRow')?.textContent };
  });
  assert.ok(activated.active && activated.testRun && activated.root && activated.coated > 0);
  assert.equal(activated.cues, 1, 'Activation sound fires once');
  assert.equal(activated.cooldown, 0, 'Cooldown does not run during the transformation');
  assert.ok(Math.abs(activated.baseDps - 117) < .001, 'Area output snapshots pre-ultra primary DPS');
  assert.ok(Math.abs(activated.radius / activated.hull - 15) < .001, 'Radius uses only fifteen hull lengths');
  if (process.env.ULTRA_SCREENSHOT) await page.screenshot({ path: process.env.ULTRA_SCREENSHOT });

  const held = await page.evaluate(() => {
    for (let i = 0; i < 5; i++) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', repeat: true, bubbles: true }));
    __advance(31);
    return { active: RIFT.ultraUltimate.active, elapsed: RIFT.ultraUltimate.elapsed, cues: __cues };
  });
  assert.ok(held.active && held.elapsed >= 30.9, 'Transformation stays active beyond the old thirty-second limit');
  assert.equal(held.cues, 1, 'Held/repeated key events do not retrigger or toggle');
  await page.keyboard.up('2');

  const movement = await page.evaluate(() => {
    const p = RIFT.player;
    const press = code => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    const release = code => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    const x = p.x; press('KeyD'); __advance(.1); release('KeyD'); const steer = p.x > x;
    press('ShiftLeft'); __step(.05); const boost = p.boosting; release('ShiftLeft');
    press('KeyC'); __step(.05); const brake = p.braking; release('KeyC');
    press('KeyQ'); __step(1 / 60); const roll = p.rollT > 0; release('KeyQ');
    press('Space'); __advance(.2); release('Space');
    const fire = RIFT.projectiles.player.some(b => b.active && b.voidBeam);
    __advance(.6); // let the roll's independently owned protection finish
    return { steer, boost, brake, roll, fire, active: RIFT.ultraUltimate.active };
  });
  assert.ok(Object.values(movement).every(Boolean), `Steering, boost, brake, rolls and held Space remain functional: ${JSON.stringify(movement)}`);

  const paused = await page.evaluate(() => {
    const u = RIFT.ultraUltimate;
    RIFT.togglePause({ showMenu: false });
    const before = [u.elapsed, u.pulseClock, u.cooldown];
    __advance(3);
    const after = [u.elapsed, u.pulseClock, u.cooldown];
    RIFT.togglePause({ showMenu: false });
    return { before, after };
  });
  assert.deepEqual(paused.after, paused.before, 'Pause freezes active and damage-pulse clocks');

  const immunity = await page.evaluate(async () => {
    const g = RIFT, p = g.player;
    const before = [p.health, p.shield];
    const direct = ['PROJECTILE', 'BEAM', 'COLLISION', 'EXPLOSION', 'BOSS', 'ENVIRONMENT', 'DAMAGE OVER TIME']
      .map(source => p.takeDamage(9999, source));
    g.projectiles.fireEnemy({ x: p.x, y: p.y, z: 0, tx: p.x, ty: p.y, tz: 1,
      speed: 1, damage: 9999, label: 'ULTRA TEST BULLET' });
    g.collisions.update(0);
    const { Beam, Zone, Shockwave, VoidAnchor, CollapseField } = await import('/src/effects/Hazards.js');
    const threats = [
      new Beam({ cx: p.x - 2, cy: p.y, trackTime: .001, lockTime: .001, damage: 9999 }),
      new Zone({ x: p.x, y: p.y, warnTime: .001, damage: 9999 }),
      new Shockwave({ x: p.x, y: p.y, damage: 9999 }),
      new VoidAnchor({ x: p.x, y: p.y, markTime: .001, damage: 9999 }),
      new CollapseField({ warnTime: .001, damage: 9999 }),
    ];
    const live = [];
    for (const h of threats) {
      g.addHazard(h); h.update(.01); h.update(.01);
      live.push(h.live && h.hits(p.x, p.y));
      g.collisions.update(0); g.clearHazards();
    }
    const rammer = g.enemies.spawn('scout', p.x, p.y, 0);
    g.collisions.update(0);
    return { before, after: [p.health, p.shield], direct, live, rammerDied: !rammer.alive,
      hostileBulletConsumed: !g.projectiles.enemy.some(b => b.active) };
  });
  assert.deepEqual(immunity.direct, Array(7).fill(false));
  assert.deepEqual(immunity.live, Array(5).fill(true), 'Every real hazard type was live and intersecting');
  assert.deepEqual(immunity.after, immunity.before, 'Real projectile/hazard/ram collisions drain neither health nor shields');
  assert.ok(immunity.hostileBulletConsumed && immunity.rammerDied, 'Collision resolution still executes while immune');

  await page.keyboard.press('2');
  await page.evaluate(() => __step(1 / 60));
  const ended = await page.evaluate(() => ({ active: RIFT.ultraUltimate.active,
    cooldown: RIFT.ultraUltimate.cooldown, materials: RIFT.ultraUltimate.effect.originalMaterials.length,
    damageLands: RIFT.player.takeDamage(1, 'AFTER ULTRA') }));
  assert.equal(ended.active, false);
  assert.ok(ended.cooldown > 59.9 && ended.cooldown <= 60, 'Sixty-second cooldown begins at the second fresh key press');
  assert.equal(ended.materials, 0);
  assert.equal(ended.damageLands, true, 'Immunity stops when the toggle ends');
  await page.keyboard.press('2');
  await page.evaluate(() => __step(1 / 60));
  assert.equal(await page.evaluate(() => RIFT.ultraUltimate.active), false, 'Cooldown blocks keyboard activation');
  const cooled = await page.evaluate(() => {
    const u = RIFT.ultraUltimate;
    RIFT.togglePause({ showMenu: false }); const before = u.cooldown;
    __advance(2); const after = u.cooldown;
    RIFT.togglePause({ showMenu: false }); __advance(1);
    return { before, after, resumed: u.cooldown };
  });
  assert.equal(cooled.after, cooled.before);
  assert.ok(Math.abs(cooled.resumed - cooled.before + 1) < .001);

  const textEntry = await page.evaluate(() => {
    RIFT.ultraUltimate.reset();
    const results = [];
    for (const tag of ['input', 'textarea', 'div']) {
      const field = document.createElement(tag);
      if (tag === 'div') field.contentEditable = 'true';
      document.body.append(field); field.focus();
      field.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', bubbles: true }));
      __step(1 / 60);
      results.push(RIFT.ultraUltimate.active);
      field.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit2', bubbles: true }));
      field.remove();
    }
    const dialog = document.createElement('dialog'); document.body.append(dialog); dialog.showModal();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', bubbles: true }));
    __step(1 / 60); results.push(RIFT.ultraUltimate.active);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit2', bubbles: true }));
    dialog.close(); dialog.remove();
    RIFT.testingPanel.secretArmed = true;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', key: '2', bubbles: true }));
    __step(1 / 60); results.push(RIFT.ultraUltimate.active);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Digit2', key: '2', bubbles: true }));
    RIFT.testingPanel.secretArmed = false;
    return results;
  });
  assert.deepEqual(textEntry, [false, false, false, false, false], 'Text fields/contenteditable/dialogs/secret entry own key 2');

  const overlap = await page.evaluate(() => {
    const p = RIFT.player, u = RIFT.ultraUltimate;
    const materials = () => { const list = []; p.hull.traverse(o => { if (o.isMesh) list.push(o.material); }); return list; };
    const layers = () => { const list = []; p.hull.traverse(o => { if (o.isMesh) list.push(o.layers.mask); }); return list; };
    const original = materials();
    const originalLayers = layers();
    const restored = () => materials().every((m, i) => m === original[i])
      && layers().every((mask, i) => mask === originalLayers[i]);
    p.resetBlackArmor(); u.reset();
    p.activateBlackArmor(); __advance(1);
    const before = p.blackArmorTime;
    u.activate(); __advance(1); u.cancel();
    const normalAfterUltra = p.blackArmorActive && p.blackArmorTime < before && p.blackArmorEffect.originalMaterials.length > 0;
    const immunityRetained = !p.takeDamage(100, 'BLACK ARMOR STILL ACTIVE');
    p.resetBlackArmor(); u.reset(); const firstRestored = restored();
    u.activate(); p.activateBlackArmor(); __advance(6);
    const ultraAfterNormal = u.active && !p.blackArmorActive && p.blackArmorCooldown > 18.9
      && u.effect.originalMaterials.length > 0 && p.hull.visible;
    p.invuln = 1.7; u.cancel();
    const rollProtectionRetained = p.invuln === 1.7 && !p.takeDamage(100, 'OTHER PROTECTION');
    return { normalAfterUltra, immunityRetained, firstRestored, ultraAfterNormal,
      rollProtectionRetained, restored: restored() };
  });
  assert.ok(Object.values(overlap).every(Boolean), `Independent armor/material/immunity ownership in both orders: ${JSON.stringify(overlap)}`);

  const field = await page.evaluate(() => {
    const g = RIFT, u = g.ultraUltimate, p = g.player;
    u.reset(); p.resetBlackArmor(); g.enemies.clear(); g.targets.length = 0;
    p.invuln = 0;
    const records = {};
    const make = (name, z, extra = {}) => {
      const t = new __Target({ hp: 1e8, kind: 'enemy', onDamage: amount => { records[name] = (records[name] || 0) + amount; } });
      t.pos.set(p.x, p.y, z); Object.assign(t, extra); g.targets.push(t); return t;
    };
    const near = make('near', -4);
    g.targets.push(near); // duplicated collider registration must not duplicate a pulse
    const far = make('far', -200);
    make('ally', -4, { team: 'ally' }); make('friendly', -4, { friendly: true });
    make('loot', -4, { kind: 'collectible' }); make('hidden', -4, { targetable: false });
    const shared = {};
    make('body', -10, { kind: 'body', damageGroup: shared, damageScale: .25 });
    make('core', -10, { kind: 'core', damageGroup: shared, damageScale: 1 });
    u.activate();
    const pulse = u.tuning().areaDps * u.tuning().pulseInterval;
    const immediate = { ...records };
    __advance(.2); const next = { ...records };
    near.pos.z = -200; far.pos.z = -4;
    __advance(.2); const moved = { ...records };
    u.cancel(); __advance(.4);
    const cancelled = { ...records };
    g.targets.length = 0;
    return { pulse, immediate, next, moved, cancelled };
  });
  assert.equal(field.pulse, 117 * 100 * .2);
  assert.deepEqual(field.immediate, { near: field.pulse, core: field.pulse }, 'Immediate pulse has correct DPS conversion, hostile filter and shared-HP dedup');
  assert.deepEqual(field.next, { near: field.pulse * 2, core: field.pulse * 2 });
  assert.deepEqual(field.moved, { near: field.pulse * 2, core: field.pulse * 3, far: field.pulse }, 'Field entry/exit follows the spherical distance');
  assert.deepEqual(field.cancelled, field.moved, 'No lingering functional pulses after cancel');

  const ships = await page.evaluate(async () => {
    const { PLAYER_SHIPS } = await import('/src/render/PlayerFleet.js');
    const p = RIFT.player, u = RIFT.ultraUltimate;
    return PLAYER_SHIPS.map(({ id }) => {
      p.setShip(id); p.resetBlackArmor();
      const masks = []; p.hull.traverse(o => { if (o.isMesh) masks.push(o.layers.mask); });
      const started = u.activate(), count = u.effect.originalMaterials.length;
      const length = u.hullLength, radius = u.fieldRadius;
      p.setShip(id); // replacement itself must clean ownership
      const afterMasks = []; p.hull.traverse(o => { if (o.isMesh) afterMasks.push(o.layers.mask); });
      return { id, started, count, length, radius, clean: !u.active && !u.cooldown && !u.effect.root.visible
        && !u.effect.originalMaterials.length && masks.every((mask, i) => mask === afterMasks[i]) };
    });
  });
  assert.ok(ships.every(s => s.started && s.count > 0 && s.clean && s.length > 1 && Math.abs(s.radius / s.length - 15) < .001), JSON.stringify(ships));

  const encounter = await page.evaluate(() => {
    const g = RIFT;
    g.testing.enter(); g.testing.setPanelOpen(false); g.testing.loadScene('sandbox');
    g.testing.setSetting('godMode', false);
    const beforeKills = g.stats.kills, beforeScore = g.score.total;
    const scout = g.testing.spawnEnemy('scout', 1)[0];
    g.ultraUltimate.activate();
    const kill = !scout.alive && g.stats.kills === beforeKills + 1 && g.score.total > beforeScore && scout.killLootIssued;
    g.testing.loadScene('tower1');
    const sceneClean = !g.ultraUltimate.active && g.ultraUltimate.cooldown === 0;
    g.ultraUltimate.activate(); __advance(4);
    const tower = { modules: g.stats.weakPoints, objectives: g.stats.towers,
      state: g.encounter?.state, director: g.director.state };
    g.testing.loadScene('boss');
    g.testing.setTuning('ultraAreaDps', 3000);
    const boss = g.encounter;
    g.ultraUltimate.activate();
    const hpBefore = boss.bossHp;
    boss._openCore(5);
    // Isolate body/core, preserving real encounter Target and phase callbacks.
    const targets = g.targets; g.targets = [boss.bodyTarget, boss.coreTarget];
    g.ultraUltimate.pulse();
    const damage = hpBefore - boss.bossHp;
    const expected = 3000 * .2 * boss.coreTarget.damageScale;
    g.targets = targets;
    for (let i = 0; i < 100 && boss.state === 'active'; i++) {
      boss._openCore(5); g.ultraUltimate.pulse();
    }
    const phases = g.stats.bossPhases;
    __advance(8);
    return { kill, sceneClean, tower, damage, expected, phases, bossState: boss.state,
      afterBoss: g.director.state };
  });
  assert.ok(encounter.kill, 'Normal kill credit, score and loot issuance survive the field');
  assert.ok(encounter.sceneClean, 'Testing Grounds scene changes clear the active ability and cooldown');
  assert.ok(encounter.tower.modules > 0 && (encounter.tower.state !== 'active'), `Tower module/objective death pipeline completes: ${JSON.stringify(encounter.tower)}`);
  assert.ok(Math.abs(encounter.damage - encounter.expected) < .001, `Admiral shared body/core pool is hit once: ${JSON.stringify(encounter)}`);
  assert.equal(encounter.phases, 4, 'Admiral progresses through all four legitimate phase callbacks');
  assert.ok(encounter.bossState !== 'active' && encounter.afterBoss === 'ESCAPE', JSON.stringify(encounter));

  const lifecycle = await page.evaluate(() => {
    const g = RIFT, u = g.ultraUltimate;
    g.testing.loadScene('sandbox'); g.testing.setPanelOpen(false);
    u.activate();
    const before = { bank: __Save.data.scrapBanked, score: __Save.data.bestScore, run: __Save.data.lastBankedRunId };
    // An explicit terminal death (e.g. failed escape) must clean the toggle even
    // though damage-based deaths are intentionally impossible during ultra.
    g.player.alive = false; g.player.health = 0; g._onPlayerDeath('TERMINAL TEST');
    const deathClean = !u.active && !u.cooldown && !u.effect.root.visible && !u.effect.originalMaterials.length;
    g.showResults({ victory: false });
    const after = { bank: __Save.data.scrapBanked, score: __Save.data.bestScore, run: __Save.data.lastBankedRunId };
    g.startRun(); g.director.go('TESTING'); g.player.frozen = false;
    const restartClean = !u.active && !u.cooldown && !g.testRun && g.player.alive;
    u.activate(); g.prepareTitle();
    return { before, after, deathClean, restartClean, titleClean: !u.active && !u.effect.root.visible };
  });
  assert.deepEqual(lifecycle.after, lifecycle.before, 'Powered run never banks scrap, best score, or run ID');
  assert.ok(lifecycle.deathClean && lifecycle.restartClean && lifecycle.titleClean, JSON.stringify(lifecycle));
  assert.deepEqual(errors, [], `Browser/runtime errors: ${errors.join('\n')}`);
  console.log('Ultra ultimate PASS: indefinite toggle, hold/text guards, pause/cooldown, all real damage families, independent armor overlap, DPS pulses and hostile/shared-HP filtering, six hulls, loot/kill/tower/Admiral progression, lifecycle and save isolation.');
} finally {
  await browser.close();
}
