/**
 * Wizard processEvent tests.
 *
 * Trump detection now happens via processCards() (single visible card).
 * Trick completion also happens via processCards() (diffing + counting).
 * The removed events (cardDetected, tableCleared, trickCompleted) are
 * no longer tested here.
 */

const { WizardGame } = require('../scorer');

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

function ev(type, data) { return { type, data }; }

/** Sends N empty processCards frames to trigger table clear. */
function clearTable(game, n = 6) {
  for (let i = 0; i < n; i++) game.processCards([]);
}

// ---------------------------------------------------------------------------
describe('processEvent – gameStarted', () => {
  it('returns cameraMode:detecting and speak action', () => {
    const game = new WizardGame(['Alice', 'Bob', 'Charlie', 'Dave']);
    const state = game.processEvent(ev('gameStarted', { players: ['Alice', 'Bob', 'Charlie', 'Dave'] }));
    expect(state.actions.some(a => a.type === 'cameraMode' && a.mode === 'detecting')).toBe(true);
    expect(state.actions.some(a => a.type === 'speak')).toBe(true);
    expect(state.players).toHaveLength(4);
  });

  it('initialises cumulative scores to 0', () => {
    const game = new WizardGame(['Alice', 'Bob']);
    const state = game.processEvent(ev('gameStarted', { players: ['Alice', 'Bob'] }));
    expect(state.players.every(s => s.totalScore === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('trump detection via processCards', () => {
  it('single visible card sets trump suit', () => {
    const game = new WizardGame(['Alice', 'Bob']);
    game.processEvent(ev('gameStarted', { players: ['Alice', 'Bob'] }));
    const result = game.processCards([card('wizard:red:07')]);
    expect(result.actions.some(a => a.type === 'cameraMode' && a.mode === 'paused')).toBe(true);
    expect(result.actions.some(a => a.type === 'listenForBid' && a.playerIndex === 0)).toBe(true);
  });

  it('wizard card sets null trump', () => {
    const game = new WizardGame(['Alice', 'Bob']);
    game.processEvent(ev('gameStarted', { players: ['Alice', 'Bob'] }));
    game.processCards([card('wizard:wizard:01')]);
    // After trump is set, phase should be bidCollection
    // Verify by placing a bid (would fail if still in trumpDetection)
    const result = game.processEvent(ev('bidPlaced', { playerIndex: 0, bid: 0 }));
    expect(result.actions.some(a => a.type === 'listenForBid')).toBe(true);
  });

  it('jester card sets null trump', () => {
    const game = new WizardGame(['Alice', 'Bob']);
    game.processEvent(ev('gameStarted', { players: ['Alice', 'Bob'] }));
    game.processCards([card('wizard:jester:02')]);
    const result = game.processEvent(ev('bidPlaced', { playerIndex: 0, bid: 0 }));
    expect(result.actions.some(a => a.type === 'listenForBid')).toBe(true);
  });

  it('multiple visible cards do not trigger trump detection', () => {
    const game = new WizardGame(['Alice', 'Bob']);
    game.processEvent(ev('gameStarted', { players: ['Alice', 'Bob'] }));
    const result = game.processCards([card('wizard:red:07'), card('wizard:blue:05')]);
    // Should still be in trumpDetection — no actions emitted
    expect(result.actions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('processEvent – bidPlaced', () => {
  function setupBidPhase(players) {
    const game = new WizardGame(players);
    game.processEvent(ev('gameStarted', { players }));
    game.processCards([card('wizard:blue:05')]);
    return game;
  }

  it('stores bid and returns next listenForBid', () => {
    const game = setupBidPhase(['Alice', 'Bob']);
    const result = game.processEvent(ev('bidPlaced', { playerIndex: 0, bid: 1 }));
    expect(result.actions.some(a => a.type === 'listenForBid' && a.playerIndex === 1)).toBe(true);
  });

  it('last bid triggers cameraMode:detecting and awaitTableClear', () => {
    const game = setupBidPhase(['Alice', 'Bob']);
    game.processEvent(ev('bidPlaced', { playerIndex: 0, bid: 1 }));
    const result = game.processEvent(ev('bidPlaced', { playerIndex: 1, bid: 0 }));
    expect(result.actions.some(a => a.type === 'cameraMode' && a.mode === 'detecting')).toBe(true);
    expect(result.actions.some(a => a.type === 'awaitTableClear')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('table clear via processCards', () => {
  it('empty frames transition from waitingForClear to trickTracking', () => {
    const game = new WizardGame(['Alice', 'Bob']);
    game.processEvent(ev('gameStarted', { players: ['Alice', 'Bob'] }));
    game.processCards([card('wizard:red:05')]);
    game.processEvent(ev('bidPlaced', { playerIndex: 0, bid: 0 }));
    game.processEvent(ev('bidPlaced', { playerIndex: 1, bid: 1 }));
    // Send enough empty frames to clear table
    clearTable(game);
    // Now cards should be tracked in trickTracking phase
    const result = game.processCards([card('wizard:blue:10')]);
    expect(result.display.hud.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe('trick completion via processCards', () => {
  function setupTrickPhase(players, bids) {
    const game = new WizardGame(players);
    game.processEvent(ev('gameStarted', { players }));
    game.processCards([card('wizard:red:01')]);
    players.forEach((_, i) => {
      game.processEvent(ev('bidPlaced', { playerIndex: i, bid: bids[i] }));
    });
    clearTable(game);
    return game;
  }

  it('trick completion detected when all players have played', () => {
    const game = setupTrickPhase(['Alice', 'Bob'], [1, 0]);
    // Both cards appear — trick complete
    const result = game.processCards([card('wizard:red:10'), card('wizard:blue:03')]);
    expect(result.actions.some(a => a.type === 'speak')).toBe(true);
  });

  it('last trick shows summary and updates cumulative scores', () => {
    // Round 1 (1 trick per round)
    const game = setupTrickPhase(['Alice', 'Bob'], [1, 0]);
    const result = game.processCards([card('wizard:wizard:01'), card('wizard:blue:03')]);
    expect(result.actions.some(a => a.type === 'showSummary')).toBe(true);
    expect(result.display.summary).toBeDefined();
    expect(result.display.summary.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe('processEvent – roundEnded', () => {
  function playRound1(players, bids) {
    const game = new WizardGame(players);
    game.processEvent(ev('gameStarted', { players }));
    game.processCards([card('wizard:red:01')]);
    players.forEach((_, i) => {
      game.processEvent(ev('bidPlaced', { playerIndex: i, bid: bids[i] }));
    });
    clearTable(game);
    // Play one trick (round 1 = 1 card each)
    game.processCards([card('wizard:wizard:01'), card('wizard:blue:03')]);
    return game;
  }

  it('advances round and resets per-round state', () => {
    const game = playRound1(['Alice', 'Bob'], [0, 1]);
    const result = game.processEvent(ev('roundEnded', {}));
    expect(result.actions.some(a => a.type === 'cameraMode' && a.mode === 'detecting')).toBe(true);
  });

  it('returns gameOver after last round', () => {
    const game = new WizardGame(['Alice', 'Bob']);
    game.processEvent(ev('gameStarted', { players: ['Alice', 'Bob'] }));

    const maxRounds = 30;
    for (let round = 1; round <= maxRounds; round++) {
      // Trump detection
      game.processCards([card('wizard:red:01')]);
      // Bids
      game.processEvent(ev('bidPlaced', { playerIndex: 0, bid: 0 }));
      game.processEvent(ev('bidPlaced', { playerIndex: 1, bid: 0 }));
      // Clear table
      clearTable(game);
      // Play tricks (round number = tricks per round)
      for (let trick = 0; trick < round; trick++) {
        game.processCards([card(`wizard:blue:${String(trick + 1).padStart(2, '0')}`), card(`wizard:red:${String(trick + 1).padStart(2, '0')}`)]);
        // Clear table between tricks (except after last trick of last round)
        if (trick < round - 1) clearTable(game);
      }
      // End round (unless last)
      if (round < maxRounds) {
        game.processEvent(ev('roundEnded', {}));
      }
    }
    const result = game.processEvent(ev('roundEnded', {}));
    expect(result.actions.some(a => a.type === 'gameOver')).toBe(true);
  });
});
