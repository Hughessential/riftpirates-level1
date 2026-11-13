# Rift Pirates — Mayhem Arsenal

The run has **45 repeatable augments**. Each pick adds a rank; weapons coexist and every rank adds power. Three choices still appear at each of the three approach checkpoints before every tower and the Inhibitor. The final Nexus choice makes thirteen picks per run. Offers mix a weapon, a survival/movement option, and a wild card; owned augments return so you can deepen a build.

Design inspiration: [Riot's Mayhem augment design](https://www.leagueoflegends.com/en-us/news/dev/dev-bringing-mayhem-to-aram/), [Arena's augment progression](https://www.leagueoflegends.com/en-us/news/dev/dev-leveling-up-arena/), and [ROUNDS' combinable weapon upgrades](https://store.steampowered.com/app/1557740/ROUNDS/). Names, colors and implementations here are original Rift Pirates mechanics.

## Build ideas

- **Prismatic storm:** Prism Lance + Tesla Fork + Shatterstar + Hypertrigger. Pierce a formation, fork lightning and fracture hits into pink shards.
- **Pirate artillery:** Pirate Broadsides + Void Mortar + Powder Keg + Solar Brand. Wide volleys, plasma blasts and burning targets.
- **Treasure reactor:** Plunder Vortex + King of Plunder + Golden Gun + Bullet Heist. Collect more scrap, load the next salvo and steal enemy fire through perfect dodges.
- **Ghost pilot:** Phase Drive + Time Bandit + Slipstream Barrage + Kinetic Capacitor. Movement charges your gun, boosting attacks, and dodges slow nearby bullets.
- **Last stand:** Dreadnought Hull + Ghost Armor + Blood Reactor + Revenge Matrix. Invest in hull resistance and turn shield loss into a counterattack.

## Shield rules

Base shield capacity is 40. Partial damage requires 8 damage-free seconds before recharge. A depleted shield requires **14 damage-free seconds**; every subsequent hull hit restarts the full delay. Recovery then proceeds at 4 shield/sec. Capacity and regeneration augments improve the shield but never shorten the depletion lockout or instantly refill it. Objective completion repairs hull and boost; shield recovery continues. The HUD shows the remaining lockout.

Base hull repairs at 2/sec after 6 seconds without damage. All six cosmetic ships use exactly these same rules.

## All 45 augments

| Augment | Type | Behavior and stacking |
| --- | --- | --- |
| **HYPERTRIGGER** | ARSENAL | Turn your entire arsenal into a neon bullet storm. +35% base firing rate per stack. No damage penalty. |
| **DREADNOUGHT HULL** | SURVIVAL | Become a flying pirate fortress. +60 maximum hull and repair 60 per stack. |
| **PLUNDER VORTEX** | SALVAGE | Pull distant treasure into your ship. +5 pickup radius and +25% base scrap yield per stack. |
| **BULWARK CAPACITOR** | SURVIVAL | A deeper shield reserve with stronger recovery after the lockout. +20 shield capacity and +1 recharge/sec per stack. Break lockout stays 14s. |
| **RIFT DRAIN** | SURVIVAL | Steal momentum from kills and life from perfect dodges. Each stack increases dodge healing and kill boost refunds. |
| **PIRATE BROADSIDES** | ARSENAL | Paired flank cannons tear open a wider firing lane. Each stack adds a pair of diagonal cannons; dense ranks also amplify their damage. |
| **LOADED DICE** | ARSENAL | Rig the reactor for spectacular critical hits. +15 percentage points crit chance and +0.3x crit damage per stack. |
| **PHASE DRIVE** | MOBILITY | Perfect dodges ignite a movement and firing-speed surge. Each stack increases the speed surge and its duration. |
| **GHOST ARMOR** | SURVIVAL | Layer damage resistance and absorb the first hits of each encounter. 15% less remaining damage and +1 full hit block per stack. |
| **INFERNAL OVERDRIVE** | ARSENAL | High Rift Heat sends every cannon into overdrive. +50% weapon damage per stack while Heat is Infernal or hotter. |
| **ABSOLUTE ZERO** | ANOMALY | Keep your combo alive through the chaos. Each stack reduces Heat loss and decay, and extends the idle grace period. |
| **KING OF PLUNDER** | SALVAGE | Turn every battlefield into a treasure vault. +60% base scrap yield per stack. Pickups award 12 score per scrap per stack. |
| **NEXUS BREAKER** | ARSENAL | Focused fire rips through exposed fortress machinery. Multiply locked weak-point and core damage by 1.5 per stack. |
| **REALITY TEAR** | ANOMALY | A perfect dodge detonates the space around you. Dodge blast deals 45 damage per stack; radius 12 + 2 per stack. Clears nearby fire. |
| **DEATH WARRANT** | SURVIVAL | The Rift refuses to collect your debt. Each stack grants one extra lethal-hit rescue at half hull. Used rescues stay spent. |
| **TWIN FANGS** | ARSENAL | Stack parallel forward cannons onto your ship. Each stack adds another forward shot; dense ranks also amplify cannon damage. |
| **HELIX CATHEDRAL** | ARSENAL | Weave rotating ribbons of laser fire through the fleet. Each stack adds another spiral pair and strengthens the helix barrage. |
| **HOTSHOT REACTOR** | ARSENAL | Feed every weapon a reckless amount of reactor power. Multiply all weapon damage by 1.25 per stack. |
| **RAIL ACCELERATOR** | ARSENAL | Launch hypervelocity shots that strike like falling stars. +15% base projectile speed and 15% more damage per stack. |
| **AFTERBURNER** | MOBILITY | Burn a blazing escape route through enemy formations. +15% base boost speed and +25 boost capacity per stack. Refills boost. |
| **INFINITE THRUST** | MOBILITY | Recover boost quickly enough to keep dancing through danger. +35% base boost regeneration per stack. |
| **REPAIR SWARM** | SURVIVAL | Repair drones stitch your hull together after you escape damage. +2 hull repair/sec per stack after the recovery delay. Repair 25 immediately. |
| **VECTOR THRUSTERS** | MOBILITY | Sharper steering wrapped in a larger shield reserve. +10% base steering speed and +12 shield capacity per stack. No instant shield refill. |
| **PRISM LANCE** | ARSENAL | A brilliant cyan rail-lance punches through clustered ships. Each stack adds penetration and increases lance power. |
| **SCATTER NOVA** | ARSENAL | A golden laser shotgun fills the forward arc. Each stack widens the pellet barrage and increases its total damage. |
| **SEEKER SWARM** | ARSENAL | Acid-green missiles hunt targets ahead of your ship. Each stack adds seekers and increases swarm damage. Targets must remain ahead. |
| **TESLA FORK** | ANOMALY | Hits fork electric arcs through nearby enemies. Chain to 2 + stack targets; each arc deals 35% hit damage per stack. |
| **VOID MORTAR** | ARSENAL | Lob heavy violet plasma into the fleet and burst it apart. Each stack strengthens the explosive orb and expands its blast. |
| **PINBALL HEX** | ANOMALY | Your laser rebounds into a new target after impact. Each stack adds another target bounce. A bolt cannot hit the same target twice. |
| **SHATTERSTAR** | ANOMALY | Hits fracture into a fan of hot-pink laser shards. Each stack adds two shards at 35% hit damage each. Shards cannot split recursively. |
| **CRYO HEX** | ANOMALY | Freeze enemy formations into a slow-motion shooting gallery. Each stack strengthens slowing and adds 0.4s duration to the 1.6s base. |
| **SOLAR BRAND** | ANOMALY | Every hit brands the target with orange reactor fire. Burn for 22% hit damage/sec per stack for 2.5s. Repeat hits refresh the burn. |
| **GRAVITY THIEF** | ANOMALY | Impacts open violet gravity wells that pull enemies together. Each stack increases radius and deals 15% hit damage/sec. Wells last 2.2s. |
| **GHOST FLEET** | ARSENAL | Orbiting gun drones join your firing line. Each stack adds two satellite cannons; dense ranks also increase drone firepower. |
| **ECHO CHAMBER** | ARSENAL | Ghost-blue copies of your shots follow the first volley. Each stack adds delayed echo fire while you hold the trigger. |
| **SLIPSTREAM BARRAGE** | MOBILITY | Boosting turns your escape into a forward laser ambush. Each stack strengthens and expands the boost-triggered barrage. |
| **BLOOD REACTOR** | SURVIVAL | Losing your shield turns the ship into a desperate damage engine. Each stack increases unshielded weapon damage and heals 2 hull per kill while unshielded. |
| **KINETIC CAPACITOR** | MOBILITY | Moving charges a reactor burst for your next attack. Each stack increases the stored movement charge and burst power. |
| **DEAD MAN'S MARK** | ANOMALY | Wounded enemies take brutal finishing damage. Each stack raises the execute threshold and adds 70% hit damage to the finisher. |
| **POWDER KEG** | ANOMALY | Kills explode and can carry destruction into the next ship. Kill blast: 18 damage per stack, radius 5 + stack. Chain explosions have a bounded budget. |
| **BULLET HEIST** | SALVAGE | Perfect dodges steal enemy fire and return it as cyan lasers. Each stack increases stolen bolts and damage. Always fires a bonus pair per stack. |
| **BLACK SUN** | ANOMALY | Every fourth kill collapses into a hungry singularity. Three-second well: 24 damage/sec per stack, radius 6 + stack. |
| **TIME BANDIT** | MOBILITY | Perfect dodges slow nearby hostile projectiles. Each stack strengthens the slow and adds 0.5s to its 2s base duration. |
| **REVENGE MATRIX** | SURVIVAL | Shield destruction answers with a bullet-clearing neon counterattack. Break clears radius 8 + stack and launches 8 + stack shots dealing 14 damage per stack. |
| **GOLDEN GUN** | SALVAGE | Load collected scrap into your next cannon volley. Store +1.5 damage per scrap per stack; reserve holds up to 300 damage per stack. |

## Rendering and sound

Player weapon families have seventeen distinct neon color profiles, with elongated player lasers and warm-colored, faceted enemy shots. The shared projectile pool supports 1,024 player shots and 512 enemy shots in four instanced GPU batches. High ranks grow damage after visual barrel limits so extra stacks remain useful without unlimited allocations. Impact reactions use bounded chains; shielded/untargetable modules still require their intended openings.

Eighteen distinct weapon/effect samples come from the supplied Juhani Junkala CC0 collection. Per-cue envelopes, voice limits and compression keep overlapping fire controlled. The official boss recording accompanies all tower and boss battles.

Each family now has a different layered projectile silhouette and trail that
grows with rank. Offensive/status augments also evolve the primary cannon's
color, shape and sound. Installing an augment auditions its cue and prioritizes
its first salvo. The reactor HUD displays current primary damage/cadence and
active weapon systems; numeric upgrade previews use the real stat calculation.
Weapon voices are bounded at 18; important danger cues briefly lower weapon
audio. Music and SFX each have a saved volume slider and independent mute.

## Validation

`npm test` covers all 45 reachable/stackable augments, mixed builds, weapon output, proc interactions, shield lockout, enemy patterns and the full level. `npm run test:mayhem` covers the rendered combined arsenal, actual audio decoding, pause/cache freeze, shield HUD and restart cleanup. `npm run test:ships` verifies that all six cosmetic hulls share stats and firing cadence.
