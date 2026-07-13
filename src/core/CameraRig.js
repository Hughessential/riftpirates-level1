import * as THREE from 'three';
import { lerp, rand, damp, clamp } from './Utils.js';

/**
 * Camera behaviour (spec §41). Three framings — traversal, tower, boss — and
 * shake reserved for impacts that earn it. Never constant shake.
 */

export const FRAMING = {
  traversal: { dist: 11, height: 4.6, fov: 68, look: -16 },
  tower: { dist: 15, height: 5.6, fov: 70, look: -22 },
  boss: { dist: 22, height: 7.5, fov: 74, look: -30 },
  cinematic: { dist: 9, height: 3.5, fov: 88, look: -40 },
};

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'traversal';
    this.shakeAmt = 0;
    this.target = { ...FRAMING.traversal };
    this.cur = { ...FRAMING.traversal };
    this._look = new THREE.Vector3();
  }

  setMode(mode) {
    if (!FRAMING[mode]) return;
    this.mode = mode;
    this.target = { ...FRAMING[mode] };
  }

  shake(amount) {
    this.shakeAmt = Math.min(1.2, this.shakeAmt + amount);
  }

  update(dt, player, boosting) {
    const c = this.camera;

    // ease between framings so encounter transitions feel like one move
    this.cur.dist = damp(this.cur.dist, this.target.dist, 2.5, dt);
    this.cur.height = damp(this.cur.height, this.target.height, 2.5, dt);
    this.cur.look = damp(this.cur.look, this.target.look, 2.5, dt);

    // mild FOV kick on boost
    const fovTarget = this.target.fov + (boosting ? 10 : 0);
    c.fov = damp(c.fov, fovTarget, 6, dt);
    c.updateProjectionMatrix();

    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.6);
    const s = this.shakeAmt * 0.55;

    // the camera only partly follows the player — the arena stays legible
    const px = player.x * 0.4;
    const py = this.cur.height + player.y * 0.3;

    c.position.x = damp(c.position.x, px, 6, dt) + rand(-s, s);
    c.position.y = damp(c.position.y, py, 6, dt) + rand(-s, s);
    c.position.z = damp(c.position.z, this.cur.dist, 4, dt);

    this._look.set(player.x * 0.6, player.y * 0.55 + 1, this.cur.look);
    c.lookAt(this._look);
    if (s > 0) c.rotation.z += rand(-s, s) * 0.02;
  }

  reset() {
    this.setMode('traversal');
    this.cur = { ...FRAMING.traversal };
    this.shakeAmt = 0;
    this.camera.position.set(0, 4.6, 11);
    this.camera.fov = 68;
    this.camera.updateProjectionMatrix();
  }
}
