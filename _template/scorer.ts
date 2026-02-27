/**
 * My Game – BoardGameBuddy scorer
 *
 * Replace this template implementation with your game's actual scoring logic.
 *
 * TypeScript source.  Compile with:
 *   npx tsc scorer.ts --outDir . --target ES2017 --module commonjs --strict
 *
 * The compiled `scorer.js` is loaded by the app at runtime.
 */

import type {
  PlayerInput,
  PlayerScoreResult,
  CardScoreDetail,
} from '../scorer-api/types';

/**
 * Optional: load card definitions from cards.json to drive scoring rules.
 * The app passes the parsed JSON object when invoking the scorer.
 *
 * Define your card-definition type here if your game uses cards.json.
 */
// interface MyGameCard { id: string; points: number; ... }
// type MyGameCards = MyGameCard[];

/**
 * Calculate scores for all players.
 *
 * @param players - All players with their detected cards.
 * @returns       - Score results in the same order as `players`.
 */
export function score(players: PlayerInput[]): PlayerScoreResult[] {
  return players.map((player) => {
    const cardDetails: CardScoreDetail[] = player.cards.map((card) => {
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

    return {
      name: player.name,
      totalScore,
      cardDetails,
    };
  });
}
