/**
 * Doppelkopf – full 12-trick round integration test.
 *
 * Plays all 48 cards (24 unique × 2) across 12 tricks using processEvent.
 * Alice (0) and Bob (1) form the Re team (each plays one kreuz:dame).
 * Charlie (2) and Dave (3) are the Kontra team.
 *
 * Augen distribution:
 *   Re wins tricks 1-7:     106 Augen
 *   Kontra wins tricks 8-12: 134 Augen
 *
 * Kontra wins (Re needs 121+, has only 106).
 *
 * Scoring breakdown (no announcements):
 *   +1 base point
 *   +1 Gegen die Alten (Kontra wins)
 *   +1 Fuchs gefangen for Re (Alice catches Charlie's Karo As in trick 6)
 *   = 3 game points, negated because Kontra wins
 *   → Alice −3, Bob −3, Charlie +3, Dave +3  (zero-sum)
 *
 * Card-use verification: every one of the 24 unique cards appears exactly
 * twice across the 12 tricks (48 plays total).
 */

const { processEvent } = require('../scorer');

function ev(type, data) { return { type, data }; }

const PLAYERS = ['Alice', 'Bob', 'Charlie', 'Dave'];

// ---------------------------------------------------------------------------
// Trick definitions
//
// Each inner array is [[playerIndex, cardId], ...] in play order.
// The first entry is the player who leads the trick (sets the led suit).
// Winners are determined automatically by determineTrickWinner.
// ---------------------------------------------------------------------------

const TRICKS = [
  // Trick 1 – Alice leads kreuz:dame (trump rank 12).
  //           Bob plays pik:dame (rank 11) — lower, Alice wins.
  //           Charlie and Dave play Fehlfarbe (can't beat trump).
  //           Alice (Re) wins. Augen: 3+3+0+0 = 6.
  //           Alice plays kreuz:dame → Alice is on the Re team.
  [
    [0, 'doppelkopf:kreuz:dame'],
    [1, 'doppelkopf:pik:dame'],
    [2, 'doppelkopf:kreuz:9'],
    [3, 'doppelkopf:pik:9'],
  ],
  // Trick 2 – Alice leads herz:10 (Dullen, trump rank 13).
  //           Bob plays the second kreuz:dame (rank 12) → Bob joins Re team.
  //           Alice wins (rank 13 > 12 > 1 > fehlfarbe).
  //           Augen: 10+3+0+0 = 13.
  [
    [0, 'doppelkopf:herz:10'],
    [1, 'doppelkopf:kreuz:dame'],
    [2, 'doppelkopf:karo:9'],
    [3, 'doppelkopf:herz:9'],
  ],
  // Trick 3 – Alice leads second herz:10 (rank 13); beats pik:dame (11),
  //           herz:dame (10), karo:dame (9). Augen: 10+3+3+3 = 19.
  [
    [0, 'doppelkopf:herz:10'],
    [1, 'doppelkopf:pik:dame'],
    [2, 'doppelkopf:herz:dame'],
    [3, 'doppelkopf:karo:dame'],
  ],
  // Trick 4 – All four first-copy Buben. kreuz:bube (rank 8) wins.
  //           Augen: 2+2+2+2 = 8.
  [
    [0, 'doppelkopf:kreuz:bube'],
    [1, 'doppelkopf:pik:bube'],
    [2, 'doppelkopf:herz:bube'],
    [3, 'doppelkopf:karo:bube'],
  ],
  // Trick 5 – Second copies of all four Buben. Same winner rule, same Augen.
  //           Augen: 2+2+2+2 = 8.
  [
    [0, 'doppelkopf:kreuz:bube'],
    [1, 'doppelkopf:pik:bube'],
    [2, 'doppelkopf:herz:bube'],
    [3, 'doppelkopf:karo:bube'],
  ],
  // Trick 6 – Alice leads herz:dame (rank 10); beats karo:dame (9), karo:as (4),
  //           karo:10 (3). All trump.
  //           Charlie (Kontra) plays karo:as (Fuchs); Alice (Re) wins the trick
  //           → Fuchs gefangen for Re. Augen: 3+3+11+10 = 27.
  [
    [0, 'doppelkopf:herz:dame'],
    [1, 'doppelkopf:karo:dame'],
    [2, 'doppelkopf:karo:as'],
    [3, 'doppelkopf:karo:10'],
  ],
  // Trick 7 – Remaining Karo trump: karo:as (rank 4) beats karo:10 (3),
  //           karo:koenig (2), karo:9 (1). Augen: 11+10+4+0 = 25.
  [
    [0, 'doppelkopf:karo:as'],
    [1, 'doppelkopf:karo:10'],
    [2, 'doppelkopf:karo:koenig'],
    [3, 'doppelkopf:karo:9'],
  ],
  // Trick 8 – Alice leads Fehlfarbe kreuz. Charlie plays karo:koenig (last
  //           remaining trump); trump beats Fehlfarbe → Charlie (Kontra) wins.
  //           Augen: 11+10+4+0 = 25. Kontra starts winning.
  [
    [0, 'doppelkopf:kreuz:as'],
    [1, 'doppelkopf:kreuz:10'],
    [2, 'doppelkopf:karo:koenig'],
    [3, 'doppelkopf:kreuz:9'],
  ],
  // Trick 9 – Charlie leads pik:as (rank 4 in pik Fehlfarbe).
  //           Dave follows pik (rank 3). Alice plays kreuz:as (off-suit, can't
  //           win). Bob plays pik:koenig (rank 2, lower). Charlie wins.
  //           Augen: 11+10+11+4 = 36.
  [
    [2, 'doppelkopf:pik:as'],
    [3, 'doppelkopf:pik:10'],
    [0, 'doppelkopf:kreuz:as'],
    [1, 'doppelkopf:pik:koenig'],
  ],
  // Trick 10 – Charlie leads pik:as again (second copy); same dynamics.
  //            Alice plays kreuz:10 (off-suit). Charlie wins.
  //            Augen: 11+10+10+4 = 35.
  [
    [2, 'doppelkopf:pik:as'],
    [3, 'doppelkopf:pik:10'],
    [0, 'doppelkopf:kreuz:10'],
    [1, 'doppelkopf:pik:koenig'],
  ],
  // Trick 11 – Charlie leads herz:as (rank 4 in herz Fehlfarbe).
  //            Bob also plays herz:as (equal rank); first played wins (Charlie).
  //            Dave and Alice play off-suit (can't win).
  //            Augen: 11+4+4+11 = 30.
  [
    [2, 'doppelkopf:herz:as'],
    [3, 'doppelkopf:herz:koenig'],
    [0, 'doppelkopf:kreuz:koenig'],
    [1, 'doppelkopf:herz:as'],
  ],
  // Trick 12 (last) – Charlie leads herz:koenig (rank 2 in herz Fehlfarbe);
  //                   beats herz:9 (rank 1). Alice and Bob play off-suit.
  //                   No kreuz:bube in last trick → no Karlchen.
  //                   Augen: 4+0+4+0 = 8.
  [
    [2, 'doppelkopf:herz:koenig'],
    [3, 'doppelkopf:herz:9'],
    [0, 'doppelkopf:kreuz:koenig'],
    [1, 'doppelkopf:pik:9'],
  ],
];

// ---------------------------------------------------------------------------
describe('full round – 12 tricks, all 48 cards played', () => {
  let finalState;

  beforeAll(() => {
    let state = processEvent(ev('gameStarted', { players: PLAYERS }), null);
    state = processEvent(ev('tableCleared', {}), state);
    for (const cards of TRICKS) {
      state = processEvent(ev('trickCompleted', { cards }), state);
    }
    finalState = state;
  });

  // ── Trick-count sanity ───────────────────────────────────────────────────

  it('records exactly 12 completed tricks', () => {
    expect(finalState._internal.completedTricks).toBe(12);
  });

  // ── Card coverage ────────────────────────────────────────────────────────

  it('accumulates 48 card plays across 12 tricks (4 per trick)', () => {
    const allPlays = finalState._internal.trickHistory.flatMap(t => t.cards);
    expect(allPlays).toHaveLength(48);
  });

  it('every unique card is played exactly twice', () => {
    const allPlays = finalState._internal.trickHistory.flatMap(t => t.cards);
    const counts = {};
    for (const [, cardId] of allPlays) {
      const key = cardId.replace('doppelkopf:', '');
      counts[key] = (counts[key] ?? 0) + 1;
    }
    // 24 unique cards × 2 = 48
    expect(Object.keys(counts)).toHaveLength(24);
    for (const [card, count] of Object.entries(counts)) {
      expect({ card, count }).toEqual({ card, count: 2 });
    }
  });

  // ── Trick winners ────────────────────────────────────────────────────────

  it('Alice (Re) wins tricks 1-7', () => {
    for (let i = 0; i < 7; i++) {
      expect(finalState._internal.trickHistory[i].winnerIndex).toBe(0);
    }
  });

  it('Charlie (Kontra) wins tricks 8-12', () => {
    for (let i = 7; i < 12; i++) {
      expect(finalState._internal.trickHistory[i].winnerIndex).toBe(2);
    }
  });

  // ── Re team detection ────────────────────────────────────────────────────

  it('Re team detected: Alice (0) and Bob (1) played kreuz:dame', () => {
    // Both kreuz:dame cards appear in trick history
    const kreuzDamePlays = finalState._internal.trickHistory
      .flatMap(t => t.cards)
      .filter(([, id]) => id === 'doppelkopf:kreuz:dame');
    expect(kreuzDamePlays).toHaveLength(2);
    const playerIndices = kreuzDamePlays.map(([idx]) => idx).sort();
    expect(playerIndices).toEqual([0, 1]); // Alice and Bob
  });

  // ── End-of-round actions ─────────────────────────────────────────────────

  it('last trick returns showSummary action', () => {
    expect(finalState.actions.some(a => a.type === 'showSummary')).toBe(true);
  });

  it('last trick returns stopAnnouncementListening action', () => {
    expect(finalState.actions.some(a => a.type === 'stopAnnouncementListening')).toBe(true);
  });

  it('display.summary is present and non-empty', () => {
    expect(finalState.display.summary).toBeDefined();
    expect(finalState.display.summary.length).toBeGreaterThan(0);
  });

  // ── Augen tally ──────────────────────────────────────────────────────────

  it('total Augen across all tricks equals 240', () => {
    const { cardAugen } = require('../scorer');
    let total = 0;
    for (const trick of finalState._internal.trickHistory) {
      for (const [, cardId] of trick.cards) {
        total += cardAugen(cardId);
      }
    }
    expect(total).toBe(240);
  });

  it('Re team (Alice + Bob) accumulated 106 Augen', () => {
    const { cardAugen } = require('../scorer');
    let reAugen = 0;
    const reTeam = new Set([0, 1]);
    for (const trick of finalState._internal.trickHistory) {
      if (reTeam.has(trick.winnerIndex)) {
        for (const [, cardId] of trick.cards) {
          reAugen += cardAugen(cardId);
        }
      }
    }
    expect(reAugen).toBe(106);
  });

  it('Kontra team (Charlie + Dave) accumulated 134 Augen', () => {
    const { cardAugen } = require('../scorer');
    let kontraAugen = 0;
    const kontraTeam = new Set([2, 3]);
    for (const trick of finalState._internal.trickHistory) {
      if (kontraTeam.has(trick.winnerIndex)) {
        for (const [, cardId] of trick.cards) {
          kontraAugen += cardAugen(cardId);
        }
      }
    }
    expect(kontraAugen).toBe(134);
  });

  // ── Final scores ─────────────────────────────────────────────────────────
  //
  // Scoring (no announcements):
  //   1 base point
  // + 1 Gegen die Alten (Kontra wins)
  // + 1 Fuchs gefangen for Re (Alice catches Charlie's karo:as in trick 6)
  // = 3 points, negated because Kontra wins
  // → Alice −3, Bob −3, Charlie +3, Dave +3

  it('Kontra wins: Re has 106 < 121 Augen', () => {
    const scores = finalState.scores;
    const alice = scores.find(s => s.name === 'Alice').totalScore;
    const bob   = scores.find(s => s.name === 'Bob').totalScore;
    expect(alice).toBeLessThan(0);
    expect(bob).toBeLessThan(0);
  });

  it('Re players score −3 each', () => {
    const scores = finalState.scores;
    expect(scores.find(s => s.name === 'Alice').totalScore).toBe(-3);
    expect(scores.find(s => s.name === 'Bob').totalScore).toBe(-3);
  });

  it('Kontra players score +3 each', () => {
    const scores = finalState.scores;
    expect(scores.find(s => s.name === 'Charlie').totalScore).toBe(3);
    expect(scores.find(s => s.name === 'Dave').totalScore).toBe(3);
  });

  it('scores are zero-sum', () => {
    const total = finalState.scores.reduce((sum, s) => sum + s.totalScore, 0);
    expect(total).toBe(0);
  });

  // ── Summary content ──────────────────────────────────────────────────────

  it('summary identifies Kontra as winning team', () => {
    const labels = finalState.display.summary.map(s => s.label);
    expect(labels.some(l => l.includes('Kontra'))).toBe(true);
  });

  it('summary includes Gegen die Alten bonus', () => {
    const labels = finalState.display.summary.map(s => s.label);
    expect(labels.some(l => l.includes('Gegen die Alten'))).toBe(true);
  });

  it('summary includes Fuchs gefangen extra point', () => {
    const labels = finalState.display.summary.map(s => s.label);
    expect(labels.some(l => l.includes('Fuchs gefangen'))).toBe(true);
  });

  it('summary reports final Spielpunkte of −3', () => {
    const spielpunkte = finalState.display.summary.find(s => s.label === 'Spielpunkte');
    expect(spielpunkte).toBeDefined();
    expect(spielpunkte.value).toBe('-3');
  });
});
