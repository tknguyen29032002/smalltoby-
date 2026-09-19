/* game.js - level state, controls, scoring, compare strip. */

var ALGOS = ['bfs', 'dfs', 'dijkstra', 'astar'];
var ALGO_NAMES = { bfs: 'BFS', dfs: 'DFS', dijkstra: 'Dijkstra', astar: 'A*' };

var el = {
  title: document.getElementById('level-title'),
  progress: document.getElementById('level-progress'),
  brief: document.getElementById('level-brief'),
  canvas: document.getElementById('map'),
  objective: document.getElementById('objective'),
  expCount: document.getElementById('exp-count'),
  expLimit: document.getElementById('exp-limit'),
  expBar: document.getElementById('exp-bar'),
  frontCount: document.getElementById('front-count'),
  frontLimit: document.getElementById('front-limit'),
  frontBar: document.getElementById('front-bar'),
  step: document.getElementById('btn-step'),
  play: document.getElementById('btn-play'),
  speed: document.getElementById('speed'),
  verdict: document.getElementById('verdict'),
  stars: document.getElementById('stars'),
  verdictText: document.getElementById('verdict-text'),
  verdictWhy: document.getElementById('verdict-why'),
  compare: document.getElementById('compare'),
  compareGrid: document.getElementById('compare-grid'),
  retry: document.getElementById('btn-retry'),
  next: document.getElementById('btn-next')
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
  carry: 0
};

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

/* ---------- the one-sentence why ---------- */

function whySentence(level, algo, trace, refs) {
  var name = ALGO_NAMES[algo];

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

  // Three stars: teach by contrast with whichever rival worked hardest.
  var rival = ALGOS.filter(function (a) { return a !== algo; }).reduce(function (acc, a) {
    return state.traces[a].expansions > state.traces[acc].expansions ? a : acc;
  });
  var rivalTrace = state.traces[rival];
  if (rivalTrace.expansions > trace.expansions * 1.2) {
    return 'On this map ' + ALGO_NAMES[rival] + ' would have spent ' + rivalTrace.expansions +
      ' expansions to get the same answer, and ' + name + ' needed only ' + trace.expansions + '.';
  }
  if (level.objective === 'any') {
    return 'Reaching the goal was never the hard part here - holding the search in memory was, and ' +
      name + ' peaked at just ' + trace.peakFrontier + ' frontier cells.';
  }
  return name + ' met the objective well inside the budget on this map.';
}

/* ---------- level loading ---------- */

function loadLevel(i) {
  state.levelIndex = i;
  state.level = LEVELS[i];
  state.grid = parseGrid(state.level.map);
  state.traces = {};
  ALGOS.forEach(function (a) { state.traces[a] = search(state.grid, a); });
  state.refs = {
    bestSteps: state.traces.bfs.pathSteps,
    bestCost: state.traces.dijkstra.pathCost
  };

  el.title.textContent = 'Level ' + (i + 1) + ' - ' + state.level.name;
  el.progress.textContent = (i + 1) + ' / ' + LEVELS.length;
  el.brief.textContent = state.level.brief;
  el.objective.innerHTML = objectiveLine();

  fitMapCanvas();
  resetRun(null);
  el.next.disabled = true;
  el.next.textContent = i >= LEVELS.length - 1 ? 'All levels done' : 'Next level';
  el.retry.disabled = true;
  setChosenButton(null);
}

function objectiveLine() {
  var o = state.level.objective;
  if (o === 'shortest') {
    return '<b>Fewest steps.</b> The goal is reachable in ' + state.refs.bestSteps +
      ' steps - anything longer does not count.';
  }
  if (o === 'cheapest') {
    return '<b>Lowest terrain cost.</b> The cheapest route costs ' + state.refs.bestCost +
      ' - anything pricier does not count.';
  }
  return '<b>Just reach the goal.</b> Any route counts. The budget is what will hurt you.';
}

function resetRun(algo) {
  state.chosen = algo;
  state.index = 0;
  state.playing = false;
  state.carry = 0;
  el.play.textContent = 'Play';
  el.step.disabled = !algo;
  el.play.disabled = !algo;
  el.verdict.classList.add('hidden');
  el.compare.classList.add('hidden');
  updateBudgets();
  draw();
}

/* ---------- drawing and budgets ---------- */

// The map takes the width the board gives it rather than a fixed 600.
function fitMapCanvas() {
  var avail = el.canvas.parentNode.clientWidth - 32;
  fitCanvas(el.canvas, state.grid, Math.max(300, Math.min(avail, 900)), 560);
}

function draw() {
  drawFrame(el.canvas, state.grid, state.chosen ? state.traces[state.chosen] : null, state.index, {});
}

function peakFrontierUpTo(trace, index) {
  var peak = 0;
  for (var k = 0; k < index && k < trace.steps.length; k++) {
    if (trace.steps[k].frontierSize > peak) { peak = trace.steps[k].frontierSize; }
  }
  return peak;
}

function setBar(barEl, countEl, limitEl, used, limit) {
  var box = barEl.parentNode.parentNode;
  if (limit === undefined) {
    box.classList.add('off');
    limitEl.textContent = 'n/a';
    countEl.textContent = used;
    barEl.style.width = '0%';
    return;
  }
  box.classList.remove('off');
  limitEl.textContent = limit;
  countEl.textContent = used;
  barEl.style.width = Math.min(100, (used / limit) * 100) + '%';
  barEl.classList.toggle('over', used > limit);
}

function updateBudgets() {
  var b = (state.level.budgets) || {};
  var trace = state.chosen ? state.traces[state.chosen] : null;
  var used = trace ? Math.min(state.index, trace.steps.length) : 0;
  var peak = trace ? peakFrontierUpTo(trace, state.index) : 0;
  setBar(el.expBar, el.expCount, el.expLimit, used, b.expansions);
  setBar(el.frontBar, el.frontCount, el.frontLimit, peak, b.frontier);
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
  var perSecond = Number(el.speed.value) * 6;
  state.carry += dt * perSecond;
  var n = Math.floor(state.carry);
  if (n > 0) {
    state.carry -= n;
    stepOnce(n);
  }
  if (state.playing) { requestAnimationFrame(tick); }
}

function togglePlay() {
  state.playing = !state.playing;
  el.play.textContent = state.playing ? 'Pause' : 'Play';
  if (state.playing) {
    state.lastTime = 0;
    requestAnimationFrame(tick);
  }
}

/* ---------- verdict and compare ---------- */

function finish() {
  var level = state.level;
  var trace = state.traces[state.chosen];
  var stars = starsFor(level, trace, state.refs);
  var met = objectiveMet(level, trace, state.refs);

  el.stars.textContent = '★★★☆☆☆'.substr(3 - stars, 3);
  el.stars.className = 'stars s' + stars;

  var headline;
  if (stars === 3) {
    headline = ALGO_NAMES[state.chosen] + ' was a good fit here.';
  } else if (stars === 1) {
    headline = ALGO_NAMES[state.chosen] + ' got the right answer, but blew the budget.';
  } else if (met) {
    headline = ALGO_NAMES[state.chosen] + ' failed.';
  } else {
    headline = ALGO_NAMES[state.chosen] + ' missed the objective.';
  }
  el.verdictText.textContent = headline + '  ' + summaryOf(trace);
  el.verdictWhy.textContent = whySentence(level, state.chosen, trace, state.refs);
  el.verdict.classList.remove('hidden');

  buildCompare();
  el.compare.classList.remove('hidden');
  el.verdict.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  el.retry.disabled = false;
  el.next.disabled = state.levelIndex >= LEVELS.length - 1;
}

function summaryOf(trace) {
  if (!trace.found) { return 'No path found.'; }
  return trace.pathSteps + ' steps, cost ' + trace.pathCost + ', ' + trace.expansions +
    ' expansions, peak frontier ' + trace.peakFrontier + '.';
}

function buildCompare() {
  el.compareGrid.innerHTML = '';
  ALGOS.forEach(function (a) {
    var trace = state.traces[a];
    var stars = starsFor(state.level, trace, state.refs);

    var card = document.createElement('div');
    card.className = 'cmp' + (a === state.chosen ? ' chosen' : '') + ' s' + stars;

    var head = document.createElement('div');
    head.className = 'cmp-head';
    head.innerHTML = '<span>' + ALGO_NAMES[a] + '</span><span class="cmp-stars">' +
      '★★★☆☆☆'.substr(3 - stars, 3) + '</span>';
    card.appendChild(head);

    var cv = document.createElement('canvas');
    fitCanvas(cv, state.grid, 260, 170);
    card.appendChild(cv);
    drawFrame(cv, state.grid, trace, trace.steps.length, {});

    var stats = document.createElement('div');
    stats.className = 'cmp-stats';
    stats.innerHTML = trace.found
      ? ('cost <b>' + trace.pathCost + '</b> · ' + trace.pathSteps + ' steps<br>' +
        'exp <b>' + trace.expansions + '</b> · frontier <b>' + trace.peakFrontier + '</b>')
      : 'no path found';
    card.appendChild(stats);

    el.compareGrid.appendChild(card);
  });
}

/* ---------- wiring ---------- */

function setChosenButton(algo) {
  document.querySelectorAll('.algo').forEach(function (b) {
    b.classList.toggle('active', b.dataset.algo === algo);
  });
}

document.querySelectorAll('.algo').forEach(function (btn) {
  btn.addEventListener('click', function () {
    setChosenButton(btn.dataset.algo);
    resetRun(btn.dataset.algo);
    el.retry.disabled = false;
  });
});

el.step.addEventListener('click', function () {
  if (state.playing) { togglePlay(); }
  stepOnce(1);
});
el.play.addEventListener('click', togglePlay);
el.retry.addEventListener('click', function () { resetRun(state.chosen); });
el.next.addEventListener('click', function () {
  if (state.levelIndex < LEVELS.length - 1) { loadLevel(state.levelIndex + 1); }
});

window.addEventListener('resize', function () {
  if (!state.grid) { return; }
  fitMapCanvas();
  draw();
});

document.addEventListener('keydown', function (e) {
  if (e.key === ' ' && !el.play.disabled) { e.preventDefault(); togglePlay(); }
  if (e.key === 'ArrowRight' && !el.step.disabled) { e.preventDefault(); stepOnce(1); }
});

loadLevel(0);
