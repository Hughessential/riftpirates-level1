import * as THREE from 'three';
import { Input } from '../core/Input.js';
import { Audio2 } from '../core/AudioManager.js';
import { clamp } from '../core/Utils.js';
import { Tex } from '../render/VoxelBuilder.js';
import './boss-intro.css';

const PROFILES = {
  tower1: { title: ['OUTER DEFENSE', 'TOWER'], call: 'BORDER SKIRMISH', threat: 'TRACKING LASERS / CANNON DECKS / RECON SWARM',
    line: 'FIRST LINE. LAST WARNING.', mark: 'I', orbit: -1, height: 8, color: '#22e5df' },
  tower2: { title: ['MIDRIFT PRESSURE', 'TOWER'], call: 'GRAVITY & FIRE', threat: 'GRAVITY WELLS / SWEEPING LASERS / PRESSURE SURGES',
    line: 'THE VOID HAS TEETH.', mark: 'II', orbit: 1, height: 9, color: '#b863ff' },
  tower3: { title: ['INNER CITADEL', 'TOWER'], call: 'ELITE GARRISON', threat: 'SHIELD GENERATORS / CROSSFIRE / ELITE CAPTAINS',
    line: 'NO QUARTER. NO RETREAT.', mark: 'III', orbit: -1, height: 7, color: '#ff4f91' },
  inhibitor: { title: ['INHIBITOR', 'CORE'], call: 'THE LAST LOCK', threat: 'OVERLOAD PULSES / ROTATING SHIELDS / EXPOSED CORE',
    line: 'BREAK THE SEAL. WAKE THE NEXUS.', mark: 'IV', orbit: 1, height: 2, color: '#ffab43' },
  boss: { title: ['THE RIFT', 'ADMIRAL'], call: 'NEXUS OVERLORD', threat: 'FOUR PHASES / RIFT ARMADA / TOTAL DOMINION',
    line: 'I AM THE NEXUS. I AM YOUR END.', mark: 'V', orbit: -1, height: 8, color: '#f447e4' },
};
const ease = value => value * value * (3 - 2 * value);
const mix = (a, b, k) => a + (b - a) * k;

/** A simulation-clock camera reveal. No timers, saves, or audio ownership. */
export class BossIntroSequence {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.elapsed = 0;
    this.duration = 0;
    this.skipRequested = false;
    this.el = document.createElement('section');
    this.el.id = 'bossIntro';
    this.el.className = 'bossIntro';
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Boss introduction');
    this.el.innerHTML = `
      <div class="bossIntroBar bossIntroBarTop"></div><div class="bossIntroBar bossIntroBarBottom"></div>
      <div class="bossIntroFrame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <header class="bossIntroHeader"><span>RIFT PIRATES / HOSTILE SIGNAL</span><div><button type="button" id="bossIntroPause">PAUSE / P</button><button type="button" id="bossIntroSkip">SKIP / SPACE ↵</button></div></header>
      <div class="bossIntroMark" aria-hidden="true"></div>
      <div class="bossIntroSignal"><span class="bossIntroSignalDot"></span><span data-intro="signal">ACQUIRING TARGET</span><i><b></b></i></div>
      <div class="bossIntroCopy"><p class="bossIntroOverline"></p><h2 id="bossIntroTitle"></h2><p class="bossIntroQuote"></p></div>
      <footer class="bossIntroFooter"><span class="bossIntroThreat"></span><strong>PLUNDER. MUTATE. BREAK THE NEXUS.</strong></footer>`;
    document.body.append(this.el);
    this.el.querySelector('#bossIntroPause').addEventListener('click', () => game.togglePause());
    this.skip = this.el.querySelector('#bossIntroSkip');
    this.skip.addEventListener('click', () => {
      if (this.active && this.elapsed >= .65 && !game.paused && !game.testing?.panelOpen) this.skipRequested = true;
    });
    addEventListener('keydown', event => {
      if (!this.active || this.elapsed < .65 || event.repeat || game.paused || game.testing?.panelOpen) return;
      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault();
        this.skipRequested = true;
      }
    });
    this.pose = { position: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
    this._createNexusBackdrop();
  }

  _createNexusBackdrop() {
    // Four small draw calls, allocated once. The dark aperture stays behind
    // the Admiral and disappears before combat, so it never competes with fire.
    this.backdrop = new THREE.Group();
    this.backdrop.name = 'admiral-intro-rift';
    this.backdrop.visible = false;
    this.backdropMaterials = [];
    const material = (color, opacity, extra = {}) => {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, ...extra });
      this.backdropMaterials.push([mat, opacity]);
      return mat;
    };
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(84, 84),
      material('#963dff', .42, { map: Tex.swirl }));
    disc.position.z = -1;
    this.backdrop.add(disc);
    const ringGeometry = new THREE.TorusGeometry(28, .13, 4, 112);
    const outer = new THREE.Mesh(ringGeometry, material('#882eff', .65));
    const inner = new THREE.Mesh(ringGeometry, material('#31cddd', .26));
    inner.scale.setScalar(.91);
    inner.rotation.x = .16;
    this.backdrop.add(outer, inner);
    this.riftFragments = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      material('#ffffff', .68), 72);
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < 72; i++) {
      const angle = i / 72 * Math.PI * 2;
      const radius = 26.7 + (i % 3) * 2.5;
      transform.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius,
        Math.sin(i * 2.7) * 1.5);
      transform.rotation.set(i * .7, i * .3, angle);
      transform.scale.setScalar(i % 6 === 0 ? .9 : .38);
      transform.updateMatrix();
      this.riftFragments.setMatrixAt(i, transform.matrix);
      this.riftFragments.setColorAt(i, color.set(i % 9 === 0 ? '#36e7ef' : '#a84dff').multiplyScalar(1.3));
    }
    this.backdrop.add(this.riftFragments);
    this.game.scene.add(this.backdrop);
  }

  start(identity, encounter, index) {
    this.end();
    const g = this.game;
    this.profile = PROFILES[identity.key];
    this.encounter = encounter;
    this.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
    this.duration = identity.key === 'boss' ? 6.5 : 5.2;
    this.active = true;
    this.elapsed = 0;
    this.skipRequested = false;
    this.wasFrozen = g.player.frozen;
    this.playerVisible = g.player.group.visible;
    g.player.frozen = true;
    g.player.group.visible = false;
    g.player.exhaust.reset();
    Input.reset();
    Input.enabled = false;
    this.fromPosition = g.camera.position.clone();
    this.fromLook = g.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(60).add(this.fromPosition);
    this.fromFov = g.camera.fov;
    this.focus = encounter.group.position.clone();
    this.focus.y += this.profile.height;
    const p = this.profile;
    this.el.style.setProperty('--boss-color', p.color);
    this.el.querySelector('.bossIntroMark').textContent = p.mark;
    this.el.querySelector('.bossIntroOverline').textContent = `${String(index).padStart(2, '0')} / ${p.call}`;
    const title = this.el.querySelector('#bossIntroTitle');
    title.replaceChildren(...p.title.map(line => {
      const span = document.createElement('span'); span.textContent = line; return span;
    }));
    title.setAttribute('aria-label', identity.name);
    this.el.querySelector('.bossIntroQuote').textContent = p.line;
    this.el.querySelector('.bossIntroThreat').textContent = p.threat;
    this.el.hidden = false;
    this.el.dataset.encounter = identity.key;
    this.backdrop.visible = identity.key === 'boss';
    document.body.classList.add('bossIntroActive');
    this.update(0);
  }

  update(elapsed) {
    if (!this.active) return false;
    this.elapsed = elapsed;
    const g = this.game, p = this.profile;
    const k = clamp(elapsed / this.duration, 0, 1);
    // All motion derives from active simulation time, including the title wipe.
    const inK = ease(clamp(k / .16, 0, 1));
    const outK = ease(clamp((k - .83) / .17, 0, 1));
    this.el.style.setProperty('--intro-in', inK);
    this.el.style.setProperty('--intro-out', outK);
    this.el.style.setProperty('--intro-title', ease(clamp((k - .12) / .12, 0, 1)) * (1 - outK));
    this.el.style.setProperty('--intro-progress', k);
    this.el.querySelector('[data-intro="signal"]').textContent = k < .2 ? 'ACQUIRING HOSTILE SIGNATURE'
      : k < .83 ? 'TARGET LOCKED / WEAPONS ARMED' : 'ENGAGE';
    this.skip.disabled = elapsed < .65;
    const target = this.focus;
    const boss = this.encounter.identity.key === 'boss';
    const finalPosition = new THREE.Vector3(g.player.x * .4, 7.5 + g.player.y * .3, boss ? 22 : 18);
    const finalLook = new THREE.Vector3(g.player.x * .6, g.player.y * .55 + 1, boss ? -30 : -22);
    const hero = new THREE.Vector3(p.orbit * mix(15, -7, ease(k)), target.y + mix(7, 2, k), boss ? 0 : -7);
    const entry = ease(clamp(k / .27, 0, 1));
    this.pose.position.copy(this.fromPosition).lerp(hero, entry).lerp(finalPosition, outK);
    this.pose.look.copy(this.fromLook).lerp(target, entry).lerp(finalLook, outK);
    this.pose.fov = mix(mix(this.fromFov, boss ? 58 : 55, entry), boss ? 74 : 70, outK);
    if (this.reducedMotion) {
      this.pose.position.copy(finalPosition);
      this.pose.look.copy(finalLook);
      this.pose.fov = boss ? 74 : 70;
    }
    if (boss) {
      this.backdrop.position.copy(this.encounter.group.position);
      this.backdrop.position.y += 5;
      this.backdrop.position.z -= 13;
      this.backdrop.rotation.z = this.reducedMotion ? 0 : elapsed * -.035;
      this.riftFragments.rotation.z = this.reducedMotion ? 0 : elapsed * .1;
      const reveal = inK * (1 - outK);
      for (const [material, opacity] of this.backdropMaterials) material.opacity = opacity * reveal;
    }
    g.camera3.setEncounterReveal(this.pose);
    // Safe intros are already excluded from combat. Freezing also prevents
    // steering/fire/roll input from accumulating underneath the cutscene.
    g.player.frozen = true;
    Input.enabled = false;
    // Drain held fire/confirm keys so a repeat or key held before this sequence
    // cannot silently skip it. Only fresh keydown/button/controller edges skip.
    Input.consumeKey('Space'); Input.consumeKey('Enter');
    if (elapsed >= .65 && (this.skipRequested || Input.menuNav.confirm)) {
      Audio2.play('ui_select', .5, 1.1);
      return true;
    }
    return k >= 1;
  }

  end() {
    if (!this.active) return;
    const g = this.game;
    this.active = false;
    this.el.hidden = true;
    this.backdrop.visible = false;
    document.body.classList.remove('bossIntroActive');
    g.camera3.clearEncounterReveal();
    g.player.frozen = this.wasFrozen;
    g.player.group.visible = this.playerVisible;
    Input.reset();
    // A lab replay may begin while the console owns input, then finish after
    // it closes. Restore current ownership, not a stale pre-intro boolean.
    Input.enabled = g.running && !g.paused && !g.testing?.panelOpen && !g.director.inUpgrade;
    this.skipRequested = false;
  }
}
