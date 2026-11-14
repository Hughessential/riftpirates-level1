import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});
const errors = [];

const ready = page => page.waitForFunction(
  () => window.RIFT && !document.getElementById('launchBtn').disabled,
  { timeout: 120000 },
);
const confirmLaunch = async page => {
  await page.click('#launchBtn');
  if (await page.$('#pilotIdentityDialog[open]')) await page.click('#pilotNameDefault');
  await page.waitForFunction(() => RIFT.running, { timeout: 30000 });
};

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    // Exercise the real-player first-run path; production intentionally skips
    // unsolicited onboarding under navigator.webdriver.
    Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false });
    window.__tutorialPads = [];
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__tutorialPads });
  });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready(page);
  await confirmLaunch(page);

  await page.evaluate(async () => {
    const inputUrl = performance.getEntriesByType('resource')
      .find(entry => /\/src\/core\/Input\.js(?:\?|$)/.test(entry.name)).name;
    window.__tutorialInput = (await import(inputUrl)).Input;
    const g = RIFT;
    window.__tutorialUpdate = g.update.bind(g);
    g.update = () => {};
    g.director.go('TRAVERSAL_1');
    __tutorialUpdate(.01);
  });

  const initial = await page.evaluate(() => ({
    active: RIFT.tutorial.active,
    phase: RIFT.tutorial.phase,
    step: RIFT.tutorial.step,
    blocksRoute: RIFT.tutorial.blocksRoute,
    title: RIFT.tutorial.title.textContent,
    copy: RIFT.tutorial.copy.textContent,
    routeTime: RIFT.director.stateT,
    transition: getComputedStyle(RIFT.tutorial.progress).transitionDuration,
  }));
  assert.equal(initial.active, true, 'A real first flight starts onboarding');
  assert.equal(initial.phase, 'actions');
  assert.equal(initial.step, 0);
  assert.equal(initial.blocksRoute, true);
  assert.match(initial.title, /1\/9.*TAKE THE HELM/);
  assert.match(initial.copy, /WASD|ARROW/);
  assert.equal(initial.transition, '0s', 'Tutorial presentation honors reduced motion');

  const controllerCopy = await page.evaluate(() => {
    window.__tutorialPad = { id:'Tutorial Controller',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],
      buttons:Array.from({length:18},()=>({pressed:false,value:0})) };
    __tutorialPad.buttons[12]={pressed:true,value:1}; __tutorialPads=[__tutorialPad];
    __tutorialInput.pollGamepad(); RIFT.tutorial.update(0);
    const copy=RIFT.tutorial.copy.textContent;
    __tutorialPad.buttons[12]={pressed:false,value:0}; __tutorialInput.pollGamepad();
    return copy;
  });
  assert.match(controllerCopy,/LEFT STICK/,'A real controller action switches contextual copy');
  await page.keyboard.press('x');
  await page.evaluate(() => RIFT.tutorial.update(0));
  assert.match(await page.evaluate(() => RIFT.tutorial.copy.textContent),/WASD|ARROW/,
    'A later keyboard action wins over an idle connected controller');

  // Pausing owns time. Neither the lesson nor the route can advance underneath it.
  await page.evaluate(() => { RIFT.paused = true; __tutorialUpdate(.8); });
  assert.deepEqual(await page.evaluate(() => [RIFT.tutorial.step, RIFT.tutorial.stepTime, RIFT.director.stateT]),
    [0, .01, initial.routeTime]);
  await page.evaluate(() => { RIFT.paused = false; });

  const action = async (code, extra = 0) => page.evaluate(({ code, extra }) => {
    __tutorialInput._keys[code] = true;
    __tutorialUpdate(.25 + extra);
    __tutorialInput._keys[code] = false;
  }, { code, extra });

  await action('KeyA');
  assert.equal(await page.evaluate(() => RIFT.tutorial.step), 1, 'Movement advances the first lesson');
  await action('Space');
  assert.equal(await page.evaluate(() => RIFT.tutorial.step), 2, 'Manual fire advances the cannon lesson');
  await action('ShiftLeft');
  assert.equal(await page.evaluate(() => RIFT.tutorial.step), 3, 'Boost advances the engine lesson');
  await action('KeyC');
  assert.equal(await page.evaluate(() => RIFT.tutorial.step), 4, 'Brake advances the flight-control lesson');

  // Q/E and double-taps both feed the normal barrel-roll queue. A second frame
  // lets the tutorial observe Player.rollT after Player consumes that request.
  await page.keyboard.down('q');
  await page.evaluate(() => __tutorialUpdate(.25));
  await page.keyboard.up('q');
  await page.evaluate(() => __tutorialUpdate(.25));
  assert.equal(await page.evaluate(() => RIFT.tutorial.step), 5, 'A real barrel roll advances the roll lesson');

  await page.evaluate(() => __tutorialUpdate(.01));
  const targetPressure = await page.evaluate(() => {
    const enemy = RIFT.tutorial.enemy;
    return {
      alive: RIFT.enemies.countAlive(),
      label: enemy?.target?.label,
      hpScale: enemy?.target?.maxHp / enemy?.type?.hp,
      fireDelay: enemy?.fireT,
      specialDelay: enemy?.special?.cooldown,
      routeTime: RIFT.director.stateT,
      maxNormalEnemies: RIFT.director.data.cfg.maxEnemies,
    };
  });
  assert.equal(targetPressure.alive, 1, 'Only one introductory scout is present');
  assert.equal(targetPressure.label, 'TRAINING SCOUT');
  assert.ok(targetPressure.hpScale <= .56, 'Training scout has reduced health');
  assert.ok(targetPressure.fireDelay > 11, 'Training scout has a long first-shot warning');
  assert.ok(targetPressure.routeTime < 1, 'Normal route pressure remains held during onboarding');
  assert.ok(targetPressure.alive < targetPressure.maxNormalEnemies, 'Tutorial pressure stays below the normal sector cap');

  await page.evaluate(() => {
    const target = RIFT.tutorial.enemy.target;
    target.damage(target.maxHp * 2);
    __tutorialUpdate(.25);
  });
  assert.equal(await page.evaluate(() => RIFT.tutorial.step), 6, 'Destroying the scout advances to the loot lesson');
  await page.evaluate(() => {
    const p = RIFT.player;
    for (const piece of RIFT.scrap.pool) {
      if (!piece.active) continue;
      piece.x = p.x; piece.y = p.y; piece.z = 0;
      piece.vx = piece.vy = piece.vz = 0;
    }
    RIFT.scrap.update(.016, 0);
    __tutorialUpdate(.25);
  });
  const briefing = await page.evaluate(() => ({
    phase: RIFT.tutorial.phase,
    step: RIFT.tutorial.step,
    earned: RIFT.scrap.wallet.earned,
    copy: RIFT.tutorial.copy.textContent,
  }));
  assert.equal(briefing.phase, 'briefing');
  assert.equal(briefing.step, 7);
  assert.ok(briefing.earned > 0, 'Normal scrap pickup completes the plunder lesson');
  assert.match(briefing.copy, /Three augment caches wait before every tower/);

  await page.evaluate(() => __tutorialUpdate(5.6));
  assert.deepEqual(await page.evaluate(() => [RIFT.tutorial.phase, RIFT.tutorial.blocksRoute]), ['cache', false],
    'The route resumes only after the controls/combat briefing');

  await page.evaluate(() => {
    RIFT.director.stateT = 18.95;
    __tutorialUpdate(.1);
  });
  const openingPressure = await page.evaluate(() => {
    const alive=RIFT.enemies.active.filter(enemy=>enemy.alive);
    const pressure=RIFT.tutorial.approachPressure(0,RIFT.director.stateT);
    return { count:alive.length,fireT:alive[0]?.fireT,special:alive[0]?.special?.cooldown,
      cap:pressure?.maxEnemies ?? null, configuredDelay:pressure?.routeFireDelay ?? null };
  });
  assert.equal(openingPressure.count,1,'First authored route segment admits one enemy at a time');
  assert.equal(openingPressure.cap,1,'Tutorial consumes the configured opening cap');
  assert.equal(openingPressure.configuredDelay,6.5,'Opening patrol delay remains config-owned');
  assert.ok(openingPressure.fireT>=5.5&&openingPressure.special>=5.5,
    `Opening patrol retains a generous warning after elapsed flight time: ${JSON.stringify(openingPressure)}`);

  // Advance only to the first authored cache. The tutorial observes the real
  // three-card shop and completes only after a paid installation succeeds.
  await page.evaluate(() => {
    RIFT.scrap.wallet.credit(5000);
    RIFT.director.stateT = RIFT.director.data.cfg.augmentAt[0] - .05;
    __tutorialUpdate(.1);
    __tutorialUpdate(.01);
  });
  const cache = await page.evaluate(() => ({
    open: RIFT.upgradeScreen.open,
    offers: document.querySelectorAll('#upgradeCards .upCard').length,
    saw: RIFT.tutorial.sawCache,
    title: RIFT.tutorial.title.textContent,
    copy: RIFT.tutorial.copy.textContent,
  }));
  assert.deepEqual([cache.open, cache.offers, cache.saw], [true, 3, true], 'Tutorial uses the normal three-card cache');
  assert.match(cache.title, /9\/9.*INSTALL AN AUGMENT/);
  assert.match(cache.copy, /HOLD SPACE/);
  await page.evaluate(() => document.querySelector('#upgradeCards .upCard').click());
  await page.evaluate(() => __tutorialUpdate(.3));
  const complete = await page.evaluate(() => ({
    active: RIFT.tutorial.active,
    complete: RIFT.save.data.tutorialComplete,
    persisted: JSON.parse(localStorage.getItem('riftpirates-level1-v1')).tutorialComplete,
    ranks: Object.values(RIFT.upgrades.ranks).reduce((sum, rank) => sum + rank, 0),
    picks: RIFT.director.data.picks,
  }));
  assert.deepEqual(complete, { active: false, complete: true, persisted: true, ranks: 1, picks: 1 },
    'Purchasing one real augment completes and persists first-flight onboarding');

  // A completed profile does not see unsolicited onboarding on the next run.
  await page.evaluate(() => { RIFT.prepareTitle(); RIFT.startRun(); });
  assert.equal(await page.evaluate(() => RIFT.tutorial.active), false);
  await page.close();

  // Automation/screenshot runs can bypass onboarding without mutating the save.
  const autoPage = await browser.newPage();
  autoPage.on('pageerror', error => errors.push(error.message));
  await autoPage.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready(autoPage);
  await autoPage.evaluate(() => localStorage.clear());
  await autoPage.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready(autoPage);
  await confirmLaunch(autoPage);
  assert.deepEqual(await autoPage.evaluate(() => [
    navigator.webdriver,
    RIFT.tutorial.active,
    RIFT.save.data.tutorialComplete,
  ]), [true, false, false], 'Webdriver bypass leaves the player tutorial preference untouched');
  await autoPage.evaluate(() => { RIFT.prepareTitle(); RIFT.testing.enter(); });
  assert.deepEqual(await autoPage.evaluate(() => [RIFT.tutorial.active,RIFT.director.state,RIFT.testRun]),
    [false,'TESTING',true],'Ordinary Testing Grounds entry bypasses onboarding');
  await autoPage.evaluate(() => { RIFT.prepareTitle(); RIFT.testing.enter({tutorial:true}); });
  assert.deepEqual(await autoPage.evaluate(() => [RIFT.tutorial.active,RIFT.director.state,RIFT.testRun]),
    [true,'TRAVERSAL_1',true],'Testing Grounds can explicitly start the real opening tutorial route');
  await autoPage.close();

  // Explicit QA force still wins over both webdriver bypass and a completed save.
  const forcedPage = await browser.newPage();
  forcedPage.on('pageerror', error => errors.push(error.message));
  await forcedPage.goto('http://localhost:8000/?tutorial=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await ready(forcedPage);
  await forcedPage.evaluate(() => {
    RIFT.save.data.tutorialComplete = true;
    RIFT.save.save();
  });
  await forcedPage.evaluate(() => RIFT.startRun());
  assert.equal(await forcedPage.evaluate(() => RIFT.tutorial.active), true, '?tutorial=1 forces replay');
  const reusedPatrol = await forcedPage.evaluate(() => {
    RIFT.director.go('TRAVERSAL_1');
    RIFT.tutorial.update(.01);
    RIFT.tutorial.spawnTarget();
    const training=RIFT.tutorial.enemy;
    training.target.damage(training.target.maxHp*2);
    const patrol=RIFT.enemies.spawn('scout',9,5,-40,{fx:9,fy:5,fz:-28});
    patrol.target.label='AUTHORED PATROL';
    return training===patrol;
  });
  assert.equal(reusedPatrol,true,'Regression setup reuses the pooled training hull');
  await forcedPage.evaluate(() => document.querySelector('#openingTutorial button').click());
  assert.deepEqual(await forcedPage.evaluate(() => [
    RIFT.tutorial.active,
    RIFT.tutorial.blocksRoute,
    RIFT.save.data.tutorialComplete,
    RIFT.enemies.countAlive(),
    RIFT.enemies.active.find(enemy=>enemy.alive)?.target.label,
  ]), [false, false, true, 1, 'AUTHORED PATROL'], 'Skip never clears a pooled hull reused by a live authored patrol');
  await forcedPage.evaluate(() => {
    RIFT.prepareTitle(); RIFT.startRun({tutorial:true}); RIFT.director.go('TRAVERSAL_1');
    RIFT.tutorial.update(.01); RIFT.tutorial.spawnTarget();
  });
  await forcedPage.evaluate(() => document.querySelector('#openingTutorial button').click());
  assert.deepEqual(await forcedPage.evaluate(() => [RIFT.enemies.countAlive(),RIFT.scrap.metrics.authorized]),[0,0],
    'Skip retires the exact live training target without awarding a cleanup kill');
  await forcedPage.close();

  assert.deepEqual(errors, []);
  console.log('PASS: first-run action/combat/loot/cache onboarding, reduced pressure/motion, pause safety, paid completion, persistence, replay force, skip and automation bypass.');
} finally {
  await browser.close();
}
