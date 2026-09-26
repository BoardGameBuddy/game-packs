import { groupByPlayer } from '../scorer-utils';
import type { DetectedBox } from '../types';

function box(cx: number, cy: number, playerIndex?: number): DetectedBox {
  return {
    cardId: 'region:01', similarity: 1, confidence: 1,
    x1: cx - 0.05, y1: cy - 0.05, x2: cx + 0.05, y2: cy + 0.05,
    cx, cy, w: 0.1, h: 0.1, angle: 0, keypoints: null,
    ...(playerIndex === undefined ? {} : { playerIndex }),
  };
}

describe('groupByPlayer', () => {
  it('uses playerIndex when every box has one, ignoring position', () => {
    // Same spot in two different photos: position alone can't separate them.
    const boxes = [box(0.5, 0.8, 1), box(0.5, 0.8, 0), box(0.4, 0.2, 1)];
    const { indices } = groupByPlayer(boxes, 2);
    expect(indices).toEqual([[1], [0, 2]]);
  });

  it('keeps empty groups for players without cards', () => {
    const { groups, indices } = groupByPlayer([box(0.5, 0.5, 2)], 3);
    expect(indices).toEqual([[], [], [0]]);
    expect(groups[2]).toHaveLength(1);
  });

  it('falls back to angular grouping when a hint is missing or invalid', () => {
    const bottom = box(0.5, 0.9);
    const top = box(0.5, 0.1, 0);
    expect(groupByPlayer([bottom, top], 2).indices).toEqual([[0], [1]]);
    const outOfRange = [box(0.5, 0.9, 5), box(0.5, 0.1, 5)];
    expect(groupByPlayer(outOfRange, 2).indices).toEqual([[0], [1]]);
  });
});
