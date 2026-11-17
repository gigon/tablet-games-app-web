// Stained glass logic. Pure: no DOM, no audio, no timers, no Math.random without an rng.
//
// A picture is a handful of large glass cells. A touch fills one; when every cell is in,
// the window is lit and the fill order can be replayed.
//   M (motor)    1 touch anywhere fills the nearest empty cell; 2 touch near; 3 touch inside
//   R (rule)     1 any cell (the minimum: no bonus); 2 one cell glows, filling it gives more
//
// The pictures are data only: polygons in a 1000 x 1000 design box and one saturated colour
// per cell. Empty cells are drawn dark and faint by the UI; the logic knows nothing about it.

import { createBonusTally, judgeTouch, ruleResultForUnit, tallyTouch } from './bonus.js';
import { assistRadius, nearestTarget } from './input.js';
import { createLadder } from './levels.js';

export const STAINED_LADDER = createLadder({
  storageKey: 'tabletGames.stainedGlass',
  dimensions: [
    { id: 'motor', max: 3 },
    { id: 'rule', max: 2 },
  ],
});

export const DESIGN_SIZE = 1000;

// Share of touches that must land inside a cell for the unit to count as clean for the
// motor dimension. Measured at every motor level, including M1 where nothing is refused.
export const CLEAN_INSIDE_SHARE = 0.75;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function polar(cx, cy, radius, degrees) {
  const radians = (degrees * Math.PI) / 180;
  return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)];
}

// A cell is a closed polygon in design pixels, with its centroid and a circular touch
// radius that fits inside the cell's bounding box.
function makeCell(id, color, points) {
  const frozenPoints = Object.freeze(points.map(([x, y]) => Object.freeze([round2(x), round2(y)])));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of frozenPoints) {
    sumX += x;
    sumY += y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const count = frozenPoints.length;
  return Object.freeze({
    id,
    color,
    points: frozenPoints,
    cx: round2(sumX / count),
    cy: round2(sumY / count),
    r: round2(0.45 * Math.min(maxX - minX, maxY - minY)),
  });
}

function makePicture(id, phraseId, cells) {
  return Object.freeze({ id, phraseId, cells: Object.freeze(cells) });
}

// --- flower: five petals around a gold heart ---------------------------------------
const FLOWER_ANGLES = Object.freeze([-90, -18, 54, 126, 198]);
const FLOWER_COLOURS = Object.freeze(['#ff6b9d', '#ff9ec2', '#ffb347', '#e85d75', '#b06bff']);

const FLOWER = makePicture(
  'flower',
  '161',
  [
    ...FLOWER_ANGLES.map((angle, index) =>
      makeCell(`petal-${index}`, FLOWER_COLOURS[index], [
        polar(500, 500, 150, angle - 24),
        polar(500, 500, 430, angle - 32),
        polar(500, 500, 480, angle),
        polar(500, 500, 430, angle + 32),
        polar(500, 500, 150, angle + 24),
      ]),
    ),
    makeCell(
      'heart',
      '#ffd43b',
      Array.from({ length: 6 }, (_, index) => polar(500, 500, 155, index * 60)),
    ),
  ],
);

// --- boat: two sails, a mast, a hull, two water panels and the sun -----------------
const BOAT = makePicture('boat', '162', [
  makeCell('main-sail', '#ffe08a', [[380, 160], [380, 600], [120, 600]]),
  makeCell('small-sail', '#ff9ec2', [[620, 240], [620, 600], [860, 600]]),
  makeCell('mast', '#c89b5a', [[380, 120], [620, 120], [620, 620], [380, 620]]),
  makeCell('hull-left', '#c0392b', [[120, 620], [500, 620], [440, 780], [100, 780]]),
  makeCell('hull-right', '#e05a3a', [[500, 620], [880, 620], [900, 780], [560, 780]]),
  makeCell('water-left', '#3a8dde', [[0, 780], [500, 780], [500, 1000], [0, 1000]]),
  makeCell('water-right', '#57b0f0', [[500, 780], [1000, 780], [1000, 1000], [500, 1000]]),
  makeCell(
    'sun',
    '#ffd43b',
    Array.from({ length: 8 }, (_, index) => polar(850, 130, 120, index * 45 + 22.5)),
  ),
]);

// --- sun: six broad rays around a warm disc ---------------------------------------
const SUN_ANGLES = Object.freeze([-90, -30, 30, 90, 150, 210]);
const SUN_COLOURS = Object.freeze(['#ffd43b', '#ff9f1c', '#ffd43b', '#ff9f1c', '#ffd43b', '#ff9f1c']);

const SUN = makePicture(
  'sun',
  '163',
  [
    ...SUN_ANGLES.map((angle, index) =>
      makeCell(`ray-${index}`, SUN_COLOURS[index], [
        polar(500, 500, 190, angle - 13),
        polar(500, 500, 470, angle - 14),
        polar(500, 500, 470, angle + 14),
        polar(500, 500, 190, angle + 13),
      ]),
    ),
    makeCell(
      'disc',
      '#ffb347',
      Array.from({ length: 8 }, (_, index) => polar(500, 500, 200, index * 45)),
    ),
  ],
);

// The built-in pictures. A later pack can add more of the same shape without touching the
// logic: id, phrase id for the finished picture, and cell polygons.
export const PICTURES = Object.freeze([FLOWER, BOAT, SUN]);
export const PICTURE_COUNT = PICTURES.length;

function clampLevel(value, max) {
  const number = Math.round(Number(value) || 1);
  return Math.min(max, Math.max(1, number));
}

function clampPictureIndex(value) {
  const number = Math.round(Number(value) || 0);
  return Math.min(PICTURES.length - 1, Math.max(0, number));
}

function pickEmpty(cells, rng) {
  const empty = cells.filter((cell) => !cell.filled);
  if (empty.length === 0) return -1;
  const random = typeof rng === 'function' ? rng : Math.random;
  return empty[Math.floor(random() * empty.length) % empty.length].index;
}

// One window. cx / cy / r are already in design pixels, so the logic never needs the
// screen size until layoutCells() maps them to the real window.
export function createUnit({ pictureIndex = 0, ruleLevel = 1, rng = Math.random } = {}) {
  const index = clampPictureIndex(pictureIndex);
  const picture = PICTURES[index];
  const rule = clampLevel(ruleLevel, 2);
  const cells = picture.cells.map((cell, cellIndex) => ({
    index: cellIndex,
    id: cell.id,
    color: cell.color,
    points: cell.points,
    cx: cell.cx,
    cy: cell.cy,
    r: cell.r,
    filled: false,
  }));
  return {
    picture,
    pictureIndex: index,
    ruleLevel: rule,
    cells,
    fillOrder: [],
    touches: 0,
    insideTouches: 0,
    tally: createBonusTally(),
    bonusIndex: rule >= 2 ? pickEmpty(cells, rng) : -1,
  };
}

// The letterboxed square the SVG actually paints inside a board rectangle, matching the
// default preserveAspectRatio="xMidYMid meet".
export function contentBox({ left = 0, top = 0, width = 0, height = 0 } = {}) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  const scale = Math.min(w, h) / DESIGN_SIZE;
  return {
    left: (Number(left) || 0) + (w - scale * DESIGN_SIZE) / 2,
    top: (Number(top) || 0) + (h - scale * DESIGN_SIZE) / 2,
    scale,
  };
}

// The cells as touch targets for a window at (left, top) of the given size, in the same
// client pixels as the touch. Filled cells are not live.
export function layoutCells(unit, rect) {
  const box = contentBox(rect);
  return unit.cells.map((cell) => ({
    index: cell.index,
    x: box.left + cell.cx * box.scale,
    y: box.top + cell.cy * box.scale,
    r: cell.r * box.scale,
    live: !cell.filled,
  }));
}

export function isDone(unit) {
  return unit.cells.every((cell) => cell.filled);
}

// One accepted touch. Returns the next unit plus what the UI should show:
//   filledIndex   the cell that filled, or -1 when the touch was out of reach of any cell
//                 (the UI still pokes, and makes nearestIndex wink: nothing is refused)
//   bonus         true when the glowing bonus cell was filled: give a bit more
//   missDistance  px outside the nearest cell's touch circle (0 = inside it)
export function touchUnit(unit, points, touch, { motorLevel = 1, rng = Math.random } = {}) {
  const hit = nearestTarget(points, touch, (point) => assistRadius(motorLevel, point.r));
  if (hit.nearest === null) {
    return { unit, filledIndex: -1, nearestIndex: -1, bonus: false, missDistance: null };
  }

  const next = {
    ...unit,
    touches: unit.touches + 1,
    insideTouches: unit.insideTouches + (hit.missDistance === 0 ? 1 : 0),
  };
  if (hit.target === null) {
    return {
      unit: next,
      filledIndex: -1,
      nearestIndex: hit.nearestIndex,
      bonus: false,
      missDistance: hit.missDistance,
    };
  }

  const judged = judgeTouch({
    ruleLevel: unit.ruleLevel,
    onBonusTarget: hit.index === unit.bonusIndex,
  });
  next.tally = tallyTouch(unit.tally, judged);
  next.cells = unit.cells.map((cell) =>
    cell.index === hit.index ? { ...cell, filled: true } : cell,
  );
  next.fillOrder = [...unit.fillOrder, hit.index];
  // The bonus moves on once it is taken; filling another cell leaves it where it is.
  if (judged.bonus) next.bonusIndex = pickEmpty(next.cells, rng);

  return {
    unit: next,
    filledIndex: hit.index,
    nearestIndex: hit.nearestIndex,
    bonus: judged.bonus,
    missDistance: hit.missDistance,
  };
}

// The app finishing the window for him (after a long idle): fills one cell, counts nothing.
export function autoFill(unit) {
  const cell = unit.cells.find((entry) => !entry.filled);
  if (!cell) return { unit, filledIndex: -1 };
  return {
    unit: {
      ...unit,
      cells: unit.cells.map((entry) =>
        entry.index === cell.index ? { ...entry, filled: true } : entry,
      ),
      fillOrder: [...unit.fillOrder, cell.index],
      bonusIndex: unit.bonusIndex === cell.index ? -1 : unit.bonusIndex,
    },
    filledIndex: cell.index,
  };
}

// What the finished window says about each dimension, for onSuccess({ results }):
// true = clean, false = not clean, null = no information (idle never counts).
export function unitResults(unit) {
  if (unit.touches === 0) return { motor: null, rule: null };
  const clean = unit.insideTouches / unit.touches >= CLEAN_INSIDE_SHARE;
  return {
    motor: clean,
    rule: ruleResultForUnit(unit.tally),
  };
}
