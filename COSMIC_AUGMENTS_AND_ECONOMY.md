# Cosmic augments and the SCRAP economy

This additive local feature pass preserves the original 45 augment IDs and adds
the supplied 30 designs: ten Rare, ten Ultra-Rare and ten Mythic. The canonical
handoff is preserved in `docs/design/cosmic-augment-source.json`; runtime metadata
and proposed tunables are in `src/systems/cosmic-augment-data.json`.

## Purchasing

There are three separate opportunities before each tower and the Inhibitor,
followed by the existing Nexus cache. Each has exactly three distinct cards.
Buy one, or Skip & Save. Cards remain stable when hidden, reopened or paused.
Completed checkpoints cannot be bought twice. No shops run during the escape.

| Tier | First rank |
| --- | ---: |
| Standard (original 45) | 100 SCRAP |
| Rare | 250 SCRAP |
| Ultra-Rare | 650 SCRAP |
| Mythic | 1,600 SCRAP |

Further rank price = tier base × (1 + .25 × owned ranks), rounded UP to the next
10 SCRAP. Prices never depend on wallet size or sector. Price and rarity weights
are centralized in `src/systems/AugmentEconomy.js`.

New tier rolls use the handoff's proposed 60/26/11/3 distribution, conditioned on
eligible categories. Slots remain arsenal, survival/mobility, wildcard. The
wildcard retains the 40% owned-build preference when available. An offer
with no affordable option replaces its third card with an affordable eligible
candidate when one exists. These constraints mean observed shop percentages
are not identical to the unconstrained tier-roll percentages. Legacy fixed
caches keep their original identities unless an affordability replacement is needed.

## Currency integrity

A run starts at zero. `RunWallet` tracks integer earned, spent and balance.
Treasure credits only on collection. Purchase validation includes the active
checkpoint token, ID, exact next rank, centralized price and funds. Stats are
staged before debit; failed installation rolls back the player and wallet.
Duplicate and stale callbacks cannot buy or complete a checkpoint again.

The existing save key is unchanged: `riftpirates-level1-v1`. Historical banked
scrap is never a shop wallet. Death and victory bank only the unspent remainder.
The additive `lastBankedRunId` field prevents a repeated results callback from
banking twice. Existing records, ship choice and audio settings are retained.
Testing Grounds stays isolated; its explicit +5,000 SCRAP control and rank grants
never bank and are unavailable outside a test run.

## Treasure and starting balance

Main-route authored treasure supplies 220/400/550/700 base SCRAP per checkpoint
in sectors 1–4. Opening 220×60%=132 per interval funds three Standard purchases,
including saving for repeat prices 100/130/150. Optional marked breakable crates,
enemy payouts and objective showers add further income. A normal successful
route can save toward 1,600 SCRAP; ignoring pickups leaves weaker buying power.
These are tested starting budgets, not a claim of final human-playtested balance.

White shards, pink salvage, teal diamonds, violet crystals and gold cores use
distinct shapes and denomination labels. The 260 pickup slots and halo batch
are bounded. Overflow retains authorized rewards in a bounded pending queue
with source attribution, without auto-credit. Source IDs and finite stage
budgets prevent repeat boss adds, scenery and encounter resets farming money.

The first collected portion snapshots that logical reward's scrap multiplier;
cumulative integer rounding preserves payout regardless of its fragment count.
Heat and loot-triggered defensive powers deduplicate the source. Amount-based
Golden Gun charge receives every actual earned portion. Combat crystals,
shield gems and Diamond Apocalypse illusions never enter the currency system.

## Cards and controls

`createHolographicAugmentCard` is reusable independently of purchase mechanics.
Native buttons render live names, rarity, ranks, effects, costs and remaining or
missing funds. Five original ship illustrations are shared by category. They
are optimized 768×768 WebP assets totaling about 557 KiB; they are not 30 unique
portraits. [Artwork prompts and provenance](assets/augments/SOURCES.md).

Tier frames add capped voxel dust, refraction, circuitry, black-violet lightning,
sigils and Mythic crowns. Animation stays in the art window. Text stays legible.
Reduced motion disables card animation and the ship installation burst; hidden
and paused screens suspend decoration. No additional WebGL contexts or RAF loops.

Select using mouse/touch, 1/2/3, Tab/Enter, or controller D-pad/stick and confirm.
Skip using the visible button or S; controllers navigate to the same button.
Unaffordable cards remain inspectable and explain the missing SCRAP.

## Combat adaptations and limits

The new powers use the existing combat clock and secondary-damage guards.
Their combined cosmetic geometry uses one capped 64-instance batch plus existing
projectile, ring and arc pools. Ranks 1, 5 and 50 are verification targets. Magnitude
scales separately from render counts. All 75 appear in Testing Grounds with
category and rarity filters.

Leviathan Pulse uses **aim + fire**, costs 24 boost and has an 8-second cooldown,
because this game has no separate secondary-fire input. Emperor's Pressure
cracks the existing elite shield mitigation rather than inventing shield HP.
Emperor of the Rift strengthens damage during already-exposed boss windows;
it never unlocks a protected boss core or bypasses phase scripts. Time powers
slow eligible enemies/projectiles, never the escape clock or soundtrack.
The 14-second shield-break lockout remains authoritative.

## Verification

Run `npm run test:economy`, `npm run test:cosmic` and `npm run test:cards`.
Browser suites need the Vite server on 8000 and local Chrome. `npm test` covers
the existing progression, combat, soundtrack, shield and finale regressions.
Build with `npm run build -- --base=/riftpirates-level1/`; `test:pages` can verify
a local production preview without publishing (`npm run preview -- --port 8001 --base=/riftpirates-level1/`). Physical controllers and subjective
long-run balance still need player feedback; simulated gamepad input checks the
same browser mapping and menu paths.

Pre-expansion local recovery checkpoint: `822a151`. This feature pass is local;
the public GitHub Pages version is unchanged until explicitly deployed.

## Checks run on this implementation

- Economy unit tests: atomic/exact/insufficient purchases, duplicate/stale input,
  stable offers, fixed-cache affordability, skip, refund/rollback, rarity rolls
  and finite stats. Save tests cover legacy fields and storage fallback.
- Loot simulation: collecting six of ten opening-route gems per interval earns
  135/270/405 cumulatively; 100/130/150 purchases leave 25. Real-browser route
  reaches all three shops at 22/54/88s with enough funds, without wallet grants.
- Pool exhaustion: 400 logical sources/40,000 SCRAP conserve their exact value.
  Throwing callbacks and secondary kills cannot pay twice or erase reused slots.
- Real-browser banking: spending is excluded, remainder banks exactly once, new
  runs start empty, and Testing Grounds grants/replays never change the save.
- All 30 cosmic effects at ranks 1/5/50, including nonrecursive secondary events,
  protected/exposed bosses, 14-second shield lockout and real escape timeout.
- Real-browser all 75 stress: peak 449 player/209 enemy bolts, 64 cosmic instances
  and 103 draw calls. These are pool/render counts, not a hardware FPS benchmark.
  Very dense sandbox builds still have a bright firing center.
- Card browser checks: all 75 descriptions at 1440×900,1280×800,390×844; live
  costs/deltas, mouse, keyboard, touch, simulated MCON, reduced motion, pause,
  hidden effects, stale callbacks and zero-wallet skipping.

[In-game rarity preview](docs/previews/holographic-augment-shop.png).

- Full-level browser regression reached all towers, the Inhibitor, four Admiral
  phases, escape victory, death and restart without browser errors. Original
  combat, perfect dodge, official soundtrack and shield tests passed.
- Controller menus and the 75-augment lab passed simulated device/remap, menu,
  scene replay and isolation checks. Local production smoke passed boot, all
  runtime asset requests, launch, pause and resume under the Pages base path.

## Files changed

- `README.md`
- `TESTING_GROUNDS.md`
- `assets/augments/SOURCES.md`
- `assets/augments/anomaly.webp`
- `assets/augments/arsenal.webp`
- `assets/augments/mobility.webp`
- `assets/augments/salvage.webp`
- `assets/augments/survival.webp`
- `docs/design/cosmic-augment-source.json`
- `docs/design/loot-economy-source.md`
- `docs/previews/holographic-augment-shop.png`
- `index.html`
- `package.json`
- `src/combat/AugmentEffects.js`
- `src/combat/CollisionSystem.js`
- `src/combat/CosmicAugmentEffects.js`
- `src/combat/ProjectilePool.js`
- `src/config/approaches.js`
- `src/core/Game.js`
- `src/core/LevelDirector.js`
- `src/core/SaveSystem.js`
- `src/core/TestingGrounds.js`
- `src/effects/DamageNumbers.js`
- `src/encounters/RiftAdmiralBoss.js`
- `src/encounters/TowerEncounter.js`
- `src/enemies/EnemySpawner.js`
- `src/player/Player.js`
- `src/player/PlayerWeapon.js`
- `src/render/Environment.js`
- `src/systems/AugmentEconomy.js`
- `src/systems/CosmicAugments.js`
- `src/systems/RunWallet.js`
- `src/systems/ScrapSystem.js`
- `src/systems/UpgradeSystem.js`
- `src/systems/cosmic-augment-data.json`
- `src/ui/AugmentFeedback.js`
- `src/ui/HUD.js`
- `src/ui/HolographicAugmentCard.js`
- `src/ui/ResultsScreen.js`
- `src/ui/TestingGroundsPanel.js`
- `src/ui/UpgradeScreen.js`
- `src/ui/holographic-augment-card.css`
- `tests/approach-progression.mjs`
- `tests/augment-economy.mjs`
- `tests/augments.mjs`
- `tests/controller-menus.mjs`
- `tests/cosmic-augments.mjs`
- `tests/cosmic-browser.mjs`
- `tests/cosmic-effects.mjs`
- `tests/display-loot.mjs`
- `tests/economy-save.mjs`
- `tests/escape-carnage.mjs`
- `tests/final-escape.mjs`
- `tests/holographic-cards.mjs`
- `tests/level-walkthrough.mjs`
- `tests/loot-economy.mjs`
- `tests/mayhem-browser.mjs`
- `tests/menu-layout.mjs`
- `tests/pages-smoke.mjs`
- `tests/testing-grounds.mjs`
- `tests/weapon-feedback.mjs`
