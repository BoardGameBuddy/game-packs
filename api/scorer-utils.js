"use strict";
/**
 * Shared scorer utilities for game packs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupByPlayer = groupByPlayer;
exports.createTranslator = createTranslator;
/**
 * Groups a flat box list into per-player arrays using y-coordinate bands.
 * Player i receives all boxes with cy in [i/n, (i+1)/n).
 * With a single player all boxes go to player 0.
 */
function groupByPlayer(boxes, playerCount) {
    if (playerCount <= 1)
        return [boxes];
    const groups = Array.from({ length: playerCount }, () => []);
    const bandSize = 1.0 / playerCount;
    for (const box of boxes) {
        const idx = Math.min(Math.floor(box.cy / bandSize), playerCount - 1);
        groups[idx].push(box);
    }
    return groups;
}
function createTranslator(textsJsonPath, lang = 'de') {
    const resolved = (() => {
        if (typeof __texts === 'object' && __texts !== null)
            return __texts;
        try {
            const raw = require(textsJsonPath);
            const flat = {};
            (function flatten(obj, prefix) {
                for (const k of Object.keys(obj)) {
                    const key = prefix ? `${prefix}.${k}` : k;
                    if (typeof obj[k] === 'object' && obj[k] !== null) {
                        flatten(obj[k], key);
                    }
                    else {
                        flat[key] = String(obj[k]);
                    }
                }
            })(raw[lang] || {}, '');
            return flat;
        }
        catch (_a) {
            return {};
        }
    })();
    return function t(key, fallback) {
        const val = resolved[key];
        return val !== undefined ? val : (fallback !== undefined ? fallback : key);
    };
}
