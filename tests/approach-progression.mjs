/**
 * Real-browser regression coverage for pre-objective augments. The ordinary
 * animation loop is silenced after launch so all gameplay time is advanced
 * explicitly, including the upgrade dismissal and recovery scheduler.
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const errors = [];
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 180000,
  args: [
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
  });
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.RIFT));
  await page.click('#launchBtn');
  await page.evaluate(() => {
    const g = window.RIFT;
    window.__step = g.update.bind(g);
    window.__realDamage = g.player.takeDamage;
    g.update = () => {};
    g.renderFrame = () => {};
    g.player.takeDamage = () => false;
  });

  const step = async (seconds) => {
    let frames = Math.ceil(seconds * 60);
    while (frames > 0) {
      const chunk = Math.min(frames, 600);
      await page.evaluate((n) => {
        for (let i = 0; i < n; i++) window.__step(1 / 60);
      }, chunk);
      frames -= chunk;
    }
  };

  const until = async (kind, value, budget) => {
    let frames = Math.ceil(budget * 60);
    while (frames > 0) {
      const chunk = Math.min(frames, 600);
      const reached = await page.evaluate(({ kind, value, n }) => {
        const g = window.RIFT;
        const done = () => kind === 'choice'
          ? g.upgradeScreen.open
          : g.director.state === value;
        for (let i = 0; i < n && !done(); i++) window.__step(1 / 60);
        return done();
      }, { kind, value, n: chunk });
      if (reached) return;
      frames -= chunk;
    }
    const state = await page.evaluate(() => ({
      state: window.RIFT.director.state,
      t: window.RIFT.director.stateT,
      open: window.RIFT.upgradeScreen.open,
      picks: window.RIFT.director.data.picks,
    }));
    assert.fail(`Did not reach ${kind}:${value} within ${budget}s: ${JSON.stringify(state)}`);
  };

  const cards = () => page.evaluate(() => {
    const g = window.RIFT;
    return {
      offers: g.upgradeScreen._offers.map((up) => up.id),
      count: document.querySelectorAll('#upgradeCards .upCard').length,
      visible: !document.getElementById('upgradeScreen').classList.contains('hidden'),
      taken: g.upgrades.taken.length,
      state: g.director.state,
      waiting: g.director.data.awaitingAugment,
      picks: g.director.data.picks,
      events: g.director.data.eventIndex,
      beat: g.director.data.beatIndex,
    };
  });

  const takeCard = async () => {
    const before = await page.evaluate(() => window.RIFT.upgrades.taken.length);
    await page.evaluate(() => {
      const card = document.querySelector('#upgradeCards .upCard');
      card.click();
      card.click(); // double input must never buy two augments
    });
    assert.equal(await page.evaluate(() => window.RIFT.upgrades.taken.length), before + 1);
    await step(0.5);
    const after = await page.evaluate(() => ({
      count: window.RIFT.upgrades.taken.length,
      open: window.RIFT.upgradeScreen.open,
      closing: window.RIFT.upgradeScreen.closing,
      hidden: document.getElementById('upgradeScreen').classList.contains('hidden'),
    }));
    assert.equal(after.count, before + 1, 'One checkpoint grants exactly one augment');
    assert.equal(after.open, false);
    assert.equal(Boolean(after.closing), false);
    assert.equal(after.hidden, true);
  };

  const checkChoiceSafety = async () => {
    // Check real hazard damage while a cache is open, not only god-mode health.
    await page.evaluate(() => {
      const g = window.RIFT;
      g.player.takeDamage = window.__realDamage;
      g.player.health = 100;
      g.player.shield = 0;
      g.player.invuln = 0;
      g.heat.heat = 0.5;
      g.heat.combo = 7;
      g.heat.comboT = 3;
      g.env.spawnGate();
      window.__gate = g.env.gates.find((o) => o.active);
      window.__gate.g.position.set(g.player.x, g.player.y, 0);
      window.__gate.g.rotation.z = 0;
      window.__gate.spin = 0;
      window.__gate.drift = 0;
    });
    const frozen = () => page.evaluate(() => {
      const g = window.RIFT;
      return {
        state: g.director.state,
        stateT: g.director.stateT,
        time: g.time,
        runTime: g.runTime,
        hp: g.player.health,
        shield: g.player.shield,
        heat: g.heat.heat,
        combo: g.heat.combo,
        x: g.player.x,
        y: g.player.y,
        gateZ: window.__gate.g.position.z,
        starZ: g.env.starA.geometry.attributes.position.array[2],
      };
    });
    const before = await frozen();
    await step(30);
    assert.deepEqual(await frozen(), before, 'Choosing augments must freeze danger, timers and combo');

    const picksBeforePause = await page.evaluate(() => window.RIFT.upgrades.taken.length);
    await page.evaluate(() => {
      const g = window.RIFT;
      g.togglePause();
      document.querySelector('#upgradeCards .upCard').click();
      dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1' }));
    });
    await step(5);
    assert.equal(await page.evaluate(() => window.RIFT.upgrades.taken.length), picksBeforePause,
      'Pause must reject card clicks and hotkeys');
    assert.equal(await page.evaluate(() => window.RIFT.upgradeScreen.open), true);
    assert.deepEqual(await frozen(), before);
    await page.evaluate(() => {
      const g = window.RIFT;
      g.togglePause();
      window.__gate.active = false;
      window.__gate.g.visible = false;
      g.player.takeDamage = () => false;
    });
  };

  await until('state', 'TRAVERSAL_1', 4);
  const approaches = [
    ['TRAVERSAL_1', 'TOWER_1_COMBAT', 'TRAVERSAL_2'],
    ['TRAVERSAL_2', 'TOWER_2_COMBAT', 'TRAVERSAL_3'],
    ['TRAVERSAL_3', 'TOWER_3_COMBAT', 'INHIBITOR_APPROACH'],
    ['INHIBITOR_APPROACH', 'INHIBITOR_COMBAT', 'NEXUS_TRANSITION'],
  ];
  let totalPicks = 0;
  for (const [sector, [traversal, combat, next]] of approaches.entries()) {
    assert.equal(await page.evaluate(() => window.RIFT.director.state), traversal);
    const duration = await page.evaluate(() => window.RIFT.director.data.cfg.duration);
    let firstEventIndex = 0;
    for (let checkpoint = 0; checkpoint < 3; checkpoint++) {
      await until('choice', null, duration + 3);
      const cache = await cards();
      assert.equal(cache.visible, true, `${traversal}: cache must be visible`);
      assert.equal(cache.state, traversal, 'Checkpoint should preserve the approach state');
      assert.equal(cache.waiting, true);
      assert.equal(cache.picks, checkpoint);
      assert.equal(cache.taken, totalPicks);
      assert.equal(cache.count, 3, `${traversal} cache ${checkpoint + 1} needs three choices`);
      assert.equal(new Set(cache.offers).size, 3, 'A cache must not duplicate cards');
      if (sector === 0 && checkpoint === 0) {
        firstEventIndex = cache.events;
        assert.ok(firstEventIndex > 0, 'Authored first-approach events must fire');
        await checkChoiceSafety();
      }
      if (sector === 0 && checkpoint === 2) {
        assert.ok(cache.events > firstEventIndex, 'Authored events must continue after the first cache');
        assert.ok(cache.beat >= 2, 'First approach should reach its third combat beat');
      }
      await takeCard();
      totalPicks++;
      assert.equal(await page.evaluate(() => window.RIFT.director.data.picks), checkpoint + 1);
      assert.equal(await page.evaluate(() => window.RIFT.director.data.awaitingAugment), false);
    }

    await until('state', combat, duration + 5);
    assert.equal(await page.evaluate(() => window.RIFT.upgrades.taken.length), totalPicks);
    assert.equal(await page.evaluate(() => window.RIFT.upgradeScreen.open), false);
    console.log(`${traversal}: three pre-objective augments, ${totalPicks} total; reached ${combat}`);

    // Resolve the objective through its damage/death callbacks and verify the
    // old post-tower cache no longer adds a fourth pick to the approach rhythm.
    await page.evaluate(() => {
      const e = window.RIFT.encounter;
      for (const t of e.targets) {
        t.targetable = true;
        t.damageScale = 1;
        t.damage(1e9);
      }
    });
    await until('state', next, 15);
    assert.equal(await page.evaluate(() => window.RIFT.upgrades.taken.length), totalPicks);
    assert.equal(await page.evaluate(() => window.RIFT.upgradeScreen.open), false);
  }
  assert.equal(totalPicks, 12);

  await until('choice', null, 15);
  const nexus = await cards();
  assert.equal(nexus.state, 'UPGRADE_5');
  assert.equal(nexus.count, 3, 'The final Nexus cache must still have three choices after twelve picks');
  assert.equal(new Set(nexus.offers).size, 3);
  await takeCard();
  await until('state', 'BOSS_COMBAT', 9);
  assert.equal(await page.evaluate(() => window.RIFT.upgrades.taken.length), 13);

  // Restart during the 260ms dismissal: an old onDone must not advance or
  // modify the newly reset run when its scheduler would have fired.
  await page.evaluate(() => window.RIFT.startRun());
  await until('state', 'TRAVERSAL_1', 4);
  await until('choice', null, 120);
  await page.evaluate(() => {
    document.querySelector('#upgradeCards .upCard').click();
    window.RIFT.startRun();
  });
  await step(0.6);
  const reset = await page.evaluate(() => ({
    state: window.RIFT.director.state,
    taken: window.RIFT.upgrades.taken.length,
    open: window.RIFT.upgradeScreen.open,
    closing: Boolean(window.RIFT.upgradeScreen.closing),
    hidden: document.getElementById('upgradeScreen').classList.contains('hidden'),
  }));
  assert.deepEqual(reset, { state: 'INTRO', taken: 0, open: false, closing: false, hidden: true });
  await until('state', 'TRAVERSAL_1', 4);
  assert.equal(await page.evaluate(() => window.RIFT.director.data.picks), 0);
  assert.deepEqual(errors, [], 'Browser must not report runtime errors');
  console.log('PASS: 12 approach picks + Nexus, choice safety, pause, double input and restart cleanup.');
} finally {
  await browser.close();
}
