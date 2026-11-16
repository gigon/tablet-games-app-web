export const MUSIC_STATE_VERSION = 1;
export const MUSIC_STORAGE_KEY = 'tabletGames.music';

export const MOTOR_LEVELS = Object.freeze([1, 2, 3, 4]);
export const RULE_LEVELS = Object.freeze([1, 2]);

export const MIN_MOTOR_LEVEL = 1;
export const MAX_MOTOR_LEVEL = 4;
export const MIN_RULE_LEVEL = 1;
export const MAX_RULE_LEVEL = 2;

export const UP_STREAK = 2;
export const DOWN_STREAK = 2;

export const PAD_COLOR_KEYS = Object.freeze(['red', 'blue', 'green', 'yellow']);

export const SONGS = Object.freeze([
  Object.freeze({
    id: 'ode-to-joy',
    names: Object.freeze({ he: 'אודה לשמחה', en: 'Ode to Joy' }),
    bpm: 100,
    notes: Object.freeze([
      Object.freeze([64, 1]),
      Object.freeze([64, 1]),
      Object.freeze([65, 1]),
      Object.freeze([67, 1]),
      Object.freeze([67, 1]),
      Object.freeze([65, 1]),
      Object.freeze([64, 1]),
      Object.freeze([62, 1]),
      Object.freeze([60, 1]),
      Object.freeze([60, 1]),
      Object.freeze([62, 1]),
      Object.freeze([64, 1]),
      Object.freeze([64, 1.5]),
      Object.freeze([62, 0.5]),
      Object.freeze([62, 2]),
      Object.freeze([64, 1]),
      Object.freeze([64, 1]),
      Object.freeze([65, 1]),
      Object.freeze([67, 1]),
      Object.freeze([67, 1]),
      Object.freeze([65, 1]),
      Object.freeze([64, 1]),
      Object.freeze([62, 1]),
      Object.freeze([60, 1]),
      Object.freeze([60, 1]),
      Object.freeze([62, 1]),
      Object.freeze([64, 1]),
      Object.freeze([62, 1.5]),
      Object.freeze([60, 0.5]),
      Object.freeze([60, 2]),
    ]),
    phrases: Object.freeze([15, 15]),
    license: 'public-domain',
  }),
  Object.freeze({
    id: 'twinkle-twinkle',
    names: Object.freeze({ he: 'כוכב קטן', en: 'Twinkle Twinkle Little Star' }),
    bpm: 110,
    notes: Object.freeze([
      Object.freeze([60, 1]),
      Object.freeze([60, 1]),
      Object.freeze([67, 1]),
      Object.freeze([67, 1]),
      Object.freeze([69, 1]),
      Object.freeze([69, 1]),
      Object.freeze([67, 2]),
      Object.freeze([65, 1]),
      Object.freeze([65, 1]),
      Object.freeze([64, 1]),
      Object.freeze([64, 1]),
      Object.freeze([62, 1]),
      Object.freeze([62, 1]),
      Object.freeze([60, 2]),
      Object.freeze([67, 1]),
      Object.freeze([67, 1]),
      Object.freeze([65, 1]),
      Object.freeze([65, 1]),
      Object.freeze([64, 1]),
      Object.freeze([64, 1]),
      Object.freeze([62, 2]),
      Object.freeze([67, 1]),
      Object.freeze([67, 1]),
      Object.freeze([65, 1]),
      Object.freeze([65, 1]),
      Object.freeze([64, 1]),
      Object.freeze([64, 1]),
      Object.freeze([62, 2]),
      Object.freeze([60, 1]),
      Object.freeze([60, 1]),
      Object.freeze([67, 1]),
      Object.freeze([67, 1]),
      Object.freeze([69, 1]),
      Object.freeze([69, 1]),
      Object.freeze([67, 2]),
      Object.freeze([65, 1]),
      Object.freeze([65, 1]),
      Object.freeze([64, 1]),
      Object.freeze([64, 1]),
      Object.freeze([62, 1]),
      Object.freeze([62, 1]),
      Object.freeze([60, 2]),
    ]),
    phrases: Object.freeze([7, 7, 7, 7, 7, 7]),
    license: 'public-domain',
  }),
]);

const DIMENSIONS = Object.freeze(['motor', 'rule']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPositiveFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
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

export function isValidNote(note) {
  if (!Array.isArray(note) || note.length !== 2) return false;
  const [midi, beats] = note;
  return (
    Number.isInteger(midi) &&
    midi >= 36 &&
    midi <= 96 &&
    isPositiveFinite(beats)
  );
}

export function validateSong(song) {
  if (!isPlainObject(song)) return false;
  if (!isNonEmptyString(song.id)) return false;
  if (!isPlainObject(song.names)) return false;
  if (!isNonEmptyString(song.names.he) || !isNonEmptyString(song.names.en)) return false;
  if (!isPositiveFinite(song.bpm)) return false;
  if (!Array.isArray(song.notes) || song.notes.length === 0) return false;
  if (!song.notes.every(isValidNote)) return false;
  if (!Array.isArray(song.phrases) || song.phrases.length === 0) return false;

  let total = 0;
  for (const count of song.phrases) {
    if (!Number.isInteger(count) || count <= 0) return false;
    total += count;
  }
  if (total !== song.notes.length) return false;

  return isNonEmptyString(song.license);
}

export function normalizeSong(song) {
  return validateSong(song) ? song : null;
}

export function padsForLevel(motorLevel) {
  const level = clampLevel(motorLevel, MIN_MOTOR_LEVEL, MAX_MOTOR_LEVEL);
  const pads = [];
  for (let index = 0; index < level; index += 1) {
    pads.push({ index, colorKey: PAD_COLOR_KEYS[index] });
  }
  return pads;
}

export function padForNote(song, noteIndex, padCount) {
  const count = clampInteger(padCount, 1, PAD_COLOR_KEYS.length, 1);
  if (count === 1) return 0;
  if (!validateSong(song)) return 0;

  const index = clampInteger(noteIndex, 0, song.notes.length - 1, 0);
  const pitches = [...new Set(song.notes.map((note) => note[0]))].sort((a, b) => a - b);
  const rank = pitches.indexOf(song.notes[index][0]);
  if (rank < 0) return 0;
  return rank % count;
}

function phraseEnds(song) {
  const ends = [];
  let total = 0;
  for (const count of song.phrases) {
    total += count;
    ends.push(total);
  }
  return ends;
}

export function createSession(song) {
  const source = validateSong(song) ? song : normalizeSong(SONGS[0]);
  return {
    song: source,
    noteIndex: 0,
    phraseIndex: 0,
    phraseDone: false,
    songDone: source.notes.length === 0,
  };
}

export function currentNote(session) {
  if (!isPlainObject(session) || !validateSong(session.song)) return null;
  if (session.songDone === true) return null;
  const index = clampInteger(session.noteIndex, 0, session.song.notes.length - 1, 0);
  if (index >= session.song.notes.length) return null;
  const note = session.song.notes[index];
  return [note[0], note[1]];
}

export function advance(session) {
  if (!isPlainObject(session) || !validateSong(session.song)) {
    return createSession(null);
  }

  const done = session.songDone === true;
  const next = {
    song: session.song,
    noteIndex: done
      ? session.song.notes.length
      : clampInteger(session.noteIndex, 0, session.song.notes.length - 1, 0),
    phraseIndex: clampInteger(session.phraseIndex, 0, session.song.phrases.length - 1, 0),
    phraseDone: done === true && session.phraseDone === true,
    songDone: done,
  };

  if (next.songDone) return next;

  next.noteIndex += 1;
  const ends = phraseEnds(session.song);

  if (next.noteIndex >= session.song.notes.length) {
    next.noteIndex = session.song.notes.length;
    next.phraseDone = true;
    next.songDone = true;
    next.phraseIndex = session.song.phrases.length - 1;
    return next;
  }

  const end = ends[next.phraseIndex];
  if (next.noteIndex === end) {
    next.phraseDone = true;
    if (next.phraseIndex < session.song.phrases.length - 1) {
      next.phraseIndex += 1;
    }
  }

  return next;
}

export function createDefaultMusicState() {
  return {
    version: MUSIC_STATE_VERSION,
    motor: defaultDimension(),
    rule: defaultDimension(),
  };
}

export function normalizeMusicState(state) {
  if (!isPlainObject(state)) {
    return createDefaultMusicState();
  }
  return {
    version: MUSIC_STATE_VERSION,
    motor: normalizeDimension(state.motor, MAX_MOTOR_LEVEL),
    rule: normalizeDimension(state.rule, MAX_RULE_LEVEL),
  };
}

export function serializeMusicState(state) {
  return JSON.stringify(normalizeMusicState(state));
}

export function parseMusicState(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return normalizeMusicState(null);
  }
  try {
    return normalizeMusicState(JSON.parse(text));
  } catch {
    return normalizeMusicState(null);
  }
}

export function loadMusicState(storage) {
  if (!storage || typeof storage.getItem !== 'function') {
    return normalizeMusicState(null);
  }
  try {
    return parseMusicState(storage.getItem(MUSIC_STORAGE_KEY));
  } catch {
    return normalizeMusicState(null);
  }
}

export function saveMusicState(storage, state) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(MUSIC_STORAGE_KEY, serializeMusicState(state));
    return true;
  } catch {
    return false;
  }
}

export function recordMusicResult(state, dimension, outcome = {}) {
  if (!DIMENSIONS.includes(dimension)) {
    throw new RangeError(`Unknown music dimension: ${dimension}`);
  }

  const next = normalizeMusicState(state);
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
  return recordMusicResult(state, 'motor', outcome);
}

export function recordRuleResult(state, outcome = {}) {
  return recordMusicResult(state, 'rule', outcome);
}
