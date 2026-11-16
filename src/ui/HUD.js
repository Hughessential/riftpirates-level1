import { P } from '../core/Palette.js';
import { $, clamp } from '../core/Utils.js';
import { weaponPowerSignature, primaryWeaponOutput } from '../config/weapons.js';

// Reassigning textContent recreates text nodes even when the displayed value
// has not changed. Most HUD values are stable across many 20 Hz updates.
function writeText(element, value) {
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

// Four seconds suits short combat notices; tutorial copy gets a full 7.5-second
// reading window. Explicit durations cannot undercut these accessibility floors.
export const HUD_NOTICE_DURATIONS = Object.freeze({ brief: 4, instruction: 7.5 });
const noticeOptions = (options, fallback = HUD_NOTICE_DURATIONS.brief) => {
  if (typeof options === 'number') options = { duration: options };
  const category = options?.category === 'instruction' ? 'instruction' : 'brief';
  const requested = Number(options?.duration);
  const minimum = category === 'instruction' ? HUD_NOTICE_DURATIONS.instruction : fallback;
  return { ...(options || {}), category,
    duration: Number.isFinite(requested) ? Math.max(minimum,requested) : minimum };
};

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
    this._toastItems = [];
    this._bannerLife = 0;
    this._pickupAmount = 0;
    this._pickupLife = 0;
    this.scrapPickupEl = document.createElement('output');
    this.scrapPickupEl.id = 'scrapPickup';
    this.scrapPickupEl.setAttribute('role','status');
    this.scrapPickupEl.setAttribute('aria-live','polite');
    this.scrapPickupEl.hidden = true;
    this.el.scrap.parentElement.appendChild(this.scrapPickupEl);
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
    this.blackArmor = document.createElement('div');
    this.blackArmor.id = 'blackArmorHud';
    this.blackArmor.className = 'barRow blackArmorRow ready';
    this.blackArmor.innerHTML = '<div class="bar thin" id="blackArmorBar"><div id="blackArmorFill"></div><span class="blackArmorReadout"><strong>BLACK ARMOR</strong><span>1 / READY</span></span></div>';
    this.el.boost.closest('.barRow').after(this.blackArmor);
    this.blackArmorLabel = this.blackArmor.querySelector('.blackArmorReadout span');
    this.blackArmorFill = this.blackArmor.querySelector('#blackArmorFill');
    this.ultraArmor = null;
    this.augmentFlash = 0;
  }

  _updateUltraArmor() {
    const ability = this.game.ultraUltimate;
    if (!ability?.authorized) {
      this.ultraArmor?.remove();
      this.ultraArmor = null;
      return;
    }
    if (!this.ultraArmor) {
      this.ultraArmor = document.createElement('div');
      this.ultraArmor.id = 'ultraUltimateHud';
      this.ultraArmor.className = 'barRow ultraUltimateRow';
      this.ultraArmor.innerHTML = '<div class="bar thin ultraUltimateBar"><div class="ultraUltimateFill"></div><span class="ultraUltimateReadout"><strong>BLACK ARMOR + GOD HAKI</strong><span>2 / READY</span></span></div>';
      this.blackArmor.after(this.ultraArmor);
      this.ultraArmorLabel = this.ultraArmor.querySelector('.ultraUltimateReadout span');
      this.ultraArmorFill = this.ultraArmor.querySelector('.ultraUltimateFill');
    }
    const cooling = !ability.active && ability.cooldown > 0;
    this.ultraArmor.classList.toggle('active', ability.active);
    this.ultraArmor.classList.toggle('cooldown', cooling);
    this.ultraArmor.classList.toggle('ready', !ability.active && !cooling);
    writeText(this.ultraArmorLabel, ability.active
      ? `ON ${Math.floor(ability.elapsed || 0)}S / 2 TO END`
      : cooling ? `${ability.cooldown.toFixed(1)}S / RECHARGING` : '2 / READY');
    this.ultraArmorFill.style.width = `${cooling
      ? (1 - clamp(ability.cooldown / Math.max(.001, ability.cooldownDuration), 0, 1)) * 100 : 100}%`;
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
    // Toasts and banners live outside #hud so results/title can show controller
    // notices. Clear run-owned messages when the HUD leaves flight.
    this.clearNotices();
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
    writeText($('approachCount'), `${d.picks} / 3 CACHES`);
    [...$('approachStops').children].forEach((marker, i) => marker.classList.toggle('installed', i < d.picks));
    const beat = d.cfg.authored?.beats[d.beatIndex];
    writeText($('approachBeat'), d.awaitingAugment ? 'AUGMENT CACHE SECURED' : beat?.title || 'PUSH THROUGH THE DEFENSES');
    writeText($('approachHint'), d.awaitingAugment ? 'Choose a power — combat is paused' : beat?.detail || (d.picks < 3
      ? `Next cache in ${Math.max(0, Math.ceil(d.cfg.augmentAt[d.picks] - t))}s · collect scrap to purchase`
      : 'All three caches cleared · objective ahead'));
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

  banner(text, color = P.magenta, options = {}) {
    const opts = noticeOptions(options);
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
    b.dataset.category = opts.category;
    this._bannerLife = opts.duration;
  }

  toast(title, sub = '', color = P.gold, options = {}) {
    const opts = noticeOptions(options);
    // There is only one instructional lane. A newer step replaces the prior
    // one predictably instead of building an unreadable wall.
    if (opts.category === 'instruction') {
      for (const item of this._toastItems.filter(item => item.category === 'instruction')) {
        clearTimeout(item.wallTimer);
        item.el.remove();
      }
      this._toastItems = this._toastItems.filter(item => item.category !== 'instruction');
    }
    const t = document.createElement('div');
    t.className = `toast ${opts.category}`;
    t.dataset.category = opts.category;
    t.style.setProperty('--toast-duration',`${opts.duration}s`);
    t.style.color = color;
    t.style.textShadow = `0 0 12px ${color}`;
    t.innerHTML = sub
      ? `<b>${title}</b><span>${sub}</span>`
      : `<b>${title}</b>`;
    this.el.toasts.appendChild(t);
    const item = { el:t,remaining:opts.duration,category:opts.category,wallTimer:null };
    this._toastItems.push(item);
    // The title/results attract loop intentionally does not update the HUD.
    // Any notice created there needs a bounded wall-time fallback; notices
    // created during flight remain simulation-time owned and pause-safe.
    if (!this.game.running) item.wallTimer = setTimeout(() => {
      item.el.remove();
      const index = this._toastItems.indexOf(item);
      if (index >= 0) this._toastItems.splice(index,1);
    },opts.duration*1000);
    // The top-center instructional lane replaces its own step above. Keep the
    // left comms rail to three separated cards so it cannot collide with the
    // encounter identity zone on shorter displays.
    while (this._toastItems.filter(item => item.category === 'brief').length > 3) {
      const oldestItem = this._toastItems.find(item => item.category === 'brief');
      const oldest = oldestItem?.el;
      if (!oldest) break;
      oldest.remove();
      clearTimeout(oldestItem.wallTimer);
      this._toastItems = this._toastItems.filter(item => item.el !== oldest);
    }
  }

  /** Combine a rapid shower into one exact, readable run-wallet increment. */
  scrapPickup(amount,{ balance = this.game.scrap?.wallet?.balance } = {}) {
    const gained = Math.max(0,Math.floor(Number(amount)||0));
    if (!gained) return;
    this._pickupAmount += gained;
    this._pickupLife = .9;
    writeText(this.scrapPickupEl,`+${this._pickupAmount.toLocaleString('en-US')} SCRAP`);
    this.scrapPickupEl.hidden = false;
    this.scrapPickupEl.classList.remove('pulse');
    void this.scrapPickupEl.offsetWidth;
    this.scrapPickupEl.classList.add('pulse');
    if (Number.isFinite(balance)) writeText(this.el.scrap,Math.max(0,Math.floor(balance)).toLocaleString('en-US'));
  }

  _updateNotices(dt) {
    const elapsed = Math.max(0,Number(dt)||0);
    if (this._bannerLife > 0) {
      this._bannerLife -= elapsed;
      if (this._bannerLife <= 0) this.el.banner.classList.remove('show');
    }
    for (const item of [...this._toastItems]) {
      item.remaining -= elapsed;
      if (item.remaining <= 0) {
        clearTimeout(item.wallTimer);
        item.el.remove();
        this._toastItems.splice(this._toastItems.indexOf(item),1);
      }
    }
    if (this._pickupLife > 0) {
      this._pickupLife -= elapsed;
      if (this._pickupLife <= 0) {
        this._pickupAmount = 0;
        this.scrapPickupEl.hidden = true;
        this.scrapPickupEl.classList.remove('pulse');
      }
    }
  }

  clearNotices() {
    for (const item of this._toastItems) clearTimeout(item.wallTimer);
    this.el.toasts.innerHTML = '';
    this._toastItems.length = 0;
    this.el.banner.classList.remove('show');
    this._bannerLife = 0;
    this._pickupAmount = this._pickupLife = 0;
    this.scrapPickupEl.hidden = true;
    this.scrapPickupEl.classList.remove('pulse');
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

    // Notifications use simulation time: pausing the game preserves tutorial
    // reading time and pickup feedback instead of consuming wall-clock time.
    this._updateNotices(dt);

    // throttle: the HUD does not need 60Hz text updates
    this._acc += dt;
    if (this._acc < 0.05) return;
    this._acc = 0;

    this._updateApproach();

    const p = g.player;
    const s = p.stats;

    // health + shield + level badge
    const hpMax = s.maxHealth * (g.testing?.getTuning('maxHealth') ?? 1);
    const shieldMax = s.shieldMax * (g.testing?.getTuning('shieldCapacity') ?? 1);
    const boostMax = s.boostCapacity * (g.testing?.getTuning('boostCapacity') ?? 1);
    const hpPct = clamp(p.health / hpMax, 0, 1) * 100;
    this.el.hp.style.width = `${hpPct}%`;
    writeText(this.el.hpText, `${Math.ceil(p.health)}/${Math.round(hpMax)}`);
    this.el.hp.classList.toggle('low', hpPct < 30);

    if (shieldMax > 0) {
      this.el.shield.style.width = `${clamp(p.shield / shieldMax, 0, 1) * 100}%`;
      this.el.shield.parentElement.classList.remove('hidden');
      const recovering = p.shield < shieldMax;
      const delay = p.shieldRecoveryRemaining || 0;
      this.el.shieldStatus.classList.toggle('hidden', !recovering);
      writeText(this.el.shieldStatus, p.shieldBroken
        ? `SHIELD BROKEN / ${delay.toFixed(1)}S`
        : recovering && delay > 0 ? `SHIELD RECOVERY / ${delay.toFixed(1)}S`
        : recovering ? 'SHIELD RECHARGING'
        : '');
      this.el.shieldStatus.classList.toggle('broken', p.shieldBroken);
    } else {
      this.el.shield.parentElement.classList.add('hidden');
      this.el.shieldStatus.classList.add('hidden');
    }

    writeText(this.el.level, g.xp.level);
    this.el.levelRing.style.background = `conic-gradient(${P.gold} ${g.xp.progress * 360}deg, rgba(255,255,255,.08) 0deg)`;

    // boost
    this.el.boost.style.width = `${clamp(p.boost / boostMax, 0, 1) * 100}%`;
    this.el.boost.classList.toggle('spent', p.boost < 15);
    this.el.boost.classList.toggle('braking', p.braking);

    // Black Armor uses a dedicated compact lane so the five-second state and
    // post-effect cooldown remain legible without competing with objectives.
    const armorActive = p.blackArmorActive;
    const armorCooling = !armorActive && p.blackArmorCooldown > 0;
    this.blackArmor.classList.toggle('active', armorActive);
    this.blackArmor.classList.toggle('cooldown', armorCooling);
    this.blackArmor.classList.toggle('ready', !armorActive && !armorCooling);
    if (armorActive) {
      writeText(this.blackArmorLabel, `${p.blackArmorTime.toFixed(1)}S / INVULNERABLE`);
      this.blackArmorFill.style.width = `${clamp(p.blackArmorTime / Math.max(.001, p.blackArmorDuration), 0, 1) * 100}%`;
    } else if (armorCooling) {
      writeText(this.blackArmorLabel, `${p.blackArmorCooldown.toFixed(1)}S / RECHARGING`);
      this.blackArmorFill.style.width = `${(1 - clamp(p.blackArmorCooldown / Math.max(.001, p.blackArmorCooldownDuration), 0, 1)) * 100}%`;
    } else {
      writeText(this.blackArmorLabel, '1 / READY');
      this.blackArmorFill.style.width = '100%';
    }

    this._updateUltraArmor();

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
    writeText(this.el.scrap, g.scrap.wallet.balance.toLocaleString());
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
    this.clearNotices();
    this.el.heatGlow.style.opacity = '0';
  }
}
