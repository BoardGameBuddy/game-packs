# BoardGameBuddy Game Packs

Community-contributed game packs for BoardGameBuddy.

## What is a game pack?

A game pack is a self-contained directory that adds support for a new board game to BoardGameBuddy.  Each pack contains:

| File | Required | Purpose |
|---|---|---|
| `game.json` | ✅ | Game metadata (id, display name, embeddings path, flags) |
| `embeddings.json` | ✅ | Card reference embeddings for on-device identification |
| `scorer.ts` | ✅ | TypeScript scorer source (compiled to `scorer.js`) |
| `scorer.js` | ✅ | Compiled JavaScript loaded by the app at runtime |
| `cards.json` | ☑️ optional | Card definitions with scoring rules, used by the scorer |
| `__tests__/scorer.test.ts` | ☑️ recommended | Unit tests for the scorer |

## Quick start

1. Copy `_template/` to a new directory named after your game ID (e.g. `mygame/`).
2. Fill in `game.json` with your game's metadata.
3. Implement the `score` function in `scorer.ts`.
4. Compile: `npx tsc scorer.ts --outDir . --target ES2017 --module commonjs`
5. Write tests in `__tests__/scorer.test.ts` and verify: `npx jest`.

## Scorer contract

The `scorer.ts` file must export a single `score` function:

```typescript
import type { PlayerInput, PlayerScoreResult } from '@boardgamebuddy/scorer-api';

export function score(players: PlayerInput[]): PlayerScoreResult[] { ... }
```

See [`../scorer-api/README.md`](../scorer-api/README.md) for full type documentation.

## game.json schema

```jsonc
{
  "id": "mygame",                          // unique, lowercase, no spaces
  "displayName": "My Game",                // shown in the game selection screen
  "uniqueCards": false                     // true = each card appears only once
}
```

## Available packs

| Directory | Game | Status |
|---|---|---|
| `_template/` | Starter template | template only |

> **Note:** The built-in scorers for **Faraway**, **Mischwald**, and **Wizard** currently run as native Kotlin modules inside the app.  TypeScript rewrites for these games will be contributed here as separate follow-up work.

## Testing

Game packs are expected to include Jest tests.  Run all pack tests at once from this directory:

```bash
npm test
```

Individual pack:

```bash
cd mygame && npx jest
```

## Contributing

1. Fork the repository.
2. Create your game pack directory following the template.
3. Ensure all tests pass.
4. Open a pull request.

Please include at least a few test fixtures (real or anonymised scoring scenarios) to verify correctness.
