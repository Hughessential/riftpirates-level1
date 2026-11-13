import assert from 'node:assert/strict';
import { settleRunResults } from '../src/ui/RunResults.js';
import { ScoreSystem } from '../src/systems/ScoreSystem.js';
import { PAR_TIME } from '../src/config/encounters.js';

const make = ({ score = 1200, testRun = false, best = 1000 } = {}) => {
  const game = {
    runId: 'results-test-1', testRun, runPilotName: 'Zoë-銀',
    player: { shipId: 'void-corsair', shipName: 'VOID CORSAIR' },
    runTime: PAR_TIME - 10, heat: { multiplier: 1, maxMultiplier: 3, maxCombo: 12 },
    stats: { kills: 20, perfectDodges: 3 }, xp: { level: 8 }, upgrades: { ranks: { rapid: 2 } },
    scrap: { wallet: { earned: 1500, spent: 900, balance: 600 } },
  };
  game.score = new ScoreSystem(game); game.score.total = score;
  const save = {
    data: { bestScore: best, scrapBanked: 30, runs: 4, clears: 1, lastBankedRunId: '' }, calls: 0,
    bankRun(run) {
      this.calls++; this.data.runs++; this.data.clears += Number(run.cleared);
      this.data.scrapBanked += run.scrap; this.data.bestScore = Math.max(this.data.bestScore, run.score);
      this.data.lastBankedRunId = run.runId;
    },
  };
  return { game, save };
};

{
  const { game, save } = make();
  const result = settleRunResults(game, { victory: true }, save);
  assert.equal(result.score, 2400);
  assert.equal(result.pilotName, 'Zoë-銀');
  assert.equal(result.shipId, 'void-corsair');
  assert.equal(result.newBest, true);
  assert.equal(result.earned, 1500); assert.equal(result.spent, 900); assert.equal(result.remainder, 600);
  assert.equal(save.data.scrapBanked, 630); assert.equal(save.calls, 1);
  game.stats.kills = 900; game.upgrades.ranks.rapid = 99; game.runPilotName = 'EDITED';
  assert.equal(result.stats.kills, 20); assert.equal(result.ranks.rapid, 2);
  assert.equal(settleRunResults(game, { victory: false, killedBy: 'STALE DEATH' }, save), result);
  assert.equal(game.score.total, 2400); assert.equal(save.calls, 1);
  assert.equal(result.victory, true, 'Repeated or contradictory renders cannot change a settled run');
}
{
  const { game, save } = make({ score: 1000, best: 1000 });
  const result = settleRunResults(game, { victory: false, killedBy: 'RAIDER' }, save);
  assert.equal(result.newBest, false, 'A tied score is not a new personal best');
  assert.equal(result.score, 1000, 'Death never receives a victory time bonus');
  assert.equal(save.data.clears, 1); assert.equal(result.killedBy, 'RAIDER');
}
{
  const { game, save } = make({ testRun: true });
  const before = JSON.stringify(save.data);
  for (let i = 0; i < 8; i++) {
    game.runId = `lab-preview-${i}`;
    const result = settleRunResults(game, { victory: i % 2 === 0 }, save);
    assert.equal(result.score, 1200); assert.equal(result.newBest, false);
  }
  assert.equal(JSON.stringify(save.data), before); assert.equal(save.calls, 0);
  assert.equal(game.score.total, 1200, 'Repeated Testing Grounds previews do not create bonus points');
}
{
  const { game, save } = make();
  save.data.lastBankedRunId = game.runId;
  const result = settleRunResults(game, { victory: true }, save);
  assert.equal(save.calls, 0); assert.equal(game.score.total, 1200); assert.equal(result.newBest, false);
}
console.log('Run results: immutable actual recap, strict personal best, once-only settlement and isolated previews passed.');
