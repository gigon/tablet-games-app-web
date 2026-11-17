// Marble drop logic. Pure: no DOM, no audio, no timers, no Math.random outside rng.
//
// A wooden board with pegs and cups. A touch releases a marble from the top; it falls
// under gravity, clicks off the round pegs and settles into a cup. A full cup tips its
// marbles out with a glow, and the unit is finished when every cup has tipped once.
//   M (motor)    1 touch anywhere: the marble drops from the top centre;
//                2 the marble drops above where he touched (still anywhere)
//   R (rule)     1 just drop (the minimum: no bonus)
//   D (density)  1: 3 rows of pegs, 3 cups; 2: 4 rows, 4 cups
//
// The physics is this module's own tiny simulation: gravity, a bounce off each fixed
// circular peg with a seeded random nudge, walls, and a guaranteed landing. It is not a
// shared physics module and it never leaves a marble stuck.

import { createLadder } from './levels.js';

export const MARBLE_LADDER = createLadder({
  storageKey: 'tabletGames.marbleDrop',
  upStreak: 1,
  dimensions: [
    { id: 'motor', max: 2 },
    { id: 'rule', max: 1 },
    { id: 'density', max: 2 },
  ],
});

// The board is measured in fixed board units; the UI scales it to the real rectangle.
// At a 700 px wide board a peg is 60 px across and a marble 68 px, as the spec asks.
export const BOARD_WIDTH = 700;
export const BOARD_HEIGHT = 1000;
export const MARBLE_RADIUS = 34;
export const PEG_RADIUS = 30;
export const CUP_RIM_Y = 800;
export const CUP_FLOOR_Y = 940;
export const START_Y = 70;

export const CUP_CAPACITY = 2;
export const MAX_WAITING = 6;
export const MAX_IN_FLIGHT = 1;

export const GRAVITY = 1200;
export const MAX_SPEED = 1000;
export const RESTITUTION = 0.55;
export const WALL_RESTITUTION = 0.5;
export const PEG_KICK = 170;

export const STUCK_SPEED = 26;
export const STUCK_MS = 700;
export const MAX_MARBLE_LIFE_MS = 10000;

const MAX_SUBSTEP_S = 1 / 120;
const EPSILON = 0.2;

export const MARBLE_COLORS = Object.freeze([
  Object.freeze({ base: '#ff6b7a', light: '#ffd0d6', dark: '#8a1f2d' }),
  Object.freeze({ base: '#5c9dff', light: '#d8e6ff', dark: '#1f3f88' }),
  Object.freeze({ base: '#5ee0bd', light: '#c6fff1', dark: '#1c6d5c' }),
  Object.freeze({ base: '#ffd43b', light: '#fff3b0', dark: '#8a6d00' }),
  Object.freeze({ base: '#d39bff', light: '#f2e2ff', dark: '#53297a' }),
  Object.freeze({ base: '#ff9ec2', light: '#ffe0ec', dark: '#8a2f53' }),
]);

export const PEG_ROWS = Object.freeze([
  Object.freeze([175, 350, 525]),
  Object.freeze([140, 280, 420, 560]),
]);

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampLevel(value, max) {
  return Math.min(max, Math.max(1, Math.round(Number(value) || 1)));
}

function random(rng) {
  const value = Number(typeof rng === 'function' ? rng() : 0);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

// The pentatonic scale step of a peg, by row: the top row rings highest.
export function pegStep(row, rows) {
  const total = Math.max(1, Math.round(Number(rows) || 1));
  const index = clampNumber(row, 0, total - 1, 0);
  return 2 + (total - 1 - index) * 2;
}

// Board layout for a density level: pegs from three or four staggered rows, and three
// or four equal cups under them. Data only, no pixels and no randomness.
export function createBoard({ densityLevel = 1 } = {}) {
  const density = clampLevel(densityLevel, 2);
  const rows = density + 2;
  const cupCount = density + 2;
  const top = 260;
  const bottom = 700;
  const gap = rows > 1 ? (bottom - top) / (rows - 1) : 0;

  const pegs = [];
  for (let row = 0; row < rows; row += 1) {
    const xs = PEG_ROWS[row % PEG_ROWS.length];
    for (const x of xs) {
      pegs.push({
        index: pegs.length,
        row,
        x,
        y: Math.round(top + gap * row),
        r: PEG_RADIUS,
      });
    }
  }

  const cupWidth = BOARD_WIDTH / cupCount;
  const cups = [];
  for (let index = 0; index < cupCount; index += 1) {
    cups.push({
      index,
      x: (index + 0.5) * cupWidth,
      width: cupWidth,
      capacity: CUP_CAPACITY,
      count: 0,
      colors: [],
      tippedOnce: false,
      tips: 0,
    });
  }

  return { densityLevel: density, rows, pegs, cups };
}

// One board of play. motorLevel is kept here so requestDrop can honour the drop point.
export function createGame({ densityLevel = 1, motorLevel = 1 } = {}) {
  const board = createBoard({ densityLevel });
  return {
    densityLevel: board.densityLevel,
    motorLevel: clampLevel(motorLevel, 2),
    rows: board.rows,
    pegs: board.pegs,
    cups: board.cups.map((cup) => ({ ...cup, colors: [] })),
    inFlight: [],
    waiting: [],
    nextId: 1,
    drops: 0,
    landed: 0,
    tips: 0,
    touches: 0,
    done: false,
  };
}

export function flightCap() {
  return MAX_IN_FLIGHT;
}

// Where the marble leaves the top for this motor level. M1 always uses the centre; M2
// follows the finger, clamped so the marble starts inside the walls.
export function dropXFor(motorLevel, touchX) {
  if (clampLevel(motorLevel, 2) <= 1) return BOARD_WIDTH / 2;
  const margin = MARBLE_RADIUS + 8;
  return clampNumber(touchX, margin, BOARD_WIDTH - margin, BOARD_WIDTH / 2);
}

function spawnMarble(x, id, rng) {
  const margin = MARBLE_RADIUS + 2;
  return {
    id,
    x: clampNumber(x, margin, BOARD_WIDTH - margin, BOARD_WIDTH / 2),
    y: START_Y,
    vx: (random(rng) - 0.5) * 110,
    vy: 0,
    rot: 0,
    colorIndex: id % MARBLE_COLORS.length,
    contacts: [],
    stillMs: 0,
    lifeMs: 0,
  };
}

function addDrop(game, x, { rng, countTouch }) {
  let next = {
    ...game,
    touches: game.touches + (countTouch ? 1 : 0),
    waiting: game.waiting.map((entry) => ({ ...entry })),
    inFlight: game.inFlight.map((marble) => ({ ...marble, contacts: [...marble.contacts] })),
  };

  if (next.inFlight.length >= flightCap(next.motorLevel) || next.waiting.length > 0) {
    if (next.waiting.length < MAX_WAITING) next.waiting.push({ x });
    return { game: next, launched: false, queued: next.waiting.length < MAX_WAITING };
  }

  const marble = spawnMarble(x, next.nextId, rng);
  next = {
    ...next,
    nextId: next.nextId + 1,
    drops: next.drops + 1,
    inFlight: [...next.inFlight, marble],
  };
  return { game: next, launched: true, queued: false, marble };
}

// One accepted touch: release a marble now, or put it in the little queue at the top.
// A touch is never refused; when more than one marble is already on its way the extra
// one waits its turn.
export function requestDrop(game, touch = {}, { rng = Math.random } = {}) {
  const x = dropXFor(game.motorLevel, touch && touch.x);
  return addDrop(game, x, { rng, countTouch: true });
}

// The app finishing the unit for him after a long idle: drops centre marbles but counts
// no touches, so the unit reports no information about him.
export function autoDrop(game, { rng = Math.random } = {}) {
  return addDrop(game, BOARD_WIDTH / 2, { rng, countTouch: false });
}

function cupIndexAt(cups, x) {
  if (!cups.length) return 0;
  const width = cups[0].width || BOARD_WIDTH / cups.length;
  return Math.min(cups.length - 1, Math.max(0, Math.floor(x / width)));
}

function advanceMarble(marble, pegs, rows, dt, rng, events) {
  marble.lifeMs += dt * 1000;
  marble.vy += GRAVITY * dt;

  const speedBefore = Math.hypot(marble.vx, marble.vy);
  if (speedBefore > MAX_SPEED) {
    marble.vx = (marble.vx / speedBefore) * MAX_SPEED;
    marble.vy = (marble.vy / speedBefore) * MAX_SPEED;
  }

  marble.x += marble.vx * dt;
  marble.y += marble.vy * dt;
  marble.rot += (marble.vx / MARBLE_RADIUS) * dt;

  if (marble.x < MARBLE_RADIUS) {
    marble.x = MARBLE_RADIUS;
    if (marble.vx < 0) marble.vx = -marble.vx * WALL_RESTITUTION;
  } else if (marble.x > BOARD_WIDTH - MARBLE_RADIUS) {
    marble.x = BOARD_WIDTH - MARBLE_RADIUS;
    if (marble.vx > 0) marble.vx = -marble.vx * WALL_RESTITUTION;
  }

  for (const peg of pegs) {
    const dx = marble.x - peg.x;
    const dy = marble.y - peg.y;
    let distance = Math.hypot(dx, dy);
    const minimum = MARBLE_RADIUS + peg.r;

    if (distance >= minimum) {
      if (marble.contacts.includes(peg.index) && distance > minimum + 4) {
        marble.contacts = marble.contacts.filter((index) => index !== peg.index);
      }
      continue;
    }

    let nx;
    let ny;
    if (distance < 0.0001) {
      nx = 0;
      ny = -1;
      distance = 0.0001;
    } else {
      nx = dx / distance;
      ny = dy / distance;
    }

    marble.x = peg.x + nx * (minimum + EPSILON);
    marble.y = peg.y + ny * (minimum + EPSILON);

    const normalSpeed = marble.vx * nx + marble.vy * ny;
    if (normalSpeed < 0) {
      marble.vx -= (1 + RESTITUTION) * normalSpeed * nx;
      marble.vy -= (1 + RESTITUTION) * normalSpeed * ny;
    }

    if (!marble.contacts.includes(peg.index)) {
      marble.contacts.push(peg.index);
      const kick = (random(rng) - 0.5) * PEG_KICK;
      marble.vx += -ny * kick;
      marble.vy += nx * kick;
      events.push({
        type: 'peg',
        pegIndex: peg.index,
        row: peg.row,
        rows,
        x: marble.x,
        y: marble.y,
        strength: Math.min(1, Math.abs(normalSpeed) / 520),
      });
    }
  }

  const speed = Math.hypot(marble.vx, marble.vy);
  if (speed < STUCK_SPEED) marble.stillMs += dt * 1000;
  else marble.stillMs = 0;

  // A marble can never get stuck: a nudge sideways, exactly as the spec asks.
  if (marble.stillMs >= STUCK_MS) {
    const direction = random(rng) < 0.5 ? -1 : 1;
    marble.vx += direction * 230;
    marble.vy -= 70;
    marble.stillMs = 0;
  }

  // And as a last safety net it always comes down to a cup within ten seconds.
  if (marble.lifeMs >= MAX_MARBLE_LIFE_MS || marble.y + MARBLE_RADIUS >= CUP_FLOOR_Y) {
    marble.y = Math.min(marble.y, CUP_FLOOR_Y - MARBLE_RADIUS);
    return true;
  }
  return false;
}

function landInCup(cups, marble, events) {
  const cupIndex = cupIndexAt(cups, marble.x);
  const cup = cups[cupIndex];
  cup.colors = [...cup.colors, Math.abs(marble.colorIndex) % MARBLE_COLORS.length];
  cup.count = cup.colors.length;

  events.push({
    type: 'land',
    cupIndex,
    x: marble.x,
    y: CUP_FLOOR_Y - MARBLE_RADIUS,
    colorIndex: marble.colorIndex,
  });

  if (cup.count < cup.capacity) return { tipped: false, cupIndex };

  const firstTip = !cup.tippedOnce;
  cup.count = 0;
  cup.colors = [];
  cup.tips += 1;
  cup.tippedOnce = true;

  events.push({
    type: 'tip',
    cupIndex,
    x: cup.x,
    y: CUP_FLOOR_Y - 30,
    first: firstTip,
  });
  return { tipped: true, cupIndex };
}

// Advances the whole board by one display frame. Returns the next game and the events
// the UI should answer (peg notes, landings, a cup tipping, the unit finishing).
export function stepGame(game, dtMs, { rng = Math.random } = {}) {
  if (!game || game.done) return { game, events: [] };

  const dt = clampNumber(dtMs, 0, 50, 16) / 1000;
  const events = [];

  let cups = game.cups.map((cup) => ({ ...cup, colors: [...cup.colors] }));
  let inFlight = game.inFlight.map((marble) => ({
    ...marble,
    contacts: [...marble.contacts],
  }));
  let waiting = game.waiting.map((entry) => ({ ...entry }));
  let landed = game.landed;
  let tips = game.tips;
  let nextId = game.nextId;
  let drops = game.drops;

  const substeps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP_S));
  const subDt = dt / substeps;

  for (let step = 0; step < substeps; step += 1) {
    const stillFlying = [];
    for (const marble of inFlight) {
      const landedNow = advanceMarble(marble, game.pegs, game.rows, subDt, rng, events);
      if (!landedNow) {
        stillFlying.push(marble);
        continue;
      }
      landed += 1;
      const result = landInCup(cups, marble, events);
      if (result.tipped) tips += 1;
    }
    inFlight = stillFlying;
  }

  while (waiting.length > 0 && inFlight.length < flightCap(game.motorLevel)) {
    const entry = waiting.shift();
    const marble = spawnMarble(entry.x, nextId, rng);
    nextId += 1;
    drops += 1;
    inFlight.push(marble);
  }

  const done = cups.every((cup) => cup.tippedOnce);
  if (done && !game.done) events.push({ type: 'done' });

  const next = {
    ...game,
    cups,
    inFlight,
    waiting,
    nextId,
    drops,
    landed,
    tips,
    done: game.done || done,
  };
  return { game: next, events };
}

export function isDone(game) {
  return Boolean(game && (game.done || game.cups.every((cup) => cup.tippedOnce)));
}

// What the finished board says about each dimension, for onSuccess({ results }).
// There is no rule to judge at rule level 1, and an idle-finished unit says nothing.
export function unitResults(game) {
  if (!game || game.touches === 0) return { motor: null, rule: null, density: null };
  return { motor: true, rule: null, density: true };
}
