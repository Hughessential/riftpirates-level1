# Official soundtrack and final escape

The ending uses the existing game and AudioManager. The later carnage pass
expands escape-only enemy pressure and destruction while retaining the route,
deadline, 45 augments, cosmetic ship stats and shield-recovery rules. Music and
SFX now also have saved, independent volume controls.

## Recovery checkpoint

Before editing, 157 source/runtime files were archived, including all relevant
uncommitted and untracked work. Every archived file was verified against its
SHA-256 hash. No required source assets were ignored; generated `node_modules`,
`dist`, screenshots and `.DS_Store` were excluded. Browser storage was untouched.

Checkpoint directory:

`/Users/devonhughes/.codex/visualizations/2026/11/11/01a1c815-4b33-7f53-a12f-bfc9b1ed27c7/riftpirates-pre-ost-escape-20261113-000356`

It contains `source.tar.gz`, `manifest.json`, `git-state.json`, `tracked.patch`
and recovery instructions. Original branch: `codex/portfolio-v1-overhaul`.
Original HEAD: `cfc7781f44596b18d73e5c53d8a99d5c18afad83`.
Work branch: `codex/official-ost-final-escape`. Nothing was committed or published.

For a complete recovery, extract `source.tar.gz` into a **new empty directory**
and run `npm ci`; do not overwrite the active checkout. For a targeted undo of
this addition, the checkpoint's `undo-additions.py --check` checks affected
files against their final hashes. `--apply` restores only this pass's changed
files and removes only its new files. It refuses if an affected file has later
edits. Unrelated files and browser saves are never touched.

## Audio ownership

The supplied archive is named `RIFTPIRATES OFFICIAL SOUNDTRACK.zip`, without
the brief's `2` suffix. Its eight filenames match the corrected inventory.
Original MP3 bytes are unchanged; hashes and source names are recorded in
`assets/music/official-soundtrack-sources.json`.

| Scene | Exact source filename |
| --- | --- |
| Title | Rift Pirates OFFICIAL Main Title Theme.mp3 |
| All towers, Inhibitor, Admiral | Boss Battle OFFICAL soundtrack.mp3 |
| Escape | The Very Very End.mp3 |
| Gameplay shuffle only | arcade.mp3, astral.mp3, neondrift.mp3, pixelatedvoid.mp3, thepirateking.mp3 |

Shuffle bags have no immediate boundary repeats and preserve the interrupted
track. A fresh encounter restarts the boss recording; intro, combat, phases and
destruction continue it. Long dedicated recordings fade their final 1.4 seconds
and restart the same full recording with a fade-in; this is deliberately not a
claim of seamless looping. Existing victory/defeat result cues remain.

Music/SFX switches retain their save format. Pausing, the lab console and hidden
tabs hold music; returning from a hidden tab requires deliberate game resume.
The original MP3 tempo is preserved. Escape frame study holds the recording
until normal speed resumes. Drift over one second is corrected to simulation
time; missing or muted audio never controls progression. Existing weapon sounds
and attribution are retained.

## Escape rules

The Admiral's destruction now opens ESCAPE instead of victory. Collected loot,
score, health, shields and augments carry forward. The route is 6,350 world units
with a genuine 135-second deadline. Base forward travel is 44 units/second;
held boost adds 16 scaled by the earned boost-speed stat. At base stats the route
requires at least 25.625 seconds of boost before the deadline. No boost times out.

Thirty-one increasingly narrow collapse walls have fixed cyan openings and
advance warning. Existing enemy ships pursue; all normal weapons, armor,
shield recovery, rolls and Perfect Dodge remain active. The final rift appears
during the last third. Victory requires reaching its distance and entering its
aperture; arriving outside it leaves time to align until the deadline. Death
uses the existing failure sequence. Deadline failure cannot be blocked by a
rescue charge or god mode. Results/rewards finalize once.

The clock follows active simulation time. Pause, background tabs and lab console
hold it; existing Perfect Dodge slows nearby enemy bolts only. No augment choice
interrupts escape. Music ending cannot win or fail the route.

Testing Grounds → Arena → FINAL ESCAPE enters or retries with the selected ship
and build. Lab results remain unsaved. Disable god mode, infinite boost and other
overrides to evaluate survival honestly.

## Armada and galactic collapse

Five stages raise pressure with route progress and elapsed time; waiting cannot
hold the opening difficulty. Enemy strength does not scale against the player's
build. The stages are Armada in Pursuit, Fleet Collision, Stellar Rupture,
Galactic Extinction and Event Horizon.

Real attack formations grow from a 12-ship cap to 18, 26, 34 and finally 40.
These use the existing killable enemy hulls, normal weapon damage and loot.
They arrive in changing formations, fire staggered locked salvos, peel past the
player and receive reinforcements. Short wall-crossing windows and the final
rift mouth exclude converging fire so a required opening remains traversable.
Up to 350 hostile shots are allowed within the existing 512-shot pool.

A separate instanced battlefield surrounds the route: up to 12 capital hulls,
84 distant fighters and 120 crossfire streaks. Capital ships break in stages,
with large fireballs, expanding shock rings and trailing wreckage. Real combat
kills trigger additional destruction feedback. The spectacle has fixed pools
of 1,700 fragments and 24 simultaneous explosions, independent of ordinary hit
effects. Distant blasts are visual; they do not create invisible damage zones.
Foreground fade and peripheral placement preserve the cyan route and final rift.

All spawning, destruction and motion follow simulation time. Pause/lab holds
them, and leaving, dying or retrying disposes both fleet and spectacle resources.
The official finale recording and its timing are unchanged.

`npm run test:carnage` verifies real targets/fire, staged escalation, fixed
budgets, pause, kill feedback, captures and cleanup. `npm run test:escape` keeps
the full ending/save/music checks and three mortal 13-pick steering pilots.

## Verification and limits

Changed runtime files: `AudioManager.js`, music hooks in `main.js` and
`RiftAdmiralBoss.js`, `Game.js`, `GameState.js`, `LevelDirector.js`,
`TestingGrounds.js`, `TestingGroundsPanel.js` and `HUD.js`. New gameplay is isolated
in `FinalEscape.js` and `finalEscapeRoute.js`. Eight source recordings and a
manifest were added under `assets/music`. Package test commands, focused music/
escape tests, the level walkthrough and the relevant project guides were updated.

Baseline build and full `npm test` passed before edits. Stage 1 independently
passed build, `test:music` and music ownership tests before escape integration.
The focused escape test exercises Admiral destruction, physical rift entry,
timeout/death, duplicate callbacks, legacy saves, pause/background behavior,
lab retry/isolation and unavailable music.

After integration, build and the full `npm test` passed. Existing `test:menu`,
`test:ships`, `test:mayhem` and `test:lab` also passed. The menu was checked at
1440×900 and 1280×800. Final escape captures were inspected at 1440×900, then
focused escape checks were repeated after the readability adjustments. Vite
still reports its existing large-bundle advisory; no build failure occurred.

After the carnage pass, three 13-pick, level-8 builds with cheats off and bounded
200ms input decisions completed the route. The balanced/arsenal builds lost
about 111–154 hull and had approximately 4–6 seconds remaining; the survival
build used kill-triggered boost refunds and had about 17 seconds remaining.
The probes reached 135 live hostile projectiles; a parked pilot failed. These
are automated probes starting healthy, not human difficulty ratings after a
damaged Admiral fight. Human playtesting and hardware performance profiling
remain necessary. Visual checks use software-rendered desktop captures.

The finale decodes cleanly at 140.06 seconds (boss 261.2; title 269.6). Audible
listening/mix review remains unverified. No beat/drop timestamps were assigned;
escalation cues follow route progress rather than guessed musical events.
