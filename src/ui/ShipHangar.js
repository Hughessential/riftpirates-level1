import * as THREE from 'three';
import { PLAYER_SHIPS, createPlayerShip, isPlayerShipId } from '../render/PlayerFleet.js';
import { buildVoxels } from '../render/VoxelBuilder.js';
import { hopperVoxels } from '../render/Models.js';
import { Input } from '../core/Input.js';
import './ship-hangar.css';

/** Cosmetic selection is kept outside the gameplay stat/upgrade systems. */
export class ShipHangar {
  constructor({ selectedId, onSelect }) {
    this.selectedId = isPlayerShipId(selectedId) ? selectedId : PLAYER_SHIPS[0].id;
    this.onSelect = onSelect;
    this.time = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.models = new Map();
    this.thumbnails = new Map();

    this.card = document.createElement('button');
    this.card.id = 'shipSelectBtn';
    this.card.className = 'shipHangarCard';
    this.card.type = 'button';
    this.card.setAttribute('aria-haspopup', 'dialog');
    this.card.innerHTML = '<img class="selectedShipThumb" alt=""><span class="selectedShipText"><small>YOUR SHIP / 06 HULLS</small><strong id="selectedShipName"></strong><span>CHANGE SHIP <b aria-hidden="true">→</b></span></span>';
    document.getElementById('titleScreen').append(this.card);

    this.dialog = document.createElement('dialog');
    this.dialog.id = 'shipHangarDialog';
    this.dialog.className = 'shipHangarDialog';
    this.dialog.setAttribute('aria-labelledby', 'hangarTitle');
    this.dialog.innerHTML = `
      <div class="hangarHeader"><div><span class="hangarEyebrow">THE STOLEN FLEET / SIX WAYS TO MAKE AN ENTRANCE</span><h2 id="hangarTitle">PICK YOUR SHIP.</h2></div><button id="hangarClose" aria-label="Close ship hangar">×</button></div>
      <div class="hangarBody">
        <div class="hangarPreview"><div class="hangarOrbit" aria-hidden="true"></div><div class="hangarCanvas"></div><span class="hangarPreviewLabel">RIFT REPAINT / VOXEL ORIGINAL</span><div class="hangarShipInfo"><span id="hangarNumber"></span><h3 id="hangarShipName"></h3><p id="hangarShipTagline"></p></div></div>
        <div class="hangarChoices"><p class="hangarRule">YOUR STYLE. SAME FIREPOWER.<span>Every ship has identical handling, weapons, hull and hitbox. Pick the silhouette you love.</span></p><div class="shipGrid" role="group" aria-label="Choose a cosmetic ship"></div><button class="hangarConfirm" id="hangarConfirm">FLY THIS SHIP <span aria-hidden="true">→</span></button><p class="hangarKeys">← → BROWSE · 1–6 SELECT · ENTER CONFIRM</p></div>
      </div>`;
    document.body.append(this.dialog);
    this.buttons = PLAYER_SHIPS.map((ship, index) => {
      const button = document.createElement('button');
      button.className = 'shipOption';
      button.dataset.shipId = ship.id;
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = `<span class="shipIndex">0${index + 1}</span><img alt=""><strong>${ship.name}</strong><span class="shipSelectedMark" aria-hidden="true">◆</span>`;
      button.addEventListener('click', () => this.select(ship.id));
      this.dialog.querySelector('.shipGrid').append(button);
      return button;
    });
    this.card.addEventListener('click', () => this.open());
    this.dialog.querySelector('#hangarClose').addEventListener('click', () => this.close());
    this.dialog.querySelector('#hangarConfirm').addEventListener('click', () => this.close());
    this.dialog.addEventListener('click', (event) => { if (event.target === this.dialog) this.close(); });
    this.dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); this.advance(1); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); this.advance(-1); }
      else if (/^[1-6]$/.test(event.key)) { event.preventDefault(); this.select(PLAYER_SHIPS[Number(event.key) - 1].id); }
      else if (event.key === 'Enter') { event.preventDefault(); this.close(); }
      else if (event.key === ' ') { event.preventDefault(); event.target.closest('button')?.click(); }
    });
    this.dialog.addEventListener('close', () => this.card.focus({ preventScroll: true }));
    addEventListener('resize', () => { if (this.dialog.open) this.resize(); });
    // One small renderer serves all six thumbnails and the rotating preview.
    // It never renders frames during gameplay or while the hangar is closed.
    this.createPreview();
    this.select(this.selectedId);
  }

  createPreview() {
    try {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      this.renderer.setSize(400, 270);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.25;
      this.renderer.domElement.setAttribute('aria-label', 'Rotating preview of the selected ship');
      this.renderer.domElement.setAttribute('role', 'img');
      this.dialog.querySelector('.hangarCanvas').append(this.renderer.domElement);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(36, 400 / 270, 0.1, 60);
      this.camera.position.set(7, 5.2, -9);
      this.camera.lookAt(0, 0, 0);
      this.scene.add(new THREE.HemisphereLight(0xa4b9f9, 0x181029, 2.2));
      for (const [color, intensity, x, y, z] of [[0xeaffff, 4.5, -4, 7, -5], [0x21ffe1, 3, 5, 2, 1], [0xb830ff, 3, -4, -1, 5]]) {
        const light = new THREE.DirectionalLight(color, intensity);
        light.position.set(x, y, z);
        this.scene.add(light);
      }
      for (const ship of PLAYER_SHIPS) {
        const model = createPlayerShip(ship.id, { size: 5.8, castShadow: false, receiveShadow: false }) || buildVoxels(hopperVoxels(), 0.28);
        model.visible = false;
        this.models.set(ship.id, model);
        this.scene.add(model);
        model.visible = true;
        this.renderer.render(this.scene, this.camera);
        this.thumbnails.set(ship.id, this.renderer.domElement.toDataURL('image/png'));
        model.visible = false;
      }
      this.buttons.forEach((button) => {
        button.querySelector('img').src = this.thumbnails.get(button.dataset.shipId);
      });
    } catch (error) {
      // A preview context failure must never prevent the actual game launching.
      this.renderer?.dispose();
      this.renderer = null;
      this.dialog.querySelector('.hangarCanvas').textContent = 'PREVIEW UNAVAILABLE';
      this.dialog.classList.add('noShipPreview');
      console.warn('Ship preview unavailable:', error.message);
    }
  }

  select(id) {
    if (!isPlayerShipId(id)) return;
    this.selectedId = id;
    const index = PLAYER_SHIPS.findIndex((ship) => ship.id === id);
    const ship = PLAYER_SHIPS[index];
    this.card.querySelector('#selectedShipName').textContent = ship.name;
    const thumbnail = this.thumbnails.get(id);
    const image = this.card.querySelector('img');
    image.hidden = !thumbnail;
    if (thumbnail) image.src = thumbnail;
    this.dialog.querySelector('#hangarNumber').textContent = `HULL 0${index + 1} / 06`;
    this.dialog.querySelector('#hangarShipName').textContent = ship.name;
    this.dialog.querySelector('#hangarShipTagline').textContent = ship.tagline;
    for (const [modelId, model] of this.models) { model.visible = modelId === id; model.rotation.y = 0; }
    this.buttons.forEach((button) => {
      const selected = button.dataset.shipId === id;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    this.onSelect(id);
    if (this.dialog.open) this.render();
  }

  advance(direction) {
    const index = PLAYER_SHIPS.findIndex((ship) => ship.id === this.selectedId);
    this.select(PLAYER_SHIPS[(index + direction + PLAYER_SHIPS.length) % PLAYER_SHIPS.length].id);
    this.buttons.find((button) => button.dataset.shipId === this.selectedId).focus();
  }

  open() {
    if (this.dialog.open) return;
    this.dialog.showModal();
    this.time = 0;
    this.resize();
    this.buttons.find((button) => button.dataset.shipId === this.selectedId).focus();
  }

  close() { if (this.dialog.open) this.dialog.close(); }

  resize() {
    if (!this.renderer) return;
    const { width, height } = this.dialog.querySelector('.hangarCanvas').getBoundingClientRect();
    this.renderer.setSize(Math.max(width, 1), Math.max(height, 1));
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() { if (this.renderer) this.renderer.render(this.scene, this.camera); }

  update(dt) {
    if (!this.dialog.open) return;
    const nav = Input.menuNav;
    if (nav.left || nav.up) this.advance(-1);
    else if (nav.right || nav.down) this.advance(1);
    if (nav.confirm) this.close();
    if (!this.reducedMotion.matches) this.time += dt;
    const model = this.models.get(this.selectedId);
    if (model) model.rotation.y = Math.sin(this.time * 0.32) * 0.48;
    this.render();
  }
}
