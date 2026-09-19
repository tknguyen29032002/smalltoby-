# Factory Heist - the campaign

This is the design behind `campaign.js` and `shop.js`.
Those two files are data: fifteen encounters, the thief roster, the zone rules, the economy and the shop.
`heist.js` is the one gameplay simulator and reads them; `maps.js` owns every floor plan and is referenced here only by id.
`node tools/verify-campaign.js` is the proof that the data still makes a campaign, and `npm test` runs it.

## The rules this is priced for

The cart does not walk.
The player aims a power at a delivery, the power (an algorithm from the engine) searches from the cart, and the cart rides the route it found, one cell per tick.
WASD is a one-cell nudge that costs charge - for stepping off oil or out of a thief's way, never for crossing the map.
The world is tick-based: it only moves when the player acts.
A level is won by standing on its 2 or 3 deliveries (the red points).
A level is lost when charge reaches zero.

Stars are cumulative:

| Stars | Condition |
|---|---|
| 1 | every delivery secured |
| 2 | and finished inside par ticks |
| 3 | and spent no more than par charge |

A boost other than recharge caps the level at two stars.

## What costs what

Every number here lives in `Campaign.ECONOMY`, and heist.js charges the same way or par means nothing.

| Action | Charge | Ticks |
|---|---|---|
| A plot (firing a power) | `ceil(chargedExpansions / 10)` - the search itself, swap penalties included (`Campaign.plotCharge(trace)`) | 1 |
| Riding a cell | its terrain: plate 1, oil 5, a power cell pays 4 back | 1, plus 1 more climbing out of oil |
| A nudge | the cell's terrain plus 2 | 1 |
| A hit on a foreman | another plot of the same power | 1 |
| Overheating (a plot whose frontier exceeds the level's `memoryCap`) | the plot's charge, and the cart does not move | 1 |

So a power is paid for twice: once for how much floor it had to think about, and once for the route it chose.
A* is cheap to plot and honest about oil; greedy is cheaper still and wades through the spill; BFS pays for every cell in the room.
That split is what lets different powers win different legs.

## The difficulty curve

Five zones of three levels.
Each zone tightens one thing and keeps everything before it.

| Zone | Tier | Levels | Swap cap | Fog | Foreman proofed against | Tightens |
|---|---|---|---|---|---|---|
| Receiving | 1 | 1-3 | 5 | never | - (no foreman) | Three powers arrive on a lit floor. |
| The Oil Line | 2 | 4-6 | 5 | never | A* | Foremen arrive, proofed against the dart that just became the easy answer. |
| The Long Halls | 3 | 7-9 | 4 | never | weighted A* | Memory is rationed and one manifest goes missing. |
| Power Row | 4 | 10-12 | 4 | some levels | beam search | Power cells, two foremen, the lights go out. |
| The Vault | 5 | 13-15 | 3 | every level | Dijkstra | No new powers; everything at once. |

From level to level the bot count never falls and the foreman's hp never falls.
Across the whole campaign one number has to rise every single level:

```
difficulty = 4*tier + 2*deliveries + 1*basic + 2*fast + (foreman hp x foremen)
           + 3 if fogged + 3 if the manifest is missing + 2 if memory is capped
           + 1 per swap below five
```

The verifier fails any level that does not climb above the one before it.
The ladder today runs 9, 12, 13, 19, 23, 24, 31, 35, 36, 42, 44, 49, 54, 55, 63, with 1 bot on level 1 and 13 on level 15.

## The thieves

Three types, one table: `Campaign.BOTS`.

| Type | hp | Moves | Plans with | Goes for | When the ride's light touches it | Bump drain |
|---|---|---|---|---|---|---|
| Hauler bot (`basic`) | 1 | 1 cell every 2 ticks | BFS | lockboxes, then deliveries, else patrols | stunned 4 ticks, drops what it carries | 4 |
| Scout (`fast`) | 1 | 2 cells every tick | greedy | the cart, inside 8 cells | flees for 3 ticks | 6 |
| Foreman (`boss`) | 3-5 | 1 cell every 3 ticks | Dijkstra | drags the delivery it holds away from the cart | loses 1 hp, unless it is proofed against that power | 12 |

The hauler bot is the thief the captain first asked for: it steals lockboxes and shoves deliveries a cell when it bumps them, so the target keeps moving.
The scout is the pressure: it is fast, it hunts the cart, and it is scared of light, so the player learns to keep a ride pointed at it.
The foreman is the fight: it holds one delivery from the start (`prizeBehaviour.heldByBoss`) and releases it only when it dies.
Each zone proofs foremen against one power, chosen as the power that would otherwise sweep the zone, so the player always has to change tools for the fight.

## The unlock ladder

Each power arrives on exactly the level whose trap it is the answer to.
The order is the one the captain agreed on 2026-09-19, and the verifier holds it.

| Level | Map | Power | Why here |
|---|---|---|---|
| 1 | receiving-1 | BFS | An open bay: a sweep is never wrong about steps. |
| 2 | receiving-2 | DFS | The memory level: a comb of aisles with a memory cap of 8 - the sweep overheats, the bore holds one aisle. |
| 3 | receiving-3 | Dijkstra | The first oil map: steps and charge stop being the same question. |
| 4 | oil-line-1 | A* | Both deliveries in plain sight, so the guess is finally worth something. |
| 5 | oil-line-2 | Greedy | Three deliveries on a moving floor: a snap that plots for nothing beats a late perfect line. |
| 6 | oil-line-3 | Weighted A* | A deep spill the snap wades into; the dial decides how much wrong you can pay for. |
| 7 | long-halls-1 | Bidirectional BFS | Both ends known, a long hall between: two small searches beat one big one. |
| 8 | long-halls-2 | IDDFS | The manifest is missing and memory is 10: only the sonar is blind, short and small. |
| 9 | long-halls-3 | Beam search | The widest floor with a memory of 12: cap the light and it still crosses. |
| 10 | power-row-1 | Bellman-Ford | The first power-cell map: a route can get cheaper after it looked finished. |
| 11 | power-row-2 | Flow field | The first multi-chest floor: lockboxes every 6 ticks, up to 4 at once. |
| 12 | power-row-3 | Wall follower | The racks: a joined-up maze, dark, with a memory of 4. |
| 13-15 | vault-1..3 | none | Revision: three swaps, every perfect line mixes powers. |

## The perfect line

Every encounter carries `perfectLine`: the authored intended solution, one leg per delivery in the order they are taken.
Authoring rules, all enforced by the verifier:

1. One leg per delivery, each delivery once, `to` indexing the map's G cells in reading order.
2. Every power in it is already unlocked on that level - no shop purchase assumed.
3. A level that hands over a power uses it; a Vault level uses at least two powers.
4. A leg to a foreman-held delivery carries `hits` equal to the foreman's hp and does not use the power the zone proofs him against.
5. It fits the swap cap and the memory cap, and every leg is found by the real engine.
6. Across a zone, no single power used alone - in whatever delivery order suits it best, and counting the one power the shop can sell early - makes three stars on all three levels.

Par is measured off the perfect line, never guessed:

```
par        = measured line x (1.15 + 0.05 per foreman), rounded up, for ticks and charge
startCharge = par charge x margin by tier (2.0, 1.8, 1.6, 1.5, 1.4)
```

The measurement is on the still floor: the verifier runs the engine, not the thieves.
The slack is the room left for the floor moving, and it grows with every foreman on it.
`node tools/verify-campaign.js --write` rewrites par and startCharge; a plain run fails when the file has drifted from the measurement.

The verifier also prints, per level, which single powers can make three stars alone.
That column is the honest read on how sharp each level's trap is.
Against today's stand-in maps some levels are loose (long-halls-1, long-halls-2, power-row-1 and power-row-2 let several powers through) even though no zone is swept.
The real maps should tighten those columns; the verifier will show it the moment `maps.js` lands.

## Economy

Gold comes from three places, and none of it can be bought with anything but play:

| Source | Amount |
|---|---|
| Each delivery secured | 5, 6, 7, 8, 9 by tier |
| Clearing the level | `rewards.clear`, 10 at tier 1 up to 40 on the last level |
| Two stars / three stars | `rewards.twoStar` / `rewards.threeStar` on top |
| Each lockbox reached first | `chestRules.gold` (5-10), and `chestRules.charge` back into the meter |

Over the whole campaign, before lockboxes, a one-star player earns 604 gold and a three-star player 994.
Buying every boost the shelf offers on every level would cost 1180, so even a perfect player chooses.
A one-star player reaches the first foreman (level 4) able to afford a recharge.
The verifier checks both of those.

## The shop

`shop.js` has two shelves.

**Powers.**
Every power unlocks for free on its level.
The shop sells exactly one of them early, once per campaign: the next power on the ladder, one level before it would arrive.
Prices by the tier of the level it belongs to: 30, 45, 60, 80, 100.
Buying one skips a wait, never a lesson - the level that teaches it still has to be played, and the verifier counts the early power when it checks for sweeps.

**Boosts.**
One-shot helps carried into the next level.
None of them moves the cart, picks a route or names a power; `Shop.ALLOWED_EFFECTS` is the whole list of what one may do.

| Boost | Unlocked after | Price | Per level | Cooldown | Effect | Star cap |
|---|---|---|---|---|---|---|
| Recharge | level 1 | 15 | 2 | 10 ticks | +40 charge | none - stars count charge spent, so it cannot buy one |
| Freeze | level 2 | 20 | 1 | - | every thief skips its next move | 2 |
| Flare | level 4 | 25 | 1 | - | lights a radius of 4 round the cart | 2 |
| Spare coupling | level 6 | 25 | 1 | - | +1 swap | 2 |

That is the no-pay-to-skip-thinking rule in one line: gold can save a shift, never earn the third star.

## The map contract

`maps.js` exports `MAPS = [{ id, zone, tier, ascii, notes }]` in engine glyphs (README, "Map format").
The campaign binds to it by id, and the verifier checks each binding:

- every `mapId` below exists, with the same `zone` and `tier`;
- the map has exactly as many `G` cells as the encounter has deliveries;
- the perfect line runs on it.

| Level | mapId | zone | tier | deliveries | What the map has to carry |
|---|---|---|---|---|---|
| 1 | receiving-1 | receiving | 1 | 2 | open bay |
| 2 | receiving-2 | receiving | 1 | 2 | a comb of aisles too wide for a sweep at memory 8 |
| 3 | receiving-3 | receiving | 1 | 2 | the first oil, with a dry way round |
| 4 | oil-line-1 | oil-line | 2 | 2 | oil, deliveries in plain sight |
| 5 | oil-line-2 | oil-line | 2 | 3 | wide aisles, three deliveries |
| 6 | oil-line-3 | oil-line | 2 | 3 | a deep spill the snap wades into |
| 7 | long-halls-1 | long-halls | 3 | 3 | long halls between known ends |
| 8 | long-halls-2 | long-halls | 3 | 3 | branchy, narrow enough for memory 10 |
| 9 | long-halls-3 | long-halls | 3 | 3 | the widest floor, crossable at memory 12 |
| 10 | power-row-1 | power-row | 4 | 3 | the first power cells (`v`) |
| 11 | power-row-2 | power-row | 4 | 3 | lots of open floor for lockboxes |
| 12 | power-row-3 | power-row | 4 | 3 | a joined-up rack maze, corridors of width 1 |
| 13 | vault-1 | vault | 5 | 3 | chutes that make the ruler lie |
| 14 | vault-2 | vault | 5 | 3 | oil, a power cell, racks and a chute |
| 15 | vault-3 | vault | 5 | 3 | the longest haul |

Until `maps.js` lands, the verifier runs on `tools/fixtures/placeholder-maps.js` and says so on its first line.
Those stand-ins exist only to prove the rules run; delete them when the real maps arrive.
