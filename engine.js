import {
  DEFAULT_GENDER,
  DEFAULT_LANGUAGE,
  LANGUAGES,
  normalizeGender,
  normalizeLanguage,
} from './i18n.js';
import { validateSong } from './music-logic.js';
import {
  LEGACY_GAME_TYPES,
  REGISTERED_TYPES,
  isRegisteredType,
  starterPackGames,
} from './registry.js';

// Every playable type: the three old prompt games plus whatever registry.js registers.
export const GAME_TYPES = Object.freeze([...LEGACY_GAME_TYPES, ...REGISTERED_TYPES]);

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;

export const UP_STREAK = 2;
export const DOWN_STREAK = 2;
export const ROUNDS_PER_TYPE = 5;
export const IDLE_PROMPT_DELAY_MS = 20000;
export const IDLE_PROMPT_COOLDOWN_MS = 60000;

export const DEFAULT_SPEECH_RATE = 0.88;
export const MIN_SPEECH_RATE = 0.5;
export const MAX_SPEECH_RATE = 1.5;

const HISTORY_SIZE = 8;

export const STATE_VERSION = 1;
export const STORAGE_KEY = 'tablet-games.state.v1';
export const PACKS_CACHE_KEY = 'tablet-games.packs.v1';

export const COLOR_TONES = Object.freeze({
  red: Object.freeze({ hex: '#d40000', tone: 392 }),
  blue: Object.freeze({ hex: '#0057d9', tone: 440 }),
  yellow: Object.freeze({ hex: '#f2c200', tone: 494 }),
  green: Object.freeze({ hex: '#008a3c', tone: 523 }),
  orange: Object.freeze({ hex: '#e86a00', tone: 587 }),
  purple: Object.freeze({ hex: '#7b2fbe', tone: 659 }),
  pink: Object.freeze({ hex: '#d81b60', tone: 698 }),
});

const VALID_COLORS = Object.freeze(Object.keys(COLOR_TONES));

const EMOJI_ONLY =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F|\u200D|\u20E3|[\u{1F1E6}-\u{1F1FF}])+$/u;

export const STARTER_THEMES = Object.freeze([
  Object.freeze({
    id: 'animals',
    names: Object.freeze({ he: 'בעלי חיים', en: 'Animals' }),
    items: Object.freeze([
      Object.freeze({ id: 'cat', emoji: '🐱', names: Object.freeze({ he: 'חתול', en: 'cat' }) }),
      Object.freeze({ id: 'dog', emoji: '🐶', names: Object.freeze({ he: 'כלב', en: 'dog' }) }),
      Object.freeze({ id: 'rabbit', emoji: '🐰', names: Object.freeze({ he: 'ארנב', en: 'rabbit' }) }),
      Object.freeze({ id: 'fish', emoji: '🐟', names: Object.freeze({ he: 'דג', en: 'fish' }) }),
      Object.freeze({ id: 'bird', emoji: '🐦', names: Object.freeze({ he: 'ציפור', en: 'bird' }) }),
      Object.freeze({ id: 'elephant', emoji: '🐘', names: Object.freeze({ he: 'פיל', en: 'elephant' }) }),
    ]),
  }),
  Object.freeze({
    id: 'instruments',
    names: Object.freeze({ he: 'כלי נגינה', en: 'Instruments' }),
    items: Object.freeze([
      Object.freeze({ id: 'violin', emoji: '🎻', names: Object.freeze({ he: 'כינור', en: 'violin' }) }),
      Object.freeze({ id: 'piano', emoji: '🎹', names: Object.freeze({ he: 'פסנתר', en: 'piano' }) }),
      Object.freeze({ id: 'guitar', emoji: '🎸', names: Object.freeze({ he: 'גיטרה', en: 'guitar' }) }),
      Object.freeze({ id: 'drum', emoji: '🥁', names: Object.freeze({ he: 'תוף', en: 'drum' }) }),
      Object.freeze({ id: 'trumpet', emoji: '🎺', names: Object.freeze({ he: 'חצוצרה', en: 'trumpet' }) }),
    ]),
  }),
  Object.freeze({
    id: 'fruit',
    names: Object.freeze({ he: 'פירות', en: 'Fruit' }),
    items: Object.freeze([
      Object.freeze({ id: 'apple', emoji: '🍎', names: Object.freeze({ he: 'תפוח', en: 'apple' }) }),
      Object.freeze({ id: 'banana', emoji: '🍌', names: Object.freeze({ he: 'בננה', en: 'banana' }) }),
      Object.freeze({ id: 'grapes', emoji: '🍇', names: Object.freeze({ he: 'ענבים', en: 'grapes' }) }),
      Object.freeze({ id: 'orange', emoji: '🍊', names: Object.freeze({ he: 'תפוז', en: 'orange' }) }),
      Object.freeze({ id: 'strawberry', emoji: '🍓', names: Object.freeze({ he: 'תות', en: 'strawberry' }) }),
      Object.freeze({ id: 'watermelon', emoji: '🍉', names: Object.freeze({ he: 'אבטיח', en: 'watermelon' }) }),
    ]),
  }),
  Object.freeze({
    id: 'vehicles',
    names: Object.freeze({ he: 'כלי רכב', en: 'Vehicles' }),
    items: Object.freeze([
      Object.freeze({ id: 'car', emoji: '🚗', names: Object.freeze({ he: 'מכונית', en: 'car' }) }),
      Object.freeze({ id: 'bus', emoji: '🚌', names: Object.freeze({ he: 'אוטובוס', en: 'bus' }) }),
      Object.freeze({ id: 'bicycle', emoji: '🚲', names: Object.freeze({ he: 'אופניים', en: 'bicycle' }) }),
      Object.freeze({ id: 'train', emoji: '🚂', names: Object.freeze({ he: 'רכבת', en: 'train' }) }),
      Object.freeze({ id: 'airplane', emoji: '✈️', names: Object.freeze({ he: 'מטוס', en: 'airplane' }) }),
      Object.freeze({ id: 'boat', emoji: '⛵', names: Object.freeze({ he: 'סירה', en: 'boat' }) }),
    ]),
  }),
]);

export function isEmojiOnly(value) {
  return typeof value === 'string' && value.length > 0 && EMOJI_ONLY.test(value);
}

const REGISTRY_LEVEL_PARAMS = Object.freeze({
  1: Object.freeze({ targets: 1, targetSize: 340, choices: 2 }),
  2: Object.freeze({ targets: 1, targetSize: 320, choices: 2 }),
  3: Object.freeze({ targets: 1, targetSize: 300, choices: 2 }),
  4: Object.freeze({ targets: 1, targetSize: 280, choices: 2 }),
  5: Object.freeze({ targets: 1, targetSize: 260, choices: 2 }),
});

export const LEVEL_PARAMS = Object.freeze({
  buttons: Object.freeze({
    1: Object.freeze({ targets: 1, targetSize: 260, choices: 2 }),
    2: Object.freeze({ targets: 1, targetSize: 230, choices: 3 }),
    3: Object.freeze({ targets: 1, targetSize: 205, choices: 4 }),
    4: Object.freeze({ targets: 1, targetSize: 180, choices: 5 }),
    5: Object.freeze({ targets: 1, targetSize: 160, choices: 6 }),
  }),
  drag: Object.freeze({
    1: Object.freeze({ targets: 2, targetSize: 200, choices: 2 }),
    2: Object.freeze({ targets: 3, targetSize: 185, choices: 2 }),
    3: Object.freeze({ targets: 4, targetSize: 165, choices: 2 }),
    4: Object.freeze({ targets: 5, targetSize: 145, choices: 2 }),
    5: Object.freeze({ targets: 6, targetSize: 125, choices: 2 }),
  }),
  count: Object.freeze({
    1: Object.freeze({ targets: 2, targetSize: 170, choices: 2 }),
    2: Object.freeze({ targets: 3, targetSize: 155, choices: 3 }),
    3: Object.freeze({ targets: 4, targetSize: 140, choices: 4 }),
    4: Object.freeze({ targets: 5, targetSize: 125, choices: 5 }),
    5: Object.freeze({ targets: 5, targetSize: 110, choices: 6 }),
  }),
  // Registry games keep their own level state (see registry.js); the engine only needs a
  // 1-5 table for them so the shared level and status code keeps working.
  ...Object.fromEntries(REGISTERED_TYPES.map((type) => [type, REGISTRY_LEVEL_PARAMS])),
});

export const BUILTIN_STARTER_PACK = Object.freeze({
  version: 1,
  id: 'starter',
  name: 'Starter',
  themes: STARTER_THEMES,
  games: starterPackGames(),
});

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clampLevel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return MIN_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(number)));
}

function normalizeLevels(levels) {
  const source = isPlainObject(levels) ? levels : {};
  return Object.fromEntries(GAME_TYPES.map((type) => [type, clampLevel(source[type])]));
}

function normalizeFixedLevel(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return clampLevel(number);
}

function normalizeFixedLevels(levels) {
  const source = isPlainObject(levels) ? levels : {};
  return Object.fromEntries(GAME_TYPES.map((type) => [type, normalizeFixedLevel(source[type])]));
}

function normalizeSelectedGame(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim().slice(0, 120);
  return id === '' ? null : id;
}

function normalizeVoiceURI(value) {
  if (typeof value !== 'string') return null;
  const uri = value.trim().slice(0, 300);
  return uri === '' ? null : uri;
}

function normalizeSpeechRate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SPEECH_RATE;
  const clamped = Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, number));
  return Math.round(clamped * 100) / 100;
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeThemes(themes) {
  if (!Array.isArray(themes)) return null;
  const seen = new Set();
  const result = [];
  for (const entry of themes) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function normalizeRecent(recent) {
  if (!Array.isArray(recent)) return [];
  return recent
    .slice(-HISTORY_SIZE)
    .filter((entry) => isPlainObject(entry) && typeof entry.success === 'boolean')
    .map((entry) => {
      const reaction = Number(entry.reactionMs);
      return {
        success: entry.success,
        timeout: entry.timeout === true,
        reactionMs: Number.isFinite(reaction) && reaction >= 0 ? reaction : null,
      };
    });
}

function normalizeStats(stats) {
  const source = isPlainObject(stats) ? stats : {};
  const result = {};
  for (const type of GAME_TYPES) {
    const entry = isPlainObject(source[type]) ? source[type] : {};
    result[type] = {
      successes: Math.max(0, Math.floor(Number(entry.successes) || 0)),
      failures: Math.max(0, Math.floor(Number(entry.failures) || 0)),
      recent: normalizeRecent(entry.recent),
    };
  }
  return result;
}

export function createDefaultState(name = '') {
  return {
    version: STATE_VERSION,
    name: typeof name === 'string' ? name.trim().slice(0, 40) : '',
    language: DEFAULT_LANGUAGE,
    gender: DEFAULT_GENDER,
    themes: null,
    levels: Object.fromEntries(GAME_TYPES.map((type) => [type, MIN_LEVEL])),
    fixedLevels: Object.fromEntries(GAME_TYPES.map((type) => [type, null])),
    selectedGame: null,
    speechMuted: false,
    voiceURI: null,
    speechRate: DEFAULT_SPEECH_RATE,
    showTextLabels: false,
    showStatusLine: true,
    stats: Object.fromEntries(
      GAME_TYPES.map((type) => [type, { successes: 0, failures: 0, recent: [] }]),
    ),
  };
}

export function normalizeState(state) {
  if (!isPlainObject(state)) return createDefaultState();
  return {
    version: STATE_VERSION,
    name: typeof state.name === 'string' ? state.name.trim().slice(0, 40) : '',
    language: normalizeLanguage(state.language),
    gender: normalizeGender(state.gender),
    themes: normalizeThemes(state.themes),
    levels: normalizeLevels(state.levels),
    fixedLevels: normalizeFixedLevels(state.fixedLevels),
    selectedGame: normalizeSelectedGame(state.selectedGame),
    speechMuted: normalizeBoolean(state.speechMuted, false),
    voiceURI: normalizeVoiceURI(state.voiceURI),
    speechRate: normalizeSpeechRate(state.speechRate),
    showTextLabels: normalizeBoolean(state.showTextLabels, false),
    showStatusLine: normalizeBoolean(state.showStatusLine, true),
    stats: normalizeStats(state.stats),
  };
}

export function setName(state, name) {
  const next = normalizeState(state);
  next.name = typeof name === 'string' ? name.trim().slice(0, 40) : '';
  return next;
}

export function setLanguage(state, language) {
  const next = normalizeState(state);
  next.language = normalizeLanguage(language);
  return next;
}

export function setGender(state, gender) {
  const next = normalizeState(state);
  next.gender = normalizeGender(gender);
  return next;
}

export function setThemes(state, themes) {
  const next = normalizeState(state);
  next.themes = normalizeThemes(themes);
  return next;
}

export function setSelectedGame(state, gameId) {
  const next = normalizeState(state);
  next.selectedGame = normalizeSelectedGame(gameId);
  return next;
}

export function setFixedLevel(state, gameType, level) {
  if (!GAME_TYPES.includes(gameType)) {
    throw new RangeError(`Unknown game type: ${gameType}`);
  }
  const next = normalizeState(state);
  next.fixedLevels[gameType] = normalizeFixedLevel(level);
  return next;
}

export function setSpeechMuted(state, muted) {
  const next = normalizeState(state);
  next.speechMuted = muted === true;
  return next;
}

export function setVoiceURI(state, voiceURI) {
  const next = normalizeState(state);
  next.voiceURI = normalizeVoiceURI(voiceURI);
  return next;
}

export function setSpeechRate(state, rate) {
  const next = normalizeState(state);
  next.speechRate = normalizeSpeechRate(rate);
  return next;
}

export function setShowTextLabels(state, show) {
  const next = normalizeState(state);
  next.showTextLabels = show === true;
  return next;
}

export function setShowStatusLine(state, show) {
  const next = normalizeState(state);
  next.showStatusLine = show === true;
  return next;
}

export function effectiveLevel(state, gameType) {
  if (!GAME_TYPES.includes(gameType)) {
    throw new RangeError(`Unknown game type: ${gameType}`);
  }
  const next = normalizeState(state);
  return next.fixedLevels[gameType] ?? next.levels[gameType];
}

export function getLevelParams(gameType, level) {
  if (!GAME_TYPES.includes(gameType)) {
    throw new RangeError(`Unknown game type: ${gameType}`);
  }
  return { ...LEVEL_PARAMS[gameType][clampLevel(level)] };
}

export function serializeState(state) {
  return JSON.stringify(normalizeState(state));
}

export function parseState(text) {
  if (typeof text !== 'string' || text.trim() === '') return createDefaultState();
  try {
    return normalizeState(JSON.parse(text));
  } catch {
    return createDefaultState();
  }
}

export function loadState(storage) {
  if (!storage || typeof storage.getItem !== 'function') return createDefaultState();
  try {
    return parseState(storage.getItem(STORAGE_KEY));
  } catch {
    return createDefaultState();
  }
}

export function saveState(storage, state) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(STORAGE_KEY, serializeState(state));
    return true;
  } catch {
    return false;
  }
}

export function recordResult(state, gameType, outcome = {}) {
  if (!GAME_TYPES.includes(gameType)) {
    throw new RangeError(`Unknown game type: ${gameType}`);
  }

  const next = normalizeState(state);
  const stats = next.stats[gameType];
  const result = isPlainObject(outcome) ? outcome : {};
  const success = result.success === true;
  const timeout = result.timeout === true;

  if (!success && timeout) {
    return next;
  }

  const reaction = Number(result.reactionMs);
  const reactionMs = Number.isFinite(reaction) && reaction >= 0 ? reaction : null;

  stats.recent.push({ success, timeout: false, reactionMs });
  if (stats.recent.length > HISTORY_SIZE) {
    stats.recent = stats.recent.slice(-HISTORY_SIZE);
  }

  if (success) {
    stats.successes += 1;
    stats.failures = 0;
  } else {
    stats.failures += 1;
    stats.successes = 0;
  }

  const level = next.levels[gameType];
  let changed = false;

  if (stats.failures >= DOWN_STREAK && level > MIN_LEVEL) {
    next.levels[gameType] = level - 1;
    changed = true;
  } else if (stats.successes >= UP_STREAK && level < MAX_LEVEL) {
    next.levels[gameType] = level + 1;
    changed = true;
  }

  if (changed) {
    stats.successes = 0;
    stats.failures = 0;
    stats.recent = [];
  }

  return next;
}

function normalizeTime(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function optionalTime(value) {
  if (value === null || value === undefined) return null;
  return normalizeTime(value, null);
}

export function createIdleState(now = 0) {
  return {
    lastTouchAt: normalizeTime(now, 0),
    lastPromptAt: null,
    prompted: false,
  };
}

export function noteTouch(idle, now = 0) {
  const current = isPlainObject(idle) ? idle : {};
  return {
    lastTouchAt: normalizeTime(now, 0),
    lastPromptAt: optionalTime(current.lastPromptAt),
    prompted: false,
  };
}

export function idlePromptDelay(idle, now = 0) {
  const current = isPlainObject(idle) ? idle : createIdleState(now);
  if (current.prompted === true) return null;

  const at = normalizeTime(now, 0);
  const lastTouchAt = normalizeTime(current.lastTouchAt, at);
  let dueAt = lastTouchAt + IDLE_PROMPT_DELAY_MS;

  const lastPromptAt = optionalTime(current.lastPromptAt);
  if (lastPromptAt !== null) {
    dueAt = Math.max(dueAt, lastPromptAt + IDLE_PROMPT_COOLDOWN_MS);
  }

  return Math.max(0, dueAt - at);
}

export function shouldRepeatIdlePrompt(idle, now = 0) {
  return idlePromptDelay(idle, now) === 0;
}

export function markIdlePromptRepeated(idle, now = 0) {
  const current = isPlainObject(idle) ? idle : {};
  return {
    lastTouchAt: normalizeTime(current.lastTouchAt, 0),
    lastPromptAt: normalizeTime(now, 0),
    prompted: true,
  };
}

export function chooseNextGame(games, currentGame, roundsPlayed = 0) {
  if (!Array.isArray(games) || games.length === 0) return null;

  const current =
    isPlainObject(currentGame) && games.includes(currentGame) ? currentGame : null;
  if (!current) return games[0];

  const played = Math.max(0, Math.floor(Number(roundsPlayed) || 0));
  const switchType = played >= ROUNDS_PER_TYPE;
  const filtered = games.filter((game) =>
    switchType ? game.type !== current.type : game.type === current.type,
  );
  const candidates = filtered.length ? filtered : games;
  const start = games.indexOf(current);

  for (let step = 1; step <= games.length; step += 1) {
    const game = games[(start + step) % games.length];
    if (candidates.includes(game)) return game;
  }

  return candidates[0];
}

export function chooseGameForRound(games, state, currentGame, roundsPlayed = 0) {
  if (!Array.isArray(games) || games.length === 0) return null;

  const selected = normalizeSelectedGame(isPlainObject(state) ? state.selectedGame : null);
  if (selected) {
    const fixed = games.find((game) => isPlainObject(game) && game.id === selected);
    if (fixed) return fixed;
  }

  return chooseNextGame(games, currentGame, roundsPlayed);
}

export function minutesPlayed(startedAt, now = Date.now()) {
  if (startedAt === null || startedAt === undefined) return 0;
  const start = Number(startedAt);
  const end = Number(now);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 60000));
}

function validatePrompt(game, at, errors, needsColor) {
  if (typeof game.prompt !== 'string' || game.prompt.trim() === '') {
    errors.push(`${at}.prompt must be a non-empty string`);
    return;
  }
  if (!game.prompt.includes('{name}')) {
    errors.push(`${at}.prompt must include {name}`);
  }
  if (needsColor && !game.prompt.includes('{color}')) {
    errors.push(`${at}.prompt must include {color}`);
  }
}

function validateTranslations(game, at, errors) {
  if (game.translations === undefined) return;
  if (!isPlainObject(game.translations)) {
    errors.push(`${at}.translations must be an object`);
    return;
  }

  for (const [language, localized] of Object.entries(game.translations)) {
    const path = `${at}.translations.${language}`;
    if (!LANGUAGES.includes(language)) {
      errors.push(`${path} uses an unsupported language`);
      continue;
    }
    if (!isPlainObject(localized)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    if (
      localized.title !== undefined &&
      (typeof localized.title !== 'string' || localized.title.trim() === '')
    ) {
      errors.push(`${path}.title must be a non-empty string when present`);
    }
    if (localized.prompt !== undefined) {
      validatePrompt(localized, path, errors, game.type === 'buttons');
    }
    if (localized.colors !== undefined) {
      if (!isPlainObject(localized.colors)) {
        errors.push(`${path}.colors must be an object when present`);
      } else {
        for (const [color, name] of Object.entries(localized.colors)) {
          if (!VALID_COLORS.includes(color)) {
            errors.push(`${path}.colors contains unknown colour "${color}"`);
          }
          if (typeof name !== 'string' || name.trim() === '') {
            errors.push(`${path}.colors.${color} must be a non-empty string`);
          }
        }
      }
    }
  }
}

function validateLocalizedNames(value, at, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${at} must be an object`);
    return;
  }
  for (const language of LANGUAGES) {
    if (typeof value[language] !== 'string' || value[language].trim() === '') {
      errors.push(`${at}.${language} must be a non-empty string`);
    }
  }
}

function validateThemes(themes, errors) {
  if (themes === undefined) return;
  if (!Array.isArray(themes)) {
    errors.push('pack.themes must be an array when present');
    return;
  }
  if (themes.length === 0) {
    errors.push('pack.themes must not be empty');
    return;
  }

  const themeIds = new Set();
  themes.forEach((theme, themeIndex) => {
    const at = `themes[${themeIndex}]`;
    if (!isPlainObject(theme)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (typeof theme.id !== 'string' || theme.id.trim() === '') {
      errors.push(`${at}.id must be a non-empty string`);
    } else if (themeIds.has(theme.id)) {
      errors.push(`${at}.id "${theme.id}" is duplicated`);
    } else {
      themeIds.add(theme.id);
    }
    validateLocalizedNames(theme.names, `${at}.names`, errors);

    if (!Array.isArray(theme.items) || theme.items.length === 0) {
      errors.push(`${at}.items must be a non-empty array`);
      return;
    }

    const itemIds = new Set();
    theme.items.forEach((item, itemIndex) => {
      const itemAt = `${at}.items[${itemIndex}]`;
      if (!isPlainObject(item)) {
        errors.push(`${itemAt} must be an object`);
        return;
      }
      if (typeof item.id !== 'string' || item.id.trim() === '') {
        errors.push(`${itemAt}.id must be a non-empty string`);
      } else if (itemIds.has(item.id)) {
        errors.push(`${itemAt}.id "${item.id}" is duplicated`);
      } else {
        itemIds.add(item.id);
      }
      if (!isEmojiOnly(item.emoji)) {
        errors.push(`${itemAt}.emoji must be a single emoji-only string`);
      }
      validateLocalizedNames(item.names, `${itemAt}.names`, errors);
    });
  });
}

export function validatePack(pack) {
  const errors = [];

  if (!isPlainObject(pack)) {
    return { valid: false, errors: ['Pack must be an object'], pack: null };
  }

  if (typeof pack.id !== 'string' || pack.id.trim() === '') {
    errors.push('pack.id must be a non-empty string');
  }
  if (typeof pack.name !== 'string' || pack.name.trim() === '') {
    errors.push('pack.name must be a non-empty string');
  }
  if (pack.version !== undefined && (!Number.isInteger(pack.version) || pack.version < 1)) {
    errors.push('pack.version must be a positive integer');
  }
  validateThemes(pack.themes, errors);
  if (!Array.isArray(pack.games) || pack.games.length === 0) {
    errors.push('pack.games must be a non-empty array');
    return { valid: false, errors, pack: null };
  }

  const seenIds = new Set();
  pack.games.forEach((game, index) => {
    const at = `games[${index}]`;
    if (!isPlainObject(game)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (!GAME_TYPES.includes(game.type)) {
      return;
    }
    if (typeof game.id !== 'string' || game.id.trim() === '') {
      errors.push(`${at}.id must be a non-empty string`);
    } else if (seenIds.has(game.id)) {
      errors.push(`${at}.id "${game.id}" is duplicated`);
    } else {
      seenIds.add(game.id);
    }
    if (game.title !== undefined && (typeof game.title !== 'string' || game.title.trim() === '')) {
      errors.push(`${at}.title must be a non-empty string when present`);
    }

    // Registry games draw their own scene and never read the pack prompt, so a pack may
    // leave it out for them. A prompt that is present is still checked.
    if (!isRegisteredType(game.type) || game.prompt !== undefined) {
      validatePrompt(game, at, errors, game.type === 'buttons');
    }
    validateTranslations(game, at, errors);

    if (game.type === 'buttons') {
      if (!Array.isArray(game.colors) || game.colors.length < 2) {
        errors.push(`${at}.colors must be an array of at least 2 colours`);
      } else {
        if (new Set(game.colors).size !== game.colors.length) {
          errors.push(`${at}.colors must not contain duplicates`);
        }
        for (const color of game.colors) {
          if (!VALID_COLORS.includes(color)) {
            errors.push(`${at}.colors contains unknown colour "${color}"`);
          }
        }
      }
    } else if (game.type === 'drag') {
      if (typeof game.item !== 'string' || game.item.trim() === '') {
        errors.push(`${at}.item must be a non-empty string`);
      }
    } else if (game.type === 'count') {
      if (!Array.isArray(game.objects) || game.objects.length === 0) {
        errors.push(`${at}.objects must be a non-empty array`);
      } else if (game.objects.some((object) => typeof object !== 'string' || object.trim() === '')) {
        errors.push(`${at}.objects must only contain non-empty strings`);
      }
    }
  });

  const valid = errors.length === 0;
  return { valid, errors, pack: valid ? pack : null };
}

export function validatePackIndex(index) {
  const files = Array.isArray(index)
    ? index
    : isPlainObject(index) && Array.isArray(index.packs)
      ? index.packs
      : null;
  if (!files || files.length === 0) {
    return { valid: false, errors: ['Pack index must list at least one pack file'], files: [] };
  }
  const errors = [];
  const validFiles = [];
  for (const file of files) {
    if (typeof file !== 'string' || file.trim() === '') {
      errors.push('Pack index entries must be non-empty strings');
      continue;
    }
    validFiles.push(file);
  }
  return { valid: errors.length === 0 && validFiles.length > 0, errors, files: validFiles };
}

export function packsToGames(packs) {
  const games = [];
  if (!Array.isArray(packs)) return games;
  for (const pack of packs) {
    const result = validatePack(pack);
    if (!result.valid) continue;
    for (const game of result.pack.games) {
      if (!GAME_TYPES.includes(game.type)) continue;
      games.push({ ...clone(game), packId: result.pack.id });
    }
  }
  return games;
}

export function packsToThemes(packs) {
  const themes = [];
  if (!Array.isArray(packs)) return themes;
  for (const pack of packs) {
    const result = validatePack(pack);
    if (!result.valid || !Array.isArray(result.pack.themes)) continue;
    for (const theme of result.pack.themes) {
      themes.push({ ...clone(theme), packId: result.pack.id });
    }
  }
  return themes;
}

export function packsToSongs(packs) {
  const songs = [];
  if (!Array.isArray(packs)) return songs;
  const seenIds = new Set();
  for (const pack of packs) {
    if (!isPlainObject(pack) || !Array.isArray(pack.songs)) continue;
    for (const song of pack.songs) {
      if (!validateSong(song)) continue;
      if (seenIds.has(song.id)) continue;
      seenIds.add(song.id);
      songs.push({ ...clone(song), packId: pack.id });
    }
  }
  return songs;
}

export function resolveThemes(themes, selected) {
  if (!Array.isArray(themes)) return [];
  if (selected === null || selected === undefined) return themes.slice();
  if (!Array.isArray(selected)) return [];
  const ids = new Set(selected.filter((id) => typeof id === 'string'));
  return themes.filter((theme) => isPlainObject(theme) && ids.has(theme.id));
}

export function themeItems(themes, selected) {
  const items = [];
  for (const theme of resolveThemes(themes, selected)) {
    if (!Array.isArray(theme.items)) continue;
    for (const item of theme.items) {
      items.push({ ...item, themeId: theme.id });
    }
  }
  return items;
}
