// Kaleidoscope logic. Pure: no DOM, no audio, no timers, no Math.random.
//
// A round sheet where every stroke is copied around the centre. The copies are made by
// rotations and mirror images, so a shaky finger leaves an ornament instead of a wobbly
// line. The unit is finished after a stretch of drawing (or after twelve stamps).
//   M (motor)  1 thick strokes (40 px), touch anywhere; 2 finer strokes (24 px)
//   R (rule)   1 free drawing (the minimum: no bonus)
//   D (density) not used in the minimum version
//
// Losing is impossible: there is no target, no score and no timer.

import { createLadder } from './levels.js';

export const KALEIDOSCOPE_LADDER = createLadder({
  storageKey: 'tabletGames.kaleidoscope',
  upStreak: 1,
  dimensions: [{ id: 'motor', max: 2 }],
});

export const SYMMETRY = 6;
export const MIRRORED = true;

// A tap is a stamp (a dot repeated around the sheet). Twelve stamps fill one picture, as
// in the spec; a dragged path adds its own length instead.
export const STAMP_DISTANCE = 0.75;
export const DRAW_GOAL = 9;

export const STROKE_WIDTHS = Object.freeze({ 1: 40, 2: 24 });
export const MIN_POINT_STEP = 0.006;
export const FADE_MS = 26000;
export const AUTO_STAMP_DISTANCE = STAMP_DISTANCE;

const TWO_PI = Math.PI * 2;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampNumber(value, min, max, fallback) {
  const number = finite(value);
  if (number === null) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampLevel(value, max) {
  const number = Math.round(Number(value) || 1);
  return Math.min(max, Math.max(1, number));
}

function isFinitePoint(point) {
  return point !== null && point !== undefined && finite(point.x) !== null && finite(point.y) !== null;
}

// One picture to draw on. fx / fy are kept nowhere: the UI converts its pixels with
// toUnitPoint(), so the logic only ever works in units of the sheet radius.
export function createUnit({ motorLevel = 1 } = {}) {
  const motor = clampLevel(motorLevel, 2);
  return {
    motorLevel: motor,
    symmetry: SYMMETRY,
    mirrored: MIRRORED,
    strokeWidth: STROKE_WIDTHS[motor],
    goal: DRAW_GOAL,
    distance: 0,
    touches: 0,
    stamps: 0,
    segments: 0,
    autoStamps: 0,
    lastPoint: null,
  };
}

export function isDone(unit) {
  if (!unit || !Number.isFinite(Number(unit.goal))) return false;
  return Number(unit.distance) >= Number(unit.goal);
}

export function progressOf(unit) {
  if (!unit || !Number.isFinite(Number(unit.goal)) || Number(unit.goal) <= 0) return 0;
  return Math.min(1, Math.max(0, Number(unit.distance) / Number(unit.goal)));
}

// Client pixels -> sheet units, where the centre is (0, 0) and one radius is 1.
export function toUnitPoint(point, rect = {}) {
  const x = finite(point?.x);
  const y = finite(point?.y);
  const left = finite(rect.left) ?? 0;
  const top = finite(rect.top) ?? 0;
  const width = finite(rect.width) ?? 0;
  const height = finite(rect.height) ?? 0;
  const radius = Math.min(width, height) / 2;
  if (x === null || y === null || radius <= 0) return { x: 0, y: 0 };
  return {
    x: (x - left - width / 2) / radius,
    y: (y - top - height / 2) / radius,
  };
}

export function clampToDisc(point, limit = 0.98) {
  const x = finite(point?.x) ?? 0;
  const y = finite(point?.y) ?? 0;
  const reach = Math.max(0.01, finite(limit) ?? 0.98);
  const distance = Math.hypot(x, y);
  if (distance <= reach || distance === 0) return { x, y };
  const scale = reach / distance;
  return { x: x * scale, y: y * scale };
}

// Exponential smoothing: the tremor is pulled towards a calm line. Passing no previous
// point starts the line exactly at the new point, so a stroke never jumps from nowhere.
export function smoothPoint(previous, next, factor = 0.42) {
  if (!isFinitePoint(next)) return isFinitePoint(previous) ? { x: previous.x, y: previous.y } : { x: 0, y: 0 };
  const target = { x: Number(next.x), y: Number(next.y) };
  if (!isFinitePoint(previous)) return target;
  const t = clampNumber(factor, 0, 1, 0.42);
  return {
    x: Number(previous.x) + (target.x - Number(previous.x)) * t,
    y: Number(previous.y) + (target.y - Number(previous.y)) * t,
  };
}

// Chaikin corner cutting, for smoothing a whole recorded path. Endpoints stay put, so a
// finished stroke begins and ends where the finger did.
export function smoothPath(points, { passes = 2, factor = 0.25 } = {}) {
  let current = Array.isArray(points) ? points.filter(isFinitePoint).map((point) => ({ x: Number(point.x), y: Number(point.y) })) : [];
  const rounds = Math.max(0, Math.round(clampNumber(passes, 0, 5, 2)));
  const t = clampNumber(factor, 0, 0.5, 0.25);
  for (let pass = 0; pass < rounds; pass += 1) {
    if (current.length < 3) break;
    const next = [{ ...current[0] }];
    for (let index = 0; index < current.length - 1; index += 1) {
      const a = current[index];
      const b = current[index + 1];
      next.push(
        { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        { x: b.x - (b.x - a.x) * t, y: b.y - (b.y - a.y) * t },
      );
    }
    next.push({ ...current[current.length - 1] });
    current = next;
  }
  return current;
}

// The rotations and reflections that make the mandala. Six rotations, each also reflected
// across its own axis: 6-fold symmetry with a mirrored twin for every arm.
export function symmetryTransforms({ arms = SYMMETRY, mirrored = MIRRORED } = {}) {
  const count = Math.round(clampNumber(arms, 1, 16, SYMMETRY));
  const transforms = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index * TWO_PI) / count;
    transforms.push({ angle, reflect: false });
    if (mirrored) transforms.push({ angle, reflect: true });
  }
  return transforms;
}

export function transformPoint(point, { angle = 0, reflect = false } = {}) {
  const x = finite(point?.x) ?? 0;
  const y = finite(point?.y) ?? 0;
  const localX = reflect ? -x : x;
  const cos = Math.cos(Number(angle) || 0);
  const sin = Math.sin(Number(angle) || 0);
  return {
    x: localX * cos - y * sin,
    y: localX * sin + y * cos,
  };
}

// Colour that marches along the stroke, and from one stroke to the next.
export function colourFor(strokeIndex = 0, pointIndex = 0, phase = 0) {
  const hue =
    (Number(strokeIndex) * 53 + Number(pointIndex) * 7 + Number(phase)) % 360;
  const wrapped = ((hue % 360) + 360) % 360;
  return `hsl(${Math.round(wrapped)} 88% 64%)`;
}

// Calm fade: full at birth, gone at lifeMs, slow at both ends (smoothstep).
export function fadeAlpha(ageMs, lifeMs = FADE_MS) {
  const life = Math.max(1, finite(lifeMs) ?? FADE_MS);
  const age = Math.max(0, finite(ageMs) ?? 0);
  const left = 1 - Math.min(1, age / life);
  return left * left * (3 - 2 * left);
}

// One accepted tap. It stamps a dot and counts the touch; nothing is ever refused.
export function stampUnit(unit, point) {
  const at = clampToDisc(point);
  const base = unit || createUnit();
  const distance = Math.min(Number(base.goal), Number(base.distance) + STAMP_DISTANCE);
  const next = {
    ...base,
    distance,
    touches: Number(base.touches) + 1,
    stamps: Number(base.stamps) + 1,
    lastPoint: at,
  };
  return { unit: next, stamp: at, done: isDone(next) };
}

// One piece of a rub or drag, already in sheet units. Pieces shorter than minStep are
// ignored so a still finger does not pile up zero-length points.
export function segmentUnit(unit, segment, { minStep = MIN_POINT_STEP } = {}) {
  const base = unit || createUnit();
  const from = clampToDisc({ x: segment?.x0, y: segment?.y0 });
  const to = clampToDisc({ x: segment?.x1, y: segment?.y1 });
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const minimum = Math.max(0, finite(minStep) ?? MIN_POINT_STEP);
  if (!Number.isFinite(length) || length < minimum) {
    return { unit: base, from, to, added: 0, drew: false, done: isDone(base) };
  }
  const added = Math.min(Number(base.goal) - Number(base.distance), length);
  const next = {
    ...base,
    distance: Number(base.distance) + Math.max(0, added),
    segments: Number(base.segments) + 1,
    lastPoint: to,
  };
  return { unit: next, from, to, added: Math.max(0, added), drew: true, done: isDone(next) };
}

// The app finishing the picture by itself after a long idle: a slow spiral of stamps,
// counted apart from his touches.
export function autoStamp(unit) {
  const base = unit || createUnit();
  if (isDone(base)) return { unit: base, stamp: null, done: true };
  const index = Number(base.autoStamps) || 0;
  const angle = index * 2.399963229728653;
  const radius = 0.16 + (index % 5) * 0.13;
  const at = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  const next = {
    ...base,
    distance: Math.min(Number(base.goal), Number(base.distance) + AUTO_STAMP_DISTANCE),
    stamps: Number(base.stamps) + 1,
    autoStamps: index + 1,
    lastPoint: at,
  };
  return { unit: next, stamp: at, done: isDone(next) };
}

// What the finished picture says about each dimension. A picture made only by the idle
// timer says nothing about him; stamps and dragged strokes both count as drawing.
export function unitResults(unit) {
  if (!unit) return { motor: null };
  const drew = Number(unit.touches) > 0 || Number(unit.segments) > 0;
  return { motor: drew ? true : null };
}
