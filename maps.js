/* maps.js - the fifteen Factory Heist maps, easiest first.
 *
 * Glyphs are the engine's (README.md, "Map format"), read as a factory floor:
 *
 *   #    wall, rack, crate stack or machine
 *   .    floor, cost 1
 *   ~    oil slick, cost 5
 *   v    power-cell chute, cost -4, one-way downward (enter from above, leave below)
 *   0-9  teleporter chutes: pads sharing a digit are one move apart
 *   S    robot start (several on a map means several robots)
 *   G    prize (several on a map means every one has to be collected)
 *   $    chest spawn point - plain floor to the engine, read by the heist logic
 *
 * Five zones, three maps each, one tier per zone: dock (1), assembly (2),
 * racks (3), chutes (4), control (5). Every map is built around one power
 * that wins on it and at least one that loses; `expect` pins those stars and
 * `notes` says why. tools/verify-maps.js runs the engine to prove each claim,
 * and checks that maps parse, can be finished, differ from one another, and
 * get harder tier by tier. docs/design/MAPS.md is the design write-up.
 *
 * Map fields: id, name, zone, tier, objective and budgets (scored exactly
 * like levels.js), optional fog / goalKnown, expect, ascii, notes.
 */

var MAPS = [
  /* ---------- tier 1: the dock ---------- */
  {
    id: 'dock-loading-bay',
    name: 'Loading bay',
    zone: 'dock',
    tier: 1,
    objective: 'shortest',
    budgets: { expansions: 120, frontier: 30 },
    expect: { bfs: 3, dijkstra: 3, astar: 3, dfs: 0 },
    ascii: [
      '################',
      '#S.....$.......#',
      '#..............#',
      '#...##....##.G.#',
      '#...##....##...#',
      '#..............#',
      '#...........$..#',
      '#..G...........#',
      '################'
    ].join('\n'),
    notes: 'An open loading bay with two pallet stacks. Every search that counts steps finds the prize; DFS commits to the first direction it tries and snakes the whole bay, so it arrives on a path far longer than the shortest one.'
  },
  {
    id: 'dock-crate-cup',
    name: 'The crate cup',
    zone: 'dock',
    tier: 1,
    objective: 'shortest',
    budgets: { expansions: 80, frontier: 40 },
    expect: { astar: 3, greedy: 3, bfs: 1, beam: 0 },
    ascii: [
      '######################',
      '#....................#',
      '#..$.................#',
      '#........#######.....#',
      '#..............#.....#',
      '#S.............#....G#',
      '#.............G#.....#',
      '#........#######.....#',
      '#....................#',
      '#.................$..#',
      '######################'
    ].join('\n'),
    notes: 'A cup of crates stands between the robot and the prize with its mouth open toward the start. A* and greedy both walk in, feel the back wall, and slide round the rim inside the fuel. BFS finds the same route but floods the whole dock to be sure. Beam search keeps only its four best-looking cells, and every one of them is inside the cup: it throws away the way round and never gets out.'
  },
  {
    id: 'dock-oil-apron',
    name: 'Oil on the apron',
    zone: 'dock',
    tier: 1,
    objective: 'cheapest',
    budgets: { expansions: 200, frontier: 60 },
    expect: { dijkstra: 3, astar: 3, bfs: 0, greedy: 0 },
    ascii: [
      '######################',
      '#S...........$.......#',
      '#....##....##........#',
      '#~~~~~~~~~~~~~~~~~...#',
      '#~~~~~~~~~~~~~~~~~...#',
      '#.............~~~~...#',
      '#..$..........~~~~...#',
      '#.............~~~~...#',
      '#..~~~~~~~~~~~~~~~...#',
      '#..~~~~~~~~~~~~~~~...#',
      '#.........G.........G#',
      '######################'
    ].join('\n'),
    notes: 'A forklift spilled oil across the apron and only the far lane is dry. The objective is the cheapest route, so BFS wading straight through the slick is wrong. Dijkstra and A* both pay for oil and go round; greedy does not, and slides in.'
  },

  /* ---------- tier 2: assembly ---------- */
  {
    id: 'assembly-line-one',
    name: 'Line one',
    zone: 'assembly',
    tier: 2,
    objective: 'cheapest',
    budgets: { expansions: 150, frontier: 40 },
    expect: { astar: 3, dijkstra: 1, bfs: 0 },
    ascii: [
      '##########################',
      '#S.......~~~.............#',
      '#.######.~~~.##########..#',
      '#........~~~.............#',
      '#.######.....##########..#',
      '#........~~~~~~~..G......#',
      '#.######.~~~~~~~######...#',
      '#..............$.........#',
      '#.######.~~~~~~~######...#',
      '#........~~~~~~~.........#',
      '#.######.....##########..#',
      '#$..........~~~.........G#',
      '##########################'
    ].join('\n'),
    notes: 'Five assembly lines run left to right with oil dripping between them, and the prize waits at the far end of the floor. Dijkstra finds the cheapest route but pays for it by ringing out over every line; A* knows which end of the floor matters and fits in the fuel.'
  },
  {
    id: 'assembly-press-trap',
    name: 'The press trap',
    zone: 'assembly',
    tier: 2,
    objective: 'cheapest',
    budgets: { expansions: 160, frontier: 60 },
    expect: { astar: 3, dijkstra: 1, greedy: 0, bfs: 0 },
    ascii: [
      '############################',
      '#..........................#',
      '#..$.......................#',
      '#.......~~~~~~~~~~~~~~.....#',
      '#......##############~.....#',
      '#......~~~~~~~~~~~~~#~.....#',
      '#S.....~~~~~~~~~~~~~#~....G#',
      '#......~~~~~~~~~~~~~#~.....#',
      '#......##############~.....#',
      '#.......~~~~~~~~~~~~~~.....#',
      '#....................G.$...#',
      '#............G.............#',
      '############################'
    ].join('\n'),
    notes: 'A stamping press sits between the robot and the prize, its bed flooded with oil and open on the near side, with more oil dripped along both rims. The fewest-steps route goes straight through the bed, so BFS and greedy wade in and pay for it. A* counts both the distance and the oil and goes wide round the press on dry floor; Dijkstra finds the same route but rings out over the whole floor first.'
  },
  {
    id: 'assembly-narrow-gantry',
    name: 'The narrow gantry',
    zone: 'assembly',
    tier: 2,
    objective: 'cheapest',
    budgets: { expansions: 260, frontier: 8 },
    expect: { beam: 3, astar: 1, dijkstra: 1, greedy: 0, bfs: 0 },
    ascii: [
      '################################',
      '#S.....~~~.......#...G.........#',
      '#.####.~~~.#####.#.###########.#',
      '#.#......~.....#.#.....~~~...#.#',
      '#.#.####.~.###.#.#####.~~~.#.#.#',
      '#.#....#.......#.......~~~.#...#',
      '#.####.#########.#######.###.###',
      '#......~~~~~.........$...#.....#',
      '#.##########.###########.#.###.#',
      '#.#.......~~~~~~~......#...#...#',
      '#.#.#####.~~~~~~~.####.#####.#.#',
      '#...#......G............~~~..#.#',
      '###.#.#################.~~~.##.#',
      '#$....#.................~~~...G#',
      '################################'
    ].join('\n'),
    notes: 'A long snaking gantry with oil on the short cuts and room in memory for only eight open cells. Dijkstra and A* both find the cheapest route and both overflow that memory holding every branch they have not finished. Greedy and weighted A* stay small but cut through the oil. Beam search keeps just its four best cells, and on a line this narrow the best four are always enough.'
  },

  /* ---------- tier 3: the racks ---------- */
  {
    id: 'racks-shelf-comb',
    name: 'Shelf comb',
    zone: 'racks',
    tier: 3,
    objective: 'any',
    budgets: { frontier: 5 },
    expect: { dfs: 3, bfs: 1, astar: 1, greedy: 1 },
    ascii: [
      '##################################',
      '#S...............................#',
      '#.#########.#########.##########.#',
      '#.#.......#.#.......#.#........#.#',
      '#.#.#####.#.#.#####.#.#.######.#.#',
      '#.#.#$....#.#.#.....#.#......#.#.#',
      '#.#.#######.#.#######.########.#.#',
      '#.#.~~~~....#.........#........#.#',
      '#.###########.#######.##########.#',
      '#.#.........#.#.....#.#.~~~....#.#',
      '#.#.#######.#.#.###.#.#.######.#.#',
      '#.#.......#.#.#...#.#.#......#.#.#',
      '#.#######.#.#.###.#.#.######.#.#.#',
      '#.........#.....#G#........G.#.G.#',
      '##################################'
    ].join('\n'),
    notes: 'Warehouse racks with bays hanging off every aisle, and oil drips nobody cares about: any route will do, but the robot only has memory for five open cells. BFS keeps every aisle mouth open at once and overflows; A* and greedy do the same with better manners. DFS goes down one aisle to the end before it looks at the next, so its memory stays small, and it gets there on a long route that still counts.'
  },
  {
    id: 'racks-dark-aisles',
    name: 'Dark aisles',
    zone: 'racks',
    tier: 3,
    objective: 'shortest',
    goalKnown: false,
    budgets: { frontier: 4 },
    expect: { iddfs: 3, bfs: 1, dfs: 0 },
    ascii: [
      '#####################################',
      '#S..................................#',
      '#.########.########################.#',
      '#.............................$.....#',
      '#.###################################',
      '#.........~~~~......................#',
      '#.############################.####.#',
      '#...................................#',
      '#.###################################',
      '#...................................#',
      '#.#################################.#',
      '#..................................G#',
      '#.###################################',
      '#.......................G...........#',
      '#.############.####################.#',
      '#...................................#',
      '#.###################################',
      '#.....$.............~~~~............#',
      '#.#################################.#',
      '#..................................G#',
      '#####################################'
    ].join('\n'),
    notes: 'The rack lights are out: nobody knows where the prize is, the route must be the shortest, and there is memory for four open cells. BFS knows the answer but cannot hold the search; DFS travels light and answers wrong. Iterative deepening walks the same shallow aisles again and again, and that is exactly what buys it both.'
  },
  {
    id: 'racks-hand-on-rack',
    name: 'Hand on the rack',
    zone: 'racks',
    tier: 3,
    objective: 'any',
    budgets: { frontier: 1 },
    expect: { wall: 3, bfs: 1, dfs: 1, iddfs: 1 },
    ascii: [
      '#################################',
      '#S#$....#.................#...#$#',
      '#.#.###.#.#.#############.#.#.#.#',
      '#...#.#.#.#.#........G#...#.#...#',
      '#####.#.#.#.#.#.#######.###.###.#',
      '#.#...#.#.#.#.#...........#.#.#.#',
      '#.#.#.#.###.#############.#.#.#.#',
      '#...#.#...#.#G........#.#.#.#...#',
      '#.###.###.#.#.#######.#.#.#.#.###',
      '#.#.#...#.#...#.......#.#...#...#',
      '#.#.###.#.#.###.#######.#######.#',
      '#...#.#...#...#.#.........#...#.#',
      '###.#.#########.#.#########.#.#.#',
      '#...#...~~~~....#...#...#...#...#',
      '#.#####.#########.#.#.#.#.#######',
      '#.......#.........#~~~#........G#',
      '#################################'
    ].join('\n'),
    notes: 'A tangle of racks where every wall is joined to every other, and a robot with no memory at all. Every real search needs a frontier; the wall follower keeps one hand on the rack and walks, and in a maze with no islands that always gets it out.'
  },

  /* ---------- tier 4: the chutes ---------- */
  {
    id: 'chutes-crossed',
    name: 'Crossed chutes',
    zone: 'chutes',
    tier: 4,
    objective: 'cheapest',
    budgets: { expansions: 150, frontier: 50 },
    expect: { dijkstra: 3, bellman: 1, astar: 0, greedy: 0, bfs: 0 },
    ascii: [
      '##################################',
      '#...~1~#.....#.......#.....#.....#',
      '#....~.#.###.#.#####.#.###.#.###.#',
      '#..S...#.#...#.#.....#.#...#.#$..#',
      '#......#.#.###.#.#####.#.###.#.###',
      '#..........#.....#.......#.......#',
      '#.#####.####.#####.###.#####.###.#',
      '#2.......~~~~#.......#.~~~~#.....#',
      '#.$..###.~~~~#.#####.#.~~~~#.#.#.#',
      '#....#.......#.#.....#.......#.#.#',
      '#.####.###.###.#.###.#####.###.#.#',
      '#......#.......#...#.......#.....#',
      '#.####.#.#####.##2G1#.####.#.###.#',
      '#......#....G#......#......#..G..#',
      '##################################'
    ].join('\n'),
    notes: 'Two teleporter chutes, both landing right beside the prize. Pad 1 is four steps from the robot but ringed with oil; pad 2 is further, behind a wall, and dry. BFS takes the one with fewer steps and pays for the oil. A* and greedy measure with a ruler, decide both pads lead the wrong way, and walk the long corridors instead. Dijkstra has no ruler to trust, so it finds the dry pad and the cheapest route.'
  },
  {
    id: 'chutes-power-cells',
    name: 'Power cells',
    zone: 'chutes',
    tier: 4,
    objective: 'cheapest',
    budgets: { frontier: 40 },
    expect: { bellman: 3, flow: 3, dijkstra: 0, astar: 0, bfs: 0 },
    ascii: [
      '##################################',
      '#..~~~~~~.#.~~~~~~~.#...#G.......#',
      '#.#######v#.#######v#.#.#.######.#',
      '#S#######v#.#######v#.#...#....#.#',
      '#.#######v#.#######v#.#####.##.#.#',
      '#.#######v#.#######v#.#...#.#$G#.#',
      '#.#######v#.#######v#...#.#.####.#',
      '#.#######v#.#######v###.#.#......#',
      '#.#######v#.#######v#...#.######.#',
      '#...........#...........#........#',
      '#.#####.###.#.#####.###.#####.##.#',
      '#.#...#...#...#...#...#.....#..#.#',
      '#.#.#.###.#####.#.###.#####.##.#.#',
      '#...#.......$...#.........G....#.#',
      '##################################'
    ].join('\n'),
    notes: 'Two charging chutes pay the robot four fuel for every cell it rides down, but both sit behind an oil slick, and the right-hand side of the floor is a rack maze. The route through the first chute looks dear at the top and ends up the cheapest on the map. Dijkstra and A* close a cell the moment they first reach it, so they never learn the chute paid off; Bellman-Ford keeps relaxing until nothing improves, and the flow field gets there by searching backward from the prize.'
  },
  {
    id: 'chutes-drop-shaft',
    name: 'The drop shaft',
    zone: 'chutes',
    tier: 4,
    objective: 'cheapest',
    budgets: { frontier: 40 },
    expect: { bellman: 3, flow: 0, dijkstra: 0, astar: 0, bfs: 0 },
    ascii: [
      '########################################',
      '#S.......~~~~~#G...................#...#',
      '#..######~~~~~#..######v######.....#.#.#',
      '#..#....#.....#..#....#v#....#.###.#.#.#',
      '#..#.$..#..1..#..#....#v#....#..3#...#.#',
      '#..#....#.....#..#....#v#....#.###.###.#',
      '#..##.###~~~~~#..##.###v###.##.....#...#',
      '#.......~~~~~~#........v...........#.###',
      '#.......~~~~~~#####.###.##########.#...#',
      '#.#####.~~~~~~#..........~~~~~~~...###.#',
      '#.#.....#######..3.......~~~~~~~.......#',
      '#.#.###........~~~~~.....~~~~~~~...#.#.#',
      '#...#..2.###...~~~~~.....#######...#.#.#',
      '###.#.####G#...~~~~~.....#..$..#...#.#.#',
      '#...#......#1..~~~~~.....#..2..#..G#.#.#',
      '#.###.####.###.#####.#####.#####.###.#.#',
      '#.......#..............................#',
      '########################################'
    ].join('\n'),
    notes: 'Everything the chute zone has, on one floor: three teleporter pairs that make the ruler lie, oil that makes the short way dear, and a charging shaft that makes the dear way cheap. The true cheapest route rides the shaft and costs 11; every search that closes cells early settles for 32 or worse. Only Bellman-Ford comes out right, and it needs the whole memory budget to do it.'
  },

  /* ---------- tier 5: the control room ---------- */
  {
    id: 'control-sorting-floor',
    name: 'Sorting floor',
    zone: 'control',
    tier: 5,
    objective: 'collect',
    budgets: { expansions: 700, frontier: 40 },
    expect: { dijkstra: 3, astar: 1, bfs: 0, dfs: 0 },
    ascii: [
      '#######################################',
      '#~#..$....#...#.........#.........#..G#',
      '#.#.#####.#.#.###.###.#.#.###.###.###.#',
      '#.#.....#...#...#.#...#.#.#.#...#...#.#',
      '#.#####.#####.#.#.#.#.###.#.###.###.#.#',
      '#.....#.......#.#.#.#.#...#...#.#...#.#',
      '###.#.#######.#.#.#.#.#.###.#.#.#.###.#',
      '#...#.#.......#.#.#..~~~#...#.#.#...#.#',
      '#.#.#.#.#######.#.#########.###.###.#.#',
      '#...#.#...#...#.#...#.......#...#.#.#.#',
      '#.#.#.###.#.#.#.###.#.#.#####.#.#.#.#.#',
      '#.#......~~~....#.#.S.#.#.....#.......#',
      '###.#######.#####.###.#.#.#####.#####.#',
      '#...#.....#.#.......~~~.......#.#.....#',
      '#.###.#.#.#.#.#####.#########.#.#.#.#.#',
      '#.#...#.....#.#.$.#.#.....#...#.#.#.#.#',
      '#.#.#####.#.###.#.#.#.###.#.###.###.#.#',
      '#.#.#.....#.#...#.#.#.#...#.#...#...#.#',
      '#.#.#.#.#.#.#.###.###.#.###.#.###.###.#',
      '#G....#.#.....#.......#.....#.....#..G#',
      '#######################################'
    ].join('\n'),
    notes: 'Four prizes in the four corners of the sorting floor, the robot in the middle, and oil in the cross-aisles. Dijkstra watches all four prizes in one run and pays for oil. A* can only aim at one prize at a time, so it re-runs for every prize left and burns the fuel; BFS takes the oil at face value.'
  },
  {
    id: 'control-fleet-recall',
    name: 'Fleet recall',
    zone: 'control',
    tier: 5,
    objective: 'dispatch',
    budgets: { expansions: 400, frontier: 40 },
    expect: { flow: 3, dijkstra: 1, astar: 1, bfs: 0 },
    ascii: [
      '########################################',
      '#S.......#.........~~~~.......#.......S#',
      '#.######.#.#######.~~~~.#####.#.######.#',
      '#.#..$...#.#.....#......#...#.#...$..#.#',
      '#.#.######.#.###.######.#.#.#.######G#.#',
      '#.#........#...#......#...#.#........#.#',
      '#.##########.#.######.#####.##########.#',
      '#......~~~~..#......#.......~~~~.......#',
      '#.####.~~~~.######..G..######~~~~.####.#',
      '#.#....~~~~.......#.....#....~~~~....#.#',
      '#.#.######.######.#.###.#.######.###.#.#',
      '#.#......#......#...#~#...#....G.#...#.#',
      '#.######.######.#####.#####.######.###.#',
      '#S.................~~~~~.............S.#',
      '########################################'
    ].join('\n'),
    notes: 'The alarm has gone off and four robots in four corners all have to get back to the prize vault in the middle, cheaply. Any search run once per robot pays four times. The flow field searches once, backward from the vault, and every robot reads its route off the same map for nothing.'
  },
  {
    id: 'control-the-vault',
    name: 'The vault',
    zone: 'control',
    tier: 5,
    objective: 'collect',
    fog: true,
    budgets: { frontier: 40 },
    expect: { bellman: 3, dijkstra: 0, astar: 0, bfs: 0, beam: 0 },
    ascii: [
      '##############################################',
      '#S..........~~~~~~...#.1......G..............#',
      '#.##################v######################..#',
      '#.#................#v##......................#',
      '#.#.##############.#v##.###################..#',
      '#.#.#.....#......#.#v##......................#',
      '#...#.##########.#.#v##.###################..#',
      '#.#.#.#...#....#.#.#v##......................#',
      '#.#.#.######.####$.#v##.###################..#',
      '#.#.#............#.#v##......................#',
      '#.#.##############.#v######################..#',
      '#.#................#v##......................#',
      '#.##################.#######################.#',
      '#.......................#...........#........#',
      '#.....####..####........#.####......#........#',
      '#.....####..####........#.####......#...$....#',
      '#.......~~~~~~~~........#...~~~~~~~.#........#',
      '#.......~~~~~~~~......G.....~~~~~~~..........#',
      '#.....####..####..........####......#........#',
      '#.....####..####..........####......#........#',
      '#................................G.1#........#',
      '##############################################'
    ].join('\n'),
    notes: 'The hardest floor: the control room in the dark. Fog hides everything the robot has not stood next to, so every heuristic starts blind and the flow field cannot run at all. Three prizes have to be collected: one at the foot of a charging shaft behind an oily gantry, one in the loading hall, and one at the top of a switchback tower that a teleporter skips. BFS pays for oil, A* walks the tower because the ruler never sees the pad, and Dijkstra settles the hall before the shaft pays off. Only Bellman-Ford comes out with the true cheapest haul, 35 against 59 or worse.'
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MAPS: MAPS };
}
