import { P } from '../core/Palette.js';
import { Audio2 } from '../core/AudioManager.js';
import { blockedBetween } from './AugmentEffects.js';

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

/** Earliest segment/sphere contact; fast lances cannot tunnel through targets. */
export function segmentSphereTime(from, to, center, radius) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const ox = from.x - center.x, oy = from.y - center.y, oz = from.z - center.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-12) return null;
  const b = ox * dx + oy * dy + oz * dz;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : null;
}

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
      const from = { x: b.px ?? b.x, y: b.py ?? b.y, z: b.pz ?? b.z };
      const end = { x: b.x, y: b.y, z: b.z };
      b.hitTargets ||= new Set();
      const hits = [];
      for (const t of g.targets) {
        if (!t.alive || !t.targetable || b.hitTargets.has(t)) continue;
        const at = segmentSphereTime(from, end, t.pos, t.radius + b.radius);
        if (at !== null) hits.push({ target: t, at });
      }
      hits.sort((a, b) => a.at - b.at);
      let redirected = false;
      for (const hit of hits) {
        const t = hit.target;
        if (!t.alive || !t.targetable) continue;
        // Check the swept route only as far as this target. A shield behind a
        // nearer enemy cannot incorrectly protect that enemy from the shot.
        if (blockedBetween(g, from, end, hit.at)) {
          g.projectiles.killPlayerBolt(b, 'blocked');
          Audio2.play('shield_break', 0.2, 1.6, 0.1);
          break;
        }
        b.x = from.x + (end.x - from.x) * hit.at;
        b.y = from.y + (end.y - from.y) * hit.at;
        b.z = from.z + (end.z - from.z) * hit.at;
        b.hitTargets.add(t);
        const dealt = g.augmentEffects
          ? g.augmentEffects.damageTarget(t, b.damage, b.crit, b.procDepth > 0)
          : t.damage(b.damage, b.crit);
        if (dealt > 0) {
          g.damageNumbers.spawn(b.x, b.y, b.z, Math.round(dealt), b.crit);
          g.heat.onDealDamage(dealt);
          Audio2.play(b.crit ? 'crit' : 'hit', b.crit ? 0.6 : 0.28, 1, 0.1);
          const voidImpact = b.voidBeam ? b.visual.impactEffects : 0;
          g.fx.explode(b.x, b.y, b.z, voidImpact > 0 ? {
            count: Math.round(9 * voidImpact),
            colors: ['#1c092c', '#b642ff', '#2affdd', '#ff3a8c', '#338bff'],
            sparkColors: ['#bf74ff', '#38ffe4', '#ff3b83', '#428bff', '#ffe88b'],
            power: 13, gravity: 0, scale: .45, life: .3,
            arcs: true, arcColor: '#be62ff',
            flashColor: '#a65aff',
            flashScale: b.visual.reducedFlashing ? 0 : .65 * voidImpact,
            flashTime: .08,
          } : {
            count: b.crit ? 5 : 2,
            colors: [b.color || P.magenta, P.white],
            power: b.crit ? 9 : 5,
            arcs: false,
            flashScale: b.crit ? 0.55 : 0.25,
            flashColor: b.color || P.magenta,
            flashTime: 0.1,
          });
          g.augmentEffects?.onHit(b, t, dealt);
        } else {
          // shielded: visibly bounce so the player learns to kill generators first
          g.damageNumbers.spawnBlocked(b.x, b.y, b.z);
          Audio2.play('shield_break', 0.3, 1.4, 0.1);
        }
        // A blocked hit never spawns reactions and always absorbs the bolt.
        if (!(dealt > 0)) { g.projectiles.killPlayerBolt(b, 'blocked'); break; }
        if (b.pierce > 0) { b.pierce--; continue; }
        redirected = g.augmentEffects?.redirect(b, t) || false;
        if (!redirected) g.projectiles.killPlayerBolt(b);
        break;
      }
      if (b.active && !redirected) {
        if (blockedBetween(g, from, end)) g.projectiles.killPlayerBolt(b, 'blocked');
        else { b.x = end.x; b.y = end.y; b.z = end.z; }
      }
      if (b.active) b.mesh?.position.set(b.x, b.y, b.z);
    }

    // ---- enemy bolts vs player ---------------------------------------------
    for (const b of g.projectiles.enemy) {
      if (!b.active) continue;
      const dx = b.x - px;
      const dy = b.y - py;
      const dz = b.z;
      const d2 = dx * dx + dy * dy + dz * dz;

      const contact = segmentSphereTime(
        { x: b.px ?? b.x, y: b.py ?? b.y, z: b.pz ?? b.z }, b,
        { x: px, y: py, z: 0 }, b.radius + p.radius
      );
      if (contact !== null) {
        if (g.augmentEffects?.cosmic?.intercept(b)) continue;
        g.projectiles.killEnemyBolt(b);
        if (p.takeDamage(b.damage * (g.augmentEffects?.cosmic?.hostileDamageFactor(b) || 1), b.label)) tookDamage = true;
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

    g.augmentEffects?.onPerfectDodge();
    g.fx.explode(p.x, p.y, 0, {
      count: 10, colors: [P.cyan, P.white], power: 13,
      gravity: 0, arcs: false,
    });
  }
}
