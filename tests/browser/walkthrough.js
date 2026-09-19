/* tests/browser/walkthrough.js - the page-side half of the browser walkthrough.
 *
 * node --test proves search.js and levels.js. It cannot prove the page: that
 * the buttons are wired, that the verdict card says what the trace says, or
 * that the same build behaves the same over file:// and http://. This script
 * does that, by driving the real controls the player uses.
 *
 * It is not a node test - it runs inside the page. Re-run it after touching
 * index.html, game.js or render.js:
 *
 *   python3 -m http.server 8777 &
 *   export CHROME_DEVTOOLS_AXI_SESSION=smalltoby-qa   # own bridge, no clashes
 *   npx -y chrome-devtools-axi open "file://$PWD/index.html"
 *   npx -y chrome-devtools-axi eval "$(cat tests/browser/walkthrough.js)"
 *   npx -y chrome-devtools-axi open "http://localhost:8777/index.html"
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

  const runToEnd = () => {
    let guard = 0;
    while (!$('btn-step').disabled && guard++ < 5000) { $('btn-step').click(); }
    if (guard >= 5000) { problems.push('run did not terminate within 5000 steps'); }
    return guard;
  };

  const levelCount = Number(($('level-progress').textContent.split('/')[1] || '0').trim());

  for (let lv = 1; lv <= levelCount; lv++) {
    for (const algo of algos) {
      document.querySelector('.algo[data-algo="' + algo + '"]').click();

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
        exp: $('exp-count').textContent + '/' + $('exp-limit').textContent,
        front: $('front-count').textContent + '/' + $('front-limit').textContent,
        expOver: $('exp-bar').classList.contains('over'),
        frontOver: $('front-bar').classList.contains('over'),
        compare: [...document.querySelectorAll('#compare-grid .cmp')].map(c => c.className).join('|')
      };
      rows.push(row);

      // --- invariants the page itself must satisfy ---
      const at = 'L' + lv + ' ' + algo + ': ';
      if ($('verdict').classList.contains('hidden')) { problems.push(at + 'no verdict card after finishing'); }
      if ($('compare').classList.contains('hidden')) { problems.push(at + 'no compare strip after finishing'); }
      if (row.compare.split('|').filter(c => /\bchosen\b/.test(c)).length !== 1) {
        problems.push(at + 'compare strip does not mark exactly one chosen card');
      }
      if ($('btn-retry').disabled) { problems.push(at + 'Retry disabled after finishing'); }
      if (row.exp.split('/')[0] !== String(steps)) {
        problems.push(at + 'expansion counter ' + row.exp + ' disagrees with ' + steps + ' steps taken');
      }
      // A budget with no limit must never be drawn as breached.
      if (row.exp.endsWith('/n/a') && row.expOver) { problems.push(at + 'expansion bar flagged over with no budget'); }
      if (row.front.endsWith('/n/a') && row.frontOver) { problems.push(at + 'frontier bar flagged over with no budget'); }
      // Retry must put the level back to its untouched state.
      $('btn-retry').click();
      if ($('exp-count').textContent !== '0' || !$('verdict').classList.contains('hidden')) {
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
      $('btn-next').click();
    }
  }

  // The last level must not offer a next level, and earlier ones must.
  if (!$('btn-next').disabled) { problems.push('Next level still enabled on the last level'); }

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
