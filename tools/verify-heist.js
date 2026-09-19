#!/usr/bin/env node
/* tools/verify-heist.js - the campaign, played with the thieves on the floor.
 *
 * tools/verify-campaign.js measures par on a still floor: the engine, no
 * thieves. This is the other half. It plays every encounter through heist.js,
 * the one simulator, with a reference player that follows the encounter's
 * perfect line - same powers, same delivery order, the foreman hit until he
 * lets go - while haulers shove, scouts ram and foremen drag. It re-aims when
 * a delivery is shoved off its route, and it does nothing a player could not.
 *
 *   node tools/verify-heist.js        play all fifteen and print the table
 *
 * It fails when an encounter cannot be won that way on its start charge, when
 * a log does not replay to the same run (the determinism a ghost race and
 * every bug report stand on), or when the simulator charges a still-floor
 * plot differently from what verify-campaign measured.
 */

var path = require('path');
var ROOT = path.join(__dirname, '..');
var Heist = require(path.join(ROOT, 'heist.js'));
var C = require(path.join(ROOT, 'campaign.js'));
var E = require(path.join(ROOT, 'search.js'));

var failures = [];
function fail(enc, msg) { failures.push('L' + enc.level + ' ' + enc.mapId + ': ' + msg); }

/* ------------------------------------------------------- reference player ---*/

function play(enc) {
  var state = Heist.create(enc);
  var legs = enc.perfectLine.legs;
  for (var n = 0; n < legs.length && state.status === 'playing'; n++) {
    var leg = legs[n];
    var d = state.deliveries[leg.to];
    var guard = 0;
    while (!d.secured && state.status === 'playing' && guard++ < 80) {
      var aim = { x: d.x, y: d.y };
      // The line's power, unless from where the cart now stands it would
      // overheat or find nothing - then the cheapest power that works.
      var power = works(state, leg.power, aim) ? leg.power : cheapest(state, aim);
      if (!power) { Heist.tick(state); continue; }
      var out = Heist.fire(state, power, aim);
      if (out.refused) { fail(enc, 'a plot was refused: ' + out.refused); return state; }
      // Ride it out, but get off the moment the delivery is shoved away.
      var rideGuard = 0;
      while (state.ride && state.status === 'playing' && rideGuard++ < 300) {
        var end = state.ride.path[state.ride.path.length - 1];
        if (end.x !== d.x || end.y !== d.y) { Heist.stop(state); break; }
        Heist.tick(state);
      }
      while (state.stall > 0 && state.status === 'playing') { Heist.tick(state); }
    }
  }
  return state;
}

// A dry run of a plot: the search, with none of its costs applied.
function probe(state, power, aim) {
  var h = Heist.openFire(state, power, aim);
  if (h.refused) { return null; }
  while (!h.done) { Heist.stepFire(h); }
  var t = Heist.traceOf(h);
  if (!t.found || (state.memory !== null && t.peakFrontier > state.memory)) { return null; }
  var ride = t.path.slice(1).reduce(function (n, p) { return n + E.cellCost(state.grid, p.x, p.y); }, 0);
  return C.plotCharge(t, state.map) + ride;
}

function works(state, power, aim) { return probe(state, power, aim) !== null; }

function cheapest(state, aim) {
  var best = null;
  var bestCost = Infinity;
  state.powers.forEach(function (p) {
    var c = probe(state, p, aim);
    if (c !== null && c < bestCost) { best = p; bestCost = c; }
  });
  return best;
}

/* ----------------------------------------------- still floor, same prices ---
 * With the thieves taken off, the first plot of a level must cost exactly
 * what verify-campaign charges for it, or par measures a different game. */

function stillPlotMatches(enc) {
  var state = Heist.create(enc);
  state.bots = [];
  var leg = enc.perfectLine.legs[0];
  var d = state.deliveries[leg.to];
  var map = Heist.mapOf(enc);
  var before = state.spent;
  var out = Heist.fire(state, leg.power, { x: d.x, y: d.y });
  var params = E.defaultParams(leg.power);
  params.from = state.grid.start;
  params.to = { x: d.x, y: d.y };
  params.fog = !!enc.fog;
  params.hideGoal = !!enc.prizeBehaviour.hidden;
  var want = C.plotCharge(E.search(state.grid, leg.power, params), map);
  if (state.spent - before !== want) {
    fail(enc, 'a still-floor plot cost ' + (state.spent - before) + ', verify-campaign charges ' + want);
  }
  return out;
}

/* ----------------------------------------------------------------- main ---*/

var rows = [];
C.ENCOUNTERS.forEach(function (enc) {
  stillPlotMatches(enc);
  var state = play(enc);
  var sum = Heist.summary(state);
  if (sum.status !== 'won') {
    fail(enc, 'the perfect line did not win with thieves on the floor (' + sum.status + ': ' + state.reason + ')');
  }
  var again = Heist.summary(Heist.replay(enc, state.log));
  if (JSON.stringify(again) !== JSON.stringify(sum)) {
    fail(enc, 'replaying the log gave a different run: ' + JSON.stringify(again));
  }
  rows.push([
    String(enc.level).padStart(2), enc.mapId.padEnd(24), sum.status.padEnd(6),
    (sum.ticks + '/' + enc.par.ticks).padStart(8), (sum.spent + '/' + enc.par.charge).padStart(9),
    String(enc.startCharge).padStart(6), (sum.secured + '/' + sum.deliveries).padStart(4),
    String(sum.hits).padStart(4), String(sum.stolen).padStart(6), (sum.stars + '*').padStart(5)
  ].join('  '));
});

console.log('');
console.log('  lv  map                       result  tick/par  spent/par   start  dlv  hits  stolen stars');
console.log('  ' + '-'.repeat(92));
rows.forEach(function (r) { console.log('  ' + r); });
console.log('');

if (failures.length) {
  console.log('  ' + failures.length + ' PROBLEM' + (failures.length === 1 ? '' : 'S') + ':');
  failures.forEach(function (f) { console.log('    - ' + f); });
  console.log('');
  process.exit(1);
}
console.log('  ALL ' + C.ENCOUNTERS.length + ' ENCOUNTERS WON WITH THE THIEVES ON THE FLOOR, AND EVERY LOG REPLAYS');
console.log('');
