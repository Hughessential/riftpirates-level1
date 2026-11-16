import * as THREE from 'three';
import { ULTRA_ULTIMATE_DEFAULTS as DEFAULTS } from '../config/abilities.js';
import { BLACK_SURFACE_LAYER } from '../render/BlackSurfacePass.js';

// Fixed budgets: five storm batches (including welded joints), two wake batches and one glint batch.
// Decorative counts never influence the damage field or its pulse frequency.
const MAX_MAJOR = 24;
const MAX_MINOR = 40;
const MAX_STRIKES = 16;
const SEGMENTS = 12;
const JOINT_NODES = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11];
const MAX_BOLTS = MAX_MAJOR + MAX_MINOR + MAX_STRIKES;
const WAKE_COUNT = 900;
const GLINT_COUNT = 96;
const TAU = Math.PI * 2;
const Y = new THREE.Vector3(0, 1, 0);
const ACCENTS = ['#ff139b', '#177aff', '#ff1538'];
const value = (t, key) => Number.isFinite(t?.[key]) ? t[key] : DEFAULTS[key];
const clamp = THREE.MathUtils.clamp;
const random = (a, b) => a + Math.random() * (b - a);

const auraVertex = `
  varying vec3 vPoint;
  varying vec3 vViewNormal;
  varying vec3 vEye;
  void main() {
    vPoint = position;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vEye = -view.xyz;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * view;
  }`;
const rainbowGLSL = `
  vec3 rainbow(float phase) {
    return clamp(abs(mod(phase * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }`;
const auraFragment = `
  uniform float time;
  uniform float opacity;
  uniform float intensity;
  uniform float cycle;
  uniform float kind;
  varying vec3 vPoint;
  varying vec3 vViewNormal;
  varying vec3 vEye;
  ${rainbowGLSL}
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vViewNormal), normalize(vEye))), 2.6);
    float phase = atan(vPoint.y, vPoint.x) / 6.2831853 + vPoint.z * .15 + time * cycle;
    vec3 color = rainbow(phase);
    vec3 royal = rainbow(.78 - .32 * (.5 + .5 * sin(phase * 6.2831853)));
    color = mix(royal, color, .8);
    float filament = pow(.5 + .5 * sin(vPoint.y * 37. + vPoint.z * 18. - time * 1.3), 18.);
    float shimmer = .82 + .18 * sin(vPoint.x * 32. + time * 1.8);
    float alpha = opacity * (rim * (.5 + filament * .5) + filament * .018) * shimmer;
    if (kind > .5) alpha = opacity * (.45 + .55 * pow(.5 + .5 * sin(phase * 19. - time), 3.));
    gl_FragColor = vec4(color * intensity, alpha);
  }`;

function auraMaterial(uniforms, kind = 0) {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, kind: { value: kind } },
    vertexShader: auraVertex, fragmentShader: auraFragment,
    transparent: true, blending: kind ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  });
}

/**
 * Presentation for the private ultra ability. All gameplay belongs to Player /
 * UltraUltimate: this class owns only isolated materials and reusable effects.
 * No projectile, forward beam, target damage, input, audio or real-time timer is
 * created here. Short-lived target arcs are fed by the actual damage pulses.
 */
export class UltraUltimateEffect {
  constructor(player, fx, camera = null) {
    this.player = player;
    this.fx = fx;
    this.camera = camera;
    this._cameraPosition = new THREE.Vector3();
    this._cameraForward = new THREE.Vector3();
    this.root = new THREE.Group();
    this.root.name = 'ULTRA — BLACK LIGHTNING / RAINBOW AURA';
    this.root.visible = false;
    player.group.add(this.root);
    this.wakeRoot = new THREE.Group();
    this.wakeRoot.name = 'ULTRA — WORLD SPACE PRISMATIC WAKE';
    this.wakeRoot.visible = false;
    player.scene.add(this.wakeRoot);
    this.active = false;
    this.fade = 0;
    this.time = 0;
    this.originalMaterials = [];
    this._dummy = new THREE.Object3D();
    this._delta = new THREE.Vector3();
    this._point = new THREE.Vector3();
    this._world = new THREE.Vector3();
    this._lastWorld = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._color = new THREE.Color();
    this._color2 = new THREE.Color();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._wakeCarry = 0;
    this._wakeCursor = 0;
    this._strikeCursor = 0;
    this._primed = false;
    this._burstTime = 0;
    this._buildArmor();
    this._buildStorm();
    this._buildAura();
    this._buildWake();
    this._buildGlints();
    this._buildRadiusGizmo();
  }

  _batch(geometry, material, count, parent = this.root) {
    const batch = new THREE.InstancedMesh(geometry, material, count);
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    batch.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      batch.setMatrixAt(i, this._zero);
      batch.setColorAt(i, this._color.setHex(0xffffff));
    }
    batch.instanceColor.setUsage(THREE.DynamicDrawUsage);
    parent.add(batch);
    return batch;
  }

  _buildArmor() {
    this.armorUniforms = { time: { value: 0 }, shine: { value: 1.5 } };
    this.armorMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x010103, roughness: .045, metalness: .55,
      clearcoat: 1, clearcoatRoughness: .015, envMapIntensity: 2.4,
      emissive: 0x000000, emissiveIntensity: 1,
    });
    this.armorMaterial.onBeforeCompile = shader => {
      shader.uniforms.ultraTime = this.armorUniforms.time;
      shader.uniforms.ultraShine = this.armorUniforms.shine;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vUltraPosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUltraPosition = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vUltraPosition; uniform float ultraTime; uniform float ultraShine;
          ${rainbowGLSL}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float coord = vUltraPosition.x * .33 - vUltraPosition.z * .21 + vUltraPosition.y * .08;
          float sweep = pow(max(0., cos(coord * 2.3 - ultraTime * 1.5)), 28.);
          float sweep2 = pow(max(0., cos(vUltraPosition.z * 1.3 + vUltraPosition.x * .8 + ultraTime * 1.25)), 22.);
          float finish = pow(.5 + .5 * sin(coord * 9. + ultraTime * .8), 24.) * .18;
          float rim = pow(1. - abs(dot(normalize(normal), normalize(vViewPosition))), 4.);
          vec3 prism = rainbow(.78 - .32 * (.5 + .5 * sin(coord + ultraTime * .6)));
          totalEmissiveRadiance += (vec3(.82,.87,1.) * (sweep * 1.15 + sweep2 * .65 + finish) + prism * rim * .10) * ultraShine;`);
    };
    this.armorMaterial.customProgramCacheKey = () => 'rift-ultra-obsidian-v1';
  }

  _buildStorm() {
    // A tapered hexagonal segment makes an angular fracture, not a neon line.
    this.boltGeometry = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    const tipFactors = new Float32Array(MAX_BOLTS * SEGMENTS);
    for (let i = 0; i < tipFactors.length; i++) tipFactors[i] = i % SEGMENTS === 7 || i % SEGMENTS === 11 ? 0 : .9;
    this.boltGeometry.setAttribute('ultraTip', new THREE.InstancedBufferAttribute(tipFactors, 1));
    const baseFactors = new Float32Array(MAX_BOLTS * SEGMENTS);
    for (let i = 0; i < baseFactors.length; i++) baseFactors[i] = i % SEGMENTS === 0 ? 0 : 1;
    this.boltGeometry.setAttribute('ultraBase', new THREE.InstancedBufferAttribute(baseFactors, 1));
    this.coreMaterial = new THREE.MeshBasicMaterial({ color: 0x000001, toneMapped: false });
    // Back faces provide an enlarged luminous silhouette without laying a
    // transparent colored front face over the opaque black inner geometry.
    this.edgeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, toneMapped: false });
    this.haloMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, side: THREE.BackSide, transparent: true,
      opacity: .13, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    for (const material of [this.coreMaterial, this.edgeMaterial, this.haloMaterial]) {
      material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float ultraTip;\nattribute float ultraBase;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz *= mix(ultraBase, ultraTip, uv.y);');
      };
      material.customProgramCacheKey = () => 'rift-ultra-pointed-fractures-v1';
    }
    this.cores = this._batch(this.boltGeometry, this.coreMaterial, MAX_BOLTS * SEGMENTS);
    this.edges = this._batch(this.boltGeometry, this.edgeMaterial, MAX_BOLTS * SEGMENTS);
    this.halos = this._batch(this.boltGeometry, this.haloMaterial, MAX_BOLTS * SEGMENTS);
    this.cores.name = 'ULTRA opaque black lightning cores';
    this.cores.layers.enable(BLACK_SURFACE_LAYER);
    this.edges.name = 'ULTRA purple-to-teal lightning edges';
    this.halos.name = 'ULTRA soft lightning corona';
    this.edges.renderOrder = 11;
    this.cores.renderOrder = 12;
    this.halos.renderOrder = 13;
    const jointGeometry = new THREE.IcosahedronGeometry(1, 0);
    const jointTips = new Float32Array(MAX_BOLTS * JOINT_NODES.length).fill(1);
    jointGeometry.setAttribute('ultraTip', new THREE.InstancedBufferAttribute(jointTips, 1));
    jointGeometry.setAttribute('ultraBase', new THREE.InstancedBufferAttribute(jointTips.slice(), 1));
    this.coreJoints = this._batch(jointGeometry, this.coreMaterial, MAX_BOLTS * JOINT_NODES.length);
    this.edgeJoints = this._batch(jointGeometry, this.edgeMaterial, MAX_BOLTS * JOINT_NODES.length);
    this.coreJoints.name = 'ULTRA welded black fracture joints';
    this.edgeJoints.name = 'ULTRA prismatic fracture joint edges';
    this.coreJoints.layers.enable(BLACK_SURFACE_LAYER);
    this.coreJoints.renderOrder = 12;
    this.edgeJoints.renderOrder = 11;
    this.bolts = Array.from({ length: MAX_BOLTS }, (_, index) => ({
      index, age: 0, life: 0, scale: 1, phase: Math.random(),
      points: Array.from({ length: SEGMENTS + 1 }, () => new THREE.Vector3()),
      endpoint: new THREE.Vector3(), target: false, enabled: false,
    }));
  }

  _buildAura() {
    this.auraUniforms = {
      time: { value: 0 }, opacity: { value: .18 }, intensity: { value: 1.7 }, cycle: { value: .24 },
    };
    this.envelopes = [];
    const envelopeGeo = new THREE.IcosahedronGeometry(1, 3);
    for (let i = 0; i < 3; i++) {
      const material = auraMaterial(this.auraUniforms);
      material.uniforms.opacity = { value: 0 };
      const mesh = new THREE.Mesh(envelopeGeo, material);
      mesh.renderOrder = 6;
      this.root.add(mesh);
      this.envelopes.push(mesh);
    }
    this.lattices = [];
    const latticeGeo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 1));
    const latticePoints = latticeGeo.attributes.position;
    const latticeColors = new Float32Array(latticePoints.count * 3);
    for (let i = 0; i < latticePoints.count; i++) {
      this._color.setHSL((Math.atan2(latticePoints.getY(i), latticePoints.getX(i)) / TAU + 1) % 1, 1, .5);
      latticeColors.set([this._color.r, this._color.g, this._color.b], i * 3);
    }
    latticeGeo.setAttribute('color', new THREE.BufferAttribute(latticeColors, 3));
    for (let i = 0; i < 2; i++) {
      const material = new THREE.LineBasicMaterial({
        color: 0xffffff, vertexColors: true, transparent: true,
        opacity: .12, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });
      const mesh = new THREE.LineSegments(latticeGeo, material);
      this.root.add(mesh); this.lattices.push(mesh);
    }
    this.ribbons = [];
    for (let i = 0; i < 9; i++) {
      const geo = new THREE.TorusGeometry(1, i < 3 ? .006 : .0025, 3, 80, Math.PI * (1.1 + i % 3 * .33));
      const material = auraMaterial(this.auraUniforms, 1);
      material.uniforms.opacity = { value: 0 };
      const ribbon = new THREE.Mesh(geo, material);
      ribbon.rotation.set(i * .77, i * 1.8, i * 2.1);
      this.root.add(ribbon); this.ribbons.push(ribbon);
    }
    this.pulses = [];
    const pulseGeo = new THREE.TorusGeometry(1, .004, 3, 100);
    for (let i = 0; i < 3; i++) {
      const material = auraMaterial(this.auraUniforms, 1);
      material.uniforms.opacity = { value: 0 };
      const pulse = new THREE.Mesh(pulseGeo, material);
      pulse.rotation.x = i * .43;
      this.root.add(pulse); this.pulses.push(pulse);
    }
    this.light = new THREE.PointLight(0x8a36ff, 0, 24, 2);
    this.light.position.set(0, 2, 2);
    this.light.layers.enable(BLACK_SURFACE_LAYER);
    this.root.add(this.light);
  }

  _buildWake() {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    this.wake = this._batch(geometry, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: .9, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }), WAKE_COUNT, this.wakeRoot);
    this.wakeGlow = this._batch(geometry, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: .06, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }), WAKE_COUNT, this.wakeRoot);
    this.wakeParticles = Array.from({ length: WAKE_COUNT }, () => ({
      life: 0, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      size: 0, phase: 0, tendril: false, boost: 0,
    }));
  }

  _buildGlints() {
    // Cross-shaped sparkling stars, rendered in one pooled batch.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -1,-.07,0, 1,-.07,0, 1,.07,0, -1,-.07,0, 1,.07,0, -1,.07,0,
      -.07,-1,0, .07,-1,0, .07,1,0, -.07,-1,0, .07,1,0, -.07,1,0,
    ], 3));
    this.glints = this._batch(geometry, new THREE.MeshBasicMaterial({
      color: 0xffffff, side: THREE.DoubleSide, transparent: true,
      opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }), GLINT_COUNT);
    this.glintSeeds = Array.from({ length: GLINT_COUNT }, (_, i) => ({
      x: random(-1, 1), y: random(-1, 1), z: random(-1, 1), phase: random(0, TAU), hull: i < 20,
    }));
  }

  _buildRadiusGizmo() {
    this.radiusGizmo = new THREE.Group();
    this.radiusGizmo.name = 'ULTRA REAL DAMAGE RADIUS — TESTING ONLY';
    const material = new THREE.LineBasicMaterial({
      color: 0x19ffce, transparent: true, opacity: .48,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 2)), material);
    wire.renderOrder = 45;
    this.radiusGizmo.add(wire);
    const ringGeometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 129 }, (_, i) => {
      const a = i / 128 * TAU;
      return new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    }));
    const ringMaterial = material.clone(); ringMaterial.opacity = .85;
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Line(ringGeometry, ringMaterial);
      if (i === 1) ring.rotation.x = Math.PI / 2;
      if (i === 2) ring.rotation.y = Math.PI / 2;
      ring.renderOrder = 46;
      this.radiusGizmo.add(ring);
    }
    this.radiusGizmo.visible = false;
    this.root.add(this.radiusGizmo);
    // The true field extent is distinct from the much tighter aura. A sparse,
    // faint sphere remains in ordinary active play; testing exposes its bright
    // full lattice above. Both use precisely the gameplay radius.
    const boundaryMaterial = new THREE.LineBasicMaterial({
      color: 0x36ffcf, transparent: true, opacity: .065,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.fieldBoundary = new THREE.Group();
    this.fieldBoundary.name = 'ULTRA actual spherical damage boundary';
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Line(ringGeometry, boundaryMaterial);
      if (i === 1) ring.rotation.x = Math.PI / 2;
      if (i === 2) ring.rotation.y = Math.PI / 2;
      this.fieldBoundary.add(ring);
    }
    this.root.add(this.fieldBoundary);
  }

  coatHull() {
    this.restoreHull();
    this.player.hull?.traverse(object => {
      if (!object.isMesh) return;
      const material = object.material;
      if (Array.isArray(material)) {
        if (!material.some(m => m.isMeshStandardMaterial)) return;
        const applied = material.map(m => m.isMeshStandardMaterial ? this.armorMaterial : m);
        this.originalMaterials.push({ object, material, applied, layerMask: object.layers.mask });
        object.layers.enable(BLACK_SURFACE_LAYER);
        object.material = applied;
      } else if (material?.isMeshStandardMaterial) {
        this.originalMaterials.push({ object, material, applied: this.armorMaterial, layerMask: object.layers.mask });
        object.layers.enable(BLACK_SURFACE_LAYER);
        object.material = this.armorMaterial;
      }
    });
  }

  restoreHull() {
    for (const record of this.originalMaterials) {
      // Do not overwrite a newer material owner during replacement/cancellation.
      if (record.object.material === record.applied) record.object.material = record.material;
      record.object.layers.mask = (record.object.layers.mask & ~(1 << BLACK_SURFACE_LAYER))
        | (record.layerMask & (1 << BLACK_SURFACE_LAYER));
    }
    this.originalMaterials.length = 0;
  }

  activate(tuning = {}) {
    this.active = true; this.fade = 1; this.time = 0;
    this.root.visible = this.wakeRoot.visible = true;
    this._burstTime = 1; this._wakeCarry = 0; this._primed = false;
    // Expired visuals stop receiving simulation updates. Never resurrect their
    // saved world-space particles after the cooldown or another activation.
    for (const particle of this.wakeParticles) particle.life = 0;
    for (const mesh of [this.wake, this.wakeGlow]) {
      for (let i = 0; i < WAKE_COUNT; i++) mesh.setMatrixAt(i, this._zero);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.coatHull();
    for (const bolt of this.bolts) { bolt.life = 0; bolt.enabled = false; }
    this.update(0, 0, tuning);
  }

  expire() { this.active = false; this.restoreHull(); }

  cancel() {
    this.active = false; this.fade = 0;
    this.root.visible = this.wakeRoot.visible = false;
    this.restoreHull();
    this._primed = false; this._wakeCarry = 0;
    for (const particle of this.wakeParticles) particle.life = 0;
    for (const mesh of [this.wake, this.wakeGlow]) {
      for (let i = 0; i < WAKE_COUNT; i++) mesh.setMatrixAt(i, this._zero);
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const bolt of this.bolts) { bolt.life = 0; bolt.enabled = false; }
  }

  /** A real damage pulse supplies a world position, copied into a bounded slot. */
  strike(worldPosition, tuning = {}) {
    if (!this.active || !worldPosition) return;
    const bolt = this.bolts[MAX_MAJOR + MAX_MINOR + this._strikeCursor];
    this._strikeCursor = (this._strikeCursor + 1) % MAX_STRIKES;
    bolt.endpoint.copy(worldPosition);
    bolt.target = true;
    this.root.updateWorldMatrix(true, false);
    this._point.copy(bolt.endpoint);
    this.root.worldToLocal(this._point);
    this._shape(bolt, tuning, this._point);
    bolt.life = Math.max(.22, value(tuning, 'lightningLifetime'));
    bolt.enabled = true;
  }

  _shape(bolt, t, end = null) {
    const minor = bolt.index >= MAX_MAJOR && bolt.index < MAX_MAJOR + MAX_MINOR;
    const reach = value(t, 'lightningReach') * (minor ? random(.18, .58) : random(.65, 1.12));
    const angle = random(0, TAU);
    const depth = random(-.9, .08);
    const endpoint = end || this._point.set(Math.cos(angle) * reach, Math.sin(angle) * reach * .68, depth * reach);
    const points = bolt.points;
    const radial = Math.hypot(endpoint.x, endpoint.y, endpoint.z) || 1;
    const startRadius = end ? 2.7 : minor ? random(3.2, 5) : random(4.6, 6.5);
    const start = Math.min(startRadius / radial, .4);
    const bendDirection = Math.random() < .5 ? -1 : 1;
    const jitter = Math.min(radial * .12, 5);
    for (let i = 0; i < 9; i++) {
      const k = i / 8, r = start + (1 - start) * k;
      const j = Math.sin(k * Math.PI) * jitter;
      const bend = Math.sin(k * Math.PI) * radial * .16 * bendDirection;
      points[i].set(endpoint.x * r - Math.sin(angle) * bend + random(-j, j),
        endpoint.y * r + Math.cos(angle) * bend + random(-j, j), endpoint.z * r + random(-j, j));
    }
    // Four fork segments branch from the middle; final two taper almost to zero.
    const base = points[4];
    for (let i = 9; i < 13; i++) {
      const k = (i - 8) / 4;
      points[i].copy(base).addScaledVector(endpoint, k * random(.24, .5));
      points[i].x += Math.cos(angle + 1.25) * radial * k * .35;
      points[i].y += Math.sin(angle + 1.25) * radial * k * .35;
      points[i].z += random(-jitter, jitter) * k;
    }
    bolt.age = 0;
    bolt.life = Math.max(.15, value(t, 'lightningLifetime')) * random(.75, 1.4);
    bolt.scale = (minor ? .29 : 1) * random(.72, 1.25);
    bolt.phase = Math.random();
  }

  _segment(batch, index, from, to, width, color) {
    const d = this._dummy;
    this._delta.subVectors(to, from);
    const length = this._delta.length();
    d.position.copy(from).addScaledVector(this._delta, .5);
    d.quaternion.setFromUnitVectors(Y, this._delta.multiplyScalar(1 / Math.max(.0001, length)));
    d.scale.set(width, length + width * .18, width);
    d.updateMatrix();
    batch.setMatrixAt(index, d.matrix);
    if (color) batch.setColorAt(index, color);
  }

  _updateStorm(dt, t) {
    const reduced = !!t.reducedFlashing;
    const major = clamp(Math.round(value(t, 'majorCount')), 0, MAX_MAJOR);
    const minor = clamp(Math.round(value(t, 'minorCount') * (reduced ? .5 : 1)), 0, MAX_MINOR);
    const branching = clamp(value(t, 'branching'), 0, 2);
    const coreWidth = Math.max(.04, value(t, 'coreWidth'));
    const edgeWidth = 1.06 + Math.max(0, value(t, 'glowWidth') - 1) * .14;
    const haloWidth = 1.4 + value(t, 'glowWidth') * .4;
    const glow = Math.sqrt(clamp(value(t, 'glowIntensity'), 0, 6)) * .95;
    this.haloMaterial.opacity = .025 * this.fade;
    for (const bolt of this.bolts) {
      const strike = bolt.index >= MAX_MAJOR + MAX_MINOR;
      const wanted = strike ? bolt.life > 0 : bolt.index < major || (bolt.index >= MAX_MAJOR && bolt.index < MAX_MAJOR + minor);
      bolt.age += dt;
      if (wanted && !strike && (!bolt.enabled || bolt.age >= bolt.life)) {
        this._shape(bolt, t); bolt.enabled = true;
        // Reduced flashing slows geometry replacement, preserving signature bolts.
        if (reduced) bolt.life *= 2.3;
      }
      if (strike && bolt.age >= bolt.life) { bolt.life = 0; bolt.enabled = false; }
      const visible = wanted && bolt.enabled && this.fade > 0;
      const smooth = reduced ? 1 : Math.min(1, (bolt.life - bolt.age) / .09 + .25);
      for (let j = 0; j < SEGMENTS; j++) {
        const index = bolt.index * SEGMENTS + j;
        const isFork = j >= 8;
        if (!visible || (isFork && branching < (bolt.phase > .5 ? 1 : .5))) {
          this.cores.setMatrixAt(index, this._zero);
          this.edges.setMatrixAt(index, this._zero);
          this.halos.setMatrixAt(index, this._zero);
          continue;
        }
        const from = j === 8 ? bolt.points[4] : bolt.points[j];
        const to = bolt.points[j + 1];
        const progress = isFork ? (j - 8) / 4 : j / 8;
        const taper = (1 - progress * .85) * (isFork ? .52 : 1);
        const width = coreWidth * bolt.scale * taper * smooth * this.fade;
        this._boltColor(bolt, j, t, glow);
        this._segment(this.edges, index, from, to, width * edgeWidth, this._color);
        this._segment(this.cores, index, from, to, width, null);
        this._segment(this.halos, index, from, to, width * haloWidth, this._color);
      }
      // Weld adjacent cylinders with shared angular joints. Their black volume
      // removes the detached-stick/T-junction gaps without smoothing the path.
      for (let n = 0; n < JOINT_NODES.length; n++) {
        const node = JOINT_NODES[n], index = bolt.index * JOINT_NODES.length + n;
        const isFork = node > 8;
        if (!visible || (isFork && branching < (bolt.phase > .5 ? 1 : .5))) {
          this.coreJoints.setMatrixAt(index, this._zero);
          this.edgeJoints.setMatrixAt(index, this._zero);
          continue;
        }
        const progress = isFork ? (node - 8) / 4 : node / 8;
        const width = coreWidth * bolt.scale * (1 - progress * .85) * (isFork ? .52 : 1) * smooth * this.fade * 1.2;
        const d = this._dummy;
        d.position.copy(bolt.points[node]); d.rotation.set(node * .27, bolt.phase, node * .41);
        d.scale.setScalar(width); d.updateMatrix();
        this.coreJoints.setMatrixAt(index, d.matrix);
        d.scale.multiplyScalar(edgeWidth); d.updateMatrix();
        this.edgeJoints.setMatrixAt(index, d.matrix);
        this._boltColor(bolt, node, t, glow);
        this.edgeJoints.setColorAt(index, this._color);
      }
    }
    for (const mesh of [this.cores, this.edges, this.halos, this.coreJoints, this.edgeJoints]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }

  _boltColor(bolt, segment, tuning, glow) {
    const wave = .5 + .5 * Math.sin(this.time * .85 + segment * .48 + bolt.phase * 3);
    const gradient = wave * wave;
    let luminance = 1 - gradient * .55;
    this._color.setHSL(.80 - gradient * .32, 1, .5);
    // Every fifth major fracture stays unmistakably red throughout its lifetime.
    if (bolt.index < MAX_MAJOR && bolt.index % 5 === 0) {
      this._color.setRGB(1, .002 + gradient * .008, .015 + gradient * .035);
      luminance = 1;
    } else if (bolt.phase > value(tuning, 'gradientMix')) {
      this._color.set(ACCENTS[bolt.index % ACCENTS.length]);
      luminance = 1;
    }
    this._color.multiplyScalar(glow * this.fade * luminance);
  }

  _updateAura(dt, t) {
    const size = Math.max(3, value(t, 'auraSize'));
    const reduced = !!t.reducedFlashing;
    const breathing = reduced ? 1 : 1 + .025 * Math.sin(this.time * 2.8);
    const opacity = value(t, 'auraOpacity') * this.fade;
    this.auraUniforms.time.value = this.time;
    this.auraUniforms.intensity.value = value(t, 'auraIntensity');
    this.auraUniforms.cycle.value = value(t, 'rainbowSpeed') * (reduced ? .45 : 1);
    this.envelopes.forEach((mesh, i) => {
      const radius = (i === 0 ? .28 : i === 1 ? .58 : .82) * size * breathing;
      mesh.scale.set(radius, radius * .74, radius * 1.05);
      mesh.rotation.y += dt * (i % 2 ? -.08 : .06);
      mesh.material.uniforms.opacity.value = opacity * (i === 0 ? 1.2 : i === 1 ? .58 : .36);
    });
    this.lattices.forEach((mesh, i) => {
      mesh.visible = value(t, 'latticeDensity') > i * .6;
      mesh.scale.setScalar(size * (.48 + i * .22));
      mesh.rotation.set(this.time * .05, this.time * (i ? -.06 : .08), i + this.time * .04);
      mesh.material.opacity = opacity * .18 * Math.min(1, value(t, 'latticeDensity'));
      mesh.material.color.setScalar(value(t, 'auraIntensity'));
    });
    this.ribbons.forEach((mesh, i) => {
      mesh.visible = i < Math.round(value(t, 'ribbonDensity') * 9);
      const radius = size * (.35 + (i % 4) * .13);
      mesh.scale.set(radius, radius * (.75 + (i % 3) * .11), radius);
      mesh.rotation.z += dt * (i % 2 ? -.13 : .17);
      mesh.rotation.y += dt * .07;
      mesh.material.uniforms.opacity.value = opacity * (i < 3 ? 2.6 : 1.4);
    });
    this._burstTime = Math.max(0, this._burstTime - dt * .6);
    this.pulses.forEach((mesh, i) => {
      const phase = (this.time * (reduced ? .08 : .22) + i / 3) % 1;
      const radius = size * (.35 + phase * 1.9);
      mesh.scale.setScalar(radius);
      mesh.material.uniforms.opacity.value = opacity * (1 - phase) * (reduced ? .25 : .7 + this._burstTime);
    });
    this.light.intensity = 11 * this.fade * Math.min(2, value(t, 'auraIntensity'));
  }

  _updateGlints(t) {
    const d = this._dummy;
    const size = value(t, 'auraSize');
    const shimmer = value(t, 'shimmer');
    const slow = t.reducedFlashing ? .6 : 1;
    for (let i = 0; i < GLINT_COUNT; i++) {
      const s = this.glintSeeds[i];
      const shine = Math.pow(Math.max(0, Math.sin(this.time * (s.hull ? 2.2 : 1.1) * slow + s.phase)), 8);
      const scale = (s.hull ? .09 : .17) * shine * shimmer * this.fade;
      d.position.set(s.x * (s.hull ? 2.1 : size), s.y * (s.hull ? .65 : size * .7), s.z * (s.hull ? 2.6 : size));
      d.rotation.set(0, 0, s.phase + this.time * .12);
      d.scale.set(scale * 1.8, scale, scale);
      d.updateMatrix(); this.glints.setMatrixAt(i, d.matrix);
      this._color.setHSL((s.phase / TAU + this.time * .055) % 1, 1, .5).multiplyScalar(1.8);
      this.glints.setColorAt(i, this._color);
    }
    this.glints.instanceMatrix.needsUpdate = true;
    this.glints.instanceColor.needsUpdate = true;
  }

  _updateWake(dt, t) {
    const p = this.player;
    if (this.camera) {
      this.camera.getWorldPosition(this._cameraPosition);
      this.camera.getWorldDirection(this._cameraForward);
    }
    const boost = p.boosting ? 1 : 0;
    p.group.updateWorldMatrix(true, false);
    this._world.setFromMatrixPosition(p.group.matrixWorld);
    this._direction.set(0, 0, 1).transformDirection(p.group.matrixWorld);
    if (!this._primed) { this._lastWorld.copy(this._world); this._primed = true; }
    if (this.active) {
      this._wakeCarry += Math.min(dt, .1) * (170 + boost * 190) * value(t, 'particles') * (t.reducedFlashing ? .5 : 1);
      const count = Math.min(WAKE_COUNT, Math.floor(this._wakeCarry));
      this._wakeCarry -= count;
      for (let i = 0; i < count; i++) {
        const particle = this.wakeParticles[this._wakeCursor];
        this._wakeCursor = (this._wakeCursor + 1) % WAKE_COUNT;
        this._point.lerpVectors(this._lastWorld, this._world, (i + 1) / Math.max(1, count));
        const phase = random(0, TAU), wide = this._wakeCursor % 4 === 0;
        const spread = wide ? random(3, value(t, 'auraSize') * .7) : random(.5, 2.5);
        const speed = 6 + boost * 9;
        Object.assign(particle, {
          life: random(1.3, 2.2) + boost * 1.2, age: 0,
          x: this._point.x + Math.cos(phase) * spread,
          y: this._point.y + Math.sin(phase) * spread * .55,
          z: this._point.z + random(1.2, 3.8),
          vx: this._direction.x * speed + p.vx * .08 + Math.cos(phase) * 1.2,
          vy: this._direction.y * speed + p.vy * .08 + Math.sin(phase) * 1.2,
          vz: Math.max(3, this._direction.z * speed),
          size: random(.045, .14) * (wide ? .75 : 1), phase,
          tendril: this._wakeCursor % 9 === 0, boost,
        });
      }
    }
    this._lastWorld.copy(this._world);
    const d = this._dummy;
    let live = 0;
    for (let i = 0; i < WAKE_COUNT; i++) {
      const particle = this.wakeParticles[i];
      if (!particle.life) continue;
      particle.age += dt;
      if (particle.age >= particle.life) {
        particle.life = 0;
        this.wake.setMatrixAt(i, this._zero); this.wakeGlow.setMatrixAt(i, this._zero);
        continue;
      }
      live++;
      particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.z += particle.vz * dt;
      const age = particle.age / particle.life;
      // A long boost wake passes the chase camera. Fade its nearest particles
      // before projection magnifies them into a fullscreen white bloom cloud.
      // World-space trails remain long; neither gameplay nor bolt counts change.
      const depth = this.camera ? this._cameraForward.x * (particle.x - this._cameraPosition.x)
        + this._cameraForward.y * (particle.y - this._cameraPosition.y)
        + this._cameraForward.z * (particle.z - this._cameraPosition.z) : 20;
      const proximity = clamp((depth - 3) / 7, 0, 1);
      const fade = (1 - age) * this.fade * proximity * proximity;
      const curl = Math.sin(particle.phase + particle.age * 3) * particle.age * .5;
      d.position.set(particle.x + curl, particle.y + Math.cos(particle.phase + particle.age * 2) * particle.age * .3, particle.z);
      d.rotation.set(particle.phase, particle.age * .5, particle.phase + particle.age);
      const scale = particle.size * Math.sqrt(Math.max(0, fade));
      d.scale.set(scale, scale, particle.tendril ? scale * (13 + particle.boost * 15) : scale);
      d.updateMatrix(); this.wake.setMatrixAt(i, d.matrix);
      d.scale.multiplyScalar(2.7); d.updateMatrix(); this.wakeGlow.setMatrixAt(i, d.matrix);
      this._color.setHSL((particle.phase / TAU + age * .22 + this.time * .04) % 1, .95, .54).multiplyScalar(2.5 * fade);
      this.wake.setColorAt(i, this._color); this.wakeGlow.setColorAt(i, this._color);
    }
    this.wakeRoot.visible = live > 0;
    for (const mesh of [this.wake, this.wakeGlow]) {
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    }
  }

  update(dt, _gameTime, tuning = {}) {
    if (!this.active) this.fade = Math.max(0, this.fade - dt * 2.8);
    const showRadius = !!tuning.showRadius && Number.isFinite(tuning.fieldRadius) && tuning.fieldRadius > 0;
    this.radiusGizmo.visible = showRadius;
    if (showRadius) this.radiusGizmo.scale.setScalar(tuning.fieldRadius);
    if (this.fade <= 0) {
      this.root.visible = showRadius;
      this.wakeRoot.visible = false;
      for (const object of this.root.children) if (object !== this.radiusGizmo) object.visible = false;
      return;
    }
    this.root.visible = true;
    for (const object of this.root.children) if (object !== this.radiusGizmo) object.visible = true;
    this.fieldBoundary.visible = this.active && Number.isFinite(tuning.fieldRadius) && tuning.fieldRadius > 0;
    if (this.fieldBoundary.visible) this.fieldBoundary.scale.setScalar(tuning.fieldRadius);
    this.time += dt;
    this.armorUniforms.time.value = this.time;
    this.armorUniforms.shine.value = value(tuning, 'armorShine');
    this._updateStorm(dt, tuning);
    this._updateAura(dt, tuning);
    this._updateGlints(tuning);
    this._updateWake(dt, tuning);
  }
}
