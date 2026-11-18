// Session-only Easter egg access, explicitly enabled by the owner.
// This discovery gate is not authenticated account authorization.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const LOCAL_ULTRA_ACCESS = import.meta.env?.DEV === true
  && LOCAL_HOSTS.has(globalThis.location?.hostname);
let brimbySignal = false;
export function enableUltraFromBrimbySignal() { brimbySignal = true; }
export function hasUltraUltimateAccess() { return LOCAL_ULTRA_ACCESS || brimbySignal; }

export const ULTRA_ULTIMATE_DEFAULTS = Object.freeze({
  // Toggle mode: unlimited active gameplay until a second fresh press of 2.
  cooldown: 60, hullLengths: 15, fieldRadius: 0, pulseInterval: .2,
  areaDps: 0, areaDpsMultiplier: 100, projectileMultiplier: 100,
  auraSize: 12, auraIntensity: 2.2, auraOpacity: .22, shimmer: 1.5,
  rainbowSpeed: .22, latticeDensity: 1, ribbonDensity: 1,
  majorCount: 7, minorCount: 20, coreWidth: .18, branching: .7,
  lightningReach: 24, lightningLifetime: .22, glowWidth: 1.65,
  glowIntensity: 3, gradientMix: .75, armorShine: 1.5, particles: 1,
  projectileTrails: 1, impactEffects: 1, bloom: .35, soundVolume: .82,
  reducedFlashing: 0, showRadius: 0,
});
export const ULTRA_ACTIVATION_AUDIO = 'ultra_transformation'; // dedicated owned SFX transport
export const ULTRA_TUNING_KEYS = Object.freeze(Object.fromEntries(
  Object.keys(ULTRA_ULTIMATE_DEFAULTS).filter(key => key !== 'hullLengths')
    .map(key => [key, `ultra${key[0].toUpperCase()}${key.slice(1)}`])
));
