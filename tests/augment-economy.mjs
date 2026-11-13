import assert from 'node:assert/strict';
import { UpgradeSystem, UPGRADES, buildAugmentStats } from '../src/systems/UpgradeSystem.js';
import { RunWallet } from '../src/systems/RunWallet.js';
import { augmentPrice, weightedAugment, RARITY_WEIGHTS } from '../src/systems/AugmentEconomy.js';

function system(balance = 0, seed = 92) {
  const wallet = new RunWallet(); wallet.credit(balance);
  const player = { health: 100, blocksLeft: 0, blockCapacity: 0,
    applyStats(stats) { this.blocksLeft += Math.max(0, stats.freeBlocks - this.blockCapacity); this.blockCapacity = stats.freeBlocks; this.stats = stats; },
    heal(n) { this.health = Math.min(this.stats.maxHealth, this.health + n); } };
  const game = { player, scrap: { wallet }, xp: { level: 1 } };
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const upgrades = new UpgradeSystem(game, random); player.stats = upgrades.stats;
  return { upgrades, wallet, player, game, random };
}

assert.equal(Object.keys(UPGRADES).length, 75);
for (const [tier, base] of Object.entries({ STANDARD: 100, RARE: 250, 'ULTRA-RARE': 650, MYTHIC: 1600 })) {
  assert.equal(augmentPrice({ rarity: tier }), base);
  assert.equal(augmentPrice({ rarity: tier }, 1), Math.ceil(base * 1.25 / 10) * 10);
  assert.ok(Number.isSafeInteger(augmentPrice({ rarity: tier }, 1e30)));
}

{
  const { upgrades: u, wallet: w, player } = system();
  const offers = u.offer(0), token = offers[0].offerToken;
  assert.equal(offers.length, 3); assert.equal(new Set(offers.map(c => c.id)).size, 3);
  assert.equal(u.pick(offers[0].id, token), false, 'Zero funds cannot buy a card');
  assert.equal(u.pick(offers[0].id), false, 'Missing checkpoint token is rejected');
  u.cancelOffer();
  assert.deepEqual(u.offer(0), offers, 'Closing and reopening preserves IDs/ranks/prices/token');
  w.credit(100);
  assert.equal(u.pick('hullBoost', token), true, 'Exact-price purchase succeeds');
  assert.deepEqual([w.earned, w.spent, w.balance], [100, 100, 0]);
  assert.equal(player.health, 160, 'Installation heals once');
  assert.equal(u.pick('hullBoost', token), false, 'Double input does not debit twice');
  assert.deepEqual(u.offer(0), [], 'Completed checkpoint cannot be farmed');
  const next = u.offer(1);
  assert.equal(u.pick(next[0].id, token), false, 'Stale checkpoint cannot buy current card');
  assert.equal(u.skip(next[0].offerToken), true, 'Zero-wallet skip works');
  assert.equal(u.skip(next[0].offerToken), false);
  assert.equal(u.taken.length, 1);
  u.reset(); w.reset();
  assert.deepEqual([w.earned,w.spent,w.balance,u.taken.length], [0,0,0,0]);
  assert.equal(u.pick('hullBoost', token), false, 'Old-run callback cannot purchase');
}

{
  const { upgrades: u, wallet: w, player } = system(500);
  const offers = u.offer(0), before = { ...player }, stats = u.stats;
  const onPick = UPGRADES.hullBoost.onPick;
  UPGRADES.hullBoost.onPick = () => { throw new Error('Simulated failed install'); };
  try { assert.equal(u.pick('hullBoost', offers[0].offerToken), false); }
  finally { if (onPick) UPGRADES.hullBoost.onPick = onPick; else delete UPGRADES.hullBoost.onPick; }
  assert.equal(w.balance, 500); assert.equal(w.spent, 0);
  assert.equal(player.health, before.health); assert.equal(player.stats, stats);
  assert.deepEqual(u.ranks, {}); assert.equal(u.taken.length, 0);
  assert.equal(u.pick('hullBoost', offers[0].offerToken), true, 'Failed purchase remains retryable');
}

// Every random shop offers one affordable candidate if a standard purchase is possible.
for (let seed = 1; seed <= 500; seed++) {
  const { upgrades: u } = system(100, seed);
  const cards = u.offer({ sector: 0, checkpoint: 0 });
  assert.ok(cards.some(c => c.price <= 100));
  assert.equal(cards[0].category, 'ARSENAL');
  assert.ok(['SURVIVAL','MOBILITY'].includes(cards[1].category));
}

// Distribution before category/owned/affordability constraints matches declared weights.
{
  const { random } = system(); const counts = Object.fromEntries(Object.keys(RARITY_WEIGHTS).map(k => [k,0]));
  const definitions = Object.fromEntries(Object.keys(counts).map(rarity => [rarity, { rarity }]));
  for(let i=0;i<50000;i++) counts[weightedAugment(Object.keys(counts), definitions, random)]++;
  for(const [tier,weight] of Object.entries(RARITY_WEIGHTS)) assert.ok(Math.abs(counts[tier]/500-weight)<1, `${tier} distribution`);
}
for(const rank of [1,5,50]) {
  const stats = buildAugmentStats(Object.fromEntries(Object.keys(UPGRADES).map(id => [id,rank])),18);
  assert.ok(Object.values(stats).every(value => typeof value !== 'number' || Number.isFinite(value)));
  assert.equal(stats.shieldBreakDelay,14);
}
{
  const {upgrades:u}=system(100);
  for(const id of ['nexusBreaker','realityTear','secondWind'])u.ranks[id]=1;
  const cards=u.offer(4);
  assert.ok(cards.some(card=>card.price<=100),'The final fixed cache must offer an affordable eligible alternative when its three stack prices exceed the wallet');
  assert.equal(cards.filter(card=>['nexusBreaker','realityTear','secondWind'].includes(card.id)).length,2,'Only one fixed-cache identity changes for affordability');
}
console.log('PASS: 75-card registry, integer prices, paid atomic install, exact/insufficient funds, skip, stable/stale offers, rollback, rarity weights and finite stacks');
