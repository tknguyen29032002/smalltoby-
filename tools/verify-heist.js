#!/usr/bin/env node
/* tools/verify-heist.js - the campaign contract, written down and executable.
 *
 * A Factory Heist floor is only a level if it can actually be won with the
 * powers unlocked by the time the player gets there, and its pars are only
 * pars if they came from a real playthrough. So this tool plays every floor
 * with a reference player - a scripted dispatcher that uses the cheapest
 * unlocked power that finds a route, rides it, and strikes a robot that is
 * sitting on the delivery it wants - and then checks the level table.
 *
 *   node tools/verify-heist.js           check every floor against campaign.js
 *   node tools/verify-heist.js --tune    print the par block the run earned
 *
 * It fails when a floor becomes unwinnable, when the reference player cannot
 * make the pars in campaign.js, when a map is malformed, or when a replay of
 * the same log does not reproduce the same result - the determinism the ghost
 * race and the tuner both stand on.
 */

var path = require('path');
var ROOT = path.join(__dirname, '..');
var Heist = require(path.join(ROOT, 'heist.js'));
var campaign = require(path.join(ROOT, 'campaign.js'));
var engine = require(path.join(ROOT, 'search.js'));

var LEVELS = campaign.HEIST_LEVELS;
var TUNE = process.argv.indexOf('--tune') !== -1;
var VERBOSE = process.argv.indexOf('-v') !== -1;

var failures = [];

function fail(level, msg) {
  failures.push((level ? level.id + ': ' : '') + msg);
}

/* ---------------------------------------------------------------- shape ---*/

function checkShape(level) {
  var rows = level.map.split('\n');
  var w = rows[0].length;
  rows.forEach(function (r, i) {
    if (r.length !== w) {
      fail(level, 'row ' + i + ' is ' + r.length + ' wide, row 0 is ' + w);
    }
  });

  var grid = engine.parseGrid(level.map);
  if (!grid.start) { fail(level, 'no S on the map'); }
  if (grid.goals.length < 2 || grid.goals.length > 3) {
    fail(level, 'a floor carries 2 or 3 deliveries, this one has ' + grid.goals.length);
  }
  if (grid.w > 30 || grid.h > 20) {
    fail(level, 'map is ' + grid.w + 'x' + grid.h + ', which will not fit on screen at the default zoom');
  }

  (level.bots || []).forEach(function (b, i) {
    try {
      var at = Heist.placeOf(grid, b.at);
      if (engine.isWall(grid, at.x, at.y)) { fail(level, 'bot ' + i + ' spawns in a wall'); }
      var den = Heist.placeOf(grid, b.den);
      if (den && engine.isWall(grid, den.x, den.y)) { fail(level, 'bot ' + i + ' dens in a wall'); }
    } catch (e) {
      fail(level, 'bot ' + i + ': ' + e.message);
    }
  });

  // Every delivery has to be reachable from the start, or the floor is a lie.
  grid.goals.forEach(function (g, i) {
    var t = engine.search(grid, 'bfs', { from: grid.start, to: g, targets: [g] });
    if (!t.found) { fail(level, 'delivery ' + i + ' is walled off from the start'); }
  });

  return grid;
}

/* ------------------------------------------------------- reference player ---
 *
 * Not an optimal player: a sensible one. It is the yardstick the pars are set
 * by, so it has to play the way the level intends - pick the unlocked power
 * that finds the route for the least charge, ride it, and clear a robot that
 * is standing between the cart and the red point.
 */

function unlockedAt(levelIndex) {
  var out = [];
  for (var i = 0; i <= levelIndex; i++) {
    if (campaign.HEIST_UNLOCKS[i]) { out.push(campaign.HEIST_UNLOCKS[i]); }
  }
  return out;
}

// What would this power cost right now, and does it get there? Probing is
// free here because it happens outside the state: the real shot pays.
function probe(state, powerId, target) {
  var probeState = { level: state.level, grid: state.grid, player: state.player, status: 'playing' };
  var handle = Heist.openFire(probeState, powerId, target);
  if (!handle) { return null; }
  while (!handle.done) { Heist.stepFire(handle); }
  var trace = engineTrace(handle);
  return {
    powerId: powerId,
    cost: trace.chargedExpansions === undefined ? trace.expansions : trace.chargedExpansions,
    found: trace.found,
    steps: trace.pathSteps,
    reach: handle.power.reach
  };
}

function engineTrace(handle) {
  return engine.traceOf(handle.search);
}

// Both budgets are stars, so the yardstick player weighs them both: charge
// spent now, plus the ticks the route it bought will take. A wall drone that
// costs nothing and walks the whole perimeter is not the sensible play.
function rideValue(p) { return p.cost + p.steps * 6; }

function bestRide(state, powers, target) {
  var best = null;
  powers.forEach(function (id) {
    var p = probe(state, id, target);
    if (!p || !p.found) { return; }
    if (!best || rideValue(p) < rideValue(best)) { best = p; }
  });
  return best;
}

function play(level, levelIndex, opts) {
  opts = opts || {};
  var powers = unlockedAt(levelIndex);
  var state = Heist.create(level);
  var guard = 0;

  while (state.status === 'playing' && guard++ < 400) {
    var open = Heist.openDeliveries(state);
    if (!open.length) { break; }

    // Aim at the nearest open delivery.
    var target = open.reduce(function (a, b) {
      var da = Math.abs(a.x - state.player.x) + Math.abs(a.y - state.player.y);
      var db = Math.abs(b.x - state.player.x) + Math.abs(b.y - state.player.y);
      return db < da ? b : a;
    });

    // A robot parked on the red point has to be moved before the ride lands.
    var sitting = Heist.botAt(state, target.x, target.y);
    if (sitting) {
      var strike = bestRide(state, powers, { x: sitting.x, y: sitting.y, botId: sitting.id });
      if (strike && strike.steps <= strike.reach) {
        Heist.fire(state, strike.powerId, { x: sitting.x, y: sitting.y, botId: sitting.id });
        continue;
      }
    }

    var ride = bestRide(state, powers, { x: target.x, y: target.y });
    if (!ride) {
      // Nothing can route there this tick: let the world move and look again.
      Heist.tick(state);
      continue;
    }
    Heist.fire(state, ride.powerId, { x: target.x, y: target.y });

    // Ride it out, but stop the moment the point is shoved off the route.
    var rideGuard = 0;
    while (state.status === 'playing' && state.ride && rideGuard++ < 200) {
      var last = state.ride.path[state.ride.path.length - 1];
      if (!Heist.deliveryAt(state, last.x, last.y) && !anyOpenAt(state, last)) {
        Heist.stop(state);
        break;
      }
      Heist.tick(state);
    }
    if (state.ride === null && opts.verbose) { /* next aim */ }
  }

  return state;
}

function anyOpenAt(state, cell) {
  return Heist.openDeliveries(state).some(function (d) {
    return d.x === cell.x && d.y === cell.y;
  });
}

/* ----------------------------------------------------------------- main ---*/

var tuned = [];
var rows = [];

LEVELS.forEach(function (level, i) {
  checkShape(level);

  var state = play(level, i);
  var sum = Heist.summary(state);

  // Determinism: the same log, replayed, has to land in exactly the same place.
  var again = Heist.replay(level, state.log);
  var a = Heist.summary(again);
  if (a.status !== sum.status || a.ticks !== sum.ticks || a.spent !== sum.spent) {
    fail(level, 'replaying the log gave a different run (' + JSON.stringify(a) +
      ' vs ' + JSON.stringify(sum) + ')');
  }

  if (sum.status !== 'won') {
    fail(level, 'the reference player could not finish it: ' + sum.status +
      ' after ' + sum.ticks + ' ticks, ' + sum.spent + '/' + level.charge + ' charge, ' +
      sum.secured + '/' + sum.deliveries + ' secured');
  }

  tuned.push({
    id: level.id,
    ticks: Math.ceil(sum.ticks * 1.15),
    charge: Math.ceil(sum.spent * 1.15 / 5) * 5
  });

  if (!TUNE && sum.status === 'won') {
    var par = level.par || {};
    if (par.ticks === undefined || par.charge === undefined) {
      fail(level, 'no par block - run with --tune and paste one in');
    } else {
      if (sum.ticks > par.ticks) {
        fail(level, 'the reference player needed ' + sum.ticks + ' ticks against a par of ' + par.ticks);
      }
      if (sum.spent > par.charge) {
        fail(level, 'the reference player spent ' + sum.spent + ' charge against a par of ' + par.charge);
      }
      if (sum.spent > level.charge * 0.8) {
        fail(level, 'the reference run used ' + sum.spent + ' of ' + level.charge +
          ' charge: there is no room left for a player who guesses wrong');
      }
    }
  }

  rows.push([
    String(i + 1).padStart(2),
    level.id.padEnd(11),
    (level.unlock || '-').padEnd(9),
    String(sum.status).padEnd(7),
    String(sum.ticks).padStart(4),
    String(sum.spent).padStart(6),
    String(level.charge).padStart(6),
    String(sum.secured + '/' + sum.deliveries).padStart(4),
    String(Heist.stars(state)) + '*'
  ].join('  '));
});

console.log('');
console.log('  #  floor        unlocks    result   ticks  charge   bar   secured stars');
console.log('  ' + '-'.repeat(72));
rows.forEach(function (r) { console.log('  ' + r); });
console.log('');

if (TUNE) {
  console.log('  par blocks from this run (reference + 15%):');
  tuned.forEach(function (t) {
    console.log("    " + t.id + ": par: { ticks: " + t.ticks + ", charge: " + t.charge + " },");
  });
  console.log('');
}

if (failures.length) {
  console.log('  ' + failures.length + ' PROBLEM' + (failures.length === 1 ? '' : 'S') + ':');
  failures.forEach(function (f) { console.log('    - ' + f); });
  console.log('');
  process.exit(1);
}

console.log('  ALL ' + LEVELS.length + ' FLOORS PLAYABLE AND ON PAR');
console.log('');
if (VERBOSE) { console.log('  (run with --tune to reprint the par blocks)'); }
