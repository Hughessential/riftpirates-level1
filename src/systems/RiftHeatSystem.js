import { clamp } from '../core/Utils.js';

/**
 * Rift Heat (spec §27) is the skill dial. It rises with aggression and falls
 * when you stall, hide or take hits. It drives the score multiplier, which is
 * the whole reason to play well.
 */

export const TIERS = [
  { at: 0, name: 'COOL' },
  { at: 2, name: 'HOT' },
  { at: 5, name: 'BURNING' },
  { at: 8, name: 'INFERNAL' },
  { at: 12, name: 'OVERDRIVE' },
];

const MAX_MULT = 12;
const COMBO_WINDOW = 3.2; // seconds of inactivity before the combo expires

export class RiftHeatSystem {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.heat = 0; // 0..1, maps to multiplier 1..12
    this.combo = 0;
    this.comboT = 0;
    this.maxCombo = 0;
    this.maxMultiplier = 1;
    this.idleT = 0;
  }

  get multiplier() {
    return 1 + this.heat * (MAX_MULT - 1);
  }

  get tier() {
    const m = this.multiplier;
    let name = TIERS[0].name;
    for (const t of TIERS) if (m >= t.at) name = t.name;
    return name;
  }

  _bump(amount) {
    this.heat = clamp(this.heat + amount * (this.game.testing?.getTuning('heatGain') ?? 1), 0, 1);
    this.maxMultiplier = Math.max(this.maxMultiplier, this.multiplier);
    this.idleT = 0;
  }

  _addCombo(n = 1) {
    this.combo += n;
    this.comboT = COMBO_WINDOW;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
  }

  // Tuning note: reaching OVERDRIVE (12x) must take sustained, clean aggression.
  // Chip damage alone should never get you past ~HOT — kills, weak points and
  // Perfect Dodges are what actually move the needle.
  onDealDamage(dmg) {
    this._bump(Math.min(0.0015, dmg * 0.00005));
    this.idleT = 0;
  }

  onKill() {
    this._bump(0.022);
    this._addCombo();
  }

  onWeakPointDestroyed() {
    this._bump(0.05);
    this._addCombo(3);
  }

  onObjectiveDestroyed() {
    this._bump(0.1);
    this._addCombo(10);
  }

  onPerfectDodge() {
    this._bump(0.05);
    this._addCombo(2);
  }

  onScrapCollected() {
    this._bump(0.0012);
  }

  onPlayerDamaged() {
    // Getting hit is the single biggest setback — Heat Sink softens it (spec §20)
    const rank = Number(this.game.player.stats.heatSink) || 0;
    const loss = 0.28 / (1 + rank * 1.3);
    this.heat = clamp(this.heat - loss, 0, 1);
    this.combo = Math.floor(this.combo * (1 - .6 / (1 + rank)));
    if (this.combo <= 0) this.comboT = 0;
  }

  update(dt) {
    // combo expiry
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    // Heat bleeds while you aren't engaging — camping the arena edge is not a strategy.
    this.idleT += dt;
    const rank = Number(this.game.player.stats.heatSink) || 0;
    const decayDelay = 1.2 + rank;
    if (this.idleT > decayDelay && this.heat > 0) {
      const rate = 0.09 / (1 + .8 * rank);
      this.heat = clamp(this.heat - rate * (this.game.testing?.getTuning('heatDecay') ?? 1) * dt, 0, 1);
    }
  }
}
