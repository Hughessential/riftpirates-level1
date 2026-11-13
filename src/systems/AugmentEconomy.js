export const AUGMENT_PRICES = Object.freeze({ STANDARD: 100, RARE: 250, 'ULTRA-RARE': 650, MYTHIC: 1600 });
export const RARITY_WEIGHTS = Object.freeze({ STANDARD: 60, RARE: 26, 'ULTRA-RARE': 11, MYTHIC: 3 });
export const augmentRarity = up => String(up?.rarity || 'STANDARD').toUpperCase().replace(/[ _]+/g, '-');

/** Integer prices depend only on tier and owned ranks, never the player's wallet. */
export function augmentPrice(up, ownedRank = 0) {
  const rank = Math.min(1e6, Math.max(0, Math.floor(Number(ownedRank) || 0)));
  return Math.ceil((AUGMENT_PRICES[augmentRarity(up)] || AUGMENT_PRICES.STANDARD) * (1 + .25 * rank) / 10) * 10;
}

export function weightedAugment(pool, definitions, random = Math.random) {
  const tiers = Object.entries(RARITY_WEIGHTS).map(([tier, weight]) => ({
    weight, ids: pool.filter(id => augmentRarity(definitions[id]) === tier),
  })).filter(tier => tier.ids.length);
  let roll = random() * tiers.reduce((sum, tier) => sum + tier.weight, 0);
  const chosen = tiers.find(tier => (roll -= tier.weight) < 0) || tiers.at(-1);
  return chosen?.ids[Math.min(chosen.ids.length - 1, Math.floor(random() * chosen.ids.length))];
}
