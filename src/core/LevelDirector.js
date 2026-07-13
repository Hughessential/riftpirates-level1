import * as THREE from 'three';
import { STATE, COMBAT_STATES, UPGRADE_STATES } from './GameState.js';
import { P, IDENTITY } from './Palette.js';
import { TRAVERSAL } from '../config/encounters.js';
import { OuterDefenseTower } from '../encounters/OuterDefenseTower.js';
import { MidriftPressureTower } from '../encounters/MidriftPressureTower.js';
import { InnerCitadelTower } from '../encounters/InnerCitadelTower.js';
import { InhibitorEncounter } from '../encounters/InhibitorEncounter.js';
import { RiftAdmiralBoss } from '../encounters/RiftAdmiralBoss.js';
import { Audio2 } from './AudioManager.js';
import { Input } from './Input.js';
import { rand, chance, clamp, pick, $ } from './Utils.js';

const TRAVERSAL_SPEED = 38;
const COMBAT_SPEED = 5; // the world keeps drifting so a tower fight never feels static

/**
 * The whole level, start to finish (spec §3, §36). Every transition happens
 * here: the player is never sent back to a menu between encounters — combat
 * slows, a card is dealt, the camera reorients, and forward motion resumes.
 */
export class LevelDirector {
  constructor(game) {
    this.game = game;
    this.state = STATE.MENU;
    this.stateT = 0;
    this.data = {};
  }

  reset() {
    this.state = STATE.MENU;
    this.stateT = 0;
    this.data = {};
  }

  go(state) {
    this.exit(this.state);
    this.state = state;
    this.stateT = 0;
    this.data = {};
    this.enter(state);
  }

  get inCombat() {
    return COMBAT_STATES.has(this.state);
  }

  get inUpgrade() {
    return UPGRADE_STATES.has(this.state);
  }

  // ---------------------------------------------------------------- lifecycle

  exit(state) {
    const g = this.game;
    if (COMBAT_STATES.has(state)) g.scheduler.cancelTag('encounter');
  }

  enter(state) {
    const g = this.game;

    switch (state) {
      case STATE.INTRO: {
        g.hud.show();
        g.camera3.setMode('traversal');
        g.env.setSpeed(TRAVERSAL_SPEED);
        g.hud.banner('LEVEL 1: RIFT APPROACH', P.cyan);
        g.hud.toast('PLUNDER. UPGRADE. BREAK THE NEXUS.', '', P.magenta);
        Audio2.playMusic('level1_a', 1.5);
        break;
      }

      // ---- traversal sectors ----
      case STATE.TRAVERSAL_1:
        this._enterTraversal(TRAVERSAL.sector1, 'OUTER DEFENSE TOWER', 0.1);
        break;
      case STATE.TRAVERSAL_2:
        this._enterTraversal(TRAVERSAL.sector2, 'MIDRIFT PRESSURE TOWER', 0.3);
        g.hud.toast('MIDRIFT SECTOR', 'GRAVITY IS UNSTABLE HERE', P.violet);
        break;
      case STATE.TRAVERSAL_3:
        this._enterTraversal(TRAVERSAL.sector3, 'INNER CITADEL', 0.6);
        g.hud.toast('INNER RIFT', 'ELITE PATROLS INBOUND', P.red);
        break;
      case STATE.INHIBITOR_APPROACH:
        this._enterTraversal(TRAVERSAL.inhibitorApproach, 'INHIBITOR CORE', 0.85);
        g.hud.banner('THE INHIBITOR AWAITS', P.orange);
        break;

      // ---- objective intros ----
      case STATE.TOWER_1_INTRO:
        this._enterObjectiveIntro(new OuterDefenseTower(g), IDENTITY.tower1, 1, 'level1_a');
        break;
      case STATE.TOWER_2_INTRO:
        this._enterObjectiveIntro(new MidriftPressureTower(g), IDENTITY.tower2, 2, 'level1_b');
        break;
      case STATE.TOWER_3_INTRO:
        this._enterObjectiveIntro(new InnerCitadelTower(g), IDENTITY.tower3, 3, 'level1_c');
        break;
      case STATE.INHIBITOR_INTRO:
        this._enterObjectiveIntro(new InhibitorEncounter(g), IDENTITY.inhibitor, 4, 'level1_c');
        break;

      // ---- objective combat ----
      case STATE.TOWER_1_COMBAT:
      case STATE.TOWER_2_COMBAT:
      case STATE.TOWER_3_COMBAT:
      case STATE.INHIBITOR_COMBAT:
        g.encounter.begin();
        break;

      // ---- upgrades ----
      case STATE.UPGRADE_1:
        this._enterUpgrade(0, IDENTITY.tower1.main, STATE.TRAVERSAL_2);
        break;
      case STATE.UPGRADE_2:
        this._enterUpgrade(1, IDENTITY.tower2.main, STATE.TRAVERSAL_3);
        break;
      case STATE.UPGRADE_3:
        this._enterUpgrade(2, IDENTITY.tower3.main, STATE.INHIBITOR_APPROACH);
        break;
      case STATE.UPGRADE_4:
        this._enterUpgrade(3, IDENTITY.inhibitor.main, STATE.NEXUS_TRANSITION);
        break;
      case STATE.UPGRADE_5:
        this._enterUpgrade(4, IDENTITY.boss.main, STATE.BOSS_INTRO);
        break;

      // ---- the Nexus ----
      case STATE.NEXUS_TRANSITION:
        this._enterNexusTransition();
        break;
      case STATE.BOSS_INTRO:
        this._enterBossIntro();
        break;
      case STATE.BOSS_COMBAT:
        g.encounter.begin();
        Audio2.playMusic('boss', 1.2);
        break;

      case STATE.VICTORY:
        g.env.setSpeed(6);
        g.camera3.setMode('tower');
        g.hud.banner('NEXUS BROKEN', P.gold);
        break;

      default:
        break;
    }
  }

  // ------------------------------------------------------------------ helpers

  _enterTraversal(cfg, nextName, nexusPresence) {
    const g = this.game;
    this.data.cfg = cfg;
    this.data.spawnT = 1.5;
    this.data.crateT = rand(6, 10);
    this.data.gatesLeft = cfg.gates || 0;
    this.data.gateT = rand(8, 14);
    this.data.cratesLeft = cfg.scrapCrates || 0;

    g.camera3.setMode('traversal');
    g.env.setSpeed(TRAVERSAL_SPEED);
    g.env.setNexusPresence(nexusPresence);
    g.hud.clearObjective();
    g.hud.el.objective.textContent = `APPROACHING: ${nextName}`;
    if (cfg.music) Audio2.playMusic(cfg.music, 2);
  }

  _enterObjectiveIntro(encounter, identity, index, music) {
    const g = this.game;
    g.encounter = encounter;

    // forward travel slows, the camera pulls back, the structure enters view
    g.env.setSpeed(COMBAT_SPEED);
    g.camera3.setMode('tower');
    g.enemies.clear();
    g.clearHazards();

    g.hud.setObjective(identity.name, identity.sub, identity.main);
    g.hud.setWeakPoints(encounter.modules);
    this._titleCard(index, identity);

    // a more intense layer under the objective
    if (music) Audio2.playMusic(music, 1.5);
    Audio2.play('laser_warning', 0.4, 0.7);
    g.camera3.shake(0.3);
  }

  _titleCard(index, identity) {
    const card = $('titleCard');
    $('tcNum').textContent = index === 4 ? 'OBJECTIVE 4' : `OBJECTIVE ${index}`;
    $('tcName').textContent = identity.name;
    $('tcSub').textContent = identity.sub;
    card.style.setProperty('--tc', identity.main);
    card.classList.remove('hidden');
    card.classList.remove('in');
    void card.offsetWidth;
    card.classList.add('in');
    clearTimeout(this._tcT);
    this._tcT = setTimeout(() => {
      card.classList.remove('in');
      setTimeout(() => card.classList.add('hidden'), 400);
    }, 2400);
  }

  _enterUpgrade(cacheIndex, color, nextState) {
    const g = this.game;
    this.data.next = nextState;

    // combat briefly slows and the loot flies in before the cards appear
    g.env.setSpeed(2);
    g.enemies.clear();
    g.clearHazards();
    g.projectiles.reset();

    g.after(0.9, () => {
      g.upgradeScreen.show(cacheIndex, color, () => {
        // camera reorients toward the next sector, forward movement resumes
        g.camera3.setMode('traversal');
        this.go(nextState);
      });
    });
  }

  /** The Nexus jump (spec §21): 10 seconds, skippable once you've seen it. */
  _enterNexusTransition() {
    const g = this.game;
    g.camera3.setMode('cinematic');
    g.enemies.clear();
    g.clearHazards();
    g.env.clearAll();
    g.hud.clearObjective();
    g.hud.el.objective.textContent = 'ENTERING THE NEXUS';
    Audio2.playMusic('boss', 3);
    Audio2.play('overload', 0.8, 0.7);

    this.data.dur = 10;
    this.data.skippable = g.save.data.seenIntro > 0;
    if (this.data.skippable) $('skipHint').classList.remove('hidden');
    g.save.data.seenIntro = 1;
    g.save.save();
  }

  _enterBossIntro() {
    const g = this.game;
    $('skipHint').classList.add('hidden');
    g.env.warpStars(0);
    g.env.setSpeed(3);
    g.camera3.setMode('boss');

    g.encounter = new RiftAdmiralBoss(g);
    g.hud.setObjective(IDENTITY.boss.name, IDENTITY.boss.sub, IDENTITY.boss.main);
    g.hud.setWeakPoints(g.encounter.modules);
    g.hud.setBossPhase(1, 'RIFT ADMIRAL');

    // the arena stays dark; he arrives out of it
    g.encounter.group.visible = true;
    this.data.dur = 6.5;
    this.data.spoke = false;

    Audio2.play('boss_taunt', 0.9, 0.75);
    this._titleCard(5, IDENTITY.boss);
    g.camera3.shake(0.8);
  }

  // -------------------------------------------------------------------- update

  update(dt) {
    const g = this.game;
    this.stateT += dt;
    const t = this.stateT;

    switch (this.state) {
      case STATE.INTRO:
        if (t > 2.2) this.go(STATE.TRAVERSAL_1);
        break;

      case STATE.TRAVERSAL_1:
      case STATE.TRAVERSAL_2:
      case STATE.TRAVERSAL_3:
      case STATE.INHIBITOR_APPROACH: {
        this._updateTraversal(dt);
        const cfg = this.data.cfg;
        if (t > cfg.duration) {
          const next = {
            [STATE.TRAVERSAL_1]: STATE.TOWER_1_INTRO,
            [STATE.TRAVERSAL_2]: STATE.TOWER_2_INTRO,
            [STATE.TRAVERSAL_3]: STATE.TOWER_3_INTRO,
            [STATE.INHIBITOR_APPROACH]: STATE.INHIBITOR_INTRO,
          }[this.state];
          this.go(next);
        }
        break;
      }

      case STATE.TOWER_1_INTRO:
      case STATE.TOWER_2_INTRO:
      case STATE.TOWER_3_INTRO:
      case STATE.INHIBITOR_INTRO: {
        // hold until the objective is clearly visible, then start the fight
        if (t > 2.8) {
          const next = {
            [STATE.TOWER_1_INTRO]: STATE.TOWER_1_COMBAT,
            [STATE.TOWER_2_INTRO]: STATE.TOWER_2_COMBAT,
            [STATE.TOWER_3_INTRO]: STATE.TOWER_3_COMBAT,
            [STATE.INHIBITOR_INTRO]: STATE.INHIBITOR_COMBAT,
          }[this.state];
          this.go(next);
        }
        break;
      }

      case STATE.TOWER_1_COMBAT:
      case STATE.TOWER_2_COMBAT:
      case STATE.TOWER_3_COMBAT:
      case STATE.INHIBITOR_COMBAT: {
        // keep a light trickle of debris so the arena still feels alive
        if (chance(dt * 0.25)) g.env.spawnAsteroid(true);

        if (g.encounter && g.encounter.isDefeated) {
          const next = {
            [STATE.TOWER_1_COMBAT]: STATE.UPGRADE_1,
            [STATE.TOWER_2_COMBAT]: STATE.UPGRADE_2,
            [STATE.TOWER_3_COMBAT]: STATE.UPGRADE_3,
            [STATE.INHIBITOR_COMBAT]: STATE.UPGRADE_4,
          }[this.state];
          this._disposeEncounter();
          this.go(next);
        }
        break;
      }

      case STATE.UPGRADE_1:
      case STATE.UPGRADE_2:
      case STATE.UPGRADE_3:
      case STATE.UPGRADE_4:
      case STATE.UPGRADE_5:
        // the UpgradeScreen callback drives the transition
        break;

      case STATE.NEXUS_TRANSITION: {
        const k = clamp(t / this.data.dur, 0, 1);

        // player accelerates, stars stretch, the screen fills with purple light
        g.env.setSpeed(38 + k * 190);
        g.env.warpStars(Math.pow(k, 1.8));
        g.camera3.shake(dt * 1.4 * k);

        const fade = $('nexusFade');
        fade.style.opacity = String(k < 0.75 ? k * 0.75 : 1 - (k - 0.75) * 0.5);

        if (g.rift) {
          g.rift.position.z += (38 + k * 190) * dt;
          g.rift.rotation.z += dt * (1 + k * 6);
          const s = 1 + k * 5;
          g.rift.scale.set(s, s, s);
        }

        const skip = this.data.skippable && (Input.consumeKey('Space') || Input.consumeKey('Enter'));
        if (k >= 1 || skip) {
          fade.style.opacity = '0';
          $('skipHint').classList.add('hidden');
          g.closeNexusRift();
          this.go(STATE.UPGRADE_5);
        }
        break;
      }

      case STATE.BOSS_INTRO: {
        const enc = g.encounter;
        const k = clamp(t / this.data.dur, 0, 1);

        // he rises out of the dark: eyes first, then the cannons power on
        enc.group.position.z = -110 + 48 * Math.min(1, k * 1.4);
        for (const e of enc.parts.eyes) {
          e.material.opacity = clamp((k - 0.15) * 3, 0, 1);
        }

        if (!this.data.spoke && t > 2.6) {
          this.data.spoke = true;
          g.hud.banner('I AM THE NEXUS. I AM THE LAW. I AM YOUR END.', P.magenta);
          Audio2.play('boss_taunt', 1, 0.6);
          g.camera3.shake(0.9);
        }

        if (t > this.data.dur) this.go(STATE.BOSS_COMBAT);
        break;
      }

      case STATE.BOSS_COMBAT:
        if (chance(dt * 0.15)) g.env.spawnAsteroid(true);
        // victory is signalled by the boss via game.onBossDefeated()
        break;

      case STATE.VICTORY:
        if (t > 2.6 && !this.data.shown) {
          this.data.shown = true;
          g.showResults({ victory: true });
        }
        break;

      default:
        break;
    }
  }

  _disposeEncounter() {
    const g = this.game;
    if (g.encounter) {
      g.encounter.dispose();
      g.encounter = null;
    }
    g.hud.clearObjective();
  }

  /** Traversal spawning: enemies, rocks, gates and caches, paced by config. */
  _updateTraversal(dt) {
    const g = this.game;
    const cfg = this.data.cfg;
    const d = this.data;

    // enemies
    d.spawnT -= dt;
    if (d.spawnT <= 0) {
      d.spawnT = rand(...cfg.spawnInterval);
      if (g.enemies.countAlive() < 7) {
        g.enemies.spawnOffscreen(pick(cfg.types), { fz: rand(-38, -20) });
      }
    }

    // rocks and scenery
    if (chance(dt * cfg.asteroidRate * 2.2)) g.env.spawnAsteroid();
    if (chance(dt * cfg.asteroidRate * 1.4)) g.env.spawnDebris();
    if (chance(dt * 0.18)) g.env.spawnWreck();
    if (cfg.ceremonial && chance(dt * 0.5)) g.env.spawnPylon();

    // laser gates
    if (d.gatesLeft > 0) {
      d.gateT -= dt;
      if (d.gateT <= 0) {
        d.gateT = rand(9, 15);
        d.gatesLeft -= 1;
        g.env.spawnGate();
        g.hud.toast('LASER GATE', 'AHEAD', P.magenta);
      }
    }

    // scrap caches
    if (d.cratesLeft > 0) {
      d.crateT -= dt;
      if (d.crateT <= 0) {
        d.crateT = rand(11, 17);
        d.cratesLeft -= 1;
        g.env.spawnCrate();
      }
    }
  }
}
