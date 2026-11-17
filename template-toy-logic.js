// TEMPLATE: copy this file to <game>-logic.js. NOT registered, not part of the app.
//
// The logic module is pure: no DOM, no audio, no timers, no Math.random without an rng
// parameter. Everything here is unit-tested first (test/template-toy-logic.test.js),
// and only then is the UI written.
//
// The toy: a grid of dots. A touch lights a dot. When all are lit, the unit is done.
//   M (motor)    1 touch anywhere lights the nearest dot; 2 touch near a dot; 3 touch inside
//   R (rule)     1 any dot; 2 BONUS: one dot glows, lighting it earns a bit more
//   D (density)  1: 2x2 dots, 2: 3x2, 3: 4x3

import { createBonusTally, judgeTouch, ruleResultForUnit, tallyTouch } from './bonus.js';
import { assistRadius, nearestTarget } from './input.js';
import { createLadder } from './levels.js';

// The ladder gives the game its saved level state: load, save, defaults, adaptation.
// Storage keys are 'tabletGames.<type>'. Never reuse another game's key.
export const TEMPLATE_LADDER = createLadder({
  storageKey: 'tabletGames.templateToy',
  dimensions: [
    { id: 'motor', max: 3 },
    { id: 'rule', max: 2 },
    { id: 'density', max: 3 },
  ],
});

export const GRIDS = Object.freeze([
  Object.freeze({ cols: 2, rows: 2 }),
  Object.freeze({ cols: 3, rows: 2 }),
  Object.freeze({ cols: 4, rows: 3 }),
]);

// Share of touches that must land inside a dot for the unit to count as "clean" for the
// motor dimension. Measured at every motor level, including M1 where nothing is refused.
export const CLEAN_INSIDE_SHARE = 0.75;

function clampLevel(value, max) {
  const number = Math.round(Number(value) || 1);
  return Math.min(max, Math.max(1, number));
}

function pickUnlit(dots, rng) {
  const unlit = dots.filter((dot) => !dot.lit);
  if (unlit.length === 0) return -1;
  return unlit[Math.floor(rng() * unlit.length) % unlit.length].index;
}

// One unit of play (one grid to fill). fx / fy are the dot centre as a fraction of the
// board, so the logic never needs pixel sizes.
export function createUnit({ densityLevel = 1, ruleLevel = 1, rng = Math.random } = {}) {
  const grid = GRIDS[clampLevel(densityLevel, GRIDS.length) - 1];
  const dots = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      dots.push({
        index: dots.length,
        fx: (col + 0.5) / grid.cols,
        fy: (row + 0.5) / grid.rows,
        lit: false,
      });
    }
  }
  const rule = clampLevel(ruleLevel, 2);
  return {
    cols: grid.cols,
    rows: grid.rows,
    ruleLevel: rule,
    dots,
    bonusIndex: rule >= 2 ? pickUnlit(dots, rng) : -1,
    touches: 0,
    insideTouches: 0,
    tally: createBonusTally(),
  };
}

// The dots as touch targets for a board at (left, top) of the given size, in the same
// client pixels as the touch. Lit dots are not live.
export function layoutDots(unit, { left = 0, top = 0, width, height }) {
  const radius = 0.36 * Math.min(width / unit.cols, height / unit.rows);
  return unit.dots.map((dot) => ({
    index: dot.index,
    x: left + dot.fx * width,
    y: top + dot.fy * height,
    r: radius,
    live: !dot.lit,
  }));
}

export function isDone(unit) {
  return unit.dots.every((dot) => dot.lit);
}

// One accepted touch. Returns the next unit plus what the UI should show:
//   litIndex      the dot that lit up, or -1 when the touch was out of reach of any dot
//                 (the UI still pokes, and makes nearestIndex wink: nothing is refused)
//   bonus         true when the bonus dot was lit: give a bit more
//   missDistance  px outside the nearest dot's edge (0 = inside)
export function touchUnit(unit, points, touch, { motorLevel = 1, rng = Math.random } = {}) {
  const radius = points.length ? points[0].r : 0;
  const hit = nearestTarget(points, touch, assistRadius(motorLevel, radius));
  if (hit.nearest === null) {
    return { unit, litIndex: -1, nearestIndex: -1, bonus: false, missDistance: null };
  }

  const next = {
    ...unit,
    touches: unit.touches + 1,
    insideTouches: unit.insideTouches + (hit.missDistance === 0 ? 1 : 0),
  };
  if (hit.target === null) {
    return { unit: next, litIndex: -1, nearestIndex: hit.nearestIndex, bonus: false, missDistance: hit.missDistance };
  }

  const judged = judgeTouch({
    ruleLevel: unit.ruleLevel,
    onBonusTarget: hit.index === unit.bonusIndex,
  });
  next.tally = tallyTouch(unit.tally, judged);
  next.dots = unit.dots.map((dot) => (dot.index === hit.index ? { ...dot, lit: true } : dot));
  // The bonus moves on once it is taken; if he lit another dot it simply stays put.
  if (judged.bonus) next.bonusIndex = pickUnlit(next.dots, rng);

  return {
    unit: next,
    litIndex: hit.index,
    nearestIndex: hit.nearestIndex,
    bonus: judged.bonus,
    missDistance: hit.missDistance,
  };
}

// The app finishing the unit for him (after a long idle): lights one dot, counts nothing.
export function autoLight(unit) {
  const dot = unit.dots.find((entry) => !entry.lit);
  if (!dot) return { unit, litIndex: -1 };
  return {
    unit: {
      ...unit,
      dots: unit.dots.map((entry) => (entry.index === dot.index ? { ...entry, lit: true } : entry)),
      bonusIndex: unit.bonusIndex === dot.index ? -1 : unit.bonusIndex,
    },
    litIndex: dot.index,
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
