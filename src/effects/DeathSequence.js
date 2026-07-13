import * as THREE from 'three';
import { P, DEBRIS } from '../core/Palette.js';
import { Tex, glowSprite } from '../render/VoxelBuilder.js';
import { Audio2 } from '../core/AudioManager.js';
import { rand, clamp, TAU, $ } from '../core/Utils.js';

/**
 * Player death (Player notes): "epic, frightening, violent, terrifyingly
 * invigorating." Time crawls, the mix smears, the core overloads, the hull
 * shatters into glowing voxel debris, everything implodes — then the rift
 * detonates.
 *
 * Hard budget: ~2.6s. Death must never feel like a punishment queue, so the
 * results screen is already reachable while the last shockwave is still ringing.
 */

const PHASES = {
  HITSTOP: 0.18,
  OVERLOAD: 1.0,
  FRACTURE: 0.25,
  IMPLODE: 0.62,
  DETONATE: 0.55,
};
const TOTAL = Object.values(PHASES).reduce((a, b) => a + b, 0);

const IMPLODE_PARTICLES = 260;

export class DeathSequence {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.active = false;
    this.t = 0;
    this.phase = null;

    // inward-falling debris cloud
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(IMPLODE_PARTICLES * 3);
    this.col = new Float32Array(IMPLODE_PARTICLES * 3);
    this.start = new Float32Array(IMPLODE_PARTICLES * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.cloud = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.7,
        map: Tex.glow,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.cloud.frustumCulled = false;
    this.cloud.visible = false;
    scene.add(this.cloud);

    // the singularity the ship collapses into
    this.singularity = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: P.black })
    );
    this.singularity.visible = false;
    scene.add(this.singularity);

    this.rim = glowSprite(P.magenta, 1, 0);
    this.rim.visible = false;
    scene.add(this.rim);

    this.overlay = $('deathFx');
    this.root = document.documentElement;
  }

  start_(x, y) {
    if (this.active) return;
    this.active = true;
    this.t = 0;
    this.phase = 'HITSTOP';
    this.x = x;
    this.y = y;

    const p = this.game.player;
    p.frozen = true;
    this.ship = p.group;

    // the core going critical
    this.coreGlow = glowSprite(P.white, 1, 0);
    this.coreGlow.position.set(x, y, 0);
    this.scene.add(this.coreGlow);

    Audio2.play('player_death', 1, 0.85);
    Audio2.stopMusic(0.5);
    this.overlay.classList.add('on');
    this.game.camera3.shake(0.6);

    if (navigator.vibrate) {
      try {
        navigator.vibrate([90, 40, 160]);
      } catch {
        /* ignore */
      }
    }
  }

  /** @returns {number} time scale the game should run at this frame. */
  get timeScale() {
    if (!this.active) return 1;
    switch (this.phase) {
      case 'HITSTOP':
        return 0.02;
      case 'OVERLOAD':
        return 0.22;
      case 'FRACTURE':
        return 0.45;
      default:
        return 0.8;
    }
  }

  get finished() {
    return this.active && this.t >= TOTAL;
  }

  _seedCloud() {
    const c = new THREE.Color();
    for (let i = 0; i < IMPLODE_PARTICLES; i++) {
      const ph = rand(-1, 1);
      const th = rand(0, TAU);
      const xz = Math.sqrt(1 - ph * ph);
      const r = rand(6, 26);
      const x = this.x + Math.cos(th) * xz * r;
      const y = this.y + ph * r;
      const z = Math.sin(th) * xz * r * 0.7;
      this.start[i * 3] = x;
      this.start[i * 3 + 1] = y;
      this.start[i * 3 + 2] = z;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      c.set(DEBRIS.player[Math.floor(Math.random() * DEBRIS.player.length)]);
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
    }
    this.cloud.geometry.attributes.position.needsUpdate = true;
    this.cloud.geometry.attributes.color.needsUpdate = true;
    this.cloud.visible = true;
  }

  /** Driven with *unscaled* dt — the sequence keeps its own pacing. */
  update(dt) {
    if (!this.active) return;
    this.t += dt;

    const fx = this.game.fx;
    let acc = 0;
    let phase = null;
    let local = 0;
    for (const [name, dur] of Object.entries(PHASES)) {
      if (this.t < acc + dur) {
        phase = name;
        local = (this.t - acc) / dur;
        break;
      }
      acc += dur;
    }
    if (!phase) {
      phase = 'DETONATE';
      local = 1;
    }

    const entered = phase !== this.phase;
    this.phase = phase;

    // ---- screen + audio distortion ramps through overload ----
    const distort =
      phase === 'HITSTOP' ? 0.15 :
      phase === 'OVERLOAD' ? 0.15 + 0.85 * local :
      phase === 'FRACTURE' ? 1 :
      phase === 'IMPLODE' ? 1 - 0.5 * local :
      Math.max(0, 0.5 - local);
    this.root.style.setProperty('--death', distort.toFixed(3));
    Audio2.warp(clamp(distort, 0, 1));

    switch (phase) {
      case 'HITSTOP': {
        if (entered) {
          this.overlay.style.setProperty('--flash', '1');
        }
        this.overlay.style.setProperty('--flash', String(1 - local));
        break;
      }

      case 'OVERLOAD': {
        // the ship convulses while its core runs away
        const shakeAmp = 0.12 + local * 0.5;
        this.ship.position.x = this.x + rand(-shakeAmp, shakeAmp);
        this.ship.position.y = this.y + rand(-shakeAmp, shakeAmp);
        this.ship.rotation.z += dt * (2 + local * 14);
        const sc = 1 + local * 0.35;
        this.ship.scale.set(sc, sc, sc);

        const glow = local * local * 26;
        this.coreGlow.scale.set(glow, glow, 1);
        this.coreGlow.material.opacity = local;
        this.coreGlow.position.set(this.ship.position.x, this.ship.position.y, 0);

        // hull venting plasma as it fails
        if (Math.random() < dt * 60 * local) {
          fx.explode(
            this.x + rand(-1.5, 1.5),
            this.y + rand(-1.5, 1.5),
            rand(-1, 1),
            {
              count: 3,
              colors: [P.cyan, P.white, P.magenta],
              power: 7 + local * 10,
              gravity: 0,
              arcColor: P.cyan,
              flashScale: 0.5,
            }
          );
        }
        this.game.camera3.shake(dt * 2.4 * local);
        break;
      }

      case 'FRACTURE': {
        if (entered) {
          // hull shatters into glowing voxel debris
          this.ship.visible = false;
          fx.explode(this.x, this.y, 0, {
            count: 90,
            colors: DEBRIS.player,
            power: 26,
            gravity: 0,
            spread: 1.6,
            scale: 1.5,
            arcColor: P.cyan,
            flashScale: 3,
            life: 2.4,
          });
          Audio2.play('boss_death', 0.5, 1.5);
          this.game.camera3.shake(1);
          this._seedCloud();
        }
        this.coreGlow.material.opacity = Math.max(0, 1 - local * 2);
        break;
      }

      case 'IMPLODE': {
        if (entered) {
          this.singularity.visible = true;
          this.rim.visible = true;
          this.singularity.position.set(this.x, this.y, 0);
          this.rim.position.set(this.x, this.y, 0);
          Audio2.play('overload', 1, 0.6);
        }
        // everything falls inward — the cosmos taking the ship back
        const k = local * local; // accelerate into the collapse
        for (let i = 0; i < IMPLODE_PARTICLES; i++) {
          this.pos[i * 3] = this.start[i * 3] + (this.x - this.start[i * 3]) * k;
          this.pos[i * 3 + 1] = this.start[i * 3 + 1] + (this.y - this.start[i * 3 + 1]) * k;
          this.pos[i * 3 + 2] = this.start[i * 3 + 2] * (1 - k);
        }
        this.cloud.geometry.attributes.position.needsUpdate = true;
        this.cloud.material.size = 0.7 + local * 1.4;

        const s = 0.4 + local * 3.4;
        this.singularity.scale.setScalar(s);
        const rs = s * 4.5;
        this.rim.scale.set(rs, rs, 1);
        this.rim.material.opacity = local * 0.9;
        this.game.camera3.shake(dt * 3);
        break;
      }

      case 'DETONATE': {
        if (entered) {
          this.cloud.visible = false;
          this.singularity.visible = false;
          // the rift lets go
          fx.explode(this.x, this.y, 0, {
            count: 150,
            colors: [P.magenta, P.violet, P.cyan, P.white, P.gold],
            power: 46,
            gravity: 0,
            spread: 2,
            scale: 2.2,
            arcColor: P.magenta,
            flashColor: 0xffffff,
            flashScale: 9,
            flashTime: 0.5,
            life: 2,
          });
          Audio2.play('boss_death', 1, 0.7);
          this.game.camera3.shake(1.2);
          this.overlay.style.setProperty('--flash', '1');
        }
        this.overlay.style.setProperty('--flash', String(Math.max(0, 1 - local * 1.6)));
        const rs = 12 + local * 90;
        this.rim.scale.set(rs, rs, 1);
        this.rim.material.opacity = Math.max(0, 0.9 - local * 1.1);
        break;
      }
      default:
        break;
    }
  }

  end() {
    this.active = false;
    this.cloud.visible = false;
    this.singularity.visible = false;
    this.rim.visible = false;
    if (this.coreGlow) {
      this.scene.remove(this.coreGlow);
      this.coreGlow = null;
    }
    this.overlay.classList.remove('on');
    this.overlay.style.setProperty('--flash', '0');
    this.root.style.setProperty('--death', '0');
    Audio2.resetWarp();
  }
}
