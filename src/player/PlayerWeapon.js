import * as THREE from 'three';
import { Audio2 } from '../core/AudioManager.js';
import { Input } from '../core/Input.js';
import { chance } from '../core/Utils.js';
import { weaponPowerSignature, primaryWeaponOutput, projectileAppearance, WEAPON_AUGMENTS } from '../config/weapons.js';

const rank = (stats, id) => Math.max(0, Number(stats[id]) || 0);

/** Manual trigger, modular guns: every gun adds to the salvo without replacing another. */
export class PlayerWeapon {
  constructor(player, projectiles, targeting) {
    this.player = player; this.proj = projectiles; this.targeting = targeting;
    this.orbitMeshes = [];
    this.muzzleFlashes = [];
    if (player.group) {
      const geometry = new THREE.OctahedronGeometry(1);
      for (const side of [-1, 1]) {
        const flash = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
          color: 0xff38c9, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        flash.position.set(side * 1.15, .05, -2.2);
        player.group.add(flash); this.muzzleFlashes.push(flash);
      }
    }
    this.reset();
  }
  reset() {
    this.cooldown = 0; this.muzzle = 1; this.shots = 0; this.time = 0;
    this.echoes = []; this.charge = 0; this.wakeCooldown = 0;
    this.flashT = 0;
    this.focusWeapon = null; this.focusT = 0; this.pendingShowcase = null;
    this.signature = weaponPowerSignature(this.player.stats);
    for (const flash of this.muzzleFlashes) flash.visible = false;
    for (const mesh of this.orbitMeshes) mesh.visible = false;
  }
  _sound(kind, power = 1, strength = 1) {
    if (Audio2.playWeapon) Audio2.playWeapon(kind, power, { strength,
      priority: this.focusT > 0 && kind === this.focusWeapon ? 4 : undefined });
    else if (kind === 'pulse') Audio2.play('player_shot', .3, 1, .06);
  }

  /** A new gun announces itself immediately, then joins the existing arsenal. */
  onAugmentInstalled(id, level = 1) {
    this.signature = weaponPowerSignature(this.player.stats, { shield: this.player.shield });
    const kind = Object.entries(WEAPON_AUGMENTS).find(([, augment]) => augment === id)?.[0];
    const status = this.signature.modifiers.find(modifier => modifier.id === id);
    const passive = ['hotshot', 'rapidFire', 'railAccelerator', 'overcharge', 'bloodReactor', 'treasureMunitions'].includes(id);
    this.focusWeapon = kind || status?.sound || (passive ? this.signature.sound : null);
    this.focusT = 2;
    this.pendingShowcase = kind;
    if (this.focusWeapon) this._sound(this.focusWeapon, level, 1.1);
  }
  _orbitals(count) {
    if (!this.player.group) return;
    if (!this.orbitGeo) {
      this.orbitGeo = new THREE.OctahedronGeometry(.22);
      this.orbitMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#baffee').multiplyScalar(2) });
    }
    while (this.orbitMeshes.length < count) {
      const mesh = new THREE.Mesh(this.orbitGeo, this.orbitMat);
      this.player.group.add(mesh); this.orbitMeshes.push(mesh);
    }
    this.orbitMeshes.forEach((mesh, index) => {
      mesh.visible = index < count;
      if (!mesh.visible) return;
      const angle = this.time * 1.4 + index / count * Math.PI * 2;
      mesh.position.set(Math.cos(angle) * 3.5, Math.sin(angle) * 1.7, .3);
      mesh.rotation.set(this.time, this.time * .5, 0);
    });
  }

  update(dt, ctx) {
    const p = this.player, s = p.stats;
    if (!p.alive || p.frozen) { p.reticleLock = false; return; }
    this.time += dt; this.wakeCooldown -= dt;
    this.focusT = Math.max(0, this.focusT - dt);
    this.flashT = Math.max(0, this.flashT - dt);
    for (const flash of this.muzzleFlashes) {
      flash.visible = this.flashT > 0;
      flash.material.opacity = this.flashT / .065 * .7;
    }
    this._orbitals(Math.min(6, rank(s, 'orbitals') * 2));
    const aiming = Input.aiming;
    const target = aiming ? this.targeting.update(dt, p.pos, ctx.targets) : null;
    if (!aiming) this.targeting.reset();
    p.reticleLock = !!target;
    // Retain the fractional interval between shots. Replacing the cooldown at
    // each shot quantizes high fire rates into identical 30Hz plateaus.
    this.cooldown = Math.max(this.cooldown - dt, -dt);
    const kinetic = rank(s, 'kineticCapacitor');
    if (kinetic) this.charge = Math.min(1, this.charge + Math.hypot(p.vx || 0, p.vy || 0) * dt * (.018 + kinetic * .006));
    if (!Input.firing && !(ctx.testing?.active && ctx.testing.settings.autoFire)) { this.echoes.length = 0; return; }

    // Releasing the trigger cancels echoes. Pause/card screens never advance them.
    for (let i = this.echoes.length - 1; i >= 0; i--) {
      const echo = this.echoes[i]; echo.delay -= dt;
      if (echo.delay > 0) continue;
      this.proj.firePlayer({ ...echo.bolt, x: p.x + echo.side, y: p.y + .05 });
      this.echoes.splice(i, 1); this._sound('echo');
    }
    if (this.cooldown > 0) return;
    // Cadences beyond the visual budget become extra damage, never a dead stack.
    const output = primaryWeaponOutput(s, { fireRate: p.fireRate, critBuffT: p.critBuffT,
      heatMultiplier: ctx.heat.multiplier, shield: p.shield, treasureCharge: p.treasureCharge,
      weakPoint: !!target && target.kind !== 'enemy' });
    this.cooldown += 1 / output.fireRate;
    let damage = output.damage;
    this.signature = weaponPowerSignature(s, { heatMultiplier: ctx.heat.multiplier,
      shield: p.shield, treasureCharge: p.treasureCharge, shot: this.shots });
    p.treasureCharge = 0;
    const crit = chance(s.criticalChance);
    if (crit) damage *= s.criticalMultiplier;
    const t = target?.pos && target.pos.z < -2 ? target.pos : { x: p.x, y: p.y + .05, z: -90 };
    this.muzzle *= -1; this.shots++;
    const showcase = this.pendingShowcase;
    this.pendingShowcase = null;
    const base = { y: p.y + .05, z: -1.6, tx: t.x, ty: t.y, tz: t.z,
      speed: s.projectileSpeed, damage, crit, ricochetsRemaining: rank(s, 'ricochet'), procDepth: 0 };
    const appearance = (weapon) => projectileAppearance(weapon, {
      rank: weapon === 'pulse' ? 1 + this.signature.stacks : rank(s, WEAPON_AUGMENTS[weapon]) || 1,
      power: this.signature.power, signature: this.signature, crit,
    });
    const emit = (weapon, options = {}) => {
      const visual = appearance(weapon);
      return this.proj.firePlayer({ ...base, x: p.x, weapon, color: visual.color, visual, ...options });
    };
    const charged = kinetic && this.charge >= 1;
    emit(charged ? 'capacitor' : 'pulse', { x: p.x + this.muzzle * 1.15,
      damage: damage * (charged ? 1 + kinetic * 2.5 : 1), pierce: charged ? 1 + kinetic : 0 });
    if (charged) { this.charge = 0; this._sound('capacitor', kinetic); }
    else {
      const hasGuns = Object.entries(this.signature.weaponRanks).some(([kind, count]) =>
        count > 0 && !['fragment', 'tesla', 'siphon', 'retaliation', 'singularity'].includes(kind));
      this._sound(this.signature.sound, 1 + this.signature.tier, hasGuns && this.signature.sound === 'pulse' ? .4 : 1);
    }
    this.flashT = .065;
    for (const flash of this.muzzleFlashes) {
      flash.visible = true;
      flash.material.color.set(this.signature.color).multiplyScalar(1.65);
      flash.material.opacity = .7;
      const size = .32 + this.signature.tier * .09;
      flash.scale.set(size, size, size * 2.3);
      flash.rotation.z = this.shots * .7;
    }

    const twins = rank(s, 'twinFangs');
    if (twins) {
      const count = Math.min(6, twins);
      for (let i = 0; i < count; i++) emit('twin', { x: p.x - this.muzzle * (1.15 + i * .4), damage: damage * .65 * twins / count });
      this._sound('twin', twins);
    }
    const broadsides = rank(s, 'broadsides');
    if (broadsides) {
      const pairs = Math.min(4, broadsides);
      for (let i = 0; i < pairs; i++) for (const side of [-1, 1]) emit('broadsides', {
        x: p.x + side * (1.6 + i * .2), tx: t.x + side * (9 + i * 5), ty: t.y + i * 1.3,
        speed: s.projectileSpeed * .95, damage: damage * .7 * broadsides / pairs,
      });
      this._sound('broadsides', broadsides);
    }
    const helix = rank(s, 'helixVolley');
    if (helix && (this.shots % 3 === 0 || showcase === 'helix')) {
      const pairs = Math.min(4, helix);
      for (let i = 0; i < pairs; i++) for (const side of [-1, 1]) {
        const angle = this.shots * .42 + i / pairs * Math.PI;
        emit('helix', { x: p.x + side * .7, tx: t.x + Math.cos(angle) * side * (6 + i * 2),
          ty: t.y + Math.sin(angle) * side * (6 + i * 2), damage: damage * .8 * helix / pairs });
      }
      this._sound('helix', helix);
    }
    const prism = rank(s, 'prismLance');
    if (prism && (this.shots % 4 === 0 || showcase === 'prism')) {
      emit('prism', { damage: damage * 2.6 * prism, speed: s.projectileSpeed * 1.55, pierce: 2 + prism });
      this._sound('prism', prism);
    }
    const scatter = rank(s, 'scatterNova');
    if (scatter && (this.shots % 5 === 0 || showcase === 'scatter')) {
      const count = Math.min(13, 3 + 2 * scatter);
      for (let i = 0; i < count; i++) {
        const offset = i - (count - 1) / 2;
        emit('scatter', { tx: t.x + offset * 4, ty: t.y + Math.cos(offset * 1.3) * 2,
          damage: damage * .8 * (3 + 2 * scatter) / count, speed: s.projectileSpeed * .9 });
      }
      this._sound('scatter', scatter);
    }
    const seeker = rank(s, 'seekerSwarm');
    if (seeker && (this.shots % 6 === 0 || showcase === 'seeker')) {
      const count = Math.min(8, 2 * seeker);
      for (let i = 0; i < count; i++) emit('seeker', { x: p.x + (i - (count - 1) / 2) * .6,
        tx: t.x + (i - (count - 1) / 2) * 7, target, homing: 5 + seeker * .5,
        damage: damage * 1.3 * 2 * seeker / count, speed: s.projectileSpeed * .72, life: 3.4 });
      this._sound('seeker', seeker);
    }
    const mortar = rank(s, 'voidMortar');
    if (mortar && (this.shots % 7 === 0 || showcase === 'mortar')) {
      emit('mortar', { damage: damage * 2.8 * mortar, splash: 5 + mortar * 1.2,
        speed: s.projectileSpeed * .62, life: 4 });
      this._sound('mortar', mortar);
    }
    const orbitals = rank(s, 'orbitals');
    if (orbitals && (this.shots % 3 === 0 || showcase === 'orbital')) {
      const count = Math.min(6, orbitals * 2);
      for (let i = 0; i < count; i++) {
        const angle = this.time * 1.4 + i / count * Math.PI * 2;
        emit('orbital', { x: p.x + Math.cos(angle) * 3.5, y: p.y + Math.sin(angle) * 1.7,
          damage: damage * .7 * orbitals * 2 / count });
      }
      this._sound('orbital', orbitals);
    }
    const echo = rank(s, 'echoBarrage');
    if (echo && (this.shots % 2 === 0 || showcase === 'echo')) {
      const count = Math.min(4, echo);
      for (let i = 0; i < count; i++) this.echoes.push({ delay: .11 + i * .065, side: this.muzzle * .6,
        bolt: { ...base, weapon: 'echo', visual: appearance('echo'), damage: damage * .85 * echo / count } });
    }
    const wake = rank(s, 'shrapnelWake');
    if (wake && p.boosting && this.wakeCooldown <= 0) {
      this.wakeCooldown = .65;
      const count = Math.min(15, 5 + wake * 2);
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2;
        emit('wake', { tx: t.x + Math.cos(angle) * 20, ty: t.y + Math.sin(angle) * 13,
          damage: damage * .9 * (5 + wake * 2) / count });
      }
      this._sound('wake', wake);
    }
  }
}
