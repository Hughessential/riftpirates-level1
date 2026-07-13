import { Game } from './core/Game.js';
import { Save } from './core/SaveSystem.js';
import { Audio2 } from './core/AudioManager.js';
import { Input } from './core/Input.js';
import { $ } from './core/Utils.js';

Save.load();
const game = new Game();

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
  game.running = false;
  Input.enabled = false;
  $('titleScreen').classList.remove('hidden');
  $('resultsScreen').classList.add('hidden');
  $('pauseScreen').classList.add('hidden');
  game.hud.hide();
  $('boostBtn').classList.add('hidden');
  paintTitle();
  Audio2.playMusic('title', 1.5);
}

async function launch() {
  $('titleScreen').classList.add('hidden');
  await Audio2.init();
  Audio2.resume();
  game.startRun();
}

// --- wiring ---
$('launchBtn').addEventListener('click', launch);
$('againBtn').addEventListener('click', () => {
  Audio2.resume();
  game.startRun();
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

// audio toggles (mirrored across the title and pause screens)
function wireToggle(id, key) {
  const el = $(id);
  const paint = () => {
    const on = !!Save.data[key];
    el.textContent = `${key === 'music' ? 'MUSIC' : 'SFX'}: ${on ? 'ON' : 'OFF'}`;
    el.classList.toggle('on', on);
  };
  el.addEventListener('click', () => {
    const next = !Save.data[key];
    if (key === 'music') Audio2.setMusicEnabled(next);
    else Audio2.setSfxEnabled(next);
    Audio2.play('ui_select', 0.5, 1);
    for (const other of ['musicTgl', 'musicTgl2', 'sfxTgl', 'sfxTgl2']) {
      const o = $(other);
      if (!o) continue;
      const k = other.startsWith('music') ? 'music' : 'sfx';
      o.textContent = `${k === 'music' ? 'MUSIC' : 'SFX'}: ${Save.data[k] ? 'ON' : 'OFF'}`;
      o.classList.toggle('on', !!Save.data[k]);
    }
  });
  paint();
}
wireToggle('musicTgl', 'music');
wireToggle('musicTgl2', 'music');
wireToggle('sfxTgl', 'sfx');
wireToggle('sfxTgl2', 'sfx');

// --- loop ---
let last = performance.now();
function frame(ts) {
  requestAnimationFrame(frame);
  // clamp dt: a background tab must not teleport the player into a laser
  const dt = Math.min((ts - last) / 1000 || 0.016, 0.05);
  last = ts;
  game.update(dt);
}

showTitle();
requestAnimationFrame(frame);

// expose for debugging in the console
window.RIFT = game;
