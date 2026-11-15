import * as THREE from 'three';
import { ARENA } from '../player/Player.js';

const COLORS = Object.freeze({ player: 0x36ffe6, enemy: 0xff5a5f, projectile: 0xffc83a,
  target: 0xff4bd1, range: 0x9d68ff, spawn: 0xff8a24, arena: 0x7dff59 });

const material = color => new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true,
  opacity: .78, depthTest: false, depthWrite: false });

/** Pooled, render-only Testing Grounds overlays. They never join collision data. */
export class TestingGizmos {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'testing-ground-gizmos';
    this.root.renderOrder = 1000;
    scene.add(this.root);
    const sphere = new THREE.SphereGeometry(1, 8, 6);
    this.hitboxes = Array.from({ length: 96 }, () => this._mesh(sphere, COLORS.enemy));
    this.projectiles = Array.from({ length: 160 }, () => this._mesh(sphere, COLORS.projectile));
    const marker = new THREE.OctahedronGeometry(1, 0);
    this.markers = Array.from({ length: 48 }, () => this._mesh(marker, COLORS.spawn));
    this.range = this._mesh(new THREE.RingGeometry(.98, 1.02, 64), COLORS.range);
    this.range.rotation.x = Math.PI / 2;
    const points = [
      new THREE.Vector3(ARENA.minX, ARENA.minY, 0), new THREE.Vector3(ARENA.maxX, ARENA.minY, 0),
      new THREE.Vector3(ARENA.maxX, ARENA.maxY, 0), new THREE.Vector3(ARENA.minX, ARENA.maxY, 0),
      new THREE.Vector3(ARENA.minX, ARENA.minY, 0),
    ];
    this.bounds = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: COLORS.arena, transparent: true, opacity: .8, depthTest: false }));
    this.root.add(this.bounds);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(96 * 2 * 3), 3));
    lineGeometry.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(lineGeometry,
      new THREE.LineBasicMaterial({ color: COLORS.target, transparent: true, opacity: .9, depthTest: false }));
    this.root.add(this.lines);
    this.hide();
  }

  _mesh(geometry, color) {
    const mesh = new THREE.Mesh(geometry, material(color));
    mesh.visible = false; mesh.renderOrder = 1001; this.root.add(mesh); return mesh;
  }

  hide() {
    this.root.visible = false;
    for (const pool of [this.hitboxes, this.projectiles, this.markers]) for (const mesh of pool) mesh.visible = false;
    this.range.visible = this.bounds.visible = false;
    this.lines.geometry.setDrawRange(0, 0);
  }

  update(game, flags = {}) {
    const visible = !!(flags.hitboxes || flags.projectiles || flags.targeting || flags.ranges ||
      flags.spawns || flags.bounds || flags.ai);
    if (!visible) {
      if (this.root.visible) this.hide();
      return;
    }
    this.root.visible = true;
    let hi = 0, pi = 0, mi = 0, li = 0;
    const use = (pool, index, pos, scale, color) => {
      const mesh = pool[index]; if (!mesh) return index;
      mesh.visible = true; mesh.position.set(pos.x, pos.y, pos.z ?? 0); mesh.scale.setScalar(Math.max(.08, scale));
      if (color) mesh.material.color.setHex(color);
      return index + 1;
    };
    if (flags.hitboxes) {
      hi = use(this.hitboxes, hi, game.player.pos, game.player.radius || 1.2, COLORS.player);
      for (const target of game.targets) if (target.alive && target.targetable && target.pos) {
        hi = use(this.hitboxes, hi, target.pos, target.radius || 1, target.kind === 'enemy' ? COLORS.enemy : COLORS.target);
      }
    }
    if (flags.projectiles) for (const pool of [game.projectiles.player, game.projectiles.enemy]) {
      for (const bolt of pool) if (bolt.active) {
        pi = use(this.projectiles, pi, bolt, bolt.radius || .4, bolt.team === 'player' ? COLORS.player : COLORS.projectile);
      }
    }
    if (flags.spawns || flags.ai) for (const enemy of game.enemies.active) if (enemy.alive) {
      if (flags.spawns) mi = use(this.markers, mi, { x: enemy.fx, y: enemy.fy, z: enemy.fz }, .55, COLORS.spawn);
      if (flags.ai) {
        const stateColor = enemy.cosmicStunT > 0 ? 0x66aaff : enemy.burstLeft > 0 ? 0xffc83a : enemy.special?.phase === 'windup' ? 0xff4bd1 : 0xff5a5f;
        mi = use(this.markers, mi, enemy, .45, stateColor);
      }
    }
    const positions = this.lines.geometry.attributes.position.array;
    const segment = (a, b) => {
      if (li >= 96) return;
      positions.set([a.x, a.y, a.z ?? 0, b.x, b.y, b.z ?? 0], li * 6); li++;
    };
    if (flags.targeting) {
      const locked = game.targeting?.current;
      if (locked?.pos) segment(game.player.pos, locked.pos);
      for (const pool of [game.projectiles.player, game.projectiles.enemy]) {
        for (const bolt of pool) if (bolt.active) {
          segment(bolt, { x: bolt.x + bolt.vx * .25, y: bolt.y + bolt.vy * .25, z: bolt.z + bolt.vz * .25 });
        }
      }
    }
    if (flags.ai) for (const enemy of game.enemies.active) if (enemy.alive) segment(enemy, { x: enemy.fx, y: enemy.fy, z: enemy.fz });
    this.lines.geometry.setDrawRange(0, li * 2);
    this.lines.geometry.attributes.position.needsUpdate = true;
    for (let i = hi; i < this.hitboxes.length; i++) this.hitboxes[i].visible = false;
    for (let i = pi; i < this.projectiles.length; i++) this.projectiles[i].visible = false;
    for (let i = mi; i < this.markers.length; i++) this.markers[i].visible = false;
    this.bounds.visible = !!flags.bounds;
    this.range.visible = !!flags.ranges;
    if (flags.ranges) {
      const radius = Math.max(5, game.player.stats.scrapRadius) * (game.testing?.getTuning('pickupRadius') || 1);
      this.range.position.set(game.player.x, game.player.y, .2); this.range.scale.setScalar(radius);
    }
  }
}
