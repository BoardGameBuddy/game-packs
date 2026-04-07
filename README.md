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

### Option A — without cloning this repo (recommended for new packs)

Install the `bgb` CLI once:

```bash
npm install -g @boardgamebuddy/game-pack-cli
```

Then scaffold and develop your pack entirely in your own directory:

```bash
bgb new mygame               # creates mygame/ from the upstream template
cd mygame
# edit scorer.ts …
bgb serve                    # live-reload dev server + QR code for the app
```

When your pack is ready, open a pull request by copying the finished directory into a fork of this repo under `games/mygame/`.

### Option B — working inside this repo

1. Copy `games/_template/` to `games/mygame/` (or run `bgb new mygame`).
2. Fill in `game.json` with your game's metadata.
3. Implement the `processCards` method in `scorer.ts`.
4. Compile: `cd games/mygame && npm run build`
5. Write tests in `__tests__/scorer.test.js` and verify: `npm test`.

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

1. Fork the repository.
2. Create your game pack directory following the template.
3. Ensure all tests pass.
4. Open a pull request.

Please include at least a few test fixtures (real or anonymised scoring scenarios) to verify correctness.
