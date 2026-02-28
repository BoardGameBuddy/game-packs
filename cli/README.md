# @boardgamebuddy/game-pack-cli

Developer CLI for creating and testing [BoardGameBuddy](https://github.com/BoardGameBuddy) game packs.

## Installation

```bash
npm install -g @boardgamebuddy/game-pack-cli
```

## Commands

### `bgb new <game-id>`

Scaffold a new game pack from the upstream template.

```bash
bgb new ticket-to-ride
bgb new ticket-to-ride --name "Ticket to Ride"
```

**Arguments**

| Argument | Description |
|---|---|
| `game-id` | Unique identifier for the game. Lowercase alphanumeric and hyphens only (e.g. `ticket-to-ride`). |

**Options**

| Option | Description |
|---|---|
| `-n, --name <displayName>` | Display name shown in the app. Defaults to the title-cased `game-id`. |

This command downloads the template from [`BoardGameBuddy/game-packs`](https://github.com/BoardGameBuddy/game-packs) and creates the pack under `<game-id>/` in the current directory:

```
ticket-to-ride/
  game.json        ← patched with your game-id and display name
  scorer.ts        ← implement your scoring logic here
  scorer.js        ← compiled output (generated)
  embeddings.json  ← card embeddings
```

### `bgb serve [pack-dir]`

Start a local dev server for a game pack with live reload whenever `scorer.ts` changes.

```bash
# from inside the pack directory
cd games/ticket-to-ride
bgb serve

# or pass the path explicitly
bgb serve games/ticket-to-ride
```

The server starts on port `3000` (override with the `PORT` environment variable) and prints a QR code you can scan in the BoardGameBuddy app to load the pack directly.

When `scorer.ts` changes, the CLI automatically recompiles it with `tsc` and pushes a reload event to the app via Server-Sent Events.

## Developing a game pack

1. **Scaffold** the pack:
   ```bash
   bgb new my-game
   ```

2. **Implement scoring** in `my-game/scorer.ts`. The `score` function receives all players and their detected cards and must return a score result for each player:
   ```ts
   export function score(players: PlayerInput[]): PlayerScoreResult[] {
     // your logic here
   }
   ```

3. **Start the dev server**:
   ```bash
   bgb serve my-game
   ```

4. **Open the app**, navigate to Pack Store, and scan the QR code to load your pack. The app reloads automatically whenever you save `scorer.ts`.

## Requirements

- Node.js >= 18
