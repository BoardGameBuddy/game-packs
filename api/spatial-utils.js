"use strict";
/**
 * Common spatial utilities for board game scorers.
 * Provides geometry helpers and visual sorting for card detection.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.overlapHorizontal = overlapHorizontal;
exports.overlapVertical = overlapVertical;
exports.sortVisuallyByBox = sortVisuallyByBox;
exports.parseCardId = parseCardId;
/**
 * Calculates horizontal overlap between two boxes.
 * @returns The width of the overlapping region, or 0 if no overlap.
 */
function overlapHorizontal(a, b) {
    return Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
}
/**
 * Calculates vertical overlap between two boxes.
 * @returns The height of the overlapping region, or 0 if no overlap.
 */
function overlapVertical(a, b) {
    return Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
}
/**
 * Sorts items in visual reading order (top-to-bottom, then left-to-right).
 * Items whose y1 values are within half the average height are considered
 * the same row and sorted left-to-right.
 *
 * @param items Array of items to sort
 * @param getBox Function to extract box coordinates from each item
 * @param epsilon Small value for floating-point comparison tolerance (default: 1e-3)
 * @returns A new sorted array of items
 */
function sortVisuallyByBox(items, getBox, epsilon = 1e-3) {
    if (items.length === 0)
        return items;
    const avgH = items.reduce((sum, item) => sum + getBox(item).h, 0) / items.length;
    const rowThreshold = Math.max(avgH / 2, epsilon);
    return [...items].sort((a, b) => {
        const boxA = getBox(a);
        const boxB = getBox(b);
        if (Math.abs(boxA.y1 - boxB.y1) < rowThreshold)
            return boxA.x1 - boxB.x1;
        return boxA.y1 - boxB.y1;
    });
}
/**
 * Parses a card ID with a delimiter (typically ':').
 * Common format: "prefix:suffix" or "kind:id" or "id:symbol"
 *
 * @param cardId The card ID string to parse
 * @param separator The delimiter character (default: ':')
 * @returns Object with prefix and suffix, or null if no separator found
 */
function parseCardId(cardId, separator = ':') {
    const idx = cardId.indexOf(separator);
    if (idx < 0)
        return null;
    return {
        prefix: cardId.slice(0, idx).trim(),
        suffix: cardId.slice(idx + 1).trim(),
    };
}
