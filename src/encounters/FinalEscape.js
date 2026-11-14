import * as THREE from 'three';
import { Hazard } from '../effects/Hazards.js';
import { Audio2 } from '../core/AudioManager.js';
import { P } from '../core/Palette.js';
import { Tex, glowSprite } from '../render/VoxelBuilder.js';
import { ESCAPE_CONFIG, createEscapeRoute, escapeSpeed } from '../config/finalEscapeRoute.js';
import { escapeIntensity } from '../config/escapeIntensity.js';
import { EscapeArmada } from './EscapeArmada.js';
import { EscapeCarnage } from './EscapeCarnage.js';

const CYAN = 0x18ebdf;
const VIOLET = 0x9a28e0;
const MAGENTA = 0xe62cac;
const WALL_COLORS = [0x0d1020, 0x18112c, 0x281641, 0x38204f, 0x172a38];
const COLLAPSE_COLORS = [0x9132e9, 0xb738de, 0xef5f38, 0xf03972, 0xcf28ed];
const COLLAPSE_CALLS = [
  'Armada inbound. Fire through the fleet. Follow cyan openings.',
  'Reinforcements on every flank. Keep firing and keep moving.',
  'Capital ships are rupturing. Boost through the wreckage.',
  'The entire sector is coming apart. There is no retreat.',
  'Final rift acquired. Punch through the last blockade.',
];
const hash = n => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); };

/**
 * A real wall of obsidian voxels with one stable, cyan-edged aperture. The
 * collision interval sweeps over z=0, so boosting cannot tunnel through it.
 * Normal damage, shields, armor, rolls and Perfect Dodge remain authoritative.
 */
class EscapeWall extends Hazard {
  constructor(escape, definition) {
    super();
    this.escape = escape;
    this.definition = definition;
    this.damage = definition.damage;
    this.label = 'COLLAPSE WALL';
    this.x = definition.x;
    this.y = definition.y;
    this.z = escape.distance - definition.distance;
    this.previousZ = this.z;
    this.group = new THREE.Group();
    this.group.position.z = this.z;
    this.objects.push(this.group);
    this._build();
  }

  _build() {
    const { x, y, halfWidth: w, halfHeight: h, index } = this.definition;
    const cells = [];
    const rectangle = (left, right, bottom, top) => {
      const step = 1.75;
      for (let px = left; px < right - .001; px += step) {
        for (let py = bottom; py < top - .001; py += step) {
          const width = Math.min(step, right - px);
          const height = Math.min(step, top - py);
          cells.push({ x: px + width / 2, y: py + height / 2,
            w: width - .065, h: height - .065, n: hash(cells.length + index * 821) });
        }
      }
    };
    rectangle(-31, x - w, -17, 22);
    rectangle(x + w, 31, -17, 22);
    rectangle(x - w, x + w, -17, y - h);
    rectangle(x - w, x + w, y + h, 22);
    const mesh = new THREE.InstancedMesh(this.escape.cube, this.escape.wallMaterial, cells.length);
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    cells.forEach((cell, i) => {
      transform.position.set(cell.x, cell.y, (cell.n - .5) * .45);
      transform.scale.set(cell.w, cell.h, 1.6 + cell.n * .75);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      color.setHex(WALL_COLORS[Math.floor(cell.n * WALL_COLORS.length)]);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.voxels = mesh;
    this.group.add(mesh);

    // Cyan means traversable; magenta remains outside the aperture. Fixed
    // dimensions match the hit test rather than a decorative shrinking ring.
    const rim = new THREE.InstancedMesh(this.escape.cube, this.escape.cyanMaterial, 4);
    const bars = [[x - w, y, .28, 2 * h], [x + w, y, .28, 2 * h],
      [x, y - h, 2 * w, .28], [x, y + h, 2 * w, .28]];
    bars.forEach(([px, py, width, height], i) => {
      transform.position.set(px, py, 1.5);
      transform.scale.set(width, height, .2);
      transform.updateMatrix();
      rim.setMatrixAt(i, transform.matrix);
    });
    rim.instanceMatrix.needsUpdate = true;
    rim.computeBoundingSphere();
    this.rim = rim;
    this.group.add(rim);

    const fractures = new THREE.InstancedMesh(this.escape.cube, this.escape.fractureMaterial, 30);
    for (let i = 0; i < 30; i++) {
      const side = i % 2 ? -1 : 1;
      const px = x + side * (w + .6 + hash(i * 13 + index) * Math.max(1, 27 - w - Math.abs(x)));
      transform.position.set(px, -14 + hash(i * 31 + index) * 33, 1.35);
      transform.scale.set(.1, .5 + hash(i + index) * 2.2, .13);
      transform.updateMatrix(); fractures.setMatrixAt(i, transform.matrix);
    }
    fractures.instanceMatrix.needsUpdate = true;
    fractures.computeBoundingSphere();
    this.fractures = fractures;
    this.group.add(fractures);
  }

  update() {
    this.previousZ = this.z;
    this.z = this.escape.distance - this.definition.distance;
    this.group.position.z = this.z;
    const contact = ESCAPE_CONFIG.wallDepth / 2 + this.escape.game.player.radius;
    this.live = this.previousZ <= contact && this.z >= -contact;
    // Keep a swept crossing alive for collision resolution, even when an
    // extreme lab build traverses the entire slab in one simulation frame.
    if (this.z > 9 && this.previousZ > contact) this.done = true;
  }

  hits(px, py, margin = 0) {
    if (!this.live) return false;
    const { halfWidth, halfHeight } = this.definition;
    const radius = this.escape.game.player.radius + margin;
    return Math.abs(px - this.x) >= Math.max(0, halfWidth - radius)
      || Math.abs(py - this.y) >= Math.max(0, halfHeight - radius);
  }

  dispose() {
    this.group.removeFromParent();
    // Geometry/materials belong to the escape and are shared across walls.
    for (const mesh of [this.voxels, this.rim, this.fractures]) mesh?.dispose();
    this.objects.length = 0;
    this.done = true;
  }
}

/** Added ending only. It does not mutate player stats, controls, saves or augments. */
export class FinalEscape {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.elapsed = 0;
    this.distance = 0;
    this.speed = ESCAPE_CONFIG.baseSpeed;
    this.deadline = ESCAPE_CONFIG.deadline;
    this.routeLength = ESCAPE_CONFIG.routeLength;
    this.route = createEscapeRoute();
    this.walls = [];
    this.outcome = null;
  }

  get remaining() { return Math.max(0, this.deadline - this.elapsed); }
  get progress() { return Math.min(1, this.distance / this.routeLength); }
  get distanceLeft() { return Math.max(0, this.routeLength - this.distance); }
  get intensity() { return escapeIntensity(this.progress, this.elapsed); }
  get phase() { return this.intensity.name; }
  get lookAhead() { return Math.max(ESCAPE_CONFIG.lookAhead, this.speed * 2.4); }
  get nextGate() {
    const contact = ESCAPE_CONFIG.wallDepth / 2 + this.game.player.radius;
    const gate = this.route.find(gate => gate.distance + contact >= this.distance
      && gate.distance - this.distance <= this.lookAhead);
    if (!gate) return null;
    return { ...gate, eta: Math.max(0, (gate.distance - this.distance) / this.speed) };
  }

  start() {
    this.dispose();
    this.elapsed = this.distance = this.gateCount = 0;
    this.speed = ESCAPE_CONFIG.baseSpeed;
    this.active = true;
    this.outcome = null;
    this.nextWall = 0;
    this.lastTier = 0;
    this._buildScene();
    this.armada = new EscapeArmada(this.game, this);
    this.carnage = new EscapeCarnage(this.game, this);
    this.game.env.setSpeed(this.speed);
    this.game.env.warpStars(.015);
    this._escalate();
    this.game.hud.banner('REACH THE FINAL RIFT', P.cyan);
    this.game.hud.toast('REACH THE FINAL RIFT', 'FIRE THROUGH THE ARMADA · HOLD BOOST · STEER THROUGH CYAN OPENINGS', P.magenta,
      { category: 'instruction', duration: 5.4 });
    Audio2.play('overload', .7, .68);
  }

  _buildScene() {
    this.root = new THREE.Group();
    this.root.name = 'final-escape';
    this.game.scene.add(this.root);
    this.cube = new THREE.BoxGeometry(1, 1, 1);
    this.wallMaterial = new THREE.MeshStandardMaterial({ roughness: .71, metalness: .22,
      emissive: 0x28113f, emissiveIntensity: .17 });
    this.cyanMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(CYAN).multiplyScalar(1.35), fog: false });
    this.fractureMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(VIOLET).multiplyScalar(1.5), fog: false });
    this.dustMaterial = new THREE.MeshStandardMaterial({ color: 0x201830,
      roughness: .78, metalness: .25, emissive: 0x34114c, emissiveIntensity: .25 });
    this.dust = new THREE.InstancedMesh(this.cube, this.dustMaterial, 320);
    this.dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dust.frustumCulled = false;
    this.root.add(this.dust);
    this.transform = new THREE.Object3D();
    this.dustCells = Array.from({ length: 320 }, (_, i) => ({
      x: (i % 2 ? -1 : 1) * (27 + hash(i * 7) * 32),
      y: -18 + hash(i * 13) * 45,
      z: -210 + hash(i * 19) * 235,
      scale: .45 + hash(i * 23) * 2.7,
      spin: hash(i * 29) * Math.PI,
    }));

    // Fractured space closes along the outskirts. Every segment stays beyond
    // the flight corridor; catastrophe never obscures a marked safe gap.
    const cracks = [];
    for (let i = 0; i < 12; i++) {
      const side = i % 2 ? -1 : 1;
      let previous = null;
      for (let j = 0; j < 8; j++) {
        const point = [side * (28 + hash(i * 31 + j) * 14),
          -18 + Math.floor(i / 2) * 7 + (hash(i * 47 + j) - .5) * 5, -195 + j * 29];
        if (previous) cracks.push(...previous, ...point);
        previous = point;
      }
    }
    this.fractureGeometry = new THREE.BufferGeometry();
    this.fractureGeometry.setAttribute('position', new THREE.Float32BufferAttribute(cracks, 3));
    this.fractureLinesMaterial = new THREE.LineBasicMaterial({ color: MAGENTA,
      transparent: true, opacity: .16, blending: THREE.AdditiveBlending, depthWrite: false });
    this.fractureLines = new THREE.LineSegments(this.fractureGeometry, this.fractureLinesMaterial);
    this.root.add(this.fractureLines);

    // Subtle corner brackets project the future opening onto the ship plane,
    // making the safe center area readable despite the chase-camera parallax.
    this.guideMaterial = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true,
      opacity: .25, depthWrite: false, depthTest: false, fog: false });
    this.guide = new THREE.InstancedMesh(this.cube, this.guideMaterial, 8);
    this.guide.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.guide.frustumCulled = false;
    this.guide.renderOrder = 8;
    this.guide.visible = false;
    this.root.add(this.guide);

    this.portal = new THREE.Group();
    this.portal.name = 'final-rift';
    this.portal.position.set(ESCAPE_CONFIG.riftX, ESCAPE_CONFIG.riftY, -400);
    this.root.add(this.portal);
    const ring = new THREE.InstancedMesh(this.cube, this.cyanMaterial, 80);
    const outer = new THREE.InstancedMesh(this.cube, this.fractureMaterial, 64);
    for (const [mesh, count, radius, size] of [[ring, 80, 6.5, .65], [outer, 64, 7.9, .46]]) {
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2;
        this.transform.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
        this.transform.rotation.set(0, 0, angle);
        this.transform.scale.set(size, size, size * 1.7);
        this.transform.updateMatrix(); mesh.setMatrixAt(i, this.transform.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      this.portal.add(mesh);
    }
    this.portalRings = [ring, outer];
    this.portalGlow = glowSprite(CYAN, 20, .3);
    this.portalGlow.material.fog = false;
    this.portal.add(this.portalGlow);
    this.portalCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: Tex.swirl,
      transparent: true, opacity: .42, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.portalCore.scale.set(12, 12, 1);
    this.portal.add(this.portalCore);
    this.portal.visible = false;
    this.transform.rotation.set(0, 0, 0);
  }

  update(dt) {
    if (!this.active || this.outcome || !(dt > 0)) return;
    const g = this.game;
    const step = Math.min(dt, this.remaining);
    this.speed = escapeSpeed(g.player);
    this.elapsed += step;
    this.distance += this.speed * step;
    g.env.setSpeed(this.speed);
    g.env.warpStars(.02 + this.intensity.intensity * .09);

    while (this.nextWall < this.route.length
      && this.route[this.nextWall].distance - this.distance <= this.lookAhead) {
      const wall = new EscapeWall(this, this.route[this.nextWall++]);
      this.walls.push(wall);
      g.addHazard(wall);
      Audio2.play('laser_warning', .32, 1.15, .2);
    }
    this.walls = this.walls.filter(wall => !wall.done);
    this.gateCount = this.route.filter(gate => gate.distance + ESCAPE_CONFIG.wallDepth < this.distance).length;
    this._escalate();
    this.armada.update(step);
    this.carnage.update(step);
    this._render(step);

    if (this.distance >= this.routeLength) {
      const aperture = ESCAPE_CONFIG.riftRadius - g.player.radius;
      const inside = Math.hypot(g.player.x - ESCAPE_CONFIG.riftX, g.player.y - ESCAPE_CONFIG.riftY) < aperture;
      if (inside) this._finish('escaped');
    }
    if (this.active && this.remaining <= 0) {
      this._finish('timeout');
    }
  }

  _escalate() {
    const pressure = this.intensity;
    if (this.lastTier === pressure.tier) return;
    const initial = this.lastTier === 0;
    this.lastTier = pressure.tier;
    this.game.setWorldMood(COLLAPSE_COLORS[pressure.index], 1.3 + pressure.index * .14, .84 + pressure.index * .025);
    if (!initial) {
      this.game.hud.banner(pressure.name, pressure.tier === 5 ? P.cyan : P.magenta);
      this.game.hud.toast(`COLLAPSE ${pressure.tier}/5`, COLLAPSE_CALLS[pressure.index], P.cyan);
      Audio2.play('overload', .5, .72 + pressure.index * .05);
    }
  }

  _render(dt) {
    const o = this.transform;
    this.dustCells.forEach((cell, i) => {
      cell.z += this.speed * dt;
      if (cell.z > 25) cell.z -= 235;
      cell.spin += dt * (i % 2 ? .35 : -.3);
      o.position.set(cell.x, cell.y, cell.z);
      o.rotation.set(cell.spin, cell.spin * .7, 0);
      o.scale.set(cell.scale, cell.scale * .8, cell.scale * 1.5);
      o.updateMatrix(); this.dust.setMatrixAt(i, o.matrix);
    });
    this.dust.instanceMatrix.needsUpdate = true;
    this.fractureLinesMaterial.opacity = .16 + this.progress * .14;
    this.fractureLines.position.z = (this.distance * .25) % 28;
    this.portal.visible = this.progress >= .66;
    const left = this.distanceLeft;
    this.portal.position.z = -(left <= 120 ? left : 120 + (left - 120) * .035);
    this.portalRings[0].rotation.z += dt * .13;
    this.portalRings[1].rotation.z -= dt * .23;
    this.portalGlow.material.opacity = .28 + Math.sin(this.elapsed * 2.5) * .025;
    this.portalCore.material.rotation -= dt * .3;

    const gate = this.nextGate;
    const portalGuide = !gate && left < 425;
    this.guide.visible = Boolean(gate || portalGuide);
    if (this.guide.visible) {
      const p = this.game.player;
      const x = gate?.x ?? ESCAPE_CONFIG.riftX;
      const y = gate?.y ?? ESCAPE_CONFIG.riftY;
      // For the circular rift, a square inscribed in its safe radius cannot
      // imply that a corner outside the actual circle is traversable.
      const r = (ESCAPE_CONFIG.riftRadius - p.radius) / Math.SQRT2;
      const w = gate ? gate.halfWidth - p.radius : r;
      const h = gate ? gate.halfHeight - p.radius : r;
      let i = 0;
      o.rotation.set(0, 0, 0);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        for (const horizontal of [true, false]) {
          o.position.set(x + sx * (w - (horizontal ? .6 : 0)),
            y + sy * (h - (horizontal ? 0 : .6)), 0);
          o.scale.set(horizontal ? 1.2 : .07, horizontal ? .07 : 1.2, .03);
          o.updateMatrix(); this.guide.setMatrixAt(i++, o.matrix);
        }
      }
      this.guide.instanceMatrix.needsUpdate = true;
    }
  }

  _finish(outcome) {
    if (!this.active || this.outcome) return;
    this.outcome = outcome;
    this.active = false;
    if (outcome === 'escaped') this.game.completeEscape();
    else this.game.failEscape('GALACTIC COLLAPSE');
  }

  snapshot() {
    return { active: this.active, outcome: this.outcome, elapsed: this.elapsed,
      remaining: this.remaining, distance: this.distance, distanceLeft: this.distanceLeft,
      progress: this.progress, speed: this.speed, phase: this.phase, gateCount: this.gateCount || 0,
      intensity: this.intensity, armada: this.armada?.snapshot() ?? null, carnage: this.carnage?.snapshot() ?? null,
      nextGate: this.nextGate,
      rift: { x: ESCAPE_CONFIG.riftX, y: ESCAPE_CONFIG.riftY, radius: ESCAPE_CONFIG.riftRadius,
        z: this.portal?.position.z ?? -400, visible: Boolean(this.portal?.visible) } };
  }

  dispose() {
    this.active = false;
    this.armada?.dispose();
    this.carnage?.dispose();
    this.armada = this.carnage = null;
    if (this.walls?.length) {
      const own = new Set(this.walls);
      this.game.hazards = this.game.hazards.filter(hazard => !own.has(hazard));
      for (const wall of this.walls) wall.dispose();
    }
    this.walls = [];
    this.root?.removeFromParent();
    this.dust?.dispose();
    this.guide?.dispose();
    for (const ring of this.portalRings || []) ring.dispose();
    this.portalGlow?.material.dispose();
    this.portalCore?.material.dispose();
    for (const resource of [this.cube, this.wallMaterial, this.cyanMaterial, this.fractureMaterial,
      this.dustMaterial, this.guideMaterial, this.fractureGeometry, this.fractureLinesMaterial]) resource?.dispose();
    this.root = this.dust = this.portal = this.portalGlow = this.portalCore = this.guide = this.fractureLines = null;
    this.portalRings = [];
    this.cube = this.wallMaterial = this.cyanMaterial = this.fractureMaterial = this.dustMaterial = null;
    this.guideMaterial = this.fractureGeometry = this.fractureLinesMaterial = null;
    this.game.env.warpStars(0);
  }
}
