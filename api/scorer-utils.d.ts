/**
 * Shared scorer utilities for game packs.
 */
import type { DetectedBox } from './types';
/**
 * Groups a flat box list into per-player arrays using y-coordinate bands.
 * Player i receives all boxes with cy in [i/n, (i+1)/n).
 * With a single player all boxes go to player 0.
 */
export declare function groupByPlayer(boxes: DetectedBox[], playerCount: number): DetectedBox[][];
export declare function createTranslator(textsJsonPath: string, lang?: string): (key: string, fallback?: string) => string;
