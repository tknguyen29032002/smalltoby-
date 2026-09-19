/* tests/browser/heist-walkthrough.js - the page-side check for Factory Heist.
 *
 * `npm test` proves heist.js and the campaign; it cannot see index.html. This
 * script plays all fifteen floors through the page's own entry points - the
 * same fireAt/pressPower the canvas click and the power keys call - and checks
 * what the player would see: the power bar, the verdict sheet, the floor gate,
 * the turn and the picking under every rotation.
 *
 * Run it after touching index.html, heist-ui.js or heist-render.js, over both
 * origins, from a fresh profile (it clears the saved stars):
 *
 *   python3 -m http.server 8777 &
 *   export CHROME_DEVTOOLS_AXI_SESSION=smalltoby-qa
 *   npx -y chrome-devtools-axi open "file://$PWD/index.html"
 *   npx -y chrome-devtools-axi eval "$(cat tests/browser/heist-walkthrough.js)"
 *   npx -y chrome-devtools-axi open "http://localhost:8777/index.html"
 *   npx -y chrome-devtools-axi eval "$(cat tests/browser/heist-walkthrough.js)"
 *
 * `problems` must be empty and the two runs must report the same `digest`.
 * The player is the same yardstick as tools/verify-heist.js - cheapest
 * unlocked power that reaches the nearest delivery - so every floor should
 * be won, and the per-floor rows are left on window.__qaHeist.
 */

(async () => {
  const H = window.__heist;
  const $ = id => document.getElementById(id);
  const problems = [];
  const rows = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const idle = async () => {
    for (let g = 0; g < 2000 && (H.ui.phase === 'search' || H.ui.phase === 'ride'); g++) { await sleep(16); }
  };

  try { localStorage.removeItem('factoryHeist.stars.v1'); } catch (e) { /* storage off: fine */ }
  H.ui.earned = {};
  H.ui.rideMs = 1;
  $('speed').value = 30;

  // --- the picture: rotation and picking agree in all four turns ----------
  H.loadFloor(0);
  for (let r = 0; r < 4; r++) {
    H.board.turn(1);
    await sleep(600);
    const st = H.ui.state;
    const s = H.board.cam.scale;
    let bad = 0;
    for (let y = 0; y < st.grid.h; y++) {
      for (let x = 0; x < st.grid.w; x++) {
        const p = H.board.screenOf(st, x, y, 0);
        const c = H.board.cellAt(p.x, p.y + 8 * s, st);
        if (!c || c.x !== x || c.y !== y) { bad++; }
      }
    }
    if (bad) { problems.push('rotation ' + H.board.rot + ': ' + bad + ' cells pick the wrong tile'); }
  }

  // --- the cheapest unlocked power that reaches a target -----------------
  const unlocked = () => [...document.querySelectorAll('.power:not(.locked)')].map(b => b.dataset.power);
  const probe = (st, id, target) => {
    const h = Heist.openFire({ level: st.level, grid: st.grid, player: st.player, status: 'playing' }, id, target);
    while (!h.done) { Heist.stepFire(h); }
    const t = PathfinderEngine.traceOf(h.search);
    const cost = t.chargedExpansions === undefined ? t.expansions : t.chargedExpansions;
    return t.found ? { id, cost, steps: t.pathSteps, reach: h.power.reach } : null;
  };
  const best = (st, target) => unlocked().map(id => probe(st, id, target)).filter(Boolean)
    .sort((a, b) => (a.cost + a.steps * 6) - (b.cost + b.steps * 6))[0];

  for (let i = 0; i < HEIST_LEVELS.length; i++) {
    if (i > 0) {
      if ($('btn-next').disabled) { problems.push('floor ' + i + ': Next floor gated after a win'); }
      $('btn-next').click();
    }
    const at = 'floor ' + (i + 1) + ': ';
    if (H.ui.index !== i) { problems.push(at + 'did not load'); continue; }

    // Power bar: every unlocked power by name and registry label, never an id.
    const open = unlocked();
    const want = HEIST_UNLOCKS.slice(0, i + 1).filter(Boolean);
    if (open.join() !== want.join()) { problems.push(at + 'power bar shows ' + open + ', expected ' + want); }
    for (const b of document.querySelectorAll('.power')) {
      if (/\b(wastar|bibfs|iddfs|bellman|flow|wall)\b/.test(b.textContent)) {
        problems.push(at + 'a power button shows a raw id: ' + b.textContent);
      }
    }

    let guard = 0;
    while (H.ui.state.status === 'playing' && guard++ < 80) {
      const st = H.ui.state;
      const openD = Heist.openDeliveries(st);
      const target = openD.reduce((a, b) =>
        (Math.abs(b.x - st.player.x) + Math.abs(b.y - st.player.y)) <
        (Math.abs(a.x - st.player.x) + Math.abs(a.y - st.player.y)) ? b : a);
      const sitting = Heist.botAt(st, target.x, target.y);
      const aim = sitting ? { x: sitting.x, y: sitting.y, botId: sitting.id } : { x: target.x, y: target.y };
      const pick = best(st, aim);
      if (!pick) { H.wait(); continue; }
      H.pressPower(pick.id);
      H.fireAt({ x: aim.x, y: aim.y });
      await idle();
    }
    await sleep(600);

    const st = H.ui.state;
    const sum = Heist.summary(st);
    rows.push({ floor: i + 1, status: sum.status, ticks: sum.ticks, spent: sum.spent, stars: sum.stars, shots: sum.shots });
    if (sum.status !== 'won') { problems.push(at + 'the yardstick player did not win (' + sum.status + ')'); }
    if ($('overlay').classList.contains('hidden')) { problems.push(at + 'no verdict sheet'); }
    if (!$('concept-chip').textContent.trim()) { problems.push(at + 'the verdict names no concept'); }
    if ($('stars').textContent.replace(/☆/g, '').length !== sum.stars) {
      problems.push(at + 'verdict shows ' + $('stars').textContent + ' for ' + sum.stars + ' stars');
    }
  }

  const serialised = JSON.stringify(rows);
  let digest = 5381;
  for (let i = 0; i < serialised.length; i++) { digest = ((digest * 33) ^ serialised.charCodeAt(i)) >>> 0; }
  window.__qaHeist = { rows, problems };
  return JSON.stringify({ origin: location.protocol, floors: rows.length, won: rows.filter(r => r.status === 'won').length, digest: digest.toString(16), problems });
})()
