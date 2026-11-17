// Sand jar logic. Pure: no DOM, no audio, no timers, no Math.random without an rng.
//
// Coloured sand pours into a glass jar. The sand is a column height map, not grains: each
// jar column is a small stack of colour cells. A pour adds cells at the top and one cheap
// relaxation pass slides them toward their natural slope. The colour changes by itself,
// so layers build up. A full jar is finished and a fresh one starts.
//   M (motor)    1 touch anywhere pours; 2 hold and the stream follows the finger
//   R (rule)     1 no rule (the minimum)
//   D (density)  1 a wide jar (fills in about 30 s of pouring); 2 a taller jar

import { createLadder } from './levels.js';

export const SAND_LADDER = createLadder({
  storageKey: 'tabletGames.sandJar',
  dimensions: [
    { id: 'motor', max: 2 },
    { id: 'rule', max: 1 },
    { id: 'density', max: 2 },
  ],
});

export const SAND_COLORS = Object.freeze([
  Object.freeze({ id: 'red', he: 'האדום.', en: 'The red one.', base: '#e0523d', light: '#ff9b78', dark: '#8c2418' }),
  Object.freeze({ id: 'blue', he: 'הכחול.', en: 'The blue one.', base: '#3d7fe0', light: '#8fbcff', dark: '#1d3f8c' }),
  Object.freeze({ id: 'green', he: 'הירוק.', en: 'The green one.', base: '#39a96b', light: '#8be6ad', dark: '#165c37' }),
  Object.freeze({ id: 'yellow', he: 'הצהוב.', en: 'The yellow one.', base: '#e9b93d', light: '#ffe38a', dark: '#8a6416' }),
]);

export const JAR_SHAPES = Object.freeze([
  Object.freeze({ id: 'wide', cols: 30, rows: 16 }),
  Object.freeze({ id: 'tall', cols: 22, rows: 28 }),
]);

// How long each colour stays before the jar changes it by itself.
export const COLOUR_PERIOD_MS = 4500;

// A single touch pours this many cells. A rub pours per segment, so sliding fills faster.
export const POUR_PER_TAP = 12;
export const POUR_PER_SEGMENT = 1;

// Sand slides until a neighbouring column is at most this much taller.
export const SLOPE = 1;

// Finished jars kept on the shelf.
export const SHELF_LIMIT = 12;

// Share of touches that must land over the jar for the unit to count as clean for the
// motor dimension. Measured at every motor level, including M1 where nothing is refused.
export const CLEAN_INSIDE_SHARE = 0.75;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function level(value, max) {
  const number = Math.round(Number(value) || 1);
  return Math.min(max, Math.max(1, number));
}

function colourIndex(value) {
  const number = Math.round(Number(value) || 0);
  return ((number % SAND_COLORS.length) + SAND_COLORS.length) % SAND_COLORS.length;
}

function cloneJar(jar) {
  return {
    ...jar,
    columns: jar.columns.map((column) => [...column]),
  };
}

// One empty jar. Positions in a column are colour indexes, bottom cell first.
export function createJar({ densityLevel = 1, colourIndex: startColour = 0 } = {}) {
  const density = level(densityLevel, JAR_SHAPES.length);
  const shape = JAR_SHAPES[density - 1];
  return {
    densityLevel: density,
    shapeId: shape.id,
    cols: shape.cols,
    rows: shape.rows,
    capacity: shape.cols * shape.rows,
    columns: Array.from({ length: shape.cols }, () => []),
    total: 0,
    colourIndex: colourIndex(startColour),
    colourClock: 0,
    touches: 0,
    insideTouches: 0,
    pours: 0,
  };
}

export function currentColour(jar) {
  return SAND_COLORS[colourIndex(jar.colourIndex)];
}

function nearestSpace(columns, origin, rows) {
  for (let distance = 0; distance < columns.length; distance += 1) {
    const right = origin + distance;
    if (right < columns.length && columns[right].length < rows) return right;
    const left = origin - distance;
    if (left >= 0 && columns[left].length < rows) return left;
  }
  return -1;
}

function addSand(jar, origin, amount, colour) {
  let left = Math.max(0, Math.round(Number(amount) || 0));
  let added = 0;
  while (left > 0 && jar.total < jar.capacity) {
    const column = nearestSpace(jar.columns, origin, jar.rows);
    if (column < 0) break;
    jar.columns[column].push(colour);
    jar.total += 1;
    added += 1;
    left -= 1;
  }
  return added;
}

// One cheap relaxation pass: any column more than SLOPE taller than its right neighbour
// gives its top cell to that neighbour, and the other way round. Total sand never changes.
export function settle(jar, { passes = 1 } = {}) {
  const count = Math.max(0, Math.round(Number(passes) || 0));
  if (count === 0) return jar;

  const next = cloneJar(jar);
  for (let pass = 0; pass < count; pass += 1) {
    let moved = false;
    for (let index = 0; index < next.cols - 1; index += 1) {
      const left = next.columns[index];
      const right = next.columns[index + 1];
      if (left.length > right.length + SLOPE) {
        right.push(left.pop());
        moved = true;
      } else if (right.length > left.length + SLOPE) {
        left.push(right.pop());
        moved = true;
      }
    }
    if (!moved) break;
  }
  return next;
}

// Pour at a fraction (0-1) across the jar. `inside` is whether the touch itself landed
// over the jar; it only feeds adaptation and never refuses anything.
// Returns { jar, added, column }.
export function pourSand(jar, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  if (isDone(jar)) return { jar, added: 0, column: -1 };

  const fx = clamp(Number.isFinite(Number(settings.fx)) ? Number(settings.fx) : 0.5, 0, 1);
  const origin = clamp(Math.floor(fx * jar.cols), 0, jar.cols - 1);
  const colour = colourIndex(settings.colourIndex ?? jar.colourIndex);
  const amount = settings.amount === undefined ? POUR_PER_TAP : Number(settings.amount);

  let next = cloneJar(jar);
  next.touches += 1;
  if (settings.inside !== false) next.insideTouches += 1;
  const added = addSand(next, origin, amount, colour);
  next.pours += 1;
  next = settle(next, { passes: 2 });

  return { jar: next, added, column: origin };
}

// The app keeping the scene alive after a long idle: pours a little, counts nothing.
export function autoPour(jar, rng = Math.random) {
  if (isDone(jar)) return { jar, added: 0 };
  const fx = 0.18 + (rng() * 0.64);
  const origin = clamp(Math.floor(fx * jar.cols), 0, jar.cols - 1);

  let next = cloneJar(jar);
  const added = addSand(next, origin, POUR_PER_TAP * 2, next.colourIndex);
  next.pours += 1;
  next = settle(next, { passes: 2 });
  return { jar: next, added };
}

// The colour changes by itself every COLOUR_PERIOD_MS. Old layers keep their colour.
export function advanceColour(jar, deltaMs) {
  const delta = Math.max(0, Number(deltaMs) || 0);
  let clock = jar.colourClock + delta;
  let index = jar.colourIndex;
  let changed = false;
  while (clock >= COLOUR_PERIOD_MS) {
    clock -= COLOUR_PERIOD_MS;
    index = (index + 1) % SAND_COLORS.length;
    changed = true;
  }
  if (!changed) return { jar, changed: false };
  return { jar: { ...jar, colourClock: clock, colourIndex: index }, changed: true };
}

export function isDone(jar) {
  return jar.total >= jar.capacity;
}

// How much of the jar is sand, 0-1, for the UI's own damping.
export function fillShare(jar) {
  return jar.capacity > 0 ? clamp(jar.total / jar.capacity, 0, 1) : 0;
}

// The finished jar as broad colour bands, bottom to top, for the little shelf jars.
export function jarBands(jar) {
  const bands = [];
  for (let row = 0; row < jar.rows; row += 1) {
    const counts = new Map();
    for (const column of jar.columns) {
      if (column.length <= row) continue;
      const colour = colourIndex(column[row]);
      counts.set(colour, (counts.get(colour) || 0) + 1);
    }
    if (counts.size === 0) break;
    let best = 0;
    let bestCount = -1;
    for (const [colour, count] of counts) {
      if (count > bestCount) {
        best = colour;
        bestCount = count;
      }
    }
    const last = bands[bands.length - 1];
    if (last && last.colourIndex === best) last.count += 1;
    else bands.push({ colourIndex: best, count: 1 });
  }
  return bands;
}

export function jarSummary(jar) {
  return {
    shapeId: jar.shapeId,
    cols: jar.cols,
    rows: jar.rows,
    bands: jarBands(jar),
  };
}

// Adds a finished jar to the shelf strip, keeping only the last SHELF_LIMIT.
export function shelfWithJar(shelf, jar, limit = SHELF_LIMIT) {
  const list = Array.isArray(shelf) ? shelf.slice() : [];
  list.push(jarSummary(jar));
  const keep = Math.max(1, Math.round(Number(limit) || SHELF_LIMIT));
  return list.length > keep ? list.slice(list.length - keep) : list;
}

// What the finished jar says about each dimension, for onSuccess({ results }):
// true = clean, false = not clean, null = no information (idle never counts).
export function unitResults(jar) {
  if (jar.touches === 0) return { motor: null, rule: null, density: null };
  const clean = jar.insideTouches / jar.touches >= CLEAN_INSIDE_SHARE;
  return {
    motor: clean,
    rule: null,
    density: clean,
  };
}
