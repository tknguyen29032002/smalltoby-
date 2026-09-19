/* tools/verify-levels.js - checks that each level scores the way it is designed to.
 *
 * A level only teaches if the algorithm it is about is the one that earns three
 * stars. The tables below are that design, written down; the run below is the
 * proof. Run with: node tools/verify-levels.js
 */
var path = require('path');
var s = require(path.join(__dirname, '..', 'search.js'));
var levels = require(path.join(__dirname, '..', 'levels.js'));

var ALL = s.STRATEGIES.map(function (x) { return x.id; });

/* Expected stars per level. Only the entries that carry the lesson are pinned;
 * a strategy left out of a row is not part of that level's design. */
var EXPECTED = [
  { bfs: 3, dfs: 3, dijkstra: 3, astar: 3 },
  { bfs: 3, dfs: 0, dijkstra: 3, astar: 3, greedy: 0, wall: 0 },
  { bfs: 0, dfs: 0, dijkstra: 3, astar: 3, greedy: 0 },
  { dijkstra: 1, astar: 3, bfs: 0, dfs: 0 },
  { bfs: 1, dfs: 3, dijkstra: 1, astar: 3 },
  // 6 - the heuristic that lies: only a search that ignores the guess is right,
  // and only Dijkstra is right inside the budget.
  { dijkstra: 3, bellman: 1, flow: 1, astar: 0, greedy: 0, wastar: 0, beam: 0, bfs: 0, dfs: 0, bibfs: 0 }
];

var EXPECTED_EXTRA = [
  // The refund run - only the two searches that keep relaxing survive a
  // negative tile (the flow field gets there by running backward from the goal).
  { bellman: 3, flow: 3, dijkstra: 0, astar: 0, bfs: 0, greedy: 0, beam: 0, bibfs: 0, wastar: 0 },
  // Lights out - hidden goal plus a memory cap.
  { iddfs: 3, bfs: 1, dijkstra: 1, bellman: 1, dfs: 0, wall: 0 },
  // The scattered depots - one search watches every goal; A* pays per goal.
  { bfs: 3, dijkstra: 3, astar: 1, greedy: 1, wastar: 1, beam: 1, dfs: 0, wall: 0 },
  // Six vans, one depot - the field is built once and read six times. In a
  // perfect maze there is only one route, so even DFS returns it; it just
  // cannot do it six times inside the budget.
  { flow: 3, bfs: 1, dijkstra: 1, astar: 1, bellman: 1, dfs: 1, wall: 0 },
  // Hands on the wall - the only one that fits in no memory at all.
  { wall: 3, bfs: 1, dfs: 1, dijkstra: 1, astar: 1, iddfs: 1 },
  // The relay - no single strategy is right for both legs (see PLANS below).
  { dijkstra: 1, astar: 0, bfs: 0, bellman: 1 },
  // Into the fog - scored by the UI's swap rules; the engine only guarantees
  // that the guess is unavailable until the goal is revealed (verify-engine.js).
  {}
];

/* Levels whose lesson is a mix of strategies, one per leg. */
var PLANS = [
  {
    level: 'The relay',
    cases: [
      { plan: ['dijkstra', 'astar'], stars: 3 },
      { plan: ['dijkstra', 'dijkstra'], stars: 1 },
      { plan: ['astar', 'astar'], stars: 0 }
    ]
  }
];

function starsFor(level, trace, refs) {
  var met = trace.found;
  if (met && level.objective === 'shortest') { met = trace.pathSteps === refs.bestSteps; }
  if (met && (level.objective === 'cheapest' || level.objective === 'collect' ||
    level.objective === 'dispatch' || level.objective === 'nearest')) {
    met = trace.pathCost === refs.bestCost;
  }
  if (!met) { return 0; }
  var b = level.budgets || {};
  // A hot swap costs the player expansions, so the budget is charged against
  // chargedExpansions whenever the run swapped at all.
  var spent = trace.chargedExpansions === undefined ? trace.expansions : trace.chargedExpansions;
  var withinBudget = (b.expansions === undefined || spent <= b.expansions) &&
    (b.frontier === undefined || trace.peakFrontier <= b.frontier);
  return withinBudget ? 3 : 1;
}

module.exports.starsFor = starsFor;

function runLevel(level, expected, label) {
  var grid = s.parseGrid(level.map);
  var refs = s.referenceFor(grid, level);
  var avail = {};
  s.strategyAvailability(level).forEach(function (a) { avail[a.id] = a; });

  console.log('\n' + label + ' - ' + level.name +
    '  [' + level.objective + ', budgets ' + JSON.stringify(level.budgets || {}) + ']  ' +
    grid.w + 'x' + grid.h +
    (grid.goals.length > 1 ? '  goals ' + grid.goals.length : '') +
    (grid.starts.length > 1 ? '  starts ' + grid.starts.length : '') +
    (level.fog ? '  fog' : ''));
  console.log('  best: ' + refs.bestSteps + ' steps, cost ' + refs.bestCost);
  console.log('  algo       steps   cost  expansions  frontier  stars');

  var failures = 0;
  ALL.forEach(function (a) {
    if (!avail[a].eligible) {
      if (expected[a] !== undefined) {
        console.log('  ' + a.padEnd(10) + ' ineligible   <-- EXPECTED ' + expected[a]);
        failures++;
      }
      return;
    }
    var trace = s.searchMission(grid, a, { objective: level.objective, goalKnown: level.goalKnown });
    var stars = starsFor(level, trace, refs);
    var want = expected[a];
    var flag = (want === undefined || want === stars) ? '' : '   <-- EXPECTED ' + want;
    if (flag) { failures++; }
    console.log('  ' + a.padEnd(10) +
      String(trace.pathSteps).padStart(6) +
      String(trace.pathCost).padStart(7) +
      String(trace.expansions).padStart(12) +
      String(trace.peakFrontier).padStart(10) +
      String(stars).padStart(7) + flag);
  });
  return failures;
}

function runPlans(failuresIn) {
  var failures = failuresIn;
  PLANS.forEach(function (spec) {
    var level = levels.ALL_LEVELS.filter(function (l) { return l.name === spec.level; })[0];
    if (!level) { console.log('\nPLAN CHECK: no level named ' + spec.level); failures++; return; }
    var grid = s.parseGrid(level.map);
    var refs = s.referenceFor(grid, level);
    console.log('\nPlans - ' + level.name);
    spec.cases.forEach(function (c) {
      var trace = s.searchMission(grid, c.plan, { objective: level.objective, goalKnown: level.goalKnown });
      var stars = starsFor(level, trace, refs);
      var flag = stars === c.stars ? '' : '   <-- EXPECTED ' + c.stars;
      if (flag) { failures++; }
      console.log('  ' + ('[' + c.plan.join(' then ') + ']').padEnd(28) +
        'cost ' + String(trace.pathCost).padStart(4) +
        '  expansions ' + String(trace.expansions).padStart(5) +
        '  frontier ' + String(trace.peakFrontier).padStart(3) +
        '  stars ' + stars + flag);
    });
  });
  return failures;
}

if (require.main === module) {
  var failures = 0;
  levels.LEVELS.forEach(function (level, i) {
    failures += runLevel(level, EXPECTED[i] || {}, 'Level ' + (i + 1));
  });
  levels.EXTRA_LEVELS.forEach(function (level, i) {
    failures += runLevel(level, EXPECTED_EXTRA[i] || {}, 'Extra ' + (i + 1) + ' (needs ' + level.needs + ')');
  });
  failures = runPlans(failures);

  console.log('\n' + (failures === 0 ? 'ALL LEVELS MATCH THE DESIGN' : failures + ' MISMATCH(ES)'));
  process.exit(failures === 0 ? 0 : 1);
}
