# Endgame music, victory presentation and pilot identity

Implemented locally on 2026-11-13. Nothing deployed or pushed.

## Recoverable pre-edit checkpoint

Annotated local tag `archive/pre-endgame-music-identity-2026-11-13` resolves to
`aac6cee9c74ee76ae6861298bac0ade3f5eb2e05`. Before editing, tracked changes and relevant
untracked files were checked: the working tree was clean. The tag therefore protects
the complete existing game, including all previous augment/economy work and the legacy music.
Recover or inspect it in a separate checkout; no reset is needed.

## Exact music routing

| Game state | Shipped recording |
| --- | --- |
| Title | `Rift Pirates OFFICIAL Main Title Theme.mp3` |
| All five tower/boss encounters, including Admiral | `Boss Battle OFFICAL soundtrack.mp3` |
| Ordinary gameplay | Shuffle bag: `arcade.mp3`, `astral.mp3`, `neondrift.mp3`, `pixelatedvoid.mp3`, `thepirateking.mp3` |
| Final escape | `The Very Very End.mp3` |
| Confirmed death / failed escape / failure review | `sorryyoudied.mp3` |
| Genuine final-rift success / celebration / victory review | `Afterthefinalescape.mp3` |

The two supplied MP3s are byte-identical to the Downloads originals; hashes and sizes
are recorded in `assets/music/official-soundtrack-sources.json`. Original tempo remains intact.
Ending recordings deliberately repeat their entire source with a short fade. They do not
fall through to gameplay shuffle. The OST bypasses the death effect's SFX filter.

Removed from shipping: `defeat.m4a`, `victory.mp3`, `title.m4a`, `level1_a.m4a`,
`level1_b.m4a`, `level1_c.m4a`. Crystal Lake and boss.m4a were already absent. No SFX assets
were removed. Missing approved music reports the exact filename and never borrows a
legacy or reserved-state song.

## Behavior and implementation

- `AudioManager.js`: explicit approved themes, terminal ownership, bounded transitions,
  async ownership protection, same-recording repetition, settings/background/unlock handling.
- `Game.js`, `LevelDirector.js`, `DeathSequence.js`: one terminal outcome, revival-first
  death, genuine-rift-only success, cleared hostile simulation/callbacks, and continuous music.
  Results settle immediately on success, independently of decorative presentation.
- `RunResults.js`, `ResultsScreen.js`, `VictoryPresentation.js`, `results-screen.css`,
  `VoxelTitle.js`, results markup in `index.html`: selected-hull hero, captain identity,
  voxel headline, bounded fireworks/diamonds/rings, immutable earned recap, strict personal
  best comparison, once-only saving/banking, and distinct failure review. Keyboard, touch,
  mouse and gamepad can skip the count-up and inspect long builds.
- `PilotName.js`, `PilotIdentity.js`, `pilot-identity.css`, `SaveSystem.js`, `ShipHangar.js`,
  `ControllerMenus.js`, `main.js`: first-use name creation, easy PIRATE default, title/hangar
  editing, run identity snapshots, projected neon ship tags, optional tag visibility and
  controller text entry. Existing save key and records remain intact.
- `TestingGrounds.js`, `TestingGroundsPanel.js`: session-only identity editing and explicit
  preview controls for both endings. Preview scores, wallets and identity settings are not saved.

## Controls and tuning

Launch for the first time to create a captain name. Later use CAPTAIN / EDIT NAME on the
title or the nameplate in the hangar. Names accept 1–16 visible graphemes, ordinary Unicode
letters/numbers, spaces, hyphens and underscores; invisible characters/markup are rejected.
Name validation/defaults live in `PilotName.js`; tag dimensions/offset live in
`PILOT_TAG_LAYOUT` in `PilotIdentity.js`.

F2 opens Testing Grounds. PILOT → EDIT TEST PILOT / NAME TAG edits only the test session.
ARENA → PREVIEW VICTORY or PREVIEW DEATH exercises the end screens without changing saves.

`VICTORY_STYLE` centralizes the 2.2-second count-up, 240-particle pool (112 at lower render
quality), five rings, 30 Hz drawing, 1.25 decorative DPR limit and occasional review bursts.
Reduced motion removes moving fireworks, ship floating and count-up, retaining a calm
crystalline composition. Decorative objects never touch loot or combat systems.

## Verification

Focused suite: `npm run test:endgame` (requires the local dev server for browser checks).
Full regression: `npm test`. Existing controller, economy, cards, lab and production Pages
smoke suites remain available. Ordinary gameplay tests complete the real default-name
step through `tests/helpers/start-run.mjs`.

Passed on the final frozen-source run:

- `npm test`: all unit/core checks, full approach progression, all bosses, complete
  level walkthrough, combat/dodge integrity, soundtrack continuity and real escape pilots.
- `npm run test:endgame`: immutable settlement, validation/save fallback, actual ending
  MP3 decode and routing, revival suppression, death-frame hostile shutdown, six hull
  name tags, all input methods, responsive results, reduced motion and effect cleanup.
- `npm run test:lab`, `npm run test:cards`, `npm run test:menu`.
- `npm run test:economy`; controller menu suite also passed after the controller changes.
- `npm run build -- --base=/riftpirates-level1/` and the production `test:pages` smoke
  check at `http://localhost:8001/riftpirates-level1/`: all runtime assets, boot, launch,
  pause and resume. This was local verification, not a deployment.
- Production music directory contains exactly ten approved recordings; every SHA-256
  matches the source manifest. Removed legacy recordings remain readable from the tag.
- `git diff --check` passes; SFX asset paths have no modifications.

A prior broad browser run was interrupted by a Vite hot reload during final UI edits;
its replacement frozen-source run passed. The ship-selection screenshot timer timed out under concurrent-browser load; its
standalone rerun passed without source or assertion changes. `npm run test:ships` and
`npm run test:audio` both passed.

Visual preview: `docs/previews/endgame-victory.png` shows an isolated test session,
using deliberate test scores rather than claiming real player accomplishments.

## Limitations

Audio was decoded and exercised in muted headless Chrome; no subjective speaker/headphone
audition or loop-seam listening is claimed. Controller tests use synthetic Gamepad API input,
not a physical MCON. Ship heroes reuse the actual hangar thumbnails to avoid an extra WebGL
context. Headless correctness/layout checks are not a hardware FPS guarantee. The existing
Three.js vendor bundle still produces Vite's advisory about a chunk above 500 kB.

## Audio follow-up: combat distortion and title startup

The combat mix previously summed music and SFX directly at the device output, allowing
clipping. It now has final peak protection after the two buses join; the death filter
still applies only to SFX. Music crossfades are smoothed, and live escape music no longer
seeks backward to follow a slower simulation clock. Explicit paused frame-study seeking
remains available in Testing Grounds.

Title music now loads and attempts playback before voxel assets finish loading. Saved
mute/volume apply from startup; SFX decoding is deferred until interaction. Browsers that
block audible autoplay still require a genuine first click/key press. No permissions or
browser autoplay settings are bypassed.

`tests/title-autoplay.mjs` passed allowed-autoplay, blocked-autoplay/first-gesture and
saved-mute cases, including a deliberately stalled voxel loader and no duplicate title
recording. `tests/audio-mix.mjs` rendered the actual graph offline: a synthetic dense
barrage's peak fell from 1.5344 to 0.9424 at default settings, and from 1.8129 to 0.9607
at maximum settings, with zero clipped samples in the protected output. These are
numerical playback checks, not a subjective listening claim.
