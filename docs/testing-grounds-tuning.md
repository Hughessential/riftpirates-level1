# Testing Grounds tuning panel

The Testing Grounds is an isolated developer session. Open the hidden globe on the title screen, enter `brimby`, then use F2 to toggle the console. A `?lab=1` URL remains available for automated QA.

## Safety model

- Live tuning is active only while `TestingGrounds.active` is true.
- Entering or leaving the lab resets temporary values to authored defaults.
- Normal saves, progression, scores, scrap, clears, and player settings are never written by the panel.
- Named presets use the separate `riftpirates-testing-tuning-v1` local-storage record and are written only after **Save**.
- **Apply to Game Defaults / Review** produces a source-owner and suggested-code review artifact; it does not rewrite production constants.
- Import validates known keys against schema ranges, ignores unknown keys, and rejects newer schema versions.

## Adding a tuning parameter

1. Add one entry to `src/core/TuningRegistry.js`. Prefer a multiplier so the owning production config stays canonical.
2. Read it at the narrowest runtime boundary with `game.testing?.getTuning('key') ?? 1` (or a zero fallback for additive values).
3. Define lifecycle behavior. Capacity changes need a percentage policy; projectile and enemy spawn values may apply only to new instances.
4. Add a registry normalization test and a browser assertion proving the control changes runtime behavior.
5. Document the production owner below if the value may graduate into normal defaults.

The UI is schema-generated. A connected entry automatically gets a slider, numeric input, tooltip, reset control, category reset, search, presets, import/export, and change highlighting.

## Production owners

| Category | Runtime owner | Authored default owner |
| --- | --- | --- |
| Player movement and resources | `Player` | `src/player/Player.js` (`BASE_STATS`, roll constants) |
| Player weapon output | `PlayerWeapon`, `ProjectilePool` | `src/config/weapons.js`, `BASE_STATS` |
| Enemy durability and attacks | `EnemySpawner` / pooled `Enemy` | `src/enemies/EnemyTypes.js` |
| Bloom and render scale | `Game`, renderer | encounter mood values and adaptive resolution |
| Particles and trails | `ParticlePool`, `EngineTrail` | their fixed pool/profile constants |
| Rewards, XP, score, and Heat | corresponding systems | `ScrapSystem`, `XPSystem`, `ScoreSystem`, `RiftHeatSystem` |

## Current behavior notes

- Enemy health changes affect newly spawned enemies. Existing enemies retain current/max health to prevent silent mid-fight healing or kills.
- Projectile speed, lifetime, and size affect newly fired projectiles. Existing projectiles retain launch values.
- Capacity controls preserve the player's current percentage as closely as possible.
- Render scale is clamped and restored on lab exit.
- Particle count stays bounded by production pools; values above 1 never allocate an unbounded effect.
- Debug gizmos are render-only pooled geometry. They are not targets, colliders, projectiles, save data, or score sources.

## Mechanics intentionally not represented

The panel does not expose disconnected controls for systems the game does not have:

- weapon recoil, magazine size, reload time, hitscan spread, or ammo economy;
- physics mass, tire-style friction, gravity, or rigid-body collision impulses;
- navmesh detection radius, pathfinding cost, cover selection, or AI perception memory;
- world fog density, shadow-map distance, or post-process exposure controls absent from the renderer;
- arbitrary boss scripting values whose mutation would violate encounter state invariants.

If one is implemented later, add its production system first, then register and verify the tuning entry. Never add a UI-only value.

## Keyboard and controller access

- `F2` toggles the panel after unlock.
- Arrow keys, Home, and End move across the six tabs.
- `Ctrl/Command + K` opens Tuning and focuses search.
- Controls use native focus, buttons, ranges, numeric inputs, and selects for keyboard/controller menu adapters.
- The desktop panel is draggable by its header, resizable, and collapsible. Double-clicking the header restores automatic centering.
