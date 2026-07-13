import * as THREE from 'three';
import { P } from '../core/Palette.js';
import { Tex, glowSprite } from '../render/VoxelBuilder.js';
import { TAU, clamp, distToLine, projOnLine } from '../core/Utils.js';

/**
 * Every damaging attack in the game is one of these five shapes. They all live
 * in the player's screen plane (the player sits at z=0), which is what keeps
 * telegraphs honest: what you see is exactly what is tested (spec §34, §44).
 *
 * Contract:
 *   update(dt)   -> advance; set `this.done` when finished
 *   hits(px, py) -> true when the player is inside the *damaging* phase
 *   .live        -> false while still telegraphing (used by the dodge system to
 *                   know an attack is about to become dangerous)
 */

const Z = -1.6; // hazard plane: just behind the player, in front of structures

export class Hazard {
  constructor() {
    this.done = false;
    this.live = false;
    this.damage = 10;
    this.objects = [];
    this.hitCooldown = 0; // per-hazard damage interval (spec §7)
    this.label = 'HAZARD';
  }
  addTo(scene) {
    for (const o of this.objects) scene.add(o);
  }
  dispose(scene) {
    for (const o of this.objects) {
      scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }
    this.objects.length = 0;
  }
  update() {}
  /** @param {number} margin inflates the shape — used for Perfect Dodge near-misses. */
  hits() {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Expanding shockwave ring. Boost through it — this is the signature Perfect
// Dodge opportunity (spec §19 Attack A).
// -----------------------------------------------------------------------------
export class Shockwave extends Hazard {
  constructor({ x = 0, y = 0, maxR = 30, speed = 22, thickness = 2.2, color = P.orange, damage = 18, delay = 0, label = 'SHOCKWAVE' }) {
    super();
    this.x = x;
    this.y = y;
    this.r = 0;
    this.maxR = maxR;
    this.speed = speed;
    this.thickness = thickness;
    this.damage = damage;
    this.delay = delay;
    this.label = label;

    const geo = new THREE.RingGeometry(0.9, 1, 48);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.mesh.position.set(x, y, Z);
    this.objects.push(this.mesh);
  }

  update(dt) {
    if (this.delay > 0) {
      this.delay -= dt;
      // pre-flash so the wave is never a surprise
      this.mesh.material.opacity = 0.25 + 0.25 * Math.sin(this.delay * 30);
      const s = 1.2;
      this.mesh.scale.set(s, s, 1);
      return;
    }
    this.live = true;
    this.r += this.speed * dt;
    this.mesh.scale.set(this.r, this.r, 1);
    // the ring reads as a band, not a hairline: scale opacity as it thins out
    this.mesh.material.opacity = 0.85 * (1 - this.r / this.maxR);
    if (this.r >= this.maxR) this.done = true;
  }

  hits(px, py, margin = 0) {
    if (!this.live) return false;
    const d = Math.hypot(px - this.x, py - this.y);
    return Math.abs(d - this.r) < this.thickness + margin;
  }
}

// -----------------------------------------------------------------------------
// A beam: telegraph line -> lock -> fire. Covers the Tower 1 tracking laser,
// the Tower 2 sweeping lasers, Tower 3 crossfire and the boss laser barrage.
// -----------------------------------------------------------------------------
export class Beam extends Hazard {
  constructor({
    cx = 0, cy = 0, angle = 0, length = 70, width = 1.5,
    color = P.cyan, damage = 22,
    trackTime = 1.5, lockTime = 0.4, fireTime = 0.6,
    sweep = 0, // rad/sec while firing (rotating beams)
    tracker = null, // () => {x,y} to follow during the tracking phase
    label = 'LASER',
  }) {
    super();
    Object.assign(this, { cx, cy, angle, length, width, damage, trackTime, lockTime, fireTime, sweep, tracker, label });
    this.phase = 'track';
    this.t = 0;
    this.hitOnce = false;

    // thin targeting line
    this.line = new THREE.Mesh(
      new THREE.PlaneGeometry(length, 0.16),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    // thick damaging beam
    this.beam = new THREE.Mesh(
      new THREE.PlaneGeometry(length, width * 2),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.glow = glowSprite(color, 3, 0);
    this.objects.push(this.line, this.beam, this.glow);
    this._place();
  }

  _place() {
    // The plane is built along +X, so we rotate to `angle` and push its centre
    // half a length forward — beams emit *from* the source, not through it.
    const hx = this.cx + Math.cos(this.angle) * this.length * 0.5;
    const hy = this.cy + Math.sin(this.angle) * this.length * 0.5;
    for (const o of [this.line, this.beam]) {
      o.position.set(hx, hy, Z);
      o.rotation.z = this.angle;
    }
    this.glow.position.set(this.cx, this.cy, Z);
  }

  update(dt) {
    this.t += dt;
    if (this.phase === 'track') {
      if (this.tracker) {
        const p = this.tracker();
        this.angle = Math.atan2(p.y - this.cy, p.x - this.cx);
      }
      this.line.material.opacity = 0.4 + 0.4 * Math.sin(this.t * 14);
      this._place();
      if (this.t >= this.trackTime) {
        this.phase = 'lock';
        this.t = 0;
      }
    } else if (this.phase === 'lock') {
      // Locked: stops tracking before it fires, so the dodge is always winnable.
      this.line.material.opacity = 0.95;
      this.line.scale.y = 2.4;
      if (this.t >= this.lockTime) {
        this.phase = 'fire';
        this.t = 0;
        this.live = true;
        this.line.visible = false;
      }
    } else if (this.phase === 'fire') {
      if (this.sweep) {
        this.angle += this.sweep * dt;
        this._place();
      }
      const k = this.t / this.fireTime;
      this.beam.material.opacity = 0.9 * (1 - Math.max(0, k - 0.7) / 0.3);
      const w = 1 + 0.2 * Math.sin(this.t * 40);
      this.beam.scale.y = w;
      this.glow.material.opacity = 0.8 * (1 - k);
      const gs = 4 + 3 * Math.sin(this.t * 30);
      this.glow.scale.set(gs, gs, 1);
      if (this.t >= this.fireTime) this.done = true;
    }
  }

  hits(px, py, margin = 0) {
    if (!this.live) return false;
    const d = distToLine(px, py, this.cx, this.cy, this.angle);
    if (d > this.width * this.beam.scale.y + margin) return false;
    const along = projOnLine(px, py, this.cx, this.cy, this.angle);
    return along > 0 && along < this.length;
  }
}

// -----------------------------------------------------------------------------
// A telegraphed circular zone: pressure pulses (T2) and hazard squares (T3).
// -----------------------------------------------------------------------------
export class Zone extends Hazard {
  constructor({
    x = 0, y = 0, r = 6, color = P.red, damage = 16,
    warnTime = 1.1, activeTime = 0.9, knockback = 0, square = false,
    label = 'HAZARD ZONE',
  }) {
    super();
    Object.assign(this, { x, y, r, damage, warnTime, activeTime, knockback, label });
    this.t = 0;
    this.phase = 'warn';

    const geo = square
      ? new THREE.PlaneGeometry(r * 2, r * 2)
      : new THREE.CircleGeometry(r, 28);
    this.fill = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.08,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.fill.position.set(x, y, Z);

    const ogeo = square
      ? new THREE.RingGeometry(r * 1.38, r * 1.44, 4)
      : new THREE.RingGeometry(r * 0.96, r, 32);
    this.ring = new THREE.Mesh(
      ogeo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.ring.position.set(x, y, Z);
    if (square) this.ring.rotation.z = Math.PI / 4;
    this.objects.push(this.fill, this.ring);
    this.square = square;
  }

  update(dt) {
    this.t += dt;
    if (this.phase === 'warn') {
      // outline appears, then brightens — the two-stage tell from the spec
      const k = this.t / this.warnTime;
      this.fill.material.opacity = 0.06 + 0.3 * k * k;
      this.ring.material.opacity = 0.5 + 0.5 * Math.sin(this.t * 16);
      if (this.t >= this.warnTime) {
        this.phase = 'active';
        this.t = 0;
        this.live = true;
      }
    } else {
      const k = this.t / this.activeTime;
      this.fill.material.opacity = 0.75 * (1 - k);
      this.ring.material.opacity = 1 - k;
      const s = 1 + 0.06 * Math.sin(this.t * 30);
      this.fill.scale.set(s, s, 1);
      if (this.t >= this.activeTime) this.done = true;
    }
  }

  hits(px, py, margin = 0) {
    if (!this.live) return false;
    if (this.square) {
      return Math.abs(px - this.x) < this.r + margin && Math.abs(py - this.y) < this.r + margin;
    }
    return Math.hypot(px - this.x, py - this.y) < this.r + margin;
  }
}

// -----------------------------------------------------------------------------
// Gravity well: pulls, never deals damage, never fully removes control (spec §13).
// -----------------------------------------------------------------------------
export class GravityWell extends Hazard {
  constructor({ x = 0, y = 0, r = 12, force = 15, life = 9, color = P.violet }) {
    super();
    Object.assign(this, { x, y, r, force, life });
    this.t = 0;
    this.warn = 0.9;
    this.damage = 0;

    this.spiral = new THREE.Mesh(
      new THREE.RingGeometry(0.5, r, 32, 3),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        wireframe: true,
      })
    );
    this.spiral.position.set(x, y, Z);
    this.core = glowSprite(color, 5, 0.5);
    this.core.position.set(x, y, Z);
    this.objects.push(this.spiral, this.core);
  }

  update(dt) {
    this.t += dt;
    this.spiral.rotation.z -= dt * 1.6;
    const pulse = 1 + 0.08 * Math.sin(this.t * 5);
    this.spiral.scale.set(pulse, pulse, 1);
    if (this.t < this.warn) {
      this.spiral.material.opacity = 0.3 * Math.sin(this.t * 20) ** 2;
      return;
    }
    this.live = true;
    this.spiral.material.opacity = 0.2;
    const fade = Math.min(1, (this.life - this.t) / 1.2);
    this.core.material.opacity = 0.5 * fade;
    if (this.t >= this.life) this.done = true;
  }

  /** Positional pull, applied by the player rather than as damage. */
  pull(px, py, dt, out) {
    if (!this.live) return;
    const dx = this.x - px;
    const dy = this.y - py;
    const d = Math.hypot(dx, dy);
    if (d > this.r || d < 0.001) return;
    const falloff = 1 - d / this.r; // strongest at the centre
    const f = this.force * falloff * dt;
    out.x += (dx / d) * f;
    out.y += (dy / d) * f;
  }

  hits() {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Void Anchor: marks the player, drops, then detonates into a shockwave
// (spec §24 Attack B). The shockwave is spawned by the boss on impact.
// -----------------------------------------------------------------------------
export class VoidAnchor extends Hazard {
  constructor({ x = 0, y = 0, markTime = 1.3, color = P.magenta, damage = 26, onImpact = null }) {
    super();
    Object.assign(this, { x, y, markTime, damage, onImpact });
    this.t = 0;
    this.phase = 'mark';
    this.r = 4.5;
    this.label = 'VOID ANCHOR';

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(4, 4.6, 24),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.marker.position.set(x, y, Z);

    this.anchor = new THREE.Mesh(
      new THREE.ConeGeometry(2.2, 6, 5),
      new THREE.MeshBasicMaterial({ color })
    );
    this.anchor.rotation.x = Math.PI / 2;
    this.anchor.position.set(x, y, -60);
    this.glow = glowSprite(color, 7, 0.8);
    this.glow.position.copy(this.anchor.position);
    this.objects.push(this.marker, this.anchor, this.glow);
  }

  update(dt) {
    this.t += dt;
    if (this.phase === 'mark') {
      const k = this.t / this.markTime;
      this.marker.material.opacity = 0.5 + 0.5 * Math.sin(this.t * 20);
      const s = 1.4 - 0.4 * k;
      this.marker.scale.set(s, s, 1);
      // anchor descends out of the rift toward the mark
      this.anchor.position.z = -60 + 58 * k * k;
      this.glow.position.copy(this.anchor.position);
      if (this.t >= this.markTime) {
        this.phase = 'impact';
        this.t = 0;
        this.live = true;
        this.anchor.position.z = Z;
        if (this.onImpact) this.onImpact(this.x, this.y);
      }
    } else {
      // brief impact flash; the radial damage is the shockwave we spawned
      this.live = this.t < 0.18;
      this.marker.material.opacity = Math.max(0, 1 - this.t * 4);
      this.anchor.material.opacity = Math.max(0, 1 - this.t * 3);
      this.anchor.material.transparent = true;
      if (this.t > 0.5) this.done = true;
    }
  }

  hits(px, py, margin = 0) {
    if (!this.live) return false;
    return Math.hypot(px - this.x, py - this.y) < this.r + margin;
  }
}

/**
 * Safe-zone attack (Nexus Collapse, spec §24 Attack D): the whole arena becomes
 * lethal *except* marked islands. Never unavoidable — safe regions stay visible
 * for the entire telegraph.
 */
export class CollapseField extends Hazard {
  constructor({ safeSpots = [], warnTime = 2.4, activeTime = 1.6, color = P.magenta, damage = 34 }) {
    super();
    this.safeSpots = safeSpots; // [{x,y,r}]
    this.warnTime = warnTime;
    this.activeTime = activeTime;
    this.damage = damage;
    this.t = 0;
    this.phase = 'warn';
    this.label = 'NEXUS COLLAPSE';

    this.safeMeshes = safeSpots.map((s) => {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(s.r, 28),
        new THREE.MeshBasicMaterial({
          color: P.cyan,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      m.position.set(s.x, s.y, Z);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(s.r * 0.94, s.r, 32),
        new THREE.MeshBasicMaterial({
          color: P.cyan,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      ring.position.set(s.x, s.y, Z);
      this.objects.push(m, ring);
      return { m, ring };
    });

    // the lethal wash covering everything else
    this.wash = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 60),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.wash.position.set(0, 2, Z - 0.4);
    this.objects.push(this.wash);
  }

  update(dt) {
    this.t += dt;
    if (this.phase === 'warn') {
      const k = this.t / this.warnTime;
      this.wash.material.opacity = 0.28 * k;
      for (const s of this.safeMeshes) {
        s.ring.material.opacity = 0.6 + 0.4 * Math.sin(this.t * 12);
      }
      if (this.t >= this.warnTime) {
        this.phase = 'active';
        this.t = 0;
        this.live = true;
      }
    } else {
      const k = this.t / this.activeTime;
      // Bright enough to read as lethal, sheer enough that the boss and your own
      // ship stay visible through it — you still have to aim during the collapse.
      this.wash.material.opacity = 0.38 * (1 - k) + 0.12;
      if (this.t >= this.activeTime) this.done = true;
    }
  }

  hits(px, py, margin = 0) {
    if (!this.live) return false;
    for (const s of this.safeSpots) {
      // A positive margin shrinks the shelter, so hugging its edge reads as a dodge.
      if (Math.hypot(px - s.x, py - s.y) < s.r - margin) return false;
    }
    return true;
  }
}
