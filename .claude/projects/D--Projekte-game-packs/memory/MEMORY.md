# BoardGameBuddy Game Packs — Memory

## Project Structure

All game packs live under `games/` subfolder (moved from root in Feb 2026):
- `games/wizard/`, `games/faraway/`, `games/mischwald/`, `games/doppelkopf/`
- `games/_template/` — starter template for new packs

Root-level tooling: `package.json`, `tsconfig.json`, `serve.js`, `cli.js`, `pack-index.json`

## Key Config Details

- `tsconfig.json`: `"include": ["games/*/scorer.ts"]` (type-check only, noEmit)
- `package.json` build: `for dir in games/*/; do ...`
- CI/release workflows loop over `games/*/`
- Release zip names use `basename` of the dir (e.g. `wizard.zip`, not `games/wizard.zip`)
- `cli.js bgb new`: creates packs in `games/<id>/`, reads template from `games/_template/`
