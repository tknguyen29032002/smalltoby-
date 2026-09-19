/* tests/browser/walkthrough.js - the browser walkthrough for the Training page.
 *
 * node --test proves search.js and levels.js. It cannot prove the page: that
 * the buttons are wired, that the verdict card says what the trace says, or
 * that the same build behaves the same over file:// and http://. This script
 * does that, by driving the real controls the player uses.
 *
 * The classic campaign lives on training.html now (index.html is Factory
 * Heist, checked by heist-walkthrough.js). It is not a node test - it runs
 * inside the page. Re-run it after touching training.html, game.js or
 * render.js:
 *
 *   python3 -m http.server 8777 &
 *   export CHROME_DEVTOOLS_AXI_SESSION=smalltoby-qa   # own bridge, no clashes
 *   npx -y chrome-devtools-axi open "file://$PWD/training.html"
 *   npx -y chrome-devtools-axi eval "$(cat tests/browser/walkthrough.js)"
 *   npx -y chrome-devtools-axi open "http://localhost:8777/training.html"
 *   npx -y chrome-devtools-axi eval "$(cat tests/browser/walkthrough.js)"
 *
 * `problems` must be empty and the two runs must report the same `digest`;
 * the verdict numbers must also match `node tools/verify-levels.js`. The full
 * per-run table is left on `window.__qaWalkthrough` (the return value stays
 * small because the CLI truncates long results), so read a slice with e.g.
 *   npx -y chrome-devtools-axi eval \
 *     "() => JSON.stringify(window.__qaWalkthrough.rows.filter(r => r.lv === 3))"
 *
 * Note for the driver: clicking by accessibility ref fails with STALE_REF
 * while playback is running, because the page re-renders every frame. Real
 * pointer clicks are still worth doing for one press of each control; the
 * exhaustive sweep below uses element.click(), which runs the same handlers.
 */

(() => {
  const algos = [...document.querySelectorAll('.algo')].map(b => b.dataset.algo);
  const $ = id => document.getElementById(id);
  const rows = [];
  const problems = [];

  // The page is one full-window board with a floating HUD: the verdict and the
  // compare strip live in an overlay sheet, and a level draws a budget row only
  // for the budgets it actually has, so a missing row means "no budget" where
  // the old panel printed "n/a".
  const overlayOpen = () => !$('overlay').classList.contains('hidden');
  const budget = key => {
    const count = $(key + '-count');
    if (!count) { return 'n/a'; }
    const limits = (typeof state !== 'undefined' && state.level && state.level.budgets) || {};
    const limit = key === 'exp' ? limits.expansions : limits.frontier;
    return count.textContent + '/' + (limit === undefined ? 'n/a' : limit);
  };
  const noLimit = v => v === 'n/a' || v.endsWith('/n/a');
  const barOver = key => {
    const bar = $(key + '-bar');
    return !!bar && bar.classList.contains('over');
  };

  const runToEnd = () => {
    let guard = 0;
    while (!$('btn-step').disabled && guard++ < 5000) { $('btn-step').click(); }
    if (guard >= 5000) { problems.push('run did not terminate within 5000 steps'); }
    return guard;
  };

  const levelCount = (typeof LEVELS !== 'undefined' && LEVELS.length) || 0;
  if (!levelCount) { problems.push('could not determine how many levels there are'); }

  for (let lv = 1; lv <= levelCount; lv++) {
    for (const algo of algos) {
      // Training hands the first four out a level at a time; a locked button
      // is greyed and disabled, and must stay that way.
      const btn = document.querySelector('.algo[data-algo="' + algo + '"]');
      if (btn.disabled) {
        if (!btn.classList.contains('locked')) { problems.push('L' + lv + ' ' + algo + ': disabled but not shown as locked'); }
        continue;
      }
      if (/^[a-z]+$/.test(btn.querySelector('span').textContent)) {
        problems.push('L' + lv + ' ' + algo + ': the button shows a raw id');
      }
      btn.click();

      if ($('btn-step').disabled || $('btn-play').disabled) {
        problems.push('L' + lv + ' ' + algo + ': picking an algorithm left Step/Play disabled');
      }
      const steps = runToEnd();

      const row = {
        lv: lv,
        algo: algo,
        stars: $('stars').className.replace('stars ', ''),
        starGlyphs: $('stars').textContent,
        headline: $('verdict-text').textContent.trim(),
        why: $('verdict-why').textContent.trim(),
        exp: budget('exp'),
        front: budget('front'),
        expOver: barOver('exp'),
        frontOver: barOver('front'),
        compare: [...document.querySelectorAll('#compare-grid .cmp')].map(c => c.className).join('|')
      };
      rows.push(row);

      // --- invariants the page itself must satisfy ---
      const at = 'L' + lv + ' ' + algo + ': ';
      if (!overlayOpen()) { problems.push(at + 'no verdict sheet after finishing'); }
      if (!document.querySelector('#compare-grid .cmp')) { problems.push(at + 'no compare strip after finishing'); }
      if (!$('concept-chip').textContent.trim()) { problems.push(at + 'verdict names no concept'); }
      if (row.compare.split('|').filter(c => /\bchosen\b/.test(c)).length !== 1) {
        problems.push(at + 'compare strip does not mark exactly one chosen card');
      }
      if ($('btn-retry').disabled) { problems.push(at + 'Retry disabled after finishing'); }
      // Only levels that have an expansion budget draw an expansion counter.
      if (!noLimit(row.exp) && row.exp.split('/')[0] !== String(steps)) {
        problems.push(at + 'expansion counter ' + row.exp + ' disagrees with ' + steps + ' steps taken');
      }
      // A budget with no limit must never be drawn, let alone drawn as breached.
      if (noLimit(row.exp) && row.expOver) { problems.push(at + 'expansion bar flagged over with no budget'); }
      if (noLimit(row.front) && row.frontOver) { problems.push(at + 'frontier bar flagged over with no budget'); }
      // Retry must put the level back to its untouched state.
      $('btn-retry').click();
      const counter = $('exp-count') || $('front-count');
      if ((counter && counter.textContent !== '0') || overlayOpen()) {
        problems.push(at + 'Retry did not reset the run');
      }
      runToEnd();
    }

    // The "same answer" sentence may only name a rival that got the same
    // answer. Checked per level, once every algorithm on it has been scored.
    for (const row of rows.filter(r => r.lv === lv)) {
      const m = row.why.match(/^On this map (.+?) would have spent/);
      if (!m) { continue; }
      const rival = rows.filter(r => r.lv === lv).find(r => r.headline.startsWith(m[1] + ' '));
      if (rival && rival.stars === 's0') {
        problems.push('L' + lv + ' ' + row.algo + ': credits ' + m[1] +
          ' with "the same answer" although it missed the objective');
      }
    }

    if (lv < levelCount) {
      // Leave the level on a run that blew a budget where one did, so the next
      // level starts from the state most likely to carry a stale breach over.
      const offender = rows.filter(r => r.lv === lv && (r.expOver || r.frontOver))[0];
      if (offender) {
        document.querySelector('.algo[data-algo="' + offender.algo + '"]').click();
        runToEnd();
      }
      if ($('btn-next').disabled) {
        problems.push('L' + lv + ': next level still gated after the level was starred');
      }
      $('btn-next').click();
      if (typeof state !== 'undefined' && state.levelIndex !== lv) {
        problems.push('L' + lv + ': Next level did not advance the board');
      }
    }
  }

  // The last level offers a replay rather than a next level.
  if ($('btn-next').textContent.trim() === 'Next level') {
    problems.push('the last level still offers a next level');
  }

  // Digest of every recorded number and sentence: two origins serving the same
  // build must produce the same one.
  const serialised = JSON.stringify(rows);
  let digest = 5381;
  for (let i = 0; i < serialised.length; i++) { digest = ((digest * 33) ^ serialised.charCodeAt(i)) >>> 0; }

  window.__qaWalkthrough = { levelCount, algos, problems, rows };
  return JSON.stringify({
    origin: location.protocol,
    levelCount: levelCount,
    algos: algos,
    rowCount: rows.length,
    digest: digest.toString(16),
    problems: problems
  });
})()
