import * as THREE from 'three';
import { STATE, COMBAT_STATES, UPGRADE_STATES } from './GameState.js';
import { P, IDENTITY } from './Palette.js';
import { TRAVERSAL } from '../config/encounters.js';
import { OuterDefenseTower } from '../encounters/OuterDefenseTower.js';
import { MidriftPressureTower } from '../encounters/MidriftPressureTower.js';
import { InnerCitadelTower } from '../encounters/InnerCitadelTower.js';
import { InhibitorEncounter } from '../encounters/InhibitorEncounter.js';
import { RiftAdmiralBoss } from '../encounters/RiftAdmiralBoss.js';
import { BossIntroSequence } from '../ui/BossIntroSequence.js';
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
    this.intro = new BossIntroSequence(game);
  }

  reset() {
    this.clearPresentation();
    this.state = STATE.MENU;
    this.stateT = 0;
    this.data = {};
  }

  clearPresentation() {
    this.intro.end();
    clearTimeout(this._tcT);
    $('titleCard').classList.add('hidden');
  }

  go(state) {
    this.exit(this.state);
    this.state = state;
    this.stateT = 0;
    this.data = {};
    this.enter(state);
  }

  get inCombat() {
    return COMBAT_STATES.has(this.state) && !this.data.awaitingAugment;
  }

  get inUpgrade() {
    return UPGRADE_STATES.has(this.state) || !!this.data.awaitingAugment;
  }

  // ---------------------------------------------------------------- lifecycle

  exit(state) {
    const g = this.game;
    this.intro.end();
    if (COMBAT_STATES.has(state)) g.scheduler.cancelTag('encounter');
    if (state === STATE.ESCAPE) {
      g.escape.dispose();
      g.hud.stopTimer();
      g.hud.clearObjective();
    }
  }

  enter(state) {
    const g = this.game;

    switch (state) {
      case STATE.INTRO: {
        g.setWorldMood(IDENTITY.tower1.hex, 0.8, 0.78);
        g.hud.show();
        g.camera3.setMode('traversal');
        g.env.setSpeed(TRAVERSAL_SPEED);
        g.hud.banner('LEVEL 1: RIFT APPROACH', P.cyan);
        g.hud.toast('PLUNDER. UPGRADE. BREAK THE NEXUS.', '', P.magenta);
        Audio2.playGameplay(1.5);
        break;
      }

      // ---- traversal sectors ----
      case STATE.TRAVERSAL_1:
        this._enterTraversal(TRAVERSAL.sector1, 'OUTER DEFENSE TOWER', 0.1, IDENTITY.tower1);
        break;
      case STATE.TRAVERSAL_2:
        this._enterTraversal(TRAVERSAL.sector2, 'MIDRIFT PRESSURE TOWER', 0.3, IDENTITY.tower2);
        g.hud.toast('MIDRIFT SECTOR', 'GRAVITY IS UNSTABLE HERE', P.violet);
        break;
      case STATE.TRAVERSAL_3:
        this._enterTraversal(TRAVERSAL.sector3, 'INNER CITADEL', 0.6, IDENTITY.tower3);
        g.hud.toast('INNER RIFT', 'ELITE PATROLS INBOUND', P.red);
        break;
      case STATE.INHIBITOR_APPROACH:
        this._enterTraversal(TRAVERSAL.inhibitorApproach, 'INHIBITOR CORE', 0.85, IDENTITY.inhibitor);
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
        this._enterRecovery(IDENTITY.tower1.main, STATE.TRAVERSAL_2);
        break;
      case STATE.UPGRADE_2:
        this._enterRecovery(IDENTITY.tower2.main, STATE.TRAVERSAL_3);
        break;
      case STATE.UPGRADE_3:
        this._enterRecovery(IDENTITY.tower3.main, STATE.INHIBITOR_APPROACH);
        break;
      case STATE.UPGRADE_4:
        this._enterRecovery(IDENTITY.inhibitor.main, STATE.NEXUS_TRANSITION);
        break;
      case STATE.UPGRADE_5:
        this._enterUpgrade(4, IDENTITY.boss.main, STATE.BOSS_INTRO);
        break;

      // ---- the Nexus ----
      case STATE.NEXUS_TRANSITION:
        g.setWorldMood(IDENTITY.boss.hex, 1.5, 1.02);
        this._enterNexusTransition();
        break;
      case STATE.BOSS_INTRO:
        g.setWorldMood(IDENTITY.boss.hex, 1.65, 1.08);
        this._enterBossIntro();
        break;
      case STATE.BOSS_COMBAT:
        g.encounter.begin();
        Audio2.playBattle(1.2);
        break;

      case STATE.ESCAPE:
        this._disposeEncounter();
        g.scheduler.clear();
        g.enemies.clear();
        g.clearHazards();
        g.projectiles.reset();
        g.projectileBlockers.length = 0;
        g.env.clearAll();
        g.env.clearApproach();
        g.closeNexusRift();
        g.camera3.setMode('traversal');
        g.player.frozen = false;
        g.setWorldMood(0x9132e9, 1.35, .84);
        g.hud.clearObjective();
        g.hud.setObjective('REACH THE FINAL RIFT', 'THE GALAXY IS COLLAPSING', P.cyan);
        g.hud.banner('THE NEXUS IS GONE. THE COLLAPSE HAS BEGUN.', P.violet);
        g.hud.toast('REACH THE FINAL RIFT', 'HOLD BOOST · STEER THROUGH CYAN OPENINGS', P.cyan);
        g.escape.start();
        g.hud.startTimer(g.escape.remaining, 'GALACTIC COLLAPSE');
        Audio2.playEscape(.7, { restart: true });
        g.syncMusicPause();
        break;

      case STATE.VICTORY:
        g.setWorldMood(0xffc53d, 1.2, 0.92);
        g.env.setSpeed(6);
        g.camera3.setMode('tower');
        g.hud.banner(g._escapeCleared ? 'RIFT REACHED. YOU MADE IT.' : 'NEXUS BROKEN', P.gold);
        break;

      default:
        break;
    }
  }

  // ------------------------------------------------------------------ helpers

  _enterTraversal(cfg, nextName, nexusPresence, identity) {
    const g = this.game;
    this.data.cfg = cfg;
    this.data.spawnT = 1.5;
    this.data.crateT = rand(6, 10);
    this.data.gatesLeft = cfg.gates || 0;
    this.data.gateT = rand(8, 14);
    this.data.cratesLeft = cfg.scrapCrates || 0;
    this.data.sector = cfg.sector;
    this.data.picks = 0;
    this.data.awaitingAugment = false;
    this.data.identity = identity;
    this.data.nextName = nextName;
    this.data.eventIndex = 0;
    this.data.beatIndex = -1;
    this.data.bounty = null;
    this.data.bountyResolved = false;

    g.env.clearApproach();
    g.camera3.setMode('traversal');
    g.env.setSpeed(TRAVERSAL_SPEED);
    g.env.setNexusPresence(nexusPresence);
    g.setWorldMood(identity.hex, 0.82 + nexusPresence * 0.18, 0.76 + nexusPresence * 0.12);
    g.hud.clearObjective();
    g.hud.el.objective.textContent = `APPROACHING: ${nextName}`;
    g.hud.setApproach(nextName, identity.main, cfg.augmentAt.map(at => at / cfg.duration));
    if (cfg.authored) {
      g.env.setApproachProgress(0, identity.main);
      this._updateApproachBeat();
    }
    Audio2.playGameplay(2);
  }

  _enterObjectiveIntro(encounter, identity, index, music) {
    const g = this.game;
    g.encounter = encounter;
    g.player.blocksLeft = g.player.stats.freeBlocks;
    g.env.clearApproach();
    g.env.clearAll();
    g.projectiles.reset();
    g.hud.clearApproach();

    // forward travel slows, the camera pulls back, the structure enters view
    g.env.setSpeed(COMBAT_SPEED);
    g.camera3.setMode('tower');
    g.enemies.clear();
    g.clearHazards();
    g.setWorldMood(identity.hex, 1.28, 0.94);

    g.hud.setObjective(identity.name, identity.sub, identity.main);
    g.hud.setWeakPoints(encounter.modules);
    this.intro.start(identity, encounter, index);
    this.data.dur = this.intro.duration;

    // a more intense layer under the objective
    Audio2.playBattle(1.5, { restart: true });
    Audio2.play('laser_warning', 0.4, 0.7);
  }

  _enterUpgrade(cacheIndex, color, nextState) {
    const g = this.game;
    this.data.next = nextState;

    // combat briefly slows and the loot flies in before the cards appear
    g.env.setSpeed(2);
    g.enemies.clear();
    g.clearHazards();
    g.projectiles.reset();
    g.setWorldMood(color, 0.72, 0.8);

    g.after(0.9, () => {
      g.upgradeScreen.show(cacheIndex, color, () => {
        // camera reorients toward the next sector, forward movement resumes
        g.camera3.setMode('traversal');
        this.go(nextState);
      });
    });
  }

  /** Cards now arrive before objectives; a cleared tower grants a short repair. */
  _enterRecovery(color, nextState) {
    const g = this.game;
    g.env.setSpeed(2);
    g.enemies.clear();
    g.clearHazards();
    g.projectiles.reset();
    g.env.clearAll();
    g.player.heal(30);
    g.player.boost = g.player.stats.boostCapacity;
    g.hud.toast('SECTOR SECURED', 'Hull repaired · boost restored · shield recovery continues', color);
    g.after(1.4, () => this.go(nextState));
  }

  _openApproachAugment() {
    const g = this.game;
    const d = this.data;
    if (d.awaitingAugment || d.picks >= 3) return;
    d.awaitingAugment = true;
    // Remove incoming fire before the choice; surviving enemies resume after it.
    g.projectiles.reset();
    g.clearHazards();
    g.env.clearAll();
    Input.enabled = false;
    Input.reset();
    g.upgradeScreen.show({ sector: d.sector, checkpoint: d.picks }, d.identity.main, () => {
      if (this.data !== d || !g.running || !d.awaitingAugment) return;
      d.picks += 1;
      d.awaitingAugment = false;
      g.player.invuln = Math.max(g.player.invuln, 1.6);
      g.player.refundBoost(35);
      g.player.heal(12);
      for (const e of g.enemies.active) {
        e.fireT = Math.max(e.fireT, 1.6);
        e.burstLeft = 0;
      }
      Input.reset();
      Input.enabled = true;
      g.hud.toast(`AUGMENT ${d.picks}/3 INSTALLED`, d.picks === 3 ? 'BUILD READY — BREACH THE TOWER' : 'Next cache marked on your route', d.identity.main);
    });
  }

  _updateApproachBeat() {
    const g = this.game;
    const d = this.data;
    const beats = d.cfg.authored?.beats;
    if (!beats) return;
    const index = beats.findLastIndex(beat => this.stateT >= beat.at);
    if (index === d.beatIndex) return;
    d.beatIndex = index;
    const beat = beats[index];
    g.env.setSpeed(beat.speed);
    g.hud.banner(beat.title, d.identity.main);
    g.hud.toast(beat.title, beat.detail, d.identity.main);
  }

  _approachEvent(event) {
    const g = this.game;
    const d = this.data;
    if (event.cue) g.hud.toast(event.cue, event.hint, P.gold);
    if (event.type === 'wave') {
      this._makePatrolRoom(event.enemies.length);
      const side = event.formation === 'left' ? -1 : event.formation === 'right' ? 1 : 0;
      event.enemies.forEach((type, i) => {
        if (g.enemies.countAlive() >= (d.cfg.maxEnemies ?? 7)) return;
        const slot = i - (event.enemies.length - 1) / 2;
        const x = side ? side * 12 + slot * 4 : slot * 9;
        g.enemies.spawn(type, x, 5 + Math.abs(slot) * 2, -95 - i * 5, {
          fx: x, fy: 3 + Math.abs(slot) * 2, fz: -30 - Math.abs(slot) * 4,
        });
      });
    } else if (event.type === 'salvage') {
      g.env.spawnCrate({ x: event.x, y: event.y });
      g.scrap.burst(event.x, event.y, -65, 18, 0.2);
      g.hud.toast('SALVAGE LANE', event.x < 0 ? 'Gold cache on your left' : event.x > 0 ? 'Gold cache on your right' : 'Gold cache ahead', P.gold);
    } else if (event.type === 'gate') {
      g.env.spawnGate({ x: event.x, y: event.y, rotation: event.rotation, spin: 0, drift: 0 });
      g.hud.toast('LASER GATE INBOUND', 'Roll or steer around the magenta beam', P.magenta);
    } else if (event.type === 'ace') {
      // Guarantee space for the priority target even if the patrol is still alive.
      this._makePatrolRoom(1);
      const ace = g.enemies.spawn('elite', 0, 7, -100, { fx: 0, fy: 5, fz: -27, hpScale: 0.7, elite: true, scrapScale: 3 });
      if (ace) {
        ace.target.label = 'BLOCKADE ACE';
        d.bounty = ace.target;
        g.hud.toast('BOUNTY: BLOCKADE ACE', 'Destroy the pink captain for +1,500 score and repairs', P.pink);
      }
    }
  }

  _makePatrolRoom(incoming) {
    const enemies = this.game.enemies;
    while (enemies.countAlive() + incoming > (this.data.cfg.maxEnemies ?? 7)) {
      const index = enemies.active.findIndex(e => e.alive && e.target !== this.data.bounty);
      if (index < 0) break;
      // Remove from the active list before the pool can reuse the same object.
      const [retiring] = enemies.active.splice(index, 1);
      retiring.despawn();
    }
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
    Audio2.playGameplay(3);
    Audio2.play('overload', 0.8, 0.7);

    this.data.dur = 10;
    this.data.skippable = g.save.data.seenIntro > 0;
    if (this.data.skippable) $('skipHint').classList.remove('hidden');
    if (!g.testRun) {
      g.save.data.seenIntro = 1;
      g.save.save();
    }
  }

  _enterBossIntro() {
    const g = this.game;
    Audio2.playBattle(1.5, { restart: true });
    $('skipHint').classList.add('hidden');
    g.env.warpStars(0);
    g.env.setSpeed(3);
    g.camera3.setMode('boss');
    g.setWorldMood(IDENTITY.boss.hex, 1.28, 0.88);
    g.enemies.clear();
    g.clearHazards();
    g.projectiles.reset();
    g.env.clearAll();

    g.encounter = new RiftAdmiralBoss(g);
    g.player.blocksLeft = g.player.stats.freeBlocks;
    g.hud.setObjective(IDENTITY.boss.name, IDENTITY.boss.sub, IDENTITY.boss.main);
    g.hud.setWeakPoints(g.encounter.modules);
    g.hud.setBossPhase(1, 'RIFT ADMIRAL');

    // the arena stays dark; he arrives out of it
    g.encounter.group.visible = true;
    this.data.spoke = false;

    Audio2.play('boss_taunt', 0.9, 0.75);
    this.intro.start(IDENTITY.boss, g.encounter, 5);
    this.data.dur = this.intro.duration;
  }

  // -------------------------------------------------------------------- update

  update(dt) {
    const g = this.game;
    if (this.data.awaitingAugment) return;
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
        if (this.data.picks < 3 && t >= this.data.cfg.augmentAt[this.data.picks]) {
          this._openApproachAugment();
          break;
        }
        this._updateTraversal(dt);
        const cfg = this.data.cfg;
        if (t > cfg.duration && this.data.picks === 3) {
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
        // Cinematic title and camera move share the paused simulation clock.
        if (this.intro.update(t)) {
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
          if (g.testing?.active) {
            g.hud.el.objective.textContent = 'ENCOUNTER CLEARED / F2 TO REPLAY OR SWITCH';
            break;
          }
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
          Audio2.play('boss_taunt', 1, 0.6);
        }

        if (this.intro.update(t)) {
          // Skipping still leaves the final encounter at its authored position.
          enc.group.position.z = -62;
          for (const eye of enc.parts.eyes) eye.material.opacity = 1;
          this.go(STATE.BOSS_COMBAT);
        }
        break;
      }

      case STATE.BOSS_COMBAT:
        if (chance(dt * 0.15)) g.env.spawnAsteroid(true);
        // The destruction callback opens the escape before victory is possible.
        break;

      case STATE.ESCAPE:
        g.escape.update(dt);
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
      // Admiral portals are scene children, rather than part of his hull.
      for (const portal of g.encounter.portals || []) {
        portal.mesh.removeFromParent();
        portal.mesh.geometry?.dispose();
        portal.mesh.material?.dispose();
      }
      if (g.encounter.portals) g.encounter.portals.length = 0;
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

    if (cfg.authored) {
      this._updateApproachBeat();
      g.env.setApproachProgress(this.stateT / cfg.duration, d.identity.main);
      const events = cfg.authored.events;
      while (d.eventIndex < events.length && this.stateT >= events[d.eventIndex].at) {
        this._approachEvent(events[d.eventIndex++]);
      }
      if (d.bounty && !d.bountyResolved && !d.bounty.alive && d.bounty.hp <= 0) {
        d.bountyResolved = true;
        g.score.add(1500, 'BLOCKADE BOUNTY');
        g.player.heal(25);
        g.hud.toast('BOUNTY CLAIMED', '+1,500 base score · +25 hull', P.gold);
        g.fx.explode(g.player.x, g.player.y, 0, { count: 22, colors: [P.gold, P.cyan], power: 12, gravity: 0 });
      }
      const beat = cfg.authored.beats[d.beatIndex];
      if (chance(dt * beat.asteroidRate)) g.env.spawnAsteroid();
      if (chance(dt * 0.2)) g.env.spawnWreck();
      return;
    }

    // enemies
    d.spawnT -= dt;
    if (d.spawnT <= 0) {
      d.spawnT = rand(...cfg.spawnInterval);
      if (g.enemies.countAlive() < (cfg.maxEnemies ?? 7)) {
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
