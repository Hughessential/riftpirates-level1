import * as THREE from 'three';
import { P } from './Palette.js';
import { STATE, COMBAT_STATES, SAFE_STATES } from './GameState.js';
import { Save } from './SaveSystem.js';
import { Audio2 } from './AudioManager.js';
import { Input } from './Input.js';
import { Scheduler } from './Scheduler.js';
import { CameraRig } from './CameraRig.js';
import { LevelDirector } from './LevelDirector.js';
import { TestingGrounds } from './TestingGrounds.js';
import { OpeningTutorial } from './OpeningTutorial.js';
import { FinalEscape } from '../encounters/FinalEscape.js';

import { initTextures, buildVoxels, glowSprite, Tex } from '../render/VoxelBuilder.js';
import { Environment } from '../render/Environment.js';
import { CinematicRenderer } from '../render/CinematicRenderer.js';
import { RiftWorldShowcase } from '../render/RiftWorldShowcase.js';
import { displayMetrics, applyDisplayLayout } from '../render/DisplayLayout.js';
import { AdaptiveResolution } from '../render/AdaptiveResolution.js';

import { Player, BASE_STATS } from '../player/Player.js';
import { PlayerWeapon } from '../player/PlayerWeapon.js';

import { ProjectilePool } from '../combat/ProjectilePool.js';
import { TargetingSystem } from '../combat/TargetingSystem.js';
import { CollisionSystem } from '../combat/CollisionSystem.js';
import { AugmentEffects } from '../combat/AugmentEffects.js';

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
    this.display = displayMetrics(innerWidth, innerHeight, devicePixelRatio, this.renderer.capabilities.maxTextureSize);
    this.adaptiveResolution = new AdaptiveResolution();
    applyDisplayLayout(this.display);
    this.renderer.setClearColor(new THREE.Color(P.ink), 1);
    this.renderer.setPixelRatio(this.display.pixelRatio * this.adaptiveResolution.scale);
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    document.body.insertBefore(this.renderer.domElement, document.body.firstChild);
    this.renderer.domElement.id = 'gameCanvas';

    // Cinematic three-point lighting: warm structure key, cyan player rim and
    // a magenta void fill. Encounter energy remains the brightest information.
    this.scene.add(new THREE.HemisphereLight(0x6f66bb, 0x090318, 0.72));

    const key = new THREE.DirectionalLight(0xffdfc4, 2.5);
    key.position.set(12, 22, 16);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -48;
    key.shadow.camera.right = 48;
    key.shadow.camera.top = 36;
    key.shadow.camera.bottom = -28;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 180;
    key.shadow.bias = -0.00035;
    key.shadow.normalBias = 0.025;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x22d3ee, 2.15);
    rim.position.set(-16, 7, 18);
    this.scene.add(rim);

    this.voidFill = new THREE.DirectionalLight(0xff2ed2, 1.05);
    this.voidFill.position.set(14, -6, -24);
    this.scene.add(this.voidFill);

    const playerPool = new THREE.PointLight(0x5befff, 8, 44, 2);
    playerPool.position.set(0, 3, 8);
    this.scene.add(playerPool);

    this.riftPool = new THREE.PointLight(0xb22cff, 11, 100, 2);
    this.riftPool.position.set(0, 8, -34);
    this.scene.add(this.riftPool);

    this.lightMood = {
      color: new THREE.Color(0xb22cff),
      target: new THREE.Color(0xb22cff),
      energy: 11,
      targetEnergy: 11,
      bloom: 0.78,
      targetBloom: 0.78,
    };

    this.presentation = new CinematicRenderer(this.renderer, this.scene, this.camera);

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
    this.worldShowcase = new RiftWorldShowcase(this.scene);
    this.worldShowcase.resize(this.camera.aspect);

    this.player = new Player(this.scene, this.fx);
    this.projectiles = new ProjectilePool(this.scene);
    this.targeting = new TargetingSystem();
    this.weapon = new PlayerWeapon(this.player, this.projectiles, this.targeting);
    this.collisions = new CollisionSystem(this);
    this.enemies = new EnemySpawner(this.scene, this);
    this.augmentEffects = new AugmentEffects(this);
    this.player.onShieldBreak = () => this.augmentEffects.onShieldBreak();

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
    this.escape = new FinalEscape(this);
    this.testing = new TestingGrounds(this);
    this.tutorial = new OpeningTutorial(this);

    // --- run state ---
    this.time = 0;
    this.runTime = 0;
    this.paused = false;
    this.running = false;
    this.titleMode = true;
    this._terminalOutcome = null;
    this.difficulty = { fireScale: 1, damageScale: 1 };
    this.stats = this._blankStats();

    // Player damage has to fan out to several systems; do it in one place.
    const takeDamage = this.player.takeDamage.bind(this.player);
    this.player.takeDamage = (amount, source) => {
      if (this._terminalOutcome) return false;
      if (this.testing.active && this.testing.settings.godMode && !this.testing.bypassGod) return false;
      const before = this.player.health;
      const hit = takeDamage(amount, source);
      if (hit) {
        this.augmentEffects.cosmic?.onPlayerDamaged();
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
    addEventListener('rift-ui-scale', () => this._resize());
    document.addEventListener('fullscreenchange', () => this._resize());
    window.visualViewport?.addEventListener('resize', () => this._resize());
    this._watchDisplayDensity();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.running && !this.paused) this.togglePause();
      this.syncMusicPause();
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
    this.display = displayMetrics(innerWidth, innerHeight, devicePixelRatio, this.renderer.capabilities.maxTextureSize);
    applyDisplayLayout(this.display);
    this.camera.aspect = this.display.aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.display.pixelRatio * this.adaptiveResolution.scale);
    this.renderer.setSize(this.display.width, this.display.height);
    this.presentation.setSize(this.display.width, this.display.height);
    this.worldShowcase.resize(this.camera.aspect);
    // A viewport resize may arrive before the media-query change event when
    // moving between displays. Rebind immediately so a rapid return is caught.
    if (this._watchedDensity !== (devicePixelRatio || 1)) this._watchDisplayDensity();
  }

  _watchDisplayDensity() {
    this._densityQuery?.removeEventListener('change', this._densityChanged);
    this._watchedDensity = devicePixelRatio || 1;
    this._densityQuery = matchMedia(`(resolution: ${this._watchedDensity}dppx)`);
    this._densityChanged = () => this._resize();
    this._densityQuery.addEventListener('change', this._densityChanged);
  }

  renderFrame(dt = 0) {
    // Some browser/display drivers change DPR without emitting resize or a
    // resolution-query event. Catch that before submitting the next frame.
    if (this._watchedDensity !== (devicePixelRatio || 1)) this._resize();
    this._updateLighting(dt);
    this.presentation.render(dt);
    this.pilotIdentity?.updateTag(this.camera, this.renderer.domElement);
  }

  /** Cross-fades the whole arena into each objective's identity color. */
  setWorldMood(color, energy = 1, bloom = 0.82) {
    this.lightMood.target.set(color);
    this.lightMood.targetEnergy = 11 * energy;
    this.lightMood.targetBloom = bloom;
  }

  _updateLighting(dt) {
    const mood = this.lightMood;
    const k = 1 - Math.exp(-Math.max(0, dt) * 2.1);
    mood.color.lerp(mood.target, k);
    mood.energy += (mood.targetEnergy - mood.energy) * k;
    mood.bloom += (mood.targetBloom - mood.bloom) * k;
    this.riftPool.color.copy(mood.color);
    this.riftPool.intensity = mood.energy;
    this.voidFill.color.copy(mood.color);
    this.presentation.setBloom(this.testing?.active && this.testing.settings.bloom !== null
      ? this.testing.settings.bloom : mood.bloom);
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
      this.rift.traverse(object => {
        // Sprite geometry and textures belong to Three/shared texture caches.
        if (object.isMesh && !object.isSprite) object.geometry?.dispose();
        object.material?.dispose();
      });
      this.rift = null;
    }
  }

  onBossDefeated() {
    if (!this.running || this._terminalOutcome || this._resultsFinalized || this.director.state !== STATE.BOSS_COMBAT) return;
    if (this.testing.active) this.testing.sceneId = 'escape';
    this.director.go(STATE.ESCAPE);
  }

  completeEscape() {
    if (!this.running || !this.player.alive || this._terminalOutcome || this._resultsFinalized || this.director.state !== STATE.ESCAPE) return;
    if (this.escape.outcome !== 'escaped') return;
    this._terminalOutcome = 'victory';
    this._escapeCleared = true;
    this.escapeMargin = this.escape.remaining;
    this.scheduler.clear();
    this.enemies.clear();
    this.clearHazards();
    this.projectiles.reset();
    this.player.frozen = true;
    this.pilotIdentity?.hideTag();
    Audio2.playVictory();
    this.director.go(STATE.VICTORY);
    // Settle immediately; decorative staging must never hold up saving.
    this.showResults({ victory: true });
  }

  failEscape(source = 'GALACTIC COLLAPSE') {
    if (!this.running || this._terminalOutcome || this._resultsFinalized || this.director.state !== STATE.ESCAPE) return;
    // Missing the deadline is a failed route, not a damage hit that armor,
    // a revive charge or lab god mode could turn into extra countdown time.
    this.player.health = 0;
    this.player.alive = false;
    this._onPlayerDeath(source);
  }

  syncMusicPause() {
    Audio2.setMusicPaused('game', this.paused);
    Audio2.setMusicPaused('lab', this.testing.active && this.testing.panelOpen);
    Audio2.setMusicPaused('background', document.hidden);
    // Explicit frame study can seek the paused recording. Live flight always
    // lets the original track run continuously, even when rendering falls behind.
    Audio2.setMusicPaused('escape-study', this.director.state === STATE.ESCAPE &&
      this.testing.active && this.testing.settings.timeScale !== 1);
    if (this.director.state === STATE.ESCAPE) Audio2.syncEscapeTime(this.escape.elapsed);
  }

  // ------------------------------------------------------------------- run flow

  prepareTitle() {
    this.tutorial?.stop();
    if (this.adaptiveResolution.restore()) this._resize();
    this.director.clearPresentation();
    this.escape.dispose();
    this.testing.deactivate();
    this.resultsScreen.hide();
    this.death.end();
    this.pilotIdentity?.resetSession();
    this.pilotIdentity?.hideTag();
    this._terminalOutcome = null;
    this.testRun = false;
    this.running = false;
    this.titleMode = true;
    this.paused = false;
    this.scheduler.clear();
    this.upgradeScreen.hide();
    this.enemies.clear();
    this.projectiles.reset();
    this.clearHazards();
    this.env.clearAll();
    this.env.clearApproach();
    this.env.setSpeed(4);
    this.env.livingDebris.group.visible = false;
    this.targets.length = 0;
    if (this.encounter) this.encounter.dispose();
    this.encounter = null;
    this.closeNexusRift();
    this.fx.reset();
    this.damageNumbers.reset();
    this.scrap.reset();
    this.player.group.visible = false;
    this.player.exhaust.reset();
    this.weapon.reset();
    this.augmentEffects.reset();
    this.camera3.reset();
    this.camera.position.set(0, 4.6, 11);
    this.camera.lookAt(0, 3, -24);
    this.worldShowcase.update(0, 0, { menu: true });
    this.setWorldMood(P.magenta, 1.4, 0.85);
    $('titleCard').classList.add('hidden');
    this.syncMusicPause();
  }

  startRun({ testing = false, tutorial = false } = {}) {
    this.director.clearPresentation();
    this.escape.dispose();
    if (!testing) this.testing.deactivate();
    this._resultsFinalized = false;
    this._terminalOutcome = null;
    this.escapeMargin = null;
    this.runId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    this._escapeCleared = false;
    this.killedBy = '';
    this.testRun = testing;
    this.runPilotName = this.pilotIdentity?.snapshotRun({ testing }) || Save.data.pilotName || 'PIRATE';
    this.time = 0;
    this.runTime = 0;
    this.paused = false;
    this.running = true;
    this.titleMode = false;
    this.env.livingDebris.group.visible = true;
    this.worldShowcase.reset();
    this.worldShowcase.update(0, 0, { menu: false });

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
    this.augmentEffects.reset();

    this.player.reset(this.upgrades.stats);
    this.player.setShip(Save.data.selectedShip);
    this.player.group.visible = true;
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
    this.tutorial.start({ testing, force: tutorial });
    this.syncMusicPause();
  }

  _onPlayerDeath(source) {
    if (!this.running || this.player.alive || this._terminalOutcome || this._resultsFinalized || this.death.active) return;
    this._terminalOutcome = 'defeat';
    this.pilotIdentity?.hideTag();
    Audio2.playDeath();
    this.director.clearPresentation();
    this.escape.dispose();
    this.killedBy = source;
    this.director.state = STATE.DYING;
    Input.enabled = false;
    this.enemies.clear();
    this.clearHazards();
    this.projectiles.reset();
    this.scheduler.clear();
    this.death.start_(this.player.x, this.player.y);
  }

  showResults({ victory }) {
    if (this._resultsFinalized) return;
    if (victory && (this._terminalOutcome !== 'victory' || !this._escapeCleared)) return;
    if (!victory && this._terminalOutcome === 'victory') return;
    this._terminalOutcome = victory ? 'victory' : 'defeat';
    this.tutorial?.stop();
    if (victory) Audio2.playVictory();
    else Audio2.playDeath();
    this.director.clearPresentation();
    this.scheduler.clear();
    this.death.end();
    this.enemies.clear();
    this.clearHazards();
    this.projectiles.reset();
    this.pilotIdentity?.hideTag();
    this._resultsFinalized = true;
    this.escape.dispose();
    this.player.exhaust.reset();
    this.running = false;
    this.paused = false;
    $('pauseScreen').classList.add('hidden');
    Input.enabled = false;
    this.upgradeScreen.hide();
    this.hud.hide();
    $('boostBtn').classList.add('hidden');
    $('fireBtn').classList.add('hidden');
    this.resultsScreen.show({ victory, killedBy: this.killedBy });
    this.syncMusicPause();
  }

  togglePause({ showMenu = true } = {}) {
    if (this.testing.active && this.testing.panelOpen) return;
    if (!this.running) return;
    if (this.director.state === STATE.DYING) return;
    const pauseScreen = $('pauseScreen');
    // Escape/Start/the pause button can reveal the normal pause console when
    // P has already frozen the action silently. A second P still resumes.
    if (this.paused && showMenu && pauseScreen.classList.contains('hidden')) {
      pauseScreen.classList.remove('hidden');
      Input.enabled = false;
      return;
    }
    this.paused = !this.paused;
    pauseScreen.classList.toggle('hidden', !this.paused || !showMenu);
    if (this.paused) this.upgradeScreen.cancelHoldForPause();
    Input.enabled = !this.paused && !this.director.inUpgrade && !this.director.intro.active && !this.testing?.panelOpen;
    if (this.paused) {
      Audio2.pauseMusic();
    } else {
      Audio2.resume();
      Audio2.resumeMusic();
    }
    this.syncMusicPause();
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

  _reticleShouldBeActive() {
    return !document.hidden && this.running && !this.paused && this.player.alive && !this.player.frozen &&
      !this._terminalOutcome && !this.death.active && COMBAT_STATES.has(this.director.state) &&
      !this.director.intro.active && !this.director.inUpgrade && !this.upgradeScreen.open &&
      !this.upgradeScreen.closing && !(this.testing.active && this.testing.panelOpen);
  }

  update(rawDt) {
    // The flat sight is persistent only during live, controllable flight.
    // Central ownership hides it immediately on pauses, shops, cinematics,
    // death/results, title screens and Testing Grounds dialogs.
    this.player?.setReticleActive(this._reticleShouldBeActive());
    if (document.hidden) {
      this.adaptiveResolution.update(rawDt, false);
      this.syncMusicPause();
      return;
    }
    if (rawDt > 0) this.testing.fps += (1 / rawDt - this.testing.fps) * .05;
    this.syncMusicPause();
    Audio2.update(rawDt);
    // gamepad is polled every frame — even while paused, so Start can resume
    Input.pollGamepad();
    this.controllerMenus?.update();
    this.resultsScreen.update?.(rawDt);
    const qualityEligible = this.running && !this.paused && !this.testing.active &&
      !this.director.intro.active && !this.director.inUpgrade && !this.upgradeScreen.open &&
      !this.upgradeScreen.closing && !this.death.active;
    if (this.adaptiveResolution.update(rawDt, qualityEligible)) {
      this.renderer.setPixelRatio(this.display.pixelRatio * this.adaptiveResolution.scale);
      this.presentation.setSize(this.display.width, this.display.height);
    }

    // connect/disconnect notice — #toasts sits outside the HUD, so this is
    // visible even on the title screen (iOS only reveals a pad after the
    // first button press, so this doubles as "Safari can see your MCON")
    const padEv = Input.consumePadEvent();
    if (padEv) {
      const name = (padEv.id.split('(')[0].trim() || 'GAMEPAD').toUpperCase().slice(0, 30);
      this.hud.toast(
        padEv.connected ? 'CONTROLLER CONNECTED' : 'CONTROLLER DISCONNECTED',
        padEv.connected ? name : '',
        padEv.connected ? P.cyan : P.red
      );
      if (padEv.connected) Audio2.play('ui_select', 0.5, 1.2);
    }

    if (this.testing.active && this.testing.panelOpen) {
      this.renderFrame(rawDt);
      return;
    }

    if (!this.running) {
      // attract mode: the world still drifts behind the menus
      this.env.update(rawDt * 0.3);
      this.fx.update(rawDt, 0);
      this.worldShowcase.update(rawDt, this.env.speed, { menu: this.titleMode });
      this.renderFrame(rawDt);
      return;
    }

    if (this.paused) {
      this.renderFrame(rawDt);
      return;
    }

    // d-pad / A card selection while an upgrade cache is open
    this.upgradeScreen.update();

    // --- death sequence owns time while it runs ---
    if (this.death.active) {
      this.death.update(rawDt);
      const dt = rawDt * this.death.timeScale * (this.testing.active ? this.testing.settings.timeScale : 1);
      this.time += dt;
      this._updateWorld(dt);
      if (this.death.finished) {
        this.death.end();
        this.showResults({ victory: false });
      }
      this.renderFrame(rawDt);
      return;
    }

    const dt = rawDt * (this.testing.active ? this.testing.settings.timeScale : 1);
    // Choices stop approach time, heat decay, enemies, hazards and player motion.
    // The scheduler still runs so the card dismissal/recovery can complete.
    const choosing = this.director.inUpgrade || this.upgradeScreen.open || this.upgradeScreen.closing;
    this.scheduler.update(dt);
    // The tutorial owns no world simulation, but it must observe the first
    // cache while choice time is frozen so the final lesson can complete.
    this.tutorial.update(dt);
    if (choosing || this.director.inUpgrade || this.upgradeScreen.open || this.upgradeScreen.closing) {
      this.fx.update(dt, 0);
      // Choice screens freeze simulation time. Keep instructional/readability
      // timers frozen with the rest of the run instead of consuming them while
      // the player studies an augment.
      this.hud.update(0);
      this.renderFrame(dt);
      return;
    }
    this.time += dt;
    if (this.director.inCombat) this.runTime += dt;

    if (!this.tutorial.blocksRoute) this.director.update(dt);
    if (this.director.state === STATE.ESCAPE) Audio2.syncEscapeTime(this.escape.elapsed);
    if (this.running && !this._terminalOutcome && !this.director.inUpgrade) this._updateWorld(dt);

    this.hud.update(dt);
    this.renderFrame(dt);
  }

  _updateWorld(dt) {
    this.testing.beforeWorld(dt);
    const dying = this.director.state === STATE.DYING;
    const active = !dying && !this._terminalOutcome && !this.director.inUpgrade;

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
    this.worldShowcase.update(dt, this.env.speed, { menu: false });
    // The ending has its own collapse debris. Keep the known decorative fleets
    // out of the aperture sightline without changing ordinary sectors or menus.
    const heroSequence = this.director.state === STATE.ESCAPE || this.director.intro.active;
    this.worldShowcase.worldRoot.visible = !heroSequence;
    this.env.livingDebris.group.visible = !heroSequence;
    if (active && !this._terminalOutcome) {
      if (!this.testing.active || !this.testing.settings.freezeEnemies) this.enemies.update(dt);
      if (this.encounter && !this._terminalOutcome) this.encounter.update(dt);
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
    this.augmentEffects.update(dt, { active: !dying && this.director.inCombat });
    this.projectiles.update(dt, this.env.speed, this);
    if (!dying && this.director.inCombat) this.collisions.update(dt);
    this.projectiles.flush?.();

    this.scrap.update(dt, this.env.speed);
    this.heat.update(dt);
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.heat.maxCombo);

    this.fx.update(dt, this.env.speed);
    this.damageNumbers.update(dt);
    this.camera3.update(dt, this.player, this.player.boosting);
    if (!this.testing.active || this.testing.settings.trail) {
      this.player.exhaust.update(dt, this.player, this.camera, { emit: !dying && !this._terminalOutcome });
    }

    // the Nexus rift spins while it's open
    if (this.rift && this.director.state !== STATE.NEXUS_TRANSITION) {
      this.rift.rotation.z += dt * 0.4;
    }
  }
}
