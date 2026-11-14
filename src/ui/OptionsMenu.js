import { Audio2 } from '../core/AudioManager.js';
import { Input } from '../core/Input.js';
import './options-menu.css';

/** A native modal keeps title settings in the same keyboard and gamepad flow. */
export class OptionsMenu {
  constructor(game) {
    this.game = game;
    this.dialog = document.getElementById('optionsDialog');
    this.button = document.getElementById('optionsBtn');
    this.button.addEventListener('click', () => this.open());
    this.dialog.querySelectorAll('[data-options-close]').forEach(button => {
      button.addEventListener('click', () => this.close());
    });
    this.dialog.addEventListener('cancel', event => {
      event.preventDefault();
      this.close();
    });
    // Keep native range keys and button activation inside the modal. Keyup
    // reaches Input so a key held before opening cannot remain stuck.
    this.dialog.addEventListener('keydown', event => event.stopPropagation());
    this.button.addEventListener('keydown', event => {
      if (event.code === 'Space' || event.code === 'Enter') event.stopPropagation();
    });
  }

  open() {
    if (this.dialog.open || document.getElementById('titleScreen').classList.contains('hidden')) return;
    this.dialog.showModal();
    this.button.setAttribute('aria-expanded', 'true');
    document.getElementById('musicTgl').focus({ preventScroll: true });
    Input.blockMenuCarryover();
    Audio2.play('ui_select', .5, 1);
  }

  close({ restoreFocus = true } = {}) {
    if (!this.dialog.open) return;
    this.dialog.close();
    this.button.setAttribute('aria-expanded', 'false');
    Input.blockMenuCarryover();
    if (restoreFocus) {
      this.button.focus({ preventScroll: true });
      const menus = this.game.controllerMenus;
      if (menus?.active) {
        menus.root = menus.currentRoot();
        menus.focus(this.button);
      }
    }
  }
}
