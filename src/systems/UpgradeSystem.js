import { BASE_STATS } from '../player/Player.js';
import { COSMIC_AUGMENTS, amplifyAugmentStats } from './CosmicAugments.js';
import { augmentPrice, augmentRarity, weightedAugment } from './AugmentEconomy.js';

/** Every augment is repeatable. Numeric ranks compose; weapons never replace one another. */
export const AUGMENT_CATEGORIES = { ARSENAL: '#34ffe4', SURVIVAL: '#73ff87', MOBILITY: '#82b8ff', SALVAGE: '#ffd34b', ANOMALY: '#d779ff' };
const augment = (name, icon, category, desc, stack, apply = () => {}, onPick) => ({
  name, icon, category, color: AUGMENT_CATEGORIES[category], desc, stack, maxRank: Infinity, apply, ...(onPick ? { onPick } : {}),
});
const linear = (s, key, rank, amount) => { s[key] *= (1 + amount * rank) / (1 + amount * (rank - 1)); };

export const UPGRADES = {
  ...COSMIC_AUGMENTS,
  rapidFire: augment('HYPERTRIGGER', '>>', 'ARSENAL', 'Turn your entire arsenal into a neon bullet storm.',
    '+35% base firing rate per stack. No damage penalty.', (s, r) => linear(s, 'fireRate', r, .35)),
  hullBoost: augment('DREADNOUGHT HULL', 'HP', 'SURVIVAL', 'Become a flying pirate fortress.',
    '+60 maximum hull and repair 60 per stack.', (s) => { s.maxHealth += 60; }),
  scrapMagnet: augment('PLUNDER VORTEX', '$', 'SALVAGE', 'Pull distant treasure into your ship.',
    '+5 pickup radius and +25% base scrap yield per stack.', (s, r) => { s.scrapRadius += 5; linear(s, 'scrapMultiplier', r, .25); }),
  shieldRecharge: augment('BULWARK CAPACITOR', '[]', 'SURVIVAL', 'A deeper shield reserve with stronger recovery after the lockout.',
    '+20 shield capacity and +1 recharge/sec per stack. Break lockout stays 14s.', (s) => { s.shieldMax += 20; s.shieldRegen += 1; }),
  riftDrain: augment('RIFT DRAIN', '+', 'SURVIVAL', 'Steal momentum from kills and life from perfect dodges.',
    'Each stack increases dodge healing and kill boost refunds.'),
  broadsides: augment('PIRATE BROADSIDES', '><', 'ARSENAL', 'Paired flank cannons tear open a wider firing lane.',
    'Each stack adds a pair of diagonal cannons; dense ranks also amplify their damage.'),
  criticalDamage: augment('LOADED DICE', '**', 'ARSENAL', 'Rig the reactor for spectacular critical hits.',
    '+15 percentage points crit chance and +0.3x crit damage per stack.', (s) => { s.criticalChance += .15; s.criticalMultiplier += .3; }),
  dodgeDrive: augment('PHASE DRIVE', '>>', 'MOBILITY', 'Perfect dodges ignite a movement and firing-speed surge.',
    'Each stack increases the speed surge and its duration.'),
  armorPlating: augment('GHOST ARMOR', '[]', 'SURVIVAL', 'Layer damage resistance and absorb the first hits of each encounter.',
    '15% less remaining damage and +1 full hit block per stack.', (s) => { s.damageReduction = 1 - (1 - s.damageReduction) * .85; s.freeBlocks += 1; }),
  overcharge: augment('INFERNAL OVERDRIVE', '!!', 'ARSENAL', 'High Rift Heat sends every cannon into overdrive.',
    '+50% weapon damage per stack while Heat is Infernal or hotter.'),
  heatSink: augment('ABSOLUTE ZERO', '--', 'ANOMALY', 'Keep your combo alive through the chaos.',
    'Each stack reduces Heat loss and decay, and extends the idle grace period.'),
  scrapYield: augment('KING OF PLUNDER', '$$', 'SALVAGE', 'Turn every battlefield into a treasure vault.',
    '+60% base scrap yield per stack. Pickups award 12 score per scrap per stack.', (s, r) => linear(s, 'scrapMultiplier', r, .6)),
  nexusBreaker: augment('NEXUS BREAKER', 'X', 'ARSENAL', 'Focused fire rips through exposed fortress machinery.',
    'Multiply locked weak-point and core damage by 1.5 per stack.', (s) => { s.weakPointDamage *= 1.5; }),
  realityTear: augment('REALITY TEAR', '//', 'ANOMALY', 'A perfect dodge detonates the space around you.',
    'Dodge blast deals 45 damage per stack; radius 12 + 2 per stack. Clears nearby fire.'),
  secondWind: augment('DEATH WARRANT', '+1', 'SURVIVAL', 'The Rift refuses to collect your debt.',
    'Each stack grants one extra lethal-hit rescue at half hull. Used rescues stay spent.'),
  twinFangs: augment('TWIN FANGS', 'II', 'ARSENAL', 'Stack parallel forward cannons onto your ship.',
    'Each stack adds another forward shot; dense ranks also amplify cannon damage.'),
  helixVolley: augment('HELIX CATHEDRAL', 'XX', 'ARSENAL', 'Weave rotating ribbons of laser fire through the fleet.',
    'Each stack adds another spiral pair and strengthens the helix barrage.'),
  hotshot: augment('HOTSHOT REACTOR', '++', 'ARSENAL', 'Feed every weapon a reckless amount of reactor power.',
    'Multiply all weapon damage by 1.25 per stack.', (s) => { s.damage *= 1.25; }),
  railAccelerator: augment('RAIL ACCELERATOR', '->', 'ARSENAL', 'Launch hypervelocity shots that strike like falling stars.',
    '+15% base projectile speed and 15% more damage per stack.', (s, r) => { linear(s, 'projectileSpeed', r, .15); s.damage *= 1.15; }),
  afterburner: augment('AFTERBURNER', '>>>', 'MOBILITY', 'Burn a blazing escape route through enemy formations.',
    '+15% base boost speed and +25 boost capacity per stack. Refills boost.', (s, r) => { linear(s, 'boostSpeed', r, .15); s.boostCapacity += 25; }, (p) => { p.boost = p.stats.boostCapacity; }),
  reactorRecovery: augment('INFINITE THRUST', '><', 'MOBILITY', 'Recover boost quickly enough to keep dancing through danger.',
    '+35% base boost regeneration per stack.', (s, r) => linear(s, 'boostRegen', r, .35)),
  repairSwarm: augment('REPAIR SWARM', '++', 'SURVIVAL', 'Repair drones stitch your hull together after you escape damage.',
    '+2 hull repair/sec per stack after the recovery delay. Repair 25 immediately.', (s) => { s.healthRegen += 2; }, (p) => p.heal(25)),
  vectorThrusters: augment('VECTOR THRUSTERS', '<>', 'MOBILITY', 'Sharper steering wrapped in a larger shield reserve.',
    '+10% base steering speed and +12 shield capacity per stack. No instant shield refill.', (s, r) => { linear(s, 'moveSpeed', r, .1); s.shieldMax += 12; }),
  prismLance: augment('PRISM LANCE', '|', 'ARSENAL', 'A brilliant cyan rail-lance punches through clustered ships.',
    'Each stack adds penetration and increases lance power.'),
  scatterNova: augment('SCATTER NOVA', '***', 'ARSENAL', 'A golden laser shotgun fills the forward arc.',
    'Each stack widens the pellet barrage and increases its total damage.'),
  seekerSwarm: augment('SEEKER SWARM', '^^', 'ARSENAL', 'Acid-green missiles hunt targets ahead of your ship.',
    'Each stack adds seekers and increases swarm damage. Targets must remain ahead.'),
  teslaFork: augment('TESLA FORK', 'W', 'ANOMALY', 'Hits fork electric arcs through nearby enemies.',
    'Chain to 2 + stack targets; each arc deals 35% hit damage per stack.'),
  voidMortar: augment('VOID MORTAR', 'O', 'ARSENAL', 'Lob heavy violet plasma into the fleet and burst it apart.',
    'Each stack strengthens the explosive orb and expands its blast.'),
  ricochet: augment('PINBALL HEX', '/\\', 'ANOMALY', 'Your laser rebounds into a new target after impact.',
    'Each stack adds another target bounce. A bolt cannot hit the same target twice.'),
  fragmentation: augment('SHATTERSTAR', '*', 'ANOMALY', 'Hits fracture into a fan of hot-pink laser shards.',
    'Each stack adds two shards at 35% hit damage each. Shards do not create more shards.'),
  cryoRounds: augment('CRYO HEX', '+', 'ANOMALY', 'Freeze enemy formations into a slow-motion shooting gallery.',
    'Each stack strengthens slowing and adds 0.4s duration to the 1.6s base.'),
  solarBurn: augment('SOLAR BRAND', 'S', 'ANOMALY', 'Every hit brands the target with orange reactor fire.',
    'Burn for 22% hit damage/sec per stack for 2.5s. Repeat hits refresh the burn.'),
  gravityWell: augment('GRAVITY THIEF', 'O', 'ANOMALY', 'Impacts open violet gravity wells that pull enemies together.',
    'Each stack increases radius and deals 15% hit damage/sec. Wells last 2.2s.'),
  orbitals: augment('GHOST FLEET', 'oO', 'ARSENAL', 'Orbiting gun drones join your firing line.',
    'Each stack adds two satellite cannons; dense ranks also increase drone firepower.'),
  echoBarrage: augment('ECHO CHAMBER', '::', 'ARSENAL', 'Ghost-blue copies of your shots follow the first volley.',
    'Each stack adds delayed echo fire while you hold the trigger.'),
  shrapnelWake: augment('SLIPSTREAM BARRAGE', '>>>', 'MOBILITY', 'Boosting turns your escape into a forward laser ambush.',
    'Each stack strengthens and expands the boost-triggered barrage.'),
  bloodReactor: augment('BLOOD REACTOR', 'HP', 'SURVIVAL', 'Losing your shield turns the ship into a desperate damage engine.',
    'Each stack increases unshielded weapon damage and heals 2 hull per kill while unshielded.'),
  kineticCapacitor: augment('KINETIC CAPACITOR', 'K', 'MOBILITY', 'Moving charges a reactor burst for your next attack.',
    'Each stack increases the stored movement charge and burst power.'),
  executionProtocol: augment('DEAD MAN\'S MARK', 'X', 'ANOMALY', 'Wounded enemies take brutal finishing damage.',
    'Each stack raises the execute threshold and adds 70% hit damage to the finisher.'),
  chainReaction: augment('POWDER KEG', '**', 'ANOMALY', 'Kills explode and can carry destruction into the next ship.',
    'Kill blast: 18 damage per stack, radius 5 + stack.'),
  bulletSiphon: augment('BULLET HEIST', '$>', 'SALVAGE', 'Perfect dodges steal enemy fire and return it as cyan lasers.',
    'Each stack increases stolen bolts and damage. Always fires a bonus pair per stack.'),
  singularity: augment('BLACK SUN', '@', 'ANOMALY', 'Every fourth kill collapses into a hungry singularity.',
    'Three-second well: 24 damage/sec per stack, radius 6 + stack.'),
  timeDilation: augment('TIME BANDIT', 'T', 'MOBILITY', 'Perfect dodges slow nearby hostile projectiles.',
    'Each stack strengthens the slow and adds 0.5s to its 2s base duration.'),
  revengeMatrix: augment('REVENGE MATRIX', '!!', 'SURVIVAL', 'Shield destruction answers with a bullet-clearing neon counterattack.',
    'Break clears radius 8 + stack and launches 8 + stack shots dealing 14 damage per stack.'),
  treasureMunitions: augment('GOLDEN GUN', '$+', 'SALVAGE', 'Load collected scrap into your next cannon volley.',
    'Store +1.5 damage per scrap per stack; reserve holds up to 300 damage per stack.'),
};

export const CACHES = [
  ['rapidFire', 'hullBoost', 'scrapMagnet'], ['shieldRecharge', 'riftDrain', 'broadsides'],
  ['criticalDamage', 'dodgeDrive', 'armorPlating'], ['overcharge', 'heatSink', 'scrapYield'],
  ['nexusBreaker', 'realityTear', 'secondWind'],
];
const IDS = Object.keys(UPGRADES);
const shuffle = (array, random) => {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

/** Rebuild from authoritative ranks so Crown bonuses never compound on themselves.
 * XP remains a separate earned progression, applied after augment magnitude. */
export function buildAugmentStats(ranks, xpLevel = 1) {
  const base = BASE_STATS();
  const raw = { ...base };
  for (const id of IDS) {
    const rank = Math.max(0, Math.floor(Number(ranks[id]) || 0));
    if (rank > 10000) throw new RangeError('Augment rank exceeds the safe simulation range');
    raw[id] = rank;
    for (let r = 1; r <= rank; r++) UPGRADES[id].apply(raw, r);
  }
  const stats = amplifyAugmentStats(raw, base);
  const level = Math.max(1, Math.min(18, Math.floor(xpLevel) || 1));
  stats.maxHealth += (level - 1) * 8;
  stats.damage *= 1.04 ** (level - 1);
  if (Object.values(stats).some(value => typeof value === 'number' && !Number.isFinite(value)))
    throw new RangeError('Augment stats must stay finite');
  return stats;
}

export class UpgradeSystem {
  constructor(game, random = Math.random) { this.game = game; this.random = random; this.runSerial = 0; this.reset(); }
  reset() {
    this.runSerial++;
    this.taken = [];
    this.ranks = {};
    this.pendingOffers = new Set();
    this.offerCache = new Map();
    this.activeOffer = null;
    this.offerSerial = 0;
    this.transactions = { purchases: 0, spent: 0, skips: 0, unaffordable: 0, byRarity: {} };
    this.stats = buildAugmentStats({});
  }
  rank(id) { return this.ranks[id] || 0; }
  canPick(id) { return Object.hasOwn(UPGRADES, id); }
  price(id) { return augmentPrice(UPGRADES[id], this.rank(id)); }
  _key(source) {
    return typeof source === 'object' && source !== null
      ? `approach:${source.sector}:${source.checkpoint}` : `cache:${source}`;
  }
  offer(source) {
    const key = this._key(source);
    let record = this.offerCache.get(key);
    if (record?.complete) return [];
    if (!record) {
      const ids = [];
      const available = category => IDS.filter(id => !ids.includes(id) && (!category || category.includes(UPGRADES[id].category)));
      const add = id => { if (id && ids.length < 3 && !ids.includes(id) && this.canPick(id)) ids.push(id); };
      if (typeof source === 'object' && source !== null) {
        add(weightedAugment(available(['ARSENAL']), UPGRADES, this.random));
        add(weightedAugment(available(['SURVIVAL', 'MOBILITY']), UPGRADES, this.random));
        const owned = available().filter(id => this.rank(id) > 0);
        add(weightedAugment(owned.length && this.random() < .4 ? owned : available(), UPGRADES, this.random));
      } else for (const id of CACHES[source] || CACHES.at(-1)) add(id);
      for (const id of shuffle(IDS, this.random)) add(id);
      const balance = this.game.scrap?.wallet?.balance || 0;
      // Keep fixed-cache identities unless all three ranks are unaffordable;
      // every shop retains an affordable answer when an eligible one exists.
      if (!ids.some(id => this.price(id) <= balance)) {
        const affordable = available().filter(id => this.price(id) <= balance);
        if (affordable.length) {
          const sameCategory = affordable.filter(id => UPGRADES[id].category === UPGRADES[ids[2]].category);
          ids[2] = weightedAugment(sameCategory.length ? sameCategory : affordable, UPGRADES, this.random);
        }
      }
      record = { key, token: `${this.runSerial}:${++this.offerSerial}:${key}`, complete: false,
        cards: ids.map(id => ({ id, rank: this.rank(id) + 1, price: this.price(id) })) };
      this.offerCache.set(key, record);
      if (!record.cards.some(card => card.price <= balance)) this.transactions.unaffordable++;
    }
    this.activeOffer = record;
    this.pendingOffers = new Set(record.cards.map(card => card.id));
    const walletBalance = this.game.scrap?.wallet?.balance || 0;
    return record.cards.map(card => ({ ...UPGRADES[card.id], ...card,
      currentRank: card.rank - 1, offerToken: record.token, walletBalance,
      remainingBalance: Math.max(0, walletBalance - card.price), missingScrap: Math.max(0, card.price - walletBalance) }));
  }
  cancelOffer() { this.pendingOffers.clear(); this.activeOffer = null; }
  _valid(token) { return Boolean(this.activeOffer && !this.activeOffer.complete && this.activeOffer.token === token); }
  skip(token) {
    if (!this._valid(token)) return false;
    this.activeOffer.complete = true;
    this.transactions.skips++;
    this.cancelOffer();
    return true;
  }
  pick(id, token) {
    if (!this._valid(token) || !this.pendingOffers.has(id) || !this.canPick(id)) return false;
    const record = this.activeOffer;
    const card = record.cards.find(card => card.id === id);
    const wallet = this.game.scrap?.wallet;
    if (!card || card.rank !== this.rank(id) + 1 || card.price !== this.price(id) || !wallet?.canSpend(card.price)) return false;
    const ranks = { ...this.ranks, [id]: card.rank };
    let next;
    try { next = buildAugmentStats(ranks, this.game.xp?.level || 1); } catch { return false; }
    const p = this.game.player;
    const snapshot = Object.fromEntries(Object.entries(p).filter(([,v]) => v === null || !['object','function'].includes(typeof v)));
    const previousStats = p.stats;
    // Stage reversible player changes first. Only successful installation debits.
    try {
      p.applyStats(next);
      if (next.maxHealth > this.stats.maxHealth) p.heal(next.maxHealth - this.stats.maxHealth);
      UPGRADES[id].onPick?.(p, card.rank);
      if (!wallet.spend(card.price)) throw new Error('Wallet changed during installation');
    } catch {
      Object.assign(p, snapshot); p.stats = previousStats;
      return false;
    }
    this.stats = next;
    this.ranks = ranks;
    this.taken.push(id);
    record.complete = true;
    this.transactions.purchases++;
    this.transactions.spent += card.price;
    const rarity = augmentRarity(UPGRADES[id]);
    this.transactions.byRarity[rarity] = (this.transactions.byRarity[rarity] || 0) + 1;
    this.cancelOffer();
    // Presentation notifications cannot invalidate a committed purchase.
    try { this.game.weapon?.onAugmentInstalled?.(id, card.rank); } catch (error) { console.warn('Augment installation feedback failed', error); }
    return true;
  }
}
