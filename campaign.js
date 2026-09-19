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
 * `node tools/verify-campaign.js` after touching this file, shop.js or
 * maps.js; it measures par off the perfect lines with the real engine and
 * fails on drift.
 *
 * ---------------------------------------------------------------------------
 * What the campaign reads off a map (maps.js owns all of it)
 * ---------------------------------------------------------------------------
 *   S          the first S (reading order) is where the cart starts; any
 *              other S is a thief's den.
 *   G, $       the deliveries: every G in reading order, then `$` pads in
 *              reading order until the encounter's `deliveries` are placed.
 *              `$` pads left over are where lockboxes pop up.
 *   budgets    `expansions` is the free thinking allowance of one plot;
 *              `frontier` is the memory a plot may hold before it overheats.
 *   fog, goalKnown
 *              the floor's own darkness and missing manifest. An encounter
 *              may add either, never remove it.
 *
 * ---------------------------------------------------------------------------
 * Encounter schema
 * ---------------------------------------------------------------------------
 *   level        1-15, the order they are played in.
 *   name         what the player sees on the level card (the map's name).
 *   mapId        the id of a map in maps.js. Its `zone` and `tier` must equal
 *                this encounter's.
 *   zone, tier   the zone key (see ZONES) and its tier, 1-5.
 *   unlocks      the power (an engine strategy id) this level hands over, or
 *                null on a revision level.
 *   deliveries   how many red points have to be stood on to win: 2 or 3, or
 *                the map's G count when the map itself asks for more.
 *   bots         [{ type: 'basic'|'fast'|'boss', count, hp? }]. `hp` only on
 *                a boss; see BOTS for what each type does.
 *   chestRules   { every, max, gold, charge }: a lockbox pops up on a free
 *                `$` pad (or a random floor cell once those run out) every
 *                `every` ticks, never more than `max` at once; reaching one
 *                first pays `gold` and `charge`.
 *   prizeBehaviour
 *                { heldByBoss, hidden }. `heldByBoss` lists the deliveries
 *                (indices into the delivery cells above) that start in a
 *                foreman's grip - one per foreman - and are only released when
 *                it dies. `hidden`: the manifest is missing, so no heuristic
 *                has anything to aim at until a delivery is seen.
 *   fog          the floor is dark outside what the cart has stood next to.
 *   memoryCap    null, or a memory limit tighter than the map's own frontier
 *                budget. A plot holding more frontier overheats.
 *   swapCap      how many times the power may change in the level.
 *   rewards      { clear, twoStar, threeStar } gold, on top of deliveries and
 *                lockboxes.
 *   shopUnlocks  boost ids (shop.js) that become buyable after this level.
 *   perfectLine  { note, legs: [{ power, to, hits? }] } - the authored
 *                intended solution, one leg per delivery in the order they are
 *                taken. `to` is a delivery index. `hits` is the foreman's hp on
 *                a leg to a held delivery: the power has to reach him that
 *                many times before the delivery is released.
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
    // A plot costs plotBase, plus one charge for every expansion past the
    // map's thinking allowance (budgets.expansions; no budget, no overage).
    // Hot-swap penalties count as expansions. A plot whose frontier passes
    // budgets.frontier overheats: it costs its charge and goes nowhere.
    plotBase: 1,
    // Riding costs the terrain of every cell entered: plate 1, oil 5, and a
    // power cell pays 4 back (the engine's TERRAIN_COST).
    // A plot takes one tick, each cell ridden one more, and wading out of oil
    // one extra.
    plotTicks: 1,
    oilStallTicks: 1,
    // A WASD nudge: one cell, one tick, the cell's terrain plus this.
    nudgeSurcharge: 2,
    // Par is the perfect line plus this much room for the floor moving.
    parSlack: 1.15,
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

  /* The five zones are maps.js's five zones, one tier each. */
  var ZONES = [
    { key: 'dock', name: 'The dock', tier: 1, bossShieldedFrom: null, swapCap: 5,
      tightens: 'Nothing yet. Three powers arrive on open floor, and there is no foreman.' },
    { key: 'assembly', name: 'Assembly', tier: 2, bossShieldedFrom: 'astar', swapCap: 5,
      tightens: 'Thinking has a budget, and foremen arrive proofed against the dart that just became the easy answer.' },
    { key: 'racks', name: 'The racks', tier: 3, bossShieldedFrom: 'beam', swapCap: 4,
      tightens: 'Memory is the budget, a manifest goes missing, and the swap cap drops to four.' },
    { key: 'chutes', name: 'The chutes', tier: 4, bossShieldedFrom: 'bibfs', swapCap: 4,
      tightens: 'Teleporters make the ruler lie and power cells make it lie twice. Two foremen, proofed against the pincer.' },
    { key: 'control', name: 'Control', tier: 5, bossShieldedFrom: 'flow', swapCap: 3,
      tightens: 'The biggest floors in the dark, memory rationed, three swaps, and foremen proofed against the field.' }
  ];

  /* ---------------------------------------------------------------------
   * The fifteen encounters, one per map, in maps.js's order. Each power
   * arrives on the map whose trap it is the answer to (the unlock table in
   * CAMPAIGN.md); the three revision levels hand over nothing.
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
        note: 'Sweep the short hop to the pad, then sweep again from where you stand to the prize.',
        legs: [{ power: 'bfs', to: 1 }, { power: 'bfs', to: 0 }]
      },
      par: { ticks: 21, charge: 21 }, startCharge: 42
    },
    {
      level: 2, name: 'The crate cup', mapId: 'dock-crate-cup', zone: 'dock', tier: 1,
      unlocks: 'greedy', deliveries: 2, fog: false, memoryCap: null, swapCap: 5,
      bots: [{ type: 'basic', count: 2 }],
      chestRules: { every: 12, max: 1, gold: 5, charge: 6 },
      prizeBehaviour: { heldByBoss: [], hidden: false },
      rewards: { clear: 10, twoStar: 5, threeStar: 10 },
      shopUnlocks: ['freeze'],
      teaches: 'The prize is in plain sight across a wide floor: a snap that leans straight at it thinks a fraction of what a sweep does.',
      perfectLine: {
        note: 'Sweep the short hop to the pad; snap across the open floor to the prize, where a sweep would pay for the whole cup.',
        legs: [{ power: 'bfs', to: 1 }, { power: 'greedy', to: 0 }]
      },
      par: { ticks: 32, charge: 32 }, startCharge: 64
    },
    {
      level: 3, name: 'Oil on the apron', mapId: 'dock-oil-apron', zone: 'dock', tier: 1,
      unlocks: 'dijkstra', deliveries: 2, fog: false, memoryCap: null, swapCap: 5,
      bots: [{ type: 'basic', count: 3 }, { type: 'fast', count: 1 }],
      chestRules: { every: 12, max: 1, gold: 6, charge: 6 },
      prizeBehaviour: { heldByBoss: [], hidden: false },
      rewards: { clear: 10, twoStar: 5, threeStar: 10 },
      shopUnlocks: [],
      teaches: 'Oil costs five a cell. Counting steps and counting charge stop being the same question.',
      perfectLine: {
        note: 'Sweep the dry hop to the pad; meter the leg to the prize, where the slick sits in the way.',
        legs: [{ power: 'bfs', to: 1 }, { power: 'dijkstra', to: 0 }]
      },
      par: { ticks: 42, charge: 42 }, startCharge: 84
    },
    {
      level: 4, name: 'Line one', mapId: 'assembly-line-one', zone: 'assembly', tier: 2,
      unlocks: 'astar', deliveries: 2, fog: false, memoryCap: null, swapCap: 5,
      bots: [{ type: 'basic', count: 2 }, { type: 'fast', count: 1 }, { type: 'boss', count: 1, hp: 3 }],
      chestRules: { every: 10, max: 1, gold: 6, charge: 8 },
      prizeBehaviour: { heldByBoss: [1], hidden: false },
      rewards: { clear: 15, twoStar: 8, threeStar: 12 },
      shopUnlocks: ['reveal'],
      teaches: 'Thinking has a budget now. The dart counts oil like the meter and aims like the snap, so it finishes inside the allowance.',
      perfectLine: {
        note: 'Meter the foreman down first - he shrugs off the dart - then dart to the prize inside the thinking allowance.',
        legs: [{ power: 'dijkstra', to: 1, hits: 3 }, { power: 'astar', to: 0 }]
      },
      par: { ticks: 44, charge: 44 }, startCharge: 80
    },
    {
      level: 5, name: 'The press trap', mapId: 'assembly-press-trap', zone: 'assembly', tier: 2,
      unlocks: 'wastar', deliveries: 2, fog: false, memoryCap: null, swapCap: 5,
      bots: [{ type: 'basic', count: 2 }, { type: 'fast', count: 2 }, { type: 'boss', count: 1, hp: 3 }],
      chestRules: { every: 10, max: 1, gold: 6, charge: 8 },
      prizeBehaviour: { heldByBoss: [1], hidden: false },
      rewards: { clear: 15, twoStar: 8, threeStar: 12 },
      shopUnlocks: [],
      teaches: 'A flooded press tempts the snap. The dial trusts the guess only as far as the oil lets it.',
      perfectLine: {
        note: 'Sweep the foreman on the near pad, then dial past the flooded press to the prize.',
        legs: [{ power: 'bfs', to: 1, hits: 3 }, { power: 'wastar', to: 0 }]
      },
      par: { ticks: 44, charge: 44 }, startCharge: 80
    },
    {
      level: 6, name: 'The narrow gantry', mapId: 'assembly-narrow-gantry', zone: 'assembly', tier: 2,
      unlocks: 'beam', deliveries: 2, fog: false, memoryCap: null, swapCap: 5,
      bots: [{ type: 'basic', count: 3 }, { type: 'fast', count: 2 }, { type: 'boss', count: 1, hp: 3 }],
      chestRules: { every: 10, max: 1, gold: 6, charge: 8 },
      prizeBehaviour: { heldByBoss: [1], hidden: false },
      rewards: { clear: 15, twoStar: 8, threeStar: 12 },
      shopUnlocks: ['extra-swap'],
      teaches: 'Memory is so tight on the gantry that every other power overheats. Cap the light at a few cells and it still crosses.',
      perfectLine: {
        note: 'Slitlamp across the gantry to the prize; the foreman\'s pad is off the gantry, where the dial fits.',
        legs: [{ power: 'beam', to: 0 }, { power: 'wastar', to: 1, hits: 3 }]
      },
      par: { ticks: 89, charge: 89 }, startCharge: 161
    },
    {
      level: 7, name: 'Shelf comb', mapId: 'racks-shelf-comb', zone: 'racks', tier: 3,
      unlocks: 'dfs', deliveries: 2, fog: false, memoryCap: null, swapCap: 4,
      bots: [{ type: 'basic', count: 3 }, { type: 'fast', count: 3 }, { type: 'boss', count: 1, hp: 3 }],
      chestRules: { every: 9, max: 1, gold: 7, charge: 8 },
      prizeBehaviour: { heldByBoss: [1], hidden: false },
      rewards: { clear: 20, twoStar: 10, threeStar: 15 },
      shopUnlocks: [],
      teaches: 'A sweep holds every aisle open at once; a bore holds one. When memory is the limit, that is the whole bill.',
      perfectLine: {
        note: 'Snap at the foreman on the open pad, then bore the comb to the prize one aisle at a time.',
        legs: [{ power: 'greedy', to: 1, hits: 3 }, { power: 'dfs', to: 0 }]
      },
      par: { ticks: 189, charge: 227 }, startCharge: 364
    },
    {
      level: 8, name: 'Dark aisles', mapId: 'racks-dark-aisles', zone: 'racks', tier: 3,
      unlocks: 'iddfs', deliveries: 3, fog: false, memoryCap: null, swapCap: 4,
      bots: [{ type: 'basic', count: 4 }, { type: 'fast', count: 3 }, { type: 'boss', count: 1, hp: 3 }],
      chestRules: { every: 9, max: 1, gold: 7, charge: 8 },
      prizeBehaviour: { heldByBoss: [2], hidden: true },
      rewards: { clear: 20, twoStar: 10, threeStar: 15 },
      shopUnlocks: [],
      teaches: 'Nobody logged where the prize went, and memory is four cells. The sonar answers shortest on a stack-sized memory.',
      perfectLine: {
        note: 'Slitlamp to the first pad, sonar down the aisle to the foreman, slitlamp back to the prize nobody logged.',
        legs: [{ power: 'beam', to: 1 }, { power: 'iddfs', to: 2, hits: 3 }, { power: 'beam', to: 0 }]
      },
      par: { ticks: 135, charge: 135 }, startCharge: 216
    },
    {
      level: 9, name: 'Hand on the rack', mapId: 'racks-hand-on-rack', zone: 'racks', tier: 3,
      unlocks: 'wall', deliveries: 3, fog: true, memoryCap: null, swapCap: 4,
      bots: [{ type: 'basic', count: 4 }, { type: 'fast', count: 4 }, { type: 'boss', count: 1, hp: 3 }],
      chestRules: { every: 9, max: 1, gold: 7, charge: 8 },
      prizeBehaviour: { heldByBoss: [2], hidden: false },
      rewards: { clear: 20, twoStar: 10, threeStar: 15 },
      shopUnlocks: [],
      teaches: 'No memory and no light. Every rack is joined up, and a hand on the wall holds no frontier and needs no light.',
      perfectLine: {
        note: 'One straight hop fits in one cell of memory; everything after it needs a hand on the rack.',
        legs: [{ power: 'bfs', to: 1 }, { power: 'wall', to: 2, hits: 3 }, { power: 'wall', to: 0 }]
      },
      par: { ticks: 251, charge: 265 }, startCharge: 424
    },
    {
      level: 10, name: 'Crossed chutes', mapId: 'chutes-crossed', zone: 'chutes', tier: 4,
      unlocks: 'bibfs', deliveries: 3, fog: false, memoryCap: null, swapCap: 4,
      bots: [{ type: 'basic', count: 4 }, { type: 'fast', count: 4 }, { type: 'boss', count: 1, hp: 4 }],
      chestRules: { every: 8, max: 1, gold: 8, charge: 10 },
      prizeBehaviour: { heldByBoss: [2], hidden: false },
      rewards: { clear: 25, twoStar: 12, threeStar: 18 },
      shopUnlocks: [],
      teaches: 'Teleporters make every guess confidently wrong. With both ends known, two small sweeps that meet in the middle trust no ruler.',
      perfectLine: {
        note: 'Sweep the foreman and the prize, then pincer the long run to the last pad, where the chutes lie to every power that aims.',
        legs: [{ power: 'bfs', to: 2, hits: 4 }, { power: 'bfs', to: 0 }, { power: 'bibfs', to: 1 }]
      },
      par: { ticks: 56, charge: 56 }, startCharge: 84
    },
    {
      level: 11, name: 'Power cells', mapId: 'chutes-power-cells', zone: 'chutes', tier: 4,
      unlocks: 'bellman', deliveries: 3, fog: false, memoryCap: null, swapCap: 4,
      bots: [{ type: 'basic', count: 5 }, { type: 'fast', count: 4 }, { type: 'boss', count: 2, hp: 4 }],
      chestRules: { every: 8, max: 1, gold: 8, charge: 10 },
      prizeBehaviour: { heldByBoss: [1, 2], hidden: false },
      rewards: { clear: 25, twoStar: 12, threeStar: 18 },
      shopUnlocks: [],
      teaches: 'A power cell pays charge back, so a route can get cheaper after it looked finished. Only the relay keeps asking.',
      perfectLine: {
        note: 'Relay the foreman down the cells, where the refund is worth the extra passes; sweep the short hops after.',
        legs: [{ power: 'bellman', to: 2, hits: 4 }, { power: 'bfs', to: 0 }, { power: 'bfs', to: 1, hits: 4 }]
      },
      par: { ticks: 107, charge: 88 }, startCharge: 132
    },
    {
      level: 12, name: 'The drop shaft', mapId: 'chutes-drop-shaft', zone: 'chutes', tier: 4,
      unlocks: null, deliveries: 3, fog: false, memoryCap: null, swapCap: 4,
      bots: [{ type: 'basic', count: 5 }, { type: 'fast', count: 5 }, { type: 'boss', count: 2, hp: 4 }],
      chestRules: { every: 8, max: 1, gold: 8, charge: 10 },
      prizeBehaviour: { heldByBoss: [1, 2], hidden: false },
      rewards: { clear: 25, twoStar: 12, threeStar: 18 },
      shopUnlocks: [],
      teaches: 'Teleporters and power cells on one shaft. The relay finds the true cheapest route; everything else settles.',
      perfectLine: {
        note: 'Sweep both foremen on the short hops, then relay down the shaft to the prize.',
        legs: [{ power: 'bfs', to: 1, hits: 4 }, { power: 'bfs', to: 2, hits: 4 }, { power: 'bellman', to: 0 }]
      },
      par: { ticks: 89, charge: 55 }, startCharge: 83
    },
    {
      level: 13, name: 'Sorting floor', mapId: 'control-sorting-floor', zone: 'control', tier: 5,
      unlocks: null, deliveries: 4, fog: true, memoryCap: 12, swapCap: 3,
      bots: [{ type: 'basic', count: 5 }, { type: 'fast', count: 5 }, { type: 'boss', count: 2, hp: 5 }],
      chestRules: { every: 8, max: 2, gold: 9, charge: 10 },
      prizeBehaviour: { heldByBoss: [2, 3], hidden: false },
      rewards: { clear: 30, twoStar: 15, threeStar: 20 },
      shopUnlocks: [],
      teaches: 'Four prizes across oil. The meter prices every leg honestly; the foremen make you change tools for the fight.',
      perfectLine: {
        note: 'Meter the first prize across the oil, then sweep the foremen and the last prize on short hops that fit the memory.',
        legs: [{ power: 'dijkstra', to: 1 }, { power: 'bfs', to: 3, hits: 5 }, { power: 'bfs', to: 2, hits: 5 }, { power: 'bfs', to: 0 }]
      },
      par: { ticks: 209, charge: 209 }, startCharge: 293
    },
    {
      level: 14, name: 'Fleet recall', mapId: 'control-fleet-recall', zone: 'control', tier: 5,
      unlocks: 'flow', deliveries: 3, fog: true, memoryCap: 14, swapCap: 3,
      bots: [{ type: 'basic', count: 7 }, { type: 'fast', count: 6 }, { type: 'boss', count: 2, hp: 5 }],
      chestRules: { every: 7, max: 2, gold: 9, charge: 10 },
      prizeBehaviour: { heldByBoss: [1, 2], hidden: false },
      rewards: { clear: 30, twoStar: 15, threeStar: 20 },
      shopUnlocks: [],
      teaches: 'Four dens, one dock. A field built backwards from the prize once answers every cell that asks.',
      perfectLine: {
        note: 'Sweep and meter the foremen - they shrug off the field - then field the prize the dens all run to.',
        legs: [{ power: 'bfs', to: 1, hits: 5 }, { power: 'dijkstra', to: 2, hits: 5 }, { power: 'flow', to: 0 }]
      },
      par: { ticks: 140, charge: 140 }, startCharge: 196
    },
    {
      level: 15, name: 'The vault', mapId: 'control-the-vault', zone: 'control', tier: 5,
      unlocks: null, deliveries: 3, fog: true, memoryCap: null, swapCap: 3,
      bots: [{ type: 'basic', count: 7 }, { type: 'fast', count: 6 }, { type: 'boss', count: 3, hp: 5 }],
      chestRules: { every: 7, max: 2, gold: 10, charge: 10 },
      prizeBehaviour: { heldByBoss: [0, 1, 2], hidden: false },
      rewards: { clear: 40, twoStar: 20, threeStar: 30 },
      shopUnlocks: [],
      teaches: 'Fog, oil, a lying teleporter and a charging shaft on one floor, and three foremen. Everything the factory taught you, in one shift.',
      perfectLine: {
        note: 'Sweep, meter, sweep: three foremen, each on the power that prices his leg honestly in the dark.',
        legs: [{ power: 'bfs', to: 1, hits: 5 }, { power: 'dijkstra', to: 2, hits: 5 }, { power: 'bfs', to: 0, hits: 5 }]
      },
      par: { ticks: 98, charge: 61 }, startCharge: 86
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

  /* What a plot costs, off an engine trace and the map it ran on. */
  function plotCharge(trace, map) {
    var spent = trace.chargedExpansions !== undefined ? trace.chargedExpansions : trace.expansions;
    var allowance = map.budgets && map.budgets.expansions !== undefined ? map.budgets.expansions : Infinity;
    return ECONOMY.plotBase + Math.max(0, spent - allowance);
  }

  /* The most frontier a plot may hold, or null for no limit: the map's
   * budget, tightened by the encounter's memoryCap when it sets one. */
  function memoryOf(enc, map) {
    var caps = [];
    if (map.budgets && map.budgets.frontier !== undefined) { caps.push(map.budgets.frontier); }
    if (enc.memoryCap !== null && enc.memoryCap !== undefined) { caps.push(enc.memoryCap); }
    return caps.length ? Math.min.apply(null, caps) : null;
  }

  function cellsOf(map, glyph) {
    var out = [];
    map.ascii.split('\n').forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) { if (row[x] === glyph) { out.push({ x: x, y: y }); } }
    });
    return out;
  }

  /* Where the deliveries are: every G, then $ pads, in reading order. */
  function deliveryCellsOf(enc, map) {
    return cellsOf(map, 'G').concat(cellsOf(map, '$')).slice(0, enc.deliveries);
  }

  /* The $ pads left for lockboxes once the deliveries are placed. */
  function chestPadsOf(enc, map) {
    var taken = enc.deliveries - cellsOf(map, 'G').length;
    return cellsOf(map, '$').slice(Math.max(0, taken));
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
    fog: 3, hidden: 3, lostSwap: 1
  };

  function difficultyOf(enc) {
    var w = DIFFICULTY_WEIGHTS;
    var d = w.tier * enc.tier + w.delivery * enc.deliveries;
    enc.bots.forEach(function (b) {
      if (b.type === 'boss') { d += w.bossHp * b.hp * b.count; } else { d += w[b.type] * b.count; }
    });
    if (enc.fog) { d += w.fog; }
    if (enc.prizeBehaviour.hidden) { d += w.hidden; }
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
    memoryOf: memoryOf,
    deliveryCellsOf: deliveryCellsOf,
    chestPadsOf: chestPadsOf,
    starsFor: starsFor,
    goldFor: goldFor,
    difficultyOf: difficultyOf
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  return api;
})();
