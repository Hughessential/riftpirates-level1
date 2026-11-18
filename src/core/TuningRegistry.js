import { clamp } from './Utils.js';
import { ULTRA_ULTIMATE_DEFAULTS, ULTRA_TUNING_KEYS } from '../config/abilities.js';

export const TUNING_VERSION = 2;

export const TUNING_CATEGORIES = Object.freeze([
  ['player', 'PLAYER & MOVEMENT', 'Ship feel, survivability, boost and dodge timing.'],
  ['combat', 'COMBAT & WEAPONS', 'Damage, cadence, projectiles and critical hits.'],
  ['enemy', 'ENEMIES & DIFFICULTY', 'Hostile durability, movement, attacks and aim.'],
  ['visual', 'VFX & GRAPHICS', 'Bloom, particles, trails, shake and render scale.'],
  ['ability', 'BLACK ARMOR', 'Transformation timing, armor finish, energy, lightning and activation audio.'],
  ['ultraGameplay', 'GAMEPLAY', 'Indefinite toggle, cooldown, damage range and overwhelming offensive power.'],
  ['ultraAura', 'AURA', 'Layered rainbow envelope, shimmer, lattice and flowing ribbons.'],
  ['ultraLightning', 'BLACK LIGHTNING', 'Opaque black bodies, branching fractures and luminous colored edges.'],
  ['ultraPresentation', 'PRESENTATION', 'Polished armor, particles, Void Beam trails, impact flashes and sound.'],
  ['gameplay', 'GAMEPLAY SYSTEMS', 'Rewards, score, XP, pickups and Rift Heat.'],
]);

const entry = (category, key, label, description, min, max, step, value = 1, unit = '×') =>
  Object.freeze({ category, key, label, description, min, max, step, default: value, unit });
const ultraEntry = (category, key, label, description, min, max, step, unit = '×') =>
  entry(category, ULTRA_TUNING_KEYS[key], label, description, min, max, step, ULTRA_ULTIMATE_DEFAULTS[key], unit);

/**
 * Every entry below is connected to a real runtime system. Values expressed as
 * multipliers keep authored production data as the single canonical baseline.
 */
export const TUNING_SCHEMA = Object.freeze([
  entry('player', 'moveSpeed', 'Move speed', 'Scales normal lateral flight speed.', .25, 3, .05),
  entry('player', 'handling', 'Handling response', 'How quickly velocity catches steering input.', .2, 3, .05),
  entry('player', 'brakeSpeed', 'Brake speed', 'Speed retained while cut-thrust braking is held.', .05, 1, .05, .45, 'ratio'),
  entry('player', 'boostSpeed', 'Boost speed', 'Scales boosted flight speed.', .25, 3, .05),
  entry('player', 'boostCapacity', 'Boost capacity', 'Scales the maximum engine reserve.', .25, 5, .05),
  entry('player', 'boostDrain', 'Boost drain', 'Scales reserve consumption while boosting.', 0, 3, .05),
  entry('player', 'boostRegen', 'Boost regeneration', 'Scales reserve recovery while not boosting.', 0, 5, .05),
  entry('player', 'maxHealth', 'Maximum hull', 'Scales maximum hull and current hull proportionally.', .1, 10, .1),
  entry('player', 'healthRegen', 'Hull regeneration', 'Scales passive hull repair rate.', 0, 8, .1),
  entry('player', 'shieldCapacity', 'Shield capacity', 'Scales maximum shield and current shield proportionally.', 0, 8, .1),
  entry('player', 'shieldRegen', 'Shield regeneration', 'Scales shield recovery rate.', 0, 8, .1),
  entry('player', 'damageTaken', 'Damage taken', 'Scales damage that reaches the player after defenses.', 0, 5, .05),
  entry('player', 'rollDuration', 'Roll duration', 'Scales barrel-roll animation and invulnerability time.', .25, 3, .05),
  entry('player', 'rollCooldown', 'Roll cooldown', 'Scales time between barrel rolls.', 0, 5, .05),
  entry('player', 'rollDistance', 'Roll distance', 'Scales the lateral roll dash.', .1, 4, .05),

  entry('combat', 'playerDamage', 'Player damage', 'Scales damage from the complete player arsenal.', .05, 20, .05),
  entry('combat', 'playerFireRate', 'Player fire rate', 'Scales primary weapon cadence.', .1, 8, .05),
  entry('combat', 'playerProjectileSpeed', 'Projectile speed', 'Scales all newly fired player projectiles.', .1, 6, .05),
  entry('combat', 'playerProjectileLife', 'Projectile lifetime', 'Scales lifetime of newly fired player projectiles.', .1, 5, .05),
  entry('combat', 'playerProjectileSize', 'Projectile hitbox size', 'Scales visual width and collision radius.', .1, 4, .05),
  entry('combat', 'criticalChance', 'Critical chance', 'Adds a flat critical-hit chance.', 0, 1, .01, 0, '+'),
  entry('combat', 'criticalDamage', 'Critical damage', 'Scales the final critical-hit multiplier.', .1, 8, .05),

  entry('enemy', 'enemyHealth', 'Enemy health', 'Scales maximum health of newly spawned enemies.', .05, 20, .05),
  entry('enemy', 'enemySpeed', 'Enemy movement', 'Scales hostile movement and repositioning.', 0, 5, .05),
  entry('enemy', 'enemyDamage', 'Enemy damage', 'Scales damage of newly fired hostile projectiles.', 0, 10, .05),
  entry('enemy', 'enemyFireRate', 'Enemy fire rate', 'Scales hostile attack cadence; higher fires faster.', .1, 8, .05),
  entry('enemy', 'enemyProjectileSpeed', 'Enemy projectile speed', 'Scales hostile projectile travel speed.', .1, 6, .05),
  entry('enemy', 'enemyAccuracy', 'Enemy accuracy', 'Scales predictive lead and aim error; 1 is authored aim.', 0, 2, .05),

  entry('visual', 'bloom', 'Bloom intensity', 'Scales the encounter-authored bloom value.', 0, 2.5, .05),
  entry('visual', 'particleCount', 'Particle count', 'Scales newly emitted chunks and sparks within fixed pools.', 0, 2, .05),
  entry('visual', 'particleSize', 'Particle size', 'Scales chunks, sparks and explosion flashes.', .1, 4, .05),
  entry('visual', 'particleSpeed', 'Particle velocity', 'Scales newly emitted explosion velocity.', 0, 4, .05),
  entry('visual', 'particleLifetime', 'Particle lifetime', 'Scales newly emitted particle lifetime.', .1, 5, .05),
  entry('visual', 'screenShake', 'Screen shake', 'Scales camera shake impulses.', 0, 4, .05),
  entry('visual', 'trailDensity', 'Engine trail density', 'Scales emission frequency of the voxel exhaust trail.', 0, 3, .05),
  entry('visual', 'renderScale', 'Render scale', 'Scales the adaptive renderer resolution while testing.', .5, 1.5, .05),

  entry('ability', 'blackArmorDuration', 'Ability duration', 'Seconds of complete Black Armor invulnerability.', .25, 30, .25, 5, 'sec'),
  entry('ability', 'blackArmorCooldown', 'Cooldown duration', 'Seconds after expiration before Black Armor is ready again.', 0, 120, 1, 20, 'sec'),
  entry('ability', 'blackArmorGlow', 'Purple glow intensity', 'Strength of the pulsing supernatural aura and ship light.', 0, 6, .1, 2.8, '×'),
  entry('ability', 'blackArmorBloom', 'Armor bloom intensity', 'Additional scene bloom while Black Armor is active.', 0, 1.5, .01, .42, '+'),
  entry('ability', 'blackArmorGloss', 'Armor glossiness', 'Polish of the obsidian coating; one is liquid-black glass.', 0, 1, .01, .94, 'ratio'),
  entry('ability', 'blackArmorSpecular', 'Specular intensity', 'Reflective clearcoat and highlight response.', 0, 3, .05, 1.45, '×'),
  entry('ability', 'blackArmorLightningFrequency', 'Lightning frequency', 'How often crawling arcs redraw and flicker.', 1, 60, 1, 18, 'Hz'),
  entry('ability', 'blackArmorArcCount', 'Lightning arc count', 'Simultaneous pooled red and blue branched arcs.', 0, 16, 1, 10, 'arcs'),
  entry('ability', 'blackArmorLightningLength', 'Lightning length', 'Reach of arcs across and outward from the hull.', .25, 2.5, .05, 1.05, '×'),
  entry('ability', 'blackArmorLightningThickness', 'Lightning thickness', 'Physical width of the energized arc segments.', .01, .18, .005, .055, 'm'),
  entry('ability', 'blackArmorLightningBrightness', 'Lightning brightness', 'HDR intensity of red and electric-blue arcs.', .1, 5, .05, 2.2, '×'),
  entry('ability', 'blackArmorRedBalance', 'Red / blue balance', 'Zero is all blue, 0.5 is balanced, one is all red.', 0, 1, .05, .5, 'red'),
  entry('ability', 'blackArmorParticles', 'Particle density', 'Density of activation debris and sustained electrical sparks.', 0, 3, .05, 1.25, '×'),
  entry('ability', 'blackArmorShimmer', 'Shimmer / glint intensity', 'Strength and frequency of armor sweeps and brilliant glints.', 0, 4, .05, 1.6, '×'),
  entry('ability', 'blackArmorSoundVolume', 'Activation sound volume', 'Black Armor charge cue level on the sound-effects bus.', 0, 1, .01, .82, 'gain'),

  ultraEntry('ultraGameplay', 'cooldown', 'Cooldown after toggle-off', 'Seconds of gameplay before another activation. Active duration is unlimited.', 0, 300, 1, 'sec'),
  ultraEntry('ultraGameplay', 'fieldRadius', 'Damage field radius', 'World-unit sphere radius. Zero uses 15 measured hull lengths, without exhaust or effects.', 0, 300, .5, 'm'),
  ultraEntry('ultraGameplay', 'pulseInterval', 'Damage pulse interval', 'Damage per pulse is area DPS times this interval; includes an immediate activation pulse.', .05, 2, .05, 'sec'),
  ultraEntry('ultraGameplay', 'areaDps', 'Area damage per second', 'Explicit DPS override. Zero derives damage from the pre-ultra primary weapon at activation.', 0, 1000000, 100, 'DPS'),
  ultraEntry('ultraGameplay', 'areaDpsMultiplier', 'Automatic area DPS multiplier', 'Scales primary-weapon DPS when the explicit area DPS override is zero.', 1, 1000, 1),
  ultraEntry('ultraGameplay', 'projectileMultiplier', 'Void Beam damage multiplier', 'Applied once to each normal upgrade-adjusted cannon shot. Firing cadence is preserved.', 1, 1000, 1),
  ultraEntry('ultraGameplay', 'showRadius', 'Damage-radius gizmo', 'A visible sphere shows the actual damage range in the test arena.', 0, 1, 1, 'on'),

  ultraEntry('ultraAura', 'auraSize', 'Rainbow envelope size', 'Radius of the layered visual envelope, independent from the actual damage range.', 4, 35, .5, 'm'),
  ultraEntry('ultraAura', 'auraIntensity', 'Rainbow light intensity', 'Radiance of the envelope, ribbons and iridescent filaments.', .2, 5, .1),
  ultraEntry('ultraAura', 'auraOpacity', 'Envelope opacity', 'Translucency of the rainbow envelope; lower values open more battlefield sightlines.', .02, .6, .01, 'ratio'),
  ultraEntry('ultraAura', 'shimmer', 'Sustained shimmer', 'Strength of traveling energy ripples and prismatic glints.', 0, 3, .05),
  ultraEntry('ultraAura', 'rainbowSpeed', 'Rainbow cycling speed', 'Speed of continuous color travel through the full rainbow palette.', 0, 1.5, .01),
  ultraEntry('ultraAura', 'latticeDensity', 'Lattice density', 'Fine faceted energy filaments within the bounded visual pool.', 0, 2, .1),
  ultraEntry('ultraAura', 'ribbonDensity', 'Ribbon density', 'Sweeping energy ribbons within the bounded visual pool.', 0, 2, .1),

  ultraEntry('ultraLightning', 'majorCount', 'Major black branches', 'Maximum signature discharge slots, with irregular gaps between flashes.', 0, 24, 1, 'bolts'),
  ultraEntry('ultraLightning', 'minorCount', 'Minor electrical branches', 'Smaller connecting arcs and filaments; reduce these first for a lighter effect.', 0, 40, 1, 'bolts'),
  ultraEntry('ultraLightning', 'coreWidth', 'Black-core width', 'Physical thickness of the opaque black lightning bodies.', .08, 1.2, .01, 'm'),
  ultraEntry('ultraLightning', 'branching', 'Branching density', 'Frequency of secondary forks along the larger fractures.', 0, 1, .05, 'ratio'),
  ultraEntry('ultraLightning', 'lightningReach', 'Decorative lightning reach', 'World-unit reach of decorative branches. Gameplay radius is configured separately.', 10, 100, 1, 'm'),
  ultraEntry('ultraLightning', 'lightningLifetime', 'Discharge cluster duration', 'A coherent path briefly flashes and restrikes, then disappears before the next discharge.', .16, .36, .01, 'sec'),
  ultraEntry('ultraLightning', 'glowWidth', 'Colored edge width', 'Width of luminous colored edge light around the opaque black body.', 1.1, 3, .05),
  ultraEntry('ultraLightning', 'glowIntensity', 'Edge glow intensity', 'Brightness of the purple-to-teal lightning edge treatment.', .5, 6, .1),
  ultraEntry('ultraLightning', 'gradientMix', 'Purple-to-teal color balance', 'Weight of signature purple and teal edges versus pink, electric blue and red accents.', 0, 1, .05, 'ratio'),

  ultraEntry('ultraPresentation', 'armorShine', 'Obsidian shine', 'Moving polished highlights and prismatic reflections on the black hull.', 0, 3, .05),
  ultraEntry('ultraPresentation', 'particles', 'Ship particles and wake', 'Prismatic sparks and trailing electrical fragments. Boost intensifies the wake.', 0, 2, .1),
  ultraEntry('ultraPresentation', 'projectileTrails', 'Void Beam trails', 'Prismatic tails on discrete cannon shots.', 0, 3, .1),
  ultraEntry('ultraPresentation', 'impactEffects', 'Void Beam impact effects', 'Intensity of brief rainbow and purple electrical impact bursts.', 0, 2, .1),
  ultraEntry('ultraPresentation', 'bloom', 'Bloom contribution', 'Additional bloom while the transformation is visible.', 0, 1, .01, '+'),
  ultraEntry('ultraPresentation', 'soundVolume', 'Ultra audio volume', 'Transformation, sustained aura and teleport sounds through the existing effects mixer.', 0, 1, .01, 'gain'),
  ultraEntry('ultraPresentation', 'reducedFlashing', 'Reduced flashing', 'Gentler pulses and impacts retain the black lightning and rainbow identity.', 0, 1, 1, 'on'),

  entry('gameplay', 'lootValue', 'Loot value', 'Scales value authorized by new loot drops.', 0, 10, .1),
  entry('gameplay', 'pickupRadius', 'Pickup radius', 'Scales the scrap attraction radius.', .25, 8, .05),
  entry('gameplay', 'scoreGain', 'Score gain', 'Scales score awarded by actions and bonuses.', 0, 20, .1),
  entry('gameplay', 'xpGain', 'XP gain', 'Scales experience earned from enemies.', 0, 20, .1),
  entry('gameplay', 'heatGain', 'Heat gain', 'Scales positive Rift Heat events.', 0, 8, .05),
  entry('gameplay', 'heatDecay', 'Heat decay', 'Scales passive Rift Heat loss.', 0, 8, .05),
]);

export const TUNING_BY_KEY = Object.freeze(Object.fromEntries(TUNING_SCHEMA.map(item => [item.key, item])));

export function tuningDefaults() {
  return Object.fromEntries(TUNING_SCHEMA.map(item => [item.key, item.default]));
}

export function normalizeTuning(input = {}) {
  const output = tuningDefaults();
  for (const item of TUNING_SCHEMA) {
    if (!Object.hasOwn(input, item.key) || !Number.isFinite(Number(input[item.key]))) continue;
    const stepped = Math.round(clamp(Number(input[item.key]), item.min, item.max) / item.step) * item.step;
    output[item.key] = Number(stepped.toFixed(6));
  }
  return output;
}

export function tuningChanges(values) {
  const normalized = normalizeTuning(values);
  return Object.fromEntries(TUNING_SCHEMA.filter(item => normalized[item.key] !== item.default)
    .map(item => [item.key, normalized[item.key]]));
}
