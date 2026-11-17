// Soap bubbles: large bubbles drift slowly upward over a dark blue stage. A touch bursts
// the nearest bubble with a bell note, and some release a small thing that floats away.
// See specs/toy-2.md.
//
//   renderSoapBubbles(stage, options) -> cleanup
//
// Every accepted touch answers at once: a poke ripple at the finger, then the burst.

import { finale, playChord, playStep, poke, pop, sparkle } from './fx.js';
import { attachTouch } from './input.js';
import {
  autoBurst,
  createUnit,
  isDone,
  layoutBubbles,
  stepUnit,
  touchUnit,
  unitResults,
} from './soap-bubbles-logic.js';

const AUTO_FINISH_AFTER_MS = 60000;
const AUTO_STEP_MS = 900;
const BURST_ANIMATION_MS = 420;
const RELEASE_ANIMATION_MS = 2400;

const FINALE_COLORS = Object.freeze(['#bfe9ff', '#ffd43b', '#ff8fab', '#ffffff']);
const BURST_COLORS = Object.freeze(['#bfe9ff', '#ffffff']);

export function renderSoapBubbles(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const motorLevel = Number(settings.motorLevel) || 1;

  let unit = createUnit({
    densityLevel: settings.densityLevel,
    ruleLevel: settings.ruleLevel,
  });
  let disposed = false;
  let finishing = false;
  let idleTimer = null;
  let cancelFinale = null;
  let frame = null;
  let lastTime = 0;
  const timers = new Set();
  const elements = new Map();
  const bursting = new Set();

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
  board.className = 'soap-bubbles-board';
  stage.append(board);

  function createBubbleElement(bubble) {
    const element = document.createElement('span');
    element.className = 'soap-bubbles-bubble';
    element.dataset.id = bubble.id;
    element.setAttribute('aria-hidden', 'true');
    const inside = document.createElement('span');
    inside.className = 'soap-bubbles-inside';
    element.append(inside);
    board.append(element);
    elements.set(bubble.id, element);
    return element;
  }

  function setInside(element, bubble) {
    const inside = element.querySelector('.soap-bubbles-inside');
    if (!inside) return;
    if (bubble.content) {
      if (element.dataset.content === bubble.content) return;
      inside.textContent = bubbleEmoji(bubble.content);
      element.dataset.content = bubble.content;
    } else if (element.dataset.content) {
      inside.textContent = '';
      delete element.dataset.content;
    }
  }

  function bubbleEmoji(id) {
    switch (id) {
      case 'flower':
        return '🌸';
      case 'bird':
        return '🐦';
      case 'butterfly':
        return '🦋';
      case 'bee':
        return '🐝';
      case 'heart':
        return '💖';
      default:
        return '';
    }
  }

  function syncScene() {
    const rect = board.getBoundingClientRect();
    const shortest = Math.min(rect.width, rect.height) || 1;
    const live = new Set();

    for (const bubble of unit.bubbles) {
      live.add(bubble.id);
      const element = elements.get(bubble.id) || createBubbleElement(bubble);
      const fx = bubble.baseX + Math.sin(bubble.phase) * bubble.swayAmp;
      const size = Math.round(bubble.size * shortest * 2);
      element.style.left = `${fx * 100}%`;
      element.style.top = `${bubble.fy * 100}%`;
      element.style.width = `${size}px`;
      element.style.height = `${size}px`;
      element.style.fontSize = `${Math.round(size * 0.44)}px`;
      element.classList.toggle('is-bonus', bubble.id === unit.bonusId);
      setInside(element, bubble);
    }

    for (const [id, element] of [...elements]) {
      if (live.has(id) || bursting.has(id)) continue;
      element.remove();
      elements.delete(id);
    }
  }

  function wink(id) {
    const element = elements.get(id);
    if (!element) return;
    element.classList.remove('is-winking');
    void element.getBoundingClientRect();
    element.classList.add('is-winking');
    later(() => element.classList.remove('is-winking'), 600);
  }

  // --- play --------------------------------------------------------------------
  function restartIdle() {
    window.clearTimeout(idleTimer);
    timers.delete(idleTimer);
    idleTimer = later(autoFinish, AUTO_FINISH_AFTER_MS);
  }

  function burstVisual(point, bubble, { bonus = false, released = null } = {}) {
    const element = elements.get(bubble.id);
    if (element && !bursting.has(bubble.id)) {
      bursting.add(bubble.id);
      element.classList.add('is-bursting');
      later(() => {
        element.remove();
        elements.delete(bubble.id);
        bursting.delete(bubble.id);
      }, BURST_ANIMATION_MS);
    }

    pop(stage, point.x, point.y, audio(), {
      color: BURST_COLORS[0],
      count: 10,
      gain: 0.12,
      pitch: 1.12,
    });
    playStep(audio(), Math.min(10, 2 + (unit.bursts % 6)), { gain: 0.1, delay: 0.03 });

    if (released) {
      releaseItem(point, released);
      if (released.phrase) say(released.phrase);
    }
    if (bonus) {
      sparkle(stage, point.x, point.y, {
        count: 26,
        colors: FINALE_COLORS,
        speed: 120,
        lifeMs: 1600,
        size: 4,
        gravity: 30,
      });
      playChord(audio(), [2, 4, 6], { gain: 0.12, duration: 1.1 });
    }
  }

  function releaseItem(point, item) {
    const rect = board.getBoundingClientRect();
    const element = document.createElement('span');
    element.className = `soap-bubbles-release soap-bubbles-release--${item.motion}`;
    element.textContent = item.emoji;
    element.setAttribute('aria-hidden', 'true');
    element.style.left = `${point.x - rect.left}px`;
    element.style.top = `${point.y - rect.top}px`;
    board.append(element);
    later(() => element.remove(), RELEASE_ANIMATION_MS);
  }

  function finish({ idle = false } = {}) {
    if (finishing) return;
    finishing = true;
    window.clearTimeout(idleTimer);
    timers.delete(idleTimer);
    say('63');

    const results = idle ? { motor: null, rule: null, density: null } : unitResults(unit);
    cancelFinale = finale(stage, audio(), {
      element: board,
      colors: FINALE_COLORS,
      holdMs: 3000,
      bursts: 4,
      onDone: () => {
        if (!disposed && typeof settings.onSuccess === 'function') settings.onSuccess({ results });
      },
    });
  }

  // After a long idle the app finishes the scene itself, slowly, and never nags.
  function autoFinish() {
    if (finishing) return;
    const points = layoutBubbles(unit, board.getBoundingClientRect());
    const result = autoBurst(unit);
    unit = result.unit;
    if (result.burstIndex >= 0) {
      const point = points[result.burstIndex];
      if (point) burstVisual(point, result.burst, { released: result.released });
    }
    if (isDone(unit)) finish({ idle: true });
    else later(autoFinish, AUTO_STEP_MS);
  }

  function onTap(tap) {
    if (disposed || finishing) return;
    restartIdle();

    // 1. Every accepted touch answers at once, before any rule is looked at.
    poke(stage, tap.x, tap.y, audio(), { silent: true });

    // 2. Then the logic decides which bubble bursts, if one is within reach.
    const points = layoutBubbles(unit, board.getBoundingClientRect());
    const result = touchUnit(unit, points, { x: tap.x, y: tap.y }, { motorLevel });
    unit = result.unit;

    if (result.burstIndex < 0) {
      playStep(audio(), 0, { gain: 0.05, duration: 0.3 });
      if (result.nearestIndex >= 0) wink(points[result.nearestIndex].id);
      return;
    }

    const point = points[result.burstIndex];
    burstVisual(point, result.burst, {
      bonus: result.bonus,
      released: result.released,
    });
    syncScene();
    if (isDone(unit)) finish();
  }

  function tick(time) {
    frame = null;
    if (disposed) return;
    if (!finishing) {
      const dt = lastTime ? Math.min(100, time - lastTime) : 16;
      lastTime = time;
      unit = stepUnit(unit, dt);
    } else {
      lastTime = 0;
    }
    syncScene();
    if (!disposed) frame = window.requestAnimationFrame(tick);
  }

  const detachTouch = attachTouch(board, { onTap });
  syncScene();
  restartIdle();
  say('60');
  frame = window.requestAnimationFrame(tick);

  return function cleanup() {
    disposed = true;
    if (frame) window.cancelAnimationFrame(frame);
    frame = null;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    if (cancelFinale) cancelFinale();
    detachTouch();
  };
}
