/* heist.js - the Factory Heist simulation.
 *
 * The one gameplay simulator. Pure logic: no DOM, no canvas, no timers. It
 * loads as a plain script in the browser (search.js, maps.js, campaign.js and
 * shop.js first) and `require()`s in node, which is how tools/verify-heist.js
 * and the tests play whole levels headlessly.
 *
 * It owns no numbers of its own. The floor plan comes from maps.js by the
 * encounter's `mapId`; who is on the floor, what everything costs and how
 * the thieves behave come from campaign.js (Campaign.ECONOMY, Campaign.BOTS,
 * the encounter itself); boosts come from shop.js. docs/design/CAMPAIGN.md is
 * the design, and par there is measured with exactly the prices charged here.
 *
 * The rules, in one paragraph. The cart does not walk. The player aims a
 * power at a cell; the power (an engine strategy) searches from the cart, the
 * plot costs ceil(expansions / 10) charge and one tick, and the cart then
 * rides the route one cell per tick, paying each cell's terrain (plate 1,
 * oil 5 and a tick to climb out, a power cell pays 4 back). The route is a
 * searchlight: a hauler it touches is stunned and drops its lockbox, a scout
 * flees, and a foreman loses a plate - unless the zone proofs him against
 * that power. A foreman holds a delivery until his last plate goes. The
 * level is won by standing on every delivery and lost when charge hits zero.
 *
 * Everything the world does is driven by one seeded RNG and by searches, so
 * an encounter plus a log of actions replays identically.
 *
 *   Heist.create(enc, opts)                   -> state
 *   Heist.fire(state, powerId, target, opts)  -> outcome     (headless)
 *   Heist.openFire(state, powerId, target)    -> handle | { refused }
 *   Heist.stepFire(handle)                    -> step | null
 *   Heist.hotSwap(state, handle, powerId)     -> true | reason
 *   Heist.closeFire(state, handle)            -> outcome
 *   Heist.nudge(state, dir)                   -> outcome
 *   Heist.stop(state)                         -> abandons the current ride
 *   Heist.tick(state)                         -> waits one tick
 *   Heist.useBoost(state, id)                 -> true | reason
 *   Heist.stars(state), Heist.gold(state), Heist.summary(state)
 *   Heist.replay(enc, log, opts)              -> state
 */

var Heist = (function () {
  'use strict';

  var NODE = typeof module !== 'undefined' && module.exports;
  var E = NODE ? require('./search.js') : window.PathfinderEngine;
  var C = NODE ? require('./campaign.js') : window.Campaign;
  var Shop = NODE ? require('./shop.js') : window.Shop;
  var MAPS = NODE ? require('./maps.js').MAPS : window.MAPS;

  var ECON = C.ECONOMY;
  var BOTS = C.BOTS;
  var REVEAL = 2;          // how far the cart sees in the dark

  /* ------------------------------------------------------------- powers ---
   * A power IS an engine strategy. These are the names CAMPAIGN.md already
   * uses for them, plus a line of feel for the power card; everything about
   * how the search behaves is the engine registry's. */

  var POWERS = [
    { id: 'bfs', name: 'Sweep', feel: 'Rings out in every direction. Never wrong about steps, and pays for every cell in the room.' },
    { id: 'dfs', name: 'Bore', feel: 'One corridor all the way down. Nearly free to plot; the ride can be long and crooked.' },
    { id: 'dijkstra', name: 'Meter', feel: 'Counts oil as the five it really costs. Blind to where you aimed, so it spreads.' },
    { id: 'astar', name: 'Dart', feel: 'Leans at the target and stops the moment it arrives. Honest about oil.' },
    { id: 'greedy', name: 'Snap', feel: 'Runs at the target and never counts the bill. Cheapest plot, sometimes a silly ride.' },
    { id: 'wastar', name: 'Dial', feel: 'A dart with the greed turned up: plots for less, rides a little worse.' },
    { id: 'bibfs', name: 'Pincer', feel: 'Two waves, one from each end, meeting in the middle.' },
    { id: 'iddfs', name: 'Sonar', feel: 'Shallow, then deeper, then deeper again, holding almost nothing.' },
    { id: 'beam', name: 'Slitlamp', feel: 'Keeps only its best few leads. Tiny memory; it can walk past the door.' },
    { id: 'bellman', name: 'Relay', feel: 'Relaxes every edge, pass after pass, so a power cell can make a route cheaper late.' },
    { id: 'flow', name: 'Field', feel: 'One search backwards from the target that leaves a route on every tile.' },
    { id: 'wall', name: 'Wall hand', feel: 'One hand on the wall and walk. No frontier at all, so it plots for almost nothing.' }
  ];
  var POWER_BY_ID = {};
  POWERS.forEach(function (p) { POWER_BY_ID[p.id] = p; });

  /* ---------------------------------------------------------------- rng ---*/

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* -------------------------------------------------------------- board ---*/

  var DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];   // east, south, west, north

  function idx(grid, x, y) { return y * grid.w + x; }
  function inside(grid, x, y) { return x >= 0 && y >= 0 && x < grid.w && y < grid.h; }
  function glyph(grid, x, y) { return inside(grid, x, y) ? grid.cells[y][x] : '#'; }
  function isWall(grid, x, y) { return glyph(grid, x, y) === '#'; }
  function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

  // The engine's movement rule, so chutes stay one-way and teleport pads one
  // move apart for thieves as well as for a search.
  function canStep(grid, from, to) {
    return E.neighborsOf(grid, idx(grid, from.x, from.y)).indexOf(idx(grid, to.x, to.y)) !== -1;
  }

  function mapOf(enc) {
    for (var i = 0; i < MAPS.length; i++) { if (MAPS[i].id === enc.mapId) { return MAPS[i]; } }
    throw new Error('encounter ' + enc.level + ' names map ' + enc.mapId + ', which maps.js does not have');
  }

  /* --------------------------------------------------------------- state ---*/

  function create(enc, opts) {
    opts = opts || {};
    var map = mapOf(enc);
    var grid = E.parseGrid(map.ascii);
    var state = {
      enc: enc,
      map: map,
      zone: C.ZONE_BY_KEY[enc.zone],
      grid: grid,
      rng: mulberry32(enc.level * 1009 + 17),
      tick: 0,
      chargeMax: enc.startCharge,
      charge: enc.startCharge,
      spent: 0,
      player: { x: grid.start.x, y: grid.start.y, facing: 1 },
      ride: null,
      stall: 0,
      deliveries: grid.goals.map(function (g, i) {
        return { id: i, x: g.x, y: g.y, secured: false, heldBy: null, known: !enc.prizeBehaviour.hidden };
      }),
      bots: [],
      chests: [],
      pads: padsOf(grid),
      nextChest: 1,
      chestGold: 0,
      chestsTaken: 0,
      stolen: 0,
      plots: 0,
      hits: 0,
      lastPower: null,
      swaps: 0,
      swapCap: enc.swapCap,
      powers: (opts.powers || C.powersAt(enc.level)).slice(),
      boosts: {},
      boostUsedAt: {},
      starCap: undefined,
      freeze: 0,
      freeWalk: opts.freeWalk === true,
      status: 'playing',
      reason: '',
      revealed: [],
      log: [],
      events: []
    };
    Object.keys(opts.boosts || {}).forEach(function (id) {
      var b = Shop.BOOST_BY_ID[id];
      if (b) { state.boosts[id] = Math.min(b.perLevel, opts.boosts[id]); }
    });
    placeBots(state);
    revealAround(state, state.player.x, state.player.y, REVEAL);
    return state;
  }

  // Chest pads: the map's `$` cells. Extra `S` cells are thief bays.
  function padsOf(grid) {
    var out = [];
    for (var y = 0; y < grid.h; y++) {
      for (var x = 0; x < grid.w; x++) {
        if (grid.cells[y][x] === '$') { out.push({ x: x, y: y }); }
      }
    }
    return out;
  }

  // Foremen start on the deliveries they hold. Everyone else takes, in order,
  // the map's extra start bays, then its chest pads, then the floor cells
  // farthest from the cart - all deterministic, so a replay starts the same.
  function placeBots(state) {
    var enc = state.enc;
    var grid = state.grid;
    var taken = {};
    var id = 1;
    var held = enc.prizeBehaviour.heldByBoss.slice();
    function claim(p) { taken[idx(grid, p.x, p.y)] = true; }
    claim(state.player);
    state.deliveries.forEach(function (d) { claim(d); });

    enc.bots.forEach(function (group) {
      if (group.type !== 'boss') { return; }
      for (var n = 0; n < group.count; n++) {
        var d = state.deliveries[held.shift()];
        var bot = makeBot(id++, 'boss', d, group.hp);
        bot.holding = d.id;
        d.heldBy = bot.id;
        state.bots.push(bot);
      }
    });

    var spots = grid.starts.slice(1).concat(state.pads).concat(farCells(state));
    enc.bots.forEach(function (group) {
      if (group.type === 'boss') { return; }
      for (var n = 0; n < group.count; n++) {
        var at = null;
        while (spots.length && !at) {
          var c = spots.shift();
          if (!taken[idx(grid, c.x, c.y)]) { at = c; }
        }
        if (!at) { throw new Error('no room on ' + state.map.id + ' for thief ' + id); }
        claim(at);
        state.bots.push(makeBot(id++, group.type, at, 1));
      }
    });
  }

  function farCells(state) {
    var grid = state.grid;
    var d = bfsFrom(grid, state.player);
    var out = [];
    for (var y = 0; y < grid.h; y++) {
      for (var x = 0; x < grid.w; x++) {
        if (grid.cells[y][x] !== '.' || d[idx(grid, x, y)] === Infinity) { continue; }
        out.push({ x: x, y: y, d: d[idx(grid, x, y)] });
      }
    }
    out.sort(function (a, b) { return b.d - a.d || a.y - b.y || a.x - b.x; });
    return out;
  }

  function bfsFrom(grid, from) {
    var d = new Array(grid.w * grid.h);
    for (var i = 0; i < d.length; i++) { d[i] = Infinity; }
    var q = [idx(grid, from.x, from.y)];
    d[q[0]] = 0;
    for (var h = 0; h < q.length; h++) {
      E.neighborsOf(grid, q[h]).forEach(function (n) {
        if (d[n] === Infinity) { d[n] = d[q[h]] + 1; q.push(n); }
      });
    }
    return d;
  }

  function makeBot(id, type, at, hp) {
    var def = BOTS[type];
    return {
      id: id,
      type: type,
      name: def.name,
      sprite: type === 'boss' ? 'thief_hauler' : (type === 'fast' ? 'thief_sneak' : 'thief_scout'),
      x: at.x, y: at.y,
      den: { x: at.x, y: at.y },
      hp: hp,
      maxHp: hp,
      phase: id % def.cadence,
      facing: 1,
      stunned: 0,
      fleeing: 0,
      carrying: null,
      holding: null
    };
  }

  /* ----------------------------------------------------------------- fog ---*/

  function revealAround(state, x, y, r) {
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > r || !inside(state.grid, x + dx, y + dy)) { continue; }
        state.revealed[idx(state.grid, x + dx, y + dy)] = true;
      }
    }
    state.deliveries.forEach(function (d) {
      if (!d.known && state.revealed[idx(state.grid, d.x, d.y)]) {
        d.known = true;
        say(state, 'seen', 'A delivery turned up on the floor.');
      }
    });
  }

  // What the player can see. On a lit floor that is everything.
  function visible(state, x, y) {
    if (!state.enc.fog) { return true; }
    return !!state.revealed[idx(state.grid, x, y)];
  }

  /* -------------------------------------------------------------- lookup ---*/

  function deliveryAt(state, x, y) {
    for (var i = 0; i < state.deliveries.length; i++) {
      var d = state.deliveries[i];
      if (!d.secured && d.x === x && d.y === y) { return d; }
    }
    return null;
  }

  function botAt(state, x, y) {
    for (var i = 0; i < state.bots.length; i++) {
      var b = state.bots[i];
      if (b.hp > 0 && b.x === x && b.y === y) { return b; }
    }
    return null;
  }

  function botById(state, id) {
    for (var i = 0; i < state.bots.length; i++) { if (state.bots[i].id === id) { return state.bots[i]; } }
    return null;
  }

  function chestAt(state, x, y) {
    for (var i = 0; i < state.chests.length; i++) {
      if (state.chests[i].x === x && state.chests[i].y === y) { return state.chests[i]; }
    }
    return null;
  }

  function openDeliveries(state) { return state.deliveries.filter(function (d) { return !d.secured; }); }
  function liveBots(state) { return state.bots.filter(function (b) { return b.hp > 0; }); }
  function botName(bot) { return bot.name; }
  function say(state, kind, text) { state.events.push({ kind: kind, text: text, tick: state.tick }); }

  /* -------------------------------------------------------------- charge ---
   * `spent` is what stars count: every plot, ride and nudge, net of power
   * cells ridden over, and every ram. Recharges and lockboxes add charge
   * without un-spending any, as CAMPAIGN.md prices them. */

  function spend(state, amount, why) {
    state.spent += amount;
    state.charge -= amount;
    if (state.charge <= 0) {
      state.charge = 0;
      lose(state, why || 'The charge meter hit zero with deliveries still open.');
    }
  }

  function gain(state, amount) { state.charge += amount; }

  function lose(state, reason) {
    if (state.status !== 'playing') { return; }
    state.status = 'lost';
    state.reason = reason;
    state.ride = null;
  }

  function win(state) {
    if (state.status !== 'playing') { return; }
    state.status = 'won';
    state.reason = 'Every delivery secured.';
    state.ride = null;
  }

  /* ---------------------------------------------------------------- plot ---
   * A plot is one search. The page watches it expand and may hot swap half
   * way; the tools want the answer at once. Both go open -> drive -> close,
   * so there is one set of rules. */

  function swapsLeft(state) { return state.swapCap - state.swaps; }

  // The registry defaults, exactly as tools/verify-campaign.js measures par.
  function paramsFor(powerId) { return E.defaultParams(powerId); }

  function openFire(state, powerId, target) {
    if (state.status !== 'playing') { return { refused: 'The shift is over.' }; }
    var power = POWER_BY_ID[powerId];
    if (!power || state.powers.indexOf(powerId) < 0) { return { refused: 'That power is not unlocked yet.' }; }
    if (state.lastPower !== null && state.lastPower !== powerId && swapsLeft(state) <= 0) {
      return { refused: 'No power changes left on this floor (' + state.swapCap + ' allowed).' };
    }
    var params = paramsFor(powerId);
    params.from = { x: state.player.x, y: state.player.y };
    params.to = { x: target.x, y: target.y };
    params.targets = [{ x: target.x, y: target.y }];
    params.fog = !!state.enc.fog;
    params.hideGoal = !!state.enc.prizeBehaviour.hidden;
    return {
      powerId: powerId,
      power: power,
      firstPower: powerId,
      target: { x: target.x, y: target.y },
      swaps: [],
      search: E.createSearch(state.grid, powerId, params),
      done: false
    };
  }

  function stepFire(handle) {
    if (!handle || handle.done) { return null; }
    var step = E.stepSearch(handle.search);
    // The engine marks a run done on the step that reaches the target; a
    // further stepSearch would keep expanding, so stop on either signal.
    if (!step || handle.search.done) { handle.done = true; }
    return step;
  }

  // A hot swap is a power change like any other, so it spends the swap cap.
  function hotSwap(state, handle, powerId) {
    if (!handle || handle.done) { return 'The search is already over.'; }
    if (powerId === handle.powerId) { return 'That power is already running.'; }
    if (state.powers.indexOf(powerId) < 0) { return 'That power is not unlocked yet.'; }
    if (swapsLeft(state) - pendingSwaps(state, handle) <= 0) { return 'No power changes left on this floor.'; }
    var power = POWER_BY_ID[powerId];
    if (!E.switchStrategy(handle.search, powerId, paramsFor(powerId))) {
      return power.name + ' has its own shape and cannot take over a search.';
    }
    handle.swaps.push({ atStep: handle.search.expansions, to: powerId });
    handle.powerId = powerId;
    handle.power = power;
    return true;
  }

  function pendingSwaps(state, handle) {
    var change = state.lastPower !== null && state.lastPower !== handle.firstPower ? 1 : 0;
    return change + handle.swaps.length;
  }

  function closeFire(state, handle) {
    if (!handle || handle.refused) { return null; }
    while (!handle.done) { stepFire(handle); }
    return applyPlot(state, handle, E.traceOf(handle.search));
  }

  // Headless: the same plot, run to the end, with an optional schedule of
  // {atStep, to} swaps so a replay reproduces an interactive hot swap.
  function fire(state, powerId, target, opts) {
    opts = opts || {};
    var handle = openFire(state, powerId, target);
    if (handle.refused) { return { refused: handle.refused, message: handle.refused }; }
    var schedule = (opts.swaps || []).slice();
    while (!handle.done) {
      while (schedule.length && handle.search.expansions >= schedule[0].atStep) {
        hotSwap(state, handle, schedule.shift().to);
      }
      stepFire(handle);
    }
    return applyPlot(state, handle, E.traceOf(handle.search));
  }

  function applyPlot(state, handle, trace) {
    var cost = C.plotCharge(trace);
    var out = { powerId: handle.powerId, target: handle.target, trace: trace, cost: cost, rode: false, hit: false, message: '' };
    state.plots++;
    state.swaps += pendingSwaps(state, handle);
    state.lastPower = handle.powerId;
    state.log.push(['f', handle.firstPower, handle.target.x, handle.target.y, handle.swaps]);
    trace.steps.forEach(function (st) { revealAround(state, st.x, st.y, 1); });
    spend(state, cost, 'The last plot emptied the charge meter.');
    if (state.status !== 'playing') { out.message = 'Out of charge.'; return out; }

    if (state.enc.memoryCap !== null && trace.peakFrontier > state.enc.memoryCap) {
      out.message = handle.power.name + ' held ' + trace.peakFrontier + ' leads, more than the ' + state.enc.memoryCap +
        ' this floor allows. It overheated: ' + cost + ' charge and the cart did not move.';
      worldTick(state);
      return out;
    }
    if (!trace.found || trace.path.length < 2) {
      out.message = handle.power.name + ' found no route from here. ' + cost + ' charge spent all the same.';
      worldTick(state);
      return out;
    }

    // The route is a searchlight: whatever stands on it is lit. A foreman
    // still standing blocks the ride at his cell.
    var path = trace.path.slice(1);
    var stopAt = path.length;
    for (var i = 0; i < path.length; i++) {
      var bot = botAt(state, path[i].x, path[i].y);
      if (!bot) { continue; }
      var lit = light(state, bot, handle.power, out);
      if (bot.type === 'boss' && lit !== 'dead' && stopAt === path.length) { stopAt = i; }
    }
    path = path.slice(0, stopAt);
    worldTick(state);                          // the plot itself takes a tick
    if (path.length && state.status === 'playing') {
      state.ride = { path: path, i: 0, power: handle.powerId };
      out.rode = true;
    }
    if (!out.message) {
      out.message = path.length
        ? handle.power.name + ' plotted ' + path.length + ' cells for ' + cost + ' charge.'
        : handle.power.name + ' plotted for ' + cost + ' charge and went nowhere.';
    }
    return out;
  }

  function light(state, bot, power, out) {
    var def = BOTS[bot.type];
    if (def.onLit === 'stun') {
      bot.stunned = def.stunTicks;
      dropCargo(state, bot);
      say(state, 'hit', 'A hauler bot is stunned.');
      return 'stunned';
    }
    if (def.onLit === 'flee') {
      bot.fleeing = def.fleeTicks;
      say(state, 'hit', 'A scout runs from the light.');
      return 'fled';
    }
    if (state.zone.bossShieldedFrom === power.id) {
      out.message = 'The foreman is proofed against ' + power.name + ' in ' + state.zone.name + '. It lit him and did nothing.';
      return 'proofed';
    }
    bot.hp -= 1;
    state.hits++;
    out.hit = true;
    if (bot.hp > 0) {
      out.message = power.name + ' took a plate off the foreman: ' + bot.hp + ' left.';
      say(state, 'hit', 'Foreman hit, ' + bot.hp + ' left.');
      return 'hit';
    }
    var d = bot.holding !== null ? state.deliveries[bot.holding] : null;
    if (d) {
      d.heldBy = null;
      d.x = bot.x;
      d.y = bot.y;
      d.known = true;
    }
    bot.holding = null;
    out.message = power.name + ' took the foreman\'s last plate. He dropped the delivery where he stood.';
    say(state, 'delivery', 'The foreman is down.');
    return 'dead';
  }

  function dropCargo(state, bot) {
    if (!bot.carrying) { return; }
    if (!chestAt(state, bot.x, bot.y)) {
      bot.carrying.x = bot.x;
      bot.carrying.y = bot.y;
      state.chests.push(bot.carrying);
    }
    bot.carrying = null;
  }

  /* ------------------------------------------------------ nudge and stop ---*/

  function nudge(state, dir) {
    if (state.status !== 'playing') { return null; }
    var d = DIRS[dir & 3];
    var to = { x: state.player.x + d[0], y: state.player.y + d[1] };
    if (!canStep(state.grid, state.player, to)) { return { moved: false, message: 'A wall. The cart does not climb.' }; }
    if (botAt(state, to.x, to.y)) { return { moved: false, message: 'A thief is standing there.' }; }
    state.player.facing = dir & 3;
    state.ride = null;
    state.log.push(['n', dir & 3]);
    if (!state.freeWalk) {
      spend(state, E.cellCost(state.grid, to.x, to.y) + ECON.nudgeSurcharge, 'The last nudge emptied the charge meter.');
    }
    if (state.status === 'playing') { movePlayerTo(state, to.x, to.y); }
    worldTick(state);
    return { moved: true, message: '' };
  }

  // Getting off a ride is a decision, so it goes in the log.
  function stop(state) {
    if (state.status !== 'playing' || !state.ride) { return false; }
    state.ride = null;
    state.log.push(['s']);
    return true;
  }

  /* --------------------------------------------------------------- boosts ---*/

  function useBoost(state, id) {
    var b = Shop.BOOST_BY_ID[id];
    if (!b) { return 'No such boost.'; }
    if (state.status !== 'playing') { return 'The shift is over.'; }
    if (!state.boosts[id]) { return 'You are not carrying a ' + b.name + '.'; }
    var last = state.boostUsedAt[id];
    if (last !== undefined && b.cooldown && state.tick - last < b.cooldown) {
      return b.name + ' is cooling down for ' + (b.cooldown - (state.tick - last)) + ' more ticks.';
    }
    state.boosts[id]--;
    state.boostUsedAt[id] = state.tick;
    state.log.push(['b', id]);
    var fx = b.effect;
    if (fx.charge) { gain(state, fx.charge); }
    if (fx.freezeTicks) { state.freeze += fx.freezeTicks; }
    if (fx.revealRadius) { revealAround(state, state.player.x, state.player.y, fx.revealRadius); }
    if (fx.swapCap) { state.swapCap += fx.swapCap; }
    if (b.capsStars !== null) { state.starCap = Math.min(state.starCap === undefined ? 3 : state.starCap, b.capsStars); }
    say(state, 'boost', b.name + ' used.');
    return true;
  }

  /* ----------------------------------------------------------------- tick ---*/

  function tick(state) {
    if (state.status !== 'playing') { return; }
    state.log.push(['t']);
    advance(state);
  }

  // One tick: the cart rides a cell (or climbs out of oil), then the world.
  function advance(state) {
    if (state.status !== 'playing') { return; }
    if (state.stall > 0) {
      state.stall--;
    } else if (state.ride) {
      var next = state.ride.path[state.ride.i];
      if (botAt(state, next.x, next.y)) {
        say(state, 'bump', 'A thief is in the way; the cart waits.');
      } else {
        state.ride.i++;
        if (state.ride.i >= state.ride.path.length) { state.ride = null; }
        var f = facing(state.player, next);
        if (f !== null) { state.player.facing = f; }
        spend(state, E.cellCost(state.grid, next.x, next.y), 'The ride emptied the charge meter.');
        if (state.status === 'playing') {
          movePlayerTo(state, next.x, next.y);
          if (glyph(state.grid, next.x, next.y) === '~') { state.stall = ECON.oilStallTicks; }
        }
      }
    }
    worldTick(state);
  }

  function facing(from, to) {
    for (var i = 0; i < DIRS.length; i++) {
      if (from.x + DIRS[i][0] === to.x && from.y + DIRS[i][1] === to.y) { return i; }
    }
    return null;
  }

  function movePlayerTo(state, x, y) {
    state.player.x = x;
    state.player.y = y;
    revealAround(state, x, y, REVEAL);
    var chest = chestAt(state, x, y);
    if (chest) {
      state.chests.splice(state.chests.indexOf(chest), 1);
      state.chestsTaken++;
      state.chestGold += state.enc.chestRules.gold;
      gain(state, state.enc.chestRules.charge);
      say(state, 'chest', 'Lockbox recovered: +' + state.enc.chestRules.gold + ' gold, +' + state.enc.chestRules.charge + ' charge.');
    }
    var d = deliveryAt(state, x, y);
    if (d && d.heldBy === null) {
      d.secured = true;
      say(state, 'delivery', 'Delivery secured.');
      if (!openDeliveries(state).length) { win(state); }
    }
  }

  function worldTick(state) {
    if (state.status !== 'playing') { return; }
    state.tick++;
    spawnChest(state);
    if (state.freeze > 0) {
      state.freeze--;
    } else {
      moveBots(state);
    }
  }

  /* --------------------------------------------------------------- chests ---*/

  function spawnChest(state) {
    var rules = state.enc.chestRules;
    if (!rules.every || state.tick % rules.every !== 0) { return; }
    var carried = state.bots.filter(function (b) { return b.carrying; }).length;
    if (state.chests.length + carried >= rules.max) { return; }
    var spot = freePad(state) || randomFloor(state);
    if (!spot) { return; }
    state.chests.push({ id: state.nextChest++, x: spot.x, y: spot.y });
    say(state, 'spawn', 'A lockbox dropped on the floor.');
  }

  function free(state, x, y) {
    return glyph(state.grid, x, y) !== '#' && !(state.player.x === x && state.player.y === y) &&
      !deliveryAt(state, x, y) && !botAt(state, x, y) && !chestAt(state, x, y);
  }

  function freePad(state) {
    var open = state.pads.filter(function (p) { return free(state, p.x, p.y); });
    return open.length ? open[Math.floor(state.rng() * open.length)] : null;
  }

  function randomFloor(state) {
    var grid = state.grid;
    for (var tries = 0; tries < 80; tries++) {
      var x = Math.floor(state.rng() * grid.w);
      var y = Math.floor(state.rng() * grid.h);
      var ch = glyph(grid, x, y);
      if (ch !== '.' && ch !== '$') { continue; }
      if (dist({ x: x, y: y }, state.player) < 4 || !free(state, x, y)) { continue; }
      return { x: x, y: y };
    }
    return null;
  }

  /* ---------------------------------------------------------------- bots ---*/

  function moveBots(state) {
    liveBots(state).forEach(function (bot) {
      if (state.status !== 'playing') { return; }
      var def = BOTS[bot.type];
      if (bot.stunned > 0) { bot.stunned--; return; }
      if ((state.tick + bot.phase) % def.cadence !== 0) { return; }
      for (var s = 0; s < def.speed && state.status === 'playing'; s++) {
        if (!stepBot(state, bot, def)) { break; }
      }
      if (bot.fleeing > 0) { bot.fleeing--; }
    });
  }

  function stepBot(state, bot, def) {
    var next;
    if (bot.type === 'boss' || bot.fleeing > 0) {
      next = awayFromCart(state, bot);
    } else if (bot.type === 'fast') {
      next = dist(bot, state.player) <= def.aggroRange ? toward(state, bot, state.player, def.plans) : wander(state, bot);
    } else {
      var goal = haulerGoal(state, bot);
      next = goal ? toward(state, bot, goal, def.plans) : wander(state, bot);
    }
    if (!next) { return false; }
    var f = facing(bot, next);
    if (f !== null) { bot.facing = f; }

    if (state.player.x === next.x && state.player.y === next.y) {
      spend(state, def.drain, 'A thief rammed the cart with the meter already empty.');
      say(state, 'bump', bot.name + ' rammed the cart: -' + def.drain + ' charge.');
      return false;
    }
    if (botAt(state, next.x, next.y)) { return false; }

    var d = deliveryAt(state, next.x, next.y);
    if (d && d.heldBy !== bot.id) {
      // A hauler shoves a free delivery one cell when it walks into it, so
      // the red point the player is aiming at moves. Nobody else touches it.
      if (bot.type !== 'basic' || d.heldBy !== null) { return false; }
      var px = d.x + (next.x - bot.x);
      var py = d.y + (next.y - bot.y);
      if (!canStep(state.grid, d, { x: px, y: py }) || !free(state, px, py)) { return false; }
      d.x = px;
      d.y = py;
      say(state, 'shove', 'A hauler bot shoved a delivery.');
    }

    bot.x = next.x;
    bot.y = next.y;
    if (bot.holding !== null) {
      var held = state.deliveries[bot.holding];
      held.x = bot.x;
      held.y = bot.y;
    }
    if (bot.type === 'basic') {
      var chest = chestAt(state, bot.x, bot.y);
      if (chest && !bot.carrying) {
        state.chests.splice(state.chests.indexOf(chest), 1);
        bot.carrying = chest;
        say(state, 'steal', 'A hauler bot picked up a lockbox.');
      } else if (bot.carrying && bot.x === bot.den.x && bot.y === bot.den.y) {
        bot.carrying = null;
        state.stolen++;
        say(state, 'lost', 'A lockbox left the floor with a hauler bot.');
      }
    }
    return true;
  }

  // Lockboxes, then free deliveries to shove, else patrol. Carrying: home.
  function haulerGoal(state, bot) {
    if (bot.carrying) { return bot.den; }
    var target = nearest(bot, state.chests) ||
      nearest(bot, openDeliveries(state).filter(function (d) { return d.heldBy === null; }));
    return target ? { x: target.x, y: target.y } : null;
  }

  function nearest(from, list) {
    var best = null;
    list.forEach(function (it) { if (!best || dist(from, it) < dist(from, best)) { best = it; } });
    return best;
  }

  function toward(state, bot, goal, strategy) {
    if (bot.x === goal.x && bot.y === goal.y) { return null; }
    var trace = null;
    try {
      trace = E.search(state.grid, strategy, {
        from: { x: bot.x, y: bot.y }, to: { x: goal.x, y: goal.y },
        targets: [{ x: goal.x, y: goal.y }], expansionCap: 3000
      });
    } catch (err) {
      trace = null;
    }
    if (!trace || !trace.found || trace.path.length < 2) { return wander(state, bot); }
    return { x: trace.path[1].x, y: trace.path[1].y };
  }

  function options(state, bot) {
    var out = [];
    for (var i = 0; i < DIRS.length; i++) {
      var n = { x: bot.x + DIRS[i][0], y: bot.y + DIRS[i][1] };
      if (!canStep(state.grid, bot, n) || botAt(state, n.x, n.y)) { continue; }
      out.push(n);
    }
    return out;
  }

  function wander(state, bot) {
    var opts = options(state, bot);
    return opts.length ? opts[Math.floor(state.rng() * opts.length)] : null;
  }

  // A foreman drags his delivery away from the cart; a lit scout runs.
  function awayFromCart(state, bot) {
    var here = dist(bot, state.player);
    var best = null;
    options(state, bot).forEach(function (n) {
      if (deliveryAt(state, n.x, n.y) || (state.player.x === n.x && state.player.y === n.y)) { return; }
      var d = dist(n, state.player);
      if (d > here && (!best || d > dist(best, state.player))) { best = n; }
    });
    return best;
  }

  /* -------------------------------------------------------------- scoring ---*/

  function outcome(state) {
    return { won: state.status === 'won', ticks: state.tick, chargeSpent: state.spent, starCap: state.starCap, chestGold: state.chestGold };
  }

  function stars(state) { return C.starsFor(state.enc, outcome(state)); }
  function gold(state) { return C.goldFor(state.enc, outcome(state)); }

  function summary(state) {
    return {
      status: state.status,
      stars: stars(state),
      gold: gold(state),
      ticks: state.tick,
      spent: state.spent,
      plots: state.plots,
      hits: state.hits,
      swaps: state.swaps,
      chests: state.chestsTaken,
      stolen: state.stolen,
      secured: state.deliveries.filter(function (d) { return d.secured; }).length,
      deliveries: state.deliveries.length
    };
  }

  /* --------------------------------------------------------------- replay ---*/

  function replay(enc, log, opts) {
    var state = create(enc, opts);
    for (var i = 0; i < log.length && state.status === 'playing'; i++) {
      var a = log[i];
      if (a[0] === 'f') { fire(state, a[1], { x: a[2], y: a[3] }, { swaps: a[4] || [] }); }
      else if (a[0] === 'n') { nudge(state, a[1]); }
      else if (a[0] === 's') { stop(state); }
      else if (a[0] === 'b') { useBoost(state, a[1]); }
      else { tick(state); }
    }
    return state;
  }

  return {
    POWERS: POWERS,
    POWER_BY_ID: POWER_BY_ID,
    DIRS: DIRS,
    mapOf: mapOf,
    create: create,
    fire: fire,
    openFire: openFire,
    stepFire: stepFire,
    hotSwap: hotSwap,
    closeFire: closeFire,
    nudge: nudge,
    stop: stop,
    useBoost: useBoost,
    tick: tick,
    advance: advance,
    stars: stars,
    gold: gold,
    summary: summary,
    replay: replay,
    visible: visible,
    isWall: isWall,
    canStep: canStep,
    botAt: botAt,
    botById: botById,
    chestAt: chestAt,
    deliveryAt: deliveryAt,
    openDeliveries: openDeliveries,
    liveBots: liveBots,
    botName: botName,
    swapsLeft: swapsLeft
  };
}());

if (typeof module !== 'undefined' && module.exports) { module.exports = Heist; }
