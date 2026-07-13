/**
 * Delayed callbacks on *game* time, not wall time. Anything gameplay-facing
 * (burst spacing, staged explosions, phase cues) must run through here so it
 * respects pause, slow-motion and run resets — setTimeout does not.
 */
export class Scheduler {
  constructor() {
    this.items = [];
  }

  /** @returns {object} handle — pass to cancel(). */
  after(delay, fn, tag = null) {
    const item = { t: delay, fn, tag, dead: false };
    this.items.push(item);
    return item;
  }

  /** Repeat `fn` every `interval` seconds, `times` times (burst spacing). */
  repeat(interval, times, fn, tag = null) {
    for (let i = 0; i < times; i++) {
      this.after(interval * i, () => fn(i), tag);
    }
  }

  cancel(item) {
    if (item) item.dead = true;
  }

  cancelTag(tag) {
    for (const i of this.items) if (i.tag === tag) i.dead = true;
  }

  update(dt) {
    if (!this.items.length) return;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.dead) {
        this.items.splice(i, 1);
        continue;
      }
      it.t -= dt;
      if (it.t <= 0) {
        this.items.splice(i, 1);
        try {
          it.fn();
        } catch (e) {
          console.error('scheduled task failed', e);
        }
      }
    }
  }

  clear() {
    this.items.length = 0;
  }
}
