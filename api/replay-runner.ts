/**
 * Shared replay runner for recorded playground sessions.
 *
 * Each recording is a JSON file with:
 *   { gameId, players, timestamp, steps: [ { type, boxes?, event?, expect } ] }
 *
 * Steps are replayed sequentially. After each step the runner asserts
 * playerScores, action types, and summary presence against the recorded
 * expectations.
 */

import * as fs from 'fs';
import * as path from 'path';

interface RecordedStep {
  type: 'processCards' | 'processEvent';
  /** Full snapshot — resets accumulated boxes. */
  boxes?: any[];
  /** Delta — appended to the previous accumulated boxes. */
  addedBoxes?: any[];
  event?: { type: string; data: any };
  expect: {
    playerScores?: number[];
    actions?: string[];
    hasSummary?: boolean;
    hud?: { label: string; value: string }[];
  };
}

interface Recording {
  gameId: string;
  players: string[];
  timestamp: string;
  steps: RecordedStep[];
}

const BOX_DEFAULTS = {
  similarity: 1,
  confidence: 1,
  x1: 0, y1: 0, x2: 0, y2: 0,
  cx: 0, cy: 0, w: 0, h: 0,
  angle: 0,
  keypoints: null,
};

/**
 * Expand delta-encoded steps in-place.  Steps with `boxes` reset the
 * accumulator; steps with `addedBoxes` append to it.  Missing DetectedCard
 * fields are filled with safe defaults.
 */
function expandSteps(steps: RecordedStep[]): void {
  let accumulated: any[] = [];
  for (const step of steps) {
    if (step.type !== 'processCards') continue;
    if (step.boxes) {
      accumulated = step.boxes.map((b: any) => ({ ...BOX_DEFAULTS, ...b }));
      step.boxes = accumulated.slice();
    } else if (step.addedBoxes) {
      const expanded = step.addedBoxes.map((b: any) => ({ ...BOX_DEFAULTS, ...b }));
      accumulated = accumulated.concat(expanded);
      step.boxes = accumulated.slice();
    }
  }
}

interface ScorerModule {
  Game?: new (players: string[]) => any;
  processCards?: (boxes: any[], context: any) => any;
}

export function replayRecordings(recordingsDir: string, scorer: ScorerModule) {
  if (!fs.existsSync(recordingsDir)) {
    it('no recordings directory', () => { });
    return;
  }

  const files = fs.readdirSync(recordingsDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    it('no recordings yet', () => { });
    return;
  }

  for (const file of files) {
    const filePath = path.join(recordingsDir, file);
    const recording: Recording = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    describe(`recording: ${file}`, () => {
      expandSteps(recording.steps);
      const isLive = recording.steps.some(s => s.type === 'processEvent');

      if (isLive && scorer.Game) {
        it('replays live-tracking session', () => {
          let game: any = null;

          for (let i = 0; i < recording.steps.length; i++) {
            const step = recording.steps[i];
            let result: any;

            if (step.type === 'processEvent') {
              const ev = step.event!;
              if (ev.type === 'gameStarted') {
                game = new scorer.Game!(recording.players);
              }
              result = game.processEvent(ev);
            } else {
              result = game.processCards(step.boxes ?? []);
            }

            assertStep(result, step, i);
          }
        });
      } else {
        it('replays static scoring session', () => {
          for (let i = 0; i < recording.steps.length; i++) {
            const step = recording.steps[i];
            if (step.type !== 'processCards') continue;

            const players = scorer.processCards!(step.boxes ?? [], {
              players: recording.players,
              similarityThreshold: 0.5,
            });
            const result = { players };

            assertStep(result, step, i);
          }
        });
      }
    });
  }
}

function assertStep(result: any, step: RecordedStep, index: number) {
  const ctx = `step ${index} (${step.type}${step.event ? ':' + step.event.type : ''})`;

  if (step.expect.playerScores) {
    const actual = (result.players ?? []).map((p: any) => p.totalScore ?? 0);
    expect(actual).toEqual(step.expect.playerScores);
  }

  if (step.expect.actions) {
    const actualTypes = (result.actions ?? []).map((a: any) => a.type);
    for (const expected of step.expect.actions) {
      expect(actualTypes).toContain(expected);
    }
  }

  if (step.expect.hasSummary) {
    expect(result.display?.summary).toBeDefined();
  }

  if (step.expect.hud) {
    expect(result.display?.hud).toEqual(step.expect.hud);
  }
}
