/* tests/heist.test.js - the Factory Heist rules and campaign contract.
 *
 * tools/verify-heist.js is the design table (every floor winnable with the
 * powers unlocked by then, pars earned by a real run); this file runs it as
 * part of `npm test` and pins the rules the page relies on: the unlock order
 * covers every power exactly once, every power has a human label in the
 * registry, replays are exact, and strikes stun ordinary robots rather than
 * removing them.
 */

var test = require('node:test');
var assert = require('node:assert');
var path = require('path');
var childProcess = require('child_process');

var ROOT = path.join(__dirname, '..');
var Heist = require(path.join(ROOT, 'heist.js'));
var campaign = require(path.join(ROOT, 'campaign.js'));
var engine = require(path.join(ROOT, 'search.js'));

var LEVELS = campaign.HEIST_LEVELS;

test('verify-heist: all fifteen floors playable and on par', function () {
  var out = childProcess.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'verify-heist.js')], { encoding: 'utf8' });
  assert.strictEqual(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /ALL 15 FLOORS PLAYABLE AND ON PAR/);
});

test('the campaign has fifteen floors with 2-3 deliveries each', function () {
  assert.strictEqual(LEVELS.length, 15);
  LEVELS.forEach(function (lv) {
    var n = engine.parseGrid(lv.map).goals.length;
    assert.ok(n >= 2 && n <= 3, lv.id + ' has ' + n + ' deliveries');
    assert.ok(lv.teaches && lv.lesson, lv.id + ' names the concept it teaches');
  });
});

test('every power unlocks exactly once, and has a registry label', function () {
  var ids = Heist.POWERS.map(function (p) { return p.id; });
  var unlocks = campaign.HEIST_UNLOCKS.filter(Boolean);
  assert.deepStrictEqual(unlocks.slice().sort(), ids.slice().sort());
  ids.forEach(function (id) {
    var s = engine.STRATEGY_BY_ID[id];
    assert.ok(s, id + ' is in the engine registry');
    assert.ok(s.label && s.label !== id, id + ' has a human label, not its id');
  });
});

test('training hands out the first four algorithms two, one, one', function () {
  assert.deepStrictEqual(campaign.TRAINING_UNLOCKS.slice(0, 3), [['bfs', 'dfs'], ['astar'], ['dijkstra']]);
});

test('a log replays to the same run, including getting off a ride', function () {
  var lv = LEVELS[0];
  var st = Heist.create(lv);
  var d = st.deliveries[0];
  Heist.fire(st, 'bfs', { x: d.x, y: d.y });
  Heist.tick(st);
  Heist.tick(st);
  assert.ok(Heist.stop(st));
  Heist.tick(st);
  Heist.nudge(st, 0);
  var again = Heist.replay(lv, st.log);
  assert.deepStrictEqual(Heist.summary(again), Heist.summary(st));
  assert.deepStrictEqual(again.player, st.player);
});

test('a strike stuns an ordinary robot and drops what it carries', function () {
  var lv = LEVELS[0];
  var st = Heist.create(lv);
  var bot = st.bots[0];
  // Park the robot two cells from the cart, carrying a lockbox.
  bot.x = st.player.x + 2;
  bot.y = st.player.y;
  bot.carrying = { id: 99, x: 0, y: 0 };
  var out = Heist.fire(st, 'bfs', { x: bot.x, y: bot.y, botId: bot.id });
  assert.ok(out.hit, out.message);
  assert.strictEqual(bot.hp, 1, 'an ordinary robot is not removed');
  assert.ok(bot.stunned > 0, 'it is stunned');
  assert.strictEqual(bot.carrying, null);
  assert.ok(st.chests.some(function (c) { return c.id === 99; }), 'the lockbox is on the floor');
});

test('nudges cost charge, and free-walk makes them free', function () {
  var lv = LEVELS[0];
  var st = Heist.create(lv);
  Heist.nudge(st, 0);
  assert.strictEqual(st.spent, Heist.RULES.nudgeCost);
  var copy = Object.assign({}, lv, { freeWalk: true });
  var free = Heist.create(copy);
  Heist.nudge(free, 0);
  assert.strictEqual(free.spent, 0);
});
