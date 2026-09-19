/* tests/campaign.test.js - the Factory Heist campaign contract.
 *
 * tools/verify-campaign.js is the proof (maps, ladder, solvable, par, no
 * sweep, curve, economy); this runs it inside `npm test` so a campaign or
 * shop edit that breaks it fails the suite, and pins the few rules that are
 * easier to state as assertions than as a table.
 */

var test = require('node:test');
var assert = require('node:assert');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var verify = require(path.join(ROOT, 'tools', 'verify-campaign.js'));
var C = require(path.join(ROOT, 'campaign.js'));
var Shop = require(path.join(ROOT, 'shop.js'));

test('verify-campaign passes on maps.js', function () {
  var result = verify.check(verify.loadMaps());
  assert.deepStrictEqual(result.problems, []);
});

test('every power unlocks exactly once, BFS first', function () {
  var ladder = C.unlockOrder().map(function (u) { return u.power; });
  assert.strictEqual(new Set(ladder).size, 12);
  assert.deepStrictEqual(C.powersAt(1), ['bfs']);
  assert.strictEqual(C.powersAt(15).length, 12);
});

test('stars are cumulative and a boost caps them at two', function () {
  var enc = C.encounter(1);
  var fast = { won: true, ticks: enc.par.ticks, chargeSpent: enc.par.charge };
  assert.strictEqual(C.starsFor(enc, fast), 3);
  assert.strictEqual(C.starsFor(enc, { won: true, ticks: enc.par.ticks + 1, chargeSpent: 0 }), 1);
  assert.strictEqual(C.starsFor(enc, { won: true, ticks: 0, chargeSpent: enc.par.charge + 1 }), 2);
  assert.strictEqual(C.starsFor(enc, { won: false, ticks: 0, chargeSpent: 0 }), 0);
  assert.strictEqual(C.starsFor(enc, Object.assign({ starCap: Shop.BOOST_BY_ID.freeze.capsStars }, fast)), 2);
});

test('the shop sells one power early, one level early, once', function () {
  var shelf = Shop.shelf(3, { gold: 999, earlyUnlocked: [] });
  assert.strictEqual(shelf.power.id, 'astar');
  assert.strictEqual(shelf.power.earlyAt, 3);
  assert.strictEqual(Shop.shelf(3, { gold: 999, earlyUnlocked: ['astar'] }).power, null);
  assert.deepStrictEqual(Shop.powersFor(3, { earlyUnlocked: ['astar'] }), ['bfs', 'greedy', 'dijkstra', 'astar']);
  assert.deepStrictEqual(Shop.powersFor(2, { earlyUnlocked: ['astar'] }), ['bfs', 'greedy']);
  assert.strictEqual(Shop.shelf(15, { gold: 999, earlyUnlocked: [] }).power, null);
});

test('boosts appear on the shelf only after the level that unlocks them', function () {
  assert.deepStrictEqual(Shop.boostsBefore(1), []);
  assert.deepStrictEqual(Shop.boostsBefore(2).map(function (b) { return b.id; }), ['recharge']);
});

test('deliveries are the map\'s prizes first, then its $ pads', function () {
  var MAPS = verify.loadMaps();
  var enc = C.encounter(1);
  var map = MAPS.filter(function (m) { return m.id === enc.mapId; })[0];
  var rows = map.ascii.split('\n');
  var cells = C.deliveryCellsOf(enc, map);
  assert.strictEqual(cells.length, enc.deliveries);
  assert.strictEqual(rows[cells[0].y][cells[0].x], 'G');
  assert.strictEqual(rows[cells[1].y][cells[1].x], '$');
  assert.strictEqual(C.chestPadsOf(enc, map).length, 1);
});

test('campaign.js and shop.js publish one global each', function () {
  var fs = require('fs');
  var vm = require('vm');
  var sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'campaign.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'shop.js'), 'utf8'), sandbox);
  assert.deepStrictEqual(Object.keys(sandbox).sort(), ['Campaign', 'Shop']);
});
