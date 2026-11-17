// Bubble sheet logic. Pure: no DOM, no audio, no timers, no Math.random.
//
// A sheet of round bubbles. A touch pops one, and the sheet is finished when all are
// popped. The motor ladder decides how close the touch must be; at M4 a finger dragged
// across the sheet pops every bubble it crosses.
//   M (motor)    1 touch anywhere pops the nearest bubble; 2 touch near; 3 touch inside;
//                4 slide across
//   R (rule)     1 any bubble (the minimum: no bonus)
//   D (density)  1: 2x2, 2: 3x3, 3: 4x3

import { assistRadius, nearestTarget } from './input.js';
import { createLadder } from './levels.js';

export const BUBBLE_LADDER = createLadder({
  storageKey: 'tabletGames.bubbleSheet',
  upStreak: 1,
  dimensions: [
    { id: 'motor', max: 4 },
    { id: 'rule', max: 1 },
    { id: 'density', max: 3 },
  ],
});

export const GRIDS = Object.freeze([
  Object.freeze({ cols: 2, rows: 2 }),
  Object.freeze({ cols: 3, rows: 3 }),
  Object.freeze({ cols: 4, rows: 3 }),
]);

// How much of the shorter cell side a bubble takes up. Just under half, so bubbles are
// big and nearly touch without overlapping.
export const BUBBLE_FILL = 0.44;

// How far a sliding finger may pass from a bubble's edge and still pop it.
export const SLIDE_PAD_PX = 10;

// Share of touches that must land inside a bubble for the unit to count as clean for the
// motor dimension. Measured at every motor level, including M1 where nothing is refused.
export const CLEAN_INSIDE_SHARE = 0.75;

function clampLevel(value, max) {
  const number = Math.round(Number(value) || 1);
  return Math.min(max, Math.max(1, number));
}

// One sheet. fx / fy are the bubble centre as a fraction of the sheet, so the logic never
// needs pixel sizes.
export function createUnit({ densityLevel = 1 } = {}) {
  const grid = GRIDS[clampLevel(densityLevel, GRIDS.length) - 1];
  const bubbles = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      bubbles.push({
        index: bubbles.length,
        fx: (col + 0.5) / grid.cols,
        fy: (row + 0.5) / grid.rows,
        popped: false,
      });
    }
  }
  return {
    cols: grid.cols,
    rows: grid.rows,
    bubbles,
    touches: 0,
    insideTouches: 0,
  };
}

// The bubbles as touch targets for a sheet at (left, top) of the given size, in the same
// client pixels as the touch. Popped bubbles are not live.
export function layoutBubbles(unit, { left = 0, top = 0, width, height }) {
  const radius = BUBBLE_FILL * Math.min(width / unit.cols, height / unit.rows);
  return unit.bubbles.map((bubble) => ({
    index: bubble.index,
    x: left + bubble.fx * width,
    y: top + bubble.fy * height,
    r: radius,
    live: !bubble.popped,
  }));
}

export function isDone(unit) {
  return unit.bubbles.every((bubble) => bubble.popped);
}

function popBubble(bubble) {
  return { ...bubble, popped: true };
}

// One accepted tap. Returns the next unit plus what the UI should show:
//   poppedIndex   the bubble that popped, or -1 when the tap was out of reach of any
//                 bubble (the UI still pokes, and makes nearestIndex wink: nothing is
//                 refused)
//   nearestIndex  the nearest live bubble even when it was out of reach
//   missDistance  px outside the nearest bubble's edge (0 = inside it)
export function touchUnit(unit, points, touch, { motorLevel = 1 } = {}) {
  const radius = points.length ? points[0].r : 0;
  const hit = nearestTarget(points, touch, assistRadius(motorLevel, radius));
  if (hit.nearest === null) {
    return { unit, poppedIndex: -1, nearestIndex: -1, missDistance: null };
  }

  const next = {
    ...unit,
    touches: unit.touches + 1,
    insideTouches: unit.insideTouches + (hit.missDistance === 0 ? 1 : 0),
  };
  if (hit.target === null) {
    return { unit: next, poppedIndex: -1, nearestIndex: hit.nearestIndex, missDistance: hit.missDistance };
  }

  next.bubbles = unit.bubbles.map((bubble) =>
    bubble.index === hit.index ? popBubble(bubble) : bubble,
  );

  return {
    unit: next,
    poppedIndex: hit.index,
    nearestIndex: hit.nearestIndex,
    missDistance: hit.missDistance,
  };
}

function distanceToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - x0, py - y0);
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lengthSquared));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

// One piece of a slide (M4). Pops every live bubble the segment crosses.
// Returns { unit, poppedIndices } with the bubbles ordered along the finger's path.
export function slideUnit(unit, points, segment, { motorLevel = 4 } = {}) {
  if (Math.round(Number(motorLevel) || 1) < 4) return { unit, poppedIndices: [] };

  const x0 = Number(segment?.x0);
  const y0 = Number(segment?.y0);
  const x1 = Number(segment?.x1);
  const y1 = Number(segment?.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return { unit, poppedIndices: [] };

  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;

  const crossed = [];
  for (const point of points) {
    if (!point || point.live === false) continue;
    const edge = Math.max(0, Number(point.r) || 0) + SLIDE_PAD_PX;
    if (distanceToSegment(point.x, point.y, x0, y0, x1, y1) > edge) continue;
    const along =
      lengthSquared === 0
        ? 0
        : ((point.x - x0) * dx + (point.y - y0) * dy) / lengthSquared;
    crossed.push({ index: point.index, along });
  }
  if (crossed.length === 0) return { unit, poppedIndices: [] };

  crossed.sort((a, b) => a.along - b.along);
  const poppedIndices = crossed.map((entry) => entry.index);
  const popped = new Set(poppedIndices);

  return {
    unit: {
      ...unit,
      bubbles: unit.bubbles.map((bubble) =>
        popped.has(bubble.index) ? popBubble(bubble) : bubble,
      ),
      // Each crossed bubble is one inside touch, so a slide is clean for motor.
      touches: unit.touches + poppedIndices.length,
      insideTouches: unit.insideTouches + poppedIndices.length,
    },
    poppedIndices,
  };
}

// The app finishing the sheet for him (after a long idle): pops one bubble, counts
// nothing.
export function autoPop(unit) {
  const bubble = unit.bubbles.find((entry) => !entry.popped);
  if (!bubble) return { unit, poppedIndex: -1 };
  return {
    unit: {
      ...unit,
      bubbles: unit.bubbles.map((entry) =>
        entry.index === bubble.index ? popBubble(entry) : entry,
      ),
    },
    poppedIndex: bubble.index,
  };
}

// What the finished sheet says about each dimension, for onSuccess({ results }):
// true = clean, false = not clean, null = no information (idle never counts).
export function unitResults(unit) {
  if (unit.touches === 0) return { motor: null, rule: null, density: null };
  const clean = unit.insideTouches / unit.touches >= CLEAN_INSIDE_SHARE;
  return {
    motor: clean,
    rule: null,
    density: clean,
  };
}
