/**
 * Shared scorer utilities for game packs.
 */

import type { DetectedBox } from './types';

/**
 * Groups a flat box list into per-player arrays using angular position from
 * the image center (0.5, 0.5).  Angle 0 = bottom (6 o'clock), increasing
 * clockwise.  The returned groups are ordered starting from the bottom-most
 * cluster, proceeding clockwise.
 *
 * With a single player all boxes go to player 0.
 */
export function groupByPlayer(boxes: DetectedBox[], playerCount: number): DetectedBox[][] {
  if (playerCount <= 1) return [boxes];
  if (boxes.length === 0) return Array.from({ length: playerCount }, () => []);

  // Compute angle from image center for each box.
  const angles: number[] = boxes.map(box => {
    const dx = box.cx - 0.5;
    const dy = box.cy - 0.5;
    let a = Math.atan2(dx, dy); // 0 = bottom, CW positive
    if (a < 0) a += 2 * Math.PI;
    return a;
  });

  // Sort indices by angle.
  const sorted = boxes.map((_, i) => i).sort((a, b) => angles[a] - angles[b]);

  if (sorted.length <= playerCount) {
    const groups: DetectedBox[][] = Array.from({ length: playerCount }, () => []);
    for (let p = 0; p < sorted.length; p++) groups[p].push(boxes[sorted[p]]);
    return groups;
  }

  // Compute circular gaps between consecutive sorted boxes.
  const gapSizes: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const next = (i + 1) % sorted.length;
    let gap = angles[sorted[next]] - angles[sorted[i]];
    if (gap <= 0) gap += 2 * Math.PI;
    gapSizes.push(gap);
  }

  // Find the largest gap — the "empty zone" between last and first player.
  let largestGapPos = 0;
  for (let i = 1; i < gapSizes.length; i++) {
    if (gapSizes[i] > gapSizes[largestGapPos]) largestGapPos = i;
  }

  // Reorder starting from after the largest gap.
  const startPos = (largestGapPos + 1) % sorted.length;
  const reordered: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    reordered.push(sorted[(startPos + i) % sorted.length]);
  }

  // Find the k-1 largest gaps within the reordered (linear) sequence.
  const innerGaps: { pos: number; size: number }[] = [];
  for (let i = 0; i < reordered.length - 1; i++) {
    let gap = angles[reordered[i + 1]] - angles[reordered[i]];
    if (gap < 0) gap += 2 * Math.PI;
    innerGaps.push({ pos: i, size: gap });
  }
  innerGaps.sort((a, b) => b.size - a.size);
  const splitPositions = innerGaps.slice(0, playerCount - 1).map(g => g.pos).sort((a, b) => a - b);

  // Split reordered list into groups at the gap positions.
  const indexGroups: number[][] = [];
  let start = 0;
  for (const sp of splitPositions) {
    indexGroups.push(reordered.slice(start, sp + 1));
    start = sp + 1;
  }
  indexGroups.push(reordered.slice(start));

  // Rotate groups so the one closest to the bottom (angle 0) comes first.
  const centroids = indexGroups.map(g => {
    let sinSum = 0, cosSum = 0;
    for (const idx of g) {
      sinSum += Math.sin(angles[idx]);
      cosSum += Math.cos(angles[idx]);
    }
    let c = Math.atan2(sinSum, cosSum);
    if (c < 0) c += 2 * Math.PI;
    return c;
  });

  const circDist = (a: number, b: number) => {
    let d = Math.abs(a - b);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d;
  };

  let bottomIdx = 0;
  let minDist = circDist(centroids[0], 0);
  for (let i = 1; i < indexGroups.length; i++) {
    const d = circDist(centroids[i], 0);
    if (d < minDist) {
      minDist = d;
      bottomIdx = i;
    }
  }

  const result: DetectedBox[][] = [];
  for (let i = 0; i < indexGroups.length; i++) {
    const g = indexGroups[(bottomIdx + i) % indexGroups.length];
    result.push(g.map(idx => boxes[idx]));
  }

  // Pad with empty arrays if fewer groups than players.
  while (result.length < playerCount) result.push([]);

  return result;
}

/**
 * Removes duplicate detections of the same card.
 *
 * When two (or more) boxes share the same `cardId` and overlap significantly
 * (IoU >= `iouThreshold`), only the one with the highest `similarity` score
 * is kept.  Boxes with different `cardId` values are never suppressed, and
 * non-overlapping duplicates are preserved (they may represent genuinely
 * distinct physical cards with the same ID, e.g. two copies of a card).
 *
 * @param boxes        Array of detected boxes.
 * @param iouThreshold Minimum IoU to consider two same-ID boxes duplicates (default 0.3).
 * @returns            Filtered array with duplicates removed.
 */
export function deduplicateBoxes(boxes: DetectedBox[], iouThreshold: number = 0.3): DetectedBox[] {
  if (boxes.length <= 1) return boxes;

  const suppressed = new Set<number>();

  for (let i = 0; i < boxes.length; i++) {
    if (suppressed.has(i)) continue;
    for (let j = i + 1; j < boxes.length; j++) {
      if (suppressed.has(j)) continue;
      if (boxes[i].cardId !== boxes[j].cardId) continue;

      const iou = computeIoU(boxes[i], boxes[j]);
      if (iou >= iouThreshold) {
        // Suppress the one with lower similarity
        suppressed.add(boxes[i].similarity >= boxes[j].similarity ? j : i);
      }
    }
  }

  return boxes.filter((_, i) => !suppressed.has(i));
}

function computeIoU(a: DetectedBox, b: DetectedBox): number {
  const interW = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const interH = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = interW * interH;
  if (inter === 0) return 0;
  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  return inter / (areaA + areaB - inter);
}

/**
 * Creates a translator function `t(key, fallback)` that resolves dot-separated
 * keys against a texts.json file.
 *
 * At app runtime the global `__texts` is pre-injected with flattened strings.
 * In Node.js/tests it loads and flattens the caller's `texts.json` manually.
 *
 * @param textsJsonPath  Path for `require()` to load texts.json (e.g. `'./texts.json'`).
 *                       Ignored when `__texts` is already available at runtime.
 * @param lang           Language key to extract from texts.json (default `'de'`).
 */
// @ts-ignore — __texts may be injected by app runtime
declare var __texts: Record<string, string> | undefined;

export function createTranslator(
  textsJsonPath: string,
  lang: string = 'de',
): (key: string, fallback?: string) => string {
  const resolved: Record<string, string> = (() => {
    if (typeof __texts === 'object' && __texts !== null) return __texts;
    try {
      const raw = require(textsJsonPath);
      const flat: Record<string, string> = {};
      (function flatten(obj: any, prefix: string) {
        for (const k of Object.keys(obj)) {
          const key = prefix ? `${prefix}.${k}` : k;
          if (typeof obj[k] === 'object' && obj[k] !== null) {
            flatten(obj[k], key);
          } else {
            flat[key] = String(obj[k]);
          }
        }
      })(raw[lang] || {}, '');
      return flat;
    } catch {
      return {};
    }
  })();

  return function t(key: string, fallback?: string): string {
    const val = resolved[key];
    return val !== undefined ? val : (fallback !== undefined ? fallback : key);
  };
}
