import * as THREE from 'three';

/** Finds a legal, hull-inset destination on the opposite projected screen side.
 * The camera can orbit or change aspect ratio; world arena edges alone are not
 * necessarily visible. This helper never changes gameplay state. */
export class UltraTeleport {
  constructor() {
    this.bounds = new THREE.Box3();
    this.projection = new THREE.Matrix4();
    this.frustum = new THREE.Frustum();
    this.point = new THREE.Vector3();
  }

  oppositeSide(player, camera, rollDirection) {
    if (!camera) return Math.abs(player.x) < .01 ? Math.sign(rollDirection) || 1 : -Math.sign(player.x);
    camera.updateMatrixWorld();
    this.point.set(player.x, player.y, 0).project(camera);
    return Math.abs(this.point.x) < .025 ? Math.sign(rollDirection) || 1 : -Math.sign(this.point.x);
  }

  destination(player, camera, arena, side) {
    player.group.updateWorldMatrix(true, true);
    this.bounds.setFromObject(player.hull);
    const b = this.bounds;
    // Reserve the full rolling cross-section, so the remaining spin cannot
    // rotate a wing outside the screen immediately after reappearance.
    const crossRadius = Math.hypot(Math.max(Math.abs(b.min.x - player.x), Math.abs(b.max.x - player.x)),
      Math.max(Math.abs(b.min.y - player.y), Math.abs(b.max.y - player.y)));
    const offsetMin = -crossRadius, offsetMax = crossRadius;
    const inset = .35;
    let lo = arena.minX - offsetMin + inset;
    let hi = arena.maxX - offsetMax - inset;
    if (camera) {
      camera.updateMatrixWorld();
      this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.projection);
      // A translated box stays inside a frustum plane when its least-supported
      // corner stays inside. Solve that inequality for the only moving axis: x.
      for (const plane of this.frustum.planes) {
        const n = plane.normal;
        if (Math.abs(n.x) < 1e-7) continue;
        const support = n.x * (n.x >= 0 ? offsetMin : offsetMax)
          + n.y * (n.y >= 0 ? b.min.y : b.max.y)
          + n.z * (n.z >= 0 ? b.min.z : b.max.z) + plane.constant;
        const edge = (inset - support) / n.x;
        const nextLo = n.x > 0 ? Math.max(lo, edge) : lo;
        const nextHi = n.x < 0 ? Math.min(hi, edge) : hi;
        // At unusual camera/vertical positions a hull may already be clipped.
        // Preserve y and keep the best feasible horizontal interval in that case.
        if (nextLo <= nextHi) { lo = nextLo; hi = nextHi; }
      }
    }
    if (lo > hi) return THREE.MathUtils.clamp((lo + hi) * .5, arena.minX, arena.maxX);
    return side < 0 ? lo : hi;
  }
}
