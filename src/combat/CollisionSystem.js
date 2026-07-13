import { P } from '../core/Palette.js';
import { Audio2 } from '../core/AudioManager.js';

/**
 * Bounding-sphere collision only (spec §34). Also the home of Perfect Dodge
 * detection: during the boost window we re-test every threat with an inflated
 * radius — if something *would* have clipped the player but didn't damage them,
 * that's a dodge (spec §6).
 *
 * The award is resolved when the window *closes*, not on the frame the threat
 * passes: a bolt that is merely near the ship on one frame may still connect on
 * the next, and a hit anywhere inside the window means nothing was dodged.
 */

const DODGE_MARGIN = 2.6; // how close a threat must pass to count as dodged

export class CollisionSystem {
  constructor(game) {
    this.game = game;
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    if (!p.alive) return;

    const px = p.x;
    const py = p.y;
    const dodging = p.dodgeT > 0 && !p.dodgeUsed;
    let tookDamage = false;

    // ---- player bolts vs targets -------------------------------------------
    for (const b of g.projectiles.player) {
      if (!b.active) continue;

      // Inhibitor's rotating shields eat shots that don't thread a gap.
      let blocked = false;
      for (const blocker of g.projectileBlockers) {
        if (blocker.blocks(b.x, b.y, b.z)) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        g.projectiles.killPlayerBolt(b);
        g.fx.explode(b.x, b.y, b.z, {
          count: 2,
          colors: [P.orange, P.white],
          power: 5,
          arcs: false,
          flashScale: 0.4,
        });
        Audio2.play('shield_break', 0.25, 1.6, 0.1);
        continue;
      }

      for (const t of g.targets) {
        if (!t.alive || !t.targetable) continue;
        const dx = t.pos.x - b.x;
        const dy = t.pos.y - b.y;
        const dz = t.pos.z - b.z;
        if (dx * dx + dy * dy + dz * dz > (t.radius + b.radius) ** 2) continue;

        const dealt = t.damage(b.damage, b.crit);
        g.projectiles.killPlayerBolt(b);

        if (dealt > 0) {
          g.damageNumbers.spawn(b.x, b.y, b.z, Math.round(dealt), b.crit);
          g.heat.onDealDamage(dealt);
          Audio2.play(b.crit ? 'crit' : 'hit', b.crit ? 0.6 : 0.28, 1, 0.1);
          g.fx.explode(b.x, b.y, b.z, {
            count: b.crit ? 5 : 2,
            colors: b.crit ? [P.gold, P.white, P.orange] : [P.magenta, P.white],
            power: b.crit ? 9 : 5,
            arcs: false,
            flashScale: b.crit ? 0.9 : 0.4,
          });
        } else {
          // shielded: visibly bounce so the player learns to kill generators first
          g.damageNumbers.spawnBlocked(b.x, b.y, b.z);
          Audio2.play('shield_break', 0.3, 1.4, 0.1);
        }
        break;
      }
    }

    // ---- enemy bolts vs player ---------------------------------------------
    for (const b of g.projectiles.enemy) {
      if (!b.active) continue;
      const dx = b.x - px;
      const dy = b.y - py;
      const dz = b.z;
      const d2 = dx * dx + dy * dy + dz * dz;

      if (d2 < (b.radius + p.radius) ** 2) {
        g.projectiles.killEnemyBolt(b);
        if (p.takeDamage(b.damage, b.label)) tookDamage = true;
        g.fx.explode(b.x, b.y, b.z, {
          count: 6,
          colors: [P.orange, P.red, P.white],
          power: 8,
          arcs: false,
        });
        continue;
      }

      // Near-miss during the dodge window. It only counts once the bolt is
      // actually moving away from us — a shot still closing in hasn't been
      // dodged yet, it's just about to hit.
      if (dodging && d2 < (b.radius + p.radius + DODGE_MARGIN) ** 2 && Math.abs(dz) < 4) {
        const receding = dx * b.vx + dy * b.vy + dz * b.vz > 0;
        if (receding) p.dodgePending = true;
      }
    }

    // ---- hazards vs player --------------------------------------------------
    for (const h of g.hazards) {
      if (!h.live) continue;
      if (h.hits(px, py, 0)) {
        if (p.takeDamage(h.damage, h.label)) {
          tookDamage = true;
          if (h.knockback) p.knockback(h.x ?? 0, h.y ?? 0, h.knockback);
          g.camera3.shake(0.5);
        }
      } else if (dodging && h.hits(px, py, DODGE_MARGIN)) {
        // Standing just outside a live beam/zone/shockwave: it is already
        // dealing damage and we are not in it.
        p.dodgePending = true;
      }
    }

    // ---- enemies ramming the player ----------------------------------------
    for (const e of g.enemies.active) {
      if (!e.alive) continue;
      const dx = e.x - px;
      const dy = e.y - py;
      const dz = e.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < (e.radius + p.radius) ** 2) {
        if (p.takeDamage(e.contactDamage, `${e.typeName} COLLISION`)) tookDamage = true;
        e.target.damage(9999); // ramming kills the rammer
      } else if (dodging && d2 < (e.radius + p.radius + DODGE_MARGIN) ** 2) {
        p.dodgePending = true;
      }
    }

    // ---- resolve the dodge --------------------------------------------------
    // Any hit inside the window disqualifies it (Game routes every damage source
    // through player.takeDamage, which sets dodgeSpoiled).
    if (tookDamage && p.dodgeT > 0) p.dodgeSpoiled = true;

    // The window has closed: if something passed us and nothing landed, that's a
    // Perfect Dodge.
    if (!dodging && p.dodgePending && !p.dodgeUsed) {
      if (!p.dodgeSpoiled) this._perfectDodge();
      p.dodgePending = false;
      p.dodgeSpoiled = false;
    }
  }

  _perfectDodge() {
    const g = this.game;
    const p = g.player;
    p.awardDodge();

    const bonus = 250;
    g.score.add(bonus, 'PERFECT DODGE');
    g.heat.onPerfectDodge();
    g.stats.perfectDodges += 1;

    Audio2.play('perfect_dodge', 0.85, 1, 0.04);
    g.hud.toast('RIFT DODGE', `+${Math.round(bonus * g.heat.multiplier)}`, P.cyan);
    g.hud.flashDodge();

    // Reality Tear: the dodge itself becomes a weapon
    if (p.stats.realityTear) {
      const cleared = g.projectiles.clearEnemyNear(p.x, p.y, 14);
      g.fx.explode(p.x, p.y, 0, {
        count: 24,
        colors: [P.cyan, P.magenta, P.white],
        power: 20,
        arcColor: P.magenta,
        gravity: 0,
      });
      for (const e of g.enemies.active) {
        if (!e.alive) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) < 14 && Math.abs(e.z) < 20) {
          e.target.damage(45);
        }
      }
      if (cleared > 0) g.camera3.shake(0.35);
    } else {
      g.fx.explode(p.x, p.y, 0, {
        count: 10,
        colors: [P.cyan, P.white],
        power: 13,
        gravity: 0,
        arcs: false,
      });
    }
  }
}
