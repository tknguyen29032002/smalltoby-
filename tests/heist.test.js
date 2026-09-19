/* tests/heist.test.js - the simulator's contract.
 *
 * tools/verify-heist.js plays all fifteen encounters with the thieves on the
 * floor; this runs it inside `npm test` and pins the rules the page and the
 * par measurement rely on: heist.js reads its floor from maps.js and its
 * prices from campaign.js, every power has a human label, replays are exact,
 * and the light, the ram, the nudge and the boosts do what CAMPAIGN.md says.
 */

var test = require('node:test');
var assert = require('node:assert');
var path = require('path');
var childProcess = require('child_process');

var ROOT = path.join(__dirname, '..');
var Heist = require(path.join(ROOT, 'heist.js'));
var C = require(path.join(ROOT, 'campaign.js'));
var E = require(path.join(ROOT, 'search.js'));

// A level with the thieves taken off, for rules that are about the cart.
function still(level) {
  var st = Heist.create(C.encounter(level));
  st.bots = [];
  st.deliveries.forEach(function (d) { d.heldBy = null; });
  return st;
}

test('verify-heist: every encounter won with the thieves on, every log replays', function () {
  var out = childProcess.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'verify-heist.js')], { encoding: 'utf8' });
  assert.strictEqual(out.status, 0, out.stdout + out.stderr);
});

test('the floor is the map the encounter names, and the deliveries are the campaign\'s', function () {
  C.ENCOUNTERS.forEach(function (enc) {
    var st = Heist.create(enc);
    var map = Heist.mapOf(enc);
    assert.strictEqual(st.map.id, enc.mapId);
    assert.deepStrictEqual(st.deliveries.map(function (d) { return [d.x, d.y]; }),
      C.deliveryCellsOf(enc, map).map(function (d) { return [d.x, d.y]; }));
    assert.strictEqual(st.bots.length, C.botCount(enc), 'L' + enc.level + ' puts every thief on the floor');
    assert.strictEqual(st.charge, enc.startCharge);
  });
});

test('every power has a human label, never its id', function () {
  Heist.POWERS.forEach(function (p) {
    var s = E.STRATEGY_BY_ID[p.id];
    assert.ok(s && s.label && s.label !== p.id, p.id);
    assert.ok(p.name && p.feel, p.id);
  });
  assert.strictEqual(Heist.POWERS.length, E.STRATEGIES.length);
});

test('a plot costs what verify-campaign charges, and takes one tick', function () {
  var st = still(1);
  var d = st.deliveries[0];
  var params = E.defaultParams('bfs');
  params.from = st.grid.start;
  params.to = { x: d.x, y: d.y };
  params.fog = false;
  params.hideGoal = false;
  var want = C.plotCharge(E.search(st.grid, 'bfs', params), st.map);
  var out = Heist.fire(st, 'bfs', d);
  assert.strictEqual(out.cost, want);
  assert.strictEqual(st.spent, want);
  assert.strictEqual(st.tick, 1);
  assert.ok(st.ride, 'the cart has a route to ride');
});

test('riding pays each cell\'s terrain, and the level is won on the last delivery', function () {
  var st = still(1);
  st.deliveries.forEach(function (d) {
    var before = st.spent;
    var out = Heist.fire(st, 'bfs', d);
    var ride = out.trace.path.slice(1).reduce(function (n, p) { return n + E.cellCost(st.grid, p.x, p.y); }, 0);
    while (st.ride) { Heist.tick(st); }
    assert.strictEqual(st.spent - before, out.cost + ride);
    assert.ok(d.secured);
  });
  assert.strictEqual(st.status, 'won');
  assert.ok(Heist.stars(st) >= 1);
});

test('a log replays to the same run: plots, stops, nudges and waits', function () {
  var enc = C.encounter(3);
  var st = Heist.create(enc);
  var d = st.deliveries[0];
  Heist.fire(st, 'bfs', d);
  Heist.tick(st);
  Heist.tick(st);
  Heist.stop(st);
  Heist.tick(st);
  Heist.nudge(st, 1);
  Heist.fire(st, 'dijkstra', st.deliveries[1]);
  Heist.tick(st);
  var again = Heist.replay(enc, st.log);
  assert.deepStrictEqual(Heist.summary(again), Heist.summary(st));
  assert.deepStrictEqual(again.player, st.player);
});

test('the light stuns a hauler and makes it drop its lockbox; a scout runs', function () {
  var st = still(3);
  var d = st.deliveries[0];
  var route = Heist.openFire(st, 'bfs', d);
  while (!route.done) { Heist.stepFire(route); }
  var mid = Heist.traceOf(route).path[2];
  var hauler = { id: 90, type: 'basic', name: 'Hauler bot', x: mid.x, y: mid.y, den: mid, hp: 1, maxHp: 1, phase: 0, facing: 0, stunned: 0, fleeing: 0, calm: 0, carrying: { id: 7, x: 0, y: 0 }, holding: null };
  st.bots.push(hauler);
  Heist.fire(st, 'bfs', d);
  assert.ok(hauler.stunned > 0);
  assert.strictEqual(hauler.carrying, null);
  assert.ok(st.chests.some(function (c) { return c.id === 7; }));
});

test('a foreman holds his delivery until his last plate, and his zone\'s power does nothing', function () {
  var enc = C.encounter(4);
  var st = Heist.create(enc);
  st.bots = st.bots.filter(function (b) { return b.type === 'boss'; });
  var boss = st.bots[0];
  var held = st.deliveries[boss.holding];
  var shield = st.zone.bossShieldedFrom;
  var other = st.powers.filter(function (p) { return p !== shield; })[0];
  Heist.fire(st, shield, { x: boss.x, y: boss.y });
  assert.strictEqual(boss.hp, boss.maxHp, 'proofed');
  for (var i = 0; i < boss.maxHp; i++) {
    boss.stunned = 0;
    Heist.fire(st, other, { x: boss.x, y: boss.y });
    Heist.stop(st);
  }
  assert.strictEqual(boss.hp, 0);
  assert.strictEqual(held.heldBy, null, 'released');
});

test('a nudge costs the cell plus the surcharge; free-walk makes it free', function () {
  var st = still(1);
  var dir = [0, 1, 2, 3].filter(function (k) {
    var dd = Heist.DIRS[k];
    return Heist.canStep(st.grid, st.player, { x: st.player.x + dd[0], y: st.player.y + dd[1] });
  })[0];
  Heist.nudge(st, dir);
  assert.strictEqual(st.spent, 1 + C.ECONOMY.nudgeSurcharge);
  var free = Heist.create(C.encounter(1), { freeWalk: true });
  Heist.nudge(free, dir);
  assert.strictEqual(free.spent, 0);
});

test('a boost other than recharge caps the level at two stars', function () {
  var st = Heist.create(C.encounter(3), { boosts: { recharge: 1, freeze: 1 } });
  var before = st.charge;
  assert.strictEqual(Heist.useBoost(st, 'recharge'), true);
  assert.ok(st.charge > before);
  assert.strictEqual(st.starCap, undefined);
  assert.strictEqual(Heist.useBoost(st, 'freeze'), true);
  assert.strictEqual(st.starCap, 2);
  assert.notStrictEqual(Heist.useBoost(st, 'freeze'), true, 'one per level');
});

test('the power change cap is enforced across plots', function () {
  var enc = C.encounter(15);
  var st = still(15);
  var powers = st.powers;
  var d = st.deliveries[0];
  for (var i = 0; i < enc.swapCap + 1; i++) {
    var out = Heist.fire(st, powers[i % 2], d);
    Heist.stop(st);
    if (i < enc.swapCap + 1) { assert.ok(!out.refused, 'change ' + i); }
  }
  var last = Heist.fire(st, powers[(enc.swapCap + 1) % 2], d);
  assert.ok(last.refused, 'one change past the cap is refused');
});
