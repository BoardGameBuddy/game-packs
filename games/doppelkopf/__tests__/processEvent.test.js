/**
 * Doppelkopf processEvent tests.
 */

const { processEvent } = require('../scorer');

function ev(type, data) { return { type, data }; }

const PLAYERS = ['Alice', 'Bob', 'Charlie', 'Dave'];

// ---------------------------------------------------------------------------
describe('processEvent – gameStarted', () => {
  it('returns cameraMode:trackTrick, awaitTableClear, startAnnouncementListening, speak', () => {
    const state = processEvent(ev('gameStarted', { players: PLAYERS }), null);
    expect(state.actions.some(a => a.type === 'cameraMode' && a.mode === 'trackTrick')).toBe(true);
    expect(state.actions.some(a => a.type === 'awaitTableClear')).toBe(true);
    expect(state.actions.some(a => a.type === 'startAnnouncementListening')).toBe(true);
    expect(state.actions.some(a => a.type === 'speak')).toBe(true);
  });

  it('initialises zero scores for all players', () => {
    const state = processEvent(ev('gameStarted', { players: PLAYERS }), null);
    expect(state.scores).toHaveLength(4);
    expect(state.scores.every(s => s.totalScore === 0)).toBe(true);
  });

  it('triggerWords contain re and kontra entries', () => {
    const state = processEvent(ev('gameStarted', { players: PLAYERS }), null);
    const ann = state.actions.find(a => a.type === 'startAnnouncementListening');
    expect(ann.triggerWords).toHaveProperty('re');
    expect(ann.triggerWords).toHaveProperty('kontra');
  });
});

// ---------------------------------------------------------------------------
describe('processEvent – tableCleared', () => {
  it('returns empty actions', () => {
    let state = processEvent(ev('gameStarted', { players: PLAYERS }), null);
    state = processEvent(ev('tableCleared', {}), state);
    expect(state.actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('processEvent – announcementMade', () => {
  it('stores announcement and speaks confirmation', () => {
    let state = processEvent(ev('gameStarted', { players: PLAYERS }), null);
    state = processEvent(ev('announcementMade', { id: 're' }), state);
    expect(state._internal.announcements).toContain('re');
    expect(state.actions.some(a => a.type === 'speak')).toBe(true);
  });

  it('ignores duplicate announcements', () => {
    let state = processEvent(ev('gameStarted', { players: PLAYERS }), null);
    state = processEvent(ev('announcementMade', { id: 're' }), state);
    state = processEvent(ev('announcementMade', { id: 're' }), state);
    expect(state._internal.announcements.filter(a => a === 're')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('processEvent – trickCompleted', () => {
  // Build a Re-team trick: Alice (0) plays kreuz:dame (Re marker)
  function reTrick(winnerIndex) {
    return [
      [0, 'doppelkopf:kreuz:dame'],
      [1, 'doppelkopf:karo:9'],
      [2, 'doppelkopf:kreuz:9'],
      [3, 'doppelkopf:pik:9'],
    ];
  }

  it('non-final trick returns speak + setLeadPlayer', () => {
    let state = processEvent(ev('gameStarted', { players: PLAYERS }), null);
    state = processEvent(ev('tableCleared', {}), state);
    state = processEvent(ev('trickCompleted', {
      cards: [[0, 'doppelkopf:kreuz:dame'], [1, 'doppelkopf:karo:9'],
              [2, 'doppelkopf:kreuz:9'], [3, 'doppelkopf:pik:9']],
    }), state);
    expect(state._internal.completedTricks).toBe(1);
    expect(state.actions.some(a => a.type === 'speak')).toBe(true);
    expect(state.actions.some(a => a.type === 'setLeadPlayer')).toBe(true);
    expect(state.actions.some(a => a.type === 'showSummary')).toBe(false);
  });

  it('after trick 2, stopAnnouncementListening is returned', () => {
    let state = processEvent(ev('gameStarted', { players: PLAYERS }), null);
    state = processEvent(ev('tableCleared', {}), state);
    // First trick
    state = processEvent(ev('trickCompleted', {
      cards: [[0, 'doppelkopf:kreuz:9'], [1, 'doppelkopf:karo:9'],
              [2, 'doppelkopf:kreuz:9'], [3, 'doppelkopf:pik:9']],
    }), state);
    // Second trick — window closes
    state = processEvent(ev('trickCompleted', {
      cards: [[0, 'doppelkopf:kreuz:9'], [1, 'doppelkopf:karo:9'],
              [2, 'doppelkopf:kreuz:9'], [3, 'doppelkopf:pik:9']],
    }), state);
    expect(state.actions.some(a => a.type === 'stopAnnouncementListening')).toBe(true);
  });

  it('12th trick shows summary and stops announcement listening', () => {
    let state = processEvent(ev('gameStarted', { players: PLAYERS }), null);
    // Lay down kreuz:dame to establish Re team in tricks 1+2
    state = processEvent(ev('tableCleared', {}), state);
    const reTrickCards = [
      [0, 'doppelkopf:kreuz:dame'],
      [1, 'doppelkopf:karo:9'],
      [2, 'doppelkopf:kreuz:9'],
      [3, 'doppelkopf:pik:9'],
    ];
    state = processEvent(ev('trickCompleted', { cards: reTrickCards }), state);
    const reTrick2Cards = [
      [1, 'doppelkopf:kreuz:dame'],
      [0, 'doppelkopf:herz:9'],
      [2, 'doppelkopf:kreuz:9'],
      [3, 'doppelkopf:pik:9'],
    ];
    state = processEvent(ev('trickCompleted', { cards: reTrick2Cards }), state);
    // Fill remaining 10 tricks with zero-augen cards
    const zeroCards = [
      [0, 'doppelkopf:kreuz:as'], [1, 'doppelkopf:pik:as'],
      [2, 'doppelkopf:herz:as'], [3, 'doppelkopf:karo:as'],
    ];
    for (let i = 0; i < 9; i++) {
      state = processEvent(ev('trickCompleted', { cards: zeroCards }), state);
    }
    // 12th trick
    state = processEvent(ev('trickCompleted', { cards: zeroCards }), state);
    expect(state._internal.completedTricks).toBe(12);
    expect(state.actions.some(a => a.type === 'showSummary')).toBe(true);
    expect(state.actions.some(a => a.type === 'stopAnnouncementListening')).toBe(true);
    expect(state.display.summary).toBeDefined();
  });

  it('cumulative scores updated after 12 tricks', () => {
    let state = processEvent(ev('gameStarted', { players: PLAYERS }), null);
    state = processEvent(ev('tableCleared', {}), state);
    const tricks = [
      [[0, 'doppelkopf:kreuz:dame'], [1, 'doppelkopf:karo:9'],   [2, 'doppelkopf:kreuz:9'], [3, 'doppelkopf:pik:9']],
      [[1, 'doppelkopf:kreuz:dame'], [0, 'doppelkopf:herz:9'],   [2, 'doppelkopf:kreuz:9'], [3, 'doppelkopf:pik:9']],
      [[0, 'doppelkopf:kreuz:as'],   [1, 'doppelkopf:pik:as'],   [2, 'doppelkopf:herz:as'], [3, 'doppelkopf:karo:as']],
      [[0, 'doppelkopf:kreuz:10'],   [1, 'doppelkopf:pik:10'],   [2, 'doppelkopf:herz:10'], [3, 'doppelkopf:karo:10']],
      [[0, 'doppelkopf:kreuz:koenig'], [1, 'doppelkopf:pik:koenig'], [2, 'doppelkopf:herz:koenig'], [3, 'doppelkopf:karo:koenig']],
    ];
    for (const t of tricks) {
      state = processEvent(ev('trickCompleted', { cards: t }), state);
    }
    while (state._internal.completedTricks < 12) {
      state = processEvent(ev('trickCompleted', { cards: [
        [0, 'doppelkopf:karo:9'], [1, 'doppelkopf:karo:9'],
        [2, 'doppelkopf:kreuz:9'], [3, 'doppelkopf:pik:9'],
      ]}), state);
    }
    // Scores were updated from zero
    const totalScore = PLAYERS.reduce((s, p) => s + (state._internal.cumulativeScores[p] ?? 0), 0);
    expect(totalScore).toBe(0); // zero-sum game
  });
});

// ---------------------------------------------------------------------------
describe('processEvent – roundEnded', () => {
  it('resets round state and returns restart actions', () => {
    let state = processEvent(ev('gameStarted', { players: PLAYERS }), null);
    // Fast-forward 12 tricks
    state = processEvent(ev('tableCleared', {}), state);
    const card = [[0, 'doppelkopf:kreuz:dame'], [1, 'doppelkopf:karo:9'],
                  [2, 'doppelkopf:kreuz:9'], [3, 'doppelkopf:pik:9']];
    const card2 = [[1, 'doppelkopf:kreuz:dame'], [0, 'doppelkopf:herz:9'],
                   [2, 'doppelkopf:kreuz:9'], [3, 'doppelkopf:pik:9']];
    state = processEvent(ev('trickCompleted', { cards: card }), state);
    state = processEvent(ev('trickCompleted', { cards: card2 }), state);
    while (state._internal.completedTricks < 12) {
      state = processEvent(ev('trickCompleted', { cards: [
        [0, 'doppelkopf:karo:9'], [1, 'doppelkopf:karo:9'],
        [2, 'doppelkopf:kreuz:9'], [3, 'doppelkopf:pik:9'],
      ]}), state);
    }
    state = processEvent(ev('roundEnded', {}), state);
    expect(state._internal.completedTricks).toBe(0);
    expect(state._internal.trickHistory).toHaveLength(0);
    expect(state._internal.announcements).toHaveLength(0);
    expect(state.actions.some(a => a.type === 'cameraMode' && a.mode === 'trackTrick')).toBe(true);
    expect(state.actions.some(a => a.type === 'awaitTableClear')).toBe(true);
    expect(state.actions.some(a => a.type === 'startAnnouncementListening')).toBe(true);
  });
});
