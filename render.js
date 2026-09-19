/* render.js - draws one frame of a trace onto a canvas.
 *
 * drawFrame(canvas, grid, trace, index, opts)
 *   index = how many expansions have happened. index >= trace.steps.length
 *   means the run is over, so the final path is drawn on top.
 */

var COLORS = {
  grass: '#e9e4d6',
  swamp: '#7fa070',
  wall: '#39405a',
  grid: 'rgba(0,0,0,0.07)',
  exploredEarly: '#e6efff',
  exploredLate: '#3a61ad',
  frontier: '#ffc94d',
  path: '#ff5d73',
  start: '#27ae72',
  goal: '#e8503a'
};

function mixColor(a, b, t) {
  function part(hex, at) { return parseInt(hex.substr(at, 2), 16); }
  var r = Math.round(part(a, 1) + (part(b, 1) - part(a, 1)) * t);
  var g = Math.round(part(a, 3) + (part(b, 3) - part(a, 3)) * t);
  var bl = Math.round(part(a, 5) + (part(b, 5) - part(a, 5)) * t);
  return 'rgb(' + r + ',' + g + ',' + bl + ')';
}

function layoutFor(canvas, grid) {
  var cell = Math.floor(Math.min(canvas.width / grid.w, canvas.height / grid.h));
  cell = Math.max(cell, 1);
  return {
    cell: cell,
    ox: Math.floor((canvas.width - cell * grid.w) / 2),
    oy: Math.floor((canvas.height - cell * grid.h) / 2)
  };
}

function drawFrame(canvas, grid, trace, index, opts) {
  opts = opts || {};
  var ctx = canvas.getContext('2d');
  var lay = layoutFor(canvas, grid);
  var cell = lay.cell;
  var small = cell < 10;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // terrain
  for (var y = 0; y < grid.h; y++) {
    for (var x = 0; x < grid.w; x++) {
      var ch = grid.cells[y][x];
      ctx.fillStyle = ch === '#' ? COLORS.wall : (ch === '~' ? COLORS.swamp : COLORS.grass);
      ctx.fillRect(lay.ox + x * cell, lay.oy + y * cell, cell, cell);
    }
  }

  if (trace) {
    var last = Math.min(index, trace.steps.length);

    // Explored cells, shaded by exploration order. Translucent on purpose:
    // the terrain underneath is the whole point on the weighted maps.
    ctx.globalAlpha = 0.62;
    for (var k = 0; k < last; k++) {
      var st = trace.steps[k];
      var t = last > 1 ? k / (last - 1) : 0;
      ctx.fillStyle = mixColor(COLORS.exploredEarly, COLORS.exploredLate, t);
      ctx.fillRect(lay.ox + st.x * cell, lay.oy + st.y * cell, cell, cell);
    }
    ctx.globalAlpha = 1;

    // frontier as it stands after the last expansion drawn
    if (last > 0 && last <= trace.steps.length) {
      var frontierCells = trace.steps[last - 1].frontierCells;
      ctx.fillStyle = COLORS.frontier;
      ctx.globalAlpha = 0.85;
      for (var f = 0; f < frontierCells.length; f++) {
        var fi = frontierCells[f];
        var fx = fi % grid.w;
        var fy = (fi - fx) / grid.w;
        ctx.fillRect(lay.ox + fx * cell, lay.oy + fy * cell, cell, cell);
      }
      ctx.globalAlpha = 1;
    }

    // Swamp stays legible however much shading is piled on top of it.
    drawSwampMarks(ctx, lay, grid);

    // path, once the run is complete
    if (index >= trace.steps.length && trace.found && trace.path.length > 1) {
      ctx.strokeStyle = COLORS.path;
      ctx.lineWidth = Math.max(2, Math.floor(cell * 0.32));
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (var p = 0; p < trace.path.length; p++) {
        var cx = lay.ox + trace.path[p].x * cell + cell / 2;
        var cy = lay.oy + trace.path[p].y * cell + cell / 2;
        if (p === 0) { ctx.moveTo(cx, cy); } else { ctx.lineTo(cx, cy); }
      }
      ctx.stroke();
    }
  }

  // grid lines
  if (!small) {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = 0; gx <= grid.w; gx++) {
      ctx.moveTo(lay.ox + gx * cell + 0.5, lay.oy);
      ctx.lineTo(lay.ox + gx * cell + 0.5, lay.oy + grid.h * cell);
    }
    for (var gy = 0; gy <= grid.h; gy++) {
      ctx.moveTo(lay.ox + 0.5, lay.oy + gy * cell + 0.5);
      ctx.lineTo(lay.ox + grid.w * cell + 0.5, lay.oy + gy * cell + 0.5);
    }
    ctx.stroke();
  }

  drawEndpoint(ctx, lay, grid.start, COLORS.start, 'S', small);
  drawEndpoint(ctx, lay, grid.goal, COLORS.goal, 'G', small);
}

function drawSwampMarks(ctx, lay, grid) {
  var cell = lay.cell;
  var r = Math.max(1, cell * 0.16);
  ctx.fillStyle = 'rgba(31,74,38,0.65)';
  for (var y = 0; y < grid.h; y++) {
    for (var x = 0; x < grid.w; x++) {
      if (grid.cells[y][x] !== '~') { continue; }
      ctx.beginPath();
      ctx.arc(lay.ox + x * cell + cell / 2, lay.oy + y * cell + cell / 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawEndpoint(ctx, lay, pos, color, label, small) {
  var cell = lay.cell;
  var x = lay.ox + pos.x * cell;
  var y = lay.oy + pos.y * cell;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, cell, cell);
  if (small) { return; }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + Math.floor(cell * 0.7) + 'px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + cell / 2, y + cell / 2 + 1);
}

// Size a canvas to the grid so there are no empty bands around the map.
function fitCanvas(canvas, grid, maxW, maxH) {
  var cell = Math.max(1, Math.floor(Math.min(maxW / grid.w, maxH / grid.h)));
  canvas.width = cell * grid.w;
  canvas.height = cell * grid.h;
  return cell;
}
