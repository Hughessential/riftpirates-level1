import { Save } from '../core/SaveSystem.js';
import { Input } from '../core/Input.js';
import { PLAYER_SHIPS } from '../render/PlayerFleet.js';
import { PILOT_NAME_DEFAULT, PILOT_NAME_MAX, safePilotName, validatePilotName } from '../core/PilotName.js';
import './pilot-identity.css';

export class PilotIdentity {
  constructor(game, hangar) {
    this.game = game;
    this.hangar = hangar;
    this.sessionName = null;
    this.hudName = document.getElementById('pilotHudName');
    this.entry = document.createElement('button');
    this.entry.type = 'button';
    this.entry.id = 'pilotIdentityBtn';
    this.entry.className = 'pilotIdentityEntry';
    this.entry.setAttribute('aria-haspopup', 'dialog');
    this.entry.innerHTML = '<span>CAPTAIN</span><strong class="pilotNameText"></strong><span>EDIT NAME ↗</span>';
    hangar.card.after(this.entry);
    this.entry.addEventListener('click', () => this.open());

    this.dialog = document.createElement('dialog');
    this.dialog.id = 'pilotIdentityDialog';
    this.dialog.className = 'pilotIdentityDialog';
    this.dialog.setAttribute('aria-labelledby', 'pilotIdentityTitle');
    this.dialog.setAttribute('aria-describedby', 'pilotIdentityHelp');
    this.dialog.innerHTML = `
      <header><div><small>YOUR SHIP. YOUR NAME. YOUR LEGEND.</small><h2 id="pilotIdentityTitle">CREATE YOUR NAME</h2></div><button type="button" id="pilotNameClose" aria-label="Cancel name editing">×</button></header>
      <div class="pilotIdentityBody"><div class="pilotShipPreview"><div class="pilotPreviewOrbit" aria-hidden="true"></div><img alt="Selected cosmetic ship"><div class="pilotNamePlate"><span aria-hidden="true">◆</span><strong class="pilotNameText" id="pilotNamePreview"></strong><span aria-hidden="true">◆</span></div><small id="pilotPreviewHull"></small></div>
      <form id="pilotNameForm" novalidate><label for="pilotNameInput">PILOT / CAPTAIN NAME</label><input id="pilotNameInput" class="pilotNameText" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text" aria-describedby="pilotIdentityHelp pilotNameError" data-keyboard-title="CREATE YOUR NAME" data-keyboard-placeholder="YOUR PILOT NAME"><p id="pilotIdentityHelp">1–${PILOT_NAME_MAX} visible characters. Letters, numbers, spaces, hyphens and underscores. Saved on this device.</p><p id="pilotNameError" role="status" aria-live="polite"></p><p id="pilotIdentityScope" class="pilotIdentityScope"></p><button type="submit" id="pilotNameConfirm" class="pilotPrimary">CONFIRM CAPTAIN <span aria-hidden="true">→</span></button></form></div>`;
    document.body.append(this.dialog);
    this.field = this.dialog.querySelector('#pilotNameInput');
    this.preview = this.dialog.querySelector('#pilotNamePreview');
    this.error = this.dialog.querySelector('#pilotNameError');
    this.field.addEventListener('input', () => this.paintPreview());
    this.dialog.querySelector('form').addEventListener('submit', event => { event.preventDefault(); this.confirm(); });
    this.dialog.querySelector('#pilotNameClose').addEventListener('click', () => this.close());
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    // Capture at the window before the lab/global gameplay handlers. Leave
    // native text editing, IME composition, touch keyboard and Tab untouched.
    this._keyDown = event => {
      if (!this.dialog.open) return;
      if (game.controllerMenus?.keyboard.open) return;
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      else if (event.key === 'Enter' && event.target === this.field && !event.isComposing) { event.preventDefault(); this.confirm(); }
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', this._keyDown, true);
    window.addEventListener('keyup', event => { if (this.dialog.open) event.stopImmediatePropagation(); }, true);

    hangar.setPilotIdentity({ name: Save.data.pilotName, onEdit: () => this.open() });
    this.paintSavedName();
  }

  isTesting() { return Boolean(this.game.testing?.active || this.game.testRun); }
  currentName() { return safePilotName(this.isTesting() ? this.sessionName ?? Save.data.pilotName : Save.data.pilotName); }

  requestLaunch(onConfirm) {
    if (Save.data.pilotNameConfirmed) { Input.blockMenuCarryover(); onConfirm(); }
    else this.open({ onConfirm });
  }

  open({ onConfirm } = {}) {
    if (this.dialog.open) return;
    this.pendingLaunch = onConfirm || null;
    this.returnFocus = document.activeElement;
    this.ownedPause = this.game.running && !this.game.paused && !this.game.testing?.panelOpen;
    if (this.ownedPause) this.game.togglePause();
    this.inputWasEnabled = Input.enabled;
    Input.enabled = false;
    Input.reset();
    this.field.value = this.currentName();
    this.dialog.querySelector('#pilotIdentityScope').textContent = this.isTesting()
      ? 'TEST LAB / Identity changes apply to this test session only.'
      : 'Your past scores stay exactly as earned. New names apply to your next run.';
    const shipId = this.isTesting() ? this.game.player.shipId : this.hangar.selectedId;
    const image = this.dialog.querySelector('.pilotShipPreview img');
    image.hidden = !this.hangar.thumbnails.get(shipId);
    if (!image.hidden) image.src = this.hangar.thumbnails.get(shipId);
    this.dialog.querySelector('#pilotPreviewHull').textContent = PLAYER_SHIPS.find(ship => ship.id === shipId)?.name || '';
    this.paintPreview();
    this.dialog.showModal();
    this.field.focus({ preventScroll: true });
    this.field.select();
    Input.blockMenuCarryover();
  }

  paintPreview() {
    const result = validatePilotName(this.field.value);
    // Invalid strings are never placed in the nameplate, even as markup text.
    this.preview.textContent = result.valid ? result.name : PILOT_NAME_DEFAULT;
    this.error.textContent = result.error;
    this.field.setAttribute('aria-invalid', String(!result.valid));
    return result;
  }

  confirm() {
    const result = this.paintPreview();
    if (!result.valid) { this.field.focus(); return false; }
    if (this.isTesting()) {
      this.sessionName = result.name;
      this.game.runPilotName = result.name;
    } else {
      Save.data.pilotName = result.name;
      Save.data.pilotNameConfirmed = true;
      Save.save();
    }
    if (this.game.running) this.paintHudName(result.name);
    this.paintSavedName();
    const launch = this.pendingLaunch;
    this.close();
    if (launch) launch();
    return true;
  }

  close() {
    if (!this.dialog.open) return;
    this.dialog.close();
    this.pendingLaunch = null;
    if (this.ownedPause && this.game.running && this.game.paused) this.game.togglePause();
    else Input.enabled = Boolean(this.inputWasEnabled && this.game.running && !this.game.paused && !this.game.testing?.panelOpen);
    this.ownedPause = false;
    Input.reset();
    Input.blockMenuCarryover();
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
  }

  paintSavedName() {
    this.entry.querySelector('strong').textContent = safePilotName(Save.data.pilotName);
    this.hangar.setPilotIdentity({ name: this.currentName() });
  }

  snapshotRun({ testing = false } = {}) {
    if (!testing) this.sessionName = null;
    const name = safePilotName(testing ? this.sessionName ?? Save.data.pilotName : Save.data.pilotName);
    this.paintHudName(name);
    return name;
  }

  resetSession() {
    this.close();
    this.sessionName = null;
    this.paintHudName(Save.data.pilotName);
    this.paintSavedName();
  }

  paintHudName(name) { this.hudName.textContent = safePilotName(name); }
}
