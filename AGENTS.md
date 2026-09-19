# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## This project

Plain HTML/CSS/JS game, no build step and no dependencies: `index.html` must keep working when opened straight from disk over `file://`, so no `fetch()` of local files, no ES modules, and nothing from a CDN. See the README for the file-by-file map and the two local run paths.

A level only teaches if its intended algorithm is the one that earns three stars. Budgets in `levels.js` are tuned to that, and the tuning is checkable: run `node tools/verify-levels.js` after touching `levels.js`, `search.js`, or the scoring in `game.js`. It exits non-zero when a level stops matching the design table.

`node tools/verify-engine.js` is the companion check for the engine itself - registry fields, trace fields, and every mechanic (teleports, refund chutes, fog, hot swap, legs, dispatch). Run both after any change to `search.js`. README.md's "Engine contract" section is what they enforce; change the contract and the docs in the same commit.

The engine has one loop, not two: `search()` is `runSearch(createSearch(...))`, and hot swap works only because every priority/queue/stack strategy shares that state. Strategies with their own shape are marked `hotSwappable: false` in the registry. When touching the loop, prove the original four strategies are untouched by diffing their traces against the previous `search.js` - the shipped levels are tuned to the exact expansion order.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
