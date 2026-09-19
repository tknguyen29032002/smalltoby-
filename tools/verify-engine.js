/* tools/verify-engine.js - checks the promises README.md's "Engine contract"
 * makes: the registry is complete, the trace carries what the UI reads, and
 * the mechanics (teleports, refund chutes, fog, hot swap, legs, dispatch) do
 * what they claim. Run with: node tools/verify-engine.js
 */
var path = require('path');
var s = require(path.join(__dirname, '..', 'search.js'));
var levels = require(path.join(__dirname, '..', 'levels.js'));
var starsFor = require(path.join(__dirname, 'verify-levels.js')).starsFor;

var failures = 0;
var checks = 0;

function ok(label, cond, detail) {
  checks++;
  if (!cond) { failures++; }
  console.log('  ' + (cond ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   [' + detail + ']' : ''));
}

function section(name) { console.log('\n' + name); }

function levelNamed(name) {
  return levels.ALL_LEVELS.filter(function (l) { return l.name === name; })[0];
}

/* ---------- registry ---------- */

section('Registry');
var REQUIRED = ['id', 'label', 'description', 'frontierRule', 'needsHeuristic',
  'guaranteesOptimal', 'params', 'wins', 'fails', 'hotSwappable',
  'needsGoalPosition', 'supportsMultiTarget'];
var ids = {};
s.STRATEGIES.forEach(function (st) {
  var missing = REQUIRED.filter(function (f) { return st[f] === undefined; });
  ok('every field present on ' + st.id, missing.length === 0, missing.join(','));
  ok(st.id + ' has a unique id', !ids[st.id]);
  ids[st.id] = true;
  st.params.forEach(function (p) {
    ok(st.id + ' param ' + p.name + ' has a default', p['default'] !== undefined);
  });
});
['bfs', 'dfs', 'dijkstra', 'astar'].forEach(function (id) {
  ok('original id ' + id + ' is still registered', !!s.strategyInfo(id));
});
ok('weighted A* exposes its weight', s.defaultParams('wastar').weight !== undefined);
ok('beam exposes its width', s.defaultParams('beam').k !== undefined);

/* ---------- trace shape ---------- */

section('Trace shape');
var grid1 = s.parseGrid(levels.LEVELS[0].map);
var TRACE_FIELDS = ['strategy', 'steps', 'path', 'pathSteps', 'pathCost',
  'expansions', 'peakFrontier', 'found'];
s.STRATEGIES.forEach(function (st) {
  var t = s.search(grid1, st.id);
  var missing = TRACE_FIELDS.filter(function (f) { return t[f] === undefined; });
  ok('trace from ' + st.id + ' carries every documented field', missing.length === 0, missing.join(','));
  var badStep = t.steps.filter(function (step) {
    return step.x === undefined || step.y === undefined || step.i === undefined ||
      step.frontierSize === undefined || !Array.isArray(step.frontierCells);
  });
  ok('every step from ' + st.id + ' carries x, y, i, frontierSize, frontierCells', badStep.length === 0);
});

/* ---------- weighted A* ---------- */

section('Weighted A*: w = 0 is Dijkstra, w = 1 is A*');
var grid4 = s.parseGrid(levels.LEVELS[3].map);
var w0 = s.search(grid4, 'wastar', { weight: 0 });
var w1 = s.search(grid4, 'wastar', { weight: 1 });
var w5 = s.search(grid4, 'wastar', { weight: 5 });
var dij = s.search(grid4, 'dijkstra');
var ast = s.search(grid4, 'astar');
ok('w = 0 matches Dijkstra', w0.pathCost === dij.pathCost && w0.expansions === dij.expansions,
  'w0 ' + w0.expansions + ' vs dijkstra ' + dij.expansions);
ok('w = 1 matches A*', w1.pathCost === ast.pathCost && w1.expansions === ast.expansions,
  'w1 ' + w1.expansions + ' vs astar ' + ast.expansions);
ok('a bigger w never expands more than Dijkstra', w5.expansions <= w0.expansions,
  'w5 ' + w5.expansions);

/* ---------- greedy ---------- */

section('Greedy orders by h alone');
var grid3 = s.parseGrid(levels.LEVELS[2].map);
var greedy = s.search(grid3, 'greedy');
ok('reaches the goal cheaply in expansions', greedy.found && greedy.expansions < s.search(grid3, 'dijkstra').expansions);
ok('and pays for it in route cost', greedy.pathCost > s.search(grid3, 'dijkstra').pathCost,
  greedy.pathCost + ' vs ' + s.search(grid3, 'dijkstra').pathCost);

/* ---------- bidirectional ---------- */

section('Bidirectional BFS');
var bi = s.search(grid4, 'bibfs');
var bfs4 = s.search(grid4, 'bfs');
ok('finds a fewest-steps route', bi.pathSteps === bfs4.pathSteps, bi.pathSteps + ' vs ' + bfs4.pathSteps);
ok('costs fewer expansions than one-sided BFS', bi.expansions < bfs4.expansions,
  bi.expansions + ' vs ' + bfs4.expansions);
ok('reports a meeting point', !!bi.meetingPoint);
var sides = {};
bi.steps.forEach(function (st) { sides[st.side] = (sides[st.side] || 0) + 1; });
ok('every step says which side it came from', !!sides.forward && !!sides.backward,
  JSON.stringify(sides));
ok('every step carries both frontiers separately', bi.steps.every(function (st) {
  return Array.isArray(st.frontierForward) && Array.isArray(st.frontierBackward) &&
    st.frontierForward.length + st.frontierBackward.length === st.frontierCells.length;
}));
ok('the merged path starts at the start and ends at the goal',
  bi.path[0].x === grid4.start.x && bi.path[0].y === grid4.start.y &&
  bi.path[bi.path.length - 1].x === grid4.goal.x && bi.path[bi.path.length - 1].y === grid4.goal.y);

/* ---------- teleports ---------- */

section('Teleport pads (level 6)');
var lvl6 = levels.LEVELS[5];
var grid6 = s.parseGrid(lvl6.map);
ok('pads are parsed as pairs', Object.keys(grid6.teleports).length === 2);
var padIds = Object.keys(grid6.teleports).map(Number);
ok('the pads are one move apart', s.neighborsOf(grid6, padIds[0], false).indexOf(padIds[1]) !== -1);
var d6 = s.search(grid6, 'dijkstra');
var a6 = s.search(grid6, 'astar');
ok('Dijkstra takes the teleport and wins', d6.pathCost < a6.pathCost, d6.pathCost + ' vs ' + a6.pathCost);
ok('A* is beaten by its own guess, not by the budget', a6.expansions < lvl6.budgets.expansions);
ok('turning the guess off (w = 0) rescues weighted A*',
  s.search(grid6, 'wastar', { weight: 0 }).pathCost === d6.pathCost);

/* ---------- refund chutes ---------- */

section('Refund chutes');
var refund = levelNamed('The refund run');
var gridR = s.parseGrid(refund.map);
var bell = s.search(gridR, 'bellman');
var dijR = s.search(gridR, 'dijkstra');
ok('Bellman-Ford finds the refunded route', bell.pathCost < dijR.pathCost,
  bell.pathCost + ' vs ' + dijR.pathCost);
ok('it never reports a negative cycle', bell.negativeCycle !== true);
ok('the chute is one-way: nothing comes back up it', (function () {
  var chute = -1;
  for (var i = 0; i < gridR.w * gridR.h; i++) {
    if (gridR.cells[Math.floor(i / gridR.w)][i % gridR.w] === 'v') { chute = i; break; }
  }
  var below = chute + gridR.w;
  return s.neighborsOf(gridR, below, false).indexOf(chute) === -1 &&
    s.neighborsOf(gridR, chute, false).length === 1;
})());
ok('the relaxation trace is grouped into passes',
  bell.passes > 1 && bell.steps.every(function (st) { return st.pass >= 1; }), 'passes ' + bell.passes);

/* ---------- flow field ---------- */

section('Flow field and dispatch');
var vans = levelNamed('Six vans, one depot');
var gridV = s.parseGrid(vans.map);
ok('all six units are parsed', gridV.starts.length === 6);
var flowRun = s.searchMission(gridV, 'flow', { objective: 'dispatch' });
var dijRun = s.searchMission(gridV, 'dijkstra', { objective: 'dispatch' });
ok('one field serves every unit', flowRun.expansions < dijRun.expansions / 2,
  flowRun.expansions + ' vs ' + dijRun.expansions);
ok('the extra units cost nothing', flowRun.legs.slice(1).every(function (l) { return l.expansions === 0; }));
ok('every unit still gets a route', flowRun.found && flowRun.legs.length === 6);
ok('the field is exposed for the UI to draw', Array.isArray(s.search(gridV, 'flow').field));

/* ---------- multi-goal ---------- */

section('Multi-goal');
var depots = levelNamed('The scattered depots');
var gridD = s.parseGrid(depots.map);
ok('all six goals are parsed', gridD.goals.length === 6);
var dijC = s.searchMission(gridD, 'dijkstra', { objective: 'collect' });
var astC = s.searchMission(gridD, 'astar', { objective: 'collect' });
ok('one search watches every goal at once', dijC.legs.length === 6);
ok('a single-target search has to re-run per goal', astC.probesRun > dijC.legs.length,
  astC.probesRun + ' probes against ' + dijC.legs.length + ' searches');
ok('and that costs it', astC.expansions > dijC.expansions * 3,
  astC.expansions + ' vs ' + dijC.expansions);
ok('both still collect every depot', dijC.found && astC.found && dijC.pathCost === astC.pathCost);
var nearest = s.searchMission(gridD, 'dijkstra', { objective: 'nearest' });
ok('nearest-goal stops at the first one reached', nearest.found && nearest.pathCost < dijC.pathCost);

/* ---------- legs ---------- */

section('Legs');
var relay = levelNamed('The relay');
var gridL = s.parseGrid(relay.map);
var refsL = s.referenceFor(gridL, relay);
ok('the waypoint is parsed', gridL.waypoints.length === 1 && gridL.waypoints[0].letter === 'A');
var mixed = s.searchMission(gridL, relay.bestPlan, { objective: 'cheapest' });
var uniformD = s.searchMission(gridL, 'dijkstra', { objective: 'cheapest' });
var uniformA = s.searchMission(gridL, 'astar', { objective: 'cheapest' });
ok('a leg each gets two legs', mixed.legs.length === 2);
ok('the legs are summed into one trace',
  mixed.expansions === mixed.legs[0].expansions + mixed.legs[1].expansions);
ok('the steps of both legs are concatenated and tagged',
  mixed.steps.length === mixed.legs[1].stepEnd && mixed.steps[mixed.steps.length - 1].leg === 1);
ok('the path runs start -> waypoint -> goal',
  mixed.path[0].x === 6 && mixed.path[mixed.path.length - 1].x === gridL.goal.x);
ok('the right courier per leg is the only three-star plan',
  starsFor(relay, mixed, refsL) === 3 &&
  starsFor(relay, uniformD, refsL) === 1 &&
  starsFor(relay, uniformA, refsL) === 0);

/* ---------- fog ---------- */

section('Fog');
var fogLevel = levelNamed('Into the fog');
var gridF = s.parseGrid(fogLevel.map);
var fogA = s.search(gridF, 'astar', { fog: true });
var clearA = s.search(gridF, 'astar');
ok('the goal does not leak into the heuristic', fogA.expansions > clearA.expansions * 3,
  fogA.expansions + ' vs ' + clearA.expansions);
ok('the first expansions are marked blind', fogA.steps[0].blind === true);
ok('the goal is revealed before the run ends', fogA.goalRevealed === true);
ok('what is visible at the start is reported', Array.isArray(fogA.initialRevealed) && fogA.initialRevealed.length > 0);
ok('each step reports what it revealed', fogA.steps.every(function (st) { return Array.isArray(st.revealedCells); }));
ok('the registry flags a heuristic strategy as blind here',
  s.strategyAvailability(fogLevel).filter(function (a) { return a.id === 'astar'; })[0].blind === true);

/* ---------- hot swap ---------- */

section('Hot swap');
var stepwise = s.createSearch(grid4, 'astar');
while (!stepwise.done) { s.stepSearch(stepwise); }
ok('stepping by hand equals search()',
  JSON.stringify(s.traceOf(stepwise).steps) === JSON.stringify(s.search(grid4, 'astar').steps));

var half = s.createSearch(grid4, 'greedy');
for (var i = 0; i < 20; i++) { s.stepSearch(half); }
var visitedBefore = half.closed.filter(Boolean).length;
var frontierBefore = half.frontier.length;
ok('a swap is accepted for a loop strategy', s.switchStrategy(half, 'dijkstra') === true);
ok('it keeps everything already visited', half.closed.filter(Boolean).length === visitedBefore);
ok('it keeps the frontier, only re-ordered', half.frontier.length === frontierBefore);
ok('the frontier is re-sorted under the new rule', (function () {
  for (var k = 1; k < half.frontier.length; k++) {
    if (half.frontier[k].f < half.frontier[k - 1].f) { return false; }
  }
  return true;
})());
ok('a swap onto a strategy with its own shape is refused', s.switchStrategy(half, 'bellman') === false);
var swapped = s.runSearch(half);
ok('the swap is carried in the trace', swapped.swapCount === 1 && swapped.swaps[0].to === 'dijkstra');
ok('the penalty is carried, not hidden in expansions',
  swapped.chargedExpansions === swapped.expansions + swapped.swapPenalty);
ok('swapping to Dijkstra fixes what greedy would have returned',
  swapped.pathCost === s.search(grid4, 'dijkstra').pathCost &&
  swapped.pathCost < s.search(grid4, 'greedy').pathCost);

section('Hot swap under fog: the level Into the fog is built on');
var scout = s.createSearch(gridF, 'dfs', { fog: true, swapPenalty: fogLevel.swapPenalty });
var didSwap = false;
while (!scout.done) {
  s.stepSearch(scout);
  if (!didSwap && scout.goalRevealed && !scout.done) { s.switchStrategy(scout, 'astar'); didSwap = true; }
}
var scoutTrace = s.traceOf(scout);
var refsF = s.referenceFor(gridF, fogLevel);
ok('scout blind, then swap, and the route is optimal', scoutTrace.pathCost === refsF.bestCost,
  scoutTrace.pathCost + ' vs ' + refsF.bestCost);
ok('that play earns three stars', starsFor(fogLevel, scoutTrace, refsF) === 3,
  'charged ' + scoutTrace.chargedExpansions);
['bfs', 'dfs', 'dijkstra', 'astar', 'beam'].forEach(function (id) {
  var pure = s.search(gridF, id, { fog: true });
  ok('no single strategy three-stars it on its own: ' + id, starsFor(fogLevel, pure, refsF) < 3,
    'cost ' + pure.pathCost + ', ' + pure.expansions + ' expansions');
});

/* ---------- availability ---------- */

section('Eligibility');
var dark = levelNamed('Lights out');
var avail = {};
s.strategyAvailability(dark).forEach(function (a) { avail[a.id] = a; });
['astar', 'greedy', 'wastar', 'beam'].forEach(function (id) {
  ok(id + ' is ineligible with the goal hidden', avail[id].eligible === false && !!avail[id].reason);
});
['bibfs', 'flow'].forEach(function (id) {
  ok(id + ' is ineligible when it cannot start from the goal', avail[id].eligible === false);
});
['bfs', 'dfs', 'dijkstra', 'iddfs', 'bellman', 'wall'].forEach(function (id) {
  ok(id + ' is still playable in the dark', avail[id].eligible === true);
});
ok('eligibleStrategies() agrees', s.eligibleStrategies(dark).indexOf('astar') === -1 &&
  s.eligibleStrategies(dark).indexOf('iddfs') !== -1);

console.log('\n' + checks + ' checks, ' +
  (failures === 0 ? 'ALL GOOD' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
