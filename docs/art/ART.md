# Factory Heist - art bible

This is the rulebook for how Factory Heist looks, and `sprites.js` at the repo root is the rulebook compiled.
Open [`concept.html`](concept.html) first - double-click it, no server needed - because the page is the argument and this file is only the reasoning behind it.
The SVG sheets in [`sprites/`](sprites) are rendered from the same definitions by `node tools/render-sprites.js`, so a sheet can never drift from the art the game draws.

## The world

A night shift in a parts factory.
Steel decking, stacked crates, a pipe main overhead, one beacon turning on a press, and thieving robots dragging lockboxes out through a chute.
The player is a dispatcher on a hover cart with a single searchlight, and the light is the search frontier: where it points is where the algorithm is about to look.

Two decisions carry the whole look.

**The factory is cold and dim, and the search is the only warm thing in it.**
Ground the search has taken goes cold blue, the frontier it is still holding glows safety yellow, and the route it committed to is warning orange.
A player who squints at the board sees the algorithm's shape and nothing else, which is the lesson the game is built to teach.

**Nothing is a photograph.**
Every sprite is a small 3D model made of boxes, prisms and cylinders, projected isometrically and painted in flat facets with no gradients except light bloom.
That is why the art survives rotation, why it costs nothing to draw, and why a new prop takes twenty lines rather than an afternoon in a paint tool.

## Palette

Five colours carry the factory.
Three more exist only as signals, and each one means exactly one thing anywhere it appears.

| Role | Name | Hex | Where |
|---|---|---|---|
| Core | Oil black | `#10141b` | shadow, gaps, the dark inside a chute |
| Core | Steel, deep | `#222936` | undersides, tracks, recesses |
| Core | Steel, dark | `#39434f` | bodies in shadow, machine housings |
| Core | Factory steel | `#5c6877` | the workhorse: decking, crates, chassis |
| Core | Steel, light | `#8b98a8` | braces, rollers, rails, lit tops |
| Core | Steel, pale | `#c3ccd8` | the catch of light on one edge |
| Core | Safety yellow | `#ffc21f` | the searchlight, the frontier, power, hazard bands |
| Core | Safety yellow, deep | `#b8860c` | the shaded side of yellow |
| Core | Warning orange | `#ff7a29` | the committed path, hot machinery, racking |
| Core | Warning orange, deep | `#b84a15` | the shaded side of orange |
| Signal | Prize glow | `#4ff0c5` | the prize, and nothing else, ever |
| Signal | Explored blue | `#2f6fb0` | ground the search has already taken |
| Signal | Thief red | `#e0452e` | thief eyes and thief hazard chevrons only |
| Mix | Glint | `#ffffff` | mixed into top faces, never painted flat |

Steel reads as six values rather than one because an isometric block needs a lit top, a half-lit face and a dark face before it reads as a solid at all.
Yellow and orange each carry a deep partner for the same reason.

The rule is mechanical, not aspirational: every colour that reaches the canvas is derived from this table by the shading helpers in `sprites.js`, and `tests/sprites.test.js` fails if a sprite ever paints a colour that was not.
A hex literal typed into a sprite definition is a test failure, which is the point.

## Light

There is one lamp.
It hangs in the ceiling of the *screen*, up and to the left, and it does not turn when the board turns.

| Surface | Treatment |
|---|---|
| Top faces | the base colour mixed 10% toward glint |
| Faces pointing down-left on screen | the base colour mixed 18% toward oil black |
| Faces pointing down-right on screen | the base colour mixed 44% toward oil black |
| Contact | a soft oil-black bloom on the deck under anything that stands on it |

Because the lamp is fixed to the screen and not to the world, rotating the board hands a lit face over to its neighbour.
That is what sells a 90-degree turn as a turn rather than as four unrelated drawings, and it is why every sprite here is modelled rather than drawn: a drawn sprite would need four consistent lighting solutions by hand, and would drift.

Cylinders are faceted in twelve segments with the same rule applied per segment, so a barrel shades smoothly without a gradient.

## Geometry and scale

One tile is 32 x 16 pixels at 1x, matching `render.js`, and heights are pixels above the deck.
A sprite's origin is the tile's north corner, so a sprite drops straight onto whatever `worldOf(x, y, 0)` already returns.

Silhouette bands, because a board full of props only reads if heights are sorted into a few classes:

| Band | Height | Members |
|---|---|---|
| Deck | 0 and below | the three floors, the chute, the explored wash |
| Low | 8 - 14 | lockboxes, power cells, the sneak, the path ribbon, pipe and conveyor decks |
| Block | 20 - 28 | the wall family, which is everything a search cannot cross |
| Tall | 24 - 32 | actors, and thin masts, beacons and aerials above a block |
| Prize | 38 | one object in the game, and it is allowed to be the tallest thing on the board |

Nothing exceeds 38, because a taller prop hides the tile behind it and the player has to be able to see the search arrive.
Thin things - an aerial, a lamp stalk, a post - may go above their band; solid volumes may not.

## Rotation

The board turns in 90-degree steps, and `Sprites.draw(ctx, name, rot, pos)` takes that number directly.
Inside a sprite, rotation is applied to the *model* before projection, so the same definition produces four pictures and four correct lighting solutions with no extra art.

A block names its four vertical faces by the grid direction they look at - `px` east, `py` south, `nx` west, `ny` north - so a stencil, a door or a screen stays painted on the same face of the object while the board turns.
That is what makes the crate, the cabinet and the machine legible under rotation: you learn which way a machine faces and the knowledge survives a turn.

Some pieces look the same from every side.
`Sprites.distinctRotations(name)` says which rotations are actually different pictures and `Sprites.rotationMap(name)` says which one a repeat repeats, so the concept page and the SVG sheets show four drawings only when there are four drawings to show.

Anything with a front of its own - the cart, the three thieves, a path tile - composes its facing with the board rotation through one helper, so the sign convention lives in exactly one place:

```js
Sprites.draw(ctx, 'player_dispatcher', Sprites.face(rot, cart.facing), pos);
Sprites.draw(ctx, 'overlay_path_end', Sprites.orient(rot, Sprites.DIR.west, cameFrom), pos);
```

Directions are `0` east (+x), `1` south (+y), `2` west, `3` north.
Sprites with a front are authored looking east; path tiles are authored entering from the west.

## Readability at tile size

The game is played at roughly 1x to 2.5x, which means a wall is about the size of a fingernail.
Five rules keep that legible, and the silhouette strip at the bottom of `concept.html` is how they are checked.

1. **Silhouette first.** Every prop must be identifiable as flat black at 1x. Crate, stack, rack, machine, pipe, barrels, conveyor and cabinet differ in outline before they differ in detail.
2. **One accent per prop.** A prop gets one warm mark - a lamp, a stencil, a band - and no more. Two accents at this size is noise.
3. **Two pixels minimum.** No feature is thinner than about 2px at 1x. Detail below that turns to mud and costs frame time to draw.
4. **The three thieves differ in mass, not in trim.** Scout is tall and narrow, hauler is wide and low and fills its tile, sneak is flat and half the height of the others. Told apart at a glance, told apart in silhouette, told apart in behaviour.
5. **Never repaint the ground.** Terrain cost is the lesson on the weighted maps, so the search paints *over* the floor as a wash and the floor stays visible underneath.

## The search, painted on the floor

| Layer | Colour | Treatment | Why |
|---|---|---|---|
| Explored | explored blue at 26% | a wash on the deck with a faint grid | it is information about the ground, not a new ground |
| Frontier | safety yellow | a pool of light on the deck plus a lit frame hovering 5px over it, tethered at the corners | the frontier is what the dispatcher is still holding up in the light |
| Path | warning orange | a ribbon riding 7-8px above the deck with chevrons pointing the way of travel | a raised ribbon cannot be buried by a tile painted later, which was the old build's worst defect |
| Breach | thief red | mixed into the explored wash past the budget | running out of fuel should be visible on the board, not only in a bar |

The frontier and the searchlight are deliberately the same yellow.
So is the power cell, because the power cell is what pays for the light.
That is the whole economy of the game stated in one colour.

## The roster

Rise is how far the sprite reaches above the tile's north corner at 1x, which is the number the silhouette bands are measured in.
Rotations is how many of the four are different pictures.
`tests/sprites.test.js` holds this table as data and fails if the code and this file disagree, the same way the level contract holds the README's level table.

| Sprite | Title | Group | Rise | Rotations |
|---|---|---|---|---|
| `floor_plate` | Plate floor | floor | 0 | 1 |
| `floor_grate` | Grating | floor | 0 | 4 |
| `floor_oil` | Oil floor | floor | -3 | 4 |
| `wall_crate` | Crate | wall | 21 | 4 |
| `wall_crate_stack` | Crate stack | wall | 23 | 4 |
| `wall_shelf_rack` | Shelving rack | wall | 27 | 4 |
| `wall_machine` | Machine with a light | wall | 32 | 4 |
| `wall_pipe_run` | Pipe run | wall | 14 | 4 |
| `wall_barrels` | Barrel cluster | wall | 17 | 4 |
| `wall_conveyor` | Conveyor segment | wall | 14 | 4 |
| `wall_cabinet` | Control cabinet | wall | 27 | 4 |
| `teleporter_chute` | Teleporter chute | fixture | 8 | 4 |
| `power_cell` | Power cell | fixture | 19 | 1 |
| `player_dispatcher` | Dispatcher cart | actor | 25 | 4 |
| `prize` | The prize | actor | 38 | 2 |
| `chest` | Lockbox | actor | 9 | 4 |
| `chest_open` | Lockbox, opened | actor | 15 | 4 |
| `thief_scout` | Scout | thief | 30 | 4 |
| `thief_hauler` | Hauler | thief | 24 | 4 |
| `thief_sneak` | Sneak | thief | 10 | 4 |
| `overlay_explored` | Explored | overlay | 0 | 2 |
| `overlay_frontier` | Frontier | overlay | 11 | 1 |
| `overlay_path_straight` | Path, straight | overlay | 14 | 4 |
| `overlay_path_corner` | Path, corner | overlay | 14 | 4 |
| `overlay_path_end` | Path, end | overlay | 20 | 4 |

Each sprite's own note - what it is for and why it looks the way it does - lives next to its drawing in `concept.html` and in `Sprites.meta(name)`.

## Dropping this into the build

`sprites.js` is a plain script with no dependencies, so it loads the same way everything else in this game does and keeps working from `file://`:

```html
<script src="sprites.js"></script>
```

```js
var w = worldOf(x, y, 0);                       // render.js already computes this
Sprites.draw(ctx, 'floor_plate', rot, w);       // floors first, all of them
Sprites.draw(ctx, 'wall_crate', rot, w);        // then props, back to front
```

Three integration notes the renderer has to respect.

Paint **all floors first and props afterwards**, both back to front along `x + y`.
A few props reach past their tile - the hauler's forks, the dispatcher's beam, the pipe main - and a floor painted later would slice them off.

For tiles that are redrawn every frame at a fixed zoom, cache them:

```js
var t = Sprites.prerender('wall_crate', rot, cam.scale);
ctx.drawImage(t.canvas, sx + t.ox, sy + t.oy);
```

`Sprites.polygons(name, rot)` is the raw shape list if the renderer wants to do its own thing with it - batch, tint, fade - and `Sprites.bounds(name, rot)` gives the box it occupies, which is what culling and the SVG export both use.

## Adding a sprite

1. Add a `def(name, meta, build)` in the right section of `sprites.js`, built from `m.box`, `m.cyl`, `m.disc`, `m.poly`, `m.line`, `m.glow` and `m.shadow`. Use `PALETTE` entries and the shading helpers; never type a hex.
2. Keep it inside its silhouette band, and give it one accent.
3. Put anything with a front on the `px` face, looking east.
4. Run `node tools/render-sprites.js` to refresh the SVG sheets.
5. Add its row to the roster table above with the rise and rotation count the tool printed, and run `npm test`.
6. Open `concept.html` and look at it on the board and in the silhouette strip. If you cannot tell it apart from its neighbours in black at 1x, it is not finished.

## Files

- `sprites.js` - the one place this art is authored; canvas draw functions, bounds, and the SVG renderer.
- `docs/art/ART.md` - this file.
- `docs/art/concept.html` - the whole kit on a rotating mini-board with a mocked HUD. Self-contained, no server, no CDN.
- `docs/art/sprites/*.svg` - generated sheets, one per sprite, every distinct rotation. Do not hand-edit.
- `tools/render-sprites.js` - regenerates those sheets.
- `tests/sprites.test.js` - palette closure, rotation claims, and this file's roster table as data.
