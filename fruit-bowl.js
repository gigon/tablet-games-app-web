// Fruit bowl: a big grid bowl where fruit drops in, equal neighbours merge, and the bowl
// quietly looks after itself when it is full. See specs/toy-7.md.
//
//   renderFruitBowl(stage, options) -> cleanup
//
// There is no physics and no losing. Every accepted touch answers at once with a poke,
// then either drops the next fruit or lets the bowl merge / clear a little room.

import { finale, playChord, playRun, playStep, poke, pop, sparkle } from './fx.js';
import { attachTouch } from './input.js';
import {
  CHAIN,
  TOP_KIND,
  autoStep,
  createUnit,
  isDone,
  layoutCells,
  matchingEmptyIndices,
  matchingFruitIndices,
  touchUnit,
  unitResults,
} from './fruit-bowl-logic.js';

const AUTO_FINISH_AFTER_MS = 60000;
const AUTO_STEP_MS = 750;
const MAX_AUTO_STEPS = 14;

const FINALE_COLORS = Object.freeze(['#ffd43b', '#ff8fab', '#7fffd4', '#9ec5ff', '#ffffff']);

function fruitScale(kind) {
  return 0.6 + kind * 0.056;
}

export function renderFruitBowl(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const motorLevel = Number(settings.motorLevel) || 1;

  let unit = createUnit({
    densityLevel: settings.densityLevel,
    ruleLevel: settings.ruleLevel,
  });
  let disposed = false;
  let finishing = false;
  let autoSteps = 0;
  let idleTimer = null;
  let autoTimer = null;
  let cancelFinale = null;
  const timers = new Set();
  const cellElements = new Map();
  const saidKinds = new Set();

  function later(callback, delay) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function audio() {
    try {
      return typeof settings.getAudioContext === 'function' ? settings.getAudioContext() : null;
    } catch {
      return null;
    }
  }

  function say(id) {
    try {
      if (typeof settings.say === 'function') settings.say(id);
    } catch {
      /* speech is an enhancement */
    }
  }

  // --- scene -------------------------------------------------------------------
  const board = document.createElement('div');
  board.className = 'fruit-bowl-board';

  const next = document.createElement('div');
  next.className = 'fruit-bowl-next';
  next.setAttribute('aria-hidden', 'true');
  const nextFruit = document.createElement('span');
  nextFruit.className = 'fruit-bowl-fruit fruit-bowl-next-fruit';
  next.append(nextFruit);

  const bowl = document.createElement('div');
  bowl.className = 'fruit-bowl-bowl';
  const rim = document.createElement('span');
  rim.className = 'fruit-bowl-rim';
  rim.setAttribute('aria-hidden', 'true');
  const grid = document.createElement('div');
  grid.className = 'fruit-bowl-grid';
  grid.style.setProperty('--cols', String(unit.cols));
  grid.style.setProperty('--rows', String(unit.rows));
  bowl.append(rim, grid);
  board.append(next, bowl);
  stage.append(board);

  function points() {
    return layoutCells(unit, grid.getBoundingClientRect());
  }

  function centre(index) {
    return points()[index] || null;
  }

  function sizeBowl() {
    const rect = grid.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const cellSize = Math.min(rect.width / unit.cols, rect.height / unit.rows);
    grid.style.setProperty('--cell-size', `${Math.max(20, Math.round(cellSize))}px`);
  }

  function makeFruit(kind, index) {
    const element = document.createElement('span');
    element.className = 'fruit-bowl-fruit';
    element.dataset.kind = String(kind);
    element.textContent = CHAIN[kind]?.emoji || '';
    element.style.left = `${((index % unit.cols) + 0.5) / unit.cols * 100}%`;
    element.style.top = `${(Math.floor(index / unit.cols) + 0.5) / unit.rows * 100}%`;
    element.style.setProperty('--fruit-scale', String(fruitScale(kind)));
    element.style.setProperty('--fruit-color', CHAIN[kind]?.color || '#ffffff');
    element.setAttribute('aria-hidden', 'true');
    return element;
  }

  function flash(element, className, duration) {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    later(() => element.classList.remove(className), duration);
  }

  function leave(element, index) {
    if (!element || element.classList.contains('is-leaving')) return;
    element.classList.add('is-leaving');
    later(() => {
      element.remove();
      if (cellElements.get(index) === element) cellElements.delete(index);
    }, 360);
  }

  function paintBonus() {
    const glowing =
      unit.ruleLevel >= 2 ? new Set(matchingFruitIndices(unit)) : new Set();
    for (const [index, element] of cellElements) {
      element.classList.toggle('is-bonus', glowing.has(index) && !element.classList.contains('is-leaving'));
    }
    next.classList.toggle('is-bonus', unit.ruleLevel >= 2 && matchingEmptyIndices(unit).length > 0);
  }

  function updateNext() {
    const fruit = CHAIN[unit.nextKind] || CHAIN[0];
    nextFruit.textContent = fruit.emoji;
    nextFruit.dataset.kind = String(unit.nextKind);
    nextFruit.style.setProperty('--fruit-scale', '1');
    nextFruit.style.setProperty('--fruit-color', fruit.color);
    paintBonus();
  }

  function paint({ droppedIndex = -1, served = [] } = {}) {
    for (let index = 0; index < unit.cells.length; index += 1) {
      const kind = unit.cells[index];
      let element = cellElements.get(index);

      if (kind === null) {
        leave(element, index);
        continue;
      }

      if (!element || !element.isConnected || element.classList.contains('is-leaving')) {
        element = makeFruit(kind, index);
        grid.append(element);
        cellElements.set(index, element);
        if (index === droppedIndex) flash(element, 'is-new', 460);
      } else {
        element.classList.remove('is-bonus');
        if (Number(element.dataset.kind) !== kind) {
          element.dataset.kind = String(kind);
          element.textContent = CHAIN[kind]?.emoji || '';
          element.style.setProperty('--fruit-scale', String(fruitScale(kind)));
          element.style.setProperty('--fruit-color', CHAIN[kind]?.color || '#ffffff');
          flash(element, 'is-merge', 520);
        } else if (index === droppedIndex) {
          flash(element, 'is-new', 460);
        }
      }
    }

    for (const event of served) {
      const ghost = makeFruit(TOP_KIND, event.index);
      ghost.classList.add('is-served');
      grid.append(ghost);
      later(() => ghost.remove(), 1100);
    }

    paintBonus();
  }

  // --- play --------------------------------------------------------------------
  function stopAuto() {
    window.clearTimeout(autoTimer);
    timers.delete(autoTimer);
    autoTimer = null;
    autoSteps = 0;
  }

  function restartIdle() {
    stopAuto();
    window.clearTimeout(idleTimer);
    timers.delete(idleTimer);
    idleTimer = later(autoFinish, AUTO_FINISH_AFTER_MS);
  }

  function sayFruit(kind) {
    if (!Number.isInteger(kind) || kind < 0 || kind >= CHAIN.length) return;
    if (saidKinds.has(kind)) return;
    saidKinds.add(kind);
    const phrase = CHAIN[kind].phrase;
    if (phrase) say(phrase);
  }

  function showResult(result, { auto = false } = {}) {
    if (result.droppedIndex >= 0 && result.droppedKind !== null) {
      const at = centre(result.droppedIndex);
      if (at) {
        pop(stage, at.x, at.y, audio(), {
          color: CHAIN[result.droppedKind]?.color,
          size: Math.round(at.r * 1.5),
          pitch: 0.85,
          gain: 0.08,
        });
      }
      sayFruit(result.droppedKind);
    }

    result.merges.forEach((merge, index) => {
      const at = centre(merge.index);
      const color = CHAIN[merge.toKind]?.color || '#ffd43b';
      if (at) {
        sparkle(stage, at.x, at.y, {
          count: Math.min(60, 16 + merge.toKind * 6),
          colors: [color, '#ffd43b', '#ffffff'],
          speed: 220,
          lifeMs: 1000,
          size: 5,
          gravity: 90,
        });
      }
      playStep(audio(), Math.min(10, 2 + merge.toKind), {
        gain: 0.09,
        duration: 0.34,
        delay: index * 0.07,
      });
      sayFruit(merge.toKind);
    });

    if (result.clearedIndices.length) {
      result.clearedIndices.forEach((index) => {
        const at = centre(index);
        if (at) {
          sparkle(stage, at.x, at.y, {
            count: 14,
            colors: ['#ffd43b', '#ffffff', '#9ec5ff'],
            speed: 170,
            lifeMs: 1000,
            size: 4,
            gravity: 130,
          });
        }
      });
      playRun(audio(), Math.min(11, result.clearedIndices.length), {
        startStep: 2,
        gapMs: 45,
        gain: 0.05,
        duration: 0.26,
      });
    }

    if (result.served) {
      const servedMerge = result.merges.find((merge) => merge.served);
      const at = servedMerge ? centre(servedMerge.index) : null;
      if (at) {
        sparkle(stage, at.x, at.y, {
          count: 70,
          colors: FINALE_COLORS,
          speed: 260,
          lifeMs: 1400,
          size: 6,
          gravity: 70,
        });
      }
      playChord(audio(), undefined, { gain: 0.12, duration: 1.2 });
    }

    if (result.bonus) {
      const at = result.droppedIndex >= 0 ? centre(result.droppedIndex) : null;
      if (at) sparkle(stage, at.x, at.y, { count: 42, colors: FINALE_COLORS, speed: 240 });
      playChord(audio(), undefined, { gain: 0.1, duration: 1 });
    }

    paint({
      droppedIndex: result.droppedIndex,
      served: result.merges.filter((merge) => merge.served),
    });
    updateNext();

    if (isDone(unit)) finish({ auto });
  }

  function finish({ auto = false } = {}) {
    if (finishing) return;
    finishing = true;
    window.clearTimeout(idleTimer);
    timers.delete(idleTimer);
    window.clearTimeout(autoTimer);
    timers.delete(autoTimer);
    say('115');

    const results = auto ? { motor: null, rule: null, density: null } : unitResults(unit);
    cancelFinale = finale(stage, audio(), {
      element: bowl,
      colors: FINALE_COLORS,
      onDone: () => {
        if (!disposed && typeof settings.onSuccess === 'function') settings.onSuccess({ results });
      },
    });
  }

  // After a long idle the app finishes the unit itself, quietly, and never nags.
  function autoFinish() {
    if (disposed || finishing) return;
    autoSteps += 1;
    if (autoSteps > MAX_AUTO_STEPS) {
      finish({ auto: true });
      return;
    }

    const result = autoStep(unit, { rng: Math.random });
    unit = result.unit;
    showResult(result, { auto: true });
    if (!finishing) autoTimer = later(autoFinish, AUTO_STEP_MS);
  }

  function onTap(tap) {
    if (disposed || finishing) return;
    restartIdle();

    // 1. Every accepted touch answers at once, before any rule is looked at.
    poke(stage, tap.x, tap.y, audio(), { silent: true });

    // 2. Then the bowl decides what else happens.
    const result = touchUnit(
      unit,
      points(),
      { x: tap.x, y: tap.y },
      { motorLevel, rng: Math.random },
    );
    unit = result.unit;

    if (
      result.droppedIndex < 0 &&
      !result.rescued &&
      result.merges.length === 0 &&
      result.clearedIndices.length === 0
    ) {
      playStep(audio(), 0, { gain: 0.05, duration: 0.3 });
      return;
    }

    showResult(result);
  }

  const detachTouch = attachTouch(board, { onTap });
  window.addEventListener('resize', sizeBowl);
  sizeBowl();
  paint();
  updateNext();
  restartIdle();
  say('110');

  return function cleanup() {
    disposed = true;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    if (cancelFinale) cancelFinale();
    detachTouch();
    window.removeEventListener('resize', sizeBowl);
    cellElements.clear();
  };
}
