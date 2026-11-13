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

initVoxelTitle();
initMenuCursor();
let fleetProgress = 0, worldProgress = 0;
const paintProgress = () => { $('bootProgress').value = (worldProgress + fleetProgress) / 8; };
await Promise.all([
  preloadImportedAssets((loaded) => { worldProgress = loaded; paintProgress(); }),
  preloadPlayerFleet((loaded) => { fleetProgress = loaded; paintProgress(); }),
]);
Save.load();
if (!isPlayerShipId(Save.data.selectedShip)) Save.data.selectedShip = PLAYER_SHIPS[0].id;
const game = new Game();
const hangar = new ShipHangar({
  selectedId: Save.data.selectedShip,
  onSelect(id) {
    Save.data.selectedShip = id;
    Save.save();
    game.player.setShip(id);
  },
});
game.hangar = hangar;
$('bootProgress').value = 1;
$('bootStatus').classList.add('hidden');
$('launchBtn').disabled = false;

// --- title screen ---
function paintTitle() {
  const d = Save.data;
  const line = $('titleStats');
  if (d.runs === 0) {
    line.innerHTML = 'FIRST FLIGHT, CAPTAIN.';
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
  $('resultsScreen').classList.add('hidden');
  $('pauseScreen').classList.add('hidden');
  game.hud.hide();
  $('boostBtn').classList.add('hidden');
  $('fireBtn').classList.add('hidden');
  paintTitle();
  Audio2.playTitle(1.5);
}

function launch() {
  hangar.close();
  $('titleScreen').classList.add('hidden');
  // Audio must never block the run from starting: init() builds the context
  // and graph synchronously (ready right away) and decodes SFX in the
  // background — samples simply pop in as they finish loading.
  Audio2.init();
  Audio2.resume();
  game.startRun();
}

// Unlock the requested title theme on the first real interaction. Launch still
// starts immediately, even when an audio device or a recording is unavailable.
const unlockAudio = () => { Audio2.init(); Audio2.resume(); };
window.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
window.addEventListener('keydown', unlockAudio, { capture: true });

// --- wiring ---
$('launchBtn').addEventListener('click', launch);
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
  onPause: () => game.togglePause(),
});

initAudioSettings();

game.testing.onExit = showTitle;
game.testingPanel = new TestingGroundsPanel(game.testing);

// --- loop ---
let last = performance.now();
function frame(ts) {
  requestAnimationFrame(frame);
  // clamp dt: a background tab must not teleport the player into a laser
  const dt = Math.min((ts - last) / 1000 || 0.016, 0.05);
  last = ts;
  game.update(dt);
  hangar.update(dt);
}

showTitle();
requestAnimationFrame(frame);

// expose for debugging in the console
window.RIFT = game;
if (new URLSearchParams(location.search).get('lab') === '1') game.testing.enter();
