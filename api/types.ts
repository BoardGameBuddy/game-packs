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
