// Night sky logic. Pure: no DOM, no audio, no timers, no Math.random.
//
// A dark sky with faint stars. Every touch opens a soft firework (the UI draws it with
// fx.sparkle). At density 2-3 faint stars also appear; touching near one lights it and a
// line joins it to the one before, so the picture fills in. When the picture is complete
// (or three fireworks have opened at density 1) the unit is done.
//   M (motor)   1 touch anywhere lights the nearest star; 2 touch near a star
//   R (rule)    1 no bonus; 2 BONUS: one star glows, lighting it gives a bit more
//   D (density) 1 fireworks only; 2 five stars; 3 seven stars
//
// Losing is impossible: a touch away from every star still opens a small firework, the
// nearest star pulses, and after two such touches it lights itself.

import { createBonusTally, judgeTouch, ruleResultForUnit, tallyTouch } from './bonus.js';
import { assistRadius, nearestTarget } from './input.js';
import { createLadder } from './levels.js';

export const NIGHT_LADDER = createLadder({
  storageKey: 'tabletGames.nightSky',
  dimensions: [
    { id: 'motor', max: 2 },
    { id: 'rule', max: 2 },
    { id: 'density', max: 3 },
  ],
});

export const FIREWORKS_PER_UNIT = 3;
export const STAR_FILL = 0.055;
export const STARS_TO_LIGHT_THEMSELVES = 2;
export const CLEAN_INSIDE_SHARE = 0.6;
export const HOLD_BIG_MS = 500;
export const MAX_FIREWORK_PARTICLES = 72;

export const FIREWORK_COLORS = Object.freeze([
  '#ffd43b',
  '#ff8fab',
  '#7fffd4',
  '#9ec5ff',
  '#ffa94d',
  '#c77dff',
  '#ffffff',
]);

export const FIREWORK_SHAPES = Object.freeze(['ring', 'willow', 'palm']);

const SHAPE_PROFILES = Object.freeze({
  ring: Object.freeze({
    speed: 210,
    lifeMs: 1500,
    gravity: 40,
    size: 1,
    arms: Object.freeze([Object.freeze({ angle: -Math.PI / 2, spread: Math.PI * 2 })]),
  }),
  willow: Object.freeze({
    speed: 145,
    lifeMs: 2300,
    gravity: 170,
    size: 1.15,
    arms: Object.freeze([Object.freeze({ angle: -Math.PI / 2, spread: Math.PI * 2 })]),
  }),
  palm: Object.freeze({
    speed: 235,
    lifeMs: 1400,
    gravity: 70,
    size: 0.9,
    arms: Object.freeze([
      Object.freeze({ angle: -Math.PI / 2 - 0.5, spread: Math.PI * 0.38 }),
      Object.freeze({ angle: -Math.PI / 2, spread: Math.PI * 0.38 }),
      Object.freeze({ angle: -Math.PI / 2 + 0.5, spread: Math.PI * 0.38 }),
    ]),
  }),
});

// Three pictures, each with seven stars; density 2 uses the first five. The stars are
// hand-placed fractions of the sky, all above the skyline.
export const PICTURES = Object.freeze([
  Object.freeze({
    id: 'boat',
    name: Object.freeze({ he: 'סירה', en: 'A boat' }),
    stars: Object.freeze([
      Object.freeze([0.30, 0.52]),
      Object.freeze([0.42, 0.52]),
      Object.freeze([0.42, 0.24]),
      Object.freeze([0.60, 0.40]),
      Object.freeze([0.42, 0.44]),
      Object.freeze([0.70, 0.52]),
      Object.freeze([0.50, 0.62]),
    ]),
  }),
  Object.freeze({
    id: 'heart',
    name: Object.freeze({ he: 'לב', en: 'A heart' }),
    stars: Object.freeze([
      Object.freeze([0.40, 0.18]),
      Object.freeze([0.30, 0.30]),
      Object.freeze([0.34, 0.46]),
      Object.freeze([0.50, 0.60]),
      Object.freeze([0.66, 0.46]),
      Object.freeze([0.70, 0.30]),
      Object.freeze([0.60, 0.18]),
    ]),
  }),
  Object.freeze({
    id: 'dove',
    name: Object.freeze({ he: 'יונה', en: 'A dove' }),
    stars: Object.freeze([
      Object.freeze([0.34, 0.34]),
      Object.freeze([0.46, 0.26]),
      Object.freeze([0.58, 0.30]),
      Object.freeze([0.70, 0.24]),
      Object.freeze([0.62, 0.40]),
      Object.freeze([0.48, 0.44]),
      Object.freeze([0.38, 0.48]),
    ]),
  }),
]);

export const PICTURE_PHRASES = Object.freeze({ boat: '121', heart: '122', dove: '123' });

function clampLevel(value, max) {
  const number = Math.round(Number(value) || 1);
  return Math.min(max, Math.max(1, number));
}

function pickIndex(length, rng) {
  return length > 0 ? Math.floor(rng() * length) % length : -1;
}

// One night scene. fx / fy are fractions of the board, so the logic never needs pixels.
export function createUnit({ densityLevel = 1, ruleLevel = 1, rng = Math.random } = {}) {
  const density = clampLevel(densityLevel, 3);
  const rule = clampLevel(ruleLevel, 2);
  const picture = PICTURES[pickIndex(PICTURES.length, rng)];
  const count = density === 1 ? 0 : density === 2 ? 5 : 7;
  const stars = picture.stars.slice(0, count).map(([fx, fy], index) => ({
    index,
    fx,
    fy,
    lit: false,
  }));

  return {
    densityLevel: density,
    ruleLevel: rule,
    pictureId: stars.length ? picture.id : null,
    stars,
    bonusIndex: stars.length && rule >= 2 ? pickIndex(stars.length, rng) : -1,
    litOrder: [],
    touches: 0,
    insideTouches: 0,
    missStreak: 0,
    autoLit: 0,
    fireworks: 0,
    requiredFireworks: FIREWORKS_PER_UNIT,
    tally: createBonusTally(),
  };
}

// The stars as touch targets for a board at (left, top) of the given size, in the same
// client pixels as the touch. Lit stars are not live.
export function layoutStars(unit, { left = 0, top = 0, width, height }) {
  const radius = STAR_FILL * Math.min(width, height);
  return unit.stars.map((star) => ({
    index: star.index,
    x: left + star.fx * width,
    y: top + star.fy * height,
    r: radius,
    live: !star.lit,
  }));
}

export function isDone(unit) {
  if (unit.stars.length === 0) return unit.fireworks >= unit.requiredFireworks;
  return unit.stars.every((star) => star.lit);
}

function lightStar(unit, index, { autoLit = false } = {}) {
  const stars = unit.stars.map((star) =>
    star.index === index ? { ...star, lit: true } : star,
  );
  const next = {
    ...unit,
    stars,
    litOrder: [...unit.litOrder, index],
    autoLit: unit.autoLit + (autoLit ? 1 : 0),
  };
  if (autoLit) next.missStreak = 0;
  return next;
}

// One accepted touch. Every touch returns firework: true (the UI always opens a soft
// firework). litIndex is the star that lit, or -1. selfLit means the nearest star lit
// itself because the last touches missed it twice (nothing is ever refused).
export function touchUnit(unit, points, touch, { motorLevel = 1, rng = Math.random } = {}) {
  const radius = points.length ? points[0].r : 0;
  const hit = nearestTarget(points, touch, assistRadius(motorLevel, radius));
  let next = {
    ...unit,
    touches: unit.touches + 1,
    insideTouches: unit.insideTouches + (hit.missDistance === 0 ? 1 : 0),
  };

  if (unit.stars.length === 0) {
    next.fireworks = unit.fireworks + 1;
    return {
      unit: next,
      litIndex: -1,
      nearestIndex: -1,
      bonus: false,
      selfLit: false,
      missDistance: hit.missDistance,
      firework: true,
    };
  }

  if (hit.nearest === null) {
    return {
      unit: next,
      litIndex: -1,
      nearestIndex: -1,
      bonus: false,
      selfLit: false,
      missDistance: null,
      firework: true,
    };
  }

  if (hit.target !== null) {
    const judged = judgeTouch({
      ruleLevel: unit.ruleLevel,
      onBonusTarget: hit.index === unit.bonusIndex,
    });
    next.tally = tallyTouch(unit.tally, judged);
    next.missStreak = 0;
    next = lightStar(next, hit.index);
    if (judged.bonus) {
      const unlit = next.stars.filter((star) => !star.lit);
      next.bonusIndex = unlit.length ? unlit[pickIndex(unlit.length, rng)].index : -1;
    }
    return {
      unit: next,
      litIndex: hit.index,
      nearestIndex: hit.nearestIndex,
      bonus: judged.bonus,
      selfLit: false,
      missDistance: hit.missDistance,
      firework: true,
    };
  }

  next.missStreak = unit.missStreak + 1;
  if (next.missStreak >= STARS_TO_LIGHT_THEMSELVES) {
    const unlit = next.stars.filter((star) => !star.lit);
    if (unlit.length === 0) {
      return {
        unit: next,
        litIndex: -1,
        nearestIndex: hit.nearestIndex,
        bonus: false,
        selfLit: false,
        missDistance: hit.missDistance,
        firework: true,
      };
    }
    const chosen = unlit[pickIndex(unlit.length, rng)];
    next = lightStar(next, chosen.index, { autoLit: true });
    return {
      unit: next,
      litIndex: chosen.index,
      nearestIndex: hit.nearestIndex,
      bonus: false,
      selfLit: true,
      missDistance: hit.missDistance,
      firework: true,
    };
  }

  return {
    unit: next,
    litIndex: -1,
    nearestIndex: hit.nearestIndex,
    bonus: false,
    selfLit: false,
    missDistance: hit.missDistance,
    firework: true,
  };
}

// The app finishing the unit by itself after a long idle: one star (or one firework at
// density 1) at a time, slowly. It counts nothing.
export function autoAdvance(unit) {
  if (isDone(unit)) return { unit, litIndex: -1, firework: false };
  if (unit.stars.length === 0) {
    return { unit: { ...unit, fireworks: unit.fireworks + 1 }, litIndex: -1, firework: true };
  }
  const star = unit.stars.find((entry) => !entry.lit);
  if (!star) return { unit, litIndex: -1, firework: false };
  return { unit: lightStar(unit, star.index, { autoLit: true }), litIndex: star.index, firework: false };
}

// What the finished unit says about each dimension, for onSuccess({ results }):
// true = clean, false = not clean, null = no information (idle never counts).
export function unitResults(unit) {
  if (unit.touches === 0) return { motor: null, rule: null, density: null };
  const rule = ruleResultForUnit(unit.tally);
  if (unit.stars.length === 0) {
    return { motor: null, rule, density: true };
  }
  const clean = unit.insideTouches / unit.touches >= CLEAN_INSIDE_SHARE;
  return {
    motor: clean,
    rule,
    density: unit.autoLit === 0,
  };
}

// The particle options for one soft firework: count, colours and size grow with the
// levels (and a longer hold at M2), and the shape varies between ring, willow and palm.
export function planFirework({
  motorLevel = 1,
  ruleLevel = 1,
  densityLevel = 1,
  holdMs = 0,
  shape,
  rng = Math.random,
} = {}) {
  const motor = clampLevel(motorLevel, 2);
  const rule = clampLevel(ruleLevel, 2);
  const density = clampLevel(densityLevel, 3);
  const chosen = FIREWORK_SHAPES.includes(shape)
    ? shape
    : FIREWORK_SHAPES[pickIndex(FIREWORK_SHAPES.length, rng)];
  const profile = SHAPE_PROFILES[chosen] || SHAPE_PROFILES.ring;
  const held = Number(holdMs) >= HOLD_BIG_MS && motor >= 2;

  const levelBoost = motor - 1 + (rule - 1) + (density - 1);
  const colours = FIREWORK_COLORS.slice(
    0,
    Math.min(FIREWORK_COLORS.length, 2 + levelBoost),
  );
  const count = Math.min(
    MAX_FIREWORK_PARTICLES,
    40 + 6 * (density - 1) + 4 * (motor - 1) + 4 * (rule - 1) + (held ? 12 : 0),
  );
  const size =
    4 + 0.6 * (density - 1) + 0.5 * (motor - 1) + 0.3 * (rule - 1) + (held ? 0.8 : 0);

  const arms = profile.arms;
  const each = Math.max(6, Math.round(count / arms.length));
  const bursts = arms.map((arm) => ({
    count: each,
    speed: profile.speed,
    lifeMs: profile.lifeMs,
    size: Number((size * profile.size).toFixed(2)),
    gravity: profile.gravity,
    spread: arm.spread,
    angle: arm.angle,
  }));

  return {
    shape: chosen,
    colors: colours,
    count,
    size: Number(size.toFixed(2)),
    bursts,
  };
}
