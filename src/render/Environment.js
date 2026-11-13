import * as THREE from 'three';
import { P, DEBRIS } from '../core/Palette.js';
import { buildVoxels, glowSprite, Tex } from './VoxelBuilder.js';
import {
  asteroidVoxels, debrisVoxels, planetVoxels, wreckVoxels,
  gatePylonVoxels, crateVoxels, pylonVoxels,
} from './Models.js';
import { Target, PRIORITY } from '../combat/Target.js';
import { Audio2 } from '../core/AudioManager.js';
import { rand, chance, TAU } from '../core/Utils.js';
import { ARENA } from '../player/Player.js';
import { ApproachScenery, LivingDebrisField } from './ApproachScenery.js';

/**
 * The world that scrolls past. The player never actually moves forward — the
 * environment moves toward the camera, which is what lets us stop dead for a
 * tower fight without breaking the illusion (spec §5).
 */

const SPAWN_Z = -190;
const KILL_Z = 22;

export class Environment {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.speed = 0;
    this.targetSpeed = 0;

    // --- backdrop ---
    this.starA = this._stars(700, 0.42, 0x9fb4ff);
    this.starB = this._stars(340, 0.24, 0x6d7fd4);
    scene.add(this.starA, this.starB);

    this.nebulae = [];
    for (let i = 0; i < 6; i++) {
      const nb = glowSprite(i % 2 ? P.nebA : P.nebB, rand(60, 120), 0.045);
      nb.position.set(rand(-80, 80), rand(-30, 40), rand(-200, -90));
      scene.add(nb);
      this.nebulae.push(nb);
    }

    this.planet = buildVoxels(planetVoxels(), 1.2);
    this.planet.position.set(-58, 30, -180);
    scene.add(this.planet);

    // A distant silhouette of the Nexus, growing more present each sector.
    this.nexusGlow = glowSprite(P.magenta, 30, 0);
    this.nexusGlow.position.set(0, 8, -185);
    scene.add(this.nexusGlow);

    this.approachScenery = new ApproachScenery(scene);
    this.livingDebris = new LivingDebrisField(scene);

    // --- pools ---
    this.asteroids = this._pool(
      [asteroidVoxels(2), asteroidVoxels(3), asteroidVoxels(4)].map((v) => buildVoxels(v, 0.62)),
      18,
      (m, i) => ({ radius: [1.7, 2.5, 3.2][i % 3], hp: [60, 110, 170][i % 3] })
    );
    this.debris = this._pool([buildVoxels(debrisVoxels(), 0.5)], 14, () => ({ radius: 0.9, hp: 30 }));
    this.wrecks = this._pool([buildVoxels(wreckVoxels(), 0.7)], 5, () => ({ radius: 3, hp: 0, inert: true }));
    this.crates = this._pool([buildVoxels(crateVoxels(), 0.55)], 5, () => ({ radius: 1.7, hp: 0, inert: true }));

    // laser gates (moving obstacles, spec §12)
    this.gates = [];
    const pyl = buildVoxels(gatePylonVoxels(), 0.55);
    for (let i = 0; i < 4; i++) {
      const grp = new THREE.Group();
      const l = pyl.clone();
      const r = pyl.clone();
      l.position.x = -9;
      r.position.x = 9;
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(18, 0.5, 0.5),
        new THREE.MeshBasicMaterial({
          color: P.magenta,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      grp.add(l, r, beam);
      grp.visible = false;
      scene.add(grp);
      this.gates.push({ g: grp, beam, active: false, drift: 0, phase: 0 });
    }

    // anchor pylons for the ceremonial Inhibitor approach
    this.pylons = this._pool([buildVoxels(pylonVoxels(), 0.7)], 6, () => ({ radius: 2, hp: 0, inert: true }));

    this.spawnT = 0;
    this.crateT = 8;
    this.decor = 0;
  }

  _stars(n, size, color) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-90, 90);
      pos[i * 3 + 1] = rand(-45, 50);
      pos[i * 3 + 2] = rand(-230, 12);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(
      g,
      new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.72, depthWrite: false })
    );
  }

  _pool(protos, n, meta) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const m = protos[i % protos.length].clone();
      m.visible = false;
      this.scene.add(m);
      out.push({ g: m, active: false, target: null, ...meta(m, i) });
    }
    return out;
  }

  _free(pool) {
    return pool.find((o) => !o.active) || null;
  }

  setSpeed(v) {
    this.targetSpeed = v;
  }

  /** How visible the Nexus is in the backdrop — ramps up sector by sector. */
  setNexusPresence(k) {
    this.nexusGlow.material.opacity = k * 0.5;
    const s = 25 + k * 45;
    this.nexusGlow.scale.set(s, s, 1);
  }

  setApproachProgress(progress, color = P.cyan) {
    this.approachScenery.setProgress(progress, color);
  }

  clearApproach() {
    this.approachScenery.clear();
  }

  // --- spawning ------------------------------------------------------------

  spawnAsteroid(big = false, opts = {}) {
    const o = this._free(this.asteroids);
    if (!o) return;
    o.g.position.set(opts.x ?? rand(-26, 26), opts.y ?? rand(-10, 16), opts.z ?? SPAWN_Z);
    o.g.visible = true;
    o.active = true;
    o.spin = { x: rand(-0.6, 0.6), y: rand(-0.6, 0.6) };
    o.zf = big ? 0.9 : 1;
    this._registerBreakable(o, 'ASTEROID', DEBRIS.rock);
  }

  spawnDebris() {
    const o = this._free(this.debris);
    if (!o) return;
    o.g.position.set(rand(-26, 26), rand(-9, 15), SPAWN_Z);
    o.g.visible = true;
    o.active = true;
    o.spin = { x: rand(-2, 2), y: rand(-2, 2) };
    o.zf = 1.4;
    this._registerBreakable(o, 'DEBRIS', DEBRIS.rock);
  }

  spawnWreck() {
    const o = this._free(this.wrecks);
    if (!o) return;
    const side = chance(0.5) ? -1 : 1;
    o.g.position.set(side * rand(26, 44), rand(-16, 20), SPAWN_Z);
    o.g.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
    o.g.visible = true;
    o.active = true;
    o.spin = { x: rand(-0.1, 0.1), y: rand(-0.15, 0.15) };
    o.zf = 0.55;
  }

  spawnPylon() {
    const o = this._free(this.pylons);
    if (!o) return;
    const side = chance(0.5) ? -1 : 1;
    o.g.position.set(side * rand(20, 30), rand(-8, 10), SPAWN_Z);
    o.g.visible = true;
    o.active = true;
    o.spin = { x: 0, y: rand(-0.2, 0.2) };
    o.zf = 0.8;
  }

  spawnCrate(opts = {}) {
    const o = this._free(this.crates);
    if (!o) return;
    o.g.position.set(opts.x ?? rand(ARENA.minX + 3, ARENA.maxX - 3), opts.y ?? rand(-5, 10), opts.z ?? SPAWN_Z);
    o.g.visible = true;
    o.active = true;
    o.spin = { x: 1.2, y: 0.9 };
    o.zf = 0.85;
    this.lootSerial = (this.lootSerial || 0) + 1;
    o.lootSourceId = opts.sourceId || `crate:${this.game.director?.state}:${this.lootSerial}`;
    o.lootValue = opts.value ?? 75;
    if (!o.lootHalo) { o.lootHalo = glowSprite(P.gold,5,.32); o.g.add(o.lootHalo); }
    o.lootHalo.visible = true;
    o.target = new Target({ object3D:o.g,hp:35,radius:o.radius,priority:PRIORITY.ENEMY+5,
      kind:'treasure',label:`TREASURE CACHE / ${o.lootValue} SCRAP`,scrap:0,score:0,xp:0,
      onDeath:()=>this._openCrate(o), });
    this.game.targets.push(o.target);
    return o;
  }

  _openCrate(o) {
    if (!o.active) return;
    const g = this.game, pos = o.g.position;
    g.scrap.burst(pos.x,pos.y,pos.z,o.lootValue,.9,{ sourceId:o.lootSourceId,kind:'treasure',
      budgetGroup:`crates:${g.director?.state}`,budgetLimit:12 });
    g.fx.explode(pos.x,pos.y,pos.z,{ count:18,colors:[P.gold,P.white,P.magenta],power:14,arcColor:P.gold,flashScale:1.5 });
    Audio2.play('scrap_burst',.5,1);
    g.hud.toast('TREASURE CACHE OPEN',`${o.lootValue} SCRAP · COLLECT THE GEMS`,P.gold);
    this._release(o);
  }

  spawnGate(opts = {}) {
    const o = this.gates.find((g) => !g.active);
    if (!o) return;
    o.g.position.set(opts.x ?? rand(-6, 6), opts.y ?? rand(-4, 9), opts.z ?? SPAWN_Z);
    o.g.rotation.z = opts.rotation ?? rand(0, Math.PI);
    o.g.visible = true;
    o.active = true;
    o.drift = opts.drift ?? rand(-0.5, 0.5);
    o.phase = rand(0, TAU);
    o.spin = opts.spin ?? rand(-0.35, 0.35);
  }

  /** Asteroids are shootable, so autofire always has something to do. */
  _registerBreakable(o, label, colors) {
    const t = new Target({
      object3D: o.g,
      hp: o.hp,
      radius: o.radius,
      priority: PRIORITY.ENEMY + 6, // below real enemies: never distract from a threat
      kind: 'enemy',
      label,
      scrap: 3,
      score: 40,
      xp: 3,
      onDeath: () => {
        const p = o.g.position;
        this.game.fx.explode(p.x, p.y, p.z, {
          count: 14, colors, power: 12, arcs: false,
        });
        Audio2.play('enemy_death', 0.35, 1.2, 0.1);
        this.lootSerial = (this.lootSerial || 0) + 1;
        this.game.scrap.burst(p.x,p.y,p.z,4,.5,{sourceId:`debris:${this.lootSerial}`,
          kind:'debris',budgetGroup:`debris:${this.game.director?.state}`,budgetLimit:32});
        this.game.score.add(40, 'DEBRIS');
        this.game.heat.onKill();
        this._release(o);
      },
    });
    o.target = t;
    this.game.targets.push(t);
  }

  _release(o) {
    o.active = false;
    o.g.visible = false;
    if (o.target) {
      o.target.alive = false;
      o.target.targetable = false;
      o.target = null;
    }
  }

  // --- per-frame -----------------------------------------------------------

  update(dt) {
    const g = this.game;
    const p = g.player;

    // ease the world speed so stopping for a tower fight is a move, not a cut
    this.speed += (this.targetSpeed - this.speed) * Math.min(1, dt * 1.6);
    const ws = this.speed;
    this.approachScenery.update(dt, ws);
    this.livingDebris.update(dt, ws);

    this._moveStars(this.starA, ws, dt, 1);
    this._moveStars(this.starB, ws, dt, 0.45);
    this.planet.rotation.y += dt * 0.04;
    this.nexusGlow.material.rotation += dt * 0.05;

    for (const nb of this.nebulae) {
      nb.position.z += ws * 0.06 * dt;
      if (nb.position.z > 30) nb.position.z = -200;
    }

    // --- scrolling solids ---
    for (const pool of [this.asteroids, this.debris, this.wrecks, this.pylons]) {
      for (const o of pool) {
        if (!o.active) continue;
        o.g.position.z += ws * (o.zf ?? 1) * dt;
        o.g.rotation.x += o.spin.x * dt;
        o.g.rotation.y += o.spin.y * dt;

        if (o.g.position.z > KILL_Z) {
          this._release(o);
          continue;
        }
        if (o.target) o.target.syncPos();

        // solid collision (asteroids and debris only — decor never hurts you)
        if (!o.inert && p.alive) {
          const d = Math.hypot(o.g.position.x - p.x, o.g.position.y - p.y, o.g.position.z);
          if (d < o.radius + p.radius) {
            g.fx.explode(o.g.position.x, o.g.position.y, o.g.position.z, {
              count: 16, colors: DEBRIS.rock, power: 14,
            });
            Audio2.play('enemy_death', 0.5, 0.9);
            p.takeDamage(16, 'ASTEROID IMPACT');
            g.camera3.shake(0.4);
            this._release(o);
          }
        }
      }
    }

    // --- crates ---
    for (const o of this.crates) {
      if (!o.active) continue;
      o.g.position.z += ws * (o.zf ?? 1) * dt;
      o.g.rotation.x += o.spin.x * dt;
      o.g.rotation.y += o.spin.y * dt;
      if (o.g.position.z > KILL_Z) {
        this._release(o);
        continue;
      }
      if (!p.alive) continue;
      const d = Math.hypot(o.g.position.x - p.x, o.g.position.y - p.y, o.g.position.z);
      if (d < o.radius + p.radius + p.stats.scrapRadius * 0.35) {
        this._openCrate(o);
      }
    }

    // --- laser gates ---
    for (const o of this.gates) {
      if (!o.active) continue;
      o.g.position.z += ws * dt;
      o.g.position.x += Math.sin(o.phase + this.game.time * 0.6) * o.drift * dt;
      o.g.rotation.z += o.spin * dt;
      o.beam.material.opacity = 0.55 + 0.4 * Math.sin(this.game.time * 12);

      if (o.g.position.z > KILL_Z) {
        o.active = false;
        o.g.visible = false;
        continue;
      }

      // beam collision: rotate the player into the gate's local frame
      if (Math.abs(o.g.position.z) < 2.5 && p.alive) {
        const dx = p.x - o.g.position.x;
        const dy = p.y - o.g.position.y;
        const a = -o.g.rotation.z;
        const lx = dx * Math.cos(a) - dy * Math.sin(a);
        const ly = dx * Math.sin(a) + dy * Math.cos(a);
        if (Math.abs(lx) < 9 && Math.abs(ly) < 1.1) {
          p.takeDamage(20, 'LASER GATE');
          g.camera3.shake(0.5);
          g.fx.explode(p.x, p.y, 0, { count: 10, colors: [P.magenta, P.white], power: 10, arcs: false });
        }
      }
    }
  }

  _moveStars(pts, ws, dt, mul) {
    const pos = pts.geometry.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i + 2] += ws * mul * dt;
      if (pos[i + 2] > 14) {
        pos[i + 2] = -230;
        pos[i] = rand(-90, 90);
        pos[i + 1] = rand(-45, 50);
      }
    }
    pts.geometry.attributes.position.needsUpdate = true;
  }

  /** Stretch the stars for the Nexus jump (spec §21). */
  warpStars(k) {
    this.starA.material.size = 0.42 + k * 3.5;
    this.starB.material.size = 0.24 + k * 2.2;
  }

  clearAll() {
    for (const pool of [this.asteroids, this.debris, this.wrecks, this.crates, this.pylons]) {
      for (const o of pool) this._release(o);
    }
    for (const o of this.gates) {
      o.active = false;
      o.g.visible = false;
    }
  }

  reset() {
    this.clearAll();
    this.clearApproach();
    this.speed = 0;
    this.targetSpeed = 0;
    this.warpStars(0);
    this.setNexusPresence(0);
  }
}
