import { clamp, $ } from './Utils.js';

/**
 * Steer, boost, brake, roll, aim, manual fire, camera, pause.
 * Floating joystick + fire/boost pads on touch, drag-to-steer + WASD/arrows on
 * desktop, and full standard-mapping gamepad support:
 *   left stick -> steer          right stick -> camera (recenters on release)
 *   RT -> fire                   LT -> boost     A -> brake
 *   X -> aim / lock-on           LB / RB -> optional roll shortcuts
 *   Start -> pause               physical A -> menu confirmation
 */
const GP_DEADZONE = 0.18;
export const DEFAULT_BUTTONS = { fire: 7, cancel: 1, brake: 0, rollLeft: 4, rollRight: 5, aim: 2, boost: 6, view: 8, pause: 9, up: 12, down: 13, left: 14, right: 15 };
const GP_CAM_DEADZONE = 0.18;
const GP_TRIGGER_ON = 0.12; // analog triggers count as held past this value
export const ROLL_DOUBLE_TAP_MS = 280;
const isTextEntry = target => target?.matches?.('input:not([type="range"]):not([type="checkbox"]),textarea,[contenteditable="true"]');

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
    this._spacePhysicalHeld = false;

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
    this.menuConfirmHeld = false; // always physical south/A; never a gameplay binding
    this.menuConfirmPhysicalHeld = false;
    this._blockMenuConfirmUntilRelease = false;
    this._blockKeyboardFireUntilRelease = false;

    // one-shot barrel-roll requests, drained by the player each frame
    this._rollQueue = 0; // -1 = left, +1 = right, 0 = none
    this._blackArmorQueued = false;
    this._rollTapTimes = new Map();
    this._rollStickDir = 0;

    // one-frame d-pad/A edges for menu navigation, overwritten every poll
    this.menuNav = { left: false, right: false, up: false, down: false, confirm: false, cancel: false, pause: false, prevTab: false, nextTab: false, view: false };
    this._padIndex = null;
    this._navRepeat = {};
    this.bindings = { ...DEFAULT_BUTTONS };
    this.axes = [0, 1, 2, 3];
    this.deadzone = GP_DEADZONE;
    this.capture = null;
    // A connected but idle controller must not steal tutorial/help copy from a
    // player who is actively using the keyboard. This survives run resets so a
    // controller-confirmed launch opens with controller instructions.
    this.lastInputFamily = 'keyboard';

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
      if (!e.repeat) this.lastInputFamily = 'keyboard';
      const wasDown = this._keys[e.code];
      this._keys[e.code] = true;
      if (e.code === 'Space') this._spacePhysicalHeld = true;
      if (!e.repeat && !isTextEntry(e.target)) {
        if (e.code === 'KeyP') {
          if (this._onPause) this._onPause({ silent: true });
        } else if (e.code === 'Escape') {
          if (this._onPause) this._onPause({ silent: false });
        }
      }
      // Roll shortcuts and double taps are edge-triggered. Key repeat and text
      // entry never count, and Input.enabled is false while a menu owns input.
      if (!wasDown && !e.repeat && this.enabled && !isTextEntry(e.target)) {
        if (e.code === 'Digit1') this._blackArmorQueued = true;
        else if (e.code === 'KeyQ') this._rollQueue = -1;
        else if (e.code === 'KeyE') this._rollQueue = 1;
        else if (e.code === 'KeyA' || e.code === 'ArrowLeft') this._recordRollTap(`key:${e.code}`, -1);
        else if (e.code === 'KeyD' || e.code === 'ArrowRight') this._recordRollTap(`key:${e.code}`, 1);
      }
      // Keep gameplay Space from scrolling the page, but preserve the native
      // keyboard click contract for the shop's separate Skip button.
      if (e.code === 'Space' && !e.target?.closest?.('.upSkip')) e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      this._keys[e.code] = false;
      if (e.code === 'Space') {
        this._spacePhysicalHeld = false;
        this._blockKeyboardFireUntilRelease = false;
      }
    });
    addEventListener('blur', () => {
      this._keys = {};
      this._spacePhysicalHeld = false;
      this._blockKeyboardFireUntilRelease = false;
      this._rollQueue = 0;
      this._blackArmorQueued = false;
      this._resetRollTaps();
      this.boost = false;
      fOff();
      stickEnd();
    });
  }

  /**
   * Poll the first connected gamepad. Called once per frame by Game.update
   * (even while paused, so Start can un-pause). Standard mapping,
   * Default gameplay layout:
   *   left stick  (axes 0/1) -> steer the ship
   *   right stick (axes 2/3) -> camera, recenters when released
   *   RT (7)                 -> fire (held)
   *   LT (6)                 -> boost (held)
   *   A (0)                  -> brake (held)
   *   X (2)                  -> aim / lock-on (held)
   *   double-flick / d-pad   -> barrel roll left / right
   *   LB (4) / RB (5)        -> optional roll shortcuts
   *   Start (9)              -> pause toggle
   *   d-pad (12-15) + A (0)  -> menu navigation and confirmation
   */
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.padLost = this._padIndex != null && !Array.from(pads).some(p => p?.connected && p.index === this._padIndex);
    let pad = Array.from(pads).find(p => p?.connected && p.index === this._padIndex);
    if (!pad) pad = Array.from(pads).find(p => p?.connected && p.mapping === 'standard') || Array.from(pads).find(p => p?.connected);
    const m = this.menuNav;
    Object.keys(m).forEach(key => { m[key] = false; });
    if (!pad) {
      if (this._padId) this._padEvent = { connected: false, id: this._padId };
      this._padId = null;
      this._padIndex = null;
      this._padPrev = {};
      this._navRepeat = {};
      this._padX = this._padY = this._camX = this._camY = 0;
      this._padBoost = this._padBrake = this._padFire = this._padAim = false;
      this.menuConfirmHeld = false;
      this.menuConfirmPhysicalHeld = false;
      // Keyboard Q/E uses the same queue. Preserve fresh key presses through
      // ordinary no-controller polling; only a real disconnect cancels input.
      if (this.padLost) {
        this._rollQueue = 0;
        this.lastInputFamily = 'keyboard';
      }
      this.capture = null;
      return;
    }
    const physicalHeld = i => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > GP_TRIGGER_ON);
    // Presence alone is not input. Only a real button/stick action makes the
    // controller the active family used by contextual tutorial copy.
    if (pad.buttons.some((_, i) => physicalHeld(i)) || pad.axes.some(value => Math.abs(value || 0) > Math.max(this.deadzone, .25))) {
      this.lastInputFamily = 'controller';
    }
    const changed = pad.id !== this._padId || pad.index !== this._padIndex;
    if (changed) {
      this._padEvent = { connected: true, id: pad.id };
      this._padId = pad.id;
      this._padIndex = pad.index;
      this.loadController();
      this._padPrev = {};
      // The press which wakes/reconnects a controller must not launch or confirm.
      for (let i = 0; i < pad.buttons.length; i++) this._padPrev[i] = physicalHeld(i);
      this._navRepeat = {};
      this.blockMenuCarryover();
    }
    if (this.capture) {
      const held = pad.buttons.map((_, i) => physicalHeld(i));
      if (!held.some(Boolean)) this.capture.armed = true;
      if (performance.now() > this.capture.until) this.capture = null;
      else if (this.capture.armed && held.some(Boolean)) {
        const nextButton = held.findIndex(Boolean);
        const previousButton = this.bindings[this.capture.action];
        for (const action of Object.keys(this.bindings)) {
          if (action !== this.capture.action && this.bindings[action] === nextButton) this.bindings[action] = previousButton;
        }
        this.bindings[this.capture.action] = nextButton;
        this.saveController();
        this.capture = null;
        held.forEach((value, i) => { this._padPrev[i] = value; });
        this.blockMenuCarryover();
      }
      this._padX = this._padY = this._camX = this._camY = 0;
      this._padBoost = this._padBrake = this._padFire = this._padAim = false;
      return;
    }
    const held = action => physicalHeld(this.bindings[action]);
    const edge = action => held(action) && !this._padPrev[this.bindings[action]];
    const physicalEdge = index => physicalHeld(index) && !this._padPrev[index];
    const dz = (v, d) => Math.abs(v || 0) < d ? 0 : Math.sign(v) * Math.min(1, (Math.abs(v) - d) / (1 - d));
    const axisX = pad.axes[this.axes[0]] || 0, axisY = pad.axes[this.axes[1]] || 0;
    if (Math.abs(axisX) < this.deadzone && Math.abs(axisY) < this.deadzone) this._blockMotionUntilNeutral = false;
    this._padX = this._blockMotionUntilNeutral ? 0 : dz(axisX, this.deadzone);
    this._padY = this._blockMotionUntilNeutral ? 0 : -dz(axisY, this.deadzone);
    this._camX = dz(pad.axes[this.axes[2]], GP_CAM_DEADZONE);
    this._camY = -dz(pad.axes[this.axes[3]], GP_CAM_DEADZONE);
    if (!held('fire')) this._blockFireUntilRelease = false;
    this._padFire = held('fire') && !this._blockFireUntilRelease;
    this._padAim = held('aim');
    this._padBoost = held('boost');
    this._padBrake = held('brake');
    if (this.enabled) {
      if (edge('rollLeft')) this._rollQueue = -1;
      if (edge('rollRight')) this._rollQueue = 1;
      if (physicalEdge(14)) this._recordRollTap('pad:dpad-left', -1);
      if (physicalEdge(15)) this._recordRollTap('pad:dpad-right', 1);
      const flick = axisX < -.68 ? -1 : axisX > .68 ? 1 : 0;
      if (Math.abs(axisX) < .34) this._rollStickDir = 0;
      else if (flick && !this._rollStickDir) {
        this._rollStickDir = flick;
        this._recordRollTap(`pad:stick-${flick}`, flick);
      }
    } else {
      this._rollStickDir = 0;
    }
    this.menuConfirmPhysicalHeld = physicalHeld(0);
    if (!this.menuConfirmPhysicalHeld) this._blockMenuConfirmUntilRelease = false;
    this.menuConfirmHeld = this.menuConfirmPhysicalHeld && !this._blockMenuConfirmUntilRelease;
    m.confirm = physicalEdge(0) && !this._blockMenuConfirmUntilRelease;
    // Physical south/A is always exposed as contextual confirm. Keep saved
    // gameplay bindings functional too; ControllerMenus resolves a button-0
    // conflict in favor of confirm only while an actual menu owns input.
    const contextualEdge = action => edge(action);
    const contextualHeld = action => this.bindings[action] === 0 ? false : held(action);
    m.cancel = contextualEdge('cancel');
    m.pause = contextualEdge('pause');
    m.view = contextualEdge('view');
    m.prevTab = contextualEdge('rollLeft');
    m.nextTab = contextualEdge('rollRight');
    const now = performance.now();
    for (const [direction, stick] of [['left', axisX < -.55], ['right', axisX > .55], ['up', axisY < -.55], ['down', axisY > .55]]) {
      const active = contextualHeld(direction) || stick;
      const repeat = this._navRepeat[direction];
      if (changed && active) this._navRepeat[direction] = Infinity;
      else if (!active) delete this._navRepeat[direction];
      else if (repeat == null || now >= repeat) {
        m[direction] = true;
        this._navRepeat[direction] = now + (repeat == null ? 380 : 115);
      }
    }
    for (let i = 0; i < pad.buttons.length; i++) this._padPrev[i] = physicalHeld(i);
    if (m.pause && !this.menuRouting && this._onPause) this._onPause();
  }

  blockMenuCarryover() {
    this._blockFireUntilRelease = true;
    this._blockMenuConfirmUntilRelease = true;
    this._blockMotionUntilNeutral = true;
    this._padFire = false;
    this.menuConfirmHeld = false;
    this._rollQueue = 0;
    this._blackArmorQueued = false;
    this._resetRollTaps();
  }

  blockKeyboardFireUntilRelease() {
    this._blockKeyboardFireUntilRelease = true;
  }

  _recordRollTap(source, direction, now = performance.now()) {
    const previous = this._rollTapTimes.get(source) || -Infinity;
    if (now - previous <= ROLL_DOUBLE_TAP_MS) {
      this._rollQueue = direction;
      this._rollTapTimes.delete(source);
    } else this._rollTapTimes.set(source, now);
  }

  _resetRollTaps() {
    this._rollTapTimes.clear();
    this._rollStickDir = 0;
  }

  loadController() {
    let settings;
    try { settings = JSON.parse(localStorage.getItem('riftpirates-controller-v1') || '{}')[this._padId]; } catch { /* private browsing */ }
    this.bindings = { ...DEFAULT_BUTTONS };
    if (settings?.buttons) for (const key of Object.keys(DEFAULT_BUTTONS)) {
      if (Number.isInteger(settings.buttons[key]) && settings.buttons[key] >= 0 && settings.buttons[key] < 64) this.bindings[key] = settings.buttons[key];
    }
    if (new Set(Object.values(this.bindings)).size !== Object.keys(this.bindings).length) this.bindings = { ...DEFAULT_BUTTONS };
    this.axes = [0, 1, 2, 3].map((fallback, i) => Number.isInteger(settings?.axes?.[i]) && settings.axes[i] >= 0 && settings.axes[i] < 16 ? settings.axes[i] : fallback);
    this.deadzone = Number.isFinite(settings?.deadzone) ? clamp(settings.deadzone, .08, .4) : GP_DEADZONE;
  }

  saveController() {
    if (!this._padId) return;
    try {
      const all = JSON.parse(localStorage.getItem('riftpirates-controller-v1') || '{}');
      all[this._padId] = { buttons: this.bindings, axes: this.axes, deadzone: this.deadzone };
      localStorage.setItem('riftpirates-controller-v1', JSON.stringify(all));
    } catch { /* Settings remain usable for this session. */ }
  }

  /** Drain a pending barrel-roll request. Returns -1, 0 or +1. */
  consumeRoll() {
    const r = this._rollQueue;
    this._rollQueue = 0;
    return r;
  }

  /** Drain the edge-triggered keyboard request for Black Armor. */
  consumeBlackArmor() {
    const queued = this._blackArmorQueued;
    this._blackArmorQueued = false;
    return queued;
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

  /** Raw hold state used to reject a confirm already down when a shop opens. */
  get purchaseConfirmHeld() {
    return this._spacePhysicalHeld || this.menuConfirmPhysicalHeld;
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

  /** Manual fire — held RT by default, Space, or the touch fire pad. */
  get firing() {
    return this.enabled && (this._padFire || this.fireHeld || (!!this._keys.Space && !this._blockKeyboardFireUntilRelease));
  }

  /**
   * Aim mode — held X by default or F. On touch, holding the fire pad aims too, since
   * there's no room for a separate aim pad.
   */
  get aiming() {
    return this.enabled && (this._padAim || !!this._keys.KeyF || this.fireHeld);
  }

  /** Brake — held A by default, C on the keyboard. */
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
    this.menuConfirmHeld = false;
    this._rollQueue = 0;
    this._blackArmorQueued = false;
    this._resetRollTaps();
  }
}

export const Input = new InputImpl();
