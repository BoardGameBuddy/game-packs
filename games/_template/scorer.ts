/**
 * My Game – BoardGameBuddy scorer
 *
 * Replace this template implementation with your game's actual scoring logic.
 *
 * TypeScript source.  The bgb CLI compiles and bundles this automatically.
 * Manual compile: npx esbuild scorer.ts --bundle --platform=node --target=es2017 --outfile=scorer.js
 *
 * The compiled `scorer.js` is loaded by the app at runtime.
 */

import type {
  GamePack,
  GameState,
  DetectedBox,
  ScorerContext,
  PlayerScoreResult,
  CardScoreDetail,
} from '@boardgamebuddy/game-pack-api';
import { groupByPlayer } from '@boardgamebuddy/game-pack-api';

/**
 * Optional: load card definitions from cards.json to drive scoring rules.
 * The app passes the parsed JSON object when invoking the scorer.
 *
 * Define your card-definition type here if your game uses cards.json.
 */
// interface MyGameCard { id: string; points: number; ... }
// type MyGameCards = MyGameCard[];

export class MyGame implements GamePack {
  private players: string[];

  constructor(players: string[]) {
    this.players = players;
  }

  processCards(boxes: DetectedBox[]): GameState {
    const groups = groupByPlayer(boxes, this.players.length);
    return {
      players: this.players.map((name, i) => {
        const playerBoxes = groups[i] ?? [];
        const cardDetails: CardScoreDetail[] = playerBoxes.map((card) => {
          // TODO: replace with real scoring logic for your game
          const points = 1;
          return {
            cardId: card.cardId,
            points,
            reason: `${card.cardId} (similarity ${card.similarity.toFixed(2)})`,
            title: card.cardId,
          };
        });

        const totalScore = cardDetails.reduce((sum, d) => sum + d.points, 0);

        return { name, totalScore, cardDetails };
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Legacy wrapper — maintains backward compatibility with the existing
// function-based scorer contract until the app is updated.
// ---------------------------------------------------------------------------

export function processCards(boxes: DetectedBox[], context: ScorerContext): PlayerScoreResult[] {
  const game = new MyGame(context.players);
  return game.processCards(boxes).players;
}

export { MyGame as Game };
