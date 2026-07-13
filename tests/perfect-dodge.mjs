import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', protocolTimeout: 120000,
  args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--mute-audio','--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errs=[]; page.on('pageerror', e=>errs.push(e.message));
await page.goto('http://localhost:8000/index.html', { waitUntil:'domcontentloaded' });
await new Promise(r=>setTimeout(r,700));
await page.click('#launchBtn');
await new Promise(r=>setTimeout(r,400));
await page.evaluate(()=>{ window.RIFT.renderer.render=()=>{}; });

// get into a combat state so CollisionSystem runs
await page.evaluate(()=>{ window.RIFT.director.go('TOWER_1_INTRO'); });
await page.evaluate(()=>{ for(let i=0;i<200;i++) window.RIFT.update(1/60); });

const trial = (boost, lateral, startZ, speed) => page.evaluate(({boost, lateral, startZ, speed}) => {
  const g = window.RIFT;
  const p = g.player;
  p.health = p.stats.maxHealth = 500;
  p.invuln = 0; p.boost = 100;
  g.stats.perfectDodges = 0;
  g.enemies.clear();
  g.clearHazards();
  g.projectiles.reset();

  // a bolt that will sail past the player during the dodge window
  g.projectiles.fireEnemy({
    x: p.x + lateral, y: p.y, z: startZ,
    tx: p.x + lateral, ty: p.y, tz: startZ + 100,
    speed, damage: 15, label: 'TEST BOLT',
  });

  if (boost) { p.dodgeT = 0.22; p.dodgeUsed = false; }
  else { p.dodgeT = 0; p.dodgeUsed = false; }

  const hp0 = p.health;
  for (let i = 0; i < 40; i++) g.update(1/60);
  return {
    dodges: g.stats.perfectDodges,
    dmg: Math.round(hp0 - p.health),
    boostRefund: Math.round(p.boost),
    critBuff: +p.critBuffT.toFixed(2),
    combo: g.heat.combo,
  };
}, {boost, lateral, startZ, speed});

console.log('Perfect Dodge — bolt passes 3.0u beside the player, arriving inside the 0.22s window');
console.log('  BOOSTING  :', JSON.stringify(await trial(true,  3.0, -6, 40)));
console.log('  NOT boost :', JSON.stringify(await trial(false, 3.0, -6, 40)), ' (must be 0 dodges)');
console.log('\nControl — bolt on a direct hit line (0.0u): boosting must NOT save you');
console.log('  BOOSTING  :', JSON.stringify(await trial(true,  0.0, -6, 40)), ' (should take damage)');
console.log('\nControl — bolt far away (12u): boosting must NOT award a dodge');
console.log('  BOOSTING  :', JSON.stringify(await trial(true, 12.0, -6, 40)), ' (must be 0 dodges)');
console.log('\nERRORS:', errs.length?errs.join('\n'):'none');
await browser.close();
