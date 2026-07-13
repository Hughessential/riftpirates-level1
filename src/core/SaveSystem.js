/**
 * Persistence (spec §29). Scrap banks across runs and survives death; temporary
 * run upgrades never persist. localStorage with an in-memory fallback so the
 * game still runs when storage is blocked (private windows, file://).
 */
const KEY = 'riftpirates-level1-v1';

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
  seenIntro: 0, // lets us offer a skip on the Nexus cinematic after the first view
};

export const Save = {
  data: { ...DEFAULTS },

  load() {
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
    return this.data;
  },

  save() {
    store.set(KEY, JSON.stringify(this.data));
  },

  bankRun({ scrap, score, time, grade, cleared }) {
    const d = this.data;
    d.scrapBanked += scrap;
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
  },
};
