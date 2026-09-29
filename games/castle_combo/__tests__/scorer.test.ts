/**
 * Castle Combo scorer tests.
 *
 * Tableaux are laid out as 3×3 grids (row-major id lists, null = empty space).
 * Expected scores are computed by hand from the rules in cards.json.
 */

import { processCards, inputs } from '../scorer';

/** Helper: box for the grid cell (row, col); w/h are normalised to the photo. */
function card(cardId, row, col, playerIndex = undefined) {
  const x1 = 0.1 + col * 0.25;
  const y1 = 0.05 + row * 0.3;
  return {
    cardId,
    similarity: 0.95,
    confidence: 0.95,
    x1, y1, x2: x1 + 0.2, y2: y1 + 0.28,
    cx: x1 + 0.1, cy: y1 + 0.14,
    w: 0.2, h: 0.28,
    angle: 0,
    keypoints: null,
    playerIndex,
  };
}

function grid(ids, playerIndex = undefined) {
  return ids.flatMap((id, i) => (id ? [card(id, Math.floor(i / 3), i % 3, playerIndex)] : []));
}

function ctx(players, gold = {}, keys = {}) {
  return { players, similarityThreshold: 0.85, additionalInputs: { gold, keys } };
}

function points(result, cardId) {
  return result.cardDetails.find((d) => d.cardId === cardId).points;
}

// ---------------------------------------------------------------------------
describe('basic contract', () => {
  it('returns one result per player in the same order', () => {
    const results = processCards([], ctx(['Alice', 'Bob']));
    expect(results.map((r) => r.name)).toEqual(['Alice', 'Bob']);
    expect(results.every((r) => r.totalScore === 0)).toBe(true);
  });

  it('declares gold and key inputs per player', () => {
    expect(inputs.map((i) => [i.id, i.perPlayer])).toEqual([['gold', true], ['keys', true]]);
  });
});

// ---------------------------------------------------------------------------
describe('lines, positions and face-down cards', () => {
  // Row 0: Duchess (blue blue), Jester (blue), Prince (blue)
  // Row 1: Squire (red), Potter (orange orange, purse 4), Lookout (red)
  // Row 2: Fisherman (yellow yellow), face-down, Carpenter (orange)
  const tableau = grid([
    'castle:duchess', 'castle:jester', 'castle:prince',
    'village:squire', 'village:potter', 'castle:lookout',
    'village:fisherman', 'castle:back', 'village:carpenter',
  ]);
  const [r] = processCards(tableau, ctx(['Alice'], { Alice: 5 }, { Alice: 3 }));

  it('Duchess scores in the top row', () => expect(points(r, 'castle:duchess')).toBe(8));
  it('Jester counts blue shields in its row and column once each', () => expect(points(r, 'castle:jester')).toBe(8));
  it('Prince counts blue shields in its row (incl. double shields)', () => expect(points(r, 'castle:prince')).toBe(16));
  it('Squire counts orange shields in row + column', () => expect(points(r, 'village:squire')).toBe(4));
  it('Potter stores gold up to its purse size', () => expect(points(r, 'village:potter')).toBe(8));
  it('Lookout counts different shield types in its column', () => expect(points(r, 'castle:lookout')).toBe(12));
  it('Fisherman scores in a corner', () => expect(points(r, 'village:fisherman')).toBe(4));
  it('face-down cards score nothing', () => expect(points(r, 'castle:back')).toBe(0));
  it('Carpenter scores with a face-down card', () => expect(points(r, 'village:carpenter')).toBe(8));
  it('remaining keys are worth 1 point each', () => expect(points(r, 'keys')).toBe(3));
  it('reports unstored gold without points', () => expect(points(r, 'gold')).toBe(0));
  it('adds everything up', () => expect(r.totalScore).toBe(71));
});

// ---------------------------------------------------------------------------
describe('tableau-wide rules and gold', () => {
  // Shields: blue 3, red 1, purple 1, green 1, yellow 2, orange 1.
  // 7 castle cards, 2 village cards.
  const tableau = grid([
    'castle:general', 'castle:her_majesty_the_queen', 'castle:his_holiness',
    'castle:baron', 'castle:judge', 'village:brigand',
    'castle:banker', 'castle:steward', 'village:beekeeper',
  ]);
  const [r] = processCards(tableau, ctx(['Alice'], { Alice: 10 }));

  it('General scores per set of 3 identical shields', () => expect(points(r, 'castle:general')).toBe(6));
  it('Queen scores per blue+green+orange set', () => expect(points(r, 'castle:her_majesty_the_queen')).toBe(10));
  it('His Holiness scores nothing with all 6 types present', () => expect(points(r, 'castle:his_holiness')).toBe(0));
  it('Baron fails when a yellow shield is present', () => expect(points(r, 'castle:baron')).toBe(0));
  it('Judge scores per castle+village pair', () => expect(points(r, 'castle:judge')).toBe(6));
  it('Brigand needs 3 village cards per scoring', () => expect(points(r, 'village:brigand')).toBe(0));
  it('gold fills purses in grid order', () => {
    expect(points(r, 'castle:steward')).toBe(6);
    expect(points(r, 'village:beekeeper')).toBe(14);
  });
  it('Banker scores all stored gold', () => expect(points(r, 'castle:banker')).toBe(10));
  it('adds everything up', () => expect(r.totalScore).toBe(52));
});

// ---------------------------------------------------------------------------
describe('rules checked against the printed cards', () => {
  // Row 0: Pilgrim (purple), Monk (purple yellow), Farmer (yellow yellow)
  // Row 1: Stable Boy (blue yellow), —, —
  const tableau = grid([
    'castle:pilgrim', 'village:monk', 'village:farmer',
    'village:stable_boy', null, null,
  ]);
  const [r] = processCards(tableau, ctx(['Alice']));

  it('Pilgrim scores per different shield type in its row', () => {
    // purple, yellow → 2 types
    expect(points(r, 'castle:pilgrim')).toBe(8);
  });

  it('Monk counts yellow shields in its row and column', () => {
    // row 0: 1 + 2 yellow; column 1 has only the Monk
    expect(points(r, 'village:monk')).toBe(6);
  });
});

// ---------------------------------------------------------------------------
describe('grid placement', () => {
  const ids = [
    'castle:astronomer', 'castle:duchess', 'village:woodcutter',
    'village:spice_merchant', 'village:spy', 'castle:captain',
    'village:farmer', 'village:baker', 'castle:guildmaster',
  ];

  it('does not depend on the order of the detected boxes', () => {
    const boxes = grid(ids).reverse();
    const [r] = processCards(boxes, ctx(['Alice']));
    // Astronomer 8 + Duchess 8 + Woodcutter 5 + Spice Merchant 5 + Spy 6
    // + Captain 8 + Farmer 7 + Baker 3 + Guildmaster 5
    expect(r.totalScore).toBe(55);
  });

  it('keeps rows and columns when a card was not detected', () => {
    const boxes = grid(ids.map((id, i) => (i === 4 ? null : id)));
    const [r] = processCards(boxes, ctx(['Alice']));
    expect(r.totalScore).toBe(55 - 6);
    expect(points(r, 'castle:captain')).toBe(8);
    expect(points(r, 'village:baker')).toBe(3);
  });

  it('flags cards outside their scoring position', () => {
    const boxes = grid([
      'village:baker', 'castle:astronomer', 'castle:duchess',
    ]);
    const [r] = processCards(boxes, ctx(['Alice']));
    // Baker in a corner, Astronomer in the middle column.
    expect(points(r, 'village:baker')).toBe(0);
    expect(points(r, 'castle:astronomer')).toBe(0);
    expect(points(r, 'castle:duchess')).toBe(8);
  });

  it('ignores unknown card ids', () => {
    const boxes = [...grid(['castle:duchess']), card('faraway:region:01', 1, 1)];
    const [r] = processCards(boxes, ctx(['Alice']));
    expect(r.cardDetails.map((d) => d.cardId)).toEqual(['castle:duchess']);
    expect(r.boxIndices).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
describe('multiple players', () => {
  it('scores each player with their own inputs', () => {
    const boxes = [
      ...grid(['village:locksmith', 'castle:templar'], 0),
      ...grid(['village:vicar'], 1),
    ];
    const [a, b] = processCards(boxes, ctx(['Alice', 'Bob'], { Bob: 9 }, { Alice: 4, Bob: 1 }));
    // Alice: Locksmith 4 + Templar 4 + 4 keys
    expect(a.totalScore).toBe(12);
    // Bob: Vicar stores 5 of 9 gold → 10, + 1 key
    expect(b.totalScore).toBe(11);
  });
});
