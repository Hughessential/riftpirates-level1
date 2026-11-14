import { SCORE } from '../systems/ScoreSystem.js';
import { OUTER_APPROACH } from './approaches.js';

/**
 * All encounter balance lives here (spec §38) so tuning never means touching
 * encounter logic. Every number a designer would want to move is in this file.
 */

export const OUTER_TOWER = {
  coreHealth: 900,
  cannonHealth: 260,
  emitterHealth: 220,
  dockHealth: 180,
  weakPointScrap: 26,
  coreScrap: 90,
  scrapReward: 200,
  destroyScore: SCORE.TOWER,
  defeatBanner: 'OUTER DEFENSE BREACHED',

  // Attack A: tracking laser
  trackingDuration: 1.5,
  laserDelay: 0.4,
  laserDuration: 0.6,
  laserCooldown: [2.8, 4.0],
  laserDamage: 24,

  // Attack B: light turret barrage
  turretBurstCount: 4,
  turretCooldown: [2.2, 3.2],
  turretProjectileSpeed: 38,
  turretDamage: 10,

  // Attack C: scout drones
  droneSpawnInterval: 6.8,
  droneCount: 2,
  maxDrones: 6,
};

export const MIDRIFT_TOWER = {
  coreHealth: 1300,
  gravityGenHealth: 340,
  deckHealth: 320,
  pressureGenHealth: 300,
  weakPointScrap: 34,
  coreScrap: 130,
  scrapReward: 300,
  destroyScore: SCORE.TOWER * 1.3,
  defeatBanner: 'PRESSURE NETWORK DESTROYED',

  overchargeAt: 0.4, // core health fraction that triggers Overcharge (spec §13 D)

  // Attack A: gravity wells
  wellCount: 2,
  wellCooldown: [7, 10],
  wellForce: 16,
  wellRadius: 13,
  wellLife: 8,

  // Attack B: sweeping rift lasers
  sweepCooldown: [6.5, 9],
  sweepSpeed: 0.5, // rad/sec
  sweepDamage: 26,
  sweepDuration: 5.5,

  // Attack C: pressure zones
  pressureCooldown: [4, 6],
  pressureDamage: 20,
  pressureKnockback: 26,
  pressureRadius: 7,

  // enemy support
  gunshipInterval: 7.8,
  maxEnemies: 6,
};

export const INNER_CITADEL = {
  coreHealth: 1500,
  shieldGenHealth: 420,
  dockHealth: 380,
  turretHealth: 300,
  shieldedDamageScale: 0.1, // body is near-immune while shields hold (spec §16 A)
  weakPointScrap: 40,
  coreScrap: 160,
  scrapReward: 380,
  destroyScore: SCORE.TOWER * 1.6,
  defeatBanner: 'INNER CITADEL FALLEN',

  // Attack B: elite deployment
  eliteInterval: 9.5,
  eliteIntervalNoDock: 20, // killing the dock slows reinforcements
  maxElites: 3,

  // Attack C: crossfire turrets
  crossfireCooldown: [5, 7.5],
  crossfireDamage: 26,

  // Attack D: hazard zones
  hazardCooldown: [3.5, 5.5],
  hazardDamage: 22,
  hazardCount: 2,

  // tighter arena (spec §16): the walls close in
  arenaSquish: 0.72,
};

export const INHIBITOR = {
  conduitHealth: 620,
  coreHealth: 1800,
  weakPointScrap: 55,
  coreScrap: 240,
  scrapReward: 500,
  destroyScore: SCORE.INHIBITOR,
  defeatBanner: 'INHIBITOR DISABLED',

  // Attack A: overload pulses
  pulseCooldown: [3.4, 5],
  pulseDamage: 24,
  pulseSpeed: 24,

  // Attack C: conduit discharge
  dischargeCooldown: [2.6, 4],
  dischargeDamage: 22,

  // Attack D: system overload — the damage window
  overloadWindow: 13, // generous (spec §19 D)
  shieldRecoverOnce: true, // shields may come back exactly once
};

export const RIFT_ADMIRAL = {
  maxHealth: 9000,
  cannonHealth: 900,
  tendrilControlHealth: 750,
  weakPointScrap: 70,
  scrapReward: 900,
  defeatBanner: 'NEXUS BROKEN',

  // phase thresholds as fractions of max health (spec §23)
  phases: [1.0, 0.75, 0.5, 0.25],
  phaseNames: ['RIFT ADMIRAL', 'RIFT UNLEASHED', 'NEXUS OVERDRIVE', 'TOTAL DOMINION'],

  // The core only opens after you break the current pattern (spec §25).
  coreOpenTime: 6.5,
  coreDamageScale: 3, // core hits count triple — finding the window is the fight
  bodyDamageScale: 0.12, // shooting the hull is nearly pointless

  // attacks
  laserBarrage: { cooldown: [6, 8], damage: 30, lanes: 3 },
  voidAnchor: { cooldown: [7, 10], damage: 32, markTime: 1.3 },
  squadron: { cooldown: [11, 15], count: 3 },
  artillery: { cooldown: [3.4, 5], damage: 28, speed: 24 },
  tendrilSweep: { cooldown: [8, 11], damage: 30 },
  collapse: { cooldown: [16, 21], damage: 38 }, // phase 3+ only
};

/** Traversal sector pacing (spec §12, §15, §18). */
export const TRAVERSAL = {
  sector1: {
    sector: 0,
    duration: 104,
    augmentAt: [22, 54, 88],
    authored: OUTER_APPROACH,
    maxEnemies: 7,
    spawnInterval: [2.4, 3.6],
    types: ['scout', 'scout', 'gunship'],
    asteroidRate: 0.55,
    gates: 0,
    scrapCrates: 2,
  },
  sector2: {
    sector: 1,
    duration: 96,
    augmentAt: [24, 52, 80],
    spawnInterval: [1.6, 2.6],
    maxEnemies: 8,
    types: ['scout', 'gunship', 'gunship', 'heavy', 'shielder'],
    asteroidRate: 0.9,
    gates: 4,
    gravityDistortions: 2,
    scrapCrates: 3,
  },
  sector3: {
    sector: 2,
    duration: 108,
    augmentAt: [28, 60, 92],
    spawnInterval: [1.3, 2.2],
    maxEnemies: 9,
    types: ['gunship', 'heavy', 'elite', 'shielder'],
    asteroidRate: 0.7,
    gates: 2,
    crossfire: true,
    scrapCrates: 3,
  },
  inhibitorApproach: {
    sector: 3,
    duration: 78,
    augmentAt: [18, 40, 62],
    spawnInterval: [1.6, 2.5],
    maxEnemies: 9,
    types: ['gunship', 'heavy', 'elite', 'shielder'],
    asteroidRate: 0.35,
    gates: 2,
    scrapCrates: 2,
    ceremonial: true,
  },
};

/** First-flight teaching lane. LevelDirector is held through the action lesson,
 * then the first authored route segment resumes under this softer pressure. */
export const TUTORIAL_OPENING = Object.freeze({
  maxEnemies: 1,
  // The authored route resumes after the lesson, but its first four wave cues
  // stay a one-ship teaching ramp until the first augment cache.
  routePressureSeconds: 22,
  routeFireDelay: 6.5,
  enemyType: 'scout',
  enemyHpScale: .55,
  enemyX: 0,
  enemyY: 4,
  enemyZ: -26,
  fireDelay: 12,
  briefingSeconds: 5.5,
});

/** Par time for the time bonus (spec §28). Beat it and you're rewarded. */
export const PAR_TIME = 11 * 60; // 11 minutes
