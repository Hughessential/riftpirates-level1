import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

export const BLACK_SURFACE_LAYER = 7;

/** Reassert opaque obsidian surfaces after bloom without clearing scene depth.
 * UnrealBloomPass composites in place, leaving RenderPass's depth buffer intact.
 * This adds only the black-core batch and coated hull draw calls; enemies in
 * front still occlude them. No fullscreen black silhouette or second renderer. */
export class BlackSurfacePass extends RenderPass {
  constructor(scene, camera) {
    super(scene, camera);
    this.clear = false;
    this.enabled = false;
    scene.traverse(object => {
      if (object.isLight) object.layers.enable(BLACK_SURFACE_LAYER);
    });
  }

  render(renderer, writeBuffer, readBuffer) {
    const mask = this.camera.layers.mask;
    const background = this.scene.background;
    const shadows = renderer.shadowMap.autoUpdate;
    this.camera.layers.set(BLACK_SURFACE_LAYER);
    this.scene.background = null;
    renderer.shadowMap.autoUpdate = false;
    try { super.render(renderer, writeBuffer, readBuffer); }
    finally {
      this.camera.layers.mask = mask;
      this.scene.background = background;
      renderer.shadowMap.autoUpdate = shadows;
    }
  }
}
