// TEMPLATE: copy this file to <game>.js. NOT registered, not part of the app.
//
// The UI module: one exported render function with the contract every game follows.
//
//   renderX(stage, options) -> cleanup
//
// - Draw inside `stage` (app.js has already emptied it and set data-game="<type>").
// - Return a cleanup function that removes every listener and timer you added.
// - Never throw; sound and speech are enhancements.
// - Do not import engine.js, app.js or registry.js here.
//
// options given by app.js to every registry game:
//   motorLevel, ruleLevel, densityLevel ...  one per ladder dimension (dimension id + "Level")
//   levels            the same by dimension id: { motor, rule, density }
//   getLevels()       fresh level options, for games that keep running after onSuccess
//   language          'he' | 'en';  gender 'm' | 'f';  name  the player's name
//   showTextLabels    true when the caregiver wants words on screen (default off)
//   getAudioContext() the shared AudioContext or null. Call it on each use, do not keep it.
//   say(phraseId)     speak one catalog phrase (family recording if there is one, else
//                     TTS). Only ids listed in the registry entry's `phrases` are spoken.
//   onPrompt(text)    speak free text and repeat it after a long idle (old games; toys
//                     normally use say)
//   onSuccess(info)   a unit is finished. app.js records it and starts the next round.
//                     Pass { results: { motor: true, rule: null, ... } } for adaptation.
//   onFailure(info)   rarely used by toys (see "Bonus, never refuse" in DEV_GUIDE.md)
//   onAdapt(info)     adaptation only, mid-unit: no praise and no new round

import { finale, playStep, poke, pop, sparkle } from './fx.js';
import { attachTouch } from './input.js';
import {
  autoLight,
  createUnit,
  isDone,
  layoutDots,
  touchUnit,
  unitResults,
} from './template-toy-logic.js';

const AUTO_FINISH_AFTER_MS = 60000;
const AUTO_STEP_MS = 900;
const DOT_COLORS = Object.freeze(['#ffd43b', '#ff8fab', '#7fffd4', '#9ec5ff']);

// The registry entry this game would get is shown in DEV_GUIDE.md and checked by
// test/template-toy-logic.test.js. Phrase ids '21' and '03' are borrowed from the catalog.

export function renderTemplateToy(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const motorLevel = Number(settings.motorLevel) || 1;
  const color = DOT_COLORS[Math.floor(Math.random() * DOT_COLORS.length)];

  let unit = createUnit({ densityLevel: settings.densityLevel, ruleLevel: settings.ruleLevel });
  let disposed = false;
  let finishing = false;
  let litCount = 0;
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
    if (typeof settings.say === 'function') settings.say(id);
  }

  // --- scene -------------------------------------------------------------------
  const board = document.createElement('div');
  board.className = 'template-toy-board';
  board.style.setProperty('--cols', String(unit.cols));
  board.style.setProperty('--rows', String(unit.rows));

  const dotElements = unit.dots.map((dot) => {
    const element = document.createElement('span');
    element.className = 'template-toy-dot';
    element.style.left = `${dot.fx * 100}%`;
    element.style.top = `${dot.fy * 100}%`;
    element.style.setProperty('--dot-color', color);
    board.append(element);
    return element;
  });
  stage.append(board);

  function points() {
    return layoutDots(unit, board.getBoundingClientRect());
  }

  function centre(index) {
    const point = points()[index];
    return { x: point.x, y: point.y };
  }

  // Sizes that depend on the board are set from its real rectangle, and again on resize.
  function sizeDots() {
    const layout = points();
    if (layout.length) board.style.setProperty('--dot-size', `${Math.round(layout[0].r * 2)}px`);
  }

  function paint() {
    unit.dots.forEach((dot, index) => {
      dotElements[index].classList.toggle('is-lit', dot.lit);
      dotElements[index].classList.toggle('is-bonus', index === unit.bonusIndex && !dot.lit);
    });
  }

  function wink(index) {
    const element = dotElements[index];
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

  function finish() {
    if (finishing) return;
    finishing = true;
    say('03');
    const results = unitResults(unit);
    cancelFinale = finale(stage, audio(), {
      element: board,
      onDone: () => {
        if (!disposed && typeof settings.onSuccess === 'function') settings.onSuccess({ results });
      },
    });
  }

  // After a long idle the app finishes the unit itself, slowly, and never nags.
  function autoFinish() {
    if (finishing) return;
    const step = autoLight(unit);
    unit = step.unit;
    if (step.litIndex >= 0) {
      const at = centre(step.litIndex);
      pop(stage, at.x, at.y, audio(), { color });
      paint();
    }
    if (isDone(unit)) finish();
    else later(autoFinish, AUTO_STEP_MS);
  }

  function onTap(tap) {
    if (disposed || finishing) return;
    restartIdle();

    // 1. Every accepted touch answers at once, before any rule is looked at.
    poke(stage, tap.x, tap.y, audio(), { silent: true });

    // 2. Then the logic decides what else happens.
    const result = touchUnit(unit, points(), { x: tap.x, y: tap.y }, { motorLevel });
    unit = result.unit;

    if (result.litIndex < 0) {
      // Out of reach of any dot: still pleasant, and the nearest one winks.
      playStep(audio(), 0, { gain: 0.05 });
      if (result.nearestIndex >= 0) wink(result.nearestIndex);
      return;
    }

    const at = centre(result.litIndex);
    pop(stage, at.x, at.y, audio(), { color });
    playStep(audio(), litCount, { gain: 0.1, delay: 0.05 }); // each dot one note higher
    litCount += 1;
    if (result.bonus) {
      // 3. The bonus gives MORE; the ordinary result above already happened.
      sparkle(stage, at.x, at.y, { count: 30 });
      playStep(audio(), litCount + 2, { gain: 0.08, delay: 0.14 });
    }
    paint();
    if (isDone(unit)) finish();
  }

  const detachTouch = attachTouch(board, { onTap });
  window.addEventListener('resize', sizeDots);
  sizeDots();
  paint();
  restartIdle();
  if (unit.ruleLevel >= 2) say('21');

  return function cleanup() {
    disposed = true;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    if (cancelFinale) cancelFinale();
    detachTouch();
    window.removeEventListener('resize', sizeDots);
  };
}
