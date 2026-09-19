/* tests/search.test.js - contract tests for search.js.
 *
 * Every strategy the registry offers is run over unweighted and weighted maps.
 * Two kinds of assertion:
 *   - trace invariants, which must hold for every strategy (the UI reads the
 *     trace for the budget bars and the compare strip, so a broken trace is a
 *     wrong verdict on screen);
 *   - per-strategy guarantees: BFS/Dijkstra/A* optimal, DFS merely arrives.
 *
 * "Optimal" is graded against the reference BFS/Dijkstra in helpers.js, not
 * against search.js itself.
 */

var test = require('node:test');
var assert = require('node:assert');

var h = require('./helpers.js');
var fixtures = require('./maps.js');

var IDS = h.STRATEGY_IDS;

test('strategy registry exposes at least the four original algorithms', function () {
  h.BASE_IDS.forEach(function (id) {
    assert.ok(IDS.indexOf(id) !== -1, 'missing strategy id: ' + id);
  });
});

/* ---------- trace invariants, every strategy, every map ---------- */

function assertTraceInvariants(map, id, res) {
  var trace = res.trace;
  var grid = res.grid;
  var label = id + ' on ' + map.name;

  assert.equal(trace.strategy, id, label + ': trace reports the strategy it was asked for');
  assert.ok(Array.isArray(trace.steps), label + ': steps is an array');

  // expansion count equals expansions.length. A strategy that re-walks the map
  // may stop recording steps once the trace would get unreasonably large, and
  // says so with truncatedSteps; the counter stays honest either way.
  if (trace.truncatedSteps) {
    assert.ok(trace.steps.length <= trace.expansions,
      label + ': a truncated trace cannot record more steps than expansions');
  } else {
    assert.equal(trace.expansions, trace.steps.length,
      label + ': expansions must equal the number of recorded steps');
  }

  // peak frontier is the max of the per-step frontier sizes.
  // frontierSize counts raw frontier entries; frontierCells is that list
  // deduped for drawing, since Dijkstra/A* can hold two entries for one cell.
  var maxSeen = 0;
  trace.steps.forEach(function (st) {
    assert.equal(typeof st.frontierSize, 'number', label + ': every step records a frontier size');
    assert.ok(st.frontierCells.length <= st.frontierSize,
      label + ': more drawn frontier cells than frontier entries');
    assert.equal(new Set(st.frontierCells).size, st.frontierCells.length,
      label + ': frontierCells must not repeat a cell');
    st.frontierCells.forEach(function (fi) {
      var fx = fi % grid.w;
      var fy = (fi - fx) / grid.w;
      assert.notEqual(grid.cells[fy][fx], '#', label + ': a wall sits on the frontier');
    });
    if (st.frontierSize > maxSeen) { maxSeen = st.frontierSize; }
  });
  assert.equal(trace.peakFrontier, Math.max(1, maxSeen),
    label + ': peakFrontier must be the max per-step frontier size');

  // Every expansion is a real walkable cell, and no cell is expanded twice -
  // unless the strategy is one that re-walks by design (iterative deepening
  // deepens a pass at a time, Bellman-Ford relaxes until nothing improves, the
  // wall follower has no visited set at all). Those declare `revisits: true`
  // and are held to the weaker promise that they never expand a wall.
  var byPass = trace.revisits === true;
  var seen = {};
  trace.steps.forEach(function (st) {
    assert.equal(st.i, st.y * grid.w + st.x, label + ': step index matches its x,y');
    if (!byPass) {
      assert.ok(!seen[st.i], label + ': cell ' + st.i + ' expanded twice');
      seen[st.i] = true;
    }
    assert.notEqual(grid.cells[st.y][st.x], '#', label + ': expanded a wall');
  });
  if (trace.steps.length > 0 && trace.steps[0].pass !== undefined) {
    assert.ok(trace.passes >= 1, label + ': a trace with passes must say how many');
  }

  if (!trace.found) {
    assert.deepEqual(trace.path, [], label + ': no path means an empty path');
    assert.equal(trace.pathCost, Infinity, label + ': no path means infinite cost');
    assert.equal(trace.pathSteps, Infinity, label + ': no path means infinite steps');
    return;
  }

  // path starts at S, ends at G
  var path = trace.path;
  assert.ok(path.length > 0, label + ': a found path is non-empty');
  assert.deepEqual({ x: path[0].x, y: path[0].y }, { x: grid.start.x, y: grid.start.y },
    label + ': path must start at S');
  assert.deepEqual({ x: path[path.length - 1].x, y: path[path.length - 1].y },
    { x: grid.goal.x, y: grid.goal.y }, label + ': path must end at G');

  // 4-connected, wall-free, and cost is the sum of entered-cell costs
  var summed = 0;
  for (var p = 1; p < path.length; p++) {
    var dx = Math.abs(path[p].x - path[p - 1].x);
    var dy = Math.abs(path[p].y - path[p - 1].y);
    assert.equal(dx + dy, 1, label + ': step ' + p + ' is not a single 4-connected move');
    assert.notEqual(grid.cells[path[p].y][path[p].x], '#', label + ': path crosses a wall');
    summed += h.refCellCost(h.refGrid(map.ascii), path[p].x, path[p].y);
  }
  assert.equal(trace.pathCost, summed, label + ': pathCost must be the sum of entered-cell costs');
  assert.equal(trace.pathSteps, path.length - 1, label + ': pathSteps must be the moves made');
}

fixtures.ALL.forEach(function (map) {
  test('trace invariants hold on ' + map.name, function () {
    IDS.forEach(function (id) {
      assertTraceInvariants(map, id, h.run(map.ascii, id));
    });
  });
});

/* ---------- reaching the goal ---------- */

fixtures.ALL.forEach(function (map) {
  test('every strategy reaches the goal on ' + map.name, function () {
    assert.ok(h.reachable(map.ascii), 'fixture sanity: goal is reachable on ' + map.name);
    IDS.forEach(function (id) {
      var trace = h.run(map.ascii, id).trace;
      assert.equal(trace.found, true, id + ' failed to reach the goal on ' + map.name);
    });
  });
});

test('DFS reaches the goal but is not required to be optimal', function () {
  fixtures.ALL.forEach(function (map) {
    var trace = h.run(map.ascii, 'dfs').trace;
    assert.equal(trace.found, true, 'dfs found no path on ' + map.name);
    assert.ok(trace.pathCost >= h.refBestCost(map.ascii),
      'dfs beat the optimal cost on ' + map.name + ', which is impossible');
  });
});

test('no strategy returns a path cheaper or shorter than optimal', function () {
  fixtures.ALL.forEach(function (map) {
    var bestCost = h.refBestCost(map.ascii);
    var bestSteps = h.refBestSteps(map.ascii);
    IDS.forEach(function (id) {
      var trace = h.run(map.ascii, id).trace;
      if (!trace.found) { return; }
      assert.ok(trace.pathCost >= bestCost, id + ' undercut the optimal cost on ' + map.name);
      assert.ok(trace.pathSteps >= bestSteps, id + ' undercut the optimal step count on ' + map.name);
    });
  });
});

/* ---------- optimality guarantees ---------- */

fixtures.ALL.forEach(function (map) {
  test('cost-optimal strategies return the cheapest path on ' + map.name, function () {
    var best = h.refBestCost(map.ascii);
    h.COST_OPTIMAL.forEach(function (id) {
      var trace = h.run(map.ascii, id).trace;
      assert.equal(trace.pathCost, best, id + ' cost on ' + map.name);
    });
  });
});

fixtures.UNWEIGHTED.forEach(function (map) {
  test('BFS returns the optimal cost on unweighted ' + map.name, function () {
    var best = h.refBestCost(map.ascii);
    h.STEP_OPTIMAL.forEach(function (id) {
      var trace = h.run(map.ascii, id).trace;
      assert.equal(trace.pathCost, best, id + ' cost on unweighted ' + map.name);
    });
  });
});

fixtures.ALL.forEach(function (map) {
  test('BFS returns the fewest steps on ' + map.name, function () {
    var best = h.refBestSteps(map.ascii);
    h.STEP_OPTIMAL.forEach(function (id) {
      var trace = h.run(map.ascii, id).trace;
      assert.equal(trace.pathSteps, best, id + ' steps on ' + map.name);
    });
  });
});

test('BFS is not cost-optimal on a weighted map - that is the lesson of level 3', function () {
  var map = fixtures.MAPS.swampBand;
  var trace = h.run(map.ascii, 'bfs').trace;
  assert.equal(trace.pathSteps, h.refBestSteps(map.ascii));
  assert.ok(trace.pathCost > h.refBestCost(map.ascii),
    'the swamp fixture no longer punishes BFS, so it cannot teach the lesson');
});

test('A* never expands more than Dijkstra on the shared fixtures', function () {
  if (!h.has('astar') || !h.has('dijkstra')) { return; }
  fixtures.ALL.forEach(function (map) {
    var a = h.run(map.ascii, 'astar').trace;
    var d = h.run(map.ascii, 'dijkstra').trace;
    assert.ok(a.expansions <= d.expansions,
      'A* expanded more than Dijkstra on ' + map.name + ' (' + a.expansions + ' vs ' + d.expansions + ')');
  });
});

/* ---------- unreachable goal ---------- */

test('every strategy terminates cleanly when the goal is walled off', function () {
  assert.equal(h.reachable(fixtures.UNREACHABLE), false, 'fixture sanity: goal must be unreachable');
  IDS.forEach(function (id) {
    var res = h.run(fixtures.UNREACHABLE, id);
    assert.equal(res.trace.found, false, id + ' claims to have reached a walled-off goal');
    assert.equal(res.trace.pathCost, Infinity, id + ' reports a finite cost with no path');
    assertTraceInvariants({ name: 'unreachable goal', ascii: fixtures.UNREACHABLE }, id, res);
  });
});

/* ---------- planned extensions: only run once the ids exist ---------- */

test('greedy best-first is non-optimal on a map that punishes the heuristic', function (t) {
  var id = h.OPTIONAL.greedy;
  if (!id) { return t.skip('no greedy strategy in the registry yet'); }
  var trace = h.run(fixtures.GREEDY_TRAP, id).trace;
  assert.equal(trace.found, true, 'greedy must still reach the goal');
  assert.ok(trace.pathCost > h.refBestCost(fixtures.GREEDY_TRAP),
    'greedy returned the optimal path on the trap map, so the map no longer makes the point');
  var astar = h.run(fixtures.GREEDY_TRAP, 'astar').trace;
  assert.equal(astar.pathCost, h.refBestCost(fixtures.GREEDY_TRAP),
    'A* must stay optimal on the same map - it is the foil greedy is measured against');
});

test('weighted A* expands no more as the weight rises', function (t) {
  var probe = weightedProbe();
  if (!probe) { return t.skip('no weighted A* strategy (or no weight knob) in the registry yet'); }
  var map = fixtures.MAPS.openField;
  var previous = Infinity;
  probe.weights.forEach(function (w) {
    var trace = probe.run(map.ascii, w);
    assert.equal(trace.found, true, 'weighted A* (w=' + w + ') must reach the goal on an open map');
    assert.ok(trace.expansions <= previous,
      'expansions rose from ' + previous + ' to ' + trace.expansions + ' when the weight rose to ' + w);
    previous = trace.expansions;
  });
});

// Weighted A* can arrive either as one id with a weight option or as a set of
// ids carrying the weight in the name. Support both, skip if neither is there.
function weightedProbe() {
  var byOption = h.OPTIONAL.weighted;
  if (byOption) {
    var weights = [1, 1.5, 2, 5];
    try {
      var baseline = h.run(fixtures.MAPS.openField.ascii, byOption, { weight: 1 }).trace;
      var heavy = h.run(fixtures.MAPS.openField.ascii, byOption, { weight: 5 }).trace;
      if (baseline.expansions !== heavy.expansions) {
        return {
          weights: weights,
          run: function (ascii, w) { return h.run(ascii, byOption, { weight: w }).trace; }
        };
      }
    } catch (err) { /* fall through to the id-per-weight shape */ }
  }

  var numbered = h.STRATEGY_IDS.filter(function (id) { return /weight/i.test(id) && /\d/.test(id); });
  if (numbered.length >= 2) {
    var parsed = numbered.map(function (id) {
      return { id: id, w: parseFloat(id.replace(/[^0-9.]/g, '')) };
    }).sort(function (a, b) { return a.w - b.w; });
    return {
      weights: parsed.map(function (p) { return p.w; }),
      run: function (ascii, w) {
        var hit = parsed.filter(function (p) { return p.w === w; })[0];
        return h.run(ascii, hit.id).trace;
      }
    };
  }
  return null;
}

test('bidirectional search returns a valid, optimal path', function (t) {
  var id = h.OPTIONAL.bidirectional;
  if (!id) { return t.skip('no bidirectional strategy in the registry yet'); }
  fixtures.UNWEIGHTED.forEach(function (map) {
    var res = h.run(map.ascii, id);
    assertTraceInvariants(map, id, res);
    assert.equal(res.trace.found, true, id + ' failed to reach the goal on ' + map.name);
    assert.equal(res.trace.pathSteps, h.refBestSteps(map.ascii),
      id + ' is a BFS from both ends, so it must return the fewest steps on ' + map.name);
  });
});
