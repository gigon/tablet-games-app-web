// Shared level ladder for registry games (see DEV_GUIDE.md).
//
// A ladder is a set of independent dimensions (motor, rule, density, tempo ...), each with
// a level from `min` to `max`. The rules are the same as in the first three games:
//   - up after UP_STREAK clean results in a row, down after DOWN_STREAK not-clean in a row
//   - idle and timeouts never count
//   - recordAll() moves at most ONE dimension up per call ("one axis per unit boundary")
// The state shape is { version, <dimension>: { level, successes, failures }, lastRaised }.

export const UP_STREAK = 2;
export const DOWN_STREAK = 2;
export const LADDER_STATE_VERSION = 1;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeDimensionDef(dimension) {
  if (!isPlainObject(dimension) || typeof dimension.id !== 'string' || dimension.id === '') {
    throw new TypeError('A ladder dimension needs an id.');
  }
  const min = clampInteger(dimension.min, 1, 99, 1);
  const max = clampInteger(dimension.max, min, 99, min);
  return Object.freeze({
    ...dimension,
    id: dimension.id,
    min,
    max,
    option: typeof dimension.option === 'string' ? dimension.option : `${dimension.id}Level`,
  });
}

export function createLadder({ storageKey, dimensions } = {}) {
  if (typeof storageKey !== 'string' || storageKey.trim() === '') {
    throw new TypeError('A ladder needs a storageKey.');
  }
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    throw new TypeError('A ladder needs at least one dimension.');
  }
  const defs = Object.freeze(dimensions.map(normalizeDimensionDef));
  const ids = defs.map((def) => def.id);
  if (new Set(ids).size !== ids.length) throw new TypeError('Ladder dimension ids must be unique.');
  for (const id of ids) {
    if (id === 'version' || id === 'lastRaised') {
      throw new TypeError(`"${id}" is reserved and cannot be a dimension id.`);
    }
  }

  function createDefault() {
    const state = { version: LADDER_STATE_VERSION, lastRaised: null };
    for (const def of defs) state[def.id] = { level: def.min, successes: 0, failures: 0 };
    return state;
  }

  function normalize(state) {
    if (!isPlainObject(state)) return createDefault();
    const next = {
      version: LADDER_STATE_VERSION,
      lastRaised: ids.includes(state.lastRaised) ? state.lastRaised : null,
    };
    for (const def of defs) {
      const source = isPlainObject(state[def.id]) ? state[def.id] : {};
      next[def.id] = {
        level: clampInteger(source.level, def.min, def.max, def.min),
        successes: clampInteger(source.successes, 0, UP_STREAK, 0),
        failures: clampInteger(source.failures, 0, DOWN_STREAK, 0),
      };
    }
    return next;
  }

  function parse(text) {
    if (typeof text !== 'string' || text.trim() === '') return createDefault();
    try {
      return normalize(JSON.parse(text));
    } catch {
      return createDefault();
    }
  }

  function load(storage) {
    if (!storage || typeof storage.getItem !== 'function') return createDefault();
    try {
      return parse(storage.getItem(storageKey));
    } catch {
      return createDefault();
    }
  }

  function save(storage, state) {
    if (!storage || typeof storage.setItem !== 'function') return false;
    try {
      storage.setItem(storageKey, JSON.stringify(normalize(state)));
      return true;
    } catch {
      return false;
    }
  }

  function levels(state) {
    const current = normalize(state);
    const result = {};
    for (const def of defs) result[def.id] = current[def.id].level;
    return result;
  }

  // results: { motor: true, rule: false, density: null }. true = clean, false = not clean,
  // null / undefined / missing = no information (idle), the streaks are left alone.
  function recordAll(state, results = {}) {
    const next = normalize(state);
    const source = isPlainObject(results) ? results : {};

    for (const def of defs) {
      const result = source[def.id];
      if (result !== true && result !== false) continue;
      const entry = next[def.id];
      if (result) {
        entry.successes = Math.min(UP_STREAK, entry.successes + 1);
        entry.failures = 0;
      } else {
        entry.failures += 1;
        entry.successes = 0;
        if (entry.failures >= DOWN_STREAK) {
          if (entry.level > def.min) entry.level -= 1;
          entry.failures = 0;
        }
      }
    }

    // At most one dimension goes up, taking turns: start after the one raised last time.
    const start = ids.indexOf(next.lastRaised) + 1;
    for (let offset = 0; offset < defs.length; offset += 1) {
      const def = defs[(start + offset) % defs.length];
      const entry = next[def.id];
      if (entry.successes < UP_STREAK) continue;
      if (entry.level >= def.max) {
        entry.successes = 0;
        continue;
      }
      entry.level += 1;
      entry.successes = 0;
      next.lastRaised = def.id;
      break;
    }

    return next;
  }

  function record(state, dimensionId, outcome = {}) {
    if (!ids.includes(dimensionId)) {
      throw new RangeError(`Unknown ladder dimension: ${dimensionId}`);
    }
    const result =
      typeof outcome === 'boolean' ? { success: outcome } : isPlainObject(outcome) ? outcome : {};
    if (result.timeout === true || result.idle === true) return normalize(state);
    return recordAll(state, { [dimensionId]: result.success === true });
  }

  // Default mapping from a game's onSuccess / onFailure call to dimension results:
  //   info.results given          -> used as is (the game knows best)
  //   success                     -> every dimension clean
  //   failure with info.reason    -> that dimension not clean (first dimension if unknown)
  function adapt(state, { success, reason, info } = {}) {
    const details = isPlainObject(info) ? info : {};
    if (isPlainObject(details.results)) return recordAll(state, details.results);
    if (success === true) {
      return recordAll(state, Object.fromEntries(ids.map((id) => [id, true])));
    }
    const failed = ids.includes(reason) ? reason : ids[0];
    return recordAll(state, { [failed]: false });
  }

  return Object.freeze({
    storageKey,
    dimensions: defs,
    createDefault,
    normalize,
    parse,
    load,
    save,
    levels,
    record,
    recordAll,
    adapt,
  });
}
