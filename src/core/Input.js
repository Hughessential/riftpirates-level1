import { clamp, $ } from './Utils.js';

/**
 * Steer, boost, brake, roll, aim, manual fire, camera, pause.
 * Floating joystick + fire/boost pads on touch, drag-to-steer + WASD/arrows on
 * desktop, and full standard-mapping gamepad support (Star Fox-style layout):
 *   left stick -> steer          right stick -> camera (recenters on release)
 *   LB / RB    -> barrel roll    A -> fire      LT -> aim / lock-on
 *   RT -> boost                  Y -> brake
 *   Start      -> pause          d-pad + A -> pick an upgrade card
 * B and X are reserved for future abilities (bomb, charge shot).
 */
const GP_DEADZONE = 0.24;
const GP_CAM_DEADZONE = 0.18;
const GP_TRIGGER_ON = 0.12; // analog triggers count as held past this value

class InputImpl {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.boost = false;
    this.fireHeld = false; // touch/mouse fire pad
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
    this._camX = 0; // camera stick
    this._camY = 0;
    this._padBoost = false;
    this._padBrake = false;
    this._padFire = false;
    this._padAim = false;
    this._padPrev = {}; // previous per-button pressed state, for edge detection

    // one-shot barrel-roll requests, drained by the player each frame
    this._rollQueue = 0; // -1 = left, +1 = right, 0 = none

    // one-frame d-pad/A edges for menu navigation, overwritten every poll
    this.menuNav = { left: false, right: false, up: false, down: false, confirm: false };

    // gamepad presence — drained by Game for the connect/disconnect toast
    this._padId = null;
    this._padEvent = null; // one-shot { connected: boolean, id: string }
  }

  init(canvas, { onPause } = {}) {
    this._onPause = onPause;
    const stick = $('stick');
    const nub = $('nub');
    const boostBtn = $('boostBtn');
    const fireBtn = $('fireBtn');
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
          if (el && (el.closest('#boostBtn') || el.closest('#fireBtn') || el.closest('#pauseBtn'))) continue;
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

    // manual fire pad (touch/mouse counterpart of L2)
    const fOn = (e) => {
      if (e) e.preventDefault();
      this.fireHeld = true;
      fireBtn.classList.add('on');
    };
    const fOff = (e) => {
      if (e) e.preventDefault();
      this.fireHeld = false;
      fireBtn.classList.remove('on');
    };
    fireBtn.addEventListener('touchstart', fOn, { passive: false });
    fireBtn.addEventListener('touchend', fOff);
    fireBtn.addEventListener('mousedown', fOn);
    fireBtn.addEventListener('mouseup', fOff);
    fireBtn.addEventListener('mouseleave', () => {
      if (this.fireHeld) fOff();
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
      fOff();
      stickEnd();
    });
  }

  /**
   * Poll the first connected gamepad. Called once per frame by Game.update
   * (even while paused, so Start can un-pause). Standard mapping,
   * Star Fox-style layout:
   *   left stick  (axes 0/1) -> steer the ship
   *   right stick (axes 2/3) -> camera, recenters when released
   *   LB (4) / RB (5)        -> barrel roll left / right
   *   A (0)                  -> fire (held)
   *   LT (6)                 -> aim / lock-on (held)
   *   RT (7)                 -> boost (held)
   *   Y (3)                  -> brake (held)
   *   Start (9)              -> pause toggle
   *   d-pad (12-15) + A      -> upgrade-card navigation (menuNav edges)
   * B (1) and X (2) stay unbound — reserved for future abilities.
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
      if (this._padId) {
        this._padEvent = { connected: false, id: this._padId };
        this._padId = null;
      }
      this._padX = 0;
      this._padY = 0;
      this._camX = 0;
      this._camY = 0;
      this._padBoost = false;
      this._padBrake = false;
      this._padFire = false;
      this._padAim = false;
      const m = this.menuNav;
      m.left = m.right = m.up = m.down = m.confirm = false;
      return;
    }
    if (pad.id !== this._padId) {
      this._padEvent = { connected: true, id: pad.id };
      this._padId = pad.id;
    }

    // deadzone with the remaining range rescaled to 0..1, so motion ramps
    // smoothly from zero instead of jumping at the deadzone edge
    const dz = (v, d) => {
      const a = Math.abs(v || 0);
      return a < d ? 0 : Math.sign(v) * Math.min(1, (a - d) / (1 - d));
    };
    this._padX = dz(pad.axes[0], GP_DEADZONE);
    this._padY = -dz(pad.axes[1], GP_DEADZONE);
    this._camX = dz(pad.axes[2], GP_CAM_DEADZONE);
    this._camY = -dz(pad.axes[3], GP_CAM_DEADZONE);

    // triggers report an analog value on most pads; past-threshold = held
    const held = (i) => {
      const b = pad.buttons[i];
      return !!b && (b.pressed || (b.value || 0) > GP_TRIGGER_ON);
    };
    this._padFire = held(0); // A
    this._padAim = held(6); // LT
    this._padBoost = held(7); // RT
    this._padBrake = held(3); // Y

    // edge-triggered buttons
    const edge = (i) => {
      const now = held(i);
      const fired = now && !this._padPrev[i];
      this._padPrev[i] = now;
      return fired;
    };
    if (this.enabled) {
      if (edge(4)) this._rollQueue = -1; // LB -> roll left
      if (edge(5)) this._rollQueue = 1; // RB -> roll right
    } else {
      // keep prev state fresh so re-enabling doesn't fire a stale edge
      [4, 5].forEach((i) => (this._padPrev[i] = held(i)));
    }
    // Start (9) toggles pause on the rising edge, regardless of enabled state
    if (edge(9) && this._onPause) this._onPause();

    // Menu navigation (upgrade cards): one-frame edges, refreshed every poll
    // so a button held before a screen opens can never fire a stale confirm.
    const m = this.menuNav;
    m.up = edge(12);
    m.down = edge(13);
    m.left = edge(14);
    m.right = edge(15);
    m.confirm = edge(0); // A
  }

  /** Drain a pending barrel-roll request. Returns -1, 0 or +1. */
  consumeRoll() {
    const r = this._rollQueue;
    this._rollQueue = 0;
    return r;
  }

  /** Drain the one-shot gamepad connect/disconnect notice. */
  consumePadEvent() {
    const e = this._padEvent;
    this._padEvent = null;
    return e;
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
    const kb = !!(k.ShiftLeft || k.ShiftRight);
    return {
      x: clamp(this._stickX + kx + this._padX, -1, 1),
      y: clamp(this._stickY + ky + this._padY, -1, 1),
      boost: this.boost || kb || this._padBoost,
    };
  }

  /** Manual fire — held A, Space, or the touch fire pad. */
  get firing() {
    return this.enabled && (this._padFire || this.fireHeld || !!this._keys.Space);
  }

  /**
   * Aim mode — held LT or F. On touch, holding the fire pad aims too, since
   * there's no room for a separate aim pad.
   */
  get aiming() {
    return this.enabled && (this._padAim || !!this._keys.KeyF || this.fireHeld);
  }

  /** Brake — held Y on a pad, C on the keyboard. */
  get braking() {
    return this.enabled && (this._padBrake || !!this._keys.KeyC);
  }

  /** Right-stick camera input. Zero while disabled, so the rig recenters. */
  readCamera() {
    if (!this.enabled) return { x: 0, y: 0 };
    return { x: this._camX, y: this._camY };
  }

  reset() {
    this._stickX = 0;
    this._stickY = 0;
    this.boost = false;
    this.fireHeld = false;
    this._keys = {};
    this._padX = 0;
    this._padY = 0;
    this._camX = 0;
    this._camY = 0;
    this._padBoost = false;
    this._padBrake = false;
    this._padFire = false;
    this._padAim = false;
    this._rollQueue = 0;
  }
}

export const Input = new InputImpl();
