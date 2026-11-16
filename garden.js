import {
  MAX_DENSITY_LEVEL,
  MAX_MOTOR_LEVEL,
  MAX_RULE_LEVEL,
  MIN_DENSITY_LEVEL,
  MIN_MOTOR_LEVEL,
  MIN_RULE_LEVEL,
  PLANTS,
  addToShelf,
  createPots,
  loadShelf,
  normalizeShelf,
  saveShelf,
  targetPot,
  waterPlant,
} from './garden-logic.js';
import { colorName, localizedName, normalizeLanguage, t } from './i18n.js';
import {
  MIN_TOUCH_DURATION_MS,
  SAFE_MARGIN,
  isTouchDurationValid,
  isWithinSafeArea,
} from './touch.js';

const DROP_MS = 430;
const POP_MS = 540;
const SHAKE_MS = 520;
const PULSE_MS = 640;
const AUTO_WATER_DELAY_MS = 520;
const BLOOM_DELAY_MS = 500;
const FLY_MS = 760;
const BUTTERFLY_MS = 1500;

const CATALOG_COLOURS = Object.freeze(['yellow', 'red', 'pink', 'white']);
const RISING_NOTES = Object.freeze([523.25, 659.25]);
const BLOOM_NOTES = Object.freeze([523.25, 659.25, 783.99, 987.77, 1174.66]);

const PLANT_BY_ID = new Map(PLANTS.map((plant) => [plant.id, plant]));

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function pickIndex(length, rng) {
  if (length <= 0) return 0;
  const value = Number(rng());
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(0.999999999, Math.max(0, value));
  return Math.floor(clamped * length);
}

function safeRandom(value) {
  return typeof value === 'function' ? value : Math.random;
}

function nowSafe(point) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return isWithinSafeArea(point, { width, height }, SAFE_MARGIN);
}

function stopScheduled(timers) {
  for (const timer of timers) window.clearTimeout(timer);
  timers.clear();
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function chooseColour(pots, preferred, rng) {
  if (
    typeof preferred === 'string' &&
    pots.some((pot) => pot.colour === preferred)
  ) {
    return preferred;
  }
  const catalogue = pots.filter((pot) => CATALOG_COLOURS.includes(pot.colour));
  const pool = catalogue.length > 0 ? catalogue : pots;
  const chosen = pool[pickIndex(pool.length, rng)];
  return chosen ? chosen.colour : null;
}

export function renderGarden(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const language = normalizeLanguage(settings.language);
  const name = typeof settings.name === 'string' ? settings.name : '';
  const showTextLabels = settings.showTextLabels === true;
  const rng = safeRandom(settings.rng);
  const motorLevel = clamp(settings.motorLevel, MIN_MOTOR_LEVEL, MAX_MOTOR_LEVEL);
  const ruleLevel = clamp(settings.ruleLevel, MIN_RULE_LEVEL, MAX_RULE_LEVEL);
  const densityLevel = clamp(
    settings.densityLevel,
    MIN_DENSITY_LEVEL,
    MAX_DENSITY_LEVEL,
  );

  let pots = createPots(densityLevel, rng);
  let targetColour =
    ruleLevel === 3 ? chooseColour(pots, settings.targetColour, rng) : null;
  let targetIndex = targetPot(
    pots,
    ruleLevel === 3 ? { level: 3, colour: targetColour } : { level: ruleLevel },
  );
  targetIndex = pots.findIndex((pot) => pot === targetIndex);
  if (targetIndex < 0) targetIndex = 0;
  let activeIndex = targetIndex;
  let wrongTaps = 0;
  let disposed = false;
  let busy = false;
  let tap = null;
  let multiTouch = false;

  const timers = new Set();
  const activePointers = new Set();

  function later(callback, delay) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function storage() {
    try {
      return settings.storage || window.localStorage || null;
    } catch {
      return null;
    }
  }

  function todayString() {
    if (
      typeof settings.today === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(settings.today.trim())
    ) {
      return settings.today.trim();
    }
    const now = settings.now instanceof Date ? settings.now : new Date();
    return formatDate(now);
  }

  let shelf = Array.isArray(settings.shelf)
    ? normalizeShelf(settings.shelf)
    : loadShelf(storage());

  function audioContext() {
    try {
      if (typeof settings.getAudioContext === 'function') {
        return settings.getAudioContext() || null;
      }
      return settings.audioContext || null;
    } catch {
      return null;
    }
  }

  function playTone(frequency, level, delay, duration) {
    const context = audioContext();
    if (!context) return;
    try {
      if (!Number.isFinite(frequency) || frequency <= 0) return;
      if (context.state === 'suspended' && typeof context.resume === 'function') {
        context.resume().catch(() => {});
      }

      const start = context.currentTime + (delay || 0);
      const end = start + (duration || 0.5);

      const fundamental = context.createOscillator();
      fundamental.type = 'sine';
      fundamental.frequency.setValueAtTime(frequency, start);

      const fundamentalGain = context.createGain();
      fundamentalGain.gain.setValueAtTime(0.0001, start);
      fundamentalGain.gain.exponentialRampToValueAtTime(level, start + 0.02);
      fundamentalGain.gain.exponentialRampToValueAtTime(0.0001, end);

      fundamental.connect(fundamentalGain);
      fundamentalGain.connect(context.destination);
      fundamental.start(start);
      fundamental.stop(end + 0.02);

      const overtone = context.createOscillator();
      overtone.type = 'sine';
      overtone.frequency.setValueAtTime(frequency * 2, start);

      const overtoneGain = context.createGain();
      overtoneGain.gain.setValueAtTime(0.0001, start);
      overtoneGain.gain.exponentialRampToValueAtTime(level * 0.2, start + 0.02);
      overtoneGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);

      overtone.connect(overtoneGain);
      overtoneGain.connect(context.destination);
      overtone.start(start);
      overtone.stop(start + 0.42);
    } catch {
      /* Sound is an enhancement. */
    }
  }

  function playRisingChime() {
    RISING_NOTES.forEach((frequency, index) => {
      playTone(frequency, 0.12, index * 0.12, 0.5);
    });
  }

  function playBloomTune() {
    BLOOM_NOTES.forEach((frequency, index) => {
      playTone(frequency, 0.1, index * 0.14, 0.55);
    });
  }

  const promptElement = showTextLabels ? document.createElement('p') : null;
  if (promptElement) promptElement.className = 'garden-prompt';

  const board = document.createElement('div');
  board.className = 'garden-board';

  const skyElement = document.createElement('div');
  skyElement.className = 'garden-sky';
  skyElement.setAttribute('aria-hidden', 'true');

  const potsElement = document.createElement('div');
  potsElement.className = 'garden-pots';
  potsElement.dataset.count = String(pots.length);
  potsElement.setAttribute('role', 'group');

  const shelfElement = document.createElement('div');
  shelfElement.className = 'garden-shelf';
  shelfElement.setAttribute('role', 'list');

  const potElements = [];
  const plantElements = [];

  pots.forEach((pot, index) => {
    const potElement = document.createElement('div');
    potElement.className = 'garden-pot';
    potElement.dataset.index = String(index);
    potElement.dataset.colour = pot.colour;
    potElement.setAttribute('role', 'img');
    potElement.setAttribute('aria-label', localizedName(pot, language));

    const plantElement = document.createElement('span');
    plantElement.className = 'garden-plant';
    plantElement.textContent = pot.stages[pot.stage];
    plantElement.setAttribute('aria-hidden', 'true');

    const baseElement = document.createElement('span');
    baseElement.className = 'garden-pot-base';
    baseElement.setAttribute('aria-hidden', 'true');

    potElement.append(plantElement);
    if (showTextLabels) {
      const label = document.createElement('span');
      label.className = 'garden-plant-name';
      label.textContent = localizedName(pot, language);
      potElement.append(label);
    }
    potElement.append(baseElement);

    if (pot.thirsty) potElement.classList.add('is-thirsty');

    potsElement.append(potElement);
    potElements.push(potElement);
    plantElements.push(plantElement);
  });

  board.append(skyElement, potsElement, shelfElement);
  if (promptElement) stage.append(promptElement);
  stage.append(board);

  function renderShelf() {
    shelfElement.replaceChildren();
    shelfElement.classList.toggle('is-empty', shelf.length === 0);
    for (const flower of shelf) {
      const base = PLANT_BY_ID.get(flower.id);
      if (!base) continue;
      const element = document.createElement('span');
      element.className = 'garden-shelf-flower';
      element.textContent = base.stages[base.stages.length - 1];
      element.setAttribute('role', 'listitem');
      element.setAttribute('aria-label', localizedName(base, language));
      shelfElement.append(element);
    }
  }

  function renderPlant(index) {
    const pot = pots[index];
    if (!pot) return;
    plantElements[index].textContent = pot.stages[pot.stage];
    potElements[index].classList.toggle('is-thirsty', pot.thirsty && !pot.bloomed);
    potElements[index].classList.toggle('is-bloomed', pot.bloomed);
  }

  function announce(text) {
    if (promptElement) promptElement.textContent = text;
    if (typeof settings.onPrompt === 'function') settings.onPrompt(text);
  }

  function rulePrompt() {
    if (ruleLevel === 3) {
      return t(language, 'gardenColourPrompt', {
        color: colorName(language, targetColour),
      });
    }
    if (ruleLevel === 2) return t(language, 'gardenThirsty', { name });
    return t(language, 'gardenStart', { name });
  }

  function restartAnimation(element, className, duration) {
    if (!element) return;
    element.classList.remove(className);
    void element.getBoundingClientRect();
    element.classList.add(className);
    later(() => element.classList.remove(className), duration);
  }

  function shakePot(index) {
    restartAnimation(potElements[index], 'is-shaking', SHAKE_MS);
  }

  function pulsePot(index) {
    restartAnimation(potElements[index], 'is-pulsing', PULSE_MS);
  }

  function dropOnPot(index) {
    const potElement = potElements[index];
    if (!potElement) return;
    const drop = document.createElement('span');
    drop.className = 'garden-drop';
    drop.textContent = '💧';
    drop.setAttribute('aria-hidden', 'true');
    potElement.append(drop);
    later(() => drop.remove(), DROP_MS + 120);
  }

  function popPlant(index) {
    restartAnimation(plantElements[index], 'is-growing', POP_MS);
  }

  function releaseButterfly() {
    const butterfly = document.createElement('span');
    butterfly.className = 'garden-butterfly';
    butterfly.textContent = '🦋';
    butterfly.setAttribute('aria-hidden', 'true');
    board.append(butterfly);
    later(() => butterfly.remove(), BUTTERFLY_MS + 100);
  }

  function flyToShelf(index, done) {
    const plantElement = plantElements[index];
    const pot = pots[index];
    if (!plantElement || !pot) {
      done();
      return;
    }

    const boardRect = board.getBoundingClientRect();
    const plantRect = plantElement.getBoundingClientRect();
    const shelfRect = shelfElement.getBoundingClientRect();
    const startX = plantRect.left + plantRect.width / 2 - boardRect.left;
    const startY = plantRect.top + plantRect.height / 2 - boardRect.top;
    const endX = shelfRect.left + shelfRect.width / 2 - boardRect.left;
    const endY = shelfRect.top + shelfRect.height / 2 - boardRect.top;

    const flyer = document.createElement('span');
    flyer.className = 'garden-flyer';
    flyer.textContent = pot.stages[pot.stages.length - 1];
    flyer.setAttribute('aria-hidden', 'true');
    flyer.style.left = `${startX}px`;
    flyer.style.top = `${startY}px`;
    board.append(flyer);

    void flyer.getBoundingClientRect();
    const dx = endX - startX;
    const dy = endY - startY;
    flyer.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.42)`;

    later(() => {
      flyer.remove();
      done();
    }, FLY_MS);
  }

  function addShelfFlower(plant) {
    shelf = addToShelf(shelf, plant, todayString());
    saveShelf(storage(), shelf);
    renderShelf();
  }

  function finishPot(index) {
    const pot = pots[index];
    const element = potElements[index];
    if (!pot || !element) return;
    element.classList.add('is-finished');
    element.classList.remove('is-thirsty');
    plantElements[index].textContent = pot.stages[1];
  }

  function waterPot(index) {
    if (disposed) return;
    const pot = pots[index];
    if (!pot) return;

    busy = true;
    wrongTaps = 0;
    activeIndex = index;
    dropOnPot(index);
    playRisingChime();

    later(() => {
      if (disposed) return;
      const grown = waterPlant(pots[index]);
      if (!grown) {
        busy = false;
        return;
      }

      pots[index] = grown;
      renderPlant(index);
      popPlant(index);

      if (!grown.bloomed) {
        busy = false;
        return;
      }

      announce(t(language, 'gardenBloom', { name }));
      releaseButterfly();
      playBloomTune();

      later(() => {
        if (disposed) return;
        flyToShelf(index, () => {
          if (disposed) return;
          addShelfFlower(grown);
          finishPot(index);
          if (typeof settings.onSuccess === 'function') {
            settings.onSuccess({
              reason: 'bloom',
              plant: grown,
              potIndex: index,
              motorLevel,
              ruleLevel,
              densityLevel,
            });
          }
          busy = false;
        });
      }, BLOOM_DELAY_MS);
    }, DROP_MS);
  }

  function potAt(point, level) {
    for (let index = potElements.length - 1; index >= 0; index -= 1) {
      const rect = potElements[index].getBoundingClientRect();
      const margin =
        level === 2 ? Math.max(28, Math.min(rect.width, rect.height) * 0.08) : 0;
      if (
        point.x >= rect.left - margin &&
        point.x <= rect.right + margin &&
        point.y >= rect.top - margin &&
        point.y <= rect.bottom + margin
      ) {
        return index;
      }
    }
    return null;
  }

  function notifyFailure(reason) {
    if (typeof settings.onFailure === 'function') {
      settings.onFailure({
        reason,
        plant: pots[targetIndex],
        potIndex: targetIndex,
        motorLevel,
        ruleLevel,
        densityLevel,
      });
    }
  }

  function autoWater() {
    wrongTaps = 0;
    const index = activeIndex >= 0 ? activeIndex : targetIndex;
    busy = true;
    pulsePot(index);
    later(() => {
      if (disposed) return;
      busy = false;
      waterPot(index);
    }, AUTO_WATER_DELAY_MS);
  }

  function motorMiss() {
    wrongTaps += 1;
    pulsePot(activeIndex >= 0 ? activeIndex : targetIndex);
    notifyFailure('motor');
    if (wrongTaps >= 2) autoWater();
  }

  function ruleMiss(index) {
    wrongTaps += 1;
    shakePot(index);
    pulsePot(targetIndex);
    notifyFailure('rule');
    if (wrongTaps >= 2) autoWater();
  }

  function handleTap(point) {
    if (disposed || busy) return;

    if (motorLevel === 1) {
      waterPot(activeIndex >= 0 ? activeIndex : targetIndex);
      return;
    }

    const hit = potAt(point, motorLevel);
    if (hit === null) {
      motorMiss();
      return;
    }

    if (ruleLevel === 1) {
      activeIndex = hit;
      waterPot(hit);
      return;
    }

    if (hit !== targetIndex) {
      ruleMiss(hit);
      return;
    }

    activeIndex = hit;
    waterPot(hit);
  }

  function point(event) {
    return { x: event.clientX, y: event.clientY };
  }

  function onPointerDown(event) {
    activePointers.add(event.pointerId);
    if (activePointers.size > 1) multiTouch = true;
  }

  function onPointerUp(event) {
    activePointers.delete(event.pointerId);
    if (activePointers.size === 0) multiTouch = false;
  }

  function onBoardPointerDown(event) {
    if (disposed || busy) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (activePointers.size > 1) {
      multiTouch = true;
      tap = null;
      return;
    }
    if (!nowSafe(point(event))) return;
    tap = { pointerId: event.pointerId, startedAt: performance.now() };
  }

  function onBoardPointerUp(event) {
    if (!tap || tap.pointerId !== event.pointerId) return;
    const startedAt = tap.startedAt;
    tap = null;
    if (multiTouch) return;
    if (!nowSafe(point(event))) return;
    if (!isTouchDurationValid(startedAt, performance.now(), MIN_TOUCH_DURATION_MS)) {
      return;
    }
    handleTap(point(event));
  }

  function onBoardPointerCancel() {
    tap = null;
  }

  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  window.addEventListener('pointerup', onPointerUp, { capture: true, passive: true });
  window.addEventListener('pointercancel', onPointerUp, { capture: true, passive: true });
  board.addEventListener('pointerdown', onBoardPointerDown);
  board.addEventListener('pointerup', onBoardPointerUp);
  board.addEventListener('pointercancel', onBoardPointerCancel);

  renderShelf();
  announce(rulePrompt());

  return function cleanup() {
    disposed = true;
    stopScheduled(timers);
    window.removeEventListener('pointerdown', onPointerDown, { capture: true });
    window.removeEventListener('pointerup', onPointerUp, { capture: true });
    window.removeEventListener('pointercancel', onPointerUp, { capture: true });
    board.removeEventListener('pointerdown', onBoardPointerDown);
    board.removeEventListener('pointerup', onBoardPointerUp);
    board.removeEventListener('pointercancel', onBoardPointerCancel);
  };
}
