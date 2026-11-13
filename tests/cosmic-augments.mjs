import assert from 'node:assert/strict';
import { COSMIC_AUGMENTS, cosmicDescription, cosmicAmplification, amplifyAugmentStats } from '../src/systems/CosmicAugments.js';
import { UPGRADES, buildAugmentStats } from '../src/systems/UpgradeSystem.js';
import { BASE_STATS } from '../src/player/Player.js';
import { augmentDelta } from '../src/ui/AugmentFeedback.js';

const expected = ['blackwakeRounds','riftstepSurge','lootstormHalo','emperorsPressure','phantomBroadside','voltageCrown','nebulaSkin','dreadwakeEngine','predatorsGaze','scrapTyphoon','conquerorsCircuit','leviathanPulse','starbreakerChoir','riftSovereign','eclipseArsenal','throneOfThunder','voidDominion','overlordsReflex','diamondApocalypse','blackFlagAscension','emperorOfTheRift','godspeedMarauder','singularityPalace','celestialExecution','kingsCataclysm','infiniteArmada','endOfFear','stormTyrantHalo','crownOfTheLastPirate','absoluteOvercharge'];
assert.deepEqual(Object.keys(COSMIC_AUGMENTS),expected);
assert.equal(Object.keys(UPGRADES).length,75);
for(const tier of ['RARE','ULTRA-RARE','MYTHIC'])assert.equal(Object.values(COSMIC_AUGMENTS).filter(a=>a.rarity===tier).length,10);
for(const id of expected){
  const a=UPGRADES[id];assert.ok(a.desc&&a.stack&&a.trigger&&a.guardrails&&a.tunables);
  for(const rank of [1,5,50]){
    const s=buildAugmentStats({[id]:rank});
    assert.equal(s[id],rank);
    for(const [key,value]of Object.entries(s))if(typeof value==='number')assert.ok(Number.isFinite(value),`${id}:${rank}:${key}`);
    assert.ok(!/undefined|NaN|Infinity/.test(cosmicDescription(id,rank)),id);
  }
}
const all=buildAugmentStats(Object.fromEntries(Object.keys(UPGRADES).map(id=>[id,50])));
assert.ok(Object.values(all).filter(v=>typeof v==='number').every(Number.isFinite));
assert.equal(all.shieldBreakDelay,14);
assert.equal(cosmicAmplification({crownOfTheLastPirate:50}),2.5);
const base=BASE_STATS(),unamplified={...base,damage:base.damage+10,damageReduction:.999};
assert.deepEqual(amplifyAugmentStats(unamplified,base),unamplified,'No crown preserves all existing values exactly');
const crowned=amplifyAugmentStats({...unamplified,crownOfTheLastPirate:1},base);
assert.equal(crowned.damage,base.damage+13);
assert.equal(crowned.shieldBreakDelay,14);
assert.ok(crowned.damageReduction>unamplified.damageReduction);
const hotshot = { id:'hotshot', ...UPGRADES.hotshot };
assert.equal(augmentDelta(hotshot,buildAugmentStats({crownOfTheLastPirate:1}),1),'SHOT 18 → 23.9');
const xpStats=buildAugmentStats({crownOfTheLastPirate:1,hotshot:2},6);
const nextXP=buildAugmentStats({crownOfTheLastPirate:1,hotshot:3},6);
assert.equal(augmentDelta(hotshot,xpStats,3),`SHOT ${Number(xpStats.damage.toFixed(1))} → ${Number(nextXP.damage.toFixed(1))}`);
console.log('PASS cosmic registry: 30 canonical IDs, 75 total, ten per tier, rank1/5/50 finite and crown applies once to tagged magnitudes.');
