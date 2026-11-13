import { $, fmtTime } from '../core/Utils.js';
import { Save } from '../core/SaveSystem.js';
import { Audio2 } from '../core/AudioManager.js';
import { PAR_TIME } from '../config/encounters.js';
import { SCORE } from '../systems/ScoreSystem.js';
import { UPGRADES } from '../systems/UpgradeSystem.js';

/**
 * Results (spec §28, §42, §43). Shown on death and on victory — same screen,
 * different framing. Restart must be one click away and near-instant.
 */
export class ResultsScreen {
  constructor(game) {
    this.game = game;
    this.el = $('resultsScreen');
    this.grid = $('resultsGrid');
  }

  show({ victory, killedBy }) {
    const g = this.game;

    // ---- end-of-run bonuses ----
    const firstPresentation = !this._shownRun || this._shownRun !== g.runId;
    if (victory && firstPresentation) {
      const spare = Math.max(0, PAR_TIME - g.runTime);
      if (spare > 0) {
        g.score.addFlat(spare * SCORE.TIME_BONUS_PER_SEC, 'TIME BONUS');
      }
    }

    const score = g.score.total;
    const grade = g.score.grade();
    const scrap = g.scrap.wallet.earned;
    const spent = g.scrap.wallet.spent;
    const remainder = g.scrap.wallet.balance;

    if (!g.testRun && firstPresentation) Save.bankRun({
      scrap: remainder,
      runId: g.runId,
      score,
      time: g.runTime,
      grade,
      cleared: victory,
    });
    this._shownRun = g.runId;

    // ---- header ----
    $('resultsEyebrow').textContent = g.testRun ? 'TEST SESSION / RESULTS NOT SAVED' : victory ? 'NEXUS BROKEN' : 'RUN TERMINATED';
    $('resultsTitle').textContent = victory ? 'THE RIFT ADMIRAL DEFEATED' : `${g.player.shipName || 'STAR HOPPER'} DESTROYED`;
    $('resultsTitle').style.color = victory ? '#FFC53D' : '#E11D48';

    const deathLine = $('deathLine');
    if (victory) {
      deathLine.classList.add('hidden');
    } else {
      deathLine.classList.remove('hidden');
      deathLine.innerHTML = `DESTROYED BY: <b>${killedBy || 'THE RIFT'}</b>`;
    }

    // ---- grade + score ----
    $('gradeVal').textContent = grade;
    $('gradeVal').className = `grade g${grade.replace('+', 'plus')}`;
    $('scoreBig').textContent = score.toLocaleString();
    $('bestScoreVal').textContent = Save.data.bestScore.toLocaleString();
    $('newBest').classList.toggle('hidden', g.testRun || score < Save.data.bestScore || score === 0);

    // ---- stat grid ----
    const st = g.stats;
    const rows = [
      ['COMPLETION TIME', fmtTime(g.runTime)],
      ['MAX MULTIPLIER', `x${g.heat.maxMultiplier.toFixed(1)}`],
      ['MAX COMBO', st.maxCombo || g.heat.maxCombo],
      ['PERFECT DODGES', st.perfectDodges],
      ['ENEMIES DESTROYED', st.kills],
      ['WEAK POINTS DESTROYED', st.weakPoints],
      ['OBJECTIVES DESTROYED', `${st.towers} / 5`],
      ['BOSS PHASES CLEARED', `${st.bossPhases} / 4`],
      ['DAMAGE TAKEN', Math.round(st.damageTaken)],
      ['SCRAP PLUNDERED', scrap.toLocaleString()],
      ['SCRAP SPENT', spent.toLocaleString()],
      [g.testRun ? 'TEST WALLET / NOT BANKED' : 'REMAINDER BANKED', remainder.toLocaleString()],
      ['LIFETIME SCRAP BANK', Save.data.scrapBanked.toLocaleString()],
      ['SHIP LEVEL', g.xp.level],
    ];
    this.grid.innerHTML = rows
      .map(([k, v]) => `<div class="rrow"><span>${k}</span><b>${v}</b></div>`)
      .join('');

    // ---- build ----
    const build = Object.entries(g.upgrades.ranks);
    $('resultsBuild').innerHTML = build.length
      ? build.map(([id, rank]) => `<span class="chip" style="color:${UPGRADES[id].color}">${UPGRADES[id].name} ×${rank}</span>`).join('')
      : '<span class="chip dim">NO UPGRADES TAKEN</span>';

    this.el.classList.remove('hidden');
    Audio2.playMusic(victory ? 'victory' : 'defeat', 1.5, !victory);
  }

  hide() {
    this.el.classList.add('hidden');
  }
}
