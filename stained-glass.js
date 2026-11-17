// Stained glass: a dark window of large glass cells. A touch fills a cell with a glowing
// colour and a glass note; when the last cell is in, the picture lights up and the order of
// fills is replayed as a small tune. See specs/toy-12.md.
//
//   renderStainedGlass(stage, options) -> cleanup
//
// The window is an SVG whose cells are polygons from the logic module, so the picture is
// pure data and the hit testing stays in design pixels.

import { finale, playStep, poke, sparkle } from './fx.js';
import { attachTouch } from './input.js';
import {
  PICTURES,
  autoFill,
  createUnit,
  isDone,
  layoutCells,
  touchUnit,
  unitResults,
} from './stained-glass-logic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const AUTO_FINISH_AFTER_MS = 60000;
const AUTO_STEP_MS = 800;
const REPLAY_GAP_MS = 260;

// Each new window moves on to the next picture, so a restart always feels fresh.
let pictureCursor = 0;

function nextPictureIndex() {
  const index = pictureCursor % PICTURES.length;
  pictureCursor += 1;
  return index;
}

function clampMotorLevel(value) {
  const number = Math.round(Number(value) || 1);
  return Math.min(3, Math.max(1, number));
}

export function renderStainedGlass(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const motorLevel = clampMotorLevel(settings.motorLevel);

  let unit = createUnit({
    pictureIndex: nextPictureIndex(),
    ruleLevel: settings.ruleLevel,
  });
  let disposed = false;
  let finishing = false;
  let autoActive = false;
  let idleTimer = null;
  let cancelFinale = null;
  const timers = new Set();

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
  board.className = 'stained-glass-board';

  const frame = document.createElement('div');
  frame.className = 'stained-glass-frame';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'stained-glass-window');
  svg.setAttribute('viewBox', '0 0 1000 1000');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', unit.picture.id);

  const cellElements = unit.cells.map((cell) => {
    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute('class', 'stained-glass-cell');
    polygon.setAttribute(
      'points',
      cell.points.map(([x, y]) => `${x},${y}`).join(' '),
    );
    polygon.style.setProperty('--cell-color', cell.color);
    polygon.dataset.index = String(cell.index);
    svg.append(polygon);
    return polygon;
  });

  frame.append(svg);
  board.append(frame);
  stage.append(board);

  function points() {
    return layoutCells(unit, frame.getBoundingClientRect());
  }

  function centre(index) {
    const layout = points()[index];
    return layout ? { x: layout.x, y: layout.y } : null;
  }

  function paint() {
    unit.cells.forEach((cell, index) => {
      cellElements[index].classList.toggle('is-filled', cell.filled);
      cellElements[index].classList.toggle('is-bonus', index === unit.bonusIndex && !cell.filled);
    });
  }

  function flash(index, className, duration = 520) {
    const element = cellElements[index];
    if (!element) return;
    element.classList.remove(className);
    void element.getBoundingClientRect();
    element.classList.add(className);
    later(() => element.classList.remove(className), duration);
  }

  // --- play --------------------------------------------------------------------
  function stopIdle() {
    window.clearTimeout(idleTimer);
    timers.delete(idleTimer);
    idleTimer = null;
  }

  function restartIdle() {
    autoActive = false;
    stopIdle();
    idleTimer = later(startAuto, AUTO_FINISH_AFTER_MS);
  }

  function fillCell(index, bonus) {
    const cell = unit.cells[index];
    if (!cell) return;
    const at = centre(index);
    flash(index, 'is-filling', 420);

    // One glass-harmonica note per fill, walking up the shared scale.
    playStep(audio(), Math.min(10, unit.fillOrder.length + 1), {
      gain: 0.09,
      attack: 0.06,
      duration: 0.8,
    });
    if (at) {
      sparkle(stage, at.x, at.y, {
        count: 10,
        colors: [cell.color, '#ffffff'],
        speed: 150,
        lifeMs: 900,
        size: 4,
        gravity: 0,
      });
    }

    if (bonus) {
      // The bonus gives MORE; the ordinary fill above already happened.
      if (at) {
        sparkle(stage, at.x, at.y, {
          count: 26,
          colors: [cell.color, '#ffd43b', '#ffffff'],
          speed: 240,
          lifeMs: 1100,
          size: 5,
          gravity: 60,
        });
      }
      playStep(audio(), Math.min(10, unit.fillOrder.length + 3), {
        gain: 0.07,
        attack: 0.04,
        duration: 0.7,
        delay: 0.08,
      });
    }
    paint();
  }

  function replayFillOrder() {
    const order = unit.fillOrder.slice();
    const gap = order.length
      ? Math.min(REPLAY_GAP_MS, Math.max(120, Math.floor(2200 / order.length)))
      : 0;

    order.forEach((cellIndex, position) => {
      later(() => {
        const element = cellElements[cellIndex];
        if (!element) return;
        flash(cellIndex, 'is-recall', 340);
        const at = centre(cellIndex);
        if (at) {
          sparkle(stage, at.x, at.y, {
            count: 8,
            colors: [unit.cells[cellIndex].color, '#ffffff'],
            speed: 110,
            lifeMs: 800,
            size: 3,
            gravity: 0,
          });
        }
        playStep(audio(), Math.min(10, position), {
          gain: 0.06,
          attack: 0.04,
          duration: 0.55,
          delay: 0.02,
        });
      }, 220 + position * gap);
    });
  }

  function finish(auto) {
    if (finishing) return;
    finishing = true;
    autoActive = false;
    stopIdle();

    board.classList.add('is-lit');
    frame.classList.add('is-lit');
    say(unit.picture.phraseId);

    const results = auto === true ? { motor: null, rule: null } : unitResults(unit);
    const colours = unit.cells.map((cell) => cell.color).slice(0, 5);
    replayFillOrder();

    cancelFinale = finale(stage, audio(), {
      element: board,
      colors: [...colours, '#ffffff'],
      holdMs: 3000,
      onDone: () => {
        say('164');
        if (!disposed && typeof settings.onSuccess === 'function') settings.onSuccess({ results });
      },
    });
  }

  // After a long idle the app finishes the window itself, slowly, and never nags.
  function autoFinish() {
    if (finishing || !autoActive) return;
    const step = autoFill(unit);
    unit = step.unit;
    if (step.filledIndex >= 0) fillCell(step.filledIndex, false);
    if (isDone(unit)) finish(true);
    else later(autoFinish, AUTO_STEP_MS);
  }

  function startAuto() {
    if (finishing) return;
    autoActive = true;
    autoFinish();
  }

  function onTap(tap) {
    if (disposed || finishing) return;
    restartIdle();

    // 1. Every accepted touch answers at once, before any rule is looked at.
    poke(stage, tap.x, tap.y, audio(), { silent: true });

    // 2. Then the logic decides what else happens.
    const result = touchUnit(unit, points(), { x: tap.x, y: tap.y }, { motorLevel });
    unit = result.unit;

    if (result.filledIndex < 0) {
      // Out of reach of any cell: still pleasant, and the nearest one winks.
      playStep(audio(), 0, { gain: 0.05, attack: 0.04, duration: 0.4 });
      if (result.nearestIndex >= 0) flash(result.nearestIndex, 'is-wink');
      return;
    }

    fillCell(result.filledIndex, result.bonus);
    if (isDone(unit)) finish(false);
  }

  const detachTouch = attachTouch(board, { onTap });
  paint();
  restartIdle();
  say('160');

  return function cleanup() {
    disposed = true;
    autoActive = false;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    if (cancelFinale) cancelFinale();
    detachTouch();
  };
}
