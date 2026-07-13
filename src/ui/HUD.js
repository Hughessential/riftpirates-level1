import { P } from '../core/Palette.js';
import { $, clamp } from '../core/Utils.js';

/**
 * Persistent HUD (spec §42). The level badge is welded to the left end of the
 * health bar, League-style (Player notes) — it must stay legible at all times.
 */
export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'),
      hp: $('hpFill'),
      hpText: $('hpText'),
      shield: $('shieldFill'),
      level: $('levelBadge'),
      levelRing: $('levelRing'),
      boost: $('boostFill'),
      heat: $('heatFill'),
      heatTier: $('heatTier'),
      mult: $('multVal'),
      combo: $('comboVal'),
      scrap: $('scrapVal'),
      score: $('scoreVal'),
      objective: $('objectiveName'),
      objBar: $('objBar'),
      objFill: $('objFill'),
      objLabel: $('objLabel'),
      objSub: $('objSub'),
      pips: $('objPips'),
      banner: $('banner'),
      toasts: $('toasts'),
      timer: $('encTimer'),
      timerFill: $('encTimerFill'),
      timerLabel: $('encTimerLabel'),
      vignette: $('vignette'),
      heatGlow: $('heatGlow'),
    };
    this._timerMax = 0;
    this._timerOn = false;
    this._acc = 0;
    this._lowHealthT = 0;
  }

  show() {
    this.el.hud.classList.remove('hidden');
  }

  hide() {
    this.el.hud.classList.add('hidden');
  }

  // --- objective bar -------------------------------------------------------

  setObjective(name, sub, color) {
    this.el.objLabel.textContent = name;
    this.el.objSub.textContent = sub || '';
    this.el.objBar.classList.remove('hidden');
    this.el.objFill.style.background = `linear-gradient(90deg, ${color}, #fff)`;
    this.el.objFill.style.boxShadow = `0 0 14px ${color}`;
    this.el.objBar.style.setProperty('--obj', color);
    this.el.objective.textContent = name;
    this._objColor = color;
  }

  clearObjective() {
    this.el.objBar.classList.add('hidden');
    this.el.objective.textContent = '';
    this.el.pips.innerHTML = '';
    this.setObjectiveWarning(false);
    this.setBossPhase(0, '');
  }

  /** One pip per weak point, so the player can see what's left to break. */
  setWeakPoints(modules) {
    this.el.pips.innerHTML = '';
    this._pips = [];
    for (const [name, m] of modules) {
      const pip = document.createElement('i');
      pip.title = m.target.label;
      this.el.pips.appendChild(pip);
      this._pips.push({ el: pip, target: m.target });
    }
  }

  setObjectiveWarning(on) {
    this.el.objBar.classList.toggle('warn', !!on);
  }

  setBossPhase(n, name) {
    const el = $('bossPhase');
    if (!n) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.textContent = `PHASE ${n} — ${name}`;
  }

  // --- encounter timer (overload window / core exposed) --------------------

  startTimer(seconds, label) {
    this._timerMax = seconds;
    this._timerOn = true;
    this.el.timer.classList.remove('hidden');
    this.el.timerLabel.textContent = label;
  }

  updateTimer(remaining) {
    if (!this._timerOn) return;
    const k = clamp(remaining / this._timerMax, 0, 1);
    this.el.timerFill.style.width = `${k * 100}%`;
  }

  stopTimer() {
    this._timerOn = false;
    this.el.timer.classList.add('hidden');
  }

  // --- notifications -------------------------------------------------------

  banner(text, color = P.magenta) {
    const b = this.el.banner;
    b.textContent = text;
    // Boss taunts are whole sentences; objective names are two or three words.
    // Shrink the type to the text so a banner never wraps into the title card.
    b.style.fontSize =
      text.length > 30 ? 'clamp(13px,2.1vw,23px)'
      : text.length > 18 ? 'clamp(16px,2.9vw,30px)'
      : '';
    b.style.color = color;
    b.style.textShadow = `0 0 18px ${color}, 0 0 44px ${color}`;
    b.classList.remove('show');
    // restart the animation
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => b.classList.remove('show'), 1900);
  }

  toast(title, sub = '', color = P.gold) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.color = color;
    t.style.textShadow = `0 0 12px ${color}`;
    t.innerHTML = sub
      ? `<b>${title}</b><span>${sub}</span>`
      : `<b>${title}</b>`;
    this.el.toasts.appendChild(t);
    setTimeout(() => t.remove(), 1800);
    // never let toasts stack into a wall
    while (this.el.toasts.children.length > 4) {
      this.el.toasts.firstChild.remove();
    }
  }

  flashDodge() {
    const v = this.el.vignette;
    v.classList.add('dodge');
    setTimeout(() => v.classList.remove('dodge'), 260);
  }

  flashHurt() {
    const v = this.el.vignette;
    v.style.transition = 'none';
    v.style.opacity = '1';
    requestAnimationFrame(() => {
      v.style.transition = 'opacity .55s';
      v.style.opacity = '0';
    });
  }

  flashLevel() {
    this.el.level.classList.add('up');
    setTimeout(() => this.el.level.classList.remove('up'), 700);
  }

  // --- per-frame -----------------------------------------------------------

  update(dt) {
    const g = this.game;

    // throttle: the HUD does not need 60Hz text updates
    this._acc += dt;
    if (this._acc < 0.05) return;
    this._acc = 0;

    const p = g.player;
    const s = p.stats;

    // health + shield + level badge
    const hpPct = clamp(p.health / s.maxHealth, 0, 1) * 100;
    this.el.hp.style.width = `${hpPct}%`;
    this.el.hpText.textContent = `${Math.ceil(p.health)}/${Math.round(s.maxHealth)}`;
    this.el.hp.classList.toggle('low', hpPct < 30);

    if (s.shieldMax > 0) {
      this.el.shield.style.width = `${clamp(p.shield / s.shieldMax, 0, 1) * 100}%`;
      this.el.shield.parentElement.classList.remove('hidden');
    } else {
      this.el.shield.parentElement.classList.add('hidden');
    }

    this.el.level.textContent = g.xp.level;
    this.el.levelRing.style.background = `conic-gradient(${P.gold} ${g.xp.progress * 360}deg, rgba(255,255,255,.08) 0deg)`;

    // boost
    this.el.boost.style.width = `${clamp(p.boost / s.boostCapacity, 0, 1) * 100}%`;
    this.el.boost.classList.toggle('spent', p.boost < 15);

    // rift heat
    const heat = g.heat;
    this.el.heat.style.width = `${heat.heat * 100}%`;
    this.el.heatTier.textContent = heat.tier;
    this.el.mult.textContent = `x${heat.multiplier.toFixed(1)}`;
    this.el.combo.textContent = heat.combo > 0 ? `COMBO ${heat.combo}` : '';

    // the meter gets more violent as it climbs
    const t = heat.heat;
    this.el.heat.style.background = `linear-gradient(90deg, ${P.cyan}, ${P.violet} ${35 + t * 20}%, ${P.magenta} ${70 + t * 15}%, ${P.gold})`;
    this.el.heatTier.style.color = t > 0.62 ? P.gold : t > 0.35 ? P.magenta : P.cyan;
    this.el.heatGlow.style.opacity = String(Math.max(0, (t - 0.45) * 1.1));

    // score + scrap
    this.el.scrap.textContent = g.scrap.total.toLocaleString();
    this.el.score.textContent = g.score.total.toLocaleString();

    // objective health + weak-point pips
    const enc = g.encounter;
    if (enc && enc.state !== 'dead') {
      this.el.objFill.style.width = `${clamp(enc.healthPct, 0, 1) * 100}%`;
      if (this._pips) {
        for (const pip of this._pips) {
          pip.el.classList.toggle('dead', !pip.target.alive);
        }
      }
    }

    // low-health alarm
    if (hpPct < 25 && p.alive) {
      this._lowHealthT -= 0.05;
      if (this._lowHealthT <= 0) {
        this._lowHealthT = 1.6;
        g.audio.play('low_health', 0.3, 1);
      }
    }
  }

  reset() {
    this.clearObjective();
    this.stopTimer();
    this.el.toasts.innerHTML = '';
    this.el.banner.classList.remove('show');
    this.el.heatGlow.style.opacity = '0';
  }
}
