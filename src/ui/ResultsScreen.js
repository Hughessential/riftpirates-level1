import { $, fmtTime } from '../core/Utils.js';
import { Save } from '../core/SaveSystem.js';
import { Audio2 } from '../core/AudioManager.js';
import { UPGRADES } from '../systems/UpgradeSystem.js';
import { settleRunResults } from './RunResults.js';
import { VictoryPresentation } from './VictoryPresentation.js';
import { voxelWordSVG } from './VoxelTitle.js';
import './results-screen.css';

/** One settlement, two distinct endings. Decorations never enter the world,
 * reward systems or scheduler, and results work even with audio unavailable. */
export class ResultsScreen {
  constructor(game) {
    this.game = game;
    this.el = $('resultsScreen');
    this.grid = $('resultsGrid');
    this.build = $('resultsBuild');
    this.buildToggle = $('resultsBuildToggle');
    this.buildPaging = this.el.querySelector('.resultsBuildPaging');
    this.buildToggle.addEventListener('click', () => {
      const expanded = this.el.classList.toggle('expandedBuild');
      this.buildToggle.setAttribute('aria-expanded', String(expanded));
      this.buildToggle.textContent = expanded ? 'COMPACT BUILD' : 'SHOW FULL BUILD';
      this.build.scrollTop = 0;
      this.syncBuildControls();
    });
    for (const [id, direction] of [['resultsBuildPrevious', -1], ['resultsBuildNext', 1]]) {
      $(id).addEventListener('click', () => {
        this.build.scrollTop += direction * Math.max(24, this.build.clientHeight - 24);
        this.syncBuildControls();
      });
    }
    this.build.addEventListener('scroll', () => this.syncBuildControls(), { passive: true });
    this.buildObserver = new ResizeObserver(() => {
      if (!this.el.classList.contains('hidden')) this.syncBuildControls();
    });
    this.buildObserver.observe(this.build);
    this.presentation = new VictoryPresentation(game, this.el);
    this.victoryHeading = `<span>${voxelWordSVG('GALAXY', 'rift')}</span><span>${voxelWordSVG('ESCAPED', 'pirates')}</span>`;
    this.el.addEventListener('keydown', event => {
      // A held confirm must not skip, move focus, then accidentally start a run.
      if (event.repeat && (event.code === 'Enter' || event.code === 'Space')) {
        event.preventDefault(); return;
      }
      if (!this.presentation.revealing || event.target.closest('button,input,textarea,select')) return;
      if (event.code === 'Space' || event.code === 'Enter' || event.code === 'KeyS') {
        event.preventDefault();
        this.presentation.skip();
      }
    });
  }

  show(outcome) {
    const g = this.game;
    const result = settleRunResults(g, outcome, Save);
    const { victory, score, grade } = result;
    const repeated = this.shownRun === result.runId;
    this.shownRun = result.runId;
    this.el.classList.toggle('victoryResults', victory);
    this.el.classList.toggle('deathResults', !victory);
    this.el.dataset.outcome = victory ? 'victory' : 'failure';
    $('resultsEyebrow').textContent = result.testRun
      ? `${victory ? 'VICTORY' : 'FAILURE'} // TEST SESSION / RESULTS NOT SAVED`
      : victory ? 'VICTORY // FINAL RIFT CLEARED' : 'RUN TERMINATED';
    const heading = $('resultsTitle');
    heading.setAttribute('aria-label', victory ? 'GALAXY ESCAPED' : 'SHIP DESTROYED');
    if (victory) heading.innerHTML = this.victoryHeading;
    else heading.textContent = 'SHIP DESTROYED';
    $('resultsSubtitle').textContent = victory
      ? 'YOU OUTRAN THE END. YOUR LEGEND CONTINUES.' : 'THE VOID TOOK THE SHIP. TAKE YOUR REVENGE.';
    $('resultsPilotName').textContent = result.pilotName;
    $('resultsShipName').textContent = result.shipName;
    const image = $('resultsShipImage');
    const thumbnail = g.hangar?.thumbnails.get(result.shipId);
    image.hidden = !thumbnail;
    if (thumbnail) image.src = thumbnail;
    else image.removeAttribute('src');
    image.alt = result.shipName;
    $('resultsShipFallback').hidden = !!thumbnail;
    const deathLine = $('deathLine');
    deathLine.classList.toggle('hidden', victory);
    deathLine.textContent = victory ? '' : `DESTROYED BY: ${result.killedBy}`;

    $('gradeVal').textContent = grade;
    $('gradeVal').className = `grade g${grade.replace('+', 'plus')}`;
    $('gradeVal').setAttribute('aria-label', `Earned rank ${grade}`);
    $('scoreBig').textContent = score.toLocaleString();
    $('scoreBig').setAttribute('aria-label', `${score.toLocaleString()} final score`);
    $('bestScoreVal').textContent = result.bestScore.toLocaleString();
    $('newBest').classList.toggle('hidden', !result.newBest);

    const st = result.stats;
    const rows = [
      [victory ? 'COMPLETION TIME' : 'RUN TIME', fmtTime(result.runTime)],
      ['MAX MULTIPLIER', `x${result.maxMultiplier.toFixed(1)}`],
      ['MAX COMBO', result.maxCombo], ['PERFECT DODGES', st.perfectDodges],
      ['ENEMIES DESTROYED', st.kills], ['WEAK POINTS DESTROYED', st.weakPoints],
      ['OBJECTIVES DESTROYED', `${st.towers} / 5`], ['BOSS PHASES CLEARED', `${st.bossPhases} / 4`],
      ['DAMAGE TAKEN', Math.round(st.damageTaken)], ['SHIP LEVEL', result.level],
      ['SCRAP PLUNDERED', result.earned.toLocaleString()], ['SCRAP SPENT', result.spent.toLocaleString()],
      [result.testRun ? 'TEST WALLET / NOT BANKED' : 'REMAINDER BANKED', result.remainder.toLocaleString()],
      ['LIFETIME SCRAP BANK', result.bank.toLocaleString()],
    ];
    this.grid.replaceChildren(...rows.map(([label, value]) => {
      const row = document.createElement('div'); row.className = 'rrow';
      const key = document.createElement('span'); key.textContent = label;
      const number = document.createElement('b'); number.textContent = String(value ?? 0);
      row.append(key, number); return row;
    }));
    const build = Object.entries(result.ranks);
    this.build.replaceChildren(...(build.length ? build.map(([id, rank]) => {
      const up = UPGRADES[id];
      const chip = document.createElement('span'); chip.className = 'chip';
      if (up) chip.style.color = up.color;
      chip.textContent = `${up?.name || id} ×${rank}`;
      return chip;
    }) : [Object.assign(document.createElement('span'), { className: 'chip dim', textContent: 'NO UPGRADES TAKEN' })]));

    this.el.classList.remove('hidden');
    if (!repeated) {
      this.el.classList.remove('expandedBuild');
      this.buildToggle.setAttribute('aria-expanded', 'false');
      this.buildToggle.textContent = 'SHOW FULL BUILD';
      this.build.scrollTop = 0;
    }
    this.syncBuildControls();
    this.presentation.show(result, { instant: repeated });
    if (!repeated) {
      this.el.scrollTop = 0;
      // Native focus lets Enter/Space, touch and controller confirm share one
      // skip button. It remains available without blocking either exit action.
      (this.presentation.revealing ? $('victorySkip') : $('againBtn')).focus({ preventScroll: true });
    }
    if (victory) Audio2.playVictory();
    else Audio2.playDeath();
  }

  syncBuildControls() {
    const expanded = this.el.classList.contains('expandedBuild');
    const overflows = this.build.scrollHeight > this.build.clientHeight + 2;
    this.buildToggle.hidden = !expanded && !overflows;
    this.buildPaging.hidden = !expanded || !overflows;
    $('resultsBuildPrevious').disabled = this.build.scrollTop <= 1;
    $('resultsBuildNext').disabled = this.build.scrollTop + this.build.clientHeight >= this.build.scrollHeight - 2;
  }

  update(dt) {
    if (this.el.classList.contains('hidden')) {
      if (this.presentation.active) this.presentation.hide();
      return;
    }
    this.presentation.update(dt);
  }

  hide() {
    this.presentation.hide();
    this.el.classList.add('hidden');
  }
}
