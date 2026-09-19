/* tools/verify-levels.js - checks that each level scores the way the README says.
 * Run with: node tools/verify-levels.js
 */
var path = require('path');
var s = require(path.join(__dirname, '..', 'search.js'));
var LEVELS = require(path.join(__dirname, '..', 'levels.js')).LEVELS;

var ALGOS = ['bfs', 'dfs', 'dijkstra', 'astar'];

// What the README promises for each level: algo -> expected stars.
var EXPECTED = [
  { bfs: 3, dfs: 3, dijkstra: 3, astar: 3 },
  { bfs: 3, dfs: 0, dijkstra: 3, astar: 3 },
  { bfs: 0, dfs: 0, dijkstra: 3, astar: 3 },
  { bfs: null, dfs: null, dijkstra: 1, astar: 3 },
  { bfs: 1, dfs: 3, dijkstra: null, astar: null }
];

function score(level, trace, refs) {
  var met = trace.found;
  if (met && level.objective === 'shortest') { met = trace.pathSteps === refs.bestSteps; }
  if (met && level.objective === 'cheapest') { met = trace.pathCost === refs.bestCost; }
  if (!met) { return 0; }
  var b = level.budgets || {};
  var withinBudget = (b.expansions === undefined || trace.expansions <= b.expansions) &&
    (b.frontier === undefined || trace.peakFrontier <= b.frontier);
  return withinBudget ? 3 : 1;
}

var failures = 0;
LEVELS.forEach(function (level, li) {
  var grid = s.parseGrid(level.map);
  var traces = {};
  ALGOS.forEach(function (a) { traces[a] = s.search(grid, a); });
  var refs = { bestSteps: traces.bfs.pathSteps, bestCost: traces.dijkstra.pathCost };

  console.log('\nLevel ' + (li + 1) + ' - ' + level.name +
    '  [' + level.objective + ', budgets ' + JSON.stringify(level.budgets) + ']  ' +
    grid.w + 'x' + grid.h);
  console.log('  algo      steps  cost  expansions  peakFrontier  stars');
  ALGOS.forEach(function (a) {
    var t = traces[a];
    var stars = score(level, t, refs);
    var want = EXPECTED[li][a];
    var flag = (want === null || want === stars) ? '' : '   <-- EXPECTED ' + want;
    if (flag) { failures++; }
    console.log('  ' + a.padEnd(9) +
      String(t.pathSteps).padStart(5) +
      String(t.pathCost).padStart(6) +
      String(t.expansions).padStart(12) +
      String(t.peakFrontier).padStart(14) +
      String(stars).padStart(7) + flag);
  });
});

console.log('\n' + (failures === 0 ? 'ALL LEVELS MATCH THE DESIGN' : failures + ' MISMATCH(ES)'));
process.exit(failures === 0 ? 0 : 1);
