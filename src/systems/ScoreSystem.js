/**
 * Score = base action value x current Rift Heat multiplier (spec §28).
 * Playing well is worth far more than playing safe.
 */

export const GRADES = [
  { min: 900000, grade: 'S+' },
  { min: 600000, grade: 'S' },
  { min: 380000, grade: 'A' },
  { min: 220000, grade: 'B' },
  { min: 110000, grade: 'C' },
  { min: 0, grade: 'D' },
];

export const SCORE = {
  ENEMY_KILL: 100,
  ELITE_KILL: 650,
  WEAK_POINT: 1500,
  TOWER: 8000,
  INHIBITOR: 12000,
  BOSS_PHASE: 6000,
  BOSS_DEFEATED: 30000,
  PERFECT_DODGE: 250,
  NO_DAMAGE_ENCOUNTER: 5000,
  TIME_BONUS_PER_SEC: 120, // awarded against a par time on victory
};

export class ScoreSystem {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.total = 0;
    this.breakdown = {};
  }

  /** Base value in, multiplied value out. */
  add(base, reason = 'SCORE') {
    const mult = this.game.heat.multiplier;
    const awarded = Math.round(base * mult * (this.game.testing?.getTuning('scoreGain') ?? 1));
    this.total += awarded;
    this.breakdown[reason] = (this.breakdown[reason] || 0) + awarded;
    return awarded;
  }

  /** Bypasses the multiplier — used for end-of-run bonuses. */
  addFlat(amount, reason = 'BONUS') {
    const awarded = Math.round(amount * (this.game.testing?.getTuning('scoreGain') ?? 1));
    this.total += awarded;
    this.breakdown[reason] = (this.breakdown[reason] || 0) + awarded;
    return awarded;
  }

  grade() {
    for (const g of GRADES) {
      if (this.total >= g.min) return g.grade;
    }
    return 'D';
  }
}
