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
export function overlapHorizontal(a: BoxLike, b: BoxLike): number {
  return Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
}

/**
 * Calculates vertical overlap between two boxes.
 * @returns The height of the overlapping region, or 0 if no overlap.
 */
export function overlapVertical(a: BoxLike, b: BoxLike): number {
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
export function sortVisuallyByBox<T>(
  items: T[],
  getBox: (item: T) => BoxLike,
  epsilon: number = 1e-3,
): T[] {
  if (items.length === 0) return items;
  const avgH = items.reduce((sum, item) => sum + getBox(item).h, 0) / items.length;
  const rowThreshold = Math.max(avgH / 2, epsilon);
  return [...items].sort((a, b) => {
    const boxA = getBox(a);
    const boxB = getBox(b);
    if (Math.abs(boxA.y1 - boxB.y1) < rowThreshold) return boxA.x1 - boxB.x1;
    return boxA.y1 - boxB.y1;
  });
}

/**
 * Rectifies bounding box coordinates using card-corner keypoints to remove
 * camera perspective distortion. Returns new boxes with axis-aligned
 * coordinates in a virtual top-down coordinate space. Non-spatial fields
 * (cardId, similarity, confidence, etc.) are preserved unchanged.
 *
 * When fewer than 2 boxes have keypoints, the original boxes are returned
 * unmodified.
 *
 * @param boxes Array of detected boxes, each with optional `keypoints`
 *              (TL, TR, BR, BL as 8 normalised x,y floats).
 * @returns     New array of boxes with rectified spatial coordinates.
 */
export function rectifyBoxes<T extends BoxLike & { keypoints?: number[] | null }>(
  boxes: T[],
): T[] {
  if (boxes.length <= 1) return boxes;

  const withKp = boxes.filter(
    (b) => b.keypoints != null && b.keypoints.length >= 8,
  );
  if (withKp.length < 2) return boxes;

  // Pick the reference card closest to the centroid of all boxes.
  let cenX = 0, cenY = 0;
  for (const b of boxes) { cenX += b.cx; cenY += b.cy; }
  cenX /= boxes.length;
  cenY /= boxes.length;

  let bestBox = withKp[0];
  let bestDist = Infinity;
  for (const b of withKp) {
    const d = (b.cx - cenX) ** 2 + (b.cy - cenY) ** 2;
    if (d < bestDist) { bestDist = d; bestBox = b; }
  }

  const ref = bestBox.keypoints!;
  const rTL = [ref[0], ref[1]];
  const rTR = [ref[2], ref[3]];
  const rBR = [ref[4], ref[5]];
  const rBL = [ref[6], ref[7]];

  const dist = (a: number[], b: number[]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]);
  const side =
    (dist(rTL, rTR) + dist(rBR, rBL) + dist(rTL, rBL) + dist(rTR, rBR)) / 4;
  const rcX = (rTL[0] + rTR[0] + rBR[0] + rBL[0]) / 4;
  const rcY = (rTL[1] + rTR[1] + rBR[1] + rBL[1]) / 4;
  const hs = side / 2;

  const sq = [
    [rcX - hs, rcY - hs],
    [rcX + hs, rcY - hs],
    [rcX + hs, rcY + hs],
    [rcX - hs, rcY + hs],
  ];

  const H = solveHomography3x3([rTL, rTR, rBR, rBL], sq);
  if (!H) return boxes;

  return boxes.map((box) => {
    // Transform the four AABB corners and compute new AABB.
    const corners = [
      applyH(H, box.x1, box.y1),
      applyH(H, box.x2, box.y1),
      applyH(H, box.x2, box.y2),
      applyH(H, box.x1, box.y2),
    ];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const nx1 = Math.min(...xs);
    const ny1 = Math.min(...ys);
    const nx2 = Math.max(...xs);
    const ny2 = Math.max(...ys);
    const nw = nx2 - nx1;
    const nh = ny2 - ny1;

    return {
      ...box,
      x1: nx1, y1: ny1, x2: nx2, y2: ny2,
      cx: nx1 + nw / 2, cy: ny1 + nh / 2,
      w: nw, h: nh,
      angle: 0,
      keypoints: null, // no longer meaningful in rectified space
    };
  });
}

// ---------------------------------------------------------------------------
// Minimal 3×3 homography helpers (no external dependency)
// ---------------------------------------------------------------------------

/** Apply 3×3 homography h (row-major, 9 elements) to (x, y). */
function applyH(h: number[], x: number, y: number): [number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/**
 * Solve 3×3 homography mapping 4 source points to 4 dest points.
 * Returns row-major [h0..h8] with h8 = 1, or null if singular.
 */
function solveHomography3x3(
  src: number[][],
  dst: number[][],
): number[] | null {
  // 8×8 system.
  const a: number[][] = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const b = new Array(8).fill(0);
  for (let i = 0; i < 4; i++) {
    const sx = src[i][0], sy = src[i][1];
    const dx = dst[i][0], dy = dst[i][1];
    const r0 = i * 2, r1 = r0 + 1;
    a[r0][0] = sx; a[r0][1] = sy; a[r0][2] = 1;
    a[r0][6] = -dx * sx; a[r0][7] = -dx * sy;
    b[r0] = dx;
    a[r1][3] = sx; a[r1][4] = sy; a[r1][5] = 1;
    a[r1][6] = -dy * sx; a[r1][7] = -dy * sy;
    b[r1] = dy;
  }
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 8; col++) {
    let maxRow = col, maxVal = Math.abs(a[col][col]);
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(a[row][col]) > maxVal) {
        maxVal = Math.abs(a[row][col]);
        maxRow = row;
      }
    }
    if (maxVal < 1e-12) return null;
    if (maxRow !== col) {
      [a[col], a[maxRow]] = [a[maxRow], a[col]];
      [b[col], b[maxRow]] = [b[maxRow], b[col]];
    }
    const pivot = a[col][col];
    for (let j = col; j < 8; j++) a[col][j] /= pivot;
    b[col] /= pivot;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const f = a[row][col];
      for (let j = col; j < 8; j++) a[row][j] -= f * a[col][j];
      b[row] -= f * b[col];
    }
  }
  return [...b, 1.0];
}

/**
 * Parses a card ID with a delimiter (typically ':').
 * Common format: "prefix:suffix" or "kind:id" or "id:symbol"
 *
 * @param cardId The card ID string to parse
 * @param separator The delimiter character (default: ':')
 * @returns Object with prefix and suffix, or null if no separator found
 */
export function parseCardId(
  cardId: string,
  separator: string = ':',
): { prefix: string; suffix: string } | null {
  const idx = cardId.indexOf(separator);
  if (idx < 0) return null;
  return {
    prefix: cardId.slice(0, idx).trim(),
    suffix: cardId.slice(idx + 1).trim(),
  };
}
