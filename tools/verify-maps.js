/* tools/verify-maps.js - checks the Factory Heist maps in maps.js.
 *
 * A map is only worth shipping if it parses, can be finished, is not a copy of
 * another map, is harder than the tier below it, and if the power it is built
 * around is really the one that wins on it. The last part is proven by running
 * the engine, not by reading the notes. Run with: node tools/verify-maps.js
 */
var path = require('path');
var s = require(path.join(__dirname, '..', 'search.js'));
var MAPS = require(path.join(__dirname, '..', 'maps.js')).MAPS;
var starsFor = require(path.join(__dirname, 'verify-levels.js')).starsFor;

var ZONES = ['dock', 'assembly', 'racks', 'chutes', 'control'];
var GLYPHS = /^[#.~v0-9A-FSG$]$/;
var ALL = s.STRATEGIES.map(function (x) { return x.id; });

var failures = 0;
function fail(map, msg) {
  failures++;
  console.log('  FAIL ' + (map ? map.id + ': ' : '') + msg);
}

/* ---------- shape ---------- */

function checkShape(map) {
  if (ZONES.indexOf(map.zone) < 0) { fail(map, 'unknown zone ' + map.zone); }
  if (map.tier !== ZONES.indexOf(map.zone) + 1) { fail(map, 'zone ' + map.zone + ' is tier ' + (ZONES.indexOf(map.zone) + 1)); }
  ['id', 'name', 'objective', 'ascii', 'notes'].forEach(function (k) {
    if (typeof map[k] !== 'string' || !map[k]) { fail(map, 'missing ' + k); }
  });
  var rows = map.ascii.split('\n');
  var w = rows[0].length;
  rows.forEach(function (row, y) {
    if (row.length !== w) { fail(map, 'row ' + y + ' is ' + row.length + ' wide, not ' + w); }
    row.split('').forEach(function (ch, x) {
      if (!GLYPHS.test(ch)) { fail(map, 'unknown glyph ' + JSON.stringify(ch) + ' at ' + x + ',' + y); }
      var edge = y === 0 || y === rows.length - 1 || x === 0 || x === w - 1;
      if (edge && ch !== '#') { fail(map, 'outer wall open at ' + x + ',' + y); }
    });
  });
  var grid = s.parseGrid(map.ascii);
  if (!grid.starts.length) { fail(map, 'no start S'); }
  if (!grid.goals.length) { fail(map, 'no prize G'); }
  var pads = {};
  rows.forEach(function (row) {
    row.split('').forEach(function (ch) { if (ch >= '0' && ch <= '9') { pads[ch] = (pads[ch] || 0) + 1; } });
  });
  Object.keys(pads).forEach(function (d) {
    if (pads[d] !== 2) { fail(map, 'teleporter ' + d + ' has ' + pads[d] + ' pads, not a pair'); }
  });
  // A refund chute is entered from above and left below: both ends must be open.
  grid.cells.forEach(function (row, y) {
    row.forEach(function (ch, x) {
      if (ch !== 'v') { return; }
      if (wallAt(grid, x, y - 1) || wallAt(grid, x, y + 1)) { fail(map, 'power-cell chute at ' + x + ',' + y + ' is capped'); }
    });
  });
  return grid;
}

/* ---------- reachability ---------- */

function reaches(grid, from, to) {
  return s.search(grid, 'bfs', { from: from, to: to }).found;
}

function checkReach(map, grid) {
  grid.starts.forEach(function (st) {
    grid.goals.forEach(function (g) {
      if (!reaches(grid, st, g)) { fail(map, 'start ' + st.x + ',' + st.y + ' cannot reach prize ' + g.x + ',' + g.y); }
    });
  });
  chestsOf(grid).forEach(function (c) {
    if (!reaches(grid, grid.start, c)) { fail(map, 'chest spawn ' + c.x + ',' + c.y + ' is unreachable'); }
  });
}

function chestsOf(grid) {
  var out = [];
  grid.cells.forEach(function (row, y) {
    row.forEach(function (ch, x) { if (ch === '$') { out.push({ x: x, y: y }); } });
  });
  return out;
}

/* ---------- metrics ---------- */

function wallAt(grid, x, y) {
  return x < 0 || y < 0 || x >= grid.w || y >= grid.h || s.isWall(grid, x, y);
}

function inOpenBlock(grid, x, y) {
  return [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(function (o) {
    var bx = x + o[0];
    var by = y + o[1];
    return !wallAt(grid, bx, by) && !wallAt(grid, bx + 1, by) &&
      !wallAt(grid, bx, by + 1) && !wallAt(grid, bx + 1, by + 1);
  });
}

function components(grid, glyphTest) {
  var seen = {};
  var count = 0;
  for (var y = 0; y < grid.h; y++) {
    for (var x = 0; x < grid.w; x++) {
      var i = y * grid.w + x;
      if (seen[i] || !glyphTest(grid.cells[y][x])) { continue; }
      count++;
      var stack = [[x, y]];
      seen[i] = true;
      while (stack.length) {
        var c = stack.pop();
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var nx = c[0] + d[0];
          var ny = c[1] + d[1];
          if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) { return; }
          var j = ny * grid.w + nx;
          if (!seen[j] && glyphTest(grid.cells[ny][nx])) { seen[j] = true; stack.push([nx, ny]); }
        });
      }
    }
  }
  return count;
}

function metrics(map, grid) {
  var floor = 0;
  var branching = 0;
  for (var y = 0; y < grid.h; y++) {
    for (var x = 0; x < grid.w; x++) {
      if (wallAt(grid, x, y)) { continue; }
      floor++;
      var open = 0;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        if (!wallAt(grid, x + d[0], y + d[1])) { open++; }
      });
      // A choice the walls force on you: a dead end, or a fork in a corridor.
      // Cells inside open floor (part of any open 2x2 block) are not forks.
      if (open === 1) { branching++; }
      if (open >= 3 && !inOpenBlock(grid, x, y)) { branching++; }
    }
  }
  var pairs = Object.keys(grid.teleports).length / 2;
  var traps = components(grid, function (ch) { return ch === '~'; }) +
    pairs +
    components(grid, function (ch) { return ch === 'v'; }) +
    (grid.goals.length - 1) +
    (grid.starts.length - 1) +
    (map.fog ? 3 : 0) +
    (map.goalKnown === false ? 2 : 0) +
    (map.budgets && map.budgets.frontier !== undefined && map.budgets.frontier <= 6 ? 2 : 0);
  return { floor: floor, branching: branching, traps: traps };
}

/* ---------- sameness ---------- */

// Fraction of the interior, both maps pinned top-left, where the two maps
// disagree about wall versus floor. The outer wall every map shares is left
// out, and area only one of the two maps has counts as different.
function difference(a, b) {
  var h = Math.min(a.h, b.h) - 1;
  var w = Math.min(a.w, b.w) - 1;
  var diff = 0;
  for (var y = 1; y < h; y++) {
    for (var x = 1; x < w; x++) {
      if ((a.cells[y][x] === '#') !== (b.cells[y][x] === '#')) { diff++; }
    }
  }
  var area = Math.max((a.w - 2) * (a.h - 2), (b.w - 2) * (b.h - 2));
  return (diff + area - (w - 1) * (h - 1)) / area;
}

/* ---------- stars ---------- */

function levelOf(map, grid) {
  return {
    name: map.name,
    objective: map.objective,
    goalKnown: map.goalKnown,
    fog: map.fog,
    goalCount: grid.goals.length,
    budgets: map.budgets
  };
}

function checkStars(map, grid) {
  var level = levelOf(map, grid);
  var refs = s.referenceFor(grid, level);
  var avail = {};
  s.strategyAvailability(level).forEach(function (a) { avail[a.id] = a; });
  var expect = map.expect || {};
  var threes = [];
  var losers = 0;
  console.log('  best: ' + refs.bestSteps + ' steps, cost ' + refs.bestCost +
    '   budgets ' + JSON.stringify(map.budgets || {}));
  ALL.forEach(function (a) {
    if (!avail[a].eligible) {
      if (expect[a] !== undefined) { fail(map, a + ' is ineligible but expected ' + expect[a]); }
      return;
    }
    var trace = s.searchMission(grid, a, {
      objective: map.objective,
      goalKnown: map.goalKnown,
      params: map.fog ? { fog: true } : undefined
    });
    var stars = starsFor(level, trace, refs);
    if (stars === 3) { threes.push(a); }
    if (expect[a] !== undefined && expect[a] < 3) { losers++; }
    var flag = expect[a] === undefined || expect[a] === stars ? '' : '   <-- EXPECTED ' + expect[a];
    if (flag) { fail(map, a + ' earned ' + stars + ', expected ' + expect[a]); }
    console.log('  ' + a.padEnd(10) +
      String(trace.pathSteps).padStart(6) + String(trace.pathCost).padStart(7) +
      String(trace.expansions).padStart(12) + String(trace.peakFrontier).padStart(10) +
      String(stars).padStart(7) + flag);
  });
  var winners = Object.keys(expect).filter(function (a) { return expect[a] === 3; });
  if (!winners.length) { fail(map, 'no power is pinned to win'); }
  if (!losers) { fail(map, 'no power is pinned to lose'); }
  return threes;
}

/* ---------- run ---------- */

if (MAPS.length !== 15) { fail(null, 'expected 15 maps, found ' + MAPS.length); }
var ids = {};
MAPS.forEach(function (m) {
  if (ids[m.id]) { fail(m, 'duplicate id'); }
  ids[m.id] = true;
});
ZONES.forEach(function (z) {
  var n = MAPS.filter(function (m) { return m.zone === z; }).length;
  if (n !== 3) { fail(null, 'zone ' + z + ' has ' + n + ' maps, not 3'); }
});

var grids = [];
var byTier = {};
var threesOf = {};
MAPS.forEach(function (map, i) {
  var grid = checkShape(map);
  grids.push(grid);
  var m = metrics(map, grid);
  console.log('\n' + (i + 1) + '. ' + map.id + ' - ' + map.name + '  [tier ' + map.tier + ', ' + map.objective +
    (map.fog ? ', fog' : '') + (map.goalKnown === false ? ', goal hidden' : '') + ']  ' +
    grid.w + 'x' + grid.h + '  floor ' + m.floor + '  branching ' + m.branching + '  traps ' + m.traps +
    '  chests ' + chestsOf(grid).length);
  checkReach(map, grid);
  var threes = checkStars(map, grid);
  m.threes = threes.length;
  threesOf[map.id] = threes.length;
  console.log('  three stars: ' + threes.join(', '));
  (byTier[map.tier] = byTier[map.tier] || []).push(m);
  if (i > 0 && map.tier < MAPS[i - 1].tier) { fail(map, 'tiers must not go down through the list'); }
});

for (var a = 0; a < MAPS.length; a++) {
  for (var b = a + 1; b < MAPS.length; b++) {
    var d = difference(grids[a], grids[b]);
    if (d < 0.15) { fail(MAPS[b], 'only ' + Math.round(d * 100) + '% different from ' + MAPS[a].id); }
  }
}

console.log('\ntier  floor  branching  traps  three-star powers   (averages)');
var prev = null;
Object.keys(byTier).sort().forEach(function (t) {
  var list = byTier[t];
  var avg = function (k) { return list.reduce(function (sum, m) { return sum + m[k]; }, 0) / list.length; };
  var row = { floor: avg('floor'), branching: avg('branching'), traps: avg('traps'), threes: avg('threes') };
  console.log('  ' + t + String(row.floor.toFixed(0)).padStart(8) + String(row.branching.toFixed(1)).padStart(11) +
    String(row.traps.toFixed(1)).padStart(7) + String(row.threes.toFixed(1)).padStart(10));
  if (prev) {
    ['floor', 'branching', 'traps'].forEach(function (k) {
      if (!(row[k] > prev[k])) { fail(null, 'tier ' + t + ' ' + k + ' does not rise above tier ' + (t - 1)); }
    });
  }
  prev = row;
});

// The top tier is where the game gets hard: it lets the fewest powers win.
var tierFive = byTier[5] || [];
Object.keys(byTier).forEach(function (t) {
  var avg = function (list) { return list.reduce(function (sum, m) { return sum + m.threes; }, 0) / list.length; };
  if (t !== '5' && avg(byTier[t]) < avg(tierFive)) { fail(null, 'tier ' + t + ' lets fewer powers win than tier 5'); }
});
MAPS.forEach(function (map) {
  if (map.tier >= 4 && threesOf[map.id] > 2) { fail(map, 'a tier ' + map.tier + ' map lets ' + threesOf[map.id] + ' powers win; at most 2'); }
});

console.log('\n' + (failures === 0 ? 'ALL MAPS CHECK OUT' : failures + ' PROBLEM(S)'));
process.exit(failures === 0 ? 0 : 1);
