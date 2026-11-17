// Marble drop: a wooden peg board. A touch releases a glass marble from the top; it
// clicks off the pegs, each peg a note, and lands in a cup. A full cup tips its marbles
// out with a rattle, and the unit ends when every cup has tipped once. See specs/toy-6.md.
//
//   renderMarbleDrop(stage, options) -> cleanup
//
// Every accepted touch answers at once with a poke, then the logic releases a marble
// (extra touches wait in a little queue at the top, never refused). The physics runs in
// a requestAnimationFrame loop on the pure logic in marble-drop-logic.js.

import { finale, playRun, playTone, poke, sparkle } from './fx.js';
import { attachTouch } from './input.js';
import { noteAt } from './scale.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CUP_FLOOR_Y,
  CUP_RIM_Y,
  MARBLE_COLORS,
  START_Y,
  autoDrop,
  createGame,
  isDone,
  pegStep,
  requestDrop,
  stepGame,
  unitResults,
} from './marble-drop-logic.js';

const AUTO_FINISH_AFTER_MS = 60000;
const AUTO_STEP_MS = 1200;
const AUTO_QUEUE = 2;

const FINALE_COLORS = Object.freeze(['#ffd43b', '#ff8fab', '#7fffd4', '#9ec5ff', '#ffffff']);

function percent(value, total) {
  return `${(value / total) * 100}%`;
}

function colourAt(index) {
  const list = MARBLE_COLORS;
  const safe = ((Math.round(Number(index) || 0) % list.length) + list.length) % list.length;
  return list[safe];
}

function applyMarbleColours(element, index) {
  const colour = colourAt(index);
  element.style.setProperty('--marble-base', colour.base);
  element.style.setProperty('--marble-light', colour.light);
  element.style.setProperty('--marble-dark', colour.dark);
}

export function renderMarbleDrop(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const motorLevel = Number(settings.motorLevel) || 1;

  let unit = createGame({
    densityLevel: settings.densityLevel,
    motorLevel,
  });
  let disposed = false;
  let finishing = false;
  let autoMode = false;
  let saidCupFull = false;
  let idleTimer = null;
  let autoTimer = null;
  let cancelFinale = null;
  let frameHandle = 0;
  let lastFrame = 0;
  let waitingSignature = null;
  const timers = new Set();
  const marbleElements = new Map();

  function later(callback, delay) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function clearTimer(timer) {
    if (timer) {
      window.clearTimeout(timer);
      timers.delete(timer);
    }
    return null;
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
  board.className = 'marble-drop-board';

  const frame = document.createElement('div');
  frame.className = 'marble-drop-frame';

  const pegsLayer = document.createElement('div');
  pegsLayer.className = 'marble-drop-pegs';
  pegsLayer.setAttribute('aria-hidden', 'true');

  const cupsLayer = document.createElement('div');
  cupsLayer.className = 'marble-drop-cups';
  cupsLayer.setAttribute('aria-hidden', 'true');

  const waitingLayer = document.createElement('div');
  waitingLayer.className = 'marble-drop-waiting';
  waitingLayer.setAttribute('aria-hidden', 'true');

  const marblesLayer = document.createElement('div');
  marblesLayer.className = 'marble-drop-marbles';
  marblesLayer.setAttribute('aria-hidden', 'true');

  frame.append(cupsLayer, pegsLayer, waitingLayer, marblesLayer);
  board.append(frame);
  stage.append(board);

  const pegElements = unit.pegs.map((peg) => {
    const element = document.createElement('span');
    element.className = 'marble-drop-peg';
    element.style.left = percent(peg.x, BOARD_WIDTH);
    element.style.top = percent(peg.y, BOARD_HEIGHT);
    element.style.setProperty('--peg-size', percent(peg.r * 2, BOARD_WIDTH));
    pegsLayer.append(element);
    return element;
  });

  const cupElements = unit.cups.map((cup) => {
    const element = document.createElement('div');
    element.className = 'marble-drop-cup';
    element.style.left = percent(cup.x, BOARD_WIDTH);
    element.style.width = percent(cup.width, BOARD_WIDTH);
    element.style.top = percent(CUP_RIM_Y, BOARD_HEIGHT);
    element.style.height = percent(CUP_FLOOR_Y - CUP_RIM_Y, BOARD_HEIGHT);

    const collected = document.createElement('span');
    collected.className = 'marble-drop-cup-marbles';
    element.append(collected);
    cupsLayer.append(element);

    return { element, collected, signature: '' };
  });

  function fitFrame() {
    const rect = board.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const usableWidth = Math.max(1, rect.width - 24);
    const usableHeight = Math.max(1, rect.height - 24);
    const ratio = BOARD_WIDTH / BOARD_HEIGHT;
    const height = Math.min(usableHeight, usableWidth / ratio);
    const width = height * ratio;
    frame.style.width = `${Math.max(1, Math.round(width))}px`;
    frame.style.height = `${Math.max(1, Math.round(height))}px`;
  }

  function clientPoint(x, y) {
    const rect = frame.getBoundingClientRect();
    return {
      x: rect.left + (x / BOARD_WIDTH) * rect.width,
      y: rect.top + (y / BOARD_HEIGHT) * rect.height,
    };
  }

  function makeMarble(colorIndex, extraClass = '') {
    const element = document.createElement('span');
    element.className = extraClass
      ? `marble-drop-marble ${extraClass}`
      : 'marble-drop-marble';
    applyMarbleColours(element, colorIndex);
    element.setAttribute('aria-hidden', 'true');
    return element;
  }

  function flash(element, className, duration) {
    if (!element) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    later(() => element.classList.remove(className), duration);
  }

  function paintWaiting() {
    const signature = `${unit.nextId}:${unit.waiting
      .map((entry) => Math.round(entry.x))
      .join(',')}`;
    if (signature === waitingSignature) return;
    waitingSignature = signature;

    const elements = unit.waiting.map((entry, index) => {
      const element = makeMarble(unit.nextId + index, 'is-waiting');
      element.style.left = percent(entry.x, BOARD_WIDTH);
      element.style.top = percent(START_Y + (index % 2) * 52, BOARD_HEIGHT);
      return element;
    });
    waitingLayer.replaceChildren(...elements);
  }

  function paintCups() {
    unit.cups.forEach((cup, index) => {
      const entry = cupElements[index];
      if (!entry) return;
      const signature = cup.colors.join(',');
      if (entry.signature === signature) return;
      entry.signature = signature;

      const dots = cup.colors.map((colorIndex) => {
        const dot = document.createElement('span');
        dot.className = 'marble-drop-cup-marble';
        applyMarbleColours(dot, colorIndex);
        return dot;
      });
      entry.collected.replaceChildren(...dots);
    });
  }

  function paintMarbles() {
    const seen = new Set();
    for (const marble of unit.inFlight) {
      seen.add(marble.id);
      let element = marbleElements.get(marble.id);
      if (!element) {
        element = makeMarble(marble.colorIndex);
        marbleElements.set(marble.id, element);
        marblesLayer.append(element);
      }
      element.style.left = percent(marble.x, BOARD_WIDTH);
      element.style.top = percent(marble.y, BOARD_HEIGHT);
      element.style.setProperty('--marble-rot', `${marble.rot}rad`);
    }

    for (const [id, element] of marbleElements) {
      if (seen.has(id)) continue;
      element.remove();
      marbleElements.delete(id);
    }

    paintWaiting();
    paintCups();
  }

  // --- sound and events ---------------------------------------------------------
  function pegTock(event) {
    const step = pegStep(event.row, event.rows);
    const strength = Math.min(1, Math.max(0, Number(event.strength) || 0));
    playTone(audio(), noteAt(step), {
      gain: 0.03 + strength * 0.055,
      duration: 0.16,
      wave: 'triangle',
    });
    flash(pegElements[event.pegIndex], 'is-hit', 220);
  }

  function marbleLanded(event) {
    const colour = colourAt(event.colorIndex);
    const at = clientPoint(event.x, event.y);
    playTone(audio(), noteAt(0), { gain: 0.1, duration: 0.32, wave: 'sine' });
    sparkle(stage, at.x, at.y, {
      count: 8,
      colors: [colour.base, colour.light, '#ffffff'],
      speed: 120,
      lifeMs: 700,
      size: 3.2,
      gravity: 140,
    });
    const entry = cupElements[event.cupIndex];
    if (entry) flash(entry.element, 'is-landing', 320);
  }

  function cupTipped(event) {
    const at = clientPoint(event.x, event.y);
    playRun(audio(), 6, { startStep: 1, gapMs: 55, gain: 0.05, duration: 0.2 });
    sparkle(stage, at.x, at.y, {
      count: 22,
      colors: ['#ffd43b', '#ffe8b0', '#ffffff'],
      speed: 190,
      lifeMs: 900,
      size: 4.2,
      gravity: 120,
    });
    const entry = cupElements[event.cupIndex];
    if (entry) flash(entry.element, 'is-tipping', 1000);
    if (!saidCupFull) {
      saidCupFull = true;
      say('101');
    }
  }

  function handleEvents(events) {
    for (const event of events) {
      if (event.type === 'peg') pegTock(event);
      else if (event.type === 'land') marbleLanded(event);
      else if (event.type === 'tip') cupTipped(event);
      else if (event.type === 'done') finish();
    }
  }

  // --- play --------------------------------------------------------------------
  function restartIdle() {
    idleTimer = clearTimer(idleTimer);
    idleTimer = later(autoFinish, AUTO_FINISH_AFTER_MS);
  }

  function stopAuto() {
    autoTimer = clearTimer(autoTimer);
    autoMode = false;
  }

  function finish() {
    if (finishing || disposed) return;
    finishing = true;
    idleTimer = clearTimer(idleTimer);
    const idleFinished = autoMode;
    stopAuto();

    const results = idleFinished
      ? { motor: null, rule: null, density: null }
      : unitResults(unit);

    cancelFinale = finale(stage, audio(), {
      element: frame,
      colors: FINALE_COLORS,
      holdMs: 3000,
      bursts: 3,
      onDone: () => {
        say('102');
        if (!disposed && typeof settings.onSuccess === 'function') settings.onSuccess({ results });
      },
    });
  }

  // After a long idle the board finishes the round itself, quietly, and never nags.
  function autoFinish() {
    if (disposed || finishing || autoMode) return;
    autoMode = true;
    autoStep();
  }

  function autoStep() {
    if (disposed || finishing) return;
    if (isDone(unit)) {
      finish();
      return;
    }
    if (unit.waiting.length < AUTO_QUEUE) {
      unit = autoDrop(unit, { rng: Math.random }).game;
      paintMarbles();
    }
    autoTimer = later(autoStep, AUTO_STEP_MS);
  }

  function boardX(clientX) {
    const rect = frame.getBoundingClientRect();
    if (!rect.width) return BOARD_WIDTH / 2;
    return ((clientX - rect.left) / rect.width) * BOARD_WIDTH;
  }

  function onTap(tap) {
    if (disposed || finishing) return;
    restartIdle();
    stopAuto();

    // 1. Every accepted touch answers at once.
    poke(stage, tap.x, tap.y, audio(), { step: 3, gain: 0.06 });

    // 2. Then a marble leaves the top (or waits its turn at the top).
    const result = requestDrop(unit, { x: boardX(tap.x) }, { rng: Math.random });
    unit = result.game;
    if (!result.launched) {
      playTone(audio(), noteAt(2), { gain: 0.04, duration: 0.22, wave: 'triangle' });
    }
    paintMarbles();
  }

  function frameStep(time) {
    if (disposed) return;
    if (!frame.style.width) fitFrame();
    const delta = lastFrame ? Math.min(50, time - lastFrame) : 16;
    lastFrame = time;

    if (!finishing) {
      const result = stepGame(unit, delta, { rng: Math.random });
      unit = result.game;
      handleEvents(result.events);
      paintMarbles();
    }

    frameHandle = window.requestAnimationFrame(frameStep);
  }

  // --- wiring ------------------------------------------------------------------
  const detachTouch = attachTouch(board, { onTap });
  window.addEventListener('resize', fitFrame);
  fitFrame();
  paintMarbles();
  restartIdle();
  say('100');
  frameHandle = window.requestAnimationFrame(frameStep);

  return function cleanup() {
    disposed = true;
    idleTimer = clearTimer(idleTimer);
    autoTimer = clearTimer(autoTimer);
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    if (cancelFinale) cancelFinale();
    if (frameHandle) window.cancelAnimationFrame(frameHandle);
    frameHandle = 0;
    detachTouch();
    window.removeEventListener('resize', fitFrame);
    marbleElements.clear();
  };
}
