export interface DetectedCard {
  cardId: string;
  similarity: number;
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
  keypoints: number[] | null;
}

/** Preferred alias for DetectedCard in the flat-box scorer API. */
export type DetectedBox = DetectedCard;

export interface PlayerInput {
  name: string;
  cards: DetectedCard[];
}

/** Declares an extra input a game pack needs from the user before scoring. */
export interface AdditionalInput {
  id: string;
  label: string;
  type: 'stepper';
  perPlayer: boolean;
  min?: number;
  default?: number;
}

/** Game session metadata passed alongside the flat box list to `processCards()`. */
export interface ScorerContext {
  players: string[];
  similarityThreshold: number;
  /**
   * Values collected from the user for each declared AdditionalInput.
   * perPlayer inputs: Record<playerName, number>; global inputs: number.
   */
  additionalInputs?: Record<string, Record<string, number> | number>;
}

export interface CardScoreDetail {
  cardId: string;
  points: number;
  reason: string;
  title?: string;
  group?: string;
}

export interface PlayerScoreResult {
  name: string;
  totalScore: number;
  cardDetails: CardScoreDetail[];
}

// ---------------------------------------------------------------------------
// Live tracking types
// ---------------------------------------------------------------------------

export interface LiveEvent {
  type: 'gameStarted'
      | 'bidPlaced'
      | 'announcementMade'
      | 'roundEnded';
  data: Record<string, unknown>;
}

export type FlutterAction =
  | { type: 'speak'; text: string }
  | { type: 'cameraMode'; mode: 'detecting' | 'paused' }
  | { type: 'awaitTableClear' }
  | { type: 'setLeadPlayer'; playerIndex: number }
  | { type: 'listenForBid'; prompt: string; playerIndex: number }
  | { type: 'startAnnouncementListening'; triggerWords: Record<string, string[]>; until: number }
  | { type: 'stopAnnouncementListening' }
  | { type: 'showSummary' }
  | { type: 'gameOver' };

export interface LiveHudItem {
  label: string;
  value: string;
}

export interface LiveGameState {
  /** Opaque game data carried forward unchanged (scorer reads/writes; Flutter ignores). */
  _internal?: unknown;
  /** What Flutter displays (game-defined content). */
  display: {
    hud: LiveHudItem[];
    summary?: LiveHudItem[];
  };
  /** Cumulative per-player scores (updated after each roundEnded). */
  scores: { name: string; totalScore: number }[];
  /** Actions Flutter executes in order after receiving this state. */
  actions: FlutterAction[];
}

// ---------------------------------------------------------------------------
// Unified game pack interface
// ---------------------------------------------------------------------------

/** Unified game state returned by processCards() and processEvent(). */
export interface GameState {
  /** Per-player scores with card-level breakdown. */
  players: PlayerScoreResult[];
  /** HUD and summary display data (used by live tracking, optional for photo). */
  display?: {
    hud: LiveHudItem[];
    summary?: LiveHudItem[];
  };
  /** Actions for Flutter to execute (TTS, camera mode, etc.). */
  actions?: FlutterAction[];
}

/** The contract every game pack class implements. */
export interface GamePack {
  /** Process currently visible cards and return updated state.
   *  Receives ALL currently visible cards — the pack diffs against
   *  previous state internally to determine what's new.
   *  [context] carries additional user-provided inputs when declared via `inputs`. */
  processCards(cards: DetectedBox[], context?: ScorerContext): GameState;
  /** Handle non-card events (bids, announcements, round transitions).
   *  Only needed for live tracking games. */
  processEvent?(event: LiveEvent): GameState;
}
