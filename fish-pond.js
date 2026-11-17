// Fish pond: a calm pond seen from above. A touch drops food; koi steer over, eat, and a
// lily opens when one swims past. See specs/toy-3.md.
//
//   renderFishPond(stage, options) -> cleanup

import { finale, poke, pop, sparkle } from './fx.js';
import { attachTouch } from './input.js';
import {
  FOOD_LIFE_MS,
  createUnit,
  dropFood,
  isDone,
  resetFeeds,
  stepUnit,
  unitResults,
} from './fish-pond-logic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const AUTO_FINISH_AFTER_MS = 60000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function svgElement(tag, attributes = {}, children = []) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    element.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child) element.append(child);
  }
  return element;
}

function fishGraphic() {
  return svgElement('svg', { viewBox: '0 0 240 120', 'aria-hidden': 'true' }, [
    svgElement('path', {
      class: 'fish-pond-tail',
      d: 'M 74 60 L 8 22 Q 34 60 8 98 Z',
    }),
    svgElement('path', {
      class: 'fish-pond-fin',
      d: 'M 118 25 Q 142 2 168 26 Q 140 30 118 25 Z',
    }),
    svgElement('ellipse', { class: 'fish-pond-body', cx: 140, cy: 60, rx: 82, ry: 38 }),
    svgElement('ellipse', {
      class: 'fish-pond-belly',
      cx: 136,
      cy: 51,
      rx: 52,
      ry: 13,
    }),
    svgElement('circle', { class: 'fish-pond-eye-white', cx: 198, cy: 52, r: 10 }),
    svgElement('circle', { class: 'fish-pond-eye', cx: 200, cy: 52, r: 5 }),
  ]);
}

function lilyGraphic() {
  const pad = document.createElement('span');
  pad.className = 'fish-pond-lily-pad';

  const flower = document.createElement('span');
  flower.className = 'fish-pond-lily-flower';
  for (let index = 0; index < 6; index += 1) {
    const petal = document.createElement('span');
    petal.className = 'fish-pond-lily-petal';
    petal.style.setProperty('--petal-angle', `${index * 60}deg`);
    flower.append(petal);
  }
  const centre = document.createElement('span');
  centre.className = 'fish-pond-lily-centre';
  flower.append(centre);

  return [pad, flower];
}

export function renderFishPond(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const motorLevel = Number(settings.motorLevel) || 1;
  const rng = Math.random;

  let unit = createUnit({
    densityLevel: settings.densityLevel,
    rng,
  });
  let disposed = false;
  let celebrating = false;
  let idleFinished = false;
  let saidLily = false;
  let lure = null;
  let idleTimer = null;
  let cancelFinale = null;
  let frameHandle = 0;
  let lastFrame = 0;
  const timers = new Set();
  const foodElements = new Map();

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
  board.className = 'fish-pond-board';

  const lilyLayer = document.createElement('div');
  lilyLayer.className = 'fish-pond-lily-layer';
  const foodLayer = document.createElement('div');
  foodLayer.className = 'fish-pond-food-layer';
  const fishLayer = document.createElement('div');
  fishLayer.className = 'fish-pond-fish-layer';
  board.append(lilyLayer, foodLayer, fishLayer);

  const lilyElements = unit.lilies.map((lily) => {
    const element = document.createElement('div');
    element.className = 'fish-pond-lily';
    element.style.left = `${lily.fx * 100}%`;
    element.style.top = `${lily.fy * 100}%`;
    for (const part of lilyGraphic()) element.append(part);
    lilyLayer.append(element);
    return element;
  });

  const fishElements = unit.fish.map((fish) => {
    const element = document.createElement('div');
    element.className = 'fish-pond-fish';
    element.style.setProperty('--fish-body', fish.color);
    element.style.setProperty('--fish-tail', fish.color);
    element.style.setProperty('--fish-fin', fish.color);
    element.style.setProperty('--fish-scale', String(fish.scale));
    element.append(fishGraphic());
    fishLayer.append(element);
    return element;
  });

  stage.append(board);

  function sizeScene() {
    const rect = board.getBoundingClientRect();
    const base = Math.max(1, Math.min(rect.width, rect.height));
    board.style.setProperty('--fish-px', `${Math.round(Math.max(210, base * 0.28))}px`);
    board.style.setProperty('--lily-px', `${Math.round(Math.max(110, base * 0.17))}px`);
    board.style.setProperty('--food-px', `${Math.round(Math.max(14, base * 0.024))}px`);
  }

  function fractionAt(x, y) {
    const rect = board.getBoundingClientRect();
    return {
      fx: rect.width ? (Number(x) - rect.left) / rect.width : 0.5,
      fy: rect.height ? (Number(y) - rect.top) / rect.height : 0.5,
    };
  }

  function addWaterRings(tap) {
    const rect = board.getBoundingClientRect();
    for (let index = 0; index < 2; index += 1) {
      const ring = document.createElement('span');
      ring.className = 'fish-pond-ring';
      ring.style.left = `${tap.x - rect.left}px`;
      ring.style.top = `${tap.y - rect.top}px`;
      ring.style.animationDelay = `${index * 220}ms`;
      board.append(ring);
      later(() => ring.remove(), 1800 + index * 220);
    }
  }

  function paintFish() {
    unit.fish.forEach((fish, index) => {
      const element = fishElements[index];
      if (!element) return;
      element.style.left = `${fish.fx * 100}%`;
      element.style.top = `${fish.fy * 100}%`;
      element.style.transform = `translate(-50%, -50%) rotate(${fish.angle}rad)`;
      element.classList.toggle('is-fed', fish.fedFlash > 0.08);
    });
  }

  function syncFood() {
    const live = new Set();
    for (const pellet of unit.food) {
      live.add(pellet.id);
      let element = foodElements.get(pellet.id);
      if (!element) {
        element = document.createElement('span');
        element.className = 'fish-pond-food';
        foodLayer.append(element);
        foodElements.set(pellet.id, element);
      }
      element.style.left = `${pellet.fx * 100}%`;
      element.style.top = `${pellet.fy * 100}%`;
      const fade = clamp(
        1 - Math.max(0, pellet.ageMs - FOOD_LIFE_MS * 0.65) / (FOOD_LIFE_MS * 0.35),
        0,
        1,
      );
      element.style.opacity = String(fade);
      element.style.setProperty('--food-scale', String(0.75 + fade * 0.25));
    }
    for (const [id, element] of [...foodElements]) {
      if (live.has(id)) continue;
      foodElements.delete(id);
      element.classList.add('is-gone');
      later(() => element.remove(), 360);
    }
  }

  function applyEvents(events) {
    const rect = board.getBoundingClientRect();
    for (const eaten of events.eaten) {
      const x = rect.left + eaten.fx * rect.width;
      const y = rect.top + eaten.fy * rect.height;
      pop(stage, x, y, audio(), {
        color: '#ffd98a',
        count: 4,
        pitch: 0.78,
        gain: 0.045,
      });
    }
    for (const index of events.opened) {
      const element = lilyElements[index];
      if (element) element.classList.add('is-open');
      const lily = unit.lilies[index];
      if (lily) {
        const x = rect.left + lily.fx * rect.width;
        const y = rect.top + lily.fy * rect.height;
        sparkle(stage, x, y, {
          count: 14,
          colors: ['#ffd6ec', '#fff6c8', '#ffffff'],
          speed: 120,
          lifeMs: 1200,
          size: 4,
          gravity: 10,
        });
      }
      if (!saidLily) {
        saidLily = true;
        say('72');
      }
    }
  }

  // --- play --------------------------------------------------------------------
  function restartIdle() {
    window.clearTimeout(idleTimer);
    timers.delete(idleTimer);
    if (idleFinished) return;
    idleTimer = later(autoFinish, AUTO_FINISH_AFTER_MS);
  }

  function finish() {
    if (celebrating) return;
    celebrating = true;
    window.clearTimeout(idleTimer);
    timers.delete(idleTimer);
    const results = unitResults(unit);
    say('73');
    cancelFinale = finale(stage, audio(), {
      element: board,
      colors: ['#ffd98a', '#ff9ec2', '#bdf4e7', '#ffffff'],
      onDone: () => {
        if (disposed) return;
        celebrating = false;
        unit = resetFeeds(unit);
        if (typeof settings.onSuccess === 'function') settings.onSuccess({ results });
      },
    });
  }

  function autoFinish() {
    if (disposed || idleFinished) return;
    idleFinished = true;
    if (celebrating) return;
    celebrating = true;
    cancelFinale = finale(stage, audio(), {
      element: board,
      bursts: 3,
      colors: ['#ffd98a', '#bdf4e7', '#ffffff'],
      onDone: () => {
        if (disposed) return;
        celebrating = false;
        if (typeof settings.onSuccess === 'function') {
          settings.onSuccess({ results: { motor: null, rule: null, density: null } });
        }
      },
    });
  }

  function onTap(tap) {
    if (disposed) return;
    restartIdle();

    // 1. Every accepted touch answers at once, before any rule is looked at.
    poke(stage, tap.x, tap.y, audio(), { step: 2, color: '#bdf4e7', gain: 0.05 });
    addWaterRings(tap);

    // 2. Water touched: food falls there.
    unit = dropFood(unit, fractionAt(tap.x, tap.y), { rng }).unit;
    syncFood();
  }

  function onDown(point) {
    if (disposed) return;
    restartIdle();
    if (motorLevel >= 2) lure = fractionAt(point.x, point.y);
  }

  function onSegment(segment) {
    if (disposed) return;
    restartIdle();
    if (motorLevel >= 2) lure = fractionAt(segment.x1, segment.y1);
  }

  function onEnd() {
    lure = null;
  }

  function frame(time) {
    if (disposed) return;
    const dt = lastFrame ? Math.min(50, time - lastFrame) : 16;
    lastFrame = time;
    const result = stepUnit(unit, dt, { rng, lure: motorLevel >= 2 ? lure : null });
    unit = result.unit;
    applyEvents(result.events);
    paintFish();
    syncFood();
    if (isDone(unit) && !celebrating) finish();
    frameHandle = window.requestAnimationFrame(frame);
  }

  const detachTouch = attachTouch(board, { onTap, onDown, onSegment, onEnd });
  window.addEventListener('resize', sizeScene);
  sizeScene();
  paintFish();
  syncFood();
  restartIdle();
  say('70');
  frameHandle = window.requestAnimationFrame(frame);

  return function cleanup() {
    disposed = true;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    if (cancelFinale) cancelFinale();
    if (frameHandle) window.cancelAnimationFrame(frameHandle);
    detachTouch();
    window.removeEventListener('resize', sizeScene);
    foodElements.clear();
  };
}
