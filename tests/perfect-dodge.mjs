import { launchRun } from './helpers/start-run.mjs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, protocolTimeout: 120000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await launchRun(page);

  const setup = await page.evaluate(async () => {
    const { Input } = await import('/src/core/Input.js');
    const g = window.RIFT;
    window.dodgeInput = Input;
    window.dodgeStep = g.update.bind(g);
    // RAF may keep ticking, but only our fixed steps advance the simulation.
    g.update = () => {};
    g.renderFrame = () => {};
    Input.reset();
    g.director.go('TOWER_1_INTRO');
    let frames = 0;
    while (!g.director.inCombat && frames < 1200) {
      window.dodgeStep(1 / 60);
      frames++;
    }
    // Keep the real combat state and collision/player systems. Only the tower's
    // attack generator is disabled so controlled bolts are the sole threats.
    g.encounter.update = () => {};
    g.scheduler.clear();
    g.enemies.clear();
    g.clearHazards();
    return { state: g.director.state, inCombat: g.director.inCombat,
      introActive: g.director.intro.active, frozen: g.player.frozen,
      frames, running: g.running, paused: g.paused };
  });
  assert.equal(setup.state, 'TOWER_1_COMBAT', 'A completed cinematic must reach actual combat before dodge trials');
  assert.equal(setup.inCombat, true);
  assert.equal(setup.introActive, false);
  assert.equal(setup.frozen, false);
  assert.equal(setup.running, true);
  assert.equal(setup.paused, false);

  const trial = (boost, lateral) => page.evaluate(({ boost, lateral }) => {
    const g = window.RIFT, p = g.player, input = window.dodgeInput;
    input.reset(); input.enabled = true;
    g.upgrades.reset(); p.reset(g.upgrades.stats);
    g.weapon.reset(); g.augmentEffects.reset();
    g.heat.reset(); g.score.reset(); g.scrap.reset();
    g.stats.perfectDodges = 0;
    g.scheduler.clear(); g.enemies.clear(); g.clearHazards(); g.projectiles.reset();
    // Explicitly unshielded and outside every invulnerability/repair window:
    // the direct-hit control must demonstrate actual hull loss.
    p.shield = 0; p.shieldBroken = true; p.timeSinceHit = 0;
    p.invuln = 0; p.blocksLeft = 0; p.boost = 50;
    input._keys.ShiftLeft = boost;
    const bolt = g.projectiles.fireEnemy({
      x: p.x + lateral, y: p.y, z: -6,
      tx: p.x + lateral, ty: p.y, tz: 94,
      speed: 40, damage: 15, label: 'DODGE TEST BOLT',
    });
    const health = p.health;
    let windowOpened = false, nearMissObserved = false;
    for (let frame = 0; frame < 40; frame++) {
      window.dodgeStep(1 / 60);
      windowOpened ||= p.dodgeT > 0;
      nearMissObserved ||= p.dodgePending;
    }
    input.reset();
    return { state: g.director.state, dodges: g.stats.perfectDodges,
      damage: health - p.health, shield: p.shield, boost: p.boost,
      critBuff: p.critBuffT, combo: g.heat.combo, score: g.score.total,
      windowOpened, nearMissObserved, boltActive: bolt.active,
      enemies: g.enemies.active.filter(enemy => enemy.alive).length,
      hazards: g.hazards.length };
  }, { boost, lateral });

  const near = await trial(true, 3);
  const noBoost = await trial(false, 3);
  const direct = await trial(true, 0);
  const far = await trial(true, 12);
  for (const result of [near, noBoost, direct, far]) {
    assert.equal(result.state, 'TOWER_1_COMBAT');
    assert.equal(result.enemies, 0, 'No incidental fleet can create a dodge or damage event');
    assert.equal(result.hazards, 0, 'No incidental tower hazard can affect the trial');
    assert.equal(result.shield, 0, 'Hull-loss assertions cannot be masked by shield absorption');
  }
  assert.equal(near.windowOpened, true, 'Real boost input opens the dodge window');
  assert.equal(near.nearMissObserved, true, 'The bolt actually passes through the near-miss region');
  assert.equal(near.dodges, 1, 'An unharmed close pass during boost awards exactly one dodge');
  assert.equal(near.damage, 0);
  assert.ok(near.critBuff > 0, 'A real dodge grants its weapon-power buff');
  assert.equal(near.combo, 2);
  assert.equal(near.score, 250);
  assert.equal(noBoost.windowOpened, false);
  assert.equal(noBoost.dodges, 0, 'The same close pass without boost earns no dodge');
  assert.equal(noBoost.damage, 0);
  assert.equal(noBoost.critBuff, 0);
  assert.equal(direct.windowOpened, true);
  assert.equal(direct.dodges, 0, 'Boost alone does not save a direct collision');
  assert.equal(direct.damage, 15, 'The direct-hit control deals exactly the controlled bolt damage to hull');
  assert.equal(direct.boltActive, false, 'The damaging bolt is consumed');
  assert.equal(direct.critBuff, 0);
  assert.equal(far.windowOpened, true);
  assert.equal(far.nearMissObserved, false);
  assert.equal(far.dodges, 0, 'A distant pass never counts as a perfect dodge');
  assert.equal(far.damage, 0);
  assert.equal(far.critBuff, 0);
  assert.ok(Math.abs(near.boost - far.boost - 18) < 1e-8, 'Successful dodge refunds exactly 18 boost over the otherwise identical far-pass trial');
  assert.deepEqual(errors, [], 'The test must fail on browser/runtime errors');
  console.log(`Perfect dodge PASS: combat after ${setup.frames} fixed intro frames; near=1, no boost=0, direct hit=15 hull/0 dodges, far=0; refund=18, no browser errors.`);
} finally {
  await browser.close();
}
