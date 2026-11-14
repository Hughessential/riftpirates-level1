import { Input } from './Input.js';
import { Save } from './SaveSystem.js';
import { STATE } from './GameState.js';
import { TUTORIAL_OPENING } from '../config/encounters.js';

const rankTotal = game => Object.values(game.upgrades?.ranks || {}).reduce((sum, value) => sum + Number(value || 0), 0);

/** Input-driven first-flight lesson. The route clock is held at sector-one's
 * starting line, while the normal combat, loot and wallet systems do the work. */
export class OpeningTutorial {
  constructor(game) {
    this.game = game;
    this.el = document.createElement('section');
    this.el.id = 'openingTutorial';
    this.el.className = 'hidden';
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = '<small>FIRST FLIGHT / TRAINING VECTOR</small><strong></strong><p></p><div><i></i></div><button type="button">SKIP TUTORIAL</button>';
    document.body.append(this.el);
    this.title = this.el.querySelector('strong');
    this.copy = this.el.querySelector('p');
    this.progress = this.el.querySelector('i');
    this.el.querySelector('button').addEventListener('click', () => this.complete({ skipped: true }));
    this.active = false;
    this.blocksRoute = false;
  }

  start({ testing = false, force = false } = {}) {
    this.stop();
    const queryForce = new URLSearchParams(location.search).get('tutorial') === '1';
    const explicitlyRequested = force || queryForce;
    const automatedRun = globalThis.navigator?.webdriver === true;
    // Testing and automation bypass onboarding by default, while an explicit
    // QA force remains authoritative in those workflows.
    this.active = explicitlyRequested || (!testing && !automatedRun && Save.data.tutorialComplete !== true);
    if (!this.active) return false;
    this.phase = 'await-flight';
    this.step = -1;
    this.stepTime = 0;
    this.enemy = null;
    this.trainingTarget = null;
    this.trainingSourceId = '';
    this.baseKills = this.game.stats.kills;
    this.baseScrap = this.game.scrap.wallet.earned;
    this.baseRanks = rankTotal(this.game);
    this.sawCache = false;
    this.lastFamily = this.inputFamily();
    this.blocksRoute = false;
    return true;
  }

  stop() {
    this.active = false;
    this.blocksRoute = false;
    this.el.classList.add('hidden');
  }

  armReplay() {
    Save.data.tutorialComplete = false;
    Save.save();
  }

  inputFamily() { return Input.lastInputFamily || (Input._padId ? 'controller' : 'keyboard'); }

  /** Config-owned cap/delay for the first authored Outer Defense segment. */
  approachPressure(sector, routeTime) {
    if (!this.active || sector !== 0 || this.blocksRoute || routeTime >= TUTORIAL_OPENING.routePressureSeconds) return null;
    return TUTORIAL_OPENING;
  }

  instruction(index) {
    const pad = this.inputFamily() === 'controller';
    return [
      ['TAKE THE HELM', pad ? 'Move with the LEFT STICK.' : 'Move with WASD or the ARROW KEYS.'],
      ['TEST THE CANNONS', pad ? 'Hold RT to fire.' : 'Hold SPACE to fire.'],
      ['IGNITE BOOST', pad ? 'Hold LT to boost.' : 'Hold SHIFT to boost.'],
      ['CUT THRUST', pad ? 'Hold A to brake.' : 'Hold C to brake.'],
      ['BARREL ROLL', pad ? 'Flick LEFT or RIGHT twice, returning the stick to center between flicks.' : 'Double-tap A / D or LEFT / RIGHT to roll.'],
      ['LIVE TARGET', 'Destroy the introductory scout. Its warning is delayed while you learn.'],
      ['PLUNDER THE WRECK', 'Fly into the glowing scrap. Collected scrap enters this run\'s wallet.'],
      ['READ THE RIFT', 'Rift Heat rewards sustained aggression. Shields recover after a safe delay. Three augment caches wait before every tower.'],
    ][index];
  }

  showStep(index) {
    this.step = index;
    this.stepTime = 0;
    const [title, copy] = this.instruction(index);
    this.title.textContent = `${index + 1}/9 · ${title}`;
    this.copy.textContent = copy;
    this.progress.style.width = `${(index + 1) / 9 * 100}%`;
    this.el.classList.remove('hidden', 'cacheLesson');
    this.game.hud.toast(title, copy, '#27f5da', { category: 'instruction', duration: 5.2 });
  }

  refreshInputCopy() {
    const family = this.inputFamily();
    if (family === this.lastFamily) return;
    this.lastFamily = family;
    if (this.phase === 'actions' && this.step >= 0 && this.step <= 7) {
      const [, copy] = this.instruction(this.step);
      this.copy.textContent = copy;
    } else if (this.phase === 'cache' && this.game.upgradeScreen.open) {
      this.copy.textContent = family === 'controller'
        ? 'Use the stick or D-pad, then HOLD A on a card to purchase it.'
        : 'Use A / D or the arrow keys, then HOLD SPACE on a card to purchase it.';
    }
  }

  spawnTarget() {
    if (this.enemy?.alive) return;
    const c = TUTORIAL_OPENING;
    this.enemy = this.game.enemies.spawn(c.enemyType, c.enemyX, c.enemyY, c.enemyZ, {
      fx: c.enemyX, fy: c.enemyY, fz: c.enemyZ, hpScale: c.enemyHpScale,
    });
    if (this.enemy) {
      this.trainingTarget = this.enemy.target;
      this.trainingSourceId = this.enemy.lootSourceId;
      this.enemy.fireT = c.fireDelay;
      this.enemy.special.cooldown = c.fireDelay;
      this.enemy.target.label = 'TRAINING SCOUT';
    }
  }

  advance() {
    if (this.step < 6) this.showStep(this.step + 1);
    else {
      this.phase = 'briefing';
      this.stepTime = 0;
      this.showStep(7);
    }
  }

  update(dt) {
    if (!this.active) return;
    this.refreshInputCopy();
    if (this.phase === 'await-flight') {
      if (this.game.director.state !== STATE.TRAVERSAL_1) return;
      this.phase = 'actions';
      this.blocksRoute = true;
      this.showStep(0);
    }
    this.stepTime += dt;
    if (this.phase === 'actions') {
      const p = this.game.player, movement = Input.read();
      let done = false;
      if (this.step === 0) done = Math.hypot(movement.x, movement.y) > .45;
      else if (this.step === 1) done = Input.firing;
      else if (this.step === 2) done = p.boosting || movement.boost;
      else if (this.step === 3) done = Input.braking;
      else if (this.step === 4) done = p.rollT > 0;
      else if (this.step === 5) {
        this.spawnTarget();
        done = this.game.stats.kills > this.baseKills;
      } else if (this.step === 6) done = this.game.scrap.wallet.earned > this.baseScrap;
      if (done && this.stepTime >= .22) this.advance();
      return;
    }
    if (this.phase === 'briefing') {
      if (this.stepTime >= TUTORIAL_OPENING.briefingSeconds) {
        this.phase = 'cache';
        this.blocksRoute = false;
        this.el.classList.add('hidden');
      }
      return;
    }
    if (this.phase === 'cache') {
      if (this.game.upgradeScreen.open) {
        const pad = this.inputFamily() === 'controller';
        this.title.textContent = '9/9 · INSTALL AN AUGMENT';
        this.copy.textContent = pad
          ? 'Use the stick or D-pad, then HOLD A on a card to purchase it.'
          : 'Use A / D or the arrow keys, then HOLD SPACE on a card to purchase it.';
        this.progress.style.width = '100%';
        this.el.classList.remove('hidden');
        this.el.classList.add('cacheLesson');
        this.sawCache = true;
      } else if (this.sawCache) {
        this.el.classList.add('hidden');
        if (rankTotal(this.game) > this.baseRanks) this.complete();
        else this.sawCache = false;
      }
    }
  }

  complete({ skipped = false } = {}) {
    if (!this.active) return;
    // A pooled training hull may already have been reused by an authored wave.
    // Retire only the exact training life; never clear legitimate route patrols.
    if (skipped && this.enemy?.alive && this.enemy.target === this.trainingTarget &&
        this.enemy.lootSourceId === this.trainingSourceId) this.enemy.despawn();
    Save.data.tutorialComplete = true;
    Save.save();
    this.stop();
    this.game.hud.toast(skipped ? 'TRAINING SKIPPED' : 'FIRST FLIGHT COMPLETE',
      skipped ? 'The tutorial can be replayed from interface settings.' : 'Captain certified · take the Outer Defense Tower.',
      '#27f5da', { category: 'instruction', duration: 4.6 });
  }
}
