/**
 * Doppelkopf processEvent tests.
 *
 * Trick completion is handled by processCards().
 * Table clearing is handled by the caller (app/playground) via the awaitTableClear action.
 * These tests focus on events: gameStarted, announcementMade, roundEnded,
 * and trick completion via processCards.
 */

const { DoppelkopfGame } = require('../scorer');

function ev(type, data) { return { type, data }; }

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

const PLAYERS = ['Alice', 'Bob', 'Charlie', 'Dave'];

// ---------------------------------------------------------------------------
describe('processEvent – gameStarted', () => {
  it('returns cameraMode:detecting, awaitTableClear, startAnnouncementListening, speak', () => {
    const game = new DoppelkopfGame(PLAYERS);
    const state = game.processEvent(ev('gameStarted', { players: PLAYERS }));
    expect(state.actions.some(a => a.type === 'cameraMode' && a.mode === 'detecting')).toBe(true);
    expect(state.actions.some(a => a.type === 'awaitTableClear')).toBe(true);
    expect(state.actions.some(a => a.type === 'startAnnouncementListening')).toBe(true);
    expect(state.actions.some(a => a.type === 'speak')).toBe(true);
  });

  it('initialises zero scores for all players', () => {
    const game = new DoppelkopfGame(PLAYERS);
    const state = game.processEvent(ev('gameStarted', { players: PLAYERS }));
    expect(state.players).toHaveLength(4);
    expect(state.players.every(s => s.totalScore === 0)).toBe(true);
  });

  it('triggerWords contain re and kontra entries', () => {
    const game = new DoppelkopfGame(PLAYERS);
    const state = game.processEvent(ev('gameStarted', { players: PLAYERS }));
    const ann = state.actions.find(a => a.type === 'startAnnouncementListening');
    expect(ann.triggerWords).toHaveProperty('re');
    expect(ann.triggerWords).toHaveProperty('kontra');
  });
});

// ---------------------------------------------------------------------------
describe('processEvent – announcementMade', () => {
  it('stores announcement and speaks confirmation', () => {
    const game = new DoppelkopfGame(PLAYERS);
    game.processEvent(ev('gameStarted', { players: PLAYERS }));
    const state = game.processEvent(ev('announcementMade', { id: 're' }));
    expect(state.actions.some(a => a.type === 'speak')).toBe(true);
  });

  it('ignores duplicate announcements', () => {
    const game = new DoppelkopfGame(PLAYERS);
    game.processEvent(ev('gameStarted', { players: PLAYERS }));
    game.processEvent(ev('announcementMade', { id: 're' }));
    game.processEvent(ev('announcementMade', { id: 're' }));
    // Just verify it doesn't crash — duplicates are silently ignored
  });
});

// ---------------------------------------------------------------------------
describe('trick completion via processCards', () => {
  it('detects trick completion when all 4 players have played', () => {
    const game = new DoppelkopfGame(PLAYERS);
    game.processEvent(ev('gameStarted', { players: PLAYERS }));
    // All 4 cards appear
    const result = game.processCards([
      card('clubs:queen'),
      card('diamond:9'),
      card('clubs:9'),
      card('spades:9'),
    ]);
    expect(result.actions.some(a => a.type === 'speak')).toBe(true);
    expect(result.actions.some(a => a.type === 'awaitTableClear')).toBe(true);
  });

  it('12th trick shows summary', () => {
    const game = new DoppelkopfGame(PLAYERS);
    game.processEvent(ev('gameStarted', { players: PLAYERS }));

    // Play 12 tricks via processCards
    const reTrickCards = [
      card('clubs:queen'),
      card('diamond:9'),
      card('clubs:9'),
      card('spades:9'),
    ];
    const reTrick2Cards = [
      card('clubs:queen'),
      card('heart:9'),
      card('clubs:9'),
      card('spades:9'),
    ];
    const zeroCards = [
      card('clubs:ace'),
      card('spades:ace'),
      card('heart:ace'),
      card('diamond:ace'),
    ];

    game.processCards(reTrickCards);
    game.processCards(reTrick2Cards);
    for (let i = 0; i < 9; i++) {
      game.processCards(zeroCards);
    }
    // 12th trick
    const result = game.processCards(zeroCards);
    expect(result.actions.some(a => a.type === 'showSummary')).toBe(true);
    expect(result.actions.some(a => a.type === 'stopAnnouncementListening')).toBe(true);
    expect(result.actions.some(a => a.type === 'awaitTableClear')).toBe(true);
    expect(result.display.summary).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
describe('processEvent – roundEnded', () => {
  it('resets round state and returns restart actions', () => {
    const game = new DoppelkopfGame(PLAYERS);
    game.processEvent(ev('gameStarted', { players: PLAYERS }));

    // Play 12 tricks
    const cards = [
      card('clubs:queen'),
      card('diamond:9'),
      card('clubs:9'),
      card('spades:9'),
    ];
    const cards2 = [
      card('clubs:queen'),
      card('heart:9'),
      card('clubs:9'),
      card('spades:9'),
    ];
    game.processCards(cards);
    game.processCards(cards2);
    const zeroCards = [
      card('diamond:9'),
      card('diamond:9'),
      card('clubs:9'),
      card('spades:9'),
    ];
    for (let i = 0; i < 10; i++) {
      game.processCards(zeroCards);
    }

    const result = game.processEvent(ev('roundEnded', {}));
    expect(result.actions.some(a => a.type === 'cameraMode' && a.mode === 'detecting')).toBe(true);
    expect(result.actions.some(a => a.type === 'awaitTableClear')).toBe(true);
    expect(result.actions.some(a => a.type === 'startAnnouncementListening')).toBe(true);
  });
});
