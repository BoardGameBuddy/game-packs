# BoardGameBuddy Game Packs

Community-contributed game packs for BoardGameBuddy.

## What is a game pack?

A game pack is a self-contained directory that adds support for a new board game to BoardGameBuddy.  Each pack contains:

| File | Required | Purpose |
|---|---|---|
| `game.json` | ✅ | Game metadata (id, display name, flags) |
| `embeddings.bin` | ✅ | Card reference embeddings for on-device identification (raw float32 LE) |
| `labels.txt` | ✅ | Card label list for on-device identification (one label per line) |
| `scorer.ts` | ✅ | TypeScript scorer source (compiled to `scorer.js` by the build step) |
| `cards.json` | ☑️ optional | Card definitions with scoring rules, used by the scorer |
| `texts.json` | ☑️ optional | Localisation strings (nested JSON, flattened to `"section.key"` at runtime) |
| `__tests__/scorer.test.js` | ☑️ recommended | Unit tests for the scorer |

## Quick start

1. Fork this repository and clone your fork.
2. Scaffold a new pack: `npx bgb new mygame`.
3. Fill in `game.json` with your game's metadata.
4. Implement the `processCards` method in `scorer.ts`.
5. Compile: `cd games/mygame && npm run build`
6. Serve and open the Playground to test interactively (see [Playground](#playground)).
7. Write tests in `__tests__/scorer.test.js` and verify: `npm test`.

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

## Playground

The Playground is a browser-based UI for testing and debugging scorer logic interactively without the app.  It lets you arrange cards on a virtual table, call the scorer, and inspect the score breakdown in real time.

Start the dev server from a pack directory:

```bash
cd games/mygame
node ../../serve.js
# playground at http://localhost:3000/playground/
```

## Contributing

1. Fork the repository and add your finished pack directory under `games/mygame/`.
2. Ensure all tests pass: `npm test`.
3. Open a pull request.

Please include at least a few test fixtures (real or anonymised scoring scenarios) to verify correctness.
