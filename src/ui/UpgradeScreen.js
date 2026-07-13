import { $ } from '../core/Utils.js';
import { Audio2 } from '../core/AudioManager.js';

/**
 * The three-card upgrade cache (spec §11, §42). Combat is paused underneath.
 * Mouse click, touch, or keys 1/2/3 — the whole choice should take seconds.
 */
export class UpgradeScreen {
  constructor(game) {
    this.game = game;
    this.el = $('upgradeScreen');
    this.cards = $('upgradeCards');
    this.title = $('upgradeTitle');
    this.sub = $('upgradeSub');
    this.open = false;
    this._onKey = this._onKey.bind(this);
  }

  /** @param {number} cacheIndex @param {function} onDone */
  show(cacheIndex, color, onDone) {
    const offers = this.game.upgrades.offer(cacheIndex);
    this.onDone = onDone;
    this.open = true;

    this.title.textContent = 'UPGRADE CACHE';
    this.sub.textContent = `CHOOSE ONE — CACHE ${cacheIndex + 1} OF 5`;
    this.el.style.setProperty('--cache', color);

    this.cards.innerHTML = '';
    offers.forEach((up, i) => {
      const card = document.createElement('button');
      card.className = 'upCard';
      card.style.setProperty('--c', color);
      card.innerHTML = `
        <span class="upKey">${i + 1}</span>
        <span class="upIcon">${up.icon}</span>
        <h3>${up.name}</h3>
        <p>${up.desc}</p>
        <span class="upTake">TAKE</span>
      `;
      card.addEventListener('click', () => this._pick(up.id));
      card.addEventListener('mouseenter', () => Audio2.play('ui_move', 0.25, 1.1));
      this.cards.appendChild(card);
    });

    this.el.classList.remove('hidden');
    // let the cards animate in before they can be clicked
    requestAnimationFrame(() => this.el.classList.add('in'));
    addEventListener('keydown', this._onKey);
    Audio2.play('ui_select', 0.5, 0.9);

    this._offers = offers;
  }

  _onKey(e) {
    if (!this.open) return;
    const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    if (i >= 0 && this._offers[i]) this._pick(this._offers[i].id);
  }

  _pick(id) {
    if (!this.open) return;
    this.open = false;
    removeEventListener('keydown', this._onKey);

    this.game.upgrades.pick(id);
    Audio2.play('upgrade', 0.9, 1);
    this.game.hud.toast('UPGRADE ACQUIRED', this.game.upgrades.taken.slice(-1)[0].toUpperCase(), '#FFC53D');

    this.el.classList.remove('in');
    setTimeout(() => {
      this.el.classList.add('hidden');
      if (this.onDone) this.onDone();
    }, 260);
  }

  hide() {
    this.open = false;
    removeEventListener('keydown', this._onKey);
    this.el.classList.add('hidden');
    this.el.classList.remove('in');
  }
}
