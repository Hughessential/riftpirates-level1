# Rift Pirates — Level 1: Rift Approach

A complete, playable Three.js vertical slice built from the *Level 1 Progression System* handoff,
the *Player-System Notes*, and the concept-art board in `riftpirates_content/`.

You fly the **Star Hopper** down a collapsing rift corridor, break five objectives, and take the
**Rift Admiral** apart at the Nexus. Roughly 10–14 minutes of play per run.

---

## Running it

A local web server is **required** — the game uses ES modules and `fetch`-loaded audio, both of
which browsers block on `file://`.

```bash
npm start          # python3 -m http.server 8000
```

Then open **http://localhost:8000/index.html** and press **LAUNCH RUN**.

Any static server works (`npx serve`, `php -S localhost:8000`, VS Code Live Server…). There is no
build step and no bundler; Three.js r160 is vendored at `vendor/three.module.js` and wired through
an importmap.

### Controls

| Action | Keyboard | Touch |
|---|---|---|
| Steer | `WASD` / arrows | drag anywhere |
| Boost + Perfect Dodge | `Shift` | the `»` pad, bottom-right |
| Pause | `P` / `Esc` | pause button |
| Pick an upgrade | `1` `2` `3` | tap a card |
| Skip a cutscene | `Space` | tap |

Weapons autofire — your job is movement, positioning, and dodge timing.

---

## The level

Traversal → objective → upgrade cache, five times over.

| # | Objective | The idea |
|---|---|---|
| 1 | **Outer Defense Tower** | Teaches weak points. Kill the emitter and its tracking laser dies with it. |
| 2 | **Midrift Pressure Tower** | Gravity wells drag you off your line while pressure pulses and sweeping lasers punish where you land. Under 40% core it Overcharges. |
| 3 | **Inner Citadel** | Two shield generators absorb 90% of core damage. Kill both, then kill the core. |
| 4 | **Inhibitor** | Rotating shields eat your bolts; thread the gaps, drop the conduits, force the overload. Its death opens the rift to the Nexus. |
| 5 | **The Rift Admiral** | One 9,000 HP pool, four phases at 100/75/50/25%, six attacks, and a core that only vents after a major pattern. |

**Rift Heat** is the skill dial: aggression raises the score multiplier (1x → 12x, `COOL` through
`OVERDRIVE`), while getting hit or camping bleeds it away. **Perfect Dodge** — boost within 0.22s of
an incoming threat — refunds boost, buffs your guns, and pays a score bonus.

Five upgrade caches, three cards each, fifteen upgrades total. Caches 1–4 come from the spec; the
fifth (**Nexus Breaker / Reality Tear / Second Wind**) is the bonus cache on the concept-art
progression board, dealt during the Nexus approach so you meet the Admiral at full build.

---

## Layout

```
index.html          markup + importmap
src/
  core/             Game loop, LevelDirector (28-state machine), Scheduler, Input, Audio, Save
  player/           ship, stats, weapon
  combat/           projectile pool, targeting, collision + Perfect Dodge
  encounters/       the five objectives (all towers share TowerEncounter)
  enemies/          spawner + enemy types
  effects/          hazards, particles, damage numbers, death sequence
  systems/          Rift Heat, score, scrap, upgrades, XP
  ui/               HUD, upgrade screen, results screen
  config/           all balance numbers, in data
  render/           voxel builder, models, structures, environment
assets/             music + SFX
legacy/             the original endless-runner prototype, kept for reference
riftpirates_content/  the source material (PDFs, concept art, audio libraries)
```

Two rules the code holds to throughout:

- **No `setTimeout` for gameplay.** Everything schedules through `core/Scheduler.js` on game time, so
  pause and the death sequence's slow-motion are respected.
- **Hazards live in the player's screen plane.** Telegraphs are the hit test — what you see is
  exactly what can hurt you.

---

## Tests

Headless Chrome drives the real game and steps the simulation deterministically at `1/60`, so a full
run is verified in seconds. Start the server first, then:

```bash
npm test           # all three suites
npm run test:level    # full playthrough: every state, all five objectives, boss, victory, restart
npm run test:combat   # every attack in every encounter actually fires and hurts
npm run test:dodge    # Perfect Dodge awards on a near miss, never on a hit
npm run shots         # renders real frames to shots/ for visual checks
```

They need Chrome at the standard macOS path and `puppeteer-core` (`npm install`).
