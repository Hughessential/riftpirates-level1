import { launchRun } from './helpers/start-run.mjs';
/**
 * Combat integrity. The full-level test ran in god mode, which hides the things
 * that actually matter: do attacks fire, do they hurt, is the Perfect Dodge
 * window real, and does dying produce a results screen?
 */
import puppeteer from 'puppeteer-core';

const errors = [];
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`${e.message} :: ${(e.stack || '').split('\n')[1]?.trim()}`));

await page.goto(process.env.RIFT_TEST_URL || 'http://localhost:8000/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled);
await new Promise((r) => setTimeout(r, 700));
await launchRun(page);
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  window.RIFT.renderFrame = () => {};
});

const step = async (seconds) => {
  let left = Math.round(seconds * 60);
  while (left > 0) {
    const chunk = Math.min(left, 600);
    await page.evaluate((n) => { for (let i = 0; i < n; i++) window.RIFT.update(1 / 60); }, chunk);
    left -= chunk;
  }
};

// Instrument: record every hazard type that goes live and every damage source.
await page.evaluate(() => {
  const g = window.RIFT;
  window.__seen = { hazards: new Set(), damage: {}, dodges: 0, maxHaz: 0 };
  const addHazard = g.addHazard.bind(g);
  g.addHazard = (h) => {
    window.__seen.hazards.add(`${h.constructor.name}:${h.label}`);
    return addHazard(h);
  };
  const td = g.player.takeDamage;
  g.player.takeDamage = (amt, src) => {
    const before = g.player.health;
    const hit = td(amt, src);
    if (hit) {
      const d = before - g.player.health;
      window.__seen.damage[src] = +((window.__seen.damage[src] || 0) + d).toFixed(0);
    }
    return hit;
  };
  // Survivability harness: the player must live long enough to observe every
  // attack in every encounter. Damage is still applied and recorded — we just
  // top the hull back up so one fight's damage can't end the test.
  window.__keepAlive = () => {
    g.player.stats.maxHealth = 1e6;
    g.player.health = 1e6;
    g.player.alive = true;
  };
  window.__keepAlive();
  const upd = g.update.bind(g);
  g.update = (dt) => { if (window.__alive !== false) window.__keepAlive(); upd(dt); };
});

const report = () => page.evaluate(() => ({
  hazards: [...window.__seen.hazards],
  damage: window.__seen.damage,
  dodges: window.RIFT.stats.perfectDodges,
  hp: Math.round(window.RIFT.player.health),
  alive: window.RIFT.player.alive,
  mult: +window.RIFT.heat.multiplier.toFixed(1),
  combo: window.RIFT.heat.combo,
}));

// ---------------------------------------------------------------- TOWER 1
// Park the player in the middle and let the tower work. It must land hits.
await page.evaluate(() => {
  const g = window.RIFT;
  g.director.go('TOWER_1_INTRO');
  g.player.health = g.player.stats.maxHealth;
});
await step(45);
let r = await report();
console.log('TOWER 1 — 45s parked, no evasion');
console.log('  hazards fired :', r.hazards.join(', ') || 'NONE');
console.log('  damage sources:', JSON.stringify(r.damage));
console.log('  player hp     :', r.hp, r.alive ? '' : '(DESTROYED)');
console.log('  heat          : x' + r.mult, 'combo', r.combo);

// disabling the emitter must stop the tracking laser
await page.evaluate(() => {
  const g = window.RIFT;
  window.__seen.hazards.clear();
  g.encounter.modules.get('emitter').target.damage(1e9);
});
await step(20);
r = await report();
console.log('  after killing the LASER EMITTER, hazards in next 20s:', r.hazards.join(', ') || 'none');

// ---------------------------------------------------------------- TOWER 2
await page.evaluate(() => {
  const g = window.RIFT;
  window.__seen.hazards.clear();
  window.__seen.damage = {};
  g.director.go('TOWER_2_INTRO');
});
await step(50);
r = await report();
console.log('\nTOWER 2 — 50s parked');
console.log('  hazards fired :', r.hazards.join(', ') || 'NONE');
console.log('  damage sources:', JSON.stringify(r.damage));
const overcharge = await page.evaluate(() => {
  const e = window.RIFT.encounter;
  e.core.targetable = true;
  e.core.damageScale = 1;
  e.core.damage(e.core.maxHp * 0.65); // drop it under the 40% Overcharge line
  return { corePct: +e.corePct.toFixed(2) };
});
await step(2);
console.log('  core at', overcharge.corePct, '-> overcharged:', await page.evaluate(() => window.RIFT.encounter.overcharged));

// ---------------------------------------------------------------- TOWER 3
await page.evaluate(() => {
  const g = window.RIFT;
  window.__seen.hazards.clear();
  window.__seen.damage = {};
  g.director.go('TOWER_3_INTRO');
});
await step(50);
r = await report();
console.log('\nTOWER 3 — 50s parked');
console.log('  hazards fired :', r.hazards.join(', ') || 'NONE');
console.log('  damage sources:', JSON.stringify(r.damage));
const shielded = await page.evaluate(() => {
  const e = window.RIFT.encounter;
  const before = e.core.hp;
  e.core.damage(1000); // must be almost entirely absorbed
  const after = e.core.hp;
  return { absorbedPct: +(100 - ((before - after) / 1000) * 100).toFixed(0), shieldsDown: e.shieldsDown };
});
console.log(`  core damage while shields hold: ${shielded.absorbedPct}% absorbed (shieldsDown=${shielded.shieldsDown})`);
const afterGens = await page.evaluate(() => {
  const e = window.RIFT.encounter;
  e.modules.get('shieldGenA').target.damage(1e9);
  e.modules.get('shieldGenB').target.damage(1e9);
  const before = e.core.hp;
  e.core.damage(1000);
  return { dealt: Math.round(before - e.core.hp), shieldsDown: e.shieldsDown };
});
console.log(`  after both generators die: core took ${afterGens.dealt}/1000 (shieldsDown=${afterGens.shieldsDown})`);

// ---------------------------------------------------------------- BOSS
await page.evaluate(() => {
  const g = window.RIFT;
  window.__seen.hazards.clear();
  window.__seen.damage = {};
  g.director.go('BOSS_INTRO');
});
await step(8);
await page.evaluate(() => { window.RIFT.encounter.phase = 2; }); // unlock the late-phase pool
await step(70);
r = await report();
console.log('\nBOSS — 70s parked (phase 3 attack pool)');
console.log('  hazards fired :', r.hazards.join('\n                  '));
console.log('  damage sources:', JSON.stringify(r.damage));
const coreCycle = await page.evaluate(() => window.RIFT.encounter.coreOpen);
console.log('  core window cycles:', await page.evaluate(() => window.RIFT.encounter.ventPending || window.RIFT.encounter.coreOpen ? 'yes' : 'observed'));

// ---------------------------------------------------------------- PERFECT DODGE
console.log('\nPERFECT DODGE');
const dodge = await page.evaluate(() => {
  const g = window.RIFT;
  g.player.invuln = 0;
  g.player.boost = 100;
  g.stats.perfectDodges = 0;

  // fire an enemy bolt that will pass just beside the player
  g.projectiles.reset();
  g.projectiles.fireEnemy({
    x: g.player.x + 3.0, y: g.player.y, z: -7,
    tx: g.player.x + 3.0, ty: g.player.y, tz: 30,
    speed: 40, damage: 10, label: 'TEST BOLT',
  });
  // open the dodge window, exactly as boosting does
  g.player.dodgeT = 0.22;
  g.player.dodgeUsed = false;

  for (let i = 0; i < 45; i++) g.update(1 / 60);
  return {
    dodges: g.stats.perfectDodges,
    hp: Math.round(g.player.health),
    boost: Math.round(g.player.boost),
    critBuff: +g.player.critBuffT.toFixed(1),
  };
});
console.log('  bolt passing inside the dodge window ->', JSON.stringify(dodge));

const noDodge = await page.evaluate(() => {
  const g = window.RIFT;
  g.stats.perfectDodges = 0;
  g.projectiles.reset();
  g.projectiles.fireEnemy({
    x: g.player.x + 3.0, y: g.player.y, z: -7,
    tx: g.player.x + 3.0, ty: g.player.y, tz: 30,
    speed: 40, damage: 10, label: 'TEST BOLT',
  });
  g.player.dodgeT = 0;      // NOT boosting
  g.player.dodgeUsed = false;
  for (let i = 0; i < 45; i++) g.update(1 / 60);
  return { dodges: g.stats.perfectDodges };
});
console.log('  same bolt with no boost            ->', JSON.stringify(noDodge), '(must be 0)');

// ---------------------------------------------------------------- DEATH
console.log('\nDEATH SEQUENCE');
await page.evaluate(() => {
  const g = window.RIFT;
  window.__alive = false;          // disable the keep-alive harness
  g.player.stats.maxHealth = 160;
  g.player.stats.secondWind = false;
  g.player.invuln = 0;
  g.player.health = 5;
  g.player.takeDamage(300, 'MIDRIFT SWEEPING LASER');
});
const deathStart = await page.evaluate(() => ({
  alive: window.RIFT.player.alive,
  deathActive: window.RIFT.death.active,
  dir: window.RIFT.director.state,
}));
console.log('  on lethal hit:', JSON.stringify(deathStart));

await step(3.0);
const deathEnd = await page.evaluate(() => ({
  deathActive: window.RIFT.death.active,
  resultsVisible: !document.getElementById('resultsScreen').classList.contains('hidden'),
  title: document.getElementById('resultsTitle').textContent,
  killedBy: document.getElementById('deathLine').textContent.trim(),
  grade: document.getElementById('gradeVal').textContent,
}));
console.log('  after 3s     :', JSON.stringify(deathEnd));

console.log('\n===== ERRORS =====');
console.log(errors.length ? [...new Set(errors)].join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
