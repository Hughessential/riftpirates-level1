import assert from 'node:assert/strict';
import { CRATE_GLOW_PROFILE, crateGlowState } from '../src/render/Environment.js';

const phase = Math.PI / 3;
const normalA = crateGlowState(0, phase, false);
const normalB = crateGlowState(Math.PI / CRATE_GLOW_PROFILE.normal.rate, phase, false);
const reducedA = crateGlowState(0, phase, true);
const reducedB = crateGlowState(Math.PI / CRATE_GLOW_PROFILE.normal.rate, phase, true);

for (const [key, value] of Object.entries(normalA)) assert.ok(Number.isFinite(value) && value > 0, `${key} is finite and visible`);
assert.ok(Math.abs(normalA.haloSize - normalB.haloSize) > .8, 'Normal treasure cache has a clear rhythmic size pulse');
assert.ok(Math.abs(normalA.haloOpacity - normalB.haloOpacity) > .15, 'Normal treasure cache has a clear rhythmic brightness pulse');
assert.ok(Math.abs(reducedA.haloSize - reducedB.haloSize) < Math.abs(normalA.haloSize - normalB.haloSize),
  'Reduced motion uses a substantially slower and more restrained local pulse');
assert.ok(CRATE_GLOW_PROFILE.reduced.haloOpacityMin >= CRATE_GLOW_PROFILE.normal.haloOpacityMin,
  'Reduced motion remains visibly luminous rather than disabling loot feedback');

console.log('PASS: treasure-cache pulse scales deterministically with a reduced-motion fallback.');
