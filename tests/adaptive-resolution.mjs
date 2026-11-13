import assert from 'node:assert/strict';
import { AdaptiveResolution } from '../src/render/AdaptiveResolution.js';

const quality = new AdaptiveResolution();
const simulate = (seconds, dt, eligible = true) => {
  let changes = 0;
  for (let t = 0; t < seconds; t += dt) changes += Number(quality.update(dt, eligible));
  return changes;
};
assert.equal(simulate(20, 1 / 60), 0, 'Stable 60 Hz keeps native rendering');
assert.equal(quality.scale, 1);
assert.equal(simulate(.5, .05), 0, 'A short stall does not degrade resolution');
simulate(20, .05, false);
assert.equal(quality.scale, 1, 'Pause/lab/menu frames cannot lower quality');
assert.ok(simulate(10, 1 / 30) > 0, 'Sustained low frame rate reduces internal pixel count');
assert.ok(quality.scale < 1);
simulate(60, 1 / 30);
assert.equal(quality.scale, .65, 'Readable minimum scale is bounded');
const floor = quality.scale;
quality.update(NaN); quality.update(Infinity); quality.update(-1); quality.update(4);
assert.equal(quality.scale, floor, 'Invalid/background intervals cannot change quality');
simulate(100, 1 / 60);
assert.equal(quality.scale, 1, 'Long stable periods gradually restore full detail');
simulate(10, 1 / 30);
assert.equal(quality.restore(), true);
assert.equal(quality.scale, 1, 'Returning to the title restores full detail immediately');
console.log('PASS: conservative render scaling, stall rejection, exclusions, bounded floor and recovery.');
