// The game registry: ONE entry per game. Everything else (engine game types, pack
// validation, rotation, the settings game list, the level choice, the status line, level
// state load/save/reset, the render call and the adaptation recorders) derives from here.
//
// To add a game: write <game>-logic.js and <game>.js, import them below and add one
// entry to GAME_ENTRIES. See DEV_GUIDE.md for the exact steps and the entry shape.
//
// Do not import engine.js or app.js from this file or from any game module: engine.js
// imports the registry, so that would be a circular import.

import { laundryItemName, formatLaundryPrompt } from './i18n.js';
import { createLadder } from './levels.js';
import {
  LAUNDRY_STORAGE_KEY,
  createDefaultLaundryState,
  loadLaundryState,
  recordMotorResult as recordLaundryMotor,
  recordRuleResult as recordLaundryRule,
  saveLaundryState,
} from './laundry-logic.js';
import { renderLaundry } from './laundry.js';
import {
  MUSIC_STORAGE_KEY,
  SONGS as BUILTIN_SONGS,
  createDefaultMusicState,
  loadMusicState,
  recordMotorResult as recordMusicMotor,
  recordRuleResult as recordMusicRule,
  saveMusicState,
} from './music-logic.js';
import { renderMusic } from './music.js';
import {
  GARDEN_STORAGE_KEY,
  createDefaultGardenState,
  loadGardenState,
  recordDensityResult as recordGardenDensity,
  recordMotorResult as recordGardenMotor,
  recordRuleResult as recordGardenRule,
  saveGardenState,
} from './garden-logic.js';
import { renderGarden } from './garden.js';
import { BUBBLE_LADDER } from './bubble-sheet-logic.js';
import { renderBubbleSheet } from './bubble-sheet.js';
import { NIGHT_LADDER } from './night-sky-logic.js';
import { renderNightSky } from './night-sky.js';
import { COLOUR_LADDER } from './colour-pop-logic.js';
import { renderColourPop } from './colour-pop.js';
import { PHRASES } from './phrases.js';

// The three old prompt-and-answer types are drawn by app.js itself and are not registry
// games. They stay valid game types so old saved state and old packs keep working.
export const LEGACY_GAME_TYPES = Object.freeze(['buttons', 'drag', 'count']);

export const SUCCESS_FEEDBACK = Object.freeze(['praise', 'none']);
export const FAILURE_FEEDBACK = Object.freeze(['tryAgain', 'none']);
export const AFTER_SUCCESS = Object.freeze(['restart', 'continue']);
export const DEFAULT_RESTART_DELAY_MS = 1600;

const DIMENSION_LABELS = Object.freeze({
  motor: Object.freeze({ he: 'מגע', en: 'touch' }),
  rule: Object.freeze({ he: 'כלל', en: 'rule' }),
  density: Object.freeze({ he: 'כמות', en: 'amount' }),
  tempo: Object.freeze({ he: 'קצב', en: 'pace' }),
});

function pick(array, rng = Math.random) {
  return array[Math.floor(rng() * array.length)];
}

// ---------------------------------------------------------------------------------
// The entries. Order here is the rotation order for games that no pack lists.
// ---------------------------------------------------------------------------------

const GAME_ENTRIES = [
  {
    type: 'laundry',
    titles: { he: 'כיבוס', en: 'Laundry' },
    typeLabels: { he: 'כיבוס', en: 'laundry' },
    prompt: { he: 'שים את הכביסה במכונה, {name}.', en: 'Put the laundry in the machine, {name}.' },
    starterPack: true,
    render: renderLaundry,
    state: {
      storageKey: LAUNDRY_STORAGE_KEY,
      createDefault: () => createDefaultLaundryState(),
      load: loadLaundryState,
      save: saveLaundryState,
    },
    dimensions: [
      { id: 'motor', option: 'motorLevel', min: 1, max: 4 },
      // The logic module allows rule level 4; the app has always capped it at 3.
      { id: 'rule', option: 'ruleLevel', min: 1, max: 3 },
    ],
    levelChoice: 'motor',
    adapt(state, { reason }) {
      if (reason === 'rule') {
        return recordLaundryRule(recordLaundryMotor(state, { success: true }), { success: false });
      }
      if (reason === 'motor') return recordLaundryMotor(state, { success: false });
      return recordLaundryRule(recordLaundryMotor(state, { success: true }), { success: true });
    },
    options: (ctx) => ({
      capacity: ctx.levelState.machine.capacity,
      itemLabel: (item) => laundryItemName(ctx.language, item.kind),
      promptForItem: (item) =>
        formatLaundryPrompt({
          language: ctx.language,
          gender: ctx.gender,
          name: ctx.name,
          kind: item.kind,
        }),
    }),
    phrases: ['10', '11', '12', '13', '14'],
    successFeedback: 'praise',
    failureFeedback: 'tryAgain',
    // The laundry scene carries on by itself; a new round only starts when it is time to
    // rotate to another game.
    afterSuccess: 'continue',
    rotateAfterFailures: 3,
  },
  {
    type: 'music',
    titles: { he: 'נגן', en: 'Play along' },
    typeLabels: { he: 'נגינה', en: 'music' },
    prompt: { he: 'בוא ננגן, {name}.', en: "Let's play a tune, {name}." },
    starterPack: true,
    render: renderMusic,
    state: {
      storageKey: MUSIC_STORAGE_KEY,
      createDefault: createDefaultMusicState,
      load: loadMusicState,
      save: saveMusicState,
    },
    dimensions: [
      { id: 'motor', option: 'motorLevel', min: 1, max: 4 },
      { id: 'rule', option: 'ruleLevel', min: 1, max: 2 },
    ],
    levelChoice: 'motor',
    adapt(state, { reason }) {
      if (reason === 'rule') {
        return recordMusicRule(recordMusicMotor(state, { success: true }), { success: false });
      }
      if (reason === 'motor') return recordMusicMotor(state, { success: false });
      return recordMusicRule(recordMusicMotor(state, { success: true }), { success: true });
    },
    createRound: (ctx) => ({
      song: pick(Array.isArray(ctx.songs) && ctx.songs.length ? ctx.songs : [...BUILTIN_SONGS]),
    }),
    options: (ctx) => ({ song: ctx.round.song }),
    phrases: ['20', '21', '22', '23', '24', '25', '26', '27'],
    successFeedback: 'praise',
    failureFeedback: 'tryAgain',
    afterSuccess: 'restart',
  },
  {
    type: 'garden',
    titles: { he: 'גינה', en: 'Garden' },
    typeLabels: { he: 'גינה', en: 'garden' },
    prompt: { he: 'הגינה מחכה, {name}.', en: 'The garden is waiting, {name}.' },
    starterPack: true,
    render: renderGarden,
    state: {
      storageKey: GARDEN_STORAGE_KEY,
      createDefault: createDefaultGardenState,
      load: loadGardenState,
      save: saveGardenState,
    },
    dimensions: [
      { id: 'motor', option: 'motorLevel', min: 1, max: 3 },
      { id: 'rule', option: 'ruleLevel', min: 1, max: 3 },
      { id: 'density', option: 'densityLevel', min: 1, max: 3 },
    ],
    levelChoice: 'motor',
    adapt(state, { reason }) {
      if (reason === 'rule') {
        let next = recordGardenMotor(state, { success: true });
        next = recordGardenRule(next, { success: false });
        return recordGardenDensity(next, { success: false });
      }
      if (reason === 'motor') {
        return recordGardenDensity(recordGardenMotor(state, { success: false }), { success: false });
      }
      let next = recordGardenMotor(state, { success: true });
      next = recordGardenRule(next, { success: true });
      return recordGardenDensity(next, { success: true });
    },
    phrases: ['40', '41', '42', '43', '44', '45', '46'],
    successFeedback: 'praise',
    failureFeedback: 'tryAgain',
    afterSuccess: 'restart',
  },
  {
    type: 'bubble-sheet',
    titles: { he: 'ניילון בועות', en: 'Bubble sheet' },
    render: renderBubbleSheet,
    ladder: BUBBLE_LADDER,
    phrases: ['50', '51', '52'],
  },
  {
    type: 'night-sky',
    titles: { he: 'שמי לילה', en: 'Night sky' },
    render: renderNightSky,
    ladder: NIGHT_LADDER,
    phrases: ['120', '121', '122', '123', '124'],
  },
  {
    type: 'colour-pop',
    titles: { he: 'כדורים צבעוניים', en: 'Colour pop' },
    render: renderColourPop,
    ladder: COLOUR_LADDER,
    phrases: ['130', '131', '132'],
  },
];

// ---------------------------------------------------------------------------------
// Registry mechanics. Nothing below needs editing when a game is added.
// ---------------------------------------------------------------------------------

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function filledString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function hasBothLanguages(value) {
  return isPlainObject(value) && filledString(value.he) && filledString(value.en);
}

const KNOWN_PHRASE_IDS = new Set(PHRASES.map((phrase) => phrase.id));

// Returns a list of problems with an entry; an empty list means the entry is fine.
export function validateGameEntry(entry) {
  const errors = [];
  if (!isPlainObject(entry)) return ['entry must be an object'];

  if (!filledString(entry.type) || !/^[a-z][a-z0-9-]*$/.test(entry.type)) {
    errors.push('type must be a lower-case id like "bubble-sheet"');
  } else if (LEGACY_GAME_TYPES.includes(entry.type)) {
    errors.push(`type "${entry.type}" is reserved`);
  }
  if (!hasBothLanguages(entry.titles)) errors.push('titles needs he and en');
  if (entry.typeLabels !== undefined && !hasBothLanguages(entry.typeLabels)) {
    errors.push('typeLabels needs he and en when present');
  }
  if (entry.prompt !== undefined) {
    if (!hasBothLanguages(entry.prompt)) errors.push('prompt needs he and en when present');
    else if (!entry.prompt.he.includes('{name}') || !entry.prompt.en.includes('{name}')) {
      errors.push('prompt must include {name}');
    }
  }
  if (typeof entry.render !== 'function') errors.push('render must be a function');

  const hasLadder = isPlainObject(entry.ladder);
  const hasState = isPlainObject(entry.state);
  if (hasLadder === hasState) {
    errors.push('give either ladder (new games) or state + dimensions + adapt, not both');
  }
  if (hasLadder) {
    for (const name of ['createDefault', 'load', 'save', 'adapt']) {
      if (typeof entry.ladder[name] !== 'function') errors.push(`ladder.${name} is missing`);
    }
    if (!filledString(entry.ladder.storageKey)) errors.push('ladder.storageKey is missing');
    if (!Array.isArray(entry.ladder.dimensions)) errors.push('ladder.dimensions is missing');
  }
  if (hasState) {
    if (!filledString(entry.state.storageKey)) errors.push('state.storageKey is missing');
    for (const name of ['createDefault', 'load', 'save']) {
      if (typeof entry.state[name] !== 'function') errors.push(`state.${name} is missing`);
    }
    if (typeof entry.adapt !== 'function') errors.push('adapt must be a function');
  }

  const dimensions = hasLadder ? entry.ladder.dimensions : entry.dimensions;
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    errors.push('at least one dimension is needed');
  } else {
    const ids = new Set();
    for (const dimension of dimensions) {
      if (!isPlainObject(dimension) || !filledString(dimension.id)) {
        errors.push('every dimension needs an id');
        continue;
      }
      if (ids.has(dimension.id)) errors.push(`dimension "${dimension.id}" is duplicated`);
      ids.add(dimension.id);
      const min = dimension.min === undefined ? 1 : dimension.min;
      if (!Number.isInteger(min) || !Number.isInteger(dimension.max) || dimension.max < min) {
        errors.push(`dimension "${dimension.id}" needs integer min <= max`);
      }
      if (dimension.labels !== undefined && !hasBothLanguages(dimension.labels)) {
        errors.push(`dimension "${dimension.id}" labels need he and en`);
      }
    }
    if (entry.levelChoice !== undefined && !ids.has(entry.levelChoice)) {
      errors.push('levelChoice must name one of the dimensions');
    }
  }

  if (entry.phrases !== undefined) {
    if (!Array.isArray(entry.phrases)) errors.push('phrases must be an array of catalog ids');
    else {
      for (const id of entry.phrases) {
        if (!KNOWN_PHRASE_IDS.has(id)) errors.push(`phrase id "${id}" is not in phrases.js`);
      }
    }
  }
  for (const name of ['options', 'createRound', 'statusText']) {
    if (entry[name] !== undefined && typeof entry[name] !== 'function') {
      errors.push(`${name} must be a function when present`);
    }
  }
  if (entry.successFeedback !== undefined && !SUCCESS_FEEDBACK.includes(entry.successFeedback)) {
    errors.push(`successFeedback must be one of ${SUCCESS_FEEDBACK.join(', ')}`);
  }
  if (entry.failureFeedback !== undefined && !FAILURE_FEEDBACK.includes(entry.failureFeedback)) {
    errors.push(`failureFeedback must be one of ${FAILURE_FEEDBACK.join(', ')}`);
  }
  if (entry.afterSuccess !== undefined && !AFTER_SUCCESS.includes(entry.afterSuccess)) {
    errors.push(`afterSuccess must be one of ${AFTER_SUCCESS.join(', ')}`);
  }
  return errors;
}

// Fills in the defaults so the rest of the app can read every field without checking.
export function defineGame(entry) {
  const errors = validateGameEntry(entry);
  if (errors.length) {
    throw new TypeError(`Bad game entry "${entry?.type ?? '?'}": ${errors.join('; ')}`);
  }

  const ladder = entry.ladder || null;
  const rawDimensions = ladder ? ladder.dimensions : entry.dimensions;
  const dimensions = Object.freeze(
    rawDimensions.map((dimension) =>
      Object.freeze({
        id: dimension.id,
        option: filledString(dimension.option) ? dimension.option : `${dimension.id}Level`,
        min: dimension.min === undefined ? 1 : dimension.min,
        max: dimension.max,
        labels: Object.freeze({
          ...(dimension.labels || DIMENSION_LABELS[dimension.id] || { he: dimension.id, en: dimension.id }),
        }),
      }),
    ),
  );

  return Object.freeze({
    type: entry.type,
    titles: Object.freeze({ ...entry.titles }),
    typeLabels: Object.freeze({ ...(entry.typeLabels || entry.titles) }),
    prompt: Object.freeze({
      ...(entry.prompt || { he: `${entry.titles.he}, {name}.`, en: `${entry.titles.en}, {name}.` }),
    }),
    starterPack: entry.starterPack === true,
    render: entry.render,
    state: Object.freeze(
      ladder
        ? {
            storageKey: ladder.storageKey,
            createDefault: ladder.createDefault,
            load: ladder.load,
            save: ladder.save,
          }
        : { ...entry.state },
    ),
    dimensions,
    levelChoice: entry.levelChoice || dimensions[0].id,
    adapt: ladder ? ladder.adapt : entry.adapt,
    options: entry.options || null,
    createRound: entry.createRound || null,
    statusText: entry.statusText || null,
    phrases: Object.freeze([...(entry.phrases || [])]),
    successFeedback: entry.successFeedback || 'none',
    failureFeedback: entry.failureFeedback || 'none',
    afterSuccess: entry.afterSuccess || 'restart',
    restartDelayMs: Number.isFinite(entry.restartDelayMs)
      ? Math.max(0, entry.restartDelayMs)
      : DEFAULT_RESTART_DELAY_MS,
    rotateAfterFailures:
      Number.isInteger(entry.rotateAfterFailures) && entry.rotateAfterFailures > 0
        ? entry.rotateAfterFailures
        : 0,
  });
}

export function buildRegistry(entries) {
  const games = [];
  const seenTypes = new Set();
  const seenKeys = new Set();
  for (const entry of entries) {
    const game = defineGame(entry);
    if (seenTypes.has(game.type)) throw new TypeError(`Game type "${game.type}" is registered twice`);
    if (seenKeys.has(game.state.storageKey)) {
      throw new TypeError(`Storage key "${game.state.storageKey}" is used by two games`);
    }
    seenTypes.add(game.type);
    seenKeys.add(game.state.storageKey);
    games.push(game);
  }
  return Object.freeze(games);
}

export const GAMES = buildRegistry(GAME_ENTRIES);

export const REGISTERED_TYPES = Object.freeze(GAMES.map((game) => game.type));

const GAMES_BY_TYPE = new Map(GAMES.map((game) => [game.type, game]));

export function getGame(type) {
  return GAMES_BY_TYPE.get(type) || null;
}

export function isRegisteredType(type) {
  return GAMES_BY_TYPE.has(type);
}

function localized(names, language) {
  return names[language === 'en' ? 'en' : 'he'];
}

export function gameTitle(game, language) {
  return localized(game.titles, language);
}

export function gameTypeLabel(game, language) {
  return localized(game.typeLabels, language);
}

// A pack-style game object for a registry game: what packs/starter.json would hold.
export function packEntryFor(game) {
  return {
    id: game.type,
    type: game.type,
    title: game.titles.en,
    prompt: game.prompt.en,
    translations: {
      en: { title: game.titles.en, prompt: game.prompt.en },
      he: { title: game.titles.he, prompt: game.prompt.he },
    },
  };
}

// The games that packs/starter.json lists (the first three only; see starterPack).
export function starterPackGames(games = GAMES) {
  return games.filter((game) => game.starterPack).map(packEntryFor);
}

// Registered games that no loaded pack lists are still offered, after the pack games,
// so a new game needs no pack edit.
export function withRegisteredGames(packGames, games = GAMES) {
  const list = Array.isArray(packGames) ? [...packGames] : [];
  const present = new Set(list.map((game) => (isPlainObject(game) ? game.type : null)));
  for (const game of games) {
    if (present.has(game.type)) continue;
    list.push({ ...packEntryFor(game), packId: 'registry' });
  }
  return list;
}

function clampLevel(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function levelChoiceDimension(game) {
  return game.dimensions.find((dimension) => dimension.id === game.levelChoice) || game.dimensions[0];
}

// What the settings "level" chooser offers for a game: which dimension it pins, its
// label and the levels on offer.
export function levelChoiceFor(game, language) {
  const dimension = levelChoiceDimension(game);
  const levels = [];
  for (let level = dimension.min; level <= dimension.max; level += 1) levels.push(level);
  return { dimension: dimension.id, label: localized(dimension.labels, language), levels };
}

// The level of every dimension, by dimension id. The caregiver's fixed level (or null for
// automatic) pins the levelChoice dimension; the others always follow the saved state.
export function resolveLevels(game, levelState, fixedLevel = null) {
  const source = isPlainObject(levelState) ? levelState : {};
  const pinned = fixedLevel === null || fixedLevel === undefined ? null : fixedLevel;
  const result = {};
  for (const dimension of game.dimensions) {
    const stored = isPlainObject(source[dimension.id]) ? source[dimension.id].level : dimension.min;
    const value = dimension.id === game.levelChoice && pinned !== null ? pinned : stored;
    result[dimension.id] = clampLevel(value, dimension.min, dimension.max);
  }
  return result;
}

// The same levels keyed the way render options expect them: { motorLevel, ruleLevel, ... }.
export function levelOptions(game, levels) {
  const result = {};
  for (const dimension of game.dimensions) result[dimension.option] = levels[dimension.id];
  return result;
}

// One onSuccess / onFailure call from a game, turned into the next level state.
export function applyOutcome(game, levelState, success, info = {}) {
  const details = isPlainObject(info) ? info : {};
  return game.adapt(levelState, { success: success === true, reason: details.reason, info: details });
}

export function phraseIdsFor(game) {
  return [...game.phrases];
}
