/* heist.js - the Factory Heist simulation.
 *
 * Pure game logic: no DOM, no canvas, no timers. It loads as a plain script
 * in the browser (search.js first) and `require()`s in node, which is how
 * tools/verify-heist.js and the tests play whole levels headlessly.
 *
 * The rules, in one paragraph. The dispatcher cannot walk. It moves by
 * RIDING a path that a power found: aim a power at a cell, the search runs,
 * its expansions are drained from the charge bar, and the cart rides the path
 * it returned one cell per TICK. Thieving robots move on their own timers,
 * shove the red deliveries around, and steal the lockboxes that pop up on the
 * floor. A power aimed at a robot is a STRIKE instead of a ride: it lands if
 * the path reaches him inside the power's reach. The level is won by standing
 * on every delivery and lost when the charge hits zero.
 *
 * Everything the world does is driven by one seeded RNG and by searches, so
 * a level plus a log of actions replays identically - which is what
 * Heist.replay() and the par tuner rely on.
 *
 *   Heist.create(level)                       -> state
 *   Heist.fire(state, powerId, target, opts)  -> outcome     (headless)
 *   Heist.openFire(state, powerId, target)    -> handle      (animated)
 *   Heist.stepFire(handle)                    -> step | null
 *   Heist.hotSwap(state, handle, powerId)     -> bool
 *   Heist.closeFire(state, handle)            -> outcome
 *   Heist.nudge(state, dir)                   -> outcome
 *   Heist.tick(state)                         -> advances one tick
 *   Heist.stars(state)                        -> 0..3
 *   Heist.replay(level, log)                  -> state
 */

var Heist = (function () {
  'use strict';

  // search.js keeps itself in one closure and publishes PathfinderEngine, so
  // this file names the engine the same way in both worlds and adds no
  // globals of its own beyond Heist.
  var E = (typeof module !== 'undefined' && module.exports)
    ? require('./search.js')
    : window.PathfinderEngine;

  /* ------------------------------------------------------------- tuning ---
   * One place for every number the rules depend on. verify-heist.js reads
   * these, so a change here shows up as a pars change rather than silently. */

  var RULES = {
    nudgeCost: 12,          // a one-cell shove of the cart, in charge
    bumpCost: 25,           // a robot walking into you
    chestCharge: 35,        // a lockbox you reach first pays for itself
    chestScore: 100,
    stunTicks: 6,           // how long a hit robot sits still
    bossStun: 3,
    cellCharge: 70,         // a power cell on the floor, once
    strikeTick: 1,          // a strike costs a tick whether it lands or not
    oilStall: 1             // extra ticks spent wading out of oil
  };

  /* ------------------------------------------------------------- powers ---
   *
   * A power IS an algorithm: firing it runs that strategy from the cart's
   * cell, and the expansions it spends are the charge it costs. `reach` is
   * how far a strike can land, which is the one thing the fiction adds on
   * top of the search - a sweep is short-ranged, a dart is long, the drone
   * that hugs walls will follow them a very long way.
   */

  var POWERS = [
    { id: 'bfs', name: 'Sweep Pulse', reach: 9,
      feel: 'Rings out in every direction. Cheap up close, ruinous across a big floor.',
      bestAt: 'Short hops, and fog - it needs to know nothing about where it is going.' },
    { id: 'dfs', name: 'Snake Probe', reach: 14,
      feel: 'One corridor at a time, all the way down. Long reach, crooked route.',
      bestAt: 'Getting somewhere at all when memory, not distance, is the problem.' },
    { id: 'dijkstra', name: 'Cost Crawler', reach: 10,
      feel: 'Counts oil as the five ticks it really is. Blind to where you aimed.',
      bestAt: 'Oil floors, power cells, and any route where cost is not distance.' },
    { id: 'astar', name: 'Dart', reach: 13,
      feel: 'Leans straight at the target and stops as soon as it arrives.',
      bestAt: 'An open line to a target you can see. The cheapest ride in the game.' },
    { id: 'greedy', name: 'Rush Beam', reach: 12,
      feel: 'Runs at the target and never counts the bill. Fast, and sometimes silly.',
      bestAt: 'A clear shot when you need it now and do not care what it cost you.' },
    { id: 'wastar', name: 'Tuned Dart', reach: 13, params: { weight: 2.5 },
      feel: 'A dart with the greed dialled up: fewer expansions, a slightly worse route.',
      bestAt: 'A long ride you can afford to take crookedly.' },
    { id: 'bibfs', name: 'Pincer', reach: 11,
      feel: 'Two waves, one from each end, meeting in the middle.',
      bestAt: 'A long ride to a target that is standing still.' },
    { id: 'iddfs', name: 'Deep Ping', reach: 10, params: { maxDepth: 26 },
      feel: 'Searches shallow, then deeper, then deeper again, holding almost nothing.',
      bestAt: 'When the frontier is what is expensive, not the clock.' },
    { id: 'beam', name: 'Narrow Beam', reach: 12, params: { k: 12 },
      feel: 'Keeps only the best dozen leads and throws the rest away.',
      bestAt: 'A cheap guess at a far target. It can walk straight past the door.' },
    { id: 'bellman', name: 'Relay Net', reach: 8,
      feel: 'Relaxes every edge, pass after pass, so a refund can make a route cheaper late.',
      bestAt: 'Floors with power cells on them. It is the only power that banks the refund.' },
    { id: 'flow', name: 'Flow Field', reach: 10,
      feel: 'One search backwards from the target that leaves a route on every tile.',
      bestAt: 'A crowded floor: the field it leaves behind answers for everything at once.' },
    { id: 'wall', name: 'Wall Drone', reach: 22, params: { maxSteps: 900 },
      feel: 'One hand on the wall and walk. No frontier at all, so it costs almost nothing.',
      bestAt: 'A maze, where the wall it is holding is joined to the wall you want.' }
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

  function inside(grid, x, y) {
    return x >= 0 && y >= 0 && x < grid.w && y < grid.h;
  }

  function glyph(grid, x, y) {
    return inside(grid, x, y) ? grid.cells[y][x] : '#';
  }

  function isWall(grid, x, y) { return glyph(grid, x, y) === '#'; }

  // The one movement rule, borrowed from the engine so chutes stay one-way
  // and teleport pads stay one move apart for robots as well as for a search.
  function canStep(grid, from, to) {
    var legal = E.neighborsOf(grid, idx(grid, from.x, from.y));
    return legal.indexOf(idx(grid, to.x, to.y)) !== -1;
  }

  function stepCost(grid, x, y) {
    return E.cellCost(grid, x, y);
  }

  /* --------------------------------------------------------------- state ---*/

  function create(level) {
    var grid = E.parseGrid(level.map);
    var state = {
      level: level,
      grid: grid,
      rng: mulberry32((level.seed || 1) >>> 0),
      tick: 0,
      chargeMax: level.charge,
      charge: level.charge,
      spent: 0,
      player: { x: grid.start.x, y: grid.start.y, facing: 1 },
      ride: null,
      stall: 0,
      deliveries: grid.goals.map(function (g, i) {
        return { id: i, x: g.x, y: g.y, secured: false };
      }),
      bots: (level.bots || []).map(function (def, i) { return makeBot(def, i, grid); }),
      chests: [],
      cells: cellsOf(grid),            // power cells, spent once each
      nextChest: 1,
      score: 0,
      stolen: 0,
      hits: 0,
      shots: 0,
      swaps: 0,
      status: 'playing',
      reason: '',
      revealed: level.fog ? [] : null,
      log: [],
      events: []
    };
    if (state.revealed) { revealAround(state, state.player.x, state.player.y, 2); }
    return state;
  }

  // A bot's spawn and den are written into the map as waypoint letters (A-F),
  // so a level never carries hand-counted coordinates that can drift when a
  // row is edited. A literal {x, y} still works.
  function placeOf(grid, where) {
    if (!where) { return null; }
    if (typeof where === 'string') {
      for (var i = 0; i < grid.waypoints.length; i++) {
        if (grid.waypoints[i].letter === where) {
          return { x: grid.waypoints[i].x, y: grid.waypoints[i].y };
        }
      }
      throw new Error('no marker "' + where + '" on this map');
    }
    return { x: where.x, y: where.y };
  }

  function makeBot(def, i, grid) {
    var at = placeOf(grid, def.at);
    var den = placeOf(grid, def.den) || { x: at.x, y: at.y };
    return {
      id: i + 1,
      kind: def.kind || 'scout',
      sprite: def.sprite || spriteFor(def.kind || 'scout'),
      strategy: def.strategy || 'bfs',
      name: def.name || null,
      x: at.x, y: at.y,
      den: den,
      hp: def.hp || 1,
      maxHp: def.hp || 1,
      period: def.period || 2,
      phase: def.phase === undefined ? i : def.phase,
      facing: 1,
      stunned: 0,
      carrying: null,
      route: null,
      routeKey: ''
    };
  }

  function spriteFor(kind) {
    if (kind === 'hauler') { return 'thief_hauler'; }
    if (kind === 'sneak') { return 'thief_sneak'; }
    return 'thief_scout';
  }

  function cellsOf(grid) {
    var out = [];
    for (var y = 0; y < grid.h; y++) {
      for (var x = 0; x < grid.w; x++) {
        if (grid.cells[y][x] === 'v') { out.push({ x: x, y: y, spent: false }); }
      }
    }
    return out;
  }

  /* ----------------------------------------------------------------- fog ---*/

  function revealAround(state, x, y, r) {
    if (!state.revealed) { return; }
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > r) { continue; }
        if (!inside(state.grid, x + dx, y + dy)) { continue; }
        state.revealed[idx(state.grid, x + dx, y + dy)] = true;
      }
    }
  }

  function visible(state, x, y) {
    if (!state.revealed) { return true; }
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

  function chestAt(state, x, y) {
    for (var i = 0; i < state.chests.length; i++) {
      if (state.chests[i].x === x && state.chests[i].y === y) { return state.chests[i]; }
    }
    return null;
  }

  function openDeliveries(state) {
    return state.deliveries.filter(function (d) { return !d.secured; });
  }

  function liveBots(state) {
    return state.bots.filter(function (b) { return b.hp > 0; });
  }

  function say(state, kind, text) {
    state.events.push({ kind: kind, text: text, tick: state.tick });
  }

  /* --------------------------------------------------------------- charge ---*/

  function spend(state, amount, why) {
    state.spent += amount;
    state.charge -= amount;
    if (state.charge <= 0) {
      state.charge = 0;
      lose(state, why || 'The charge bar hit zero with deliveries still open.');
    }
  }

  function gain(state, amount) {
    state.charge = Math.min(state.chargeMax, state.charge + amount);
  }

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

  /* ---------------------------------------------------------------- fire ---
   *
   * A shot is one search. The UI wants to watch it expand cell by cell and
   * to be able to hot swap the strategy half way through; the tuner and the
   * tests want the answer immediately. Both go through the same three steps -
   * open, drive, close - so there is one set of rules and no second copy.
   */

  function powerParams(state, power, target, kind) {
    var level = state.level;
    var p = {};
    var k;
    if (power.params) {
      for (k in power.params) {
        if (Object.prototype.hasOwnProperty.call(power.params, k)) { p[k] = power.params[k]; }
      }
    }
    p.from = { x: state.player.x, y: state.player.y };
    p.to = { x: target.x, y: target.y };
    p.targets = [{ x: target.x, y: target.y }];
    if (level.fog) { p.fog = true; }
    p.swapPenalty = level.swapPenalty === undefined ? 5 : level.swapPenalty;
    if (kind === 'strike') {
      // A strike is a shot, not a survey: it gives up rather than combing the
      // whole floor for a robot that has already gone.
      p.expansionCap = Math.max(60, power.reach * 40);
    }
    return p;
  }

  function targetKind(state, target) {
    if (target.botId) { return 'strike'; }
    return 'ride';
  }

  function openFire(state, powerId, target) {
    if (state.status !== 'playing') { return null; }
    var power = POWER_BY_ID[powerId];
    if (!power) { return null; }
    var kind = targetKind(state, target);
    var params = powerParams(state, power, target, kind);
    return {
      powerId: powerId,
      power: power,
      kind: kind,
      target: { x: target.x, y: target.y, botId: target.botId || null },
      swaps: [],
      search: E.createSearch(state.grid, power.id, params),
      done: false
    };
  }

  function stepFire(handle) {
    if (!handle || handle.done) { return null; }
    var step = E.stepSearch(handle.search);
    if (!step) { handle.done = true; }
    return step;
  }

  function hotSwap(state, handle, powerId) {
    if (!handle || handle.done) { return false; }
    var power = POWER_BY_ID[powerId];
    if (!power) { return false; }
    var ok = E.switchStrategy(handle.search, power.id, power.params || {});
    if (!ok) { return false; }
    handle.swaps.push({ atStep: handle.search.expansions, to: powerId });
    handle.powerId = powerId;
    handle.power = power;
    state.swaps++;
    return true;
  }

  function closeFire(state, handle) {
    if (!handle) { return null; }
    while (!handle.done) { stepFire(handle); }
    var trace = E.traceOf(handle.search);
    return applyShot(state, handle, trace);
  }

  // Headless: the same shot, run to the end, with an optional swap schedule
  // of {atStep, to} so a replay reproduces an interactive hot swap exactly.
  function fire(state, powerId, target, opts) {
    opts = opts || {};
    var handle = openFire(state, powerId, target);
    if (!handle) { return null; }
    var schedule = (opts.swaps || []).slice();
    while (!handle.done) {
      while (schedule.length && handle.search.expansions >= schedule[0].atStep) {
        var s = schedule.shift();
        hotSwap(state, handle, s.to);
      }
      stepFire(handle);
    }
    var trace = E.traceOf(handle.search);
    return applyShot(state, handle, trace);
  }

  function applyShot(state, handle, trace) {
    var cost = trace.chargedExpansions === undefined ? trace.expansions : trace.chargedExpansions;
    var outcome = {
      kind: handle.kind,
      powerId: handle.powerId,
      target: handle.target,
      trace: trace,
      cost: cost,
      hit: false,
      rode: false,
      message: ''
    };

    state.shots++;
    state.log.push(['f', handle.powerId, handle.target.x, handle.target.y,
      handle.target.botId, handle.swaps]);

    if (state.revealed) {
      trace.steps.forEach(function (st) { revealAround(state, st.x, st.y, 1); });
    }

    spend(state, cost, 'The charge bar hit zero mid-shot.');

    if (handle.kind === 'strike') {
      resolveStrike(state, handle, trace, outcome);
      // A strike is an action, so the world moves whether it landed or not.
      for (var t = 0; t < RULES.strikeTick; t++) { advance(state); }
      return outcome;
    }

    if (!trace.found || trace.path.length < 2) {
      outcome.message = handle.power.name + ' found no route from here, and the charge is spent either way.';
      return outcome;
    }
    state.ride = { path: trace.path.slice(1), i: 0, power: handle.powerId };
    outcome.rode = true;
    outcome.message = handle.power.name + ' laid a ' + (trace.path.length - 1) +
      '-cell route for ' + cost + ' charge.';
    return outcome;
  }

  function resolveStrike(state, handle, trace, outcome) {
    var bot = null;
    state.bots.forEach(function (b) { if (b.id === handle.target.botId && b.hp > 0) { bot = b; } });
    if (!bot) {
      outcome.message = 'That robot is already down. The charge is gone all the same.';
      return;
    }
    var reached = trace.found && bot.x === trace.to.x && bot.y === trace.to.y;
    if (!reached) {
      outcome.message = handle.power.name + ' never reached ' + botName(bot) + '.';
      return;
    }
    if (trace.pathSteps > handle.power.reach) {
      outcome.message = handle.power.name + ' got there in ' + trace.pathSteps +
        ' cells - ' + handle.power.reach + ' is as far as it strikes. ' +
        botName(bot) + ' walked off with it.';
      return;
    }

    outcome.hit = true;
    state.hits++;
    bot.hp -= 1;
    bot.route = null;
    dropCargo(state, bot);
    if (bot.hp <= 0) {
      outcome.message = handle.power.name + ' put ' + botName(bot) + ' out of the shift.';
      say(state, 'hit', botName(bot) + ' is down.');
    } else {
      bot.stunned = bot.maxHp > 1 ? RULES.bossStun : RULES.stunTicks;
      outcome.message = handle.power.name + ' caught ' + botName(bot) + ' in ' +
        trace.pathSteps + ' cells.' + (bot.maxHp > 1 ? ' ' + bot.hp + ' plates left.' : '');
      say(state, 'hit', botName(bot) + ' stunned.');
    }
  }

  function botName(bot) {
    return bot.name || (bot.kind.charAt(0).toUpperCase() + bot.kind.slice(1));
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

  /* --------------------------------------------------------------- nudge ---
   * Not travel: one cell, paid for in charge, for stepping off oil or out of
   * a robot's way. `dir` is 0 east, 1 south, 2 west, 3 north. */

  function nudge(state, dir) {
    if (state.status !== 'playing') { return null; }
    var d = DIRS[dir & 3];
    var to = { x: state.player.x + d[0], y: state.player.y + d[1] };
    var free = state.level.freeWalk === true;
    if (!inside(state.grid, to.x, to.y) || !canStep(state.grid, state.player, to)) {
      return { moved: false, message: 'A wall. The cart does not climb.' };
    }
    state.player.facing = dir & 3;
    state.ride = null;
    state.log.push(['n', dir & 3]);
    if (!free) { spend(state, RULES.nudgeCost, 'The last nudge emptied the charge bar.'); }
    movePlayerTo(state, to.x, to.y);
    advance(state);
    return { moved: true, message: '' };
  }

  /* ---------------------------------------------------------------- tick ---*/

  function tick(state) {
    if (state.status !== 'playing') { return; }
    state.log.push(['t']);
    advance(state);
  }

  // One tick of the world: the cart rides a cell, then everything else moves.
  function advance(state) {
    if (state.status !== 'playing') { return; }

    if (state.stall > 0) {
      state.stall--;
    } else if (state.ride) {
      var next = state.ride.path[state.ride.i];
      state.ride.i++;
      if (state.ride.i >= state.ride.path.length) { state.ride = null; }
      if (next && !isWall(state.grid, next.x, next.y)) {
        var d = facingBetween(state.player, next);
        if (d !== null) { state.player.facing = d; }
        movePlayerTo(state, next.x, next.y);
        if (stepCost(state.grid, next.x, next.y) >= 5) { state.stall = RULES.oilStall; }
      }
    }

    worldTick(state);
  }

  function facingBetween(from, to) {
    for (var i = 0; i < DIRS.length; i++) {
      if (from.x + DIRS[i][0] === to.x && from.y + DIRS[i][1] === to.y) { return i; }
    }
    return null;
  }

  function movePlayerTo(state, x, y) {
    state.player.x = x;
    state.player.y = y;
    revealAround(state, x, y, 2);
    collectAt(state, x, y);
  }

  function collectAt(state, x, y) {
    var chest = chestAt(state, x, y);
    if (chest) {
      state.chests.splice(state.chests.indexOf(chest), 1);
      state.score += RULES.chestScore;
      gain(state, RULES.chestCharge);
      say(state, 'chest', 'Lockbox recovered: +' + RULES.chestCharge + ' charge.');
    }
    state.cells.forEach(function (c) {
      if (!c.spent && c.x === x && c.y === y) {
        c.spent = true;
        gain(state, RULES.cellCharge);
        say(state, 'cell', 'Power cell drained: +' + RULES.cellCharge + ' charge.');
      }
    });
    var d = deliveryAt(state, x, y);
    if (d) {
      d.secured = true;
      say(state, 'delivery', 'Delivery secured.');
      if (openDeliveries(state).length === 0) { win(state); }
    }
  }

  function worldTick(state) {
    if (state.status !== 'playing') { return; }
    state.tick++;
    spawnChest(state);
    moveBots(state);
    if (state.charge <= 0) { lose(state, 'The charge bar hit zero.'); }
  }

  /* -------------------------------------------------------------- chests ---*/

  function spawnChest(state) {
    var level = state.level;
    if (!level.chestEvery) { return; }
    if (state.tick % level.chestEvery !== 0) { return; }
    var cap = level.maxChests === undefined ? 3 : level.maxChests;
    var carried = state.bots.filter(function (b) { return b.carrying; }).length;
    if (state.chests.length + carried >= cap) { return; }

    var spot = randomFloor(state);
    if (!spot) { return; }
    state.chests.push({ id: state.nextChest++, x: spot.x, y: spot.y });
    say(state, 'spawn', 'A lockbox dropped on the floor.');
  }

  function randomFloor(state) {
    var grid = state.grid;
    for (var tries = 0; tries < 60; tries++) {
      var x = Math.floor(state.rng() * grid.w);
      var y = Math.floor(state.rng() * grid.h);
      var ch = glyph(grid, x, y);
      if (ch === '#' || ch === 'v' || /[0-9]/.test(ch)) { continue; }
      if (state.player.x === x && state.player.y === y) { continue; }
      if (deliveryAt(state, x, y) || botAt(state, x, y) || chestAt(state, x, y)) { continue; }
      return { x: x, y: y };
    }
    return null;
  }

  /* ---------------------------------------------------------------- bots ---*/

  function moveBots(state) {
    var bots = liveBots(state);
    for (var i = 0; i < bots.length; i++) {
      var bot = bots[i];
      if (bot.stunned > 0) { bot.stunned--; continue; }
      if ((state.tick + bot.phase) % bot.period !== 0) { continue; }
      stepBot(state, bot);
    }
  }

  function botGoal(state, bot) {
    if (bot.carrying) { return { key: 'den', at: bot.den }; }
    if (bot.kind === 'hunter') {
      return { key: 'player', at: { x: state.player.x, y: state.player.y } };
    }
    var chest = nearest(bot, state.chests);
    if (chest) { return { key: 'chest' + chest.id, at: { x: chest.x, y: chest.y } }; }
    var d = nearest(bot, openDeliveries(state));
    if (d) { return { key: 'd' + d.id, at: { x: d.x, y: d.y } }; }
    return { key: 'den', at: bot.den };
  }

  function nearest(from, list) {
    var best = null;
    var bestD = Infinity;
    list.forEach(function (it) {
      var d = Math.abs(it.x - from.x) + Math.abs(it.y - from.y);
      if (d < bestD) { bestD = d; best = it; }
    });
    return best;
  }

  function stepBot(state, bot) {
    var goal = botGoal(state, bot);
    var key = goal.key + ':' + goal.at.x + ',' + goal.at.y;
    if (!bot.route || !bot.route.length || bot.routeKey !== key) {
      bot.routeKey = key;
      bot.route = planRoute(state, bot, goal.at);
    }
    var next = bot.route && bot.route.length ? bot.route.shift() : null;
    if (!next || !canStep(state.grid, bot, next)) {
      bot.route = null;
      next = wanderStep(state, bot);
      if (!next) { return; }
    }

    var dir = facingBetween(bot, next);
    if (dir !== null) { bot.facing = dir; }

    if (state.player.x === next.x && state.player.y === next.y) {
      spend(state, RULES.bumpCost, 'A robot shunted the cart with the bar already empty.');
      say(state, 'bump', botName(bot) + ' shunted the cart: -' + RULES.bumpCost + ' charge.');
      bot.route = null;
      return;
    }

    var other = botAt(state, next.x, next.y);
    if (other && other !== bot) { bot.route = null; return; }

    var d = deliveryAt(state, next.x, next.y);
    if (d) {
      // The robots do not steal a delivery, they shove it: the red point the
      // player is riding at moves, which is what makes aiming a live problem.
      var px = d.x + DIRS[dir === null ? 0 : dir][0];
      var py = d.y + DIRS[dir === null ? 0 : dir][1];
      if (inside(state.grid, px, py) && !isWall(state.grid, px, py) &&
        !deliveryAt(state, px, py) && !botAt(state, px, py) &&
        !(state.player.x === px && state.player.y === py) &&
        canStep(state.grid, { x: d.x, y: d.y }, { x: px, y: py })) {
        d.x = px;
        d.y = py;
        say(state, 'shove', botName(bot) + ' shoved a delivery.');
      } else {
        bot.route = null;
        return;
      }
    }

    bot.x = next.x;
    bot.y = next.y;

    var chest = chestAt(state, next.x, next.y);
    if (chest && !bot.carrying) {
      state.chests.splice(state.chests.indexOf(chest), 1);
      bot.carrying = chest;
      bot.route = null;
      say(state, 'steal', botName(bot) + ' picked up a lockbox.');
    }
    if (bot.carrying && bot.x === bot.den.x && bot.y === bot.den.y) {
      bot.carrying = null;
      state.stolen++;
      bot.route = null;
      say(state, 'lost', botName(bot) + ' got a lockbox out through the chute.');
    }
  }

  function planRoute(state, bot, to) {
    var trace;
    try {
      trace = E.search(state.grid, bot.strategy, {
        from: { x: bot.x, y: bot.y },
        to: { x: to.x, y: to.y },
        targets: [{ x: to.x, y: to.y }],
        expansionCap: 4000
      });
    } catch (err) {
      return null;
    }
    if (!trace.found || trace.path.length < 2) { return null; }
    return trace.path.slice(1);
  }

  function wanderStep(state, bot) {
    var opts = [];
    for (var i = 0; i < DIRS.length; i++) {
      var nx = bot.x + DIRS[i][0];
      var ny = bot.y + DIRS[i][1];
      if (!inside(state.grid, nx, ny)) { continue; }
      if (!canStep(state.grid, bot, { x: nx, y: ny })) { continue; }
      if (botAt(state, nx, ny)) { continue; }
      opts.push({ x: nx, y: ny });
    }
    if (!opts.length) { return null; }
    return opts[Math.floor(state.rng() * opts.length)];
  }

  /* -------------------------------------------------------------- scoring ---*/

  function stars(state) {
    if (state.status !== 'won') { return 0; }
    var par = state.level.par || {};
    var n = 1;
    if (par.ticks === undefined || state.tick <= par.ticks) { n++; }
    if (par.charge === undefined || state.spent <= par.charge) { n++; }
    return n;
  }

  function summary(state) {
    return {
      status: state.status,
      stars: stars(state),
      ticks: state.tick,
      spent: state.spent,
      score: state.score,
      stolen: state.stolen,
      shots: state.shots,
      hits: state.hits,
      secured: state.deliveries.filter(function (d) { return d.secured; }).length,
      deliveries: state.deliveries.length
    };
  }

  /* --------------------------------------------------------------- replay ---*/

  function replay(level, log) {
    var state = create(level);
    for (var i = 0; i < log.length && state.status === 'playing'; i++) {
      var a = log[i];
      if (a[0] === 'f') {
        fire(state, a[1], { x: a[2], y: a[3], botId: a[4] }, { swaps: a[5] || [] });
      } else if (a[0] === 'n') {
        nudge(state, a[1]);
      } else {
        tick(state);
      }
    }
    return state;
  }

  return {
    RULES: RULES,
    POWERS: POWERS,
    POWER_BY_ID: POWER_BY_ID,
    DIRS: DIRS,
    create: create,
    fire: fire,
    openFire: openFire,
    stepFire: stepFire,
    hotSwap: hotSwap,
    closeFire: closeFire,
    nudge: nudge,
    tick: tick,
    advance: advance,
    stars: stars,
    summary: summary,
    replay: replay,
    visible: visible,
    placeOf: placeOf,
    isWall: isWall,
    canStep: canStep,
    botAt: botAt,
    chestAt: chestAt,
    deliveryAt: deliveryAt,
    openDeliveries: openDeliveries,
    liveBots: liveBots,
    botName: botName
  };
}());

if (typeof module !== 'undefined' && module.exports) { module.exports = Heist; }
