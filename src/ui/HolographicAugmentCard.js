import './holographic-augment-card.css';

const TIERS = {
  STANDARD: { key: 'standard', label: 'STANDARD', signal: 'STABLE SIGNAL', particles: 8 },
  RARE: { key: 'rare', label: 'RARE', signal: 'CRYSTAL RESONANCE', particles: 8 },
  'ULTRA-RARE': { key: 'ultra-rare', label: 'ULTRA-RARE', signal: 'FORBIDDEN FREQUENCY', particles: 10 },
  MYTHIC: { key: 'mythic', label: 'MYTHIC', signal: 'REALITY UNDER PRESSURE', particles: 14 },
};
const ART = new Set(['arsenal', 'survival', 'mobility', 'salvage', 'anomaly']);
const text = (parent, selector, value) => { parent.querySelector(selector).textContent = value; };
const scrap = value => Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('en-US');

/** Presentation metadata only. Existing unclassified augments remain STANDARD;
 * this component never changes rarity odds, prices, offers or combat strength. */
export function augmentCardTier(rarity) {
  const key = String(rarity || 'STANDARD').toUpperCase().replace(/[ _]+/g, '-');
  return TIERS[key] || TIERS.STANDARD;
}

/** Reusable native button; consumers own selection and installation semantics. */
export function createHolographicAugmentCard(up, { index = 0, delta = '', onSelect } = {}) {
  const tier = augmentCardTier(up.rarity);
  const category = String(up.category || 'ANOMALY').toLowerCase();
  const art = ART.has(category) ? category : 'anomaly';
  const rank = Math.max(1, Number(up.rank) || 1);
  const current = Math.max(0, Number(up.currentRank) || 0);
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'upCard holoCard';
  card.dataset.rarity = tier.key;
  card.dataset.augmentId = up.id || '';
  card.style.setProperty('--holo-index', index);
  card.dataset.description = `${up.name}. ${tier.label}. ${current ? `Rank ${current} to ${rank}` : `Install rank ${rank}`}. ${up.desc}. ${up.stack || ''}. ${delta}`;
  card.setAttribute('aria-label', card.dataset.description);
  // Only decoration is HTML. User-facing metadata is assigned as live text.
  card.innerHTML = `
    <span class="holoFrame" aria-hidden="true"></span>
    <span class="holoTop"><span class="upKey"></span><span class="holoRarity"></span><span class="holoSerial"></span></span>
    <span class="holoVisual" aria-hidden="true">
      <img class="holoIllustration" alt="" width="640" height="400" decoding="async">
      <span class="holoDistortion"></span><span class="holoPrism"></span>
      <span class="holoHalo"></span><span class="holoCrown"></span>
      <svg class="holoLightning" viewBox="0 0 320 210" fill="none" preserveAspectRatio="none">
        <path d="M34 0 53 28 35 51 68 72 45 95 78 124 60 159 91 210"/>
        <path d="m284 0-24 29 18 24-41 27 26 25-39 29 18 31-38 45"/>
        <path d="m0 150 37-12 14 13 40-17 24 8 28-9 30 22 31-19 27 8 27-16 62 14"/>
      </svg>
      <span class="holoDust"></span><span class="holoSigil">◇ / ◈ / ◇</span>
      <span class="holoSignal"></span><span class="holoSeal">◇</span>
    </span>
    <span class="holoBody">
      <span class="upCategory"></span><h3></h3>
      <span class="holoRule" aria-hidden="true"></span>
      <p class="holoDescription"></p>
      <p class="upStackEffect"></p>
      <span class="holoTelemetry"><span>SHIP MODIFICATION</span><b class="holoRank"></b></span>
      <p class="upActualDelta"></p>
      <span class="holoEconomy"><span><small>PRICE / SCRAP</small><b class="holoPrice"></b></span><span><small class="holoMoneyLabel"></small><b class="holoBalance"></b></span></span>
      <span class="upTake"><span class="holoAction"></span><b aria-hidden="true">↗</b></span>
    </span>`;
  const image = card.querySelector('img');
  image.src = `${import.meta.env?.BASE_URL || './'}augments/${art}.webp`;
  image.addEventListener('error', () => { image.hidden = true; card.classList.add('artUnavailable'); }, { once: true });
  text(card, '.upKey', String(index + 1).padStart(2, '0'));
  text(card, '.holoRarity', tier.label);
  text(card, '.holoSerial', `RP / ${String(index + 1).padStart(2, '0')}`);
  text(card, '.holoSignal', tier.signal);
  text(card, '.upCategory', `${up.category || 'ANOMALY'} / STACKABLE`);
  text(card, 'h3', up.name || 'UNKNOWN ARTIFACT');
  text(card, '.holoDescription', up.desc || '');
  text(card, '.upStackEffect', up.stack || '');
  text(card, '.holoRank', current ? `${current} → ${rank}` : `RANK ${rank}`);
  text(card, '.upActualDelta', delta);
  text(card, '.holoAction', current ? `STACK ${current} → ${rank}` : 'INSTALL AUGMENT');
  if (Number.isFinite(up.price)) {
    card.dataset.price = up.price;
    updateHolographicAugmentCardWallet(card, up.walletBalance || 0);
  } else card.querySelector('.holoEconomy').hidden = true;
  const dust = card.querySelector('.holoDust');
  for (let i = 0; i < tier.particles; i++) {
    const voxel = document.createElement('i');
    voxel.style.setProperty('--x', `${(i * 37 + 9) % 96}%`);
    voxel.style.setProperty('--y', `${(i * 23 + 13) % 88}%`);
    voxel.style.setProperty('--delay', `${-i * .63}s`);
    voxel.style.setProperty('--size', `${i % 3 + 2}px`);
    dust.append(voxel);
  }
  if (onSelect) card.addEventListener('click', () => onSelect(up.id, card));
  return card;
}

/** Wallet presentation only; purchases still go through UpgradeSystem's guarded transaction. */
export function updateHolographicAugmentCardWallet(card, balance) {
  if (card.dataset.price == null) return;
  const price = Number(card.dataset.price);
  const wallet = Math.max(0, Math.floor(Number(balance) || 0));
  const missing = Math.max(0, price - wallet);
  card.dataset.affordable = String(missing === 0);
  card.dataset.wallet = wallet;
  card.setAttribute('aria-disabled', String(missing > 0));
  text(card, '.holoPrice', scrap(price));
  text(card, '.holoMoneyLabel', missing ? 'MISSING / SCRAP' : 'REMAINING / SCRAP');
  text(card, '.holoBalance', scrap(missing || wallet - price));
  text(card, '.holoAction', missing ? 'SAVE FOR THIS AUGMENT' : 'PURCHASE & INSTALL');
  card.setAttribute('aria-label', `${card.dataset.description}. Price ${scrap(price)} scrap. Wallet ${scrap(wallet)}. ${missing ? `Missing ${scrap(missing)} scrap. Cannot purchase yet` : `${scrap(wallet - price)} scrap remaining after purchase`}.`);
}

export function activateHolographicAugmentCard(card) {
  card.classList.add('installing');
  text(card, '.holoAction', 'SEAL BREACHED');
}
