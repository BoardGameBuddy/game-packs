# BoardGameBuddy Game Packs

Community-contributed game packs for BoardGameBuddy.

## What is a game pack?

A game pack is a self-contained directory that adds support for a new board game to BoardGameBuddy.  Each pack contains:

| File | Required | Purpose |
|---|---|---|
| `game.json` | ✅ | Game metadata (id, display name, flags) |
| `embeddings.bin` | ✅ | Card reference embeddings for on-device identification (raw float32 LE) |
| `labels.txt` | ✅ | Card label list for on-device identification (one label per line) |
| `scorer.ts` | ✅ | TypeScript scorer source |
| `scorer.js` | ✅ | Compiled JavaScript loaded by the app at runtime (generated — do not edit by hand) |
| `cards.json` | ☑️ optional | Card definitions with scoring rules, used by the scorer |
| `texts.json` | ☑️ optional | Localisation strings (nested JSON, flattened to `"section.key"` at runtime) |
| `__tests__/scorer.test.js` | ☑️ recommended | Unit tests for the scorer |

## Quick start

You can develop a game pack **without cloning this repository** using the `bgb` CLI, or work directly inside a fork of this repo.

### Option A — standalone with the bgb CLI (recommended)

No clone required.  The CLI scaffolds the pack from the upstream template and provides a live-reload dev server.

```bash
# 1. Install the CLI once
npm install -g @boardgamebuddy/game-pack-cli

# 2. Scaffold a new pack in the current directory
bgb new mygame
# or supply a display name:
bgb new mygame --name "My Game"

# 3. Implement scoring logic in mygame/scorer.ts, then start the dev server
bgb serve mygame
```

The dev server starts on port 3000, prints a QR code, and automatically recompiles `scorer.ts` whenever you save.  Scan the QR code in the BoardGameBuddy app to load your pack.

When you're ready to contribute, open a pull request by copying your finished pack directory into a fork of this repository (see [Contributing](#contributing)).

### Option B — inside a fork of this repo

1. Fork this repository and clone your fork.
2. Copy `games/_template/` to `games/mygame/`.
3. Fill in `game.json` with your game's metadata.
4. Implement the `processCards` method in `scorer.ts`.
5. Compile: `cd games/mygame && npm run build`
6. Write tests in `__tests__/scorer.test.js` and verify: `npm test`.

## Scorer contract

Every game pack exports a class that implements the `GamePack` interface:

```typescript
import type { GamePack, GameState, DetectedBox, ScorerContext } from '@boardgamebuddy/game-pack-api';
import { groupByPlayer } from '@boardgamebuddy/game-pack-api';

export class MyGame implements GamePack {
  processCards(boxes: DetectedBox[], context?: ScorerContext): GameState {
    // your scoring logic here
  }
}

export { MyGame as Game };
```

Types are defined in the [`api/`](api/) package (`@boardgamebuddy/game-pack-api`).

## game.json schema

```jsonc
{
  "id": "mygame",                          // unique, lowercase, no spaces
  "displayName": "My Game",                // shown in the game selection screen
  "uniqueCards": false                     // true = each card appears only once
}
```

## Available packs

| Directory | Game | Notes |
|---|---|---|
| `games/_template/` | Starter template | template only |
| `games/faraway/` | Faraway | |
| `games/mischwald/` | Mischwald | |
| `games/wizard/` | Wizard | live tracking |
| `games/doppelkopf/` | Doppelkopf | live tracking |

## Testing

Game packs are expected to include Jest tests.  Run all pack tests at once from this directory:

```bash
npm test
```

Individual pack:

```bash
npm test -- --testPathPattern=games/mygame
```

## Contributing

1. Fork the repository and add your finished pack directory under `games/mygame/` (whether you developed it standalone with the `bgb` CLI or directly inside the fork).
2. Ensure all tests pass: `npm test`.
3. Open a pull request.

Please include at least a few test fixtures (real or anonymised scoring scenarios) to verify correctness.
