import { clamp, $ } from './Utils.js';

/**
 * Deliberately minimal (spec §4): steer, hold to boost, roll, pause.
 * Floating joystick on touch, drag-to-steer + WASD/arrows on desktop, and full
 * gamepad support (left stick / d-pad to steer, a face/trigger button to boost,
 * shoulder buttons to barrel roll, Start to pause).
 */
const GP_DEADZONE = 0.28;

class InputImpl {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.boost = false;
    this.enabled = false;
    this._touchId = null;
    this._bx = 0;
    this._by = 0;
    this._keys = {};
    this._onPause = null;
    this._stickX = 0;
    this._stickY = 0;
    this._mouseDown = false;

    // gamepad state, refreshed once per frame by pollGamepad()
    this._padX = 0;
    this._padY = 0;
    this._padBoost = false;
    this._padPrev = {}; // previous per-button pressed state, for edge detection

    // one-shot barrel-roll requests, drained by the player each frame
    this._rollQueue = 0; // -1 = left, +1 = right, 0 = none
  }

  init(canvas, { onPause } = {}) {
    this._onPause = onPause;
    const stick = $('stick');
    const nub = $('nub');
    const boostBtn = $('boostBtn');
    const R = 48;

    const stickStart = (id, cx, cy) => {
      this._touchId = id;
      this._bx = cx;
      this._by = cy;
      stick.style.display = 'block';
      stick.style.left = `${cx - 60}px`;
      stick.style.top = `${cy - 60}px`;
      nub.style.transform = 'translate(0px,0px)';
    };
    const stickMove = (cx, cy) => {
      let dx = cx - this._bx;
      let dy = cy - this._by;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      nub.style.transform = `translate(${dx}px,${dy}px)`;
      this._stickX = dx / R;
      this._stickY = -dy / R;
    };
    const stickEnd = () => {
      this._touchId = null;
      this._stickX = 0;
      this._stickY = 0;
      stick.style.display = 'none';
    };

    document.addEventListener(
      'touchstart',
      (e) => {
        if (!this.enabled) return;
        for (const t of e.changedTouches) {
          const el = document.elementFromPoint(t.clientX, t.clientY);
          if (el && (el.closest('#boostBtn') || el.closest('#pauseBtn'))) continue;
          if (this._touchId === null) stickStart(t.identifier, t.clientX, t.clientY);
        }
        if (e.target === canvas) e.preventDefault();
      },
      { passive: false }
    );
    document.addEventListener(
      'touchmove',
      (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === this._touchId) stickMove(t.clientX, t.clientY);
        }
        if (this._touchId !== null) e.preventDefault();
      },
      { passive: false }
    );
    const touchDone = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._touchId) stickEnd();
      }
    };
    document.addEventListener('touchend', touchDone);
    document.addEventListener('touchcancel', touchDone);

    // desktop: drag anywhere on the canvas to steer
    document.addEventListener('mousedown', (e) => {
      if (!this.enabled || e.target !== canvas) return;
      this._mouseDown = true;
      stickStart('m', e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', (e) => {
      if (this._mouseDown) stickMove(e.clientX, e.clientY);
    });
    document.addEventListener('mouseup', () => {
      if (this._mouseDown) {
        this._mouseDown = false;
        stickEnd();
      }
    });

    const bOn = (e) => {
      if (e) e.preventDefault();
      this.boost = true;
      boostBtn.classList.add('on');
    };
    const bOff = (e) => {
      if (e) e.preventDefault();
      this.boost = false;
      boostBtn.classList.remove('on');
    };
    boostBtn.addEventListener('touchstart', bOn, { passive: false });
    boostBtn.addEventListener('touchend', bOff);
    boostBtn.addEventListener('mousedown', bOn);
    boostBtn.addEventListener('mouseup', bOff);
    boostBtn.addEventListener('mouseleave', () => {
      if (this.boost) bOff();
    });

    addEventListener('keydown', (e) => {
      const wasDown = this._keys[e.code];
      this._keys[e.code] = true;
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (this._onPause) this._onPause();
      }
      // barrel roll — edge-triggered, so holding the key doesn't spin forever
      if (!wasDown && this.enabled) {
        if (e.code === 'KeyQ') this._rollQueue = -1;
        else if (e.code === 'KeyE') this._rollQueue = 1;
      }
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      this._keys[e.code] = false;
    });
    addEventListener('blur', () => {
      this._keys = {};
      this.boost = false;
      stickEnd();
    });
  }

  /**
   * Poll the first connected gamepad. Called once per frame by Game.update
   * (even while paused, so Start can un-pause). Maps:
   *   left stick + d-pad -> steer
   *   A / RT / RB        -> boost
   *   LB                 -> roll left   RB is shared with boost, so roll-right
   *   X / L-stick click  -> roll right
   *   Start              -> pause toggle
   */
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) {
      this._padX = 0;
      this._padY = 0;
      this._padBoost = false;
      return;
    }

    const ax = pad.axes[0] || 0;
    const ay = pad.axes[1] || 0;
    const dz = (v) => (Math.abs(v) < GP_DEADZONE ? 0 : v);
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    // d-pad (standard mapping buttons 12-15) folds into the analog steer
    let sx = dz(ax) + (btn(15) ? 1 : 0) - (btn(14) ? 1 : 0);
    let sy = -dz(ay) + (btn(12) ? 1 : 0) - (btn(13) ? 1 : 0);
    this._padX = clamp(sx, -1, 1);
    this._padY = clamp(sy, -1, 1);

    // boost: A (0), RT (7) or RB (5)
    this._padBoost = btn(0) || btn(7) || btn(5);

    // edge-triggered buttons
    const edge = (i) => {
      const now = btn(i);
      const fired = now && !this._padPrev[i];
      this._padPrev[i] = now;
      return fired;
    };
    if (this.enabled) {
      if (edge(4)) this._rollQueue = -1; // LB -> roll left
      if (edge(2)) this._rollQueue = 1; //  X -> roll right
      if (edge(1)) this._rollQueue = this._rollQueue || 1; // B -> roll right (fallback)
    } else {
      // keep prev state fresh so re-enabling doesn't fire a stale edge
      [1, 2, 4].forEach((i) => (this._padPrev[i] = btn(i)));
    }
    // Start (9) toggles pause on the rising edge, regardless of enabled state
    if (edge(9) && this._onPause) this._onPause();
  }

  /** Drain a pending barrel-roll request. Returns -1, 0 or +1. */
  consumeRoll() {
    const r = this._rollQueue;
    this._rollQueue = 0;
    return r;
  }

  key(code) {
    return !!this._keys[code];
  }

  /** Consume a one-shot key press (used for the cinematic skip). */
  consumeKey(code) {
    if (this._keys[code]) {
      this._keys[code] = false;
      return true;
    }
    return false;
  }

  /** Merged analog + keyboard steering, clamped to the unit square. */
  read() {
    let kx = 0;
    let ky = 0;
    const k = this._keys;
    if (k.ArrowLeft || k.KeyA) kx -= 1;
    if (k.ArrowRight || k.KeyD) kx += 1;
    if (k.ArrowUp || k.KeyW) ky += 1;
    if (k.ArrowDown || k.KeyS) ky -= 1;
    const kb = !!(k.ShiftLeft || k.ShiftRight || k.Space);
    return {
      x: clamp(this._stickX + kx + this._padX, -1, 1),
      y: clamp(this._stickY + ky + this._padY, -1, 1),
      boost: this.boost || kb || this._padBoost,
    };
  }

  reset() {
    this._stickX = 0;
    this._stickY = 0;
    this.boost = false;
    this._keys = {};
    this._padX = 0;
    this._padY = 0;
    this._padBoost = false;
    this._rollQueue = 0;
  }
}

export const Input = new InputImpl();
