/* tests/maps.js - small fixture maps for the search tests.
 *
 * Deliberately separate from levels.js: level maps are tuned for teaching and
 * another lane owns them, so the algorithm tests need maps that will not move
 * under them. Weighted maps use '~' (cost 5) so the cheapest route and the
 * shortest route disagree.
 */

var MAPS = {
  // --- unweighted ---
  openField: {
    name: 'open field (unweighted)',
    weighted: false,
    ascii: [
      'S.......',
      '........',
      '........',
      '........',
      '.......G'
    ].join('\n')
  },
  walls: {
    name: 'wall maze (unweighted)',
    weighted: false,
    ascii: [
      'S....#......',
      '####.#.####.',
      '.....#.#....',
      '.#####.#.###',
      '.......#...G',
      '.#########..',
      '............'
    ].join('\n')
  },
  corridor: {
    name: 'single corridor (unweighted)',
    weighted: false,
    ascii: [
      'S..........',
      '##########.',
      '..........G'
    ].join('\n')
  },
  tiny: {
    name: 'tiny 2x2 (unweighted)',
    weighted: false,
    ascii: [
      'S.',
      '.G'
    ].join('\n')
  },

  // --- weighted ---
  swampBand: {
    name: 'swamp band (weighted)',
    weighted: true,
    ascii: [
      'S.........',
      '..........',
      '~~~~~~~~..',
      '~~~~~~~~..',
      '..........',
      '.......G..'
    ].join('\n')
  },
  swampPocket: {
    name: 'swamp pocket (weighted)',
    weighted: true,
    ascii: [
      'S~~~~~~~~.',
      '.~~~~~~~~.',
      '.~~~~~~~~.',
      '.........G'
    ].join('\n')
  },
  weightedWalls: {
    name: 'weighted maze (weighted)',
    weighted: true,
    ascii: [
      'S~~~~#.....',
      '.~~~~#.~~~.',
      '.~~~~..~~~.',
      '.####..~~~.',
      '.......~~~G'
    ].join('\n')
  }
};

// Two arms meet at the bottom-left corner and share one long tail to the goal.
// The right-hand arm runs toward the goal the whole way, so greedy best-first
// walks it first and claims the corner through it; the left-hand arm is nine
// steps shorter but starts by moving away, so greedy never parents through it.
// Verified against both tie-break policies: greedy 45 steps, optimal 35.
var GREEDY_TRAP = [
  '.S.....########',
  '.#####.########',
  '.#####.########',
  '.#####.########',
  '.#####.#####G..',
  '.#####.#######.',
  '.#####.#######.',
  '.#####.#######.',
  '.......#######.',
  '.#############.',
  '.#############.',
  '...............'
].join('\n');

// Goal walled off entirely: nothing can reach it.
var UNREACHABLE = [
  'S....#....',
  '.....#....',
  '.....#..G.',
  '.....#....'
].join('\n');

var UNWEIGHTED = ['openField', 'walls', 'corridor', 'tiny'].map(function (k) { return MAPS[k]; });
var WEIGHTED = ['swampBand', 'swampPocket', 'weightedWalls'].map(function (k) { return MAPS[k]; });
var ALL = UNWEIGHTED.concat(WEIGHTED);

module.exports = {
  MAPS: MAPS,
  UNWEIGHTED: UNWEIGHTED,
  WEIGHTED: WEIGHTED,
  ALL: ALL,
  GREEDY_TRAP: GREEDY_TRAP,
  UNREACHABLE: UNREACHABLE
};
