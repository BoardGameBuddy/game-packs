/**
 * Wizard scorer tests.
 */

const {
  score,
  parseCardDisplay,
  calculateRoundScore,
  extractSuit,
  extractValue,
  determineTrickWinner,
} = require('../scorer');

// Helper: minimal DetectedCard
function card(cardId) {
  return { cardId, similarity: 0.95, x1: 0, y1: 0, x2: 0.2, y2: 0.3, cx: 0.1, cy: 0.15, w: 0.2, h: 0.3 };
}

// ---------------------------------------------------------------------------
describe('parseCardDisplay', () => {
  it('colour suit card', () => {
    expect(parseCardDisplay('wizard:blue:05')).toEqual(['Blau 5', 'Blau']);
    expect(parseCardDisplay('wizard:green:13')).toEqual(['Grün 13', 'Grün']);
    expect(parseCardDisplay('wizard:red:01')).toEqual(['Rot 1', 'Rot']);
    expect(parseCardDisplay('wizard:yellow:10')).toEqual(['Gelb 10', 'Gelb']);
  });

  it('wizard card', () => {
    expect(parseCardDisplay('wizard:wizard:01')).toEqual(['Zauberer 01', 'Zauberer']);
    expect(parseCardDisplay('wizard:wizard:04')).toEqual(['Zauberer 04', 'Zauberer']);
  });

  it('jester card', () => {
    expect(parseCardDisplay('wizard:jester:02')).toEqual(['Narr 02', 'Narr']);
  });

  it('strips leading zeros from colour card number', () => {
    expect(parseCardDisplay('wizard:blue:01')[0]).toBe('Blau 1');
    expect(parseCardDisplay('wizard:blue:00')[0]).toBe('Blau 0');
  });
});

// ---------------------------------------------------------------------------
describe('extractSuit / extractValue', () => {
  it('extracts suit', () => {
    expect(extractSuit('wizard:blue:05')).toBe('blue');
    expect(extractSuit('wizard:wizard:01')).toBe('wizard');
    expect(extractSuit('wizard:jester:03')).toBe('jester');
  });

  it('extracts numeric value', () => {
    expect(extractValue('wizard:blue:05')).toBe(5);
    expect(extractValue('wizard:red:13')).toBe(13);
    expect(extractValue('wizard:wizard:01')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('calculateRoundScore', () => {
  it('correct bid = +20 + 10×tricks', () => {
    expect(calculateRoundScore(0, 0)).toBe(20);
    expect(calculateRoundScore(2, 2)).toBe(40);
    expect(calculateRoundScore(3, 3)).toBe(50);
  });

  it('wrong bid = -10 × |diff|', () => {
    expect(calculateRoundScore(1, 0)).toBe(-10);
    expect(calculateRoundScore(0, 2)).toBe(-20);
    expect(calculateRoundScore(3, 1)).toBe(-20);
  });
});

// ---------------------------------------------------------------------------
describe('determineTrickWinner', () => {
  it('wizard always wins, first wizard if multiple', () => {
    const cards = [[0, 'wizard:blue:13'], [1, 'wizard:wizard:01'], [2, 'wizard:wizard:02']];
    expect(determineTrickWinner(cards, null)).toBe(1);
  });

  it('highest trump wins when no wizard', () => {
    const cards = [[0, 'wizard:blue:03'], [1, 'wizard:red:07'], [2, 'wizard:red:05']];
    expect(determineTrickWinner(cards, 'red')).toBe(1);
  });

  it('highest led-suit card wins when no trump played', () => {
    const cards = [[0, 'wizard:blue:10'], [1, 'wizard:blue:08'], [2, 'wizard:green:13']];
    expect(determineTrickWinner(cards, 'red')).toBe(0); // no red played; led=blue, 10>8
  });

  it('all jesters → first player wins', () => {
    const cards = [[0, 'wizard:jester:01'], [1, 'wizard:jester:02']];
    expect(determineTrickWinner(cards, null)).toBe(0);
  });

  it('jester does not win over colour card', () => {
    const cards = [[0, 'wizard:jester:01'], [1, 'wizard:blue:02']];
    expect(determineTrickWinner(cards, null)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('score – photo mode', () => {
  it('total score is always 0 (full scoring is in live tracking)', () => {
    const results = score([
      { name: 'Alice', cards: [card('wizard:blue:05'), card('wizard:red:12')] },
    ]);
    expect(results[0].totalScore).toBe(0);
  });

  it('each card gets points=0, displayName as reason and title', () => {
    const results = score([{ name: 'Alice', cards: [card('wizard:green:07')] }]);
    expect(results[0].cardDetails[0]).toMatchObject({
      cardId: 'wizard:green:07',
      points: 0,
      reason: 'Grün 7',
      title: 'Grün 7',
      group: 'Grün',
    });
  });

  it('wizard and jester cards get correct group', () => {
    const results = score([{
      name: 'Alice',
      cards: [card('wizard:wizard:01'), card('wizard:jester:03')],
    }]);
    expect(results[0].cardDetails[0].group).toBe('Zauberer');
    expect(results[0].cardDetails[1].group).toBe('Narr');
  });

  it('empty hand returns empty cardDetails', () => {
    const results = score([{ name: 'Alice', cards: [] }]);
    expect(results[0].totalScore).toBe(0);
    expect(results[0].cardDetails).toHaveLength(0);
  });

  it('preserves player order', () => {
    const names = ['Alice', 'Bob', 'Charlie'];
    const results = score(names.map((name) => ({ name, cards: [] })));
    expect(results.map((r) => r.name)).toEqual(names);
  });
});
