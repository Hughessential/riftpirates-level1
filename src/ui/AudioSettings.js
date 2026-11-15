import { Audio2 } from '../core/AudioManager.js';
import { Save } from '../core/SaveSystem.js';

/** The title and pause menus share master/channel levels; mute remembers each channel level. */
export function initAudioSettings() {
  const sliders = [...document.querySelectorAll('[data-audio-volume]')];
  const toggles = ['musicTgl', 'musicTgl2', 'sfxTgl', 'sfxTgl2']
    .map(id => document.getElementById(id)).filter(Boolean);
  const paint = () => {
    for (const toggle of toggles) {
      const key = toggle.id.startsWith('music') ? 'music' : 'sfx';
      const on = !!Save.data[key];
      toggle.textContent = `${key === 'music' ? 'MUSIC' : 'SFX'}: ${on ? 'ON' : 'OFF'}`;
      toggle.classList.toggle('on', on);
      toggle.setAttribute('aria-pressed', String(on));
    }
    for (const slider of sliders) {
      const key = slider.dataset.audioVolume;
      const percentage = Math.round(Save.data[`${key}Volume`] * 100);
      slider.value = percentage;
      slider.style.setProperty('--volume', `${percentage}%`);
      const muted = key !== 'master' && !Save.data[key];
      slider.setAttribute('aria-valuetext', `${percentage} percent${muted ? ', muted' : ''}`);
      slider.closest('.audioChannel').classList.toggle('isMuted', muted);
      document.getElementById(`${slider.id}Value`).value = `${percentage}%`;
    }
  };
  for (const toggle of toggles) toggle.addEventListener('click', () => {
    const key = toggle.id.startsWith('music') ? 'music' : 'sfx';
    if (key === 'music') Audio2.setMusicEnabled(!Save.data.music);
    else Audio2.setSfxEnabled(!Save.data.sfx);
    paint();
    Audio2.play('ui_select', .5, 1);
  });
  for (const slider of sliders) {
    slider.addEventListener('input', () => {
      const value = Number(slider.value) / 100;
      if (slider.dataset.audioVolume === 'master') Audio2.setMasterVolume(value);
      else if (slider.dataset.audioVolume === 'music') Audio2.setMusicVolume(value);
      else Audio2.setSfxVolume(value);
      paint();
    });
    slider.addEventListener('change', () => {
      if (slider.dataset.audioVolume !== 'music') Audio2.play('ui_select', .5, 1);
    });
  }
  for (const mixer of document.querySelectorAll('.audioMixer')) {
    // Preserve native arrows/Home/End and button Space/Enter. Do not let those
    // keys steer, fire, roll, or skip a cutscene behind the menu. Keyup still
    // reaches Input so a key held before focus cannot get stuck.
    mixer.addEventListener('keydown', event => {
      if (event.code !== 'Escape' && event.code !== 'KeyP') event.stopPropagation();
    });
  }
  paint();
  return paint;
}
