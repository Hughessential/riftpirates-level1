/** Conservative render-only feedback; gameplay, camera and CSS pixels stay fixed. */
export class AdaptiveResolution {
  constructor() {
    this.scale = 1;
    this.resetSamples();
    this.cooldown = 3;
    this.stableTime = 0;
  }

  resetSamples() { this.elapsed = 0; this.frames = 0; }

  restore() {
    const changed = this.scale !== 1;
    this.scale = 1;
    this.resetSamples();
    this.cooldown = 3;
    this.stableTime = 0;
    return changed;
  }

  update(dt, eligible = true) {
    // Pause, menus, cinematic setup, tab changes and lab stepping are not GPU
    // performance samples. Do not turn their timing into a blurry next frame.
    if (!eligible || !Number.isFinite(dt) || dt <= 0 || dt > .1) {
      this.resetSamples();
      this.stableTime = 0;
      return false;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed < 2) return false;
    const average = this.elapsed / this.frames;
    this.stableTime = average < .0175 ? this.stableTime + this.elapsed : 0;
    this.resetSamples();
    if (this.cooldown > 0) return false;
    const previous = this.scale;
    if (average > .024) this.scale = Math.max(.65, Math.round((this.scale - .1) * 100) / 100);
    else if (this.stableTime >= 10) this.scale = Math.min(1, Math.round((this.scale + .05) * 100) / 100);
    if (this.scale === previous) return false;
    this.cooldown = 4;
    this.stableTime = 0;
    return true;
  }
}
