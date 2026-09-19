/* heist-ui.js - Factory Heist, the page.
 *
 * Wires heist.js (the rules) to heist-render.js (the board) and the HUD in
 * index.html. It owns input, pacing and persistence and nothing else: every
 * decision about what a shot costs or where a robot goes is made in heist.js,
 * so what the player sees is exactly what tools/verify-heist.js measures.
 *
 * The encounters are Campaign.ENCOUNTERS (campaign.js, bound to maps.js by
 * map id); the powers a floor hands over and the shelf between floors are
 * Shop's (shop.js). This file adds no rule and no number of its own.
 *
 * The turn, as the player lives it:
 *   aim      pick a power (1-9, 0, -, =) and click a delivery, a floor tile or
 *            a thief. The world is frozen until you act.
 *   search   the power's search plays out on the floor; press another power
 *            key to hot swap it mid-run. Space finishes it at once.
 *   ride     the cart rides the route one cell per tick while the thieves
 *            move. Esc gets off; plotting again replaces the ride.
 * WASD / arrows nudge the cart one cell for a charge fee, relative to the
 * screen, so a turned board still means "up is up".
 *
 * Publishes nothing: one closure, started on load.
 */

(function () {
  'use strict';

  var E = window.PathfinderEngine;
  var C = window.Campaign;
  var LEVELS = C.ENCOUNTERS;
  // The power bar, and its keys, follow the ladder: floor 1's power is 1.
  var POWERS = Heist.POWERS.slice().sort(function (a, b) {
    return (C.unlockLevelOf(a.id) || 99) - (C.unlockLevelOf(b.id) || 99);
  });
  var KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
  var STORE = 'factoryHeist.save.v2';

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    canvas: $('board'),
    hudTop: document.querySelector('.hud-top'),
    hudBottom: document.querySelector('.hud-bottom'),
    progress: $('floor-progress'),
    title: $('floor-title'),
    starTotal: $('star-total'),
    objective: $('floor-objective'),
    brief: $('floor-brief'),
    gauges: $('gauges'),
    legend: $('legend'),
    toast: $('toast'),
    powers: $('powers'),
    boosts: $('boosts'),
    mode: $('mode-line'),
    rotL: $('btn-rot-left'),
    rotR: $('btn-rot-right'),
    fit: $('btn-fit'),
    retry: $('btn-retry'),
    speed: $('speed'),
    freewalk: $('freewalk'),
    floorbar: $('floorbar'),
    glossary: $('glossary'),
    overlay: $('overlay'),
    close: $('overlay-close'),
    stars: $('stars'),
    verdict: $('verdict-text'),
    why: $('verdict-why'),
    chip: $('concept-chip'),
    note: $('concept-note'),
    runGrid: $('run-grid'),
    shop: $('shop'),
    gate: $('gate-note'),
    retry2: $('btn-retry-2'),
    next: $('btn-next')
  };

  var board = HeistBoard.create(el.canvas);

  var ui = {
    index: 0,
    state: null,
    phase: 'aim',          // aim | search | ride | over
    power: null,           // the selected power id
    handle: null,          // the search in flight
    explored: null,
    frontier: null,
    lastPath: null,        // the route the last ride took, kept on screen
    hover: null,
    rideClock: 0,
    seenEvents: 0,
    toastTimer: 0,
    save: loadSave(),
    unlockAll: /[?&]all\b/.test(window.location.search),
    drag: null,
    lastFrame: 0,
    rideMs: 150            // one tick of a ride, on screen
  };

  /* ---------------------------------------------------------- persistence ---
   * One save: best stars per level, gold, the boosts bought and not yet
   * used, and the one early power the shop sells per campaign. */

  function loadSave() {
    var save = { stars: {}, gold: 0, bank: {}, earlyUnlocked: [] };
    try {
      var raw = JSON.parse(window.localStorage.getItem(STORE) || '{}');
      Object.keys(save).forEach(function (k) { if (raw[k] !== undefined) { save[k] = raw[k]; } });
    } catch (e) { /* a fresh save */ }
    return save;
  }

  function saveGame() {
    try { window.localStorage.setItem(STORE, JSON.stringify(ui.save)); } catch (e) { /* play on */ }
  }

  function starsOf(i) { return ui.save.stars[LEVELS[i].level] || 0; }

  function floorOpen(i) {
    return ui.unlockAll || i === 0 || starsOf(i - 1) > 0 || starsOf(i) > 0;
  }

  // The floor a power is handed over on, 1-based, or 0 if it never is.
  function unlockFloor(id) { return C.unlockLevelOf(id) || 0; }

  function powerOpen(id) { return ui.state.powers.indexOf(id) !== -1; }

  function label(id) {
    var s = E.STRATEGY_BY_ID[id];
    return s ? s.label : id;
  }

  // "foreman" is the one irregular noun the HUD counts.
  function plural(n, word) {
    return n + ' ' + (n === 1 ? word : (/man$/.test(word) ? word.replace(/man$/, 'men') : word + 's'));
  }

  /* ---------------------------------------------------------------- floors ---*/

  function loadFloor(i) {
    ui.index = i;
    var enc = LEVELS[i];
    // Boosts ride in from the bank, as many as a level lets you carry.
    var carry = {};
    Object.keys(ui.save.bank).forEach(function (id) {
      var b = Shop.BOOST_BY_ID[id];
      if (b && ui.save.bank[id] > 0) { carry[id] = Math.min(b.perLevel, ui.save.bank[id]); }
    });
    ui.state = Heist.create(enc, {
      powers: Shop.powersFor(enc.level, ui.save),
      boosts: carry,
      freeWalk: el.freewalk.checked
    });
    ui.phase = 'aim';
    ui.handle = null;
    ui.explored = null;
    ui.frontier = null;
    ui.lastPath = null;
    ui.seenEvents = 0;
    if (!ui.power || !powerOpen(ui.power)) { ui.power = enc.unlocks || ui.state.powers[ui.state.powers.length - 1]; }

    el.progress.textContent = 'Floor ' + enc.level + ' of ' + LEVELS.length + ' \u00b7 ' + ui.state.zone.name;
    el.title.textContent = enc.name;
    el.brief.textContent = briefLine(ui.state);
    el.objective.innerHTML = objectiveLine(ui.state);
    hideOverlay();
    buildPowers();
    buildBoosts();
    buildLegend();
    buildFloorbar();
    updateStarTotal();
    updateGauges();
    updateMode();
    resize(true);
  }

  function objectiveLine(st) {
    var enc = st.enc;
    var n = st.deliveries.length;
    var line = '<b>Secure ' + n + ' red deliveries</b> by stopping on them.';
    var held = enc.prizeBehaviour.heldByBoss.length;
    if (held === 1) {
      line += ' A foreman holds one: light him ' + C.bossHp(enc) + ' times with a route to make him let go.';
    } else if (held) {
      line += ' Foremen hold ' + held + ': light each one ' + C.bossHp(enc) + ' times with a route to break his grip.';
    }
    if (st.hidden) { line += ' Nobody logged where they are: find them.'; }
    return line + ' Par: ' + enc.par.ticks + ' ticks, ' + enc.par.charge + ' charge.';
  }

  // Who is on the floor and what the floor allows, in one line.
  function briefLine(st) {
    var parts = [];
    st.enc.bots.forEach(function (g) {
      parts.push(plural(g.count, C.BOTS[g.type].name.toLowerCase()));
    });
    if (st.memory !== null) { parts.push('memory ' + st.memory); }
    if (st.map.budgets && st.map.budgets.expansions) { parts.push(st.map.budgets.expansions + ' free per plot'); }
    if (st.fog) { parts.push('dark floor'); }
    parts.push(plural(st.swapCap, 'power change'));
    return parts.join(' \u00b7 ');
  }

  /* ------------------------------------------------------------------ HUD ---*/

  function buildPowers() {
    el.powers.innerHTML = '';
    POWERS.forEach(function (p, k) {
      var open = powerOpen(p.id);
      var b = document.createElement('button');
      b.className = 'algo power' + (open ? '' : ' locked');
      b.dataset.power = p.id;
      b.disabled = !open;
      b.innerHTML = open
        ? '<span class="pname"><kbd>' + KEYS[k] + '</kbd>' + p.name + '</span><small>' + label(p.id) + '</small>'
        : '<span class="pname"><kbd>' + KEYS[k] + '</kbd>' + label(p.id) + (unlockFloor(p.id) ? ' <em>F' + unlockFloor(p.id) + '</em>' : '') + '</span>';
      b.addEventListener('click', function () { pressPower(p.id); });
      b.addEventListener('mouseenter', function () { showGlossary(p, b); });
      b.addEventListener('focus', function () { showGlossary(p, b); });
      b.addEventListener('mouseleave', hideGlossary);
      b.addEventListener('blur', hideGlossary);
      el.powers.appendChild(b);
    });
    markPower();
  }

  function markPower() {
    Array.prototype.forEach.call(el.powers.children, function (b) {
      var id = b.dataset.power;
      b.classList.toggle('active', id === ui.power);
      b.classList.toggle('firing', !!ui.handle && ui.handle.powerId === id);
    });
  }

  function showGlossary(p, anchor) {
    var s = E.STRATEGY_BY_ID[p.id] || {};
    var open = powerOpen(p.id);
    el.glossary.innerHTML =
      '<div class="fam">' + (s.label || p.id) + (open ? '' : ' &middot; unlocks on floor ' + unlockFloor(p.id)) + '</div>' +
      '<h4>' + p.name + '</h4>' +
      '<p class="gdesc">' + (s.description || '') + '</p>' +
      '<dl>' +
      '<dt>Feel</dt><dd>' + p.feel + '</dd>' +
      (s.wins ? '<dt>Wins when</dt><dd class="good">' + s.wins + '</dd>' : '') +
      (s.fails ? '<dt>Fails when</dt><dd class="bad">' + s.fails + '</dd>' : '') +
      '<dt>Frontier</dt><dd>' + (s.frontierRule || '') + '</dd>' +
      (ui.state.zone.bossShieldedFrom === p.id ? '<dt>Here</dt><dd class="bad">the foremen in ' + ui.state.zone.name + ' are proofed against it</dd>' : '') +
      '<dt>Hot swap</dt><dd>' + (s.hotSwappable ? 'can take over a search mid-run' : '<span class="bad">has its own shape - fire it fresh</span>') + '</dd>' +
      '</dl>';
    el.glossary.classList.remove('hidden');
    var r = anchor.getBoundingClientRect();
    var gw = 300;
    var left = Math.max(12, Math.min(window.innerWidth - gw - 12, r.left + r.width / 2 - gw / 2));
    el.glossary.style.left = left + 'px';
    el.glossary.style.top = '';
    el.glossary.style.bottom = (window.innerHeight - r.top + 10) + 'px';
  }

  function hideGlossary() { el.glossary.classList.add('hidden'); }

  function buildLegend() {
    var st = ui.state;
    var ascii = st.map.ascii;
    var items = [
      ['i-you', 'Your cart'],
      ['i-delivery', 'Delivery'],
      ['i-thief', 'Thief'],
      ['i-route', 'Route (it lights thieves)']
    ];
    if (st.enc.chestRules.every) { items.push(['i-chest', 'Lockbox +' + st.enc.chestRules.charge]); }
    if (/~/.test(ascii)) { items.push(['i-oil', 'Oil: 5 a tile']); }
    if (/v/.test(ascii)) { items.push(['i-cell', 'Power cell +4']); }
    if (/[0-9]/.test(ascii)) { items.push(['i-chute', 'Chute pair']); }
    el.legend.innerHTML = items.map(function (it) {
      return '<span><i class="' + it[0] + '"></i>' + it[1] + '</span>';
    }).join('');
  }

  // One button per boost the cart carried in. Using one is logged like any
  // other action, and it leaves the bank for good.
  function buildBoosts() {
    var st = ui.state;
    var ids = Object.keys(st.boosts).filter(function (id) { return st.boosts[id] > 0; });
    el.boosts.innerHTML = '';
    el.boosts.classList.toggle('hidden', !ids.length);
    ids.forEach(function (id) {
      var b = Shop.BOOST_BY_ID[id];
      var btn = document.createElement('button');
      btn.className = 'boost';
      btn.dataset.boost = id;
      btn.title = b.does;
      btn.innerHTML = b.name + ' <b>&times;' + st.boosts[id] + '</b>' + (b.capsStars ? ' <small>caps at ' + b.capsStars + '&#9733;</small>' : '');
      btn.addEventListener('click', function () { boost(id); });
      el.boosts.appendChild(btn);
    });
  }

  function buildFloorbar() {
    el.floorbar.innerHTML = '';
    LEVELS.forEach(function (lv, i) {
      var open = floorOpen(i);
      var b = document.createElement('button');
      b.className = 'lvl' + (i === ui.index ? ' current' : '') + (open ? '' : ' locked');
      b.disabled = !open;
      b.title = lv.name + (open ? '' : ' - earn a star on the floor before it');
      var s = starsOf(i);
      b.innerHTML = '<b>' + (i + 1) + '</b><span class="s">' + (s ? '★★★'.slice(0, s) : '') + '</span>';
      b.addEventListener('click', function () { if (open) { loadFloor(i); } });
      el.floorbar.appendChild(b);
    });
  }

  function updateStarTotal() {
    var total = 0;
    LEVELS.forEach(function (lv, i) { total += starsOf(i); });
    el.starTotal.textContent = '★ ' + total + ' / ' + LEVELS.length * 3 + '  \u00b7  ' + ui.save.gold + ' gold';
  }

  function gauge(key, name, value, detail, frac, cls, marker) {
    return '<div class="budget" id="g-' + key + '">' +
      '<div class="budget-line"><span>' + name + '</span><b>' + value + '</b>' +
      (detail ? '<span class="gd">' + detail + '</span>' : '') + '</div>' +
      '<div class="bar">' +
      '<div class="fill ' + (cls || '') + '" style="width:' + Math.max(0, Math.min(100, frac * 100)).toFixed(1) + '%"></div>' +
      (marker !== undefined ? '<div class="par" style="left:' + (marker * 100).toFixed(1) + '%"></div>' : '') +
      '</div></div>';
  }

  function updateGauges() {
    var st = ui.state;
    var par = st.enc.par;
    var pending = ui.handle ? Heist.pendingCost(st, ui.handle) : 0;
    var charge = Math.max(0, st.charge - pending);
    var frac = Math.min(1, charge / st.chargeMax);
    var cls = frac < 0.2 ? 'over' : (frac < 0.4 ? 'warn' : '');
    // The par marker sits where the bar will be if you spend exactly par.
    var parMark = Math.max(0, (st.chargeMax - par.charge) / st.chargeMax);
    var secured = st.deliveries.filter(function (d) { return d.secured; }).length;
    var html = gauge('charge', 'Charge', charge + ' / ' + st.chargeMax,
      pending ? '-' + pending + ' this plot' : 'spent ' + st.spent + ' (par ' + par.charge + ')', frac, cls, parMark);
    html += gauge('ticks', 'Ticks', st.tick + ' / par ' + par.ticks, '',
      st.tick / par.ticks, st.tick > par.ticks ? 'over' : '');
    if (st.memory !== null) {
      var held = ui.handle ? Heist.traceOf(ui.handle).peakFrontier || 0 : 0;
      html += gauge('memory', 'Memory', held + ' / ' + st.memory + ' leads', held > st.memory ? 'overheating' : '',
        held / st.memory, held > st.memory ? 'over' : (held > st.memory * 0.75 ? 'warn' : ''));
    }
    var left = Heist.swapsLeft(st);
    html += '<div class="budget-line tally"><span>Deliveries</span><b>' + secured + ' / ' + st.deliveries.length + '</b>' +
      '<span>Changes left</span><b' + (left <= 0 ? ' class="badv"' : '') + '>' + left + '</b>' +
      '<span>Lockboxes</span><b>' + st.chestsTaken + '</b>' +
      (st.stolen ? '<span>Stolen</span><b class="badv">' + st.stolen + '</b>' : '') + '</div>';
    el.gauges.innerHTML = html;
  }

  function updateMode() {
    var p = Heist.POWER_BY_ID[ui.power];
    var text;
    if (ui.phase === 'search') {
      text = '<b>' + ui.handle.power.name + '</b> searching &middot; press another power to hot swap &middot; Space to finish';
    } else if (ui.phase === 'ride') {
      text = '<b>Riding</b> &middot; Esc to get off &middot; fire again to re-route';
    } else if (ui.phase === 'over') {
      text = ui.state.status === 'won' ? '<b>Floor cleared</b>' : '<b>Out of charge</b>';
    } else if (ui.hover) {
      text = aimText(ui.hover, p);
    } else {
      text = p ? '<b>' + p.name + '</b> ready &middot; click a delivery to plot a route there &middot; T waits a tick'
        : 'Pick a power';
      if (p && changesPower(p.id)) { text += ' &middot; <span class="warnv">uses a power change</span>'; }
    }
    if (ui.state.freeWalk) { text += ' <span class="debug">free-walk</span>'; }
    el.mode.innerHTML = text;
  }

  function aimText(cell, p) {
    var st = ui.state;
    if (!p) { return 'Pick a power first'; }
    var bot = Heist.visible(st, cell.x, cell.y) && Heist.botAt(st, cell.x, cell.y);
    if (bot) {
      if (bot.type === 'boss') {
        return st.zone.bossShieldedFrom === p.id
          ? 'The <b>Foreman</b> is proofed against ' + p.name + ' here'
          : 'Light the <b>Foreman</b> with ' + p.name + ' &middot; ' + plural(bot.hp, 'plate') + ' left';
      }
      return 'Plot onto the <b>' + bot.name + '</b> with ' + p.name + ' &middot; the route lights it';
    }
    if (Heist.isWall(st.grid, cell.x, cell.y)) { return 'Wall'; }
    var d = Heist.deliveryAt(st, cell.x, cell.y);
    if (d && d.known) { return 'Ride to this <b>delivery</b> with ' + p.name; }
    if (cell.x === st.player.x && cell.y === st.player.y) { return 'Your cart'; }
    return 'Ride here with ' + p.name;
  }

  function toast(text, kind) {
    el.toast.textContent = text;
    el.toast.className = 'toast' + (kind ? ' t-' + kind : '');
    ui.toastTimer = 2.6;
  }

  function drainEvents() {
    var ev = ui.state.events;
    while (ui.seenEvents < ev.length) {
      var e = ev[ui.seenEvents++];
      toast(e.text, e.kind);
    }
  }

  /* -------------------------------------------------------------- actions ---*/

  // Aiming a different power than the last plot's spends a power change.
  function changesPower(id) {
    return ui.state.lastPower !== null && ui.state.lastPower !== id;
  }

  function pressPower(id) {
    if (!powerOpen(id)) {
      var f = unlockFloor(id);
      toast(label(id) + (f ? ' unlocks on floor ' + f + '.' : ' is not on this campaign.'), 'lost');
      return;
    }
    if (ui.phase === 'search') {
      if (id === ui.handle.powerId) { return; }
      var ok = Heist.hotSwap(ui.state, ui.handle, id);
      if (ok === true) {
        ui.power = id;
        toast('Hot swap: ' + Heist.POWER_BY_ID[id].name + ' takes over. Everything found so far is kept.', 'swap');
      } else {
        toast(ok, 'lost');
      }
      markPower();
      updateGauges();
      updateMode();
      return;
    }
    ui.power = id;
    markPower();
    updateMode();
  }

  function fireAt(cell) {
    var st = ui.state;
    if (st.status !== 'playing' || ui.phase === 'search') { return; }
    if (!ui.power) { toast('Pick a power first.'); return; }
    if (Heist.isWall(st.grid, cell.x, cell.y) && Heist.visible(st, cell.x, cell.y)) { return; }
    if (cell.x === st.player.x && cell.y === st.player.y) { return; }

    var handle = Heist.openFire(st, ui.power, { x: cell.x, y: cell.y });
    if (handle.refused) { toast(handle.refused, 'lost'); return; }
    if (ui.phase === 'ride') { Heist.stop(st); }
    ui.handle = handle;
    ui.explored = {};
    ui.frontier = null;
    ui.lastPath = null;
    ui.phase = 'search';
    markPower();
    updateMode();
  }

  function finishSearch() {
    var st = ui.state;
    var outcome = Heist.closeFire(st, ui.handle);
    ui.handle = null;
    ui.frontier = null;
    markPower();
    // The plot's own sentence says more than the events it raised, so it wins.
    drainEvents();
    if (outcome) {
      toast(outcome.message, outcome.hit ? 'hit' : (outcome.rode ? '' : 'lost'));
      if (outcome.rode) { ui.lastPath = outcome.trace.path; }
    }
    // Leave the explored wash up for a beat, so the player sees what it cost.
    window.setTimeout(function () { if (ui.phase !== 'search') { ui.explored = null; } }, 900);
    ui.phase = st.ride ? 'ride' : 'aim';
    ui.rideClock = 0;
    afterAction();
  }

  function boost(id) {
    var st = ui.state;
    if (ui.phase === 'search') { return; }
    var ok = Heist.useBoost(st, id);
    if (ok !== true) { toast(ok, 'lost'); return; }
    ui.save.bank[id] = Math.max(0, (ui.save.bank[id] || 0) - 1);
    saveGame();
    drainEvents();
    buildBoosts();
    afterAction();
  }

  function nudge(screenDir) {
    var st = ui.state;
    if (st.status !== 'playing' || ui.phase === 'search') { return; }
    if (ui.phase === 'ride') { Heist.stop(st); ui.phase = 'aim'; }
    var out = Heist.nudge(st, gridDir(screenDir));
    if (out && !out.moved) { toast(out.message); }
    drainEvents();
    afterAction();
  }

  // W/A/S/D name directions on the SCREEN. The board is turned by rot quarter
  // turns, so the grid direction is the screen one turned back by the same.
  function gridDir(screenDir) {
    return (screenDir - board.rot + 4) % 4;
  }

  function wait() {
    var st = ui.state;
    if (st.status !== 'playing' || ui.phase !== 'aim') { return; }
    Heist.tick(st);
    drainEvents();
    afterAction();
  }

  // One tick of a ride: the cart moves a cell and the world moves with it.
  function rideTick() {
    if (ui.phase !== 'ride') { return; }
    Heist.tick(ui.state);
    drainEvents();
    if (!ui.state.ride && ui.state.status === 'playing') { ui.phase = 'aim'; ui.lastPath = null; }
    afterAction();
  }

  function stopRide() {
    if (ui.phase !== 'ride') { return; }
    Heist.stop(ui.state);
    ui.phase = 'aim';
    ui.lastPath = null;
    updateMode();
  }

  function afterAction() {
    var st = ui.state;
    if (st.status !== 'playing') {
      ui.phase = 'over';
      ui.lastPath = null;
      finishFloor();
    }
    updateGauges();
    updateMode();
  }

  /* -------------------------------------------------------------- verdict ---*/

  function finishFloor() {
    var st = ui.state;
    var enc = st.enc;
    var sum = Heist.summary(st);
    var stars = sum.stars;
    var par = enc.par;
    var debug = st.freeWalk;
    var won = st.status === 'won';
    if (!debug) {
      if (stars > starsOf(ui.index)) { ui.save.stars[enc.level] = stars; }
      if (won) { ui.save.gold += sum.gold; }
      saveGame();
    }

    el.stars.textContent = '★★★☆☆☆'.substr(3 - stars, 3);
    el.stars.className = 'stars s' + stars;
    if (won) {
      el.verdict.textContent = stars === 3 ? 'You outsmarted the floor.' :
        (stars === 2 ? 'Cleared, with room to spare on one bar.' : 'Cleared - the hard way.');
      var misses = [];
      if (sum.ticks > par.ticks) { misses.push(sum.ticks + ' ticks against a par of ' + par.ticks); }
      if (sum.spent > par.charge) { misses.push(sum.spent + ' charge against a par of ' + par.charge); }
      el.why.textContent = st.starCap !== undefined && st.starCap < 3 && stars === st.starCap
        ? 'Every delivery secured. A boost was used, so the floor tops out at ' + st.starCap + ' stars.'
        : (misses.length
          ? 'Every delivery secured, but ' + misses.join(' and ') + '. A cheaper power, or a better moment to plot, gets the rest.'
          : 'Every delivery secured, under par on ticks and on charge.');
    } else {
      el.verdict.textContent = 'Out of charge.';
      el.why.textContent = st.reason + ' ' + sum.secured + ' of ' + sum.deliveries +
        ' deliveries were secured.' + (sum.plots ? ' The expensive plot is usually the one that searched the whole floor.' : '');
    }
    if (debug) { el.why.textContent += ' (Free-walk was on, so nothing is kept.)'; }
    el.chip.textContent = 'The lesson';
    el.note.textContent = enc.teaches;

    var cells = [
      ['Deliveries', sum.secured + ' / ' + sum.deliveries, sum.secured === sum.deliveries],
      // Par only means something on a floor that was cleared.
      ['Ticks', sum.ticks + ' (par ' + par.ticks + ')', won ? sum.ticks <= par.ticks : null],
      ['Charge spent', sum.spent + ' (par ' + par.charge + ')', won ? sum.spent <= par.charge : null],
      ['Plots', sum.plots + (sum.hits ? ', ' + plural(sum.hits, 'foreman hit') : ''), null],
      ['Lockboxes', sum.chests + ' recovered, ' + sum.stolen + ' stolen', null],
      ['Gold', won && !debug ? '+' + sum.gold + ' (' + ui.save.gold + ' banked)' : 'none this run', null]
    ];
    el.runGrid.innerHTML = cells.map(function (c) {
      var cls = c[2] === null ? '' : (c[2] ? ' ok' : ' miss');
      return '<div class="cmp run' + cls + '"><div class="cmp-head">' + c[0] + '</div><div class="cmp-stats"><b>' + c[1] + '</b></div></div>';
    }).join('');

    updateNext();
    buildShop();
    buildFloorbar();
    updateStarTotal();
    window.setTimeout(showOverlay, 450);
  }

  function updateNext() {
    var last = ui.index === LEVELS.length - 1;
    var nextOpen = !last && floorOpen(ui.index + 1);
    var gives = !last && LEVELS[ui.index + 1].unlocks;
    el.next.textContent = last ? 'Back to floor 1' : 'Next floor';
    el.next.disabled = !last && !nextOpen;
    el.gate.textContent = (!last && !nextOpen) ? 'Earn one star here to open the next floor.' :
      (gives && ui.save.earlyUnlocked.indexOf(gives) === -1
        ? 'Next floor hands over ' + Heist.POWER_BY_ID[gives].name + ' (' + label(gives) + ').' : '');
  }

  /* ----------------------------------------------------------------- shop ---
   * Between floors: the boosts cleared floors have put on the shelf, and the
   * one early power per campaign. Shop.shelf decides what is on offer. */

  function buildShop() {
    var nextLevel = ui.index === LEVELS.length - 1 ? 1 : LEVELS[ui.index + 1].level;
    var shelf = Shop.shelf(nextLevel, ui.save);
    var gold = ui.save.gold;
    var items = shelf.boosts.map(function (b) {
      var have = ui.save.bank[b.id] || 0;
      var full = have >= b.perLevel;
      return shopItem('boost', b.id, b.name + (have ? ' <small>&times;' + have + ' carried</small>' : ''), b.does +
        (b.capsStars ? ' Using it caps the floor at ' + b.capsStars + ' stars.' : ''), b.price, full ? 'carrying the most a floor allows' : '');
    });
    if (shelf.power) {
      var p = Heist.POWER_BY_ID[shelf.power.id];
      items.push(shopItem('power', p.id, p.name + ' <small>' + label(p.id) + ', early</small>',
        'Yours from floor ' + shelf.power.earlyAt + ' instead of ' + shelf.power.unlockLevel + '. One early power per campaign.',
        shelf.power.earlyPrice, ''));
    }
    el.shop.innerHTML = items.length
      ? '<h3>The shop <span class="gold">' + gold + ' gold</span></h3><div class="shelf">' + items.join('') + '</div>'
      : '';
    Array.prototype.forEach.call(el.shop.querySelectorAll('button[data-buy]'), function (b) {
      b.disabled = b.disabled || +b.dataset.price > gold;
      b.addEventListener('click', function () { buy(b.dataset.buy, b.dataset.id, +b.dataset.price); });
    });
  }

  function shopItem(kind, id, name, does, price, why) {
    return '<div class="ware"><div class="ware-head">' + name + '</div><p>' + does + '</p>' +
      '<button data-buy="' + kind + '" data-id="' + id + '" data-price="' + price + '"' + (why ? ' disabled title="' + why + '"' : '') + '>' +
      (why || 'Buy &middot; ' + price + ' gold') + '</button></div>';
  }

  function buy(kind, id, price) {
    if (ui.save.gold < price) { return; }
    ui.save.gold -= price;
    if (kind === 'power') {
      ui.save.earlyUnlocked.push(id);
      toast(Heist.POWER_BY_ID[id].name + ' is yours from the next floor.', 'swap');
    } else {
      ui.save.bank[id] = (ui.save.bank[id] || 0) + 1;
      toast(Shop.BOOST_BY_ID[id].name + ' bought. It rides in with you on the next floor.', 'swap');
    }
    saveGame();
    buildShop();
    updateNext();
    updateStarTotal();
  }

  function showOverlay() {
    if (ui.phase !== 'over') { return; }
    el.toast.classList.add('hidden');
    ui.toastTimer = 0;
    el.overlay.classList.remove('hidden');
    document.body.classList.add('overlay-open');
  }

  function hideOverlay() {
    el.overlay.classList.add('hidden');
    document.body.classList.remove('overlay-open');
  }

  /* ------------------------------------------------------------ the loop ---*/

  function frame(now) {
    var dt = ui.lastFrame ? Math.min(0.1, (now - ui.lastFrame) / 1000) : 0;
    ui.lastFrame = now;
    // While the floor swings, keep the cart framed: a turn pivots about the
    // middle of the map, which can carry the cart off the screen.
    if (HeistBoard.stepSpin(board, dt) && !ui.overview) {
      board.follow(ui.state, window.innerWidth, window.innerHeight, insets(), true);
    }

    if (ui.phase === 'search') {
      var speed = +el.speed.value;
      var n = Math.max(1, Math.round(speed * speed / 14));
      for (var k = 0; k < n && ui.handle && !ui.handle.done; k++) {
        var step = Heist.stepFire(ui.handle);
        if (step) {
          ui.explored[step.i] = true;
          ui.frontier = step.frontierCells || null;
        }
      }
      updateGauges();
      if (ui.handle.done) { finishSearch(); }
    } else if (ui.phase === 'ride') {
      ui.rideClock += dt * 1000;
      while (ui.rideClock >= ui.rideMs && ui.phase === 'ride') {
        ui.rideClock -= ui.rideMs;
        rideTick();
      }
      if (!ui.overview) { board.follow(ui.state, window.innerWidth, window.innerHeight, insets(), false); }
    }

    if (ui.toastTimer > 0) {
      ui.toastTimer -= dt;
      if (ui.toastTimer <= 0) { el.toast.classList.add('hidden'); }
    }

    board.draw(ui.state, overlay());
    window.requestAnimationFrame(frame);
  }

  function overlay() {
    var st = ui.state;
    var o = { hover: ui.hover };
    if (ui.explored) {
      o.explored = ui.explored;
      o.bust = ui.handle && Heist.pendingCost(st, ui.handle) >= st.charge;
    }
    if (ui.frontier) {
      var f = {};
      ui.frontier.forEach(function (i) { f[i] = true; });
      o.frontier = f;
    }
    if (st.ride) {
      o.path = [{ x: st.player.x, y: st.player.y }].concat(st.ride.path.slice(st.ride.i));
    } else if (ui.handle) {
      var t = Heist.traceOf(ui.handle);
      if (t.found && t.path.length > 1) { o.path = t.path; }
    }
    if (ui.phase === 'aim' && ui.hover) { o.aim = ui.hover; }
    return o;
  }

  /* --------------------------------------------------------------- camera ---*/

  function insets() {
    return {
      top: el.hudTop.offsetHeight * 0.55,
      bottom: document.body.classList.contains('overlay-open') ? window.innerHeight * 0.4 : el.hudBottom.offsetHeight * 0.7
    };
  }

  function resize(refit) {
    HeistBoard.sizeCanvas(el.canvas, window.innerWidth, window.innerHeight);
    // The power bar and the readouts hide the board under them.
    board.covered = {
      top: el.legend.getBoundingClientRect().bottom,
      bottom: window.innerHeight - el.powers.getBoundingClientRect().top
    };
    if (refit) { refitCamera(); }
  }

  // F flips between the play framing (close, following the cart) and an
  // overview of the whole floor.
  function refitCamera(overview) {
    ui.overview = !!overview;
    board.fit(ui.state, window.innerWidth, window.innerHeight, insets(), ui.overview);
    if (!ui.overview) { board.follow(ui.state, window.innerWidth, window.innerHeight, insets(), true); }
  }

  function turn(dir) {
    // Turn about the middle of the screen, which is where the eye is.
    board.turn(dir);
  }

  /* ---------------------------------------------------------------- input ---*/

  function bindInput() {
    el.canvas.addEventListener('pointerdown', function (e) {
      ui.drag = { x: e.clientX, y: e.clientY, cx: board.cam.x, cy: board.cam.y, moved: false };
      el.canvas.setPointerCapture(e.pointerId);
    });
    el.canvas.addEventListener('pointermove', function (e) {
      if (ui.drag) {
        var dx = e.clientX - ui.drag.x;
        var dy = e.clientY - ui.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) { ui.drag.moved = true; el.canvas.classList.add('dragging'); }
        if (ui.drag.moved) {
          board.cam.x = ui.drag.cx + dx;
          board.cam.y = ui.drag.cy + dy;
        }
      }
      var c = board.cellAt(e.clientX, e.clientY, ui.state);
      var same = c && ui.hover && c.x === ui.hover.x && c.y === ui.hover.y;
      if (!same) { ui.hover = c; updateMode(); }
    });
    el.canvas.addEventListener('pointerup', function (e) {
      var d = ui.drag;
      ui.drag = null;
      el.canvas.classList.remove('dragging');
      if (d && !d.moved) {
        var c = board.cellAt(e.clientX, e.clientY, ui.state);
        if (c) { fireAt(c); }
      }
    });
    el.canvas.addEventListener('pointerleave', function () { ui.hover = null; updateMode(); });
    el.canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var k = Math.exp(-e.deltaY * 0.0015);
      var s = Math.max(0.8, Math.min(5, board.cam.scale * k));
      k = s / board.cam.scale;
      board.cam.x = e.clientX - (e.clientX - board.cam.x) * k;
      board.cam.y = e.clientY - (e.clientY - board.cam.y) * k;
      board.cam.scale = s;
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) { return; }
      if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') { return; }
      var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      var at = KEYS.indexOf(key);
      if (at !== -1) { pressPower(POWERS[at].id); e.preventDefault(); return; }
      var dir = { d: 0, ArrowRight: 0, s: 1, ArrowDown: 1, a: 2, ArrowLeft: 2, w: 3, ArrowUp: 3 }[key];
      if (dir !== undefined) {
        e.preventDefault();
        // Screen right/down/left/up are the grid's east/south/west/north on an
        // unturned board, which is how the isometric camera is laid out.
        nudge(dir);
        return;
      }
      switch (key) {
        case 'q': turn(-1); break;
        case 'e': turn(1); break;
        case 'f': refitCamera(!ui.overview); break;
        case 'r': loadFloor(ui.index); break;
        case 't': wait(); break;
        case ' ':
          e.preventDefault();
          if (ui.phase === 'search') { while (!ui.handle.done) { Heist.stepFire(ui.handle); } finishSearch(); } else { wait(); }
          break;
        case 'Escape':
          if (!el.overlay.classList.contains('hidden')) { hideOverlay(); } else { stopRide(); }
          break;
        case 'Enter':
          if (!el.overlay.classList.contains('hidden') && !el.next.disabled) { el.next.click(); }
          break;
        default: return;
      }
    });

    el.rotL.addEventListener('click', function () { turn(-1); });
    el.rotR.addEventListener('click', function () { turn(1); });
    el.fit.addEventListener('click', function () { refitCamera(!ui.overview); });
    el.retry.addEventListener('click', function () { loadFloor(ui.index); });
    el.retry2.addEventListener('click', function () { loadFloor(ui.index); });
    el.close.addEventListener('click', hideOverlay);
    el.next.addEventListener('click', function () {
      loadFloor(ui.index === LEVELS.length - 1 ? 0 : ui.index + 1);
    });
    el.freewalk.addEventListener('change', function () {
      ui.state.freeWalk = el.freewalk.checked;
      el.freewalk.blur();
      updateMode();
    });
    window.addEventListener('resize', function () { resize(false); });
  }

  /* ---------------------------------------------------------------- start ---*/

  bindInput();
  // Open on the furthest floor the player has reached.
  var start = 0;
  for (var i = 0; i < LEVELS.length; i++) { if (floorOpen(i)) { start = i; } }
  if (ui.unlockAll) { start = 0; }
  loadFloor(start);
  window.requestAnimationFrame(frame);

  // For the browser walkthrough: read-only access to the live run.
  window.__heist = { ui: ui, board: board, loadFloor: loadFloor, fireAt: fireAt, pressPower: pressPower, nudge: nudge, wait: wait, rideTick: rideTick, boost: boost, buy: buy };
}());
