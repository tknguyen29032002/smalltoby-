# Pathfinder Dispatch

Play it: https://tknguyen29032002.github.io/smalltoby-/

A small browser game that teaches graph pathfinding by making the trade-offs visible.
Pick BFS, DFS, Dijkstra, or A* for a map, watch it explore, and see what it cost.

Open `index.html` in a browser. No build step, no dependencies.

## Run locally on a Mac

Two ways, both work out of the box:

- Double-click `index.html` in Finder. It opens over `file://` in Safari or Chrome and plays fully - the game is plain scripts, so there is no fetch of local files, no ES modules, and nothing loaded from a CDN.
- Or serve the folder: from the repo root run `python3 -m http.server 8000` (python3 ships with macOS) and open <http://localhost:8000>.

## Learning objective

Each algorithm trades something away.
BFS and Dijkstra spend exploration to guarantee an optimal path.
DFS spends nothing on optimality.
A* borrows a heuristic to spend less.
The game turns those trade-offs into budgets the player can see run out.

## Core loop

1. A map appears with a start, a goal, an objective, and one or two budgets.
2. The player picks an algorithm. The pick is the prediction.
3. The algorithm animates: cells fill in exploration order, the frontier is highlighted, the path is drawn at the end. Budget bars drain live.
4. A verdict card says whether the objective and budget were met, and one sentence of why.
5. A compare strip shows what the other three algorithms would have done on the same map.
6. Stars: 3 = best fit, 1 = objective met but budget wasted, 0 = failed.

## Objectives and budgets

Objective is one of `shortest` (fewest steps), `cheapest` (lowest terrain cost), or `any` (reach the goal).
Budget is `expansions` (nodes taken off the frontier) or `frontier` (peak frontier size, a stand-in for memory).

## The algorithms on screen

| Algorithm | Frontier | Shape you see | Lesson |
|---|---|---|---|
| BFS | queue | concentric diamond rings | fair, blind, optimal on unweighted maps |
| DFS | stack | one snaking line with backtracks | commits early, no notion of distance |
| Dijkstra | priority by cost so far | rings that slow down in expensive terrain | respects weights, still blind to the goal |
| A* | priority by cost so far + heuristic | a teardrop stretched toward the goal | uses knowledge of where the goal is |
| Greedy | priority by heuristic alone | a thin line that walks straight at the goal | speed bought by never counting the bill |
| Weighted A* | priority by g + w*h | A* at w = 1, Greedy as w grows | the dial between the two, and what it costs |
| Bidirectional BFS | two queues, one from each end | two circles growing until they touch | two small searches beat one big one |
| Iterative deepening | depth-limited stack, deeper each pass | the same shallow cells, again and again | BFS answers on a DFS-sized stack |
| Beam search | best-first, frontier capped at k | a narrow band that can walk past the door | bounded memory, no guarantee |
| Bellman-Ford | no priority: relax every edge, pass after pass | the whole map lighting up in waves | the only one that survives a refund |
| Flow field | one search backward from the goals | a distance field over the entire map | pay once, answer every unit |
| Wall follower | none at all | one hand on the wall, all the way round | no memory, and it shows |

`search.js` exports a `STRATEGIES` registry holding this table as data - label, one-sentence description, frontier rule, what it wins, where it fails - so the UI never has to hard-code it.

## Levels

1. Open field, close goal, unweighted, `shortest`. Tutorial: everything works, see the four shapes.
2. Walls, unweighted, `shortest`. DFS returns a long path and fails. BFS and A* pass; A* with fewer expansions.
3. Swamp terrain, `cheapest`, generous expansion budget. BFS wades through swamp and fails. Dijkstra and A* pass.
4. Large weighted map, far goal, tight expansion budget. Dijkstra runs out of fuel. A* fits.
5. One spine with nine corridors hanging off it, `any`, tight frontier budget. BFS holds every corridor open at once and its frontier balloons. DFS walks one corridor at a time, stays small, and reaches the goal.
6. A pair of teleport pads, `cheapest`. The pads are one step apart however far apart they look, so Manhattan distance overstates the real distance and A* is confidently wrong. Dijkstra is right; so is Weighted A* with `w` turned down to 0.

(Level 5 is a comb rather than an empty hall: on a fully open grid a stack-based DFS actually holds *more* cells than BFS, so the level has to branch for the memory lesson to be true.)

`levels.js` also exports `EXTRA_LEVELS`: levels that are authored, tuned and checked exactly like the six above, but need a strategy or a mechanic the buttons do not offer yet. Each says what it is waiting for in its `needs` field - refund chutes, a hidden goal, several goals, several units, a maze with no memory, one courier per leg, and fog with a hot swap. Move one into `LEVELS` the moment the UI can play it.

## Map format

Levels are ASCII strings in `levels.js`:

```
#    wall
.    grass, cost 1
~    swamp, cost 5
v    refund chute: cost -4, one-way downward
0-9  teleport pads: cells sharing a digit are one move apart
A-F  waypoints, visited in letter order when the level uses legs
S    start (a map may hold several: one unit each)
G    goal (a map may hold several)
```

A refund chute is entered only from the cell directly above it and left only to the cell directly below, and that one-way rule is what keeps a negative tile from becoming a two-cell loop you could ride forever.

## Engine contract

`search.js` is the whole engine and has no dependencies on the UI files.
Everything below is what `render.js`, `game.js` and `tools/` are allowed to rely on.

### The registry

`STRATEGIES` is an array of plain objects, one per algorithm, and `STRATEGY_BY_ID` is the same data keyed by id.
The four original ids - `bfs`, `dfs`, `dijkstra`, `astar` - are stable and will not be renamed.

| Field | Meaning |
|---|---|
| `id` | The stable key. Used in traces, level plans and button wiring. |
| `label` | What the player sees on the button. |
| `description` | One sentence explaining the algorithm. |
| `frontierRule` | One sentence naming the rule that makes it different: what comes off the frontier next. |
| `needsHeuristic` | It cannot run without knowing where the goal is *and* being able to measure the distance. |
| `needsGoalPosition` | It has to *begin* its search at the goal, so an unknown or fogged goal rules it out outright. Bidirectional BFS and the flow field do; A* does not, it just goes blind. |
| `supportsMultiTarget` | It can watch several goals in one run. When false, a multi-goal level re-runs it once per goal. |
| `guaranteesOptimal` | `'steps'`, `'cost'`, a qualified string such as `'cost-if-h-admissible'`, or `false`. |
| `hotSwappable` | It shares the one frontier loop, so a run can be swapped onto or off it mid-search. |
| `wins` | The kind of challenge it is the right answer to. Shown as its glossary card. |
| `fails` | Where it is the wrong answer. Shown on the same card. |
| `params` | Tunable inputs: `{ name, label, description, min, max, step, default }`. Weighted A* has `weight`, beam search has `k`, iterative deepening has `maxDepth`, the wall follower has `maxSteps`. |

`defaultParams(id)` returns the defaults as an object.
`strategyAvailability(level)` returns one `{ id, eligible, reason, note, blind }` per strategy for a given level, so the UI can grey out what cannot be played and warn about what will be expensive.
`eligibleStrategies(level)` is the same thing reduced to a list of ids.

### search(grid, strategy, params)

`parseGrid(ascii)` turns a map into `{ w, h, cells, start, starts, goal, goals, waypoints, teleports }`.
`search(grid, strategy, params)` runs one strategy from one start to one target set and returns a finished trace.
Every field of `params` is optional:

| Param | Meaning |
|---|---|
| `weight` | The `w` of weighted A*. 0 is Dijkstra, 1 is A*, large is greedy. |
| `k` | The beam width. |
| `from` | `{x,y}` start override. Legs use this. |
| `to` | `{x,y}` single target override. |
| `targets` | `[{x,y}, ...]`. The run stops at whichever is reached first. |
| `hideGoal` | The goal position is unknown, so `h` is 0 everywhere. |
| `fog` | Only visited cells and their neighbours are visible, and `h` stays 0 until the goal is actually revealed. |
| `swapPenalty` | Expansions charged per hot swap. Default 5. |
| `maxDepth`, `maxSteps`, `expansionCap` | Per-strategy limits, as declared in the registry. |

### The trace

Field names already in use do not change.

| Field | Meaning |
|---|---|
| `strategy` | The id that produced it - after a swap, the one it finished under. |
| `steps` | One entry per expansion, in order. Playback is an index into this. |
| `steps[i].x`, `.y`, `.i` | The cell expanded, as coordinates and as `y * w + x`. |
| `steps[i].frontierSize` | How many entries the frontier held after that expansion. |
| `steps[i].frontierCells` | The distinct cell indices in the frontier at that moment. |
| `path` | `[{x,y,i}, ...]` from start to goal, empty when nothing was found. |
| `pathSteps` | `path.length - 1`, or `Infinity`. |
| `pathCost` | Terrain cost of every cell entered along the path, or `Infinity`. |
| `expansions` | Cells taken off the frontier. Never includes a swap penalty. |
| `peakFrontier` | The largest the frontier ever got. The memory budget is scored against this. |
| `found` | Whether a target was reached. |
| `from`, `to`, `targets` | Where the run started, where it ended, what it was aiming at. |
| `params` | The params it actually ran with, defaults filled in. |

Fields that appear only when the run earned them:

| Field | Appears on | Meaning |
|---|---|---|
| `steps[i].side` | bidirectional | `'forward'` or `'backward'`: which wave that expansion came from. |
| `steps[i].frontierForward`, `.frontierBackward` | bidirectional | The two frontiers separately, for colouring. Together they are `frontierCells`. |
| `meetingPoint` | bidirectional | Where the two waves met. |
| `steps[i].pass` | iterative deepening, Bellman-Ford | Which pass this expansion belongs to, so the UI can animate the restarts. |
| `passes` | iterative deepening, Bellman-Ford | How many passes it took. |
| `negativeCycle` | Bellman-Ford | The relaxation never settled. A map with refund chutes should never produce this. |
| `field` | flow field | Cost-to-goal for every cell on the map, indexed like the grid. |
| `steps[i].facing` | wall follower | Which way the walker is pointing, as an index into the move order. |
| `gaveUp` | wall follower, iterative deepening, flow field | It stopped on its own cap rather than on a wall of `no path`. |
| `truncatedSteps` | iterative deepening, Bellman-Ford | The counters are honest but step recording stopped at 20000 entries. |
| `steps[i].revealedCells`, `.blind` | fog | What that expansion uncovered, and whether the heuristic was still unavailable. |
| `fog`, `goalRevealed`, `initialRevealed` | fog | The run was fogged, whether the goal ever came out of it, and what was visible before the first step. |
| `swaps`, `swapCount`, `swapPenalty` | hot swap | Each swap as `{ atStep, from, to, params }`, how many there were, and the charge per swap. |
| `penaltyExpansions`, `chargedExpansions` | hot swap | The penalty total, and `expansions + penaltyExpansions`. **Budgets are scored against `chargedExpansions` when it is present.** |
| `steps[i].strategyNow` | hot swap | Which strategy was in charge for that expansion. |
| `legs`, `probesRun` | missions | See below. |

### Resumable runs, hot swap and fog

The loop is exposed as a state you can hold rather than only as a finished trace.

- `createSearch(grid, strategy, params)` returns a state: frontier, visited set, `bestG`, parents, counters.
- `stepSearch(state)` performs exactly one expansion and returns the step it recorded, or `null` when the run is over. `state.done` says the same thing.
- `switchStrategy(state, id, params)` swaps the rule mid-run and returns `false` if that strategy has its own shape (`hotSwappable: false`). Everything learned survives - visited cells, costs, parents - and only the order the frontier hands cells back changes: FIFO for a queue, LIFO for a stack, re-sorted by the new key for a priority rule.
- `runSearch(state)` drives it to the end; `traceOf(state)` reads the trace off it at any point.
- `search()` is exactly `runSearch(createSearch(...))`, so there is one loop and no second copy to drift.

Under `fog: true` a cell is visible once it has been stood on or stood next to.
Until a goal is visible, `heuristicAt` returns 0 for every cell, so A*, greedy, weighted A* and beam behave like their heuristic-free cousins; `strategyAvailability` marks them `blind: true` for that level.
The moment the goal is revealed the whole frontier is re-scored, and the run finishes sighted.
Nothing about the goal reaches the heuristic before that.

### Missions: several goals, several units, several legs

`searchMission(grid, plan, options)` returns a trace with the same shape as a single search plus a `legs` array, so `render.js` and the budget bars need no special case.
`plan` is a strategy id, or an array with one entry per leg - ids or `{ strategy, params }` objects - and a short array repeats its last entry.
`options.objective` decides what the legs are:

| Objective | Legs |
|---|---|
| `collect` | One leg per goal: go to the nearest, then the nearest of the rest, until every `G` has been stood on. |
| `dispatch` | One leg per `S` on the map. Every unit has to reach a goal. |
| `nearest` | One leg, all goals as targets, stopping at whichever is reached first. |
| anything else, with waypoints `A`-`F` | `S -> A -> B -> ... -> G`, one leg per hop. |
| anything else | One leg, `S -> G`. |

A strategy with `supportsMultiTarget: false` cannot watch several goals at once, so it is re-run once per goal and every discarded probe stays in the trace and in the bill; `probesRun` counts them.
The flow field is the exception `dispatch` exists for: it builds its field once and every later unit reads a route off it for zero expansions.

In the merged trace, `steps` are concatenated and each carries its `leg` index, `expansions` are summed, `peakFrontier` is the highest any leg reached, and `path` is the legs walked end to end.
Each entry of `legs` is `{ leg, strategy, params, from, to, found, probe, discarded, probesRun, pathSteps, pathCost, expansions, peakFrontier, stepStart, stepEnd }`.

### Scoring references

`referenceFor(grid, level)` returns `{ bestSteps, bestCost, reachable }`.
Steps come from BFS and cost comes from Bellman-Ford, never from Dijkstra: a map with refund chutes is exactly the map Dijkstra gets wrong, and scoring against a wrong answer would mark the right answer as a failure.

### Checking it

```
node tools/verify-levels.js   # every level still scores the way it is designed to
node tools/verify-engine.js   # the registry, the trace fields and the mechanics above
```

## Structure

- `index.html` - layout and buttons.
- `style.css` - styling.
- `levels.js` - the ASCII maps plus objective and budgets per level, and `EXTRA_LEVELS` for the ones waiting on a button.
- `search.js` - the engine: the strategy registry, `search()`, the resumable `createSearch`/`stepSearch`/`switchStrategy` loop, and missions. Seven of the twelve strategies are the same loop with a different frontier; the other five have their own shape behind the same trace. See the engine contract above.
- `render.js` - draws grid, visited-by-order, frontier, and path for a given trace index.
- `game.js` - level state, button wiring, playback via `requestAnimationFrame`, scoring, compare strip.
- `tools/` - the two verification scripts. They are the design table, written down and executable.
