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
  DetectedBox,
  ScorerContext,
  PlayerScoreResult,
  CardScoreDetail,
} from '@boardgamebuddy/game-pack-api';

/**
 * Optional: load card definitions from cards.json to drive scoring rules.
 * The app passes the parsed JSON object when invoking the scorer.
 *
 * Define your card-definition type here if your game uses cards.json.
 */
// interface MyGameCard { id: string; points: number; ... }
// type MyGameCards = MyGameCard[];

function groupByPlayer(boxes: DetectedBox[], playerCount: number): DetectedBox[][] {
  if (playerCount <= 1) return [boxes];
  const groups: DetectedBox[][] = Array.from({ length: playerCount }, () => []);
  const bandSize = 1.0 / playerCount;
  for (const box of boxes) {
    const idx = Math.min(Math.floor(box.cy / bandSize), playerCount - 1);
    groups[idx].push(box);
  }
  return groups;
}

/**
 * Calculate scores for all players.
 *
 * @param boxes   - Flat list of all detected cards (all players combined).
 * @param context - Player names and session metadata.
 * @returns       - Score results in the same order as `context.players`.
 */
export function score(boxes: DetectedBox[], context: ScorerContext): PlayerScoreResult[] {
  const groups = groupByPlayer(boxes, context.players.length);
  return context.players.map((playerName, i) => {
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

    return {
      name: playerName,
      totalScore,
      cardDetails,
    };
  });
}
