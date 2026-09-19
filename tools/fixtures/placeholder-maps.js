/* tools/fixtures/placeholder-maps.js - stand-in maps, for verification only.
 *
 * THE MAP LANE OWNS `maps.js`. This file is not it, is never loaded by the
 * game, and must be deleted the day `maps.js` lands at the repo root.
 *
 * It exists so `tools/verify-campaign.js` can prove the campaign rules,
 * economy and pars actually run before the real maps exist. Every map here
 * satisfies the map contract in docs/design/CAMPAIGN.md - id, zone, tier,
 * ascii in engine glyphs, notes - and nothing else about it is designed: the
 * shapes are the crudest thing that carries the trap the zone is about.
 *
 * Glyphs are the engine's, from README.md: # wall, . plate floor, ~ oil,
 * v power cell (one-way, pays charge back), 0-9 teleporter pads, S the
 * dispatcher's start, G a prize (a delivery).
 */

var PLACEHOLDER_MAPS = [
  {
    id: 'receiving-1',
    zone: 'receiving',
    tier: 1,
    notes: 'Open bay. Nothing to trip over: the floodlight is the whole answer.',
    ascii: [
      'S.......................',
      '........................',
      '....####....####........',
      '....####....####........',
      '........................',
      '........................',
      '....####....####........',
      '....####....####....G...',
      '........................',
      '...G....................',
      '........................',
      '........................'
    ].join('\n')
  },
  {
    id: 'receiving-2',
    zone: 'receiving',
    tier: 1,
    notes: 'Shelving comb: eleven aisles off one spine, so a sweep holds every aisle at once.',
    ascii: [
      'S.......................',
      '.######################.',
      '........................',
      '.######################.',
      '.....................G..',
      '.######################.',
      '........................',
      '.######################.',
      '..G.....................',
      '.######################.',
      '........................',
      '.######################.',
      '........................'
    ].join('\n')
  },
  {
    id: 'receiving-3',
    zone: 'receiving',
    tier: 1,
    notes: 'First oil map. Two spill bands across the floor, and a dry way round both.',
    ascii: [
      'S.......................',
      '........................',
      '~~~~~~~~~~~~~~~~~.......',
      '~~~~~~~~~~~~~~~~~.......',
      '........................',
      '........................',
      '.......~~~~~~~~~~~~~~~~~',
      '.......~~~~~~~~~~~~~~~~~',
      '........................',
      '..G.....................',
      '........................',
      '...................G....'
    ].join('\n')
  },
  {
    id: 'oil-line-1',
    zone: 'oil-line',
    tier: 2,
    notes: 'Long weighted floor with both prizes in plain sight - the map the homing beam is for.',
    ascii: [
      'S...........~~~~~.......',
      '............~~~~~.......',
      '..~~~~......~~~~~.......',
      '..~~~~..................',
      '..~~~~..................',
      '............~~~~~~~~....',
      '........................',
      '......~~~~~.............',
      '......~~~~~.......~~~~..',
      '......~~~~~.......~~~~..',
      '..G.....................',
      '.....................G..'
    ].join('\n')
  },
  {
    id: 'oil-line-2',
    zone: 'oil-line',
    tier: 2,
    notes: 'Three prizes, wide aisles, thieves already moving: good enough beats perfect.',
    ascii: [
      'S.......................',
      '...####.......####......',
      '...####.......####......',
      '........................',
      '.....~~~~~~~~~~~........',
      '.....~~~~~~~~~~~........',
      '...............G........',
      '...####.......####......',
      '...####.......####......',
      '..G.....................',
      '........................',
      '.................G......'
    ].join('\n')
  },
  {
    id: 'oil-line-3',
    zone: 'oil-line',
    tier: 2,
    notes: 'A deep spill you can wade or walk around: the dial decides how much the guess is trusted.',
    ascii: [
      'S.......................',
      '..#################.....',
      '..~~~~~~~~~~~~~~~~~.....',
      '..~~~~~~~~~~~~~~~~~.....',
      '..~~~~~~~~~~~~~~~~~.....',
      '..#################.....',
      '........................',
      '...G....................',
      '........................',
      '.........G..............',
      '........................',
      '.....................G..'
    ].join('\n')
  },
  {
    id: 'long-halls-1',
    zone: 'long-halls',
    tier: 3,
    notes: 'One long hall between two known ends - two small searches beat one big one.',
    ascii: [
      'S.......................',
      '.######################.',
      '.######################.',
      '........................',
      '.######################.',
      '.######################.',
      '..................G.....',
      '.######################.',
      '........................',
      '....G...................',
      '.######################.',
      '.......G................'
    ].join('\n')
  },
  {
    id: 'long-halls-2',
    zone: 'long-halls',
    tier: 3,
    notes: 'Branchy relay with the prizes unlisted: shortest answers on a stack-sized memory.',
    ascii: [
      'S.......................',
      '.#####.#####.#####.####.',
      '.....#.....#.....#......',
      '.###.#.###.#.###.#.####.',
      '.#...#...#...#...#.....G',
      '.#.#####.#####.#####.##.',
      '...#...............#....',
      '.###.#####.#####.#.#.##.',
      '.....#...#.....#.#.#....',
      '.#####.#.####..#.#.####.',
      '..G....#......G#........',
      '.######################.'
    ].join('\n')
  },
  {
    id: 'long-halls-3',
    zone: 'long-halls',
    tier: 3,
    notes: 'The widest floor in the factory. Memory is rationed, so the light has to stay narrow.',
    ascii: [
      'S.......................',
      '........................',
      '........................',
      '........#####...........',
      '........#####...........',
      '........#####..........G',
      '........................',
      '........................',
      '...G....................',
      '........................',
      '..............G.........',
      '........................'
    ].join('\n')
  },
  {
    id: 'power-row-1',
    zone: 'power-row',
    tier: 4,
    notes: 'First power-cell map: the chutes pay charge back, so a route can get cheaper after it looked finished.',
    ascii: [
      'S.~~~~~.################',
      '.######v#...............',
      '.######v#...............',
      '.######v#...............',
      '.######v#..........G....',
      '.######v#...............',
      '.######v#...............',
      '........................',
      '........................',
      '..G.....................',
      '........................',
      '..........G.............'
    ].join('\n')
  },
  {
    id: 'power-row-2',
    zone: 'power-row',
    tier: 4,
    notes: 'First multi-chest floor: one field built backwards answers every lockbox at once.',
    ascii: [
      '#######################',
      '#S....#.......#.......#',
      '#.###.#.#####.#.#####.#',
      '#.#...#.....#.#.....#.#',
      '#.#.#######.#.#####.#.#',
      '#...#.....#.#.....#...#',
      '###.#.###.#.#####.#.###',
      '#...#.#G#.#.....#.#...#',
      '#.###.#.#.#####.#.###.#',
      '#.....#.#.....#.#....G#',
      '#.#####.#####.#.#####.#',
      '#G....................#',
      '#######################'
    ].join('\n')
  },
  {
    id: 'power-row-3',
    zone: 'power-row',
    tier: 4,
    notes: 'The racks: one simply connected maze, where a hand on the wall is enough.',
    ascii: [
      '#######################',
      '#S#.....#.#.......#..G#',
      '#.###.#.#.#.###.#.###.#',
      '#...#.#...#.#.#.#.....#',
      '###.#.#####.#.#.#####.#',
      '#...#.#.......#.#...#.#',
      '#.###.#.#####.#.#.#.#.#',
      '#.#.....#...#.#.#.#.#.#',
      '#.#.#####.#.###.#.#.#.#',
      '#.#.#.....#.....#.#...#',
      '#.###.###########.#####',
      '#G....#..............G#',
      '#######################'
    ].join('\n')
  },
  {
    id: 'vault-1',
    zone: 'vault',
    tier: 5,
    notes: 'Vault approach: a pair of chutes makes the ruler lie, and the oil makes the lie expensive.',
    ascii: [
      '.......#######..........',
      '1~~~~~S.................',
      '.......#######..........',
      '........................',
      '.....~~~~~~~~~~~~~......',
      '.....~~~~~~~~~~~~~......',
      '........................',
      '..........########......',
      '..........########..G...',
      '........................',
      '...........~~~~~~~~~~~..',
      '..G.........1..........G'
    ].join('\n')
  },
  {
    id: 'vault-2',
    zone: 'vault',
    tier: 5,
    notes: 'Everything the factory has, on one floor: oil, a power cell, racks and a teleporter.',
    ascii: [
      'S......#........#.......',
      '.####..#..####..#..####.',
      '....#..#.....#..#.....#.',
      '.##.#..#####.#..####..#.',
      '.#..#......#.#.....#..#.',
      '.#.~~~~~~~.#.#####.#..#.',
      '.#.~~~~~~~.......#.#..1.',
      '.#.~~~~~~~.#####.#.#..#.',
      '.#.........#..G#.#.#..#.',
      '.#####v#####..#..#.####.',
      '..G...........#......1.G',
      '........................'
    ].join('\n')
  },
  {
    id: 'vault-3',
    zone: 'vault',
    tier: 5,
    notes: 'The strongroom. Three prizes, the longest haul in the game, and nowhere cheap to stand.',
    ascii: [
      'S...~~~~~~~..#..........',
      '....~~~~~~~..#..#####...',
      '.............#......#...',
      '.#########...#.####.#...',
      '.#.......#...#.#..#.#...',
      '.#.#####.#####.#..#.#..G',
      '.#.#...#.......#..#.#...',
      '.#.#.#.#########..#.#...',
      '...#.#............#.....',
      '.###.#####v########.###.',
      '..G..........~~~~~~....G',
      '........................'
    ].join('\n')
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MAPS: PLACEHOLDER_MAPS, PLACEHOLDER_MAPS: PLACEHOLDER_MAPS };
}
