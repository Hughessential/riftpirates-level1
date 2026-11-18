import { Game } from './core/Game.js';
import { Save } from './core/SaveSystem.js';
import { Audio2 } from './core/AudioManager.js';
import { Input } from './core/Input.js';
import { $ } from './core/Utils.js';
import { preloadImportedAssets } from './render/ImportedAssets.js';
import { initVoxelTitle } from './ui/VoxelTitle.js';
import { preloadPlayerFleet, isPlayerShipId, PLAYER_SHIPS } from './render/PlayerFleet.js';
import { ShipHangar } from './ui/ShipHangar.js';
import { initMenuCursor } from './ui/MenuCursor.js';
import { TestingGroundsPanel } from './ui/TestingGroundsPanel.js';
import { initAudioSettings } from './ui/AudioSettings.js';
import { applyUIScale, initUISettings } from './ui/UISettings.js';
import { ControllerMenus } from './ui/ControllerMenus.js';
import { PilotIdentity } from './ui/PilotIdentity.js';
import { OptionsMenu } from './ui/OptionsMenu.js';
import './ui/title-layout.css';

// Start the official title recording before voxel loading. Saved mute/volume
// still apply, and browsers which block autoplay unlock on the first gesture.
Save.load();
applyUIScale();
Audio2.setMusicPaused('background', document.hidden);
Audio2.playTitle(0);
Audio2.init({ loadSfx: false });
Audio2.resume();
const unlockAudio = () => { Audio2.init(); Audio2.resume(); };
window.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
window.addEventListener('keydown', unlockAudio, { capture: true });
document.addEventListener('visibilitychange', () => Audio2.setMusicPaused('background', document.hidden));

initVoxelTitle();
let fleetProgress = 0, worldProgress = 0;
const paintProgress = () => { $('bootProgress').value = (worldProgress + fleetProgress) / 8; };
await Promise.all([
  preloadImportedAssets((loaded) => { worldProgress = loaded; paintProgress(); }),
  preloadPlayerFleet((loaded) => { fleetProgress = loaded; paintProgress(); }),
]);
if (!isPlayerShipId(Save.data.selectedShip)) Save.data.selectedShip = PLAYER_SHIPS[0].id;
const game = new Game();
const menuHalo = document.querySelector('.riftHalo');
let haloLayout = '';
function positionMenuHalo() {
  if (!game.titleMode) return;
  const bounds = game.worldShowcase.getMenuPlanetScreenBounds(game.camera, game.display);
  const diameter = Math.max(bounds.width, bounds.height) * 1.7;
  // Explicit bounds avoid Safari painting percentage-translated gradients
  // at the wrong origin when the page is zoomed or the viewport changes.
  const layout = `${(bounds.x - diameter / 2).toFixed(2)}px ${(bounds.y - diameter / 2).toFixed(2)}px ${diameter.toFixed(2)}px`;
  if (layout === haloLayout) return;
  haloLayout = layout;
  const [left, top, size] = layout.split(' ');
  menuHalo.style.left = left;
  menuHalo.style.top = top;
  menuHalo.style.width = size;
  menuHalo.style.height = size;
}
initMenuCursor({
  hitTestSkull: (x, y) => game.worldShowcase.isPointerOverSkull(
    x, y, game.camera, game.renderer.domElement.getBoundingClientRect()),
});
const hangar = new ShipHangar({
  selectedId: Save.data.selectedShip,
  onSelect(id) {
    Save.data.selectedShip = id;
    Save.save();
    game.player.setShip(id);
  },
});
game.hangar = hangar;
game.pilotIdentity = new PilotIdentity(game, hangar);
$('bootProgress').value = 1;
$('bootStatus').classList.add('hidden');
$('launchBtn').disabled = false;

// --- title screen ---
function paintTitle() {
  const d = Save.data;
  const line = $('titleStats');
  line.classList.toggle('hidden', d.runs === 0);
  if (d.runs === 0) {
    line.textContent = '';
  } else {
    const best = d.bestScore.toLocaleString();
    line.innerHTML =
      `BEST SCORE <b>${best}</b>${d.bestGrade ? ` <b class="gradeInline">${d.bestGrade}</b>` : ''}` +
      ` &middot; SCRAP BANKED <b class="gold">${d.scrapBanked.toLocaleString()}</b>` +
      (d.clears > 0 ? ` &middot; NEXUS BROKEN <b>${d.clears}x</b>` : '');
  }
}

function showTitle() {
  game.prepareTitle();
  Input.enabled = false;
  $('titleScreen').classList.remove('hidden');
  positionMenuHalo();
  game.resultsScreen.hide();
  $('pauseScreen').classList.add('hidden');
  game.hud.hide();
  $('boostBtn').classList.add('hidden');
  $('fireBtn').classList.add('hidden');
  paintTitle();
  Audio2.playTitle(1.5);
}

function launch() {
  game.optionsMenu.close({ restoreFocus: false });
  hangar.close();
  hangar.releasePreview();
  $('titleScreen').classList.add('hidden');
  // Audio must never block the run from starting: init() builds the context
  // and graph synchronously (ready right away) and decodes SFX in the
  // background — samples simply pop in as they finish loading.
  Audio2.init();
  Audio2.resume();
  game.startRun();
}

// --- wiring ---
$('launchBtn').addEventListener('click', () => game.pilotIdentity.requestLaunch(launch));
$('againBtn').addEventListener('click', () => {
  Audio2.resume();
  if (game.testRun) game.testing.enter();
  else game.startRun();
});
$('toTitleBtn').addEventListener('click', () => {
  Audio2.play('ui_select', 0.6, 1);
  showTitle();
});
$('pauseBtn').addEventListener('click', () => game.togglePause());
$('resumeBtn').addEventListener('click', () => game.togglePause());
$('quitBtn').addEventListener('click', () => game.quitRun());

Input.init(game.renderer.domElement, {
  onPause: ({ silent = false } = {}) => game.togglePause({ showMenu: !silent }),
});

initAudioSettings();
initUISettings();
game.optionsMenu = new OptionsMenu(game);
for (const button of document.querySelectorAll('.tutorialReplayBtn')) {
  button.addEventListener('click', () => {
    game.tutorial.armReplay();
    game.hud.toast('FIRST FLIGHT ARMED', 'The complete tutorial will begin on your next normal run.', '#27f5da',
      { category: 'instruction', duration: 4.2 });
  });
}

game.testing.onExit = showTitle;
game.testingPanel = new TestingGroundsPanel(game.testing);
game.controllerMenus = new ControllerMenus(game);

// --- loop ---
let last = performance.now();
document.addEventListener('visibilitychange', () => { last = performance.now(); });
function frame(ts) {
  requestAnimationFrame(frame);
  // clamp dt: a background tab must not teleport the player into a laser
  const presentationDt = Math.max(0, (ts - last) / 1000 || 0.016);
  const dt = Math.min(presentationDt, 0.05);
  last = ts;
  game.update(dt, presentationDt);
  positionMenuHalo();
  hangar.update(dt);
}

showTitle();
requestAnimationFrame(frame);

// expose for debugging in the console
window.RIFT = game;
if (new URLSearchParams(location.search).get('lab') === '1') game.testing.enter();
