# Rift Pirates — Master Testing Grounds

Open **Testing Grounds** on the title or pause menu, press **F2** (or the backtick key), or visit **http://localhost:8000/?lab=1**. This starts an isolated test run with god mode, infinite boost and three immortal damage targets. Entering from a normal run starts a fresh test session.

The console holds the simulation while you configure it. **Close + Fly**, **F2**, or **Escape** resumes the test. The persistent **TEST LAB** badge reopens your controls and shows whether god mode is on. **Exit Test Lab** returns to the title. Test scores, scrap, clears, hull choices and cinematic progress are never written to the normal save.

## Pilot

- Swap between all six cosmetic hulls without changing your build.
- Toggle god mode, infinite boost, unlimited rolls, automatic firing, enemy-ship freeze and the voxel exhaust trail.
- Run at quarter, half, normal or double simulation speed.
- Set player level 1–18. Restore the ship, apply test damage, break the shield or trigger perfect-dodge augments.
- God mode blocks normal combat damage. Explicit damage/shield controls bypass it so shield-break builds remain testable. Damage still respects armor, hit blocks and rescue augments. Freezing enemy ships leaves tower and boss attacks running.

## Augments

Search all **75 augments** by name or effect, filter by category and rarity, and set each rank from **0–50**. Rank zero removes an augment. Rebuilding recomputes stats from base values and your XP level, so removing a modifier does not leave invisible bonuses behind.

**All 75 / Rank 1**, **Full Arsenal**, and **Clear Build** provide instant presets. Rank edits clear existing projectiles, queued volleys and temporary augment effects; they also reset hit-block and rescue charges for a clean experiment. They do not refill hull or shield—use Restore when needed.

The **TEST WALLET +5,000** button adds isolated spendable scrap for shop tests. Scene replays reset the wallet and reopen their checkpoints while keeping the build. Test currency never enters your saved bank.

## Arena

- Jump straight into any of the four approaches, three towers, the Inhibitor, the Admiral or **FINAL ESCAPE**.
- Select a tower, Inhibitor or Admiral and choose **PLAY SELECTED BOSS INTRO** to replay its cinematic, then continue into combat. Space/Enter skips after the first moment; pause holds the camera and soundtrack together.
- Load FINAL ESCAPE again to retry with the same ship/build. Turn god mode and infinite boost off for difficulty checks. Timeout still fails with god mode on. Restore after death restarts the escape and retains the build.
- FINAL ESCAPE builds through five escalating armada/collapse stages. Use an earned-size build (13 picks) to judge pressure; All 45 is useful for destruction stress testing. Freeze Enemies holds the combat fleet while the collapse spectacle continues; opening the console holds everything.
- Opening the console pauses music with the simulation. During escape frame study (speed other than 1×), the finale recording is held and aligned to simulation time; returning to 1× resumes the original tempo.
- Load any of the Admiral's four phases, including moving backward. Each phase load creates a fresh boss with intact modules.
- Spawn scouts, gunships, heavies, elite captains or shield drones in groups of up to ten, subject to the game's enemy pool.
- Spawn immortal targets for damage/DPS measurement, a hostile bullet fan with a dodge lane, or collectible scrap.
- Set Rift Heat up to Overdrive to test heat-dependent weapons.
- Clear Arena returns to an empty test range. Scene changes retain your ship, augments, XP and overrides, restore your ship and clear previous enemies, hazards, effects and callbacks.

Target dummies measure direct damage and hit effects. Use enemy ships to test kills, executions, cryo slowing, gravity pulls and loot. DPS uses a rolling two-second simulation-time window, so slow motion does not change the reported rate.

## Effects

Preview all **18 weapon/effect sounds**, adjust bloom or restore each scene's lighting default, and queue a voxel explosion. Audio follows the game's SFX switch. Close the console to watch queued particles animate.
Music and SFX levels can be adjusted separately from the title or pause menus and persist across visits.

## Tuning and debug

The Tuning tab exposes live, validated controls for player movement/survivability, weapons, enemies, graphics, and gameplay rewards. Search works across names, systems, and descriptions. Every parameter has an individual reset; each category and the complete panel can also reset to authored baselines.

Named presets persist only when **Save** is pressed and live in a Testing Grounds-specific storage record. JSON export/import is portable and validated. **Apply to Game Defaults / Review** creates a non-destructive source-owner and suggested-code artifact for review; it never rewrites production configuration.

The Debug tab can draw pooled hitboxes, projectile volumes, targeting/velocity paths, pickup range, formation spawn markers, arena bounds, and color-coded enemy state markers. It also provides deterministic attack, projectile-clear, enemy-destroy, restore, barrage, and explosion actions. These overlays are render-only and never enter collision, target, reward, or save systems.

The desktop console can be dragged, resized, or collapsed. Double-click its header to restore automatic centering. Use arrow keys/Home/End between tabs and Ctrl/Command+K to jump to tuning search. See [the extension guide](docs/testing-grounds-tuning.md) for wiring and safety details.

## Validation

`npm run test:lab` checks registry validation, UI entry/search/ranks, god-mode toggling, all six hulls, all 75 augments, reversible XP/stat rebuilding, live tuning behavior, actual damage to targets, debug overlays, presets/import/export, spawns, slow motion, input isolation, scene/phase jumps, cleanup, save isolation and return to normal play.
