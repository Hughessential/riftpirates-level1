import assert from 'node:assert/strict';
import { TUNING_SCHEMA, TUNING_BY_KEY, normalizeTuning, tuningChanges, tuningDefaults } from '../src/core/TuningRegistry.js';

const defaults = tuningDefaults();
assert.equal(Object.keys(defaults).length, TUNING_SCHEMA.length, 'Every tuning entry has one default');
assert.equal(new Set(TUNING_SCHEMA.map(item => item.key)).size, TUNING_SCHEMA.length, 'Tuning keys are unique');
for (const item of TUNING_SCHEMA) {
  assert.equal(TUNING_BY_KEY[item.key], item);
  assert.ok(item.default >= item.min && item.default <= item.max, `${item.key} default is in range`);
  assert.ok(item.step > 0 && item.max > item.min, `${item.key} has a usable numeric range`);
}

const normalized = normalizeTuning({ moveSpeed: 999, enemyHealth: -5, criticalChance: .337, unknown: 4, bloom: 'nope' });
assert.equal(normalized.moveSpeed, TUNING_BY_KEY.moveSpeed.max);
assert.equal(normalized.enemyHealth, TUNING_BY_KEY.enemyHealth.min);
assert.equal(normalized.criticalChance, .34, 'Values snap to the declared step');
assert.equal(normalized.bloom, defaults.bloom, 'Invalid numbers return to the authored default');
assert.equal(Object.hasOwn(normalized, 'unknown'), false, 'Unknown imported keys are discarded');

assert.deepEqual(tuningChanges(defaults), {});
assert.deepEqual(tuningChanges({ ...defaults, playerDamage: 2, renderScale: .75 }), { playerDamage: 2, renderScale: .75 });
console.log(`PASS: ${TUNING_SCHEMA.length} tuning parameters have unique, clamped, step-normalized defaults.`);
