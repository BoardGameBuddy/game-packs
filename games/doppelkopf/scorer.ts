/**
 * Doppelkopf – BoardGameBuddy scorer
 *
 * TypeScript implementation of Doppelkopf card scoring and trick-winner logic.
 *
 * Card IDs follow the pattern `doppelkopf:<suit>:<value>` where:
 *   suit  = kreuz | pik | herz | karo
 *   value = 9 | 10 | bube | dame | koenig | as
 *
 * Each card is present twice in the deck (48 cards total).
 *
 * Trump order (highest → lowest, normal game):
 *   1.  herz:10       (Dullen)
 *   2.  kreuz:dame    (Alten)
 *   3.  pik:dame
 *   4.  herz:dame
 *   5.  karo:dame
 *   6.  kreuz:bube    (Karlchen – makes last trick for extra point)
 *   7.  pik:bube
 *   8.  herz:bube
 *   9.  karo:bube
 *   10. karo:as       (Fuchs)
 *   11. karo:10
 *   12. karo:koenig
 *   13. karo:9
 *
 * Fehlfarben (kreuz, pik, herz) order: as > 10 > koenig > 9
 * Note: Dame and Bube are always trump regardless of suit; Herz 10 is trump.
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
// Card point values (Augen)
// ---------------------------------------------------------------------------

const AUGEN: Record<string, number> = {
  as: 11,
  '10': 10,
  koenig: 4,
  dame: 3,
  bube: 2,
  '9': 0,
};

// ---------------------------------------------------------------------------
// Trump rank table (1 = lowest, 13 = highest)
// ---------------------------------------------------------------------------

const TRUMP_RANK: Record<string, number> = {
  'herz:10': 13,
  'kreuz:dame': 12,
  'pik:dame': 11,
  'herz:dame': 10,
  'karo:dame': 9,
  'kreuz:bube': 8,
  'pik:bube': 7,
  'herz:bube': 6,
  'karo:bube': 5,
  'karo:as': 4,
  'karo:10': 3,
  'karo:koenig': 2,
  'karo:9': 1,
};

// Fehlfarbe rank for As, 10, König, 9 (Dame/Bube are trump, not Fehlfarbe)
const FEHLFARBE_RANK: Record<string, number> = {
  as: 4,
  '10': 3,
  koenig: 2,
  '9': 1,
};

// ---------------------------------------------------------------------------
// Card parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parses a card ID and returns the [suit, value] pair.
 * Strips the "doppelkopf:" prefix if present.
 *
 * @example
 * parseCard('doppelkopf:kreuz:dame') // → ['kreuz', 'dame']
 * parseCard('herz:10')               // → ['herz', '10']
 */
export function parseCard(cardId: string): [string, string] {
  const stripped = cardId.startsWith('doppelkopf:')
    ? cardId.slice('doppelkopf:'.length)
    : cardId;
  const colon = stripped.indexOf(':');
  if (colon < 0) return [stripped, ''];
  return [stripped.slice(0, colon), stripped.slice(colon + 1)];
}

/**
 * Returns the trump rank of a card, or 0 if it is not a trump card.
 */
export function trumpRank(cardId: string): number {
  const [suit, value] = parseCard(cardId);
  const key = `${suit}:${value}`;
  return TRUMP_RANK[key] ?? 0;
}

/**
 * Returns true if the card is a trump card in normal-game rules.
 *
 * Trump cards: all Damen, all Buben, all Karo, and Herz 10.
 */
export function isTrump(cardId: string): boolean {
  return trumpRank(cardId) > 0;
}

/**
 * Extracts the logical suit of a card for trick-taking purposes.
 * Trump cards return "trump"; Fehlfarbe cards return their actual suit.
 */
export function extractSuit(cardId: string): string {
  if (isTrump(cardId)) return 'trump';
  const [suit] = parseCard(cardId);
  return suit;
}

/**
 * Extracts the rank value of a card used for Fehlfarbe comparison.
 * Trump cards return their trump rank; Fehlfarbe cards return their Fehlfarbe rank.
 */
export function extractValue(cardId: string): number {
  const tr = trumpRank(cardId);
  if (tr > 0) return tr;
  const [, value] = parseCard(cardId);
  return FEHLFARBE_RANK[value] ?? 0;
}

/**
 * Returns the Augen (point value) of a card.
 */
export function cardAugen(cardId: string): number {
  const [, value] = parseCard(cardId);
  return AUGEN[value] ?? 0;
}

/**
 * Returns a human-readable display name for a card.
 *
 * @example
 * cardDisplayName('doppelkopf:kreuz:dame') // → 'Kreuz Dame'
 * cardDisplayName('doppelkopf:karo:as')    // → 'Karo As (Fuchs)'
 * cardDisplayName('doppelkopf:herz:10')    // → 'Herz 10 (Dullen)'
 * cardDisplayName('doppelkopf:kreuz:bube') // → 'Kreuz Bube (Karlchen)'
 */
export function cardDisplayName(cardId: string): string {
  const [suit, value] = parseCard(cardId);

  const suitName = t(`suits.${suit}`, suit);
  const valueName = t(`cards.${value}`, value);
  let name = `${suitName} ${valueName}`;

  // Special nicknames
  if (suit === 'herz' && value === '10') name += ` (${t('cards.dullen', 'Dullen')})`;
  if (suit === 'karo' && value === 'as') name += ` (${t('cards.fuchs', 'Fuchs')})`;
  if (suit === 'kreuz' && value === 'bube') name += ` (${t('cards.karlchen', 'Karlchen')})`;

  return name;
}

// ---------------------------------------------------------------------------
// Trick-winner logic
// ---------------------------------------------------------------------------

/**
 * Determines the winner of a trick in normal-game Doppelkopf.
 *
 * @param cards  List of [playerIndex, cardId] pairs in play order.
 * @param _trumpSuit  Ignored — trump is always fixed in Doppelkopf.
 * @returns      The playerIndex of the winner.
 *
 * Rules:
 * - All Damen, Buben, Karo cards, and Herz 10 are trump.
 * - Trump beats Fehlfarbe; higher trump rank wins.
 * - Among Fehlfarbe, only cards of the led suit can win; As > 10 > König > 9.
 * - Equal cards: the first one played wins ("liegt oben").
 */
export function determineTrickWinner(
  cards: [number, string][],
  _trumpSuit: string | null,
): number {
  if (cards.length === 0) return 0;

  let winnerIndex = cards[0][0];
  let winnerIsTrump = isTrump(cards[0][1]);
  let winnerRank = winnerIsTrump
    ? trumpRank(cards[0][1])
    : extractValue(cards[0][1]);
  const ledSuit = extractSuit(cards[0][1]);

  for (let i = 1; i < cards.length; i++) {
    const [playerIdx, cardId] = cards[i];
    const trump = isTrump(cardId);
    const suit = extractSuit(cardId);
    const rank = trump ? trumpRank(cardId) : extractValue(cardId);

    if (trump && !winnerIsTrump) {
      // Trump beats Fehlfarbe.
      winnerIndex = playerIdx;
      winnerIsTrump = true;
      winnerRank = rank;
    } else if (trump && winnerIsTrump && rank > winnerRank) {
      // Higher trump wins; equal trump → first played wins (no update).
      winnerIndex = playerIdx;
      winnerRank = rank;
    } else if (!trump && !winnerIsTrump && suit === ledSuit && rank > winnerRank) {
      // Higher Fehlfarbe of the led suit wins; equal → first played wins.
      winnerIndex = playerIdx;
      winnerRank = rank;
    }
    // All other cases: current winner keeps the trick.
  }

  return winnerIndex;
}

// ---------------------------------------------------------------------------
// Round score helper (legacy per-player — returns 0 when calculateAllRoundScores is used)
// ---------------------------------------------------------------------------

/**
 * Returns 0 to prevent double-counting.
 * Full scoring is handled by calculateAllRoundScores.
 */
export function calculateRoundScore(_bid: number, _tricksWon: number): number {
  return 0;
}

// ---------------------------------------------------------------------------
// Full round scoring — calculateAllRoundScores
// ---------------------------------------------------------------------------

interface TrickRecord {
  cards: [number, string][];  // [playerIndex, cardId]
  winnerIndex: number;
}

interface RoundContext {
  playerNames: string[];
  trickHistory: TrickRecord[];
  announcements: string[];  // e.g. ["re"] or ["re", "kontra"]
}

interface RoundScoreResult {
  scores: Record<string, number>;
  summary: { label: string; value: string }[];
}

/**
 * Detects the Re team by finding which players played Kreuz Dame.
 * In normal Doppelkopf, the two players holding Kreuz Dame form the Re team.
 * Returns a Set of player indices on the Re team.
 */
function detectReTeam(trickHistory: TrickRecord[]): Set<number> {
  const reMembers = new Set<number>();
  for (const trick of trickHistory) {
    for (const [playerIdx, cardId] of trick.cards) {
      const [suit, value] = parseCard(cardId);
      if (suit === 'kreuz' && value === 'dame') {
        reMembers.add(playerIdx);
      }
    }
  }
  return reMembers;
}

/**
 * Sums Augen won by each team based on trick winners.
 */
function sumAugenByTeam(
  trickHistory: TrickRecord[],
  reTeam: Set<number>,
): { reAugen: number; kontraAugen: number } {
  let reAugen = 0;
  let kontraAugen = 0;

  for (const trick of trickHistory) {
    let trickAugen = 0;
    for (const [, cardId] of trick.cards) {
      trickAugen += cardAugen(cardId);
    }
    if (reTeam.has(trick.winnerIndex)) {
      reAugen += trickAugen;
    } else {
      kontraAugen += trickAugen;
    }
  }

  return { reAugen, kontraAugen };
}

interface ExtraPoint {
  label: string;
  forRe: boolean;  // true = point for Re, false = point for Kontra
}

/**
 * Detects extra point events.
 */
function detectExtras(
  trickHistory: TrickRecord[],
  reTeam: Set<number>,
): ExtraPoint[] {
  const extras: ExtraPoint[] = [];

  // Fuchs gefangen: Kontra catches Re's Karo As, or vice versa.
  // A "Fuchs" (Karo As) is caught when the opposing team wins a trick
  // containing a Fuchs played by the other team.
  for (const trick of trickHistory) {
    for (const [playerIdx, cardId] of trick.cards) {
      const [suit, value] = parseCard(cardId);
      if (suit === 'karo' && value === 'as') {
        const playerIsRe = reTeam.has(playerIdx);
        const winnerIsRe = reTeam.has(trick.winnerIndex);
        if (playerIsRe && !winnerIsRe) {
          extras.push({ label: t('scoring.fuchs_caught', 'Fuchs gefangen'), forRe: false });
        } else if (!playerIsRe && winnerIsRe) {
          extras.push({ label: t('scoring.fuchs_caught', 'Fuchs gefangen'), forRe: true });
        }
      }
    }
  }

  // Karlchen letzter Stich: Kreuz Bube wins the last trick.
  if (trickHistory.length > 0) {
    const lastTrick = trickHistory[trickHistory.length - 1];
    for (const [playerIdx, cardId] of lastTrick.cards) {
      const [suit, value] = parseCard(cardId);
      if (suit === 'kreuz' && value === 'bube' && playerIdx === lastTrick.winnerIndex) {
        const winnerIsRe = reTeam.has(lastTrick.winnerIndex);
        extras.push({ label: t('scoring.karlchen_label', 'Karlchen'), forRe: winnerIsRe });
        break;
      }
    }
  }

  // Doppelkopf: a trick worth 40+ Augen.
  for (const trick of trickHistory) {
    let trickAugen = 0;
    for (const [, cardId] of trick.cards) {
      trickAugen += cardAugen(cardId);
    }
    if (trickAugen >= 40) {
      const winnerIsRe = reTeam.has(trick.winnerIndex);
      extras.push({ label: t('scoring.doppelkopf_label', 'Doppelkopf'), forRe: winnerIsRe });
    }
  }

  // Gegen die Alten: Kontra wins the game (scored separately in Spielpunkte).
  // This is not an extra point — it's part of the base game result.

  return extras;
}

/**
 * Calculates Spielpunkte (game points) for the round.
 *
 * Base game: Re needs 121+ Augen to win; Kontra wins with 120+.
 * Graduated thresholds: keine 90 (+1), keine 60 (+1), keine 30 (+1), schwarz (+1).
 * Extras: +1 each.
 * "Gegen die Alten": +1 if Kontra wins (always counted).
 * Announcements: each doubles the final value (Re doubles, Kontra doubles again).
 *
 * Returns positive value for Re win, negative for Kontra win.
 */
function calculateSpielPunkte(
  reAugen: number,
  kontraAugen: number,
  extras: ExtraPoint[],
  announcements: string[],
): { points: number; reWins: boolean; breakdown: { label: string; value: string }[] } {
  const breakdown: { label: string; value: string }[] = [];

  // Determine winner.
  const reWins = reAugen >= 121;
  breakdown.push({
    label: reWins ? t('scoring.re_wins', 'Re gewinnt') : t('scoring.kontra_wins', 'Kontra gewinnt'),
    value: `${reAugen} : ${kontraAugen} ${t('scoring.augen_unit', 'Augen')}`,
  });

  // Base point: winning.
  let points = 1;

  // Gegen die Alten: if Kontra wins, +1 extra point.
  if (!reWins) {
    points++;
    breakdown.push({ label: t('scoring.gegen_die_alten', 'Gegen die Alten'), value: '+1' });
  }

  // Graduated thresholds — count for the winning team.
  const loserAugen = reWins ? kontraAugen : reAugen;

  if (loserAugen < 90) {
    points++;
    breakdown.push({ label: t('scoring.keine_90', 'Keine 90'), value: '+1' });
  }
  if (loserAugen < 60) {
    points++;
    breakdown.push({ label: t('scoring.keine_60', 'Keine 60'), value: '+1' });
  }
  if (loserAugen < 30) {
    points++;
    breakdown.push({ label: t('scoring.keine_30', 'Keine 30'), value: '+1' });
  }
  if (loserAugen === 0) {
    points++;
    breakdown.push({ label: t('scoring.schwarz', 'Schwarz'), value: '+1' });
  }

  // Extras.
  for (const extra of extras) {
    // Extra points count for the team that achieved them,
    // regardless of who won the game.
    if (extra.forRe) {
      points++;
      breakdown.push({ label: extra.label + ' (Re)', value: '+1' });
    } else {
      // Kontra earned this extra — subtract from Re's perspective.
      points--;
      breakdown.push({ label: extra.label + ' (Kontra)', value: '-1' });
    }
  }

  // Announcements multiply the final value.
  const hasRe = announcements.includes('re');
  const hasKontra = announcements.includes('kontra');
  if (hasRe) {
    points *= 2;
    breakdown.push({ label: t('scoring.re_announced', 'Re angesagt'), value: '×2' });
  }
  if (hasKontra) {
    points *= 2;
    breakdown.push({ label: t('scoring.kontra_announced', 'Kontra angesagt'), value: '×2' });
  }

  // Sign: positive = Re gains, negative = Kontra gains.
  if (!reWins) {
    points = -points;
  }

  return { points, reWins, breakdown };
}

/**
 * Full round scoring for Doppelkopf.
 *
 * Called by the engine after all 12 tricks are completed.
 * Determines Re/Kontra teams, sums Augen, computes Spielpunkte
 * with extras and announcements, and returns per-player scores.
 *
 * Re team members get +points, Kontra team members get -points (or vice versa).
 */
export function calculateAllRoundScores(context: RoundContext): RoundScoreResult {
  const { playerNames, trickHistory, announcements } = context;

  // Detect Re team from Kreuz Dame plays.
  const reTeam = detectReTeam(trickHistory);

  // If we couldn't detect teams (e.g. incomplete data), fall back to 0 scores.
  if (reTeam.size === 0) {
    const scores: Record<string, number> = {};
    for (const name of playerNames) scores[name] = 0;
    return { scores, summary: [{ label: t('scoring.error', 'Fehler'), value: t('scoring.re_team_unknown', 'Re-Team nicht erkannt') }] };
  }

  // Sum Augen per team.
  const { reAugen, kontraAugen } = sumAugenByTeam(trickHistory, reTeam);

  // Detect extras.
  const extras = detectExtras(trickHistory, reTeam);

  // Calculate Spielpunkte.
  const { points, reWins, breakdown } = calculateSpielPunkte(
    reAugen, kontraAugen, extras, announcements,
  );

  // Build team summary.
  const reNames: string[] = [];
  const kontraNames: string[] = [];
  for (let i = 0; i < playerNames.length; i++) {
    if (reTeam.has(i)) {
      reNames.push(playerNames[i]);
    } else {
      kontraNames.push(playerNames[i]);
    }
  }

  const summary: { label: string; value: string }[] = [
    { label: t('scoring.re', 'Re'), value: reNames.join(', ') },
    { label: t('scoring.kontra', 'Kontra'), value: kontraNames.join(', ') },
    ...breakdown,
    { label: t('scoring.spielpunkte', 'Spielpunkte'), value: `${points > 0 ? '+' : ''}${points}` },
  ];

  // Assign scores: winners get +|points|, losers get -|points|.
  const absPoints = Math.abs(points);
  const scores: Record<string, number> = {};
  for (let i = 0; i < playerNames.length; i++) {
    const isRe = reTeam.has(i);
    if (reWins) {
      scores[playerNames[i]] = isRe ? absPoints : -absPoints;
    } else {
      scores[playerNames[i]] = isRe ? -absPoints : absPoints;
    }
  }

  return { scores, summary };
}

// ---------------------------------------------------------------------------
// Photo-mode scorer
// ---------------------------------------------------------------------------

/**
 * Groups detected cards per player and annotates each card with its
 * Augen value and whether it is a trump card.
 */
export function score(players: PlayerInput[]): PlayerScoreResult[] {
  return players.map((player) => {
    if (player.cards.length === 0) {
      return { name: player.name, totalScore: 0, cardDetails: [] };
    }

    const cardDetails: CardScoreDetail[] = player.cards.map((card) => {
      const [suit] = parseCard(card.cardId);
      const points = cardAugen(card.cardId);
      const displayName = cardDisplayName(card.cardId);
      const trump = isTrump(card.cardId);
      const group = trump ? t('scoring.trump_group', 'Trumpf') : t(`suits.${suit}`, suit);
      return {
        cardId: card.cardId,
        points,
        reason: displayName,
        title: displayName,
        group,
      };
    });

    const totalScore = cardDetails.reduce((sum, d) => sum + d.points, 0);
    return { name: player.name, totalScore, cardDetails };
  });
}
