/** Weapon shapes and neon identities. Hostile rounds keep their diamond silhouette. */
export const WEAPON_STYLES = Object.freeze({
  pulse: { color: '#ff38c9', width: .25, length: 3.4, radius: .7, shape: 'beam', trail: 3.2 },
  twin: { color: '#ff729e', width: .24, length: 3.6, radius: .65, shape: 'double', trail: 3.7 },
  broadsides: { color: '#ff922e', width: .34, length: 3, radius: .75, shape: 'cleaver', trail: 3.8 },
  helix: { color: '#7763ff', width: .3, length: 4.2, radius: .7, shape: 'helix', trail: 5.4 },
  prism: { color: '#21eeff', width: .43, length: 9.4, radius: .8, shape: 'lance', trail: 8 },
  scatter: { color: '#ffe84c', width: .45, length: 1.5, radius: .75, shape: 'pellet', trail: 2.2 },
  seeker: { color: '#a7ff3b', width: .5, length: 2.5, radius: .8, shape: 'missile', trail: 5.8 },
  mortar: { color: '#c34aff', width: 1.25, length: 1.6, radius: 1.05, shape: 'orb', trail: 4.7 },
  orbital: { color: '#e8fff8', width: .25, length: 3.9, radius: .65, shape: 'lance', trail: 4.2 },
  echo: { color: '#48a6ff', width: .25, length: 3.3, radius: .65, shape: 'double', trail: 5.2 },
  wake: { color: '#ff4b40', width: .4, length: 2.5, radius: .8, shape: 'cleaver', trail: 4.3 },
  capacitor: { color: '#45ffc1', width: .75, length: 8.2, radius: 1, shape: 'lance', trail: 9.5 },
  fragment: { color: '#f97cf5', width: .27, length: 1.8, radius: .55, shape: 'shard', trail: 2.6 },
  tesla: { color: '#6ccaff', width: .31, length: 4, radius: .7, shape: 'helix', trail: 5 },
  siphon: { color: '#5aff94', width: .34, length: 4, radius: .7, shape: 'double', trail: 4.8 },
  retaliation: { color: '#ffb668', width: .48, length: 2.8, radius: .8, shape: 'cleaver', trail: 4 },
  singularity: { color: '#d289ff', width: 1.4, length: 1.6, radius: 1.1, shape: 'orb', trail: 5.5 },
});
export const PROJECTILE_BUDGET = Object.freeze({ player: 1024, enemy: 512 });
// Fixed instance slices retain four draw calls. Three solid parts make a weapon
// silhouette; two additive instances give every bolt its own trailing wake.
export const PROJECTILE_PARTS = Object.freeze({ core: 3, glow: 2 });
export const WEAPON_AUGMENTS = Object.freeze({
  twin: 'twinFangs', broadsides: 'broadsides', helix: 'helixVolley', prism: 'prismLance',
  scatter: 'scatterNova', seeker: 'seekerSwarm', mortar: 'voidMortar', orbital: 'orbitals',
  echo: 'echoBarrage', wake: 'shrapnelWake', capacitor: 'kineticCapacitor',
  fragment: 'fragmentation', tesla: 'teslaFork', siphon: 'bulletSiphon',
  retaliation: 'revengeMatrix', singularity: 'singularity',
});
const rank = (stats, id) => Math.max(0, Number(stats?.[id]) || 0);
const MODIFIERS = [
  ['cryoRounds', 'CRYO', '#9cecff', 'prism'],
  ['solarBurn', 'SOLAR', '#ff692b', 'broadsides'],
  ['teslaFork', 'TESLA', '#428aff', 'tesla'],
  ['gravityWell', 'GRAVITY', '#b272ff', 'singularity'],
  ['fragmentation', 'SHATTER', '#f977ec', 'fragment'],
  ['ricochet', 'RICOCHET', '#52ffad', 'siphon'],
  ['executionProtocol', 'EXECUTION', '#ff3863', 'capacitor'],
];
const OFFENSIVE = ['rapidFire', 'hotshot', 'railAccelerator', 'criticalDamage', 'nexusBreaker',
  'overcharge', 'bloodReactor', 'treasureMunitions', ...Object.values(WEAPON_AUGMENTS),
  'cryoRounds', 'solarBurn', 'gravityWell', 'ricochet', 'executionProtocol', 'chainReaction'];

/** Primary output before random crits; shared by firing and the live readout. */
export function primaryWeaponOutput(stats = {}, context = {}) {
  let requestedRate = context.fireRate ?? stats.fireRate ?? 6.5;
  if (context.critBuffT > 0) requestedRate *= 1.35;
  let damage = (stats.damage ?? 18) * Math.max(1, requestedRate / 45);
  if (context.critBuffT > 0) damage *= 1.25;
  if (rank(stats, 'overcharge') && context.heatMultiplier >= 8) damage *= 1 + rank(stats, 'overcharge') * .5;
  if (rank(stats, 'bloodReactor') && context.shield <= 0) damage *= 1 + rank(stats, 'bloodReactor') * .35;
  if (context.weakPoint) damage *= stats.weakPointDamage ?? 1;
  damage += Math.max(0, context.treasureCharge || 0);
  return { damage, fireRate: Math.min(45, Math.max(.1, requestedRate)), requestedRate };
}

/** Readable build identity, shared by primary fire, acquisition feedback and HUD. */
export function weaponPowerSignature(stats = {}, context = {}) {
  const weaponRanks = Object.fromEntries(Object.entries(WEAPON_AUGMENTS).map(([kind, id]) => [kind, rank(stats, id)]));
  const stacks = [...new Set(OFFENSIVE)].reduce((sum, id) => sum + rank(stats, id), 0);
  const power = stacks + Math.max(0, Math.log2(Math.max(1, (stats.damage || 18) / 18)))
    + Math.max(0, ((stats.fireRate || 6.5) / 6.5 - 1) * .45);
  const tier = power === 0 ? 0 : power < 3 ? 1 : power < 6 ? 2 : power < 11 ? 3 : 4;
  const modifiers = MODIFIERS.filter(([id]) => rank(stats, id)).map(([id, label, color, sound]) =>
    ({ id, label, color, sound, rank: rank(stats, id) }));
  if (rank(stats, 'overcharge') && Number(context.heatMultiplier) >= 8)
    modifiers.push({ id: 'overcharge', label: 'INFERNAL', color: '#ff452b', sound: 'capacitor', rank: rank(stats, 'overcharge') });
  if (rank(stats, 'bloodReactor') && Number(context.shield) <= 0)
    modifiers.push({ id: 'bloodReactor', label: 'BLOOD', color: '#ff295d', sound: 'retaliation', rank: rank(stats, 'bloodReactor') });
  if (Number(context.treasureCharge) > 0)
    modifiers.push({ id: 'treasureMunitions', label: 'GOLDEN', color: '#ffdc54', sound: 'scatter', rank: rank(stats, 'treasureMunitions') });
  const modifier = modifiers.length ? modifiers[Math.abs(Math.floor(context.shot || 0)) % modifiers.length] : null;
  let color = modifier?.color || WEAPON_STYLES.pulse.color;
  let sound = modifier?.sound || 'pulse';
  let shape = modifier?.id === 'gravityWell' ? 'orb' : modifier ? 'helix' : 'beam';
  if (!modifier && rank(stats, 'railAccelerator')) { color = '#c5f2ff'; sound = 'prism'; shape = 'lance'; }
  else if (!modifier && rank(stats, 'hotshot')) { color = '#ff6050'; sound = 'capacitor'; shape = 'cleaver'; }
  else if (!modifier && rank(stats, 'rapidFire')) { color = '#2affd0'; sound = 'twin'; shape = 'double'; }
  return { tier, power, stacks, label: ['PULSE', 'CHARGED', 'OVERDRIVE', 'OBLITERATOR', 'RIFT GOD'][tier],
    color, sound, shape, modifiers, weaponRanks };
}

/** Ranks grow visible dimensions, silhouette and trails without unbounded bloom. */
export function projectileAppearance(weapon = 'pulse', { rank: level = 1, power = 0, signature = null, crit = false } = {}) {
  const style = WEAPON_STYLES[weapon] || WEAPON_STYLES.pulse;
  const growth = Math.log2(1 + Math.max(0, Number(level) - 1));
  const reactor = Math.log2(1 + Math.max(0, Number(power))) * .07;
  const scale = Math.min(2.25, 1 + growth * .23 + reactor);
  const pulse = weapon === 'pulse' && signature;
  const width = style.width * scale * (pulse && signature.tier ? 1.25 : 1) * (crit ? 1.12 : 1);
  return { color: pulse ? signature.color : style.color,
    accent: pulse && signature.modifiers.length > 1 ? signature.modifiers[(signature.stacks + 1) % signature.modifiers.length].color : style.color,
    width, length: style.length * Math.min(1.85, 1 + growth * .15 + reactor),
    trail: style.trail * Math.min(2, 1 + growth * .23 + reactor),
    shape: pulse ? signature.shape : style.shape,
    rank: Math.max(1, Number(level) || 1), power: Math.max(0, Number(power) || 0),
    radius: style.radius * Math.min(1.3, 1 + growth * .06), brightness: Math.min(1.85, 1.28 + growth * .08 + reactor),
  };
}
