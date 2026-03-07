/**
 * Wizard scorer tests.
 */

const {
  processCards,
  parseCardDisplay,
  calculateRoundScore,
  extractSuit,
  extractValue,
  determineTrickWinner,
  processEvent,
} = require('../scorer');

// Helper: minimal DetectedCard
function card(cardId) {
  return {
    cardId,
    similarity: 0.95,
    x1: 0, y1: 0, x2: 0.2, y2: 0.3,
    cx: 0.1, cy: 0.15,
    w: 0.2, h: 0.3,
    confidence: 0.95,
    angle: 0,
    keypoints: null,
  };
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
describe('processCards – legacy wrapper (always trumpDetection phase)', () => {
  it('returns scores with totalScore 0', () => {
    const results = processCards(
      [card('wizard:blue:05'), card('wizard:red:12')],
      { players: ['Alice'], similarityThreshold: 0.85 },
    );
    expect(results[0].totalScore).toBe(0);
  });

  it('empty hand returns empty cardDetails', () => {
    const results = processCards([], { players: ['Alice'], similarityThreshold: 0.85 });
    expect(results[0].totalScore).toBe(0);
    expect(results[0].cardDetails).toHaveLength(0);
  });

  it('preserves player order', () => {
    const names = ['Alice', 'Bob', 'Charlie'];
    const results = processCards([], { players: names, similarityThreshold: 0.85 });
    expect(results.map((r) => r.name)).toEqual(names);
  });
});

// ---------------------------------------------------------------------------
const { WizardGame } = require('../scorer');

describe('processCards – stateful (via WizardGame class)', () => {
  function makeGame(players) {
    const game = new WizardGame(players);
    // Advance to trickTracking via processEvent
    game.processEvent({ type: 'gameStarted', data: { players } });
    game.processEvent({ type: 'cardDetected', data: { cardId: 'wizard:blue:07' } });
    for (let i = 0; i < players.length; i++) {
      game.processEvent({ type: 'bidPlaced', data: { playerIndex: i, bid: 1 } });
    }
    game.processEvent({ type: 'tableCleared', data: {} });
    return game;
  }

  it('tracks new cards during trickTracking phase', () => {
    const game = makeGame(['Alice', 'Bob']);
    // First call: both cards are new
    const result1 = game.processCards([card('wizard:blue:05'), card('wizard:red:03')]);
    expect(result1.display.hud.length).toBeGreaterThan(0);
  });

  it('diffs cards between calls — only new cards are tracked', () => {
    const game = makeGame(['Alice', 'Bob']);
    // First frame: Alice plays blue 5
    game.processCards([card('wizard:blue:05')]);
    // Second frame: same card still visible + Bob plays red 3
    const result = game.processCards([card('wizard:blue:05'), card('wizard:red:03')]);
    // Both players should have card details
    const allDetails = result.players.flatMap(p => p.cardDetails);
    expect(allDetails).toHaveLength(2);
  });

  it('resets tracked cards after trickCompleted', () => {
    const game = makeGame(['Alice', 'Bob']);
    game.processCards([card('wizard:blue:05'), card('wizard:red:03')]);
    // Complete the trick
    game.processEvent({
      type: 'trickCompleted',
      data: { cards: [[0, 'wizard:blue:05'], [1, 'wizard:red:03']] },
    });
    // New processCards call should start fresh
    const result = game.processCards([]);
    const allDetails = result.players.flatMap(p => p.cardDetails);
    expect(allDetails).toHaveLength(0);
  });

  it('returns HUD with round/trump/bid info during trickTracking', () => {
    const game = makeGame(['Alice', 'Bob']);
    const result = game.processCards([]);
    const hudLabels = result.display.hud.map(h => h.label);
    // Should have round info and player bid tracking
    expect(hudLabels.length).toBeGreaterThanOrEqual(3); // round, trump, alice, bob
  });

  it('trickCompleted uses currentTrickCards as fallback when no event data', () => {
    const game = makeGame(['Alice', 'Bob']);
    // Camera detects cards
    game.processCards([card('wizard:blue:05'), card('wizard:red:03')]);
    // trickCompleted with no cards in data — should use tracked cards
    const result = game.processEvent({ type: 'trickCompleted', data: {} });
    // Should have processed the trick (not crashed)
    expect(result.players).toHaveLength(2);
  });
});
