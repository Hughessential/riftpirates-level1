import { P } from '../core/Palette.js';
import { $, clamp } from '../core/Utils.js';
import { weaponPowerSignature, primaryWeaponOutput } from '../config/weapons.js';

// Reassigning textContent recreates text nodes even when the displayed value
// has not changed. Most HUD values are stable across many 20 Hz updates.
function writeText(element, value) {
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

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
      shieldStatus: $('shieldStatus'),
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
    this.arsenal = document.createElement('aside');
    this.arsenal.id = 'arsenalReadout';
    this.arsenal.innerHTML = '<small>REACTOR / TIER 0</small><strong>PULSE</strong><span class="arsenalStats"></span><span class="arsenalMods"></span>';
    this.el.hud.append(this.arsenal);
    this.arsenalFields = {
      tier: this.arsenal.querySelector('small'),
      label: this.arsenal.querySelector('strong'),
      stats: this.arsenal.querySelector('.arsenalStats'),
      mods: this.arsenal.querySelector('.arsenalMods'),
    };
    this.augmentFlash = 0;
  }

  flashAugment(augment) {
    this.augmentFlash = 2.6;
    this.arsenal.style.setProperty('--installed', augment.color);
    this.arsenal.classList.add('installed');
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
    this.clearApproach();
    this.el.objBar.classList.add('hidden');
    this.el.objective.textContent = '';
    this.el.pips.innerHTML = '';
    this.setObjectiveWarning(false);
    this.setBossPhase(0, '');
  }

  setApproach(name, color, checkpoints) {
    $('approachPanel').classList.remove('hidden');
    $('approachPanel').style.setProperty('--route', color);
    $('approachTitle').textContent = name;
    $('approachStops').replaceChildren(...checkpoints.map((progress, i) => {
      const marker = document.createElement('i');
      marker.style.left = `${progress * 100}%`;
      marker.title = `Augment ${i + 1}`;
      return marker;
    }));
    this._updateApproach();
  }

  clearApproach() {
    $('approachPanel').classList.add('hidden');
    $('approachBounty').classList.add('hidden');
  }

  _updateApproach() {
    const d = this.game.director?.data;
    if (!d?.cfg || $('approachPanel').classList.contains('hidden')) return;
    const t = this.game.director.stateT;
    $('approachFill').style.width = `${clamp(t / d.cfg.duration, 0, 1) * 100}%`;
    writeText($('approachCount'), `${d.picks} / 3 AUGMENTS`);
    [...$('approachStops').children].forEach((marker, i) => marker.classList.toggle('installed', i < d.picks));
    const beat = d.cfg.authored?.beats[d.beatIndex];
    writeText($('approachBeat'), d.awaitingAugment ? 'AUGMENT CACHE SECURED' : beat?.title || 'PUSH THROUGH THE DEFENSES');
    writeText($('approachHint'), d.awaitingAugment ? 'Choose a power — combat is paused' : beat?.detail || (d.picks < 3
      ? `Next augment in ${Math.max(0, Math.ceil(d.cfg.augmentAt[d.picks] - t))}s · survive and collect scrap`
      : 'All three augments installed · objective ahead'));
    const bounty = $('approachBounty');
    bounty.classList.toggle('hidden', !d.bounty);
    if (d.bounty) writeText(bounty, d.bountyResolved ? '★ BLOCKADE BOUNTY CLAIMED' : `BOUNTY: BLOCKADE ACE · ${Math.ceil(d.bounty.healthPct * 100)}% HULL`);
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

    this._updateApproach();

    const p = g.player;
    const s = p.stats;

    // health + shield + level badge
    const hpPct = clamp(p.health / s.maxHealth, 0, 1) * 100;
    this.el.hp.style.width = `${hpPct}%`;
    writeText(this.el.hpText, `${Math.ceil(p.health)}/${Math.round(s.maxHealth)}`);
    this.el.hp.classList.toggle('low', hpPct < 30);

    if (s.shieldMax > 0) {
      this.el.shield.style.width = `${clamp(p.shield / s.shieldMax, 0, 1) * 100}%`;
      this.el.shield.parentElement.classList.remove('hidden');
      const recovering = p.shield < s.shieldMax;
      const delay = p.shieldRecoveryRemaining || 0;
      writeText(this.el.shieldStatus, p.shieldBroken
        ? `SHIELD BROKEN / ${delay.toFixed(1)}S`
        : recovering && delay > 0 ? `SHIELD RECOVERY / ${delay.toFixed(1)}S`
        : recovering ? 'SHIELD RECHARGING'
        : `SHIELD ${Math.ceil(p.shield)} / ${Math.round(s.shieldMax)}`);
      this.el.shieldStatus.classList.toggle('broken', p.shieldBroken);
    } else {
      this.el.shield.parentElement.classList.add('hidden');
    }

    writeText(this.el.level, g.xp.level);
    this.el.levelRing.style.background = `conic-gradient(${P.gold} ${g.xp.progress * 360}deg, rgba(255,255,255,.08) 0deg)`;

    // boost
    this.el.boost.style.width = `${clamp(p.boost / s.boostCapacity, 0, 1) * 100}%`;
    this.el.boost.classList.toggle('spent', p.boost < 15);

    // rift heat
    const heat = g.heat;
    this.el.heat.style.width = `${heat.heat * 100}%`;
    writeText(this.el.heatTier, heat.tier);
    writeText(this.el.mult, `x${heat.multiplier.toFixed(1)}`);
    writeText(this.el.combo, heat.combo > 0 ? `COMBO ${heat.combo}` : '');

    // the meter gets more violent as it climbs
    const t = heat.heat;
    this.el.heat.style.background = `linear-gradient(90deg, ${P.cyan}, ${P.violet} ${35 + t * 20}%, ${P.magenta} ${70 + t * 15}%, ${P.gold})`;
    this.el.heatTier.style.color = t > 0.62 ? P.gold : t > 0.35 ? P.magenta : P.cyan;
    this.el.heatGlow.style.opacity = String(Math.max(0, (t - 0.45) * 1.1));

    // score + scrap
    writeText(this.el.scrap, g.scrap.total.toLocaleString());
    writeText(this.el.score, g.score.total.toLocaleString());

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

    if (g.escape.active) {
      const escape = g.escape.snapshot();
      const seconds = Math.max(0, Math.ceil(escape.remaining));
      writeText(this.el.timerLabel, `COLLAPSE IN ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
      this.updateTimer(escape.remaining);
      this.el.objFill.style.width = `${escape.progress * 100}%`;
      writeText(this.el.objSub, `${escape.phase} ${escape.intensity.tier}/5 / ${Math.ceil(escape.distanceLeft)}m / ${escape.armada?.alive || 0} HOSTILES`);
      this.setObjectiveWarning(escape.remaining < 25);
    }

    const signature = weaponPowerSignature(s, { heatMultiplier: g.heat.multiplier,
      shield: p.shield, treasureCharge: p.treasureCharge });
    this.arsenal.style.setProperty('--reactor', signature.color);
    writeText(this.arsenalFields.tier, `REACTOR / TIER ${signature.tier} / ${g.upgrades.taken.length} AUGMENTS`);
    writeText(this.arsenalFields.label, signature.label);
    const output = primaryWeaponOutput(s, { fireRate: p.fireRate, critBuffT: p.critBuffT,
      heatMultiplier: g.heat.multiplier, shield: p.shield, treasureCharge: p.treasureCharge,
      weakPoint: !!p.reticleLock && !!g.targeting?.current && g.targeting.current.kind !== 'enemy' });
    writeText(this.arsenalFields.stats, `${Number(output.damage.toFixed(1))} SHOT · ${Number(output.fireRate.toFixed(1))}/SEC · ${Math.round(s.damageReduction * 100)}% ARMOR`);
    const guns = Object.keys(signature.weaponRanks).filter(kind => signature.weaponRanks[kind] > 0);
    const systems = guns.length ? `${guns.length} SYSTEMS` : 'PRIMARY';
    writeText(this.arsenalFields.mods, signature.modifiers.length
      ? `${systems} / ${signature.modifiers.slice(0, 3).map(mod => `${mod.label} ×${mod.rank}`).join(' / ')}`
      : `${systems} ONLINE`);
    this.augmentFlash = Math.max(0, this.augmentFlash - .05);
    this.arsenal.classList.toggle('installed', this.augmentFlash > 0);

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
    this.augmentFlash = 0;
    this.arsenal.classList.remove('installed');
    this.clearObjective();
    this.stopTimer();
    this.el.toasts.innerHTML = '';
    this.el.banner.classList.remove('show');
    this.el.heatGlow.style.opacity = '0';
  }
}
