import designs from './cosmic-augment-data.json' with { type: 'json' };

// The canonical handoff's starting values. Visual counts are capped separately
// from magnitude so a dense build remains powerful without growing draw calls.
export const cosmicRank = (stats, id) => Math.min(1e6, Math.max(0, Number(stats?.[id]) || 0));
export const cosmicAmplification = stats => {
  const rank = cosmicRank(stats, 'crownOfTheLastPirate');
  return rank ? 1 + Math.min(1.5, .3 + .1 * (rank - 1)) : 1;
};
export const COSMIC_AUGMENTS = Object.fromEntries(designs.map(a => [a.id, {
  name: a.name.toUpperCase(), rarity: a.rarity, category: a.category,
  color: a.rarity === 'RARE' ? '#28f1d4' : a.rarity === 'ULTRA-RARE' ? '#bd67ff' : '#e49aff',
  icon: a.rarity === 'MYTHIC' ? '♜' : a.rarity === 'ULTRA-RARE' ? '◈' : '◇',
  desc: a.card_text, stack: a.extra_rank_scaling, maxRank: Infinity,
  tunables: Object.freeze(a.parameters), trigger: a.trigger, guardrails: a.guardrails,
  apply() {},
}]));

// Call against freshly aggregated unamplified stats, never an already amplified
// result. Counts, cooldowns, saved currency and the crown itself are excluded.
export function amplifyAugmentStats(stats, base) {
  const factor = cosmicAmplification(stats);
  const out = { ...stats };
  if (factor === 1) return out;
  for (const key of ['damage','fireRate','projectileSpeed','moveSpeed','boostSpeed',
    'boostCapacity','boostRegen','maxHealth','healthRegen','shieldMax','shieldRegen',
    'scrapRadius','scrapMultiplier','criticalChance','criticalMultiplier','weakPointDamage']) {
    if (Number.isFinite(stats[key]) && Number.isFinite(base[key]))
      out[key] = Math.min(1e12, base[key] + (stats[key] - base[key]) * factor);
  }
  out.damageReduction = 1 - Math.pow(1 - Math.min(1 - 1e-12, Math.max(0, Number(stats.damageReduction) || 0)), factor);
  return out;
}

export function cosmicDescription(id, rank) {
  const a = COSMIC_AUGMENTS[id];
  if (!a) return null;
  const r = Math.max(1, cosmicRank({ r: rank }, 'r'));
  const n=(r,base,extra,cap=Infinity)=>r?Math.min(cap,base+(r-1)*extra):0;
  const fmt=(value)=>Number(value.toFixed(2)).toString();
  const pct=value=>`${Math.round(value*100)}%`;
  const metrics={
    blackwakeRounds:[['SHARDS',r=>n(r,6,2,18)],['SHOT',r=>n(r,.45,.05),pct]],
    riftstepSurge:[['BLINK',r=>n(r,5,.75,8)],['SLASH',r=>n(r,70,25)]],
    lootstormHalo:[['GEMS',r=>n(r,3,1,6)],['SHARD',r=>n(r,24,8)]],
    emperorsPressure:[['RADIUS',r=>n(r,10,2,100)],['STUN',r=>n(r,.8,.2,1.6),v=>`${fmt(v)}s`]],
    phantomBroadside:[['ECHO',r=>n(r,.35,.15),pct]],
    voltageCrown:[['ARCS',r=>n(r,3,1,8)],['HIT',r=>n(r,.35,.05),pct]],
    nebulaSkin:[['MOVING REGEN',r=>r?n(r,1.6,.3):1,v=>`${fmt(v)}×`]],
    dreadwakeEngine:[['SPEED',r=>n(r,.3,.1),pct],['WAKE DPS',r=>n(r,25,10)]],
    predatorsGaze:[['CRIT',r=>n(r,.25,.05,1),pct],['CRIT POWER',r=>n(r,.4,.15)]],
    scrapTyphoon:[['BLADES',r=>n(r,3,1,8)],['CONTACT',r=>n(r,24,8)]],
    conquerorsCircuit:[['WAVE',r=>n(r,180,70)],['RADIUS',r=>n(r,12,2,100)]],
    leviathanPulse:[['PULSE',r=>n(r,250,100)],['RADIUS',r=>n(r,18,2,100)]],
    starbreakerChoir:[['BEAM DPS',r=>n(r,300,130)]],
    riftSovereign:[['FIRE RATE',r=>n(r,1,.15),pct],['FIELD',r=>n(r,8,2),v=>`${fmt(v)}s`]],
    eclipseArsenal:[['BONUS VOLLEY',r=>n(r,180,70)]],
    throneOfThunder:[['STRIKE',r=>n(r,140,55)],['DURATION',r=>n(r,6,1,9),v=>`${fmt(v)}s`]],
    voidDominion:[['RADIUS',r=>n(r,7,1)],['SHOT RESIST',r=>n(r,.2,.05,.6),pct]],
    overlordsReflex:[['SLOW',r=>n(r,1.2,.2),v=>`${fmt(v)}s`],['PHASE',r=>n(r,.55,.12,1.5),v=>`${fmt(v)}s`]],
    diamondApocalypse:[['CRYSTALS',r=>n(r,3,1,7)],['BLAST',r=>n(r,120,60)]],
    blackFlagAscension:[['FIRE RATE',r=>n(r,.8,.15),pct],['LEECH',r=>n(r,.04,.01),pct]],
    emperorOfTheRift:[['RADIUS',r=>n(r,22,4,100)],['ELITE HIT',r=>n(r,500,180)]],
    godspeedMarauder:[['SPEED',r=>n(r,.6,.1),pct],['CLONES',r=>n(r,3,1,5)]],
    singularityPalace:[['FIELD DPS',r=>n(r,90,35)],['RADIUS',r=>n(r,8,1)]],
    celestialExecution:[['BLADE',r=>n(r,500,200)],['RADIUS',r=>n(r,5,1,100)]],
    kingsCataclysm:[['BLAST',r=>n(r,600,180)],['BOLTS',r=>n(r,12,4,24)]],
    infiniteArmada:[['FRIGATES',r=>n(r,2,1,5)],['CANNON',r=>n(r,50,25)]],
    endOfFear:[['WAVE',r=>n(r,550,180)],['PHASE',r=>n(r,2.5,.25,4),v=>`${fmt(v)}s`]],
    stormTyrantHalo:[['SPEARS',r=>n(r,3,1,8)],['STRIKE',r=>n(r,65,25)]],
    crownOfTheLastPirate:[['AMPLIFICATION',r=>n(r,.3,.1,1.5),pct]],
    absoluteOvercharge:[['DAMAGE',r=>r?n(r,2.5,.4):1,v=>`${fmt(v)}×`],['BURST',r=>n(r,6,.6,10),v=>`${fmt(v)}s`]],
  };
  return (metrics[id]||[]).map(([label,value,format=fmt])=>`${label} ${format(value(r-1))} → ${format(value(r))}`).join(' / ')
    || `RANK ${r-1} → ${r}`;
}
