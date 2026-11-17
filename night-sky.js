// Night sky: a dark sky over one skyline. A touch opens a soft firework, and from density
// level 2 faint stars light up and join into a picture. See specs/toy-8.md.
//
//   renderNightSky(stage, options) -> cleanup
//
// Every accepted touch answers at once: a poke ripple at the finger, a firework of soft
// particles (fx.sparkle), and, when one is near, a lit star with a bell note.

import { finale, playPop, playStep, poke, sparkle } from './fx.js';
import { attachTouch } from './input.js';
import {
  PICTURE_PHRASES,
  autoAdvance,
  createUnit,
  isDone,
  layoutStars,
  planFirework,
  touchUnit,
  unitResults,
} from './night-sky-logic.js';

const AUTO_FINISH_AFTER_MS = 60000;
const AUTO_STEP_MS = 1100;
const SVG_NS = 'http://www.w3.org/2000/svg';

const TRAIL_COLORS = Object.freeze(['#ffd43b', '#ff8fab', '#7fffd4', '#9ec5ff']);
const FINALE_COLORS = Object.freeze(['#ffd43b', '#ff8fab', '#9ec5ff', '#ffffff']);

export function renderNightSky(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const motorLevel = Number(settings.motorLevel) || 1;

  let unit = createUnit({
    densityLevel: settings.densityLevel,
    ruleLevel: settings.ruleLevel,
  });
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
    try {
      if (typeof settings.say === 'function') settings.say(id);
    } catch {
      /* speech is an enhancement */
    }
  }

  // --- scene -------------------------------------------------------------------
  const board = document.createElement('div');
  board.className = 'night-sky-board';

  const skyline = document.createElement('div');
  skyline.className = 'night-sky-skyline';
  skyline.setAttribute('aria-hidden', 'true');
  board.append(skyline);

  const lineLayer = document.createElementNS(SVG_NS, 'svg');
  lineLayer.setAttribute('class', 'night-sky-lines');
  lineLayer.setAttribute('aria-hidden', 'true');
  board.append(lineLayer);

  const starElements = unit.stars.map((star) => {
    const element = document.createElement('span');
    element.className = 'night-sky-star';
    element.style.left = `${star.fx * 100}%`;
    element.style.top = `${star.fy * 100}%`;
    board.append(element);
    return element;
  });

  stage.append(board);

  function points() {
    return layoutStars(unit, board.getBoundingClientRect());
  }

  function centre(index) {
    const point = points().find((entry) => entry.index === index);
    return point ? { x: point.x, y: point.y } : null;
  }

  function sizeStars() {
    const layout = points();
    if (layout.length) board.style.setProperty('--star-size', `${Math.round(layout[0].r * 2)}px`);
  }

  function paintLines() {
    lineLayer.replaceChildren();
    const layout = points();
    if (layout.length === 0 || unit.litOrder.length < 2) return;
    const rect = board.getBoundingClientRect();
    lineLayer.setAttribute('viewBox', `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);
    const byIndex = new Map(layout.map((point) => [point.index, point]));
    for (let index = 1; index < unit.litOrder.length; index += 1) {
      const from = byIndex.get(unit.litOrder[index - 1]);
      const to = byIndex.get(unit.litOrder[index]);
      if (!from || !to) continue;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'night-sky-line');
      line.setAttribute('x1', String(from.x - rect.left));
      line.setAttribute('y1', String(from.y - rect.top));
      line.setAttribute('x2', String(to.x - rect.left));
      line.setAttribute('y2', String(to.y - rect.top));
      lineLayer.append(line);
    }
  }

  function paint() {
    unit.stars.forEach((star, index) => {
      const element = starElements[index];
      if (!element) return;
      element.classList.toggle('is-lit', star.lit);
      element.classList.toggle('is-bonus', index === unit.bonusIndex && !star.lit);
    });
    paintLines();
  }

  function wink(index) {
    const element = starElements[index];
    if (!element) return;
    element.classList.remove('is-wink');
    void element.getBoundingClientRect();
    element.classList.add('is-wink');
    later(() => element.classList.remove('is-wink'), 1200);
  }

  // --- play --------------------------------------------------------------------
  function restartIdle() {
    window.clearTimeout(idleTimer);
    timers.delete(idleTimer);
    idleTimer = later(autoFinish, AUTO_FINISH_AFTER_MS);
  }

  function launchFirework(x, y, holdMs) {
    const plan = planFirework({
      motorLevel,
      ruleLevel: unit.ruleLevel,
      densityLevel: unit.densityLevel,
      holdMs,
    });
    for (const burst of plan.bursts) {
      sparkle(stage, x, y, { ...burst, colors: plan.colors });
    }
    playPop(audio(), {
      gain: 0.12,
      pitch: plan.shape === 'willow' ? 0.85 : plan.shape === 'palm' ? 1.15 : 1,
    });
  }

  function finish() {
    if (finishing) return;
    finishing = true;
    window.clearTimeout(idleTimer);
    timers.delete(idleTimer);

    const phraseId = unit.pictureId ? PICTURE_PHRASES[unit.pictureId] : '124';
    say(phraseId);

    const results = unitResults(unit);
    cancelFinale = finale(stage, audio(), {
      element: board,
      colors: FINALE_COLORS,
      holdMs: 3000,
      bursts: 3,
      onDone: () => {
        if (!disposed && typeof settings.onSuccess === 'function') settings.onSuccess({ results });
      },
    });
  }

  // After a long idle the app finishes the picture itself, slowly, and never nags.
  function autoFinish() {
    if (finishing) return;
    const step = autoAdvance(unit);
    unit = step.unit;

    if (step.litIndex >= 0) {
      const at = centre(step.litIndex);
      if (at) {
        sparkle(stage, at.x, at.y, {
          count: 16,
          colors: FINALE_COLORS,
          speed: 90,
          lifeMs: 1700,
          size: 3.4,
          gravity: 30,
        });
        playStep(audio(), 3, { gain: 0.05 });
      }
      paint();
    } else if (step.firework) {
      const rect = board.getBoundingClientRect();
      const x = rect.left + rect.width * (0.2 + Math.random() * 0.6);
      const y = rect.top + rect.height * (0.18 + Math.random() * 0.4);
      launchFirework(x, y, 0);
    }

    if (isDone(unit)) finish();
    else later(autoFinish, AUTO_STEP_MS);
  }

  function onTap(tap) {
    if (disposed || finishing) return;
    restartIdle();

    // 1. Every accepted touch answers at once, before any rule is looked at.
    poke(stage, tap.x, tap.y, audio(), { silent: true });

    // 2. A soft firework at the finger, always.
    const result = touchUnit(unit, points(), { x: tap.x, y: tap.y }, { motorLevel });
    unit = result.unit;
    launchFirework(tap.x, tap.y, tap.duration);

    // 3. Then the star, if one is within reach.
    if (result.litIndex >= 0) {
      playStep(audio(), Math.min(10, litCount + 1), { gain: 0.1, delay: 0.05 });
      litCount += 1;
      if (result.bonus) {
        const at = centre(result.litIndex);
        if (at) {
          sparkle(stage, at.x, at.y, {
            count: 28,
            colors: ['#ffd43b', '#ffffff'],
            speed: 130,
            lifeMs: 1800,
            size: 5,
            gravity: 20,
          });
        }
        playStep(audio(), Math.min(10, litCount + 3), { gain: 0.08, delay: 0.16 });
      }
      paint();
    } else if (result.nearestIndex >= 0) {
      // Away from every star: the firework already happened, the nearest star pulses.
      wink(result.nearestIndex);
      playStep(audio(), 0, { gain: 0.05, duration: 0.3 });
    }

    if (isDone(unit)) finish();
  }

  function onSegment(segment) {
    if (disposed || finishing) return;
    restartIdle();
    if (segment.first) poke(stage, segment.x0, segment.y0, audio(), { silent: true });
    if (motorLevel < 2) return;

    // M2: a sliding finger leaves a trail of small sparklers.
    sparkle(stage, segment.x1, segment.y1, {
      count: Math.min(8, 3 + Math.round(segment.length / 30)),
      colors: TRAIL_COLORS,
      speed: 70,
      lifeMs: 650,
      size: 2.4,
      gravity: 60,
      spread: Math.PI * 1.6,
      angle: -Math.PI / 2,
    });
  }

  const detachTouch = attachTouch(board, { onTap, onSegment });
  window.addEventListener('resize', sizeStars);
  window.addEventListener('resize', paintLines);
  sizeStars();
  paint();
  restartIdle();
  say('120');

  return function cleanup() {
    disposed = true;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    if (cancelFinale) cancelFinale();
    detachTouch();
    window.removeEventListener('resize', sizeStars);
    window.removeEventListener('resize', paintLines);
  };
}
