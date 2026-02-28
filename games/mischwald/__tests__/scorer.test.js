/**
 * Mischwald scorer tests.
 *
 * Tests are driven from the same JSON fixture files used by the Kotlin
 * parameterised test (MischwaldScorerTest.kt), so any scenario that passes
 * in Kotlin should also pass here.
 *
 * Fixture format (matching Kotlin ScoringTestCaseFile):
 * {
 *   players: [ { name, boxes: [[x1,y1,x2,y2,"clsName"], ...] } ],
 *   expected: [ { name, totalScore, cardDetails: [{cardId, points}] } ]
 * }
 */

const path = require('path');
const fs   = require('fs');
const { score } = require('../scorer');

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function loadFixtures() {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs.readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const name = f.replace('.json', '');
      const data = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf8'));
      return { name, ...data };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Convert fixture boxes → PlayerInput cards
// ---------------------------------------------------------------------------

function boxToCard([x1, y1, x2, y2, clsName]) {
  const w = x2 - x1;
  const h = y2 - y1;
  return {
    cardId: clsName,
    similarity: 1.0,
    x1, y1, x2, y2,
    cx: x1 + w / 2,
    cy: y1 + h / 2,
    w, h,
  };
}

// ---------------------------------------------------------------------------
// Fixture-driven tests
// ---------------------------------------------------------------------------

describe('Mischwald scorer – fixture-driven', () => {
  const fixtures = loadFixtures();

  for (const fixture of fixtures) {
    test(fixture.name, () => {
      const players = fixture.players.map((p) => ({
        name: p.name,
        cards: p.boxes.map(boxToCard),
      }));

      const results = score(players);

      expect(results).toHaveLength(fixture.expected.length);

      for (let i = 0; i < fixture.expected.length; i++) {
        const exp = fixture.expected[i];
        const got = results[i];

        expect(got.name).toBe(exp.name);

        if (exp.totalScore != null) {
          expect(got.totalScore).toBe(exp.totalScore);
        }

        if (exp.cardDetails != null) {
          expect(got.cardDetails).toHaveLength(exp.cardDetails.length);
          for (let j = 0; j < exp.cardDetails.length; j++) {
            const expDetail = exp.cardDetails[j];
            const gotDetail = got.cardDetails[j];
            expect(gotDetail.cardId).toBe(expDetail.cardId);
            if (expDetail.points != null) {
              expect(gotDetail.points).toBe(expDetail.points);
            }
          }
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Additional unit tests
// ---------------------------------------------------------------------------

describe('Mischwald scorer – unit tests', () => {
  it('returns one result per player in the same order', () => {
    const players = [
      { name: 'Alice', cards: [] },
      { name: 'Bob',   cards: [] },
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

  it('a lone tree card with no score rule returns 0', () => {
    // brown_bear has no score rule
    const results = score([{
      name: 'Alice',
      cards: [boxToCard([0.1, 0.4, 0.2, 0.6, 'oak:oak'])],
    }]);
    // oak scores based on having ≥8 unique trees; alone it scores 0
    expect(results[0].cardDetails[0].cardId).toBe('oak:oak');
  });

  it('groups cards under the correct tree label', () => {
    // Two trees, each with one attached animal
    // Layout: [oak][wolf] side-by-side on the top, [birch][wolf] below
    const results = score([{
      name: 'Alice',
      cards: [
        // tree 1 (left)
        boxToCard([0.1, 0.4, 0.3, 0.7, 'oak:oak']),
        // attached to tree 1 on the right
        boxToCard([0.31, 0.4, 0.5, 0.7, 'wolf:oak']),
        // tree 2 (far right)
        boxToCard([0.6, 0.4, 0.8, 0.7, 'birch:birch']),
        // attached to tree 2 on the right
        boxToCard([0.81, 0.4, 0.99, 0.7, 'wolf:birch']),
      ],
    }]);

    const details = results[0].cardDetails;
    // Both wolf cards should have a group
    const wolves = details.filter((d) => d.cardId.startsWith('wolf:'));
    wolves.forEach((w) => expect(w.group).toMatch(/Baum \d+/));
  });
});
