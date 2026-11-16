import {
  BUILTIN_STARTER_PACK,
  COLOR_TONES,
  PACKS_CACHE_KEY,
  ROUNDS_PER_TYPE,
  chooseGameForRound,
  createDefaultState,
  createIdleState,
  effectiveLevel,
  getLevelParams,
  idlePromptDelay,
  loadState,
  markIdlePromptRepeated,
  minutesPlayed,
  noteTouch,
  packsToGames,
  packsToSongs,
  packsToThemes,
  recordResult,
  resolveThemes,
  saveState,
  setFixedLevel as setStateFixedLevel,
  setGender as setStateGender,
  setLanguage as setStateLanguage,
  setName,
  setSelectedGame as setStateSelectedGame,
  setShowStatusLine as setStateShowStatusLine,
  setShowTextLabels as setStateShowTextLabels,
  setSpeechMuted as setStateSpeechMuted,
  setSpeechRate as setStateSpeechRate,
  setThemes as setStateThemes,
  setVoiceURI as setStateVoiceURI,
  shouldRepeatIdlePrompt,
  STORAGE_KEY,
  themeItems,
  validatePack,
  validatePackIndex,
} from './engine.js';
import {
  SPEECH_LANGS,
  formatLaundryPrompt,
  formatPrompt as buildPrompt,
  formatText,
  gameColorName,
  gameText,
  itemName,
  laundryItemName,
  normalizeGender,
  normalizeLanguage,
  t,
  themeName,
} from './i18n.js';
import {
  createDefaultLaundryState,
  loadLaundryState,
  recordMotorResult,
  recordRuleResult,
  saveLaundryState,
} from './laundry-logic.js';
import { renderLaundry } from './laundry.js';
import {
  SONGS as BUILTIN_SONGS,
  createDefaultMusicState,
  loadMusicState,
  recordMotorResult as recordMusicMotorResult,
  recordRuleResult as recordMusicRuleResult,
  saveMusicState,
} from './music-logic.js';
import { renderMusic } from './music.js';
import {
  MIN_TOUCH_DURATION_MS,
  SAFE_MARGIN,
  isSingleTouch,
  isTouchDurationValid,
  isWithinSafeArea,
} from './touch.js';

const PRAISE_KEYS = ['praiseGood', 'praiseWellDone'];
const SETTINGS_HOLD_MS = 2000;
const STATUS_UPDATE_MS = 15000;
const PACK_FETCH_TIMEOUT_MS = 5000;
const DROP_TOLERANCE_PX = 64;
const SNAP_BACK_MS = 260;

const els = {
  stage: document.getElementById('stage'),
  gameTitle: document.getElementById('game-title'),
  status: document.getElementById('status'),
  statusLine: document.getElementById('status-line'),
  welcome: document.getElementById('welcome'),
  welcomeTitle: document.getElementById('welcome-title'),
  nameLabel: document.getElementById('name-label'),
  nameInput: document.getElementById('name-input'),
  startButton: document.getElementById('start-button'),
  hint: document.getElementById('hint'),
  settings: document.getElementById('settings'),
  settingsTitle: document.getElementById('settings-title'),
  settingsResume: document.getElementById('settings-resume'),
  settingMute: document.getElementById('setting-mute'),
  muteLabel: document.getElementById('mute-label'),
  gameLabel: document.getElementById('game-label'),
  settingGame: document.getElementById('setting-game'),
  levelLabel: document.getElementById('level-label'),
  settingLevel: document.getElementById('setting-level'),
  settingLanguage: document.getElementById('setting-language'),
  languageLabel: document.getElementById('language-label'),
  settingGender: document.getElementById('setting-gender'),
  genderLabel: document.getElementById('gender-label'),
  settingName: document.getElementById('setting-name'),
  nameSettingLabel: document.getElementById('name-setting-label'),
  themesLabel: document.getElementById('themes-label'),
  settingsThemes: document.getElementById('settings-themes'),
  textLabelsLabel: document.getElementById('text-labels-label'),
  settingTextLabels: document.getElementById('setting-text-labels'),
  statusLineLabel: document.getElementById('status-line-label'),
  settingStatusLine: document.getElementById('setting-status-line'),
  voiceLabel: document.getElementById('voice-label'),
  settingVoice: document.getElementById('setting-voice'),
  rateLabel: document.getElementById('rate-label'),
  settingRate: document.getElementById('setting-rate'),
  settingsExit: document.getElementById('settings-exit'),
  settingsReset: document.getElementById('settings-reset'),
  settingsZone1: document.getElementById('settings-zone-1'),
  settingsZone2: document.getElementById('settings-zone-2'),
};

let state = loadState(window.localStorage);
let laundryState = loadLaundryState(window.localStorage);
let laundryCleanup = null;
let musicState = loadMusicState(window.localStorage);
let musicCleanup = null;
let musicSongs = [...BUILTIN_SONGS];
let games = [];
let allThemes = [];
let packsReady = null;
let started = false;
let currentGame = null;
let currentRound = null;
let roundsInType = 0;
let gameSessionStartedAt = null;
let retryTimer = null;
let idleTimer = null;
let idleState = createIdleState(0);
let resetArmed = false;
let resetDisarmTimer = null;
let audioContext = null;
let activePointers = new Set();
let multiTouchGesture = false;
let settingsPointers = new Map();
let settingsHoldTimer = null;

function language() {
  return normalizeLanguage(state.language);
}

function gender() {
  return normalizeGender(state.gender);
}

function text(key, values = {}) {
  return t(language(), key, values, gender());
}

function availableVoices() {
  try {
    const voices = window.speechSynthesis.getVoices();
    return Array.isArray(voices) ? voices : [];
  } catch {
    return [];
  }
}

function findVoice(lang) {
  const voices = availableVoices();
  if (state.voiceURI) {
    const chosen = voices.find((voice) => voice.voiceURI === state.voiceURI);
    if (chosen) return chosen;
  }
  const prefix = lang === 'he' ? 'he' : 'en';
  const matches = (voice) => voice.lang.replace('_', '-').toLowerCase().startsWith(prefix);
  return voices.find((voice) => matches(voice) && voice.localService) || voices.find(matches) || null;
}

const speech = {
  available:
    typeof window.speechSynthesis !== 'undefined' &&
    typeof window.SpeechSynthesisUtterance !== 'undefined',
  speak(message, lang = language()) {
    if (!this.available || !message || state.speechMuted) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new window.SpeechSynthesisUtterance(String(message));
      utterance.lang = SPEECH_LANGS[lang] || SPEECH_LANGS.en;
      utterance.rate = Number(state.speechRate) || 0.88;
      utterance.pitch = 1;
      utterance.volume = 1;
      const voice = findVoice(lang);
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    } catch {
      /* Speech is an enhancement, never a requirement. */
    }
  },
  stop() {
    if (!this.available) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  },
};

function loadVoices() {
  if (!speech.available) return;
  try {
    window.speechSynthesis.getVoices();
  } catch {
    /* ignore */
  }
  renderVoiceChooser();
  syncSettingsFields();
}

function displayName() {
  return state.name || text('friend');
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function pick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function shuffle(array) {
  const copy = [...array];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function pointWithinSafeArea(x, y) {
  return isWithinSafeArea({ x, y }, viewportSize(), SAFE_MARGIN);
}

function multiTouchActive() {
  // The window capture listener removes the pointer on pointerup before the element
  // handlers run, so the live pointer count is unreliable there; rely on the flag that
  // is set whenever a second pointer goes down.
  return multiTouchGesture;
}

function attachGameTap(element, handler) {
  let tap = null;

  element.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!pointWithinSafeArea(event.clientX, event.clientY)) return;
    if (activePointers.size > 1) {
      multiTouchGesture = true;
      tap = null;
      return;
    }
    tap = { pointerId: event.pointerId, startedAt: performance.now() };
  });

  element.addEventListener('pointerup', (event) => {
    if (!tap || tap.pointerId !== event.pointerId) return;
    const startedAt = tap.startedAt;
    tap = null;
    if (multiTouchActive()) return;
    if (!isTouchDurationValid(startedAt, performance.now(), MIN_TOUCH_DURATION_MS)) return;
    handler(event);
  });

  element.addEventListener('pointercancel', () => {
    tap = null;
  });

  element.addEventListener('click', (event) => {
    if (event.detail === 0) handler(event);
  });
}

function formatPrompt(game, values = {}) {
  return buildPrompt(game, {
    language: language(),
    gender: gender(),
    name: displayName(),
    color: values.color,
    count: values.count,
  });
}

function selectedItems() {
  return themeItems(allThemes, state.themes);
}

function formatThemePrompt(key, values = {}) {
  const lang = language();
  return formatText(t(lang, key, {}, gender()), {
    name: displayName(),
    touch: t(lang, 'touch', {}, gender()),
    move: t(lang, 'move', {}, gender()),
    ...values,
  });
}

function formatItemPrompt(key, item) {
  return formatThemePrompt(key, { item: itemName(item, language()) });
}

function persist() {
  saveState(window.localStorage, state);
}

function updateHud() {
  const title = currentGame ? gameText(currentGame, language()).title : '';
  els.gameTitle.textContent = title || text('appTitle');
  const level = currentGame ? effectiveLevel(state, currentGame.type) : 1;
  els.status.textContent = text('level', { level });
}

function updateStatusLine() {
  if (!els.statusLine) return;
  if (!state.showStatusLine || !started || !currentGame) {
    els.statusLine.classList.add('hidden');
    return;
  }
  const game = gameText(currentGame, language()).title || text('appTitle');
  const level = effectiveLevel(state, currentGame.type);
  const minutes = minutesPlayed(gameSessionStartedAt, performance.now());
  els.statusLine.textContent = text('statusLine', { game, level, minutes });
  els.statusLine.classList.remove('hidden');
}

function gameTypeLabel(type) {
  const keys = {
    buttons: 'typeButtons',
    drag: 'typeDrag',
    count: 'typeCount',
    laundry: 'typeLaundry',
    music: 'typeMusic',
  };
  return text(keys[type] || 'typeButtons');
}

function chosenGame() {
  if (!state.selectedGame) return null;
  return games.find((game) => game.id === state.selectedGame) || null;
}

function currentSettingsGameType() {
  const fixed = chosenGame();
  if (fixed) return fixed.type;
  if (currentGame) return currentGame.type;
  return games[0]?.type || 'buttons';
}

function renderGameChooser() {
  if (!els.settingGame) return;
  els.settingGame.replaceChildren();

  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = text('autoMix');
  els.settingGame.append(auto);

  for (const game of games) {
    const option = document.createElement('option');
    option.value = game.id;
    option.textContent = gameText(game, language()).title || game.id;
    els.settingGame.append(option);
  }

  const hasSelected = games.some((game) => game.id === state.selectedGame);
  els.settingGame.value = hasSelected ? state.selectedGame : '';
}

function renderLevelChooser() {
  if (!els.settingLevel) return;
  const type = currentSettingsGameType();
  els.levelLabel.textContent = text('levelFor', { type: gameTypeLabel(type) });
  els.settingLevel.replaceChildren();

  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = text('auto');
  els.settingLevel.append(auto);

  for (let level = 1; level <= 5; level += 1) {
    const option = document.createElement('option');
    option.value = String(level);
    option.textContent = text('level', { level });
    els.settingLevel.append(option);
  }

  const fixed = state.fixedLevels[type];
  els.settingLevel.value = fixed === null ? '' : String(fixed);
}

function renderRateChooser() {
  if (!els.settingRate) return;
  const keys = { '0.7': 'rateSlow', '0.88': 'rateNormal', '1.15': 'rateFast' };
  for (const option of els.settingRate.options) {
    option.textContent = text(keys[option.value] || 'rateNormal');
  }
  els.settingRate.value = String(state.speechRate);
}

function renderVoiceChooser() {
  if (!els.settingVoice) return;
  const voices = availableVoices();
  els.settingVoice.replaceChildren();

  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = text('voiceAuto');
  els.settingVoice.append(auto);

  for (const voice of voices) {
    const option = document.createElement('option');
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})`;
    els.settingVoice.append(option);
  }

  els.settingVoice.value = state.voiceURI || '';
}

function syncSettingsFields() {
  if (!els.settings) return;
  els.settingMute.checked = state.speechMuted;
  els.settingTextLabels.checked = state.showTextLabels;
  els.settingStatusLine.checked = state.showStatusLine;
  if (document.activeElement !== els.settingName) els.settingName.value = state.name;
  els.settingGame.value = chosenGame() ? state.selectedGame : '';
  const type = currentSettingsGameType();
  const fixed = state.fixedLevels[type];
  els.settingLevel.value = fixed === null ? '' : String(fixed);
  els.settingLanguage.value = language();
  els.settingGender.value = gender();
  const voiceValues = new Set([...els.settingVoice.options].map((option) => option.value));
  els.settingVoice.value = voiceValues.has(state.voiceURI) ? state.voiceURI : '';
  els.settingRate.value = String(state.speechRate);
}

function applyLanguage() {
  const lang = language();
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.title = text('appTitle');

  els.welcomeTitle.textContent = state.name
    ? text('welcomeBack', { name: state.name })
    : text('welcomeTitle');
  els.nameLabel.textContent = text('nameQuestion');
  els.nameInput.placeholder = text('namePlaceholder');
  els.startButton.textContent = text('start');
  els.hint.textContent = text('hint');

  els.settingsTitle.textContent = text('settingsTitle');
  els.settingsResume.textContent = text('resume');
  els.muteLabel.textContent = text('muteSpeech');
  els.gameLabel.textContent = text('chooseGame');
  els.languageLabel.textContent = text('language');
  els.genderLabel.textContent = text('gender');
  els.nameSettingLabel.textContent = text('name');
  els.settingName.placeholder = text('namePlaceholder');
  els.themesLabel.textContent = text('themes');
  els.textLabelsLabel.textContent = text('showTextLabels');
  els.statusLineLabel.textContent = text('showStatusLine');
  els.voiceLabel.textContent = text('voice');
  els.rateLabel.textContent = text('speechRate');
  els.settingsExit.textContent = text('exit');
  els.settingsReset.textContent = resetArmed ? text('resetConfirm') : text('reset');
  els.settingsZone1.textContent = text('settings1');
  els.settingsZone2.textContent = text('settings2');

  const languageKeys = { he: 'languageHebrew', en: 'languageEnglish' };
  for (const option of els.settingLanguage.options) {
    option.textContent = text(languageKeys[option.value] || 'languageEnglish');
  }
  const genderKeys = { m: 'genderMale', f: 'genderFemale' };
  for (const option of els.settingGender.options) {
    option.textContent = text(genderKeys[option.value] || 'genderMale');
  }

  renderThemeChooser();
  renderGameChooser();
  renderLevelChooser();
  renderRateChooser();
  renderVoiceChooser();
  syncSettingsFields();
  updateHud();
  updateStatusLine();
}

function renderThemeChooser() {
  if (!els.settingsThemes) return;
  const selected =
    state.themes === null ? new Set(allThemes.map((theme) => theme.id)) : new Set(state.themes);

  els.settingsThemes.replaceChildren();
  for (const theme of allThemes) {
    const label = document.createElement('label');
    label.className = 'theme-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'theme-checkbox';
    checkbox.value = theme.id;
    checkbox.checked = selected.has(theme.id);
    checkbox.addEventListener('change', () => {
      const checked = [
        ...els.settingsThemes.querySelectorAll('input[type="checkbox"]:checked'),
      ].map((input) => input.value);
      state = setStateThemes(state, checked);
      persist();
    });

    const name = document.createElement('span');
    name.textContent = themeName(theme, language());

    label.append(checkbox, name);
    els.settingsThemes.append(label);
  }
}

function unlockedAudio() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;
  if (!audioContext) {
    try {
      audioContext = new AudioCtor();
    } catch {
      audioContext = null;
      return;
    }
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
}

function playTone(frequency, duration = 0.3) {
  if (!audioContext) return;
  try {
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  } catch {
    /* ignore audio errors */
  }
}

function playSuccessTone() {
  playTone(660, 0.18);
  window.setTimeout(() => playTone(880, 0.24), 130);
}

async function fetchJson(path) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PACK_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(path, { cache: 'no-cache', signal: controller.signal });
    if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

function readPackCache() {
  try {
    const raw = window.localStorage.getItem(PACKS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter((pack) => validatePack(pack).valid);
    return valid.length ? valid : null;
  } catch {
    return null;
  }
}

function writePackCache(packs) {
  try {
    window.localStorage.setItem(PACKS_CACHE_KEY, JSON.stringify(packs));
  } catch {
    /* cache is best effort */
  }
}

async function loadPacksFromNetwork() {
  const index = await fetchJson('packs/index.json');
  const indexResult = validatePackIndex(index);
  if (!indexResult.valid) throw new Error(indexResult.errors.join('; '));

  const loaded = [];
  for (const file of indexResult.files) {
    try {
      const cleanFile = file.replace(/^\.?\//, '');
      const rawPack = await fetchJson(`packs/${cleanFile}`);
      const result = validatePack(rawPack);
      if (result.valid) loaded.push(result.pack);
    } catch {
      /* one bad pack should not sink the whole pack list */
    }
  }
  if (!loaded.length) throw new Error('No valid packs found');
  return loaded;
}

async function loadPacks() {
  const cached = readPackCache();
  try {
    const packs = await loadPacksFromNetwork();
    writePackCache(packs);
    return packs;
  } catch {
    return cached || [BUILTIN_STARTER_PACK];
  }
}

function refreshGames(packs) {
  games = packsToGames(packs);
  allThemes = packsToThemes(packs);
  const packSongs = packsToSongs(packs);
  const seenSongs = new Set();
  musicSongs = [];
  for (const song of [...BUILTIN_SONGS, ...packSongs]) {
    if (seenSongs.has(song.id)) continue;
    seenSongs.add(song.id);
    musicSongs.push(song);
  }
  if (!games.length) games = packsToGames([BUILTIN_STARTER_PACK]);
  if (!allThemes.length) allThemes = packsToThemes([BUILTIN_STARTER_PACK]);
  if (!musicSongs.length) musicSongs = [...BUILTIN_SONGS];
  renderThemeChooser();
  renderGameChooser();
  renderLevelChooser();
  syncSettingsFields();
}

function overlayOpen() {
  return (
    !els.welcome.classList.contains('hidden') ||
    !els.settings.classList.contains('hidden')
  );
}

function clearRoundTimers() {
  window.clearTimeout(retryTimer);
  window.clearTimeout(idleTimer);
  retryTimer = null;
  idleTimer = null;
  if (laundryCleanup) {
    laundryCleanup();
    laundryCleanup = null;
  }
  if (musicCleanup) {
    musicCleanup();
    musicCleanup = null;
  }
}

function markTouch() {
  if (!started || !currentRound || currentRound.done) return;
  idleState = noteTouch(idleState, performance.now());
  scheduleIdlePrompt();
}

function scheduleIdlePrompt() {
  window.clearTimeout(idleTimer);
  idleTimer = null;
  if (!started || !currentRound || currentRound.done || overlayOpen()) return;

  const delay = idlePromptDelay(idleState, performance.now());
  if (delay === null) return;

  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    if (!started || !currentRound || currentRound.done || overlayOpen()) return;

    const now = performance.now();
    if (!shouldRepeatIdlePrompt(idleState, now)) {
      scheduleIdlePrompt();
      return;
    }

    idleState = markIdlePromptRepeated(idleState, now);
    speech.speak(currentRound.promptText);
  }, delay);
}

function createRound(game, params) {
  const items = selectedItems();
  const useItems = items.length > 0;

  if (game.type === 'laundry') {
    return {
      type: 'laundry',
      promptText: '',
      silentPrompt: true,
      startedAt: performance.now(),
      done: false,
    };
  }

  if (game.type === 'music') {
    return {
      type: 'music',
      song: pick(musicSongs.length ? musicSongs : [...BUILTIN_SONGS]),
      promptText: '',
      silentPrompt: true,
      startedAt: performance.now(),
      done: false,
    };
  }

  if (game.type === 'buttons') {
    if (useItems) {
      const target = pick(items);
      const others = shuffle(items.filter((item) => item !== target)).slice(
        0,
        Math.max(0, Math.min(params.choices, items.length) - 1),
      );
      return {
        type: 'buttons',
        mode: 'items',
        target,
        options: shuffle([target, ...others]),
        promptText: formatItemPrompt('touchItem', target),
        startedAt: performance.now(),
        done: false,
      };
    }

    const target = pick(game.colors);
    const others = shuffle(game.colors.filter((color) => color !== target)).slice(
      0,
      Math.max(0, Math.min(params.choices, game.colors.length) - 1),
    );
    return {
      type: 'buttons',
      target,
      options: shuffle([target, ...others]),
      promptText: formatPrompt(game, { color: target }),
      startedAt: performance.now(),
      done: false,
    };
  }

  if (game.type === 'drag') {
    const item = useItems ? pick(items) : null;
    return {
      type: 'drag',
      item: item ? item.emoji : game.item,
      itemLabel: item ? itemName(item, language()) : '',
      themed: Boolean(item),
      total: params.targets,
      moved: 0,
      promptText: item ? formatItemPrompt('moveItem', item) : formatPrompt(game),
      startedAt: performance.now(),
      done: false,
    };
  }

  const object = useItems ? pick(items) : null;
  const maxCount = Math.max(1, Math.min(5, params.targets, params.choices));
  const count = 1 + Math.floor(Math.random() * maxCount);
  const optionCount = Math.max(params.choices, count);
  return {
    type: 'count',
    count,
    object: object ? object.emoji : pick(game.objects),
    options: Array.from({ length: optionCount }, (_, index) => index + 1),
    promptText: object ? formatThemePrompt('countThemePrompt') : formatPrompt(game),
    startedAt: performance.now(),
    done: false,
  };
}

function startRound(gameOverride = null) {
  clearRoundTimers();
  if (!started || overlayOpen()) return;

  if (!games.length) refreshGames([BUILTIN_STARTER_PACK]);

  const previousGameId = currentGame?.id ?? null;
  const fixed = chosenGame();

  if (gameOverride && !fixed) {
    currentGame = gameOverride;
  } else if (!currentGame) {
    currentGame = chooseGameForRound(games, state, null, 0) || games[0];
    roundsInType = 1;
  } else {
    const previousType = currentGame.type;
    currentGame = chooseGameForRound(games, state, currentGame, roundsInType) || games[0];
    roundsInType = currentGame.type === previousType ? roundsInType + 1 : 1;
  }

  if (gameSessionStartedAt === null || previousGameId !== currentGame.id) {
    gameSessionStartedAt = performance.now();
  }

  const level = effectiveLevel(state, currentGame.type);
  const params = getLevelParams(currentGame.type, level);
  currentRound = createRound(currentGame, params);

  updateHud();
  renderRound(currentGame, params, currentRound);
  updateStatusLine();
  if (!currentRound.silentPrompt) speech.speak(currentRound.promptText);

  idleState = createIdleState(performance.now());
  scheduleIdlePrompt();
}

function promptElement(text) {
  const heading = document.createElement('h1');
  heading.className = 'prompt';
  heading.textContent = text;
  return heading;
}

function setChoiceColumns(choices, count) {
  const columns = count <= 2 ? Math.max(1, count) : count <= 4 ? 2 : 3;
  choices.style.setProperty('--cols', String(columns));
}

function renderRound(game, params, round) {
  els.stage.replaceChildren();
  if (state.showTextLabels && game.type !== 'laundry' && game.type !== 'music') {
    els.stage.append(promptElement(round.promptText));
  }
  els.stage.dataset.game = game.type;

  if (game.type === 'buttons') renderButtons(game, params, round);
  else if (game.type === 'count') renderCount(params, round);
  else if (game.type === 'laundry') renderLaundryRound(round);
  else if (game.type === 'music') renderMusicRound(round);
  else renderDrag(params, round);
}

function laundryLevels() {
  const fixed = state.fixedLevels.laundry;
  const motorLevel =
    fixed === null || fixed === undefined
      ? laundryState.motor.level
      : Math.min(4, Math.max(1, Math.round(Number(fixed) || 1)));
  const ruleLevel = Math.min(3, Math.max(1, laundryState.rule.level));
  return { motorLevel, ruleLevel };
}

function laundryPrompt(item) {
  return formatLaundryPrompt({
    language: language(),
    gender: gender(),
    name: displayName(),
    kind: item.kind,
  });
}

function handleLaundryOutcome(success, info = {}, round) {
  if (!started || !currentGame || currentGame.type !== 'laundry' || overlayOpen()) return;

  const reactionMs = Math.max(0, performance.now() - (round?.startedAt || performance.now()));
  state = recordResult(state, 'laundry', { success, reactionMs });

  const reason = info.reason;
  if (reason === 'rule') {
    laundryState = recordMotorResult(laundryState, { success: true });
    laundryState = recordRuleResult(laundryState, { success: false });
  } else if (reason === 'motor') {
    laundryState = recordMotorResult(laundryState, { success: false });
  } else {
    laundryState = recordMotorResult(laundryState, { success: true });
    laundryState = recordRuleResult(laundryState, { success: true });
  }
  saveLaundryState(window.localStorage, laundryState);

  persist();
  updateHud();
  updateStatusLine();

  if (success) {
    playSuccessTone();
    speech.speak(text(pick(PRAISE_KEYS)));
    roundsInType += 1;
    if (!chosenGame() && roundsInType >= ROUNDS_PER_TYPE) {
      const scheduledGame = round;
      retryTimer = window.setTimeout(() => {
        if (currentRound !== scheduledGame || currentGame?.type !== 'laundry' || overlayOpen()) {
          return;
        }
        startRound();
      }, 1600);
    }
  } else {
    speech.speak(text('tryAgain', { name: displayName() }));
  }

  idleState = createIdleState(performance.now());
  scheduleIdlePrompt();
}

function renderLaundryRound(round) {
  const levels = laundryLevels();
  laundryCleanup = renderLaundry(els.stage, {
    motorLevel: levels.motorLevel,
    ruleLevel: levels.ruleLevel,
    capacity: laundryState.machine.capacity,
    language: language(),
    gender: gender(),
    name: displayName(),
    showTextLabels: state.showTextLabels,
    getLevels: laundryLevels,
    itemLabel: (item) => laundryItemName(language(), item.kind),
    promptForItem: laundryPrompt,
    getAudioContext: () => {
      unlockedAudio();
      return audioContext;
    },
    onPrompt: (promptText) => {
      round.promptText = promptText;
      idleState = createIdleState(performance.now());
      scheduleIdlePrompt();
      speech.speak(promptText);
    },
    onSuccess: (info) => handleLaundryOutcome(true, info, round),
    onFailure: (info) => handleLaundryOutcome(false, info, round),
  });
}

function musicLevels() {
  const fixed = state.fixedLevels.music;
  const motorLevel =
    fixed === null || fixed === undefined
      ? musicState.motor.level
      : Math.min(4, Math.max(1, Math.round(Number(fixed) || 1)));
  const ruleLevel = Math.min(2, Math.max(1, musicState.rule.level));
  return { motorLevel, ruleLevel };
}

function handleMusicOutcome(success, info = {}, round) {
  if (!started || !currentGame || currentGame.type !== 'music' || overlayOpen()) return;

  const reactionMs = Math.max(0, performance.now() - (round?.startedAt || performance.now()));
  state = recordResult(state, 'music', { success, reactionMs });

  const reason = info.reason;
  if (reason === 'rule') {
    musicState = recordMusicMotorResult(musicState, { success: true });
    musicState = recordMusicRuleResult(musicState, { success: false });
  } else if (reason === 'motor') {
    musicState = recordMusicMotorResult(musicState, { success: false });
  } else {
    musicState = recordMusicMotorResult(musicState, { success: true });
    musicState = recordMusicRuleResult(musicState, { success: true });
  }
  saveMusicState(window.localStorage, musicState);

  persist();
  updateHud();
  updateStatusLine();

  if (success) {
    playSuccessTone();
    speech.speak(text(pick(PRAISE_KEYS)));
    retryTimer = window.setTimeout(() => {
      if (currentRound !== round || currentGame?.type !== 'music' || overlayOpen()) {
        return;
      }
      startRound();
    }, 1600);
  } else {
    speech.speak(text('tryAgain', { name: displayName() }));
  }

  idleState = createIdleState(performance.now());
  scheduleIdlePrompt();
}

function renderMusicRound(round) {
  const levels = musicLevels();
  musicCleanup = renderMusic(els.stage, {
    motorLevel: levels.motorLevel,
    ruleLevel: levels.ruleLevel,
    song: round.song,
    language: language(),
    name: displayName(),
    showTextLabels: state.showTextLabels,
    getAudioContext: () => {
      unlockedAudio();
      return audioContext;
    },
    onPrompt: (promptText) => {
      round.promptText = promptText;
      idleState = createIdleState(performance.now());
      scheduleIdlePrompt();
      speech.speak(promptText);
    },
    onSuccess: (info) => handleMusicOutcome(true, info, round),
    onFailure: (info) => handleMusicOutcome(false, info, round),
  });
}

function renderButtons(game, params, round) {
  const choices = document.createElement('div');
  choices.className = 'choices';
  setChoiceColumns(choices, round.options.length);
  if (round.mode === 'items') {
    const tones = Object.values(COLOR_TONES).map((entry) => entry.tone);
    round.options.forEach((item, index) => {
      const name = itemName(item, language());
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice item-choice';
      button.style.setProperty('--size', `${params.targetSize}px`);
      button.setAttribute('aria-label', capitalize(name));

      const emoji = document.createElement('span');
      emoji.className = 'item-emoji';
      emoji.textContent = item.emoji;
      emoji.setAttribute('aria-hidden', 'true');

      button.append(emoji);
      if (state.showTextLabels) {
        const label = document.createElement('span');
        label.className = 'item-name';
        label.textContent = capitalize(name);
        button.append(label);
      }
      attachGameTap(button, () => {
        if (round.done) return;
        playTone(tones[index % tones.length]);
        submitOutcome(item === round.target);
      });

      choices.append(button);
    });

    els.stage.append(choices);
    return;
  }

  const colorLabel = (color) => gameColorName(game, language(), color);

  for (const color of round.options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice color-choice';
    button.style.setProperty('--size', `${params.targetSize}px`);
    button.style.background = COLOR_TONES[color].hex;
    button.setAttribute('aria-label', text('colorButton', { color: capitalize(colorLabel(color)) }));

    if (state.showTextLabels) {
      const label = document.createElement('span');
      label.textContent = capitalize(colorLabel(color));
      button.append(label);
    }

    attachGameTap(button, () => {
      if (round.done) return;
      playTone(COLOR_TONES[color].tone);
      submitOutcome(color === round.target);
    });

    choices.append(button);
  }

  els.stage.append(choices);
}

function renderCount(params, round) {
  const row = document.createElement('div');
  row.className = 'count-row';
  for (let index = 0; index < round.count; index += 1) {
    const object = document.createElement('span');
    object.className = 'count-object';
    object.style.setProperty('--size', `${params.targetSize}px`);
    object.textContent = round.object;
    object.setAttribute('aria-hidden', 'true');
    row.append(object);
  }

  const choices = document.createElement('div');
  choices.className = 'choices';
  setChoiceColumns(choices, round.options.length);
  for (const number of round.options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice number-choice';
    button.textContent = String(number);
    button.setAttribute('aria-label', `${number}`);
    attachGameTap(button, () => {
      if (round.done) return;
      playTone(300 + number * 70, 0.2);
      submitOutcome(number === round.count);
    });
    choices.append(button);
  }

  els.stage.append(row, choices);
}

function renderDrag(params, round) {
  const board = document.createElement('div');
  board.className = 'drag-board';

  const dragZone = document.createElement('div');
  dragZone.className = 'drag-zone';
  const dragLabel = document.createElement('span');
  dragLabel.className = 'zone-label';
  dragLabel.textContent = round.themed ? text('items') : text('coins');

  const dropZone = document.createElement('div');
  dropZone.className = 'drop-zone';
  const dropLabel = document.createElement('span');
  dropLabel.className = 'zone-label';
  dropLabel.textContent = text('basket');

  const coins = document.createElement('div');
  coins.className = 'coins';

  dragZone.append(coins);
  if (state.showTextLabels) dragZone.append(dragLabel);
  if (state.showTextLabels) dropZone.append(dropLabel);
  board.append(dragZone, dropZone);
  els.stage.append(board);

  for (let index = 0; index < round.total; index += 1) {
    const coin = document.createElement('div');
    coin.className = 'coin';
    coin.tabIndex = 0;
    coin.setAttribute('role', 'button');
    coin.setAttribute('aria-label', round.themed ? round.itemLabel : text('coinAria'));
    coin.style.setProperty('--size', `${params.targetSize}px`);
    coin.textContent = round.item;
    attachDrag(coin, dropZone, round);
    coins.append(coin);
  }
}

function attachDrag(coin, dropZone, round) {
  let drag = null;

  const resetCoin = () => {
    coin.classList.remove('dragging');
    coin.style.transition = `transform ${SNAP_BACK_MS}ms ease-out`;
    coin.style.transform = '';
    window.setTimeout(() => {
      coin.style.transition = '';
    }, SNAP_BACK_MS + 50);
    drag = null;
  };

  coin.addEventListener('pointerdown', (event) => {
    if (round.done) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (drag) {
      multiTouchGesture = true;
      return;
    }
    if (!pointWithinSafeArea(event.clientX, event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
    };
    coin.classList.add('dragging');
    coin.style.transition = 'none';
    try {
      coin.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  });

  coin.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (multiTouchActive()) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    coin.style.transform = `translate(${dx}px, ${dy}px)`;
  });

  coin.addEventListener('pointerup', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    try {
      coin.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }

    const startedAt = drag.startedAt;
    const rejected =
      multiTouchActive() ||
      !isTouchDurationValid(startedAt, performance.now(), MIN_TOUCH_DURATION_MS);

    if (rejected) {
      resetCoin();
      return;
    }

    const coinRect = coin.getBoundingClientRect();
    const dropRect = dropZone.getBoundingClientRect();
    const centerX = coinRect.left + coinRect.width / 2;
    const centerY = coinRect.top + coinRect.height / 2;
    const insideDrop =
      centerX >= dropRect.left - DROP_TOLERANCE_PX &&
      centerX <= dropRect.right + DROP_TOLERANCE_PX &&
      centerY >= dropRect.top - DROP_TOLERANCE_PX &&
      centerY <= dropRect.bottom + DROP_TOLERANCE_PX;

    drag = null;

    if (insideDrop && !round.done) {
      round.moved += 1;
      playTone(700 + round.moved * 40, 0.2);
      coin.remove();
      if (round.moved >= round.total) submitOutcome(true);
    } else {
      resetCoin();
    }
  });

  coin.addEventListener('pointercancel', () => {
    if (drag) resetCoin();
  });
}

function submitOutcome(success, { timeout = false } = {}) {
  if (!started || !currentRound || currentRound.done || !currentGame || overlayOpen()) return;

  currentRound.done = true;
  clearRoundTimers();

  const reactionMs = Math.max(0, performance.now() - currentRound.startedAt);
  state = recordResult(state, currentGame.type, { success, timeout, reactionMs });
  persist();
  updateHud();
  updateStatusLine();

  if (success) {
    playSuccessTone();
    speech.speak(text(pick(PRAISE_KEYS)));
    retryTimer = window.setTimeout(() => startRound(), 1200);
  } else {
    speech.speak(text('tryAgain', { name: displayName() }));
    // Retry the SAME question: a fresh random target would let a repeated wrong tap
    // become "correct" by chance and be praised.
    const failedRound = currentRound;
    retryTimer = window.setTimeout(() => {
      if (currentRound !== failedRound || !started || overlayOpen()) return;
      failedRound.done = false;
      failedRound.startedAt = performance.now();
      speech.speak(failedRound.promptText);
      idleState = createIdleState(performance.now());
      scheduleIdlePrompt();
    }, 1700);
  }
}

function requestFullscreen() {
  const element = document.documentElement;
  if (!document.fullscreenElement && element.requestFullscreen) {
    element.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
}

function reRequestFullscreen() {
  if (!document.fullscreenElement) requestFullscreen();
}

function clearActivePointers() {
  activePointers = new Set();
  multiTouchGesture = false;
}

async function startApp() {
  const name = els.nameInput.value.trim();
  if (!name) {
    speech.speak(text('pleaseTypeName'));
    els.nameInput.focus();
    return;
  }

  state = setName(state, name);
  persist();
  unlockedAudio();
  requestFullscreen();

  els.startButton.disabled = true;
  els.startButton.textContent = text('starting');
  try {
    await packsReady;
  } finally {
    els.startButton.disabled = false;
    els.startButton.textContent = text('start');
  }

  if (!games.length) refreshGames([BUILTIN_STARTER_PACK]);

  els.welcome.classList.add('hidden');
  started = true;
  currentGame = null;
  roundsInType = 0;
  gameSessionStartedAt = null;
  updateHud();
  updateStatusLine();
  speech.speak(text('helloPlay', { name: displayName() }));
  window.setTimeout(() => startRound(), 1300);
}

function setSettingsScrolling(enabled) {
  document.documentElement.classList.toggle('settings-open', enabled);
  document.body.classList.toggle('settings-open', enabled);
}

function openSettings() {
  if (!started || !els.settings.classList.contains('hidden')) return;
  clearRoundTimers();
  speech.stop();
  disarmReset();
  applyLanguage();
  setSettingsScrolling(true);
  els.settings.classList.remove('hidden');
  els.settingsResume.focus({ preventScroll: true });
}

function closeSettings() {
  saveSettingsName();
  els.settings.classList.add('hidden');
  setSettingsScrolling(false);
  disarmReset();
  if (started) startRound(currentGame);
}

function disarmReset() {
  resetArmed = false;
  window.clearTimeout(resetDisarmTimer);
  els.settingsReset.textContent = text('reset');
}

function handleReset() {
  if (!resetArmed) {
    resetArmed = true;
    els.settingsReset.textContent = text('resetConfirm');
    resetDisarmTimer = window.setTimeout(disarmReset, 3500);
    return;
  }

  disarmReset();
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  state = createDefaultState();
  laundryState = createDefaultLaundryState();
  saveLaundryState(window.localStorage, laundryState);
  musicState = createDefaultMusicState();
  saveMusicState(window.localStorage, musicState);
  started = false;
  currentGame = null;
  currentRound = null;
  games = [];
  roundsInType = 0;
  gameSessionStartedAt = null;
  clearRoundTimers();
  speech.stop();
  els.settings.classList.add('hidden');
  setSettingsScrolling(false);
  els.stage.replaceChildren();
  els.nameInput.value = '';
  els.welcome.classList.remove('hidden');
  applyLanguage();
  refreshGames([BUILTIN_STARTER_PACK]);
  packsReady = loadPacks().then((packs) => {
    refreshGames(packs);
    return games;
  });
}

function saveSettingsName() {
  const name = els.settingName.value.trim();
  if (!name) {
    els.settingName.value = state.name;
    return;
  }
  if (name === state.name) return;
  state = setName(state, name);
  persist();
  els.nameInput.value = name;
}

function exitApp() {
  started = false;
  currentGame = null;
  currentRound = null;
  roundsInType = 0;
  gameSessionStartedAt = null;
  clearRoundTimers();
  speech.stop();
  disarmReset();
  els.settings.classList.add('hidden');
  setSettingsScrolling(false);
  els.stage.replaceChildren();
  els.nameInput.value = state.name;
  els.welcome.classList.remove('hidden');
  updateStatusLine();
  applyLanguage();
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

function installGlobalGuards() {
  document.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('dragstart', (event) => event.preventDefault());
  document.addEventListener(
    'dblclick',
    (event) => {
      event.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length > 1) event.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener(
    'gesturestart',
    (event) => {
      event.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        ['+', '-', '=', '0'].includes(event.key)
      ) {
        event.preventDefault();
      }
    },
    { passive: false },
  );
  window.addEventListener(
    'pointerdown',
    (event) => {
      reRequestFullscreen();
      if (!event.target?.closest?.('.settings-zone')) markTouch();
      activePointers.add(event.pointerId);
      multiTouchGesture = activePointers.size > 1;
    },
    { capture: true, passive: true },
  );

  const releasePointer = (event) => {
    activePointers.delete(event.pointerId);
  };
  window.addEventListener('pointerup', releasePointer, { capture: true, passive: true });
  window.addEventListener('pointercancel', releasePointer, { capture: true, passive: true });

  window.addEventListener('blur', () => {
    clearSettingsGesture();
    clearActivePointers();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearSettingsGesture();
      clearActivePointers();
    }
  });
}

function clearSettingsGesture() {
  settingsPointers = new Map();
  window.clearTimeout(settingsHoldTimer);
  settingsHoldTimer = null;
}

function bothSettingsHeld() {
  const zones = new Set(settingsPointers.values());
  return zones.has(0) && zones.has(1);
}

function checkSettingsHold() {
  if (!bothSettingsHeld()) {
    window.clearTimeout(settingsHoldTimer);
    settingsHoldTimer = null;
    return;
  }
  if (settingsHoldTimer !== null) return;

  settingsHoldTimer = window.setTimeout(() => {
    settingsHoldTimer = null;
    if (!bothSettingsHeld()) return;
    clearSettingsGesture();
    openSettings();
  }, SETTINGS_HOLD_MS);
}

function beginSettingsPress(zone, event) {
  if (!started || overlayOpen()) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  settingsPointers.set(event.pointerId, zone);
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
  checkSettingsHold();
}

function endSettingsPress(event) {
  if (!settingsPointers.has(event.pointerId)) return;
  settingsPointers.delete(event.pointerId);
  checkSettingsHold();
}

function installSettingsGesture() {
  els.settingsZone1.addEventListener('pointerdown', (event) => beginSettingsPress(0, event));
  els.settingsZone2.addEventListener('pointerdown', (event) => beginSettingsPress(1, event));
  window.addEventListener('pointerup', endSettingsPress, { capture: true, passive: true });
  window.addEventListener('pointercancel', endSettingsPress, { capture: true, passive: true });
}

function wireUi() {
  els.startButton.addEventListener('click', startApp);
  els.nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      startApp();
    }
  });

  els.settingsResume.addEventListener('click', closeSettings);
  els.settingsExit.addEventListener('click', exitApp);
  els.settingsReset.addEventListener('click', handleReset);

  els.settingMute.addEventListener('change', () => {
    state = setStateSpeechMuted(state, els.settingMute.checked);
    persist();
    if (state.speechMuted) speech.stop();
  });
  els.settingGame.addEventListener('change', () => {
    state = setStateSelectedGame(state, els.settingGame.value);
    persist();
    renderLevelChooser();
    syncSettingsFields();
  });
  els.settingLevel.addEventListener('change', () => {
    const type = currentSettingsGameType();
    const value = els.settingLevel.value === '' ? null : Number(els.settingLevel.value);
    state = setStateFixedLevel(state, type, value);
    persist();
    syncSettingsFields();
  });
  els.settingLanguage.addEventListener('change', () => {
    state = setStateLanguage(state, els.settingLanguage.value);
    persist();
    applyLanguage();
  });
  els.settingGender.addEventListener('change', () => {
    state = setStateGender(state, els.settingGender.value);
    persist();
    applyLanguage();
  });
  els.settingName.addEventListener('change', saveSettingsName);
  els.settingName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveSettingsName();
    }
  });
  els.settingTextLabels.addEventListener('change', () => {
    state = setStateShowTextLabels(state, els.settingTextLabels.checked);
    persist();
  });
  els.settingStatusLine.addEventListener('change', () => {
    state = setStateShowStatusLine(state, els.settingStatusLine.checked);
    persist();
    updateStatusLine();
  });
  els.settingVoice.addEventListener('change', () => {
    state = setStateVoiceURI(state, els.settingVoice.value);
    persist();
  });
  els.settingRate.addEventListener('change', () => {
    state = setStateSpeechRate(state, els.settingRate.value);
    persist();
  });
}

function boot() {
  installGlobalGuards();
  installSettingsGesture();
  wireUi();
  window.setInterval(updateStatusLine, STATUS_UPDATE_MS);

  if (speech.available) {
    loadVoices();
    try {
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    } catch {
      /* ignore */
    }
  }

  if (state.name) {
    els.nameInput.value = state.name;
  }

  applyLanguage();

  packsReady = loadPacks()
    .then((packs) => {
      refreshGames(packs);
      return games;
    })
    .catch(() => {
      refreshGames([BUILTIN_STARTER_PACK]);
      return games;
    });
}

boot();
