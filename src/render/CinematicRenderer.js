import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BlackSurfacePass } from './BlackSurfacePass.js';

// A quiet digital-print texture, not a glitch event. It never changes time,
// blurs, flashes or reduces render resolution; aim lines remain pixel sharp.
const RiftSignalShader = {
  uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(1, 1) },
    offset: { value: 1.08 }, darkness: { value: .98 } },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    vec3 vignette(vec2 uv) {
      vec2 center = (uv - vec2(0.5)) * offset;
      return mix(texture2D(tDiffuse, uv).rgb, vec3(1.0 - darkness), dot(center, center));
    }
    void main() {
      vec2 pixel = vUv * resolution;
      vec2 center = vUv - 0.5;
      float edge = smoothstep(0.18, 0.65, length(center));
      vec2 splitOffset = vec2(0.12 * edge / resolution.x, 0.0);
      vec3 source = vignette(vUv);
      vec3 split = vec3(vignette(vUv + splitOffset).r,
                        source.g, vignette(vUv - splitOffset).b);
      float grain = fract(sin(dot(floor(pixel / 2.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      float scan = 0.5 + 0.5 * cos(pixel.y * 3.14159265);
      vec3 color = split * (1.0 - 0.0035 * scan);
      color += grain * 0.0015 * min(vec3(1.0), source + 0.03);
      gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
    }`,
};

/**
 * Desktop-first presentation pipeline. Gameplay systems remain renderer-agnostic;
 * this class owns the HDR target, bloom, finishing pass and future quality tiers.
 */
export class CinematicRenderer {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;

    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    // Four-sample MSAA keeps the chunky silhouettes clean before bloom.
    target.samples = 4;

    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(renderer.getPixelRatio());

    this.renderPass = new RenderPass(scene, camera);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      0.78,
      0.52,
      0.82
    );
    // Apply vignette at each signal sample in one shader. This removes an HDR
    // fullscreen pass while retaining the same vignette-before-signal order.
    this.signalPass = new ShaderPass(RiftSignalShader);
    this.blackSurfacePass = new BlackSurfacePass(scene, camera);
    this.outputPass = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.blackSurfacePass);
    this.composer.addPass(this.signalPass);
    this.composer.addPass(this.outputPass);
    this.setSize(innerWidth, innerHeight);
  }

  setSize(width, height) {
    // Display density can change when moving a window between monitors.
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    this.signalPass.uniforms.resolution.value.set(
      width * this.renderer.getPixelRatio(), height * this.renderer.getPixelRatio()
    );
  }

  setBloom(strength) {
    this.bloomPass.strength = strength;
  }

  render(dt = 0) {
    this.composer.render(dt);
  }

  dispose() {
    for (const pass of this.composer.passes) pass.dispose?.();
    this.composer.dispose();
  }
}
