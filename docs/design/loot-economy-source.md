# CODEX HANDOFF: More treasure, paid augments, and a meaningful loot economy

Continue the current Rift Pirates project. This is an additive loot-and-purchasing pass that works alongside the existing 30-augment integration kit. Do not rewrite that kit or redesign its augments.

## 1. Creative direction and fixed requirements

I want substantially more loot throughout the game, and players must purchase their augments with the loot they collect. Collecting treasure must feel imperative because it determines how powerful their build becomes.

The loop should be: destroy enemies, chase valuable loot, make a purchasing decision, become outrageously powerful, and take on more dangerous encounters.

Make the game feel like a neon pirate treasure raid, not a shooter with an incidental scrap counter. Loot should be abundant, beautiful, satisfying to collect, and strategically important. Abundant pickups must NOT mean enough money to buy everything. This is an in-game economy only: no real-money purchases, accounts, or monetization systems.

These requirements supersede earlier FREE augment-selection behavior. Preserve the existing cadence, selection format, augment identities, and other unrelated rules. Prices, drop values, and collection targets below are initial tuning proposals, not verified final balance.

## 2. Protect the existing game

Inspect the current checkout, working changes, and implementations before editing. The supplied archive is a snapshot, not necessarily the latest code. Create and verify a recoverable checkpoint that includes tracked edits and relevant untracked files.

Extend the current scrap, upgrade, UI, progression, and save systems. Preserve the original 45 augments and the 30 additional designs, their ranks and synergies, cosmetic ship parity, controls, combat, shield recovery, rendering, official music assignments, and any completed final escape. Do not migrate engines, replace the build system, reset saves, deploy, or broadly rebalance unrelated combat.

Inspect the current equivalents of ScrapSystem, UpgradeSystem, UpgradeScreen, LevelDirector, SaveSystem, HUD, ResultsScreen, AugmentEffects, and Testing Grounds. Only change the integration points required for this feature.

## 3. One currency, clear accounting

Use SCRAP as the single spendable currency. Diamonds, crystals, salvage, and treasure cores are collectible denominations of SCRAP, not separate currencies.

For this pass, use a current-run wallet:
- Start a new run with zero spendable scrap. Keep the starting loadout functional.
- Track total earned, total spent, and current balance separately.
- Award currency when a legitimate pickup is collected, not merely when its source is destroyed.
- Purchases subtract from the current-run balance. They must not reduce lifetime records, score already earned, or the historical earned-this-run total.
- Do not allow negative balances, fractional display mismatches, duplicate collection, or duplicate charges. Use integer currency or documented fixed-point accounting with consistent rounding.

Keep existing banked scrap and saved records intact. Do not automatically turn the historic bank into an unlimited shop wallet. For newly completed runs, bank the UNSPENT remainder once, on either victory or death, preserving the existing ability to retain remaining scrap on death. Never also bank currency that has already been spent. Preserve the existing save key and old fields; any additive fields must load old saves safely.

This is an intentional forward-only accounting change, not a retroactive deduction. Purchased augment ranks remain temporary run powers. Do not build a permanent-upgrade or bank-withdrawal system in this pass.

## 4. Convert upgrade moments into purchase opportunities

Keep three separate opportunities before every tower and the Inhibitor, plus any existing later cache. At each opportunity, show exactly three distinct augment cards and allow ONE purchase, then continue. The player may instead SKIP AND SAVE.

Do not collapse three opportunities into one shop. Do not force three purchases or quietly award an augment for free. Apply prices to existing augments, the new Rare/Ultra-Rare/Mythic augments, and additional ranks. Preserve XP leveling itself; any XP-driven card award, if one exists, must not become an unintended free-augment loophole.

Preserve current category filtering, eligible stack offers, and fixed-cache identities where compatible. Keep existing rarity weights unless an explicit change is necessary, and document it. Do not guarantee Mythics or turn every offer into expensive premium cards.

Show unaffordable cards with their real price and the amount missing. They can remain inspectable, but cannot be purchased. Always provide a working skip option across mouse, touch, keyboard, and controller.

Generate the three-card offer once per checkpoint and keep it stable. Reopening, pausing, or repeated inputs must not reroll the cards. No paid rerolls or second currency in this pass.

If a valid affordable option exists but the random set contains none, replace one offer with a useful affordable candidate, respecting categories where possible. Do not discount prices based on wallet size. If nothing eligible is affordable, allow skipping without a softlock or free grant.

## 5. Starting prices and progression targets

Suggested first-rank prices:

| Tier | SCRAP |
| --- | ---: |
| Existing/Standard | 100 |
| Rare | 250 |
| Ultra-Rare | 650 |
| Mythic | 1,600 |

Use existing rarity metadata if it has since changed; otherwise the original unclassified augments use Standard pricing.

Suggested stacking price: base price multiplied by (1 + 0.25 times ranks already owned), rounded UP to the next 10 scrap. Centralize and reuse the same price calculation for display, affordability, validation, and debit. Keep prices finite at high test ranks.

Do not automatically raise prices because the player collected more money, acquired a loot augment, or entered a later sector. Later income should genuinely unlock stronger purchasing power.

Tune available loot and prices together:
- In the opening approach, collecting roughly 60% of the intended main-route loot should fund one Standard purchase at each of the three checkpoints, assuming Standard choices rather than prior premium spending.
- Ensure money arrives BEFORE each checkpoint, not mostly after the tower.
- Strong collection and optional treasure routes should allow more Rare/Ultra-Rare purchases or saving toward a Mythic.
- A Mythic should be a major payday or savings decision, not unattainable within a normal successful run.
- Ignoring loot should noticeably weaken purchasing power. Efficient play should feel rewarded, not met with hidden price increases.

Instrument actual earnings and simulate purchase paths before finalizing numbers. Do not claim these initial prices are balanced without testing.

## 6. Put much more treasure into the world

Increase collectible presence through a coherent mix of:
- Frequent salvage and gem bursts from enemies, with meaningful payouts from elites and destroyed objective modules.
- Clearly marked breakable treasure crates and crystal clusters using existing encounter/scenery systems.
- Authored loot trails, treasure pockets, and finite optional high-risk salvage lanes.
- Large, satisfying tower and boss treasure showers.

Possible starting denominations: scrap shard 2, salvage bundle 10, teal diamond 25, violet crystal 100, and treasure core 250. Distinguish value through silhouette, size, animation, and labels, not color alone.

Place drops where the player can actually intercept them at the existing flight speed. Reward intentional steering and risky routes without forcing backtracking, stopping, or tedious cleanup. Keep ordinary collection satisfying without owning a magnet augment, while preserving meaningful benefits from existing loot upgrades.

Provide appropriate collection time around encounter transitions. Do not clear newly dropped rewards before they can be collected, or grant all ignored distant loot automatically. Pause pickup lifetimes while the shop genuinely pauses gameplay. Keep mandatory hazards and the route readable.

Use finite treasure sources. Repeatedly spawning boss adds, resetting encounters, or idle farming must not produce unlimited shop money.

## 7. Loot integrity, performance, and augment interactions

Recheck this specific snapshot issue: ScrapSystem.burst() divides reward value by the planned number of pieces, but its pool may have fewer free slots. The unspawned pieces can therefore lose their share of the payout. Fix this before increasing drop volume.

Preserve total authorized value through pool saturation with denomination merging, nearby compatible bundles, or a bounded pending-reward representation. Do not solve it with unlimited particles or silent auto-credit. Any aggregation must preserve source attribution and must not change the payout or amplify pickup-triggered combat effects.

Separate collectible logic from visual sparkle. Use pooled/instanced visuals and capped lights, particles, and pickup sounds. Quality settings may reduce decoration, never collectible value or the player's ability to see and collect it.

Audit Scrap Magnet, existing scrap multipliers, Lootstorm Halo, Scrap Typhoon, Diamond Apocalypse, and every loot-linked effect actually present. Count each legitimate reward once. Apply authorized multipliers once in a documented order. Decorative diamonds, shield gems, orbiting weapons, and duplicated combat crystals are not automatically spendable loot. Secondary kills may pay their normal reward once, never once per overlapping effect.

Keep score/Heat interactions bounded and consistent. More visible fragments must not create unlimited Heat, score, shield retaliation, or resource-triggered attacks. Spending currency must never count as collecting it. Do not nerf the existing powers as a shortcut; repair accounting and bound event recursion.

## 8. Purchase transaction and presentation

Route every purchase through one guarded transaction: verify the active offer, checkpoint, augment ID, next rank, price, and current balance; debit once; install once; complete the checkpoint once. Reject stale callbacks and duplicate clicks or controller presses. Failed validation or installation must not lose money or leave partially applied stats. Tests and developer grants can bypass payment only in an explicit isolated mode.

Keep the holographic cards: obsidian-black foundations, teal and violet glow, neon-green digital text, shimmering voxel particles, black-lightning aura, and very sparse gold. Do not replace the approved card aesthetic.

Add live UI fields for rarity, current/next rank, ability, price, available scrap, and remaining balance after purchase. Example: WALLET 420 | PRICE 250 | REMAINING 170. Use a readable PURCHASE & INSTALL action and an understated SKIP & SAVE action. Show earned, spent, and banked remainder distinctly on results.

On purchase, briefly draw a stream of gem energy into the selected card, fracture its holographic seal, and install its aura onto the ship. Keep it fast and responsive. Show a subtle notification when collecting enough to cross an important affordability threshold, without constant popups. Honor reduced-motion settings and never bury text or enemy telegraphs under bloom.

## 9. Preserve pacing and the final escape

Fit purchasing into existing intermissions. Do not add repeated shopping interruptions during combat or require beat-timed inputs. Loot audio must sit beneath the drum-and-bass soundtrack and critical danger cues. Preserve shield-lockout and pause semantics.

Do not open shops during the final galaxy escape or pause its deadline for currency rewards. Complete final spending before the final combat/escape sequence. Preserve all earned powers and the genuine escape challenge. This economy pass must not alter official music routing or rewrite the finale.

## 10. Verify, then report

Implement in stages: verified source checkpoint; wallet and one working purchase screen; revised drops and performance; all upgrade checkpoints and loot-effect interactions; regression checks.

Test insufficient funds, exact-price purchases, repeated inputs, stale offers, skip with zero balance, stack pricing, pause/resume, new-run reset, death/victory banking once, old-save loading, storage fallback, and Testing Grounds isolation.

Also test pickup-pool exhaustion, multiplier rounding, overlapping kill effects, artificial crystal duplication, finite treasure sources, and the early-game purchase budget. Verify all input methods and peak-load combat with the most visually intense augment combinations. Track available loot, collected loot, earned/spent/balance, unaffordable offers, skips, purchases by rarity, and performance locally in development.

Report changed files, the actual economy defaults, verification performed, remaining tuning needs, and how previous saves and completed work were protected. Keep the work local. Do not claim the game or economy is tested when only static checks ran.

The intended feeling: every glowing diamond matters because it brings the player closer to an absurdly powerful build. PLUNDER. PURCHASE. BECOME A MONSTER.
