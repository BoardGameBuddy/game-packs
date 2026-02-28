export interface DetectedCard {
    cardId: string;
    similarity: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    cx: number;
    cy: number;
    w: number;
    h: number;
}
export interface PlayerInput {
    name: string;
    cards: DetectedCard[];
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
