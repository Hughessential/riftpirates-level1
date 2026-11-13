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

## Validation

`npm run test:lab` checks UI entry/search/ranks, god-mode toggling, all six hulls, all 75 augments, reversible XP/stat rebuilding, actual damage to targets, spawns, slow motion, input isolation, scene/phase jumps, cleanup, save isolation and return to normal play.
