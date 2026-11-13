# Rift Pirates V.1 — Portfolio Overhaul

## Product target

Rift Pirates V.1 is a desktop-first, browser-delivered voxel action showcase.
The target is a 25–30 minute run at 60 FPS on a modern desktop browser, with a
reduced-quality path retained for lower-power hardware. Mobile compatibility is
useful but no longer sets the art, control, encounter, or performance ceiling.

## Visual target

The concept sheets are the art direction:

- monumental block-built pirate fortresses;
- worn stone, dark metal, banners, chains, cannons, and dense silhouette detail;
- soft cinematic key/fill/rim lighting;
- deep violet space, layered nebulae, debris, and atmospheric depth;
- cyan, violet, red, orange, and magenta encounter energy that visibly lights the world;
- bright but controlled bloom, readable telegraphs, and violent destruction payoffs.

The voxel identity stays. Smooth generic science-fiction art is explicitly not
the target. Blender/GLB assets may supplement the procedural voxel system where
they materially improve hero assets, animation, or surface detail.

## Gameplay target

- Expand every sector into multiple authored traversal and combat beats.
- Create harder encounters through layered readable patterns, arena changes,
  target priority, and phase mutations rather than health inflation alone.
- Give every major objective at least three meaningful combat phases.
- Turn augments into build-defining behavior changes with visible synergies.
- Preserve fast restarts, deterministic gameplay timing, and the existing
  keyboard/controller control quality.

## Augment direction

Implemented: three augment checkpoints before each tower and the Inhibitor,
each offering three choices. The player selects one at each checkpoint and one
more at the Nexus, for thirteen selections. The pool contains 45 repeatable
augment types across arsenal, survival, mobility, salvage and anomalies. Every
rank adds power, guns coexist, and impact/kill/dodge effects combine. Combat and
route time freeze during choices. See `MAYHEM_ARSENAL.md` for the full catalogue.

Base shield recovery now requires 14 damage-free seconds after depletion;
every hull hit resets that delay. Partial shields wait 8 seconds. New enemy
fans and gapped volleys increase dodge pressure, while instanced projectiles
and bounded reaction chains keep dense builds within a fixed allocation budget.

The first expanded approach is 104 seconds of flight time, with caches at 22,
54 and 88 seconds: scout pickets, salvage/gates, shield escort and bounty ace,
then a final breach run. Other approaches have three spaced checkpoints too.
About 28,000 additional instanced scenery voxels populate all sectors; the first
approach adds a growing fortress landmark and navigation beacons.

## Fleet, characters and title presentation

Implemented: seven supplied MagicaVoxel models with shared, exposed-face
geometry and emissive engine/eye colors. Five enemy roles have distinct hulls;
scouts bank through intercepts and Dual Strikers fire paired cannon lanes.
Four colossal robot shrines and six passing ships populate the route edges.

The title uses turquoise/violet extruded voxel lettering, gold control plaques,
chromatic orbital effects and a block-built pirate planet. Launch waits for the asset load
with a visible progress indicator; missing models retain procedural fallbacks.
Menu animation supports reduced motion. A shimmering voxel pointer star follows
the mouse only on the title; a matching orbital pause console holds the action.
An original, self-hosted digital font covers the entire interface. The display
finish adds faint static scan/grain and subpixel edge color separation without
blurring or lowering the game resolution.

Six original hulls from `Voxel Spaceships.zip` are selectable in the title
hangar, with actual 3D previews and remembered selection. They share identical
stats, collision radius, firing cadence, upgrades and controls. Source shapes
retain their authored details, recolored in violet, turquoise, near-black,
gold and lime with emissive engines. The original Star Hopper is a loading
fallback. Browser checks verify every hull in gameplay and selection persistence.

The official boss recording accompanies all five objectives,
continuing from introduction into combat without restarting. Five official
gameplay tracks shuffle between battles. The official title and finale themes
have dedicated ownership; the Admiral now leads into a timed final escape.
Desktop layout, imported geometry,
enemy behavior and soundtrack transitions have automated checks; hardware
frame-rate profiling remains part of the portfolio finish.

## Delivery sequence

1. **Rendering foundation** — modern Three.js/Vite pipeline, HDR post-processing,
   cinematic lighting, PBR voxel materials, quality controls, and performance telemetry.
2. **Outer Defense target slice** — finished traversal, three augment checkpoints,
   multi-phase tower encounter, destruction sequence, and portfolio-quality presentation.
3. **System propagation** — reuse proven lighting, materials, encounter tools, and
   augment infrastructure across Midrift, Inner Citadel, and the Inhibitor.
4. **Nexus finale** — rebuild the Rift Admiral as the visual and mechanical maximum.
5. **Portfolio finish** — title flow, accessibility/quality options, loading polish,
   automated verification, screenshots/video capture, and deployment.

## Engineering constraints

- Gameplay delays use `Scheduler`, never wall-clock timers.
- Hazard geometry and visible telegraphs must agree.
- Reuse pools and merged/instanced geometry for recurring effects and scenery.
- Encounter identity colors remain consistent across models, lighting, UI, and attacks.
- New rendering features must have an intentional reduced-quality fallback.
- Finish and profile the Outer Defense target slice before rebuilding every sector.

## First milestone acceptance criteria

- `npm run build` succeeds from a fresh dependency install.
- The existing title, traversal, combat, pause, upgrade, death, and results flows remain intact.
- Outer Defense reads clearly from gameplay distance and resembles its concept identity.
- Emissive energy blooms without washing out HUD or attack telegraphs.
- Shadows, post-processing, and particles maintain the desktop 60 FPS target.
- Automated walkthrough/combat/dodge checks remain runnable after the renderer change.
