import { Audio2 } from '../core/AudioManager.js';
import { P } from '../core/Palette.js';

/**
 * The level badge welded to the health bar (Player notes). Levelling is earned
 * through play and reads at a glance, League-style: it is *not* a second
 * upgrade economy — it just makes you tougher and hits harder as the run escalates.
 */

const CURVE = (lvl) => Math.round(120 * Math.pow(1.35, lvl - 1));
const MAX_LEVEL = 18;

export class XPSystem {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.level = 1;
    this.xp = 0;
    this.next = CURVE(1);
  }

  add(amount) {
    if (this.level >= MAX_LEVEL) return;
    this.xp += amount * (this.game.testing?.getTuning('xpGain') ?? 1);
    while (this.xp >= this.next && this.level < MAX_LEVEL) {
      this.xp -= this.next;
      this.level += 1;
      this.next = CURVE(this.level);
      this._levelUp();
    }
  }

  _levelUp() {
    const g = this.game;
    const p = g.player;

    // modest, compounding: +8 max hull and +4% damage per level
    p.stats.maxHealth += 8;
    p.stats.damage *= 1.04;
    p.heal(20);

    Audio2.play('levelup', 0.7, 1, 0);
    g.hud.toast(`LEVEL ${this.level}`, 'HULL REINFORCED', P.gold);
    g.hud.flashLevel();
    g.fx.explode(p.x, p.y, 0, {
      count: 14,
      colors: [P.gold, P.white, P.cyan],
      power: 12,
      gravity: 0,
      arcColor: P.gold,
    });
  }

  get progress() {
    return this.next > 0 ? this.xp / this.next : 1;
  }
}
