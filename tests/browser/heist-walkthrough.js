/* tests/browser/heist-walkthrough.js - the page-side check for Factory Heist.
 *
 * `npm test` proves heist.js and the campaign; it cannot see index.html. This
 * script plays all fifteen floors through the page's own entry points - the
 * same fireAt/pressPower the canvas click and the power keys call - and checks
 * what the player would see: the power bar, the verdict sheet, the shop, the
 * floor gate, the turn and the picking under every rotation.
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
 * The player is tools/verify-heist.js's reference player - the encounter's
 * perfect line, the cheapest working power when the line's own fails from
 * where the cart stands - so every floor is won, and on the same numbers
 * verify-heist prints. The per-floor rows are left on window.__qaHeist.
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

  try { localStorage.removeItem('factoryHeist.save.v2'); } catch (e) { /* storage off: fine */ }
  H.ui.save = { stars: {}, gold: 0, bank: {}, earlyUnlocked: [] };
  // The ride clock is stopped and the walkthrough ticks it itself, one tick
  // at a time as verify-heist does, so the run cannot depend on frame timing.
  H.ui.rideMs = 1e9;
  $('speed').value = 30;
  $('freewalk').checked = false;

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

  // --- verify-heist's reference player, driven through the page -----------
  const probe = (st, id, aim) => {
    const h = Heist.openFire(st, id, aim);
    if (h.refused) { return null; }
    while (!h.done) { Heist.stepFire(h); }
    const t = Heist.traceOf(h);
    if (!t.found || (st.memory !== null && t.peakFrontier > st.memory)) { return null; }
    return Campaign.plotCharge(t, st.map) + t.path.slice(1).reduce((n, p) => n + PathfinderEngine.cellCost(st.grid, p.x, p.y), 0);
  };
  const cheapest = (st, aim) => {
    let best = null;
    let cost = Infinity;
    st.powers.forEach(id => { const c = probe(st, id, aim); if (c !== null && c < cost) { best = id; cost = c; } });
    return best;
  };
  const tickOnce = async () => { H.wait(); await sleep(0); };

  for (let i = 0; i < Campaign.ENCOUNTERS.length; i++) {
    const enc = Campaign.ENCOUNTERS[i];
    if (i > 0) {
      if ($('btn-next').disabled) { problems.push('floor ' + i + ': Next floor gated after a win'); }
      $('btn-next').click();
    }
    const at = 'floor ' + enc.level + ': ';
    if (H.ui.index !== i) { problems.push(at + 'did not load'); continue; }

    // Power bar: exactly the ladder's powers so far, by name and registry
    // label, never an id.
    const open = [...document.querySelectorAll('.power:not(.locked)')].map(b => b.dataset.power);
    const want = Campaign.powersAt(enc.level);
    if (open.join() !== want.join()) { problems.push(at + 'power bar shows ' + open + ', expected ' + want); }
    for (const b of document.querySelectorAll('.power')) {
      const label = PathfinderEngine.STRATEGY_BY_ID[b.dataset.power].label;
      if (b.textContent.indexOf(label) === -1 || /\b(wastar|bibfs|iddfs|bellman|flow|wall|bfs|dfs|astar)\b/.test(b.textContent)) {
        problems.push(at + 'a power button does not show its registry label: ' + b.textContent);
      }
    }

    const st = H.ui.state;
    for (let n = 0; n < enc.perfectLine.legs.length && st.status === 'playing'; n++) {
      const leg = enc.perfectLine.legs[n];
      const d = st.deliveries[leg.to];
      let guard = 0;
      while (!d.secured && st.status === 'playing' && guard++ < 80) {
        const aim = { x: d.x, y: d.y };
        const power = probe(st, leg.power, aim) !== null ? leg.power : cheapest(st, aim);
        if (!power) { await tickOnce(); continue; }
        H.pressPower(power);
        H.fireAt(aim);
        if (H.ui.phase === 'search') {
          // Space: finish the search at once, as a player would.
          window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        }
        let rideGuard = 0;
        while (H.ui.phase === 'ride' && st.status === 'playing' && rideGuard++ < 300) {
          const end = st.ride.path[st.ride.path.length - 1];
          if (end.x !== d.x || end.y !== d.y) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            break;
          }
          H.rideTick();
          if (rideGuard % 8 === 0) { await sleep(0); }
        }
        while (st.stall > 0 && st.status === 'playing') { await tickOnce(); }
      }
    }
    await sleep(600);

    const sum = Heist.summary(st);
    rows.push({ floor: enc.level, map: enc.mapId, status: sum.status, ticks: sum.ticks, spent: sum.spent, stars: sum.stars, gold: sum.gold });
    if (sum.status !== 'won') { problems.push(at + 'the reference player did not win (' + sum.status + ': ' + st.reason + ')'); }
    if ($('overlay').classList.contains('hidden')) { problems.push(at + 'no verdict sheet'); }
    if ($('concept-note').textContent !== enc.teaches) { problems.push(at + 'the verdict does not print what the floor teaches'); }
    if ($('stars').textContent.replace(/☆/g, '').length !== sum.stars) {
      problems.push(at + 'verdict shows ' + $('stars').textContent + ' for ' + sum.stars + ' stars');
    }
    const shelf = Shop.shelf(i + 1 < Campaign.ENCOUNTERS.length ? enc.level + 1 : 1, H.ui.save);
    const wares = document.querySelectorAll('#shop .ware').length;
    if (wares !== shelf.boosts.length + (shelf.power ? 1 : 0)) { problems.push(at + 'the shop shows ' + wares + ' wares, the shelf has more or fewer'); }
  }

  // --- the shop: buying a boost banks it, and it rides into the next floor ---
  H.ui.save.gold = 100;
  H.loadFloor(1);
  H.buy('boost', 'recharge', 15);
  H.loadFloor(2);
  if (H.ui.state.boosts.recharge !== 1) { problems.push('a bought recharge did not ride into the next floor'); }
  if (!document.querySelector('#boosts [data-boost="recharge"]')) { problems.push('no button for the carried recharge'); }
  document.querySelector('#boosts [data-boost="recharge"]').click();
  if (H.ui.save.bank.recharge !== 0 || H.ui.state.log.slice(-1)[0][0] !== 'b') { problems.push('using a boost did not log it and spend it from the bank'); }

  const serialised = JSON.stringify(rows);
  let digest = 5381;
  for (let i = 0; i < serialised.length; i++) { digest = ((digest * 33) ^ serialised.charCodeAt(i)) >>> 0; }
  window.__qaHeist = { rows, problems };
  return JSON.stringify({ origin: location.protocol, floors: rows.length, won: rows.filter(r => r.status === 'won').length, stars: rows.reduce((n, r) => n + r.stars, 0), digest: digest.toString(16), problems });
})()
