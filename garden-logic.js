export const GARDEN_STATE_VERSION = 1;
export const GARDEN_STORAGE_KEY = 'tabletGames.garden';
export const GARDEN_SHELF_STORAGE_KEY = 'tabletGames.garden.shelf';

export const MOTOR_LEVELS = Object.freeze([1, 2, 3]);
export const RULE_LEVELS = Object.freeze([1, 2, 3]);
export const DENSITY_LEVELS = Object.freeze([1, 2, 3]);

export const MIN_MOTOR_LEVEL = 1;
export const MAX_MOTOR_LEVEL = 3;
export const MIN_RULE_LEVEL = 1;
export const MAX_RULE_LEVEL = 3;
export const MIN_DENSITY_LEVEL = 1;
export const MAX_DENSITY_LEVEL = 3;

export const UP_STREAK = 2;
export const DOWN_STREAK = 2;

export const MAX_SHELF_FLOWERS = 12;

export const GARDEN_COLOUR_KEYS = Object.freeze([
  'yellow',
  'red',
  'pink',
  'white',
  'orange',
  'purple',
]);

export const PLANTS = Object.freeze([
  Object.freeze({
    id: 'sunflower',
    names: Object.freeze({ he: 'חמנייה', en: 'Sunflower' }),
    colour: 'yellow',
    stages: Object.freeze(['🌱', '🌿', '🌻']),
  }),
  Object.freeze({
    id: 'tulip',
    names: Object.freeze({ he: 'צבעוני', en: 'Tulip' }),
    colour: 'red',
    stages: Object.freeze(['🌱', '🌿', '🌷']),
  }),
  Object.freeze({
    id: 'rose',
    names: Object.freeze({ he: 'ורד', en: 'Rose' }),
    colour: 'pink',
    stages: Object.freeze(['🌱', '🌿', '🌹']),
  }),
  Object.freeze({
    id: 'daisy',
    names: Object.freeze({ he: 'חיננית', en: 'Daisy' }),
    colour: 'white',
    stages: Object.freeze(['🌱', '🌿', '🌼']),
  }),
  Object.freeze({
    id: 'tomato',
    names: Object.freeze({ he: 'עגבנייה', en: 'Tomato' }),
    colour: 'orange',
    stages: Object.freeze(['🌱', '🌿', '🍅']),
  }),
  Object.freeze({
    id: 'strawberry',
    names: Object.freeze({ he: 'תות', en: 'Strawberry' }),
    colour: 'purple',
    stages: Object.freeze(['🌱', '🌿', '🍓']),
  }),
]);

const DIMENSIONS = Object.freeze(['motor', 'rule', 'density']);
const DEFAULT_NEXT_RAISE = 'density';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampInteger(value, min, max, fallback) {
  const number = toFiniteNumber(value);
  if (number === null) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clampLevel(value, min, max) {
  return clampInteger(value, min, max, min);
}

function clampCount(value) {
  const number = toFiniteNumber(value);
  if (number === null) return 0;
  return Math.max(0, Math.floor(number));
}

function pickIndex(length, rng) {
  if (length <= 0) return 0;
  const value = typeof rng === 'function' ? Number(rng()) : 0;
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(0.999999999, Math.max(0, value));
  return Math.floor(clamped * length);
}

function basePlant(value) {
  const id = isPlainObject(value) ? value.id : value;
  if (!isNonEmptyString(id)) return null;
  return PLANTS.find((plant) => plant.id === id) || null;
}

function toPot(base, thirsty) {
  return {
    id: base.id,
    names: base.names,
    colour: base.colour,
    stages: base.stages,
    stage: 0,
    bloomed: false,
    thirsty: thirsty === true,
  };
}

function pickPlants(count, rng) {
  const pool = PLANTS.slice();
  const take = Math.min(count, pool.length);
  for (let index = 0; index < take; index += 1) {
    const chosen = index + pickIndex(pool.length - index, rng);
    [pool[index], pool[chosen]] = [pool[chosen], pool[index]];
  }
  return pool.slice(0, take);
}

export function normalizePlant(value) {
  const base = basePlant(value);
  if (!base) return null;
  const source = isPlainObject(value) ? value : {};
  const last = base.stages.length - 1;
  const stage = clampInteger(source.stage, 0, last, 0);
  return {
    id: base.id,
    names: base.names,
    colour: base.colour,
    stages: base.stages,
    stage,
    bloomed: stage >= last,
    thirsty: source.thirsty === true,
  };
}

export function waterPlant(plant) {
  const next = normalizePlant(plant);
  if (!next) return null;
  const last = next.stages.length - 1;
  if (next.stage < last) next.stage += 1;
  next.bloomed = next.stage >= last;
  return next;
}

export function createPots(density, rng = Math.random) {
  const count = clampLevel(density, MIN_DENSITY_LEVEL, MAX_DENSITY_LEVEL);
  const plants = pickPlants(count, rng);
  const thirstyIndex = pickIndex(plants.length, rng);
  return plants.map((plant, index) => toPot(plant, index === thirstyIndex));
}

function normalizeRule(rule) {
  if (typeof rule === 'number') {
    return { level: clampLevel(rule, MIN_RULE_LEVEL, MAX_RULE_LEVEL), colour: null };
  }
  const source = isPlainObject(rule) ? rule : {};
  const colour = isNonEmptyString(source.colour)
    ? source.colour
    : isNonEmptyString(source.targetColour)
      ? source.targetColour
      : null;
  return {
    level: clampLevel(source.level, MIN_RULE_LEVEL, MAX_RULE_LEVEL),
    colour,
  };
}

export function targetPot(pots, rule) {
  if (!Array.isArray(pots)) return null;
  const list = pots.filter(isPlainObject);
  if (list.length === 0) return null;

  const spec = normalizeRule(rule);
  if (spec.level === 2) {
    return list.find((pot) => pot.thirsty === true) || null;
  }
  if (spec.level === 3) {
    if (!spec.colour) return null;
    return list.find((pot) => pot.colour === spec.colour) || null;
  }
  return list[0];
}

export function normalizeShelf(shelf) {
  if (!Array.isArray(shelf)) return [];
  const flowers = [];
  for (const entry of shelf) {
    if (!isPlainObject(entry) || !isNonEmptyString(entry.id)) continue;
    flowers.push({
      id: entry.id,
      date: typeof entry.date === 'string' ? entry.date : '',
    });
  }
  return flowers.slice(0, MAX_SHELF_FLOWERS);
}

export function addToShelf(shelf, plant, dateStr) {
  const id = isPlainObject(plant) ? plant.id : plant;
  const flowers = normalizeShelf(shelf);
  if (!isNonEmptyString(id)) return flowers;
  const date = typeof dateStr === 'string' ? dateStr.trim() : '';
  return [{ id, date }, ...flowers].slice(0, MAX_SHELF_FLOWERS);
}

export function serializeShelf(shelf) {
  return JSON.stringify(normalizeShelf(shelf));
}

export function parseShelf(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return normalizeShelf(null);
  }
  try {
    return normalizeShelf(JSON.parse(text));
  } catch {
    return normalizeShelf(null);
  }
}

export function loadShelf(storage) {
  if (!storage || typeof storage.getItem !== 'function') {
    return normalizeShelf(null);
  }
  try {
    return parseShelf(storage.getItem(GARDEN_SHELF_STORAGE_KEY));
  } catch {
    return normalizeShelf(null);
  }
}

export function saveShelf(storage, shelf) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(GARDEN_SHELF_STORAGE_KEY, serializeShelf(shelf));
    return true;
  } catch {
    return false;
  }
}

function parseDate(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function shiftDate(value, days) {
  const date = parseDate(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function yesterdayFlowers(shelf, todayStr) {
  const yesterday = shiftDate(todayStr, -1);
  if (!yesterday) return [];
  return normalizeShelf(shelf).filter((flower) => flower.date === yesterday);
}

function defaultDimension() {
  return { level: 1, successes: 0, failures: 0 };
}

function maxLevelFor(dimension) {
  if (dimension === 'density') return MAX_DENSITY_LEVEL;
  if (dimension === 'rule') return MAX_RULE_LEVEL;
  return MAX_MOTOR_LEVEL;
}

function otherHardDimension(dimension) {
  return dimension === 'rule' ? 'density' : 'rule';
}

function normalizeNextRaise(value) {
  return value === 'rule' || value === 'density' ? value : DEFAULT_NEXT_RAISE;
}

function normalizeDimension(value, maxLevel) {
  const source = isPlainObject(value) ? value : {};
  return {
    level: clampLevel(source.level, 1, maxLevel),
    successes: clampCount(source.successes),
    failures: clampCount(source.failures),
  };
}

export function createDefaultGardenState() {
  return {
    version: GARDEN_STATE_VERSION,
    motor: defaultDimension(),
    rule: defaultDimension(),
    density: defaultDimension(),
    nextRaise: DEFAULT_NEXT_RAISE,
  };
}

export function normalizeGardenState(state) {
  if (!isPlainObject(state)) {
    return createDefaultGardenState();
  }

  const next = {
    version: GARDEN_STATE_VERSION,
    motor: normalizeDimension(state.motor, MAX_MOTOR_LEVEL),
    rule: normalizeDimension(state.rule, MAX_RULE_LEVEL),
    density: normalizeDimension(state.density, MAX_DENSITY_LEVEL),
    nextRaise: normalizeNextRaise(state.nextRaise),
  };

  const pending = next.nextRaise;
  const other = otherHardDimension(pending);
  if (
    next[pending].level >= maxLevelFor(pending) &&
    next[other].level < maxLevelFor(other)
  ) {
    next.nextRaise = other;
  }

  return next;
}

export function serializeGardenState(state) {
  return JSON.stringify(normalizeGardenState(state));
}

export function parseGardenState(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return normalizeGardenState(null);
  }
  try {
    return normalizeGardenState(JSON.parse(text));
  } catch {
    return normalizeGardenState(null);
  }
}

export function loadGardenState(storage) {
  if (!storage || typeof storage.getItem !== 'function') {
    return normalizeGardenState(null);
  }
  try {
    return parseGardenState(storage.getItem(GARDEN_STORAGE_KEY));
  } catch {
    return normalizeGardenState(null);
  }
}

export function saveGardenState(storage, state) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(GARDEN_STORAGE_KEY, serializeGardenState(state));
    return true;
  } catch {
    return false;
  }
}

function raiseDimension(state, dimension) {
  const entry = state[dimension];
  const maxLevel = maxLevelFor(dimension);

  if (entry.level >= maxLevel) {
    entry.successes = 0;
    entry.failures = 0;
    if (dimension !== 'motor' && state.nextRaise === dimension) {
      state.nextRaise = otherHardDimension(dimension);
    }
    return false;
  }

  if (dimension === 'motor') {
    entry.level += 1;
    entry.successes = 0;
    entry.failures = 0;
    return true;
  }

  if (state.nextRaise !== dimension) return false;

  entry.level += 1;
  entry.successes = 0;
  entry.failures = 0;

  const other = otherHardDimension(dimension);
  state[other].successes = 0;
  state.nextRaise = other;
  return true;
}

export function recordGardenResult(state, dimension, outcome = {}) {
  if (!DIMENSIONS.includes(dimension)) {
    throw new RangeError(`Unknown garden dimension: ${dimension}`);
  }

  const next = normalizeGardenState(state);
  const result = typeof outcome === 'boolean' ? { success: outcome } : isPlainObject(outcome) ? outcome : {};

  if (result.timeout === true || result.idle === true) return next;

  const entry = next[dimension];
  if (result.success === true) {
    entry.successes += 1;
    entry.failures = 0;
  } else {
    entry.failures += 1;
    entry.successes = 0;
  }

  if (entry.failures >= DOWN_STREAK && entry.level > 1) {
    entry.level -= 1;
    entry.successes = 0;
    entry.failures = 0;
    if (dimension !== 'motor') next.nextRaise = dimension;
    return next;
  }

  if (entry.successes >= UP_STREAK) {
    raiseDimension(next, dimension);
  }

  return next;
}

export function recordMotorResult(state, outcome = {}) {
  return recordGardenResult(state, 'motor', outcome);
}

export function recordRuleResult(state, outcome = {}) {
  return recordGardenResult(state, 'rule', outcome);
}

export function recordDensityResult(state, outcome = {}) {
  return recordGardenResult(state, 'density', outcome);
}
