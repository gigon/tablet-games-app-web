// Pottery wheel logic. Pure: no DOM, no audio, no timers, no Math.random.
//
// A lump of clay turns on a wheel. A side view, so the pot is a symmetric profile of
// BAND_COUNT radii. Touching the clay shapes the band at that height: at M1 the app walks
// the profile toward a nice vase on every touch, at M2+ the band moves toward the finger
// (in or out), and at M3 a drag along the side reshapes every band it passes.
//
// After enough touches the clay is ready to be fired, then glazed from a few big colour
// pots, and put on the shelf. Nothing can collapse: every radius is clamped.
//   M (motor)    1 touch anywhere, the app shapes one step toward a vase; 2 touch at a
//                height widens or narrows there toward the finger; 3 drag in and out
//   R (rule)     1 free shaping (the minimum: no rule)
//
// Dimensions: motor 1-3, rule 1.

import { createLadder } from './levels.js';

export const POTTERY_LADDER = createLadder({
  storageKey: 'tabletGames.potteryWheel',
  upStreak: 1,
  dimensions: [
    { id: 'motor', max: 3 },
    { id: 'rule', max: 1 },
  ],
});

export const BAND_COUNT = 10;

// A calm vase: a little foot, a wide belly and a narrow neck. Index 0 is the bottom band,
// the last index is the rim.
export const TARGET_PROFILE = Object.freeze([
  0.52, 0.68, 0.84, 0.94, 0.96, 0.9, 0.76, 0.58, 0.44, 0.4,
]);

// The starting lump: low and round, with almost no neck yet.
export const START_PROFILE = Object.freeze([
  0.62, 0.7, 0.68, 0.6, 0.5, 0.4, 0.3, 0.24, 0.2, 0.18,
]);

export const MIN_RADIUS = 0.18;
export const MAX_RADIUS = 1;

// At M1 the profile closes this share of the remaining distance to the vase per touch, so
// six touches leave it visibly vase-like and the seventh barely moves it. At M2+ one
// touch moves the touched band by TOUCH_STEP.
export const M1_EASE = 0.34;
export const TOUCH_STEP = 0.22;
export const DRAG_STEP = 0.14;

export const TOUCHES_TO_FINISH_M1 = 6;
export const TOUCHES_TO_FINISH_HIGH = 8;

export const CLAY_COLOURS = Object.freeze([
  Object.freeze({ id: 'terracotta', base: '#b96a45', light: '#e6a27c', dark: '#6f341d' }),
  Object.freeze({ id: 'sand', base: '#c6a76c', light: '#efd9a6', dark: '#7d5f31' }),
  Object.freeze({ id: 'slate', base: '#8b8f9c', light: '#cfd3dd', dark: '#4c505b' }),
]);

export const GLAZE_COLOURS = Object.freeze([
  Object.freeze({ id: 'azure', base: '#3f8fd8', light: '#9fd3ff', dark: '#1c4e85', phrase: '25' }),
  Object.freeze({ id: 'moss', base: '#4aa06a', light: '#a7e6b8', dark: '#22603a', phrase: '26' }),
  Object.freeze({ id: 'honey', base: '#d9a23a', light: '#ffe08a', dark: '#8a5f16', phrase: '24' }),
]);

// Bands of glaze, as fractions of the pot height from the foot (0) to the rim (1).
export const GLAZE_BANDS = Object.freeze([
  Object.freeze({ from: 0.1, to: 0.28 }),
  Object.freeze({ from: 0.39, to: 0.55 }),
  Object.freeze({ from: 0.66, to: 0.82 }),
]);

export const SHELF_LIMIT = 12;
export const CLEAN_INSIDE_SHARE = 0.75;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function level(value, max) {
  const number = Math.round(Number(value) || 1);
  return Math.min(max, Math.max(1, number));
}

function colourIndex(value, count) {
  const number = Math.round(Number(value) || 0);
  return ((number % count) + count) % count;
}

function approach(value, target, step) {
  if (value < target) return Math.min(target, value + step);
  return Math.max(target, value - step);
}

function eased(value, target, fraction) {
  return value + (target - value) * fraction;
}

// One fresh lump. motorLevel only sets how many touches the wheel asks for; the clay is
// the same calm shape at every level.
export function createPot({ motorLevel = 1, clayIndex = 0 } = {}) {
  const motor = level(motorLevel, 3);
  return {
    motorLevel: motor,
    bandCount: BAND_COUNT,
    radii: [...START_PROFILE],
    phase: 'shaping',
    touches: 0,
    insideTouches: 0,
    touchesToFinish: motor <= 1 ? TOUCHES_TO_FINISH_M1 : TOUCHES_TO_FINISH_HIGH,
    fireReady: false,
    clayIndex: colourIndex(clayIndex, CLAY_COLOURS.length),
    glazeIndex: -1,
  };
}

// The profile bands as touch targets in client pixels. `rect` is the whole drawn pot.
// A band's r is half a band tall, so the nearest target is mostly a vertical choice.
export function layoutBands(pot, { left = 0, top = 0, width = 0, height = 0 } = {}) {
  const count = pot.bandCount || BAND_COUNT;
  const bandHeight = height / count;
  const axis = left + width / 2;
  return pot.radii.map((radius, index) => ({
    index,
    x: axis,
    y: top + height - (index + 0.5) * bandHeight,
    r: Math.max(8, bandHeight / 2),
    radius,
    live: pot.phase === 'shaping',
  }));
}

// Which band a point is at. Above the rim is the rim; below the foot is the foot, so a
// touch far from the pot still nudges the nearest part. Pure and total.
export function bandAtPoint(point, { top = 0, height = 0 } = {}) {
  const y = Number(point?.y);
  if (!Number.isFinite(y) || !(height > 0)) return -1;
  const fromBottom = (top + height - y) / height;
  return clamp(Math.floor(fromBottom * BAND_COUNT), 0, BAND_COUNT - 1);
}

// The radius the finger is asking for: its horizontal distance from the axis. The finger
// far out asks for a wide band; a finger close to the axis asks for a narrow one.
export function radiusAtPoint(point, { left = 0, width = 0 } = {}) {
  const x = Number(point?.x);
  if (!Number.isFinite(x) || !(width > 0)) return MIN_RADIUS;
  const axis = left + width / 2;
  return clamp(Math.abs(x - axis) / (width / 2), MIN_RADIUS, MAX_RADIUS);
}

function isInside(point, pot, rect) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (y < rect.top || y > rect.top + rect.height) return false;
  const index = bandAtPoint(point, rect);
  if (index < 0) return false;
  const axis = rect.left + rect.width / 2;
  const edge = pot.radii[index] * (rect.width / 2);
  return Math.abs(x - axis) <= edge;
}

function shapeTowardsVase(pot) {
  return pot.radii.map((radius, index) => eased(radius, TARGET_PROFILE[index], M1_EASE));
}

function shapeBand(pot, index, desired, step) {
  if (index < 0) return pot.radii;
  const next = pot.radii.slice();
  next[index] = clamp(approach(next[index], desired, step), MIN_RADIUS, MAX_RADIUS);
  const soft = step / 2;
  if (index > 0) next[index - 1] = clamp(approach(next[index - 1], desired, soft), MIN_RADIUS, MAX_RADIUS);
  if (index < next.length - 1) {
    next[index + 1] = clamp(approach(next[index + 1], desired, soft), MIN_RADIUS, MAX_RADIUS);
  }
  return next;
}

// One accepted touch on the clay while shaping. Never refuses and never collapses the pot.
// Returns { pot, bandIndex, shaped, inside, readyToFire }.
export function touchPot(pot, point, rect, { motorLevel = pot.motorLevel } = {}) {
  if (!pot || pot.phase !== 'shaping') {
    return { pot, bandIndex: -1, shaped: false, inside: false, readyToFire: false };
  }
  const motor = level(motorLevel, 3);
  const index = bandAtPoint(point, rect);
  const inside = isInside(point, pot, rect);

  let radii;
  if (motor <= 1) {
    radii = shapeTowardsVase(pot);
  } else {
    const desired = radiusAtPoint(point, rect);
    radii = shapeBand(pot, index, desired, TOUCH_STEP);
  }

  const touches = pot.touches + 1;
  const next = {
    ...pot,
    radii,
    touches,
    insideTouches: pot.insideTouches + (inside ? 1 : 0),
    fireReady: touches >= pot.touchesToFinish,
  };

  return {
    pot: next,
    bandIndex: index,
    shaped: true,
    inside,
    readyToFire: next.fireReady,
  };
}

// One piece of a rub / drag along the side (M3). Reshapes the bands under both ends of the
// segment. A drag is shaping, not another touch: it never counts toward the unit results.
export function stretchPot(pot, segment, rect, { motorLevel = pot.motorLevel } = {}) {
  if (!pot || pot.phase !== 'shaping' || level(motorLevel, 3) < 3) {
    return { pot, bandIndices: [], shaped: false };
  }
  const x0 = Number(segment?.x0);
  const y0 = Number(segment?.y0);
  const x1 = Number(segment?.x1);
  const y1 = Number(segment?.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) {
    return { pot, bandIndices: [], shaped: false };
  }

  // Walk the stroke in small steps so every band it crosses moves, and the last point in
  // a band is the one that shapes it.
  const byBand = new Map();
  const stepSize = Math.max(1, rect.height / BAND_COUNT / 2);
  const steps = Math.min(BAND_COUNT * 2, Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / stepSize)));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const point = { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
    const index = bandAtPoint(point, rect);
    if (index < 0) continue;
    byBand.set(index, point);
  }
  if (byBand.size === 0) return { pot, bandIndices: [], shaped: false };

  let radii = pot.radii.slice();
  for (const [index, point] of byBand) {
    radii = shapeBand({ ...pot, radii }, index, radiusAtPoint(point, rect), DRAG_STEP);
  }
  const bandIndices = [...byBand.keys()];
  return { pot: { ...pot, radii }, bandIndices, shaped: true };
}

// Fire the pot. Allowed while shaping; the glow that follows is the UI's job.
export function firePot(pot) {
  if (!pot || pot.phase !== 'shaping') return pot;
  return { ...pot, phase: 'fired', fireReady: false };
}

// Glaze the fired pot from a colour pot. The bands are fixed calm stripes.
export function glazePot(pot, glazeIndex = 0) {
  if (!pot || pot.phase !== 'fired') return pot;
  return {
    ...pot,
    phase: 'glazed',
    glazeIndex: colourIndex(glazeIndex, GLAZE_COLOURS.length),
    glazeBands: GLAZE_BANDS.map((band) => ({ ...band })),
  };
}

export function isDone(pot) {
  return Boolean(pot) && pot.phase === 'glazed';
}

// A small snapshot for the shelf strip, keeping only the last SHELF_LIMIT pots.
export function shelfWithPot(shelf, pot, limit = SHELF_LIMIT) {
  const list = Array.isArray(shelf) ? shelf.slice() : [];
  if (pot) {
    list.push({
      radii: pot.radii.map((radius) => Number(radius.toFixed(3))),
      clayIndex: colourIndex(pot.clayIndex, CLAY_COLOURS.length),
      glazeIndex: pot.glazeIndex >= 0 ? colourIndex(pot.glazeIndex, GLAZE_COLOURS.length) : -1,
    });
  }
  const keep = Math.max(1, Math.round(Number(limit) || SHELF_LIMIT));
  return list.length > keep ? list.slice(list.length - keep) : list;
}

// What the finished pot says about each dimension, for onSuccess({ results }):
// true = clean, false = not clean, null = no information (idle never counts).
export function unitResults(pot) {
  if (!pot || pot.touches === 0) return { motor: null, rule: null };
  const clean = pot.insideTouches / pot.touches >= CLEAN_INSIDE_SHARE;
  return { motor: clean, rule: null };
}

export function clayColourAt(index) {
  return CLAY_COLOURS[colourIndex(index, CLAY_COLOURS.length)];
}

export function glazeColourAt(index) {
  return GLAZE_COLOURS[colourIndex(index, GLAZE_COLOURS.length)];
}
