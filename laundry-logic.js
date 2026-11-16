export const LAUNDRY_STATE_VERSION = 1;
export const LAUNDRY_STORAGE_KEY = 'tablet-games.laundry.v1';

export const MOTOR_LEVELS = Object.freeze([1, 2, 3, 4]);
export const RULE_LEVELS = Object.freeze([1, 2, 3, 4]);
export const MULTI_MACHINE_LEVELS = Object.freeze([1, 2, 3]);

export const MIN_MOTOR_LEVEL = 1;
export const MAX_MOTOR_LEVEL = 4;
export const MIN_RULE_LEVEL = 1;
export const MAX_RULE_LEVEL = 4;
export const MIN_MULTI_MACHINE_LEVEL = 1;
export const MAX_MULTI_MACHINE_LEVEL = 3;

export const UP_STREAK = 2;
export const DOWN_STREAK = 2;

export const ITEM_KINDS = Object.freeze(['shirt', 'sock', 'towel']);

export const LAUNDRY_COLORS = Object.freeze({
  white: Object.freeze({ hex: '#f2f2ec', dark: false }),
  yellow: Object.freeze({ hex: '#f2c200', dark: false }),
  pink: Object.freeze({ hex: '#e87a9a', dark: false }),
  blue: Object.freeze({ hex: '#0057d9', dark: true }),
  green: Object.freeze({ hex: '#008a3c', dark: true }),
  red: Object.freeze({ hex: '#c40000', dark: true }),
});

export const ITEM_COLORS = Object.freeze(Object.keys(LAUNDRY_COLORS));

export const MIN_MACHINE_CAPACITY = 3;
export const MAX_MACHINE_CAPACITY = 4;
export const DEFAULT_MACHINE_CAPACITY = MIN_MACHINE_CAPACITY;

const DIMENSIONS = Object.freeze(['motor', 'rule']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function defaultDimension() {
  return { level: 1, successes: 0, failures: 0 };
}

function maxLevelFor(dimension) {
  return dimension === 'rule' ? MAX_RULE_LEVEL : MAX_MOTOR_LEVEL;
}

function normalizeDimension(value, maxLevel) {
  const source = isPlainObject(value) ? value : {};
  return {
    level: clampLevel(source.level, 1, maxLevel),
    successes: clampCount(source.successes),
    failures: clampCount(source.failures),
  };
}

export function randomMachineCapacity(rng = Math.random) {
  return pickIndex(2, rng) === 0 ? MIN_MACHINE_CAPACITY : MAX_MACHINE_CAPACITY;
}

export function createMachine(rng = Math.random) {
  return {
    capacity: randomMachineCapacity(rng),
    count: 0,
    washes: 0,
  };
}

export function normalizeMachine(machine) {
  const source = isPlainObject(machine) ? machine : {};
  const capacity = clampInteger(
    source.capacity,
    MIN_MACHINE_CAPACITY,
    MAX_MACHINE_CAPACITY,
    DEFAULT_MACHINE_CAPACITY,
  );
  return {
    capacity,
    count: clampInteger(source.count, 0, capacity, 0),
    washes: clampCount(source.washes),
  };
}

export function addItemToMachine(machine) {
  const next = normalizeMachine(machine);
  next.count = Math.min(next.capacity, next.count + 1);
  return next;
}

export function isMachineFull(machine) {
  const next = normalizeMachine(machine);
  return next.count >= next.capacity;
}

export function machineRoom(machine) {
  const next = normalizeMachine(machine);
  return Math.max(0, next.capacity - next.count);
}

export function washMachine(machine, rng = Math.random) {
  const next = normalizeMachine(machine);
  return {
    capacity: randomMachineCapacity(rng),
    count: 0,
    washes: next.washes + 1,
  };
}

export function createDefaultLaundryState(rng = Math.random) {
  return {
    version: LAUNDRY_STATE_VERSION,
    motor: defaultDimension(),
    rule: defaultDimension(),
    machine: createMachine(rng),
  };
}

export function normalizeLaundryState(state) {
  if (!isPlainObject(state)) {
    return {
      version: LAUNDRY_STATE_VERSION,
      motor: defaultDimension(),
      rule: defaultDimension(),
      machine: normalizeMachine(null),
    };
  }
  return {
    version: LAUNDRY_STATE_VERSION,
    motor: normalizeDimension(state.motor, MAX_MOTOR_LEVEL),
    rule: normalizeDimension(state.rule, MAX_RULE_LEVEL),
    machine: normalizeMachine(state.machine),
  };
}

export function serializeLaundryState(state) {
  return JSON.stringify(normalizeLaundryState(state));
}

export function parseLaundryState(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return normalizeLaundryState(null);
  }
  try {
    return normalizeLaundryState(JSON.parse(text));
  } catch {
    return normalizeLaundryState(null);
  }
}

export function loadLaundryState(storage) {
  if (!storage || typeof storage.getItem !== 'function') {
    return normalizeLaundryState(null);
  }
  try {
    return parseLaundryState(storage.getItem(LAUNDRY_STORAGE_KEY));
  } catch {
    return normalizeLaundryState(null);
  }
}

export function saveLaundryState(storage, state) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(LAUNDRY_STORAGE_KEY, serializeLaundryState(state));
    return true;
  } catch {
    return false;
  }
}

export function recordLaundryResult(state, dimension, outcome = {}) {
  if (!DIMENSIONS.includes(dimension)) {
    throw new RangeError(`Unknown laundry dimension: ${dimension}`);
  }

  const next = normalizeLaundryState(state);
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

  const maxLevel = maxLevelFor(dimension);
  let changed = false;

  if (entry.failures >= DOWN_STREAK && entry.level > 1) {
    entry.level -= 1;
    changed = true;
  } else if (entry.successes >= UP_STREAK && entry.level < maxLevel) {
    entry.level += 1;
    changed = true;
  }

  if (changed) {
    entry.successes = 0;
    entry.failures = 0;
  }

  return next;
}

export function recordMotorResult(state, outcome = {}) {
  return recordLaundryResult(state, 'motor', outcome);
}

export function recordRuleResult(state, outcome = {}) {
  return recordLaundryResult(state, 'rule', outcome);
}

export function createItem(kind, color) {
  return {
    kind: ITEM_KINDS.includes(kind) ? kind : ITEM_KINDS[0],
    color: LAUNDRY_COLORS[color] ? color : ITEM_COLORS[0],
  };
}

export function normalizeItem(item) {
  const source = isPlainObject(item) ? item : {};
  return createItem(source.kind, source.color);
}

export function generateItem(rng = Math.random) {
  return createItem(
    ITEM_KINDS[pickIndex(ITEM_KINDS.length, rng)],
    ITEM_COLORS[pickIndex(ITEM_COLORS.length, rng)],
  );
}

export function isDark(item) {
  const color = typeof item === 'string' ? item : isPlainObject(item) ? item.color : null;
  return LAUNDRY_COLORS[color]?.dark === true;
}

export function ruleAcceptsItem(ruleLevel, item) {
  const level = clampLevel(ruleLevel, MIN_RULE_LEVEL, MAX_RULE_LEVEL);
  if (level === 2) return isDark(item);
  if (level === 3) return normalizeItem(item).kind === 'sock';
  return true;
}

export function needsDetergent(ruleLevel, detergentFlagged = false) {
  const level = clampLevel(ruleLevel, MIN_RULE_LEVEL, MAX_RULE_LEVEL);
  return level === 4 && detergentFlagged === true;
}

export function isDetergentSatisfied(ruleLevel, context = {}) {
  const source = isPlainObject(context) ? context : {};
  return !needsDetergent(ruleLevel, source.detergentFlagged) || source.detergentTapped === true;
}

export function shouldAcceptItem(ruleLevel, item, context = {}) {
  return ruleAcceptsItem(ruleLevel, item) && isDetergentSatisfied(ruleLevel, context);
}

function toPoint(value) {
  if (!isPlainObject(value)) return null;
  const x = toFiniteNumber(value.x);
  const y = toFiniteNumber(value.y);
  if (x === null || y === null) return null;
  return { x, y };
}

function toRect(value) {
  if (!isPlainObject(value)) return null;
  const x = toFiniteNumber(value.x);
  const y = toFiniteNumber(value.y);
  const width = toFiniteNumber(value.width);
  const height = toFiniteNumber(value.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width < 0 || height < 0) return null;
  return { x, y, width, height };
}

export function isPointInRect(point, rect) {
  const p = toPoint(point);
  const r = toRect(rect);
  if (!p || !r) return false;
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

function itemGeometry(item) {
  if (!isPlainObject(item)) return { center: null, radius: null, bounds: null };

  const center = toPoint(item.center) || toPoint(item);
  const radius = toFiniteNumber(item.radius);

  let bounds = toRect(item.bounds);
  if (!bounds && center && radius !== null && radius >= 0) {
    bounds = {
      x: center.x - radius,
      y: center.y - radius,
      width: radius * 2,
      height: radius * 2,
    };
  }

  return {
    center,
    radius: radius !== null && radius >= 0 ? radius : null,
    bounds,
  };
}

function tapWithinCircle(point, center, radius) {
  if (!point || !center || radius === null) return false;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return Math.sqrt(dx * dx + dy * dy) <= radius * 2;
}

export function motorHitTest(motorLevel, options = {}) {
  const source = isPlainObject(options) ? options : {};
  const level = clampLevel(motorLevel, MIN_MOTOR_LEVEL, MAX_MOTOR_LEVEL);
  const point = toPoint(source.point) || toPoint(source.dragEnd);

  if (!point) return false;
  if (level === 1) return true;

  const geometry = itemGeometry(source.item);
  if (level === 2) return tapWithinCircle(point, geometry.center, geometry.radius);
  if (level === 3) return isPointInRect(point, geometry.bounds);

  return isPointInRect(point, source.machineZone);
}
