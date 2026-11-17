// Soap bubbles logic. Pure: no DOM, no audio, no timers, no Math.random.
//
// Large soap bubbles drift slowly upward with a gentle sway. A touch bursts the nearest
// live bubble (at M1 anywhere, at M2 near it, at M3 inside it) and the bubbles are
// replaced from below, so the scene never empties. Some bubbles carry a small thing
// inside; bursting one releases it.
//   M (motor)    1 touch anywhere bursts the nearest bubble; 2 touch near; 3 touch inside
//   R (rule)     1 any bubble; 2 BONUS: one bubble with something inside glows softly
//   D (density)  1 one bubble, nearly still; 2 three bubbles, slow drift; 3 five bubbles
//
// Nothing is ever lost: a bubble that reaches the top simply leaves, and a touch that
// misses still pokes and makes the nearest bubble wink.

import { createBonusTally, judgeTouch, ruleResultForUnit, tallyTouch } from './bonus.js';
import { assistRadius, nearestTarget } from './input.js';
import { createLadder } from './levels.js';

export const SOAP_LADDER = createLadder({
  storageKey: 'tabletGames.soapBubbles',
  upStreak: 1,
  dimensions: [
    { id: 'motor', max: 3 },
    { id: 'rule', max: 2 },
    { id: 'density', max: 3 },
  ],
});

// The steady supply of live bubbles for each density level.
export const BUBBLES_PER_LEVEL = Object.freeze([1, 3, 5]);

// Ten bursts is one short scene; the gathered things are held up during the finale.
export const BURSTS_PER_UNIT = 10;

// Share of touches that must land inside a bubble for the unit to count as clean for the
// motor dimension. Measured at every motor level, including M1 where nothing is refused.
export const CLEAN_INSIDE_SHARE = 0.6;

// Five things may float inside a soap bubble. Only the bird and the flower have their own
// spoken phrases in the 60s block; the others are a quiet surprise.
export const INSIDE_ITEMS = Object.freeze([
  Object.freeze({ id: 'flower', emoji: '🌸', phrase: '62', motion: 'down' }),
  Object.freeze({ id: 'bird', emoji: '🐦', phrase: '61', motion: 'up' }),
  Object.freeze({ id: 'butterfly', emoji: '🦋', phrase: null, motion: 'up' }),
  Object.freeze({ id: 'bee', emoji: '🐝', phrase: null, motion: 'up' }),
  Object.freeze({ id: 'heart', emoji: '💖', phrase: null, motion: 'up' }),
]);

// Fractions of the board per second. Level 1 really is nearly still.
export const DRIFT_SPEED = Object.freeze([0.004, 0.018, 0.035]);
export const SWAY_RATE = Object.freeze([0.35, 0.55]);
export const SWAY_AMPLITUDE = Object.freeze([0.016, 0.04]);
export const BUBBLE_SIZE = Object.freeze([0.19, 0.24]);
export const CONTENT_CHANCE = 0.45;

function clampLevel(value, max) {
  const number = Math.round(Number(value) || 1);
  return Math.min(max, Math.max(1, number));
}

function between(range, rng) {
  return range[0] + rng() * (range[1] - range[0]);
}

function itemFor(id) {
  return INSIDE_ITEMS.find((item) => item.id === id) || null;
}

function pickItem(rng) {
  const index = Math.floor(rng() * INSIDE_ITEMS.length) % INSIDE_ITEMS.length;
  return INSIDE_ITEMS[index];
}

function pickContent(rng) {
  return rng() < CONTENT_CHANCE ? pickItem(rng) : null;
}

function makeBubble(unit, { fy, baseX, rng }) {
  const content = pickContent(rng);
  return {
    id: `soap-bubble-${unit.nextId}`,
    baseX,
    fy,
    size: between(BUBBLE_SIZE, rng),
    vy: DRIFT_SPEED[unit.densityLevel - 1] * (0.85 + rng() * 0.3),
    phase: rng() * Math.PI * 2,
    swayRate: between(SWAY_RATE, rng),
    swayAmp: between(SWAY_AMPLITUDE, rng),
    age: 0,
    content: content ? content.id : null,
  };
}

function addBubble(unit, { fy, baseX, rng }) {
  const bubble = makeBubble(unit, { fy, baseX, rng });
  return {
    ...unit,
    nextId: unit.nextId + 1,
    bubbles: [...unit.bubbles, bubble],
  };
}

function pickBonusId(bubbles, rng) {
  const carrying = bubbles.filter((bubble) => bubble.content);
  if (carrying.length === 0) return null;
  return carrying[Math.floor(rng() * carrying.length) % carrying.length].id;
}

// Makes sure there is always at least one thing inside, and (at R2) a bonus to find.
function ensureContent(unit, rng) {
  let bubbles = unit.bubbles;
  if (bubbles.length === 0) return { ...unit, bonusId: null };

  if (!bubbles.some((bubble) => bubble.content)) {
    const item = pickItem(rng);
    bubbles = bubbles.map((bubble, index) =>
      index === 0 ? { ...bubble, content: item.id } : bubble,
    );
  }

  let bonusId = unit.bonusId;
  const bonusAlive = bubbles.some((bubble) => bubble.id === bonusId);
  if (unit.ruleLevel >= 2 && !bonusAlive) {
    bonusId = pickBonusId(bubbles, rng);
  }
  return { ...unit, bubbles, bonusId: unit.ruleLevel >= 2 ? bonusId : null };
}

// One scene of drifting bubbles. The first bubbles are spread calmly over the board.
export function createUnit({ densityLevel = 1, ruleLevel = 1, rng = Math.random } = {}) {
  const density = clampLevel(densityLevel, BUBBLES_PER_LEVEL.length);
  const rule = clampLevel(ruleLevel, 2);
  const count = BUBBLES_PER_LEVEL[density - 1];

  let unit = {
    densityLevel: density,
    ruleLevel: rule,
    targetCount: count,
    goal: BURSTS_PER_UNIT,
    bursts: 0,
    bubbles: [],
    nextId: 0,
    bonusId: null,
    releasedItems: [],
    touches: 0,
    insideTouches: 0,
    tally: createBonusTally(),
  };

  for (let index = 0; index < count; index += 1) {
    const slot = count === 1 ? 0.5 : 0.52 - (index / Math.max(1, count - 1)) * 0.4;
    const spread = (index + 0.5) / count;
    const baseX = Math.min(0.8, Math.max(0.2, spread + (rng() - 0.5) * 0.08));
    const fy = Math.min(0.88, Math.max(0.16, slot + (rng() - 0.5) * 0.04));
    unit = addBubble(unit, { fy, baseX, rng });
  }

  return ensureContent(unit, rng);
}

// The live bubbles as touch targets for a board at (left, top) of the given size, in the
// same client pixels as the touch.
export function layoutBubbles(unit, { left = 0, top = 0, width = 0, height = 0 }) {
  const shortest = Math.min(width, height);
  return unit.bubbles.map((bubble, index) => ({
    index,
    id: bubble.id,
    x: left + (bubble.baseX + Math.sin(bubble.phase) * bubble.swayAmp) * width,
    y: top + bubble.fy * height,
    r: bubble.size * shortest,
    live: true,
  }));
}

export function bubbleItem(bubble) {
  return bubble && bubble.content ? itemFor(bubble.content) : null;
}

export function isDone(unit) {
  return unit.bursts >= unit.goal;
}

// Moves every bubble on by dtMs, lets the ones that left the top go, and keeps the
// supply topped up from below.
export function stepUnit(unit, dtMs, { rng = Math.random } = {}) {
  const dt = Math.min(0.1, Math.max(0, Number(dtMs) || 0) / 1000);
  const moved = unit.bubbles
    .map((bubble) => ({
      ...bubble,
      fy: bubble.fy - bubble.vy * dt,
      phase: bubble.phase + bubble.swayRate * dt,
      age: bubble.age + dt,
    }))
    .filter((bubble) => bubble.fy + bubble.size > 0);

  let next = { ...unit, bubbles: moved };
  while (next.bubbles.length < next.targetCount) {
    const baseX = Math.min(0.8, Math.max(0.2, 0.22 + rng() * 0.56));
    const fy = 1.02 + rng() * 0.06;
    const bubble = makeBubble(next, { fy, baseX, rng });
    next = {
      ...next,
      nextId: next.nextId + 1,
      bubbles: [...next.bubbles, bubble],
    };
  }
  return ensureContent(next, rng);
}

// One accepted touch. Returns the next unit plus what the UI should show:
//   burstIndex    the burst bubble's index in the old layout, or -1 when the touch was
//                 out of reach (the UI still pokes and makes nearestIndex wink)
//   burst         the bubble that burst, or null
//   released      the inside item that floated free, or null
//   bonus         true when the bonus bubble burst: give a bit more
//   nearestIndex  the nearest live bubble even when it was out of reach
//   missDistance  px outside the nearest bubble's edge (0 = inside it)
export function touchUnit(unit, points, touch, { motorLevel = 1, rng = Math.random } = {}) {
  const radius = points.length ? points[0].r : 0;
  const hit = nearestTarget(points, touch, assistRadius(motorLevel, radius));

  const counted = {
    ...unit,
    touches: unit.touches + 1,
    insideTouches: unit.insideTouches + (hit.missDistance === 0 ? 1 : 0),
  };

  if (hit.nearest === null) {
    return {
      unit: counted,
      burstIndex: -1,
      burst: null,
      released: null,
      bonus: false,
      nearestIndex: -1,
      missDistance: null,
    };
  }

  if (hit.target === null) {
    return {
      unit: counted,
      burstIndex: -1,
      burst: null,
      released: null,
      bonus: false,
      nearestIndex: hit.nearestIndex,
      missDistance: hit.missDistance,
    };
  }

  const bubble = unit.bubbles[hit.index];
  const judged = judgeTouch({
    ruleLevel: unit.ruleLevel,
    onBonusTarget: bubble.id === unit.bonusId,
  });
  const released = bubbleItem(bubble);

  let next = {
    ...counted,
    bubbles: unit.bubbles.filter((entry) => entry.id !== bubble.id),
    bursts: unit.bursts + 1,
    tally: tallyTouch(unit.tally, judged),
  };
  if (released) next.releasedItems = [...unit.releasedItems, released.id];
  if (judged.bonus) next.bonusId = pickBonusId(next.bubbles, rng);
  next = ensureContent(next, rng);

  return {
    unit: next,
    burstIndex: hit.index,
    burst: bubble,
    released,
    bonus: judged.bonus,
    nearestIndex: hit.nearestIndex,
    missDistance: hit.missDistance,
  };
}

// The app finishing the scene for him after a long idle: bursts one bubble, counts
// nothing.
export function autoBurst(unit, { rng = Math.random } = {}) {
  const bubble = unit.bubbles[0];
  if (!bubble) return { unit, burstIndex: -1, burst: null, released: null };
  const released = bubbleItem(bubble);
  let next = {
    ...unit,
    bubbles: unit.bubbles.filter((entry) => entry.id !== bubble.id),
    bursts: unit.bursts + 1,
  };
  if (released) next.releasedItems = [...unit.releasedItems, released.id];
  if (unit.bonusId === bubble.id) next.bonusId = null;
  next = ensureContent(next, rng);
  return { unit: next, burstIndex: 0, burst: bubble, released };
}

// What the finished scene says about each dimension, for onSuccess({ results }):
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
