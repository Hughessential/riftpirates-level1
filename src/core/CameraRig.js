import * as THREE from 'three';
import { rand, damp } from './Utils.js';
import { Input } from './Input.js';

/**
 * Camera behaviour (spec §41). Three framings — traversal, tower, boss — and
 * shake reserved for impacts that earn it. Never constant shake.
 *
 * The right stick free-looks by orbiting the whole rig around the ship.
 * Releasing the stick always eases the camera back to its front-facing
 * framing — yaw/pitch chase zero and the final fraction snaps to exactly 0.
 */

export const FRAMING = {
  // Leave room below the ship for the long exhaust ribbons and dodge lanes.
  traversal: { dist: 16, height: 7, fov: 68, look: -16 },
  tower: { dist: 18, height: 7.5, fov: 70, look: -22 },
  boss: { dist: 22, height: 7.5, fov: 74, look: -30 },
  cinematic: { dist: 9, height: 3.5, fov: 88, look: -40 },
};

// right-stick orbit limits and response
const ORBIT_YAW = 0.9; // rad, ~51° each way
const ORBIT_PITCH = 0.45; // rad, ~26° up/down
const ORBIT_CHASE = 10; // damp rate while the stick is deflected
const ORBIT_RETURN = 7; // damp rate snapping home after release

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'traversal';
    this.shakeAmt = 0;
    this.target = { ...FRAMING.traversal };
    this.cur = { ...FRAMING.traversal };
    this.yaw = 0; // right-stick orbit state
    this.pitch = 0;
    this._base = new THREE.Vector3(0, FRAMING.traversal.height, FRAMING.traversal.dist);
    this._look = new THREE.Vector3();
    this._pivot = new THREE.Vector3();
    this._offC = new THREE.Vector3();
    this._offL = new THREE.Vector3();
    this._euler = new THREE.Euler();
  }

  setMode(mode) {
    if (!FRAMING[mode]) return;
    this.mode = mode;
    this.target = { ...FRAMING[mode] };
  }

  /** Encounter reveals provide a complete pose; gameplay framing remains intact. */
  setEncounterReveal(pose) { this.encounterReveal = pose; }
  clearEncounterReveal() {
    if (this.encounterReveal) this.cur = { ...this.target };
    this.encounterReveal = null;
  }

  shake(amount) {
    this.shakeAmt = Math.min(1.2, this.shakeAmt + amount * (this.testing?.getTuning('screenShake') ?? 1));
  }

  update(dt, player, boosting) {
    const c = this.camera;

    if (this.encounterReveal) {
      const pose = this.encounterReveal;
      c.position.copy(pose.position);
      c.lookAt(pose.look);
      c.fov = pose.fov;
      c.updateProjectionMatrix();
      this._base.copy(pose.position);
      this.yaw = this.pitch = this.shakeAmt = 0;
      return;
    }

    // ease between framings so encounter transitions feel like one move
    this.cur.dist = damp(this.cur.dist, this.target.dist, 2.5, dt);
    this.cur.height = damp(this.cur.height, this.target.height, 2.5, dt);
    this.cur.look = damp(this.cur.look, this.target.look, 2.5, dt);

    // mild FOV kick on boost, slight tighten while aiming
    const fovTarget = this.target.fov + (boosting ? 10 : 0) - (Input.aiming ? 6 : 0);
    c.fov = damp(c.fov, fovTarget, 6, dt);
    c.updateProjectionMatrix();

    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.6);
    const s = this.shakeAmt * 0.55;

    // the camera only partly follows the player — the arena stays legible
    const px = player.x * 0.4;
    const py = this.cur.height + player.y * 0.3;
    this._base.x = damp(this._base.x, px, 6, dt);
    this._base.y = damp(this._base.y, py, 6, dt);
    this._base.z = damp(this._base.z, this.cur.dist, 4, dt);

    // ---- right-stick free look ----
    const cam = Input.readCamera();
    const active = cam.x !== 0 || cam.y !== 0;
    const rate = active ? ORBIT_CHASE : ORBIT_RETURN;
    // stick right looks right (negative yaw around +Y), stick up looks up
    this.yaw = damp(this.yaw, -cam.x * ORBIT_YAW, rate, dt);
    this.pitch = damp(this.pitch, cam.y * ORBIT_PITCH, rate, dt);
    if (!active) {
      // settle exactly front-facing once the stick is released
      if (Math.abs(this.yaw) < 0.002) this.yaw = 0;
      if (Math.abs(this.pitch) < 0.002) this.pitch = 0;
    }

    this._look.set(player.x * 0.6, player.y * 0.55 + 1, this.cur.look);

    if (this.yaw !== 0 || this.pitch !== 0) {
      // rotate camera and look target rigidly around the ship, so free-look
      // pivots on the Star Hopper and never loses it
      this._pivot.set(player.x, player.y, 0);
      this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
      this._offC.copy(this._base).sub(this._pivot).applyEuler(this._euler);
      this._offL.copy(this._look).sub(this._pivot).applyEuler(this._euler);
      c.position.copy(this._pivot).add(this._offC);
      this._look.copy(this._pivot).add(this._offL);
    } else {
      c.position.copy(this._base);
    }
    c.position.x += rand(-s, s);
    c.position.y += rand(-s, s);

    c.lookAt(this._look);
    if (s > 0) c.rotation.z += rand(-s, s) * 0.02;
  }

  reset() {
    this.clearEncounterReveal();
    this.setMode('traversal');
    this.cur = { ...FRAMING.traversal };
    this.shakeAmt = 0;
    this.yaw = 0;
    this.pitch = 0;
    this._base.set(0, this.cur.height, this.cur.dist);
    this.camera.position.copy(this._base);
    this.camera.fov = this.cur.fov;
    this.camera.updateProjectionMatrix();
  }
}
