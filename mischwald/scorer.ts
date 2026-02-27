/**
 * Mischwald (Forest Shuffle) – BoardGameBuddy scorer
 *
 * TypeScript port of:
 *   - ForestParser.kt  — spatial forest-building logic
 *   - MischwaldScorer.kt — scoring engine (fixed / multiplication / table)
 *
 * Card IDs use the format `<cardId>:<treeSymbol>`, e.g. `wolf:oak`.
 * Tree cards have a "Tree" tag in cards.json and are identified by the
 * first part of the clsName matching a tree ID.
 *
 * Card data is loaded from cards.json bundled with this pack.
 */

import type { PlayerInput, PlayerScoreResult, CardScoreDetail } from '../../scorer-api/types';

// ---------------------------------------------------------------------------
// JSON types (shape of mischwald_cards.json)
// ---------------------------------------------------------------------------

interface CardsJson {
  cards: CardDef[];
}

// score.amount can be a single number (fixed/multiplication) OR an array (table)
type ScoreAmount = number | number[];

interface ScoreJson {
  type: string;
  amount?: ScoreAmount;
  min?: number;
  condition?: ConditionJson;
}

interface ConditionJson {
  name?: string[];
  tags?: string[];
  type?: string;
  unique?: boolean;
  sameTree?: boolean;
  sameTreeSymbol?: boolean;
  fullTree?: boolean;
  most?: boolean;
  sameSpot?: boolean;
  position?: string[];
}

interface JokerJson {
  type: string;
}

interface CardDef {
  id: string;
  tags: string[];
  type?: string;
  score?: ScoreJson;
  joker?: JokerJson;
}

// ---------------------------------------------------------------------------
// Internal models
// ---------------------------------------------------------------------------

type Side = 'top' | 'bottom' | 'left' | 'right';

interface Box {
  x1: number; y1: number; x2: number; y2: number;
  cx: number; cy: number; w: number; h: number;
  clsName: string;
}

interface CardInstance {
  box: Box;
  id: string;
  treeSymbol: string;
  definition: CardDef | null;
  /** Used for shared-table deduplication across instances. */
  set?: Set<string>;
}

interface Tree {
  card: CardInstance;
  top: CardInstance[];
  left: CardInstance[];
  right: CardInstance[];
  bottom: CardInstance[];
}

interface Forest {
  trees: Tree[];
}

interface Placement {
  tree: Tree;
  side: Side | null;
}

interface PlacementCandidate {
  tree: CardInstance;
  side: Side;
  dist: number;
  overlap: number;
}

// ---------------------------------------------------------------------------
// Constants (mirror Kotlin)
// ---------------------------------------------------------------------------

const ADJACENT_EPSILON = 1e-3;
const SIDE_OVERLAP_TOLERANCE = 2e-3;
const MIN_PERP_OVERLAP_RATIO = 0.20;
const MAX_SIDE_GAP_RATIO = 0.50;

// ---------------------------------------------------------------------------
// Cards JSON
// ---------------------------------------------------------------------------

// Card data bundled with this pack.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CARDS_JSON: CardsJson = require('./cards.json');

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function overlapH(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
}

function overlapV(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
}

// ---------------------------------------------------------------------------
// Card instance parsing
// ---------------------------------------------------------------------------

function parseCardInstance(box: Box, defById: Map<string, CardDef>): CardInstance | null {
  const colon = box.clsName.indexOf(':');
  if (colon < 0) return null;
  const id = box.clsName.slice(0, colon).trim();
  const treeSymbol = box.clsName.slice(colon + 1).trim();
  return { box, id, treeSymbol, definition: defById.get(id) ?? null };
}

// ---------------------------------------------------------------------------
// Forest parser (mirrors ForestParser.kt)
// ---------------------------------------------------------------------------

function bestPlacementCandidate(
  card: CardInstance,
  tree: CardInstance,
): PlacementCandidate | null {
  const sides: Side[] = ['top', 'left', 'right', 'bottom'];
  let best: PlacementCandidate | null = null;

  for (const side of sides) {
    const perpOverlap = (side === 'top' || side === 'bottom')
      ? overlapH(card.box, tree.box)
      : overlapV(card.box, tree.box);

    const minPerpSize = Math.max(
      ADJACENT_EPSILON,
      (side === 'top' || side === 'bottom')
        ? Math.min(tree.box.w, card.box.w)
        : Math.min(tree.box.h, card.box.h),
    );

    if (perpOverlap < minPerpSize * MIN_PERP_OVERLAP_RATIO) continue;

    let rawDist: number;
    switch (side) {
      case 'top': rawDist = tree.box.y1 - card.box.y2; break;
      case 'bottom': rawDist = card.box.y1 - tree.box.y2; break;
      case 'left': rawDist = tree.box.x1 - card.box.x2; break;
      case 'right': rawDist = card.box.x1 - tree.box.x2; break;
    }

    if (rawDist < -SIDE_OVERLAP_TOLERANCE) continue;
    const dist = Math.max(0, rawDist);

    const maxGap = Math.max(
      ADJACENT_EPSILON,
      (side === 'top' || side === 'bottom')
        ? Math.max(tree.box.h, card.box.h)
        : Math.max(tree.box.w, card.box.w),
    ) * MAX_SIDE_GAP_RATIO;

    if (dist > maxGap) continue;

    const onCorrectSide = (
      (side === 'top' && card.box.cy <= tree.box.cy) ||
      (side === 'bottom' && card.box.cy >= tree.box.cy) ||
      (side === 'left' && card.box.cx <= tree.box.cx) ||
      (side === 'right' && card.box.cx >= tree.box.cx)
    );
    if (!onCorrectSide) continue;

    const cand: PlacementCandidate = { tree, side, dist, overlap: perpOverlap };
    if (!best || dist < best.dist || (dist === best.dist && perpOverlap > best.overlap)) {
      best = cand;
    }
  }

  return best;
}

function pickDirectlyAdjacent(
  anchorBox: Box,
  cards: CardInstance[],
  side: Side,
): CardInstance[] {
  const candidates: [CardInstance, number][] = [];

  for (const card of cards) {
    const perpOverlap = (side === 'top' || side === 'bottom')
      ? overlapH(card.box, anchorBox)
      : overlapV(card.box, anchorBox);

    const minPerpSize = Math.max(
      ADJACENT_EPSILON,
      (side === 'top' || side === 'bottom')
        ? Math.min(anchorBox.w, card.box.w)
        : Math.min(anchorBox.h, card.box.h),
    );

    if (perpOverlap < minPerpSize * MIN_PERP_OVERLAP_RATIO) continue;

    let rawDist: number;
    switch (side) {
      case 'top': rawDist = anchorBox.y1 - card.box.y2; break;
      case 'bottom': rawDist = card.box.y1 - anchorBox.y2; break;
      case 'left': rawDist = anchorBox.x1 - card.box.x2; break;
      case 'right': rawDist = card.box.x1 - anchorBox.x2; break;
    }

    if (rawDist < -SIDE_OVERLAP_TOLERANCE) continue;
    const dist = Math.max(0, rawDist);

    const onCorrectSide = (
      (side === 'top' && card.box.y2 <= anchorBox.y1 + ADJACENT_EPSILON) ||
      (side === 'bottom' && card.box.y1 >= anchorBox.y2 - ADJACENT_EPSILON) ||
      (side === 'left' && card.box.x2 <= anchorBox.x1 + ADJACENT_EPSILON) ||
      (side === 'right' && card.box.x1 >= anchorBox.x2 - ADJACENT_EPSILON)
    );
    if (!onCorrectSide) continue;

    const maxGap = Math.max(
      ADJACENT_EPSILON,
      (side === 'top' || side === 'bottom')
        ? Math.max(anchorBox.h, card.box.h)
        : Math.max(anchorBox.w, card.box.w),
    ) * MAX_SIDE_GAP_RATIO;

    if (dist > maxGap) continue;
    candidates.push([card, dist]);
  }

  if (candidates.length === 0) return [];
  const minDist = Math.min(...candidates.map(([, d]) => d));
  return candidates
    .filter(([, d]) => d <= minDist + ADJACENT_EPSILON)
    .map(([c]) => c);
}

function expandSideChain(
  treeBox: Box,
  side: Side,
  attached: CardInstance[],
  remaining: CardInstance[],
): void {
  const anchors: Box[] = [treeBox, ...attached.map((c) => c.box)];

  while (true) {
    const next = new Set<CardInstance>();
    for (const anchor of anchors) {
      for (const c of pickDirectlyAdjacent(anchor, remaining, side)) next.add(c);
    }
    if (next.size === 0) break;
    for (const c of next) {
      const idx = remaining.indexOf(c);
      if (idx >= 0) {
        remaining.splice(idx, 1);
        attached.push(c);
        anchors.push(c.box);
      }
    }
  }
}

function buildForest(boxes: Box[], cards: CardsJson): Forest {
  const defById = new Map<string, CardDef>(cards.cards.map((c) => [c.id, c]));
  const treeIds = new Set<string>(
    cards.cards.filter((c) => c.tags.includes('Tree')).map((c) => c.id),
  );

  const treeBoxes = boxes.filter((b) => {
    const colon = b.clsName.indexOf(':');
    return colon >= 0 && treeIds.has(b.clsName.slice(0, colon).trim());
  });
  const otherBoxes = boxes.filter((b) => {
    const colon = b.clsName.indexOf(':');
    if (colon < 0) return true;
    return !treeIds.has(b.clsName.slice(0, colon).trim());
  });

  const treeCards: CardInstance[] = treeBoxes.map((b) => parseCardInstance(b, defById)).filter(Boolean) as CardInstance[];
  const cardInsts: CardInstance[] = otherBoxes.map((b) => parseCardInstance(b, defById)).filter(Boolean) as CardInstance[];

  const topByTree = new Map<Box, CardInstance[]>();
  const bottomByTree = new Map<Box, CardInstance[]>();
  const leftByTree = new Map<Box, CardInstance[]>();
  const rightByTree = new Map<Box, CardInstance[]>();

  const sideListFor = (tree: CardInstance, side: Side): CardInstance[] => {
    const map = side === 'top' ? topByTree : side === 'bottom' ? bottomByTree : side === 'left' ? leftByTree : rightByTree;
    let list = map.get(tree.box);
    if (!list) { list = []; map.set(tree.box, list); }
    return list;
  };

  // Phase 1: direct placement
  for (const card of cardInsts) {
    let best: PlacementCandidate | null = null;
    for (const tree of treeCards) {
      const cand = bestPlacementCandidate(card, tree);
      if (!cand) continue;
      if (!best || cand.dist < best.dist || (cand.dist === best.dist && cand.overlap > best.overlap)) {
        best = cand;
      }
    }
    if (best) sideListFor(best.tree, best.side).push(card);
  }

  // Phase 2: chain expansion for indirectly adjacent cards
  const directlyPlaced = new Set<CardInstance>([
    ...topByTree.values(), ...bottomByTree.values(),
    ...leftByTree.values(), ...rightByTree.values(),
  ].flat());
  const remaining = cardInsts.filter((c) => !directlyPlaced.has(c));

  for (const treeCard of treeCards) {
    const top = sideListFor(treeCard, 'top');
    const bottom = sideListFor(treeCard, 'bottom');
    const left = sideListFor(treeCard, 'left');
    const right = sideListFor(treeCard, 'right');
    expandSideChain(treeCard.box, 'top', top, remaining);
    expandSideChain(treeCard.box, 'bottom', bottom, remaining);
    expandSideChain(treeCard.box, 'left', left, remaining);
    expandSideChain(treeCard.box, 'right', right, remaining);
  }

  const trees: Tree[] = treeCards.map((tc) => ({
    card: tc,
    top: topByTree.get(tc.box) ?? [],
    left: leftByTree.get(tc.box) ?? [],
    right: rightByTree.get(tc.box) ?? [],
    bottom: bottomByTree.get(tc.box) ?? [],
  }));

  return { trees };
}

// ---------------------------------------------------------------------------
// Forest utilities
// ---------------------------------------------------------------------------

function allCardInstances(forest: Forest): CardInstance[] {
  const seen = new Set<CardInstance>();
  const result: CardInstance[] = [];
  for (const tree of forest.trees) {
    for (const c of [tree.card, ...tree.top, ...tree.left, ...tree.right, ...tree.bottom]) {
      if (!seen.has(c)) { seen.add(c); result.push(c); }
    }
  }
  return result;
}

function buildPlacementsByBox(forest: Forest): Map<Box, Placement> {
  const map = new Map<Box, Placement>();
  for (const tree of forest.trees) {
    if (!map.has(tree.card.box)) map.set(tree.card.box, { tree, side: null });
    for (const c of tree.top) if (!map.has(c.box)) map.set(c.box, { tree, side: 'top' });
    for (const c of tree.bottom) if (!map.has(c.box)) map.set(c.box, { tree, side: 'bottom' });
    for (const c of tree.left) if (!map.has(c.box)) map.set(c.box, { tree, side: 'left' });
    for (const c of tree.right) if (!map.has(c.box)) map.set(c.box, { tree, side: 'right' });
  }
  return map;
}

/** Sorts trees in visual reading order (row then left-to-right). */
function sortTreesVisually(trees: Tree[]): Tree[] {
  if (trees.length === 0) return trees;
  const avgH = trees.reduce((s, t) => s + t.card.box.h, 0) / trees.length;
  const thresh = Math.max(avgH / 2, ADJACENT_EPSILON);
  return [...trees].sort((a, b) => {
    if (Math.abs(a.card.box.y1 - b.card.box.y1) < thresh) return a.card.box.x1 - b.card.box.x1;
    return a.card.box.y1 - b.card.box.y1;
  });
}

/** Returns tree-to-index mapping for group name generation. */
function buildBoxToTreeIndex(forest: Forest): Map<Box, number> {
  const sortedTrees = sortTreesVisually(forest.trees);
  const map = new Map<Box, number>();
  sortedTrees.forEach((tree, idx) => {
    map.set(tree.card.box, idx);
    for (const c of [...tree.top, ...tree.left, ...tree.right, ...tree.bottom]) map.set(c.box, idx);
  });
  return map;
}

/**
 * Sorts all cards in UI display order:
 * trees in reading order, each followed by top/left/right/bottom attached cards.
 */
function sortCardsInUiOrder(forest: Forest): Box[] {
  const sorted: Box[] = [];
  const seen = new Set<Box>();

  const sortAttached = (tree: Tree, sideCards: CardInstance[], side: Side): CardInstance[] => {
    const treeBox = tree.card.box;
    const result = [...sideCards];
    result.sort((a, b) => {
      switch (side) {
        case 'top': return b.box.y2 !== a.box.y2 ? b.box.y2 - a.box.y2 : a.box.cx - b.box.cx;
        case 'bottom': return a.box.y1 !== b.box.y1 ? a.box.y1 - b.box.y1 : a.box.cx - b.box.cx;
        case 'left': return b.box.x2 !== a.box.x2 ? b.box.x2 - a.box.x2 : a.box.cy - b.box.cy;
        case 'right': return a.box.x1 !== b.box.x1 ? a.box.x1 - b.box.x1 : a.box.cy - b.box.cy;
        default: return 0;
      }
    });
    // filter to only cards geometrically on the correct side
    return result.filter((c) => {
      switch (side) {
        case 'top': return c.box.y2 <= treeBox.y1 + 1e-3;
        case 'bottom': return c.box.y1 >= treeBox.y2 - 1e-3;
        case 'left': return c.box.x2 <= treeBox.x1 + 1e-3;
        case 'right': return c.box.x1 >= treeBox.x2 - 1e-3;
        default: return true;
      }
    });
  };

  for (const tree of sortTreesVisually(forest.trees)) {
    if (seen.add(tree.card.box)) sorted.push(tree.card.box);
    for (const c of sortAttached(tree, tree.top, 'top')) if (!seen.has(c.box)) { seen.add(c.box); sorted.push(c.box); }
    for (const c of sortAttached(tree, tree.left, 'left')) if (!seen.has(c.box)) { seen.add(c.box); sorted.push(c.box); }
    for (const c of sortAttached(tree, tree.right, 'right')) if (!seen.has(c.box)) { seen.add(c.box); sorted.push(c.box); }
    for (const c of sortAttached(tree, tree.bottom, 'bottom')) if (!seen.has(c.box)) { seen.add(c.box); sorted.push(c.box); }
  }

  // Unattached cards at the end
  for (const tree of forest.trees) {
    for (const box of [tree.card.box, ...tree.top.map((c) => c.box), ...tree.left.map((c) => c.box),
    ...tree.right.map((c) => c.box), ...tree.bottom.map((c) => c.box)]) {
      if (!seen.has(box)) { seen.add(box); sorted.push(box); }
    }
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// Scoring logic
// ---------------------------------------------------------------------------

function isFullTree(tree: Tree): boolean {
  return tree.top.length > 0 && tree.left.length > 0 && tree.bottom.length > 0 && tree.right.length > 0;
}

function matchesAnyTag(inst: CardInstance, tags: string[]): boolean {
  const cardTags = inst.definition?.tags ?? [];
  return tags.some((t) => cardTags.includes(t));
}

function filterCards(
  self: CardInstance,
  candidates: CardInstance[],
  cond: ConditionJson,
): CardInstance[] {
  const ids = cond.name;
  const tags = cond.tags;
  const type = cond.type;
  const treeSymbol = cond.sameTreeSymbol ? self.treeSymbol : null;

  return candidates.filter((inst) => {
    if (type != null && inst.definition?.joker?.type === type) return true;
    const idOk = ids ? ids.includes(inst.id) : true;
    const tagsOk = tags ? matchesAnyTag(inst, tags) : true;
    const typeOk = type == null || type === inst.definition?.type;
    const symOk = treeSymbol == null || treeSymbol === inst.treeSymbol;
    return idOk && tagsOk && typeOk && symOk;
  });
}

type MostResolver = (self: CardInstance, cond: ConditionJson) => boolean;

function countMatches(
  self: CardInstance,
  cond: ConditionJson,
  all: CardInstance[],
  placementsByBox: Map<Box, Placement>,
  assumeMost: boolean,
  mostResolver: MostResolver | null,
): number {
  if (cond.most === true) {
    const ok = mostResolver ? mostResolver(self, cond) : assumeMost;
    if (!ok) return 0;
  }

  const placement = placementsByBox.get(self.box);

  if (cond.fullTree === true) {
    const tree = placement?.tree;
    return tree && isFullTree(tree) ? 1 : 0;
  }

  let pool: CardInstance[];

  if (cond.sameTree === true) {
    const tree = placement?.tree;
    if (!tree) return 0;
    const treeCards = [...tree.top, ...tree.bottom, ...tree.left, ...tree.right];
    pool = self === tree.card ? treeCards : [tree.card, ...treeCards];
  } else if (cond.sameSpot === true) {
    const tree = placement?.tree;
    const side = placement?.side;
    if (!tree || !side) return 0;
    pool = tree[side];
  } else if (cond.position?.includes('below')) {
    pool = all.filter((o) => o.box.y1 >= self.box.y2 && overlapH(o.box, self.box) > 0);
  } else {
    pool = all;
  }

  const matching = filterCards(self, pool, cond);

  // Table dedup: shared set across instances that self-reference by ID
  if (cond.unique === true && self.definition?.score?.type === 'table') {
    if (!self.set) {
      const set = new Set<string>();
      const sets: Set<string>[] = [set];
      self.set = set;
      for (const item of matching) {
        let s = sets.find((ss) => !ss.has(item.id));
        if (!s) { s = new Set<string>(); sets.push(s); }
        item.set = s;
        s.add(item.id);
      }
    }
    return self.set.size;
  }

  return cond.unique === true
    ? new Set(matching.filter((m) => !m.definition?.joker).map((m) => m.id)).size
    : matching.length;
}

function scoreTableIndex(points: number[], count: number): number {
  if (points.length === 0) return 0;
  return points[Math.max(0, Math.min(points.length - 1, count - 1))];
}

function pointsWord(n: number): string { return n === 1 ? 'Punkt' : 'Punkte'; }

function describeTarget(cond: ConditionJson): string {
  const ids = (cond.name ?? []).filter(Boolean);
  const tags = (cond.tags ?? []).filter(Boolean);
  if (ids.length > 0) return ids.join('/');
  if (tags.length > 0) return tags.join(' oder ');
  return 'Karten';
}

function describeScope(cond: ConditionJson): string {
  return cond.sameTree === true ? 'im selben Baum' : '';
}

function describeExtras(cond: ConditionJson): string {
  const parts: string[] = [];
  if (cond.unique === true) parts.push('einzigartig');
  if (cond.sameTreeSymbol === true) parts.push('gleiches Baum-Symbol');
  if (cond.fullTree === true) parts.push('voller Baum');
  if (cond.sameSpot === true) parts.push('gleicher Platz');
  if (cond.most === true) parts.push('meiste');
  if (cond.position?.length) parts.push(cond.position.join('/'));
  return parts.join(', ');
}

function scoreInstanceWithReason(
  instance: CardInstance,
  all: CardInstance[],
  placementsByBox: Map<Box, Placement>,
  assumeMost: boolean,
  mostResolver: MostResolver | null,
): [number, string] {
  const scoreRule = instance.definition?.score;
  if (!scoreRule) return [0, 'kein Effekt'];

  const cond = scoreRule.condition;
  const type = scoreRule.type.toLowerCase();

  if (type === 'fixed') {
    const amount = Array.isArray(scoreRule.amount) ? 0 : (scoreRule.amount ?? 0);
    if (!cond) return [amount, `${amount} feste ${pointsWord(amount)}`];

    const matches = countMatches(instance, cond, all, placementsByBox, assumeMost, mostResolver);
    const min = scoreRule.min;
    const satisfied = min != null ? matches >= min : matches > 0;
    const minText = min != null ? `mind. ${min}` : 'mind. 1';
    const extra = describeExtras(cond);
    const extraStr = extra ? ` (${extra})` : '';
    const scopeStr = describeScope(cond) ? ` ${describeScope(cond)}` : '';
    const target = describeTarget(cond);
    if (satisfied) {
      return [amount, `${amount} feste ${pointsWord(amount)} (${matches} Treffer, ${minText} ${target}${scopeStr}${extraStr})`];
    } else {
      return [0, `0 ${pointsWord(0)} (Bedingung nicht erfüllt: ${matches} Treffer, ${minText} ${target}${scopeStr}${extraStr})`];
    }
  }

  if (type === 'multiplication') {
    const amount = Array.isArray(scoreRule.amount) ? 0 : (scoreRule.amount ?? 0);
    if (!cond) return [0, '0 (keine Bedingung)'];

    const matches = countMatches(instance, cond, all, placementsByBox, assumeMost, mostResolver);
    const min = scoreRule.min;
    const effectiveMatches = (min != null && matches < min) ? 0 : matches;
    const pts = amount * effectiveMatches;
    const minText = min != null ? `mind. ${min}` : '';
    const extra = describeExtras(cond);
    const extraStr = extra ? ` (${extra})` : '';
    const scopeStr = describeScope(cond);
    const perText = `${amount} ${pointsWord(amount)} pro ${describeTarget(cond)}`;
    const detailsParts = [minText, scopeStr].filter(Boolean);
    const detailsStr = detailsParts.length > 0 ? ` (${detailsParts.join(', ')})` : '';
    return [pts, `${perText} · ${effectiveMatches}${detailsStr}${extraStr}`];
  }

  if (type === 'table') {
    const arr = Array.isArray(scoreRule.amount) ? (scoreRule.amount as number[]) : [];
    if (!cond) return [0, '0 (keine Bedingung)'];

    const matches = countMatches(instance, cond, all, placementsByBox, assumeMost, mostResolver);

    const pts = scoreTableIndex(arr, matches);
    const extra = describeExtras(cond);
    const extraStr = extra ? ` (${extra})` : '';
    const scopeStr = describeScope(cond) ? ` ${describeScope(cond)}` : '';
    return [pts, `Tabelle: ${matches} Treffer (${describeTarget(cond)}${scopeStr}${extraStr})`];
  }

  return [0, 'kein Effekt'];
}

// ---------------------------------------------------------------------------
// Cross-player "most" resolver
// ---------------------------------------------------------------------------

interface MostKey {
  ids: string;
  tags: string;
  unique: boolean;
  treeSymbol: string | null;
}

function makeMostKey(self: CardInstance, cond: ConditionJson): MostKey {
  const ids = (cond.name ?? []).filter(Boolean).sort().join(',');
  const tags = (cond.tags ?? []).filter(Boolean).sort().join(',');
  const unique = cond.unique === true;
  const treeSymbol = cond.sameTreeSymbol === true ? self.treeSymbol : null;
  return { ids, tags, unique, treeSymbol };
}

function mostKeyStr(k: MostKey): string {
  return `${k.ids}|${k.tags}|${k.unique}|${k.treeSymbol ?? ''}`;
}

function countForMostKey(key: MostKey, cards: CardInstance[], cond: ConditionJson): number {
  const filtered = cards.filter((inst) => {
    if (key.treeSymbol != null && inst.treeSymbol !== key.treeSymbol) return false;
    const idOk = key.ids ? key.ids.split(',').includes(inst.id) : true;
    const tagsOk = key.tags ? key.tags.split(',').some((t) => inst.definition?.tags.includes(t)) : true;
    const typeOk = cond.type == null || cond.type === inst.definition?.type;
    return idOk && tagsOk && typeOk;
  });
  return key.unique
    ? new Set(filtered.filter((m) => !m.definition?.joker).map((m) => m.id)).size
    : filtered.length;
}

// ---------------------------------------------------------------------------
// Public score function
// ---------------------------------------------------------------------------

export function score(players: PlayerInput[]): PlayerScoreResult[] {
  const cards = CARDS_JSON;

  // Phase 1: build forests
  interface PreparedPlayer {
    forest: Forest | null;
    all: CardInstance[];
  }

  const prepared: PreparedPlayer[] = players.map((p) => {
    if (p.cards.length === 0) return { forest: null, all: [] };
    // Convert DetectedCard → Box
    const boxes: Box[] = p.cards.map((dc) => ({
      x1: dc.x1, y1: dc.y1, x2: dc.x2, y2: dc.y2,
      cx: dc.cx, cy: dc.cy, w: dc.w, h: dc.h,
      clsName: dc.cardId,
    }));
    const forest = buildForest(boxes, cards);
    return { forest, all: allCardInstances(forest) };
  });

  // Phase 2: build cross-player "most" cache
  // Map from key-string → {max, winnerSet}
  const mostWinnerCache = new Map<string, { max: number; winners: Set<number> }>();
  const condByKeyStr = new Map<string, ConditionJson>();

  function getMostWinners(key: MostKey, cond: ConditionJson): { max: number; winners: Set<number> } {
    const ks = mostKeyStr(key);
    if (mostWinnerCache.has(ks)) return mostWinnerCache.get(ks)!;
    const counts = prepared.map((p) => countForMostKey(key, p.all, cond));
    const max = Math.max(0, ...counts);
    const winners = new Set<number>(
      max <= 0
        ? []
        : counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0),
    );
    mostWinnerCache.set(ks, { max, winners });
    condByKeyStr.set(ks, cond);
    return { max, winners };
  }

  // Phase 3: score each player
  return prepared.map((p, playerIndex) => {
    const playerName = players[playerIndex].name;
    const forest = p.forest;

    if (!forest || p.all.length === 0) {
      return { name: playerName, totalScore: 0, cardDetails: [] };
    }

    const mostResolver: MostResolver = (self, cond) => {
      if (cond.most !== true) return true;
      const key = makeMostKey(self, cond);
      return getMostWinners(key, cond).winners.has(playerIndex);
    };

    const placementsByBox = buildPlacementsByBox(forest);
    const all = p.all;

    // Score all instances first
    const scoreByBox = new Map<Box, [number, string]>();
    for (const inst of all) {
      const result = scoreInstanceWithReason(
        inst, all, placementsByBox, false, mostResolver,
      );
      scoreByBox.set(inst.box, result);
    }

    // Sort into UI order
    const sortedBoxes = sortCardsInUiOrder(forest);
    const instByBox = new Map<Box, CardInstance>(all.map((c) => [c.box, c]));
    const boxToTreeIdx = buildBoxToTreeIndex(forest);

    const cardDetails: CardScoreDetail[] = [];
    for (const box of sortedBoxes) {
      const inst = instByBox.get(box);
      if (!inst) continue;
      const [points, reason] = scoreByBox.get(box) ?? [0, ''];
      const treeIdx = boxToTreeIdx.get(box);
      const group = treeIdx != null ? `Baum ${treeIdx + 1}` : undefined;
      cardDetails.push({
        cardId: inst.box.clsName,
        points,
        reason,
        title: inst.id,
        group,
      });
    }

    const totalScore = cardDetails.reduce((s, d) => s + d.points, 0);
    return { name: playerName, totalScore, cardDetails };
  });
}
