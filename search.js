/* search.js - one engine behind every strategy the game offers.
 *
 * Everything the UI needs to describe a strategy lives in the STRATEGIES
 * registry below, so a new algorithm is a registry entry plus a frontier rule
 * rather than a new branch spread over three files.
 *
 * Seven strategies are the same loop with a different frontier:
 *   bfs      - array as queue (take from the front)
 *   dfs      - array as stack (take from the back)
 *   dijkstra - take the lowest g (cost so far)
 *   greedy   - take the lowest h (guess to the goal)
 *   astar    - take the lowest g + h
 *   wastar   - take the lowest g + w*h (w = 0 Dijkstra, 1 A*, large greedy)
 *   beam     - lowest g + h, but the frontier is hard-capped at k
 * and five are their own shape behind the same trace:
 *   bibfs    - two BFS queues, one from each end, meeting in the middle
 *   iddfs    - depth-limited DFS, run again one level deeper each pass
 *   bellman  - relax every edge, pass after pass; survives negative tiles
 *   flow     - one Dijkstra from the goals outward, a distance field for all
 *   wall     - a walker with one hand on the wall and no memory at all
 *
 * A run is precomputed into a trace; playback only steps an index.
 * README.md "Engine contract" documents the registry, search() and every
 * trace field. Do not rename trace fields - render.js and game.js read them.
 */

var TERRAIN_COST = { '.': 1, '~': 5, 'S': 1, 'G': 1, 'v': -4 };

// 4-direction moves, in the order they are considered: right, down, left, up.
var MOVES = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1]
];

/* ---------- the registry ---------- */

var STRATEGIES = [
  {
    id: 'bfs',
    label: 'BFS',
    description: 'Explores every cell one step away, then every cell two steps away, and so on.',
    frontierRule: 'Queue: take the cell that entered the frontier first.',
    needsHeuristic: false,
    needsGoalPosition: false,
    supportsMultiTarget: true,
    guaranteesOptimal: 'steps',
    hotSwappable: true,
    wins: 'Fewest-steps levels with room to breathe, and levels that hide the goal.',
    fails: 'Weighted maps - it counts steps, not cost - and tight frontier budgets.',
    params: []
  },
  {
    id: 'dfs',
    label: 'DFS',
    description: 'Follows one corridor as deep as it goes before it ever considers another.',
    frontierRule: 'Stack: take the cell that entered the frontier last.',
    needsHeuristic: false,
    needsGoalPosition: false,
    supportsMultiTarget: true,
    guaranteesOptimal: false,
    hotSwappable: true,
    wins: 'Just-reach-it levels with a hard memory cap: it holds almost nothing.',
    fails: 'Anything asking for the best route. It hands in the first one it trips over.',
    params: []
  },
  {
    id: 'dijkstra',
    label: 'Dijkstra',
    description: 'Grows outward by cost paid so far, so expensive terrain slows the wave down.',
    frontierRule: 'Take the cell with the lowest g (cost from the start).',
    needsHeuristic: false,
    needsGoalPosition: false,
    supportsMultiTarget: true,
    guaranteesOptimal: 'cost',
    hotSwappable: true,
    wins: 'Cheapest-route levels, hidden goals, and maps where the heuristic lies.',
    fails: 'Expansion budgets: with no idea where the goal is, it searches everywhere.',
    params: []
  },
  {
    id: 'astar',
    label: 'A*',
    description: 'Dijkstra plus a guess of the distance still to go, which pulls the search at the goal.',
    frontierRule: 'Take the cell with the lowest g + h.',
    needsHeuristic: true,
    needsGoalPosition: false,
    supportsMultiTarget: false,
    guaranteesOptimal: 'cost-if-h-admissible',
    hotSwappable: true,
    wins: 'Big open maps under a tight expansion budget, when the guess can be trusted.',
    fails: 'Teleports, refunds and hidden goals - anywhere the guess overstates the truth.',
    params: []
  },
  {
    id: 'greedy',
    label: 'Greedy',
    description: 'Always walks at whatever looks closest to the goal and never counts what it has spent.',
    frontierRule: 'Take the cell with the lowest h (guess to the goal), ignoring g entirely.',
    needsHeuristic: true,
    needsGoalPosition: false,
    supportsMultiTarget: false,
    guaranteesOptimal: false,
    hotSwappable: true,
    wins: 'Just-reach-it levels on a clear run, for almost no expansions at all.',
    fails: 'Any objective about the route: it will happily wade a swamp to save a step.',
    params: []
  },
  {
    id: 'wastar',
    label: 'Weighted A*',
    description: 'A* with the guess turned up: faster and greedier, and it can hand back a worse path.',
    frontierRule: 'Take the cell with the lowest g + w*h. w = 0 is Dijkstra, w = 1 is A*, large w is Greedy.',
    needsHeuristic: true,
    needsGoalPosition: false,
    supportsMultiTarget: false,
    guaranteesOptimal: 'cost-if-w-is-1-and-h-admissible',
    hotSwappable: true,
    wins: 'Levels where the expansion budget is too tight for A* and you can pay in route quality - or where turning w down to 0 outsmarts a lying heuristic.',
    fails: 'Optimal-route objectives at high w: the path it returns can cost up to w times the best.',
    params: [
      {
        name: 'weight',
        label: 'w',
        description: 'How much the heuristic is trusted. 0 = Dijkstra, 1 = A*, 3+ = practically Greedy.',
        min: 0,
        max: 5,
        step: 0.25,
        'default': 1.5
      }
    ]
  },
  {
    id: 'bibfs',
    label: 'Bidirectional BFS',
    description: 'Runs one BFS from the start and one from the goal and stops where the two waves touch.',
    frontierRule: 'Two queues. Expand the smaller one, and check every new cell against the other side.',
    needsHeuristic: false,
    needsGoalPosition: true,
    supportsMultiTarget: false,
    guaranteesOptimal: 'steps',
    hotSwappable: false,
    wins: 'Long fewest-steps runs: two small circles beat one big one, so it pays a fraction of BFS.',
    fails: 'Hidden goals - it has to start from the goal - and weighted maps, where steps are not cost.',
    params: []
  },
  {
    id: 'iddfs',
    label: 'Iterative deepening',
    description: 'DFS with a depth limit, re-run one level deeper each pass until the goal falls inside.',
    frontierRule: 'Stack, but nothing deeper than the current limit. Only the current path is held.',
    needsHeuristic: false,
    needsGoalPosition: false,
    supportsMultiTarget: true,
    guaranteesOptimal: 'steps',
    hotSwappable: false,
    wins: 'Memory-capped fewest-steps levels: BFS-quality answers on a DFS-sized frontier.',
    fails: 'Expansion budgets - it re-walks the shallow cells every pass - and weighted maps.',
    params: [
      {
        name: 'maxDepth',
        label: 'max depth',
        description: 'How deep the last pass is allowed to go before the search gives up.',
        min: 1,
        max: 400,
        step: 1,
        'default': 200
      }
    ]
  },
  {
    id: 'beam',
    label: 'Beam search',
    description: 'Best-first search that throws away everything outside the k most promising cells.',
    frontierRule: 'Take the lowest g + h, then bin the frontier down to the best k cells.',
    needsHeuristic: true,
    needsGoalPosition: false,
    supportsMultiTarget: false,
    guaranteesOptimal: false,
    hotSwappable: true,
    wins: 'Hard frontier caps on open maps: its memory is k by construction, whatever the map size.',
    fails: 'Narrow corridors and dead ends - it discards the branch that was the way through and never gets it back.',
    params: [
      {
        name: 'k',
        label: 'beam width',
        description: 'How many cells the frontier may hold. Small k is fast, forgetful and prone to missing the goal.',
        min: 1,
        max: 40,
        step: 1,
        'default': 4
      }
    ]
  },
  {
    id: 'bellman',
    label: 'Bellman-Ford',
    description: 'Relaxes every edge again and again until nothing improves, so a late bargain still lands.',
    frontierRule: 'No priority at all: a pass over every cell that changed in the pass before.',
    needsHeuristic: false,
    needsGoalPosition: false,
    supportsMultiTarget: true,
    guaranteesOptimal: 'cost',
    hotSwappable: false,
    wins: 'Refund chutes and any map with negative cost, where Dijkstra and A* close a cell too early and answer wrong.',
    fails: 'Expansion budgets: it revisits cells pass after pass instead of finalising them once.',
    params: []
  },
  {
    id: 'flow',
    label: 'Flow field',
    description: 'One Dijkstra outward from the goals that leaves a distance field the whole map can read.',
    frontierRule: 'Take the lowest distance-to-goal, searching backward from every goal at once.',
    needsHeuristic: false,
    needsGoalPosition: true,
    supportsMultiTarget: true,
    guaranteesOptimal: 'cost',
    hotSwappable: false,
    wins: 'Many goals or many starts: one run answers every cell, so the second unit is free.',
    fails: 'A single start and a single goal - it pays for the whole map to serve one query - and hidden goals.',
    params: []
  },
  {
    id: 'wall',
    label: 'Wall follower',
    description: 'Keeps its left hand on the wall and walks. It stores nothing: no frontier, no visited set.',
    frontierRule: 'None. One position, one facing, and the rule "left, straight, right, back".',
    needsHeuristic: false,
    needsGoalPosition: false,
    supportsMultiTarget: true,
    guaranteesOptimal: false,
    hotSwappable: false,
    wins: 'No-memory levels in a proper maze, where every wall connects and the hand rule must reach an exit.',
    fails: 'Open rooms and islands: it circles forever, and the step cap is the only thing that stops it.',
    params: [
      {
        name: 'maxSteps',
        label: 'step cap',
        description: 'How long the walker is allowed to wander before it is declared lost.',
        min: 10,
        max: 4000,
        step: 10,
        'default': 900
      }
    ]
  }
];

var STRATEGY_BY_ID = {};
STRATEGIES.forEach(function (s) { STRATEGY_BY_ID[s.id] = s; });

function strategyInfo(id) {
  return STRATEGY_BY_ID[id] || null;
}

function defaultParams(id) {
  var info = STRATEGY_BY_ID[id];
  var out = {};
  if (!info) { return out; }
  (info.params || []).forEach(function (p) { out[p.name] = p['default']; });
  return out;
}

function withDefaults(id, params) {
  var out = defaultParams(id);
  if (params) {
    Object.keys(params).forEach(function (k) { out[k] = params[k]; });
  }
  return out;
}

/* Which strategies a level may offer, and why not when it may not.
 * needsHeuristic  - it cannot measure a distance it has no goal for, so a
 *                   hidden goal rules it out and fog leaves it blind until
 *                   the goal is revealed.
 * needsGoalPosition - it has to *begin* at the goal, so an unknown goal rules
 *                   it out outright.
 * The UI greys out the ineligible ones and can show `note` as a warning. */
function strategyAvailability(level) {
  var goalHidden = level && (level.objective === 'unknown' || level.goalKnown === false);
  var goalCount = (level && level.goalCount) || 1;
  var multiTarget = goalCount > 1 && (level.objective === 'nearest' || level.objective === 'collect');

  return STRATEGIES.map(function (s) {
    if (goalHidden && s.needsHeuristic) {
      return {
        id: s.id, eligible: false, note: null,
        reason: 'The goal position is hidden on this level, so there is no distance to guess.'
      };
    }
    if ((goalHidden || (level && level.fog)) && s.needsGoalPosition) {
      return {
        id: s.id, eligible: false, note: null,
        reason: 'It has to start its search at the goal, and nobody here knows where the goal is.'
      };
    }
    if (multiTarget && !s.supportsMultiTarget) {
      return {
        id: s.id, eligible: true, blind: false,
        note: 'Aims at one goal at a time, so it has to be re-run once per goal - and you pay for every run.',
        reason: null
      };
    }
    if (level && level.fog && s.needsHeuristic) {
      return {
        id: s.id, eligible: true, blind: true,
        note: 'Starts blind: in the fog there is nothing to measure, so it behaves like Dijkstra until the goal is revealed.',
        reason: null
      };
    }
    return { id: s.id, eligible: true, blind: false, note: null, reason: null };
  });
}

function eligibleStrategies(level) {
  return strategyAvailability(level)
    .filter(function (a) { return a.eligible; })
    .map(function (a) { return a.id; });
}

/* ---------- the map ---------- */

function isTeleportGlyph(ch) { return ch >= '0' && ch <= '9'; }
function isWaypointGlyph(ch) { return ch >= 'A' && ch <= 'F'; }

function parseGrid(ascii) {
  var rows = ascii.replace(/^\n+|\n+$/g, '').split('\n');
  var cells = rows.map(function (row) { return row.split(''); });
  var w = 0;
  cells.forEach(function (row) { w = Math.max(w, row.length); });
  cells.forEach(function (row) {
    while (row.length < w) { row.push('#'); }
  });

  var starts = [];
  var goals = [];
  var waypointsByLetter = {};
  var padsByGlyph = {};

  for (var y = 0; y < cells.length; y++) {
    for (var x = 0; x < w; x++) {
      var ch = cells[y][x];
      if (ch === 'S') { starts.push({ x: x, y: y }); }
      if (ch === 'G') { goals.push({ x: x, y: y }); }
      if (isWaypointGlyph(ch)) { waypointsByLetter[ch] = { x: x, y: y }; }
      if (isTeleportGlyph(ch)) {
        if (!padsByGlyph[ch]) { padsByGlyph[ch] = []; }
        padsByGlyph[ch].push(y * w + x);
      }
    }
  }

  // Teleporters: cells sharing a digit are linked both ways, one move apart.
  var teleports = {};
  Object.keys(padsByGlyph).forEach(function (glyph) {
    var group = padsByGlyph[glyph];
    group.forEach(function (i) {
      teleports[i] = group.filter(function (j) { return j !== i; });
    });
  });

  var waypoints = Object.keys(waypointsByLetter).sort().map(function (k) {
    return { letter: k, x: waypointsByLetter[k].x, y: waypointsByLetter[k].y };
  });

  return {
    w: w,
    h: cells.length,
    cells: cells,
    start: starts[0] || null, // kept for every single-start caller
    starts: starts,
    goal: goals[0] || null,   // kept for every single-goal caller
    goals: goals,
    waypoints: waypoints,
    teleports: teleports
  };
}

function cellCost(grid, x, y) {
  var c = TERRAIN_COST[grid.cells[y][x]];
  return c === undefined ? 1 : c;   // teleport pads and waypoints are plain ground
}

function isWall(grid, x, y) {
  return grid.cells[y][x] === '#';
}

function indexOf(grid, p) { return p.y * grid.w + p.x; }
function pointOf(grid, i) {
  var x = i % grid.w;
  return { x: x, y: (i - x) / grid.w, i: i };
}

function isChute(grid, i) {
  var p = pointOf(grid, i);
  return grid.cells[p.y][p.x] === 'v';
}

/* A refund chute is one-way: you drop in from directly above and come out
 * directly below. That is what keeps a negative tile from turning into a
 * two-cell loop you could ride forever, which is the only reason the map can
 * carry negative cost at all. */
function canMove(grid, fromI, toI) {
  var a = pointOf(grid, fromI);
  var b = pointOf(grid, toI);
  if (isWall(grid, b.x, b.y)) { return false; }
  var teleport = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1;
  if (teleport) { return true; }              // pad to pad, already validated
  if (isChute(grid, fromI) && !(b.x === a.x && b.y === a.y + 1)) { return false; }
  if (isChute(grid, toI) && !(b.x === a.x && b.y === a.y + 1)) { return false; }
  return true;
}

/* Every cell one move away: the four neighbours, plus the twin pad of a
 * teleporter. A teleport is one move and costs whatever the far pad costs (1).
 * backward = true walks the edges the other way, which is what the backward
 * half of bidirectional search and the flow field need. */
function neighborsOf(grid, i, reverseOrder, backward) {
  var p = pointOf(grid, i);
  var out = [];
  for (var m = 0; m < MOVES.length; m++) {
    var move = reverseOrder ? MOVES[MOVES.length - 1 - m] : MOVES[m];
    var nx = p.x + move[0];
    var ny = p.y + move[1];
    if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) { continue; }
    if (isWall(grid, nx, ny)) { continue; }
    var ni = ny * grid.w + nx;
    if (backward ? !canMove(grid, ni, i) : !canMove(grid, i, ni)) { continue; }
    out.push(ni);
  }
  var pads = grid.teleports && grid.teleports[i];
  if (pads) {
    for (var k = 0; k < pads.length; k++) { out.push(pads[k]); }
  }
  return out;
}

/* ---------- the frontier ---------- */

// The priority a strategy sorts its frontier by. This one function, plus the
// queue/stack cases in takeNext, is the whole difference between the algorithms.
function priorityOf(strategy, g, h, weight) {
  if (strategy === 'greedy') { return h; }
  if (strategy === 'astar' || strategy === 'beam') { return g + h; }
  if (strategy === 'wastar') { return g + weight * h; }
  return g;  // bfs, dfs (unused), dijkstra
}

function usesHeuristicTieBreak(strategy) {
  return strategy === 'astar' || strategy === 'wastar' ||
    strategy === 'greedy' || strategy === 'beam';
}

// Beam search: anything outside the best k cells is thrown away for good.
function capFrontier(frontier, k) {
  if (!k || frontier.length <= k) { return frontier; }
  frontier.sort(function (a, b) { return a.f - b.f || a.h - b.h; });
  frontier.length = k;
  return frontier;
}

function takeNext(frontier, strategy) {
  if (strategy === 'bfs') { return frontier.shift(); }
  if (strategy === 'dfs') { return frontier.pop(); }

  var tieBreak = usesHeuristicTieBreak(strategy);
  var bestAt = 0;
  for (var i = 1; i < frontier.length; i++) {
    // Ties on f go to the node closer to the goal: that is what turns the
    // blob into a teardrop instead of a diamond.
    var better = frontier[i].f < frontier[bestAt].f ||
      (tieBreak && frontier[i].f === frontier[bestAt].f && frontier[i].h < frontier[bestAt].h);
    if (better) { bestAt = i; }
  }
  return frontier.splice(bestAt, 1)[0];
}

/* ---------- one search, one expansion at a time ---------- */

/* The loop below is the engine. A run is a state you can hold, step, swap the
 * strategy of, and read a trace off; search() is that state driven to the end.
 * Hot swap works because every strategy in this family shares one state: the
 * visited set, the costs and the parents all survive the swap, and only the
 * order the frontier comes out in changes.
 *
 * params (all optional):
 *   weight       - the w of weighted A*
 *   k            - the beam width
 *   from         - {x,y} override for the start (legs use this)
 *   to           - {x,y} override for the single goal
 *   targets      - [{x,y}, ...]; the run stops at whichever is reached first
 *   hideGoal     - the goal position is unknown, so h is 0 everywhere
 *   fog          - only cells next to somewhere visited are visible, and h
 *                  stays 0 until the goal is actually revealed
 *   swapPenalty  - expansions charged per hot swap (carried, never hidden
 *                  inside `expansions`)
 */
function createSearch(grid, strategy, params) {
  params = withDefaults(strategy, params);
  var size = grid.w * grid.h;
  var from = params.from || grid.start;
  var targets = resolveTargets(grid, params);
  var startI = indexOf(grid, from);

  var state = {
    grid: grid,
    strategy: strategy,
    params: params,
    weight: params.weight === undefined ? 1 : params.weight,
    from: from,
    targets: targets,
    isTarget: targetFlags(grid, targets),
    startI: startI,
    bestG: new Array(size).fill(Infinity),
    parent: new Array(size).fill(-1),
    closed: new Array(size).fill(false),
    discovered: new Array(size).fill(false),
    frontier: [],
    seq: 0,
    steps: [],
    expansions: 0,
    peakFrontier: 1,
    found: false,
    reachedI: -1,
    done: false,
    fog: !!params.fog,
    visible: params.fog ? new Array(size).fill(false) : null,
    goalRevealed: !params.fog,
    swaps: [],
    swapPenalty: params.swapPenalty === undefined ? 5 : params.swapPenalty
  };

  state.bestG[startI] = 0;
  state.discovered[startI] = true;
  // What the unit can see before it has taken a single step.
  state.initialRevealed = state.fog ? revealAround(state, startI) : [];

  var startH = heuristicAt(state, from.x, from.y);
  state.frontier.push({
    i: startI, x: from.x, y: from.y, g: 0, h: startH,
    f: priorityOf(strategy, 0, startH, state.weight),
    seq: state.seq++
  });
  return state;
}

function heuristicAt(state, x, y) {
  if (state.params.hideGoal) { return 0; }
  if (state.fog && !state.goalRevealed) { return 0; }  // nothing to aim at yet
  var best = Infinity;
  for (var t = 0; t < state.targets.length; t++) {
    var d = Math.abs(x - state.targets[t].x) + Math.abs(y - state.targets[t].y);
    if (d < best) { best = d; }
  }
  return best === Infinity ? 0 : best;
}

// Fog: a cell is visible once it has been stood on or stood next to.
function revealAround(state, i) {
  var newly = [];
  var cells = [i].concat(neighborsOf(state.grid, i, false));
  for (var k = 0; k < cells.length; k++) {
    if (state.visible[cells[k]]) { continue; }
    state.visible[cells[k]] = true;
    newly.push(cells[k]);
    if (state.isTarget[cells[k]] && !state.goalRevealed) {
      state.goalRevealed = true;
      rescoreFrontier(state);       // the guess just became available
    }
  }
  return newly;
}

// Recompute h and f for everything already waiting. Called when the goal comes
// out of the fog, and after a hot swap.
function rescoreFrontier(state) {
  for (var k = 0; k < state.frontier.length; k++) {
    var n = state.frontier[k];
    n.h = heuristicAt(state, n.x, n.y);
    n.f = priorityOf(state.strategy, n.g, n.h, state.weight);
  }
}

/* Hot swap. Everything learned so far is kept - visited cells, costs, parents -
 * and only the order the frontier hands cells back changes: FIFO for a queue,
 * LIFO for a stack, re-sorted by the new key for a priority rule. */
function switchStrategy(state, newStrategy, newParams) {
  var info = strategyInfo(newStrategy);
  if (!info || info.hotSwappable === false) { return false; }

  var merged = withDefaults(newStrategy, null);
  ['from', 'to', 'targets', 'hideGoal', 'fog', 'swapPenalty'].forEach(function (k) {
    if (state.params[k] !== undefined) { merged[k] = state.params[k]; }
  });
  if (newParams) {
    Object.keys(newParams).forEach(function (k) { merged[k] = newParams[k]; });
  }

  var from = state.strategy;
  state.strategy = newStrategy;
  state.params = merged;
  state.weight = merged.weight === undefined ? 1 : merged.weight;
  rescoreFrontier(state);

  // Insertion order is what a queue and a stack disagree about; sorting by it
  // puts the oldest first, which is exactly what shift() and pop() then want.
  state.frontier.sort(function (a, b) { return a.seq - b.seq; });
  if (newStrategy !== 'bfs' && newStrategy !== 'dfs') {
    var tieBreak = usesHeuristicTieBreak(newStrategy);
    state.frontier.sort(function (a, b) {
      return a.f - b.f || (tieBreak ? a.h - b.h : 0) || a.seq - b.seq;
    });
  }
  if (newStrategy === 'beam') { capFrontier(state.frontier, merged.k); }

  state.swaps.push({
    atStep: state.steps.length,
    from: from,
    to: newStrategy,
    params: merged
  });
  return true;
}

// One expansion. Returns the step it recorded, or null when the run is over.
function stepSearch(state) {
  var grid = state.grid;
  while (state.frontier.length > 0) {
    var node = takeNext(state.frontier, state.strategy);
    if (state.closed[node.i]) { continue; }  // stale duplicate, not a real expansion
    state.closed[node.i] = true;
    state.expansions++;

    var revealed = state.fog ? revealAround(state, node.i) : null;

    if (state.isTarget[node.i]) {
      state.found = true;
      state.reachedI = node.i;
      state.done = true;
      return pushStep(state, node, revealed);
    }

    // DFS pops from the back, so push in reverse to keep the same preference order.
    var nbrs = neighborsOf(grid, node.i, state.strategy === 'dfs');
    for (var m = 0; m < nbrs.length; m++) {
      var ni = nbrs[m];
      if (state.closed[ni]) { continue; }
      var np = pointOf(grid, ni);
      var g2 = node.g + cellCost(grid, np.x, np.y);

      if (state.strategy === 'bfs' || state.strategy === 'dfs') {
        if (state.discovered[ni]) { continue; }
      } else if (g2 >= state.bestG[ni]) {
        continue;
      }
      state.discovered[ni] = true;

      state.bestG[ni] = g2;
      state.parent[ni] = node.i;
      var nh = heuristicAt(state, np.x, np.y);
      state.frontier.push({
        i: ni, x: np.x, y: np.y, g: g2, h: nh,
        f: priorityOf(state.strategy, g2, nh, state.weight),
        seq: state.seq++
      });
    }

    if (state.strategy === 'beam') { capFrontier(state.frontier, state.params.k); }
    if (state.frontier.length > state.peakFrontier) { state.peakFrontier = state.frontier.length; }
    return pushStep(state, node, revealed);
  }
  state.done = true;
  return null;
}

function pushStep(state, node, revealed) {
  var seen = {};
  var cells = [];
  for (var k = 0; k < state.frontier.length; k++) {
    var fi = state.frontier[k].i;
    if (!seen[fi]) { seen[fi] = true; cells.push(fi); }
  }
  var step = {
    x: node.x,
    y: node.y,
    i: node.i,
    frontierSize: state.frontier.length,
    frontierCells: cells
  };
  if (state.fog) {
    step.revealedCells = revealed || [];
    step.blind = !state.goalRevealed;
  }
  if (state.swaps.length > 0) { step.strategyNow = state.strategy; }
  state.steps.push(step);
  return step;
}

// Drive a state to the end and read the trace off it.
function runSearch(state) {
  while (!state.done) { stepSearch(state); }
  return traceOf(state);
}

function traceOf(state) {
  var grid = state.grid;
  var path = [];
  if (state.found) {
    var cur = state.reachedI;
    while (cur !== -1) {
      path.push(pointOf(grid, cur));
      cur = state.parent[cur];
    }
    path.reverse();
  }

  var trace = {
    strategy: state.strategy,
    params: state.params,
    steps: state.steps,
    path: path,
    expansions: state.expansions,
    peakFrontier: state.peakFrontier,
    found: state.found,
    from: { x: state.from.x, y: state.from.y },
    to: state.found ? pointOf(grid, state.reachedI) : (state.targets[0] || null),
    targets: state.targets
  };
  if (state.swaps.length > 0) {
    trace.swaps = state.swaps;
    trace.swapCount = state.swaps.length;
    trace.swapPenalty = state.swapPenalty;
    trace.penaltyExpansions = state.swaps.length * state.swapPenalty;
    trace.chargedExpansions = state.expansions + trace.penaltyExpansions;
  }
  if (state.fog) {
    trace.fog = true;
    trace.goalRevealed = state.goalRevealed;
    trace.initialRevealed = state.initialRevealed;
  }
  return finishTrace(grid, trace);
}

function search(grid, strategy, params) {
  params = withDefaults(strategy, params);
  if (strategy === 'bibfs') { return bidirectionalSearch(grid, params); }
  if (strategy === 'iddfs') { return iterativeDeepeningSearch(grid, params); }
  if (strategy === 'bellman') { return bellmanFordSearch(grid, params); }
  if (strategy === 'flow') { return flowFieldSearch(grid, params); }
  if (strategy === 'wall') { return wallFollowerSearch(grid, params); }
  return runSearch(createSearch(grid, strategy, params));
}

function resolveTargets(grid, params) {
  if (params.targets && params.targets.length) { return params.targets; }
  if (params.to) { return [params.to]; }
  if (grid.goals && grid.goals.length) { return grid.goals; }
  return grid.goal ? [grid.goal] : [];
}

// pathSteps / pathCost are derived from the path the same way everywhere.
function finishTrace(grid, trace) {
  var cost = 0;
  for (var p = 1; p < trace.path.length; p++) {
    cost += cellCost(grid, trace.path[p].x, trace.path[p].y);
  }
  trace.pathSteps = trace.found ? trace.path.length - 1 : Infinity;
  trace.pathCost = trace.found ? cost : Infinity;
  return trace;
}

/* ---------- bidirectional BFS ---------- */

/* Two BFS waves, one from the start and one from the goal. Each step of the
 * trace says which side it came from, and carries both frontiers separately,
 * so the UI can paint them in two colours. */
function bidirectionalSearch(grid, params) {
  var w = grid.w;
  var size = w * grid.h;
  var from = params.from || grid.start;
  var targets = resolveTargets(grid, params);
  var to = params.to || targets[0];
  var startI = indexOf(grid, from);
  var goalI = indexOf(grid, to);

  var side = [
    { q: [startI], dist: new Array(size).fill(-1), parent: new Array(size).fill(-1), closed: new Array(size).fill(false), name: 'forward' },
    { q: [goalI], dist: new Array(size).fill(-1), parent: new Array(size).fill(-1), closed: new Array(size).fill(false), name: 'backward' }
  ];
  side[0].dist[startI] = 0;
  side[1].dist[goalI] = 0;

  var steps = [];
  var expansions = 0;
  var peakFrontier = 2;
  var bestMeet = Infinity;
  var meetI = -1;

  while (side[0].q.length > 0 && side[1].q.length > 0) {
    // Standard termination: once the two wave fronts can no longer combine
    // into anything shorter than what we have, the meeting point is final.
    if (bestMeet <= side[0].dist[side[0].q[0]] + side[1].dist[side[1].q[0]]) { break; }

    var s = side[0].q.length <= side[1].q.length ? 0 : 1;
    var other = 1 - s;
    var cur = side[s].q.shift();
    if (side[s].closed[cur]) { continue; }
    side[s].closed[cur] = true;
    expansions++;

    var nbrs = neighborsOf(grid, cur, false, s === 1);
    for (var k = 0; k < nbrs.length; k++) {
      var ni = nbrs[k];
      if (side[s].dist[ni] === -1) {
        side[s].dist[ni] = side[s].dist[cur] + 1;
        side[s].parent[ni] = cur;
        side[s].q.push(ni);
      }
      if (side[other].dist[ni] !== -1) {
        var total = side[s].dist[ni] + side[other].dist[ni];
        if (total < bestMeet) { bestMeet = total; meetI = ni; }
      }
    }

    var total2 = side[0].q.length + side[1].q.length;
    if (total2 > peakFrontier) { peakFrontier = total2; }
    steps.push(bidiStep(grid, cur, side, side[s].name));
  }

  var path = [];
  if (meetI !== -1) {
    var f = meetI;
    while (f !== -1) { path.push(pointOf(grid, f)); f = side[0].parent[f]; }
    path.reverse();
    var b = side[1].parent[meetI];
    while (b !== -1) { path.push(pointOf(grid, b)); b = side[1].parent[b]; }
  }

  return finishTrace(grid, {
    strategy: 'bibfs',
    params: params,
    steps: steps,
    path: path,
    expansions: expansions,
    peakFrontier: peakFrontier,
    found: meetI !== -1,
    bidirectional: true,
    meetingPoint: meetI === -1 ? null : pointOf(grid, meetI),
    from: { x: from.x, y: from.y },
    to: { x: to.x, y: to.y },
    targets: [to]
  });
}

function bidiStep(grid, cur, side, name) {
  var p = pointOf(grid, cur);
  var fwd = uniq(side[0].q);
  var back = uniq(side[1].q);
  return {
    x: p.x,
    y: p.y,
    i: cur,
    side: name,
    frontierSize: fwd.length + back.length,
    frontierCells: fwd.concat(back),
    frontierForward: fwd,
    frontierBackward: back
  };
}

function uniq(list) {
  var seen = {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    if (!seen[list[i]]) { seen[list[i]] = true; out.push(list[i]); }
  }
  return out;
}

// Playback holds one entry per step, so a strategy that re-walks the map has
// to stop recording somewhere. The counters stay honest past this point.
var MAX_TRACE_STEPS = 20000;

function targetFlags(grid, targets) {
  var set = new Array(grid.w * grid.h).fill(false);
  targets.forEach(function (t) { set[indexOf(grid, t)] = true; });
  return set;
}

/* ---------- iterative deepening DFS ---------- */

/* DFS to depth 0, then to depth 1, then to depth 2... The shallow cells get
 * walked again every pass, which is the price; in exchange it answers like BFS
 * while holding a DFS-sized stack.
 * Each pass stamps the depth a cell was reached at, so a pass stays linear
 * instead of walking every route of that length. The frontier is counted the
 * same way DFS counts it: the branches pushed and not yet taken. */
function iterativeDeepeningSearch(grid, params) {
  var size = grid.w * grid.h;
  var from = params.from || grid.start;
  var targets = resolveTargets(grid, params);
  var isTarget = targetFlags(grid, targets);
  var startI = indexOf(grid, from);
  var maxDepth = params.maxDepth === undefined ? size : params.maxDepth;
  // Re-walking the shallow cells every pass is the trade, but on a big map it
  // is also genuinely hopeless, so the search is allowed to give up.
  var expansionCap = params.expansionCap === undefined ? 50000 : params.expansionCap;

  var steps = [];
  var expansions = 0;
  var peakFrontier = 1;
  var passes = 0;
  var path = [];
  var found = false;

  for (var limit = 0; limit <= maxDepth && !found; limit++) {
    passes++;
    var parent = new Array(size).fill(-1);
    var depthAt = new Array(size).fill(Infinity);
    var stack = [{ i: startI, d: 0 }];
    var cutoff = false;
    depthAt[startI] = 0;

    while (stack.length > 0) {
      var node = stack.pop();
      if (depthAt[node.i] < node.d) { continue; }   // a later pass found it shallower
      expansions++;
      var p = pointOf(grid, node.i);
      if (steps.length < MAX_TRACE_STEPS) {
        steps.push({
          x: p.x, y: p.y, i: node.i,
          pass: limit,
          frontierSize: stack.length,
          frontierCells: uniq(stack.map(function (n) { return n.i; }))
        });
      }
      if (stack.length > peakFrontier) { peakFrontier = stack.length; }

      if (isTarget[node.i]) {
        found = true;
        var cur = node.i;
        while (cur !== -1) { path.push(pointOf(grid, cur)); cur = parent[cur]; }
        path.reverse();
        break;
      }
      if (node.d >= limit) { cutoff = true; continue; }

      var nbrs = neighborsOf(grid, node.i, true);   // reversed: pop order matches DFS
      for (var k = 0; k < nbrs.length; k++) {
        var ni = nbrs[k];
        if (node.d + 1 >= depthAt[ni]) { continue; }
        depthAt[ni] = node.d + 1;
        parent[ni] = node.i;
        stack.push({ i: ni, d: node.d + 1 });
      }
    }

    if (!found && !cutoff) { break; }               // the whole map fits inside the limit
    if (expansions > expansionCap) { break; }
  }

  return finishTrace(grid, {
    strategy: 'iddfs',
    params: params,
    steps: steps,
    path: found ? path : [],
    expansions: expansions,
    peakFrontier: peakFrontier,
    found: found,
    passes: passes,
    gaveUp: !found && expansions > expansionCap,
    truncatedSteps: steps.length >= MAX_TRACE_STEPS,
    from: { x: from.x, y: from.y },
    to: found ? path[path.length - 1] : (targets[0] || null),
    targets: targets
  });
}

/* ---------- Bellman-Ford ---------- */

/* No priority queue and no closed set: just relax every edge out of every cell
 * that changed in the pass before, over and over, until nothing improves.
 * That is what lets a refund chute rewrite a route the greedy algorithms had
 * already declared finished. Each step carries its `pass` number. */
function bellmanFordSearch(grid, params) {
  var size = grid.w * grid.h;
  var from = params.from || grid.start;
  var targets = resolveTargets(grid, params);
  var isTarget = targetFlags(grid, targets);
  var startI = indexOf(grid, from);

  var dist = new Array(size).fill(Infinity);
  var parent = new Array(size).fill(-1);
  dist[startI] = 0;

  var steps = [];
  var expansions = 0;
  var peakFrontier = 1;
  var pass = 0;
  var negativeCycle = false;
  var current = [startI];

  while (current.length > 0) {
    pass++;
    if (pass > size) { negativeCycle = true; break; }
    var next = [];
    var queued = {};
    for (var idx = 0; idx < current.length; idx++) {
      var u = current[idx];
      expansions++;
      var nbrs = neighborsOf(grid, u, false);
      for (var k = 0; k < nbrs.length; k++) {
        var v = nbrs[k];
        var vp = pointOf(grid, v);
        var nd = dist[u] + cellCost(grid, vp.x, vp.y);
        if (nd < dist[v]) {
          dist[v] = nd;
          parent[v] = u;
          if (!queued[v]) { queued[v] = true; next.push(v); }
        }
      }
      var pending = uniq(current.slice(idx + 1).concat(next));
      if (pending.length > peakFrontier) { peakFrontier = pending.length; }
      var up = pointOf(grid, u);
      if (steps.length < MAX_TRACE_STEPS) {
        steps.push({
          x: up.x, y: up.y, i: u,
          pass: pass,
          frontierSize: pending.length,
          frontierCells: pending
        });
      }
    }
    current = next;
  }

  var bestI = -1;
  targets.forEach(function (t) {
    var ti = indexOf(grid, t);
    if (dist[ti] < Infinity && (bestI === -1 || dist[ti] < dist[bestI])) { bestI = ti; }
  });

  var path = [];
  if (bestI !== -1) {
    var guard = new Array(size).fill(false);
    var cur = bestI;
    while (cur !== -1 && !guard[cur]) {
      guard[cur] = true;
      path.push(pointOf(grid, cur));
      cur = parent[cur];
    }
    path.reverse();
  }

  return finishTrace(grid, {
    strategy: 'bellman',
    params: params,
    steps: steps,
    path: path,
    expansions: expansions,
    peakFrontier: peakFrontier,
    found: bestI !== -1 && isTarget[bestI],
    passes: pass,
    negativeCycle: negativeCycle,
    from: { x: from.x, y: from.y },
    to: bestI === -1 ? (targets[0] || null) : pointOf(grid, bestI),
    targets: targets
  });
}

/* ---------- flow field ---------- */

/* One Dijkstra outward from every goal at once, walking the edges backward.
 * What it leaves behind is a cost-to-goal for every cell on the map, so any
 * number of units can read their next move straight off the field. */
function flowFieldSearch(grid, params) {
  var size = grid.w * grid.h;
  var from = params.from || grid.start;
  var targets = resolveTargets(grid, params);
  var startI = indexOf(grid, from);

  var dist = new Array(size).fill(Infinity);
  var closed = new Array(size).fill(false);
  var frontier = [];
  targets.forEach(function (t) {
    var ti = indexOf(grid, t);
    dist[ti] = 0;
    frontier.push({ i: ti, g: 0, h: 0, f: 0 });
  });

  var steps = [];
  var expansions = 0;
  var peakFrontier = Math.max(1, frontier.length);

  while (frontier.length > 0) {
    var bestAt = 0;
    for (var i = 1; i < frontier.length; i++) {
      if (frontier[i].f < frontier[bestAt].f) { bestAt = i; }
    }
    var node = frontier.splice(bestAt, 1)[0];
    if (closed[node.i]) { continue; }
    closed[node.i] = true;
    expansions++;

    var np = pointOf(grid, node.i);
    var stepCost = cellCost(grid, np.x, np.y);
    var preds = neighborsOf(grid, node.i, false, true);
    for (var k = 0; k < preds.length; k++) {
      var pi = preds[k];
      if (closed[pi]) { continue; }
      var nd = dist[node.i] + stepCost;
      if (nd >= dist[pi]) { continue; }
      dist[pi] = nd;
      frontier.push({ i: pi, g: nd, h: 0, f: nd });
    }

    if (frontier.length > peakFrontier) { peakFrontier = frontier.length; }
    steps.push({
      x: np.x, y: np.y, i: node.i,
      field: dist[node.i],
      frontierSize: frontier.length,
      frontierCells: uniq(frontier.map(function (n) { return n.i; }))
    });
  }

  var path = walkField(grid, dist, startI);
  var found = !!path;

  return finishTrace(grid, {
    strategy: 'flow',
    params: params,
    steps: steps,
    path: path || [],
    expansions: expansions,
    peakFrontier: peakFrontier,
    found: found,
    gaveUp: !found && dist[startI] < Infinity,
    field: dist,
    from: { x: from.x, y: from.y },
    to: found ? path[path.length - 1] : (targets[0] || null),
    targets: targets
  });
}

/* Read a route off a finished field: from here, always step to the neighbour
 * that leaves the least still to pay. Returns null if the field never bottoms
 * out - which is exactly what a refund chute does to it. */
function walkField(grid, dist, startI) {
  var size = grid.w * grid.h;
  if (!dist || dist[startI] === Infinity) { return null; }
  var path = [pointOf(grid, startI)];
  var cur = startI;
  var walked = 0;
  var seen = new Array(size).fill(false);
  seen[cur] = true;
  while (dist[cur] !== 0 && walked < size) {
    var succ = neighborsOf(grid, cur, false);
    var bestNext = -1;
    var bestVal = Infinity;
    for (var s = 0; s < succ.length; s++) {
      if (seen[succ[s]]) { continue; }
      var sp = pointOf(grid, succ[s]);
      var val = dist[succ[s]] + cellCost(grid, sp.x, sp.y);
      if (val < bestVal) { bestVal = val; bestNext = succ[s]; }
    }
    if (bestNext === -1) { return null; }
    cur = bestNext;
    seen[cur] = true;
    path.push(pointOf(grid, cur));
    walked++;
  }
  return dist[cur] === 0 ? path : null;
}

/* ---------- wall follower ---------- */

/* One hand on the left-hand wall, and that is the entire algorithm: no
 * frontier, no visited set, nothing to run out of. In a maze whose walls are
 * all connected it must reach the exit. In an open room it circles until the
 * step cap stops it. Teleport pads mean nothing to a walker feeling its way. */
function wallFollowerSearch(grid, params) {
  var from = params.from || grid.start;
  var targets = resolveTargets(grid, params);
  var isTarget = targetFlags(grid, targets);
  var startI = indexOf(grid, from);
  var maxSteps = params.maxSteps === undefined ? 900 : params.maxSteps;

  var steps = [];
  var path = [pointOf(grid, startI)];
  var cur = startI;
  var facing = 0;
  var expansions = 0;
  var found = isTarget[startI];

  function ahead(i, dir) {
    var p = pointOf(grid, i);
    var nx = p.x + MOVES[dir][0];
    var ny = p.y + MOVES[dir][1];
    if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) { return -1; }
    if (isWall(grid, nx, ny)) { return -1; }
    var ni = ny * grid.w + nx;
    return canMove(grid, i, ni) ? ni : -1;
  }

  while (!found && expansions < maxSteps) {
    // left, straight, right, back - in that order, every single time.
    var order = [(facing + 3) % 4, facing, (facing + 1) % 4, (facing + 2) % 4];
    var moved = false;
    for (var k = 0; k < order.length; k++) {
      var ni = ahead(cur, order[k]);
      if (ni === -1) { continue; }
      facing = order[k];
      cur = ni;
      moved = true;
      break;
    }
    if (!moved) { break; }   // sealed in on all four sides

    expansions++;
    var p = pointOf(grid, cur);
    path.push(p);
    steps.push({
      x: p.x, y: p.y, i: cur,
      facing: facing,
      frontierSize: 1,
      frontierCells: [cur]
    });
    if (isTarget[cur]) { found = true; }
  }

  return finishTrace(grid, {
    strategy: 'wall',
    params: params,
    steps: steps,
    path: found ? path : [],
    expansions: expansions,
    peakFrontier: 1,
    found: found,
    gaveUp: !found,
    from: { x: from.x, y: from.y },
    to: found ? path[path.length - 1] : (targets[0] || null),
    targets: targets
  });
}

/* ---------- missions: several legs, one trace ---------- */

/* searchMission(grid, plan, options) -> trace
 *
 * plan is a strategy id, or an array (one entry per leg) of ids or
 * {strategy, params} objects; a short array repeats its last entry.
 *
 * options.objective decides what the legs are:
 *   'collect'  - visit every G on the map, nearest first
 *   'nearest'  - reach whichever G is closest
 *   anything else, with waypoints A..F on the map - S -> A -> B -> ... -> G
 *   anything else, no waypoints - one leg, S -> G
 *
 * The returned trace has the same shape as a single search (so render.js and
 * the budget bars need no special case) plus a `legs` array.
 */
function searchMission(grid, plan, options) {
  options = options || {};
  var objective = options.objective;
  var hideGoal = objective === 'unknown' || options.goalKnown === false;
  var goals = (grid.goals && grid.goals.length) ? grid.goals : (grid.goal ? [grid.goal] : []);
  var starts = (grid.starts && grid.starts.length) ? grid.starts : (grid.start ? [grid.start] : []);
  var legs = [];

  if (objective === 'dispatch' && starts.length > 0) {
    legs = dispatchLegs(grid, plan, starts, goals, hideGoal);
  } else if (objective === 'collect' && goals.length > 0) {
    legs = collectLegs(grid, plan, goals, hideGoal);
  } else if (objective === 'nearest' && goals.length > 1) {
    legs = [runLeg(grid, planAt(plan, 0), { from: grid.start, targets: goals, hideGoal: hideGoal })];
  } else if (grid.waypoints && grid.waypoints.length > 0) {
    var stops = [grid.start].concat(grid.waypoints).concat([goals[0]]);
    for (var i = 0; i + 1 < stops.length; i++) {
      legs.push(runLeg(grid, planAt(plan, i), { from: stops[i], to: stops[i + 1], hideGoal: hideGoal }));
    }
  } else {
    legs = [runLeg(grid, planAt(plan, 0), { from: grid.start, to: goals[0], hideGoal: hideGoal })];
  }

  return mergeLegs(grid, legs, objective);
}

/* What the level is scored against: the fewest steps there are, and the least
 * cost there is. BFS settles steps. Cost has to come from Bellman-Ford, not
 * Dijkstra, because a map with refund chutes is exactly the map Dijkstra gets
 * wrong - scoring against a wrong answer would mark the right one as failed. */
function referenceFor(grid, level) {
  level = level || {};
  var opts = { objective: level.objective, goalKnown: level.goalKnown };
  var steps = searchMission(grid, 'bfs', opts);
  var cost = searchMission(grid, 'bellman', opts);
  return {
    bestSteps: steps.pathSteps,
    bestCost: cost.pathCost,
    reachable: steps.found
  };
}

// Convenience for callers holding a level object rather than a grid.
function searchLevel(level, plan, params) {
  var grid = parseGrid(level.map);
  return searchMission(grid, plan, {
    objective: level.objective,
    goalKnown: level.goalKnown,
    params: params
  });
}

function planAt(plan, i) {
  var entry = plan;
  if (Array.isArray(plan)) { entry = plan[Math.min(i, plan.length - 1)]; }
  if (typeof entry === 'string') { return { strategy: entry, params: {} }; }
  return { strategy: entry.strategy, params: entry.params || {} };
}

function runLeg(grid, spec, opts) {
  var params = {};
  Object.keys(spec.params).forEach(function (k) { params[k] = spec.params[k]; });
  Object.keys(opts).forEach(function (k) { if (opts[k] !== undefined) { params[k] = opts[k]; } });

  var info = strategyInfo(spec.strategy);
  var targets = params.targets;

  // A strategy that aims at one goal cannot watch several at once: it has to
  // be re-run per goal and pay for every run. That is the whole lesson of the
  // multi-goal levels, so the wasted probes stay in the trace.
  if (targets && targets.length > 1 && info && !info.supportsMultiTarget) {
    return probePerGoal(grid, spec, params, targets);
  }
  return search(grid, spec.strategy, params);
}

function probePerGoal(grid, spec, params, targets) {
  var probes = targets.map(function (t) {
    var p = {};
    Object.keys(params).forEach(function (k) { p[k] = params[k]; });
    p.targets = null;
    p.to = t;
    var trace = search(grid, spec.strategy, p);
    trace.probe = true;
    return trace;
  });

  var winner = null;
  probes.forEach(function (t) {
    if (!t.found) { return; }
    if (!winner || t.pathCost < winner.pathCost) { winner = t; }
  });
  probes.forEach(function (t) { t.discarded = t !== winner; });

  var merged = mergeLegs(grid, probes, null);
  merged.strategy = spec.strategy;
  merged.path = winner ? winner.path : [];
  merged.found = !!winner;
  merged.probesRun = probes.length;
  return finishTrace(grid, merged);
}

// Glue several traces into one: steps concatenated, expansions summed, peak
// frontier the highest any leg reached, path the legs walked end to end.
function mergeLegs(grid, legs, objective) {
  var steps = [];
  var path = [];
  var expansions = 0;
  var peakFrontier = 0;
  var found = true;
  var summaries = [];

  legs.forEach(function (leg, li) {
    var stepStart = steps.length;
    leg.steps.forEach(function (st) {
      var copy = {};
      Object.keys(st).forEach(function (k) { copy[k] = st[k]; });
      copy.leg = li;
      steps.push(copy);
    });
    expansions += leg.expansions;
    if (leg.peakFrontier > peakFrontier) { peakFrontier = leg.peakFrontier; }
    if (!leg.found) { found = false; }
    if (!leg.discarded) {
      for (var p = (path.length === 0 ? 0 : 1); p < leg.path.length; p++) { path.push(leg.path[p]); }
    }
    summaries.push({
      leg: li,
      strategy: leg.strategy,
      params: leg.params,
      from: leg.from,
      to: leg.to,
      found: leg.found,
      probe: !!leg.probe,
      probesRun: leg.probesRun || (leg.probe ? 1 : 0),
      discarded: !!leg.discarded,
      pathSteps: leg.pathSteps,
      pathCost: leg.pathCost,
      expansions: leg.expansions,
      peakFrontier: leg.peakFrontier,
      stepStart: stepStart,
      stepEnd: steps.length
    });
  });

  var probesRun = summaries.reduce(function (n, sum) { return n + (sum.probesRun || 0); }, 0);

  if (legs.length === 1 && !legs[0].probe) {
    var only = legs[0];
    only.legs = summaries;
    only.objective = objective || only.objective;
    if (probesRun) { only.probesRun = probesRun; }
    return only;
  }

  return finishTrace(grid, {
    strategy: legs.length ? legs[0].strategy : null,
    params: legs.length ? legs[0].params : {},
    objective: objective,
    steps: steps,
    path: path,
    expansions: expansions,
    peakFrontier: peakFrontier,
    found: found && legs.length > 0,
    legs: summaries,
    probesRun: probesRun,
    from: legs.length ? legs[0].from : null,
    to: legs.length ? legs[legs.length - 1].to : null
  });
}

/* 'dispatch': every unit on the map has to reach a goal. One search per unit
 * for everybody else - but the flow field builds its distance field once and
 * every extra unit reads its route straight off it for nothing. That is the
 * only place the field's price actually buys something. */
function dispatchLegs(grid, plan, starts, goals, hideGoal) {
  var first = planAt(plan, 0);
  if (first.strategy === 'flow' && !hideGoal) {
    var base = search(grid, 'flow', { from: starts[0], targets: goals });
    var legs = [base];
    for (var u = 1; u < starts.length; u++) {
      var walk = walkField(grid, base.field, indexOf(grid, starts[u]));
      legs.push(finishTrace(grid, {
        strategy: 'flow',
        params: base.params,
        steps: [],
        path: walk || [],
        expansions: 0,          // the field was already paid for
        peakFrontier: 0,
        found: !!walk,
        reusedField: true,
        from: { x: starts[u].x, y: starts[u].y },
        to: walk ? walk[walk.length - 1] : null,
        targets: goals
      }));
    }
    return legs;
  }
  return starts.map(function (s, u) {
    return runLeg(grid, planAt(plan, u), { from: s, targets: goals, hideGoal: hideGoal });
  });
}

// 'collect all': go to the nearest goal the chosen strategy can find, then on
// to the nearest of the rest, until every G has been stood on.
function collectLegs(grid, plan, goals, hideGoal) {
  var remaining = goals.slice();
  var at = grid.start;
  var legs = [];
  var n = 0;
  while (remaining.length > 0) {
    var leg = runLeg(grid, planAt(plan, n), { from: at, targets: remaining, hideGoal: hideGoal });
    legs.push(leg);
    if (!leg.found) { break; }
    var reached = leg.path[leg.path.length - 1];
    remaining = remaining.filter(function (g) { return !(g.x === reached.x && g.y === reached.y); });
    at = { x: reached.x, y: reached.y };
    n++;
    if (n > goals.length) { break; }  // belt and braces
  }
  return legs;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STRATEGIES: STRATEGIES,
    STRATEGY_BY_ID: STRATEGY_BY_ID,
    strategyInfo: strategyInfo,
    defaultParams: defaultParams,
    strategyAvailability: strategyAvailability,
    eligibleStrategies: eligibleStrategies,
    search: search,
    createSearch: createSearch,
    stepSearch: stepSearch,
    switchStrategy: switchStrategy,
    runSearch: runSearch,
    traceOf: traceOf,
    searchMission: searchMission,
    searchLevel: searchLevel,
    referenceFor: referenceFor,
    walkField: walkField,
    parseGrid: parseGrid,
    neighborsOf: neighborsOf,
    cellCost: cellCost,
    isWall: isWall,
    TERRAIN_COST: TERRAIN_COST
  };
}
