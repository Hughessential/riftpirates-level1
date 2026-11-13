import * as THREE from 'three';
import { STATE } from './GameState.js';
import { Input } from './Input.js';
import { Audio2, WEAPON_AUDIO } from './AudioManager.js';
import { UPGRADES, buildAugmentStats } from '../systems/UpgradeSystem.js';
import { PLAYER_SHIPS, isPlayerShipId } from '../render/PlayerFleet.js';
import { ENEMY_TYPES } from '../enemies/EnemyTypes.js';
import { Target } from '../combat/Target.js';
import { $, clamp } from './Utils.js';

const defaults = () => ({ godMode: true, infiniteBoost: true, unlimitedRolls: false,
  autoFire: false, timeScale: 1, freezeEnemies: false, trail: true, bloom: null });
const SCENES = {
  sandbox: [STATE.TESTING],
  approach1: [STATE.TRAVERSAL_1], approach2: [STATE.TRAVERSAL_2],
  approach3: [STATE.TRAVERSAL_3], approach4: [STATE.INHIBITOR_APPROACH],
  tower1: [STATE.TOWER_1_INTRO, STATE.TOWER_1_COMBAT],
  tower2: [STATE.TOWER_2_INTRO, STATE.TOWER_2_COMBAT],
  tower3: [STATE.TOWER_3_INTRO, STATE.TOWER_3_COMBAT],
  inhibitor: [STATE.INHIBITOR_INTRO, STATE.INHIBITOR_COMBAT],
  boss: [STATE.BOSS_INTRO, STATE.BOSS_COMBAT],
  escape: [STATE.ESCAPE],
};
const GUNS = ['rapidFire', 'twinFangs', 'broadsides', 'helixVolley', 'prismLance',
  'scatterNova', 'seekerSwarm', 'voidMortar', 'orbitals', 'echoBarrage', 'shrapnelWake', 'kineticCapacitor'];

/** Explicit, session-only developer sandbox. It never edits the player's save. */
export class TestingGrounds {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.panelOpen = false;
    this.settings = defaults();
    this.sceneId = 'sandbox';
    this.dummies = [];
    this.dummyDamage = 0;
    this.damageSamples = [];
    this.elapsed = 0;
    this.fps = 60;
  }

  changed() { this.onChange?.(); }

  enter() {
    if (this.active && this.game.running && this.game.player.alive) {
      this.setPanelOpen(true);
      return;
    }
    this.settings = defaults();
    this.active = true;
    this._disposeEncounter();
    this.game.hangar?.close();
    Audio2.init(); Audio2.resume();
    this.game.startRun({ testing: true });
    for (const id of ['titleScreen', 'resultsScreen', 'pauseScreen']) $(id).classList.add('hidden');
    this.loadScene('sandbox');
    this.spawnDummies();
    this.setPanelOpen(true);
  }

  deactivate() {
    this.game.escape.dispose();
    this._disposeDummies();
    this._disposeEncounter();
    this.active = false;
    this.panelOpen = false;
    this.settings = defaults();
    this.damageSamples.length = 0;
    Input.reset();
    this.changed();
    this.game.syncMusicPause();
  }

  exit() {
    if (!this.active) return;
    if (this.onExit) this.onExit();
    else this.game.prepareTitle();
  }

  setPanelOpen(open) {
    if (!this.active) return;
    this.panelOpen = Boolean(open);
    Input.reset();
    Input.enabled = !this.panelOpen && !this.game.paused && !this.game.director.inUpgrade && !this.game.director.intro.active;
    this.game.syncMusicPause();
    this.changed();
  }

  setSetting(key, value) {
    if (!this.active || !Object.hasOwn(this.settings, key)) return;
    if (key === 'timeScale') this.settings[key] = clamp(Number(value) || 1, .1, 2);
    else if (key === 'bloom') this.setBloom(value);
    else this.settings[key] = Boolean(value);
    if (key === 'trail' && !this.settings.trail) this.game.player.exhaust.reset();
    this.game.syncMusicPause();
    this.changed();
  }

  setShip(id) {
    if (!this.active || !isPlayerShipId(id)) return;
    this.game.player.setShip(id);
    this.changed();
  }

  setAugmentRank(id, rank) {
    if (!this.active || !Object.hasOwn(UPGRADES, id) || !Number.isFinite(Number(rank))) return;
    const ranks = { ...this.game.upgrades.ranks, [id]: clamp(Math.floor(Number(rank)), 0, 50) };
    this._rebuild(ranks);
  }

  applyPreset(id) {
    if (!this.active) return;
    const presets = { all: Object.keys(UPGRADES), arsenal: GUNS, empty: [],
      lightning: ['prismLance', 'teslaFork', 'fragmentation', 'rapidFire'],
      salvage: ['scrapMagnet', 'scrapYield', 'treasureMunitions', 'bulletSiphon'],
      mobility: ['dodgeDrive', 'timeDilation', 'shrapnelWake', 'kineticCapacitor'] };
    if (!Object.hasOwn(presets, id)) return;
    this._rebuild(Object.fromEntries(presets[id].map(key => [key, 1])));
  }

  _rebuild(ranks) {
    const g = this.game, p = g.player;
    // Editing a build dismisses a pending card, instead of leaving stale offers.
    if (g.director.data.awaitingAugment) {
      g.director.data.awaitingAugment = false;
      g.director.data.picks = Math.min(3, g.director.data.picks + 1);
    } else if (g.director.state === STATE.UPGRADE_5) {
      this.loadScene('boss');
    }
    g.upgradeScreen.hide();
    g.upgrades.reset();
    for (const id of Object.keys(UPGRADES)) {
      const rank = clamp(Math.floor(ranks[id] || 0), 0, 50);
      if (!rank) continue;
      g.upgrades.ranks[id] = rank;
      for (let r = 0; r < rank; r++) g.upgrades.taken.push(id);
    }
    const s = buildAugmentStats(g.upgrades.ranks, g.xp.level);
    g.upgrades.stats = s;
    p.stats = s;
    p.blockCapacity = s.freeBlocks;
    p.blocksLeft = s.freeBlocks;
    p.secondWindUsed = 0;
    p.health = Math.min(p.health, s.maxHealth);
    p.shield = Math.min(p.shield, s.shieldMax);
    p.boost = Math.min(p.boost, s.boostCapacity);
    g.weapon.reset(); g.augmentEffects.reset(); g.projectiles.reset();
    this.changed();
  }

  _disposeObject(root) {
    if (!root) return;
    const geometries = new Set(), materials = new Set();
    root.traverse(o => {
      if (o.geometry) geometries.add(o.geometry);
      for (const mat of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) materials.add(mat);
    });
    root.removeFromParent();
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose()); // textures belong to the shared renderer
  }

  _disposeEncounter() {
    const enc = this.game.encounter;
    // Normal play's encounter lifecycle remains owned by LevelDirector.
    if (!this.active || !enc) return;
    for (const portal of enc.portals || []) this._disposeObject(portal.mesh);
    if (enc.portals) enc.portals.length = 0;
    enc.dispose();
    this._disposeObject(enc.group);
    this.game.encounter = null;
  }

  _disposeDummies() {
    for (const dummy of this.dummies) {
      dummy.target.alive = dummy.target.targetable = false;
      this._disposeObject(dummy.group);
    }
    this.dummies.length = 0;
  }

  loadScene(id, { introOnly = false } = {}) {
    if (!this.active || !Object.hasOwn(SCENES, id)) return;
    const g = this.game, p = g.player;
    g.director.clearPresentation();
    g.escape.dispose();
    g._resultsFinalized = false;
    g._escapeCleared = false;
    g.killedBy = '';
    this._disposeDummies(); this._disposeEncounter();
    g.scheduler.clear(); g.upgradeScreen.hide(); g.resultsScreen.hide();
    // Scene replays are a new isolated experiment. Preserve the build, but
    // re-open its checkpoints without reviving stale purchase tokens.
    g.upgrades.offerCache.clear();
    g.upgrades.cancelOffer();
    clearTimeout(g.director._tcT);
    g.enemies.clear(); g.clearHazards(); g.projectiles.reset();
    g.targets.length = 0; g.projectileBlockers.length = 0;
    g.weapon.reset(); g.augmentEffects.reset(); g.targeting.reset();
    g.scrap.reset(); g.fx.reset(); g.damageNumbers.reset(); g.closeNexusRift();
    g.env.reset(); g.death.end();
    g.running = true; g.titleMode = false; g.paused = false;
    g.testRun = true;
    $('pauseScreen').classList.add('hidden');
    $('skipHint').classList.add('hidden'); $('nexusFade').style.opacity = '0';
    p.alive = true; p.frozen = false; p.x = 0; p.y = 1; p.vx = p.vy = p.kx = p.ky = 0;
    p.group.position.set(0, 1, 0); p.group.rotation.set(0, 0, 0); p.group.visible = p.hull.visible = true;
    p.rollT = p.rollCd = p.invuln = p.dodgeT = p.buffT = p.critBuffT = 0;
    p.boosting = false; p.exhaust.reset();
    g.camera3.reset(); g.hud.reset(); g.hud.show();
    $('boostBtn').classList.remove('hidden'); $('fireBtn').classList.remove('hidden');
    this.sceneId = id; this.dummyDamage = 0; this.damageSamples.length = 0; this.elapsed = 0;
    for (const state of introOnly ? SCENES[id].slice(0, 1) : SCENES[id]) g.director.go(state);
    if (id === 'sandbox') {
      g.env.setSpeed(5); g.env.setNexusPresence(.35);
      g.setWorldMood(0x6d44ff, 1, .78);
      g.camera3.setMode('tower');
      g.hud.clearObjective(); g.hud.el.objective.textContent = 'TESTING GROUNDS / FREE FLIGHT';
      Audio2.playMusic('level1_a', .5);
    }
    if (id === 'boss' && !introOnly) for (const eye of g.encounter.parts.eyes) eye.material.opacity = 1;
    clearTimeout(g.director._tcT);
    $('titleCard').classList.add('hidden');
    $('banner').textContent = '';
    this.restorePlayer();
    Input.reset(); Input.enabled = !this.panelOpen && !g.director.intro.active;
    g.syncMusicPause();
    this.changed();
  }

  setBossPhase(phase) {
    if (!this.active || !Number.isFinite(Number(phase))) return;
    phase = clamp(Math.floor(Number(phase)), 1, 4);
    this.loadScene('boss');
    const enc = this.game.encounter;
    enc.phase = phase - 1;
    enc.bossHp = enc.maxBossHp * (1 - .25 * (phase - 1));
    enc._closeCore(); enc.ventPending = false;
    enc.attackT = 2.2; enc.artilleryT = 1.8;
    this.game.hud.setBossPhase(phase, enc.config.phaseNames[phase - 1]);
    this.changed();
  }

  clearArena() { this.loadScene('sandbox'); }

  spawnEnemy(type, count = 1) {
    if (!this.active || !Object.hasOwn(ENEMY_TYPES, type)) return [];
    count = clamp(Math.floor(Number(count) || 1), 1, 10);
    const spawned = [];
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * Math.min(7, 30 / count);
      const enemy = this.game.enemies.spawn(type, x, 2 + i % 2 * 4, -40 - i % 2 * 5,
        { fx: x, fy: 2 + i % 2 * 4, fz: -32 - i % 2 * 5 });
      if (enemy) spawned.push(enemy);
    }
    this.changed(); return spawned;
  }

  spawnDummies() {
    if (!this.active) return;
    this._disposeDummies();
    this.game.targets = this.game.targets.filter(t => t.alive);
    this.dummyDamage = 0; this.damageSamples.length = 0;
    for (let i = 0; i < 3; i++) {
      const group = new THREE.Group();
      const color = [0x36ffe6, 0xc47dff, 0xffc83a][i];
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.4, 1.2),
        new THREE.MeshBasicMaterial({ color, wireframe: true }));
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.5),
        new THREE.MeshStandardMaterial({ color: 0x101425, emissive: color, emissiveIntensity: .7, metalness: .6, roughness: .25 }));
      group.add(frame, crystal); group.position.set((i - 1) * 9, 1, -30 - Math.abs(i - 1) * 4);
      this.game.scene.add(group);
      const target = new Target({ object3D: group, hp: 1e15, radius: 2.5, kind: 'enemy', label: 'IMMORTAL DAMAGE TARGET',
        onDamage: (damage, _crit, t) => {
          t.hp = t.maxHp;
          this.dummyDamage += damage;
          const sample = this.damageSamples.at(-1);
          if (sample && this.elapsed - sample.time < .1) sample.damage += damage;
          else this.damageSamples.push({ time: this.elapsed, damage });
        } });
      this.game.targets.push(target); this.dummies.push({ group, crystal, target });
    }
    this.changed();
  }

  spawnBulletPattern() {
    if (!this.active) return;
    const p = this.game.player;
    for (let i = 0; i < 19; i++) {
      if (i === 9) continue; // one deliberate safe lane
      const x = p.x + (i - 9) * 1.4;
      this.game.projectiles.fireEnemy({ x, y: p.y + Math.sin(i * .7) * 2, z: -34,
        tx: x, ty: p.y, tz: 3, speed: 18, damage: 8, radius: .55, color: '#ff8844', label: 'TEST BARRAGE' });
    }
    this.changed();
  }

  creditTestScrap(amount = 5000) {
    if (!this.active || !this.game.testRun) return false;
    this.game.scrap.wallet.credit(amount);
    this.changed();
    return true;
  }

  spawnScrap() {
    if (!this.active) return;
    const p = this.game.player;
    this.game.scrap.burst(p.x, p.y, -8, 100, 3);
    this.changed();
  }

  restorePlayer() {
    if (!this.active) return;
    const p = this.game.player;
    if (!p.alive) {
      const phase = this.game.encounter?.phase;
      if (this.sceneId === 'boss' && phase !== undefined) this.setBossPhase(phase + 1);
      else this.loadScene(this.sceneId);
      return;
    }
    p.health = p.stats.maxHealth; p.shield = p.stats.shieldMax; p.boost = p.stats.boostCapacity;
    p.shieldBroken = false; p.timeSinceHit = 99; p.invuln = 0;
    p.blocksLeft = p.stats.freeBlocks; p.secondWindUsed = 0;
    this.changed();
  }

  damagePlayer(amount = 25) {
    if (!this.active || !this.game.player.alive) return;
    this.bypassGod = true;
    this.game.player.invuln = 0;
    try { this.game.player.takeDamage(clamp(Number(amount) || 25, 1, 1e6), 'TEST DAMAGE'); }
    finally { this.bypassGod = false; }
    this.changed();
  }

  breakShield() {
    if (!this.active) return;
    const p = this.game.player;
    const hadShield = p.shield > 0;
    p.shield = 0; p.shieldBroken = true; p.timeSinceHit = 0; p.invuln = 0;
    if (hadShield) p.onShieldBreak?.();
    this.changed();
  }

  triggerDodge() {
    if (!this.active) return;
    this.game.player.awardDodge();
    this.game.augmentEffects.onPerfectDodge();
    this.game.heat.onPerfectDodge();
    this.game.hud.flashDodge();
    this.changed();
  }

  setHeat(multiplier) {
    if (!this.active) return;
    this.game.heat.heat = (clamp(Number(multiplier) || 1, 1, 12) - 1) / 11;
    this.game.heat.idleT = 0;
    this.changed();
  }

  setXPLevel(level) {
    if (!this.active) return;
    this.game.xp.level = clamp(Math.floor(Number(level) || 1), 1, 18);
    this.game.xp.xp = 0;
    this.game.xp.next = Math.round(120 * 1.35 ** (this.game.xp.level - 1));
    this._rebuild({ ...this.game.upgrades.ranks });
  }

  setBloom(value) {
    if (!this.active) return;
    this.settings.bloom = value === null ? null : clamp(Number(value) || 0, 0, 1.5);
    this.changed();
  }

  burstFX() {
    if (!this.active) return;
    const p = this.game.player;
    this.game.fx.explode(p.x, p.y + 2, -16, { count: 70, colors: ['#34ffe4', '#ba55ff', '#ff4bd1'],
      power: 16, gravity: 0, arcColor: '#34ffe4', flashColor: 0xba55ff, flashScale: 1.5 });
  }

  playWeaponSound(kind) {
    if (!this.active || !Object.hasOwn(WEAPON_AUDIO, kind)) return;
    Audio2.init(); Audio2.resume(); Audio2.playWeapon(kind);
  }

  beforeWorld(dt) {
    if (!this.active) return;
    const p = this.game.player;
    if (this.settings.infiniteBoost) p.boost = p.stats.boostCapacity;
    if (this.settings.unlimitedRolls) { p.rollCd = 0; p.boost = Math.max(p.boost, 24); }
    this.elapsed += dt;
    while (this.damageSamples.length && this.elapsed - this.damageSamples[0].time > 2) this.damageSamples.shift();
    for (const dummy of this.dummies) {
      dummy.crystal.rotation.y += dt * .6;
      dummy.crystal.rotation.z += dt * .25;
    }
  }

  snapshot() {
    const g = this.game, p = g.player;
    return { active: this.active, panelOpen: this.panelOpen, settings: { ...this.settings },
      sceneId: this.sceneId, shipId: p.shipId || PLAYER_SHIPS[0].id, ranks: { ...g.upgrades.ranks },
      phase: g.encounter?.phase === undefined ? 0 : g.encounter.phase + 1,
      hp: p.health, maxHp: p.stats.maxHealth, shield: p.shield, maxShield: p.stats.shieldMax,
      level: g.xp.level, heat: g.heat.multiplier,
      projectiles: g.projectiles.player.filter(b => b.active).length + g.projectiles.enemy.filter(b => b.active).length,
      enemies: g.enemies.countAlive(), targets: g.targets.filter(t => t.alive).length,
      fps: this.fps, dummyDamage: this.dummyDamage,
      wallet: { ...g.scrap.wallet }, economy: { ...g.upgrades.transactions },
      escape: g.escape.snapshot(),
      dps: this.damageSamples.reduce((sum, sample) => sum + sample.damage, 0) / Math.min(2, Math.max(.1, this.elapsed)),
    };
  }
}
