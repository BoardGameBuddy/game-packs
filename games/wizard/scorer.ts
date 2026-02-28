/**
 * Wizard – BoardGameBuddy scorer
 *
 * TypeScript port of the Kotlin WizardScorer.
 *
 * In photo mode the scorer groups the detected cards per player and
 * displays them by suit — total score is always 0 because full round
 * scoring (bid vs. actual tricks won) happens in the live-tracking mode.
 *
 * Card IDs follow the pattern `wizard:<suit>:<number>` where:
 *   suit   = blue | green | red | yellow | wizard | jester
 *   number = zero-padded two-digit string, e.g. "01"–"13" for colour
 *            suits, "01"–"04" for wizard/jester cards
 */

import type { PlayerInput, PlayerScoreResult, CardScoreDetail } from '@boardgamebuddy/game-pack-api';

// ---------------------------------------------------------------------------
// Localisation — t(key, fallback) resolves display strings from texts.json.
// In the app runtime, __texts is injected by the JS shim.
// In Node.js (tests), texts.json is loaded via require().
// ---------------------------------------------------------------------------

// @ts-ignore — __texts may be injected by app runtime
declare var __texts: Record<string, string> | undefined;

const _resolvedTexts: Record<string, string> = (() => {
  if (typeof __texts === 'object' && __texts !== null) return __texts;
  try {
    const raw = require('./texts.json');
    const flat: Record<string, string> = {};
    (function flatten(obj: any, prefix: string) {
      for (const k of Object.keys(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof obj[k] === 'object' && obj[k] !== null) flatten(obj[k], key);
        else flat[key] = String(obj[k]);
      }
    })(raw.de || {}, '');
    return flat;
  } catch { return {}; }
})();

function t(key: string, fallback?: string): string {
  const val = _resolvedTexts[key];
  return val !== undefined ? val : (fallback !== undefined ? fallback : key);
}

// ---------------------------------------------------------------------------
// Card display parsing (mirrors WizardScorer.parseCardDisplay)
// ---------------------------------------------------------------------------

/**
 * Parses a card ID like `wizard:blue:05` into a [displayName, group] pair.
 *
 * @example
 * parseCardDisplay('wizard:blue:05')   // → ['Blau 5', 'Blau']
 * parseCardDisplay('wizard:wizard:01') // → ['Zauberer 01', 'Zauberer']
 * parseCardDisplay('wizard:jester:02') // → ['Narr 02', 'Narr']
 */
export function parseCardDisplay(cardId: string): [string, string] {
  const withoutPrefix = cardId.startsWith('wizard:') ? cardId.slice('wizard:'.length) : cardId;
  const colon = withoutPrefix.indexOf(':');
  if (colon < 0) return [cardId, ''];

  const suit   = withoutPrefix.slice(0, colon);
  const number = withoutPrefix.slice(colon + 1);

  if (suit === 'wizard') {
    const name = t('suits.wizard', 'Wizard');
    return [`${name} ${number}`, name];
  }
  if (suit === 'jester') {
    const name = t('suits.jester', 'Jester');
    return [`${name} ${number}`, name];
  }

  const suitName = t(`suits.${suit}`, suit);
  const displayNumber = number.replace(/^0+/, '') || '0';
  return [`${suitName} ${displayNumber}`, suitName];
}

// ---------------------------------------------------------------------------
// Round-score helpers (photo mode returns 0; these are used by live tracking)
// ---------------------------------------------------------------------------

/**
 * Standard Wizard scoring for a single round.
 * Correct bid → +20 + 10×tricksWon; wrong → −10×|bid − tricksWon|.
 */
export function calculateRoundScore(bid: number, tricksWon: number): number {
  return bid === tricksWon
    ? 20 + 10 * tricksWon
    : -10 * Math.abs(bid - tricksWon);
}

/**
 * Extracts the suit portion from a card ID (e.g. `wizard:blue:05` → `"blue"`).
 */
export function extractSuit(cardId: string): string {
  const withoutPrefix = cardId.startsWith('wizard:') ? cardId.slice('wizard:'.length) : cardId;
  const colon = withoutPrefix.indexOf(':');
  return colon >= 0 ? withoutPrefix.slice(0, colon) : withoutPrefix;
}

/**
 * Extracts the numeric value from a card ID (e.g. `wizard:blue:05` → `5`).
 */
export function extractValue(cardId: string): number {
  const withoutPrefix = cardId.startsWith('wizard:') ? cardId.slice('wizard:'.length) : cardId;
  const colon = withoutPrefix.indexOf(':');
  if (colon < 0) return 0;
  return parseInt(withoutPrefix.slice(colon + 1), 10) || 0;
}

/**
 * Determines the winner of a trick given the played cards and trump suit.
 *
 * @param cards     List of [playerIndex, cardId] pairs in play order.
 * @param trumpSuit The trump suit for this round, or null if no trump.
 * @returns         The playerIndex of the winner.
 */
export function determineTrickWinner(
  cards: [number, string][],
  trumpSuit: string | null,
): number {
  if (cards.length === 0) return 0;

  // First wizard played always wins the trick.
  const firstWizard = cards.find(([, id]) => extractSuit(id) === 'wizard');
  if (firstWizard) return firstWizard[0];

  // If all cards are jesters the first player wins.
  const nonJesters = cards.filter(([, id]) => extractSuit(id) !== 'jester');
  if (nonJesters.length === 0) return cards[0][0];

  // Determine the led suit (first non-jester card).
  const ledSuit = extractSuit(nonJesters[0][1]);

  // Find the best trump card; if none, find the best card of the led suit.
  const trumpCards = trumpSuit
    ? nonJesters.filter(([, id]) => extractSuit(id) === trumpSuit)
    : [];

  const candidates = trumpCards.length > 0
    ? trumpCards
    : nonJesters.filter(([, id]) => extractSuit(id) === ledSuit);

  return candidates.reduce((best, cur) =>
    extractValue(cur[1]) > extractValue(best[1]) ? cur : best
  )[0];
}

// ---------------------------------------------------------------------------
// Exported scorer function
// ---------------------------------------------------------------------------

export function score(players: PlayerInput[]): PlayerScoreResult[] {
  return players.map((player) => {
    if (player.cards.length === 0) {
      return { name: player.name, totalScore: 0, cardDetails: [] };
    }

    const cardDetails: CardScoreDetail[] = player.cards.map((card) => {
      const [displayName, group] = parseCardDisplay(card.cardId);
      return {
        cardId: card.cardId,
        points: 0,
        reason: displayName,
        title: displayName,
        group,
      };
    });

    return { name: player.name, totalScore: 0, cardDetails };
  });
}
