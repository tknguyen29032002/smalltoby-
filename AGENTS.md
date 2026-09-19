# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## This project

Plain HTML/CSS/JS game, no build step and no dependencies: `index.html` must keep working when opened straight from disk over `file://`, so no `fetch()` of local files, no ES modules, and nothing from a CDN. See the README for the file-by-file map and the two local run paths.

The five levels only teach if each one's intended algorithm is the one that earns three stars. Budgets in `levels.js` are tuned to that, and the tuning is checkable: run `node tools/verify-levels.js` after touching `levels.js`, `search.js`, or the scoring in `game.js`. It exits non-zero when a level stops matching the design table.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
