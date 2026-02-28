/**
 * Faraway scorer tests.
 *
 * Cards used (from faraway_cards.json):
 *   region:01  – red (city),   stone=1, chimera=1, no task (fixed 0)
 *   region:03  – green (forest), no symbols, fixed 4 pts
 *   region:09  – blue (river),  no symbols, fixed 5 pts
 *   region:11  – green (forest), hints=0, perHint ×2
 *   region:16  – red (city), chimera=1, perChimera ×2
 *   region:17  – blue (river),  stone=1, chimera=0, perStone ×3, condition: chimera_min=2
 *   region:22  – green (forest), night=true, hints=1, perHint ×1
 *   sanctuary:01 – no landscape, perYellowOrBlue ×1
 */

const { score } = require('../scorer');

/** Helper: create a minimal DetectedCard positioned at the given column (x1). */
function card(cardId, x1 = 0.1) {
  return {
    cardId,
    similarity: 0.95,
    x1,
    y1: 0.1,
    x2: x1 + 0.2,
    y2: 0.4,
    cx: x1 + 0.1,
    cy: 0.25,
    w: 0.2,
    h: 0.3,
  };
}

// ---------------------------------------------------------------------------
describe('score – basic contract', () => {
  it('returns one result per player in the same order', () => {
    const players = [
      { name: 'Alice', cards: [] },
      { name: 'Bob', cards: [] },
    ];
    const results = score(players);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('Alice');
    expect(results[1].name).toBe('Bob');
  });

  it('scores 0 for a player with no cards', () => {
    const results = score([{ name: 'Alice', cards: [] }]);
    expect(results[0].totalScore).toBe(0);
    expect(results[0].cardDetails).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('score – fixed-point regions', () => {
  it('awards fixed points for region:03 (fixed 4)', () => {
    const results = score([{ name: 'Alice', cards: [card('region:03')] }]);
    expect(results[0].totalScore).toBe(4);
    expect(results[0].cardDetails[0]).toMatchObject({
      cardId: 'region:03',
      points: 4,
      reason: 'feste 4 Punkte',
      title: 'Region 3',
      group: '1 Regionen',
    });
  });

  it('sums fixed points for two regions (region:03 + region:09 = 9)', () => {
    // region:03 left (first played), region:09 right (last played)
    const results = score([{
      name: 'Alice',
      cards: [card('region:03', 0.1), card('region:09', 0.4)],
    }]);
    expect(results[0].totalScore).toBe(9);
  });

  it('displays regions in last-played-first order (region:09 before region:03)', () => {
    // region:03 is leftmost (first played), so it scores last and appears second
    const results = score([{
      name: 'Alice',
      cards: [card('region:03', 0.1), card('region:09', 0.4)],
    }]);
    const details = results[0].cardDetails;
    expect(details[0].cardId).toBe('region:09'); // last played → first in output
    expect(details[1].cardId).toBe('region:03'); // first played → last in output
  });
});

// ---------------------------------------------------------------------------
describe('score – perHint tasks', () => {
  it('scores perHint ×1 for region:22 (1 hint in its own scope)', () => {
    // region:22 has 1 hint symbol; scope when scored = [itself] → 1 hint
    const results = score([{ name: 'Alice', cards: [card('region:22')] }]);
    expect(results[0].totalScore).toBe(1);
    expect(results[0].cardDetails[0]).toMatchObject({
      cardId: 'region:22',
      points: 1,
      reason: '1 pro Hinweis × 1',
    });
  });

  it('scores perHint ×2 for region:11 using hints from revealed region:22', () => {
    // region:11 (left, perHint ×2, 0 hints) is first played → scored last
    // region:22 (right, perHint ×1, 1 hint) is last played  → scored first
    //
    // Scoring order:
    //   i=1 region:22  scope=[region:22]          hints=1 → 1×1=1
    //   i=0 region:11  scope=[region:22, region:11] hints=1 → 2×1=2
    const results = score([{
      name: 'Alice',
      cards: [card('region:11', 0.1), card('region:22', 0.4)],
    }]);
    expect(results[0].totalScore).toBe(3); // 1 + 2
    const details = results[0].cardDetails;
    expect(details[0]).toMatchObject({ cardId: 'region:22', points: 1 });
    expect(details[1]).toMatchObject({ cardId: 'region:11', points: 2 });
  });
});

// ---------------------------------------------------------------------------
describe('score – condition handling', () => {
  it('returns 0 and "Bedingung nicht erfüllt" when condition is not met', () => {
    // region:17 requires chimera_min=2; played alone (chimera=0)
    const results = score([{ name: 'Alice', cards: [card('region:17')] }]);
    expect(results[0].totalScore).toBe(0);
    expect(results[0].cardDetails[0]).toMatchObject({
      cardId: 'region:17',
      points: 0,
      reason: 'Bedingung nicht erfüllt',
    });
  });

  it('fires perStone ×3 for region:17 when chimera_min=2 is met via earlier regions', () => {
    // Hand (left to right): region:17, region:01, region:16
    //   region:17 is first played → scored last; by then chimera in scope =
    //     chimera(region:16=1) + chimera(region:01=1) + chimera(region:17=0) = 2 ✓
    //   stone in that scope = 0(region:16) + 1(region:01) + 1(region:17) = 2
    //   → points = 3 × 2 = 6
    const results = score([{
      name: 'Alice',
      cards: [
        card('region:17', 0.1), // leftmost = first played = scored last
        card('region:01', 0.4),
        card('region:16', 0.7), // rightmost = last played  = scored first
      ],
    }]);
    // Intermediate scores:
    //   region:16 (i=2): scope=[region:16]                 chimera=1 → perChimera ×2 → 2
    //   region:01 (i=1): scope=[region:16, region:01]      fixed 0 → 0
    //   region:17 (i=0): condition met (chimera=2), stone=2 → 3×2 = 6
    expect(results[0].totalScore).toBe(8); // 2 + 0 + 6
    const details = results[0].cardDetails;
    expect(details[0]).toMatchObject({ cardId: 'region:16', points: 2 });
    expect(details[1]).toMatchObject({ cardId: 'region:01', points: 0 });
    expect(details[2]).toMatchObject({ cardId: 'region:17', points: 6 });
  });
});

// ---------------------------------------------------------------------------
describe('score – sanctuaries', () => {
  it('scores sanctuary:01 (perYellowOrBlue ×1) against all cards', () => {
    // region:09 is blue (river); sanctuary:01 is perYellowOrBlue ×1
    // allCards = [region:09, sanctuary:01]
    // desert=0, river=1 → (0+1)×1 = 1
    const results = score([{
      name: 'Alice',
      cards: [card('region:09', 0.1), card('sanctuary:01', 0.4)],
    }]);
    expect(results[0].totalScore).toBe(6); // 5 (region:09 fixed) + 1 (sanctuary:01)
    const details = results[0].cardDetails;
    expect(details[0]).toMatchObject({ cardId: 'region:09', points: 5, group: '1 Regionen' });
    expect(details[1]).toMatchObject({ cardId: 'sanctuary:01', points: 1, group: '1 Heiligtümer' });
  });

  it('includes sanctuary landscape in sanctuary scoring scope', () => {
    // sanctuary:02 is yellow (desert), perYellow ×1
    // sanctuary:01 is perYellowOrBlue ×1
    // allCards = [sanctuary:01, sanctuary:02] (no regions)
    // For sanctuary:01: desert=1 (sanctuary:02), river=0 → 1×1=1
    // For sanctuary:02: desert=1 (itself) → 1×1=1
    const results = score([{
      name: 'Alice',
      cards: [card('sanctuary:01', 0.1), card('sanctuary:02', 0.4)],
    }]);
    expect(results[0].totalScore).toBe(2); // 1 + 1
  });
});

// ---------------------------------------------------------------------------
describe('score – card ID formatting', () => {
  it('preserves leading zeros in output cardId', () => {
    const results = score([{ name: 'Alice', cards: [card('region:03')] }]);
    expect(results[0].cardDetails[0].cardId).toBe('region:03');
  });

  it('formats region title as "Region N" stripping leading zeros', () => {
    const results = score([{ name: 'Alice', cards: [card('region:03')] }]);
    expect(results[0].cardDetails[0].title).toBe('Region 3');
  });

  it('returns "keine Aufgabe" for a region with no scoring task', () => {
    // region:01 has fixed value=0 → treated as no task
    const results = score([{ name: 'Alice', cards: [card('region:01')] }]);
    expect(results[0].cardDetails[0].reason).toBe('keine Aufgabe');
  });
});

// ---------------------------------------------------------------------------
describe('score – multiple players', () => {
  it('scores each player independently', () => {
    const results = score([
      { name: 'Alice', cards: [card('region:03')] }, // fixed 4
      { name: 'Bob', cards: [card('region:09')] }, // fixed 5
    ]);
    expect(results[0]).toMatchObject({ name: 'Alice', totalScore: 4 });
    expect(results[1]).toMatchObject({ name: 'Bob', totalScore: 5 });
  });
});
