/**
 * Wizard processEvent tests.
 */

const { processEvent } = require('../scorer');

function ev(type, data) { return { type, data }; }

// ---------------------------------------------------------------------------
describe('processEvent – gameStarted', () => {
  it('returns cameraMode:detectSingle and speak action', () => {
    const state = processEvent(ev('gameStarted', { players: ['Alice', 'Bob', 'Charlie', 'Dave'] }), null);
    expect(state.actions.some(a => a.type === 'cameraMode' && a.mode === 'detectSingle')).toBe(true);
    expect(state.actions.some(a => a.type === 'speak')).toBe(true);
    expect(state.scores).toHaveLength(4);
    expect(state._internal.round).toBe(1);
    expect(state._internal.maxRounds).toBe(15);
  });

  it('initialises cumulative scores to 0', () => {
    const state = processEvent(ev('gameStarted', { players: ['Alice', 'Bob'] }), null);
    expect(state.scores.every(s => s.totalScore === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('processEvent – cardDetected (trump detection)', () => {
  it('regular suit sets trumpSuit and starts bid collection', () => {
    const s0 = processEvent(ev('gameStarted', { players: ['Alice', 'Bob'] }), null);
    const s1 = processEvent(ev('cardDetected', { cardId: 'wizard:red:07' }), s0);
    expect(s1._internal.trumpSuit).toBe('red');
    expect(s1._internal.phase).toBe('bidCollection');
    expect(s1.actions.some(a => a.type === 'cameraMode' && a.mode === 'pause')).toBe(true);
    expect(s1.actions.some(a => a.type === 'listenForBid' && a.playerIndex === 0)).toBe(true);
  });

  it('wizard card sets null trump', () => {
    const s0 = processEvent(ev('gameStarted', { players: ['Alice', 'Bob'] }), null);
    const s1 = processEvent(ev('cardDetected', { cardId: 'wizard:wizard:01' }), s0);
    expect(s1._internal.trumpSuit).toBeNull();
  });

  it('jester card sets null trump', () => {
    const s0 = processEvent(ev('gameStarted', { players: ['Alice', 'Bob'] }), null);
    const s1 = processEvent(ev('cardDetected', { cardId: 'wizard:jester:02' }), s0);
    expect(s1._internal.trumpSuit).toBeNull();
  });

  it('ignored when not in trumpDetection phase', () => {
    const s0 = processEvent(ev('gameStarted', { players: ['Alice', 'Bob'] }), null);
    const s1 = processEvent(ev('cardDetected', { cardId: 'wizard:red:07' }), s0);
    const s2 = processEvent(ev('cardDetected', { cardId: 'wizard:blue:07' }), s1);
    expect(s2.actions).toHaveLength(0);
    expect(s2._internal.trumpSuit).toBe('red');
  });
});

// ---------------------------------------------------------------------------
describe('processEvent – bidPlaced', () => {
  function setupBidPhase(players) {
    let state = processEvent(ev('gameStarted', { players }), null);
    state = processEvent(ev('cardDetected', { cardId: 'wizard:blue:05' }), state);
    return state;
  }

  it('stores bid and returns next listenForBid', () => {
    let state = setupBidPhase(['Alice', 'Bob']);
    state = processEvent(ev('bidPlaced', { playerIndex: 0, bid: 1 }), state);
    expect(state._internal.bids['Alice']).toBe(1);
    expect(state.actions.some(a => a.type === 'listenForBid' && a.playerIndex === 1)).toBe(true);
  });

  it('last bid triggers cameraMode:trackTrick and awaitTableClear', () => {
    let state = setupBidPhase(['Alice', 'Bob']);
    state = processEvent(ev('bidPlaced', { playerIndex: 0, bid: 1 }), state);
    state = processEvent(ev('bidPlaced', { playerIndex: 1, bid: 0 }), state);
    expect(state.actions.some(a => a.type === 'cameraMode' && a.mode === 'trackTrick')).toBe(true);
    expect(state.actions.some(a => a.type === 'awaitTableClear')).toBe(true);
    expect(state._internal.phase).toBe('waitingForClear');
  });
});

// ---------------------------------------------------------------------------
describe('processEvent – tableCleared', () => {
  it('sets phase to trickTracking with no actions', () => {
    const players = ['Alice', 'Bob'];
    let state = processEvent(ev('gameStarted', { players }), null);
    state = processEvent(ev('cardDetected', { cardId: 'wizard:red:05' }), state);
    state = processEvent(ev('bidPlaced', { playerIndex: 0, bid: 0 }), state);
    state = processEvent(ev('bidPlaced', { playerIndex: 1, bid: 1 }), state);
    state = processEvent(ev('tableCleared', {}), state);
    expect(state._internal.phase).toBe('trickTracking');
    expect(state.actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('processEvent – trickCompleted', () => {
  function setupTrickPhase(players, bids) {
    let state = processEvent(ev('gameStarted', { players }), null);
    state = processEvent(ev('cardDetected', { cardId: 'wizard:red:01' }), state);
    players.forEach((_, i) => {
      state = processEvent(ev('bidPlaced', { playerIndex: i, bid: bids[i] }), state);
    });
    state = processEvent(ev('tableCleared', {}), state);
    return state;
  }

  it('updates tricksWon and returns speak + setLeadPlayer for non-final trick', () => {
    // Round 2 (2 tricks): first trick
    const players = ['Alice', 'Bob'];
    let state = processEvent(ev('gameStarted', { players }), null);
    state._internal.round = 2; // manually set to round 2 so tricksPerRound=2
    state = processEvent(ev('cardDetected', { cardId: 'wizard:red:01' }), state);
    state = processEvent(ev('bidPlaced', { playerIndex: 0, bid: 1 }), state);
    state = processEvent(ev('bidPlaced', { playerIndex: 1, bid: 1 }), state);
    state = processEvent(ev('tableCleared', {}), state);

    // First of 2 tricks
    state = processEvent(ev('trickCompleted', {
      cards: [[0, 'wizard:red:10'], [1, 'wizard:blue:03']],
    }), state);
    expect(state._internal.tricksWon['Alice']).toBe(1);
    expect(state.actions.some(a => a.type === 'speak')).toBe(true);
    expect(state.actions.some(a => a.type === 'setLeadPlayer')).toBe(true);
    expect(state.actions.some(a => a.type === 'showSummary')).toBe(false);
  });

  it('last trick shows summary and updates cumulative scores', () => {
    // Round 1 (1 trick)
    const players = ['Alice', 'Bob'];
    let state = setupTrickPhase(players, [1, 0]);
    // Alice (0) wins with wizard
    state = processEvent(ev('trickCompleted', {
      cards: [[0, 'wizard:wizard:01'], [1, 'wizard:blue:03']],
    }), state);
    expect(state.actions.some(a => a.type === 'showSummary')).toBe(true);
    expect(state._internal.cumulativeScores['Alice']).toBe(30); // bid=1, won=1 → 20+10
    expect(state._internal.cumulativeScores['Bob']).toBe(20);   // bid=0, won=0 → 20+0
    expect(state.display.summary).toBeDefined();
    expect(state.display.summary.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe('processEvent – roundEnded', () => {
  function playRound1(players, bids, trickWinnerIndex) {
    let state = processEvent(ev('gameStarted', { players }), null);
    state = processEvent(ev('cardDetected', { cardId: 'wizard:red:01' }), state);
    players.forEach((_, i) => {
      state = processEvent(ev('bidPlaced', { playerIndex: i, bid: bids[i] }), state);
    });
    state = processEvent(ev('tableCleared', {}), state);
    const cards = players.map((_, i) => [i, i === trickWinnerIndex ? 'wizard:wizard:01' : 'wizard:blue:03']);
    state = processEvent(ev('trickCompleted', { cards }), state);
    return state;
  }

  it('advances round and resets per-round state', () => {
    let state = playRound1(['Alice', 'Bob'], [0, 1], 1);
    state = processEvent(ev('roundEnded', {}), state);
    expect(state._internal.round).toBe(2);
    expect(state._internal.completedTricks).toBe(0);
    expect(state._internal.phase).toBe('trumpDetection');
    expect(Object.keys(state._internal.bids)).toHaveLength(0);
  });

  it('starts next round with cameraMode:detectSingle', () => {
    let state = playRound1(['Alice', 'Bob'], [0, 1], 1);
    state = processEvent(ev('roundEnded', {}), state);
    expect(state.actions.some(a => a.type === 'cameraMode' && a.mode === 'detectSingle')).toBe(true);
  });

  it('returns gameOver after last round', () => {
    const players = ['Alice', 'Bob'];
    let state = processEvent(ev('gameStarted', { players }), null);
    // Set round to the last round (30 for 2 players)
    state._internal.round = 30;
    state._internal.maxRounds = 30;
    state._internal.phase = 'trumpDetection';
    state = processEvent(ev('cardDetected', { cardId: 'wizard:red:01' }), state);
    state = processEvent(ev('bidPlaced', { playerIndex: 0, bid: 0 }), state);
    state = processEvent(ev('bidPlaced', { playerIndex: 1, bid: 1 }), state);
    state = processEvent(ev('tableCleared', {}), state);
    // Play 30 tricks (round 30)
    for (let i = 0; i < 30; i++) {
      state = processEvent(ev('trickCompleted', {
        cards: [[1, 'wizard:wizard:01'], [0, 'wizard:blue:03']],
      }), state);
    }
    state = processEvent(ev('roundEnded', {}), state);
    expect(state.actions.some(a => a.type === 'gameOver')).toBe(true);
  });
});
