// Bubble sheet: a sheet of round bubbles. A touch pops one; when the sheet is empty it
// flips over, fresh, in a new colour. See specs/toy-1.md.
//
//   renderBubbleSheet(stage, options) -> cleanup
//
// The scene is a dark stage with a rounded sheet inside the safe margin. Popped bubbles
// are flat and darker, so what is left is obvious even with poor vision.

import { finale, playStep, poke, pop } from './fx.js';
import { attachTouch } from './input.js';
import {
  autoPop,
  createUnit,
  isDone,
  layoutBubbles,
  slideUnit,
  touchUnit,
  unitResults,
} from './bubble-sheet-logic.js';

const AUTO_FINISH_AFTER_MS = 60000;
const AUTO_STEP_MS = 700;

const SHEET_COLOURS = Object.freeze([
  Object.freeze({ base: '#5ee0bd', light: '#b8ffe9', dark: '#1c6d5c' }),
  Object.freeze({ base: '#ff9ec2', light: '#ffd3e4', dark: '#8a2f53' }),
  Object.freeze({ base: '#8fb8ff', light: '#d8e6ff', dark: '#274a8a' }),
]);

// Each finished sheet moves on to the next colour, so a flip always feels fresh.
let colourCursor = 0;

function nextColour() {
  const colour = SHEET_COLOURS[colourCursor % SHEET_COLOURS.length];
  colourCursor += 1;
  return colour;
}

function pitchFor(index) {
  return 0.9 + (index % 6) * 0.05;
}

export function renderBubbleSheet(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const motorLevel = Number(settings.motorLevel) || 1;
  const colour = nextColour();

  let unit = createUnit({ densityLevel: settings.densityLevel });
  let disposed = false;
  let finishing = false;
  let poppedCount = 0;
  let idleTimer = null;
  let cancelFinale = null;
  const timers = new Set();
  const slidPointers = new Set();

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
  board.className = 'bubble-sheet-board';

  const sheet = document.createElement('div');
  sheet.className = 'bubble-sheet-sheet';
  sheet.style.setProperty('--cols', String(unit.cols));
  sheet.style.setProperty('--rows', String(unit.rows));
  board.append(sheet);

  function applyColour(next) {
    sheet.style.setProperty('--bubble-color', next.base);
    sheet.style.setProperty('--bubble-light', next.light);
    sheet.style.setProperty('--bubble-dark', next.dark);
  }

  applyColour(colour);

  const bubbleElements = unit.bubbles.map((bubble) => {
    const element = document.createElement('span');
    element.className = 'bubble-sheet-bubble';
    element.style.left = `${bubble.fx * 100}%`;
    element.style.top = `${bubble.fy * 100}%`;
    sheet.append(element);
    return element;
  });

  stage.append(board);

  function points() {
    return layoutBubbles(unit, sheet.getBoundingClientRect());
  }

  function centre(index) {
    const point = points()[index];
    return { x: point.x, y: point.y };
  }

  // Sizes that depend on the sheet are set from its real rectangle, and again on resize.
  function sizeBubbles() {
    const layout = points();
    if (layout.length) sheet.style.setProperty('--bubble-size', `${Math.round(layout[0].r * 2)}px`);
  }

  function paint() {
    unit.bubbles.forEach((bubble, index) => {
      bubbleElements[index].classList.toggle('is-popped', bubble.popped);
    });
  }

  function markPopping(index) {
    const element = bubbleElements[index];
    if (!element) return;
    element.classList.add('is-popping');
    later(() => element.classList.remove('is-popping'), 260);
  }

  function wink(index) {
    const element = bubbleElements[index];
    if (!element) return;
    element.classList.remove('is-wink');
    void element.getBoundingClientRect();
    element.classList.add('is-wink');
    later(() => element.classList.remove('is-wink'), 500);
  }

  // --- play --------------------------------------------------------------------
  function restartIdle() {
    window.clearTimeout(idleTimer);
    timers.delete(idleTimer);
    idleTimer = later(autoFinish, AUTO_FINISH_AFTER_MS);
  }

  function popAt(index) {
    const at = centre(index);
    pop(stage, at.x, at.y, audio(), { color: colour.base, pitch: pitchFor(index) });
    markPopping(index);
  }

  function finish() {
    if (finishing) return;
    finishing = true;
    window.clearTimeout(idleTimer);
    timers.delete(idleTimer);
    say('51');

    const results = unitResults(unit);
    const fresh = nextColour();

    sheet.classList.add('is-rippling');
    later(() => {
      applyColour(fresh);
      sheet.classList.add('is-flipped');
    }, 140);

    cancelFinale = finale(stage, audio(), {
      element: board,
      colors: [fresh.base, fresh.light, '#ffffff'],
      onDone: () => {
        say('52');
        if (!disposed && typeof settings.onSuccess === 'function') settings.onSuccess({ results });
      },
    });
  }

  // After a long idle the app finishes the sheet itself, slowly, and never nags.
  function autoFinish() {
    if (finishing) return;
    const step = autoPop(unit);
    unit = step.unit;
    if (step.poppedIndex >= 0) {
      popAt(step.poppedIndex);
      paint();
    }
    if (isDone(unit)) finish();
    else later(autoFinish, AUTO_STEP_MS);
  }

  function onTap(tap) {
    if (disposed || finishing) return;
    restartIdle();

    // At M4 the slide already answered; do not answer the same stroke twice.
    if (motorLevel >= 4 && slidPointers.has(tap.pointerId)) {
      slidPointers.delete(tap.pointerId);
      return;
    }

    // 1. Every accepted touch answers at once, before any rule is looked at.
    poke(stage, tap.x, tap.y, audio(), { silent: true });

    // 2. Then the logic decides what else happens.
    const result = touchUnit(unit, points(), { x: tap.x, y: tap.y }, { motorLevel });
    unit = result.unit;

    if (result.poppedIndex < 0) {
      // Out of reach of any bubble: still pleasant, and the nearest one winks.
      playStep(audio(), 0, { gain: 0.05, duration: 0.3 });
      if (result.nearestIndex >= 0) wink(result.nearestIndex);
      return;
    }

    popAt(result.poppedIndex);
    playStep(audio(), Math.min(10, poppedCount + 2), { gain: 0.08, delay: 0.05 });
    poppedCount += 1;
    paint();
    if (isDone(unit)) finish();
  }

  function onSegment(segment) {
    if (disposed || finishing || motorLevel < 4) return;
    restartIdle();
    slidPointers.add(segment.pointerId);
    if (segment.first) poke(stage, segment.x0, segment.y0, audio(), { silent: true });

    const result = slideUnit(unit, points(), segment, { motorLevel });
    if (result.poppedIndices.length === 0) return;

    unit = result.unit;
    for (const index of result.poppedIndices) {
      popAt(index);
      poppedCount += 1;
    }
    paint();
    if (isDone(unit)) finish();
  }

  function onEnd(summary) {
    slidPointers.delete(summary.pointerId);
  }

  const detachTouch = attachTouch(sheet, { onTap, onSegment, onEnd });
  window.addEventListener('resize', sizeBubbles);
  sizeBubbles();
  paint();
  restartIdle();
  say('50');

  return function cleanup() {
    disposed = true;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    if (cancelFinale) cancelFinale();
    detachTouch();
    window.removeEventListener('resize', sizeBubbles);
  };
}
