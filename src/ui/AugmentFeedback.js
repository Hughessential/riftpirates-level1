const format = (value, percent = false) => percent
  ? `${Math.round(value * 100)}%` : Number(value.toFixed(1)).toString();

/** Show real deltas from the same apply function used by the upgrade system. */
export function augmentDelta(upgrade, stats, rank) {
  const cosmic = cosmicDescription(upgrade.id, rank);
  if (cosmic) return cosmic;
  let next, baseline = stats;
  if (stats.crownOfTheLastPirate > 0) {
    const ranks = Object.fromEntries(Object.keys(UPGRADES).map(id => [id, stats[id] || 0]));
    const noXP = buildAugmentStats(ranks);
    const level = Math.max(1, Math.min(18, 1 + Math.round((stats.maxHealth - noXP.maxHealth) / 8)));
    baseline = buildAugmentStats(ranks, level);
    next = buildAugmentStats({ ...ranks, [upgrade.id]: rank }, level);
  } else {
    next = { ...stats, [upgrade.id]: rank };
    upgrade.apply(next, rank);
  }
  const metrics = [
    ['damage', 'SHOT'], ['fireRate', 'RATE'], ['projectileSpeed', 'VELOCITY'],
    ['maxHealth', 'HULL'], ['shieldMax', 'SHIELD'], ['shieldRegen', 'RECHARGE'],
    ['damageReduction', 'ARMOR', true], ['freeBlocks', 'BLOCKS'],
    ['criticalChance', 'CRIT', true], ['criticalMultiplier', 'CRIT POWER'],
    ['weakPointDamage', 'CORE POWER'], ['moveSpeed', 'STEERING'],
    ['boostSpeed', 'BOOST'], ['boostCapacity', 'RESERVE'], ['boostRegen', 'THRUST RECOVERY'],
    ['healthRegen', 'REPAIR'], ['scrapRadius', 'MAGNET'], ['scrapMultiplier', 'LOOT'],
  ];
  // Chance beyond 100% adds no more guaranteed hits; critical damage still
  // scales, so show that benefit instead of advertising impossible odds.
  const value = (source, key) => key === 'criticalChance' ? Math.min(1, Math.max(0, source[key])) : source[key];
  const changes = metrics.filter(([key]) => Number.isFinite(next[key]) && value(next, key) !== value(baseline, key));
  return changes.slice(0, 2).map(([key, label, percent]) =>
    `${label} ${format(value(stats, key), percent)} → ${format(value(next, key), percent)}`).join(' / ')
    || `${stats[upgrade.id] || 0} → ${rank} EFFECT STACKS`;
}
import { cosmicDescription } from '../systems/CosmicAugments.js';
import { UPGRADES, buildAugmentStats } from '../systems/UpgradeSystem.js';
