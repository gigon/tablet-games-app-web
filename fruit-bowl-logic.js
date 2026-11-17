// Fruit bowl logic. Pure: no DOM, no audio, no timers, no Math.random.
//
// A grid bowl. A touch drops the next fruit into the nearest empty cell. Two equal
// four-way neighbours merge into the next fruit in the chain, and a chain can cascade.
// The bowl can never overflow: when it is full the app quietly merges a pair itself, or
// clears the smallest fruits if there is no pair. A unit ends after enough merges.
//   M (motor)   1 touch anywhere (auto-aim at a matching fruit); 2 drop at the touch
//   R (rule)    1 any drop; 2 BONUS: the matching fruit glows, a merging drop sparkles
//   D (density) 1: 4x4, 3 kinds; 2: 5x4, 4 kinds; 3: 5x5, 5 kinds
//
// Nothing is ever refused: a touch always drops or rescues, even at the edge of the stage.

import { createBonusTally, judgeTouch, ruleResultForUnit, tallyTouch } from './bonus.js';
import { nearestTarget } from './input.js';
import { createLadder } from './levels.js';

export const FRUIT_LADDER = createLadder({
  storageKey: 'tabletGames.fruitBowl',
  upStreak: 1,
  dimensions: [
    { id: 'motor', max: 2 },
    { id: 'rule', max: 2 },
    { id: 'density', max: 3 },
  ],
});

// The merge chain, smallest first. The last fruit is carried off on a plate: merging two
// of them (or anything into one) frees the cells again.
export const CHAIN = Object.freeze([
  Object.freeze({ id: 'cherry', emoji: '🍒', phrase: '117', color: '#ff5d73' }),
  Object.freeze({ id: 'strawberry', emoji: '🍓', phrase: '116', color: '#ff4d6d' }),
  Object.freeze({ id: 'orange', emoji: '🍊', phrase: '112', color: '#ffa94d' }),
  Object.freeze({ id: 'apple', emoji: '🍎', phrase: '113', color: '#ff6b6b' }),
  Object.freeze({ id: 'melon', emoji: '🍈', phrase: '114', color: '#a9e36b' }),
  Object.freeze({ id: 'watermelon', emoji: '🍉', phrase: '111', color: '#ff7aa2' }),
]);

export const TOP_KIND = CHAIN.length - 1;

export const GRIDS = Object.freeze([
  Object.freeze({ cols: 4, rows: 4, spawnKinds: 3 }),
  Object.freeze({ cols: 5, rows: 4, spawnKinds: 4 }),
  Object.freeze({ cols: 5, rows: 5, spawnKinds: 5 }),
]);

export const MERGE_TARGETS = Object.freeze([6, 8, 10]);

// How much of the shorter cell side a fruit body takes up.
export const CELL_FILL = 0.46;

// Share of drops that must land inside an empty cell for the unit to count as clean for
// the motor dimension (measured at every level, including M1 where nothing is refused).
export const CLEAN_INSIDE_SHARE = 0.75;

function clampLevel(value, max) {
  const number = Math.round(Number(value) || 1);
  return Math.min(max, Math.max(1, number));
}

function pickKind(spawnKinds, rng) {
  const count = Math.max(1, Math.round(Number(spawnKinds) || 1));
  const value = Number(rng());
  const fraction = Number.isFinite(value) ? value : 0;
  return Math.floor(fraction * count) % count;
}

export function isFull(unit) {
  return unit.cells.every((kind) => kind !== null);
}

export function isDone(unit) {
  return unit.merges >= unit.mergesTarget;
}

// One bowl of play. The two seed cherries and the matching next fruit make the very first
// touch a merge, so level 1 starts out working.
export function createUnit({ densityLevel = 1, ruleLevel = 1 } = {}) {
  const density = clampLevel(densityLevel, GRIDS.length);
  const grid = GRIDS[density - 1];
  const rule = clampLevel(ruleLevel, 2);
  const cells = new Array(grid.cols * grid.rows).fill(null);
  const bottom = (grid.rows - 1) * grid.cols;
  cells[bottom] = 0;
  cells[bottom + grid.cols - 1] = 0;
  return {
    densityLevel: density,
    ruleLevel: rule,
    cols: grid.cols,
    rows: grid.rows,
    spawnKinds: grid.spawnKinds,
    cells,
    nextKind: 0,
    merges: 0,
    mergesTarget: MERGE_TARGETS[density - 1],
    served: 0,
    rescues: 0,
    lastRescue: null,
    touches: 0,
    insideTouches: 0,
    tally: createBonusTally(),
  };
}

export function cellRow(unit, index) {
  return Math.floor(index / unit.cols);
}

export function cellCol(unit, index) {
  return index % unit.cols;
}

// The cells as touch targets for a grid at (left, top) of the given size, in client
// pixels. Only empty cells are live, because a fruit is already there.
export function layoutCells(unit, { left = 0, top = 0, width = 0, height = 0 }) {
  const radius = CELL_FILL * Math.min(width / unit.cols, height / unit.rows);
  return unit.cells.map((kind, index) => {
    const row = cellRow(unit, index);
    const col = cellCol(unit, index);
    return {
      index,
      row,
      col,
      kind,
      x: left + ((col + 0.5) / unit.cols) * width,
      y: top + ((row + 0.5) / unit.rows) * height,
      r: Math.max(0, radius),
      live: kind === null,
    };
  });
}

export function neighbourIndices(unit, index) {
  const row = cellRow(unit, index);
  const col = cellCol(unit, index);
  const result = [];
  if (row > 0) result.push(index - unit.cols);
  if (col > 0) result.push(index - 1);
  if (col < unit.cols - 1) result.push(index + 1);
  if (row < unit.rows - 1) result.push(index + unit.cols);
  return result;
}

// True when a fruit of `kind` dropped at `index` would touch an equal fruit.
export function canMergeAt(unit, index, kind) {
  if (index < 0 || unit.cells[index] !== null) return false;
  return neighbourIndices(unit, index).some((next) => unit.cells[next] === kind);
}

// Empty cells where the next fruit would merge. Used by the M1 auto-aim and the R2 glow.
export function matchingEmptyIndices(unit, kind = unit.nextKind) {
  const indices = [];
  unit.cells.forEach((cellKind, index) => {
    if (cellKind === null && canMergeAt(unit, index, kind)) indices.push(index);
  });
  return indices;
}

// Fruit cells of the next kind: what glows at rule level 2.
export function matchingFruitIndices(unit, kind = unit.nextKind) {
  const indices = [];
  unit.cells.forEach((cellKind, index) => {
    if (cellKind === kind) indices.push(index);
  });
  return indices;
}

function nearestIndex(indices, points, touch) {
  let best = -1;
  let bestDistance = Infinity;
  for (const index of indices) {
    const point = points[index];
    if (!point) continue;
    const distance = Math.hypot(point.x - touch.x, point.y - touch.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function chooseEmptyIndex(unit, points, touch, motorLevel) {
  const empty = [];
  points.forEach((point) => {
    if (point.live) empty.push(point.index);
  });
  if (empty.length === 0) return -1;

  if (Math.round(Number(motorLevel) || 1) <= 1) {
    const matching = matchingEmptyIndices(unit, unit.nextKind);
    if (matching.length) return nearestIndex(matching, points, touch);
  }
  return nearestIndex(empty, points, touch);
}

// A merge chain starting at `index`, which holds `kind`. Each step joins one equal
// four-way neighbour; the merged fruit moves up the chain. The top merge is served: the
// cell becomes empty, which is how the bowl always has room again.
function resolveMerges(unit, cells, index, kind) {
  const merges = [];
  let served = 0;
  let currentKind = kind;
  let guard = 0;

  while (currentKind !== null && guard < unit.cells.length) {
    guard += 1;
    const partnerIndex = neighbourIndices(unit, index).find(
      (next) => cells[next] === currentKind,
    );
    if (partnerIndex === undefined) break;

    const toKind = currentKind + 1;
    if (toKind >= TOP_KIND) {
      cells[index] = null;
      cells[partnerIndex] = null;
      merges.push({
        index,
        partnerIndex,
        fromKind: currentKind,
        toKind: TOP_KIND,
        chain: merges.length,
        served: true,
      });
      served += 1;
      currentKind = null;
    } else {
      cells[index] = toKind;
      cells[partnerIndex] = null;
      merges.push({
        index,
        partnerIndex,
        fromKind: currentKind,
        toKind,
        chain: merges.length,
        served: false,
      });
      currentKind = toKind;
    }
  }

  return { cells, merges, served };
}

function findAdjacentEqualPair(unit) {
  for (let index = 0; index < unit.cells.length; index += 1) {
    const kind = unit.cells[index];
    if (kind === null) continue;
    const partnerIndex = neighbourIndices(unit, index).find(
      (next) => next > index && unit.cells[next] === kind,
    );
    if (partnerIndex !== undefined) return { index, partnerIndex, kind };
  }
  return null;
}

function findSmallestKind(cells) {
  let smallest = Infinity;
  for (const kind of cells) {
    if (kind !== null) smallest = Math.min(smallest, kind);
  }
  return smallest === Infinity ? null : smallest;
}

// The quiet rescue when the bowl is full. A merge pair is used if there is one; otherwise
// every fruit of the smallest kind is lifted out. Never a failure, always a little show.
export function rescueUnit(unit) {
  const empty = {
    unit,
    rescued: false,
    rescueKind: null,
    merges: [],
    clearedIndices: [],
    served: 0,
  };
  if (!isFull(unit)) return empty;

  const pair = findAdjacentEqualPair(unit);
  if (pair) {
    const resolved = resolveMerges(unit, unit.cells.slice(), pair.index, pair.kind);
    return {
      unit: {
        ...unit,
        cells: resolved.cells,
        merges: unit.merges + resolved.merges.length,
        served: unit.served + resolved.served,
        rescues: unit.rescues + 1,
        lastRescue: 'merge',
      },
      rescued: true,
      rescueKind: 'merge',
      merges: resolved.merges,
      clearedIndices: [],
      served: resolved.served,
    };
  }

  const smallest = findSmallestKind(unit.cells);
  if (smallest === null) return empty;
  const clearedIndices = [];
  const cells = unit.cells.map((kind, index) => {
    if (kind !== smallest) return kind;
    clearedIndices.push(index);
    return null;
  });
  return {
    unit: {
      ...unit,
      cells,
      rescues: unit.rescues + 1,
      lastRescue: 'clear',
    },
    rescued: true,
    rescueKind: 'clear',
    merges: [],
    clearedIndices,
    served: 0,
  };
}

// One accepted touch. The next fruit drops into the nearest empty cell (M1 first looks
// for a cell that would merge). Returns the next unit plus the events the UI animates.
export function touchUnit(unit, points, touch, { motorLevel = 1, rng = Math.random } = {}) {
  const level = Math.round(Number(motorLevel) || 1);
  const x = Number(touch?.x);
  const y = Number(touch?.y);
  const point = { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };

  if (isFull(unit)) {
    const rescue = rescueUnit(unit);
    return {
      ...rescue,
      unit: {
        ...rescue.unit,
        touches: unit.touches + 1,
        insideTouches: unit.insideTouches + 1,
      },
      droppedIndex: -1,
      droppedKind: null,
      bonus: false,
      nearestIndex: -1,
      missDistance: null,
      nextKind: unit.nextKind,
    };
  }

  const hit = nearestTarget(points, point, Infinity);
  const chosen = chooseEmptyIndex(unit, points, point, level);
  if (chosen < 0) {
    return {
      unit: { ...unit, touches: unit.touches + 1 },
      rescued: false,
      rescueKind: null,
      merges: [],
      clearedIndices: [],
      served: 0,
      droppedIndex: -1,
      droppedKind: null,
      bonus: false,
      nearestIndex: hit.nearestIndex,
      missDistance: hit.missDistance,
      nextKind: unit.nextKind,
    };
  }

  const droppedKind = unit.nextKind;
  const onBonusTarget = unit.ruleLevel >= 2 && canMergeAt(unit, chosen, droppedKind);
  const judged = judgeTouch({ ruleLevel: unit.ruleLevel, onBonusTarget });
  const tally = tallyTouch(unit.tally, judged);

  const cells = unit.cells.slice();
  cells[chosen] = droppedKind;
  const resolved = resolveMerges(unit, cells, chosen, droppedKind);

  let next = {
    ...unit,
    cells: resolved.cells,
    merges: unit.merges + resolved.merges.length,
    served: unit.served + resolved.served,
    nextKind: pickKind(unit.spawnKinds, rng),
    touches: unit.touches + 1,
    insideTouches: unit.insideTouches + (hit.missDistance === 0 ? 1 : 0),
    tally,
  };

  // A drop that fills the bowl is rescued at once, so the bowl never sits stuck full.
  let rescue = null;
  if (isFull(next) && !isDone(next)) {
    const quiet = rescueUnit(next);
    if (quiet.rescued) {
      rescue = quiet;
      next = quiet.unit;
    }
  }

  return {
    unit: next,
    rescued: Boolean(rescue),
    rescueKind: rescue ? rescue.rescueKind : null,
    autoRescue: Boolean(rescue),
    merges: rescue ? [...resolved.merges, ...rescue.merges] : resolved.merges,
    clearedIndices: rescue ? rescue.clearedIndices : [],
    served: resolved.served + (rescue ? rescue.served : 0),
    droppedIndex: chosen,
    droppedKind,
    bonus: judged.bonus,
    nearestIndex: hit.nearestIndex,
    missDistance: hit.missDistance,
    nextKind: next.nextKind,
  };
}

// The app keeping the bowl alive after a long idle: one quiet drop (aimed at a merge) or
// one rescue at a time. It adds no touches, so idle never pushes a level up.
export function autoStep(unit, { rng = Math.random } = {}) {
  if (isFull(unit)) {
    return {
      ...rescueUnit(unit),
      droppedIndex: -1,
      droppedKind: null,
      bonus: false,
      nextKind: unit.nextKind,
    };
  }

  const matching = matchingEmptyIndices(unit, unit.nextKind);
  const empty = [];
  unit.cells.forEach((kind, index) => {
    if (kind === null) empty.push(index);
  });
  const chosen = matching.length ? matching[0] : empty[0];
  if (chosen === undefined) {
    return {
      ...rescueUnit(unit),
      droppedIndex: -1,
      droppedKind: null,
      bonus: false,
      nextKind: unit.nextKind,
    };
  }

  const droppedKind = unit.nextKind;
  const cells = unit.cells.slice();
  cells[chosen] = droppedKind;
  const resolved = resolveMerges(unit, cells, chosen, droppedKind);
  let next = {
    ...unit,
    cells: resolved.cells,
    merges: unit.merges + resolved.merges.length,
    served: unit.served + resolved.served,
    nextKind: pickKind(unit.spawnKinds, rng),
  };

  let rescue = null;
  if (isFull(next) && !isDone(next)) {
    const quiet = rescueUnit(next);
    if (quiet.rescued) {
      rescue = quiet;
      next = quiet.unit;
    }
  }

  return {
    unit: next,
    rescued: Boolean(rescue),
    rescueKind: rescue ? rescue.rescueKind : null,
    autoRescue: Boolean(rescue),
    merges: rescue ? [...resolved.merges, ...rescue.merges] : resolved.merges,
    clearedIndices: rescue ? rescue.clearedIndices : [],
    served: resolved.served + (rescue ? rescue.served : 0),
    droppedIndex: chosen,
    droppedKind,
    bonus: false,
    nextKind: next.nextKind,
  };
}

// What the finished unit says about each dimension, for onSuccess({ results }):
// true = clean, false = not clean, null = no information (idle never counts).
export function unitResults(unit) {
  if (unit.touches === 0) return { motor: null, rule: null, density: null };
  const clean = unit.insideTouches / unit.touches >= CLEAN_INSIDE_SHARE;
  return {
    motor: clean,
    rule: ruleResultForUnit(unit.tally),
    density: clean,
  };
}
