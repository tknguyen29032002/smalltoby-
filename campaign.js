/* campaign.js - Factory Heist: the fifteen encounters and the numbers that
 * price them.
 *
 * Data only. This file owns progression and economy: which map each level is
 * played on, who is on the floor, what the shift pays, when each power
 * unlocks, and the par a three-star run has to beat. It does not own a map
 * (maps.js does, referenced here by id) and it does not play a level
 * (heist.js does - the one gameplay simulator). It needs nothing loaded
 * before it, and it publishes exactly one name, `Campaign`, because every
 * script tag on the page shares one global namespace.
 *
 * The design behind every number is docs/design/CAMPAIGN.md. Run
 * `node tools/verify-campaign.js` after touching anything here; it measures
 * par off the perfect lines with the real engine and fails on drift.
 *
 * ---------------------------------------------------------------------------
 * Encounter schema
 * ---------------------------------------------------------------------------
 *   level        1-15, the order they are played in.
 *   name         what the player sees on the level card.
 *   mapId        the id of a map in maps.js. The map's `zone` and `tier` must
 *                equal this encounter's, and its G count must equal
 *                `deliveries`.
 *   zone, tier   the zone key (see ZONES) and its tier, 1-5.
 *   unlocks      the power (an engine strategy id) this level hands over, or
 *                null on the three Vault levels, which hand over nothing.
 *   deliveries   2 or 3: how many red points have to be stood on to win.
 *   bots         [{ type: 'basic'|'fast'|'boss', count, hp? }]. `hp` only on
 *                a boss; see BOTS for what each type does.
 *   chestRules   { every, max, gold, charge }: a lockbox pops up on a random
 *                floor cell every `every` ticks, never more than `max` on the
 *                floor at once; reaching one first pays `gold` and `charge`.
 *   prizeBehaviour
 *                { heldByBoss, hidden }. `heldByBoss` lists the deliveries
 *                (indices into the map's G cells, reading order) that start in
 *                a boss's grip - one per boss - and are only released when it
 *                dies. `hidden` means the manifest is missing: the player is
 *                not told where the deliveries are, so no heuristic has
 *                anything to aim at until one is seen.
 *   fog          the floor is dark outside what the cart has stood next to.
 *   memoryCap    null, or the most frontier a plot may hold. A plot that
 *                needs more overheats: it costs its charge and goes nowhere.
 *   swapCap      how many times the power may change in the level.
 *   rewards      { clear, twoStar, threeStar } gold, on top of deliveries and
 *                lockboxes.
 *   shopUnlocks  boost ids (shop.js) that become buyable after this level.
 *   perfectLine  { note, legs: [{ power, to, hits? }] } - the authored
 *                intended solution, one leg per delivery in the order they are
 *                taken. `to` is a delivery index. `hits` is the boss's hp on a
 *                leg to a boss-held delivery: the power has to reach the boss
 *                that many times before the delivery is released.
 *   par          { ticks, charge } - the two-star and three-star lines.
 *   startCharge  the charge the cart starts with. Zero is a loss.
 *                par and startCharge are measured, never guessed:
 *                `node tools/verify-campaign.js --write` rewrites them.
 *   teaches      the one sentence the verdict prints.
 */

var Campaign = (function () {
  'use strict';

  /* ---------------------------------------------------------------------
   * The price of moving. One tick is one world step. The cart never walks:
   * it rides the line a power found. Everything below is what par is
   * measured in, so heist.js charges the same way or par means nothing.
   * ------------------------------------------------------------------ */
  var ECONOMY = {
    // A plot costs its search: ceil(chargedExpansions / plotDivisor). Hot-swap
    // penalties are in chargedExpansions already.
    plotDivisor: 10,
    // Riding costs the terrain of every cell entered: plate 1, oil 5, and a
    // power cell pays 4 back (the engine's TERRAIN_COST).
    // A plot takes one tick, each cell ridden one more, and wading out of oil
    // one extra.
    plotTicks: 1,
    oilStallTicks: 1,
    // A WASD nudge: one cell, one tick, the cell's terrain plus this.
    nudgeSurcharge: 2,
    // Par is the perfect line plus room for the floor moving: this much,
    // and a little more for every boss on it.
    parSlack: 1.15,
    parSlackPerBoss: 0.05,
    // Starting charge is par charge times this: generous early, tight late.
    startMargin: { 1: 2.0, 2: 1.8, 3: 1.6, 4: 1.5, 5: 1.4 },
    // Gold for each delivery secured, by tier.
    deliveryGold: { 1: 5, 2: 6, 3: 7, 4: 8, 5: 9 }
  };

  /* ---------------------------------------------------------------------
   * The three thieves. heist.js reads behaviour from here; the numbers are
   * the contract, the prose is in CAMPAIGN.md.
   *   speed     cells per move. cadence: moves once every n ticks.
   *   plans     the engine strategy it routes with.
   *   targets   what it goes for, in priority order.
   *   drain     charge lost when it bumps the cart.
   *   onLit     what it does when the searchlight (the ride ribbon) touches it.
   * ------------------------------------------------------------------ */
  var BOTS = {
    basic: {
      name: 'Hauler bot', hp: 1, speed: 1, cadence: 2, plans: 'bfs',
      targets: ['chest', 'delivery', 'patrol'], drain: 4, onLit: 'stun',
      stunTicks: 4,
      does: 'Patrols with a sweep, grabs lockboxes and shoves deliveries one cell when it bumps them.'
    },
    fast: {
      name: 'Scout', hp: 1, speed: 2, cadence: 1, plans: 'greedy',
      targets: ['cart'], drain: 6, onLit: 'flee', fleeTicks: 3, aggroRange: 8,
      does: 'Greedy and twice the cart\'s speed. Hunts the cart inside eight cells and runs from the light.'
    },
    boss: {
      name: 'Foreman', hp: null, speed: 1, cadence: 3, plans: 'dijkstra',
      targets: ['away-from-cart'], drain: 12, onLit: 'hit',
      does: 'Slow, heavy, holds a delivery and drags it away from the cart. Takes hp hits; proofed against one power per zone.'
    }
  };

  var ZONES = [
    { key: 'dock', name: 'The Dock', tier: 1, bossShieldedFrom: null, swapCap: 5, fog: false,
      tightens: 'Nothing yet. Three powers arrive; the floor is lit and there is no foreman.' },
    { key: 'assembly', name: 'Assembly', tier: 2, bossShieldedFrom: 'astar', swapCap: 5, fog: false,
      tightens: 'Foremen arrive, proofed against the dart that just became the easy answer.' },
    { key: 'racks', name: 'The Racks', tier: 3, bossShieldedFrom: 'wastar', swapCap: 4, fog: false,
      tightens: 'Memory is rationed and one manifest goes missing. Four swaps.' },
    { key: 'chutes', name: 'The Chutes', tier: 4, bossShieldedFrom: 'beam', swapCap: 4, fog: true,
      tightens: 'Power cells, two foremen proofed against the slitlamp, and the lights go out.' },
    { key: 'control', name: 'Control', tier: 5, bossShieldedFrom: 'dijkstra', swapCap: 3, fog: true,
      tightens: 'No new powers. Three swaps, dark floors, and everything the factory has.' }
  ];

  /* ---------------------------------------------------------------------
   * The fifteen encounters. Why each power lands where it does is the
   * unlock table in CAMPAIGN.md: each one arrives on the level whose trap
   * it is the answer to.
   * ------------------------------------------------------------------ */
  var ENCOUNTERS = [
    {
      level: 1, name: 'Loading bay', mapId: 'dock-loading-bay', zone: 'dock', tier: 1,
      unlocks: 'bfs', deliveries: 2, fog: false, memoryCap: null, swapCap: 5,
      bots: [{ type: 'basic', count: 1 }],
      chestRules: { every: 12, max: 1, gold: 5, charge: 6 },
      prizeBehaviour: { heldByBoss: [], hidden: false },
      rewards: { clear: 10, twoStar: 5, threeStar: 10 },
      shopUnlocks: ['recharge'],
      teaches: 'A sweep spreads evenly in every direction and is never wrong about the number of steps.',
      perfectLine: {
        note: 'Sweep to the near delivery, then sweep again from where you stand.',
        legs: [{ power: 'bfs', to: 1 }, { power: 'bfs', to: 0 }]
      },
      par: { ticks: 28, charge: 41 }, startCharge: 82
    },
    {
      level: 2, name: 'The crate cup', mapId: 'dock-crate-cup', zone: 'dock', tier: 1,
      unlocks: 'dfs', deliveries: 2, fog: false, memoryCap: null, swapCap: 5,
      bots: [{ type: 'basic', count: 2 }],
      chestRules: { every: 12, max: 1, gold: 5, charge: 6 },
      prizeBehaviour: { heldByBoss: [], hidden: false },
      rewards: { clear: 10, twoStar: 5, threeStar: 10 },
      shopUnlocks: ['freeze'],
      teaches: 'A bore commits to one direction and follows it to the end: nearly free to plot, and it promises nothing about the ride.',
      perfectLine: {
        note: 'Bore both hops. On an open dock the crooked ride costs less than a sweep of the whole floor.',
        legs: [{ power: 'dfs', to: 1 }, { power: 'dfs', to: 0 }]
      },
      par: { ticks: 45, charge: 61 }, startCharge: 122
    },
    {
      level: 3, name: 'First spill', mapId: 'dock-oil-apron', zone: 'dock', tier: 1,
      unlocks: 'dijkstra', deliveries: 2, fog: false, memoryCap: null, swapCap: 5,
      bots: [{ type: 'basic', count: 3 }, { type: 'fast', count: 1 }],
      chestRules: { every: 12, max: 1, gold: 6, charge: 6 },
      prizeBehaviour: { heldByBoss: [], hidden: false },
      rewards: { clear: 10, twoStar: 5, threeStar: 10 },
      shopUnlocks: [],
      teaches: 'Oil costs five a cell. Counting steps and counting charge stop being the same question.',
      perfectLine: {
        note: 'Bore the dry hop along the top; the meter is the only power that walks round the apron spill instead of through it.',
        legs: [{ power: 'dfs', to: 1 }, { power: 'dijkstra', to: 0 }]
      },
      par: { ticks: 46, charge: 52 }, startCharge: 104
    },
    {
      level: 4, name: 'Foreman on the line', mapId: 'assembly-line-one', zone: 'assembly', tier: 2,
      unlocks: 'astar', deliveries: 2, fog: false, memoryCap: null, swapCap: 5,
      bots: [{ type: 'basic', count: 2 }, { type: 'fast', count: 1 }, { type: 'boss', count: 1, hp: 3 }],
      chestRules: { every: 10, max: 2, gold: 6, charge: 8 },
      prizeBehaviour: { heldByBoss: [1], hidden: false },
      rewards: { clear: 15, twoStar: 8, threeStar: 12 },
      shopUnlocks: ['reveal'],
      teaches: 'Both deliveries are in plain sight, so the guess is finally worth something - but the foreman shrugs it off.',
      perfectLine: {
        note: 'Dart to the free delivery; the foreman is proofed against the dart, so bore him down.',
        legs: [{ power: 'astar', to: 0 }, { power: 'dfs', to: 1, hits: 3 }]
      },
      par: { ticks: 53, charge: 80 }, startCharge: 144
    },
    {
      level: 5, name: 'The press trap', mapId: 'assembly-press-trap', zone: 'assembly', tier: 2,
      unlocks: 'greedy', deliveries: 3, fog: false, memoryCap: null, swapCap: 5,
      bots: [{ type: 'basic', count: 2 }, { type: 'fast', count: 2 }, { type: 'boss', count: 1, hp: 3 }],
      chestRules: { every: 10, max: 2, gold: 6, charge: 8 },
      prizeBehaviour: { heldByBoss: [2], hidden: false },
      rewards: { clear: 15, twoStar: 8, threeStar: 12 },
      shopUnlocks: [],
      teaches: 'Three deliveries and a flooded press: the snap is cheap to plot, and a foreman does not care how elegant the hit was.',
      perfectLine: {
        note: 'Dart round the press, snap the foreman down where the guess is honest, dart home.',
        legs: [{ power: 'astar', to: 1 }, { power: 'greedy', to: 2, hits: 3 }, { power: 'astar', to: 0 }]
      },
      par: { ticks: 69, charge: 72 }, startCharge: 130
    },
    {
      level: 6, name: 'The dial', mapId: 'assembly-narrow-gantry', zone: 'assembly', tier: 2,
      unlocks: 'wastar', deliveries: 3, fog: false, memoryCap: null, swapCap: 5,
      bots: [{ type: 'basic', count: 3 }, { type: 'fast', count: 2 }, { type: 'boss', count: 1, hp: 3 }],
      chestRules: { every: 10, max: 2, gold: 6, charge: 8 },
      prizeBehaviour: { heldByBoss: [2], hidden: false },
      rewards: { clear: 15, twoStar: 8, threeStar: 12 },
      shopUnlocks: ['extra-swap'],
      teaches: 'One dial runs from the meter to the snap. The gantry\'s spills decide how much wrong you can afford.',
      perfectLine: {
        note: 'Dart, snap the foreman, and dial the last long hop: weight 1.5 plots for a fraction and still walks round the oil.',
        legs: [{ power: 'astar', to: 1 }, { power: 'greedy', to: 2, hits: 3 }, { power: 'wastar', to: 0 }]
      },
      par: { ticks: 95, charge: 128 }, startCharge: 231
    },
    {
      level: 7, name: 'The shelf comb', mapId: 'racks-shelf-comb', zone: 'racks', tier: 3,
      unlocks: 'bibfs', deliveries: 3, fog: false, memoryCap: 24, swapCap: 4,
      bots: [{ type: 'basic', count: 3 }, { type: 'fast', count: 2 }, { type: 'boss', count: 1, hp: 3 }],
      chestRules: { every: 9, max: 2, gold: 7, charge: 8 },
      prizeBehaviour: { heldByBoss: [2], hidden: false },
      rewards: { clear: 20, twoStar: 10, threeStar: 15 },
      shopUnlocks: [],
      teaches: 'Both ends are known and the aisle between them is long: two small searches cost less than one big one.',
      perfectLine: {
        note: 'Snap to the first delivery, pincer down the long aisle, bore the foreman out of his bay.',
        legs: [{ power: 'greedy', to: 0 }, { power: 'bibfs', to: 1 }, { power: 'dfs', to: 2, hits: 3 }]
      },
      par: { ticks: 122, charge: 150 }, startCharge: 240
    },
    {
      level: 8, name: 'Unlisted', mapId: 'racks-dark-aisles', zone: 'racks', tier: 3,
      unlocks: 'iddfs', deliveries: 3, fog: false, memoryCap: 10, swapCap: 4,
      bots: [{ type: 'basic', count: 4 }, { type: 'fast', count: 2 }, { type: 'boss', count: 1, hp: 3 }],
      chestRules: { every: 9, max: 2, gold: 7, charge: 8 },
      prizeBehaviour: { heldByBoss: [2], hidden: true },
      rewards: { clear: 20, twoStar: 10, threeStar: 15 },
      shopUnlocks: [],
      teaches: 'Nobody logged where the deliveries went, and memory is short. The sonar answers shortest on a stack-sized memory.',
      perfectLine: {
        note: 'Sonar for the first delivery while the manifest is missing and nothing else fits the memory; once the floor is known, the pincer does the rest.',
        legs: [{ power: 'iddfs', to: 1 }, { power: 'bibfs', to: 0 }, { power: 'bibfs', to: 2, hits: 3 }]
      },
      par: { ticks: 212, charge: 863 }, startCharge: 1381
    },
    {
      level: 9, name: 'Hand on the rack', mapId: 'racks-hand-on-rack', zone: 'racks', tier: 3,
      unlocks: 'beam', deliveries: 3, fog: false, memoryCap: 4, swapCap: 4,
      bots: [{ type: 'basic', count: 4 }, { type: 'fast', count: 4 }, { type: 'boss', count: 1, hp: 3 }],
      chestRules: { every: 9, max: 2, gold: 7, charge: 8 },
      prizeBehaviour: { heldByBoss: [2], hidden: false },
      rewards: { clear: 20, twoStar: 10, threeStar: 15 },
      shopUnlocks: [],
      teaches: 'A memory of four cells, and a rack maze. Cap the light at a few leads and it still gets through.',
      perfectLine: {
        note: 'Sweep the short hop, dart the next, and take the foreman with the slitlamp - the dart is what he is proofed against.',
        legs: [{ power: 'bfs', to: 1 }, { power: 'astar', to: 0 }, { power: 'beam', to: 2, hits: 3 }]
      },
      par: { ticks: 257, charge: 335 }, startCharge: 536
    },
    {
      level: 10, name: 'Power cells', mapId: 'chutes-power-cells', zone: 'chutes', tier: 4,
      unlocks: 'bellman', deliveries: 3, fog: true, memoryCap: null, swapCap: 4,
      bots: [{ type: 'basic', count: 4 }, { type: 'fast', count: 4 }, { type: 'boss', count: 1, hp: 4 }],
      chestRules: { every: 8, max: 2, gold: 8, charge: 10 },
      prizeBehaviour: { heldByBoss: [2], hidden: false },
      rewards: { clear: 25, twoStar: 12, threeStar: 18 },
      shopUnlocks: [],
      teaches: 'A power cell pays charge back, so a route can get cheaper after it looked finished. Only the relay keeps asking.',
      perfectLine: {
        note: 'Relay down the cell stack where the refund beats the extra passes, then bore both short hops.',
        legs: [{ power: 'bellman', to: 0 }, { power: 'dfs', to: 2, hits: 4 }, { power: 'dfs', to: 1 }]
      },
      par: { ticks: 147, charge: 191 }, startCharge: 287
    },
    {
      level: 11, name: 'Crossed chutes', mapId: 'chutes-crossed', zone: 'chutes', tier: 4,
      unlocks: 'flow', deliveries: 3, fog: false, memoryCap: 16, swapCap: 4,
      bots: [{ type: 'basic', count: 5 }, { type: 'fast', count: 4 }, { type: 'boss', count: 2, hp: 4 }],
      chestRules: { every: 6, max: 4, gold: 8, charge: 10 },
      prizeBehaviour: { heldByBoss: [1, 2], hidden: false },
      rewards: { clear: 25, twoStar: 12, threeStar: 18 },
      shopUnlocks: [],
      teaches: 'Two foremen and a memory of sixteen. A field built backwards from a target answers the last hop at once.',
      perfectLine: {
        note: 'Meter the free delivery, snap the near foreman, and field the far one.',
        legs: [{ power: 'dijkstra', to: 0 }, { power: 'greedy', to: 1, hits: 4 }, { power: 'flow', to: 2, hits: 4 }]
      },
      par: { ticks: 110, charge: 290 }, startCharge: 435
    },
    {
      level: 12, name: 'The drop shaft', mapId: 'chutes-drop-shaft', zone: 'chutes', tier: 4,
      unlocks: 'wall', deliveries: 3, fog: true, memoryCap: null, swapCap: 4,
      bots: [{ type: 'basic', count: 5 }, { type: 'fast', count: 4 }, { type: 'boss', count: 2, hp: 4 }],
      chestRules: { every: 8, max: 2, gold: 8, charge: 10 },
      prizeBehaviour: { heldByBoss: [1, 2], hidden: false },
      rewards: { clear: 25, twoStar: 12, threeStar: 18 },
      shopUnlocks: [],
      teaches: 'A hand on the wall holds no frontier at all, and in a joined-up shaft it gets there for almost nothing.',
      perfectLine: {
        note: 'Wall-follow to the first delivery, then dart and bore the two foremen.',
        legs: [{ power: 'wall', to: 0 }, { power: 'astar', to: 1, hits: 4 }, { power: 'dfs', to: 2, hits: 4 }]
      },
      par: { ticks: 207, charge: 410 }, startCharge: 615
    },
    {
      level: 13, name: 'Sorting floor', mapId: 'control-sorting-floor', zone: 'control', tier: 5,
      unlocks: null, deliveries: 3, fog: true, memoryCap: null, swapCap: 3,
      bots: [{ type: 'basic', count: 5 }, { type: 'fast', count: 4 }, { type: 'boss', count: 2, hp: 5 }],
      chestRules: { every: 8, max: 3, gold: 9, charge: 10 },
      prizeBehaviour: { heldByBoss: [1, 2], hidden: false },
      rewards: { clear: 30, twoStar: 15, threeStar: 20 },
      shopUnlocks: [],
      teaches: 'Two foremen at opposite ends of a maze of sorting lanes. No single power is right twice here.',
      perfectLine: {
        note: 'Pincer to the free delivery, bore the near foreman, and walk a wall to the far one.',
        legs: [{ power: 'bibfs', to: 0 }, { power: 'dfs', to: 2, hits: 5 }, { power: 'wall', to: 1, hits: 5 }]
      },
      par: { ticks: 225, charge: 338 }, startCharge: 474
    },
    {
      level: 14, name: 'Fleet recall', mapId: 'control-fleet-recall', zone: 'control', tier: 5,
      unlocks: null, deliveries: 3, fog: true, memoryCap: null, swapCap: 3,
      bots: [{ type: 'basic', count: 6 }, { type: 'fast', count: 4 }, { type: 'boss', count: 2, hp: 5 }],
      chestRules: { every: 7, max: 3, gold: 9, charge: 10 },
      prizeBehaviour: { heldByBoss: [1, 2], hidden: false },
      rewards: { clear: 30, twoStar: 15, threeStar: 20 },
      shopUnlocks: [],
      teaches: 'Four starting bays and three deliveries: the pincer and the slitlamp split the floor between them.',
      perfectLine: {
        note: 'Pincer the first foreman, slitlamp the second, and slitlamp home.',
        legs: [{ power: 'bibfs', to: 1, hits: 5 }, { power: 'beam', to: 2, hits: 5 }, { power: 'beam', to: 0 }]
      },
      par: { ticks: 130, charge: 307 }, startCharge: 430
    },
    {
      level: 15, name: 'The strongroom', mapId: 'control-the-vault', zone: 'control', tier: 5,
      unlocks: null, deliveries: 3, fog: true, memoryCap: null, swapCap: 3,
      bots: [{ type: 'basic', count: 6 }, { type: 'fast', count: 4 }, { type: 'boss', count: 3, hp: 5 }],
      chestRules: { every: 7, max: 3, gold: 10, charge: 10 },
      prizeBehaviour: { heldByBoss: [0, 1, 2], hidden: true },
      rewards: { clear: 40, twoStar: 20, threeStar: 30 },
      shopUnlocks: [],
      teaches: 'Three foremen, three deliveries, fog, chutes and a charging shaft. Everything the factory taught you, in one shift.',
      perfectLine: {
        note: 'Slitlamp the first two foremen, and bore the last one.',
        legs: [{ power: 'beam', to: 1, hits: 5 }, { power: 'beam', to: 2, hits: 5 }, { power: 'dfs', to: 0, hits: 5 }]
      },
      par: { ticks: 103, charge: 236 }, startCharge: 331
    }
  ];

  var ZONE_BY_KEY = {};
  ZONES.forEach(function (z) { ZONE_BY_KEY[z.key] = z; });

  var BY_LEVEL = {};
  ENCOUNTERS.forEach(function (e) { BY_LEVEL[e.level] = e; });

  /* The unlock ladder, read off the encounters. */
  function unlockOrder() {
    return ENCOUNTERS.filter(function (e) { return e.unlocks; })
      .map(function (e) { return { power: e.unlocks, level: e.level }; });
  }

  /* Powers the player holds when level n starts, before anything bought. */
  function powersAt(level) {
    return unlockOrder().filter(function (u) { return u.level <= level; })
      .map(function (u) { return u.power; });
  }

  function unlockLevelOf(power) {
    var u = unlockOrder().filter(function (x) { return x.power === power; })[0];
    return u ? u.level : null;
  }

  function botCount(enc) {
    return enc.bots.reduce(function (n, b) { return n + b.count; }, 0);
  }

  function bossesOf(enc) {
    return enc.bots.filter(function (b) { return b.type === 'boss'; })
      .reduce(function (n, b) { return n + b.count; }, 0);
  }

  function bossHp(enc) {
    var boss = enc.bots.filter(function (b) { return b.type === 'boss'; })[0];
    return boss ? boss.hp : 0;
  }

  /* What a plot costs, off an engine trace. */
  function plotCharge(trace) {
    var spent = trace.chargedExpansions !== undefined ? trace.chargedExpansions : trace.expansions;
    return Math.max(1, Math.ceil(spent / ECONOMY.plotDivisor));
  }

  /* Stars. Cumulative: the second needs the first, the third needs both.
   * A boost other than recharge used in the level caps the result at two
   * (shop.js, `capsStars`): gold can save a shift, never earn the third star. */
  function starsFor(enc, outcome) {
    if (!outcome.won) { return 0; }
    var stars = 1;
    if (outcome.ticks <= enc.par.ticks) {
      stars = 2;
      if (outcome.chargeSpent <= enc.par.charge) { stars = 3; }
    }
    if (outcome.starCap !== undefined) { stars = Math.min(stars, outcome.starCap); }
    return stars;
  }

  /* Gold for a finished level. Lockbox gold is paid when a box is reached,
   * so it arrives in `outcome.chestGold` rather than being counted here. */
  function goldFor(enc, outcome) {
    if (!outcome.won) { return outcome.chestGold || 0; }
    var stars = starsFor(enc, outcome);
    return enc.deliveries * ECONOMY.deliveryGold[enc.tier] + enc.rewards.clear +
      (stars >= 2 ? enc.rewards.twoStar : 0) + (stars >= 3 ? enc.rewards.threeStar : 0) +
      (outcome.chestGold || 0);
  }

  /* The difficulty metric the ladder is monotone in (CAMPAIGN.md). */
  var DIFFICULTY_WEIGHTS = {
    tier: 4, basic: 1, fast: 2, bossHp: 1, delivery: 2,
    fog: 3, hidden: 3, memoryCap: 2, lostSwap: 1
  };

  function difficultyOf(enc) {
    var w = DIFFICULTY_WEIGHTS;
    var d = w.tier * enc.tier + w.delivery * enc.deliveries;
    enc.bots.forEach(function (b) {
      if (b.type === 'boss') { d += w.bossHp * b.hp * b.count; } else { d += w[b.type] * b.count; }
    });
    if (enc.fog) { d += w.fog; }
    if (enc.prizeBehaviour.hidden) { d += w.hidden; }
    if (enc.memoryCap !== null) { d += w.memoryCap; }
    d += w.lostSwap * (ZONES[0].swapCap - enc.swapCap);
    return d;
  }

  var api = {
    ECONOMY: ECONOMY,
    BOTS: BOTS,
    ZONES: ZONES,
    ZONE_BY_KEY: ZONE_BY_KEY,
    ENCOUNTERS: ENCOUNTERS,
    DIFFICULTY_WEIGHTS: DIFFICULTY_WEIGHTS,
    encounter: function (level) { return BY_LEVEL[level] || null; },
    unlockOrder: unlockOrder,
    powersAt: powersAt,
    unlockLevelOf: unlockLevelOf,
    botCount: botCount,
    bossesOf: bossesOf,
    bossHp: bossHp,
    plotCharge: plotCharge,
    starsFor: starsFor,
    goldFor: goldFor,
    difficultyOf: difficultyOf
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  return api;
})();
