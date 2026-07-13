import { clamp, $ } from './Utils.js';

/**
 * Deliberately minimal (spec §4): steer, hold to boost, pause. Nothing else.
 * Floating joystick on touch, drag-to-steer + WASD/arrows on desktop.
 */
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
      this._keys[e.code] = true;
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (this._onPause) this._onPause();
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
      x: clamp(this._stickX + kx, -1, 1),
      y: clamp(this._stickY + ky, -1, 1),
      boost: this.boost || kb,
    };
  }

  reset() {
    this._stickX = 0;
    this._stickY = 0;
    this.boost = false;
    this._keys = {};
  }
}

export const Input = new InputImpl();
