import { launchRun } from './helpers/start-run.mjs';
/**
 * Full-level verification. Steps the simulation with a fixed dt so we can play
 * an entire 12-minute run in seconds and assert every state transition.
 */
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const errors = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  protocolTimeout: 180000,
  args: [
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900',
  ],
});
try {
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', (e) => errors.push(`${e.message} :: ${(e.stack || '').split('\n')[1]?.trim()}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`console: ${m.text()}`); });

await page.goto(process.env.RIFT_TEST_URL || 'http://localhost:8000/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.RIFT));
await launchRun(page);

// Simulation-only: software GL makes rendering the bottleneck, and we're
// verifying game logic here. Visuals get checked separately with screenshots.
await page.evaluate(() => {
  window.__realRender = window.RIFT.renderFrame.bind(window.RIFT);
  window.RIFT.renderFrame = () => {};
  window.__step = window.RIFT.update.bind(window.RIFT);
  window.RIFT.update = () => {};
});

/** Step the sim by `seconds` of game time at a fixed 60Hz. */
const step = async (seconds) => {
  let left = Math.round(seconds * 60);
  while (left > 0) {
    const chunk = Math.min(left, 600);
    await page.evaluate((n) => {
      for (let i = 0; i < n; i++) window.__step(1 / 60);
    }, chunk);
    left -= chunk;
  }
};

const advanceUntil = async (state, maxSeconds = 20, choice = false) => {
  for (let elapsed = 0; elapsed < maxSeconds; elapsed += 10) {
    const reached = await page.evaluate(({ state, choice, seconds }) => {
      const g = window.RIFT;
      const done = () => choice ? g.upgradeScreen.open : g.director.state === state;
      for (let i = 0; i < Math.ceil(seconds * 60) && !done(); i++) window.__step(1 / 60);
      return done();
    }, { state, choice, seconds: Math.min(10, maxSeconds - elapsed) });
    if (reached) return;
  }
  assert.fail(`Did not reach ${choice ? 'upgrade choice' : state}: ${JSON.stringify(await snap())}`);
};

const snap = () =>
  page.evaluate(() => {
    const g = window.RIFT;
    return {
      dir: g.director.state,
      enc: g.encounter?.constructor.name.replace(/Tower|Encounter|Boss/g, '') ?? '-',
      encState: g.encounter?.state ?? '-',
      objHp: g.encounter ? +(g.encounter.healthPct * 100).toFixed(0) : null,
      haz: g.hazards.length,
      tgt: g.targets.length,
      foes: g.enemies.countAlive(),
      hp: Math.round(g.player.health),
      alive: g.player.alive,
      lvl: g.xp.level,
      mult: +g.heat.multiplier.toFixed(1),
      score: g.score.total,
      scrap: g.scrap.total,
    };
  });

const log = async (label) => {
  const s = await snap();
  console.log(
    `${label.padEnd(24)} ${s.dir.padEnd(19)} ${String(s.enc).padEnd(9)} ${String(s.encState).padEnd(7)}` +
    ` obj:${String(s.objHp ?? '-').padStart(4)}% haz:${String(s.haz).padStart(2)} foes:${String(s.foes).padStart(2)}` +
    ` hp:${String(s.hp).padStart(3)} lv:${String(s.lvl).padStart(2)} x${String(s.mult).padStart(4)} score:${String(s.score).padStart(7)}`
  );
  return s;
};

const godMode = () =>
  page.evaluate(() => {
    window.__realTakeDamage = window.RIFT.player.takeDamage;
    window.RIFT.player.takeDamage = () => false;
  });
const mortal = () => page.evaluate(() => { window.RIFT.player.takeDamage = window.__realTakeDamage; });
const killEncounter = () =>
  page.evaluate(() => {
    const e = window.RIFT.encounter;
    for (const t of e.targets) { t.targetable = true; t.damageScale = 1; t.damage(1e9); }
  });
const pickUpgrade = async () => {
  const before = await page.evaluate(() => {
    const g = window.RIFT;
    return { taken: g.upgrades.taken.length, open: g.upgradeScreen.open,
      count: document.querySelectorAll('#upgradeCards .upCard').length };
  });
  assert.equal(before.open, true, 'Expected a visible upgrade choice');
  assert.equal(before.count, 3, 'Every cache must offer three cards');
  await page.evaluate(() => (window.RIFT.scrap.wallet.credit(10000), document.querySelector('#upgradeCards .upCard').click()));
  await step(0.5);
  assert.equal(await page.evaluate(() => window.RIFT.upgrades.taken.length), before.taken + 1);
  assert.equal(await page.evaluate(() => window.RIFT.upgradeScreen.open), false);
};

const approach = async (traversal, combat) => {
  assert.equal((await snap()).dir, traversal);
  const duration = await page.evaluate(() => window.RIFT.director.data.cfg.duration);
  const before = await page.evaluate(() => window.RIFT.upgrades.taken.length);
  for (let i = 0; i < 3; i++) {
    await advanceUntil(null, duration + 3, true);
    assert.equal((await snap()).dir, traversal, 'Augments must arrive before the objective');
    await pickUpgrade();
    assert.equal(await page.evaluate(() => window.RIFT.director.data.picks), i + 1);
  }
  await advanceUntil(combat, duration + 5);
  assert.equal(await page.evaluate(() => window.RIFT.upgrades.taken.length), before + 3);
  await log(`${traversal} complete`);
};

console.log('LABEL                    DIRECTOR            ENCOUNTER STATE');
console.log('-'.repeat(122));

await godMode();
await log('boot');

await advanceUntil('TRAVERSAL_1', 4);
for (const [traversal, combat, next] of [
  ['TRAVERSAL_1', 'TOWER_1_COMBAT', 'TRAVERSAL_2'],
  ['TRAVERSAL_2', 'TOWER_2_COMBAT', 'TRAVERSAL_3'],
  ['TRAVERSAL_3', 'TOWER_3_COMBAT', 'INHIBITOR_APPROACH'],
]) {
  await approach(traversal, combat);
  await step(8);
  await log(`${combat} active`);
  const picks = await page.evaluate(() => window.RIFT.upgrades.taken.length);
  await killEncounter();
  await advanceUntil(next, 15);
  assert.equal(await page.evaluate(() => window.RIFT.upgrades.taken.length), picks,
    'Post-objective recovery must not add another augment');
  await log(`${combat} cleared`);
}

// ---- inhibitor ----
await approach('INHIBITOR_APPROACH', 'INHIBITOR_COMBAT');
await step(6);
await log('inhibitor combat');
const shieldsUp = await page.evaluate(() => window.RIFT.encounter.shieldsUp);
console.log(`   >> inhibitor rotating shields blocking fire: ${shieldsUp}`);
assert.equal(shieldsUp, true);

await page.evaluate(() => {
  const e = window.RIFT.encounter;
  for (const [, m] of e.modules) m.target.damage(1e9);
});
await step(1);
const overload = await page.evaluate(() => ({
  overloading: window.RIFT.encounter.overloading,
  shieldsUp: window.RIFT.encounter.shieldsUp,
  coreTargetable: window.RIFT.encounter.core.targetable,
}));
console.log(`   >> all conduits down -> ${JSON.stringify(overload)}`);
assert.deepEqual(overload, { overloading: true, shieldsUp: false, coreTargetable: true });
await log('inhibitor overload');

await page.evaluate(() => window.RIFT.encounter.core.damage(1e9));
await advanceUntil('NEXUS_TRANSITION', 15);
await log('inhibitor destroyed');
console.log(`   >> nexus rift opened: ${await page.evaluate(() => !!window.RIFT.rift)}`);
assert.equal(await page.evaluate(() => Boolean(window.RIFT.rift)), true);
assert.equal(await page.evaluate(() => window.RIFT.upgrades.taken.length), 12);

// ---- nexus transition ----
await advanceUntil(null, 15, true);
await log('nexus transition');
const up5 = await page.evaluate(() => !document.getElementById('upgradeScreen').classList.contains('hidden'));
console.log(`   >> upgrade cache 5 (progression-board bonus) visible: ${up5}`);
assert.equal(up5, true);
assert.equal((await snap()).dir, 'UPGRADE_5');
await pickUpgrade();
assert.equal(await page.evaluate(() => window.RIFT.upgrades.taken.length), 13);

// ---- boss ----
await advanceUntil('BOSS_COMBAT', 9);
await log('boss intro');
await step(10);
await log('boss phase 1');

for (const [i, pct] of [[2, 0.74], [3, 0.49], [4, 0.24]]) {
  await page.evaluate((p) => {
    const e = window.RIFT.encounter;
    e.bossHp = e.maxBossHp * p + 5;
    e._bossDamage(4);
  }, pct);
  await step(6);
  await log(`boss phase ${i}`);
  assert.equal(await page.evaluate(() => window.RIFT.encounter.phase + 1), i);
}
console.log(`   >> boss reached phase ${await page.evaluate(() => window.RIFT.encounter.phase + 1)} / 4`);

await page.evaluate(() => {
  const e = window.RIFT.encounter;
  e.bossHp = 10;
  e._bossDamage(20);
});
await step(6);
await log('boss destroyed / escape');
assert.equal((await snap()).dir, 'ESCAPE', 'Admiral defeat must lead to the escape before victory');
assert.equal(await page.$eval('#resultsScreen', el => el.classList.contains('hidden')), true,
  'Admiral defeat does not finalize the run');
// Progression coverage uses the existing god-mode harness, but the route still
// has to be flown through the real movement controls. Mortal difficulty pilots
// live in final-escape.mjs; this test does not make a balance claim.
await page.evaluate(async () => {
  const g = window.RIFT;
  const { Input } = await import('/src/core/Input.js');
  const read = Input.read.bind(Input);
  Input.read = () => {
    const route = g.escape.snapshot();
    const target = route.nextGate || route.rift;
    return { x: Math.max(-1, Math.min(1, (target.x - g.player.x) * .55)),
      y: Math.max(-1, Math.min(1, (target.y - g.player.y) * .65)), boost: true };
  };
  try {
    for (let frame = 0; frame < 140 * 60 && g.director.state === 'ESCAPE'; frame++) window.__step(1 / 60);
  } finally { Input.read = read; Input.reset(); }
});
assert.equal((await snap()).dir, 'VICTORY', 'Reaching the rift completes the run');
await step(3);
await log('victory after escape');

const results = await page.evaluate(() => {
  const el = document.getElementById('resultsScreen');
  return {
    visible: !el.classList.contains('hidden'),
    title: document.getElementById('resultsTitle').getAttribute('aria-label'),
    grade: document.getElementById('gradeVal').textContent,
    score: document.getElementById('scoreBig').textContent,
    rows: document.querySelectorAll('#resultsGrid .rrow').length,
    build: [...document.querySelectorAll('#resultsBuild .chip')].map((c) => c.textContent.trim()),
  };
});
console.log('\nRESULTS:', JSON.stringify(results, null, 1));
assert.equal(results.visible, true);
assert.equal(results.title, 'GALAXY ESCAPED');
assert.equal((await snap()).dir, 'VICTORY');

// ---- restart without reload ----
await page.click('#againBtn');
await step(3);
const restart = await snap();
console.log('RESTART:', JSON.stringify({
  dir: restart.dir, score: restart.score, hp: restart.hp, lvl: restart.lvl,
  upgrades: await page.evaluate(() => window.RIFT.upgrades.taken.length),
}));
assert.equal(restart.dir, 'TRAVERSAL_1');
assert.equal(restart.score, 0);
assert.equal(restart.hp, 160);
assert.equal(restart.lvl, 1);
assert.equal(await page.evaluate(() => window.RIFT.upgrades.taken.length), 0);

// ---- death path (uses the real damage pipeline) ----
await mortal();
await page.evaluate(() => {
  const g = window.RIFT;
  g.player.health = 1;
  g.player.stats.secondWind = false;
  g.player.takeDamage(500, 'MIDRIFT SWEEPING LASER');
});
await step(3.2);
const dead = await page.evaluate(() => ({
  deathRan: !window.RIFT.death.active,
  resultsVisible: !document.getElementById('resultsScreen').classList.contains('hidden'),
  killedBy: document.getElementById('deathLine').textContent.trim(),
}));
console.log('DEATH:', JSON.stringify(dead));
assert.equal(dead.deathRan, true);
assert.equal(dead.resultsVisible, true);
assert.ok(dead.killedBy.includes('MIDRIFT SWEEPING LASER'));

console.log('\n===== ERRORS =====');
if (!errors.length) console.log('none');
else [...new Set(errors)].slice(0, 20).forEach((e) => console.log('  ' + e));

assert.deepEqual(errors, [], 'Browser must not report runtime errors');
} finally {
  await browser.close();
}
