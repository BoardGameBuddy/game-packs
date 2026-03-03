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
/** Game session metadata passed alongside the flat box list to `score()`. */
export interface ScorerContext {
    players: string[];
    similarityThreshold: number;
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
export interface LiveEvent {
    type: 'gameStarted' | 'cardDetected' | 'bidPlaced' | 'trickCompleted' | 'announcementMade' | 'tableCleared' | 'roundEnded';
    data: Record<string, unknown>;
}
export type FlutterAction = {
    type: 'speak';
    text: string;
} | {
    type: 'cameraMode';
    mode: 'detectSingle' | 'trackTrick' | 'pause';
} | {
    type: 'awaitTableClear';
} | {
    type: 'setLeadPlayer';
    playerIndex: number;
} | {
    type: 'listenForBid';
    prompt: string;
    playerIndex: number;
} | {
    type: 'startAnnouncementListening';
    triggerWords: Record<string, string[]>;
    until: number;
} | {
    type: 'stopAnnouncementListening';
} | {
    type: 'showSummary';
} | {
    type: 'gameOver';
};
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
    scores: {
        name: string;
        totalScore: number;
    }[];
    /** Actions Flutter executes in order after receiving this state. */
    actions: FlutterAction[];
}
