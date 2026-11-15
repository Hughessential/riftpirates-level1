/**
 * Persistence (spec §29). Scrap banks across runs and survives death; temporary
 * run upgrades never persist. localStorage with an in-memory fallback so the
 * game still runs when storage is blocked (private windows, file://).
 */
import { PILOT_IDENTITY_DEFAULTS, validatePilotName } from './PilotName.js';

const KEY = 'riftpirates-level1-v1';

export const AUDIO_DEFAULTS = { masterVolume: 1, musicVolume: .75, sfxVolume: .75 };
export const clampAudioVolume = (value, fallback) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
export const UI_SCALE_DEFAULT = 1.1;
export const clampUIScale = value => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return UI_SCALE_DEFAULT;
  return Math.round(Math.max(.8, Math.min(1.4, numeric)) * 20) / 20;
};

const mem = {};
const store = {
  get(k) {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return k in mem ? mem[k] : null;
    }
  },
  set(k, v) {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      mem[k] = v;
    }
  },
};

const DEFAULTS = {
  scrapBanked: 0,
  bestScore: 0,
  bestTime: 0, // seconds; only written on a victory
  bestGrade: '',
  runs: 0,
  clears: 0,
  music: 1,
  sfx: 1,
  ...AUDIO_DEFAULTS,
  uiScale: UI_SCALE_DEFAULT,
  tutorialComplete: false,
  ...PILOT_IDENTITY_DEFAULTS,
  seenIntro: 0, // lets us offer a skip on the Nexus cinematic after the first view
  selectedShip: 'rift-talon', // cosmetic hull only; never changes run stats
  lastBankedRunId: '', // additive: prevents a repeated results callback banking twice
};

export const Save = {
  data: { ...DEFAULTS },

  load() {
    // Each load begins from the current schema so fields missing from an older
    // save receive additive defaults without inheriting stale in-memory data.
    this.data = { ...DEFAULTS };
    try {
      const raw = store.get(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        for (const k of Object.keys(DEFAULTS)) {
          if (k in d) this.data[k] = d[k];
        }
      }
    } catch {
      /* corrupt save — fall back to defaults rather than blocking the run */
    }
    for (const [key, fallback] of Object.entries(AUDIO_DEFAULTS)) {
      this.data[key] = clampAudioVolume(this.data[key], fallback);
    }
    this.data.uiScale = clampUIScale(this.data.uiScale);
    this.data.tutorialComplete = this.data.tutorialComplete === true;
    const pilot = validatePilotName(this.data.pilotName);
    this.data.pilotName = pilot.valid ? pilot.name : PILOT_IDENTITY_DEFAULTS.pilotName;
    this.data.pilotNameConfirmed = pilot.valid && this.data.pilotNameConfirmed === true;
    return this.data;
  },

  save() {
    store.set(KEY, JSON.stringify(this.data));
  },

  bankRun({ scrap, score, time, grade, cleared, runId }) {
    const d = this.data;
    if (runId && d.lastBankedRunId === runId) return false;
    const remainder = Number.isFinite(scrap) ? Math.max(0, Math.floor(scrap)) : 0;
    d.scrapBanked = Math.max(0, Number(d.scrapBanked) || 0) + remainder;
    if (runId) d.lastBankedRunId = runId;
    d.runs += 1;
    if (score > d.bestScore) {
      d.bestScore = score;
      d.bestGrade = grade;
    }
    if (cleared) {
      d.clears += 1;
      if (!d.bestTime || time < d.bestTime) d.bestTime = time;
    }
    this.save();
    return true;
  },
};
