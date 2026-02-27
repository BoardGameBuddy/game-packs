/**
 * Template scorer tests.
 *
 * Replace with real test fixtures for your game.
 */

// When using the compiled JS in tests:
const { score } = require('../scorer');

describe('score', () => {
  it('returns one result per player', () => {
    const players = [
      { name: 'Alice', cards: [] },
      { name: 'Bob',   cards: [] },
    ];
    const results = score(players);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('Alice');
    expect(results[1].name).toBe('Bob');
  });

  it('awards one point per card', () => {
    const players = [
      {
        name: 'Alice',
        cards: [
          {
            cardId: 'mygame:card01',
            similarity: 0.95,
            x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.4,
            cx: 0.2, cy: 0.25, w: 0.2, h: 0.3,
          },
          {
            cardId: 'mygame:card02',
            similarity: 0.91,
            x1: 0.4, y1: 0.1, x2: 0.6, y2: 0.4,
            cx: 0.5, cy: 0.25, w: 0.2, h: 0.3,
          },
        ],
      },
    ];

    const results = score(players);
    expect(results[0].totalScore).toBe(2);
    expect(results[0].cardDetails).toHaveLength(2);
  });

  it('preserves player order', () => {
    const names = ['Alice', 'Bob', 'Charlie'];
    const players = names.map((name) => ({ name, cards: [] }));
    const results = score(players);
    expect(results.map((r) => r.name)).toEqual(names);
  });
});
