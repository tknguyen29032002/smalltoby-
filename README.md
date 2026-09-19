# Pathfinder Dispatch

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

## The four algorithms on screen

| Algorithm | Frontier | Shape you see | Lesson |
|---|---|---|---|
| BFS | queue | concentric diamond rings | fair, blind, optimal on unweighted maps |
| DFS | stack | one snaking line with backtracks | commits early, no notion of distance |
| Dijkstra | priority by cost so far | rings that slow down in expensive terrain | respects weights, still blind to the goal |
| A* | priority by cost so far + heuristic | a teardrop stretched toward the goal | uses knowledge of where the goal is |

## Levels

1. Open field, close goal, unweighted, `shortest`. Tutorial: everything works, see the four shapes.
2. Walls, unweighted, `shortest`. DFS returns a long path and fails. BFS and A* pass; A* with fewer expansions.
3. Swamp terrain, `cheapest`, generous expansion budget. BFS wades through swamp and fails. Dijkstra and A* pass.
4. Large weighted map, far goal, tight expansion budget. Dijkstra runs out of fuel. A* fits.
5. One spine with nine corridors hanging off it, `any`, tight frontier budget. BFS holds every corridor open at once and its frontier balloons. DFS walks one corridor at a time, stays small, and reaches the goal.

(Level 5 is a comb rather than an empty hall: on a fully open grid a stack-based DFS actually holds *more* cells than BFS, so the level has to branch for the memory lesson to be true.)

Planned extensions: a Greedy best-first button (heuristic only, the foil for A*), a level where the heuristic lies (teleporter or wrap-around edge, so A* returns a non-optimal path), Weighted A* as a slider, and bidirectional BFS.

## Map format

Levels are ASCII strings in `levels.js`:

```
#  wall
.  grass, cost 1
~  swamp, cost 5
S  start
G  goal
```

## Structure

- `index.html` - layout and buttons.
- `style.css` - styling.
- `levels.js` - the ASCII maps plus objective and budgets per level.
- `search.js` - one `search(grid, strategy)` function. The four algorithms are the same loop with a different frontier: queue, stack, sorted by g, sorted by g + h. It returns a full trace (expansion order, frontier size per step, final path) so playback is just stepping an index.
- `render.js` - draws grid, visited-by-order, frontier, and path for a given trace index.
- `game.js` - level state, button wiring, playback via `requestAnimationFrame`, scoring, compare strip.
