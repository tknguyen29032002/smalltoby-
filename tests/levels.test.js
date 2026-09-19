/* tests/levels.test.js - the level contract.
 *
 * README.md's level table is the design: each level names an algorithm it is
 * about, and the budgets are tuned so that algorithm - and only that kind of
 * algorithm - earns three stars. This file holds the README table as data and
 * asserts the levels still behave that way, so a budget edit that quietly
 * breaks a lesson fails here instead of in front of a student.
 *
 * Levels are matched by name, not index, so the design table survives
 * reordering and insertion. Adding a level means adding a README row and an
 * entry here; both are part of shipping the level.
 *
 * Scoring mirrors game.js (objective met -> 3 stars inside budget, 1 star
 * outside it, 0 stars when the objective is missed). "Optimal" comes from the
 * reference BFS/Dijkstra in helpers.js, and the test also checks that the
 * references game.js derives from its own traces agree with them.
 */

var test = require('node:test');
var assert = require('node:assert');
var path = require('path');

var h = require('./helpers.js');
var LEVELS = require(path.join(h.ROOT, 'levels.js')).LEVELS;

var IDS = h.STRATEGY_IDS;
var MVP_LEVEL_COUNT = 5;

/* ---------- the README table, as data ----------
 * stars: what the level must award. null/absent = the README makes no promise.
 * Every entry doubles as documentation of the lesson the level teaches.
 */
var DESIGN = [
  {
    name: 'Open field',
    lesson: 'Tutorial: everything works, see the four shapes.',
    // The one level that is allowed to let everybody win: it is teaching the
    // controls and the four shapes, not a choice between algorithms.
    tutorial: true,
    stars: { bfs: 3, dfs: 3, dijkstra: 3, astar: 3 }
  },
  {
    name: 'The switchbacks',
    lesson: 'DFS returns a long path and fails. BFS and A* pass; A* with fewer expansions.',
    stars: { bfs: 3, dfs: 0, dijkstra: 3, astar: 3 },
    fewerExpansions: [['astar', 'bfs']]
  },
  {
    name: 'The swamp',
    lesson: 'BFS wades through swamp and fails. Dijkstra and A* pass.',
    stars: { bfs: 0, dfs: 0, dijkstra: 3, astar: 3 }
  },
  {
    name: 'The long haul',
    lesson: 'Dijkstra runs out of fuel. A* fits.',
    stars: { dijkstra: 1, astar: 3 },
    fewerExpansions: [['astar', 'dijkstra']]
  },
  {
    name: 'The comb',
    lesson: 'BFS holds every corridor open at once and its frontier balloons. DFS stays small and arrives.',
    stars: { bfs: 1, dfs: 3 },
    smallerFrontier: [['dfs', 'bfs']]
  },
  {
    name: 'The heuristic that lies',
    lesson: 'Teleport pads make the guess overstate the distance, so A* is confidently wrong. Dijkstra is right.',
    // Every strategy that steers by Manhattan distance walks the long way and
    // misses the objective outright; the two that keep relaxing are right but
    // cannot do it inside the fuel.
    stars: {
      dijkstra: 3,
      astar: 0, greedy: 0, wastar: 0, beam: 0,
      bfs: 0, dfs: 0, bibfs: 0, iddfs: 0, wall: 0,
      bellman: 1, flow: 1
    },
    fewerExpansions: [['astar', 'dijkstra']]
  }
];

/* ---------- scoring, as game.js does it ---------- */

function refsFor(level) {
  var steps = h.refBestSteps(level.map);
  var cost = h.refBestCost(level.map);
  return { bestSteps: steps, bestCost: cost };
}

function objectiveMet(level, trace, refs) {
  if (!trace.found) { return false; }
  if (level.objective === 'shortest') { return trace.pathSteps === refs.bestSteps; }
  if (level.objective === 'cheapest') { return trace.pathCost === refs.bestCost; }
  return true;
}

function withinBudget(level, trace) {
  var b = level.budgets || {};
  return (b.expansions === undefined || trace.expansions <= b.expansions) &&
    (b.frontier === undefined || trace.peakFrontier <= b.frontier);
}

function starsFor(level, trace, refs) {
  if (!objectiveMet(level, trace, refs)) { return 0; }
  return withinBudget(level, trace) ? 3 : 1;
}

function tracesFor(level) {
  var out = {};
  IDS.forEach(function (id) { out[id] = h.run(level.map, id).trace; });
  return out;
}

function levelByName(name) {
  return LEVELS.filter(function (l) { return l.name === name; })[0] || null;
}

/* ---------- structure every level must have ---------- */

test('every level is well formed', function () {
  assert.ok(LEVELS.length > 0, 'there are no levels');
  var names = {};
  LEVELS.forEach(function (level, i) {
    var at = 'level ' + (i + 1) + ' (' + level.name + ')';
    assert.ok(level.name && level.name.trim(), at + ': needs a name');
    assert.ok(!names[level.name], at + ': duplicate level name');
    names[level.name] = true;
    assert.ok(level.brief && level.brief.trim(), at + ': needs a brief the player can read');
    assert.ok(['shortest', 'cheapest', 'any'].indexOf(level.objective) !== -1,
      at + ': objective must be shortest, cheapest or any');

    var grid = h.run(level.map, 'bfs').grid;
    assert.ok(grid.start, at + ': no S on the map');
    assert.ok(grid.goal, at + ': no G on the map');
    assert.ok(h.reachable(level.map), at + ': the goal is not reachable');

    var b = level.budgets || {};
    assert.ok(b.expansions !== undefined || b.frontier !== undefined,
      at + ': a level with no budget cannot be lost');
    ['expansions', 'frontier'].forEach(function (k) {
      if (b[k] === undefined) { return; }
      assert.ok(Number.isInteger(b[k]) && b[k] > 0, at + ': budget ' + k + ' must be a positive integer');
    });
  });
});

test("game.js's references match an independent BFS and Dijkstra", function () {
  // game.js takes bestSteps from its own BFS trace and bestCost from its own
  // Dijkstra trace. If either is wrong, every verdict on that level is wrong.
  LEVELS.forEach(function (level) {
    var refs = refsFor(level);
    assert.equal(h.run(level.map, 'bfs').trace.pathSteps, refs.bestSteps,
      level.name + ': BFS step count is the game reference and must be optimal');
    assert.equal(h.run(level.map, 'dijkstra').trace.pathCost, refs.bestCost,
      level.name + ': Dijkstra cost is the game reference and must be optimal');
  });
});

test('every level is winnable and every non-tutorial level discriminates', function () {
  LEVELS.forEach(function (level) {
    var refs = refsFor(level);
    var traces = tracesFor(level);
    var scores = IDS.map(function (id) { return starsFor(level, traces[id], refs); });
    assert.ok(scores.indexOf(3) !== -1, level.name + ': no algorithm can earn three stars');

    var design = DESIGN.filter(function (d) { return d.name === level.name; })[0];
    if (design && design.tutorial) { return; }
    assert.ok(scores.some(function (s) { return s < 3; }),
      level.name + ': every algorithm earns three stars, so the level teaches no choice. ' +
      'Mark it tutorial: true in the DESIGN table if that is deliberate.');
  });
});

/* ---------- the README table itself ---------- */

DESIGN.forEach(function (design) {
  test('level "' + design.name + '" keeps its contract: ' + design.lesson, function () {
    var level = levelByName(design.name);
    assert.ok(level, 'no level named "' + design.name + '" - if it was renamed or ' +
      'removed, update README.md\'s level table and the DESIGN table in this file together');

    var refs = refsFor(level);
    var traces = tracesFor(level);

    Object.keys(design.stars).forEach(function (id) {
      if (!h.has(id)) { return; }
      var want = design.stars[id];
      if (want === null) { return; }
      var got = starsFor(level, traces[id], refs);
      assert.equal(got, want, design.name + ': ' + id + ' should score ' + want +
        ' stars but scored ' + got + ' (steps ' + traces[id].pathSteps +
        ', cost ' + traces[id].pathCost + ', expansions ' + traces[id].expansions +
        ', peak frontier ' + traces[id].peakFrontier +
        ', budgets ' + JSON.stringify(level.budgets) + ')');
    });

    (design.fewerExpansions || []).forEach(function (pair) {
      if (!h.has(pair[0]) || !h.has(pair[1])) { return; }
      assert.ok(traces[pair[0]].expansions < traces[pair[1]].expansions,
        design.name + ': ' + pair[0] + ' should need fewer expansions than ' + pair[1] +
        ' (' + traces[pair[0]].expansions + ' vs ' + traces[pair[1]].expansions + ')');
    });

    (design.smallerFrontier || []).forEach(function (pair) {
      if (!h.has(pair[0]) || !h.has(pair[1])) { return; }
      assert.ok(traces[pair[0]].peakFrontier < traces[pair[1]].peakFrontier,
        design.name + ': ' + pair[0] + ' should hold a smaller frontier than ' + pair[1] +
        ' (' + traces[pair[0]].peakFrontier + ' vs ' + traces[pair[1]].peakFrontier + ')');
    });
  });
});

test('every level has a row in the design table', function () {
  LEVELS.forEach(function (level) {
    var known = DESIGN.some(function (d) { return d.name === level.name; });
    assert.ok(known, 'level "' + level.name + '" has no entry in the DESIGN table here. ' +
      'A new level ships with its README row and its contract row: name the algorithm ' +
      'it is about and the stars each algorithm must score.');
  });
});

/* ---------- no algorithm may sweep the campaign ---------- */

test('no single strategy earns three stars on every level', function (t) {
  var sweepers = IDS.filter(function (id) {
    return LEVELS.every(function (level) {
      return starsFor(level, h.run(level.map, id).trace, refsFor(level)) === 3;
    });
  });

  if (LEVELS.length <= MVP_LEVEL_COUNT) {
    // The MVP five let A* sweep: every level it appears in is a level it wins.
    // The campaign lane owns the fix (a level where the heuristic lies), so
    // this is a live warning here rather than a red build on the MVP set.
    return t.skip('only the MVP ' + LEVELS.length + ' levels are present; ' +
      (sweepers.length ? 'current sweeper(s): ' + sweepers.join(', ') : 'no sweeper') +
      ' - this check goes live when new levels land');
  }

  assert.deepEqual(sweepers, [], 'these strategies earn three stars on every level: ' +
    sweepers.join(', ') + '. A campaign one algorithm always wins gives the player ' +
    'nothing to choose - add a level that punishes it.');
});
