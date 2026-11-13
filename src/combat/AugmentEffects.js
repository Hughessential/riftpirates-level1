import * as THREE from 'three';
import { Audio2 } from '../core/AudioManager.js';
import { WEAPON_AUGMENTS } from '../config/weapons.js';
import { CosmicAugmentEffects } from './CosmicAugmentEffects.js';

const COLORS = {
  tesla: '#4c91ff', fragment: '#ff73e8', frost: '#a4edff', burn: '#ff9b35',
  gravity: '#b76bff', singularity: '#bd54ff', siphon: '#46ffcf', revenge: '#ff6651',
};
const rank = (stats, key) => Math.max(0, Number(stats?.[key]) || 0);
const point = (source) => ({ x: source.x, y: source.y, z: source.z });

/** Conservative line-of-sight test shared by bolts and secondary damage. */
export function blockedBetween(game, from, to, until = 1) {
  const blockers = game.projectileBlockers || [];
  if (!blockers.length) return false;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) * until / 0.5));
  for (let i = 0; i <= steps; i++) {
    const t = until * i / steps;
    for (const blocker of blockers) {
      if (blocker.blocks(from.x + dx * t, from.y + dy * t, from.z + dz * t)) return true;
    }
  }
  return false;
}

/**
 * Combat-only augment reactions. Secondary damage may kill, but never starts
 * another chain reaction; rank increases power without recursive event storms.
 * All clocks run on game dt, so caches, pause and restart share one lifecycle.
 */
export class AugmentEffects {
  constructor(game) {
    this.game = game;
    this.visualRoot = new THREE.Group();
    game.scene?.add(this.visualRoot);
    // Real geometry stays readable on dense desktop displays where 1px lines
    // disappear. Ring count and the lightning instance bank remain fixed.
    const ringGeometry = new THREE.TorusGeometry(1, .014, 4, 48);
    this.rings = Array.from({ length: 12 }, () => {
      const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      ring.visible = false;
      this.visualRoot.add(ring);
      return { mesh: ring, active: false, life: 0, duration: 1, radius: 1 };
    });
    this.arcMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({
      transparent: true, opacity: .82, depthWrite: false, blending: THREE.AdditiveBlending,
    }), 48 * 3);
    this.arcMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arcMesh.frustumCulled = false;
    this.arcPart = new THREE.Object3D();
    this.arcColor = new THREE.Color();
    this.visualRoot.add(this.arcMesh);
    this.cosmic = new CosmicAugmentEffects(this);
    this.reset();
  }

  reset() {
    this.cosmic?.reset();
    this.burns = new Map();
    this.fields = [];
    this.arcs = [];
    this.killQueue = [];
    this.creditedKills = new WeakSet();
    this.secondaryDepth = 0;
    this.killCount = 0;
    this.dilationT = 0;
    this.teslaCooldown = 0;
    this.fragmentCooldown = 0;
    this.wellCooldown = 0;
    this.impactCooldown = 0;
    this.frameDamage = 0;
    for (const ring of this.rings) { ring.active = false; ring.mesh.visible = false; }
    this.arcMesh.count = 0;
    if (this.game.player) this.game.player.treasureCharge = 0;
    for (const b of this.game.projectiles?.enemy || []) b.augmentTimeScale = 1;
    for (const enemy of this.game.enemies?.active || []) {
      enemy.augmentSlowT = 0;
      enemy.augmentSlowFactor = 1;
      enemy.cosmicStunT = 0; enemy.cosmicSlowT = 0; enemy.cosmicSlowFactor = 1;
    }
  }

  /** The collision system uses this scope so child projectile kills stay finite. */
  damageTarget(target, amount, crit = false, secondary = true) {
    if (!target.alive || !target.targetable || !(amount > 0)) return 0;
    if (secondary) this.secondaryDepth++;
    const vulnerable = (target.cosmicVulnerableUntil || 0) > (this.cosmic?.time || 0) && target.damageScale >= 1;
    try { return target.damage(Math.min(1e12, amount * (vulnerable ? 1.3 : 1)), crit); }
    finally { if (secondary) this.secondaryDepth--; }
  }

  _valid(target, origin) {
    return target?.alive && target.targetable && !blockedBetween(this.game, origin, target.pos);
  }

  _damage(target, amount, origin, color) {
    if (this.frameDamage >= 100 || !this._valid(target, origin)) return 0;
    this.frameDamage++;
    const dealt = this.damageTarget(target, amount * (this.cosmic?.amp() || 1), false, true);
    if (dealt > 0) {
      this.game.heat?.onDealDamage(dealt);
      this.game.damageNumbers?.spawn(target.pos.x, target.pos.y, target.pos.z, Math.round(dealt), false);
      this._arc(origin, target.pos, color);
    }
    return dealt;
  }

  _arc(from, to, color) {
    if (this.arcs.length >= 48) this.arcs.shift();
    this.arcs.push({ from: point(from), to: point(to), color: new THREE.Color(color), life: 0.18 });
  }

  _ring(origin, radius, color, duration = 0.5) {
    const ring = this.rings.find((item) => !item.active) || this.rings[0];
    ring.active = true;
    ring.duration = duration;
    ring.life = duration;
    ring.radius = radius;
    ring.mesh.position.set(origin.x, origin.y, origin.z);
    ring.mesh.material.color.set(color).multiplyScalar(1.8);
    ring.mesh.visible = true;
    return ring;
  }

  _near(origin, radius, exclude = new Set()) {
    return (this.game.targets || []).filter((t) => !exclude.has(t) && this._valid(t, origin)
      && Math.hypot(t.pos.x - origin.x, t.pos.y - origin.y, t.pos.z - origin.z) <= radius)
      .sort((a, b) => a.pos.distanceToSquared ? a.pos.distanceToSquared(origin) - b.pos.distanceToSquared(origin)
        : Math.hypot(a.pos.x - origin.x, a.pos.y - origin.y, a.pos.z - origin.z)
          - Math.hypot(b.pos.x - origin.x, b.pos.y - origin.y, b.pos.z - origin.z));
  }

  _burst(origin, radius, damage, color, exclude = null) {
    this._ring(origin, radius, color);
    Audio2.playWeapon?.('blast', 1);
    const excluded = exclude ? new Set([exclude]) : new Set();
    for (const t of this._near(origin, radius, excluded)) this._damage(t, damage, origin, color);
  }

  _field(origin, radius, damage, duration, color, pull) {
    // Six independent wells are enough to cover the arena; recycle the oldest.
    if (this.fields.length >= 6) this.fields.shift();
    this.fields.push({ ...point(origin), radius, damage, life: duration, duration, color, pull, tick: 0 });
    this._ring(origin, radius, color, duration);
  }

  onHit(bolt, target, dealt) {
    if (!(dealt > 0)) return;
    if (bolt.procDepth > 0) {
      if (bolt.splash > 0) this._burst(point(bolt), bolt.splash, bolt.damage * .65, bolt.color || COLORS.gravity, target);
      return;
    }
    this.cosmic?.onHit(bolt, target, dealt);
    const s = this.game.player.stats;
    const origin = point(bolt);
    const damage = Math.max(0, bolt.damage);
    const tesla = rank(s, 'teslaFork');
    if (tesla && this.teslaCooldown <= 0) {
      this.teslaCooldown = 0.1;
      let from = origin;
      const visited = new Set([target]);
      for (let i = 0; i < Math.min(2 + tesla, 8); i++) {
        const next = this._near(from, 12 + 1.5 * tesla, visited)[0];
        if (!next) break;
        this._damage(next, damage * 0.35 * tesla, from, COLORS.tesla);
        visited.add(next);
        from = point(next.pos);
      }
      Audio2.playWeapon?.('tesla', tesla);
    }

    const shards = rank(s, 'fragmentation');
    if (shards && this.fragmentCooldown <= 0) {
      this.fragmentCooldown = 0.08;
      const count = Math.min(2 * shards, 8);
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2 + 0.3;
        const child = this.game.projectiles.firePlayer({
          x: origin.x, y: origin.y, z: origin.z - 0.3,
          tx: origin.x + Math.cos(angle) * 12, ty: origin.y + Math.sin(angle) * 12,
          tz: origin.z - 30, speed: this.game.player.stats.projectileSpeed * 0.85,
          damage: damage * 0.35 * (2 * shards / count), crit: false,
          weapon: 'fragment', color: COLORS.fragment, rank: shards, power: shards, procDepth: 1,
        });
        child?.hitTargets?.add(target);
      }
      Audio2.playWeapon?.('fragment', shards);
    }

    const cryo = rank(s, 'cryoRounds');
    if (cryo && target.owner?.alive) this._slow(target.owner, 1 / (1 + 0.28 * cryo), 1.6 + 0.4 * cryo);
    const burn = rank(s, 'solarBurn');
    if (burn && target.alive) {
      const previous = this.burns.get(target);
      this.burns.set(target, { life: 2.5, tick: previous?.tick || 0,
        damage: Math.max(previous?.damage || 0, damage * 0.22 * burn), origin });
    }
    if ((cryo || burn) && this.impactCooldown <= 0) {
      this.impactCooldown = .12;
      const color = cryo && !burn ? COLORS.frost : burn && !cryo ? COLORS.burn
        : (this.killCount + Math.floor(this.game.time || 0)) % 2 ? COLORS.frost : COLORS.burn;
      this.game.fx?.explode?.(origin.x, origin.y, origin.z, { count: 4,
        colors: [color], power: 6, arcs: false, flashScale: .35,
        flashColor: color, flashTime: .12 });
      if (cryo) this._ring(origin, Math.min(3, 1.1 + cryo * .18), COLORS.frost, .25);
    }
    const gravity = rank(s, 'gravityWell');
    if (gravity && this.wellCooldown <= 0) {
      this.wellCooldown = 1.2;
      this._field(origin, 4 + 1.2 * gravity, damage * 0.15 * gravity, 2.2, COLORS.gravity, 2 + gravity);
    }

    const execution = rank(s, 'executionProtocol');
    if (execution && target.kind === 'enemy' && target.alive
      && target.hp / target.maxHp <= Math.min(0.55, 0.08 + 0.035 * execution)) {
      this._damage(target, damage * 0.7 * execution, origin, '#ff3e6c');
    }
    if (bolt.splash > 0) this._burst(origin, bolt.splash, damage * 0.65, bolt.color || COLORS.gravity, target);
  }

  redirect(bolt, target) {
    if (!(bolt.ricochetsRemaining > 0) || bolt.procDepth > 0) return false;
    const origin = point(bolt);
    const exclude = new Set(bolt.hitTargets || []);
    exclude.add(target);
    // Ricochets may travel sideways or slightly back through the enemy fleet,
    // but never seek a target behind the player or cross a shield wall.
    const next = this._near(origin, 28, exclude).find((t) => t.pos.z < -2);
    if (!next) return false;
    const dx = next.pos.x - origin.x, dy = next.pos.y - origin.y, dz = next.pos.z - origin.z;
    const distance = Math.hypot(dx, dy, dz) || 1;
    const speed = bolt.speed || Math.hypot(bolt.vx, bolt.vy, bolt.vz);
    bolt.vx = dx / distance * speed;
    bolt.vy = dy / distance * speed;
    bolt.vz = dz / distance * speed;
    bolt.damage *= 1.08;
    bolt.ricochetsRemaining--;
    bolt.life = Math.max(bolt.life, 0.6);
    bolt.target = next;
    bolt.mesh?.lookAt(next.pos.x, next.pos.y, next.pos.z);
    this._arc(origin, next.pos, '#73ffc0');
    return true;
  }

  _slow(enemy, factor, time) {
    enemy.augmentSlowFactor = Math.min(enemy.augmentSlowFactor || 1, factor);
    enemy.augmentSlowT = Math.max(enemy.augmentSlowT || 0, time);
  }

  onKill(enemy) {
    if (!enemy.target || this.creditedKills.has(enemy.target)) return;
    this.creditedKills.add(enemy.target);
    this.cosmic?.onKill(enemy, this.secondaryDepth > 0);
    const s = this.game.player.stats;
    const blood = rank(s, 'bloodReactor');
    if (blood && this.game.player.shield <= 0) this.game.player.heal(2 * blood);
    // Kills caused by fragments, damage-over-time and blasts still pay normal
    // loot/XP, but cannot recursively detonate the fleet in one event stack.
    if (this.secondaryDepth) return;
    this.killCount++;
    if (this.killQueue.length < 64) this.killQueue.push({ ...point(enemy),
      chain: rank(s, 'chainReaction'),
      singularity: this.killCount % 4 === 0 ? rank(s, 'singularity') : 0 });
  }

  onPerfectDodge() {
    this.cosmic?.onPerfectDodge();
    const g = this.game, p = g.player, s = p.stats;
    const tear = rank(s, 'realityTear');
    const siphon = rank(s, 'bulletSiphon');
    if (siphon) {
      let stolen = 0;
      for (const bolt of g.projectiles.enemy) {
        if (!bolt.active || bolt.z < -35 || Math.hypot(bolt.x - p.x, bolt.y - p.y) > 12 + siphon) continue;
        g.projectiles.killEnemyBolt(bolt);
        if (++stolen >= 3 + 2 * siphon) break;
      }
      this._fan(p, 2 * siphon + stolen, 16 * siphon, 'siphon', COLORS.siphon);
      Audio2.playWeapon?.('siphon', siphon);
    }
    // Convert bullets before Reality Tear clears the remainder, so both
    // augments keep their full benefit when they are in the same build.
    if (tear) {
      const radius = 12 + 2 * tear;
      g.projectiles.clearEnemyNear(p.x, p.y, radius);
      this._burst({ x: p.x, y: p.y, z: -9 }, radius, 45 * tear, COLORS.siphon);
    }
    const dilation = rank(s, 'timeDilation');
    if (dilation) {
      this.dilationT = 2 + 0.5 * dilation;
      this._ring({ x: p.x, y: p.y, z: -8 }, 19, COLORS.frost, 0.9);
    }
  }

  _fan(p, requested, damage, weapon, color) {
    const count = Math.min(24, requested);
    for (let i = 0; i < count; i++) {
      const angle = (i / Math.max(1, count - 1) - 0.5) * 1.8;
      this.game.projectiles.firePlayer({ x: p.x, y: p.y, z: -2,
        tx: p.x + Math.sin(angle) * 28, ty: p.y + Math.sin(angle * 3) * 5,
        tz: -48, speed: p.stats.projectileSpeed, damage: damage * requested / count,
        crit: false, weapon, color, rank: rank(p.stats, WEAPON_AUGMENTS[weapon]) || 1,
        power: rank(p.stats, WEAPON_AUGMENTS[weapon]), procDepth: 1 });
    }
  }

  onShieldBreak() {
    const p = this.game.player;
    const revenge = rank(p.stats, 'revengeMatrix');
    if (!revenge) return;
    this.game.projectiles.clearEnemyNear(p.x, p.y, 8 + revenge);
    this._fan(p, 8 + revenge, 14 * revenge, 'retaliation', COLORS.revenge);
    this._ring({ x: p.x, y: p.y, z: -2 }, 8 + revenge, COLORS.revenge);
    Audio2.playWeapon?.('retaliation', revenge);
  }

  onScrap(amount, event) {
    this.cosmic?.onScrap(amount, event);
    const p = this.game.player;
    const treasure = rank(p.stats, 'treasureMunitions');
    if (treasure) p.treasureCharge = Math.min(300 * treasure, (p.treasureCharge || 0) + Math.max(0, amount) * 1.5 * treasure);
  }

  update(dt, { active = true } = {}) {
    this.frameDamage = 0;
    this.teslaCooldown -= dt;
    this.fragmentCooldown -= dt;
    this.wellCooldown -= dt;
    this.impactCooldown -= dt;
    if (!active) {
      this.burns.clear();
      this.fields.length = 0;
      this.killQueue.length = 0;
      this.dilationT = 0;
      for (const enemy of this.game.enemies?.active || []) {
        enemy.augmentSlowT = 0;
        enemy.augmentSlowFactor = 1;
        enemy.cosmicStunT = 0; enemy.cosmicSlowT = 0; enemy.cosmicSlowFactor = 1;
      }
    }
    const queued = this.killQueue.splice(0, 16);
    for (const kill of queued) {
      if (kill.chain) this._burst(kill, 5 + kill.chain, 18 * kill.chain, COLORS.burn);
      if (kill.singularity) {
        this._field(kill, 6 + kill.singularity, 24 * kill.singularity, 3, COLORS.singularity, 4 + kill.singularity);
        Audio2.playWeapon?.('singularity', kill.singularity);
      }
    }
    for (const [target, burn] of this.burns) {
      burn.life -= dt;
      if (!target.alive || !target.targetable || burn.life <= 0) { this.burns.delete(target); continue; }
      burn.tick += dt;
      if (burn.tick >= 0.25) {
        this._damage(target, burn.damage * burn.tick, burn.origin, COLORS.burn);
        burn.tick = 0;
      }
    }
    for (const field of this.fields) {
      field.life -= dt;
      field.tick += dt;
      for (const enemy of this.game.enemies?.active || []) {
        if (!enemy.alive || Math.hypot(enemy.x - field.x, enemy.y - field.y, enemy.z - field.z) > field.radius) continue;
        if (blockedBetween(this.game, field, enemy.target.pos)) continue;
        this._slow(enemy, 0.6, 0.3);
        const pull = Math.min(0.25, dt * field.pull);
        enemy.x += (field.x - enemy.x) * pull;
        enemy.y += (field.y - enemy.y) * pull;
        enemy.mesh?.position.set(enemy.x, enemy.y, enemy.z);
        enemy.target.syncPos?.();
      }
      if (field.tick >= 0.25) {
        for (const target of this._near(field, field.radius)) this._damage(target, field.damage * field.tick, field, field.color);
        field.tick = 0;
      }
    }
    this.fields = this.fields.filter((field) => field.life > 0);
    this.dilationT = Math.max(0, this.dilationT - dt);
    const p = this.game.player;
    const dilation = rank(p.stats, 'timeDilation');
    for (const bolt of this.game.projectiles?.enemy || []) {
      bolt.augmentTimeScale = this.dilationT > 0 && bolt.z > -35
        && Math.hypot(bolt.x - p.x, bolt.y - p.y) < 20 ? 1 / (1 + 0.35 * dilation) : 1;
    }
    this.cosmic?.update(dt, { active });
    for (const ring of this.rings) {
      if (!ring.active) continue;
      ring.life -= dt;
      ring.active = ring.life > 0;
      ring.mesh.visible = ring.active;
      const progress = 1 - Math.max(0, ring.life / ring.duration);
      ring.mesh.scale.setScalar(ring.radius * (0.72 + 0.28 * progress));
      ring.mesh.material.opacity = Math.max(0, (1 - progress) * 0.7);
      ring.mesh.rotation.z += dt * 0.18;
    }
    this.arcs = this.arcs.filter((arc) => (arc.life -= dt) > 0);
    for (let i = 0; i < this.arcs.length; i++) {
      const arc = this.arcs[i], d = this.arcPart;
      const dx = arc.to.x - arc.from.x, dy = arc.to.y - arc.from.y, dz = arc.to.z - arc.from.z;
      const bend = Math.min(1.3, Math.hypot(dx, dy, dz) * .12);
      const fade = arc.life / .18;
      this.arcColor.copy(arc.color).multiplyScalar(1.9 * fade);
      // A stable zig-zag makes chain lightning read as electricity, not aim lines.
      let x = arc.from.x, y = arc.from.y, z = arc.from.z;
      for (let part = 0; part < 3; part++) {
        const t = (part + 1) / 3;
        const offset = part === 2 ? 0 : (part === 0 ? bend : -bend);
        const nx = arc.from.x + dx * t + offset;
        const ny = arc.from.y + dy * t + offset * .6;
        const nz = arc.from.z + dz * t;
        d.position.set((x + nx) / 2, (y + ny) / 2, (z + nz) / 2);
        d.lookAt(nx, ny, nz);
        d.scale.set(.12 * fade, .12 * fade, Math.max(.01, Math.hypot(nx - x, ny - y, nz - z)));
        d.updateMatrix();
        this.arcMesh.setMatrixAt(i * 3 + part, d.matrix);
        this.arcMesh.setColorAt(i * 3 + part, this.arcColor);
        x = nx; y = ny; z = nz;
      }
    }
    this.arcMesh.count = this.arcs.length * 3;
    this.arcMesh.instanceMatrix.needsUpdate = true;
    if (this.arcMesh.instanceColor) this.arcMesh.instanceColor.needsUpdate = true;
  }
}
