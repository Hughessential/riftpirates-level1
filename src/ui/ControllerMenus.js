import { Input, DEFAULT_BUTTONS } from '../core/Input.js';
import { Audio2 } from '../core/AudioManager.js';
import { pilotNameCharacters } from '../core/PilotName.js';
import './controller-menus.css';

const controls = 'button,input:not([type="hidden"]),select,textarea';
const visible = el => !el.disabled && !el.closest('[hidden],.hidden') && el.getClientRects().length > 0;
const labels = { fire: 'PRIMARY FIRE', cancel: 'BACK', brake: 'BRAKE', rollLeft: 'LEFT ROLL / PREVIOUS TAB', rollRight: 'RIGHT ROLL / NEXT TAB', aim: 'AIM / LOCK', boost: 'BOOST', view: 'CONTROLLER SETUP', pause: 'PAUSE', up: 'MENU UP', down: 'MENU DOWN', left: 'MENU LEFT', right: 'MENU RIGHT' };

/** One focus owner per frame. Native controls receive their normal input/change
 * events, so controller edits use exactly the same settings paths as the mouse. */
export class ControllerMenus {
  constructor(game) {
    this.game = game;
    this.root = null;
    this.focused = null;
    this.wasConnected = false;
    this.active = false;
    Input.menuRouting = true;
    this.hint = document.createElement('div');
    this.hint.className = 'controllerHint';
    this.hint.hidden = true;
    this.hint.textContent = 'STICK / D-PAD MOVE · SOUTH SELECT · EAST BACK · LEFT / RIGHT ADJUST · LB / RB TABS';
    document.body.append(this.hint);
    this.audioHint = document.createElement('div');
    this.audioHint.className = 'controllerAudioHint';
    this.audioHint.hidden = true;
    this.audioHint.setAttribute('role', 'status');
    this.audioHint.textContent = 'AUDIO LOCKED BY BROWSER · CLICK OR PRESS A KEY TO ENABLE SOUND';
    document.body.append(this.audioHint);
    this.createSettings();
    this.createKeyboard();
    document.addEventListener('pointerdown', () => this.setActive(false), { passive: true });
    document.addEventListener('keydown', () => this.setActive(false));
  }

  createSettings() {
    const button = document.createElement('button');
    button.id = 'controllerSettingsBtn';
    button.className = 'controllerEntry';
    button.textContent = 'CONTROLLER SETUP';
    button.addEventListener('click', () => this.openSettings());
    const slot = document.querySelector('.menuControls>span');
    if (slot) slot.replaceWith(button);
    else document.querySelector('.menuControls')?.append(button);
    const pauseButton = button.cloneNode(true);
    pauseButton.id = 'controllerSettingsPauseBtn';
    pauseButton.className = 'btnGhost labPauseEntry';
    pauseButton.addEventListener('click', () => this.openSettings());
    document.getElementById('quitBtn').before(pauseButton);
    this.settings = document.createElement('dialog');
    this.settings.id = 'controllerSettings';
    this.settings.className = 'controllerDialog';
    this.settings.innerHTML = `<header><div><small>FLY YOUR WAY</small><h2>CONTROLLER SETUP</h2></div><button data-close aria-label="Close controller settings">×</button></header><p id="controllerName" role="status"></p><p class="controllerHelp">MCON: use X-Input mode. Default flight: RT fire · LT boost · A brake · X aim · double-flick or D-pad roll · Start pause. Menus always confirm with physical A. Xbox, PlayStation and Switch layouts use browser standard mapping. For other layouts, select an action and press its physical button. Settings are saved for each controller.</p><div class="controllerBindings">${Object.entries(labels).map(([id, label]) => `<button data-bind="${id}"><span>${label}</span><b></b></button>`).join('')}</div><div class="controllerAxes">${['STEER X', 'STEER Y', 'CAMERA X', 'CAMERA Y'].map((label, i) => `<label>${label}<select data-axis="${i}">${Array.from({length: 16}, (_, n) => `<option value="${n}">AXIS ${n}</option>`).join('')}</select></label>`).join('')}<label>STICK DEADZONE<input type="range" id="controllerDeadzone" min="8" max="40" step="1"><output id="controllerDeadzoneValue"></output></label></div><p id="controllerCapture" role="status"></p><footer><button id="controllerReset">RESET THIS CONTROLLER</button><button data-close>DONE</button></footer>`;
    document.body.append(this.settings);
    this.settings.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => this.closeSettings()));
    this.settings.querySelectorAll('[data-bind]').forEach(el => el.addEventListener('click', () => {
      if (Input._padId) Input.capture = { action: el.dataset.bind, armed: false, until: performance.now() + 12000 };
    }));
    this.settings.querySelectorAll('[data-axis]').forEach(el => el.addEventListener('change', () => {
      Input.axes[Number(el.dataset.axis)] = Number(el.value); Input.saveController();
    }));
    this.settings.querySelector('#controllerDeadzone').addEventListener('input', event => {
      Input.deadzone = Number(event.target.value) / 100; Input.saveController();
    });
    this.settings.querySelector('#controllerReset').addEventListener('click', () => {
      Input.bindings = { ...DEFAULT_BUTTONS }; Input.axes = [0, 1, 2, 3]; Input.deadzone = .18;
      Input.saveController(); Input.blockMenuCarryover();
    });
    this.settings.addEventListener('cancel', event => { event.preventDefault(); this.closeSettings(); });
    this.settings.addEventListener('keydown', event => event.stopPropagation());
  }

  openSettings() {
    this.ownedPause = this.game.running && !this.game.paused && !this.game.testing.panelOpen;
    if (this.ownedPause) this.game.togglePause();
    this.paintSettings();
    this.settings.showModal();
    this.settings.querySelector('[data-close]').focus();
  }

  closeSettings() {
    Input.capture = null;
    this.settings.close();
    if (this.ownedPause && this.game.paused) this.game.togglePause();
    this.ownedPause = false;
    Input.blockMenuCarryover();
  }

  paintSettings() {
    this.settings.querySelector('#controllerName').textContent = Input._padId || 'CONNECT A CONTROLLER, THEN PRESS ANY BUTTON';
    this.settings.querySelectorAll('[data-bind]').forEach(button => {
      const text = `BUTTON ${Input.bindings[button.dataset.bind]}`;
      if (button.lastElementChild.textContent !== text) button.lastElementChild.textContent = text;
      button.disabled = !Input._padId;
    });
    this.settings.querySelectorAll('[data-axis]').forEach(el => { if (document.activeElement !== el) el.value = Input.axes[Number(el.dataset.axis)]; });
    const deadzone = this.settings.querySelector('#controllerDeadzone');
    if (document.activeElement !== deadzone) deadzone.value = Math.round(Input.deadzone * 100);
    this.settings.querySelector('#controllerDeadzoneValue').value = `${Math.round(Input.deadzone * 100)}%`;
    this.settings.querySelector('#controllerCapture').textContent = Input.capture ? `RELEASE, THEN PRESS A BUTTON FOR ${labels[Input.capture.action]} · WAIT 12s OR ESC TO CANCEL` : 'D-PAD / STICK MOVE · LEFT / RIGHT ADJUST · BACK CLOSE';
  }

  createKeyboard() {
    this.keyboard = document.createElement('dialog');
    this.keyboard.id = 'controllerKeyboard';
    this.keyboard.className = 'controllerDialog controllerKeyboard';
    this.keyboard.innerHTML = `<h2>AUGMENT SEARCH</h2><output class="pilotNameText"></output><div>${'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('').map(key => `<button data-key="${key}">${key}</button>`).join('')}<button data-key=" ">SPACE</button><button data-key="erase">⌫</button><button data-key="clear">CLEAR</button><button data-key="done">DONE</button></div>`;
    document.body.append(this.keyboard);
    this.keyboard.addEventListener('click', event => {
      const key = event.target.closest('[data-key]')?.dataset.key;
      if (key == null || !this.searchField) return;
      if (key === 'done') return this.closeKeyboard();
      if (key === 'clear') this.searchField.value = '';
      else if (key === 'erase') this.searchField.value = pilotNameCharacters(this.searchField.value).slice(0, -1).join('');
      else this.searchField.value += key;
      this.searchField.dispatchEvent(new Event('input', { bubbles: true }));
      this.keyboard.querySelector('output').value = this.searchField.value || this.searchField.dataset.keyboardPlaceholder || 'TYPE TO FILTER';
    });
    this.keyboard.addEventListener('cancel', event => { event.preventDefault(); this.closeKeyboard(); });
    this.keyboard.addEventListener('keydown', event => event.stopPropagation());
  }

  closeKeyboard() {
    if (!this.keyboard.open) return;
    this.keyboard.close();
    // Restore both owners synchronously. A queued native close listener could
    // steal focus after the player has already moved to the next control.
    this.root = this.currentRoot();
    if (this.searchField?.isConnected) this.focus(this.searchField);
    Input.blockMenuCarryover();
  }

  setActive(active) {
    this.active = active;
    if (active) this.hint.textContent = `STICK / D-PAD MOVE · SOUTH / A SELECT · ${Input.bindings.cancel === 1 ? 'EAST' : 'BUTTON ' + Input.bindings.cancel} BACK · LEFT / RIGHT ADJUST · LB / RB TABS`;
    document.body.classList.toggle('controllerMode', active);
    if (!active) this.focused?.classList.remove('controllerFocus');
    this.hint.hidden = !active || !this.root;
  }

  currentRoot() {
    if (this.keyboard.open) return this.keyboard;
    if (this.settings.open) return this.settings;
    if (this.game.pilotIdentity?.dialog.open) return this.game.pilotIdentity.dialog;
    if (this.game.testingPanel?.dialog.open) return this.game.testingPanel.dialog;
    if (this.game.hangar?.dialog.open) return this.game.hangar.dialog;
    if (this.game.optionsMenu?.dialog.open) return this.game.optionsMenu.dialog;
    // The tutorial Skip is controller-accessible, but upgrade choices keep
    // priority while the final cache lesson and shop are both visible.
    for (const id of ['pauseScreen', 'resultsScreen', 'upgradeScreen', 'openingTutorial', 'titleScreen']) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) return el;
    }
    return null;
  }

  focus(el) {
    this.focused?.classList.remove('controllerFocus');
    this.focused = el;
    if (!el) return;
    el.classList.add('controllerFocus');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (el.dataset.shipId) this.game.hangar.select(el.dataset.shipId);
    if (el.classList.contains('upCard')) {
      this.game.upgradeScreen.sel = [...el.parentElement.children].indexOf(el);
      this.game.upgradeScreen._paintSel();
    }
  }

  move(items, direction) {
    const index = items.indexOf(this.focused);
    this.focus(items[(Math.max(0, index) + direction + items.length) % items.length]);
  }

  adjust(el, direction) {
    if (el.tagName === 'SELECT') {
      const options = [...el.options].filter(option => !option.disabled && !option.hidden);
      const index = options.indexOf(el.selectedOptions[0]);
      const next = options[Math.max(0, Math.min(options.length - 1, index + direction))];
      if (next) el.value = next.value;
    } else if (el.matches('input[type="range"],input[type="number"]')) {
      const step = el.dataset.audioVolume ? 5 : Number(el.step || 1);
      const min = el.min === '' ? -Infinity : Number(el.min), max = el.max === '' ? Infinity : Number(el.max);
      el.value = Math.max(min, Math.min(max, Number(el.value) + step * direction));
    } else return false;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  update() {
    const connected = Boolean(Input._padId);
    if (Input.padLost || (this.wasConnected && !connected)) {
      if (this.game.running && !this.game.paused) this.game.togglePause();
      this.setActive(false);
    }
    this.wasConnected = connected;
    const nav = Input.menuNav;
    if (Object.values(nav).some(Boolean)) {
      this.setActive(true);
      Audio2.init(); Audio2.resume();
    }
    this.audioHint.hidden = !this.active || Audio2.ctx?.state !== 'suspended';
    if (this.settings.open) {
      const signature = JSON.stringify([Input._padId, Input.bindings, Input.axes, Input.deadzone, Input.capture?.action]);
      if (signature !== this.settingsSignature) { this.paintSettings(); this.settingsSignature = signature; }
    }
    let root = this.currentRoot();
    if (root !== this.root) {
      if (this.root && !root) Input.blockMenuCarryover();
      this.root = root;
      this.tutorialSkipArmed = false;
      this.focused?.classList.remove('controllerFocus');
      this.focused = null;
      if (this.active && root) {
        // Flight-stick movement must not pre-focus Skip: otherwise the A brake
        // lesson would also activate it. A deliberate D-pad move arms Skip.
        if (root.id !== 'openingTutorial') {
          const preferred = root.querySelector('#victorySkip:not([hidden])') || root.querySelector('#launchBtn,#resumeBtn,#againBtn,#pilotNameInput,#musicTgl,.shipOption[aria-pressed="true"],.upCard,[role="tab"][aria-selected="true"]');
          const items = [...root.querySelectorAll(controls)].filter(visible);
          this.focus(preferred && visible(preferred) ? preferred : items[0]);
        }
      }
    }
    this.hint.hidden = !this.active || !root || root.tagName === 'DIALOG';
    if (!connected) return;
    if (root && nav.confirm) {
      // Physical A owns confirmation whenever a menu is present, even when a
      // preserved custom gameplay map assigns pause/back/view/shoulder to the
      // same button. Outside menus those saved mappings remain fully usable.
      const buttonZeroConflicts = {
        cancel: 'cancel', pause: 'pause', view: 'view',
        rollLeft: 'prevTab', rollRight: 'nextTab',
      };
      for (const [action, navKey] of Object.entries(buttonZeroConflicts)) {
        if (Input.bindings[action] === 0) nav[navKey] = false;
      }
    }
    if (nav.view && !this.settings.open && !this.keyboard.open) { this.openSettings(); this.consume(); return; }
    if (!root) {
      if (nav.pause) { this.game.togglePause(); this.consume(); }
      if (nav.confirm && !document.getElementById('skipHint').classList.contains('hidden')) Input._keys.Enter = true;
      return;
    }
    if (nav.cancel || nav.pause) {
      if (root === this.keyboard) this.closeKeyboard();
      else if (root === this.settings) this.closeSettings();
      else if (root === this.game.pilotIdentity?.dialog) this.game.pilotIdentity.close();
      else if (root === this.game.testingPanel?.dialog) this.game.testingPanel.close();
      else if (root === this.game.hangar?.dialog) this.game.hangar.close();
      else if (root === this.game.optionsMenu?.dialog) this.game.optionsMenu.close();
      else if (root.id === 'pauseScreen' || root.id === 'upgradeScreen' || (root.id === 'openingTutorial' && nav.pause)) this.game.togglePause();
      else if (root.id === 'resultsScreen') document.getElementById('toTitleBtn').click();
      this.consume(); return;
    }
    if (!this.active || Input.capture) { this.consume(); return; }
    if (!Object.values(nav).some(Boolean)) return;
    let items = [...root.querySelectorAll(controls)].filter(visible);
    if (!items.length) { this.consume(); return; }
    if (root.id === 'openingTutorial' && !this.tutorialSkipArmed) {
      const direction = nav.left || nav.right || nav.up || nav.down;
      const physicalDpad = [12, 13, 14, 15].some(index => Input._padPrev[index]);
      if (direction && physicalDpad) {
        this.tutorialSkipArmed = true;
        this.focus(items[0]);
        Audio2.play('ui_move', 0.3, 1.1);
      }
      // Physical A remains gameplay brake until Skip is deliberately armed.
      this.consume(); return;
    }
    if (!items.includes(this.focused)) this.focus(items.includes(document.activeElement) ? document.activeElement : items[0]);
    if (root === this.game.testingPanel?.dialog && (nav.prevTab || nav.nextTab)) {
      const tabs = ['pilot', 'augments', 'arena', 'effects'];
      const index = (tabs.indexOf(this.game.testingPanel.activeTab) + (nav.nextTab ? 1 : -1) + 4) % 4;
      this.game.testingPanel.selectTab(tabs[index]);
      this.focus(root.querySelector(`#labTab-${tabs[index]}`));
    } else if (nav.up || nav.down) this.move(items, nav.down ? 1 : -1);
    else if (nav.left || nav.right) {
      const direction = nav.right ? 1 : -1;
      if (!this.adjust(this.focused, direction)) this.move(items, direction);
    } else if (nav.prevTab || nav.nextTab) this.move(items, nav.nextTab ? 1 : -1);
    if (nav.confirm) {
      const el = this.focused;
      // Augment cards own the south-button hold gesture. Skip and every other
      // menu action remain immediate; gameplay fire mappings never affect A.
      if (root.id === 'upgradeScreen' && el.classList.contains('upCard')) {
        this.consume(); return;
      }
      Input.blockMenuCarryover();
      if (el.matches('input[type="search"],input[type="text"],textarea')) {
        this.searchField = el;
        this.keyboard.querySelector('h2').textContent = el.dataset.keyboardTitle || 'AUGMENT SEARCH';
        this.keyboard.querySelector('output').value = el.value || el.dataset.keyboardPlaceholder || 'TYPE TO FILTER';
        this.keyboard.showModal();
      } else if (el.tagName === 'SELECT') this.adjust(el, 1);
      else if (!el.matches('input[type="range"],input[type="number"]')) el.click();
    }
    this.consume();
  }

  consume() { Object.keys(Input.menuNav).forEach(key => { Input.menuNav[key] = false; }); }
}
