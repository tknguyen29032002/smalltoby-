/* search.js - one search() for all four strategies.
 *
 * The four algorithms are the same loop with a different frontier:
 *   bfs      - array as queue (take from the front)
 *   dfs      - array as stack (take from the back)
 *   dijkstra - take the lowest g (cost so far)
 *   astar    - take the lowest g + h (Manhattan)
 *
 * The whole run is precomputed into a trace; playback only steps an index.
 */

var TERRAIN_COST = { '.': 1, '~': 5, 'S': 1, 'G': 1 };

// 4-direction moves, in the order they are considered: right, down, left, up.
var MOVES = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1]
];

function parseGrid(ascii) {
  var rows = ascii.replace(/^\n+|\n+$/g, '').split('\n');
  var cells = rows.map(function (row) { return row.split(''); });
  var w = 0;
  cells.forEach(function (row) { w = Math.max(w, row.length); });
  cells.forEach(function (row) {
    while (row.length < w) { row.push('#'); }
  });

  var start = null;
  var goal = null;
  for (var y = 0; y < cells.length; y++) {
    for (var x = 0; x < w; x++) {
      if (cells[y][x] === 'S') { start = { x: x, y: y }; }
      if (cells[y][x] === 'G') { goal = { x: x, y: y }; }
    }
  }
  return { w: w, h: cells.length, cells: cells, start: start, goal: goal };
}

function cellCost(grid, x, y) {
  var c = TERRAIN_COST[grid.cells[y][x]];
  return c === undefined ? 1 : c;
}

function isWall(grid, x, y) {
  return grid.cells[y][x] === '#';
}

// Pull the next node out of the frontier. This single function is the only
// difference between the four algorithms.
function takeNext(frontier, strategy) {
  if (strategy === 'bfs') { return frontier.shift(); }
  if (strategy === 'dfs') { return frontier.pop(); }

  var bestAt = 0;
  for (var i = 1; i < frontier.length; i++) {
    var better;
    if (strategy === 'astar') {
      // Ties on f go to the node closer to the goal: that is what turns the
      // blob into a teardrop instead of a diamond.
      better = frontier[i].f < frontier[bestAt].f ||
        (frontier[i].f === frontier[bestAt].f && frontier[i].h < frontier[bestAt].h);
    } else {
      better = frontier[i].g < frontier[bestAt].g;
    }
    if (better) { bestAt = i; }
  }
  return frontier.splice(bestAt, 1)[0];
}

function search(grid, strategy) {
  var w = grid.w;
  var h = grid.h;
  var size = w * h;
  var startI = grid.start.y * w + grid.start.x;
  var goalI = grid.goal.y * w + grid.goal.x;

  function heuristic(x, y) {
    return Math.abs(x - grid.goal.x) + Math.abs(y - grid.goal.y);
  }

  var bestG = new Array(size).fill(Infinity);
  var parent = new Array(size).fill(-1);
  var closed = new Array(size).fill(false);
  var discovered = new Array(size).fill(false); // bfs/dfs: push each cell once

  bestG[startI] = 0;
  discovered[startI] = true;

  var startH = heuristic(grid.start.x, grid.start.y);
  var frontier = [{ i: startI, x: grid.start.x, y: grid.start.y, g: 0, h: startH, f: startH }];

  var steps = [];
  var peakFrontier = 1;
  var expansions = 0;
  var found = false;

  while (frontier.length > 0) {
    var node = takeNext(frontier, strategy);
    if (closed[node.i]) { continue; } // stale duplicate, not a real expansion
    closed[node.i] = true;
    expansions++;

    if (node.i === goalI) {
      found = true;
      steps.push(makeStep(node, frontier));
      break;
    }

    for (var m = 0; m < MOVES.length; m++) {
      // DFS pops from the back, so push in reverse to keep the same preference order.
      var move = strategy === 'dfs' ? MOVES[MOVES.length - 1 - m] : MOVES[m];
      var nx = node.x + move[0];
      var ny = node.y + move[1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) { continue; }
      if (isWall(grid, nx, ny)) { continue; }

      var ni = ny * w + nx;
      if (closed[ni]) { continue; }
      var g2 = node.g + cellCost(grid, nx, ny);

      if (strategy === 'bfs' || strategy === 'dfs') {
        if (discovered[ni]) { continue; }
        discovered[ni] = true;
      } else if (g2 >= bestG[ni]) {
        continue;
      }

      bestG[ni] = g2;
      parent[ni] = node.i;
      var nh = heuristic(nx, ny);
      frontier.push({ i: ni, x: nx, y: ny, g: g2, h: nh, f: g2 + nh });
    }

    if (frontier.length > peakFrontier) { peakFrontier = frontier.length; }
    steps.push(makeStep(node, frontier));
  }

  function makeStep(node, currentFrontier) {
    var seen = {};
    var cells = [];
    for (var k = 0; k < currentFrontier.length; k++) {
      var fi = currentFrontier[k].i;
      if (!seen[fi]) { seen[fi] = true; cells.push(fi); }
    }
    return {
      x: node.x,
      y: node.y,
      i: node.i,
      frontierSize: currentFrontier.length,
      frontierCells: cells
    };
  }

  var path = [];
  var pathCost = 0;
  if (found) {
    var cur = goalI;
    while (cur !== -1) {
      var px = cur % w;
      var py = (cur - px) / w;
      path.push({ x: px, y: py, i: cur });
      cur = parent[cur];
    }
    path.reverse();
    for (var p = 1; p < path.length; p++) {
      pathCost += cellCost(grid, path[p].x, path[p].y);
    }
  }

  return {
    strategy: strategy,
    steps: steps,
    path: path,
    pathSteps: found ? path.length - 1 : Infinity,
    pathCost: found ? pathCost : Infinity,
    expansions: expansions,
    peakFrontier: peakFrontier,
    found: found
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { search: search, parseGrid: parseGrid, cellCost: cellCost, isWall: isWall, TERRAIN_COST: TERRAIN_COST };
}
