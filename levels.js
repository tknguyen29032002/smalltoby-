/* levels.js - the five maps, their objective and their budgets.
 *
 *   #  wall
 *   .  grass, cost 1
 *   ~  swamp, cost 5
 *   S  start
 *   G  goal
 *
 * objective: 'shortest' (fewest steps) | 'cheapest' (lowest terrain cost) | 'any'
 * budgets:   expansions (nodes taken off the frontier) and/or frontier (peak size)
 *
 * The budgets are tuned so the algorithm the level is about earns three stars.
 * tools/verify-levels.js checks that; run it after touching anything here.
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
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LEVELS: LEVELS };
}
