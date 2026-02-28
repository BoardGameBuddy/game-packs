# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Community game pack repository for **BoardGameBuddy**, an app for on-device board game scoring using computer vision. Each game pack is a self-contained module implementing a shared scorer API.

## Commands

```bash
npm test                    # Run all Jest tests (from root)
npm run build               # Compile all TypeScript scorers to JS
npm run serve               # Start local dev server (run from a pack directory)
npm run watch               # Watch and recompile TypeScript on change

# Run tests for a single pack
npx jest --testPathPattern=wizard
npx jest --testPathPattern=faraway

# Compile a single scorer manually
npx tsc scorer.ts --outDir . --target ES2017 --module commonjs --skipLibCheck

# Test with app: serve a pack and scan QR code
cd wizard && node ../serve.js
```

**Important**: Jest only runs compiled `.js` files. After modifying `scorer.ts` or `__tests__/scorer.test.ts`, compile before testing. The `npm test` command does NOT auto-compile.

## Architecture

### Scorer Contract

Every game pack exposes a single function:

```typescript
export function score(players: PlayerInput[]): PlayerScoreResult[]
```

Types are defined in `scorer-api/types.ts`. Input provides detected card positions (bounding box + center coordinates). Output includes `totalScore` and `cardDetails` (per-card breakdown with `points`, `reason`, `title`, `group`).

### Game Pack Structure

Each pack directory contains:
- `game.json` — metadata (`id`, `displayName`, optional feature flags)
- `scorer.ts` + `scorer.js` — TypeScript source and compiled output
- `embeddings.json` — ML embeddings for card recognition (not manually edited)
- `cards.json` (optional) — card definitions loaded at runtime by the scorer
- `texts.json` (optional) — localization strings (nested JSON, flattened to `"section.key"` at runtime)
- `__tests__/scorer.test.js` — compiled Jest tests

Use `_template/` as the starting point for new packs.

### Localization Pattern

Scorers load `texts.json` via a self-executing IIFE at module load, flattening nested JSON into dot-separated keys. Use the `t(key, fallback)` helper to retrieve translated strings. The `__texts` global allows the app to inject translations at runtime.

### Card ID Convention

Card IDs use colon-separated segments (e.g., `wizard:blue:05`, `region:03`). Parse with `cardId.indexOf(':')` to split kind from value. Strip leading zeros with `parseInt(rawId, 10)`.

### Visual Sorting

For games where card play order matters, use a row-based sort: group cards by Y position (row threshold = avg card height / 2), then sort left-to-right within rows. See `faraway/scorer.ts` for the reference implementation.

## CI/CD

- **PRs to main**: Type-check → compile scorers → validate `game.json` schemas → run Jest
- **Merge to main**: Full CI + package each pack as `dist/{id}.zip` → compute checksums → update `pack-index.json` → create GitHub Release → commit index back to main
- Release `version` = GitHub run number (auto-incrementing, never manually set)

## TypeScript Configuration

`tsconfig.json` at root uses `"noEmit": true` — it only type-checks, never produces output. Actual compilation uses direct `tsc` invocations with `--outDir .` to place `.js` files alongside `.ts` files. Target is `ES2017`, module format is `commonjs`.
