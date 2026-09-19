/* game.js - level state, camera, controls, scoring, verdict overlay.
 *
 * The board fills the window and the HUD floats over it. Nothing here knows
 * how many algorithms exist: the picker, the glossary cards and the compare
 * strip are all built from the strategy registry, so a strategy added in
 * search.js appears in the UI on its own.
 */

/* ---------- strategy registry ---------- */

// search.js owns the registry. Until it exports one, this describes the four
// strategies the current engine ships with, in the same shape.
var FALLBACK_STRATEGIES = [
  {
    id: 'bfs', name: 'BFS', family: 'blind', frontier: 'queue',
    tagline: 'first in, first out',
    guarantee: 'Fewest steps, always - on an unweighted map.',
    cost: 'Expands every cell at the current distance before going deeper.',
    goodWhen: 'Steps are what counts and memory is not scarce.',
    badWhen: 'Terrain has costs, or the map branches and memory is capped.'
  },
  {
    id: 'dfs', name: 'DFS', family: 'blind', frontier: 'stack',
    tagline: 'last in, first out',
    guarantee: 'Finds a route if one exists. Says nothing about how good it is.',
    cost: 'Almost no memory: one corridor at a time.',
    goodWhen: 'Any route will do and memory is the binding constraint.',
    badWhen: 'The objective is shortest or cheapest.'
  },
  {
    id: 'dijkstra', name: 'Dijkstra', family: 'weighted', frontier: 'lowest cost so far',
    tagline: 'cheapest frontier first',
    guarantee: 'Cheapest route, always - with non-negative costs.',
    cost: 'Blind to the goal, so it spreads in every direction.',
    goodWhen: 'Weights matter, or the goal is unknown or plural.',
    badWhen: 'One known goal on a big map under a tight fuel budget.'
  },
  {
    id: 'astar', name: 'A*', family: 'informed', frontier: 'cost so far + guess',
    tagline: 'cost + distance to goal',
    guarantee: 'Cheapest route, as long as the guess never overestimates.',
    cost: 'Holds the largest frontier of the four: it buys time with memory.',
    goodWhen: 'One known goal and an honest distance estimate.',
    badWhen: 'The goal is unknown, the guess lies, or memory is capped.'
  }
];

// A button has room for a few words; the registry's frontier rule is a
// sentence, so the newer strategies get a short line of their own here.
var TAGLINES = {
  wastar: 'cost + w x guess',
  bibfs: 'two queues, meeting',
  iddfs: 'deeper stack each pass',
  beam: 'best k leads only',
  bellman: 'relax every edge',
  flow: 'a field from the goal',
  wall: 'one hand on the wall'
};

function registry() {
  var list = (typeof STRATEGIES !== 'undefined' && STRATEGIES && STRATEGIES.length)
    ? STRATEGIES
    : FALLBACK_STRATEGIES;
  return list.map(function (s, i) {
    var fb = FALLBACK_STRATEGIES[i] || {};
    // Never an id on screen: the registry's human label comes first.
    return {
      id: s.id || s.key || fb.id,
      name: s.name || s.label || fb.name || s.id,
      family: s.family || fb.family || (s.needsHeuristic ? 'informed' : 'blind'),
      frontier: s.frontier || fb.frontier || TAGLINES[s.id] || '',
      tagline: s.tagline || fb.tagline || TAGLINES[s.id] || '',
      guarantee: s.guarantee || fb.guarantee || s.description || '',
      cost: s.cost || fb.cost || s.frontierRule || '',
      goodWhen: s.goodWhen || fb.goodWhen || s.wins || '',
      badWhen: s.badWhen || fb.badWhen || s.fails || '',
      weightable: s.weightable === true,
      bidirectional: s.bidirectional === true
    };
  });
}

var STRATS = registry();
var BY_ID = {};
STRATS.forEach(function (s) { BY_ID[s.id] = s; });
function nameOf(id) { return (BY_ID[id] && BY_ID[id].name) || id; }

/* ---------- concepts ---------- */

var CONCEPTS = {
  optimality: {
    label: 'Optimality',
    note: 'An algorithm can be complete (it finds a route) without being optimal (it finds the best one).'
  },
  weights: {
    label: 'Weights',
    note: 'Counting steps and counting cost are different questions, and they have different answers.'
  },
  heuristics: {
    label: 'Heuristics',
    note: 'A heuristic is knowledge of where the goal is. It buys expansions, and it costs memory.'
  },
  space: {
    label: 'Space complexity',
    note: 'The frontier is what a search holds in memory. Time is not the only budget.'
  },
  admissibility: {
    label: 'Admissibility',
    note: 'A heuristic that overestimates can talk A* out of the best route. Optimality depends on an honest guess.'
  },
  bounded: {
    label: 'Bounded suboptimality',
    note: 'Weighting the guess trades a known slice of optimality for a large cut in work.'
  },
  meeting: {
    label: 'Meet in the middle',
    note: 'Two half-depth searches hold far less than one full-depth search.'
  }
};

/* ---------- elements ---------- */

var el = {
  canvas: document.getElementById('map'),
  title: document.getElementById('level-title'),
  progress: document.getElementById('level-progress'),
  starTotal: document.getElementById('star-total'),
  brief: document.getElementById('level-brief'),
  objective: document.getElementById('objective'),
  budgets: document.getElementById('budgets'),
  legend: document.getElementById('legend'),
  algos: document.getElementById('algos'),
  levelbar: document.getElementById('levelbar'),
  glossary: document.getElementById('glossary'),
  step: document.getElementById('btn-step'),
  play: document.getElementById('btn-play'),
  retry: document.getElementById('btn-retry'),
  retry2: document.getElementById('btn-retry-2'),
  next: document.getElementById('btn-next'),
  speed: document.getElementById('speed'),
  weightBox: document.getElementById('weight-box'),
  weight: document.getElementById('weight'),
  weightVal: document.getElementById('weight-val'),
  overlay: document.getElementById('overlay'),
  overlayClose: document.getElementById('overlay-close'),
  stars: document.getElementById('stars'),
  verdictText: document.getElementById('verdict-text'),
  verdictWhy: document.getElementById('verdict-why'),
  conceptChip: document.getElementById('concept-chip'),
  conceptNote: document.getElementById('concept-note'),
  gateNote: document.getElementById('gate-note'),
  compareGrid: document.getElementById('compare-grid'),
  hudTop: document.querySelector('.hud-top'),
  hudBottom: document.querySelector('.hud-bottom')
};

var state = {
  levelIndex: 0,
  level: null,
  grid: null,
  traces: null,
  refs: null,
  chosen: null,
  index: 0,
  playing: false,
  lastTime: 0,
  carry: 0,
  weight: 1,
  cam: createCamera(),
  earned: loadStars()
};

/* ---------- persistence ---------- */

function loadStars() {
  try {
    var raw = window.localStorage.getItem('pathfinder.stars.v1');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};   // file:// with storage disabled: play on, just do not persist
  }
}

function saveStars() {
  try {
    window.localStorage.setItem('pathfinder.stars.v1', JSON.stringify(state.earned));
  } catch (e) { /* nothing to do: the run still scores on screen */ }
}

function totalStars() {
  return Object.keys(state.earned).reduce(function (n, k) { return n + state.earned[k]; }, 0);
}

// Training hands out the first four algorithms two, then one, then one at a
// time (TRAINING_UNLOCKS in campaign.js); everything else is out from the
// level after the last of them. Returns the 0-based level a strategy opens on.
function unlockLevel(id) {
  var table = (typeof TRAINING_UNLOCKS !== 'undefined') ? TRAINING_UNLOCKS : [];
  var last = 0;
  for (var i = 0; i < table.length; i++) {
    if (table[i].indexOf(id) !== -1) { return i; }
    if (table[i].length) { last = i; }
  }
  return table.length ? last + 1 : 0;
}

function algoOpen(id) { return unlockLevel(id) <= state.levelIndex; }

function unlocked(i) {
  return i === 0 || (state.earned[i - 1] || 0) > 0 || (state.earned[i] || 0) > 0;
}

/* ---------- engine calls ---------- */

// The engine may or may not take options yet; both shapes are supported.
function runSearch(strategy) {
  var s = BY_ID[strategy];
  if (s && s.weightable) {
    try { return search(state.grid, strategy, { weight: state.weight }); } catch (e) { /* fall through */ }
  }
  return search(state.grid, strategy);
}

function computeTraces() {
  state.traces = {};
  STRATS.forEach(function (s) { state.traces[s.id] = runSearch(s.id); });
  state.refs = {
    bestSteps: bestOf('pathSteps'),
    bestCost: bestOf('pathCost')
  };
}

function bestOf(field) {
  var best = Infinity;
  STRATS.forEach(function (s) {
    var t = state.traces[s.id];
    if (t.found && t[field] < best) { best = t[field]; }
  });
  return best;
}

/* ---------- scoring ---------- */

function objectiveMet(level, trace, refs) {
  if (!trace.found) { return false; }
  if (level.objective === 'shortest') { return trace.pathSteps === refs.bestSteps; }
  if (level.objective === 'cheapest') { return trace.pathCost === refs.bestCost; }
  return true;
}

function budgetBreaches(level, trace) {
  var b = level.budgets || {};
  var out = [];
  if (b.expansions !== undefined && trace.expansions > b.expansions) {
    out.push({ kind: 'expansions', used: trace.expansions, limit: b.expansions });
  }
  if (b.frontier !== undefined && trace.peakFrontier > b.frontier) {
    out.push({ kind: 'frontier', used: trace.peakFrontier, limit: b.frontier });
  }
  return out;
}

function starsFor(level, trace, refs) {
  if (!objectiveMet(level, trace, refs)) { return 0; }
  return budgetBreaches(level, trace).length === 0 ? 3 : 1;
}

function starText(stars) { return '★★★☆☆☆'.substr(3 - stars, 3); }

/* ---------- which concept this level teaches ---------- */

function conceptFor(level) {
  if (level.concept && CONCEPTS[level.concept]) { return CONCEPTS[level.concept]; }
  if (level.teleports) { return CONCEPTS.admissibility; }

  var b = level.budgets || {};
  if (b.frontier !== undefined && b.expansions === undefined) { return CONCEPTS.space; }

  if (level.objective === 'cheapest') {
    // If the blind optimal search cannot afford this map, the level is about
    // knowing where the goal is. Otherwise it is about cost versus distance.
    var blind = state.traces.dijkstra;
    if (blind && b.expansions !== undefined && blind.expansions > b.expansions) {
      return CONCEPTS.heuristics;
    }
    return CONCEPTS.weights;
  }
  if (level.objective === 'any') { return CONCEPTS.space; }

  // A step-counting level is about optimality unless nothing can actually get
  // the answer wrong and the memory budget is what bites.
  var missable = false;
  var memoryBites = false;
  STRATS.forEach(function (s) {
    var t = state.traces[s.id];
    if (!t) { return; }
    if (!objectiveMet(level, t, state.refs)) { missable = true; }
    if (b.frontier !== undefined && t.peakFrontier > b.frontier) { memoryBites = true; }
  });
  if (!missable && memoryBites) { return CONCEPTS.space; }
  return CONCEPTS.optimality;
}

/* ---------- the one-sentence why ---------- */

function whySentence(level, algo, trace, refs) {
  var name = nameOf(algo);

  if (!trace.found) {
    return name + ' ran out of reachable cells without ever touching the goal.';
  }

  if (level.objective === 'shortest' && trace.pathSteps !== refs.bestSteps) {
    if (algo === 'dfs') {
      return 'DFS follows the first corridor that opens and never compares lengths, so it handed in a ' +
        trace.pathSteps + '-step route when ' + refs.bestSteps + ' steps was there for the taking.';
    }
    return name + ' returned ' + trace.pathSteps + ' steps where ' + refs.bestSteps + ' was possible.';
  }

  if (level.objective === 'cheapest' && trace.pathCost !== refs.bestCost) {
    if (algo === 'bfs') {
      return 'BFS counts steps, not cost, so it waded straight through the swamp: cost ' + trace.pathCost +
        ' when a longer route on grass cost only ' + refs.bestCost + '.';
    }
    if (algo === 'dfs') {
      return 'DFS has no notion of distance or cost at all, so its route cost ' + trace.pathCost +
        ' against the cheapest ' + refs.bestCost + '.';
    }
    return name + ' returned a path costing ' + trace.pathCost + ' where ' + refs.bestCost + ' was possible.';
  }

  var breaches = budgetBreaches(level, trace);
  if (breaches.length > 0) {
    var b = breaches[0];
    if (b.kind === 'expansions') {
      if (algo === 'dijkstra') {
        return 'Dijkstra found the right answer but has no idea where the goal is, so it fanned out over the whole map: ' +
          b.used + ' expansions against a budget of ' + b.limit + '.';
      }
      if (algo === 'bfs') {
        return 'BFS expands every cell at the current distance before going deeper, blind to the goal: ' +
          b.used + ' expansions against a budget of ' + b.limit + '.';
      }
      return name + ' spent ' + b.used + ' expansions against a budget of ' + b.limit + '.';
    }
    if (algo === 'bfs' || algo === 'dijkstra') {
      return name + ' has to hold every open branch at once, so its frontier peaked at ' + b.used +
        ' cells against a budget of ' + b.limit + '.';
    }
    return name + ' peaked at ' + b.used + ' frontier cells against a budget of ' + b.limit + '.';
  }

  // Three stars: teach by contrast with whichever rival worked hardest for the
  // SAME answer. A rival that missed the objective did not get the same answer,
  // so it cannot carry this sentence - on the levels DFS or BFS is designed to
  // fail, claiming it would have is the opposite of the lesson.
  var peers = STRATS.map(function (s) { return s.id; }).filter(function (a) {
    return a !== algo && state.traces[a] && objectiveMet(level, state.traces[a], refs);
  });
  if (peers.length > 0) {
    var rival = peers.reduce(function (acc, a) {
      return state.traces[a].expansions > state.traces[acc].expansions ? a : acc;
    });
    var rivalTrace = state.traces[rival];
    if (rivalTrace.expansions > trace.expansions * 1.2) {
      return 'On this map ' + nameOf(rival) + ' would have spent ' + rivalTrace.expansions +
        ' expansions to get the same answer, and ' + name + ' needed only ' + trace.expansions + '.';
    }
  }
  if (level.objective === 'any') {
    return 'Reaching the goal was never the hard part here - holding the search in memory was, and ' +
      name + ' peaked at just ' + trace.peakFrontier + ' frontier cells.';
  }
  return name + ' met the objective inside every budget on this map.';
}

/* ---------- HUD building ---------- */

function buildPicker() {
  el.algos.innerHTML = '';
  STRATS.forEach(function (s) {
    var b = document.createElement('button');
    var open = algoOpen(s.id);
    b.className = 'algo' + (open ? '' : ' locked');
    b.dataset.algo = s.id;
    b.disabled = !open;
    b.innerHTML = '<span>' + s.name + '</span><small>' +
      (open ? s.tagline : 'Level ' + (unlockLevel(s.id) + 1)) + '</small>';
    b.addEventListener('click', function () { choose(s.id); });
    b.addEventListener('mouseenter', function () { showGlossary(s, b); });
    b.addEventListener('focus', function () { showGlossary(s, b); });
    b.addEventListener('mouseleave', hideGlossary);
    b.addEventListener('blur', hideGlossary);
    el.algos.appendChild(b);
  });
}

function showGlossary(s, anchor) {
  window.clearTimeout(glossaryTimer);
  el.glossary.innerHTML =
    '<div class="fam">' + s.family + ' search</div>' +
    '<h4>' + s.name + '</h4>' +
    '<dl>' +
    '<dt>Frontier</dt><dd>' + s.frontier + '</dd>' +
    '<dt>Guarantee</dt><dd>' + s.guarantee + '</dd>' +
    '<dt>Cost</dt><dd>' + s.cost + '</dd>' +
    '<dt>Good when</dt><dd class="good">' + s.goodWhen + '</dd>' +
    '<dt>Bad when</dt><dd class="bad">' + s.badWhen + '</dd>' +
    '</dl>';
  el.glossary.classList.remove('hidden');
  var r = anchor.getBoundingClientRect();
  var gw = el.glossary.offsetWidth;
  var gh = el.glossary.offsetHeight;
  var left = Math.max(12, Math.min(window.innerWidth - gw - 12, r.left + r.width / 2 - gw / 2));
  el.glossary.style.left = left + 'px';
  el.glossary.style.top = Math.max(12, r.top - gh - 10) + 'px';
}

function hideGlossary() { el.glossary.classList.add('hidden'); }

function buildLegend() {
  var items = [
    ['#e9e4d6', 'grass 1'],
    ['#7fa070', 'swamp 5'],
    ['#4a5273', 'wall'],
    ['#3a61ad', 'explored'],
    ['#ffc94d', 'frontier'],
    ['#ff5d73', 'path']
  ];
  if (state.level.teleports) { items.push(['#b07cff', 'teleporter']); }
  el.legend.innerHTML = items.map(function (it) {
    return '<span><i style="background:' + it[0] + '"></i>' + it[1] + '</span>';
  }).join('');
}

function buildBudgets() {
  var b = state.level.budgets || {};
  var rows = '';
  if (b.expansions !== undefined) { rows += budgetRow('exp', 'Fuel (expansions)', b.expansions); }
  if (b.frontier !== undefined) { rows += budgetRow('front', 'Memory (frontier peak)', b.frontier); }
  el.budgets.innerHTML = rows;
}

function budgetRow(key, label, limit) {
  return '<div class="budget" id="bud-' + key + '">' +
    '<div class="budget-line"><span>' + label + '</span>' +
    '<span><b id="' + key + '-count">0</b> / ' + limit + '</span></div>' +
    '<div class="bar"><div id="' + key + '-bar" class="fill"></div></div></div>';
}

function buildLevelBar() {
  el.levelbar.innerHTML = '';
  LEVELS.forEach(function (lv, i) {
    var b = document.createElement('button');
    var open = unlocked(i);
    b.className = 'lvl' + (i === state.levelIndex ? ' current' : '') + (open ? '' : ' locked');
    b.innerHTML = '<b>' + (i + 1) + '</b><span class="s">' +
      (state.earned[i] ? starText(state.earned[i]).replace(/☆/g, '') : '') + '</span>';
    b.title = open ? lv.name : 'Earn a star on level ' + i + ' to unlock';
    b.disabled = !open;
    b.addEventListener('click', function () { if (open) { loadLevel(i); } });
    el.levelbar.appendChild(b);
  });
}

function updateStarTotal() {
  var max = LEVELS.length * 3;
  el.starTotal.textContent = '★ ' + totalStars() + ' / ' + max;
}

/* ---------- level loading ---------- */

function loadLevel(i) {
  state.levelIndex = i;
  state.level = LEVELS[i];
  state.grid = parseGrid(state.level.map);
  computeTraces();

  el.title.textContent = state.level.name;
  el.progress.textContent = 'Level ' + (i + 1) + ' of ' + LEVELS.length;
  el.brief.textContent = state.level.brief;
  el.objective.innerHTML = objectiveLine();
  buildBudgets();
  buildLegend();
  buildLevelBar();
  buildPicker();
  updateStarTotal();
  hideOverlay();
  resetRun(null);
  resize(true);
}

function objectiveLine() {
  var o = state.level.objective;
  if (o === 'shortest') {
    return '<b>Fewest steps.</b> A route that arrives the long way does not count.';
  }
  if (o === 'cheapest') {
    return '<b>Lowest terrain cost.</b> Swamp costs five a tile, grass costs one.';
  }
  return '<b>Just reach the goal.</b> Any route counts - the budget is what will hurt you.';
}

function resetRun(algo) {
  state.chosen = algo;
  state.index = 0;
  state.playing = false;
  state.carry = 0;
  el.play.textContent = 'Play';
  el.step.disabled = !algo;
  el.play.disabled = !algo;
  el.retry.disabled = !algo;
  setActiveButton(algo);
  updateWeightBox();
  updateBudgets();
  draw();
}

var glossaryTimer = null;

function choose(algo) {
  resetRun(algo);
  hideOverlay();
  // Hover does not exist on a touch screen, so picking an algorithm shows its
  // card for a moment: the player still meets the vocabulary before the run.
  var btn = el.algos.querySelector('[data-algo="' + algo + '"]');
  if (btn && BY_ID[algo]) {
    showGlossary(BY_ID[algo], btn);
    window.clearTimeout(glossaryTimer);
    glossaryTimer = window.setTimeout(hideGlossary, 2600);
  }
}

function setActiveButton(algo) {
  Array.prototype.forEach.call(el.algos.children, function (b) {
    b.classList.toggle('active', b.dataset.algo === algo);
  });
}

function updateWeightBox() {
  var s = state.chosen ? BY_ID[state.chosen] : null;
  el.weightBox.classList.toggle('hidden', !(s && s.weightable));
}

/* ---------- camera and drawing ---------- */

// Frame the level inside the band of screen the HUD leaves free. When the
// verdict sheet is up it takes the bottom of the screen, so the board pulls
// back into what is left rather than hiding the route behind the card.
function fitToLevel() {
  var top = el.hudTop.offsetHeight * 0.72;
  var bottom = el.hudBottom.offsetHeight * 0.86 + 26;
  if (!el.overlay.classList.contains('hidden')) {
    var sheet = el.overlay.querySelector('.sheet');
    top = el.hudTop.offsetHeight * 0.45;
    bottom = sheet.offsetHeight + 34;
  }
  var h = window.innerHeight - top - bottom;
  // On a short window the sheet would squeeze the board into a sliver, which
  // is worse than letting the world run on behind it.
  if (h < 280) {
    top = 0;
    h = window.innerHeight;
  }
  fitCamera(state.cam, state.grid, window.innerWidth, h, 26);
  state.cam.y += top;
}

function resize(refit) {
  sizeCanvas(el.canvas, window.innerWidth, window.innerHeight);
  if (refit) { fitToLevel(); }
  draw();
}

function breachIndex() {
  var b = (state.level.budgets || {}).expansions;
  return b === undefined ? undefined : b;
}

function sidesOf(trace, upTo) {
  // Bidirectional engines may tag each frontier cell with its half.
  if (!trace || !trace.steps.length) { return null; }
  var step = trace.steps[Math.max(0, Math.min(upTo, trace.steps.length) - 1)];
  if (!step || !step.frontierSides) { return null; }
  var map = {};
  step.frontierCells.forEach(function (ci, k) { map[ci] = step.frontierSides[k]; });
  return map;
}

function draw() {
  var trace = state.chosen ? state.traces[state.chosen] : null;
  var memLimit = (state.level.budgets || {}).frontier;
  drawScene(el.canvas, state.grid, trace, state.index, state.cam, {
    breachAt: breachIndex(),
    cursor: true,
    teleports: state.level.teleports,
    sides: sidesOf(trace, state.index),
    frontierOver: !!(trace && memLimit !== undefined &&
      peakFrontierUpTo(trace, state.index) > memLimit)
  });
}

/* ---------- budgets ---------- */

function peakFrontierUpTo(trace, index) {
  var peak = 0;
  for (var k = 0; k < index && k < trace.steps.length; k++) {
    if (trace.steps[k].frontierSize > peak) { peak = trace.steps[k].frontierSize; }
  }
  return peak;
}

// A budget that does not apply is no longer drawn at all - buildBudgets emits
// a row only for the budgets a level actually has, and rebuilds them per level
// - so the stale-red-bar case QA found cannot arise here. The toggles below
// still clear their own classes on every update.
function setBar(key, used, limit) {
  var bar = document.getElementById(key + '-bar');
  var count = document.getElementById(key + '-count');
  if (!bar) { return; }
  count.textContent = used;
  var ratio = used / limit;
  bar.style.width = Math.min(100, ratio * 100) + '%';
  bar.classList.toggle('warn', ratio > 0.75 && ratio <= 1);
  bar.classList.toggle('over', used > limit);
}

function updateBudgets() {
  var b = state.level.budgets || {};
  var trace = state.chosen ? state.traces[state.chosen] : null;
  if (b.expansions !== undefined) {
    setBar('exp', trace ? Math.min(state.index, trace.steps.length) : 0, b.expansions);
  }
  if (b.frontier !== undefined) {
    setBar('front', trace ? peakFrontierUpTo(trace, state.index) : 0, b.frontier);
  }
}

/* ---------- playback ---------- */

function stepOnce(n) {
  var trace = state.traces[state.chosen];
  state.index = Math.min(trace.steps.length, state.index + n);
  updateBudgets();
  draw();
  if (state.index >= trace.steps.length) {
    state.playing = false;
    el.play.textContent = 'Play';
    el.step.disabled = true;
    el.play.disabled = true;
    finish();
  }
}

function tick(time) {
  if (!state.playing) { return; }
  var dt = state.lastTime ? (time - state.lastTime) / 1000 : 0;
  state.lastTime = time;
  state.carry += dt * Number(el.speed.value) * 6;
  var n = Math.floor(state.carry);
  if (n > 0) {
    state.carry -= n;
    stepOnce(n);
  }
  if (state.playing) { requestAnimationFrame(tick); }
}

function togglePlay() {
  if (el.play.disabled) { return; }
  state.playing = !state.playing;
  el.play.textContent = state.playing ? 'Pause' : 'Play';
  if (state.playing) {
    state.lastTime = 0;
    requestAnimationFrame(tick);
  }
}

/* ---------- verdict ---------- */

function finish() {
  var level = state.level;
  var trace = state.traces[state.chosen];
  var stars = starsFor(level, trace, state.refs);

  if ((state.earned[state.levelIndex] || 0) < stars) {
    state.earned[state.levelIndex] = stars;
    saveStars();
  }
  updateStarTotal();
  buildLevelBar();

  el.stars.textContent = starText(stars);
  el.stars.className = 'stars s' + stars;

  var name = nameOf(state.chosen);
  var headline;
  if (stars === 3) {
    headline = name + ' was the right call.';
  } else if (stars === 1) {
    headline = name + ' got the right answer and blew the budget.';
  } else {
    headline = name + ' missed the objective.';
  }
  el.verdictText.textContent = headline + ' ' + summaryOf(trace);
  el.verdictWhy.textContent = whySentence(level, state.chosen, trace, state.refs);

  var concept = conceptFor(level);
  el.conceptChip.textContent = concept.label;
  el.conceptNote.textContent = concept.note;

  buildCompare();

  el.next.textContent = state.levelIndex >= LEVELS.length - 1 ? 'Replay a level' : 'Next level';
  // The gate is the best result on this level, not the last one: a player who
  // has already earned a star here and then goes back to watch DFS fail has
  // not un-earned the next level.
  el.next.disabled = (state.earned[state.levelIndex] || 0) === 0 &&
    state.levelIndex < LEVELS.length - 1;
  el.retry2.className = stars === 3 ? '' : 'primary';
  el.gateNote.textContent = el.next.disabled
    ? 'One star on this level opens the next one.'
    : '';
  el.overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  fitToLevel();
  draw();
}

function summaryOf(trace) {
  if (!trace.found) { return 'No path found.'; }
  return trace.pathSteps + ' steps, cost ' + trace.pathCost + ', ' + trace.expansions +
    ' expansions, peak frontier ' + trace.peakFrontier + '.';
}

function hideOverlay() {
  var wasOpen = !el.overlay.classList.contains('hidden');
  el.overlay.classList.add('hidden');
  document.body.classList.remove('overlay-open');
  if (wasOpen && state.grid) { fitToLevel(); draw(); }
}

function buildCompare() {
  el.compareGrid.innerHTML = '';
  STRATS.forEach(function (s) {
    var trace = state.traces[s.id];
    var stars = starsFor(state.level, trace, state.refs);

    var card = document.createElement('div');
    card.className = 'cmp' + (s.id === state.chosen ? ' chosen' : '') + ' s' + stars;
    card.innerHTML = '<div class="cmp-head"><span>' + s.name + '</span>' +
      '<span class="cmp-stars">' + starText(stars) + '</span></div>';

    var cv = document.createElement('canvas');
    var cw = 170;
    var chh = 112;
    sizeCanvas(cv, cw, chh);
    card.appendChild(cv);

    var cam = fitCamera(createCamera(), state.grid, cw, chh, 6);
    // The finished frame shows shape and route only: leftover frontier at the
    // end of a run tells the player nothing and hides what the search drew.
    drawScene(cv, state.grid, trace, trace.steps.length, cam, {
      breachAt: (state.level.budgets || {}).expansions,
      teleports: state.level.teleports
    });

    var stats = document.createElement('div');
    stats.className = 'cmp-stats';
    stats.innerHTML = trace.found
      ? ('cost <b>' + trace.pathCost + '</b> &middot; ' + trace.pathSteps + ' steps<br>' +
        'fuel <b>' + trace.expansions + '</b> &middot; memory <b>' + trace.peakFrontier + '</b>')
      : 'no path found';
    card.appendChild(stats);

    el.compareGrid.appendChild(card);
  });
}

/* ---------- camera input ---------- */

var drag = null;

el.canvas.addEventListener('pointerdown', function (e) {
  drag = { x: e.clientX, y: e.clientY, cx: state.cam.x, cy: state.cam.y, moved: false };
  el.canvas.classList.add('dragging');
  el.canvas.setPointerCapture(e.pointerId);
});

el.canvas.addEventListener('pointermove', function (e) {
  if (!drag) { return; }
  state.cam.x = drag.cx + (e.clientX - drag.x);
  state.cam.y = drag.cy + (e.clientY - drag.y);
  drag.moved = true;
  draw();
});

function endDrag() {
  drag = null;
  el.canvas.classList.remove('dragging');
}

el.canvas.addEventListener('pointerup', endDrag);
el.canvas.addEventListener('pointercancel', endDrag);

el.canvas.addEventListener('wheel', function (e) {
  e.preventDefault();
  var factor = Math.exp(-e.deltaY * 0.0016);
  var next = Math.max(0.3, Math.min(3, state.cam.scale * factor));
  var k = next / state.cam.scale;
  // Zoom about the pointer, so the tile under the cursor stays put.
  state.cam.x = e.clientX - (e.clientX - state.cam.x) * k;
  state.cam.y = e.clientY - (e.clientY - state.cam.y) * k;
  state.cam.scale = next;
  draw();
}, { passive: false });

el.canvas.addEventListener('dblclick', function () { fitToLevel(); draw(); });

/* ---------- wiring ---------- */

el.step.addEventListener('click', function () {
  if (state.playing) { togglePlay(); }
  stepOnce(1);
});
el.play.addEventListener('click', togglePlay);
el.retry.addEventListener('click', function () { choose(state.chosen); });
el.retry2.addEventListener('click', function () { choose(state.chosen); });
el.overlayClose.addEventListener('click', hideOverlay);

el.overlay.addEventListener('click', function (e) {
  if (e.target === el.overlay) { hideOverlay(); }   // click the map, keep playing
});

el.next.addEventListener('click', function () {
  if (state.levelIndex < LEVELS.length - 1) {
    loadLevel(state.levelIndex + 1);
  } else {
    hideOverlay();
  }
});

el.speed.addEventListener('input', function () { el.speed.title = 'Speed ' + el.speed.value; });

el.weight.addEventListener('input', function () {
  state.weight = Number(el.weight.value) / 10;
  el.weightVal.textContent = state.weight.toFixed(1);
  computeTraces();
  resetRun(state.chosen);
});

window.addEventListener('resize', function () { resize(true); });

document.addEventListener('keydown', function (e) {
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  if (e.key === 'ArrowRight' && !el.step.disabled) { e.preventDefault(); stepOnce(1); }
  if (e.key === 'f' || e.key === 'F') { fitToLevel(); draw(); }
  if (e.key === 'Escape') { hideOverlay(); }
  if (e.key >= '1' && e.key <= '9') {
    var s = STRATS[Number(e.key) - 1];
    if (s && algoOpen(s.id)) { choose(s.id); }
  }
});

buildPicker();
loadLevel(0);
window.addEventListener('load', function () { resize(true); });
