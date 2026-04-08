/**
 * Doppelkopf – BoardGameBuddy scorer
 *
 * TypeScript implementation of Doppelkopf card scoring and trick-winner logic.
 *
 * Card IDs follow the pattern `<suit>:<value>` where:
 *   suit  = clubs | spades | heart | diamond
 *   value = 9 | 10 | jack | queen | king | ace
 *
 * Each card is present twice in the deck (48 cards total).
 *
 * Trump order (highest → lowest, normal game):
 *   1.  heart:10      (Dullen)
 *   2.  clubs:queen   (Alten)
 *   3.  spades:queen
 *   4.  heart:queen
 *   5.  diamond:queen
 *   6.  clubs:jack    (Karlchen – makes last trick for extra point)
 *   7.  spades:jack
 *   8.  heart:jack
 *   9.  diamond:jack
 *   10. diamond:ace   (Fuchs)
 *   11. diamond:10
 *   12. diamond:king
 *   13. diamond:9
 *
 * Fehlfarben (clubs, spades, heart) order: ace > 10 > king > 9
 * Note: Queens and Jacks are always trump regardless of suit; Heart 10 is trump.
 */

import type { GamePack, GameState, DetectedBox, ScorerContext, PlayerScoreResult, CardScoreDetail, LiveEvent, LiveGameState, LiveHudItem, FlutterAction } from '@boardgamebuddy/game-pack-api';
import { createTranslator } from '@boardgamebuddy/game-pack-api';

// ---------------------------------------------------------------------------
// Localisation
// ---------------------------------------------------------------------------

const t = createTranslator('./texts.json');

// ---------------------------------------------------------------------------
// Card point values (Augen)
// ---------------------------------------------------------------------------

const AUGEN: Record<string, number> = {
  ace: 11,
  '10': 10,
  king: 4,
  queen: 3,
  jack: 2,
  '9': 0,
};

// ---------------------------------------------------------------------------
// Trump rank table (1 = lowest, 13 = highest)
// ---------------------------------------------------------------------------

const TRUMP_RANK: Record<string, number> = {
  'heart:10': 13,
  'clubs:queen': 12,
  'spades:queen': 11,
  'heart:queen': 10,
  'diamond:queen': 9,
  'clubs:jack': 8,
  'spades:jack': 7,
  'heart:jack': 6,
  'diamond:jack': 5,
  'diamond:ace': 4,
  'diamond:10': 3,
  'diamond:king': 2,
  'diamond:9': 1,
};

// Fehlfarbe rank for ace, 10, king, 9 (queen/jack are trump, not Fehlfarbe)
const FEHLFARBE_RANK: Record<string, number> = {
  ace: 4,
  '10': 3,
  king: 2,
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
 * parseCard('clubs:queen') // → ['clubs', 'queen']
 * parseCard('heart:10')    // → ['heart', '10']
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
 * Trump cards: all queens, all jacks, all diamonds, and heart:10.
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
 * cardDisplayName('clubs:queen')   // → 'Clubs Queen (Alten)'
 * cardDisplayName('diamond:ace')   // → 'Diamond Ace (Fuchs)'
 * cardDisplayName('heart:10')      // → 'Heart 10 (Dullen)'
 * cardDisplayName('clubs:jack')    // → 'Clubs Jack (Karlchen)'
 */
export function cardDisplayName(cardId: string): string {
  const [suit, value] = parseCard(cardId);

  const suitName = t(`suits.${suit}`, suit);
  const valueName = t(`cards.${value}`, value);
  let name = `${suitName} ${valueName}`;

  // Special nicknames
  if (suit === 'heart' && value === '10') name += ` (${t('cards.dullen', 'Dullen')})`;
  if (suit === 'diamond' && value === 'ace') name += ` (${t('cards.fuchs', 'Fuchs')})`;
  if (suit === 'clubs' && value === 'jack') name += ` (${t('cards.karlchen', 'Karlchen')})`;

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
      if (suit === 'clubs' && value === 'queen') {
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
      if (suit === 'diamond' && value === 'ace') {
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

  // Karlchen letzter Stich: Kreuz Bube in last trick.
  //   - Karlchen player wins the trick → bonus for their team
  //   - Partner wins the trick → no score
  //   - Opponent wins the trick → penalty for the Karlchen player's team
  if (trickHistory.length > 0) {
    const lastTrick = trickHistory[trickHistory.length - 1];
    for (const [playerIdx, cardId] of lastTrick.cards) {
      const [suit, value] = parseCard(cardId);
      if (suit === 'clubs' && value === 'jack') {
        const playerIsRe = reTeam.has(playerIdx);
        const winnerIsRe = reTeam.has(lastTrick.winnerIndex);
        if (playerIdx === lastTrick.winnerIndex) {
          // Karlchen wins the trick: bonus for their team.
          extras.push({ label: t('scoring.karlchen_label', 'Karlchen'), forRe: playerIsRe });
        } else if (playerIsRe !== winnerIsRe) {
          // Opponent wins the trick: penalty against the Karlchen player's team.
          extras.push({ label: t('scoring.karlchen_penalty', 'Karlchen Strafe'), forRe: !playerIsRe });
        }
        // Partner wins: no score — nothing pushed.
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
 *   Exception: if only Kontra is announced (not Re), Re wins with 120+.
 * Graduated thresholds: keine 90 (+1), keine 60 (+1), keine 30 (+1), schwarz (+1).
 * "Gegen die Alten": +1 if Kontra wins.
 * Announcements: each adds 2 flat points (Re +2, Kontra +2).
 * Extras (Fuchs, Karlchen, Doppelkopf): independent of game result and announcements.
 *
 * Returns reScore (positive = Re gains, negative = Kontra gains).
 */
function calculateSpielPunkte(
  reAugen: number,
  kontraAugen: number,
  extras: ExtraPoint[],
  announcements: string[],
): { reScore: number; reWins: boolean; breakdown: { label: string; value: string }[] } {
  const breakdown: { label: string; value: string }[] = [];

  const hasRe = announcements.includes('re');
  const hasKontra = announcements.includes('kontra');

  // Win condition: if only Kontra is announced (not Re), Re wins at 120+.
  const reThreshold = (hasKontra && !hasRe) ? 120 : 121;
  const reWins = reAugen >= reThreshold;

  breakdown.push({
    label: reWins ? t('scoring.re_wins', 'Re gewinnt') : t('scoring.kontra_wins', 'Kontra gewinnt'),
    value: `${reAugen} : ${kontraAugen} ${t('scoring.augen_unit', 'Augen')}`,
  });

  // --- Game points (all additive, sign applied at the end) ---
  let gamePoints = 1; // base: winning

  // Gegen die Alten: +1 if Kontra wins.
  if (!reWins) {
    gamePoints++;
    breakdown.push({ label: t('scoring.gegen_die_alten', 'Gegen die Alten'), value: '+1' });
  }

  // Graduated thresholds — based on the loser's Augen.
  const loserAugen = reWins ? kontraAugen : reAugen;

  if (loserAugen < 90) {
    gamePoints++;
    breakdown.push({ label: t('scoring.keine_90', 'Keine 90'), value: '+1' });
  }
  if (loserAugen < 60) {
    gamePoints++;
    breakdown.push({ label: t('scoring.keine_60', 'Keine 60'), value: '+1' });
  }
  if (loserAugen < 30) {
    gamePoints++;
    breakdown.push({ label: t('scoring.keine_30', 'Keine 30'), value: '+1' });
  }
  if (loserAugen === 0) {
    gamePoints++;
    breakdown.push({ label: t('scoring.schwarz', 'Schwarz'), value: '+1' });
  }

  // Announcements: each adds +2 flat (not a multiplier).
  if (hasRe) {
    gamePoints += 2;
    breakdown.push({ label: t('scoring.re_announced', 'Re angesagt'), value: '+2' });
  }
  if (hasKontra) {
    gamePoints += 2;
    breakdown.push({ label: t('scoring.kontra_announced', 'Kontra angesagt'), value: '+2' });
  }

  // --- Extras (independent of game result and announcement bonuses) ---
  // Positive = favours Re, negative = favours Kontra.
  let netExtras = 0;
  for (const extra of extras) {
    if (extra.forRe) {
      netExtras++;
      breakdown.push({ label: extra.label + ' (Re)', value: '+1' });
    } else {
      netExtras--;
      breakdown.push({ label: extra.label + ' (Kontra)', value: '+1' });
    }
  }

  // Final score from Re's perspective:
  //   game part is sign-flipped when Kontra wins;
  //   extras are always directional and never flipped.
  const reScore = (reWins ? gamePoints : -gamePoints) + netExtras;

  return { reScore, reWins, breakdown };
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
  const { reScore, reWins, breakdown } = calculateSpielPunkte(
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
    { label: t('scoring.spielpunkte', 'Spielpunkte'), value: `${reScore > 0 ? '+' : ''}${reScore}` },
  ];

  // Assign scores: Re players get reScore, Kontra players get -reScore.
  // reScore is already sign-aware (positive = Re wins, negative = Kontra wins)
  // with extras applied independently.
  const scores: Record<string, number> = {};
  for (let i = 0; i < playerNames.length; i++) {
    const isRe = reTeam.has(i);
    scores[playerNames[i]] = isRe ? reScore : -reScore;
  }

  return { scores, summary };
}

// ---------------------------------------------------------------------------
// Live tracking — processEvent
// ---------------------------------------------------------------------------

interface TrickHistoryEntry {
  cards: [number, string][];
  winnerIndex: number;
}

interface DoppelkopfInternal {
  players: string[];
  completedTricks: number;
  trickHistory: TrickHistoryEntry[];
  announcements: string[];
  cumulativeScores: Record<string, number>;
  /** Card IDs seen in the previous processCards call — used for count-based diffing (supports duplicates). */
  previousCardIds: string[];
  /** Cards detected in the current trick: [playerIndex, cardId] pairs. */
  currentTrickCards: [number, string][];
  /** Guards against firing trick completion actions more than once. */
  trickCompletionFired: boolean;
  /** Counts consecutive processCards calls with no visible cards (for table-clear detection). */
  emptyCallCount: number;
  /** True after a trick completes, waiting for cards to be removed. */
  waitingForTableClear: boolean;
  /** Index of the player who leads the current trick (round-robin assignment). */
  trickLeader: number;
}

/** Number of consecutive processCards calls with empty boxes required to confirm table clear. */
const EMPTY_CALLS_THRESHOLD = 5;

/** Announcement trigger words keyed by id, as defined in game.json. */
const ANNOUNCEMENT_TRIGGERS: Record<string, string[]> = {
  re:     ['re', 'ree'],
  kontra: ['kontra', 'contra'],
};
const ANNOUNCEMENT_UNTIL = 2; // maxTrick window

function buildScoresDk(s: DoppelkopfInternal): PlayerScoreResult[] {
  return s.players.map(p => ({ name: p, totalScore: s.cumulativeScores[p] ?? 0, cardDetails: [] }));
}

function buildScoresDkWithCards(s: DoppelkopfInternal): PlayerScoreResult[] {
  const cardDetails: CardScoreDetail[] = s.currentTrickCards.map(([playerIdx, cardId]) => {
    const [suit] = parseCard(cardId);
    const points = cardAugen(cardId);
    const displayName = cardDisplayName(cardId);
    const trump = isTrump(cardId);
    const group = trump ? t('scoring.trump_group', 'Trumpf') : t(`suits.${suit}`, suit);
    return {
      cardId,
      points,
      reason: `${s.players[playerIdx]}: ${displayName}`,
      title: displayName,
      group,
    };
  });
  return s.players.map((name, playerIdx) => ({
    name,
    totalScore: s.cumulativeScores[name] ?? 0,
    cardDetails: cardDetails.filter((_, i) => s.currentTrickCards[i][0] === playerIdx),
  }));
}

function buildHudDk(s: DoppelkopfInternal): LiveHudItem[] {
  const hud: LiveHudItem[] = [];
  hud.push({
    label: t('ui.trick_count', 'Stiche'),
    value: `${s.completedTricks}/12`,
  });

  // Augen per player (from trickHistory)
  const playerAugen: Record<string, number> = {};
  for (const p of s.players) playerAugen[p] = 0;
  for (const trick of s.trickHistory) {
    const winner = s.players[trick.winnerIndex];
    if (winner) {
      let trickAugen = 0;
      for (const [, cardId] of trick.cards) trickAugen += cardAugen(cardId);
      playerAugen[winner] = (playerAugen[winner] ?? 0) + trickAugen;
    }
  }

  for (const p of s.players) {
    hud.push({ label: p, value: `${playerAugen[p] ?? 0} ${t('scoring.augen_unit', 'Augen')}` });
  }

  // Announcements
  for (const ann of s.announcements) {
    hud.push({ label: ann.toUpperCase(), value: '✓' });
  }

  return hud;
}

// ---------------------------------------------------------------------------
// DoppelkopfGame class
// ---------------------------------------------------------------------------

export class DoppelkopfGame implements GamePack {
  private players: string[];
  private state: DoppelkopfInternal;

  constructor(players: string[]) {
    this.players = players;
    this.state = {
      players,
      completedTricks: 0,
      trickHistory: [],
      announcements: [],
      cumulativeScores: Object.fromEntries(players.map(p => [p, 0])),
      previousCardIds: [],
      currentTrickCards: [],
      trickCompletionFired: false,
      emptyCallCount: 0,
      waitingForTableClear: false,
      trickLeader: 0,
    };
  }

  /**
   * Count-based diffing that supports duplicate card IDs (Doppelkopf has 2 copies of each card).
   * Returns boxes that are "new" compared to the previous call.
   */
  private diffNewCards(boxes: DetectedBox[]): DetectedBox[] {
    const s = this.state;
    const currentIds = boxes.map(b => b.cardId);

    // Build count maps
    const prevCounts: Record<string, number> = {};
    for (const id of s.previousCardIds) {
      prevCounts[id] = (prevCounts[id] ?? 0) + 1;
    }

    // Track which boxes are genuinely new (count exceeds previous count)
    const usedCounts: Record<string, number> = {};
    const newCards: DetectedBox[] = [];
    for (const box of boxes) {
      const id = box.cardId;
      usedCounts[id] = (usedCounts[id] ?? 0) + 1;
      if (usedCounts[id] > (prevCounts[id] ?? 0)) {
        newCards.push(box);
      }
    }

    s.previousCardIds = currentIds;
    return newCards;
  }

  processCards(boxes: DetectedBox[]): GameState {
    const s = this.state;
    const newCards = this.diffNewCards(boxes);

    // --- waitingForTableClear: count empty frames ---
    if (s.waitingForTableClear) {
      if (boxes.length === 0) {
        s.emptyCallCount++;
        if (s.emptyCallCount >= EMPTY_CALLS_THRESHOLD) {
          s.emptyCallCount = 0;
          s.waitingForTableClear = false;
          s.trickCompletionFired = false;
          s.currentTrickCards = [];
          s.previousCardIds = [];
        }
      } else {
        s.emptyCallCount = 0;
      }
      return {
        players: buildScoresDk(s),
        display: { hud: buildHudDk(s) },
      };
    }

    // Track newly appeared cards — assign sequentially starting from trick leader
    if (newCards.length > 0 && !s.trickCompletionFired) {
      for (const card of newCards) {
        const playerIdx = (s.trickLeader + s.currentTrickCards.length) % s.players.length;
        s.currentTrickCards.push([playerIdx, card.cardId]);
      }
    }

    // Check for trick completion
    if (s.currentTrickCards.length >= s.players.length && !s.trickCompletionFired) {
      s.trickCompletionFired = true;
      s.waitingForTableClear = true;

      const cards = s.currentTrickCards;
      const winnerIndex = determineTrickWinner(cards, null);
      const winnerName = s.players[winnerIndex] ?? '?';

      let trickAugen = 0;
      for (const [, cardId] of cards) trickAugen += cardAugen(cardId);

      s.trickHistory.push({ cards, winnerIndex });
      s.completedTricks++;
      s.trickLeader = winnerIndex;

      const trickNum = s.completedTricks;
      const trickWonText = trickAugen > 0
        ? t('voice.trick_won_augen', '%s gewinnt Stich %d mit %d Augen.')
            .replace('%s', winnerName).replace('%d', String(trickNum)).replace('%d', String(trickAugen))
        : t('voice.trick_won', '%s gewinnt Stich %d.')
            .replace('%s', winnerName).replace('%d', String(trickNum));

      if (s.completedTricks >= 12) {
        // Last trick — calculate round scores
        const roundResult = calculateAllRoundScores({
          playerNames: s.players,
          trickHistory: s.trickHistory,
          announcements: s.announcements,
        });
        for (const p of s.players) {
          s.cumulativeScores[p] = (s.cumulativeScores[p] ?? 0) + (roundResult.scores[p] ?? 0);
        }

        const summaryItems: LiveHudItem[] = [
          ...roundResult.summary,
          { label: '---', value: '' },
          ...s.players.map(p => ({
            label: p,
            value: `${t('ui.score_total', 'Gesamt:')} ${s.cumulativeScores[p] ?? 0}`,
          })),
        ];

        const summaryText = t('voice.round_summary_intro', 'Spielabschluss.');
        return {
          players: buildScoresDk(s),
          display: { hud: buildHudDk(s), summary: summaryItems },
          actions: [
            { type: 'speak', text: `${trickWonText} ${summaryText}` },
            { type: 'stopAnnouncementListening' },
            { type: 'showSummary' },
          ],
        };
      }

      // Not last trick
      const actions: FlutterAction[] = [
        { type: 'speak', text: trickWonText },
      ];

      if (s.completedTricks >= ANNOUNCEMENT_UNTIL) {
        actions.push({ type: 'stopAnnouncementListening' });
      }

      return {
        players: buildScoresDk(s),
        display: { hud: buildHudDk(s) },
        actions,
      };
    }

    // No trick completion — just display current state with card details
    return {
      players: buildScoresDkWithCards(s),
      display: { hud: buildHudDk(s) },
    };
  }

  processEvent(event: LiveEvent): GameState {
    const type = event.type;
    const data = event.data;
    const s = this.state;

    // ---- gameStarted --------------------------------------------------------
    if (type === 'gameStarted') {
      const players = data.players as string[];
      this.state = {
        players,
        completedTricks: 0,
        trickHistory: [],
        announcements: [],
        cumulativeScores: Object.fromEntries(players.map(p => [p, 0])),
        previousCardIds: [],
        currentTrickCards: [],
        trickCompletionFired: false,
        emptyCallCount: 0,
        waitingForTableClear: false,
        trickLeader: 0,
      };
      const gameStartText = t('voice.game_start', 'Spiel beginnt. Tisch bitte leeren.');
      return {
        players: buildScoresDk(this.state),
        display: { hud: [] },
        actions: [
          { type: 'cameraMode', mode: 'detecting' },
          { type: 'awaitTableClear' },
          {
            type: 'startAnnouncementListening',
            triggerWords: ANNOUNCEMENT_TRIGGERS,
            until: ANNOUNCEMENT_UNTIL,
          },
          { type: 'speak', text: gameStartText },
        ],
      };
    }

    // ---- announcementMade ---------------------------------------------------
    if (type === 'announcementMade') {
      const id = data.id as string;
      if (!s.announcements.includes(id)) {
        s.announcements.push(id);
      }
      const confirmText = t('voice.announcement_confirmed', '%s angesagt!').replace('%s', id.toUpperCase());
      return {
        players: buildScoresDk(s),
        display: { hud: buildHudDk(s) },
        actions: [{ type: 'speak', text: confirmText }],
      };
    }

    // ---- roundEnded ---------------------------------------------------------
    if (type === 'roundEnded') {
      // Reset round state
      s.completedTricks = 0;
      s.trickHistory = [];
      s.announcements = [];
      s.currentTrickCards = [];
      s.previousCardIds = [];
      s.trickCompletionFired = false;
      s.emptyCallCount = 0;
      s.waitingForTableClear = false;
      s.trickLeader = 0;

      const nextRoundText = t('voice.next_round', 'Naechste Runde. Tisch bitte leeren.');
      return {
        players: buildScoresDk(s),
        display: { hud: [] },
        actions: [
          { type: 'speak', text: nextRoundText },
          { type: 'cameraMode', mode: 'detecting' },
          { type: 'awaitTableClear' },
          {
            type: 'startAnnouncementListening',
            triggerWords: ANNOUNCEMENT_TRIGGERS,
            until: ANNOUNCEMENT_UNTIL,
          },
        ],
      };
    }

    // Unknown event
    return { players: buildScoresDk(s), display: { hud: buildHudDk(s) }, actions: [] };
  }
}

// ---------------------------------------------------------------------------
// Legacy wrappers
// ---------------------------------------------------------------------------

export function processCards(boxes: DetectedBox[], context: ScorerContext): PlayerScoreResult[] {
  const game = new DoppelkopfGame(context.players);
  return game.processCards(boxes).players;
}

export function processEvent(event: LiveEvent, prevState: LiveGameState | null): LiveGameState {
  const game = new DoppelkopfGame([]);
  // Reconstruct internal state from prevState
  if (prevState?._internal) {
    (game as any).state = prevState._internal as DoppelkopfInternal;
  }
  const result = game.processEvent(event);
  return {
    _internal: (game as any).state,
    display: result.display ?? { hud: [] },
    scores: result.players,
    actions: result.actions ?? [],
  };
}

export { DoppelkopfGame as Game };
