// Colour pop logic. Pure: no DOM, no audio, no timers, no Math.random.
//
// A box of coloured balls. A touch pops the ball's whole same-colour group, the balls
// above fall straight down in their columns, and fresh balls pour in from the top. The
// unit ends after its pops target, or when a pop clears the box.
//   M (motor)   1 touch anywhere pops the nearest group; 2 touch near; 3 touch inside
//   R (rule)    1 any group; 2 BONUS: the largest group glows, popping it gives more
//   D (density) 1: 5x4, 2 colours; 2: 6x5, 3 colours; 3: 7x6, 3 colours
//
// A group of one still pops. Nothing is ever refused.

import { createBonusTally, judgeTouch, ruleResultForUnit, tallyTouch } from './bonus.js';
import { assistRadius, nearestTarget } from './input.js';
import { createLadder } from './levels.js';

export const COLOUR_LADDER = createLadder({
  storageKey: 'tabletGames.colourPop',
  upStreak: 1,
  dimensions: [
    { id: 'motor', max: 3 },
    { id: 'rule', max: 2 },
    { id: 'density', max: 3 },
  ],
});

export const GRIDS = Object.freeze([
  Object.freeze({ cols: 5, rows: 4, colours: 2 }),
  Object.freeze({ cols: 6, rows: 5, colours: 3 }),
  Object.freeze({ cols: 7, rows: 6, colours: 3 }),
]);

export const POPS_TARGETS = Object.freeze([10, 14, 18]);

// How much of the shorter cell side a ball takes up. Just under half, so balls are big
// and nearly touch without overlapping.
export const BALL_FILL = 0.44;

// A group this size gets the extra shower of sparks.
export const BIG_GROUP = 6;

// Share of touches that must land inside a ball for the unit to count as clean for the
// motor dimension. Measured at every motor level, including M1 where nothing is refused.
export const CLEAN_INSIDE_SHARE = 0.75;

function clampLevel(value, max) {
  const number = Math.round(Number(value) || 1);
  return Math.min(max, Math.max(1, number));
}

function randomColour(colours, rng) {
  const count = Math.max(1, Math.round(Number(colours) || 1));
  const value = Number(rng());
  const fraction = Number.isFinite(value) ? value : 0;
  return Math.floor(fraction * count) % count;
}

function makeBall(id, row, col, colour) {
  return { id, row, col, color: colour };
}

// One box of balls. Rows run from the top (0) to the bottom.
export function createUnit({ densityLevel = 1, ruleLevel = 1, rng = Math.random } = {}) {
  const density = clampLevel(densityLevel, GRIDS.length);
  const grid = GRIDS[density - 1];
  const rule = clampLevel(ruleLevel, 2);
  const balls = [];
  let id = 1;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      balls.push(makeBall(id, row, col, randomColour(grid.colours, rng)));
      id += 1;
    }
  }
  return {
    densityLevel: density,
    ruleLevel: rule,
    cols: grid.cols,
    rows: grid.rows,
    colourCount: grid.colours,
    balls,
    popsTarget: POPS_TARGETS[density - 1],
    pops: 0,
    cleared: false,
    touches: 0,
    insideTouches: 0,
    tally: createBonusTally(),
    nextId: id,
  };
}

// The balls as touch targets for a box at (left, top) of the given size, in the same
// client pixels as the touch.
export function layoutBalls(unit, { left = 0, top = 0, width = 0, height = 0 }) {
  const radius = BALL_FILL * Math.min(width / unit.cols, height / unit.rows);
  return unit.balls.map((ball, index) => ({
    index,
    id: ball.id,
    row: ball.row,
    col: ball.col,
    color: ball.color,
    x: left + ((ball.col + 0.5) / unit.cols) * width,
    y: top + ((ball.row + 0.5) / unit.rows) * height,
    r: Math.max(0, radius),
    live: true,
  }));
}

export function isDone(unit) {
  return unit.balls.length === 0 || unit.pops >= unit.popsTarget;
}

export function jarFill(unit) {
  const target = Math.max(1, Number(unit.popsTarget) || 1);
  return Math.min(1, Math.max(0, (Number(unit.pops) || 0) / target));
}

function ballAt(unit, row, col) {
  if (row < 0 || col < 0 || row >= unit.rows || col >= unit.cols) return null;
  for (const ball of unit.balls) {
    if (ball.row === row && ball.col === col) return ball;
  }
  return null;
}

// The same-colour group the ball at (row, col) belongs to, using four-way adjacency.
// Diagonal neighbours do not join. An empty cell gives [].
export function findGroup(unit, row, col) {
  const start = ballAt(unit, row, col);
  if (!start) return [];

  const keyOf = (ball) => `${ball.row},${ball.col}`;
  const seen = new Set([keyOf(start)]);
  const stack = [start];
  const group = [];

  while (stack.length) {
    const ball = stack.pop();
    group.push(ball);
    const neighbours = [
      [ball.row - 1, ball.col],
      [ball.row + 1, ball.col],
      [ball.row, ball.col - 1],
      [ball.row, ball.col + 1],
    ];
    for (const [nextRow, nextCol] of neighbours) {
      const next = ballAt(unit, nextRow, nextCol);
      if (!next || next.color !== start.color) continue;
      const key = keyOf(next);
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(next);
    }
  }

  return group.sort((a, b) => a.row - b.row || a.col - b.col);
}

export function largestGroupSize(unit) {
  const seen = new Set();
  let largest = 0;
  for (const ball of unit.balls) {
    const key = `${ball.row},${ball.col}`;
    if (seen.has(key)) continue;
    const group = findGroup(unit, ball.row, ball.col);
    for (const member of group) seen.add(`${member.row},${member.col}`);
    largest = Math.max(largest, group.length);
  }
  return largest;
}

// Every ball that belongs to a largest group. Ties all glow. Empty below rule level 2.
export function bonusBallIds(unit) {
  if (unit.ruleLevel < 2) return [];
  const largest = largestGroupSize(unit);
  if (largest <= 0) return [];

  const seen = new Set();
  const ids = [];
  for (const ball of unit.balls) {
    const key = `${ball.row},${ball.col}`;
    if (seen.has(key)) continue;
    const group = findGroup(unit, ball.row, ball.col);
    for (const member of group) seen.add(`${member.row},${member.col}`);
    if (group.length === largest) {
      for (const member of group) ids.push(member.id);
    }
  }
  return ids;
}

function collapseAndRefill(unit, remaining, rng) {
  const falls = [];
  const refills = [];
  const balls = [];
  let nextId = unit.nextId;

  for (let col = 0; col < unit.cols; col += 1) {
    const column = remaining
      .filter((ball) => ball.col === col)
      .sort((a, b) => a.row - b.row);
    const topRow = unit.rows - column.length;

    column.forEach((ball, index) => {
      const row = topRow + index;
      if (row !== ball.row) {
        falls.push({
          id: ball.id,
          col,
          color: ball.color,
          fromRow: ball.row,
          toRow: row,
        });
      }
      balls.push(row === ball.row ? ball : { ...ball, row });
    });

    for (let row = 0; row < topRow; row += 1) {
      const ball = makeBall(nextId, row, col, randomColour(unit.colourCount, rng));
      nextId += 1;
      refills.push(ball);
      balls.push(ball);
    }
  }

  balls.sort((a, b) => a.row - b.row || a.col - b.col);
  return { balls, nextId, falls, refills };
}

function removeGroup(unit, group, rng) {
  const removed = new Set(group.map((ball) => ball.id));
  const remaining = unit.balls.filter((ball) => !removed.has(ball.id));
  const cleared = remaining.length === 0;
  const poppedBalls = group.map((ball) => ({ ...ball }));

  if (cleared) {
    return {
      unit: { ...unit, balls: [], pops: unit.pops + group.length, cleared: true },
      poppedBalls,
      falls: [],
      refills: [],
      cleared: true,
    };
  }

  const collapsed = collapseAndRefill(unit, remaining, rng);
  return {
    unit: {
      ...unit,
      balls: collapsed.balls,
      nextId: collapsed.nextId,
      pops: unit.pops + group.length,
    },
    poppedBalls,
    falls: collapsed.falls,
    refills: collapsed.refills,
    cleared: false,
  };
}

// One accepted tap. Returns the next unit plus what the UI should show:
//   poppedBalls    every ball that popped, with its old row and colour
//   falls          balls that dropped, from row to row
//   refills        new balls that arrive from the top
//   nearestBallId  the nearest live ball even when it was out of reach (the UI winks it)
//   bonus          true when a largest group popped at rule level 2
//   cleared        true when the pop emptied the box
export function touchUnit(unit, points, touch, { motorLevel = 1, rng = Math.random } = {}) {
  const radius = points.length ? points[0].r : 0;
  const hit = nearestTarget(points, touch, assistRadius(motorLevel, radius, { nearFactor: 1.5 }));
  if (hit.nearest === null) {
    return {
      unit,
      poppedBalls: [],
      falls: [],
      refills: [],
      nearestIndex: -1,
      nearestBallId: null,
      bonus: false,
      cleared: false,
      missDistance: null,
    };
  }

  const next = {
    ...unit,
    touches: unit.touches + 1,
    insideTouches: unit.insideTouches + (hit.missDistance === 0 ? 1 : 0),
  };

  if (hit.target === null) {
    return {
      unit: next,
      poppedBalls: [],
      falls: [],
      refills: [],
      nearestIndex: hit.nearestIndex,
      nearestBallId: hit.nearest.id,
      bonus: false,
      cleared: false,
      missDistance: hit.missDistance,
    };
  }

  const seed = ballAt(unit, hit.target.row, hit.target.col) || unit.balls[hit.index];
  const group = findGroup(unit, seed.row, seed.col);
  const judged = judgeTouch({
    ruleLevel: unit.ruleLevel,
    onBonusTarget:
      unit.ruleLevel >= 2 && group.length === largestGroupSize(unit),
  });
  next.tally = tallyTouch(unit.tally, judged);

  const result = removeGroup(next, group, rng);
  return {
    unit: result.unit,
    poppedBalls: result.poppedBalls,
    falls: result.falls,
    refills: result.refills,
    nearestIndex: hit.nearestIndex,
    nearestBallId: seed.id,
    bonus: judged.bonus,
    cleared: result.cleared,
    missDistance: hit.missDistance,
  };
}

// The app finishing the unit for him after a long idle: pops a group at a time, slowly.
// It counts nothing (touches stay as they are), so idle never pushes a level up.
export function autoPop(unit, { rng = Math.random } = {}) {
  if (isDone(unit) || unit.balls.length === 0) {
    return {
      unit,
      poppedBalls: [],
      falls: [],
      refills: [],
      cleared: unit.balls.length === 0,
      alreadyDone: true,
    };
  }

  const largest = largestGroupSize(unit);
  let seed = unit.balls[0];
  for (const ball of unit.balls) {
    if (findGroup(unit, ball.row, ball.col).length === largest) {
      seed = ball;
      break;
    }
  }

  const group = findGroup(unit, seed.row, seed.col);
  const result = removeGroup(unit, group, rng);
  return { ...result, alreadyDone: false };
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
