// Colour pop: a box of coloured balls and a glass jar at the side. A touch pops the
// ball's whole same-colour group, the balls above tumble down, and fresh balls pour in
// from the top. See specs/toy-9.md.
//
//   renderColourPop(stage, options) -> cleanup
//
// Every accepted touch answers at once: a poke ripple at the finger, then the group pops
// one ball at a time, each a note higher, with the popped balls flying toward the jar.

import { finale, playChord, playRun, playStep, poke, pop, sparkle } from './fx.js';
import { attachTouch } from './input.js';
import {
  BIG_GROUP,
  autoPop,
  bonusBallIds,
  createUnit,
  isDone,
  jarFill,
  layoutBalls,
  touchUnit,
  unitResults,
} from './colour-pop-logic.js';

const AUTO_FINISH_AFTER_MS = 60000;
const AUTO_STEP_MS = 850;

const PALETTE = Object.freeze([
  Object.freeze({ base: '#ff7a6b', light: '#ffd2cb', dark: '#8f2c24' }),
  Object.freeze({ base: '#5c9dff', light: '#d3e2ff', dark: '#1f3f88' }),
  Object.freeze({ base: '#ffd43b', light: '#fff3b0', dark: '#8a6d00' }),
]);

const FINALE_COLORS = Object.freeze(['#ffd43b', '#ff8fab', '#9ec5ff', '#ffffff']);
const SPARK_COLORS = Object.freeze(['#ffd43b', '#ff8fab', '#7fffd4', '#9ec5ff', '#ffffff']);

export function renderColourPop(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const motorLevel = Number(settings.motorLevel) || 1;

  let unit = createUnit({
    densityLevel: settings.densityLevel,
    ruleLevel: settings.ruleLevel,
  });
  let disposed = false;
  let finishing = false;
  let saidBig = false;
  let poppedCount = 0;
  let idleTimer = null;
  let cancelFinale = null;
  const timers = new Set();
  const elements = new Map();

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
  const bench = document.createElement('div');
  bench.className = 'colour-pop-bench';

  const board = document.createElement('div');
  board.className = 'colour-pop-board';

  const jar = document.createElement('div');
  jar.className = 'colour-pop-jar';
  jar.setAttribute('aria-hidden', 'true');
  const jarGlass = document.createElement('div');
  jarGlass.className = 'colour-pop-jar-glass';
  const jarContent = document.createElement('div');
  jarContent.className = 'colour-pop-jar-fill';
  jarGlass.append(jarContent);
  jar.append(jarGlass);

  bench.append(board, jar);
  stage.append(bench);

  function points() {
    return layoutBalls(unit, board.getBoundingClientRect());
  }

  function leftFor(ball) {
    return `${((ball.col + 0.5) / unit.cols) * 100}%`;
  }

  function topFor(ball) {
    return `${((ball.row + 0.5) / unit.rows) * 100}%`;
  }

  function aboveTop() {
    return `${(-100 / unit.rows) * 1.1}%`;
  }

  function applyPosition(element, ball, { above = false } = {}) {
    element.style.left = leftFor(ball);
    element.style.top = above ? aboveTop() : topFor(ball);
  }

  function createBallElement(ball, { above = false } = {}) {
    const element = document.createElement('span');
    element.className = `colour-pop-ball colour-pop-ball--${ball.color}`;
    element.dataset.color = String(ball.color);
    element.setAttribute('aria-hidden', 'true');
    const mark = document.createElement('i');
    mark.className = 'colour-pop-mark';
    element.append(mark);
    applyPosition(element, ball, { above });
    board.append(element);
    return element;
  }

  function sizeBalls() {
    const layout = points();
    if (layout.length) board.style.setProperty('--ball-size', `${Math.round(layout[0].r * 2)}px`);
  }

  function syncScene({ refillIds = new Set() } = {}) {
    for (const ball of unit.balls) {
      let element = elements.get(ball.id);
      if (!element) {
        const fromTop = refillIds.has(ball.id);
        element = createBallElement(ball, { above: fromTop });
        elements.set(ball.id, element);
        if (fromTop) later(() => applyPosition(element, ball), 28);
        continue;
      }
      applyPosition(element, ball);
    }
  }

  function markPopped(poppedBalls) {
    for (const ball of poppedBalls) {
      const element = elements.get(ball.id);
      if (!element) continue;
      element.classList.add('is-popping');
      later(() => {
        element.remove();
        elements.delete(ball.id);
      }, 300);
    }
  }

  function paintBonus() {
    const glowing = new Set(bonusBallIds(unit));
    for (const [id, element] of elements) {
      element.classList.toggle('is-bonus', glowing.has(id));
    }
  }

  function updateJar() {
    const fill = jarFill(unit);
    jar.style.setProperty('--jar-fill', `${Math.round(fill * 100)}%`);
    jar.classList.toggle('is-full', fill >= 1);
  }

  function wink(ballId) {
    const element = elements.get(ballId);
    if (!element) return;
    element.classList.remove('is-wink');
    void element.getBoundingClientRect();
    element.classList.add('is-wink');
    later(() => element.classList.remove('is-wink'), 500);
  }

  function centreFor(layout, ballId) {
    return layout.find((point) => point.id === ballId) || null;
  }

  function sparkleGroup(popped, layout) {
    if (popped.length < BIG_GROUP) return;
    const colours = [...new Set(popped.map((ball) => PALETTE[ball.color]?.base || '#ffffff'))];
    const first = popped[0];
    const anchor = layout.find((point) => point.id === first.id);
    if (anchor) {
      sparkle(stage, anchor.x, anchor.y, {
        count: Math.min(70, 24 + popped.length * 3),
        colors: [...colours, ...SPARK_COLORS],
      });
    }
    if (!saidBig) {
      saidBig = true;
      say('131');
    }
  }

  function playPoppedRun(count, soft = false) {
    playRun(audio(), Math.min(11, Math.max(1, count)), {
      startStep: Math.min(6, poppedCount % 6),
      gapMs: 40,
      gain: soft ? 0.045 : 0.065,
      duration: 0.28,
    });
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
    window.clearTimeout(idleTimer);
    timers.delete(idleTimer);
    say('132');
    jar.classList.add('is-full');

    const results = unitResults(unit);
    cancelFinale = finale(stage, audio(), {
      element: board,
      colors: FINALE_COLORS,
      onDone: () => {
        if (!disposed && typeof settings.onSuccess === 'function') settings.onSuccess({ results });
      },
    });
  }

  function showPop(popped, layout) {
    popped.forEach((ball, index) => {
      const point = centreFor(layout, ball.id);
      later(() => {
        if (point) {
          pop(stage, point.x, point.y, audio(), {
            color: PALETTE[ball.color]?.base,
            size: Math.round(point.r * 1.8),
            silent: true,
          });
        }
        markPopped([ball]);
      }, index * 40);
    });
  }

  // After a long idle the app finishes the unit itself, slowly, and never nags.
  function autoFinish() {
    if (disposed || finishing) return;
    const layout = points();
    const step = autoPop(unit, { rng: Math.random });
    unit = step.unit;

    if (step.poppedBalls.length) {
      showPop(step.poppedBalls, layout);
      syncScene({ refillIds: new Set(step.refills.map((ball) => ball.id)) });
      playPoppedRun(step.poppedBalls.length, true);
      poppedCount += step.poppedBalls.length;
      paintBonus();
      updateJar();
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
    const layout = points();
    const result = touchUnit(unit, layout, { x: tap.x, y: tap.y }, {
      motorLevel,
      rng: Math.random,
    });
    unit = result.unit;

    if (result.poppedBalls.length === 0) {
      // Out of reach of any ball: still pleasant, and the nearest one winks.
      playStep(audio(), 0, { gain: 0.05, duration: 0.3 });
      if (result.nearestBallId !== null) wink(result.nearestBallId);
      return;
    }

    showPop(result.poppedBalls, layout);
    syncScene({ refillIds: new Set(result.refills.map((ball) => ball.id)) });
    playPoppedRun(result.poppedBalls.length);
    poppedCount += result.poppedBalls.length;

    if (result.poppedBalls.length >= BIG_GROUP) sparkleGroup(result.poppedBalls, layout);

    if (result.bonus) {
      const anchor = centreFor(layout, result.poppedBalls[0].id);
      if (anchor) {
        sparkle(stage, anchor.x, anchor.y, { count: 42, colors: FINALE_COLORS });
      }
      playChord(audio(), undefined, { gain: 0.12, duration: 1.1 });
    }

    if (result.falls.length) {
      later(
        () =>
          playRun(audio(), Math.min(11, result.falls.length), {
            startStep: 0,
            gapMs: 55,
            gain: 0.035,
            duration: 0.22,
          }),
        280,
      );
    }

    paintBonus();
    updateJar();
    if (isDone(unit)) finish();
  }

  const detachTouch = attachTouch(board, { onTap });
  window.addEventListener('resize', sizeBalls);
  sizeBalls();
  syncScene();
  paintBonus();
  updateJar();
  restartIdle();
  say('130');

  return function cleanup() {
    disposed = true;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    if (cancelFinale) cancelFinale();
    detachTouch();
    window.removeEventListener('resize', sizeBalls);
    elements.clear();
  };
}
