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
3. The algorithm animates: cells fill in exploration order, the lifted frontier shows what is still held, and the path is drawn as a raised ribbon at the end. Budget bars drain live, and anything explored past the fuel budget turns red on the board.
4. A verdict sheet rises over the map: stars, what happened, one sentence of why, and the name of the CS concept the level just taught.
5. The same sheet compares what every other algorithm would have done on the same map.
6. Stars: 3 = best fit, 1 = objective met but budget wasted, 0 = failed. Stars persist, and one star opens the next level.

The board is the whole window. Drag to pan, scroll to zoom, `F` to refit, space to play, `→` to step, `1`-`9` to pick an algorithm.
The design review behind this shape, and the roadmap it produced, is in [VISION.md](VISION.md).

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

- `index.html` - the full-window canvas plus the HUD that floats over it.
- `style.css` - styling. House rule: the map is the screen, so there is no panel layout and nothing scrolls.
- `levels.js` - the ASCII maps plus objective and budgets per level.
- `search.js` - one `search(grid, strategy)` function. The four algorithms are the same loop with a different frontier: queue, stack, sorted by g, sorted by g + h. It returns a full trace (expansion order, frontier size per step, final path) so playback is just stepping an index.
- `render.js` - isometric board renderer: terrain with height, exploration order, lifted frontier, raised path ribbon, and the camera (`fitCamera`, `drawScene`, `screenToCell`).
- `game.js` - level state, camera input, playback via `requestAnimationFrame`, scoring, stars in `localStorage`, verdict and compare. The algorithm picker and its glossary cards are built from the strategy registry, so a strategy added in `search.js` appears in the UI with no change here.
