/* heist-render.js - the rotating factory board.
 *
 * One full-window canvas, a camera you can pan, zoom and TURN in 90-degree
 * steps, and the sprite kit from sprites.js painted onto it. Publishes one
 * name, HeistBoard, and reads nothing but the state heist.js hands it.
 *
 * Rotation works because the grid is rotated before it is projected: a cell
 * is turned about the middle of the map by the board angle and only then
 * flattened to isometric. The angle is animated, so a turn is a swing rather
 * than a cut, and each sprite is drawn at the nearest quarter turn, which is
 * exactly what the kit was authored for.
 *
 * Readability is the rule this file is written to, in this order:
 *   1. the walkable floor is the quietest thing on the board;
 *   2. walls are mostly one plain block, decorated one cell in three;
 *   3. the player, the deliveries, the robots and the found path are the only
 *      things allowed to be bright, and all four are drawn last, over the top
 *      of the world, so no crate can ever hide them.
 *
 *   HeistBoard.create(canvas)            -> board
 *   board.fit(state, w, h, insets)       frame the floor
 *   board.turn(+1|-1)                    animate a 90-degree step
 *   board.draw(state, overlay)           paint one frame
 *   board.cellAt(sx, sy, state)          screen point -> cell
 *   board.follow(state, w, h)            keep the cart on screen
 */

var HeistBoard = (function () {
  'use strict';

  var TILE_W = 32;
  var TILE_H = 16;
  var HALF_PI = Math.PI / 2;

  var INK = {
    floorWay: 'rgba(16, 20, 27, 0.12)',      // the quiet darker strip along a corridor
    wallQuiet: 'rgba(14, 17, 24, 0.52)',     // the plain wall, pushed well back
    wallDim: 'rgba(14, 17, 24, 0.28)',       // a decorated wall, pushed back a little
    fog: '#10141c',
    fogEdge: 'rgba(8, 10, 14, 0.55)',
    explored: 'rgba(47, 111, 176, 0.30)',
    exploredBust: 'rgba(224, 69, 46, 0.34)',
    frontier: 'rgba(255, 194, 31, 0.40)',
    frontierEdge: 'rgba(255, 194, 31, 0.95)',
    path: '#ff7a29',
    pathDark: '#b84a15',
    pathGlow: 'rgba(255, 122, 41, 0.35)',
    player: '#ffc21f',
    playerGlow: 'rgba(255, 194, 31, 0.30)',
    delivery: '#ff3b30',
    deliveryDone: '#4ff0c5',
    thief: '#e0452e',
    aim: 'rgba(255, 255, 255, 0.85)'
  };

  // Most walls are the plain crate. One cell in three gets a variant, chosen
  // from the cell's own coordinates so a floor looks the same every visit.
  var WALL_PLAIN = 'wall_crate';
  var WALL_SINK = 10;     // of the kit's 20px wall, see sinkTile
  var WALL_VARIANTS = [
    'wall_crate_stack', 'wall_shelf_rack', 'wall_machine',
    'wall_pipe_run', 'wall_barrels', 'wall_conveyor', 'wall_cabinet'
  ];

  function hash(x, y) {
    var h = (x * 73856093) ^ (y * 19349663);
    h = (h ^ (h >>> 13)) >>> 0;
    return h;
  }

  function wallSprite(grid, x, y) {
    var h = hash(x, y);
    if (h % 3 !== 0) { return WALL_PLAIN; }
    return WALL_VARIANTS[(h >>> 4) % WALL_VARIANTS.length];
  }

  /* ---------------------------------------------------------------- board ---*/

  function create(canvas) {
    var board = {
      canvas: canvas,
      ctx: canvas.getContext('2d'),
      cam: { x: 0, y: 0, scale: 1.8 },
      rot: 0,
      angle: 0,
      spin: null,
      cache: {},
      cacheKeyScale: 0,
      time: 0,
      // Screen bands the page's HUD covers; the edge arrows treat them as
      // off screen, since a delivery under the power bar is as lost as one
      // past the edge.
      covered: { top: 0, bottom: 0 }
    };
    board.fit = function (state, w, h, insets, overview) { return fit(board, state, w, h, insets, overview); };
    board.turn = function (dir) { return turn(board, dir); };
    board.draw = function (state, overlay) { return draw(board, state, overlay); };
    board.cellAt = function (sx, sy, state) { return cellAt(board, sx, sy, state); };
    board.follow = function (state, w, h, insets, snap) { return follow(board, state, w, h, insets, snap); };
    board.animating = function () { return !!board.spin; };
    board.project = function (state, x, y, z) { return project(board, state.grid, x, y, z); };
    board.screenOf = function (state, x, y, z) { return screenOf(board, state.grid, x, y, z); };
    return board;
  }

  /* ------------------------------------------------------------ geometry ---*/

  function rotated(grid, x, y, angle) {
    var cx = x - (grid.w - 1) / 2;
    var cy = y - (grid.h - 1) / 2;
    var c = Math.cos(angle);
    var s = Math.sin(angle);
    return { x: cx * c - cy * s, y: cx * s + cy * c };
  }

  // World point (pre-camera) of a cell's north corner, z pixels above the deck.
  function project(board, grid, x, y, z) {
    var r = rotated(grid, x, y, board.angle);
    return {
      x: (r.x - r.y) * TILE_W / 2,
      y: (r.x + r.y) * TILE_H / 2 - (z || 0),
      depth: r.x + r.y
    };
  }

  function screenOf(board, grid, x, y, z) {
    var p = project(board, grid, x, y, z);
    return {
      x: p.x * board.cam.scale + board.cam.x,
      y: p.y * board.cam.scale + board.cam.y,
      depth: p.depth
    };
  }

  function cellAt(board, sx, sy, state) {
    var grid = state.grid;
    var wx = (sx - board.cam.x) / board.cam.scale;
    var wy = (sy - board.cam.y) / board.cam.scale;
    // Undo the isometric flatten, then the board turn.
    // A tile spans one unit south-east of its north corner in the turned
    // frame, so its centre is half a unit in; round from there.
    var rx = (wx / (TILE_W / 2) + wy / (TILE_H / 2)) / 2 - 0.5;
    var ry = (wy / (TILE_H / 2) - wx / (TILE_W / 2)) / 2 - 0.5;
    var c = Math.cos(-board.angle);
    var s = Math.sin(-board.angle);
    var x = Math.round(rx * c - ry * s + (grid.w - 1) / 2);
    var y = Math.round(rx * s + ry * c + (grid.h - 1) / 2);
    if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) { return null; }
    return { x: x, y: y };
  }

  // Two framings. The overview fits the whole floor between the HUD bands;
  // the play framing is 1.6x that (at least 2.2), so a tile reads at 1.5-2x
  // the old board and the camera follows the cart across a floor that is
  // bigger than the screen.
  function fit(board, state, viewW, viewH, insets, overview) {
    insets = insets || {};
    var grid = state.grid;
    var top = insets.top || 0;
    var bottom = insets.bottom || 0;
    var span = (grid.w + grid.h);
    var availW = viewW - 60;
    var availH = viewH - top - bottom - 40;
    var whole = Math.min(availW / (span * TILE_W / 2), availH / (span * TILE_H / 2 + 40));
    board.cam.scale = overview ? Math.max(0.6, whole) : Math.max(2.2, Math.min(3.2, whole * 1.6));
    // Centre the middle of the map, which the turn keeps at the origin.
    board.cam.x = viewW / 2;
    board.cam.y = top + (viewH - top - bottom) / 2 - TILE_H / 2 * board.cam.scale;
    return board;
  }

  function follow(board, state, viewW, viewH, insets, snap) {
    insets = insets || {};
    var p = screenOf(board, state.grid, state.player.x, state.player.y, 0);
    var marginX = viewW * 0.28;
    var bottom = viewH - (insets.bottom || 0) - viewH * 0.12;
    // The pointer floats about 40 tile units over the cart; keep all of it
    // below the readouts, or it sits under the legend text.
    var top = Math.min(bottom, Math.max((insets.top || 0) + viewH * 0.12,
      board.covered.top + 40 * board.cam.scale));
    var dx = 0;
    var dy = 0;
    if (p.x < marginX) { dx = marginX - p.x; }
    if (p.x > viewW - marginX) { dx = (viewW - marginX) - p.x; }
    if (p.y < top) { dy = top - p.y; }
    if (p.y > bottom) { dy = bottom - p.y; }
    if (!dx && !dy) { return false; }
    var k = snap ? 1 : 0.22;
    board.cam.x += dx * k;
    board.cam.y += dy * k;
    return true;
  }

  function turn(board, dir) {
    var from = board.angle;
    board.rot = (board.rot + dir + 4) % 4;
    // Always swing the short way round.
    var to = board.rot * HALF_PI;
    while (to - from > Math.PI) { to -= Math.PI * 2; }
    while (from - to > Math.PI) { to += Math.PI * 2; }
    board.spin = { from: from, to: to, t: 0 };
    return board.rot;
  }

  function stepSpin(board, dt) {
    if (!board.spin) { return false; }
    board.spin.t = Math.min(1, board.spin.t + dt / 0.42);
    var e = board.spin.t;
    e = e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2;   // ease in-out
    board.angle = board.spin.from + (board.spin.to - board.spin.from) * e;
    if (board.spin.t >= 1) {
      board.angle = board.rot * HALF_PI;
      board.spin = null;
    }
    return true;
  }

  /* --------------------------------------------------------------- tiles ---*/

  // Every tile the board draws is a cached bitmap: the sprite kit draws
  // polygons, and six hundred of those a frame would not hold 60fps.
  function tile(board, name, rot, extra) {
    // Rendered at device pixels, so a retina screen gets crisp edges rather
    // than a CSS-size bitmap stretched by the canvas transform.
    var dpr = board.canvas._dpr || 1;
    var q = Math.round(board.cam.scale * dpr * 20) / 20;
    if (board.cacheKeyScale !== q) {
      board.cache = {};
      board.cacheKeyScale = q;
    }
    var key = name + '|' + rot + '|' + (extra || '');
    var hit = board.cache[key];
    if (hit) { return hit; }
    var t = Sprites.prerender(name, rot, q);
    if (extra === 'way') { t = tintTile(t, q, INK.floorWay); }
    if (extra === 'quiet' || extra === 'dim') {
      t = sinkTile(t, q, WALL_SINK);
      t = tintTile(t, q, extra === 'quiet' ? INK.wallQuiet : INK.wallDim);
    }
    t = { canvas: t.canvas, ox: t.ox / dpr, oy: t.oy / dpr, w: t.canvas.width / dpr, h: t.canvas.height / dpr };
    board.cache[key] = t;
    return t;
  }

  // A wall sunk into the deck: the model drawn WALL_SINK pixels lower and
  // clipped to its own footprint, so what shows is a shorter block with the
  // same top and the same detail. Full-height walls hide a one-cell corridor
  // for two rows behind them; at half height the way through a rack maze is
  // visible from every turn of the board.
  function sinkTile(src, scale, sink) {
    var c = document.createElement('canvas');
    c.width = src.canvas.width;
    c.height = src.canvas.height;
    var g = c.getContext('2d');
    var nx = -src.ox;                 // the tile's north corner, in this bitmap
    var ny = -src.oy;
    var w = TILE_W / 2 * scale;
    var hh = TILE_H / 2 * scale;
    g.beginPath();
    g.moveTo(nx - w, 0);
    g.lineTo(nx + w, 0);
    g.lineTo(nx + w, ny + hh);
    g.lineTo(nx, ny + hh * 2);
    g.lineTo(nx - w, ny + hh);
    g.closePath();
    g.clip();
    g.drawImage(src.canvas, 0, sink * scale);
    return { canvas: c, ox: src.ox, oy: src.oy };
  }

  // A corridor tile is the same plate with a quiet wash over it: the walkable
  // way reads as a way without adding a single new shape to the board.
  function tintTile(src, scale, colour) {
    var c = document.createElement('canvas');
    c.width = src.canvas.width;
    c.height = src.canvas.height;
    var g = c.getContext('2d');
    g.drawImage(src.canvas, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = colour;
    g.fillRect(0, 0, c.width, c.height);
    return { canvas: c, ox: src.ox, oy: src.oy };
  }

  function blit(board, name, rot, sx, sy, extra) {
    var t = tile(board, name, rot, extra);
    board.ctx.drawImage(t.canvas, sx + t.ox, sy + t.oy, t.w, t.h);
  }

  function diamond(ctx, sx, sy, scale) {
    var w = TILE_W / 2 * scale;
    var h = TILE_H / 2 * scale;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + w, sy + h);
    ctx.lineTo(sx, sy + h * 2);
    ctx.lineTo(sx - w, sy + h);
    ctx.closePath();
  }

  /* ---------------------------------------------------------------- draw ---*/

  function draw(board, state, overlay) {
    overlay = overlay || {};
    var ctx = board.ctx;
    var canvas = board.canvas;
    var dpr = canvas._dpr || 1;
    var cssW = canvas.width / dpr;
    var cssH = canvas.height / dpr;
    var grid = state.grid;
    var scale = board.cam.scale;
    var rot = ((Math.round(board.angle / HALF_PI) % 4) + 4) % 4;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    paintBackground(ctx, cssW, cssH);

    var cells = orderCells(board, state);
    var i;
    var c;
    var sx;
    var sy;

    /* --- floors, quietly --------------------------------------------- */
    for (i = 0; i < cells.length; i++) {
      c = cells[i];
      if (c.wall) { continue; }
      sx = c.sx; sy = c.sy;
      if (sx < -120 || sx > cssW + 120 || sy < -160 || sy > cssH + 160) { continue; }
      if (!c.seen) { continue; }
      var floor = c.oil ? 'floor_oil' : 'floor_plate';
      blit(board, floor, rot, sx, sy, c.oil ? '' : (c.way ? 'way' : ''));
      if (c.chute) { blit(board, 'teleporter_chute', rot, sx, sy); }
      if (c.cell) { blit(board, 'power_cell', 0, sx, sy); }
    }

    /* --- what the search has taken, as a wash on the deck ------------- */
    paintSearch(board, state, overlay, cells, scale);

    /* --- props, actors, back to front --------------------------------- */
    for (i = 0; i < cells.length; i++) {
      c = cells[i];
      sx = c.sx; sy = c.sy;
      if (sx < -140 || sx > cssW + 140 || sy < -220 || sy > cssH + 160) { continue; }
      if (!c.seen) {
        // Walls too: fog that let the racks show through would give the maze away.
        fogTile(ctx, sx, sy, scale);
        continue;
      }
      if (c.wall) {
        var ws = wallSprite(grid, c.x, c.y);
        blit(board, ws, rot, sx, sy, ws === WALL_PLAIN ? 'quiet' : 'dim');
        continue;
      }
      if (c.chest) { blit(board, 'chest', Sprites.face(rot, 1), sx, sy); }
      if (c.delivery) { drawDelivery(board, sx, sy, rot, c.delivery, scale); }
      if (c.bot) { drawBot(board, sx, sy, rot, c.bot, scale); }
      if (c.player) { drawPlayer(board, state, sx, sy, rot, scale); }
    }

    /* --- the route, riding over everything ----------------------------- */
    if (overlay.path && overlay.path.length > 1) {
      drawRibbon(board, state, overlay.path, scale, overlay.rideIndex || 0);
    }
    if (overlay.aim) { drawAim(board, state, overlay.aim, scale); }

    /* --- markers: nothing is allowed to hide these --------------------- */
    drawMarkers(board, state, scale, overlay);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function paintBackground(ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0c1016');
    g.addColorStop(1, '#161b24');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function fogTile(ctx, sx, sy, scale) {
    diamond(ctx, sx, sy, scale);
    ctx.fillStyle = INK.fog;
    ctx.fill();
    ctx.strokeStyle = INK.fog;   // closes the hairline seams between diamonds
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // One pass over the map per frame, producing draw order and everything the
  // painters need, so nothing below has to look anything up twice.
  function orderCells(board, state) {
    var grid = state.grid;
    var out = [];
    var x;
    var y;
    for (y = 0; y < grid.h; y++) {
      for (x = 0; x < grid.w; x++) {
        var ch = grid.cells[y][x];
        var p = screenOf(board, grid, x, y, 0);
        out.push({
          x: x, y: y, i: y * grid.w + x,
          sx: p.x, sy: p.y, depth: p.depth,
          wall: ch === '#',
          oil: ch === '~',
          cell: ch === 'v',
          chute: /[0-9]/.test(ch),
          way: isWay(grid, x, y),
          seen: Heist.visible(state, x, y),
          chest: null, delivery: null, bot: null, player: false
        });
      }
    }
    var byIndex = {};
    out.forEach(function (c) { byIndex[c.i] = c; });

    state.chests.forEach(function (ch) {
      var c = byIndex[ch.y * grid.w + ch.x];
      if (c) { c.chest = ch; }
    });
    state.deliveries.forEach(function (d) {
      // An unlogged delivery is not on the board until the cart has seen it.
      if (!d.known) { return; }
      var c = byIndex[d.y * grid.w + d.x];
      if (c) { c.delivery = d; }
    });
    Heist.liveBots(state).forEach(function (b) {
      var c = byIndex[b.y * grid.w + b.x];
      if (c) { c.bot = b; }
    });
    var pc = byIndex[state.player.y * grid.w + state.player.x];
    if (pc) { pc.player = true; }

    out.sort(function (a, b) { return a.depth - b.depth; });
    return out;
  }

  // A corridor: floor with walls on both sides of one axis. It gets the quiet
  // darker plate, which is what makes "the way you can walk" visible at a
  // glance without drawing anything new.
  function isWay(grid, x, y) {
    if (grid.cells[y][x] === '#') { return false; }
    function wall(dx, dy) {
      var nx = x + dx;
      var ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) { return true; }
      return grid.cells[ny][nx] === '#';
    }
    return (wall(1, 0) && wall(-1, 0)) || (wall(0, 1) && wall(0, -1));
  }

  function paintSearch(board, state, overlay, cells, scale) {
    var ctx = board.ctx;
    var explored = overlay.explored;
    var frontier = overlay.frontier;
    if (!explored && !frontier) { return; }
    var i;
    var c;
    for (i = 0; i < cells.length; i++) {
      c = cells[i];
      if (c.wall || !c.seen) { continue; }
      if (frontier && frontier[c.i]) {
        diamond(ctx, c.sx, c.sy, scale);
        ctx.fillStyle = INK.frontier;
        ctx.fill();
        ctx.strokeStyle = INK.frontierEdge;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else if (explored && explored[c.i] !== undefined) {
        diamond(ctx, c.sx, c.sy, scale);
        ctx.fillStyle = overlay.bust ? INK.exploredBust : INK.explored;
        ctx.fill();
      }
    }
  }

  /* -------------------------------------------------------------- actors ---*/

  function drawPlayer(board, state, sx, sy, rot, scale) {
    var ctx = board.ctx;
    // A soft pool of light under the cart, so the eye lands on it first.
    ctx.save();
    ctx.globalAlpha = 0.55;
    var g = ctx.createRadialGradient(sx, sy + TILE_H / 2 * scale, 1,
      sx, sy + TILE_H / 2 * scale, TILE_W * scale * 0.85);
    g.addColorStop(0, INK.playerGlow);
    g.addColorStop(1, 'rgba(255,194,31,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(sx, sy + TILE_H / 2 * scale, TILE_W * scale * 0.85,
      TILE_H * scale * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    blit(board, 'player_dispatcher', Sprites.face(rot, state.player.facing), sx, sy);
  }

  function drawBot(board, sx, sy, rot, bot, scale) {
    var ctx = board.ctx;
    if (bot.stunned > 0 || bot.fleeing > 0) { ctx.globalAlpha = 0.55; }
    blit(board, bot.sprite, Sprites.face(rot, bot.facing), sx, sy);
    ctx.globalAlpha = 1;
    if (bot.carrying) {
      blit(board, 'chest', Sprites.face(rot, bot.facing), sx, sy - 12 * scale);
    }
  }

  function drawDelivery(board, sx, sy, rot, delivery, scale) {
    if (delivery.secured) {
      blit(board, 'chest_open', Sprites.face(rot, 1), sx, sy);
      return;
    }
    blit(board, 'prize', rot, sx, sy);
  }

  /* -------------------------------------------------------------- markers ---
   * Drawn last, in screen space, over everything: the four things a player
   * has to find in under two seconds are the four things nothing can cover. */

  function drawMarkers(board, state, scale, overlay) {
    var ctx = board.ctx;
    board.time += 1 / 60;
    var bob = Math.sin(board.time * 3.2) * 3 * scale;

    state.deliveries.forEach(function (d) {
      // A dark floor hides the way, not the manifest: a logged delivery keeps
      // its beacon in the dark. Only a delivery nobody logged waits to be seen.
      if (d.secured || !d.known) { return; }
      var p = screenOf(board, state.grid, d.x, d.y, 0);
      beacon(ctx, p.x, p.y + TILE_H / 2 * scale, scale, INK.delivery, board.time);
      edgeArrow(board, p.x, p.y + TILE_H / 2 * scale, INK.delivery);
    });

    Heist.liveBots(state).forEach(function (b) {
      if (!Heist.visible(state, b.x, b.y)) { return; }
      var p = screenOf(board, state.grid, b.x, b.y, 0);
      botTag(ctx, p.x, p.y - (18 + (b.type === 'boss' ? 10 : 0)) * scale + bob * 0.3, scale, b);
    });

    var pp = screenOf(board, state.grid, state.player.x, state.player.y, 0);
    pointer(ctx, pp.x, pp.y - 30 * scale + bob, scale);
    edgeArrow(board, pp.x, pp.y + TILE_H / 2 * scale, INK.player);

    if (overlay.hover) {
      var h = screenOf(board, state.grid, overlay.hover.x, overlay.hover.y, 0);
      diamond(ctx, h.x, h.y, scale);
      ctx.strokeStyle = INK.aim;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  // The floor is bigger than the screen at play zoom, so anything the player
  // must find that has scrolled off, or sits under the HUD, gets an arrow on
  // the edge of the open board pointing at it.
  function edgeArrow(board, x, y, colour) {
    var dpr = board.canvas._dpr || 1;
    var w = board.canvas.width / dpr;
    var h = board.canvas.height / dpr;
    var m = 26;
    var top = board.covered.top + m;
    var bottom = h - board.covered.bottom - m;
    if (x >= m && x <= w - m && y >= top && y <= bottom) { return; }
    var cx = Math.max(m, Math.min(w - m, x));
    var cy = Math.max(top, Math.min(bottom, y));
    var ang = Math.atan2(y - cy, x - cx);
    var ctx = board.ctx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.shadowColor = colour;
    ctx.shadowBlur = 8;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-7, 9);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-7, -9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // A tall red column over a delivery: it has to be findable through a rack.
  // A red column rising out of a delivery, ending in a marker: findable over
  // a rack, and joined to the floor so the eye follows it down to the cell.
  function beacon(ctx, x, y, scale, colour, time) {
    var h = 40 * scale;
    var pulse = 0.55 + 0.45 * Math.sin(time * 3);

    // The cell itself glows red, whatever sits on it.
    ctx.save();
    ctx.fillStyle = 'rgba(255, 59, 48, ' + (0.16 + 0.12 * pulse).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(x, y, TILE_W * 0.46 * scale, TILE_H * 0.46 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 59, 48, ' + (0.65 + 0.35 * pulse).toFixed(3) + ')';
    ctx.lineWidth = 1.6 * scale;
    ctx.stroke();

    var g = ctx.createLinearGradient(x, y - h, x, y);
    g.addColorStop(0, 'rgba(255, 59, 48, 0.85)');
    g.addColorStop(1, 'rgba(255, 59, 48, 0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 1.3 * scale, y - h, 2.6 * scale, h);

    // The marker: a red diamond with a light rim, bobbing gently.
    var my = y - h - 4 * scale + Math.sin(time * 3) * 1.5 * scale;
    var r = 5.5 * scale;
    ctx.shadowColor = 'rgba(255, 59, 48, 0.9)';
    ctx.shadowBlur = 8 * scale;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(x, my - r);
    ctx.lineTo(x + r * 0.8, my);
    ctx.lineTo(x, my + r);
    ctx.lineTo(x - r * 0.8, my);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 230, 225, 0.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  function botTag(ctx, x, y, scale, bot) {
    var r = 5 * scale;
    ctx.fillStyle = 'rgba(12, 16, 22, 0.75)';
    ctx.beginPath();
    ctx.arc(x, y, r + 2.2 * scale, 0, Math.PI * 2);
    ctx.fill();
    // Grey when the light has it (stunned or running): it can be rolled past.
    // A scout is a dart, a hauler a diamond, a foreman a diamond with plates.
    ctx.fillStyle = bot.stunned > 0 || bot.fleeing > 0 ? '#8b98a8' : INK.thief;
    ctx.beginPath();
    if (bot.type === 'fast') {
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.9, y + r * 0.8);
      ctx.lineTo(x, y + r * 0.35);
      ctx.lineTo(x - r * 0.9, y + r * 0.8);
    } else {
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
    }
    ctx.closePath();
    ctx.fill();
    if (bot.type === 'boss') {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold ' + Math.round(8 * scale) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(bot.hp), x, y + 0.5);
    }
  }

  // The player's pointer: the brightest thing on the board, and the only
  // bobbing one, so the eye finds the cart before it finds anything else.
  function pointer(ctx, x, y, scale) {
    var s = 7 * scale;
    ctx.save();
    ctx.shadowColor = 'rgba(255, 194, 31, 0.9)';
    ctx.shadowBlur = 10 * scale;
    ctx.fillStyle = INK.player;
    ctx.beginPath();
    ctx.moveTo(x, y + s);
    ctx.lineTo(x + s * 0.95, y - s * 0.7);
    ctx.lineTo(x, y - s * 0.25);
    ctx.lineTo(x - s * 0.95, y - s * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(16, 20, 27, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* ------------------------------------------------------------- the path ---*/

  function drawRibbon(board, state, path, scale, from) {
    var ctx = board.ctx;
    var pts = [];
    for (var i = Math.max(0, from - 1); i < path.length; i++) {
      var p = screenOf(board, state.grid, path[i].x, path[i].y, 9);
      pts.push({ x: p.x, y: p.y + TILE_H / 2 * scale });
    }
    if (pts.length < 2) { return; }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    stroke(ctx, pts, 0, 5 * scale * 0.6, 'rgba(8, 10, 14, 0.45)', 9 * scale * 0.7);
    stroke(ctx, pts, 0, 0, INK.pathDark, 8 * scale * 0.7);
    stroke(ctx, pts, 0, -1.5, INK.path, 5.2 * scale * 0.7);

    // Chevrons: which way the cart is about to travel, not just where.
    ctx.fillStyle = '#ffd7b0';
    for (var k = 1; k < pts.length; k += 2) {
      var a = pts[k - 1];
      var b = pts[k];
      var mx = (a.x + b.x) / 2;
      var my = (a.y + b.y) / 2;
      var ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(ang);
      var s = 3.1 * scale * 0.8;
      ctx.beginPath();
      ctx.moveTo(s, 0);
      ctx.lineTo(-s * 0.8, s * 0.72);
      ctx.lineTo(-s * 0.8, -s * 0.72);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function stroke(ctx, pts, dx, dy, colour, width) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var x = pts[i].x + dx;
      var y = pts[i].y + dy;
      if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
  }

  function drawAim(board, state, aim, scale) {
    var ctx = board.ctx;
    var a = screenOf(board, state.grid, state.player.x, state.player.y, 14);
    var b = screenOf(board, state.grid, aim.x, aim.y, 14);
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y + TILE_H / 2 * scale);
    ctx.lineTo(b.x, b.y + TILE_H / 2 * scale);
    ctx.stroke();
    ctx.restore();
    diamond(ctx, b.x, b.y, scale);
    ctx.strokeStyle = INK.aim;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /* -------------------------------------------------------------- canvas ---*/

  function sizeCanvas(canvas, cssW, cssH) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas._dpr = dpr;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
  }

  return {
    create: create,
    sizeCanvas: sizeCanvas,
    stepSpin: stepSpin,
    TILE_W: TILE_W,
    TILE_H: TILE_H,
    INK: INK,
    wallSprite: wallSprite
  };
}());

if (typeof module !== 'undefined' && module.exports) { module.exports = HeistBoard; }
