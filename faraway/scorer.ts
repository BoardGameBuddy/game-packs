/**
 * Faraway – BoardGameBuddy scorer
 *
 * TypeScript port of the Kotlin FarawayScorer.
 *
 * Rules summary:
 *  - Each player plays region cards (1–68) and sanctuary cards (1–45) face-down
 *    in a row, left to right.
 *  - Regions are scored last-to-first (the last card played scores first).
 *    Each region's scope = already-scored regions + this region + all sanctuaries.
 *  - Sanctuaries score against every card (all regions + all sanctuaries).
 *  - Each card has an optional condition (minimum stone/chimera/thistle symbols in
 *    scope) that must be met for the task to fire.
 *
 * Card data is loaded from cards.json bundled with this pack.
 */

import type { PlayerInput, PlayerScoreResult, CardScoreDetail, DetectedCard } from '../../scorer-api/types';

// ---------------------------------------------------------------------------
// JSON types (shape of faraway_cards.json)
// ---------------------------------------------------------------------------

type TaskType =
  | 'perHint'
  | 'perStone'
  | 'perChimera'
  | 'perThistle'
  | 'perCityOrRiver'
  | 'perForest'
  | 'perLandscapeSet'
  | 'perNight'
  | 'perYellow'
  | 'perBlue'
  | 'perGreen'
  | 'perRed'
  | 'perYellowOrBlue'
  | 'perYellowOrGreen'
  | 'perYellowOrRed'
  | 'perGreenOrRed'
  | 'perGreenOrBlue'
  | 'perBlueOrRed'
  | 'fixed';

interface JsonSymbols {
  stone: number;
  chimera: number;
  thistle: number;
  hints: number;
}

interface JsonCondition {
  stone_min: number;
  chimera_min: number;
  thistle_min: number;
}

interface JsonTask {
  type: TaskType;
  per: number;
  value: number;
}

interface JsonCard {
  id: number;
  color: string;
  night: boolean;
  symbols: JsonSymbols;
  condition: JsonCondition;
  points: JsonTask;
}

interface CardsJson {
  region: Record<string, JsonCard>;
  sanctuary: Record<string, JsonCard>;
}

// ---------------------------------------------------------------------------
// Internal card representation
// ---------------------------------------------------------------------------

type Landscape = 'city' | 'river' | 'forest' | 'desert' | null;

interface Card {
  /** Raw ID string, preserving leading zeros (e.g. "03"). */
  id: string;
  kind: 'region' | 'sanctuary';
  landscape: Landscape;
  night: boolean;
  stone: number;
  chimera: number;
  thistle: number;
  hints: number;
  taskType: TaskType | null;
  taskPer: number;
  taskValue: number;
  conditionStone: number;
  conditionChimera: number;
  conditionThistle: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLOR_TO_LANDSCAPE: Record<string, Landscape> = {
  red: 'city',
  blue: 'river',
  green: 'forest',
  yellow: 'desert',
};

// Card data bundled with this pack.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CARDS_JSON: CardsJson = require('./cards.json');

// ---------------------------------------------------------------------------
// Card loading helpers
// ---------------------------------------------------------------------------

/**
 * Converts a raw card ID (e.g. "03") to the numeric key used in cards.json
 * (e.g. "3"). Mirrors Kotlin's CardLoader.parseKey().
 */
function idToKey(idPart: string): string {
  const n = parseInt(idPart, 10);
  if (!isNaN(n)) return String(n);
  return idPart.replace(/^0+/, '') || '0';
}

function buildCard(rawId: string, kind: 'region' | 'sanctuary', data: JsonCard): Card {
  const sym = data.symbols ?? ({ stone: 0, chimera: 0, thistle: 0, hints: 0 } as JsonSymbols);
  const pts = data.points;
  // A task with type=fixed and value=0 is treated as "no task"
  const taskType: TaskType | null =
    pts && (pts.type !== 'fixed' || pts.value > 0) ? pts.type : null;

  return {
    id: rawId,
    kind,
    landscape: COLOR_TO_LANDSCAPE[data.color] ?? null,
    night: data.night,
    stone: sym.stone,
    chimera: sym.chimera,
    thistle: sym.thistle,
    hints: sym.hints,
    taskType,
    taskPer: pts?.per ?? 0,
    taskValue: pts?.value ?? 0,
    conditionStone: data.condition?.stone_min ?? 0,
    conditionChimera: data.condition?.chimera_min ?? 0,
    conditionThistle: data.condition?.thistle_min ?? 0,
  };
}

function loadCard(cardId: string, cards: CardsJson): Card | null {
  const trimmed = cardId.trim();
  const colon = trimmed.indexOf(':');
  if (colon < 0) return null;

  const kind = trimmed.slice(0, colon).toLowerCase();
  const rawId = trimmed.slice(colon + 1).trim();
  const key = idToKey(rawId);

  if (kind === 'region') {
    const data = cards.region[key];
    return data ? buildCard(rawId, 'region', data) : null;
  }
  if (kind === 'sanctuary') {
    const data = cards.sanctuary[key];
    return data ? buildCard(rawId, 'sanctuary', data) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Visual sort (mirrors BoxSortUtils.sortVisually)
// ---------------------------------------------------------------------------

/**
 * Sorts detected cards in reading order (by row top-to-bottom, then left-to-right
 * within each row). Cards whose y1 values are within half the average card height
 * are considered the same row.
 */
function sortVisually(cards: DetectedCard[]): DetectedCard[] {
  if (cards.length === 0) return cards;
  const avgH = cards.reduce((sum, c) => sum + c.h, 0) / cards.length;
  const rowThreshold = Math.max(avgH / 2, 1e-3);
  return [...cards].sort((a, b) => {
    if (Math.abs(a.y1 - b.y1) < rowThreshold) return a.x1 - b.x1;
    return a.y1 - b.y1;
  });
}

// ---------------------------------------------------------------------------
// Condition check
// ---------------------------------------------------------------------------

function meetsCondition(scope: Card[], card: Card): boolean {
  const stone = scope.reduce((s, c) => s + c.stone, 0);
  const chimera = scope.reduce((s, c) => s + c.chimera, 0);
  const thistle = scope.reduce((s, c) => s + c.thistle, 0);
  return (
    card.conditionStone <= stone &&
    card.conditionChimera <= chimera &&
    card.conditionThistle <= thistle
  );
}

// ---------------------------------------------------------------------------
// Task evaluation (mirrors TaskEvaluatorFactory)
// ---------------------------------------------------------------------------

/** Returns the effective multiplier: task.per if non-zero, else the default. */
function mult(taskPer: number, defaultM: number): number {
  return taskPer !== 0 ? Math.round(taskPer) : defaultM;
}

function evalTask(card: Card, scope: Card[]): [number, string] {
  const type = card.taskType;
  if (!type) return [0, 'keine Aufgabe'];

  const p = card.taskPer;

  switch (type) {
    case 'perHint': {
      const n = scope.reduce((s, c) => s + c.hints, 0);
      const m = mult(p, 1);
      return [n * m, `${m} pro Hinweis × ${n}`];
    }
    case 'perStone': {
      const n = scope.reduce((s, c) => s + c.stone, 0);
      const m = mult(p, 2);
      return [n * m, `${m} pro Stein × ${n}`];
    }
    case 'perChimera': {
      const n = scope.reduce((s, c) => s + c.chimera, 0);
      const m = mult(p, 4);
      return [n * m, `${m} pro Chimäre × ${n}`];
    }
    case 'perThistle': {
      const n = scope.reduce((s, c) => s + c.thistle, 0);
      const m = mult(p, 3);
      return [n * m, `${m} pro Distel × ${n}`];
    }
    case 'perNight': {
      const n = scope.filter((c) => c.night).length;
      const m = mult(p, 4);
      return [n * m, `${m} pro Nacht × ${n}`];
    }
    case 'perForest': {
      const n = scope.filter((c) => c.landscape === 'forest').length;
      const m = mult(p, 4);
      return [n * m, `${m} pro Wald × ${n}`];
    }
    case 'perLandscapeSet': {
      const city = scope.filter((c) => c.landscape === 'city').length;
      const river = scope.filter((c) => c.landscape === 'river').length;
      const forest = scope.filter((c) => c.landscape === 'forest').length;
      const desert = scope.filter((c) => c.landscape === 'desert').length;
      const n = Math.min(city, river, forest, desert);
      const m = mult(p, 10);
      return [n * m, `${m} pro Set (Stadt/Fluss/Wald/Wüste) × ${n}`];
    }
    case 'perYellow': {
      const n = scope.filter((c) => c.landscape === 'desert').length;
      const m = mult(p, 1);
      return [n * m, `${m} pro Wüste × ${n}`];
    }
    case 'perBlue': {
      const n = scope.filter((c) => c.landscape === 'river').length;
      const m = mult(p, 1);
      return [n * m, `${m} pro Fluss × ${n}`];
    }
    case 'perGreen': {
      const n = scope.filter((c) => c.landscape === 'forest').length;
      const m = mult(p, 1);
      return [n * m, `${m} pro Wald × ${n}`];
    }
    case 'perRed': {
      const n = scope.filter((c) => c.landscape === 'city').length;
      const m = mult(p, 1);
      return [n * m, `${m} pro Stadt × ${n}`];
    }
    case 'perCityOrRiver': {
      const c1 = scope.filter((c) => c.landscape === 'city').length;
      const c2 = scope.filter((c) => c.landscape === 'river').length;
      const m = mult(p, 2);
      return [(c1 + c2) * m, `${m} pro Stadt (${c1}) + Fluss (${c2})`];
    }
    case 'perYellowOrBlue': {
      const c1 = scope.filter((c) => c.landscape === 'desert').length;
      const c2 = scope.filter((c) => c.landscape === 'river').length;
      const m = mult(p, 1);
      return [(c1 + c2) * m, `${m} pro Wüste (${c1}) + Fluss (${c2})`];
    }
    case 'perYellowOrGreen': {
      const c1 = scope.filter((c) => c.landscape === 'desert').length;
      const c2 = scope.filter((c) => c.landscape === 'forest').length;
      const m = mult(p, 1);
      return [(c1 + c2) * m, `${m} pro Wüste (${c1}) + Wald (${c2})`];
    }
    case 'perYellowOrRed': {
      const c1 = scope.filter((c) => c.landscape === 'desert').length;
      const c2 = scope.filter((c) => c.landscape === 'city').length;
      const m = mult(p, 1);
      return [(c1 + c2) * m, `${m} pro Wüste (${c1}) + Stadt (${c2})`];
    }
    case 'perGreenOrRed': {
      const c1 = scope.filter((c) => c.landscape === 'forest').length;
      const c2 = scope.filter((c) => c.landscape === 'city').length;
      const m = mult(p, 1);
      return [(c1 + c2) * m, `${m} pro Wald (${c1}) + Stadt (${c2})`];
    }
    case 'perGreenOrBlue': {
      const c1 = scope.filter((c) => c.landscape === 'forest').length;
      const c2 = scope.filter((c) => c.landscape === 'river').length;
      const m = mult(p, 1);
      return [(c1 + c2) * m, `${m} pro Wald (${c1}) + Fluss (${c2})`];
    }
    case 'perBlueOrRed': {
      const c1 = scope.filter((c) => c.landscape === 'river').length;
      const c2 = scope.filter((c) => c.landscape === 'city').length;
      const m = mult(p, 1);
      return [(c1 + c2) * m, `${m} pro Fluss (${c1}) + Stadt (${c2})`];
    }
    case 'fixed': {
      return [card.taskValue, `feste ${card.taskValue} Punkte`];
    }
    default:
      return [0, 'unbekannte Aufgabe'];
  }
}

// ---------------------------------------------------------------------------
// Core scoring
// ---------------------------------------------------------------------------

function scorePlayer(
  detectedCards: DetectedCard[],
  cards: CardsJson,
): { total: number; cardDetails: CardScoreDetail[] } {
  const sorted = sortVisually(detectedCards);

  const regions: Card[] = [];
  const sanctuaries: Card[] = [];
  for (const dc of sorted) {
    const card = loadCard(dc.cardId, cards);
    if (!card) continue;
    if (card.kind === 'region') regions.push(card);
    else sanctuaries.push(card);
  }

  const allCards: Card[] = [...regions, ...sanctuaries];
  const cardDetails: CardScoreDetail[] = [];
  let total = 0;

  const regionsGroup = `${regions.length} Regionen`;
  const sanctuariesGroup = `${sanctuaries.length} Heiligtümer`;

  // Regions scored last-to-first; scope grows as each scored region is "revealed"
  const revealed: Card[] = [];
  for (let i = regions.length - 1; i >= 0; i--) {
    const region = regions[i];
    const scope: Card[] = [...revealed, region, ...sanctuaries];

    let points = 0;
    let reason = 'keine Aufgabe';

    if (region.taskType !== null) {
      if (meetsCondition(scope, region)) {
        [points, reason] = evalTask(region, scope);
      } else {
        reason = 'Bedingung nicht erfüllt';
      }
    }

    total += points;
    const displayId = region.id.replace(/^0+/, '') || '0';
    cardDetails.push({
      cardId: `region:${region.id}`,
      points,
      reason,
      title: `Karte ${displayId}`,
      group: regionsGroup,
    });
    revealed.push(region);
  }

  // Sanctuaries scored against all cards
  for (const sanctuary of sanctuaries) {
    let points = 0;
    let reason = 'kein Effekt';

    if (sanctuary.taskType !== null) {
      [points, reason] = evalTask(sanctuary, allCards);
    }

    total += points;
    const displayId = sanctuary.id.replace(/^0+/, '') || '0';
    cardDetails.push({
      cardId: `sanctuary:${sanctuary.id}`,
      points,
      reason,
      title: `Karte ${displayId}`,
      group: sanctuariesGroup,
    });
  }

  return { total, cardDetails };
}

// ---------------------------------------------------------------------------
// Exported scorer function
// ---------------------------------------------------------------------------

export function score(players: PlayerInput[]): PlayerScoreResult[] {
  return players.map((player) => {
    if (player.cards.length === 0) {
      return { name: player.name, totalScore: 0, cardDetails: [] };
    }
    const { total, cardDetails } = scorePlayer(player.cards, CARDS_JSON);
    return { name: player.name, totalScore: total, cardDetails };
  });
}
