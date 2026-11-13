import { Beam, Zone, Shockwave } from '../effects/Hazards.js';
import { Audio2 } from '../core/AudioManager.js';
import { clamp } from '../core/Utils.js';

/** Fixed route pressure: earned player power never changes these multipliers. */
export function enemySector(state = '') {
  if (/^(TRAVERSAL|TOWER)_2/.test(state)) return 1;
  if (/^(TRAVERSAL|TOWER)_3/.test(state)) return 2;
  if (state.startsWith('INHIBITOR')) return 3;
  if (state.startsWith('BOSS')) return 4;
  return 0;
}

/**
 * One authored special per hull. Tells lock a position before they fire and use
 * the same hazard geometry as collision. No wall-clock timers or callbacks can
 * survive a source ship's death, an augment clear, or reuse of a pooled hull.
 */
export class EnemyAbilities {
  constructor(game) {
    this.game = game;
    this.announced = new Set();
    this.casts = Object.create(null);
  }

  reset(enemy) {
    this.cancel(enemy);
    enemy.special = { phase: 'idle', cooldown: 3.8 + Math.abs(Math.sin(enemy.phase)) * 3.2,
      t: 0, hazards: [], lock: null };
    enemy.specialShieldT = 0;
  }

  cancel(enemy) {
    if (enemy.special) {
      for (const h of enemy.special.hazards) { h.done = true; h.live = false; }
      enemy.special.phase = 'idle';
      enemy.special.hazards = [];
      enemy.special.cooldown = Math.max(2, enemy.special.cooldown || 0);
      enemy.special.lock = null;
    }
    enemy.specialShieldT = 0;
  }

  _enabled() {
    const g = this.game;
    // The escape already owns its only safe corridor. Pursuers retain their
    // ordinary volleys there, rather than covering a required opening with mines.
    return !!g.director?.inCombat && g.director.state !== 'ESCAPE'
      && g.player.alive !== false && g.encounter?.state !== 'dying'
      && typeof g.addHazard === 'function';
  }

  update(enemy, dt) {
    const special = enemy.special, spec = enemy.type.special;
    if (!special || !spec) return;
    enemy.specialShieldT = Math.max(0, enemy.specialShieldT - dt);
    if (!this._enabled()) { this.cancel(enemy); return; }
    const g = this.game;
    // A card selection or encounter transition may have removed its warning.
    // Never release the pending shot after the visual tell has been cleared.
    if (special.phase === 'windup' && special.hazards.some(h => !g.hazards.includes(h))) {
      this.cancel(enemy);
      return;
    }
    if (special.phase === 'windup') {
      special.t += dt;
      if (special.t >= spec.warning) {
        this._release(enemy);
        special.phase = 'recover';
        special.t = 0;
      }
      return;
    }
    if (special.phase === 'recover') {
      special.t += dt;
      if (special.t >= 2.6) {
        special.phase = 'idle';
        special.hazards = [];
        special.cooldown = spec.cooldown * (1 - enemy.sector * .05);
      }
      return;
    }
    special.cooldown -= dt;
    if (special.cooldown > 0 || enemy.z < -65) return;
    const busy = g.enemies.active.filter(e => e.alive && e.special && e.special.phase !== 'idle').length;
    const limit = g.director.state === 'BOSS_COMBAT' ? 1 : enemy.sector >= 2 ? 3 : 2;
    if (busy >= limit || g.hazards.length >= 10) { special.cooldown = .65; return; }
    this._begin(enemy);
  }

  _hazard(enemy, hazard) {
    const special = enemy.special;
    hazard.enemyAbility = enemy.type.special.id;
    hazard.enemyAbilityOwner = enemy;
    const update = hazard.update.bind(hazard);
    hazard.update = dt => {
      if (hazard.done || !enemy.alive || !enemy.active || enemy.special !== special) {
        hazard.done = true; hazard.live = false; return;
      }
      update(dt * (enemy.actionScale ?? 1));
    };
    special.hazards.push(hazard);
    this.game.addHazard(hazard);
    return hazard;
  }

  _beam(enemy, startX, startY, aim, width, label) {
    const spec = enemy.type.special;
    return this._hazard(enemy, new Beam({
      cx: startX, cy: startY, angle: Math.atan2(aim.y - startY, aim.x - startX),
      length: 78, width, color: spec.color, damage: spec.damage * enemy.damagePressure,
      trackTime: 0, lockTime: spec.warning, fireTime: .5, label,
    }));
  }

  _begin(enemy) {
    const g = this.game, spec = enemy.type.special, special = enemy.special;
    const aim = { x: clamp(g.player.x, -20, 20), y: clamp(g.player.y, -8, 12) };
    special.phase = 'windup'; special.t = 0; special.hazards = []; special.lock = aim;
    enemy.burstLeft = 0;
    enemy.fireT = Math.max(enemy.fireT, spec.warning + .7);
    this.casts[spec.id] = (this.casts[spec.id] || 0) + 1;
    if (!this.announced.has(spec.id)) {
      this.announced.add(spec.id);
      g.hud?.toast(spec.name, spec.hint, spec.color);
    }
    Audio2.play('laser_warning', .42, spec.id === 'siegeMines' ? .7 : 1.2);
    switch (spec.id) {
      case 'ionLock':
        this._hazard(enemy, new Zone({ ...aim, r: 3.3, damage: 0, color: spec.color,
          warnTime: spec.warning, activeTime: .55, label: spec.name }));
        break;
      case 'crossfire':
        this._beam(enemy, -32, aim.y - 9, aim, .85, spec.name);
        this._beam(enemy, 32, aim.y - 9, aim, .85, spec.name);
        break;
      case 'siegeMines':
        for (const offset of [-7, 0, 7]) this._hazard(enemy, new Zone({
          x: clamp(aim.x + offset, -20, 20), y: clamp(aim.y + (offset ? 0 : 3), -7, 11),
          r: 3.4, damage: spec.damage * enemy.damagePressure, color: spec.color,
          warnTime: spec.warning, activeTime: .8, label: spec.name,
        }));
        break;
      case 'bulwarkPulse':
        this._hazard(enemy, new Shockwave({ x: enemy.x, y: enemy.y, maxR: 23,
          speed: 16, thickness: 1.25, delay: spec.warning, damage: spec.damage * enemy.damagePressure,
          color: spec.color, label: spec.name }));
        break;
      case 'riftStep': {
        special.destination = { x: clamp(-enemy.x, -17, 17), y: clamp(aim.y + 5, -5, 10) };
        const fromX = special.destination.x < 0 ? -32 : 32;
        this._beam(enemy, fromX, special.destination.y, aim, 1.15, spec.name);
        break;
      }
    }
  }

  _release(enemy) {
    const g = this.game, spec = enemy.type.special, special = enemy.special;
    if (!enemy.alive || !this._enabled()) return;
    if (spec.id === 'ionLock') {
      for (const lane of [-2, -1, 0, 1, 2]) g.projectiles.fireEnemy({
        x: enemy.x + lane * .3, y: enemy.y, z: enemy.z + 1,
        tx: special.lock.x + lane * 2.6, ty: special.lock.y, tz: 0,
        speed: 43, radius: .5, damage: spec.damage * enemy.damagePressure,
        color: spec.color, label: spec.name,
      });
    } else if (spec.id === 'bulwarkPulse') {
      enemy.specialShieldT = 3.5;
    } else if (spec.id === 'riftStep') {
      g.fx.explode(enemy.x, enemy.y, enemy.z, { count: 10, colors: [spec.color],
        power: 7, gravity: 0, arcs: false, flashScale: .6 });
      enemy.x = enemy.fx = special.destination.x;
      enemy.y = enemy.fy = special.destination.y;
      enemy.mesh.position.set(enemy.x, enemy.y, enemy.z);
      g.fx.explode(enemy.x, enemy.y, enemy.z, { count: 14, colors: [spec.color, '#ffffff'],
        power: 10, gravity: 0, arcs: false, flashScale: .8 });
    }
    Audio2.play(spec.id === 'siegeMines' ? 'heavy_shot' : spec.id === 'bulwarkPulse' ? 'overload' : 'laser_fire',
      .48, spec.id === 'bulwarkPulse' ? .9 : 1.2);
  }
}
