/* sprites.js - the Factory Heist sprite kit.
 *
 * Hand-authored isometric art, defined once as little 3D models and painted
 * as flat-shaded polygons. Plain script, no build, no modules, no external
 * images: it loads from file:// with <script src="sprites.js"></script> and
 * it also `require()`s in node, which is how the SVG sheets and the tests
 * read it.
 *
 * The art bible is docs/art/ART.md. Look at docs/art/concept.html first.
 *
 * ---------------------------------------------------------------- usage ---
 *
 *   Sprites.draw(ctx, 'wall_crate', rot, { x: sx, y: sy });
 *
 * `rot` is 0..3, the board rotation in 90-degree steps. `x, y` is the screen
 * point of the tile's NORTH corner - exactly what render.js's worldOf(x, y, 0)
 * already returns - so a sprite drops onto a tile with no extra maths:
 *
 *   var w = worldOf(x, y, 0);
 *   Sprites.draw(ctx, 'floor_plate', rot, { x: w.x, y: w.y });
 *
 * Paint the floors in one pass and then the props back to front along
 * (x + y), because a few props (forks, beams) reach over their tile edge.
 * Within one sprite the parts sort themselves, so a sprite never needs the
 * caller's help to look right.
 *
 * Anything bolted to the grid is drawn with the board rotation alone. Things
 * that face a direction of their own - the cart, the thieves, a path tile -
 * compose the two with Sprites.orient(), which keeps the sign convention in
 * one place:
 *
 *   Sprites.draw(ctx, 'player_dispatcher', Sprites.face(rot, cart.facing), pos);
 *   Sprites.draw(ctx, 'overlay_path_end', Sprites.orient(rot, Sprites.DIR.west, from), pos);
 *
 * Directions are 0 east (+x), 1 south (+y), 2 west, 3 north. Sprites that
 * have a front are authored looking east; path tiles are authored entering
 * from the west.
 *
 * For a tile that is drawn every frame at a fixed zoom, cache it once:
 *
 *   var t = Sprites.prerender('wall_crate', rot, cam.scale);
 *   ctx.drawImage(t.canvas, sx + t.ox, sy + t.oy);
 *
 * Other entry points: Sprites.names(), Sprites.meta(name),
 * Sprites.polygons(name, rot), Sprites.bounds(name, rot),
 * Sprites.distinctRotations(name), Sprites.svg(name, rot), Sprites.PALETTE.
 */

var Sprites = (function () {
  'use strict';

  /* ------------------------------------------------------------ geometry ---
   *
   * Model space: u runs along grid +x, v along grid +y, both 0..1 across one
   * tile, h is height in pixels above the floor. One tile is TILE_W x TILE_H
   * on screen, matching render.js, and the sprite origin is the tile's north
   * corner (u=0, v=0).
   */

  var TILE_W = 32;
  var TILE_H = 16;
  var WALL_H = 20;       // the standard wall block height, see ART.md
  var SEG = 12;          // segments per cylinder

  function rot2(u, v, r) {
    switch (r & 3) {
      case 1: return [v, 1 - u];
      case 2: return [1 - u, 1 - v];
      case 3: return [1 - v, u];
      default: return [u, v];
    }
  }

  function project(u, v, h) {
    return [(u - v) * TILE_W / 2, (u + v) * TILE_H / 2 - h];
  }

  function p3(u, v, h, r) {
    var q = rot2(u, v, r);
    return project(q[0], q[1], h);
  }

  /* ------------------------------------------------------------- colour ---
   *
   * Every colour in every sprite is derived from PALETTE by the helpers
   * below, which record what they produce. tests/sprites.test.js asserts that
   * nothing else ever reaches the canvas, so the palette is a mechanical
   * rule rather than a good intention.
   */

  var PALETTE = {
    oil: '#10141b',        // oil black - outlines, shadow, the gaps
    steelDeep: '#222936',
    steelDark: '#39434f',
    steel: '#5c6877',
    steelLight: '#8b98a8',
    steelPale: '#c3ccd8',
    yellow: '#ffc21f',     // safety yellow - the dispatcher's light, frontier
    yellowDeep: '#b8860c',
    orange: '#ff7a29',     // warning orange - the path, hot machinery
    orangeDeep: '#b84a15',
    prize: '#4ff0c5',      // the one glowing colour, the prize only
    explored: '#2f6fb0',   // cold wash on ground the search has taken
    hazard: '#e0452e',     // thief signal only
    glint: '#ffffff'
  };

  var DERIVED = {};
  (function () {
    for (var k in PALETTE) {
      if (Object.prototype.hasOwnProperty.call(PALETTE, k)) {
        DERIVED[PALETTE[k]] = PALETTE[k];
      }
    }
  }());

  function hex2(v) { return ('0' + Math.round(v).toString(16)).slice(-2); }

  function chan(h, i) { return parseInt(h.substr(i, 2), 16); }

  function mix(a, b, t) {
    return '#' + hex2(chan(a, 1) + (chan(b, 1) - chan(a, 1)) * t) +
      hex2(chan(a, 3) + (chan(b, 3) - chan(a, 3)) * t) +
      hex2(chan(a, 5) + (chan(b, 5) - chan(a, 5)) * t);
  }

  function reg(out, base) { DERIVED[out] = base; return out; }

  // Toward the ceiling lamp, and toward the oil in the corners.
  function lite(c, t) { return reg(mix(c, PALETTE.glint, t), c); }
  function dark(c, t) { return reg(mix(c, PALETTE.oil, t), c); }

  function rgba(c, a) {
    return reg('rgba(' + chan(c, 1) + ',' + chan(c, 3) + ',' + chan(c, 5) + ',' + a + ')', c);
  }

  /* --------------------------------------------------------------- light ---
   *
   * One lamp, fixed in the ceiling of the screen, up and to the left. It does
   * NOT rotate with the board: the top of a block is always the brightest
   * face, the face pointing down-left always catches more than the face
   * pointing down-right. Turning the board therefore swaps which *painted*
   * face is in the light, which is what sells the rotation.
   */

  var LIGHT = { top: 0.10, left: 0.18, right: 0.44 };

  function faceTop(c) { return lite(c, LIGHT.top); }
  function faceLeft(c) { return dark(c, LIGHT.left); }
  function faceRight(c) { return dark(c, LIGHT.right); }

  /* ---------------------------------------------------------------- model ---
   *
   * A sprite definition is a function(m, r) that pushes parts onto the model.
   * Parts are sorted back to front by their footprint depth (u + v) with a
   * stable tie-break on insertion order, so a definition can be written in
   * any sensible order and still rotate correctly.
   */

  function Model(r) {
    this.r = r;
    this.parts = [];
    this.n = 0;
  }

  Model.prototype.push = function (part, cu, cv, bias) {
    part.key = cu + cv + (bias || 0);
    part.seq = this.n++;
    this.parts.push(part);
    return part;
  };

  Model.prototype.poly = function (pts, fill, opt) {
    opt = opt || {};
    var r = this.r;
    var out = [];
    var cu = 0;
    var cv = 0;
    for (var i = 0; i < pts.length; i++) {
      out.push(p3(pts[i][0], pts[i][1], pts[i][2], r));
      cu += pts[i][0];
      cv += pts[i][1];
    }
    return this.push({
      kind: 'poly',
      pts: out,
      fill: fill,
      stroke: opt.stroke,
      width: opt.width
    }, cu / pts.length, cv / pts.length, opt.d);
  };

  // An axis-aligned block. `sides` names the four vertical faces by the grid
  // direction they look at, so a stencil or a screen stays painted on the
  // same face of the object while the board turns.
  //   px = +u (east)  py = +v (south)  nx = -u (west)  ny = -v (north)
  Model.prototype.box = function (u0, v0, u1, v1, h0, h1, st) {
    st = st || {};
    var c = st.color || PALETTE.steel;
    var sides = [
      st.px || c, st.py || c, st.nx || c, st.ny || c
    ];
    var r = this.r;
    var a = rot2(u0, v0, r);
    var b = rot2(u1, v1, r);
    var ru0 = Math.min(a[0], b[0]);
    var ru1 = Math.max(a[0], b[0]);
    var rv0 = Math.min(a[1], b[1]);
    var rv1 = Math.max(a[1], b[1]);
    var cu = (ru0 + ru1) / 2;
    var cv = (rv0 + rv1) / 2;
    var bias = st.d;

    // The two faces that end up looking at the camera after the turn.
    var rightSrc = sides[(0 + r) & 3];
    var leftSrc = sides[(1 + r) & 3];

    if (h1 > h0) {
      this.push({
        kind: 'poly',
        pts: [project(ru1, rv0, h1), project(ru1, rv1, h1),
          project(ru1, rv1, h0), project(ru1, rv0, h0)],
        fill: faceRight(rightSrc)
      }, cu, cv, bias);
      this.push({
        kind: 'poly',
        pts: [project(ru0, rv1, h1), project(ru1, rv1, h1),
          project(ru1, rv1, h0), project(ru0, rv1, h0)],
        fill: faceLeft(leftSrc)
      }, cu, cv, bias);
    }
    this.push({
      kind: 'poly',
      pts: [project(ru0, rv0, h1), project(ru1, rv0, h1),
        project(ru1, rv1, h1), project(ru0, rv1, h1)],
      fill: st.topColor ? faceTop(st.topColor) : faceTop(c),
      stroke: st.stroke,
      width: st.width
    }, cu, cv, bias);
    return this;
  };

  // A standing cylinder: barrels, lamp housings, power cells. Faceted, not
  // smooth - the whole kit is flat polygons, see ART.md.
  Model.prototype.cyl = function (cu, cv, rad, h0, h1, st) {
    st = st || {};
    var c = st.color || PALETTE.steel;
    var q = rot2(cu, cv, this.r);
    var base = project(q[0], q[1], 0);
    var rx = TILE_W * rad / Math.SQRT2;
    var ry = TILE_H * rad / Math.SQRT2;
    var i;
    var pts;

    if (h1 > h0) {
      for (i = 0; i < SEG; i++) {
        var a0 = Math.PI * i / SEG;
        var a1 = Math.PI * (i + 1) / SEG;
        var midc = Math.cos((a0 + a1) / 2);
        // Screen normal points left when cos < 0, and the lamp is up-left.
        var k = 0.44 - 0.26 * (-midc);
        pts = [
          [base[0] + rx * Math.cos(a0), base[1] + ry * Math.sin(a0) - h1],
          [base[0] + rx * Math.cos(a1), base[1] + ry * Math.sin(a1) - h1],
          [base[0] + rx * Math.cos(a1), base[1] + ry * Math.sin(a1) - h0],
          [base[0] + rx * Math.cos(a0), base[1] + ry * Math.sin(a0) - h0]
        ];
        this.push({ kind: 'poly', pts: pts, fill: dark(c, k) }, cu, cv, st.d);
      }
    }
    if (st.open !== true) {
      pts = [];
      for (i = 0; i < SEG * 2; i++) {
        var a = Math.PI * i / SEG;
        pts.push([base[0] + rx * Math.cos(a), base[1] + ry * Math.sin(a) - h1]);
      }
      this.push({
        kind: 'poly', pts: pts, fill: faceTop(st.topColor || c),
        stroke: st.stroke, width: st.width
      }, cu, cv, st.d);
    }
    return this;
  };

  // A flat ring or disc lying on the ground, for pads and light pools.
  Model.prototype.disc = function (cu, cv, rad, h, fill, opt) {
    opt = opt || {};
    var q = rot2(cu, cv, this.r);
    var base = project(q[0], q[1], h);
    var rx = TILE_W * rad / Math.SQRT2;
    var ry = TILE_H * rad / Math.SQRT2;
    var pts = [];
    for (var i = 0; i < SEG * 2; i++) {
      var a = Math.PI * i / SEG + (opt.turn || 0);
      pts.push([base[0] + rx * Math.cos(a), base[1] + ry * Math.sin(a)]);
    }
    return this.push({
      kind: 'poly', pts: pts, fill: fill, stroke: opt.stroke, width: opt.width
    }, cu, cv, opt.d);
  };

  Model.prototype.glow = function (cu, cv, h, rad, color, alpha, bias) {
    var q = rot2(cu, cv, this.r);
    var base = project(q[0], q[1], h);
    return this.push({
      kind: 'glow', cx: base[0], cy: base[1], r: rad,
      color: color, alpha: alpha === undefined ? 0.8 : alpha
    }, cu, cv, bias === undefined ? 6 : bias);
  };

  Model.prototype.shadow = function (cu, cv, rad, alpha) {
    return this.glow(cu, cv, 0, rad, PALETTE.oil, alpha === undefined ? 0.5 : alpha, -9);
  };

  Model.prototype.line = function (pts, color, width, opt) {
    opt = opt || {};
    var r = this.r;
    var out = [];
    var cu = 0;
    var cv = 0;
    for (var i = 0; i < pts.length; i++) {
      out.push(p3(pts[i][0], pts[i][1], pts[i][2], r));
      cu += pts[i][0];
      cv += pts[i][1];
    }
    return this.push({
      kind: 'path', pts: out, stroke: color, width: width
    }, cu / pts.length, cv / pts.length, opt.d);
  };

  /* ------------------------------------------------------- shared shapes ---*/

  // Hazard band: safety yellow with oil black ticks, the factory's way of
  // saying "this edge will hurt you". Four strips, never a filled top - a
  // band that fills the tile reads as a lit pad, which is a different object.
  function hazardBand(m, u0, v0, u1, v1, h0, h1, step) {
    var w = 0.075;
    var strips = [
      [u0, v0, u1, v0 + w, true],
      [u0, v1 - w, u1, v1, true],
      [u0, v0 + w, u0 + w, v1 - w, false],
      [u1 - w, v0 + w, u1, v1 - w, false]
    ];
    step = step || 0.13;
    for (var i = 0; i < strips.length; i++) {
      var s = strips[i];
      m.box(s[0], s[1], s[2], s[3], h0, h1, { color: PALETTE.yellow });
      var a0 = s[4] ? s[0] : s[1];
      var a1 = s[4] ? s[2] : s[3];
      for (var t = a0 + step * 0.4; t < a1 - step; t += step * 2) {
        if (s[4]) {
          m.box(t, s[1] - 0.004, t + step, s[3] + 0.004, h0, h1 + 0.02,
            { color: PALETTE.oil, d: 0.01 });
        } else {
          m.box(s[0] - 0.004, t, s[2] + 0.004, t + step, h0, h1 + 0.02,
            { color: PALETTE.oil, d: 0.01 });
        }
      }
    }
  }

  // A crate: braced corners, a stencil on its east face so rotation reads.
  function crate(m, u0, v0, u1, v1, h0, h1, stencil) {
    var body = PALETTE.steel;
    m.box(u0, v0, u1, v1, h0, h1, {
      color: body,
      px: dark(body, 0.06),
      ny: dark(body, 0.1),
      topColor: dark(body, 0.12)
    });
    var b = 0.055;
    var braces = [[u0, v0], [u1 - b, v0], [u0, v1 - b], [u1 - b, v1 - b]];
    for (var i = 0; i < braces.length; i++) {
      m.box(braces[i][0], braces[i][1], braces[i][0] + b, braces[i][1] + b,
        h0, h1 + 0.6, { color: PALETTE.steelLight, d: 0.02 });
    }
    // Lid rim.
    m.box(u0 - 0.015, v0 - 0.015, u1 + 0.015, v1 + 0.015, h1, h1 + 1.4,
      { color: PALETTE.steelLight, topColor: PALETTE.steelDark });
    var mu = (u0 + u1) / 2;
    var mv = (v0 + v1) / 2;
    // Diagonal strap on the east face and a painted band on the south face.
    m.poly([
      [u1 + 0.008, v0 + 0.1, h0 + 1.5], [u1 + 0.008, v1 - 0.1, h1 - 2],
      [u1 + 0.008, v1 - 0.1, h1 - 3.6], [u1 + 0.008, v0 + 0.1, h0 + 0.2]
    ], PALETTE.steelLight, { d: 0.02 });
    if (stencil !== false) {
      m.box(mu - 0.14, v1 + 0.006, mu + 0.14, v1 + 0.008, h0 + (h1 - h0) * 0.45,
        h0 + (h1 - h0) * 0.72, { color: PALETTE.yellow, d: 0.03 });
      m.box(u1 + 0.006, mv - 0.05, u1 + 0.008, mv + 0.05, h0 + 1.8, h0 + 3.6,
        { color: PALETTE.yellow, d: 0.03 });
    }
  }

  function bolts(m, u0, v0, u1, v1, h, color) {
    var pts = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]];
    for (var i = 0; i < pts.length; i++) {
      m.disc(pts[i][0], pts[i][1], 0.045, h, color, { d: 0.04 });
    }
  }

  // Chevrons pointing along +u, used by belts, chutes and the path ribbon.
  function chevrons(m, u0, u1, cv, half, h, color, count, alpha) {
    for (var i = 0; i < count; i++) {
      var a = u0 + (u1 - u0) * (i + 0.15) / count;
      var b = u0 + (u1 - u0) * (i + 0.75) / count;
      var fill = alpha === undefined ? color : rgba(color, alpha);
      m.poly([
        [a, cv - half, h], [b, cv, h], [a, cv + half, h],
        [a + (b - a) * 0.45, cv, h]
      ], fill, { d: 0.05 });
    }
  }

  /* ------------------------------------------------------------- registry ---*/

  var DEFS = {};
  var ORDER = [];

  function def(name, meta, build) {
    meta.name = name;
    DEFS[name] = { meta: meta, build: build };
    ORDER.push(name);
  }

  /* ---- floors ------------------------------------------------------------*/

  def('floor_plate', {
    group: 'floor',
    title: 'Plate floor',
    note: 'The default walkable tile: one bolted steel plate, cost 1.'
  }, function (m) {
    m.box(0, 0, 1, 1, -3, 0, {
      color: PALETTE.steelDark,
      topColor: PALETTE.steel
    });
    bolts(m, 0.12, 0.12, 0.88, 0.88, 0.05, dark(PALETTE.steel, 0.35));
    m.line([[0.5, 0.06, 0.1], [0.5, 0.94, 0.1]], dark(PALETTE.steel, 0.22), 0.7, { d: 0.03 });
    m.line([[0.06, 0.5, 0.1], [0.94, 0.5, 0.1]], dark(PALETTE.steel, 0.22), 0.7, { d: 0.03 });
  });

  def('floor_grate', {
    group: 'floor',
    title: 'Grating',
    note: 'Walkable, cost 1, and the bars point along the grid so rotation reads even on empty ground.'
  }, function (m) {
    m.box(0, 0, 1, 1, -4, -1.2, { color: PALETTE.steelDeep, topColor: PALETTE.oil });
    for (var i = 0; i < 6; i++) {
      var v0 = 0.05 + i * 0.155;
      m.box(0.03, v0, 0.97, v0 + 0.085, -1.2, -0.2, {
        color: PALETTE.steel, topColor: PALETTE.steelLight, d: 0.02
      });
    }
    m.box(0.0, 0.0, 1.0, 0.04, -1.4, 0.2, { color: PALETTE.steelDark, d: 0.03 });
    m.box(0.0, 0.96, 1.0, 1.0, -1.4, 0.2, { color: PALETTE.steelDark, d: 0.03 });
    m.box(0.0, 0.0, 0.04, 1.0, -1.4, 0.2, { color: PALETTE.steelDark, d: 0.03 });
    m.box(0.96, 0.0, 1.0, 1.0, -1.4, 0.2, { color: PALETTE.steelDark, d: 0.03 });
    m.line([[0.5, 0.06, 0.4], [0.5, 0.94, 0.4]], dark(PALETTE.steelLight, 0.2), 0.8, { d: 0.05 });
  });

  def('floor_oil', {
    group: 'floor',
    title: 'Oil floor',
    note: 'The slow tile. It sinks, the spill eats the light, and the rim is hazard-striped.'
  }, function (m) {
    m.box(0, 0, 1, 1, -7, -3, { color: PALETTE.steelDeep, topColor: PALETTE.steelDeep });
    m.poly([
      [0.18, 0.3, -2.8], [0.46, 0.14, -2.8], [0.82, 0.28, -2.8], [0.9, 0.6, -2.8],
      [0.62, 0.88, -2.8], [0.28, 0.82, -2.8], [0.12, 0.56, -2.8]
    ], PALETTE.oil, { d: 0.02 });
    m.poly([
      [0.3, 0.36, -2.6], [0.5, 0.26, -2.6], [0.58, 0.38, -2.6], [0.38, 0.48, -2.6]
    ], rgba(PALETTE.explored, 0.4), { d: 0.03 });
    m.poly([
      [0.6, 0.62, -2.6], [0.72, 0.56, -2.6], [0.76, 0.66, -2.6], [0.64, 0.72, -2.6]
    ], rgba(PALETTE.steelPale, 0.12), { d: 0.03 });
    hazardBand(m, 0.0, 0.0, 1.0, 1.0, -3.2, -2.9, 0.12);
  });

  /* ---- walls -------------------------------------------------------------*/

  def('wall_crate', {
    group: 'wall',
    title: 'Crate',
    note: 'The plain blocker. Braced corners, one stencilled face, reads as a cube at any size.'
  }, function (m) {
    m.shadow(0.5, 0.5, 15, 0.42);
    crate(m, 0.07, 0.07, 0.93, 0.93, 0, WALL_H);
  });

  def('wall_crate_stack', {
    group: 'wall',
    title: 'Crate stack',
    note: 'Two crates, the top one shoved east - the offset is what makes all four rotations different.'
  }, function (m) {
    m.shadow(0.5, 0.5, 16, 0.45);
    crate(m, 0.05, 0.06, 0.95, 0.94, 0, 13);
    crate(m, 0.26, 0.18, 0.86, 0.72, 14.4, 25, false);
    m.box(0.3, 0.16, 0.82, 0.18, 17, 22, { color: PALETTE.yellow, d: 0.05 });
  });

  def('wall_shelf_rack', {
    group: 'wall',
    title: 'Shelving rack',
    note: 'Four uprights, two decks, stock on one side and a back panel on the north face: solid from one angle, see-through from the next.'
  }, function (m) {
    m.shadow(0.5, 0.5, 16, 0.4);
    var H = 27;
    var legs = [[0.08, 0.08], [0.84, 0.08], [0.08, 0.84], [0.84, 0.84]];
    for (var i = 0; i < legs.length; i++) {
      m.box(legs[i][0], legs[i][1], legs[i][0] + 0.08, legs[i][1] + 0.08, 0, H,
        { color: PALETTE.orangeDeep, topColor: PALETTE.orange, d: 0.01 });
    }
    m.box(0.06, 0.06, 0.94, 0.13, 2, H - 2, { color: PALETTE.steelDeep, d: -0.02 });
    m.box(0.06, 0.06, 0.94, 0.94, 8.6, 10.2, { color: PALETTE.steelDark, topColor: PALETTE.steelLight });
    m.box(0.06, 0.06, 0.94, 0.94, 18.6, 20.2, { color: PALETTE.steelDark, topColor: PALETTE.steelLight });
    crate(m, 0.12, 0.16, 0.54, 0.7, 10.2, 18, false);
    crate(m, 0.58, 0.22, 0.92, 0.76, 10.2, 16.2, false);
    crate(m, 0.14, 0.2, 0.7, 0.8, 20.2, 26.4, false);
    m.box(0.2, 0.18, 0.64, 0.2, 21.6, 25, { color: PALETTE.yellow, d: 0.06 });
    m.box(0.07, 0.07, 0.93, 0.93, H, H + 1.2, { color: PALETTE.orange, topColor: PALETTE.orangeDeep });
  });

  def('wall_machine', {
    group: 'wall',
    title: 'Machine with a light',
    note: 'A press with a rotating beacon. The vents, the screen and the lamp sit on named faces, so it has a front.'
  }, function (m) {
    m.shadow(0.5, 0.5, 16, 0.42);
    hazardBand(m, 0.08, 0.08, 0.92, 0.92, 0, 3, 0.18);
    m.box(0.08, 0.08, 0.92, 0.92, 3, 17, {
      color: PALETTE.steelDark,
      px: PALETTE.steel,
      topColor: PALETTE.steel
    });
    // Screen on the east face, vents on the south face.
    m.box(0.921, 0.24, 0.925, 0.62, 8, 14, { color: PALETTE.steelDeep, d: 0.05 });
    m.box(0.926, 0.28, 0.93, 0.44, 9.4, 12.6, { color: PALETTE.yellow, d: 0.06 });
    m.box(0.926, 0.47, 0.93, 0.58, 9.4, 10.6, { color: PALETTE.orange, d: 0.06 });
    for (var i = 0; i < 4; i++) {
      var u = 0.2 + i * 0.16;
      m.box(u, 0.921, u + 0.1, 0.925, 6, 13, { color: PALETTE.steelDeep, d: 0.05 });
    }
    m.box(0.04, 0.04, 0.96, 0.96, 17, 19, { color: PALETTE.steel, topColor: PALETTE.steelLight });
    m.cyl(0.5, 0.5, 0.13, 19, 21.5, { color: PALETTE.steelDeep, topColor: PALETTE.steelDark });
    m.cyl(0.5, 0.5, 0.115, 21.5, 24.5, { color: PALETTE.orange, topColor: PALETTE.yellow });
    m.glow(0.5, 0.5, 23, 17, PALETTE.orange, 0.5);
    m.line([[0.18, 0.5, 19], [0.18, 0.5, 26]], PALETTE.steelLight, 1, { d: 0.05 });
  });

  def('wall_pipe_run', {
    group: 'wall',
    title: 'Pipe run',
    note: 'A trunk main on piers. Across the screen in two rotations, straight at you in the other two - the most rotation-legible piece in the kit.'
  }, function (m) {
    m.shadow(0.5, 0.5, 15, 0.38);
    // One continuous main: the body runs past both tile edges so a line of
    // these reads as one pipe, and only the collar marks the joint.
    m.box(0.18, 0.36, 0.34, 0.64, 0, 8.6, { color: PALETTE.steelDeep, topColor: PALETTE.steelDark });
    m.box(0.66, 0.36, 0.82, 0.64, 0, 8.6, { color: PALETTE.steelDeep, topColor: PALETTE.steelDark });
    m.box(-0.04, 0.26, 1.04, 0.74, 8.4, 14, { color: PALETTE.steel });
    m.box(-0.04, 0.32, 1.04, 0.68, 14, 16.6, { color: PALETTE.steelLight, topColor: PALETTE.steelLight });
    m.box(-0.04, 0.22, 1.04, 0.28, 8.4, 12.6, { color: PALETTE.steelDeep, d: 0.04 });
    m.box(0.45, 0.22, 0.55, 0.78, 8, 17.4,
      { color: PALETTE.steelDark, topColor: PALETTE.steel, d: 0.03 });
    m.box(0.16, 0.2, 0.36, 0.24, 10, 14.4, { color: PALETTE.yellow, d: 0.05 });
    m.cyl(0.5, 0.5, 0.1, 17.4, 19.2, { color: PALETTE.orangeDeep, topColor: PALETTE.orange, d: 0.05 });
    m.line([[0.38, 0.5, 19], [0.62, 0.5, 19]], PALETTE.orange, 1.6, { d: 0.06 });
  });

  def('wall_barrels', {
    group: 'wall',
    title: 'Barrel cluster',
    note: 'Three drums at three heights. The round silhouette is the one shape in the kit that is not a box, so it never reads as a crate.'
  }, function (m) {
    m.shadow(0.5, 0.52, 16, 0.44);
    var drums = [
      [0.3, 0.32, 0.25, 19, PALETTE.steel],
      [0.72, 0.4, 0.23, 15.5, PALETTE.steelDark],
      [0.48, 0.74, 0.24, 21.5, PALETTE.steel]
    ];
    for (var i = 0; i < drums.length; i++) {
      var d = drums[i];
      m.cyl(d[0], d[1], d[2], 0, d[3], { color: d[4], topColor: dark(d[4], 0.25) });
      m.cyl(d[0], d[1], d[2] + 0.012, d[3] * 0.28, d[3] * 0.28 + 1.6,
        { color: PALETTE.yellow, open: true });
      m.cyl(d[0], d[1], d[2] + 0.012, d[3] * 0.7, d[3] * 0.7 + 1.6,
        { color: PALETTE.yellow, open: true });
      m.disc(d[0] + 0.06, d[1] - 0.02, 0.05, d[3] + 0.2, PALETTE.steelDeep, { d: 0.05 });
      m.disc(d[0], d[1], d[2] - 0.03, d[3] + 0.1, dark(d[4], 0.1), { d: 0.04 });
    }
    m.poly([
      [0.12, 0.62, 0.15], [0.3, 0.56, 0.15], [0.36, 0.72, 0.15],
      [0.2, 0.84, 0.15], [0.08, 0.76, 0.15]
    ], PALETTE.oil, { d: -0.5 });
  });

  def('wall_conveyor', {
    group: 'wall',
    title: 'Conveyor segment',
    note: 'A belt with a direction. Chevrons run along +x, so four rotations give four headings and a line of them reads as one machine.'
  }, function (m) {
    m.shadow(0.5, 0.5, 15, 0.36);
    var legs = [[0.12, 0.24], [0.12, 0.7], [0.8, 0.24], [0.8, 0.7]];
    for (var i = 0; i < legs.length; i++) {
      m.box(legs[i][0], legs[i][1], legs[i][0] + 0.08, legs[i][1] + 0.06, 0, 9,
        { color: PALETTE.steelDeep, d: 0.01 });
    }
    m.box(-0.02, 0.18, 1.02, 0.82, 9, 12.4, { color: PALETTE.steelDark, topColor: PALETTE.oil });
    for (i = 0; i < 7; i++) {
      var u = -0.01 + i * 0.145;
      m.box(u, 0.2, u + 0.055, 0.8, 12.4, 13.2,
        { color: PALETTE.steelDark, topColor: PALETTE.steel, d: 0.02 });
    }
    chevrons(m, 0.02, 0.98, 0.5, 0.2, 13.5, PALETTE.yellow, 3, 0.9);
    m.box(-0.02, 0.14, 1.02, 0.2, 9, 14.6, { color: PALETTE.orangeDeep, topColor: PALETTE.orange, d: 0.03 });
    m.box(-0.02, 0.8, 1.02, 0.86, 9, 14.6, { color: PALETTE.orangeDeep, topColor: PALETTE.orange, d: 0.03 });
    m.cyl(0.98, 0.5, 0.16, 8.6, 13.4, { color: PALETTE.steelLight, topColor: PALETTE.steel, d: 0.05 });
  });

  def('wall_cabinet', {
    group: 'wall',
    title: 'Control cabinet',
    note: 'Tall and thin, with a door on the east face. The status lamp is the only warm thing at head height, so it marks a junction from across the map.'
  }, function (m) {
    m.shadow(0.5, 0.5, 14, 0.42);
    var H = 28;
    hazardBand(m, 0.2, 0.2, 0.8, 0.8, 0, 2.4, 0.2);
    m.box(0.2, 0.2, 0.8, 0.8, 2.4, H, {
      color: PALETTE.steelDark,
      px: PALETTE.steel,
      topColor: PALETTE.steelDark
    });
    m.box(0.801, 0.24, 0.805, 0.76, 4, H - 2, { color: PALETTE.steelDeep, d: 0.05 });
    m.box(0.806, 0.28, 0.81, 0.5, H - 9, H - 4, { color: PALETTE.steelDeep, d: 0.06 });
    m.box(0.812, 0.3, 0.816, 0.48, H - 8.2, H - 5, { color: PALETTE.yellow, d: 0.07 });
    m.box(0.806, 0.56, 0.81, 0.72, 8, 9.4, { color: PALETTE.steelLight, d: 0.06 });
    m.disc(0.82, 0.62, 0.07, H - 2.2, PALETTE.orange, { d: 0.08 });
    m.glow(0.86, 0.62, H - 2, 10, PALETTE.orange, 0.45);
    m.box(0.16, 0.16, 0.84, 0.84, H, H + 1.6, { color: PALETTE.steel, topColor: PALETTE.steelLight });
    for (var i = 0; i < 3; i++) {
      m.box(0.3 + i * 0.14, 0.801, 0.38 + i * 0.14, 0.805, H - 6, H - 3,
        { color: PALETTE.steelDeep, d: 0.05 });
    }
  });

  /* ---- fixtures ----------------------------------------------------------*/

  def('teleporter_chute', {
    group: 'fixture',
    title: 'Teleporter chute',
    note: 'A hole in the floor with a lit rim and a loading mouth on one side. Machinery, not magic: it is lit safety yellow, not prize green.'
  }, function (m) {
    m.box(0, 0, 1, 1, -4, -0.6, { color: PALETTE.steelDeep, topColor: PALETTE.steelDark });
    m.disc(0.5, 0.5, 0.42, -0.4, PALETTE.steelDark, { d: 0.01 });
    m.disc(0.5, 0.5, 0.33, -0.3, PALETTE.oil, { d: 0.02 });
    // Throat: a cone sinking away under the floor.
    for (var i = 0; i < 6; i++) {
      var t = i / 6;
      m.disc(0.5, 0.5, 0.31 - t * 0.2, -0.28 - t * 0.5,
        rgba(PALETTE.yellow, 0.05 + t * 0.06), { d: 0.03 + t * 0.001 });
    }
    for (i = 0; i < 8; i++) {
      var a = Math.PI * 2 * i / 8;
      var cu = 0.5 + Math.cos(a) * 0.37;
      var cv = 0.5 + Math.sin(a) * 0.37;
      m.disc(cu, cv, 0.05, -0.2, i % 2 ? PALETTE.yellow : PALETTE.yellowDeep, { d: 0.05 });
    }
    m.glow(0.5, 0.5, 0, 16, PALETTE.yellow, 0.45);
    // Loading mouth on the west side, so the chute has a facing.
    m.box(-0.02, 0.28, 0.16, 0.72, 0, 7, { color: PALETTE.steelDark, topColor: PALETTE.steel, d: 0.04 });
    m.poly([[0.16, 0.3, 7], [0.34, 0.42, 0.4], [0.34, 0.58, 0.4], [0.16, 0.7, 7]],
      dark(PALETTE.steel, 0.3), { d: 0.05 });
    chevrons(m, 0.18, 0.34, 0.5, 0.1, 3.4, PALETTE.yellow, 2, 0.85);
    m.box(-0.03, 0.26, 0.17, 0.3, 6.8, 8.4, { color: PALETTE.orange, d: 0.06 });
    m.box(-0.03, 0.7, 0.17, 0.74, 6.8, 8.4, { color: PALETTE.orange, d: 0.06 });
  });

  def('power_cell', {
    group: 'fixture',
    title: 'Power cell',
    note: 'The pickup that pays for light. Same yellow as the searchlight and the frontier, because that is literally what it buys.'
  }, function (m) {
    m.shadow(0.5, 0.5, 12, 0.4);
    m.disc(0.5, 0.5, 0.34, 0.4, PALETTE.steelDark, { d: 0.01 });
    m.cyl(0.5, 0.5, 0.24, 1, 3.6, { color: PALETTE.steelDeep, topColor: PALETTE.steelDark });
    m.cyl(0.5, 0.5, 0.2, 3.6, 11.4, { color: PALETTE.yellowDeep, topColor: PALETTE.yellow });
    m.cyl(0.5, 0.5, 0.215, 5, 9.4, { color: PALETTE.yellow, open: true, d: 0.02 });
    m.cyl(0.5, 0.5, 0.24, 11.4, 14.4, { color: PALETTE.steel, topColor: PALETTE.steelLight });
    var cage = [[0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]];
    for (var i = 0; i < cage.length; i++) {
      m.box(cage[i][0] - 0.035, cage[i][1] - 0.035, cage[i][0] + 0.035, cage[i][1] + 0.035,
        1.8, 14.6, { color: PALETTE.steelLight, d: 0.04 });
    }
    m.box(0.44, 0.44, 0.56, 0.56, 14.4, 15.8, { color: PALETTE.steelDark, topColor: PALETTE.steel });
    m.glow(0.5, 0.5, 8, 19, PALETTE.yellow, 0.7);
  });

  /* ---- actors ------------------------------------------------------------*/

  def('player_dispatcher', {
    group: 'actor',
    title: 'Dispatcher cart',
    note: 'You. A hover cart with a searchlight, and the beam is the search frontier: where it points is where the algorithm is about to look.',
    facing: true
  }, function (m) {
    m.shadow(0.5, 0.56, 13, 0.5);
    // The beam lands on the floor ahead, in front of everything on this tile.
    m.poly([
      [0.86, 0.42, 15], [0.86, 0.58, 15], [2.0, 0.98, 0.6], [2.0, 0.02, 0.6]
    ], rgba(PALETTE.yellow, 0.16), { d: 0.5 });
    m.poly([
      [0.88, 0.46, 14.6], [0.88, 0.54, 14.6], [1.7, 0.78, 0.6], [1.7, 0.22, 0.6]
    ], rgba(PALETTE.yellow, 0.22), { d: 0.52 });
    m.glow(0.5, 0.5, 4, 14, PALETTE.yellow, 0.3);
    m.cyl(0.5, 0.5, 0.32, 6.4, 9.4, { color: PALETTE.steelDeep, topColor: PALETTE.steelDark });
    m.cyl(0.5, 0.5, 0.29, 9.4, 12.4, { color: PALETTE.steel, topColor: PALETTE.steelLight });
    m.cyl(0.5, 0.5, 0.3, 8.6, 9.2, { color: PALETTE.yellow, open: true, d: 0.03 });
    m.box(0.24, 0.3, 0.76, 0.7, 12.4, 17.4, {
      color: PALETTE.steelLight,
      px: PALETTE.steelPale,
      topColor: PALETTE.steelPale
    });
    m.box(0.22, 0.32, 0.78, 0.38, 13.2, 15.2, { color: PALETTE.yellow, d: 0.04 });
    m.box(0.22, 0.62, 0.78, 0.68, 13.2, 15.2, { color: PALETTE.yellow, d: 0.04 });
    m.box(0.3, 0.36, 0.62, 0.64, 17.4, 22.4, {
      color: PALETTE.steelDark, px: PALETTE.steelDeep, topColor: PALETTE.steel
    });
    m.box(0.621, 0.4, 0.625, 0.6, 18.4, 21.4, { color: PALETTE.explored, d: 0.05 });
    // Searchlight on a yoke, aimed east.
    m.box(0.6, 0.44, 0.68, 0.56, 14.6, 16.6, { color: PALETTE.steelDark, d: 0.05 });
    m.box(0.66, 0.4, 0.88, 0.6, 12.4, 17.2, {
      color: PALETTE.steel, px: PALETTE.yellow, topColor: PALETTE.steelLight, d: 0.06
    });
    m.box(0.881, 0.42, 0.9, 0.58, 12.8, 16.8, { color: PALETTE.yellow, d: 0.07 });
    m.glow(0.95, 0.5, 14.8, 13, PALETTE.yellow, 0.75);
    m.line([[0.36, 0.5, 22.4], [0.3, 0.5, 30]], PALETTE.steelLight, 1, { d: 0.06 });
    m.disc(0.3, 0.5, 0.05, 30.4, PALETTE.orange, { d: 0.07 });
  });

  def('prize', {
    group: 'actor',
    title: 'The prize',
    note: 'The one thing in the factory that glows green, floating a finger above its pedestal. Nothing else may use this colour.'
  }, function (m) {
    m.glow(0.5, 0.5, 2, 26, PALETTE.prize, 0.3, -8);
    m.box(0.12, 0.12, 0.88, 0.88, 0, 4, { color: PALETTE.steelDeep, topColor: PALETTE.steelDark });
    m.box(0.2, 0.2, 0.8, 0.8, 4, 9, { color: PALETTE.steelDark, topColor: PALETTE.steel });
    m.box(0.16, 0.16, 0.84, 0.84, 9, 10.4, { color: PALETTE.steel, topColor: PALETTE.steelLight });
    m.disc(0.5, 0.5, 0.26, 10.6, rgba(PALETTE.prize, 0.55), { d: 0.02 });
    m.glow(0.5, 0.5, 12, 14, PALETTE.prize, 0.55);
    // The crate itself, lifted clear of the pedestal.
    m.box(0.27, 0.27, 0.73, 0.73, 13.6, 25.6, {
      color: PALETTE.steelDark, topColor: PALETTE.steel
    });
    var b = 0.05;
    var braces = [[0.27, 0.27], [0.73 - b, 0.27], [0.27, 0.73 - b], [0.73 - b, 0.73 - b]];
    for (var i = 0; i < braces.length; i++) {
      m.box(braces[i][0], braces[i][1], braces[i][0] + b, braces[i][1] + b, 13.6, 26.2,
        { color: PALETTE.steelLight, d: 0.02 });
    }
    // Light leaking between the slats.
    [[0.731, 0.735, true], [0.265, 0.269, true]].forEach(function (s) {
      m.box(s[0], 0.32, s[1], 0.68, 16.4, 17.4, { color: PALETTE.prize, d: 0.05 });
      m.box(s[0], 0.32, s[1], 0.68, 21, 22, { color: PALETTE.prize, d: 0.05 });
      m.box(0.32, s[0], 0.68, s[1], 16.4, 17.4, { color: PALETTE.prize, d: 0.05 });
      m.box(0.32, s[0], 0.68, s[1], 21, 22, { color: PALETTE.prize, d: 0.05 });
    });
    m.box(0.3, 0.3, 0.7, 0.7, 25.6, 26.6, { color: PALETTE.prize, topColor: PALETTE.prize, d: 0.05 });
    m.glow(0.5, 0.5, 26, 20, PALETTE.prize, 0.6);
    m.poly([[0.34, 0.34, 27], [0.66, 0.66, 27], [0.62, 0.62, 44], [0.38, 0.38, 44]],
      rgba(PALETTE.prize, 0.12), { d: 0.6 });
  });

  def('chest', {
    group: 'actor',
    title: 'Lockbox',
    note: 'What the thieves drag. Popped up out of the floor, lid latched, one orange lock lamp.'
  }, function (m) {
    m.shadow(0.5, 0.52, 12, 0.45);
    m.box(0.18, 0.22, 0.82, 0.78, 0, 8.4, {
      color: PALETTE.steelDark, px: PALETTE.steel, topColor: PALETTE.steelDark
    });
    m.box(0.15, 0.19, 0.85, 0.81, 8.4, 11.6, {
      color: PALETTE.steel, topColor: PALETTE.steelLight
    });
    m.box(0.15, 0.44, 0.85, 0.56, 11.6, 12, { color: PALETTE.yellow, topColor: PALETTE.yellow, d: 0.04 });
    m.box(0.851, 0.42, 0.87, 0.58, 6.4, 10, { color: PALETTE.steelDeep, d: 0.05 });
    m.disc(0.88, 0.5, 0.06, 8.6, PALETTE.orange, { d: 0.06 });
    m.glow(0.9, 0.5, 8.4, 8, PALETTE.orange, 0.4);
    bolts(m, 0.22, 0.26, 0.78, 0.74, 11.8, dark(PALETTE.steelLight, 0.3));
  });

  def('chest_open', {
    group: 'actor',
    title: 'Lockbox, opened',
    note: 'The same box with the lid thrown back and the contents gone. Reads as "too late" at a glance.'
  }, function (m) {
    m.shadow(0.5, 0.52, 12, 0.45);
    m.box(0.18, 0.22, 0.82, 0.78, 0, 8.4, {
      color: PALETTE.steelDark, px: PALETTE.steel, topColor: PALETTE.oil
    });
    m.box(0.21, 0.25, 0.79, 0.75, 6.6, 7, { color: PALETTE.steelDeep, topColor: PALETTE.steelDeep, d: 0.03 });
    m.glow(0.5, 0.5, 8, 11, PALETTE.yellow, 0.25);
    // The lid, hinged on the north edge and thrown over backwards.
    m.poly([
      [0.18, 0.22, 8.4], [0.82, 0.22, 8.4], [0.82, -0.08, 15.4], [0.18, -0.08, 15.4]
    ], faceLeft(PALETTE.steel), { d: 0.04 });
    m.poly([
      [0.18, 0.2, 8.7], [0.82, 0.2, 8.7], [0.82, -0.1, 15.7], [0.18, -0.1, 15.7]
    ], faceTop(PALETTE.steelLight), { d: 0.05 });
    m.poly([
      [0.44, 0.2, 8.8], [0.56, 0.2, 8.8], [0.56, -0.1, 15.8], [0.44, -0.1, 15.8]
    ], PALETTE.yellow, { d: 0.06 });
    m.box(0.82, -0.08, 0.86, 0.22, 8.2, 15.6, { color: PALETTE.steelDark, d: 0.05 });
  });

  def('thief_scout', {
    group: 'thief',
    title: 'Scout',
    note: 'Fast. Two long legs, a thin forward-leaning body, one big eye and a whip aerial: tall, narrow, always ahead of you.',
    facing: true
  }, function (m) {
    m.shadow(0.5, 0.5, 11, 0.4);
    // The stance is spread along the screen axis (u - v), which is the only
    // direction two legs can be told apart in an isometric projection.
    m.box(0.18, 0.62, 0.36, 0.8, 0, 1.8, { color: PALETTE.steelDeep, topColor: PALETTE.steelDark });
    m.box(0.58, 0.2, 0.76, 0.38, 0, 1.8, { color: PALETTE.steelDeep, topColor: PALETTE.steelDark });
    m.poly([[0.23, 0.71, 1.6], [0.31, 0.71, 1.6], [0.47, 0.57, 14], [0.39, 0.57, 14]],
      PALETTE.steel, { d: 0.2 });
    m.poly([[0.63, 0.29, 1.6], [0.71, 0.29, 1.6], [0.57, 0.45, 14], [0.49, 0.45, 14]],
      PALETTE.steelLight, { d: -0.2 });
    m.box(0.34, 0.36, 0.66, 0.64, 13, 23, {
      color: PALETTE.steelLight, px: PALETTE.steelPale, topColor: PALETTE.steelPale, d: 0.02
    });
    m.box(0.32, 0.345, 0.68, 0.385, 15, 17, { color: PALETTE.hazard, d: 0.04 });
    m.box(0.32, 0.615, 0.68, 0.655, 15, 17, { color: PALETTE.hazard, d: 0.04 });
    m.box(0.5, 0.38, 0.8, 0.62, 22.4, 28.4, {
      color: PALETTE.steelDark, px: PALETTE.steelDeep, topColor: PALETTE.steel, d: 0.05
    });
    m.box(0.801, 0.42, 0.815, 0.58, 23.8, 26.6, { color: PALETTE.hazard, d: 0.06 });
    m.glow(0.88, 0.5, 25.2, 13, PALETTE.hazard, 0.55);
    m.line([[0.56, 0.5, 28.4], [0.4, 0.5, 36]], PALETTE.steelLight, 1, { d: 0.06 });
    m.disc(0.4, 0.5, 0.05, 36.2, PALETTE.hazard, { d: 0.07 });
  });

  def('thief_hauler', {
    group: 'thief',
    title: 'Hauler',
    note: 'Heavy. Tracks, a wide low chassis and forks out front with a lockbox already in them. It fills its tile - you can see it coming.',
    facing: true
  }, function (m) {
    m.shadow(0.5, 0.5, 17, 0.5);
    m.box(0.04, 0.08, 0.96, 0.3, 0, 7.4, { color: PALETTE.oil, topColor: PALETTE.steelDeep });
    m.box(0.04, 0.7, 0.96, 0.92, 0, 7.4, { color: PALETTE.oil, topColor: PALETTE.steelDeep });
    for (var i = 0; i < 5; i++) {
      var u = 0.08 + i * 0.18;
      m.box(u, 0.07, u + 0.07, 0.31, 1.6, 3.4, { color: PALETTE.steelDark, d: 0.03 });
      m.box(u, 0.69, u + 0.07, 0.93, 1.6, 3.4, { color: PALETTE.steelDark, d: 0.03 });
    }
    m.box(0.08, 0.14, 0.92, 0.86, 7.4, 15, {
      color: PALETTE.steelDark, px: PALETTE.steel, topColor: PALETTE.steel
    });
    chevrons(m, 0.12, 0.88, 0.5, 0.26, 15.2, PALETTE.hazard, 3, 0.9);
    m.box(0.12, 0.26, 0.48, 0.74, 15, 23.5, {
      color: PALETTE.steelDeep, px: PALETTE.steelDark, topColor: PALETTE.steelDark, d: 0.02
    });
    m.box(0.481, 0.3, 0.49, 0.7, 18.5, 20.8, { color: PALETTE.hazard, d: 0.05 });
    m.glow(0.56, 0.5, 19.6, 13, PALETTE.hazard, 0.42);
    m.box(0.14, 0.28, 0.46, 0.34, 23.5, 24.6, { color: PALETTE.steel, d: 0.03 });
    // Forks, and the box they have already taken.
    m.box(0.9, 0.22, 1.34, 0.34, 6.4, 8, { color: PALETTE.steelLight, d: 0.06 });
    m.box(0.9, 0.66, 1.34, 0.78, 6.4, 8, { color: PALETTE.steelLight, d: 0.06 });
    m.box(0.96, 0.2, 1.04, 0.8, 6, 16, { color: PALETTE.steelDark, d: 0.05 });
    m.box(1.04, 0.26, 1.36, 0.74, 8, 16.4, {
      color: PALETTE.steel, px: PALETTE.steelDark, topColor: PALETTE.steelLight, d: 0.07
    });
    m.box(1.04, 0.44, 1.37, 0.56, 16.4, 16.9, { color: PALETTE.yellow, topColor: PALETTE.yellow, d: 0.08 });
  });

  def('thief_sneak', {
    group: 'thief',
    title: 'Sneak',
    note: 'Low. A flat shell on four splayed legs with a dimmed visor slit - half the height of the others, so it hides behind a crate.',
    facing: true
  }, function (m) {
    m.shadow(0.5, 0.5, 12, 0.34);
    var feet = [[0.12, 0.16], [0.8, 0.16], [0.12, 0.84], [0.8, 0.84]];
    for (var i = 0; i < feet.length; i++) {
      m.poly([
        [feet[i][0] + 0.04, feet[i][1] + 0.04, 0.6], [feet[i][0] + 0.09, feet[i][1] + 0.09, 0.6],
        [0.52, 0.52, 7.4], [0.47, 0.47, 7.4]
      ], dark(PALETTE.steelLight, 0.45), { d: -0.2 });
      m.box(feet[i][0], feet[i][1], feet[i][0] + 0.08, feet[i][1] + 0.08, 0, 1.6,
        { color: PALETTE.steelDeep, topColor: PALETTE.steelDark, d: -0.18 });
    }
    m.box(0.22, 0.24, 0.78, 0.76, 4.4, 9.4, {
      color: PALETTE.steelDeep, px: PALETTE.steelDark, topColor: PALETTE.steelDeep
    });
    m.poly([
      [0.26, 0.28, 9.4], [0.74, 0.28, 9.4], [0.82, 0.5, 13.4], [0.74, 0.72, 9.4],
      [0.26, 0.72, 9.4], [0.18, 0.5, 13.4]
    ], faceTop(PALETTE.steel), { d: 0.03 });
    m.poly([
      [0.74, 0.28, 9.4], [0.82, 0.5, 13.4], [0.74, 0.72, 9.4]
    ], dark(PALETTE.steel, 0.42), { d: 0.04 });
    m.line([[0.26, 0.28, 9.5], [0.74, 0.28, 9.5]], PALETTE.steelLight, 0.9, { d: 0.035 });
    m.box(0.821, 0.4, 0.835, 0.6, 10.4, 11.6, { color: PALETTE.hazard, d: 0.05 });
    m.glow(0.88, 0.5, 11, 10, PALETTE.hazard, 0.3);
    m.box(0.28, 0.46, 0.44, 0.54, 13.2, 13.9, { color: PALETTE.steelDark, topColor: PALETTE.steelLight, d: 0.04 });
    m.poly([[0.24, 0.34, 9.8], [0.4, 0.28, 9.8], [0.34, 0.44, 9.8]],
      rgba(PALETTE.steelPale, 0.22), { d: 0.05 });
  });

  /* ---- search overlays ---------------------------------------------------
   *
   * These are the search painted onto the factory, and they are deliberately
   * the only three saturated things on an empty floor: cold blue for ground
   * already taken, safety yellow lifted off the deck for the frontier the
   * dispatcher is holding, warning orange for the committed route.
   */

  def('overlay_explored', {
    group: 'overlay',
    title: 'Explored',
    note: 'A cold wash laid ON the plate, never replacing it: on weighted floors the ground underneath is the lesson.'
  }, function (m) {
    m.poly([[0.02, 0.02, 0.5], [0.98, 0.02, 0.5], [0.98, 0.98, 0.5], [0.02, 0.98, 0.5]],
      rgba(PALETTE.explored, 0.26));
    m.poly([[0.12, 0.12, 0.7], [0.88, 0.12, 0.7], [0.88, 0.88, 0.7], [0.12, 0.88, 0.7]],
      rgba(PALETTE.explored, 0.16), { d: 0.01 });
    m.line([[0.1, 0.34, 0.9], [0.9, 0.34, 0.9]], rgba(PALETTE.steelPale, 0.08), 0.8, { d: 0.02 });
    m.line([[0.1, 0.66, 0.9], [0.9, 0.66, 0.9]], rgba(PALETTE.steelPale, 0.08), 0.8, { d: 0.02 });
  });

  def('overlay_frontier', {
    group: 'overlay',
    title: 'Frontier',
    note: 'A pool of searchlight on the deck with the scan frame hovering over it, tethered at the corners. Lifted, because the frontier is what the dispatcher is still holding up.'
  }, function (m) {
    // A pool of light on the deck, and the frame of the scan hovering over it.
    m.glow(0.5, 0.5, 1, 15, PALETTE.yellow, 0.26, -1);
    m.poly([[0.06, 0.06, 0.5], [0.94, 0.06, 0.5], [0.94, 0.94, 0.5], [0.06, 0.94, 0.5]],
      rgba(PALETTE.yellow, 0.26));
    var tether = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
    for (var i = 0; i < tether.length; i++) {
      m.line([[tether[i][0], tether[i][1], 0.5], [tether[i][0], tether[i][1], 5.6]],
        rgba(PALETTE.yellow, 0.45), 0.9);
    }
    // Four full-length strips, so a quarter turn maps the ring onto itself.
    var w = 0.085;
    var rim = [
      [0.08, 0.08, 0.92, 0.08 + w], [0.08, 0.92 - w, 0.92, 0.92],
      [0.08, 0.08, 0.08 + w, 0.92], [0.92 - w, 0.08, 0.92, 0.92]
    ];
    for (i = 0; i < rim.length; i++) {
      m.box(rim[i][0], rim[i][1], rim[i][2], rim[i][3], 5.2, 6.2, {
        color: PALETTE.yellowDeep, topColor: PALETTE.yellow, d: 0.05
      });
    }
    m.glow(0.5, 0.5, 6, 13, PALETTE.yellow, 0.34);
  });

  def('overlay_path_straight', {
    group: 'overlay',
    title: 'Path, straight',
    note: 'The committed route, riding above every tile so nothing can bury it. Chevrons point the way of travel.'
  }, function (m) {
    m.box(-0.02, 0.38, 1.02, 0.62, 6.6, 8.4, {
      color: PALETTE.orangeDeep, topColor: PALETTE.orange
    });
    chevrons(m, 0.02, 0.98, 0.5, 0.14, 8.6, PALETTE.yellow, 2, 0.7);
    m.glow(0.5, 0.5, 8, 14, PALETTE.orange, 0.2);
  });

  def('overlay_path_corner', {
    group: 'overlay',
    title: 'Path, corner',
    note: 'Enters from the west edge, leaves by the south. The four rotations are the four corners.'
  }, function (m) {
    m.box(-0.02, 0.38, 0.62, 0.62, 6.6, 8.4, {
      color: PALETTE.orangeDeep, topColor: PALETTE.orange
    });
    m.box(0.38, 0.38, 0.62, 1.02, 6.6, 8.4, {
      color: PALETTE.orangeDeep, topColor: PALETTE.orange, d: 0.01
    });
    m.poly([[0.43, 0.43, 8.6], [0.57, 0.43, 8.6], [0.57, 0.57, 8.6], [0.43, 0.57, 8.6]],
      rgba(PALETTE.yellow, 0.7), { d: 0.02 });
    m.glow(0.5, 0.5, 8, 14, PALETTE.orange, 0.2);
  });

  def('overlay_path_end', {
    group: 'overlay',
    title: 'Path, end',
    note: 'Arrives from the west and stops. A ring and a post, so the end of a leg is a place rather than a stub.'
  }, function (m) {
    m.box(-0.02, 0.38, 0.5, 0.62, 6.6, 8.4, {
      color: PALETTE.orangeDeep, topColor: PALETTE.orange
    });
    m.disc(0.5, 0.5, 0.3, 6.8, PALETTE.orangeDeep, { d: 0.01 });
    m.disc(0.5, 0.5, 0.22, 8.5, PALETTE.orange, { d: 0.02 });
    m.box(0.46, 0.46, 0.54, 0.54, 8.5, 15, { color: PALETTE.steelLight, d: 0.03 });
    m.disc(0.5, 0.5, 0.12, 15.4, PALETTE.yellow, { d: 0.04 });
    m.glow(0.5, 0.5, 15, 13, PALETTE.yellow, 0.45);
  });

  /* ------------------------------------------------------------- pipeline ---*/

  var cache = {};

  function polygons(name, rot) {
    var d = DEFS[name];
    if (!d) { throw new Error('unknown sprite: ' + name); }
    rot = rot & 3;
    var key = name + '|' + rot;
    if (cache[key]) { return cache[key]; }
    var m = new Model(rot);
    d.build(m, rot);
    m.parts.sort(function (a, b) {
      return (a.key - b.key) || (a.seq - b.seq);
    });
    cache[key] = m.parts;
    return m.parts;
  }

  function bounds(name, rot) {
    var parts = polygons(name, rot);
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    parts.forEach(function (p) {
      if (p.kind === 'glow') {
        b.x0 = Math.min(b.x0, p.cx - p.r); b.x1 = Math.max(b.x1, p.cx + p.r);
        b.y0 = Math.min(b.y0, p.cy - p.r); b.y1 = Math.max(b.y1, p.cy + p.r);
        return;
      }
      p.pts.forEach(function (q) {
        b.x0 = Math.min(b.x0, q[0]); b.x1 = Math.max(b.x1, q[0]);
        b.y0 = Math.min(b.y0, q[1]); b.y1 = Math.max(b.y1, q[1]);
      });
    });
    return b;
  }

  // Quantised so that a rotation which lands on the same picture through a
  // different arithmetic route still compares equal (and so that -0 and 0 are
  // the same number, which they are).
  function q2(v) {
    var n = Math.round(v * 100) / 100;
    return (n === 0 ? 0 : n).toFixed(2);
  }

  // A rotation permutes the vertex list of a shape it leaves in place, so the
  // key starts the ring at its smallest vertex and takes whichever winding
  // reads lower. Two identical pictures then produce one key.
  function ringKey(pts) {
    var s = pts.map(function (q) { return q2(q[0]) + ',' + q2(q[1]); });
    var best = null;
    var dirs = [s, s.slice().reverse()];
    for (var d = 0; d < dirs.length; d++) {
      for (var i = 0; i < dirs[d].length; i++) {
        var cand = dirs[d].slice(i).concat(dirs[d].slice(0, i)).join(' ');
        if (best === null || cand < best) { best = cand; }
      }
    }
    return best;
  }

  function partKey(p) {
    if (p.kind === 'glow') {
      return 'g' + q2(p.cx) + ',' + q2(p.cy) + ',' + p.r + p.color + p.alpha;
    }
    return p.kind + (p.fill || '') + (p.stroke || '') + ringKey(p.pts);
  }

  function signature(name, rot) {
    return polygons(name, rot).map(partKey).join('|');
  }

  // Which of the four rotations are actually different pictures. Symmetric
  // pieces say so here instead of shipping four identical sheets. The
  // comparison is on the set of painted shapes, not the paint order: a turn
  // that only re-sorts identical parts paints the same picture.
  function shapeSet(name, rot) {
    return polygons(name, rot).map(partKey).sort().join('|');
  }

  function distinctRotations(name) {
    var seen = {};
    var out = [];
    for (var r = 0; r < 4; r++) {
      var s = shapeSet(name, r);
      if (seen[s] === undefined) { seen[s] = r; out.push(r); }
    }
    return out;
  }

  // rotationMap(name)[r] is the rotation whose picture r repeats - itself when
  // r is one of the distinct ones.
  function rotationMap(name) {
    var seen = {};
    var out = [];
    for (var r = 0; r < 4; r++) {
      var s = shapeSet(name, r);
      if (seen[s] === undefined) { seen[s] = r; }
      out.push(seen[s]);
    }
    return out;
  }

  /* ---- canvas ------------------------------------------------------------*/

  function paintPart(ctx, p) {
    if (p.kind === 'glow') {
      var g = ctx.createRadialGradient(p.cx, p.cy, 0, p.cx, p.cy, p.r);
      g.addColorStop(0, rgba(p.color, p.alpha));
      g.addColorStop(0.55, rgba(p.color, p.alpha * 0.35));
      g.addColorStop(1, rgba(p.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.cx, p.cy, p.r, p.r * TILE_H / TILE_W * 1.35, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    for (var i = 0; i < p.pts.length; i++) {
      if (i === 0) { ctx.moveTo(p.pts[i][0], p.pts[i][1]); } else { ctx.lineTo(p.pts[i][0], p.pts[i][1]); }
    }
    if (p.kind === 'poly') {
      ctx.closePath();
      ctx.fillStyle = p.fill;
      ctx.fill();
    }
    if (p.stroke) {
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.width || 1;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  function draw(ctx, name, rot, opts) {
    opts = opts || {};
    var parts = polygons(name, rot);
    ctx.save();
    ctx.translate(opts.x || 0, opts.y || 0);
    if (opts.scale && opts.scale !== 1) { ctx.scale(opts.scale, opts.scale); }
    if (opts.alpha !== undefined) { ctx.globalAlpha *= opts.alpha; }
    for (var i = 0; i < parts.length; i++) {
      // skipGlow drops the bloom: what is left is the solid shape, which is
      // what a silhouette check and a low-quality mode both want.
      if (opts.skipGlow && parts[i].kind === 'glow') { continue; }
      paintPart(ctx, parts[i]);
    }
    ctx.restore();
  }

  // An offscreen tile for a fixed zoom. Returns {canvas, ox, oy}: blit it at
  // (tileScreenX + ox, tileScreenY + oy).
  function prerender(name, rot, scale) {
    scale = scale || 1;
    var b = bounds(name, rot);
    var pad = 2;
    var w = Math.ceil((b.x1 - b.x0) * scale) + pad * 2;
    var h = Math.ceil((b.y1 - b.y0) * scale) + pad * 2;
    var c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    var ctx = c.getContext('2d');
    draw(ctx, name, rot, { x: -b.x0 * scale + pad, y: -b.y0 * scale + pad, scale: scale });
    return { canvas: c, ox: b.x0 * scale - pad, oy: b.y0 * scale - pad, scale: scale };
  }

  /* ---- svg ---------------------------------------------------------------
   *
   * The sheets in docs/art/sprites are rendered from these same definitions,
   * so the SVG and the canvas cannot drift apart.
   */

  function svgBody(name, rot, idPrefix) {
    var parts = polygons(name, rot);
    var defs = [];
    var body = [];
    parts.forEach(function (p, i) {
      if (p.kind === 'glow') {
        var id = idPrefix + i;
        defs.push('<radialGradient id="' + id + '" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0" stop-color="' + p.color + '" stop-opacity="' + p.alpha + '"/>' +
          '<stop offset="0.55" stop-color="' + p.color + '" stop-opacity="' + (p.alpha * 0.35).toFixed(3) + '"/>' +
          '<stop offset="1" stop-color="' + p.color + '" stop-opacity="0"/></radialGradient>');
        body.push('<ellipse cx="' + p.cx.toFixed(2) + '" cy="' + p.cy.toFixed(2) +
          '" rx="' + p.r.toFixed(2) + '" ry="' + (p.r * TILE_H / TILE_W * 1.35).toFixed(2) +
          '" fill="url(#' + id + ')"/>');
        return;
      }
      var pts = p.pts.map(function (q) { return q[0].toFixed(2) + ',' + q[1].toFixed(2); }).join(' ');
      var attrs = p.kind === 'poly'
        ? 'fill="' + p.fill + '"'
        : 'fill="none"';
      if (p.stroke) {
        attrs += ' stroke="' + p.stroke + '" stroke-width="' + (p.width || 1) +
          '" stroke-linejoin="round" stroke-linecap="round"';
      }
      body.push('<' + (p.kind === 'poly' ? 'polygon' : 'polyline') + ' points="' + pts + '" ' + attrs + '/>');
    });
    return { defs: defs, body: body };
  }

  function svg(name, rot, opts) {
    opts = opts || {};
    var scale = opts.scale || 4;
    var b = bounds(name, rot);
    var pad = 3;
    var w = (b.x1 - b.x0 + pad * 2);
    var h = (b.y1 - b.y0 + pad * 2);
    var s = svgBody(name, rot, 'g');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(w * scale) +
      '" height="' + Math.round(h * scale) + '" viewBox="' +
      (b.x0 - pad).toFixed(2) + ' ' + (b.y0 - pad).toFixed(2) + ' ' +
      w.toFixed(2) + ' ' + h.toFixed(2) + '">' +
      (s.defs.length ? '<defs>' + s.defs.join('') + '</defs>' : '') +
      '<g shape-rendering="geometricPrecision">' + s.body.join('') + '</g></svg>';
  }

  /* ---------------------------------------------------------------- api ---*/

  var DIR = { east: 0, south: 1, west: 2, north: 3 };

  // Compose a board rotation with a sprite that has a front. `authored` is
  // the direction the artwork looks at rotation 0, `target` the grid
  // direction it should look on this board.
  function orient(boardRot, authored, target) {
    return (boardRot + authored - target) & 3;
  }

  return {
    version: 1,
    DIR: DIR,
    orient: orient,
    face: function (boardRot, facing) { return orient(boardRot, DIR.east, facing || 0); },
    TILE_W: TILE_W,
    TILE_H: TILE_H,
    WALL_H: WALL_H,
    PALETTE: PALETTE,
    LIGHT: LIGHT,
    DERIVED: DERIVED,
    names: function () { return ORDER.slice(); },
    meta: function (name) {
      if (!DEFS[name]) { throw new Error('unknown sprite: ' + name); }
      return DEFS[name].meta;
    },
    polygons: polygons,
    bounds: bounds,
    signature: signature,
    distinctRotations: distinctRotations,
    rotationMap: rotationMap,
    draw: draw,
    prerender: prerender,
    svg: svg,
    svgBody: svgBody
  };
}());

if (typeof module !== 'undefined' && module.exports) { module.exports = Sprites; }
