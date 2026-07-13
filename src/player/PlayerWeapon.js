import { Audio2 } from '../core/AudioManager.js';
import { chance } from '../core/Utils.js';

/**
 * Autofire (spec §4): the player never presses a fire button. The weapon shoots
 * whatever the targeting system selected, and only when something is in range.
 */
export class PlayerWeapon {
  constructor(player, projectiles, targeting) {
    this.player = player;
    this.proj = projectiles;
    this.targeting = targeting;
    this.cooldown = 0;
    this.muzzle = 1;
  }

  reset() {
    this.cooldown = 0;
    this.muzzle = 1;
  }

  update(dt, ctx) {
    const p = this.player;
    if (!p.alive || p.frozen) return;

    const target = this.targeting.update(dt, p.pos, ctx.targets);
    if (!target) return;

    this.cooldown -= dt;
    if (this.cooldown > 0) return;

    const s = p.stats;
    let rate = p.fireRate;
    // Perfect Dodge grants a brief weapon-power increase (spec §6)
    if (p.critBuffT > 0) rate *= 1.35;
    this.cooldown = 1 / rate;

    let dmg = s.damage;
    if (p.critBuffT > 0) dmg *= 1.25;
    // Overcharge: extra damage once Rift Heat is high (spec §20)
    if (s.overcharge && ctx.heat.multiplier >= 8) dmg *= 1.5;
    // Nexus Breaker: bonus against modules and cores
    if (target.kind !== 'enemy') dmg *= s.weakPointDamage;

    const crit = chance(s.criticalChance);
    if (crit) dmg *= s.criticalMultiplier;

    const t = target.pos;
    this.muzzle *= -1;

    this.proj.firePlayer({
      x: p.x + this.muzzle * 1.15,
      y: p.y + 0.05,
      z: -1.6,
      tx: t.x,
      ty: t.y,
      tz: t.z,
      speed: s.projectileSpeed,
      damage: dmg,
      crit,
    });

    // Broadsides: two weaker diagonal shots (spec §14)
    if (s.broadsides) {
      for (const side of [-1, 1]) {
        this.proj.firePlayer({
          x: p.x + side * 1.6,
          y: p.y,
          z: -1.6,
          tx: t.x + side * 14,
          ty: t.y + 4,
          tz: t.z,
          speed: s.projectileSpeed * 0.9,
          damage: dmg * 0.6,
          crit: false,
        });
      }
    }

    Audio2.play(crit ? 'player_shot_alt' : 'player_shot', crit ? 0.45 : 0.3, 1, 0.06);
  }
}
