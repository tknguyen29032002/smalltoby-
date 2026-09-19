# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## This project

Plain HTML/CSS/JS game, no build step and no dependencies: `index.html` must keep working when opened straight from disk over `file://`, so no `fetch()` of local files, no ES modules, and nothing from a CDN. See the README for the file-by-file map and the two local run paths.

The levels only teach if each one's intended algorithm is the one that earns three stars.
Budgets in `levels.js` are tuned to that, and the tuning is checkable: `npm test` runs the node suite in `tests/` (search invariants plus the level contract, which holds README's level table as data), and `node tools/verify-levels.js` prints the same table for a human.
Run both after touching `levels.js`, `search.js`, or the scoring in `game.js`; a new level ships with its README row and its row in `tests/levels.test.js`.

`node tools/verify-engine.js` is the companion check for the engine itself - registry fields, trace fields, and every mechanic (teleports, refund chutes, fog, hot swap, legs, dispatch).
Run it after any change to `search.js`. README.md's "Engine contract" section is what it enforces; change the contract and the docs in the same commit.

Script tags share one global namespace, and a duplicate name between two files is silent until the page runs: `search.js` and `game.js` both wanted `runSearch`, and the engine recursed into the UI until the stack blew, with every node check still green.
Each file therefore owns exactly what it publishes - `search.js` is one closure exposing `PathfinderEngine` plus `search`, `parseGrid` and `STRATEGIES` - and the walkthrough is the only check that would have caught it.

The engine has one loop, not two: `search()` is `runSearch(createSearch(...))`, and hot swap works only because every priority/queue/stack strategy shares that state.
Strategies with their own shape are marked `hotSwappable: false` in the registry.
When touching the loop, prove the original four strategies are untouched by diffing their traces against the previous `search.js` - the shipped levels are tuned to the exact expansion order.

Factory Heist's campaign is data: `campaign.js` and `shop.js` hold encounters, economy and shop, bind to `maps.js` by map id, and never simulate - `heist.js` is the one gameplay simulator.
Par is measured, not guessed: after touching `campaign.js`, `shop.js` or `maps.js`, run `node tools/verify-campaign.js` (`--write` re-measures par and start charge); the design it enforces is `docs/design/CAMPAIGN.md`.

`npm test` cannot see the page. After touching `index.html`, `game.js`, or `render.js`, also run the browser walkthrough in `tests/browser/walkthrough.js` - its header has the commands - over both `file://` and `http://`; the two runs must report the same digest and no problems.

The art has one author: `sprites.js` defines every sprite as a small 3D model, and the SVG sheets under `docs/art/sprites/` are generated from it by `node tools/render-sprites.js` - never hand-edited. The rules are in `docs/art/ART.md`, whose roster table is held as data by `tests/sprites.test.js` (alongside palette closure and the rotation claims), so a sprite edit ships with a regenerated sheet and an updated row. Judge any art change by eye in `docs/art/concept.html`, which draws the whole kit from the shipped `sprites.js`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
