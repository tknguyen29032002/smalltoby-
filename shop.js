/* shop.js - Factory Heist: what gold buys.
 *
 * Data only, plus the one rule that decides what is on the shelf. It
 * publishes exactly one name, `Shop`, and needs campaign.js loaded first in
 * the browser (under node it requires it).
 *
 * Two shelves:
 *
 *   POWERS  every power is an engine strategy and unlocks for free on its
 *           level (campaign.js). The shop sells exactly one of them early:
 *           the next power on the ladder, one level before it would arrive,
 *           and only once per campaign. Buying it skips a wait, never a
 *           lesson - the level that teaches it still has to be played.
 *
 *   BOOSTS  one-shot helps, bought between levels and carried into the next
 *           one. None of them moves the cart, picks a route or names a power.
 *           Using any boost except recharge caps that level at two stars
 *           (`capsStars`), and recharge cannot help a third star anyway:
 *           stars count charge spent, and a recharge adds charge without
 *           un-spending any.
 *
 * Numbers and the reasoning behind them: docs/design/CAMPAIGN.md.
 */

var Shop = (function () {
  'use strict';

  var C = (typeof module !== 'undefined' && module.exports) ? require('./campaign.js') : Campaign;

  /* Early-unlock price by the tier of the level the power belongs to. */
  var EARLY_UNLOCK_PRICE = { 1: 30, 2: 45, 3: 60, 4: 80, 5: 100 };
  var EARLY_UNLOCKS_PER_CAMPAIGN = 1;

  /*   id           referenced by encounters' shopUnlocks.
   *   price        gold.
   *   perLevel     how many can be carried into one level.
   *   cooldown     ticks between two uses inside a level (only matters when
   *                perLevel > 1).
   *   capsStars    the most stars a level can earn once this is used, or
   *                null when it cannot change the stars at all.
   *   effect       what heist.js applies. Only these fields are allowed.
   */
  var BOOSTS = [
    {
      id: 'recharge', name: 'Recharge', price: 15, perLevel: 2, cooldown: 10, capsStars: null,
      effect: { charge: 40 },
      does: 'Forty charge back into the meter. Saves a run; cannot buy a star, because stars count what you spent.'
    },
    {
      id: 'freeze', name: 'Freeze', price: 20, perLevel: 1, cooldown: 0, capsStars: 2,
      effect: { freezeTicks: 1 },
      does: 'Every thief skips its next move. One tick to get out of a bad spot.'
    },
    {
      id: 'reveal', name: 'Flare', price: 25, perLevel: 1, cooldown: 0, capsStars: 2,
      effect: { revealRadius: 4 },
      does: 'Lights the floor four cells round the cart. Only matters in the dark.'
    },
    {
      id: 'extra-swap', name: 'Spare coupling', price: 25, perLevel: 1, cooldown: 0, capsStars: 2,
      effect: { swapCap: 1 },
      does: 'One more power change than the level allows.'
    }
  ];

  var BOOST_BY_ID = {};
  BOOSTS.forEach(function (b) { BOOST_BY_ID[b.id] = b; });

  /* The fields an effect may carry. Anything that would move the cart or
   * choose for the player is not on this list, and the verifier holds it. */
  var ALLOWED_EFFECTS = ['charge', 'freezeTicks', 'revealRadius', 'swapCap'];

  /* The power shelf, derived from the ladder so it cannot drift from it. */
  function powers() {
    return C.unlockOrder().map(function (u) {
      var tier = C.encounter(u.level).tier;
      return { id: u.power, unlockLevel: u.level, earlyAt: u.level - 1, earlyPrice: EARLY_UNLOCK_PRICE[tier] };
    });
  }

  /* Boosts buyable before `level`: everything a cleared level unlocked. */
  function boostsBefore(level) {
    var ids = [];
    C.ENCOUNTERS.forEach(function (e) {
      if (e.level < level) { e.shopUnlocks.forEach(function (id) { ids.push(id); }); }
    });
    return ids.map(function (id) { return BOOST_BY_ID[id]; });
  }

  /* What the shelf shows between levels, given the player's save:
   *   save = { gold, earlyUnlocked: [powerId] }
   * `nextLevel` is the level about to be played. */
  function shelf(nextLevel, save) {
    var early = null;
    var used = (save.earlyUnlocked || []).length;
    if (used < EARLY_UNLOCKS_PER_CAMPAIGN) {
      var next = powers().filter(function (p) { return p.unlockLevel === nextLevel + 1; })[0];
      if (next && nextLevel >= 1) { early = next; }
    }
    return {
      power: early,
      boosts: boostsBefore(nextLevel),
      gold: save.gold
    };
  }

  /* The powers a player holds on a level, early unlock included. */
  function powersFor(level, save) {
    var held = C.powersAt(level);
    (save.earlyUnlocked || []).forEach(function (id) {
      var p = powers().filter(function (x) { return x.id === id; })[0];
      if (p && p.earlyAt <= level && held.indexOf(id) < 0) { held.push(id); }
    });
    return held;
  }

  var api = {
    BOOSTS: BOOSTS,
    BOOST_BY_ID: BOOST_BY_ID,
    ALLOWED_EFFECTS: ALLOWED_EFFECTS,
    EARLY_UNLOCK_PRICE: EARLY_UNLOCK_PRICE,
    EARLY_UNLOCKS_PER_CAMPAIGN: EARLY_UNLOCKS_PER_CAMPAIGN,
    powers: powers,
    boostsBefore: boostsBefore,
    shelf: shelf,
    powersFor: powersFor
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  return api;
})();
