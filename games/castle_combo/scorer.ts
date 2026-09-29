/**
 * Castle Combo – BoardGameBuddy scorer
 *
 * Each player ends with 9 cards in a 3×3 grid. Every card scores on its own,
 * usually from the shields in its row/column/tableau or from its position.
 * Face-down cards (card back detected) score nothing and carry no shields.
 *
 * Gold only scores while stored on purse cards. At game end players may still
 * move gold from their supply onto purses, so the scorer asks for each
 * player's total gold and stores as much of it as the purses hold. Every
 * remaining key is worth 1 point.
 *
 * Card data is loaded from cards.json bundled with this pack.
 */

import type { AdditionalInput, GamePack, GameState, DetectedBox, ScorerContext, PlayerScoreResult, CardScoreDetail } from '@boardgamebuddy/game-pack-api';
import { rectifyBoxes, groupByPlayer, createTranslator } from '@boardgamebuddy/game-pack-api';

const t = createTranslator(require('path').join(__dirname, 'texts.json'));

// ---------------------------------------------------------------------------
// JSON types (shape of cards.json)
// ---------------------------------------------------------------------------

type Shield = 'blue' | 'purple' | 'green' | 'red' | 'yellow' | 'orange';
type Line = 'row' | 'column' | 'row_col';
type Where = 'top_row' | 'middle_row' | 'bottom_row' | 'left_col' | 'middle_col' | 'right_col' | 'corner' | 'edge_middle';
type CardFilter = 'castle' | 'village' | 'double_shield' | 'single_shield' | 'cost4' | 'cost0' | 'cost5plus'
  | 'discount' | 'purse' | 'castle_village_pair';

type ScoreRule =
  | { type: 'shield_in_line'; color: Shield; line: Line; points: number }
  | { type: 'diff_shield'; line: 'row' | 'column' | 'tableau'; points: number }
  | { type: 'shield_set'; colors: Shield[]; points: number }
  | { type: 'identical_set'; size: number; points: number }
  | { type: 'missing_types'; points: number }
  | { type: 'if_missing'; color: Shield; points: number }
  | { type: 'position'; where: Where; points: number }
  | { type: 'per_card'; filter: CardFilter; points: number; per?: number }
  | { type: 'if_facedown'; points: number }
  | { type: 'stored_gold'; points: number; max: number }
  | { type: 'all_stored_gold'; points: number }
  | { type: 'per_key'; points: number };

interface CardJson {
  deck: 'castle' | 'village';
  cost: number;
  shields: Shield[];
  purse: number | null;
  discount: boolean;
  score: ScoreRule;
}

interface CardsJson {
  cards: Record<string, CardJson>;
}

const CARDS_JSON: CardsJson = require('./cards.json');

const ALL_SHIELDS: Shield[] = ['blue', 'purple', 'green', 'red', 'yellow', 'orange'];

// ---------------------------------------------------------------------------
// Grid placement
// ---------------------------------------------------------------------------

interface Cell {
  box: DetectedBox;
  boxIndex: number;
  /** null for a face-down card. */
  card: CardJson | null;
  row: number;
  col: number;
}

/**
 * Assigns each value to one of up to 3 bands (rows or columns) by splitting
 * at the largest gaps. A gap only splits when it exceeds half a card, so a
 * missing card does not break a band apart.
 */
function bands(values: number[], cardSize: number): number[] {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const gaps = order.slice(1).map((idx, i) => ({ pos: i, size: values[idx] - values[order[i]] }));
  const splits = gaps
    .filter((g) => g.size > cardSize / 2)
    .sort((a, b) => b.size - a.size)
    .slice(0, 2)
    .map((g) => g.pos)
    .sort((a, b) => a - b);
  const band = new Array<number>(values.length);
  let current = 0;
  order.forEach((idx, i) => {
    band[idx] = current;
    if (splits.includes(i)) current++;
  });
  return band;
}

function placeCards(boxes: DetectedBox[], boxIndices: number[]): Cell[] {
  const rectified = rectifyBoxes(boxes);
  const known = boxes
    .map((box, i) => ({ box: rectified[i], original: box, boxIndex: boxIndices[i] }))
    .filter(({ original }) => isBack(original.cardId) || CARDS_JSON.cards[original.cardId] !== undefined);
  if (known.length === 0) return [];
  const avgW = known.reduce((s, k) => s + k.box.w, 0) / known.length;
  const avgH = known.reduce((s, k) => s + k.box.h, 0) / known.length;
  const cols = bands(known.map((k) => k.box.cx), avgW);
  const rows = bands(known.map((k) => k.box.cy), avgH);
  const cells = known.map((k, i) => ({
    box: k.original,
    boxIndex: k.boxIndex,
    card: isBack(k.original.cardId) ? null : CARDS_JSON.cards[k.original.cardId],
    row: rows[i],
    col: cols[i],
  }));
  return cells.sort((a, b) => a.row - b.row || a.col - b.col);
}

function isBack(cardId: string): boolean {
  return cardId.endsWith(':back');
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function fmt(template: string, ...args: (string | number)[]): string {
  let i = 0;
  return template.replace(/%[ds]/g, () => String(args[i++]));
}

const shieldName = (s: Shield) => t('shields.' + s, s);

function shieldsOf(cells: Cell[]): Shield[] {
  return cells.flatMap((c) => c.card?.shields ?? []);
}

function inLine(cells: Cell[], self: Cell, line: Line | 'tableau'): Cell[] {
  return cells.filter((c) =>
    line === 'tableau'
    || (line !== 'column' && c.row === self.row)
    || (line !== 'row' && c.col === self.col));
}

function matchesPosition(cell: Cell, where: Where): boolean {
  const edge = (v: number) => v === 0 || v === 2;
  switch (where) {
    case 'top_row': return cell.row === 0;
    case 'middle_row': return cell.row === 1;
    case 'bottom_row': return cell.row === 2;
    case 'left_col': return cell.col === 0;
    case 'middle_col': return cell.col === 1;
    case 'right_col': return cell.col === 2;
    case 'corner': return edge(cell.row) && edge(cell.col);
    case 'edge_middle': return edge(cell.row) !== edge(cell.col);
  }
}

function countCards(cells: Cell[], filter: CardFilter): number {
  const cards = cells.map((c) => c.card).filter((c): c is CardJson => c !== null);
  const count = (pred: (c: CardJson) => boolean) => cards.filter(pred).length;
  switch (filter) {
    case 'castle': return count((c) => c.deck === 'castle');
    case 'village': return count((c) => c.deck === 'village');
    case 'double_shield': return count((c) => c.shields.length === 2);
    case 'single_shield': return count((c) => c.shields.length === 1);
    case 'cost4': return count((c) => c.cost === 4);
    case 'cost0': return count((c) => c.cost === 0);
    case 'cost5plus': return count((c) => c.cost >= 5);
    case 'discount': return count((c) => c.discount);
    case 'purse': return count((c) => c.purse !== null);
    case 'castle_village_pair': return Math.min(count((c) => c.deck === 'castle'), count((c) => c.deck === 'village'));
  }
}

interface PlayerExtras {
  keys: number;
  /** Gold stored on each purse cell, by cell. */
  stored: Map<Cell, number>;
  totalStored: number;
}

function scoreCell(cell: Cell, cells: Cell[], extras: PlayerExtras): [number, string] {
  const rule = cell.card!.score;
  switch (rule.type) {
    case 'shield_in_line': {
      const n = shieldsOf(inLine(cells, cell, rule.line)).filter((s) => s === rule.color).length;
      return [n * rule.points, fmt(t('ui.shield_in_line'), n, shieldName(rule.color), t('ui.' + rule.line))];
    }
    case 'diff_shield': {
      const n = new Set(shieldsOf(inLine(cells, cell, rule.line))).size;
      return [n * rule.points, fmt(t('ui.diff_shield'), n, t('ui.' + rule.line))];
    }
    case 'shield_set': {
      const all = shieldsOf(cells);
      const n = Math.min(...rule.colors.map((color) => all.filter((s) => s === color).length));
      return [n * rule.points, fmt(t('ui.shield_set'), n, rule.colors.map(shieldName).join(' + '))];
    }
    case 'identical_set': {
      const all = shieldsOf(cells);
      const n = ALL_SHIELDS.reduce((sum, color) => sum + Math.floor(all.filter((s) => s === color).length / rule.size), 0);
      return [n * rule.points, fmt(t('ui.identical_set'), n)];
    }
    case 'missing_types': {
      const n = ALL_SHIELDS.length - new Set(shieldsOf(cells)).size;
      return [n * rule.points, fmt(t('ui.missing_types'), n)];
    }
    case 'if_missing': {
      const missing = !shieldsOf(cells).includes(rule.color);
      return [missing ? rule.points : 0, fmt(t(missing ? 'ui.if_missing_ok' : 'ui.if_missing_fail'), shieldName(rule.color))];
    }
    case 'position': {
      const ok = matchesPosition(cell, rule.where);
      return [ok ? rule.points : 0, fmt(t(ok ? 'ui.position_ok' : 'ui.position_fail'), t('where.' + rule.where))];
    }
    case 'per_card': {
      const per = rule.per ?? 1;
      const n = countCards(cells, rule.filter);
      const reason = per === 1
        ? fmt(t('ui.per_card'), n, t('filters.' + rule.filter))
        : fmt(t('ui.per_card_per'), n, t('filters.' + rule.filter), per);
      return [Math.floor(n / per) * rule.points, reason];
    }
    case 'if_facedown': {
      const ok = cells.some((c) => c.card === null);
      return [ok ? rule.points : 0, t(ok ? 'ui.if_facedown_ok' : 'ui.if_facedown_fail')];
    }
    case 'stored_gold': {
      const n = extras.stored.get(cell) ?? 0;
      return [n * rule.points, fmt(t('ui.stored_gold'), n, rule.max)];
    }
    case 'all_stored_gold':
      return [extras.totalStored * rule.points, fmt(t('ui.all_stored_gold'), extras.totalStored)];
    case 'per_key':
      return [extras.keys * rule.points, fmt(t('ui.per_key'), extras.keys)];
  }
}

/** Stores gold on purses in grid order; every purse gold is worth the same. */
function storeGold(cells: Cell[], gold: number): Map<Cell, number> {
  const stored = new Map<Cell, number>();
  let left = gold;
  for (const cell of cells) {
    const rule = cell.card?.score;
    if (rule?.type !== 'stored_gold') continue;
    const n = Math.min(left, rule.max, cell.card!.purse ?? rule.max);
    stored.set(cell, n);
    left -= n;
  }
  return stored;
}

function inputFor(context: ScorerContext | undefined, id: string, player: string): number {
  const values = context?.additionalInputs?.[id];
  const v = typeof values === 'object' ? values[player] : undefined;
  return Number.isFinite(v) && v! > 0 ? Math.floor(v!) : 0;
}

// ---------------------------------------------------------------------------
// Game pack
// ---------------------------------------------------------------------------

export class CastleComboGame implements GamePack {
  private players: string[];

  constructor(players: string[]) {
    this.players = players;
  }

  processCards(boxes: DetectedBox[], context?: ScorerContext): GameState {
    const { groups, indices } = groupByPlayer(boxes, this.players.length);
    return {
      players: this.players.map((name, p) => {
        const cells = placeCards(groups[p] ?? [], indices[p] ?? []);
        const gold = inputFor(context, 'gold', name);
        const keys = inputFor(context, 'keys', name);
        const stored = storeGold(cells, gold);
        const totalStored = [...stored.values()].reduce((s, n) => s + n, 0);
        const extras: PlayerExtras = { keys, stored, totalStored };
        const gridGroup = t('ui.grid_group');

        const cardDetails: CardScoreDetail[] = cells.map((cell) => {
          const slug = cell.box.cardId.split(':')[1];
          const [points, reason] = cell.card ? scoreCell(cell, cells, extras) : [0, t('ui.facedown')];
          return { cardId: cell.box.cardId, points, reason, title: t('cards.' + slug, slug), group: gridGroup };
        });

        const extrasGroup = t('ui.extras_group');
        if (keys > 0) {
          cardDetails.push({
            cardId: 'keys', points: keys, reason: fmt(t('ui.keys_reason'), keys),
            title: t('ui.keys_title'), group: extrasGroup,
          });
        }
        if (gold > totalStored) {
          cardDetails.push({
            cardId: 'gold', points: 0, reason: fmt(t('ui.gold_unstored'), gold - totalStored),
            title: 'Gold', group: extrasGroup,
          });
        }

        const totalScore = cardDetails.reduce((s, d) => s + d.points, 0);
        return { name, totalScore, cardDetails, boxIndices: cells.map((c) => c.boxIndex) };
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Additional inputs declaration
// ---------------------------------------------------------------------------

export const inputs: AdditionalInput[] = [
  { id: 'gold', label: t('inputs.gold', 'Gold'), type: 'stepper', perPlayer: true, min: 0, default: 0 },
  { id: 'keys', label: t('inputs.keys', 'Schlüssel'), type: 'stepper', perPlayer: true, min: 0, default: 0 },
];

// ---------------------------------------------------------------------------
// Legacy wrapper
// ---------------------------------------------------------------------------

export function processCards(boxes: DetectedBox[], context: ScorerContext): PlayerScoreResult[] {
  const game = new CastleComboGame(context.players);
  return game.processCards(boxes, context).players;
}

export { CastleComboGame as Game };
