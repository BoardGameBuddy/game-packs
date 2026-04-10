/**
 * Wizard – BoardGameBuddy scorer
 *
 * TypeScript port of the Kotlin WizardScorer.
 *
 * processCards() is state-aware: it diffs visible cards against the previous
 * frame, tracks newly appeared cards per player, and feeds them into the
 * current trick. processEvent() remains the authoritative state machine
 * (trump detection, bids, trick completion, round scoring).
 *
 * Card IDs follow the pattern `wizard:<suit>:<number>` where:
 *   suit   = blue | green | red | yellow | wizard | jester
 *   number = zero-padded two-digit string, e.g. "01"–"13" for colour
 *            suits, "01"–"04" for wizard/jester cards
 */

import type { GamePack, GameState, DetectedBox, ScorerContext, PlayerScoreResult, CardScoreDetail, LiveEvent, LiveGameState, LiveHudItem, FlutterAction } from '@boardgamebuddy/game-pack-api';
import { createTranslator } from '@boardgamebuddy/game-pack-api';

// ---------------------------------------------------------------------------
// Localisation
// ---------------------------------------------------------------------------

const t = createTranslator(require('path').join(__dirname, 'texts.json'));

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
// Live tracking — processEvent
// ---------------------------------------------------------------------------

/** Internal state carried across events. */
interface WizardInternal {
  players: string[];
  round: number;       // current round, 1-based
  maxRounds: number;   // total rounds = 60 / players.length
  phase: 'trumpDetection' | 'bidCollection' | 'waitingForClear' | 'trickTracking';
  trumpSuit: string | null;
  bids: Record<string, number>;
  bidIndex: number;    // index of next player to bid
  tricksWon: Record<string, number>;
  completedTricks: number;
  cumulativeScores: Record<string, number>;
  /** Card IDs seen in the previous processCards call — used for diffing new arrivals. */
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

/** Formats a number with explicit sign (+/-). */
function fmtSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function buildScores(s: WizardInternal): PlayerScoreResult[] {
  return s.players.map(p => ({ name: p, totalScore: s.cumulativeScores[p] ?? 0, cardDetails: [] }));
}

function buildScoresWithCards(s: WizardInternal): PlayerScoreResult[] {
  const cardDetails: CardScoreDetail[] = s.currentTrickCards.map(([playerIdx, cardId]) => {
    const [displayName, group] = parseCardDisplay(cardId);
    return {
      cardId,
      points: 0,
      reason: `${s.players[playerIdx]}: ${displayName}`,
      title: displayName,
      group,
    };
  });
  return s.players.map((name, i) => ({
    name,
    totalScore: s.cumulativeScores[name] ?? 0,
    cardDetails: cardDetails.filter(d =>
      s.currentTrickCards.some(([pi, id]) => id === d.cardId && s.players[pi] === name)),
  }));
}

function buildHud(s: WizardInternal): LiveHudItem[] {
  const hud: LiveHudItem[] = [];
  const tricksPerRound = s.round;

  hud.push({
    label: `${t('ui.round_label', 'Runde')} ${s.round}/${s.maxRounds}`,
    value: `${t('ui.trick_count', 'Stich')} ${s.completedTricks}/${tricksPerRound}`,
  });

  if (s.phase !== 'trumpDetection') {
    const trumpName = s.trumpSuit
      ? t(`suits.${s.trumpSuit}`, s.trumpSuit)
      : t('suits.no_trump', 'Kein Trumpf');
    hud.push({ label: 'Trumpf', value: trumpName });
  }

  if (s.phase === 'trickTracking') {
    for (const player of s.players) {
      const bid = s.bids[player];
      const won = s.tricksWon[player] ?? 0;
      hud.push({
        label: player,
        value: bid !== undefined ? `${won}/${bid}` : String(won),
      });
    }
  }

  return hud;
}

function buildRoundSummary(s: WizardInternal): LiveHudItem[] {
  const summary: LiveHudItem[] = [];
  for (const player of s.players) {
    const bid = s.bids[player] ?? 0;
    const won = s.tricksWon[player] ?? 0;
    const score = calculateRoundScore(bid, won);
    const cumulative = s.cumulativeScores[player] ?? 0;
    summary.push({
      label: player,
      value: `${won}/${s.round} → ${fmtSigned(score)} (Σ ${cumulative})`,
    });
  }
  return summary;
}

function buildGameOverSummary(s: WizardInternal): LiveHudItem[] {
  const sorted = [...s.players].sort(
    (a, b) => (s.cumulativeScores[b] ?? 0) - (s.cumulativeScores[a] ?? 0),
  );
  return sorted.map((p, i) => ({
    label: `${i + 1}. ${p}`,
    value: `${s.cumulativeScores[p] ?? 0} ${t('ui.points', 'Punkte')}`,
  }));
}

// ---------------------------------------------------------------------------
// WizardGame class
// ---------------------------------------------------------------------------

export class WizardGame implements GamePack {
  private players: string[];
  private state: WizardInternal;

  constructor(players: string[]) {
    this.players = players;
    const maxRounds = Math.floor(60 / players.length);
    this.state = {
      players,
      round: 1,
      maxRounds,
      phase: 'trumpDetection',
      trumpSuit: null,
      bids: {},
      bidIndex: 0,
      tricksWon: {},
      completedTricks: 0,
      cumulativeScores: Object.fromEntries(players.map(p => [p, 0])),
      previousCardIds: [],
      currentTrickCards: [],
      trickCompletionFired: false,
      emptyCallCount: 0,
      waitingForTableClear: false,
      trickLeader: 0,
    };
  }

  processCards(boxes: DetectedBox[]): GameState {
    const s = this.state;
    const currentIds = boxes.map(b => b.cardId);
    const previousSet = new Set(s.previousCardIds);
    const newCards = boxes.filter(b => !previousSet.has(b.cardId));
    s.previousCardIds = currentIds;

    // --- trumpDetection: detect trump from visible cards ---
    if (s.phase === 'trumpDetection') {
      // When exactly one card is visible, treat it as the trump card.
      if (boxes.length === 1) {
        const cardId = boxes[0].cardId;
        const suit = extractSuit(cardId);
        const trumpSuit = (suit === 'wizard' || suit === 'jester') ? null : suit;
        s.trumpSuit = trumpSuit;
        s.phase = 'bidCollection';
        s.bidIndex = 0;

        const trumpName = trumpSuit
          ? t(`suits.${trumpSuit}`, trumpSuit)
          : t('suits.no_trump', 'Kein Trumpf');
        const trumpSpeak = trumpSuit
          ? t('voice.trump_confirm', 'Trumpf ist %s. Jetzt Ansagen.').replace('%s', trumpName)
          : t('voice.no_trump_confirm', 'Kein Trumpf. Jetzt ansagen.');
        const firstPlayer = s.players[0];
        const bidPrompt = t('voice.bid_prompt', '%s, deine Ansage?').replace('%s', firstPlayer);

        return {
          players: buildScores(s),
          display: { hud: buildHud(s) },
          actions: [
            { type: 'speak', text: trumpSpeak },
            { type: 'cameraMode', mode: 'paused' },
            { type: 'listenForBid', prompt: bidPrompt, playerIndex: 0 },
          ],
        };
      }
      return {
        players: buildScores(s),
        display: { hud: buildHud(s) },
      };
    }

    // --- waitingForClear: count empty frames, transition to trickTracking ---
    if (s.phase === 'waitingForClear' || s.waitingForTableClear) {
      if (boxes.length === 0) {
        s.emptyCallCount++;
        if (s.emptyCallCount >= EMPTY_CALLS_THRESHOLD) {
          s.emptyCallCount = 0;
          s.waitingForTableClear = false;
          s.trickCompletionFired = false;
          s.currentTrickCards = [];
          s.previousCardIds = [];
          if (s.phase === 'waitingForClear') {
            s.phase = 'trickTracking';
          }
          return {
            players: buildScores(s),
            display: { hud: buildHud(s) },
          };
        }
      } else {
        s.emptyCallCount = 0;
      }
      return {
        players: buildScores(s),
        display: { hud: buildHud(s) },
      };
    }

    // --- trickTracking: track newly appeared cards sequentially from trick leader ---
    if (s.phase === 'trickTracking') {
      if (newCards.length > 0 && !s.trickCompletionFired) {
        for (const card of newCards) {
          if (!s.currentTrickCards.some(([, id]) => id === card.cardId)) {
            const playerIdx = (s.trickLeader + s.currentTrickCards.length) % s.players.length;
            s.currentTrickCards.push([playerIdx, card.cardId]);
          }
        }
      }

      // Check for trick completion
      if (s.currentTrickCards.length >= s.players.length && !s.trickCompletionFired) {
        s.trickCompletionFired = true;
        s.waitingForTableClear = true;

        const cards = s.currentTrickCards;
        const winnerIndex = determineTrickWinner(cards, s.trumpSuit);
        const winnerName = s.players[winnerIndex];

        s.tricksWon[winnerName] = (s.tricksWon[winnerName] ?? 0) + 1;
        s.completedTricks++;
        s.trickLeader = winnerIndex;

        const trickNum = s.completedTricks;
        const trickWonText = t('voice.trick_won', '%s gewinnt Stich %d.')
          .replace('%s', winnerName).replace('%d', String(trickNum));

        if (s.completedTricks >= s.round) {
          // Last trick — calculate round scores
          for (const p of s.players) {
            const bid = s.bids[p] ?? 0;
            const won = s.tricksWon[p] ?? 0;
            const roundScore = calculateRoundScore(bid, won);
            s.cumulativeScores[p] = (s.cumulativeScores[p] ?? 0) + roundScore;
          }

          const summaryItems = buildRoundSummary(s);
          const summaryText = t('voice.round_summary_intro', 'Rundenabschluss.');

          return {
            players: buildScoresWithCards(s),
            display: { hud: buildHud(s), summary: summaryItems },
            actions: [
              { type: 'speak', text: `${trickWonText} ${summaryText}` },
              { type: 'showSummary' },
            ],
          };
        }

        // Not last trick
        return {
          players: buildScoresWithCards(s),
          display: { hud: buildHud(s) },
          actions: [
            { type: 'speak', text: trickWonText },
          ],
        };
      }

      // No trick completion — just display current state with card details
      return {
        players: buildScoresWithCards(s),
        display: { hud: buildHud(s) },
      };
    }

    // --- bidCollection: just show current HUD ---
    return {
      players: buildScores(s),
      display: { hud: buildHud(s) },
    };
  }

  processEvent(event: LiveEvent): GameState {
    const type = event.type;
    const data = event.data;
    const s = this.state;

    // ---- gameStarted --------------------------------------------------------
    if (type === 'gameStarted') {
      const players = data.players as string[];
      const maxRounds = Math.floor(60 / players.length);
      this.state = {
        players,
        round: 1,
        maxRounds,
        phase: 'trumpDetection',
        trumpSuit: null,
        bids: {},
        bidIndex: 0,
        tricksWon: {},
        completedTricks: 0,
        cumulativeScores: Object.fromEntries(players.map(p => [p, 0])),
        previousCardIds: [],
        currentTrickCards: [],
        trickCompletionFired: false,
        emptyCallCount: 0,
        waitingForTableClear: false,
        trickLeader: 0,
      };
      const roundText = t('voice.round_start', 'Runde %d von %d.')
        .replace('%d', String(this.state.round)).replace('%d', String(this.state.maxRounds));
      const hintText = t('ui.trump_detection_hint', 'Bitte zeige die Trumpfkarte der Kamera.');
      return {
        players: buildScores(this.state),
        display: { hud: [] },
        actions: [
          { type: 'cameraMode', mode: 'detecting' },
          { type: 'speak', text: `${roundText} ${hintText}` },
        ],
      };
    }

    // ---- bidPlaced ----------------------------------------------------------
    if (type === 'bidPlaced') {
      const playerIndex = data.playerIndex as number;
      const bid = data.bid as number;
      const player = s.players[playerIndex];
      s.bids[player] = bid;
      s.bidIndex = playerIndex + 1;

      const confirmText = t('voice.bid_confirm', '%s sagt %s an.')
        .replace('%s', player).replace('%s', String(bid));
      const actions: FlutterAction[] = [
        { type: 'speak', text: confirmText },
      ];

      const allBidsIn = s.bidIndex >= s.players.length;
      if (allBidsIn) {
        s.phase = 'waitingForClear';
        const bidsDoneText = t('voice.bids_done', 'Danke. Los gehts.');
        actions.push(
          { type: 'speak', text: bidsDoneText },
          { type: 'cameraMode', mode: 'detecting' },
          { type: 'awaitTableClear' },
        );
      } else {
        const nextPlayer = s.players[s.bidIndex];
        const nextPrompt = t('voice.bid_prompt', '%s, deine Ansage?').replace('%s', nextPlayer);
        actions.push({ type: 'listenForBid', prompt: nextPrompt, playerIndex: s.bidIndex });
      }

      return {
        players: buildScores(s),
        display: { hud: buildHud(s) },
        actions,
      };
    }

    // ---- roundEnded ---------------------------------------------------------
    if (type === 'roundEnded') {
      const justFinishedRound = s.round;
      s.round++;
      s.trumpSuit = null;
      s.bids = {};
      s.bidIndex = 0;
      s.tricksWon = {};
      s.completedTricks = 0;
      s.currentTrickCards = [];
      s.previousCardIds = [];
      s.trickCompletionFired = false;
      s.emptyCallCount = 0;
      s.waitingForTableClear = false;

      if (justFinishedRound >= s.maxRounds) {
        // Game over
        const sorted = [...s.players].sort(
          (a, b) => (s.cumulativeScores[b] ?? 0) - (s.cumulativeScores[a] ?? 0),
        );
        const winner = sorted[0];
        const gameOverText = t('voice.game_over', '%s gewinnt mit %d Punkten!')
          .replace('%s', winner)
          .replace('%d', String(s.cumulativeScores[winner] ?? 0));
        return {
          players: buildScores(s),
          display: { hud: [], summary: buildGameOverSummary(s) },
          actions: [
            { type: 'speak', text: gameOverText },
            { type: 'gameOver' },
          ],
        };
      }

      // Next round
      s.phase = 'trumpDetection';
      const roundText = t('voice.round_start', 'Runde %d von %d.')
        .replace('%d', String(s.round)).replace('%d', String(s.maxRounds));
      const hintText = t('ui.trump_detection_hint', 'Bitte zeige die Trumpfkarte der Kamera.');
      return {
        players: buildScores(s),
        display: { hud: [] },
        actions: [
          { type: 'cameraMode', mode: 'detecting' },
          { type: 'speak', text: `${roundText} ${hintText}` },
        ],
      };
    }

    // Unknown event
    return { players: buildScores(s), display: { hud: buildHud(s) }, actions: [] };
  }
}

// ---------------------------------------------------------------------------
// Legacy wrappers
// ---------------------------------------------------------------------------

export function processCards(boxes: DetectedBox[], context: ScorerContext): PlayerScoreResult[] {
  const game = new WizardGame(context.players);
  return game.processCards(boxes).players;
}

export function processEvent(event: LiveEvent, prevState: LiveGameState | null): LiveGameState {
  const game = new WizardGame([]);
  // Reconstruct internal state from prevState
  if (prevState?._internal) {
    (game as any).state = prevState._internal as WizardInternal;
  }
  const result = game.processEvent(event);
  return {
    _internal: (game as any).state,
    display: result.display ?? { hud: [] },
    scores: result.players,
    actions: result.actions ?? [],
  };
}

export { WizardGame as Game };
