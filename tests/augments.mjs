import assert from 'node:assert/strict';
import { UpgradeSystem, UPGRADES } from '../src/systems/UpgradeSystem.js';
import { PlayerWeapon } from '../src/player/PlayerWeapon.js';
import { Input } from '../src/core/Input.js';
import { Scheduler } from '../src/core/Scheduler.js';
import { UpgradeScreen } from '../src/ui/UpgradeScreen.js';
import { BASE_STATS } from '../src/player/Player.js';
import { WEAPON_STYLES } from '../src/config/weapons.js';

function makeSystem(seed = 1) {
  const player = {
    health: 100,
    shield: 40,
    applyStats(stats) { this.stats = stats; },
    heal(n) { this.health = Math.min(this.stats.maxHealth, this.health + n); },
  };
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const upgrades = new UpgradeSystem({ player }, random);
  player.stats = upgrades.stats;
  return { upgrades, player };
}

// Use actual randomized offers rather than granting an impossible/unoffered ID.
function offerId(upgrades, id) {
  for (let i = 0; i < 1000; i++) {
    const cards = upgrades.offer({ sector: i % 4, checkpoint: i % 3 });
    if (cards.some((card) => card.id === id)) return cards.find((card) => card.id === id);
  }
  assert.fail(`${id} must be reachable through normal approach offers`);
}

assert.equal(Object.keys(UPGRADES).length, 45, 'The catalogue contains exactly 45 distinct augments');
assert.equal(new Set(Object.values(UPGRADES).map((up) => up.category)).size, 5, 'Weapon, survival, mobility, salvage and anomaly builds are represented');
for (const [index, [id, definition]] of Object.entries(UPGRADES).entries()) {
  const { upgrades } = makeSystem(index + 500);
  assert.equal(definition.maxRank, Infinity, `${id} remains repeatable`);
  assert.ok(definition.stack?.length > 10, `${id} explains its next-stack benefit`);
  for (let rank = 1; rank <= 3; rank++) {
    const offered = offerId(upgrades, id);
    assert.equal(offered.rank, rank);
    assert.equal(offered.currentRank, rank - 1);
    assert.equal(upgrades.pick(id), true);
    assert.equal(upgrades.rank(id), rank);
    assert.equal(upgrades.stats[id], rank, `${id} behavior receives every acquired stack`);
    assert.equal(upgrades.canPick(id), true, `${id} does not become exclusive after buying it`);
  }
  for (const value of Object.values(upgrades.stats)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${id} stacking produces finite stats`);
  }
}

// All behaviors can coexist. Each numeric rank survives adding every other perk.
{
  const { upgrades } = makeSystem(75);
  for (let rank = 1; rank <= 2; rank++) for (const id of Object.keys(UPGRADES)) {
    offerId(upgrades, id);
    assert.equal(upgrades.pick(id), true);
  }
  for (const id of Object.keys(UPGRADES)) assert.equal(upgrades.stats[id], 2, `${id} survives the full mixed build`);
  assert.ok(upgrades.stats.damageReduction > 0 && upgrades.stats.damageReduction < 1);
  assert.ok(upgrades.stats.damage > BASE_STATS().damage);
  assert.ok(upgrades.stats.fireRate > BASE_STATS().fireRate);
  assert.ok(upgrades.stats.shieldMax > BASE_STATS().shieldMax);
  assert.ok(upgrades.stats.moveSpeed > BASE_STATS().moveSpeed);
  assert.ok(upgrades.stats.scrapMultiplier > BASE_STATS().scrapMultiplier);
  assert.equal(upgrades.stats.shieldBreakDelay, 14, 'Defense stacking cannot erase the shield-break lockout');
}

// Exercise varied legal builds through all twelve approach picks and the
// legendary Nexus pick. Repeat ranks are legal, but duplicate cards in one offer are not.
for (let route = 0; route < 243; route++) {
  const { upgrades } = makeSystem(route + 1);
  for (let checkpoint = 0; checkpoint < 13; checkpoint++) {
    const source = checkpoint === 12 ? 4 : {
      sector: Math.floor(checkpoint / 3), checkpoint: checkpoint % 3,
    };
    const cards = upgrades.offer(source);
    assert.equal(cards.length, 3, `build ${route}, checkpoint ${checkpoint}`);
    assert.equal(new Set(cards.map((card) => card.id)).size, 3);
    for (const card of cards) assert.ok(upgrades.canPick(card.id));
    if (checkpoint < 12) {
      assert.equal(cards[0].category, 'ARSENAL');
      assert.ok(['SURVIVAL', 'MOBILITY'].includes(cards[1].category));
    }
    const index = Math.floor(route / (3 ** (checkpoint % 5))) % 3;
    assert.equal(upgrades.pick(cards[index].id), true);
    assert.equal(upgrades.pick(cards[index].id), false, 'one selection consumes the offer');
  }
  assert.equal(upgrades.taken.length, 13);
  for (const [id, rank] of Object.entries(upgrades.ranks)) {
    assert.equal(rank, upgrades.taken.filter((taken) => taken === id).length);
    assert.equal(upgrades.stats[id], rank);
  }
}

{
  const { upgrades, player } = makeSystem();
  assert.equal(upgrades.pick('broadsides'), false, 'unoffered picks are rejected');
  assert.equal(upgrades.canPick('__proto__'), false, 'Prototype properties are not valid augments');
  offerId(upgrades, 'broadsides');
  assert.equal(upgrades.pick('broadsides'), true);
  assert.equal(upgrades.canPick('broadsides'), true, 'Weapon augments can be rebought');

  upgrades.offer(0);
  player.stats.maxHealth += 8;
  player.stats.damage *= 1.04;
  const xpDamage = player.stats.damage;
  assert.equal(upgrades.pick('hullBoost'), true);
  assert.equal(player.stats.maxHealth, 228, 'XP hull persists through upgrade');
  assert.equal(player.stats.damage, xpDamage, 'XP damage persists through upgrade');
  assert.equal(player.health, 160, 'hull upgrade heals once, not twice');
  upgrades.offer(0);
  assert.equal(upgrades.pick('hullBoost'), true);
  assert.equal(upgrades.canPick('hullBoost'), true, 'Stat augments also remain repeatable');
  const repeat = upgrades.offer(0).find((card) => card.id === 'hullBoost');
  assert.equal(repeat.rank, 3);
  assert.equal(repeat.currentRank, 2);

  upgrades.cancelOffer();
  assert.equal(upgrades.pick('rapidFire'), false, 'dismissed cards cannot be selected');
  upgrades.reset();
  assert.deepEqual(upgrades.ranks, {});
  assert.equal(upgrades.taken.length, 0);
  assert.equal(upgrades.stats.maxHealth, 160);
  for (const id of Object.keys(UPGRADES)) assert.equal(upgrades.stats[id], 0, 'Restart clears every behavior rank');
}

// The new weapon effects must actually emit extra forward projectiles, with
// the damage fractions promised by the cards, while keeping manual fire.
{
  const bolts = [];
  const { player } = makeSystem();
  Object.assign(player, {
    alive: true, frozen: false, x: 0, y: 1, pos: { x: 0, y: 1 },
    fireRate: BASE_STATS().fireRate, critBuffT: 0, shield: 40,
  });
  const weapon = new PlayerWeapon(player, {
    firePlayer(bolt) { bolts.push(bolt); },
  }, { reset() {} });
  const context = { targets: [], heat: { multiplier: 1 } };
  Input.enabled = true;
  Input._keys.Space = false;
  weapon.update(1, context);
  assert.equal(bolts.length, 0, 'no automatic fire');
  Input._keys.Space = true;
  player.stats.twinFangs = 1;
  weapon.update(1, context);
  assert.equal(bolts.length, 2);
  assert.equal(bolts[1].damage, player.stats.damage * 0.65);
  assert.equal(bolts[0].weapon, 'pulse');
  assert.equal(bolts[1].weapon, 'twin');
  assert.notEqual(WEAPON_STYLES.pulse.color, WEAPON_STYLES.twin.color);

  bolts.length = 0;
  weapon.reset();
  player.stats.twinFangs = 2;
  weapon.update(1, context);
  assert.equal(bolts.filter((bolt) => bolt.weapon === 'twin').length, 2, 'Second Twin Fangs stack adds another real cannon');

  bolts.length = 0;
  weapon.reset();
  player.stats.twinFangs = 0;
  player.stats.helixVolley = 1;
  for (let i = 0; i < 3; i++) weapon.update(1, context);
  assert.equal(bolts.length, 5, 'third volley adds two helix bolts');
  assert.equal(bolts[4].damage, player.stats.damage * 0.8);
  assert.equal(bolts.filter((bolt) => bolt.weapon === 'helix').length, 2);
  assert.ok(bolts.every((bolt) => bolt.tz < bolt.z), 'all bolts travel forward');

  bolts.length = 0;
  weapon.reset();
  player.stats.twinFangs = 2;
  player.stats.broadsides = 2;
  player.stats.helixVolley = 2;
  for (let i = 0; i < 3; i++) weapon.update(1, context);
  assert.equal(bolts.filter((bolt) => bolt.weapon === 'twin').length, 6);
  assert.equal(bolts.filter((bolt) => bolt.weapon === 'broadsides').length, 12);
  assert.equal(bolts.filter((bolt) => bolt.weapon === 'helix').length, 4);
  const count = bolts.length;
  Input._keys.Space = false;
  weapon.update(1, context);
  assert.equal(bolts.length, count, 'A stacked build still respects manual trigger release');
  Input.reset();
}

// Minimal UI doubles keep this test focused on selection/scheduler ownership:
// a stale close callback must never restart or advance a new run.
{
  class Element {
    constructor() {
      this.children = [];
      this.classes = new Set();
      this.style = { setProperty() {} };
      this.classList = {
        add: (name) => this.classes.add(name),
        remove: (name) => this.classes.delete(name),
        toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name),
      };
    }
    set innerHTML(_value) { this.children = []; }
    addEventListener() {}
    appendChild(child) { this.children.push(child); }
  }
  const elements = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element(),
  };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const { upgrades, player } = makeSystem();
  const game = {
    upgrades, player, paused: false,
    scheduler: new Scheduler(), hud: { toast() {}, flashAugment() {} }, fx: { explode() {} },
  };
  const screen = new UpgradeScreen(game);
  let completed = 0;
  const show = () => screen.show({ sector: 0, checkpoint: 0 }, '#22d3ee', () => completed++);

  show();
  assert.equal(screen.cards.children.length, 3);
  game.paused = true;
  screen._pick(screen._offers[0].id);
  assert.equal(upgrades.taken.length, 0, 'paused clicks do not install augments');
  game.paused = false;
  screen._pick(screen._offers[0].id);
  assert.equal(screen.closing, true);
  game.scheduler.update(0.2);
  assert.equal(completed, 0, 'dismissal waits for game time');
  screen.hide();
  game.scheduler.update(1);
  assert.equal(completed, 0, 'hide cancels a pending dismissal');

  show();
  screen._pick(screen._offers[0].id);
  show();
  game.scheduler.update(1);
  assert.equal(completed, 0, 'replacement screen cannot receive stale callback');
  assert.equal(screen.open, true);
  screen._pick(screen._offers[0].id);
  game.scheduler.update(0.3);
  assert.equal(completed, 1, 'valid selection completes exactly once');
  assert.equal(screen.closing, false);
  game.scheduler.update(1);
  assert.equal(completed, 1);
}

console.log('Augments: all 45 repeatable perks, mixed stacks, 243 builds, XP preservation, modular guns, manual fire and stale-dismissal checks passed.');
