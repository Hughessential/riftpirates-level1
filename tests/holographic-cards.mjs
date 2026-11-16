import { launchRun } from './helpers/start-run.mjs';
/** Browser coverage for the reusable card presentation and the existing cache input path. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const artifacts = '/tmp/riftpirates-holographic-cards';
await mkdir(artifacts, { recursive: true });
const errors = [];
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, hasTouch: true });
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    // Capture one consistent source snapshot while other agents edit modules.
    // The game has no network gameplay; this only suspends Vite's HMR socket.
    window.WebSocket = class extends EventTarget { readyState = 0; send() {} close() {} };
    window.__pads = [];
    Object.defineProperty(navigator, 'getGamepads', { value: () => window.__pads });
  });
  await page.goto(process.env.RIFT_TEST_URL || 'http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.RIFT && !document.getElementById('launchBtn').disabled, { timeout: 120000 });
  await launchRun(page);
  await page.evaluate(async () => {
    // Reuse the exact Vite module URLs, including HMR query strings, to avoid duplicate singletons.
    const loaded = path => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith(path))?.name;
    window.__input = (await import(loaded('/src/core/Input.js'))).Input;
    window.__cardModule = await import(loaded('/src/ui/HolographicAugmentCard.js'));
    window.__registry = (await import(loaded('/src/systems/UpgradeSystem.js'))).UPGRADES;
    window.__feedback = await import(loaded('/src/ui/AugmentFeedback.js'));
    RIFT.update = () => {};
    RIFT.renderFrame = () => {};
    RIFT.scrap.wallet.credit(100000);
    window.__done = 0;
    window.__checkpoint = 0;
    window.__show = (tiers, source) => {
      const checkpoint = __checkpoint++;
      source ||= { sector: Math.floor(checkpoint / 3), checkpoint: checkpoint % 3 };
      window.__lastSource = source;
      const offer = RIFT.upgrades.offer;
      if (tiers) RIFT.upgrades.offer = function(source) {
        return offer.call(this, source).map((up, i) => ({ ...up, rarity: tiers[i] }));
      };
      try { RIFT.upgradeScreen.show(source, '#24ffe0', () => { __done++; }); }
      finally { RIFT.upgrades.offer = offer; }
    };
    window.__preview = (ids, tiers) => {
      __show();
      const cards = ids.map((id, index) => {
        const up = { ...__registry[id], id, rank: 1, currentRank: 0, rarity: tiers?.[index], price: [250, 650, 1600][index], walletBalance: 3200 };
        return __cardModule.createHolographicAugmentCard(up, {
          index, delta: __feedback.augmentDelta(up, RIFT.upgrades.stats, 1), onSelect: () => {},
        });
      });
      RIFT.upgradeScreen.cards.replaceChildren(...cards);
    };
    window.__settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.__layout = () => [...document.querySelectorAll('#upgradeCards .holoCard')].flatMap(card => {
      const faults = [];
      const box = card.getBoundingClientRect();
      const label = card.dataset.augmentId;
      if (box.left < -1 || box.right > innerWidth + 1) faults.push(`${label}: horizontal overflow`);
      const fields = ['h3', '.holoDescription', '.upStackEffect', '.upActualDelta', '.holoEconomy', '.upTake'];
      let previous;
      for (const selector of fields) {
        const el = card.querySelector(selector);
        if (!el || !el.textContent.trim()) { faults.push(`${label}: missing live ${selector}`); continue; }
        const rect = el.getBoundingClientRect();
        if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) faults.push(`${label}: clipped ${selector}`);
        if (rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1) faults.push(`${label}: ${selector} outside card`);
        if (previous && previous.bottom > rect.top + 1) faults.push(`${label}: overlapping ${selector}`);
        previous = rect;
      }
      return faults;
    });
    window.__tick = () => { __input.pollGamepad(); RIFT.controllerMenus.update(); RIFT.upgradeScreen.update(); };
    window.__pad = {
      id: 'OHSNAP MCON / holographic card test', index: 0, connected: true, mapping: 'standard',
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
    };
    window.__press = index => {
      __pad.buttons[index] = { pressed: true, value: 1 }; __tick();
      __pad.buttons[index] = { pressed: false, value: 0 }; __tick();
    };
    await document.fonts.ready;
  });

  const show = async tiers => {
    await page.evaluate(tiers => __show(tiers), tiers);
    await page.waitForSelector('#upgradeScreen.in .holoCard');
    await page.evaluate(() => __settle());
  };
  const finish = async (before, done) => {
    assert.equal(await page.evaluate(() => RIFT.upgrades.taken.length), before + 1, 'Exactly one augment installs');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.holoCard.installing').length), 1, 'Chosen card plays installation feedback');
    await page.evaluate(() => RIFT.scheduler.update(.3));
    assert.equal(await page.evaluate(() => __done), done + 1, 'Dismissal completes exactly once');
    assert.equal(await page.evaluate(() => RIFT.upgradeScreen.el.classList.contains('hidden')), true);
  };

  await show();
  const backdrop = await page.$eval('#upgradeBackdrop', el => {
    const rect = el.getBoundingClientRect();
    return { display: getComputedStyle(el).display, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  });
  assert.deepEqual(backdrop, { display: 'block', left: 0, top: 0, right: 1440, bottom: 900 },
    'The unscaled augment backdrop covers every viewport edge');
  const originalScale = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-user-scale'));
  for (const [width, height] of [[2560, 1296], [1440, 900], [390, 844]]) {
    await page.setViewport({ width, height, hasTouch: true });
    for (const scale of [.8, 1, 1.1, 1.25, 1.4]) {
      await page.evaluate(scale => document.documentElement.style.setProperty('--ui-user-scale', String(scale)), scale);
      const bounds = await page.$eval('#upgradeBackdrop', el => {
        const r = el.getBoundingClientRect(), css = getComputedStyle(el);
        return { x: r.x, y: r.y, width: r.width, height: r.height, display: css.display, pointerEvents: css.pointerEvents };
      });
      assert.deepEqual(bounds, { x: 0, y: 0, width, height, display: 'block', pointerEvents: 'none' },
        `Backdrop covers every edge at ${width}x${height}, UI scale ${scale}`);
    }
  }
  await page.evaluate(scale => document.documentElement.style.setProperty('--ui-user-scale', scale), originalScale);
  await page.setViewport({ width: 1440, height: 900, hasTouch: true });
  await page.evaluate(async () => { __preview(Object.keys(__registry).slice(0, 3)); await __settle(); });
  const defaults = await page.$$eval('#upgradeCards .holoCard', cards => cards.map(card => ({
    tag: card.tagName, rarity: card.dataset.rarity, label: card.querySelector('.holoRarity')?.textContent,
    nestedControls: card.querySelectorAll('button,input,a,select').length,
  })));
  assert.equal(defaults.length, 3, 'Cache keeps exactly three offers');
  assert.ok(defaults.every(card => card.tag === 'BUTTON' && card.rarity === 'standard' && card.label.includes('STANDARD') && !card.nestedControls), 'Existing augments remain standard native buttons');
  await page.waitForFunction(() => [...document.querySelectorAll('.holoIllustration')].every(img => img.complete && img.naturalWidth > 0));
  await page.screenshot({ path: `${artifacts}/standard-offers.png` });

  await show(['RARE', 'ULTRA-RARE', 'MYTHIC']);
  assert.deepEqual(await page.$$eval('.holoCard', cards => cards.map(card => card.dataset.rarity)), ['rare', 'ultra-rare', 'mythic']);
  await page.waitForFunction(() => [...document.querySelectorAll('.holoIllustration')].every(img => img.complete && img.naturalWidth > 0));
  const budget = await page.$$eval('.holoCard', cards => cards.map(card => ({
    dust: card.querySelectorAll('.holoDust i').length,
    nodes: card.querySelectorAll('*').length,
    canvas: card.querySelectorAll('canvas').length,
  })));
  assert.deepEqual(budget.map(card => card.dust), [8, 10, 14], 'Tier effects have fixed particle budgets');
  assert.ok(budget.every(card => card.nodes < 100 && card.canvas === 0), 'Cards add no WebGL contexts or unbounded particle nodes');
  await page.screenshot({ path: `${artifacts}/tiers-1440.png` });

  const actualTierNames = await page.evaluate(async () => {
    const tiers = ['RARE', 'ULTRA-RARE', 'MYTHIC'];
    const ids = tiers.map(tier => Object.keys(__registry).find(id => __registry[id].rarity === tier));
    __preview(ids, tiers);
    document.getElementById('upgradeTitle').textContent = 'COSMIC ARTIFACTS';
    document.getElementById('upgradeSub').textContent = 'PRESENTATION PREVIEW · THREE NEW AUGMENT DESIGNS';
    document.querySelector('#augmentWallet b').textContent = '3,200';
    await __settle();
    return ids.map(id => __registry[id].name);
  });
  assert.equal(actualTierNames.length, 3, 'All three new gameplay rarities have real card designs');
  await page.screenshot({ path: `${artifacts}/actual-new-tiers-1440.png` });
  for (let attempt = 0; attempt < 15; attempt++) {
    await show();
    if (await page.$$eval('.holoCard', cards => new Set(cards.map(card => card.dataset.rarity)).size > 1)) break;
  }
  await page.screenshot({ path: `${artifacts}/actual-mixed-offer-1440.png` });

  await show();
  const money = await page.$$eval('.holoCard', cards => cards.map(card => ({
    price: Number(card.dataset.price), wallet: Number(card.dataset.wallet),
    priceText: card.querySelector('.holoPrice').textContent.replaceAll(',', ''),
    remaining: card.querySelector('.holoBalance').textContent.replaceAll(',', ''),
    action: card.querySelector('.holoAction').textContent,
  })));
  assert.ok(money.every(card => card.price > 0 && Number(card.priceText) === card.price && Number(card.remaining) === card.wallet - card.price && card.action === 'PURCHASE & INSTALL'), 'Prices, wallet and remaining balance use live text');

  // Closing and reopening a pending checkpoint must never reroll its stock.
  const stable = await page.evaluate(() => {
    const source = { sector: 700, checkpoint: 2 };
    __show(null, source);
    const before = RIFT.upgradeScreen._offers.map(up => [up.id, up.rank, up.price, up.offerToken]);
    RIFT.upgradeScreen.hide();
    __show(null, source);
    return { before, after: RIFT.upgradeScreen._offers.map(up => [up.id, up.rank, up.price, up.offerToken]) };
  });
  assert.deepEqual(stable.after, stable.before, 'Pending checkpoint keeps the same cards, ranks, prices and token');
  const staleButton = await page.evaluate(() => {
    const oldCard = document.querySelector('.holoCard');
    __show();
    const before = { balance: RIFT.scrap.wallet.balance, taken: RIFT.upgrades.taken.length };
    oldCard.click();
    return { before, after: { balance: RIFT.scrap.wallet.balance, taken: RIFT.upgrades.taken.length } };
  });
  assert.deepEqual(staleButton.after, staleButton.before, 'A detached card callback cannot buy from the replacement checkpoint');

  const ids = await page.evaluate(() => Object.keys(__registry));
  for (const [width, height] of [[1440, 900], [1280, 800], [390, 844]]) {
    await page.setViewport({ width, height, hasTouch: true });
    for (let offset = 0; offset < ids.length; offset += 3) {
      await page.evaluate(async ids => { __preview(ids, ['RARE', 'ULTRA-RARE', 'MYTHIC']); await __settle(); }, ids.slice(offset, offset + 3));
      const faults = await page.evaluate(() => __layout());
      assert.deepEqual(faults, [], `All card text stays readable at ${width}×${height}`);
      if (width > 1000) {
        assert.equal(await page.$$eval('.holoCard', cards => cards.every(card => {
          const rect = card.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight + 1;
        })), true, `Desktop cards remain fully visible at ${width}×${height}`);
        assert.equal(await page.$eval('.upSkip', el => { const rect = el.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight + 1; }), true, `Skip stays visible at ${width}×${height}`);
      }
    }
    await show(['RARE', 'ULTRA-RARE', 'MYTHIC']);
    await page.screenshot({ path: `${artifacts}/tiers-${width}.png` });
    if (width < 1000) {
      for (const card of await page.$$('.holoCard')) {
        await card.evaluate(el => el.scrollIntoView({ block: 'center' }));
        const visible = await card.evaluate(el => { const rect = el.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight + 1; });
        assert.equal(visible, true, 'Each narrow-screen card can be fully scrolled into view');
      }
      await page.$eval('.upSkip', el => el.scrollIntoView({ block: 'center' }));
      assert.equal(await page.$eval('.upSkip', el => { const rect = el.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight + 1; }), true, 'Skip can be scrolled into view on touch screens');
    }
  }

  await page.setViewport({ width: 1440, height: 900, hasTouch: true });
  await show(['RARE', 'ULTRA-RARE', 'MYTHIC']);
  const liveText = () => page.$$eval('#upgradeCards .holoTop, #upgradeCards .holoBody', elements => elements.map(el => el.innerText));
  const textBefore = await liveText();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluate(() => __settle());
  assert.deepEqual(await liveText(), textBefore, 'Reduced motion preserves all information');
  assert.equal(await page.$eval('#upgradeCards', el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && animation.effect.getTiming().iterations === Infinity).length), 0, 'Reduced motion stops all decorative loops');
  await page.screenshot({ path: `${artifacts}/reduced-motion.png` });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

  // A confirm held before the cache appears is carryover, not intent. Require
  // release and a brand-new hold for both keyboard and physical controller A.
  await page.evaluate(() => RIFT.upgradeScreen.hide());
  await page.keyboard.down('Space');
  await show();
  const keyboardCarry = await page.evaluate(() => ({ before:RIFT.upgrades.taken.length, done:__done }));
  await new Promise(resolve => setTimeout(resolve, 650));
  await page.evaluate(() => RIFT.upgradeScreen.update());
  assert.deepEqual(await page.evaluate(() => ({ taken:RIFT.upgrades.taken.length, open:RIFT.upgradeScreen.open, holding:document.querySelector('.holoCard').classList.contains('holding') })),
    { taken:keyboardCarry.before, open:true, holding:false }, 'Space held before opening cannot purchase or begin progress');
  await page.keyboard.up('Space');
  await page.evaluate(() => RIFT.upgradeScreen.update());
  await page.keyboard.down('Space');
  await page.evaluate(() => RIFT.upgradeScreen.update());
  await new Promise(resolve => setTimeout(resolve, 650));
  await page.evaluate(() => RIFT.upgradeScreen.update());
  await page.keyboard.up('Space');
  await finish(keyboardCarry.before, keyboardCarry.done);

  const controllerCarry = await page.evaluate(() => {
    __pads=[__pad]; __pad.buttons[0]={pressed:true,value:1}; __input.pollGamepad();
    const before=RIFT.upgrades.taken.length, done=__done;
    __show();
    return { before, done };
  });
  await page.waitForSelector('#upgradeScreen.in .holoCard');
  await new Promise(resolve => setTimeout(resolve, 650));
  await page.evaluate(() => __tick());
  assert.deepEqual(await page.evaluate(() => ({ taken:RIFT.upgrades.taken.length, open:RIFT.upgradeScreen.open, holding:document.querySelector('.holoCard').classList.contains('holding') })),
    { taken:controllerCarry.before, open:true, holding:false }, 'Controller A held before opening cannot purchase or begin progress');
  await page.evaluate(() => { __pad.buttons[0]={pressed:false,value:0}; __tick(); __pad.buttons[0]={pressed:true,value:1}; __tick(); });
  await new Promise(resolve => setTimeout(resolve, 650));
  await page.evaluate(() => { __tick(); __pad.buttons[0]={pressed:false,value:0}; __tick(); });
  await finish(controllerCarry.before, controllerCarry.done);

  await show();
  await page.evaluate(() => RIFT.upgradeScreen._select(0));
  const pausedHold = await page.evaluate(() => ({ before:RIFT.upgrades.taken.length, done:__done }));
  await page.keyboard.down('Space');
  await page.evaluate(() => RIFT.upgradeScreen.update());
  await new Promise(resolve => setTimeout(resolve, 250));
  await page.evaluate(() => RIFT.upgradeScreen.update());
  const prePauseHold = await page.evaluate(() => ({
    holding:RIFT.upgradeScreen.cards.children[RIFT.upgradeScreen.sel].classList.contains('holding'), raw:__input.purchaseConfirmHeld,
    latch:RIFT.upgradeScreen._holdLatch, paused:RIFT.paused, open:RIFT.upgradeScreen.open,
    sel:RIFT.upgradeScreen.sel, active:document.activeElement?.className,
  }));
  assert.equal(prePauseHold.holding, true, `Fresh hold begins before pause: ${JSON.stringify(prePauseHold)}`);
  await page.evaluate(() => RIFT.togglePause());
  assert.deepEqual(await page.evaluate(() => ({ paused:RIFT.paused, holding:[...document.querySelectorAll('.holoCard')].some(card => card.classList.contains('holding')) })),
    { paused:true, holding:false }, 'Pausing immediately cancels visible hold progress');
  await new Promise(resolve => setTimeout(resolve, 700));
  await page.evaluate(() => { RIFT.togglePause(); RIFT.upgradeScreen.update(); });
  await new Promise(resolve => setTimeout(resolve, 650));
  await page.evaluate(() => RIFT.upgradeScreen.update());
  assert.deepEqual(await page.evaluate(() => ({ taken:RIFT.upgrades.taken.length, open:RIFT.upgradeScreen.open, holding:[...document.querySelectorAll('.holoCard')].some(card => card.classList.contains('holding')) })),
    { taken:pausedHold.before, open:true, holding:false }, 'Held confirm cannot accrue wall time or resume after pause');
  await page.keyboard.up('Space');
  await page.evaluate(() => RIFT.upgradeScreen.update());
  await page.keyboard.down('Space');
  await page.evaluate(() => RIFT.upgradeScreen.update());
  await new Promise(resolve => setTimeout(resolve, 650));
  await page.evaluate(() => RIFT.upgradeScreen.update());
  await page.keyboard.up('Space');
  await finish(pausedHold.before, pausedHold.done);

  for (const key of ['Enter', 'Space']) {
    await show();
    const skip = await page.evaluate(() => ({ before:RIFT.upgrades.taken.length, done:__done, balance:RIFT.scrap.wallet.balance }));
    await page.focus('.upSkip');
    await page.keyboard.press(key);
    assert.equal(await page.evaluate(() => RIFT.upgradeScreen.open), false, `${key} natively activates focused Skip`);
    await page.evaluate(() => RIFT.scheduler.update(.3));
    assert.deepEqual(await page.evaluate(() => ({ taken:RIFT.upgrades.taken.length, done:__done, balance:RIFT.scrap.wallet.balance })),
      { taken:skip.before, done:skip.done + 1, balance:skip.balance }, `${key} Skip neither buys nor spends`);
  }

  // The shop owns A/D, including the Skip slot, and wraps without feeding a
  // gameplay roll request into the player beneath the overlay.
  await show();
  await page.evaluate(() => { __input.enabled = false; __input._rollQueue = 0; RIFT.upgradeScreen._select(0); });
  await page.keyboard.press('KeyA');
  assert.deepEqual(await page.evaluate(() => ({ sel:RIFT.upgradeScreen.sel, skip:document.activeElement.matches('.upSkip'), roll:__input.consumeRoll() })),
    { sel:3, skip:true, roll:0 }, 'A wraps left from the first card to Skip without rolling');
  await page.keyboard.press('KeyD');
  assert.deepEqual(await page.evaluate(() => ({ sel:RIFT.upgradeScreen.sel, first:document.activeElement.matches('.holoCard:nth-child(1)'), roll:__input.consumeRoll() })),
    { sel:0, first:true, roll:0 }, 'D wraps right from Skip to the first card without rolling');
  await page.evaluate(() => { RIFT.upgradeScreen.hide(); __input.enabled = true; });

  for (const input of ['mouse', 'keyboard', 'keyboard-focus', 'touch', 'gamepad']) {
    await show();
    const index = input === 'mouse' ? 0 : input === 'touch' ? 2 : 1;
    const { before, done, expectedId, balance, price, spent } = await page.evaluate(index => ({
      before: RIFT.upgrades.taken.length, done: __done, expectedId: RIFT.upgradeScreen._offers[index].id,
      balance: RIFT.scrap.wallet.balance, spent: RIFT.scrap.wallet.spent, price: RIFT.upgradeScreen._offers[index].price,
    }), index);
    if (input === 'mouse') await page.click('.holoCard:nth-child(1)');
    if (input === 'keyboard') {
      await page.keyboard.press('Digit2');
      assert.equal(await page.evaluate(() => RIFT.upgrades.taken.length), before, 'Number key focuses without purchasing');
      await page.keyboard.down('Space');
      await page.evaluate(() => RIFT.upgradeScreen.update());
      await new Promise(resolve => setTimeout(resolve, 250));
      await page.evaluate(() => RIFT.upgradeScreen.update());
      assert.equal(await page.$eval('.holoCard:nth-child(2)', card => card.classList.contains('holding') && Number(card.style.getPropertyValue('--hold-progress')) > 0), true, 'Hold progress is visible');
      await page.keyboard.up('Space');
      await page.evaluate(() => RIFT.upgradeScreen.update());
      assert.equal(await page.evaluate(() => RIFT.upgrades.taken.length), before, 'Early release cancels cleanly');
      await page.keyboard.down('Space');
      await page.evaluate(() => RIFT.upgradeScreen.update());
      await new Promise(resolve => setTimeout(resolve, 650));
      await page.evaluate(() => RIFT.upgradeScreen.update());
      await page.keyboard.up('Space');
    }
    if (input === 'keyboard-focus') {
      await page.focus('.holoCard:nth-child(1)');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.matches('.holoCard:nth-child(2)')), true, 'Native keyboard focus reaches the next card');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => RIFT.upgrades.taken.length), before, 'Enter cannot bypass hold confirmation');
      await page.keyboard.down('Space'); await page.evaluate(() => RIFT.upgradeScreen.update());
      await new Promise(resolve => setTimeout(resolve, 650));
      await page.evaluate(() => RIFT.upgradeScreen.update()); await page.keyboard.up('Space');
    }
    if (input === 'touch') {
      const card = await page.$('.holoCard:nth-child(3)');
      const box = await card.boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    }
    if (input === 'gamepad') {
      await page.evaluate(() => { __pads = [__pad]; __tick(); __press(15); });
      assert.equal(await page.evaluate(() => document.activeElement.matches('.holoCard')), true, 'Controller focuses a native card');
      await page.evaluate(() => { __pad.buttons[0]={pressed:true,value:1}; __tick(); });
      await new Promise(resolve => setTimeout(resolve, 650));
      await page.evaluate(() => { __tick(); __pad.buttons[0]={pressed:false,value:0}; __tick(); });
    }
    await page.evaluate(() => {
      document.querySelector('.holoCard').click();
      dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', repeat: true }));
    });
    await finish(before, done);
    assert.equal(await page.evaluate(() => RIFT.upgrades.taken.at(-1)), expectedId, `${input} installs the selected card`);
    assert.equal(await page.evaluate(() => RIFT.scrap.wallet.balance), balance - price, `${input} charges exactly once`);
    assert.equal(await page.evaluate(() => RIFT.scrap.wallet.spent), spent + price, `${input} records one spend`);
  }

  for (const input of ['mouse', 'keyboard', 'keyboard-focus', 'touch', 'gamepad']) {
    await page.evaluate(() => RIFT.scrap.wallet.reset());
    await show();
    assert.equal(await page.$$eval('.holoCard', cards => cards.every(card => card.getAttribute('aria-disabled') === 'true' && !card.disabled && card.querySelector('.holoMoneyLabel').textContent === 'MISSING / SCRAP')), true, 'Unaffordable cards remain inspectable');
    const before = await page.evaluate(() => ({ taken: RIFT.upgrades.taken.length, done: __done }));
    await page.click('.holoCard');
    await page.keyboard.press('Digit2');
    assert.equal(await page.evaluate(() => RIFT.upgradeScreen.open), true, 'Invalid purchase keeps the shop open');
    assert.equal(await page.evaluate(() => RIFT.upgrades.taken.length), before.taken, 'Insufficient funds cannot install');
    assert.equal(await page.evaluate(() => RIFT.scrap.wallet.balance), 0, 'Insufficient funds cannot debit');
    if (input === 'mouse') await page.click('.upSkip');
    if (input === 'keyboard') await page.keyboard.press('KeyS');
    if (input === 'keyboard-focus') { await page.focus('.upSkip'); await page.keyboard.press('Enter'); }
    if (input === 'touch') {
      const skip = await page.$('.upSkip');
      const box = await skip.boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    }
    if (input === 'gamepad') {
      await page.evaluate(() => {
        __pads = [__pad]; __tick();
        RIFT.controllerMenus.focus(document.querySelector('.holoCard'));
        __press(15); __press(15); __press(15);
      });
      assert.equal(await page.evaluate(() => document.activeElement.matches('.upSkip')), true, 'D-pad reaches Skip & Save');
      await page.evaluate(() => __press(0));
    }
    await page.evaluate(() => { document.querySelector('.upSkip').click(); RIFT.scheduler.update(.3); });
    assert.equal(await page.evaluate(() => __done), before.done + 1, `${input} skip continues once`);
    assert.equal(await page.evaluate(() => RIFT.upgrades.taken.length), before.taken, `${input} skip grants no augment`);
    assert.equal(await page.evaluate(() => RIFT.scrap.wallet.balance), 0, `${input} skip spends nothing`);
  }

  await show();
  const exact = await page.evaluate(() => {
    const up = RIFT.upgradeScreen._offers[0];
    RIFT.scrap.wallet.credit(up.price);
    RIFT.upgradeScreen.update();
    return { before: RIFT.upgrades.taken.length, done: __done, price: up.price };
  });
  assert.equal(await page.$eval('.holoCard', card => card.getAttribute('aria-disabled')), 'false', 'Exact-price balance enables purchase');
  await page.click('.holoCard');
  await finish(exact.before, exact.done);
  assert.equal(await page.evaluate(() => RIFT.scrap.wallet.balance), 0, 'Exact-price purchase leaves zero');
  const completedShop = await page.evaluate(() => {
    const opened = RIFT.upgradeScreen.show(__lastSource, '#24ffe0', () => { __done++; });
    return { opened, hidden: RIFT.upgradeScreen.el.classList.contains('hidden'), open: RIFT.upgradeScreen.open };
  });
  assert.deepEqual(completedShop, { opened: false, hidden: true, open: false }, 'A completed checkpoint cannot open an empty shop');
  await page.evaluate(() => RIFT.scrap.wallet.credit(100000));

  // An old installation cannot close a replacement offer or run its callback.
  await show();
  const staleDone = await page.evaluate(() => {
    const done = __done;
    document.querySelector('.holoCard').click();
    __show();
    RIFT.scheduler.update(1);
    return done;
  });
  assert.equal(await page.evaluate(() => __done), staleDone);
  assert.equal(await page.evaluate(() => RIFT.upgradeScreen.open), true);
  assert.equal(await page.evaluate(() => RIFT.upgradeScreen.el.classList.contains('hidden')), false);

  // Pausing blocks both pointer and keyboard installs and suspends the aura.
  const pausedBefore = await page.evaluate(() => {
    RIFT.togglePause();
    const count = RIFT.upgrades.taken.length;
    document.querySelector('.holoCard').click();
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1' }));
    return count;
  });
  assert.equal(await page.evaluate(() => RIFT.upgrades.taken.length), pausedBefore);
  await page.evaluate(() => __settle());
  assert.equal(await page.$eval('#upgradeCards', el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && animation.effect.getTiming().iterations === Infinity).length), 0, 'Pause stops card effects');
  await page.evaluate(() => { RIFT.togglePause(); RIFT.upgradeScreen.hide(); });
  assert.equal(await page.$eval('#upgradeCards', el => el.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length), 0, 'Hidden cards do no animation work');
  assert.equal(await page.$eval('#upgradeBackdrop', el => getComputedStyle(el).display), 'none', 'Closing the shop removes its full-screen dimmer');
  assert.deepEqual(errors, []);
  console.log(`PASS: ${ids.length} augment texts at desktop/narrow sizes, rarity art and bounded effects, reduced motion, paid mouse/keyboard/touch/virtual MCON, zero-wallet skips, exact-price and single-charge transactions, stable offers and stale callback safety. Screenshots: ${artifacts}`);
} finally {
  await browser.close();
}
