# Rift Pirates — Level 1: Rift Approach

A complete, playable Three.js vertical slice built from the *Level 1 Progression System* handoff,
the *Player-System Notes*, and the concept-art board in `riftpirates_content/`.

Choose one of six cosmetic ships and fly down a collapsing rift corridor, break five objectives, and take the
**Rift Admiral** apart at the Nexus. Each approach offers three separate paid augment caches before
its objective, letting you build up your ship while you fight forward.

---

## Running it

A local web server is **required** — the game uses ES modules and `fetch`-loaded audio, both of
which browsers block on `file://`.

```bash
npm install
npm start          # Vite dev server on port 8000
```

Then open **http://localhost:8000/index.html** and press **LAUNCH RUN**.
For the developer sandbox, open **http://localhost:8000/?lab=1**, click **TESTING GROUNDS**, or press **F2**.
It includes god mode, all ships, editable ranks for all 75 augments, enemy/target spawning,
every encounter and boss phase, slow motion, live developer tuning, debug gizmos, presets,
and lighting/sound previews. Test progress is never banked.
See [the Testing Grounds guide](TESTING_GROUNDS.md) and [tuning extension guide](docs/testing-grounds-tuning.md);
run its checks with `npm run test:lab`.

Use **CHANGE SHIP** on the title screen to browse the six supplied voxel hulls.
The hangar shows their actual recolored geometry; all ships share identical
handling, weapons, health, shields and collision bounds. Selection is remembered
locally and survives restarts. Arrow keys or a controller browse the open hangar;
keys `1`–`6` select a hull and `Enter` confirms.
Leave the server running while playing. If localhost cannot connect, restart
`npm start` and reload the page. The original `python3 serve.py` command also
starts Vite. Plain Python/Live Server hosting does not support the source imports;
use Vite for development or serve the generated `dist/` folder after building.

For a production bundle, run `npm run build`; Vite writes the deployable site to `dist/`.
Three.js and its post-processing addons are installed through npm.

### GitHub Pages

The public game is **https://hughessential.github.io/riftpirates-level1/**. A push to
`main` runs `.github/workflows/deploy-pages.yml`: it installs locked npm dependencies,
builds with the `/riftpirates-level1/` base path, and publishes `dist/` through
GitHub Pages Actions. The source files in the repository root are not a deployable
site by themselves. The former Pages version is preserved at the
`archive/pre-portfolio-pages-2026-11-13` tag; the full current source remains in
Git history and on `codex/combat-spectacle-display`.

To check a finished deployment in a browser, run
`RIFT_URL=https://hughessential.github.io/riftpirates-level1/ npm run test:pages`.
The smoke check loads the published JavaScript, CSS, font, voxel ships, soundtrack
and sound effects, then launches, pauses and resumes a run.

### Controls

The default gamepad layout keeps flight controls on the triggers and south face button:

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Steer | `WASD` / arrows | left stick | drag anywhere |
| Camera (auto-recenters on release) | — | right stick | — |
| Fire / primary weapon | `Space` | `RT` | the `✦` pad, above boost |
| Aim / lock-on | `F` | `X` | hold the fire pad |
| Boost + Perfect Dodge | `Shift` | `LT` | the `»` pad, bottom-right |
| Brake / slow down | `C` | `A` | — |
| Barrel Roll left / right | double-tap `A` / `D` or arrows; `Q` / `E` shortcut | double-flick stick or double-tap d-pad; `LB` / `RB` shortcut | — |
| Pause | `P` / `Esc` | `Start` | pause button |
| Pick an upgrade | `A` / `D` or arrows, then hold `Space` | d-pad/stick, then hold `A` | tap a card |
| Skip a cutscene | `Space` / `Enter` | `A` when available | tap |

Controller menus support the stick or D-pad to move focus, physical `A` regardless of the gameplay fire binding
to select, the east face button to go back, and left/right to adjust sliders,
numbers and choices. LB/RB switch Testing Grounds tabs. Title, ship hangar,
pause/audio, augment cards, results and Testing Grounds use the same navigation.
The augment search has a controller keyboard. Disconnecting pauses a live run;
reconnecting or leaving a menu requires releasing confirm before firing.

Use **CONTROLLER SETUP** on the title/pause menu (or View/Select) to save button
bindings, stick axes and deadzone per device. MCON should use its **X-Input**
mode. Xbox, PlayStation and Switch controllers use the browser's standard mapping;
nonstandard devices can be configured in setup. Controller recognition still
depends on the operating system/browser exposing the device through the Gamepad
API. Automated checks use virtual pads, not physical MCON hardware.
Some browsers require one click or key press before audio can play; if audio is
blocked, a small hint explains how to enable it while controller navigation stays
available.

Gameplay bindings remain remappable per controller. Menu confirmation always stays
on physical `A`, so changing the primary-fire binding can never strand a menu.

Firing is fully manual and shots only go where you're aimed: bolts fly
straight down the nose, so you line up shots by flying. Holding **aim**
raises the red reticle and lets the assist lock anything inside a narrow
forward cone — locked shots converge on it, and the reticle turns gold.
Nothing behind or beside you can be locked, so lasers never fire backwards.
**Brake** drops the ship to ~45% speed for threading gates and steadying your
aim; boost overrides it. Any standard-mapped controller (Ohsnap MCON, Xbox,
PlayStation, most Bluetooth pads) is picked up automatically once you nudge a
stick or press a button; the camera stick free-looks around the Star Hopper
and always locks back to the front-facing camera the moment you release it.

Your ship repairs 2 hull/sec after 6 seconds without damage. Its 40-point shield
waits 8 seconds after a partial hit, or **14 damage-free seconds after depletion**,
then restores 4 shield/sec. Hull hits restart the full depletion delay. The HUD
shows the countdown; upgrades improve capacity/recovery without bypassing the
lockout. A **barrel roll** is a quick
i-framed dash on a short cooldown; roll *through* incoming fire and it still
counts as a Perfect Dodge.

---

## The level

Three approach beats with augment checkpoints → objective → repair break.
The Outer Defense approach lasts 104 seconds of flight time: scout pickets,
salvage lanes and laser gates, a shield escort and bounty ace, then a final rush.
Choosing cards freezes flight, danger, Heat and the route timer.

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

Three caches precede each tower and the Inhibitor, with one final cache before the
Admiral. Each shows exactly three distinct choices from **75 repeatable augments**
across weapons, survival, speed, loot and anomalies. Purchase one or **SKIP & SAVE**;
mouse/touch, keys `1`–`3`, `S`, Tab/Enter and gamepad navigation all work.

Plunder physical treasure to fund the current-run wallet. Base prices are **100 /
250 / 650 / 1,600 SCRAP** for Standard / Rare / Ultra-Rare / Mythic. Further ranks
cost 25% more per owned rank, rounded up to the next 10 scrap. Historical banked
scrap stays separate; only the unspent remainder banks on death or victory.
The new tiers contain ten powers each, including spectral broadsides, blink
slashes, defensive crystal halos, ghost armadas and black-hole fortresses.

See [the original 45 arsenal guide](MAYHEM_ARSENAL.md) and the
[cosmic augment and economy guide](COSMIC_AUGMENTS_AND_ECONOMY.md) for mechanics,
starting balance, known adaptations and verification commands. Objective clears
still repair hull and boost while normal shield recovery continues.

The weapon system uses seventeen distinct neon projectile styles and eighteen
original sound cues selected from the supplied retro SFX collection. Four
instanced GPU batches support 1,024 player bolts and 512 enemy shots. Enemy
fans, four-lane volleys and gapped rings warn before firing; concentrated damage
numbers are grouped to preserve combat visibility.

The scenery uses about 28,000 extra decorative surface voxels in six instanced
draw calls: drifting rock reefs, broken bastions, wrecks, fragments and passing
ships. These sit around the combat corridor and are not collision obstacles.

Seven original models from the supplied voxel archive now populate the game.
Five distinct enemy hulls include weaving Micro Recons and twin-cannon Dual
Strikers; giant robot guardians and passing convoys inhabit the route edges.
The title screen pairs turquoise/violet voxel lettering and obsidian neon trim with a
block-built pirate planet, neon orbital rings, a glowing pointer star and the
ship hangar. A local digital pixel font spans the menus and HUD. The pause screen
uses an orbital skull centerpiece and matching controls. Deep-black space and a
very faint, static display texture preserve clear combat silhouettes and signals.

Desktop presentation scales together through QHD, 4K and ultrawide windows.
Camera, canvas and postprocessing resize together, including changes in monitor
pixel density. Every tower and the Admiral has a skippable, pause-safe camera
reveal with its own title and color. Replay them from Testing Grounds.

Weapon stacks now change laser silhouettes, trails, elemental colors and sound;
upgrade cards show actual stat deltas and the reactor HUD shows current output.
Enemy hulls have locked, visible warnings before ion volleys, crossfire lances,
mine clusters, shield pulses or blink attacks. Later sectors increase fleet
pressure. Loot shimmers in white, gold, violet, teal and pink.

The **official soundtrack** now owns the title, five-song ordinary gameplay
shuffle, every tower/boss, and the final escape. Boss music continues from
introduction through combat and phases; long sessions use a deliberate end
fade and same-recording restart. After the Admiral falls, reach the final rift
before the 135-second collapse deadline to earn victory. See
[soundtrack and escape notes](SOUNDTRACK_ESCAPE.md) for timing, recovery and tests.
The escape now escalates through five assault stages: up to 40 live attackers,
reinforcing formations, a surrounding capital fleet breaking apart, expanding
blast rings and dense glowing wreckage. Required cyan openings remain visible
as the armada and destruction intensify toward the final rift.
Master volume starts at 100%; music and SFX both start at 75%. Shared master plus
separate channel sliders and mute controls on
the title and pause menus save your preferred mix across visits.

Imported models are loaded before launch, share cached geometry, and fall back
to procedural models if a file cannot load. Source paths are recorded in
`assets/voxels/SOURCES.md`.

The fleet parser builds each recolored hull once. Asset requests retry transient
failures, and short sound downloads/decodes use four prioritized workers to avoid
flooding startup. Three.js is bundled separately for caching across game updates.
The finishing effects share one pass, unchanged HUD text avoids DOM rewrites,
and hidden tabs stop rendering. During sustained slow gameplay, internal render
resolution steps down conservatively (minimum 65%) and recovers after stable
frames; UI size, camera proportions, enemies and combat stay unchanged. Returning
to the title restores full detail.

---

## Layout

```
index.html          markup + Vite module entry
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
assets/             music, SFX + imported voxel models
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
npm test             # assets, augments, approaches, walkthrough, combat, dodge and music
npm run test:mayhem   # stacked arsenal rendering, audio, pause/reset and shield HUD
npm run test:menu     # desktop layout, voxel typography, reduced motion and launch
npm run test:ships    # six cosmetic selections, equal stats, persistence and hangar controls
npm run test:music    # official title/boss/finale mappings, continuity and pause/resume
npm run test:escape   # ending, deadline, save isolation and legal-build movement pilots
npm run test:carnage  # staged horde pressure, destruction pools, captures and cleanup
npm run test:display  # QHD/4K/ultrawide, monitor-density switches, loot and augment previews
npm run test:intros   # all five cinematic reveals, pause/skip, camera and lab replay
npm run test:audio    # saved music/SFX faders, mute, keyboard and pause behavior
npm run test:controllers # virtual gamepads, menu coverage and per-device setup
npm run test:assets   # parser fidelity, retries, bounded audio and failure recovery
npm run test:render   # adaptive resolution, hidden tabs, HUD churn and GPU cleanup
npm run test:approach # three pre-objective choices, safety/pause/reset regression
npm run test:level    # full playthrough: every state, all five objectives, boss, victory, restart
npm run test:combat   # every attack in every encounter actually fires and hurts
npm run test:dodge    # Perfect Dodge awards on a near miss, never on a hit
npm run shots         # renders real frames to shots/ for visual checks
```

They need Chrome at the standard macOS path and `puppeteer-core` (`npm install`).
