# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Community game pack repository for **BoardGameBuddy**, an app for on-device board game scoring using computer vision. Each game pack is a self-contained module implementing a shared scorer API.

## Commands

```bash
npm test                    # Run all Jest tests (from root)
npm run build               # Compile all TypeScript scorers to JS
npm run build wizard        # Compile a single scorer
npm run typecheck           # Type-check all scorers (no output)
npm run serve wizard        # Start local dev server for a pack
npm run watch               # Watch and recompile TypeScript on change
npm run new mygame          # Scaffold a new pack from the template

# Run tests for a single pack
npm test -- --testPathPattern=games/wizard
```

**Important**: Test files are TypeScript (`.test.ts`) and run directly via ts-jest — no pre-compilation needed. However, `require('../scorer')` in tests resolves `scorer.ts` first (ts-jest handles it), so scorer compilation is not required either.

## Architecture

### Scorer Contract

Every game pack exports a class that implements the `GamePack` interface:

```typescript
import type { GamePack, GameState, DetectedBox, ScorerContext } from '@boardgamebuddy/game-pack-api';

export class MyGame implements GamePack {
  processCards(boxes: DetectedBox[], context?: ScorerContext): GameState { ... }
}
export { MyGame as Game };
```

Types are defined in `api/types.ts`. Input provides detected card positions (bounding box + centre coordinates) plus optional session metadata. Output includes per-player `totalScore` and `cardDetails` (per-card breakdown with `points`, `reason`, `title`, `group`).

### Game Pack Structure

Each pack directory contains:
- `game.json` — metadata (`id`, `displayName`, optional feature flags)
- `scorer.ts` + `scorer.js` — TypeScript source and compiled output
- `embeddings.bin` — ML embeddings for card recognition: raw float32 LE values, N×D row-major (not manually edited)
- `labels.txt` — one card label per line, parallel to `embeddings.bin` rows (not manually edited)
- `cards.json` (optional) — card definitions loaded at runtime by the scorer
- `texts.json` (optional) — localization strings (nested JSON, flattened to `"section.key"` at runtime)
- `__tests__/scorer.test.js` — compiled Jest tests

Use `games/_template/` as the starting point for new packs. `npm run new <game-id>` scaffolds a new pack by copying the template into `games/`.

### Localization Pattern

Scorers load `texts.json` via a self-executing IIFE at module load, flattening nested JSON into dot-separated keys. Use the `t(key, fallback)` helper to retrieve translated strings. The `__texts` global allows the app to inject translations at runtime.

### Card ID Convention

Card IDs use colon-separated segments (e.g., `wizard:blue:05`, `region:03`). Parse with `cardId.indexOf(':')` to split kind from value. Strip leading zeros with `parseInt(rawId, 10)`.

### Visual Sorting

For games where card play order matters, use a row-based sort: group cards by Y position (row threshold = avg card height / 2), then sort left-to-right within rows. See `games/faraway/scorer.ts` for the reference implementation.

## CI/CD

- **PRs to main**: Type-check → compile scorers → validate `game.json` schemas → run Jest
- **Merge to main**: Full CI + package each pack as `dist/{id}.zip` → compute checksums → update `pack-index.json` → create GitHub Release → commit index back to main
- Release `version` = GitHub run number (auto-incrementing, never manually set)

## TypeScript Configuration

`tsconfig.json` at root uses `"noEmit": true` — it only type-checks, never produces output. Actual compilation uses **esbuild** with `--bundle` to produce a single `scorer.js` alongside each `scorer.ts`. Target is `ES2017`, format is `commonjs`.
