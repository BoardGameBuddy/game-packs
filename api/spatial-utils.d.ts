/**
 * Common spatial utilities for board game scorers.
 * Provides geometry helpers and visual sorting for card detection.
 */
/**
 * Common interface for objects with bounding box coordinates.
 * Compatible with DetectedCard and custom Box types.
 */
export interface BoxLike {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    cx: number;
    cy: number;
    w: number;
    h: number;
}
/**
 * Calculates horizontal overlap between two boxes.
 * @returns The width of the overlapping region, or 0 if no overlap.
 */
export declare function overlapHorizontal(a: BoxLike, b: BoxLike): number;
/**
 * Calculates vertical overlap between two boxes.
 * @returns The height of the overlapping region, or 0 if no overlap.
 */
export declare function overlapVertical(a: BoxLike, b: BoxLike): number;
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
export declare function sortVisuallyByBox<T>(items: T[], getBox: (item: T) => BoxLike, epsilon?: number): T[];
/**
 * Parses a card ID with a delimiter (typically ':').
 * Common format: "prefix:suffix" or "kind:id" or "id:symbol"
 *
 * @param cardId The card ID string to parse
 * @param separator The delimiter character (default: ':')
 * @returns Object with prefix and suffix, or null if no separator found
 */
export declare function parseCardId(cardId: string, separator?: string): {
    prefix: string;
    suffix: string;
} | null;
