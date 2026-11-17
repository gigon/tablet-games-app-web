// The window logic. Pure: no DOM, no audio, no timers, no Math.random without an rng.
//
// A fogged window. A touch clears a soft disc; rubbing clears a path. The scene behind
// the fog is one of three built-in views: a sunny garden, a snowy village or the sea.
//   M (motor)    1 touch anywhere clears a large disc; 2 touch clears a smaller disc and
//                rubbing clears a 140 px path
//   R (rule)     1 no rule (the minimum)
//
// Coverage is measured on a coarse grid, so the UI can answer "how much is clear?"
// without reading pixels back from its canvas.

import { createLadder } from './levels.js';

export const WINDOW_LADDER = createLadder({
  storageKey: 'tabletGames.window',
  dimensions: [
    { id: 'motor', max: 2 },
    { id: 'rule', max: 1 },
  ],
});

// Share of the window that must be clear before the rest melts away.
export const REVEAL_TARGET = 0.7;

// The coverage grid is deliberately coarse: one snapshot per cell is enough, and it
// keeps the logic cheap on an old tablet.
export const COVERAGE_COLS = 20;
export const COVERAGE_ROWS = 14;

// Eraser width per motor level, straight from the spec: M1 clears a 200 px disc, M2
// rubs a 140 px wide path (the touch itself is a smaller wipe).
export const TAP_WIDTHS = Object.freeze([200, 90]);
export const RUB_WIDTHS = Object.freeze([200, 140]);

export const AUTO_RADIUS_CELLS = 3;

export const SCENES = Object.freeze([
  Object.freeze({
    id: 'sunny-garden',
    kind: 'garden',
    phraseId: '91',
    palette: Object.freeze({
      skyTop: '#65cfff',
      skyBottom: '#e8fbff',
      sun: '#ffd447',
      sunRay: '#ffe680',
      cloud: '#ffffff',
      hillBack: '#6ecb72',
      hillFront: '#3da45a',
      stem: '#2f7d46',
      petalA: '#ff8fab',
      petalB: '#ffd447',
      petalC: '#ffffff',
      flowerCenter: '#8a4b1f',
      bird: '#2c5a3a',
    }),
  }),
  Object.freeze({
    id: 'snowy-village',
    kind: 'village',
    phraseId: '92',
    palette: Object.freeze({
      skyTop: '#26356f',
      skyBottom: '#8fa5df',
      moon: '#fff3b0',
      star: '#ffffff',
      hillBack: '#cfe3f5',
      hillFront: '#eef7ff',
      house: '#9a6650',
      house2: '#7b5246',
      roof: '#f4f9ff',
      roof2: '#d9e7f5',
      window: '#ffcf6b',
      tree: '#2f5a45',
      snow: '#ffffff',
    }),
  }),
  Object.freeze({
    id: 'seaside',
    kind: 'seaside',
    phraseId: '93',
    palette: Object.freeze({
      skyTop: '#ff9a5b',
      skyMid: '#ffd39a',
      skyBottom: '#ffd9c2',
      sun: '#fff1a8',
      seaBack: '#3d8fc6',
      seaFront: '#1f5f96',
      foam: '#d9f4ff',
      sand: '#f2d38a',
      boat: '#7a4a32',
      sail: '#ffffff',
      sail2: '#ff8fab',
      gull: '#4a3b3b',
    }),
  }),
]);

function clampLevel(value, max) {
  const number = Math.round(Number(value) || 1);
  return Math.min(max, Math.max(1, number));
}

// Radius of the cleared disc for this motor level and this gesture.
export function brushRadius(motorLevel, { rub = false } = {}) {
  const widths = rub ? RUB_WIDTHS : TAP_WIDTHS;
  const level = clampLevel(motorLevel, widths.length);
  return widths[level - 1] / 2;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normaliseBounds(bounds) {
  const left = finite(bounds?.left);
  const top = finite(bounds?.top);
  const width = finite(bounds?.width);
  const height = finite(bounds?.height);
  if (left === null || top === null || width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

function coverageOf(unit) {
  return unit.total > 0 ? unit.cleared / unit.total : 0;
}

function sceneIndexFor(value) {
  const index = Math.round(Number(value));
  if (!Number.isFinite(index)) return null;
  return ((index % SCENES.length) + SCENES.length) % SCENES.length;
}

// One window. sceneIndex may be given by the UI so the three views take turns; otherwise
// the rng chooses one. The coverage grid starts fully fogged.
export function createUnit({ motorLevel = 1, rng = Math.random, sceneIndex = null } = {}) {
  const total = COVERAGE_COLS * COVERAGE_ROWS;
  const forced = sceneIndex === null || sceneIndex === undefined ? null : sceneIndexFor(sceneIndex);
  const random = typeof rng === 'function' ? Number(rng()) : Math.random();
  const index =
    forced === null
      ? Math.min(SCENES.length - 1, Math.max(0, Math.floor((Number.isFinite(random) ? random : 0) * SCENES.length)))
      : forced;

  return {
    sceneIndex: index,
    scene: SCENES[index],
    cols: COVERAGE_COLS,
    rows: COVERAGE_ROWS,
    total,
    cells: new Array(total).fill(false),
    cleared: 0,
    motorLevel: clampLevel(motorLevel, WINDOW_LADDER.dimensions[0].max),
    touches: 0,
    rubs: 0,
    autoSteps: 0,
  };
}

function cellCentre(unit, bounds, index) {
  const col = index % unit.cols;
  const row = Math.floor(index / unit.cols);
  return {
    x: bounds.left + ((col + 0.5) / unit.cols) * bounds.width,
    y: bounds.top + ((row + 0.5) / unit.rows) * bounds.height,
  };
}

function markCells(unit, predicate) {
  const cells = unit.cells.slice();
  const clearedCells = [];
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]) continue;
    if (!predicate(index)) continue;
    cells[index] = true;
    clearedCells.push(index);
  }
  if (clearedCells.length === 0) return { unit, clearedCells };
  return {
    unit: { ...unit, cells, cleared: unit.cleared + clearedCells.length },
    clearedCells,
  };
}

function outcome(unit, clearedCells) {
  return {
    unit,
    clearedCells,
    newlyCleared: clearedCells.length,
    coverage: coverageOf(unit),
  };
}

// One touch: clear a disc of `radius` around point. Point and bounds are client pixels.
export function revealAt(unit, point, bounds, { radius = TAP_WIDTHS[0] / 2 } = {}) {
  const area = normaliseBounds(bounds);
  const x = finite(point?.x);
  const y = finite(point?.y);
  const r = Math.max(0, finite(radius) ?? 0);
  if (!area || x === null || y === null) return outcome(unit, []);

  const { unit: next, clearedCells } = markCells(unit, (index) => {
    const centre = cellCentre(unit, area, index);
    return Math.hypot(centre.x - x, centre.y - y) <= r;
  });
  return outcome({ ...next, touches: unit.touches + 1 }, clearedCells);
}

function distanceToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - x0, py - y0);
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lengthSquared));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

// One piece of a rub: clear every cell within `radius` of the finger's path.
export function revealSegment(unit, segment, bounds, { radius = RUB_WIDTHS[0] / 2 } = {}) {
  const area = normaliseBounds(bounds);
  const x0 = finite(segment?.x0);
  const y0 = finite(segment?.y0);
  const x1 = finite(segment?.x1);
  const y1 = finite(segment?.y1);
  const r = Math.max(0, finite(radius) ?? 0);
  if (!area || x0 === null || y0 === null || x1 === null || y1 === null) {
    return outcome(unit, []);
  }

  const { unit: next, clearedCells } = markCells(unit, (index) => {
    const centre = cellCentre(unit, area, index);
    return distanceToSegment(centre.x, centre.y, x0, y0, x1, y1) <= r;
  });
  return outcome({ ...next, rubs: unit.rubs + 1 }, clearedCells);
}

// The app opening the window for him after a long idle: clears one small patch without
// counting any touch. Picks an uncleared cell with the rng (pure in tests).
export function autoReveal(unit, { rng = Math.random, radiusCells = AUTO_RADIUS_CELLS } = {}) {
  const uncleared = [];
  for (let index = 0; index < unit.cells.length; index += 1) {
    if (!unit.cells[index]) uncleared.push(index);
  }
  if (uncleared.length === 0) {
    return { unit, cellIndex: -1, clearedCells: [], newlyCleared: 0, coverage: coverageOf(unit), fx: 0.5, fy: 0.5 };
  }

  const random = typeof rng === 'function' ? Number(rng()) : Math.random();
  const pick = uncleared[Math.floor((Number.isFinite(random) ? Math.max(0, random) : 0) * uncleared.length) % uncleared.length];
  const col = pick % unit.cols;
  const row = Math.floor(pick / unit.cols);
  const reach = Math.max(0, Math.round(finite(radiusCells) ?? AUTO_RADIUS_CELLS));

  const cells = unit.cells.slice();
  const clearedCells = [];
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]) continue;
    const cellCol = index % unit.cols;
    const cellRow = Math.floor(index / unit.cols);
    if (Math.hypot(cellCol - col, cellRow - row) > reach) continue;
    cells[index] = true;
    clearedCells.push(index);
  }

  const next = {
    ...unit,
    cells,
    cleared: unit.cleared + clearedCells.length,
    autoSteps: unit.autoSteps + 1,
  };
  return {
    unit: next,
    cellIndex: pick,
    clearedCells,
    newlyCleared: clearedCells.length,
    coverage: coverageOf(next),
    fx: (col + 0.5) / unit.cols,
    fy: (row + 0.5) / unit.rows,
    radiusCells: reach,
  };
}

export function coverage(unit) {
  return coverageOf(unit);
}

export function isDone(unit, target = REVEAL_TARGET) {
  const goal = Math.min(1, Math.max(0, finite(target) ?? REVEAL_TARGET));
  return coverageOf(unit) >= goal;
}

// What the finished window says about each dimension:
// true = clean, false = not clean, null = no information (idle never counts).
export function unitResults(unit) {
  if (unit.touches === 0 && unit.rubs === 0) return { motor: null, rule: null };
  return { motor: true, rule: null };
}
