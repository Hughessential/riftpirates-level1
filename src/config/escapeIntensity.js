/** Shared pressure curve for the playable fleet and the collapse spectacle. */
const THRESHOLDS = [0, .20, .43, .68, .86];
const NAMES = ['ARMADA IN PURSUIT', 'FLEET COLLISION', 'STELLAR RUPTURE', 'GALACTIC EXTINCTION', 'EVENT HORIZON'];
const clamp01 = n => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

export function escapeIntensity(progress = 0, elapsed = 0) {
  // A slow pilot cannot hold the opening pressure forever. This is a fixed
  // timeline, never adaptive scaling based on the player's earned build.
  const intensity = Math.max(clamp01(progress), clamp01(elapsed / 135) * .94);
  let index = 0;
  while (index < THRESHOLDS.length - 1 && intensity >= THRESHOLDS[index + 1]) index++;
  return {
    index, level: index, tier: index + 1, name: NAMES[index], progress: clamp01(progress), intensity,
    capacity: [12, 18, 26, 34, 40][index], waveSize: [4, 5, 7, 8, 10][index],
    spawnInterval: 2.7 - intensity * 1.25,
    shooters: [3, 4, 5, 6, 8][index], volleyInterval: 1.7 - intensity * .68,
    projectileLimit: [130, 180, 230, 290, 350][index],
    damageScale: .66 + intensity * .24,
    // Effects may use the same smooth curve without allocating per-tier pools.
    explosionRate: 1.1 + intensity * 5.5,
    debrisDensity: .3 + intensity * .7,
    backgroundShips: Math.round(28 + intensity * 132),
  };
}
