import * as THREE from 'three';
import { glowSprite } from '../render/VoxelBuilder.js';
import { rand, TAU } from '../core/Utils.js';

const MAX_ARCS = 16;
const ARC_SEGMENTS = 7;
const GLINTS = 8;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const SPARK_COLORS = Object.freeze(['#b936ff', '#ff174d', '#28a9ff', '#ffffff']);

/**
 * Ship-attached, allocation-free-after-boot presentation for Black Armor.
 * Gameplay timing and immunity remain owned by Player; this class only coats
 * the current hull and animates its pooled aura, lightning and glints.
 */
export class BlackArmorEffect {
  constructor(player, fx) {
    this.player = player;
    this.fx = fx;
    this.root = new THREE.Group();
    this.root.name = 'BLACK ARMOR FX';
    this.root.visible = false;
    this.player.group.add(this.root);

    this.shader = { time: { value: 0 }, shimmer: { value: 1 } };
    this.armorMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x010104,
      emissive: 0x160020,
      emissiveIntensity: 0.55,
      metalness: 1,
      roughness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.025,
      envMapIntensity: 2.1,
    });
    this.armorMaterial.onBeforeCompile = shader => {
      shader.uniforms.blackArmorTime = this.shader.time;
      shader.uniforms.blackArmorShimmer = this.shader.shimmer;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBlackArmorPosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlackArmorPosition = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBlackArmorPosition;\nuniform float blackArmorTime;\nuniform float blackArmorShimmer;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float armorSweepCoord = vBlackArmorPosition.x * 0.31 - vBlackArmorPosition.z * 0.17;
          float armorSweep = 1.0 - abs(fract(armorSweepCoord - blackArmorTime * 0.72) - 0.5) * 2.0;
          armorSweep = pow(max(armorSweep, 0.0), 16.0);
          totalEmissiveRadiance += vec3(0.7, 0.14, 1.0) * armorSweep * blackArmorShimmer;`);
    };
    this.armorMaterial.customProgramCacheKey = () => 'rift-black-armor-shimmer-v1';
    this.originalMaterials = [];

    this.aura = new THREE.Mesh(
      new THREE.IcosahedronGeometry(3.5, 2),
      new THREE.MeshBasicMaterial({
        color: 0xa936ff, wireframe: true, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    this.aura.scale.set(1.05, 0.58, 1.35);
    this.root.add(this.aura);

    this.auraGlow = [];
    for (const [x, y, z, scale] of [[0, 0, 0.4, 7.2], [-2.2, 0, 0, 4.4], [2.2, 0, 0, 4.4]]) {
      const sprite = glowSprite(0x8f1dff, scale, 0);
      sprite.position.set(x, y, z);
      this.root.add(sprite);
      this.auraGlow.push(sprite);
    }

    this.light = new THREE.PointLight(0xb02cff, 0, 18, 2);
    this.light.position.set(0, 1, 1);
    this.root.add(this.light);

    this.redMaterial = new THREE.MeshBasicMaterial({
      color: 0xff143d, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.blueMaterial = new THREE.MeshBasicMaterial({
      color: 0x26a8ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.segmentGeometry = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    this.arcs = [];
    for (let i = 0; i < MAX_ARCS; i++) {
      const meshes = [];
      for (let j = 0; j < ARC_SEGMENTS; j++) {
        const mesh = new THREE.Mesh(this.segmentGeometry, i % 2 ? this.blueMaterial : this.redMaterial);
        mesh.visible = false;
        mesh.renderOrder = 16;
        this.root.add(mesh);
        meshes.push(mesh);
      }
      this.arcs.push({ meshes, points: Array.from({ length: 6 }, () => new THREE.Vector3()) });
    }

    this.glints = [];
    for (let i = 0; i < GLINTS; i++) {
      const sprite = glowSprite(i % 3 ? 0xf6eaff : 0xc36cff, 0, 0);
      sprite.visible = false;
      this.root.add(sprite);
      this.glints.push({ sprite, life: 0, max: 1, delay: rand(0, 0.7) });
    }

    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._delta = new THREE.Vector3();
    this._mid = new THREE.Vector3();
    this._branch = new THREE.Vector3();
    this._world = new THREE.Vector3();
    this._jetDirection = new THREE.Vector3();
    this._lightningTick = 0;
    this._particleTick = 0;
    this.fade = 0;
    this.active = false;
  }

  coatHull() {
    this.restoreHull();
    this.player.hull?.traverse(object => {
      if (!object.isMesh || !object.material?.isMeshStandardMaterial) return;
      this.originalMaterials.push({ object, material: object.material });
      object.material = this.armorMaterial;
    });
  }

  restoreHull() {
    for (const record of this.originalMaterials) record.object.material = record.material;
    this.originalMaterials.length = 0;
  }

  activate(tuning) {
    this.active = true;
    this.fade = 1;
    this.root.visible = true;
    this.coatHull();
    this._lightningTick = 0;
    this._particleTick = 0;
    this._burst(tuning);
  }

  expire() {
    this.active = false;
    this.restoreHull();
  }

  cancel() {
    this.active = false;
    this.fade = 0;
    this.root.visible = false;
    this.restoreHull();
    for (const arc of this.arcs) for (const mesh of arc.meshes) mesh.visible = false;
    for (const glint of this.glints) glint.sprite.visible = false;
  }

  update(dt, time, tuning) {
    if (!this.active) {
      this.fade = Math.max(0, this.fade - dt * 3.4);
      if (this.fade <= 0) {
        this.root.visible = false;
        return;
      }
    } else {
      this.fade = Math.min(1, this.fade + dt * 9);
    }

    const fade = this.fade;
    const pulse = 0.78 + Math.sin(time * 7.5) * 0.14 + Math.sin(time * 17) * 0.08;
    const glow = tuning.glow * fade;
    this.shader.time.value = time;
    this.shader.shimmer.value = tuning.shimmer * fade;
    this.armorMaterial.roughness = THREE.MathUtils.lerp(0.42, 0.015, tuning.gloss);
    this.armorMaterial.clearcoat = Math.min(1, tuning.specular);
    this.armorMaterial.clearcoatRoughness = THREE.MathUtils.lerp(0.18, 0.015, tuning.gloss);
    this.armorMaterial.envMapIntensity = 0.5 + tuning.specular * 1.35;
    this.armorMaterial.emissiveIntensity = (0.18 + glow * 0.2) * pulse;
    this.aura.material.opacity = Math.min(0.42, 0.035 * glow * pulse);
    this.aura.rotation.y += dt * 0.7;
    this.aura.rotation.z -= dt * 0.32;
    this.aura.scale.set(1.05 + pulse * 0.035, 0.58 + pulse * 0.02, 1.35 + pulse * 0.045);
    this.auraGlow.forEach((sprite, index) => {
      sprite.material.opacity = Math.min(0.72, (index ? 0.075 : 0.13) * glow * pulse);
    });
    this.light.intensity = Math.min(24, glow * 3.6 * pulse);

    this.redMaterial.opacity = Math.min(1, tuning.lightningBrightness * 0.34 * fade);
    this.blueMaterial.opacity = Math.min(1, tuning.lightningBrightness * 0.34 * fade);
    this.redMaterial.color.setRGB(1.15 * tuning.lightningBrightness, 0.025, 0.09);
    this.blueMaterial.color.setRGB(0.025, 0.34 * tuning.lightningBrightness, 1.2 * tuning.lightningBrightness);
    this._lightningTick -= dt;
    if (this._lightningTick <= 0) {
      this._lightningTick = 1 / Math.max(1, tuning.lightningFrequency);
      this._refreshArcs(tuning);
    }

    this._particleTick -= dt;
    if (this.active && tuning.particles > 0 && this._particleTick <= 0) {
      this._particleTick = Math.max(0.045, 0.2 / Math.max(0.25, tuning.particles));
      this.player.group.getWorldPosition(this._world);
      this._jetDirection.set(rand(-0.4, 0.4), rand(-0.35, 0.7), rand(-0.3, 0.3));
      this.fx.jet(this._world.x + rand(-2.3, 2.3), this._world.y + rand(-1.1, 1.1), rand(-2.8, 2.8),
        this._jetDirection, Math.max(1, Math.round(2 * tuning.particles)), SPARK_COLORS);
    }
    this._updateGlints(dt, tuning, fade);
  }

  _burst(tuning) {
    this.player.group.getWorldPosition(this._world);
    this.fx.explode(this._world.x, this._world.y, 0, {
      count: Math.round(16 * Math.max(0.2, tuning.particles)),
      colors: ['#09000f', '#7f19e8', '#d650ff'],
      sparkColors: ['#ff174d', '#28a9ff', '#d650ff', '#ffffff'],
      power: 12,
      gravity: 0,
      scale: 0.6,
      life: 0.75,
      arcColor: '#b936ff',
      flashColor: '#d650ff',
      flashScale: 1.25,
      flashTime: 0.14,
    });
  }

  _refreshArcs(tuning) {
    const count = Math.min(MAX_ARCS, Math.max(0, Math.round(tuning.arcCount)));
    for (let i = 0; i < this.arcs.length; i++) {
      const arc = this.arcs[i];
      const visible = i < count && this.fade > 0;
      for (const mesh of arc.meshes) mesh.visible = visible;
      if (!visible) continue;
      const red = Math.random() < tuning.redBalance;
      for (const mesh of arc.meshes) mesh.material = red ? this.redMaterial : this.blueMaterial;
      this._shapeArc(arc, tuning, i);
    }
  }

  _shapeArc(arc, tuning, seed) {
    const length = tuning.lightningLength;
    const angle = rand(0, TAU);
    const zStart = rand(-2.55, 2.55);
    const direction = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < arc.points.length; i++) {
      const k = i / (arc.points.length - 1);
      const a = angle + direction * (k - 0.5) * (0.75 + length * 0.7);
      arc.points[i].set(
        Math.cos(a) * (2.35 + rand(-0.22, 0.22)),
        Math.sin(a) * (0.72 + rand(-0.1, 0.1)),
        THREE.MathUtils.clamp(zStart + (k - 0.5) * 3.1 * length + rand(-0.3, 0.3), -3.35, 3.35)
      );
    }
    const thickness = tuning.lightningThickness * rand(0.72, 1.28);
    for (let i = 0; i < 5; i++) this._setSegment(arc.meshes[i], arc.points[i], arc.points[i + 1], thickness);
    this._from.copy(arc.points[2]);
    this._branch.set(rand(-1.2, 1.2) * length, rand(-0.65, 0.65) * length, rand(-0.8, 0.8) * length);
    this._to.copy(this._from).add(this._branch);
    this._mid.copy(this._from).lerp(this._to, 0.52);
    this._mid.x += rand(-0.28, 0.28);
    this._mid.y += rand(-0.18, 0.18);
    this._setSegment(arc.meshes[5], this._from, this._mid, thickness * 0.68);
    this._setSegment(arc.meshes[6], this._mid, this._to, thickness * 0.52);
    arc.meshes[seed % ARC_SEGMENTS].scale.x *= 1.35;
  }

  _setSegment(mesh, from, to, thickness) {
    this._delta.subVectors(to, from);
    const length = Math.max(0.001, this._delta.length());
    this._mid.copy(from).addScaledVector(this._delta, 0.5);
    mesh.position.copy(this._mid);
    mesh.quaternion.setFromUnitVectors(Y_AXIS, this._delta.multiplyScalar(1 / length));
    mesh.scale.set(thickness, length, thickness);
  }

  _updateGlints(dt, tuning, fade) {
    for (const glint of this.glints) {
      glint.delay -= dt;
      if (glint.delay > 0) continue;
      glint.life -= dt;
      if (glint.life <= 0) {
        glint.max = glint.life = rand(0.08, 0.22);
        glint.delay = rand(0.05, 0.65) / Math.max(0.2, tuning.shimmer);
        glint.sprite.position.set(rand(-2.45, 2.45), rand(-0.82, 0.82), rand(-3.05, 3.05));
        glint.sprite.visible = this.active && tuning.shimmer > 0;
      }
      const k = Math.max(0, glint.life / glint.max);
      const scale = (0.35 + Math.sin(k * Math.PI) * 1.25) * Math.min(2.5, tuning.shimmer);
      glint.sprite.scale.set(scale, scale * 0.18, 1);
      glint.sprite.material.opacity = Math.sin(k * Math.PI) * Math.min(1, tuning.shimmer * 0.45) * fade;
      if (!this.active && glint.life <= 0) glint.sprite.visible = false;
    }
  }
}
