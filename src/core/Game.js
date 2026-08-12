import * as THREE from 'three';
import { P } from './Palette.js';
import { STATE, COMBAT_STATES, SAFE_STATES } from './GameState.js';
import { Save } from './SaveSystem.js';
import { Audio2 } from './AudioManager.js';
import { Input } from './Input.js';
import { Scheduler } from './Scheduler.js';
import { CameraRig } from './CameraRig.js';
import { LevelDirector } from './LevelDirector.js';

import { initTextures, buildVoxels, glowSprite, Tex } from '../render/VoxelBuilder.js';
import { Environment } from '../render/Environment.js';

import { Player, BASE_STATS } from '../player/Player.js';
import { PlayerWeapon } from '../player/PlayerWeapon.js';

import { ProjectilePool } from '../combat/ProjectilePool.js';
import { TargetingSystem } from '../combat/TargetingSystem.js';
import { CollisionSystem } from '../combat/CollisionSystem.js';

import { EnemySpawner } from '../enemies/EnemySpawner.js';

import { ParticlePool } from '../effects/ParticlePool.js';
import { DamageNumbers } from '../effects/DamageNumbers.js';
import { DeathSequence } from '../effects/DeathSequence.js';

import { RiftHeatSystem } from '../systems/RiftHeatSystem.js';
import { ScoreSystem } from '../systems/ScoreSystem.js';
import { ScrapSystem } from '../systems/ScrapSystem.js';
import { UpgradeSystem } from '../systems/UpgradeSystem.js';
import { XPSystem } from '../systems/XPSystem.js';

import { HUD } from '../ui/HUD.js';
import { UpgradeScreen } from '../ui/UpgradeScreen.js';
import { ResultsScreen } from '../ui/ResultsScreen.js';

import { $, clamp } from './Utils.js';

/**
 * Game owns the scene, the systems, and the update order. LevelDirector owns
 * *what happens when*; Game owns *what exists*.
 */
export class Game {
  constructor() {
    this.save = Save;
    this.audio = Audio2;

    // --- renderer ---
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(new THREE.Color(P.fog), 0.0075);

    this.camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 500);
    this.camera.position.set(0, 4.6, 11);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(new THREE.Color(P.ink), 1);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    document.body.insertBefore(this.renderer.domElement, document.body.firstChild);

    this.scene.add(new THREE.HemisphereLight(0x8a7bff, 0x1a0b3a, 0.9));
    const sun = new THREE.DirectionalLight(0xffe9ff, 0.8);
    sun.position.set(6, 14, 10);
    this.scene.add(sun);
    // rim light from the player's side so hulls read against the void
    const rim = new THREE.DirectionalLight(0x22d3ee, 0.35);
    rim.position.set(-8, 2, 14);
    this.scene.add(rim);

    initTextures();

    // --- shared state buckets ---
    this.targets = [];
    this.hazards = [];
    this.projectileBlockers = [];
    this.encounter = null;
    this.rift = null;

    // --- systems ---
    this.scheduler = new Scheduler();
    this.camera3 = new CameraRig(this.camera);
    this.fx = new ParticlePool(this.scene);
    this.damageNumbers = new DamageNumbers(this.camera);
    this.env = new Environment(this.scene, this);

    this.player = new Player(this.scene, this.fx);
    this.projectiles = new ProjectilePool(this.scene);
    this.targeting = new TargetingSystem();
    this.weapon = new PlayerWeapon(this.player, this.projectiles, this.targeting);
    this.collisions = new CollisionSystem(this);
    this.enemies = new EnemySpawner(this.scene, this);

    this.heat = new RiftHeatSystem(this);
    this.score = new ScoreSystem(this);
    this.scrap = new ScrapSystem(this.scene, this);
    this.upgrades = new UpgradeSystem(this);
    this.xp = new XPSystem(this);

    this.hud = new HUD(this);
    this.upgradeScreen = new UpgradeScreen(this);
    this.resultsScreen = new ResultsScreen(this);
    this.death = new DeathSequence(this.scene, this);

    this.director = new LevelDirector(this);

    // --- run state ---
    this.time = 0;
    this.runTime = 0;
    this.paused = false;
    this.running = false;
    this.difficulty = { fireScale: 1, damageScale: 1 };
    this.stats = this._blankStats();

    // Player damage has to fan out to several systems; do it in one place.
    const takeDamage = this.player.takeDamage.bind(this.player);
    this.player.takeDamage = (amount, source) => {
      const before = this.player.health;
      const hit = takeDamage(amount, source);
      if (hit) {
        const dealt = before - this.player.health;
        // A hit landing inside the dodge window means it was never a dodge.
        if (this.player.dodgeT > 0) this.player.dodgeSpoiled = true;
        this.stats.damageTaken += Math.max(0, dealt);
        this.heat.onPlayerDamaged();
        this.hud.flashHurt();
        this.camera3.shake(0.35);
        if (this.encounter) this.encounter.onPlayerDamaged();
        if (!this.player.alive) this._onPlayerDeath(source);
      }
      return hit;
    };

    addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.running && !this.paused) this.togglePause();
    });
  }

  _blankStats() {
    return {
      kills: 0,
      weakPoints: 0,
      towers: 0,
      bossPhases: 0,
      perfectDodges: 0,
      damageTaken: 0,
      maxCombo: 0,
      maxOnscreen: 0,
    };
  }

  _resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  // ------------------------------------------------------------------ helpers

  after(delay, fn) {
    return this.scheduler.after(delay, fn, 'encounter');
  }

  addHazard(h) {
    h.addTo(this.scene);
    this.hazards.push(h);
    return h;
  }

  clearHazards() {
    for (const h of this.hazards) h.dispose(this.scene);
    this.hazards.length = 0;
  }

  /** The Inhibitor calls this on death — the way to the Nexus opens. */
  openNexusRift(pos) {
    const grp = new THREE.Group();
    const swirl = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: Tex.swirl,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    swirl.scale.set(40, 44, 1);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(16, 1.6, 6, 40),
      new THREE.MeshBasicMaterial({ color: P.magenta })
    );
    const halo = glowSprite(P.magenta, 60, 0.8);
    grp.add(swirl, ring, halo);
    grp.position.copy(pos);
    grp.position.z -= 6;
    this.scene.add(grp);
    this.rift = grp;

    this.fx.explode(pos.x, pos.y, pos.z, {
      count: 60,
      colors: [P.magenta, P.violet, P.white],
      power: 34,
      gravity: 0,
      spread: 10,
      arcColor: P.magenta,
      flashScale: 8,
    });
    this.camera3.shake(1);
  }

  closeNexusRift() {
    if (this.rift) {
      this.scene.remove(this.rift);
      this.rift = null;
    }
  }

  onBossDefeated() {
    this.director.go(STATE.VICTORY);
  }

  // ------------------------------------------------------------------- run flow

  startRun() {
    this.time = 0;
    this.runTime = 0;
    this.paused = false;
    this.running = true;

    // wipe every scrap of the previous run
    this.targets.length = 0;
    this.clearHazards();
    this.projectileBlockers.length = 0;
    this.scheduler.clear();
    if (this.encounter) {
      this.encounter.dispose();
      this.encounter = null;
    }
    this.closeNexusRift();

    this.enemies.clear();
    this.projectiles.reset();
    this.scrap.reset();
    this.fx.reset();
    this.damageNumbers.reset();
    this.env.reset();
    this.death.end();

    this.upgrades.reset();
    this.heat.reset();
    this.score.reset();
    this.xp.reset();
    this.targeting.reset();
    this.weapon.reset();
    this.stats = this._blankStats();

    this.player.reset(this.upgrades.stats);
    this.camera3.reset();

    this.hud.reset();
    this.hud.show();
    this.resultsScreen.hide();
    this.upgradeScreen.hide();
    $('boostBtn').classList.remove('hidden');
    $('fireBtn').classList.remove('hidden');
    $('nexusFade').style.opacity = '0';

    Input.enabled = true;
    Input.reset();

    this.director.reset();
    this.director.go(STATE.INTRO);
  }

  _onPlayerDeath(source) {
    this.killedBy = source;
    this.director.state = STATE.DYING;
    Input.enabled = false;
    this.enemies.clear();
    this.clearHazards();
    this.scheduler.clear();
    this.death.start_(this.player.x, this.player.y);
  }

  showResults({ victory }) {
    this.running = false;
    Input.enabled = false;
    this.hud.hide();
    $('boostBtn').classList.add('hidden');
    $('fireBtn').classList.add('hidden');
    this.resultsScreen.show({ victory, killedBy: this.killedBy });
  }

  togglePause() {
    if (!this.running) return;
    if (this.director.state === STATE.DYING) return;
    this.paused = !this.paused;
    $('pauseScreen').classList.toggle('hidden', !this.paused);
    Input.enabled = !this.paused;
    if (this.paused) {
      Audio2.pauseMusic();
    } else {
      Audio2.resume();
      Audio2.resumeMusic();
    }
  }

  quitRun() {
    this.paused = false;
    $('pauseScreen').classList.add('hidden');
    this.running = false;
    Input.enabled = false;
    this.hud.hide();
    $('boostBtn').classList.add('hidden');
    $('fireBtn').classList.add('hidden');
    this.showResults({ victory: false });
  }

  // ------------------------------------------------------------------- update

  update(rawDt) {
    Audio2.update(rawDt);
    // gamepad is polled every frame — even while paused, so Start can resume
    Input.pollGamepad();

    if (!this.running) {
      // attract mode: the world still drifts behind the menus
      this.env.update(rawDt * 0.3);
      this.fx.update(rawDt, 0);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // d-pad / A card selection while an upgrade cache is open
    this.upgradeScreen.update();

    // --- death sequence owns time while it runs ---
    if (this.death.active) {
      this.death.update(rawDt);
      const dt = rawDt * this.death.timeScale;
      this.time += dt;
      this._updateWorld(dt);
      if (this.death.finished) {
        this.death.end();
        this.showResults({ victory: false });
      }
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const dt = rawDt;
    this.time += dt;
    if (this.director.inCombat) this.runTime += dt;

    this.scheduler.update(dt);
    this.director.update(dt);
    this._updateWorld(dt);

    this.hud.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _updateWorld(dt) {
    const dying = this.director.state === STATE.DYING;
    const active = !this.director.inUpgrade;

    // --- purge dead targets before anything reads the list ---
    for (let i = this.targets.length - 1; i >= 0; i--) {
      if (!this.targets[i].alive) this.targets.splice(i, 1);
    }
    for (const t of this.targets) t.syncPos();

    // --- player ---
    if (!dying) {
      this.player.update(dt, this);
      if (active && this.director.inCombat) this.weapon.update(dt, this);
    }

    // --- world ---
    this.env.update(dt);
    if (active) {
      this.enemies.update(dt);
      if (this.encounter) this.encounter.update(dt);
    }

    // --- hazards ---
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.update(dt);
      if (h.done) {
        h.dispose(this.scene);
        this.hazards.splice(i, 1);
      }
    }

    // --- combat resolution ---
    this.projectiles.update(dt, this.env.speed);
    if (!dying && this.director.inCombat) this.collisions.update(dt);

    this.scrap.update(dt, this.env.speed);
    this.heat.update(dt);
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.heat.maxCombo);

    this.fx.update(dt, this.env.speed);
    this.damageNumbers.update(dt);
    this.camera3.update(dt, this.player, this.player.boosting);

    // the Nexus rift spins while it's open
    if (this.rift && this.director.state !== STATE.NEXUS_TRANSITION) {
      this.rift.rotation.z += dt * 0.4;
    }
  }
}
