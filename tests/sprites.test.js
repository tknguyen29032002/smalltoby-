/* tests/sprites.test.js - the art contract.
 *
 * docs/art/ART.md is the art bible, and the parts of it that are checkable
 * are checked here rather than trusted: the palette is closed, the roster
 * table in ART.md is the roster in sprites.js, the silhouette heights quoted
 * in that table are the heights the code draws, and the "this piece looks the
 * same from all four sides" claims are true.
 *
 * Same idea as the level contract: the document is held as data, so art that
 * drifts from its own rulebook fails here instead of on the board.
 */

var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var Sprites = require(path.join(ROOT, 'sprites.js'));
var ART = fs.readFileSync(path.join(ROOT, 'docs', 'art', 'ART.md'), 'utf8');

var GROUPS = ['floor', 'wall', 'fixture', 'actor', 'thief', 'overlay'];

// Heights a sprite is allowed to reach, from ART.md's silhouette bands. The
// prize is the one object permitted to be the tallest thing on the board.
var MAX_RISE = 38;

/* ---------- ART.md's roster table, as data ---------- */

function rosterFromArt() {
  var rows = [];
  ART.split('\n').forEach(function (line) {
    var m = line.match(/^\|\s*`([a-z_]+)`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/);
    if (!m) { return; }
    rows.push({
      name: m[1],
      title: m[2].trim(),
      group: m[3].trim(),
      rise: Number(m[4].trim()),
      rotations: Number(m[5].trim())
    });
  });
  return rows;
}

function rise(name) {
  // Math.round(-0) is -0, and -0 does not read as 0 in an assertion message.
  return Math.round(-Sprites.bounds(name, 0).y0) + 0;
}

var ROSTER = rosterFromArt();

test('ART.md carries a roster row for every sprite, and no others', function () {
  assert.ok(ROSTER.length > 20, 'the roster table should have been parsed out of ART.md');
  assert.deepStrictEqual(
    ROSTER.map(function (r) { return r.name; }).slice().sort(),
    Sprites.names().slice().sort()
  );
});

ROSTER.forEach(function (row) {
  test('ART.md agrees with the code about ' + row.name, function () {
    var meta = Sprites.meta(row.name);
    assert.strictEqual(meta.title, row.title, 'title');
    assert.strictEqual(meta.group, row.group, 'group');
    assert.strictEqual(rise(row.name), row.rise, 'rise above the tile corner at 1x');
    assert.strictEqual(
      Sprites.distinctRotations(row.name).length, row.rotations,
      'number of rotations that are a different picture'
    );
  });
});

/* ---------- the rules the bible states ---------- */

test('every sprite declares a known group and a note', function () {
  Sprites.names().forEach(function (name) {
    var meta = Sprites.meta(name);
    assert.ok(GROUPS.indexOf(meta.group) !== -1, name + ' has group ' + meta.group);
    assert.ok(meta.title && meta.note, name + ' needs a title and a note');
    assert.ok(meta.note.length > 20, name + ' needs a note worth reading');
  });
});

test('every sprite draws something in all four rotations', function () {
  Sprites.names().forEach(function (name) {
    for (var r = 0; r < 4; r++) {
      var parts = Sprites.polygons(name, r);
      assert.ok(parts.length > 0, name + ' rotation ' + r + ' drew nothing');
      parts.forEach(function (p) {
        if (p.kind === 'glow') { return; }
        assert.ok(p.pts.length >= 2, name + ' has a degenerate shape');
        p.pts.forEach(function (q) {
          assert.ok(isFinite(q[0]) && isFinite(q[1]), name + ' produced a non-finite point');
        });
      });
    }
  });
});

test('the palette is closed: nothing but derived palette colours is painted', function () {
  var offenders = [];
  Sprites.names().forEach(function (name) {
    for (var r = 0; r < 4; r++) {
      Sprites.polygons(name, r).forEach(function (p) {
        [p.fill, p.stroke, p.color].forEach(function (c) {
          if (c && Sprites.DERIVED[c] === undefined) { offenders.push(name + ': ' + c); }
        });
      });
    }
  });
  assert.deepStrictEqual(offenders, [], 'colours that did not come from PALETTE');
});

test('nothing grows taller than the silhouette bands allow', function () {
  Sprites.names().forEach(function (name) {
    assert.ok(rise(name) <= MAX_RISE, name + ' rises ' + rise(name) + 'px, over the ' + MAX_RISE + 'px ceiling');
  });
});

test('the kit covers the concepts the game needs', function () {
  var counts = {};
  Sprites.names().forEach(function (n) {
    var g = Sprites.meta(n).group;
    counts[g] = (counts[g] || 0) + 1;
  });
  assert.ok(counts.wall >= 6, 'walls should come in at least six forms, got ' + counts.wall);
  assert.ok(counts.floor >= 3, 'three floors: plain, grating, and a slow one');
  assert.ok(counts.thief >= 3, 'three thief silhouettes');
  ['player_dispatcher', 'prize', 'chest', 'teleporter_chute', 'power_cell',
    'overlay_explored', 'overlay_frontier', 'overlay_path_straight'].forEach(function (n) {
    assert.ok(Sprites.names().indexOf(n) !== -1, 'missing ' + n);
  });
});

/* ---------- rotation ---------- */

test('drawing is deterministic', function () {
  Sprites.names().forEach(function (name) {
    assert.strictEqual(Sprites.signature(name, 1), Sprites.signature(name, 1), name);
  });
});

test('rotationMap points every repeat at a rotation that is drawn', function () {
  Sprites.names().forEach(function (name) {
    var distinct = Sprites.distinctRotations(name);
    var map = Sprites.rotationMap(name);
    assert.strictEqual(map.length, 4, name);
    map.forEach(function (src, r) {
      assert.ok(distinct.indexOf(src) !== -1, name + ' rotation ' + r + ' points at a rotation nobody draws');
      assert.strictEqual(
        Sprites.polygons(name, r).length, Sprites.polygons(name, src).length,
        name + ' rotation ' + r + ' claims to repeat ' + src + ' but draws a different number of shapes'
      );
    });
  });
});

test('orient() composes a facing with the board rotation, in one place', function () {
  // A cart looking east on an unturned board is the artwork as authored.
  assert.strictEqual(Sprites.face(0, Sprites.DIR.east), 0);
  // Turning the board and turning the actor the same way cancel out.
  for (var r = 0; r < 4; r++) {
    assert.strictEqual(Sprites.face(r, r), 0);
    assert.strictEqual(Sprites.orient(r, Sprites.DIR.west, (Sprites.DIR.west + r) & 3), 0);
  }
  // A quarter turn of the actor is a quarter turn of the model, either way.
  assert.notStrictEqual(Sprites.face(0, Sprites.DIR.south), Sprites.face(0, Sprites.DIR.east));
});

/* ---------- the generated sheets ---------- */

test('docs/art/sprites holds exactly the kit, and the sheets are current', function () {
  var dir = path.join(ROOT, 'docs', 'art', 'sprites');
  var files = fs.readdirSync(dir).filter(function (f) { return /\.svg$/.test(f); });
  var expected = Sprites.names().concat(['_contact-sheet']).sort();
  assert.deepStrictEqual(
    files.map(function (f) { return f.replace(/\.svg$/, ''); }).sort(), expected,
    'run: node tools/render-sprites.js'
  );
  Sprites.names().forEach(function (name) {
    var svg = fs.readFileSync(path.join(dir, name + '.svg'), 'utf8');
    var shown = (svg.match(/>rot \d</g) || []).length;
    assert.strictEqual(
      shown, Sprites.distinctRotations(name).length,
      name + '.svg is stale: run node tools/render-sprites.js'
    );
    assert.ok(svg.indexOf('<svg') === 0 && svg.indexOf('http') !== -1,
      name + '.svg should be a standalone svg document');
    assert.ok(!/<image|xlink:href/.test(svg), name + '.svg must stay hand-authored vector, no bitmaps');
  });
});

test('concept.html is self-contained: no CDN, no modules, no images', function () {
  var page = fs.readFileSync(path.join(ROOT, 'docs', 'art', 'concept.html'), 'utf8');
  // Only fetches count: the SVG namespace in the inline favicon is a name,
  // not a URL the browser ever goes to.
  assert.ok(!/(?:src|href)\s*=\s*["']https?:/.test(page), 'nothing may be loaded from the network');
  assert.ok(!/@import|url\(\s*["']?https?:/.test(page), 'no remote stylesheet or font');
  assert.ok(!/type="module"|import\s+/.test(page), 'plain scripts only, so file:// works');
  assert.ok(!/<img|url\(['"]?data:image/.test(page), 'every pixel is drawn by sprites.js');
  assert.ok(page.indexOf('src="../../sprites.js"') !== -1, 'the page must use the shipped sprites.js');
});
