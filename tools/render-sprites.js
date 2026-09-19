#!/usr/bin/env node
/* tools/render-sprites.js - write the SVG sheets in docs/art/sprites.
 *
 *   node tools/render-sprites.js
 *
 * The sheets are rendered from sprites.js, which is the one place any of this
 * art is authored: edit a sprite, re-run this, and the SVG follows. Never
 * hand-edit a file in docs/art/sprites - it will be overwritten.
 *
 * Each sheet shows the rotations that are actually different pictures, back
 * to back, on the factory floor colour, at 6x so the facets are readable.
 */

var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var Sprites = require(path.join(root, 'sprites.js'));
var outDir = path.join(root, 'docs', 'art', 'sprites');

var SCALE = 6;
var BG = '#151a22';
var INK = '#c3ccd8';
var DIM = '#8b98a8';

function cellSvg(name, rots, scale) {
  // One row of rotations, framed on a common box so they sit on one baseline.
  var box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  rots.forEach(function (r) {
    var b = Sprites.bounds(name, r);
    box.x0 = Math.min(box.x0, b.x0); box.x1 = Math.max(box.x1, b.x1);
    box.y0 = Math.min(box.y0, b.y0); box.y1 = Math.max(box.y1, b.y1);
  });
  var pad = 4;
  var cw = box.x1 - box.x0 + pad * 2;
  var ch = box.y1 - box.y0 + pad * 2;
  var label = 14;

  var defs = [];
  var body = [];
  rots.forEach(function (r, i) {
    var s = Sprites.svgBody(name, r, 'r' + r + '_');
    defs = defs.concat(s.defs);
    var ox = i * cw - box.x0 + pad;
    var oy = -box.y0 + pad;
    body.push('<g transform="translate(' + ox.toFixed(2) + ' ' + oy.toFixed(2) + ')">' +
      s.body.join('') + '</g>');
    body.push('<text x="' + (i * cw + cw / 2).toFixed(2) + '" y="' + (ch + label - 5).toFixed(2) +
      '" font-family="ui-monospace,Menlo,monospace" font-size="7" fill="' + DIM +
      '" text-anchor="middle">rot ' + r + '</text>');
  });

  var w = cw * rots.length;
  var h = ch + label;
  return {
    width: Math.round(w * scale),
    height: Math.round(h * scale),
    viewBox: '0 0 ' + w.toFixed(2) + ' ' + h.toFixed(2),
    defs: defs,
    body: body,
    w: w,
    h: h
  };
}

function writeSheet(name) {
  var rots = Sprites.distinctRotations(name);
  var meta = Sprites.meta(name);
  var c = cellSvg(name, rots, SCALE);
  var note = rots.length === 4
    ? 'four distinct rotations'
    : rots.length + ' distinct rotation' + (rots.length === 1 ? '' : 's') +
      ' (the others repeat)';
  var head = 16;
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + c.width +
    '" height="' + Math.round((c.h + head) * SCALE) + '" viewBox="0 0 ' +
    c.w.toFixed(2) + ' ' + (c.h + head).toFixed(2) + '">' +
    '<title>' + meta.title + '</title>' +
    '<desc>' + meta.note + '</desc>' +
    (c.defs.length ? '<defs>' + c.defs.join('') + '</defs>' : '') +
    '<rect width="100%" height="100%" fill="' + BG + '"/>' +
    '<text x="4" y="8" font-family="ui-monospace,Menlo,monospace" font-size="7.5" fill="' + INK + '">' +
    name + '</text>' +
    '<text x="4" y="15" font-family="ui-monospace,Menlo,monospace" font-size="5.5" fill="' + DIM + '">' +
    note + '</text>' +
    '<g transform="translate(0 ' + head + ')">' + c.body.join('') + '</g></svg>\n';
  fs.writeFileSync(path.join(outDir, name + '.svg'), svg);
  return { name: name, rots: rots.length };
}

function writeContactSheet(names) {
  // Every sprite at rotation 0, one grid, for the ART.md header image.
  var cols = 5;
  var cw = 44;
  var chh = 52;
  var defs = [];
  var body = [];
  names.forEach(function (name, i) {
    var col = i % cols;
    var row = Math.floor(i / cols);
    var b = Sprites.bounds(name, 0);
    var s = Sprites.svgBody(name, 0, 'c' + i + '_');
    defs = defs.concat(s.defs);
    var scale = Math.min(1, (cw - 6) / (b.x1 - b.x0), (chh - 16) / (b.y1 - b.y0));
    var ox = col * cw + cw / 2;
    var oy = row * chh + chh - 14 - (b.y1 * scale);
    body.push('<g transform="translate(' + ox.toFixed(2) + ' ' + oy.toFixed(2) +
      ') scale(' + scale.toFixed(3) + ')">' + s.body.join('') + '</g>');
    body.push('<text x="' + ox.toFixed(2) + '" y="' + (row * chh + chh - 3).toFixed(2) +
      '" font-family="ui-monospace,Menlo,monospace" font-size="3.6" fill="' + DIM +
      '" text-anchor="middle">' + name + '</text>');
  });
  var w = cols * cw;
  var h = Math.ceil(names.length / cols) * chh;
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(w * 4) +
    '" height="' + Math.round(h * 4) + '" viewBox="0 0 ' + w + ' ' + h + '">' +
    '<title>Factory Heist sprite contact sheet</title>' +
    (defs.length ? '<defs>' + defs.join('') + '</defs>' : '') +
    '<rect width="100%" height="100%" fill="' + BG + '"/>' +
    body.join('') + '</svg>\n';
  fs.writeFileSync(path.join(outDir, '_contact-sheet.svg'), svg);
}

fs.mkdirSync(outDir, { recursive: true });
var names = Sprites.names();
// Drop anything left from a renamed sprite, so the folder is exactly the kit.
fs.readdirSync(outDir).forEach(function (f) {
  if (f.slice(-4) !== '.svg') { return; }
  var base = f.slice(0, -4);
  if (base !== '_contact-sheet' && names.indexOf(base) === -1) {
    fs.unlinkSync(path.join(outDir, f));
  }
});

var rows = names.map(writeSheet);
writeContactSheet(names);

var total = rows.reduce(function (a, r) { return a + r.rots; }, 0);
console.log(rows.map(function (r) {
  return '  ' + r.name.padEnd(24) + r.rots + ' rotation' + (r.rots === 1 ? '' : 's');
}).join('\n'));
console.log('\n' + rows.length + ' sprites, ' + total + ' distinct rotations -> ' +
  path.relative(root, outDir));
