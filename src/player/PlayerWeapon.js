import { Audio2 } from '../core/AudioManager.js';
import { Input } from '../core/Input.js';
import { chance } from '../core/Utils.js';

/**
 * Fully manual fire: hold L2 (gamepad), Space (keyboard) or the fire pad
 * (touch). Shots always travel where the nose points. Holding aim (R2 / F)
 * raises the reticle and lets the targeting system lock anything inside the
 * forward cone; locked shots converge on it. No lock, no redirection — bolts
 * fly dead ahead, never backwards.
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
    if (!p.alive || p.frozen) {
      p.reticleLock = false;
      return;
    }

    // a target lock only exists while aiming, and only inside the forward cone
    const aiming = Input.aiming;
    const target = aiming ? this.targeting.update(dt, p.pos, ctx.targets) : null;
    if (!aiming) this.targeting.reset();
    p.reticleLock = !!target;

    // the cooldown ticks whether or not the trigger is held, so a tap the
    // moment it elapses always fires instantly
    this.cooldown -= dt;
    if (!Input.firing || this.cooldown > 0) return;

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
    if (target && target.kind !== 'enemy') dmg *= s.weakPointDamage;

    const crit = chance(s.criticalChance);
    if (crit) dmg *= s.criticalMultiplier;

    // locked shots converge on the target; otherwise straight down the nose
    const t = target ? target.pos : { x: p.x, y: p.y + 0.05, z: -90 };
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
