/* tools/verify-campaign.js - checks that the campaign data still holds.
 *
 * campaign.js and shop.js are data; this is the proof that the data is a
 * campaign. It checks, and exits non-zero when any fails:
 *
 *   maps       every mapId exists in maps.js, in the right zone and tier,
 *              with exactly as many deliveries as the encounter asks for;
 *   ladder     the twelve powers unlock one per level in the agreed order,
 *              and each level's perfect line uses the power it hands over;
 *   solvable   every perfect line runs on the real engine: each leg is
 *              found, fits the memory cap, holds only powers the player has,
 *              respects the foreman's shield and the swap cap;
 *   par        par is the perfect line plus slack, so it is reachable, and
 *              the numbers in campaign.js match what this measures;
 *   no sweep   no single power, used alone for every leg, makes three stars
 *              on every level of a zone - including the one power the shop
 *              can sell a level early;
 *   curve      the difficulty metric rises every level, the bot count never
 *              falls, and the zone rules (tier, fog, swap cap) are obeyed;
 *   economy    the shop only sells what the rules allow, and the gold curve
 *              is neither starving nor a skip button.
 *
 * Par is measured on the still floor: the thieves are not simulated here
 * (heist.js is the only simulator), so the slack in ECONOMY is the room left
 * for the floor moving. CAMPAIGN.md explains the model.
 *
 *   node tools/verify-campaign.js           check and print the ladder
 *   node tools/verify-campaign.js --write   rewrite par and startCharge in
 *                                           campaign.js from the measurement
 *
 * Maps come from maps.js at the repo root. Until the map lane lands it, the
 * stand-ins in tools/fixtures/placeholder-maps.js are used, and the run says
 * so on its first line.
 */
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var E = require(path.join(ROOT, 'search.js'));
var C = require(path.join(ROOT, 'campaign.js'));
var Shop = require(path.join(ROOT, 'shop.js'));

/* The order the captain agreed, 2026-09-19: each power arrives on the level
 * whose trap it solves. */
var AGREED_LADDER = ['bfs', 'dfs', 'dijkstra', 'astar', 'greedy', 'wastar',
  'bibfs', 'iddfs', 'beam', 'bellman', 'flow', 'wall'];

function loadMaps() {
  var real = path.join(ROOT, 'maps.js');
  if (fs.existsSync(real)) {
    var m = require(real);
    return { source: 'maps.js', maps: Array.isArray(m) ? m : m.MAPS };
  }
  return {
    source: 'tools/fixtures/placeholder-maps.js (maps.js has not landed yet)',
    maps: require(path.join(__dirname, 'fixtures', 'placeholder-maps.js')).MAPS
  };
}

/* ------------------------------------------------------------ the model --- */

function rideOf(grid, trace) {
  var charge = 0;
  var oil = 0;
  trace.path.slice(1).forEach(function (p) {
    var c = E.cellCost(grid, p.x, p.y);
    charge += c;
    if (grid.cells[p.y][p.x] === '~') { oil++; }
  });
  return { charge: charge, ticks: trace.pathSteps + oil * C.ECONOMY.oilStallTicks };
}

/* Plays a line on the still floor. Returns { ok, why, ticks, charge, swaps }. */
function measure(enc, grid, legs) {
  var zone = C.ZONE_BY_KEY[enc.zone];
  var from = grid.start;
  var out = { ok: true, why: '', ticks: 0, charge: 0, swaps: 0, legs: [] };
  for (var n = 0; n < legs.length; n++) {
    var leg = legs[n];
    var goal = grid.goals[leg.to];
    if (!goal) { return fail(out, 'leg ' + (n + 1) + ' aims at delivery ' + leg.to + ', which the map does not have'); }
    if (leg.hits && leg.power === zone.bossShieldedFrom) {
      return fail(out, 'leg ' + (n + 1) + ': the foreman is proofed against ' + leg.power);
    }
    var params = E.defaultParams(leg.power);
    params.from = { x: from.x, y: from.y };
    params.to = { x: goal.x, y: goal.y };
    params.fog = !!enc.fog;
    params.hideGoal = !!enc.prizeBehaviour.hidden;
    var trace = E.search(grid, leg.power, params);
    if (!trace.found) { return fail(out, 'leg ' + (n + 1) + ': ' + leg.power + ' finds no route'); }
    if (enc.memoryCap !== null && trace.peakFrontier > enc.memoryCap) {
      return fail(out, 'leg ' + (n + 1) + ': ' + leg.power + ' overheats (frontier ' + trace.peakFrontier + ' > cap ' + enc.memoryCap + ')');
    }
    var plots = 1 + (leg.hits || 0);
    var ride = rideOf(grid, trace);
    var legCharge = C.plotCharge(trace) * plots + ride.charge;
    var legTicks = C.ECONOMY.plotTicks * plots + ride.ticks;
    out.charge += legCharge;
    out.ticks += legTicks;
    out.legs.push({ power: leg.power, charge: legCharge, ticks: legTicks });
    if (n > 0 && legs[n - 1].power !== leg.power) { out.swaps++; }
    from = goal;
  }
  if (out.swaps > enc.swapCap) { return fail(out, out.swaps + ' swaps, cap is ' + enc.swapCap); }
  return out;
}

function fail(out, why) { out.ok = false; out.why = why; return out; }

function parFor(enc, measured) {
  var slack = C.ECONOMY.parSlack + C.ECONOMY.parSlackPerBoss * C.bossesOf(enc);
  var charge = Math.ceil(Math.max(measured.charge, 1) * slack);
  return {
    ticks: Math.ceil(measured.ticks * slack),
    charge: charge,
    startCharge: Math.ceil(charge * C.ECONOMY.startMargin[enc.tier])
  };
}

function orders(items) {
  if (items.length <= 1) { return [items]; }
  var out = [];
  items.forEach(function (x, i) {
    orders(items.filter(function (_, j) { return j !== i; })).forEach(function (rest) { out.push([x].concat(rest)); });
  });
  return out;
}

/* The best a player can do with one power and no swaps: every order of the
 * deliveries is tried, because a solo player picks their own order too. */
function bestSolo(enc, grid, power) {
  var best = null;
  orders(enc.perfectLine.legs).forEach(function (legs) {
    var m = measure(enc, grid, legs.map(function (l) { return { power: power, to: l.to, hits: l.hits }; }));
    if (m.ok && (!best || m.charge < best.charge || (m.charge === best.charge && m.ticks < best.ticks))) { best = m; }
  });
  return best;
}

/* ------------------------------------------------------------ the check --- */

function check(maps) {
  var problems = [];
  var rows = [];
  var measured = {};
  var mapById = {};
  maps.forEach(function (m) {
    if (mapById[m.id]) { problems.push('maps: id ' + m.id + ' appears twice'); }
    mapById[m.id] = m;
  });
  var ids = E.STRATEGIES.map(function (s) { return s.id; });
  var encs = C.ENCOUNTERS;

  // ladder and structure
  if (encs.length !== 15) { problems.push('ladder: ' + encs.length + ' encounters, want 15'); }
  var ladder = C.unlockOrder().map(function (u) { return u.power; });
  if (ladder.join() !== AGREED_LADDER.join()) {
    problems.push('ladder: unlock order is ' + ladder.join(' ') + ', agreed ' + AGREED_LADDER.join(' '));
  }
  var seenMaps = {};
  encs.forEach(function (enc, i) {
    var tag = 'L' + enc.level + ' ';
    var zone = C.ZONE_BY_KEY[enc.zone];
    if (enc.level !== i + 1) { problems.push(tag + 'is out of order'); }
    if (!zone) { problems.push(tag + 'names unknown zone ' + enc.zone); return; }
    if (C.ZONES.indexOf(zone) !== Math.floor(i / 3)) { problems.push(tag + 'is in zone ' + enc.zone + ', the ladder puts it in ' + C.ZONES[Math.floor(i / 3)].key); }
    if (enc.tier !== zone.tier) { problems.push(tag + 'tier ' + enc.tier + ' but zone ' + zone.key + ' is tier ' + zone.tier); }
    if (enc.swapCap !== zone.swapCap) { problems.push(tag + 'swap cap ' + enc.swapCap + ', zone ' + zone.key + ' sets ' + zone.swapCap); }
    if (enc.fog && !zone.fog) { problems.push(tag + 'is fogged in a zone that is lit'); }
    if (enc.deliveries < 2 || enc.deliveries > 3) { problems.push(tag + 'has ' + enc.deliveries + ' deliveries, want 2-3'); }
    if (seenMaps[enc.mapId]) { problems.push(tag + 'reuses map ' + enc.mapId); }
    seenMaps[enc.mapId] = true;
    if (enc.unlocks && ids.indexOf(enc.unlocks) < 0) { problems.push(tag + 'unlocks unknown power ' + enc.unlocks); }
    enc.bots.forEach(function (b) {
      if (!C.BOTS[b.type]) { problems.push(tag + 'has unknown bot type ' + b.type); }
      if (b.type === 'boss' && !(b.hp >= 3 && b.hp <= 5)) { problems.push(tag + 'foreman hp ' + b.hp + ', want 3-5'); }
    });
    var bosses = C.bossesOf(enc);
    var held = enc.prizeBehaviour.heldByBoss;
    if (held.length !== bosses) { problems.push(tag + bosses + ' foremen but ' + held.length + ' held deliveries'); }
    if (bosses > 0 && !zone.bossShieldedFrom) { problems.push(tag + 'has a foreman in a zone with no shield rule'); }
    enc.shopUnlocks.forEach(function (id) {
      if (!Shop.BOOST_BY_ID[id]) { problems.push(tag + 'unlocks unknown boost ' + id); }
    });

    // the perfect line, as data
    var legs = enc.perfectLine.legs;
    if (legs.length !== enc.deliveries) { problems.push(tag + 'perfect line has ' + legs.length + ' legs for ' + enc.deliveries + ' deliveries'); }
    var targets = legs.map(function (l) { return l.to; }).sort();
    if (targets.join() !== targets.filter(function (t, k) { return targets.indexOf(t) === k; }).join()) {
      problems.push(tag + 'perfect line visits a delivery twice');
    }
    var have = C.powersAt(enc.level);
    legs.forEach(function (l, k) {
      if (have.indexOf(l.power) < 0) { problems.push(tag + 'leg ' + (k + 1) + ' uses ' + l.power + ', not unlocked until L' + C.unlockLevelOf(l.power)); }
      var isHeld = held.indexOf(l.to) >= 0;
      if (isHeld && l.hits !== C.bossHp(enc)) { problems.push(tag + 'leg ' + (k + 1) + ' takes a held delivery with ' + (l.hits || 0) + ' hits, the foreman has ' + C.bossHp(enc)); }
      if (!isHeld && l.hits) { problems.push(tag + 'leg ' + (k + 1) + ' hits a foreman who is not there'); }
    });
    if (enc.unlocks && !legs.some(function (l) { return l.power === enc.unlocks; })) {
      problems.push(tag + 'hands over ' + enc.unlocks + ' but its perfect line never uses it');
    }
    if (!enc.unlocks && legs.every(function (l) { return l.power === legs[0].power; })) {
      problems.push(tag + 'is a revision level with a one-power perfect line');
    }

    // the map
    var map = mapById[enc.mapId];
    if (!map) { problems.push(tag + 'references map ' + enc.mapId + ', which maps.js does not have'); return; }
    if (map.zone !== enc.zone || map.tier !== enc.tier) {
      problems.push(tag + 'map ' + map.id + ' is ' + map.zone + '/' + map.tier + ', encounter is ' + enc.zone + '/' + enc.tier);
    }
    var grid = E.parseGrid(map.ascii);
    if (grid.goals.length !== enc.deliveries) {
      problems.push(tag + 'map ' + map.id + ' has ' + grid.goals.length + ' deliveries, encounter wants ' + enc.deliveries);
    }

    // solvable, and par
    var m = measure(enc, grid, legs);
    measured[enc.level] = m;
    if (!m.ok) { problems.push(tag + 'perfect line fails: ' + m.why); return; }
    var want = parFor(enc, m);
    if (m.ticks > enc.par.ticks || m.charge > enc.par.charge) {
      problems.push(tag + 'par ' + enc.par.ticks + 't/' + enc.par.charge + 'c is not reachable: the perfect line takes ' + m.ticks + 't/' + m.charge + 'c');
    }
    if (enc.par.ticks !== want.ticks || enc.par.charge !== want.charge || enc.startCharge !== want.startCharge) {
      problems.push(tag + 'par/startCharge drifted: file ' + enc.par.ticks + 't/' + enc.par.charge + 'c/' + enc.startCharge +
        ', measured ' + want.ticks + 't/' + want.charge + 'c/' + want.startCharge + ' (run with --write)');
    }

    // who else makes three stars here alone - counting the one power the
    // shop may have sold a level early, so gold cannot buy a sweep
    var solos = [];
    var early = C.unlockOrder().filter(function (u) { return u.level === enc.level + 1; })[0];
    have.concat(early ? [early.power] : []).forEach(function (p) {
      var s = bestSolo(enc, grid, p);
      if (s && s.ticks <= enc.par.ticks && s.charge <= enc.par.charge) { solos.push(p); }
    });
    rows.push({ enc: enc, m: m, want: want, solos: solos, grid: grid });
  });

  // no single power sweeps a zone
  C.ZONES.forEach(function (zone) {
    var zr = rows.filter(function (r) { return r.enc.zone === zone.key; });
    if (zr.length !== 3) { return; }
    ids.forEach(function (p) {
      if (zr.every(function (r) { return r.solos.indexOf(p) >= 0; })) {
        problems.push('sweep: ' + p + ' alone makes three stars on every level of ' + zone.key);
      }
    });
  });

  // the curve
  for (var k = 1; k < encs.length; k++) {
    var a = encs[k - 1];
    var b = encs[k];
    if (C.difficultyOf(b) <= C.difficultyOf(a)) {
      problems.push('curve: L' + b.level + ' difficulty ' + C.difficultyOf(b) + ' does not rise above L' + a.level + ' (' + C.difficultyOf(a) + ')');
    }
    if (C.botCount(b) < C.botCount(a)) { problems.push('curve: L' + b.level + ' has fewer bots than L' + a.level); }
    if (C.bossHp(b) < C.bossHp(a)) { problems.push('curve: L' + b.level + ' foreman is weaker than L' + a.level + '\'s'); }
  }

  problems = problems.concat(checkEconomy());
  return { problems: problems, rows: rows };
}

function checkEconomy() {
  var problems = [];
  Shop.BOOSTS.forEach(function (b) {
    Object.keys(b.effect).forEach(function (f) {
      if (Shop.ALLOWED_EFFECTS.indexOf(f) < 0) { problems.push('shop: boost ' + b.id + ' has effect ' + f + ', which is not on the allowed list'); }
    });
    var chargeOnly = Object.keys(b.effect).join() === 'charge';
    if (!chargeOnly && b.capsStars !== 2) { problems.push('shop: boost ' + b.id + ' can change a run but does not cap it at two stars'); }
  });
  var offered = C.ENCOUNTERS.reduce(function (n, e) { return n.concat(e.shopUnlocks); }, []);
  Shop.BOOSTS.forEach(function (b) {
    if (offered.indexOf(b.id) < 0) { problems.push('shop: boost ' + b.id + ' is never unlocked by any level'); }
  });
  var prices = Shop.powers().map(function (p) { return p.earlyPrice; });
  for (var i = 1; i < prices.length; i++) {
    if (prices[i] < prices[i - 1]) { problems.push('shop: early unlock prices fall along the ladder'); break; }
  }

  // income, without lockboxes: the floor, not the player, decides those
  var floor = 0;
  var best = 0;
  var firstBoss = C.ENCOUNTERS.filter(function (e) { return C.bossesOf(e) > 0; })[0];
  var recharge = Shop.BOOST_BY_ID.recharge;
  C.ENCOUNTERS.forEach(function (e) {
    if (e.level === firstBoss.level && floor < recharge.price) {
      problems.push('economy: a one-star player reaches the first foreman (L' + e.level + ') with ' + floor + ' gold, less than one recharge');
    }
    floor += C.goldFor(e, { won: true, ticks: Infinity, chargeSpent: Infinity });
    best += C.goldFor(e, { won: true, ticks: 0, chargeSpent: 0 });
  });
  var everything = 0;
  C.ENCOUNTERS.forEach(function (e) {
    Shop.boostsBefore(e.level).forEach(function (b) { everything += b.price * b.perLevel; });
  });
  if (best >= everything) {
    problems.push('economy: a three-star player earns ' + best + ' gold, enough to buy every boost on every level (' + everything + ')');
  }
  checkEconomy.summary = { oneStar: floor, threeStar: best, everything: everything };
  return problems;
}

/* ------------------------------------------------------------ --write --- */

function writePars(rows) {
  var file = path.join(ROOT, 'campaign.js');
  var src = fs.readFileSync(file, 'utf8');
  rows.forEach(function (r) {
    var at = src.indexOf('level: ' + r.enc.level + ', name:');
    var re = /par: \{ ticks: -?\d+, charge: -?\d+ \}, startCharge: -?\d+/g;
    re.lastIndex = at;
    var hit = re.exec(src);
    if (at < 0 || !hit) { throw new Error('cannot find the par line of L' + r.enc.level); }
    var line = 'par: { ticks: ' + r.want.ticks + ', charge: ' + r.want.charge + ' }, startCharge: ' + r.want.startCharge;
    src = src.slice(0, hit.index) + line + src.slice(hit.index + hit[0].length);
  });
  fs.writeFileSync(file, src);
}

/* ------------------------------------------------------------ main --- */

function pad(s, n) { s = String(s); while (s.length < n) { s += ' '; } return s; }

if (require.main === module) {
  var loaded = loadMaps();
  console.log('maps: ' + loaded.source);
  var result = check(loaded.maps);
  if (process.argv.indexOf('--write') >= 0) {
    writePars(result.rows.filter(function (r) { return r.m.ok; }));
    console.log('wrote par and startCharge for ' + result.rows.length + ' levels; run again to check');
    process.exit(0);
  }
  console.log('');
  console.log(pad('lvl', 4) + pad('map', 14) + pad('unlocks', 9) + pad('bots b/f/B', 11) + pad('diff', 5) +
    pad('line', 26) + pad('measured', 10) + pad('par', 10) + pad('start', 6) + 'three stars solo');
  result.rows.forEach(function (r) {
    var e = r.enc;
    var n = function (t) { return e.bots.filter(function (b) { return b.type === t; }).reduce(function (s, b) { return s + b.count; }, 0); };
    console.log(pad(e.level, 4) + pad(e.mapId, 14) + pad(e.unlocks || '-', 9) +
      pad(n('basic') + '/' + n('fast') + '/' + n('boss'), 11) + pad(C.difficultyOf(e), 5) +
      pad(e.perfectLine.legs.map(function (l) { return l.power; }).join(','), 26) +
      pad(r.m.ticks + 't/' + r.m.charge + 'c', 10) + pad(e.par.ticks + 't/' + e.par.charge + 'c', 10) +
      pad(e.startCharge, 6) + (r.solos.join(' ') || '-'));
  });
  var s = checkEconomy.summary;
  console.log('');
  console.log('gold over the campaign, before lockboxes: one-star ' + s.oneStar + ', three-star ' + s.threeStar +
    ', every boost on every level ' + s.everything);
  console.log('');
  if (result.problems.length) {
    result.problems.forEach(function (p) { console.log('FAIL ' + p); });
    process.exit(1);
  }
  console.log('ok: maps, ladder, solvable, par, no sweep, curve, economy');
}

module.exports = { check: check, loadMaps: loadMaps, measure: measure, AGREED_LADDER: AGREED_LADDER };
