# Factory Heist - the campaign

This is the design behind `campaign.js` and `shop.js`.
Those two files are data: fifteen encounters, the thief roster, the zone rules, the economy and the shop.
`maps.js` owns every floor plan and is the only source of them; the campaign binds to it by map id and layers encounters on top.
`heist.js` is the one gameplay simulator and reads all three.
`node tools/verify-campaign.js` is the proof that the data still makes a campaign, and `npm test` runs it.
`docs/design/campaign.html` draws the whole campaign from the shipped files.

## The rules this is priced for

The cart does not walk.
The player aims a power at a delivery, the power (an algorithm from the engine) searches from the cart, and the cart rides the route it found, one cell per tick.
WASD is a one-cell nudge that costs charge - for stepping off oil or out of a thief's way, never for crossing the map.
The world is tick-based: it only moves when the player acts.
A level is won by standing on its deliveries (the red points).
A level is lost when charge reaches zero.

Stars are cumulative:

| Stars | Condition |
|---|---|
| 1 | every delivery secured |
| 2 | and finished inside par ticks |
| 3 | and spent no more than par charge |

A boost other than recharge caps the level at two stars.

## What the campaign reads off a map

`maps.js` owns all of this; the campaign only interprets it.

| Map field | What it means in the heist |
|---|---|
| first `S` | where the cart starts; any other `S` is a thief's den |
| `G`, then `$` | the deliveries: every `G` in reading order, then `$` pads in reading order until the encounter has as many as it asks for |
| leftover `$` | where lockboxes pop up (then random floor once they are taken) |
| `budgets.expansions` | the thinking allowance: expansions a plot gets for free |
| `budgets.frontier` | memory: a plot that holds more frontier overheats |
| `fog`, `goalKnown: false` | the floor's own darkness and missing manifest |

An encounter may add fog, hide the manifest, or tighten memory (`memoryCap`), but it never removes what the map was built around.
Using the map's own budgets as the price of thinking is what carries each map's lesson into the charge meter: the map lane already proved which power wins inside those budgets.

## What costs what

Every number lives in `Campaign.ECONOMY`, and heist.js charges the same way or par means nothing.

| Action | Charge | Ticks |
|---|---|---|
| A plot (firing a power) | 1, plus 1 for every expansion past the map's allowance (`Campaign.plotCharge(trace, map)`); swap penalties count as expansions | 1 |
| Riding a cell | its terrain: plate 1, oil 5, a power cell pays 4 back | 1, plus 1 more climbing out of oil |
| A nudge | the cell's terrain plus 2 | 1 |
| A hit on a foreman | another plot of the same power | 1 |
| Overheating (frontier past the memory limit) | the plot's charge, and the cart does not move | 1 |

So a power is paid for twice: once for thinking past the allowance, and once for the route it chose.

## The difficulty curve

Five zones of three levels, the five zones of `maps.js`.
Each zone tightens one thing and keeps everything before it.

| Zone | Tier | Levels | Swap cap | Foreman proofed against | Tightens |
|---|---|---|---|---|---|
| The dock | 1 | 1-3 | 5 | - (no foreman) | Three powers arrive on open floor. |
| Assembly | 2 | 4-6 | 5 | A* | Thinking has a budget; foremen arrive, proofed against the dart. |
| The racks | 3 | 7-9 | 4 | beam search | Memory is the budget, a manifest goes missing, the racks go dark. |
| The chutes | 4 | 10-12 | 4 | bidirectional BFS | Teleporters and power cells make the ruler lie; two foremen. |
| Control | 5 | 13-15 | 3 | flow field | The biggest floors in the dark, memory rationed, three foremen at the end. |

Each zone's shield is the power that would otherwise sweep the zone, so the player always has to change tools for the fight.
From level to level the bot count never falls and the foreman's hp never falls.
One number has to rise every single level:

```
difficulty = 4*tier + 2*deliveries + 1*basic + 2*fast + (foreman hp x foremen)
           + 3 if fogged + 3 if the manifest is missing + 1 per swap below five
```

The ladder today runs 9, 10, 13, 19, 21, 22, 29, 35, 37, 39, 44, 46, 58, 60, 65, with 1 thief on level 1 and 16 on level 15.

## The thieves

Three types, one table: `Campaign.BOTS`.

| Type | hp | Moves | Plans with | Goes for | When the ride's light touches it | Bump drain |
|---|---|---|---|---|---|---|
| Hauler bot (`basic`) | 1 | 1 cell every 2 ticks | BFS | lockboxes, then deliveries, else patrols | stunned 4 ticks, drops what it carries | 4 |
| Scout (`fast`) | 1 | 2 cells every tick | greedy | the cart, inside 8 cells | flees for 3 ticks | 6 |
| Foreman (`boss`) | 3-5 | 1 cell every 3 ticks | Dijkstra | drags the delivery it holds away from the cart | loses 1 hp, unless it is proofed against that power | 12 |

The hauler bot steals lockboxes and shoves deliveries a cell when it bumps them, so the target keeps moving.
The scout is the pressure: fast, hunting the cart, scared of light.
The foreman is the fight: it holds one delivery from the start (`prizeBehaviour.heldByBoss`) and releases it only when it dies.

## On the floor

The table above is the contract; `heist.js` is how it plays.
These are the rules it adds, each one there because without it a perfect line could not be ridden with the thieves on.

- **Where they start.** Foremen start on the delivery they hold. Everyone else takes the map's extra `S` cells (their dens), then its `$` lockbox pads, then the floor cell farthest from the cart, the deliveries and every thief already placed, so no corner turns into a nest. It is all deterministic, so a replay starts the same.
- **The route is a searchlight.** Every thief standing on a found route is lit when the plot lands. A foreman still standing blocks the ride at his cell, so the cart stops short of him instead of driving through.
- **The ride stays lit.** A hauler or scout that steps onto what is left of the route being ridden is lit exactly as if the plot had found it there. Foremen are fought with plots, not ribbons.
- **A lit foreman staggers.** Losing a plate costs him his next drag, so a second plot can reach him before he is gone.
- **A ram is one hit, not a grind.** A thief that bumps the cart drains its charge, then backs off for as long as the light would have sent it running, and a scout does not hunt again until it has crossed its own hunting range.
- **Blocked rides end.** A thief standing on the next cell of the route ends the ride, since the cart does not wait on a robot that may never move. A stunned or fleeing thief is rolled past.
- **Hauler shoves.** Walking into a free delivery pushes it one cell, so the red point the player aimed at moves. The player has to get off and plot again.

`node tools/verify-heist.js` is the proof that the priced rules and these rules agree.
It plays all fifteen encounters through `heist.js` with every thief on the floor, using a reference player that follows the perfect line.
When the line's power cannot reach from where the cart now stands, the player plots with the cheapest power that works.
It gets off when a delivery is shoved away, and it does nothing a player could not do.
It fails when an encounter is not won that way on its start charge, when a log does not replay to the same run, or when a still-floor plot costs anything other than what `verify-campaign.js` charged for it.
Today every floor is won, mostly at two or three stars; level 12, the drop shaft, is the tightest, won at one star with 83 of its 83 charge spent.
`tests/browser/heist-walkthrough.js` plays the same reference player through the page and must print the same numbers.

## The unlock ladder

Each power arrives on the map whose trap it answers.
The verifier holds three things about every unlock: the power either wins that map's own verified lesson (`expect` in `maps.js`) or is the cheapest single power on that floor; the level's perfect line uses it; and the captain's anchors hold - BFS first, Dijkstra on the first oil map, Bellman-Ford on the first power-cell map, the wall follower in the racks.

| Level | Map | Power | Why here |
|---|---|---|---|
| 1 | Loading bay | BFS | Open bay: a sweep is never wrong about steps. |
| 2 | The crate cup | Greedy | The prize is in plain sight across a wide cup: the snap thinks a fraction of what a sweep does. |
| 3 | Oil on the apron | Dijkstra | The first oil: steps and charge stop being the same question. |
| 4 | Line one | A* | Thinking has a budget, and only the dart is both honest about oil and inside it. |
| 5 | The press trap | Weighted A* | A flooded press tempts the snap; the dial trusts the guess only as far as the oil lets it. |
| 6 | The narrow gantry | Beam search | Memory 8: every other power overheats. |
| 7 | Shelf comb | DFS | The memory level of the racks: a bore holds one aisle. |
| 8 | Dark aisles | IDDFS | No manifest and memory 4: only the sonar is blind, short and small. |
| 9 | Hand on the rack | Wall follower | Memory 1, and dark: a hand on the wall holds nothing and needs no light. |
| 10 | Crossed chutes | Bidirectional BFS | Teleporters lie to every power that aims; two sweeps from known ends do not aim. |
| 11 | Power cells | Bellman-Ford | The first power cells: a route can get cheaper after it looked finished. |
| 12 | The drop shaft | - | Revision: teleporters and cells on one shaft. |
| 13 | Sorting floor | - | Revision: four prizes across oil. |
| 14 | Fleet recall | Flow field | Four dens run to one prize: one field built backwards answers every cell. |
| 15 | The vault | - | Revision: fog, oil, a lying teleporter and a charging shaft, three foremen. |

Weighted A* and bidirectional BFS are the two powers no map was built around, so each lands where it is the cheapest power on the floor: weighted A* on the press trap, bidirectional BFS on the crossed chutes.

## The perfect line

Every encounter carries `perfectLine`: the authored intended solution, one leg per delivery in the order they are taken.
Authoring rules, all enforced by the verifier:

1. One leg per delivery, each delivery once, `to` indexing the delivery cells (G cells, then `$` pads).
2. Every power in it is already unlocked on that level - no shop purchase assumed.
3. A level that hands over a power uses it; a revision level uses at least two powers.
4. A leg to a foreman-held delivery carries `hits` equal to the foreman's hp and does not use the power the zone proofs him against.
5. It fits the swap cap and the memory limit, and every leg is found by the real engine.
6. Across a zone, no single power used alone - in whatever delivery order suits it best, and counting the one power the shop can sell early once a perfect player could afford it - makes three stars on all three levels.

Par is measured off the perfect line, never guessed:

```
par         = measured line x 1.15, rounded up, for ticks and charge
startCharge = par charge x margin by tier (2.0, 1.8, 1.6, 1.5, 1.4)
```

The measurement is on the still floor: the verifier runs the engine, not the thieves.
The 15% is the room left for the floor moving, and `tools/verify-heist.js` checks it is enough (see "On the floor" above).
`node tools/verify-campaign.js --write` rewrites par and startCharge; a plain run fails when the file has drifted from the measurement.

The verifier also prints, per level, which single powers can make three stars alone.
That column is the honest read on how sharp each level's trap is.
Six levels let exactly one power through (levels 1, 2, 6, 8, 9, 15) and one lets none (10).
The rest are loose, for two reasons.
Open floors with oil reward any power that prices it, so several cost-correct powers tie.
And on a level with a foreman, the zone's shield can stop the level's own power from soloing it, even though that power wins the map's prize leg.
Neither is a sweep, because the zone rule above holds, but those columns are where a sharper map would pay off first.

## Economy

Gold comes from play only:

| Source | Amount |
|---|---|
| Each delivery secured | 5, 6, 7, 8, 9 by tier |
| Clearing the level | `rewards.clear`, 10 at tier 1 up to 40 on the last level |
| Two stars / three stars | `rewards.twoStar` / `rewards.threeStar` on top |
| Each lockbox reached first | `chestRules.gold` (5-10), and `chestRules.charge` back into the meter |

Over the whole campaign, before lockboxes, a one-star player earns 594 gold and a three-star player 984.
Buying every boost the shelf offers on every level would cost 1180, so even a perfect player chooses.
A one-star player reaches the first foreman (level 4) able to afford a recharge.
The verifier checks both.

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

## Deliveries on one-prize maps

Most maps in `maps.js` have one prize, because each is built around one route.
The captain's rule is 2-3 deliveries a level, so the campaign places the rest on the map's `$` pads, which the map lane left for the heist logic to decide.
The prize leg keeps the map's lesson; the pad legs are where foremen stand and where swaps pay off.
The Sorting floor asks for four prizes itself, so it has four deliveries - the one level over three.
The Shelf comb has one prize and one pad, so it has two.
