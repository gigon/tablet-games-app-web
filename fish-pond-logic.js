// Fish pond logic. Pure: no DOM, no audio, no timers, no Math.random without an rng.
//
// A calm pond. A touch drops food; each fish steers toward the nearest pellet and eats it
// with a small plop. Lilies open when a fish swims past. Nothing can fail and nothing
// leaves the pond.
//   M (motor)    1 touch anywhere drops food; 2 hold and fish follow the finger
//   R (rule)     1 no rule (the minimum)
//   D (density)  1: 2 fish, 2: 4 fish, 3: 6 fish (and one more lily each time)

import { createLadder } from './levels.js';

export const FISH_LADDER = createLadder({
  storageKey: 'tabletGames.fishPond',
  upStreak: 1,
  dimensions: [
    { id: 'motor', max: 2 },
    { id: 'rule', max: 1 },
    { id: 'density', max: 3 },
  ],
});

export const FISH_COUNTS = Object.freeze([2, 4, 6]);
export const LILY_COUNTS = Object.freeze([1, 2, 3]);
export const FISH_COLORS = Object.freeze(['#ff8a3d', '#fff2dc', '#ffc64d', '#ff6b5e']);

export const FEEDS_PER_ROUND = 10;
export const FOOD_LIMIT = 14;
export const FOOD_LIFE_MS = 14000;
export const EAT_RADIUS = 0.06;
export const LILY_OPEN_RADIUS = 0.1;
export const FOOD_SENSE_RADIUS = 0.75;
export const POND_MARGIN = 0.08;

const LILY_SPOTS = Object.freeze([
  Object.freeze({ fx: 0.18, fy: 0.22 }),
  Object.freeze({ fx: 0.82, fy: 0.26 }),
  Object.freeze({ fx: 0.2, fy: 0.78 }),
  Object.freeze({ fx: 0.8, fy: 0.76 }),
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function level(value, max) {
  const number = Math.round(Number(value) || 1);
  return Math.min(max, Math.max(1, number));
}

function fraction(value, fallback = 0.5) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 1) : fallback;
}

function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function createFish(index, count, rng) {
  const spawnAngle = (index / count) * Math.PI * 2 + rng() * 0.4;
  const spawnRadius = 0.16 + rng() * 0.2;
  const wanderAngle = rng() * Math.PI * 2;
  const wanderRadius = 0.18 + rng() * 0.24;
  const edge = POND_MARGIN + 0.02;

  return {
    index,
    fx: clamp(0.5 + Math.cos(spawnAngle) * spawnRadius, edge, 1 - edge),
    fy: clamp(0.5 + Math.sin(spawnAngle) * spawnRadius, edge, 1 - edge),
    angle: spawnAngle + Math.PI / 2 + (rng() - 0.5) * 0.6,
    speed: 0.045 + rng() * 0.025,
    turn: 1.6 + rng() * 0.9,
    wobble: rng() * Math.PI * 2,
    wanderFx: clamp(0.5 + Math.cos(wanderAngle) * wanderRadius, edge, 1 - edge),
    wanderFy: clamp(0.5 + Math.sin(wanderAngle) * wanderRadius, edge, 1 - edge),
    color: FISH_COLORS[index % FISH_COLORS.length],
    scale: 1 + rng() * 0.2,
    fedFlash: 0,
  };
}

function createLilies(count, rng) {
  return LILY_SPOTS.slice(0, count).map((spot, index) => ({
    index,
    fx: clamp(spot.fx + (rng() - 0.5) * 0.06, 0.1, 0.9),
    fy: clamp(spot.fy + (rng() - 0.5) * 0.06, 0.1, 0.9),
    open: false,
  }));
}

// One pond. Positions are fractions of the board, so the logic never needs pixel sizes.
export function createUnit({ densityLevel = 1, rng = Math.random } = {}) {
  const density = level(densityLevel, FISH_COUNTS.length);
  const fishCount = FISH_COUNTS[density - 1];
  const lilyCount = LILY_COUNTS[density - 1];
  const fish = [];
  for (let index = 0; index < fishCount; index += 1) {
    fish.push(createFish(index, fishCount, rng));
  }
  return {
    densityLevel: density,
    fish,
    lilies: createLilies(lilyCount, rng),
    food: [],
    nextFoodId: 1,
    fed: 0,
    touches: 0,
    foodDropped: 0,
  };
}

// A touch on the water: food falls at that spot. Overfeeding is impossible; the oldest
// pellets fall away once the pond is full.
export function dropFood(unit, point, { rng = Math.random } = {}) {
  const edge = 0.05;
  const pellet = {
    id: unit.nextFoodId,
    fx: clamp(fraction(point?.fx), edge, 1 - edge),
    fy: clamp(fraction(point?.fy), edge, 1 - edge),
    ageMs: 0,
    drift: rng() * Math.PI * 2,
  };
  const food = [...unit.food, pellet];
  if (food.length > FOOD_LIMIT) food.splice(0, food.length - FOOD_LIMIT);
  return {
    unit: {
      ...unit,
      food,
      nextFoodId: unit.nextFoodId + 1,
      touches: unit.touches + 1,
      foodDropped: unit.foodDropped + 1,
    },
    foodId: pellet.id,
  };
}

// Moves the pond on by dtMs. Fish seek food, otherwise a held finger at M2, otherwise a
// slow wander. Returns the next unit and what happened, for the UI to show.
export function stepUnit(unit, dtMs, { rng = Math.random, lure = null } = {}) {
  const seconds = Math.min(0.1, Math.max(0, Number(dtMs) || 0) / 1000);
  if (seconds === 0) return { unit, events: { eaten: [], opened: [] } };

  let food = unit.food
    .map((pellet) => ({ ...pellet, ageMs: pellet.ageMs + seconds * 1000 }))
    .filter((pellet) => pellet.ageMs < FOOD_LIFE_MS);

  const lurePoint =
    lure && Number.isFinite(Number(lure.fx)) && Number.isFinite(Number(lure.fy))
      ? { fx: fraction(lure.fx), fy: fraction(lure.fy) }
      : null;

  const events = { eaten: [], opened: [] };
  let fed = unit.fed;
  const fish = [];

  for (const source of unit.fish) {
    const current = {
      ...source,
      wobble: (source.wobble + seconds * 1.1) % (Math.PI * 2),
      fedFlash: Math.max(0, (source.fedFlash || 0) - seconds * 1.6),
    };

    let target = null;
    let bestDistance = Infinity;
    for (const pellet of food) {
      const distance = Math.hypot(pellet.fx - current.fx, pellet.fy - current.fy);
      if (distance < bestDistance) {
        bestDistance = distance;
        target = pellet;
      }
    }
    if (target && bestDistance > FOOD_SENSE_RADIUS) target = null;
    if (!target && lurePoint) target = lurePoint;

    if (!target) {
      if (Math.hypot(current.wanderFx - current.fx, current.wanderFy - current.fy) < 0.08) {
        const spotAngle = rng() * Math.PI * 2;
        const spotRadius = 0.18 + rng() * 0.24;
        const edge = POND_MARGIN + 0.02;
        current.wanderFx = clamp(0.5 + Math.cos(spotAngle) * spotRadius, edge, 1 - edge);
        current.wanderFy = clamp(0.5 + Math.sin(spotAngle) * spotRadius, edge, 1 - edge);
      }
      target = { fx: current.wanderFx, fy: current.wanderFy };
      current.angle += Math.sin(current.wobble) * 0.45 * seconds;
    }

    const desired = Math.atan2(target.fy - current.fy, target.fx - current.fx);
    const turn = current.turn * seconds;
    current.angle += clamp(angleDelta(current.angle, desired), -turn, turn);
    current.fx += Math.cos(current.angle) * current.speed * seconds;
    current.fy += Math.sin(current.angle) * current.speed * seconds;

    if (current.fx < POND_MARGIN) {
      current.fx = POND_MARGIN;
      current.angle = Math.PI - current.angle;
    } else if (current.fx > 1 - POND_MARGIN) {
      current.fx = 1 - POND_MARGIN;
      current.angle = Math.PI - current.angle;
    }
    if (current.fy < POND_MARGIN) {
      current.fy = POND_MARGIN;
      current.angle = -current.angle;
    } else if (current.fy > 1 - POND_MARGIN) {
      current.fy = 1 - POND_MARGIN;
      current.angle = -current.angle;
    }

    const eatenIndex = food.findIndex(
      (pellet) => Math.hypot(pellet.fx - current.fx, pellet.fy - current.fy) <= EAT_RADIUS,
    );
    if (eatenIndex >= 0) {
      const pellet = food[eatenIndex];
      food = food.slice(0, eatenIndex).concat(food.slice(eatenIndex + 1));
      fed += 1;
      current.fedFlash = 1;
      events.eaten.push({
        fishIndex: current.index,
        foodId: pellet.id,
        fx: pellet.fx,
        fy: pellet.fy,
      });
    }

    fish.push(current);
  }

  const lilies = unit.lilies.map((lily) => {
    if (lily.open) return lily;
    const near = fish.some(
      (entry) => Math.hypot(entry.fx - lily.fx, entry.fy - lily.fy) <= LILY_OPEN_RADIUS,
    );
    if (!near) return lily;
    events.opened.push(lily.index);
    return { ...lily, open: true };
  });

  return { unit: { ...unit, fish, food, lilies, fed }, events };
}

export function isDone(unit) {
  return unit.fed >= FEEDS_PER_ROUND;
}

export function resetFeeds(unit) {
  return unit.fed === 0 ? unit : { ...unit, fed: 0 };
}

// What the finished pond says about each dimension, for onSuccess({ results }):
// true = clean, false = not clean, null = no information (idle never counts).
export function unitResults(unit) {
  if (unit.touches === 0) return { motor: null, rule: null, density: null };
  return { motor: true, rule: null, density: true };
}
