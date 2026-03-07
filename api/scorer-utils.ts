/**
 * Shared scorer utilities for game packs.
 */

import type { DetectedBox } from './types';

/**
 * Groups a flat box list into per-player arrays using y-coordinate bands.
 * Player i receives all boxes with cy in [i/n, (i+1)/n).
 * With a single player all boxes go to player 0.
 */
export function groupByPlayer(boxes: DetectedBox[], playerCount: number): DetectedBox[][] {
  if (playerCount <= 1) return [boxes];
  const groups: DetectedBox[][] = Array.from({ length: playerCount }, () => []);
  const bandSize = 1.0 / playerCount;
  for (const box of boxes) {
    const idx = Math.min(Math.floor(box.cy / bandSize), playerCount - 1);
    groups[idx].push(box);
  }
  return groups;
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
