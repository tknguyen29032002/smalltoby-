/* render.js - isometric board renderer.
 *
 * The map is the screen: one full-viewport canvas, a camera you can pan and
 * zoom, and tiles with height so the world reads as a place rather than a
 * spreadsheet. Plain 2D canvas calls only - no WebGL, no dependencies, works
 * from file://.
 *
 *   createCamera()                        -> {x, y, scale}
 *   fitCamera(cam, grid, w, h, pad)       -> camera that frames the level
 *   drawScene(canvas, grid, trace, i, cam, opts)
 *   screenToCell(cam, grid, sx, sy)       -> {x, y} or null
 *
 * opts:
 *   breachAt   index after which the run is over budget (tiles go red)
 *   cursor     true to mark the cell expanded on this step
 *   teleports  [{a:{x,y}, b:{x,y}}] drawn as linked pads (level 6)
 *   sides      map of cell index -> 0|1, colours a bidirectional frontier
 *   frontierOver  true once the frontier has passed the memory budget
 *   dim        0..1, fades the whole board (used behind overlays)
 */

var TILE_W = 32;
var TILE_H = 16;
var WALL_H = 8;
var SWAMP_SINK = 7;
var FRONTIER_LIFT = 6;
var RIBBON_H = 12;

var COLORS = {
  grass: '#e9e4d6',
  swamp: '#7fa070',
  wall: '#4a5273',
  exploredEarly: '#eef4ff',
  exploredLate: '#4f7bc9',
  exploredBust: '#e8503a',
  frontier: '#ffc94d',
  frontierB: '#59d0ff',
  path: '#ff5d73',
  start: '#27ae72',
  goal: '#e8503a',
  teleport: '#b07cff'
};

/* ---------- colour helpers ---------- */

function hex2(v) { return ('0' + Math.round(v).toString(16)).slice(-2); }

// Returns hex, so results can be fed back into mixColor or shade.
function mixColor(a, b, t) {
  function p(h, i) { return parseInt(h.substr(i, 2), 16); }
  return '#' + hex2(p(a, 1) + (p(b, 1) - p(a, 1)) * t) +
    hex2(p(a, 3) + (p(b, 3) - p(a, 3)) * t) +
    hex2(p(a, 5) + (p(b, 5) - p(a, 5)) * t);
}

function shade(hex, f) {
  return mixColor('#000000', hex, f);
}

/* ---------- camera ---------- */

function createCamera() {
  return { x: 0, y: 0, scale: 1 };
}

// Frame the whole level with a little air around it.
function fitCamera(cam, grid, viewW, viewH, pad) {
  pad = pad === undefined ? 40 : pad;
  var spanW = (grid.w + grid.h) * TILE_W / 2;
  var spanH = (grid.w + grid.h) * TILE_H / 2 + WALL_H + RIBBON_H;
  var scale = Math.min((viewW - pad * 2) / spanW, (viewH - pad * 2) / spanH);
  cam.scale = Math.max(0.25, Math.min(3.4, scale));
  // World origin sits at the top corner of the diamond.
  cam.x = viewW / 2 + (grid.h - grid.w) * TILE_W / 4 * cam.scale;
  cam.y = viewH / 2 - (grid.w + grid.h) * TILE_H / 4 * cam.scale;
  return cam;
}

function worldOf(x, y, z) {
  return { x: (x - y) * TILE_W / 2, y: (x + y) * TILE_H / 2 - z };
}

// Inverse projection onto the ground plane, for hover and click.
function screenToCell(cam, grid, sx, sy) {
  var wx = (sx - cam.x) / cam.scale;
  var wy = (sy - cam.y) / cam.scale;
  var x = Math.floor((wx / (TILE_W / 2) + wy / (TILE_H / 2)) / 2);
  var y = Math.floor((wy / (TILE_H / 2) - wx / (TILE_W / 2)) / 2);
  if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) { return null; }
  return { x: x, y: y };
}

/* ---------- tiles ---------- */

function tileTop(ctx, wx, wy) {
  ctx.beginPath();
  ctx.moveTo(wx, wy);
  ctx.lineTo(wx + TILE_W / 2, wy + TILE_H / 2);
  ctx.lineTo(wx, wy + TILE_H);
  ctx.lineTo(wx - TILE_W / 2, wy + TILE_H / 2);
  ctx.closePath();
}

function drawTile(ctx, x, y, z, color, depth, outline) {
  var w = worldOf(x, y, z);

  if (depth > 0) {
    ctx.fillStyle = shade(color, 0.6);
    ctx.beginPath();
    ctx.moveTo(w.x - TILE_W / 2, w.y + TILE_H / 2);
    ctx.lineTo(w.x, w.y + TILE_H);
    ctx.lineTo(w.x, w.y + TILE_H + depth);
    ctx.lineTo(w.x - TILE_W / 2, w.y + TILE_H / 2 + depth);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = shade(color, 0.42);
    ctx.beginPath();
    ctx.moveTo(w.x + TILE_W / 2, w.y + TILE_H / 2);
    ctx.lineTo(w.x, w.y + TILE_H);
    ctx.lineTo(w.x, w.y + TILE_H + depth);
    ctx.lineTo(w.x + TILE_W / 2, w.y + TILE_H / 2 + depth);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = color;
  tileTop(ctx, w.x, w.y);
  ctx.fill();
  if (outline !== false) {
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  return w;
}

/* ---------- scene ---------- */

function drawScene(canvas, grid, trace, index, cam, opts) {
  opts = opts || {};
  var ctx = canvas.getContext('2d');
  var dpr = canvas._dpr || 1;
  var cssW = canvas.width / dpr;
  var cssH = canvas.height / dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  ctx.save();
  ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, dpr * cam.x, dpr * cam.y);
  if (opts.dim) { ctx.globalAlpha = 1 - opts.dim; }

  var last = trace ? Math.min(index, trace.steps.length) : 0;
  var order = {};
  var i;
  for (i = 0; i < last; i++) { order[trace.steps[i].i] = i; }

  // Once the run is over the frontier is history: drawing it would bury the
  // shape the search actually drew, which is the whole point of the picture.
  var runOver = !!trace && index >= trace.steps.length;
  var frontier = {};
  if (trace && last > 0 && !runOver) {
    var cells = trace.steps[last - 1].frontierCells;
    for (i = 0; i < cells.length; i++) { frontier[cells[i]] = true; }
  }

  var teleAt = {};
  (opts.teleports || []).forEach(function (t) {
    teleAt[t.a.y * grid.w + t.a.x] = true;
    teleAt[t.b.y * grid.w + t.b.x] = true;
  });

  var breach = opts.breachAt === undefined ? Infinity : opts.breachAt;

  // Painter's order: back to front along x + y.
  for (var d = 0; d <= grid.w + grid.h - 2; d++) {
    for (var x = Math.max(0, d - grid.h + 1); x <= Math.min(d, grid.w - 1); x++) {
      var y = d - x;
      var ch = grid.cells[y][x];
      var idx = y * grid.w + x;

      if (ch === '#') {
        drawTile(ctx, x, y, WALL_H, COLORS.wall, WALL_H + 9);
        continue;
      }

      var swamp = ch === '~';
      var z = swamp ? -SWAMP_SINK : 0;
      var depth = swamp ? 5 : 5 + SWAMP_SINK;
      var base = swamp ? COLORS.swamp : COLORS.grass;
      if (ch === 'S') { base = COLORS.start; }
      if (ch === 'G') { base = COLORS.goal; }
      if (teleAt[idx]) { base = COLORS.teleport; }

      if (frontier[idx]) {
        var side = opts.sides ? opts.sides[idx] : undefined;
        var fc = side === 1 ? COLORS.frontierB : COLORS.frontier;
        if (opts.frontierOver) { fc = mixColor(fc, COLORS.exploredBust, 0.8); }
        drawTile(ctx, x, y, z + FRONTIER_LIFT, fc, depth + FRONTIER_LIFT);
      } else if (order[idx] !== undefined && ch !== 'S' && ch !== 'G') {
        // Explored tints the terrain instead of repainting it: on the weighted
        // maps the ground underneath is the whole lesson. Past the budget the
        // tint turns red, so running out of fuel is visible on the board.
        var k = order[idx];
        var t = last > 1 ? k / (last - 1) : 0;
        var tint = k >= breach
          ? COLORS.exploredBust
          : mixColor(COLORS.exploredEarly, COLORS.exploredLate, t);
        drawTile(ctx, x, y, z, mixColor(base, tint, k >= breach ? 0.5 : 0.56), depth);
      } else {
        drawTile(ctx, x, y, z, base, depth);
      }
    }
  }

  drawEndpointMarker(ctx, grid.start, COLORS.start);
  drawEndpointMarker(ctx, grid.goal, COLORS.goal);
  (opts.teleports || []).forEach(function (t) { drawTeleport(ctx, t); });

  // The cell taken off the frontier on this step, so playback has a heartbeat.
  if (opts.cursor && trace && last > 0 && last < trace.steps.length) {
    var st = trace.steps[last - 1];
    var w = worldOf(st.x, st.y, 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    tileTop(ctx, w.x, w.y);
    ctx.stroke();
  }

  if (runOver && trace.found) {
    drawRibbon(ctx, trace.path);
  }

  ctx.restore();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// The path rides above the tiles, so no amount of shading can bury it.
function drawRibbon(ctx, path) {
  if (!path || path.length < 2) { return; }
  var pts = path.map(function (p) {
    var w = worldOf(p.x, p.y, RIBBON_H);
    return { x: w.x, y: w.y + TILE_H / 2 };
  });

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  strokePath(ctx, pts, 0, 7, 'rgba(0,0,0,0.38)', 8);
  strokePath(ctx, pts, 0, 0, COLORS.path, 6.5);
  strokePath(ctx, pts, 0, -2, 'rgba(255,255,255,0.4)', 1.6);
}

function strokePath(ctx, pts, dx, dy, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (var i = 0; i < pts.length; i++) {
    var x = pts[i].x + dx;
    var y = pts[i].y + dy;
    if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
  }
  ctx.stroke();
}

function drawEndpointMarker(ctx, pos, color) {
  if (!pos) { return; }
  var w = worldOf(pos.x, pos.y, 0);
  var cx = w.x;
  var cy = w.y + TILE_H / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 20);
  ctx.lineTo(cx + 5, cy - 9);
  ctx.lineTo(cx - 5, cy - 9);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 6, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawTeleport(ctx, t) {
  [t.a, t.b].forEach(function (p) {
    var w = worldOf(p.x, p.y, 1);
    ctx.strokeStyle = COLORS.teleport;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(w.x, w.y + TILE_H / 2, TILE_W * 0.3, TILE_H * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
  });
}

/* ---------- canvas sizing ---------- */

// Size a canvas to CSS pixels with device-pixel-ratio backing.
function sizeCanvas(canvas, cssW, cssH) {
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas._dpr = dpr;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
}
