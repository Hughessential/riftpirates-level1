import { $ } from '../core/Utils.js';
import { Audio2 } from '../core/AudioManager.js';
import { augmentDelta } from './AugmentFeedback.js';
import { Input } from '../core/Input.js';
import { createHolographicAugmentCard, activateHolographicAugmentCard, updateHolographicAugmentCardWallet } from './HolographicAugmentCard.js';

/**
 * Three stable purchase offers. Combat is paused underneath. All input methods
 * use the same guarded purchase/skip transactions owned by UpgradeSystem.
 */
export class UpgradeScreen {
  constructor(game) {
    this.game = game;
    this.el = $('upgradeScreen');
    this.cards = $('upgradeCards');
    this.title = $('upgradeTitle');
    this.sub = $('upgradeSub');
    this.wallet = document.createElement('div');
    this.wallet.id = 'augmentWallet';
    this.wallet.innerHTML = '<span>AVAILABLE SCRAP</span><b>0</b><span class="augmentWalletGem" aria-hidden="true">◇</span>';
    this.sub.after(this.wallet);
    this.footer = document.createElement('div');
    this.footer.className = 'augmentShopFooter';
    this.footer.innerHTML = '<p id="augmentShopStatus" role="status" aria-live="polite"></p><button type="button" class="upSkip">SKIP & SAVE <span>[S]</span></button>';
    this.cards.after(this.footer);
    this.status = this.footer.querySelector('#augmentShopStatus');
    this.skipButton = this.footer.querySelector('.upSkip');
    this.skipButton.addEventListener('click', () => this._skip());
    this.skipButton.addEventListener('focus', () => { this.sel = this._offers.length; this._paintSel(); });
    this.skipButton.addEventListener('mouseenter', () => { this.sel = this._offers.length; this._paintSel(); });
    this.el.querySelector('.upHint').textContent = 'A / D OR ARROWS SELECT · HOLD SPACE / A TO INSTALL · S SKIP & SAVE';
    this.open = false;
    this.closing = false;
    this.sel = 0; // gamepad-highlighted card
    this.holdDuration = 600;
    this._holdStarted = 0;
    this._holdCard = null;
    this._holdLatch = false;
    this._generation = 0;
    this._onKey = this._onKey.bind(this);
    this.el.dataset.suspended = String(document.hidden);
    document.addEventListener('visibilitychange', () => {
      this.el.dataset.suspended = String(document.hidden);
      // Controller state is not guaranteed to emit a browser blur. Never let
      // an invisible tab accrue wall-clock hold progress toward a purchase.
      if (document.hidden) this.cancelHoldForPause();
    });
  }

  /** source is a legacy cache number or an approach {sector, checkpoint}. */
  show(source, color, onDone) {
    this.hide();
    const offers = this.game.upgrades.offer(source);
    if (offers.length !== 3) {
      this.game.upgrades.cancelOffer();
      return false;
    }
    this._offerToken = offers[0]?.offerToken;
    this.onDone = onDone;
    this.open = true;
    // A held brake/confirm or fire key must be released after the shop appears;
    // only a fresh hold may begin an installation.
    this._holdLatch = Input.purchaseConfirmHeld;

    const approach = typeof source === 'object' && source !== null;
    const sectorNames = ['OUTER DEFENSE', 'MIDRIFT', 'INNER CITADEL', 'INHIBITOR'];
    this.title.textContent = approach ? 'RIFT AUGMENT' : 'NEXUS AUGMENT';
    this.sub.textContent = approach
      ? `PURCHASE ONE OR SAVE · AUGMENT ${source.checkpoint + 1}/3 · ${sectorNames[source.sector] || 'RIFT APPROACH'}`
      : 'ONE FINAL PURCHASE BEFORE THE ADMIRAL';
    this.el.style.setProperty('--cache', color);

    this.cards.innerHTML = '';
    offers.forEach((up, i) => {
      const card = createHolographicAugmentCard(up, {
        index: i,
        delta: augmentDelta(up, this.game.upgrades.stats, up.rank),
        onSelect: () => this._pick(up.id, up.offerToken),
      });
      card.addEventListener('mouseenter', () => {
        Audio2.play('ui_move', 0.25, 1.1);
        // keep the pad cursor in sync so a follow-up A press takes this card
        this.sel = i;
        this._paintSel();
      });
      card.addEventListener('focus', () => { this.sel = i; this._paintSel(); });
      // Native buttons activate on Enter/Space. Keyboard/card purchases use
      // the explicit hold gesture instead; pointer and touch clicks stay fast.
      card.addEventListener('keydown', event => {
        if (event.code === 'Space' || event.code === 'Enter') event.preventDefault();
      });
      this.cards.appendChild(card);
    });

    this.el.classList.remove('hidden');
    // let the cards animate in before they can be clicked
    const generation = this._generation;
    this._animateIn = requestAnimationFrame(() => {
      if (generation === this._generation && this.open) this.el.classList.add('in');
      this._animateIn = null;
    });
    addEventListener('keydown', this._onKey);
    Audio2.play('ui_select', 0.5, 0.9);

    this._offers = offers;
    this._lastWallet = null;
    this.status.textContent = 'ONE PURCHASE. EVERY STACK MAKES YOUR SHIP STRONGER.';
    this._refreshWallet();
    this.sel = 0;
    this._paintSel();
    return true;
  }

  /** Gamepad navigation — called once per frame by Game.update. */
  update() {
    if (!this.open || !this._offers?.length) {
      this._cancelHold(); return;
    }
    if (this.game.paused) {
      this.cancelHoldForPause(); return;
    }
    this._refreshWallet();
    this._updateHold(Input.purchaseConfirmHeld);
    if (Input.menuRouting) return;
    const nav = Input.menuNav;
    const n = this._offers.length + 1;

    const dir = (nav.right || nav.down ? 1 : 0) - (nav.left || nav.up ? 1 : 0);
    if (dir) {
      this.sel = (this.sel + dir + n) % n;
      this._paintSel();
      Audio2.play('ui_move', 0.3, 1.1);
    }
    if (nav.confirm && this.sel === this._offers.length) this._skip();
  }

  _paintSel() {
    [...this.cards.children].forEach((c, i) => c.classList.toggle('sel', i === this.sel));
    this.skipButton.classList.toggle('sel', this.sel === this._offers.length);
  }

  _refreshWallet() {
    const balance = this.game.scrap.wallet.balance;
    if (balance === this._lastWallet) return;
    this._lastWallet = balance;
    this.wallet.querySelector('b').textContent = balance.toLocaleString('en-US');
    [...this.cards.children].forEach(card => updateHolographicAugmentCardWallet(card, balance));
  }

  _onKey(e) {
    if (!this.open || this.game.paused || e.repeat) return;
    if (e.code === 'KeyS') { e.preventDefault(); this._skip(); return; }
    if (e.code === 'Space' || e.code === 'Enter') {
      // Preserve native button activation for the separate Skip action. Cards
      // still suppress the synthetic click and use the explicit hold path.
      if (e.target !== this.skipButton) e.preventDefault();
      return;
    }
    const direction = ['KeyA', 'ArrowLeft'].includes(e.code) ? -1
      : ['KeyD', 'ArrowRight'].includes(e.code) ? 1 : 0;
    if (direction) {
      e.preventDefault();
      this._moveSelection(direction);
      return;
    }
    const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    if (i >= 0 && this._offers[i]) {
      e.preventDefault();
      this._select(i);
    }
  }

  _select(index) {
    const changed = index !== this.sel;
    // Changing focus by itself is not a hold cancellation: number keys and
    // A/D should let the player immediately begin holding Space. Only require
    // a release when the selection changes during an active hold gesture.
    if (changed) this._cancelHold(Boolean(this._holdCard || Input.purchaseConfirmHeld));
    this.sel = index;
    this._paintSel();
    const selected = index < this._offers.length ? this.cards.children[index] : this.skipButton;
    selected?.focus({ preventScroll: true });
    if (changed) Audio2.play('ui_move', 0.3, 1.1);
  }

  _moveSelection(direction) {
    const n = this._offers.length + 1;
    this._select((this.sel + direction + n) % n);
  }

  _updateHold(held, now = performance.now()) {
    if (!held) {
      this._holdLatch = false;
      this._cancelHold();
      return;
    }
    if (this._holdLatch || this.sel >= this._offers.length) return;
    const card = this.cards.children[this.sel];
    if (!card) return;
    if (card !== this._holdCard) {
      this._cancelHold();
      this._holdCard = card;
      this._holdStarted = now;
      card.classList.add('holding');
      card.style.setProperty('--hold-progress', '0');
      this.status.textContent = 'HOLD SPACE / A TO INSTALL · RELEASE TO CANCEL';
    }
    const progress = Math.min(1, (now - this._holdStarted) / this.holdDuration);
    card.style.setProperty('--hold-progress', progress.toFixed(3));
    if (progress < 1) return;
    const id = this._offers[this.sel]?.id;
    this._holdLatch = true;
    this._cancelHold();
    Input.blockMenuCarryover();
    Input.blockKeyboardFireUntilRelease();
    this._pick(id);
  }

  _cancelHold(requireRelease = false) {
    if (this._holdCard) {
      this._holdCard.classList.remove('holding');
      this._holdCard.style.removeProperty('--hold-progress');
    }
    this._holdCard = null;
    this._holdStarted = 0;
    if (requireRelease) this._holdLatch = true;
  }

  cancelHoldForPause() {
    // Game time stops while paused, and a held confirm must not resume the
    // installation. Release once, then begin a fresh full hold.
    this._cancelHold(Input.purchaseConfirmHeld);
  }

  _pick(id, offerToken = this._offerToken) {
    if (!this.open || this.game.paused || offerToken !== this._offerToken || !this._offers.some((up) => up.id === id)) return;
    const selected = this._offers.find((up) => up.id === id);
    const delta = augmentDelta(selected, this.game.upgrades.stats, selected.rank);
    if (!this.game.upgrades.pick(id, offerToken)) {
      this._refreshWallet();
      const missing = Math.max(0, selected.price - this.game.scrap.wallet.balance);
      this.status.textContent = missing ? `NEED ${missing.toLocaleString('en-US')} MORE SCRAP. KEEP PLUNDERING OR SKIP & SAVE.` : 'THIS OFFER IS NO LONGER AVAILABLE.';
      return;
    }
    this.wallet.querySelector('b').textContent = this.game.scrap.wallet.balance.toLocaleString('en-US');
    this.open = false;
    this.closing = true;
    const chosenCard = [...this.cards.children].find(card => card.dataset.augmentId === id);
    if (chosenCard) activateHolographicAugmentCard(chosenCard);
    this.el.classList.add('installing');
    this.status.textContent = `${selected.name} PURCHASED. INSTALLING FORBIDDEN TECH.`;
    removeEventListener('keydown', this._onKey);

    Audio2.play('upgrade', 0.9, 1);
    this.game.hud.toast(`${selected.name} / RANK ${selected.rank}`, delta, selected.color || '#FFC53D');
    this.game.hud.flashAugment(selected);
    const p = this.game.player;
    if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
      this.game.fx.explode(p.x, p.y, 0, { count: 22, colors: [selected.color, '#ffffff'],
        power: 9, gravity: 0, arcColor: selected.color, flashScale: .7, flashTime: .18 });

    // Keep the selected artifact visible for the existing scheduler-owned seal
    // breach. Installation/choice timing and duplicate-pick guards are unchanged.
    this._complete(0.26);
  }

  _skip() {
    if (!this.open || this.game.paused || !this.game.upgrades.skip(this._offerToken)) return;
    this._cancelHold(true);
    this.open = false;
    this.closing = true;
    removeEventListener('keydown', this._onKey);
    this.status.textContent = 'SCRAP SECURED. THE RAID CONTINUES.';
    Audio2.play('ui_select', 0.35, .85);
    this._complete(0);
  }

  _complete(delay) {
    const generation = this._generation;
    const done = this.onDone;
    this._dismiss = this.game.scheduler.after(delay, () => {
      if (generation !== this._generation) return;
      this._dismiss = null;
      this.closing = false;
      this.onDone = null;
      this.el.classList.add('hidden');
      if (done) done();
    }, 'upgrade-ui');
  }

  hide() {
    this._cancelHold();
    this._holdLatch = false;
    this._generation += 1;
    if (this._dismiss) this.game.scheduler.cancel(this._dismiss);
    if (this._animateIn != null) cancelAnimationFrame(this._animateIn);
    this._dismiss = null;
    this._animateIn = null;
    this.onDone = null;
    this.open = false;
    this.closing = false;
    this._offers = [];
    this._offerToken = null;
    this.game.upgrades.cancelOffer();
    removeEventListener('keydown', this._onKey);
    this.el.classList.add('hidden');
    this.el.classList.remove('in', 'installing');
  }
}
