import {
  BUILTIN_STARTER_PACK,
  COLOR_TONES,
  PACKS_CACHE_KEY,
  ROUNDS_PER_TYPE,
  chooseNextGame,
  createDefaultState,
  createIdleState,
  getLevelParams,
  idlePromptDelay,
  loadState,
  markIdlePromptRepeated,
  noteTouch,
  packsToGames,
  packsToThemes,
  recordResult,
  resolveThemes,
  saveState,
  setGender as setStateGender,
  setLanguage as setStateLanguage,
  setName,
  setThemes as setStateThemes,
  shouldRepeatIdlePrompt,
  STORAGE_KEY,
  themeItems,
  validatePack,
  validatePackIndex,
} from './engine.js';
import {
  SPEECH_LANGS,
  formatPrompt as buildPrompt,
  formatText,
  gameColorName,
  gameText,
  itemName,
  normalizeGender,
  normalizeLanguage,
  t,
  themeName,
} from './i18n.js';
import {
  MIN_TOUCH_DURATION_MS,
  SAFE_MARGIN,
  isSingleTouch,
  isTouchDurationValid,
  isWithinSafeArea,
} from './touch.js';

const PRAISE_KEYS = ['praiseGood', 'praiseWellDone'];
const CORNER_SIZE = 180;
const LONG_PRESS_MS = 2000;
const PACK_FETCH_TIMEOUT_MS = 5000;
const DROP_TOLERANCE_PX = 64;
const SNAP_BACK_MS = 260;

const els = {
  stage: document.getElementById('stage'),
  gameTitle: document.getElementById('game-title'),
  status: document.getElementById('status'),
  welcome: document.getElementById('welcome'),
  welcomeTitle: document.getElementById('welcome-title'),
  nameLabel: document.getElementById('name-label'),
  nameInput: document.getElementById('name-input'),
  startButton: document.getElementById('start-button'),
  hint: document.getElementById('hint'),
  nameDialog: document.getElementById('name-dialog'),
  nameDialogTitle: document.getElementById('name-dialog-title'),
  renameInput: document.getElementById('rename-input'),
  renameSave: document.getElementById('rename-save'),
  renameCancel: document.getElementById('rename-cancel'),
  menu: document.getElementById('menu'),
  menuTitle: document.getElementById('menu-title'),
  menuResume: document.getElementById('menu-resume'),
  menuRename: document.getElementById('menu-rename'),
  menuLanguage: document.getElementById('menu-language'),
  menuGender: document.getElementById('menu-gender'),
  languageLabel: document.getElementById('language-label'),
  genderLabel: document.getElementById('gender-label'),
  themesLabel: document.getElementById('themes-label'),
  menuThemes: document.getElementById('menu-themes'),
  menuExit: document.getElementById('menu-exit'),
  menuReset: document.getElementById('menu-reset'),
};

let state = loadState(window.localStorage);
let games = [];
let allThemes = [];
let packsReady = null;
let started = false;
let currentGame = null;
let currentRound = null;
let roundsInType = 0;
let retryTimer = null;
let idleTimer = null;
let idleState = createIdleState(0);
let resetArmed = false;
let resetDisarmTimer = null;
let audioContext = null;
let activePointers = new Set();
let multiTouchGesture = false;

function language() {
  return normalizeLanguage(state.language);
}

function gender() {
  return normalizeGender(state.gender);
}

function text(key, values = {}) {
  return t(language(), key, values, gender());
}

function findVoice(lang) {
  try {
    const voices = window.speechSynthesis.getVoices();
    const prefix = lang === 'he' ? 'he' : 'en';
    const matches = (voice) => voice.lang.replace('_', '-').toLowerCase().startsWith(prefix);
    return voices.find((voice) => matches(voice) && voice.localService) || voices.find(matches) || null;
  } catch {
    return null;
  }
}

const speech = {
  available:
    typeof window.speechSynthesis !== 'undefined' &&
    typeof window.SpeechSynthesisUtterance !== 'undefined',
  speak(message, lang = language()) {
    if (!this.available || !message) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new window.SpeechSynthesisUtterance(String(message));
      utterance.lang = SPEECH_LANGS[lang] || SPEECH_LANGS.en;
      utterance.rate = 0.88;
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
  const level = currentGame ? state.levels[currentGame.type] || 1 : 1;
  els.status.textContent = text('level', { level });
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

  els.nameDialogTitle.textContent = text('yourName');
  els.renameInput.placeholder = text('namePlaceholder');
  els.renameSave.textContent = text('save');
  els.renameCancel.textContent = text('cancel');

  els.menuTitle.textContent = text('menuTitle');
  els.menuResume.textContent = text('resume');
  els.menuRename.textContent = text('changeName');
  els.languageLabel.textContent = text('language');
  els.genderLabel.textContent = text('gender');
  els.menuExit.textContent = text('exit');
  els.menuReset.textContent = resetArmed ? text('resetConfirm') : text('reset');

  const languageKeys = { he: 'languageHebrew', en: 'languageEnglish' };
  for (const option of els.menuLanguage.options) {
    option.textContent = text(languageKeys[option.value] || 'languageEnglish');
  }
  const genderKeys = { m: 'genderMale', f: 'genderFemale' };
  for (const option of els.menuGender.options) {
    option.textContent = text(genderKeys[option.value] || 'genderMale');
  }

  els.menuLanguage.value = lang;
  els.menuGender.value = gender();
  els.themesLabel.textContent = text('themes');
  renderThemeChooser();

  updateHud();
}

function renderThemeChooser() {
  if (!els.menuThemes) return;
  const selected =
    state.themes === null ? new Set(allThemes.map((theme) => theme.id)) : new Set(state.themes);

  els.menuThemes.replaceChildren();
  for (const theme of allThemes) {
    const label = document.createElement('label');
    label.className = 'theme-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'theme-checkbox';
    checkbox.value = theme.id;
    checkbox.checked = selected.has(theme.id);
    checkbox.addEventListener('change', () => {
      const checked = [...els.menuThemes.querySelectorAll('input[type="checkbox"]:checked')].map(
        (input) => input.value,
      );
      state = setStateThemes(state, checked);
      persist();
    });

    const name = document.createElement('span');
    name.textContent = themeName(theme, language());

    label.append(checkbox, name);
    els.menuThemes.append(label);
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
  if (!games.length) games = packsToGames([BUILTIN_STARTER_PACK]);
  if (!allThemes.length) allThemes = packsToThemes([BUILTIN_STARTER_PACK]);
  if (els.menuThemes) renderThemeChooser();
}

function overlayOpen() {
  return (
    !els.welcome.classList.contains('hidden') ||
    !els.menu.classList.contains('hidden') ||
    !els.nameDialog.classList.contains('hidden')
  );
}

function clearRoundTimers() {
  window.clearTimeout(retryTimer);
  window.clearTimeout(idleTimer);
  retryTimer = null;
  idleTimer = null;
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

  if (gameOverride) {
    currentGame = gameOverride;
  } else if (!currentGame) {
    currentGame = chooseNextGame(games, null, 0) || games[0];
    roundsInType = 1;
  } else {
    const previousType = currentGame.type;
    currentGame = chooseNextGame(games, currentGame, roundsInType) || games[0];
    roundsInType = currentGame.type === previousType ? roundsInType + 1 : 1;
  }

  const level = state.levels[currentGame.type] || 1;
  const params = getLevelParams(currentGame.type, level);
  currentRound = createRound(currentGame, params);

  updateHud();
  renderRound(currentGame, params, currentRound);
  speech.speak(currentRound.promptText);

  idleState = createIdleState(performance.now());
  scheduleIdlePrompt();
}

function promptElement(text) {
  const heading = document.createElement('h1');
  heading.className = 'prompt';
  heading.textContent = text;
  return heading;
}

function renderRound(game, params, round) {
  els.stage.replaceChildren(promptElement(round.promptText));
  els.stage.dataset.game = game.type;

  if (game.type === 'buttons') renderButtons(game, params, round);
  else if (game.type === 'count') renderCount(params, round);
  else renderDrag(params, round);
}

function renderButtons(game, params, round) {
  const choices = document.createElement('div');
  choices.className = 'choices';
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

      const label = document.createElement('span');
      label.className = 'item-name';
      label.textContent = capitalize(name);

      button.append(emoji, label);
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

    const label = document.createElement('span');
    label.textContent = capitalize(colorLabel(color));
    button.append(label);

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

  dragZone.append(dragLabel, coins);
  dropZone.append(dropLabel);
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

  if (success) {
    playSuccessTone();
    speech.speak(text(pick(PRAISE_KEYS)));
    retryTimer = window.setTimeout(() => startRound(), 1200);
  } else {
    speech.speak(text('tryAgain', { name: displayName() }));
    retryTimer = window.setTimeout(() => startRound(currentGame), 1700);
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
  updateHud();
  speech.speak(text('helloPlay', { name: displayName() }));
  window.setTimeout(() => startRound(), 1300);
}

function openMenu() {
  if (
    !started ||
    !els.menu.classList.contains('hidden') ||
    !els.nameDialog.classList.contains('hidden')
  ) {
    return;
  }
  clearRoundTimers();
  speech.stop();
  disarmReset();
  applyLanguage();
  els.menu.classList.remove('hidden');
  els.menuResume.focus({ preventScroll: true });
}

function closeMenu() {
  els.menu.classList.add('hidden');
  disarmReset();
  if (started) startRound(currentGame);
}

function disarmReset() {
  resetArmed = false;
  window.clearTimeout(resetDisarmTimer);
  els.menuReset.textContent = text('reset');
}

function handleReset() {
  if (!resetArmed) {
    resetArmed = true;
    els.menuReset.textContent = text('resetConfirm');
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
  started = false;
  currentGame = null;
  currentRound = null;
  games = [];
  roundsInType = 0;
  clearRoundTimers();
  speech.stop();
  els.menu.classList.add('hidden');
  els.nameDialog.classList.add('hidden');
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

function openRename() {
  els.menu.classList.add('hidden');
  els.renameInput.value = state.name;
  els.nameDialog.classList.remove('hidden');
  els.renameInput.focus();
  els.renameInput.select();
}

function closeRename(returnToMenu = true) {
  els.nameDialog.classList.add('hidden');
  if (returnToMenu) {
    els.menu.classList.remove('hidden');
    els.menuRename.focus({ preventScroll: true });
  }
}

function saveRename() {
  const name = els.renameInput.value.trim();
  if (!name) {
    speech.speak(text('pleaseTypeName'));
    els.renameInput.focus();
    return;
  }
  state = setName(state, name);
  persist();
  els.nameDialog.classList.add('hidden');
  els.nameInput.value = name;
  applyLanguage();
  if (started) {
    speech.speak(text('helloShort', { name: displayName() }));
    window.setTimeout(() => startRound(currentGame), 1100);
  }
}

function exitApp() {
  started = false;
  currentGame = null;
  currentRound = null;
  roundsInType = 0;
  clearRoundTimers();
  speech.stop();
  disarmReset();
  els.menu.classList.add('hidden');
  els.nameDialog.classList.add('hidden');
  els.stage.replaceChildren();
  els.nameInput.value = state.name;
  els.welcome.classList.remove('hidden');
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
    clearCornerTracking();
    clearActivePointers();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearCornerTracking();
      clearActivePointers();
    }
  });
}

let cornerPointers = new Map();
let cornerTimer = null;
let armedCorner = null;

function cornerAt(x, y) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const size = Math.min(CORNER_SIZE, width / 2, height / 2);
  if (x < size && y < size) return 'top-left';
  if (x > width - size && y < size) return 'top-right';
  if (x < size && y > height - size) return 'bottom-left';
  if (x > width - size && y > height - size) return 'bottom-right';
  return null;
}

function clearCornerTracking() {
  cornerPointers = new Map();
  window.clearTimeout(cornerTimer);
  cornerTimer = null;
  armedCorner = null;
}

function checkCornerPress() {
  if (cornerPointers.size !== 2) {
    window.clearTimeout(cornerTimer);
    cornerTimer = null;
    armedCorner = null;
    return;
  }

  const points = [...cornerPointers.values()];
  const corners = points.map((point) => cornerAt(point.x, point.y));
  if (!corners[0] || corners[0] !== corners[1]) {
    window.clearTimeout(cornerTimer);
    cornerTimer = null;
    armedCorner = null;
    return;
  }

  if (armedCorner === corners[0] && cornerTimer !== null) return;

  window.clearTimeout(cornerTimer);
  armedCorner = corners[0];
  cornerTimer = window.setTimeout(() => {
    cornerTimer = null;
    if (cornerPointers.size !== 2 || !armedCorner) {
      armedCorner = null;
      return;
    }
    const current = [...cornerPointers.values()].map((point) => cornerAt(point.x, point.y));
    if (current.length === 2 && current[0] === armedCorner && current[1] === armedCorner) {
      armedCorner = null;
      openMenu();
    } else {
      armedCorner = null;
    }
  }, LONG_PRESS_MS);
}

function installCompanionExit() {
  window.addEventListener(
    'pointerdown',
    (event) => {
      markTouch();
      cornerPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      checkCornerPress();
    },
    { capture: true, passive: true },
  );

  window.addEventListener(
    'pointermove',
    (event) => {
      if (!cornerPointers.has(event.pointerId)) return;
      cornerPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      checkCornerPress();
    },
    { capture: true, passive: true },
  );

  const release = (event) => {
    if (!cornerPointers.has(event.pointerId)) return;
    cornerPointers.delete(event.pointerId);
    checkCornerPress();
  };

  window.addEventListener('pointerup', release, { capture: true, passive: true });
  window.addEventListener('pointercancel', release, { capture: true, passive: true });
}

function wireUi() {
  els.startButton.addEventListener('click', startApp);
  els.nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      startApp();
    }
  });

  els.menuResume.addEventListener('click', closeMenu);
  els.menuRename.addEventListener('click', openRename);
  els.menuExit.addEventListener('click', exitApp);
  els.menuReset.addEventListener('click', handleReset);
  els.menuLanguage.addEventListener('change', () => {
    state = setStateLanguage(state, els.menuLanguage.value);
    persist();
    applyLanguage();
  });
  els.menuGender.addEventListener('change', () => {
    state = setStateGender(state, els.menuGender.value);
    persist();
    applyLanguage();
  });

  els.renameSave.addEventListener('click', saveRename);
  els.renameCancel.addEventListener('click', () => closeRename(true));
  els.renameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeRename(true);
    }
  });
}

function boot() {
  installGlobalGuards();
  installCompanionExit();
  wireUi();

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
