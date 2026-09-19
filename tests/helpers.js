/* tests/helpers.js - shared plumbing for the QA suite.
 *
 * Two jobs:
 *   1. discover which strategy ids search.js actually offers (registry if one
 *      exists, the original four otherwise), so the suite keeps covering new
 *      algorithms as other lanes add them;
 *   2. provide reference implementations - a plain BFS for fewest steps and a
 *      plain Dijkstra for lowest cost - written here, independently of
 *      search.js, so "optimal" is not graded by the code under test.
 */

var path = require('path');
var fs = require('fs');

var ROOT = path.join(__dirname, '..');
var searchModule = require(path.join(ROOT, 'search.js'));

var BASE_IDS = ['bfs', 'dfs', 'dijkstra', 'astar'];

/* ---------- strategy discovery ---------- */

// A registry may appear as an array of ids, an array of objects with an id, or
// an object keyed by id. Accept all three, from search.js or a sibling module.
function idsFromRegistry(reg) {
  if (!reg) { return null; }
  if (Array.isArray(reg)) {
    var ids = reg.map(function (entry) {
      if (typeof entry === 'string') { return entry; }
      if (entry && typeof entry === 'object') { return entry.id || entry.key || entry.strategy; }
      return null;
    }).filter(Boolean);
    return ids.length ? ids : null;
  }
  if (typeof reg === 'object') {
    var keys = Object.keys(reg);
    return keys.length ? keys : null;
  }
  return null;
}

function sidecarRegistry() {
  var names = ['strategies.js', 'algorithms.js', 'registry.js'];
  for (var i = 0; i < names.length; i++) {
    var file = path.join(ROOT, names[i]);
    if (!fs.existsSync(file)) { continue; }
    var mod = require(file);
    var candidates = [mod.STRATEGIES, mod.STRATEGY_REGISTRY, mod.REGISTRY, mod.ALGOS, mod.ALGORITHMS, mod];
    for (var c = 0; c < candidates.length; c++) {
      var ids = idsFromRegistry(candidates[c]);
      if (ids) { return ids; }
    }
  }
  return null;
}

function discoverStrategyIds() {
  var m = searchModule;
  var candidates = [m.STRATEGIES, m.STRATEGY_REGISTRY, m.REGISTRY, m.ALGOS, m.ALGORITHMS, m.strategies];
  for (var i = 0; i < candidates.length; i++) {
    var ids = idsFromRegistry(candidates[i]);
    if (ids) { return dedupe(ids); }
  }
  var side = sidecarRegistry();
  if (side) { return dedupe(side); }
  return BASE_IDS.slice();
}

function dedupe(list) {
  var seen = {};
  return list.filter(function (id) {
    if (seen[id]) { return false; }
    seen[id] = true;
    return true;
  });
}

var STRATEGY_IDS = discoverStrategyIds();

// Ids the suite knows the semantics of, whatever else the registry adds.
function has(id) { return STRATEGY_IDS.indexOf(id) !== -1; }

function findId(pattern) {
  for (var i = 0; i < STRATEGY_IDS.length; i++) {
    if (pattern.test(STRATEGY_IDS[i])) { return STRATEGY_IDS[i]; }
  }
  return null;
}

// Optional strategies from the planned extensions, matched loosely because the
// lane that adds them picks the id.
var OPTIONAL = {
  greedy: findId(/greedy|best[-_]?first/i),
  bidirectional: findId(/^bi|bidir/i)
};

// Cost-optimal strategies: these must return the cheapest path on any map.
var COST_OPTIMAL = ['dijkstra', 'astar'].filter(has);
// Step-optimal strategies: these must return the fewest-steps path.
var STEP_OPTIMAL = ['bfs'].filter(has);

/* ---------- reference implementations (not search.js) ---------- */

var COST = { '.': 1, 'S': 1, 'G': 1, '~': 5, 'v': -4 };

function isPad(ch) { return ch >= '0' && ch <= '9'; }

function refGrid(ascii) {
  var rows = ascii.replace(/^\n+|\n+$/g, '').split('\n');
  var w = rows.reduce(function (acc, r) { return Math.max(acc, r.length); }, 0);
  var cells = rows.map(function (r) {
    var row = r.split('');
    while (row.length < w) { row.push('#'); }
    return row;
  });
  var start = null;
  var goal = null;
  var pads = {};
  for (var y = 0; y < cells.length; y++) {
    for (var x = 0; x < w; x++) {
      var ch = cells[y][x];
      if (ch === 'S') { start = { x: x, y: y }; }
      if (ch === 'G') { goal = { x: x, y: y }; }
      if (isPad(ch)) {
        if (!pads[ch]) { pads[ch] = []; }
        pads[ch].push([x, y]);
      }
    }
  }
  // Teleport pads sharing a digit are one move apart, both ways.
  var links = {};
  Object.keys(pads).forEach(function (glyph) {
    pads[glyph].forEach(function (a) {
      links[a[1] * w + a[0]] = pads[glyph].filter(function (b) {
        return !(b[0] === a[0] && b[1] === a[1]);
      });
    });
  });
  return { w: w, h: cells.length, cells: cells, start: start, goal: goal, links: links };
}

function refCellCost(g, x, y) {
  var c = COST[g.cells[y][x]];
  return c === undefined ? 1 : c;
}

// A refund chute 'v' is entered only from directly above and left only to
// directly below: that one-way rule is what keeps a negative tile from being
// a two-cell loop, so the reference model has to honour it too.
function passable(g, fx, fy, tx, ty) {
  if (g.cells[ty][tx] === '#') { return false; }
  var downward = tx === fx && ty === fy + 1;
  if (g.cells[fy][fx] === 'v' && !downward) { return false; }
  if (g.cells[ty][tx] === 'v' && !downward) { return false; }
  return true;
}

function neighbours(g, x, y) {
  var out = [];
  var deltas = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (var i = 0; i < deltas.length; i++) {
    var nx = x + deltas[i][0];
    var ny = y + deltas[i][1];
    if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) { continue; }
    if (!passable(g, x, y, nx, ny)) { continue; }
    out.push([nx, ny]);
  }
  var linked = g.links && g.links[y * g.w + x];
  if (linked) { linked.forEach(function (p) { out.push([p[0], p[1]]); }); }
  return out;
}

// Fewest steps, by hand-rolled BFS.
function refBestSteps(ascii) {
  var g = refGrid(ascii);
  var dist = {};
  var key = function (x, y) { return y * g.w + x; };
  var queue = [[g.start.x, g.start.y]];
  dist[key(g.start.x, g.start.y)] = 0;
  while (queue.length) {
    var cur = queue.shift();
    if (cur[0] === g.goal.x && cur[1] === g.goal.y) { return dist[key(cur[0], cur[1])]; }
    var ns = neighbours(g, cur[0], cur[1]);
    for (var i = 0; i < ns.length; i++) {
      var k = key(ns[i][0], ns[i][1]);
      if (dist[k] !== undefined) { continue; }
      dist[k] = dist[key(cur[0], cur[1])] + 1;
      queue.push(ns[i]);
    }
  }
  return Infinity;
}

// Lowest terrain cost, by hand-rolled Bellman-Ford: relax every edge out of
// every cell that changed in the pass before, until nothing improves. Dijkstra
// would be simpler but it is wrong on a map with refund chutes, and that is
// exactly a map this reference has to grade.
function refBestCost(ascii) {
  var g = refGrid(ascii);
  var key = function (x, y) { return y * g.w + x; };
  var size = g.w * g.h;
  var best = {};
  best[key(g.start.x, g.start.y)] = 0;
  var current = [[g.start.x, g.start.y]];
  var passes = 0;
  while (current.length && passes <= size) {
    passes++;
    var next = [];
    var queued = {};
    for (var i = 0; i < current.length; i++) {
      var cur = current[i];
      var ck = key(cur[0], cur[1]);
      var ns = neighbours(g, cur[0], cur[1]);
      for (var n = 0; n < ns.length; n++) {
        var nk = key(ns[n][0], ns[n][1]);
        var cand = best[ck] + refCellCost(g, ns[n][0], ns[n][1]);
        if (best[nk] === undefined || cand < best[nk]) {
          best[nk] = cand;
          if (!queued[nk]) { queued[nk] = true; next.push(ns[n]); }
        }
      }
    }
    current = next;
  }
  var goalKey = key(g.goal.x, g.goal.y);
  return best[goalKey] === undefined ? Infinity : best[goalKey];
}

function reachable(ascii) {
  return refBestSteps(ascii) !== Infinity;
}

/* ---------- running a strategy ---------- */

function run(ascii, strategy, opts) {
  var grid = searchModule.parseGrid(ascii);
  var trace = opts === undefined
    ? searchModule.search(grid, strategy)
    : searchModule.search(grid, strategy, opts);
  return { grid: grid, trace: trace };
}

module.exports = {
  ROOT: ROOT,
  search: searchModule,
  STRATEGY_IDS: STRATEGY_IDS,
  BASE_IDS: BASE_IDS,
  OPTIONAL: OPTIONAL,
  COST_OPTIMAL: COST_OPTIMAL,
  STEP_OPTIMAL: STEP_OPTIMAL,
  has: has,
  run: run,
  refBestSteps: refBestSteps,
  refBestCost: refBestCost,
  refCellCost: refCellCost,
  refGrid: refGrid,
  reachable: reachable
};
