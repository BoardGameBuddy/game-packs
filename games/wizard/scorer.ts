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

import type { DetectedBox, ScorerContext, PlayerScoreResult, CardScoreDetail, LiveEvent, LiveGameState, LiveHudItem, FlutterAction } from '@boardgamebuddy/game-pack-api';

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
// Player grouping (y-band spatial split)
// ---------------------------------------------------------------------------

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
}

/** Formats a number with explicit sign (+/-). */
function fmtSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function buildScores(s: WizardInternal): { name: string; totalScore: number }[] {
  return s.players.map(p => ({ name: p, totalScore: s.cumulativeScores[p] ?? 0 }));
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

/**
 * Live tracking entry point.
 * Called by Flutter on each game event; returns updated state + actions to execute.
 */
export function processEvent(event: LiveEvent, prevState: LiveGameState | null): LiveGameState {
  const type = event.type;
  const data = event.data;

  // ---- gameStarted --------------------------------------------------------
  if (type === 'gameStarted') {
    const players = data.players as string[];
    const maxRounds = Math.floor(60 / players.length);
    const internal: WizardInternal = {
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
    };
    const roundText = t('voice.round_start', 'Runde %d von %d.')
      .replace('%d', String(internal.round)).replace('%d', String(internal.maxRounds));
    const hintText = t('ui.trump_detection_hint', 'Bitte zeige die Trumpfkarte der Kamera.');
    return {
      _internal: internal,
      display: { hud: [] },
      scores: buildScores(internal),
      actions: [
        { type: 'cameraMode', mode: 'detectSingle' },
        { type: 'speak', text: `${roundText} ${hintText}` },
      ],
    };
  }

  // Restore internal state for subsequent events
  const internal = (prevState?._internal ?? {}) as WizardInternal;

  // ---- cardDetected (trump detection) -------------------------------------
  if (type === 'cardDetected') {
    if (internal.phase !== 'trumpDetection') {
      // Ignore card events during other phases
      return { ...prevState!, actions: [] };
    }
    const cardId = data.cardId as string;
    const suit = extractSuit(cardId);
    const trumpSuit = (suit === 'wizard' || suit === 'jester') ? null : suit;
    internal.trumpSuit = trumpSuit;
    internal.phase = 'bidCollection';
    internal.bidIndex = 0;

    const trumpName = trumpSuit
      ? t(`suits.${trumpSuit}`, trumpSuit)
      : t('suits.no_trump', 'Kein Trumpf');
    const trumpSpeak = trumpSuit
      ? t('voice.trump_confirm', 'Trumpf ist %s. Jetzt Ansagen.').replace('%s', trumpName)
      : t('voice.no_trump_confirm', 'Kein Trumpf. Jetzt ansagen.');
    const firstPlayer = internal.players[0];
    const bidPrompt = t('voice.bid_prompt', '%s, deine Ansage?').replace('%s', firstPlayer);

    return {
      _internal: internal,
      display: { hud: buildHud(internal) },
      scores: buildScores(internal),
      actions: [
        { type: 'speak', text: trumpSpeak },
        { type: 'cameraMode', mode: 'pause' },
        { type: 'listenForBid', prompt: bidPrompt, playerIndex: 0 },
      ],
    };
  }

  // ---- bidPlaced ----------------------------------------------------------
  if (type === 'bidPlaced') {
    const playerIndex = data.playerIndex as number;
    const bid = data.bid as number;
    const player = internal.players[playerIndex];
    internal.bids[player] = bid;
    internal.bidIndex = playerIndex + 1;

    const confirmText = t('voice.bid_confirm', '%s sagt %s an.')
      .replace('%s', player).replace('%s', String(bid));
    const actions: FlutterAction[] = [
      { type: 'speak', text: confirmText },
    ];

    const allBidsIn = internal.bidIndex >= internal.players.length;
    if (allBidsIn) {
      internal.phase = 'waitingForClear';
      const bidsDoneText = t('voice.bids_done', 'Danke. Los gehts.');
      actions.push(
        { type: 'speak', text: bidsDoneText },
        { type: 'cameraMode', mode: 'trackTrick' },
        { type: 'awaitTableClear' },
      );
    } else {
      const nextPlayer = internal.players[internal.bidIndex];
      const nextPrompt = t('voice.bid_prompt', '%s, deine Ansage?').replace('%s', nextPlayer);
      actions.push({ type: 'listenForBid', prompt: nextPrompt, playerIndex: internal.bidIndex });
    }

    return {
      _internal: internal,
      display: { hud: buildHud(internal) },
      scores: buildScores(internal),
      actions,
    };
  }

  // ---- tableCleared -------------------------------------------------------
  if (type === 'tableCleared') {
    internal.phase = 'trickTracking';
    return {
      _internal: internal,
      display: { hud: buildHud(internal) },
      scores: buildScores(internal),
      actions: [],
    };
  }

  // ---- trickCompleted -----------------------------------------------------
  if (type === 'trickCompleted') {
    const cards = data.cards as [number, string][];
    const winnerIndex = determineTrickWinner(cards, internal.trumpSuit);
    const winnerName = internal.players[winnerIndex];

    internal.tricksWon[winnerName] = (internal.tricksWon[winnerName] ?? 0) + 1;
    internal.completedTricks++;

    const tricksPerRound = internal.round;
    const trickNum = internal.completedTricks;
    const trickWonText = t('voice.trick_won', '%s gewinnt Stich %d.')
      .replace('%s', winnerName).replace('%d', String(trickNum));

    if (internal.completedTricks >= tricksPerRound) {
      // Last trick — calculate round scores
      for (const p of internal.players) {
        const bid = internal.bids[p] ?? 0;
        const won = internal.tricksWon[p] ?? 0;
        const score = calculateRoundScore(bid, won);
        internal.cumulativeScores[p] = (internal.cumulativeScores[p] ?? 0) + score;
      }

      const summaryItems = buildRoundSummary(internal);
      const summaryText = t('voice.round_summary_intro', 'Rundenabschluss.');

      return {
        _internal: internal,
        display: { hud: buildHud(internal), summary: summaryItems },
        scores: buildScores(internal),
        actions: [
          { type: 'speak', text: `${trickWonText} ${summaryText}` },
          { type: 'showSummary' },
        ],
      };
    }

    // Not last trick
    return {
      _internal: internal,
      display: { hud: buildHud(internal) },
      scores: buildScores(internal),
      actions: [
        { type: 'speak', text: trickWonText },
        { type: 'setLeadPlayer', playerIndex: winnerIndex },
      ],
    };
  }

  // ---- roundEnded ---------------------------------------------------------
  if (type === 'roundEnded') {
    const justFinishedRound = internal.round;
    internal.round++;
    internal.trumpSuit = null;
    internal.bids = {};
    internal.bidIndex = 0;
    internal.tricksWon = {};
    internal.completedTricks = 0;

    if (justFinishedRound >= internal.maxRounds) {
      // Game over
      const sorted = [...internal.players].sort(
        (a, b) => (internal.cumulativeScores[b] ?? 0) - (internal.cumulativeScores[a] ?? 0),
      );
      const winner = sorted[0];
      const gameOverText = t('voice.game_over', '%s gewinnt mit %d Punkten!')
        .replace('%s', winner)
        .replace('%d', String(internal.cumulativeScores[winner] ?? 0));
      return {
        _internal: internal,
        display: { hud: [], summary: buildGameOverSummary(internal) },
        scores: buildScores(internal),
        actions: [
          { type: 'speak', text: gameOverText },
          { type: 'gameOver' },
        ],
      };
    }

    // Next round
    internal.phase = 'trumpDetection';
    const roundText = t('voice.round_start', 'Runde %d von %d.')
      .replace('%d', String(internal.round)).replace('%d', String(internal.maxRounds));
    const hintText = t('ui.trump_detection_hint', 'Bitte zeige die Trumpfkarte der Kamera.');
    return {
      _internal: internal,
      display: { hud: [] },
      scores: buildScores(internal),
      actions: [
        { type: 'cameraMode', mode: 'detectSingle' },
        { type: 'speak', text: `${roundText} ${hintText}` },
      ],
    };
  }

  // Unknown event — return state unchanged
  return { ...(prevState ?? { _internal: internal, display: { hud: [] }, scores: [], actions: [] }), actions: [] };
}

// ---------------------------------------------------------------------------
// Exported scorer function
// ---------------------------------------------------------------------------

export function score(boxes: DetectedBox[], context: ScorerContext): PlayerScoreResult[] {
  const groups = groupByPlayer(boxes, context.players.length);
  return context.players.map((playerName, i) => {
    const playerBoxes = groups[i] ?? [];
    if (playerBoxes.length === 0) {
      return { name: playerName, totalScore: 0, cardDetails: [] };
    }

    const cardDetails: CardScoreDetail[] = playerBoxes.map((card) => {
      const [displayName, group] = parseCardDisplay(card.cardId);
      return {
        cardId: card.cardId,
        points: 0,
        reason: displayName,
        title: displayName,
        group,
      };
    });

    return { name: playerName, totalScore: 0, cardDetails };
  });
}
