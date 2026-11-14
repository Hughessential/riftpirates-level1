import { Save, clampUIScale, UI_SCALE_DEFAULT } from '../core/SaveSystem.js';

const percentage = value => `${Math.round(value * 100)}%`;

/** Saved interface scale. It affects DOM UI only; the WebGL canvas and world
 * coordinates retain the viewport metrics owned by Game/DisplayLayout. */
export function applyUIScale(value = Save.data.uiScale ?? UI_SCALE_DEFAULT) {
  const scale = clampUIScale(value);
  Save.data.uiScale = scale;
  const root = document.documentElement;
  root.style.setProperty('--ui-user-scale', String(scale));
  root.dataset.uiScale = String(scale);
  window.dispatchEvent(new CustomEvent('rift-ui-scale', { detail: scale }));
  return scale;
}

export function initUISettings() {
  const sliders = [...document.querySelectorAll('[data-ui-scale]')];
  const paint = () => {
    const scale = applyUIScale(Save.data.uiScale);
    for (const slider of sliders) {
      slider.value = String(Math.round(scale * 100));
      slider.style.setProperty('--volume', `${Math.round((scale - .8) / .6 * 100)}%`);
      slider.setAttribute('aria-valuetext', percentage(scale));
      const output = document.getElementById(`${slider.id}Value`);
      if (output) output.value = percentage(scale);
    }
  };
  for (const slider of sliders) {
    slider.addEventListener('input', () => {
      Save.data.uiScale = clampUIScale(Number(slider.value) / 100);
      Save.save();
      paint();
    });
  }
  paint();
  return paint;
}
