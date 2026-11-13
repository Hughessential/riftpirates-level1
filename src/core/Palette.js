/**
 * Colors pulled from the concept sheets. Each encounter owns an identity color
 * that must show up in its health bar, telegraphs, lights, particles and debris
 * (progression spec §39).
 */
export const P = {
  ink: '#010207',
  fog: '#03040b',
  nebA: '#071DBC',
  nebB: '#490C8F',

  hull: '#8B2FD6',
  hullDark: '#4A2482',
  light: '#C9B8F0',

  cyan: '#22D3EE',
  teal: '#0E9BA8',
  magenta: '#FF2ED2',
  gold: '#FFC53D',
  green: '#2FCE58',
  orange: '#F97316',
  amber: '#FBBF24',
  red: '#E11D48',
  pink: '#FB4E8D',
  violet: '#A855F7',
  purple: '#7C3AED',

  brown: '#8B5A2B',
  tan: '#E7C067',
  rock: '#5B4B8A',
  rockDark: '#3A2E52',
  stone: '#4B5563',
  stoneDark: '#2C333F',
  steel: '#6B7280',
  black: '#0A0716',
  white: '#FFFFFF',
  gray: '#9CA3AF',
};

/** Per-encounter identity. `hex` is the numeric form for three.js materials. */
export const IDENTITY = {
  tower1: { key: 'tower1', name: 'OUTER DEFENSE TOWER', sub: 'Border Skirmish', main: P.cyan, alt: P.teal, hex: 0x22d3ee },
  tower2: { key: 'tower2', name: 'MIDRIFT PRESSURE TOWER', sub: 'Gravity and Fire', main: P.violet, alt: P.purple, hex: 0xa855f7 },
  tower3: { key: 'tower3', name: 'INNER CITADEL TOWER', sub: 'Elite Garrison', main: P.red, alt: P.pink, hex: 0xe11d48 },
  inhibitor: { key: 'inhibitor', name: 'INHIBITOR CORE', sub: 'Gate-Sealing Power Structure', main: P.orange, alt: P.amber, hex: 0xf97316 },
  boss: { key: 'boss', name: 'THE RIFT ADMIRAL', sub: 'Nexus Overlord', main: P.magenta, alt: P.gold, hex: 0xff2ed2 },
};

/** Debris palettes for the voxel-shatter explosions. */
export const DEBRIS = {
  enemy: [P.hull, P.hullDark, P.red, P.orange, P.gold],
  rock: [P.rock, P.rockDark, P.orange, P.gold],
  tower1: [P.cyan, P.teal, P.stone, P.stoneDark, P.white],
  tower2: [P.violet, P.purple, P.stoneDark, P.orange, P.white],
  tower3: [P.red, P.pink, P.stone, P.stoneDark, P.gold],
  inhibitor: [P.orange, P.amber, P.gold, P.stoneDark, P.white],
  boss: [P.magenta, P.violet, P.gold, P.orange, P.white, P.black],
  player: [P.hull, P.hullDark, P.cyan, P.orange, P.gold, P.white],
};
