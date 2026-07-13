import { BASE_STATS } from '../player/Player.js';

/**
 * Temporary run upgrades (spec §30). Every upgrade is a stat modifier or a
 * boolean flag on the player — no duplicated weapon systems. All of it resets
 * at the start of a new run.
 *
 * Caches 1-4 are the pools from the progression handoff (§11, §14, §17, §20).
 * Cache 5 is the final one from the progression board, dealt as you enter the
 * Nexus so you meet the Rift Admiral at full build.
 */

export const UPGRADES = {
  // --- Cache 1: after the Outer Defense Tower ---
  rapidFire: {
    name: 'RAPID FIRE',
    icon: '⚡',
    desc: 'Fire 50% faster. Each bolt hits a little softer.',
    apply: (s) => {
      s.fireRate *= 1.5;
      s.damage *= 0.85;
    },
  },
  hullBoost: {
    name: 'HULL BOOST',
    icon: '🛡',
    desc: '+60 max hull, and repair 60 right now.',
    apply: (s) => {
      s.maxHealth += 60;
    },
    onPick: (p) => p.heal(60),
  },
  scrapMagnet: {
    name: 'SCRAP MAGNET',
    icon: '🧲',
    desc: 'Far wider pickup radius. +25% scrap from kills.',
    apply: (s) => {
      s.scrapRadius *= 2.4;
      s.scrapMultiplier *= 1.25;
    },
  },

  // --- Cache 2: after the Midrift Pressure Tower ---
  shieldRecharge: {
    name: 'SHIELD RECHARGE',
    icon: '🔷',
    desc: 'Gain a 45-point shield that rebuilds when you avoid damage.',
    apply: (s) => {
      s.shieldMax += 45;
      s.shieldRegen += 11;
    },
    onPick: (p) => {
      p.shield = p.stats.shieldMax;
    },
  },
  riftDrain: {
    name: 'RIFT DRAIN',
    icon: '🩸',
    desc: 'Perfect Dodges repair you. Kills refund boost energy.',
    apply: (s) => {
      s.riftDrain = true;
    },
  },
  broadsides: {
    name: 'BROADSIDES',
    icon: '🔱',
    desc: 'Fire two extra diagonal cannons with every shot.',
    apply: (s) => {
      s.broadsides = true;
    },
  },

  // --- Cache 3: after the Inner Citadel ---
  criticalDamage: {
    name: 'CRIT DAMAGE',
    icon: '💥',
    desc: '25% chance to deal 2.5x damage.',
    apply: (s) => {
      s.criticalChance += 0.25;
    },
  },
  dodgeDrive: {
    name: 'DODGE DRIVE',
    icon: '💨',
    desc: 'Perfect Dodges grant +40% move and fire speed for 4s.',
    apply: (s) => {
      s.dodgeDrive = true;
    },
  },
  armorPlating: {
    name: 'ARMOR PLATING',
    icon: '🪖',
    desc: 'Take 25% less damage, and block one hit per encounter outright.',
    apply: (s) => {
      s.damageReduction += 0.25;
      s.freeBlocks += 1;
    },
  },

  // --- Cache 4: after the Inhibitor ---
  overcharge: {
    name: 'OVERCHARGE',
    icon: '🔥',
    desc: '+50% damage while Rift Heat is Infernal or hotter.',
    apply: (s) => {
      s.overcharge = true;
    },
  },
  heatSink: {
    name: 'HEAT SINK',
    icon: '❄',
    desc: 'Damage barely dents your Heat, and your combo decays slower.',
    apply: (s) => {
      s.heatSink = true;
    },
  },
  scrapYield: {
    name: 'SCRAP YIELD',
    icon: '💎',
    desc: '+60% scrap, and every piece adds score as you collect it.',
    apply: (s) => {
      s.scrapMultiplier *= 1.6;
      s.scrapScores = true;
    },
  },

  // --- Cache 5: entering the Nexus (from the progression board) ---
  nexusBreaker: {
    name: 'NEXUS BREAKER',
    icon: '⚔',
    desc: '+60% damage to weak points, conduits and cores.',
    apply: (s) => {
      s.weakPointDamage *= 1.6;
    },
  },
  realityTear: {
    name: 'REALITY TEAR',
    icon: '🌀',
    desc: 'Perfect Dodges detonate — erasing nearby fire and shredding enemies.',
    apply: (s) => {
      s.realityTear = true;
    },
  },
  secondWind: {
    name: 'SECOND WIND',
    icon: '💚',
    desc: 'The first hit that would destroy you instead revives you at half hull.',
    apply: (s) => {
      s.secondWind = true;
    },
  },
};

/** Fixed pools, so each cache keeps the identity the design docs gave it. */
export const CACHES = [
  ['rapidFire', 'hullBoost', 'scrapMagnet'],
  ['shieldRecharge', 'riftDrain', 'broadsides'],
  ['criticalDamage', 'dodgeDrive', 'armorPlating'],
  ['overcharge', 'heatSink', 'scrapYield'],
  ['nexusBreaker', 'realityTear', 'secondWind'],
];

export class UpgradeSystem {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.taken = [];
    this.stats = BASE_STATS();
  }

  /** Cards for cache N (0-indexed). Already-taken upgrades never re-appear. */
  offer(cacheIndex) {
    const pool = CACHES[cacheIndex] || CACHES[CACHES.length - 1];
    return pool
      .filter((id) => !this.taken.includes(id))
      .map((id) => ({ id, ...UPGRADES[id] }));
  }

  pick(id) {
    const up = UPGRADES[id];
    if (!up || this.taken.includes(id)) return;
    this.taken.push(id);

    const p = this.game.player;
    const before = this.stats.maxHealth;
    up.apply(this.stats);
    p.applyStats(this.stats);

    // A max-health increase should feel like one — grant the delta immediately.
    const delta = this.stats.maxHealth - before;
    if (delta > 0) p.heal(delta);
    if (up.onPick) up.onPick(p);
  }
}
