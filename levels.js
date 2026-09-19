/* levels.js - the maps, their objective and their budgets.
 *
 *   #    wall
 *   .    grass, cost 1
 *   ~    swamp, cost 5
 *   v    refund chute, cost -4, one-way downward (enter from above, leave below)
 *   0-9  teleport pads: cells sharing a digit are one move apart, cost 1
 *   A-F  waypoints, visited in letter order when the level uses legs
 *   S    start
 *   G    goal (a map may hold several)
 *
 * objective: 'shortest' (fewest steps) | 'cheapest' (lowest terrain cost) |
 *            'any' (just arrive) | 'collect' (stand on every G) |
 *            'nearest' (reach the closest G) | 'unknown' (arrive with the goal
 *            position hidden, so no heuristic is available)
 * budgets:   expansions (nodes taken off the frontier) and/or frontier (peak size)
 *
 * The budgets are tuned so the algorithm the level is about earns three stars.
 * tools/verify-levels.js checks that; run it after touching anything here.
 * README.md has the full map format and the engine contract.
 */

var LEVELS = [
  {
    name: 'Open field',
    objective: 'shortest',
    brief: 'No walls, no swamp, goal in plain sight. Every algorithm gets there - run all four and watch the shape each one draws.',
    budgets: { expansions: 120, frontier: 30 },
    map: [
      'S...........',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '...........G'
    ].join('\n')
  },
  {
    name: 'The switchbacks',
    objective: 'shortest',
    brief: 'Two ways down: a short one and a very long one. The objective is fewest steps, so merely arriving is not enough.',
    budgets: { expansions: 140, frontier: 30 },
    map: [
      'S..............',
      '.#############.',
      '.#.............',
      '.#.############',
      '.#.............',
      '.#############.',
      '.#.............',
      '.#.############',
      '.#.............',
      '.#############.',
      '..............G'
    ].join('\n')
  },
  {
    name: 'The swamp',
    objective: 'cheapest',
    brief: 'Swamp costs 5 a tile, grass costs 1. The objective is the cheapest route now, and the cheapest route is not the shortest one.',
    budgets: { expansions: 170, frontier: 40 },
    map: [
      'S..............',
      '...............',
      '...............',
      '~~~~~~~~~~~~~..',
      '~~~~~~~~~~~~~..',
      '~~~~~~~~~~~~~..',
      '...............',
      '...............',
      '...............',
      '...............',
      '..........G....'
    ].join('\n')
  },
  {
    name: 'The long haul',
    objective: 'cheapest',
    brief: 'A big weighted map, the goal far away in the corner, and only so much fuel. Who can afford to look everywhere?',
    budgets: { expansions: 200, frontier: 90 },
    map: [
      'S............~~~~~...............',
      '.............~~~~~...............',
      '..~~~~.......~~~~~...............',
      '..~~~~.......~~~~~...............',
      '..~~~~.......~~~~~...............',
      '..~~~~...........................',
      '..~~~~...........................',
      '.............~~~~~~~~~~..........',
      '.............~~~~~~~~~~..........',
      '.................................',
      '.......~~~~~~....................',
      '.......~~~~~~....................',
      '.......~~~~~~..........~~~~~~....',
      '.......~~~~~~..........~~~~~~....',
      '.......................~~~~~~....',
      '.................................',
      '............~~~~~~~~~............',
      '............~~~~~~~~~...........G'
    ].join('\n')
  },
  {
    name: 'The comb',
    objective: 'any',
    brief: 'Nine corridors hang off one spine and only one of them holds the goal. Just reach it - but memory is scarce, and the frontier is where a search keeps the branches it has not finished.',
    budgets: { frontier: 6 },
    map: [
      'S.............................',
      '.#############################',
      '..............................',
      '.#############################',
      '..............................',
      '.#############################',
      '..............................',
      '.#############################',
      '.............................G',
      '.#############################',
      '..............................',
      '.#############################',
      '..............................',
      '.#############################',
      '..............................',
      '.#############################',
      '..............................'
    ].join('\n')
  },
  {
    name: 'The heuristic that lies',
    objective: 'cheapest',
    brief: 'Those two pads marked 1 are one step apart, however far apart they look. A* still measures the map with a ruler, so its guess is not just wrong, it is confidently wrong.',
    budgets: { expansions: 120, frontier: 40 },
    map: [
      '.......#######................',
      '1~~~~~S.......................',
      '.......#######................',
      '..............................',
      '.....~~~~~~~~~~~~~~~..........',
      '.....~~~~~~~~~~~~~~~..........',
      '..............................',
      '..........########............',
      '..........########............',
      '..............................',
      '...........~~~~~~~~~~~~~......',
      '...........~~~~~~~~~~~~~......',
      '............................1G'
    ].join('\n')
  }
];

/* Levels that need a strategy, or a mechanic, the buttons do not offer yet.
 * They are authored, tuned and checked by tools/verify-levels.js exactly like
 * the shipped ones - move an entry into LEVELS above the moment the UI can
 * play it. `needs` says what that is. */
var EXTRA_LEVELS = [
  {
    name: 'The refund run',
    objective: 'cheapest',
    needs: 'bellman',
    brief: 'Those chutes pay you four fuel back to ride, one way, downhill - and they sit on the far side of a swamp. A route can get cheaper after it looked finished, and an algorithm that files a cell away the moment it reaches it will never find out.',
    budgets: { expansions: 400, frontier: 30 },
    map: [
      'S.~~~~~.##############',
      '.######v#.............',
      '.######v#.............',
      '.######v#.............',
      '.######v#.............',
      '.######v#.............',
      '.######v#.............',
      '.######v#.............',
      '......................',
      '......................',
      '......................',
      '......................',
      '......................',
      '..G...................'
    ].join('\n')
  },
  {
    name: 'Lights out',
    objective: 'shortest',
    goalKnown: false,
    needs: 'iddfs',
    brief: 'Fewest steps, nobody will tell you where the goal is, and there is room for four cells in memory. Every algorithm that steers by a guess is out. BFS knows the answer and cannot hold the search; DFS travels light and answers wrong.',
    budgets: { frontier: 4 },
    map: [
      'S.............................',
      '.############################.',
      '..............................',
      '.#############################',
      '..............................',
      '.############################.',
      '..............................',
      '.#############################',
      '....................G.........',
      '.############################.',
      '..............................',
      '.#############################',
      '..............................',
      '.############################.',
      '..............................',
      '.#############################',
      '..............................'
    ].join('\n')
  },
  {
    name: 'The scattered depots',
    objective: 'collect',
    needs: 'multi-goal',
    brief: 'Six depots, one van, and a maze that makes a straight-line guess worthless. One search can watch all six at once. An algorithm that can only aim at one address has to start again for every depot left.',
    budgets: { expansions: 400, frontier: 20 },
    map: [
      '#######################',
      '#G.........G#........G#',
      '###########.#######.#.#',
      '#...#.....#.#...#...#.#',
      '###.#.###.#.#.#.#.###.#',
      '#...#...#.#S#.#...#.#.#',
      '#.#.###.#.#.#.#####.#.#',
      '#.#...#.#.#.#...#.#...#',
      '#.###.#.#.#.###.#.#.###',
      '#...#.#.#.#.....#...#.#',
      '#.#.###.#.#######.###.#',
      '#G#.....#..G.........G#',
      '#######################'
    ].join('\n')
  },
  {
    name: 'Six vans, one depot',
    objective: 'dispatch',
    needs: 'multi-start',
    brief: 'Six vans, all heading for the same depot. Search once from the depot outward and the map itself tells every van where to turn - and the sixth van costs nothing at all.',
    budgets: { expansions: 200, frontier: 20 },
    map: [
      '#######################',
      '#S.........S#........S#',
      '###########.#######.#.#',
      '#...#.....#.#...#...#.#',
      '###.#.###.#.#.#.#.###.#',
      '#...#...#.#G#.#...#.#.#',
      '#.#.###.#.#.#.#####.#.#',
      '#.#...#.#.#.#...#.#...#',
      '#.###.#.#.#.###.#.#.###',
      '#...#.#.#.#.....#...#.#',
      '#.#.###.#.#######.###.#',
      '#S#.....#..S.........S#',
      '#######################'
    ].join('\n')
  },
  {
    name: 'Hands on the wall',
    objective: 'any',
    needs: 'wall',
    brief: 'No frontier, no visited set, no map in your head: one hand on the left wall, and walk. In a maze where every wall is joined up, that is enough - and it is the only thing here that fits in the memory you have.',
    budgets: { frontier: 1 },
    map: [
      '###################',
      '#S..#.......#.....#',
      '###.#.#####.#####.#',
      '#.#.#.#...#.#.....#',
      '#.#.#.###.#.#.###.#',
      '#...#...#.#.#.#.#.#',
      '#.###.#.#.#.#.#.#.#',
      '#.#...#.#.#...#.#.#',
      '#.#####.#.#####.#.#',
      '#.......#........G#',
      '###################'
    ].join('\n')
  },
  {
    name: 'The relay',
    objective: 'cheapest',
    needs: 'legs',
    bestPlan: ['dijkstra', 'astar'],
    brief: 'Two legs, and you hire a courier for each. The first leg has a pair of teleport pads in it, so a courier who trusts the ruler will be confidently wrong. The second is a long clear run, where a courier who has no idea where the goal is will burn the whole budget.',
    budgets: { expansions: 200, frontier: 60 },
    map: [
      '.......#######................####################',
      '1~~~~~S.......................#..................G',
      '.......#######................#...................',
      '..............................#...................',
      '.....~~~~~~~~~~~~~~~..........#...................',
      '.....~~~~~~~~~~~~~~~..........#...................',
      '..............................#...................',
      '..........########............#...................',
      '..........########............#...................',
      '..............................#...................',
      '...........~~~~~~~~~~~~~......#...................',
      '...........~~~~~~~~~~~~~......#...................',
      '............................1A....................'
    ].join('\n')
  },
  {
    name: 'Into the fog',
    objective: 'cheapest',
    fog: true,
    swapPenalty: 5,
    needs: 'fog + hot swap',
    brief: 'You can see where you have been and one step around it, nothing else - so there is nothing for a heuristic to measure yet. Send a scout out blind to find the goal, then swap, and let the guess clean up the route it left behind.',
    budgets: { expansions: 140 },
    map: [
      'S.....~~~~~..........####.......',
      '......~~~~~.............#.......',
      '..##..~~~~~..######.....#.......',
      '..##.............#......#.......',
      '..##..######.....#..~~~~~~~~....',
      '......#..........#..~~~~~~~~....',
      '......#...####...#..............',
      '~~~~..#...####...........####...',
      '~~~~..#...####...#..#....####...',
      '~~~~......#......#..#...........',
      '......#####......#..#...~~~~~~~.',
      '......#..........#..#...~~~~~~~.',
      '..#####..~~~~~...#..#...........',
      '..#......~~~~~...#......###.....',
      '..#..........................#..',
      '..#..#####...####...####.....#..',
      '.....#...........#..............',
      '.....#....~~~~~..#...........#G.'
    ].join('\n')
  }
];

var ALL_LEVELS = LEVELS.concat(EXTRA_LEVELS);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LEVELS: LEVELS, EXTRA_LEVELS: EXTRA_LEVELS, ALL_LEVELS: ALL_LEVELS };
}
