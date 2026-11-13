import { PAR_TIME } from '../config/encounters.js';
import { SCORE } from '../systems/ScoreSystem.js';

/** Freeze the real settlement before any presentation/count-up starts. The run
 * owns this snapshot so reopening or rebuilding its UI cannot award it twice. */
export function settleRunResults(game, { victory, killedBy }, save) {
  if (game._resultSnapshot?.runId === game.runId) return game._resultSnapshot;
  const alreadyBanked = !!game.runId && save.data.lastBankedRunId === game.runId;
  if (victory && !alreadyBanked && !game.testRun) {
    const spare = Math.max(0, PAR_TIME - game.runTime);
    if (spare > 0) game.score.addFlat(spare * SCORE.TIME_BONUS_PER_SEC, 'TIME BONUS');
  }
  const score = game.score.total;
  const grade = game.score.grade();
  const earned = game.scrap.wallet.earned;
  const spent = game.scrap.wallet.spent;
  const remainder = game.scrap.wallet.balance;
  const newBest = !game.testRun && !alreadyBanked && score > save.data.bestScore && score > 0;
  if (!game.testRun && !alreadyBanked) save.bankRun({
    scrap: remainder, runId: game.runId, score, time: game.runTime, grade, cleared: victory,
  });
  const result = {
    runId: game.runId, victory: !!victory, killedBy: killedBy || 'THE RIFT',
    testRun: !!game.testRun, pilotName: game.runPilotName || 'PIRATE',
    shipId: game.player.shipId, shipName: game.player.shipName || 'STAR HOPPER',
    score, grade, earned, spent, remainder, newBest,
    bestScore: save.data.bestScore, bank: save.data.scrapBanked,
    runTime: game.runTime, maxMultiplier: game.heat.maxMultiplier,
    maxCombo: game.stats.maxCombo || game.heat.maxCombo,
    stats: Object.freeze({ ...game.stats }), level: game.xp.level,
    ranks: Object.freeze({ ...game.upgrades.ranks }),
  };
  game._resultSnapshot = Object.freeze(result);
  return game._resultSnapshot;
}
