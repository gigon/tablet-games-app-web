// Pottery wheel: a lump of clay turns on a wheel, seen from the side. A touch shapes the
// band under the finger; at M1 the app walks the profile toward a calm vase, at M2+ the
// clay moves in or out toward the finger, and at M3 a drag along the side reshapes it.
// After a stretch the pot is fired with a warm glow, glazed from three big colour pots,
// and set on the shelf strip. Then a fresh lump begins. See specs/toy-10.md.
//
//   renderPotteryWheel(stage, options) -> cleanup
//
// Nothing can fall, tear or be ruined: every radius is clamped in the logic module.

import { finale, playChord, playStep, playTone, poke, sparkle } from './fx.js';
import { attachTouch } from './input.js';
import {
  CLAY_COLOURS,
  GLAZE_BANDS,
  GLAZE_COLOURS,
  clayColourAt,
  createPot,
  firePot,
  glazeColourAt,
  glazePot,
  shelfWithPot,
  stretchPot,
  touchPot,
  unitResults,
} from './pottery-wheel-logic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const AUTO_FINISH_AFTER_MS = 60000;
const POT_VIEW = Object.freeze({ top: 10, bottom: 92, half: 46, axis: 50 });
const SHAPE_EASE_MS = 300;
let svgCounter = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function svgElement(tag, attributes = {}, children = []) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    element.setAttribute(name, String(value));
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

function div(className) {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

// The symmetric side profile as an SVG path in a 0 0 100 100 viewBox. Index 0 is the
// foot, the last index the rim; both sides are mirrored around x = 50.
function profilePath(radii) {
  const count = radii.length;
  const spacing = (POT_VIEW.bottom - POT_VIEW.top) / count;
  const left = [];
  const right = [];
  for (let index = 0; index < count; index += 1) {
    const y = POT_VIEW.bottom - (index + 0.5) * spacing;
    const reach = Math.max(2, radii[index] * POT_VIEW.half);
    left.push({ x: POT_VIEW.axis - reach, y });
    right.push({ x: POT_VIEW.axis + reach, y });
  }
  let d = `M ${left[0].x.toFixed(2)} ${POT_VIEW.bottom}`;
  for (let index = 0; index < count; index += 1) {
    d += ` L ${left[index].x.toFixed(2)} ${left[index].y.toFixed(2)}`;
  }
  d += ` L ${left[count - 1].x.toFixed(2)} ${POT_VIEW.top}`;
  d += ` L ${right[count - 1].x.toFixed(2)} ${POT_VIEW.top}`;
  for (let index = count - 1; index >= 0; index -= 1) {
    d += ` L ${right[index].x.toFixed(2)} ${right[index].y.toFixed(2)}`;
  }
  d += ` L ${right[0].x.toFixed(2)} ${POT_VIEW.bottom} Z`;
  return d;
}

function createWheel() {
  const wheel = div('pottery-wheel-wheel');
  const spin = div('pottery-wheel-wheel-spin');
  for (let index = 0; index < 8; index += 1) {
    const spoke = document.createElement('span');
    spoke.className = 'pottery-wheel-spoke';
    spoke.style.setProperty('--spoke-angle', `${index * 45}deg`);
    spin.append(spoke);
  }
  const hub = div('pottery-wheel-wheel-hub');
  spin.append(hub);
  wheel.append(spin);
  return wheel;
}

function createPotSvg() {
  const uid = `pottery-wheel-${++svgCounter}`;
  const defs = svgElement('defs');
  const clay = svgElement('linearGradient', {
    id: `${uid}-clay`,
    x1: '0',
    y1: '0',
    x2: '1',
    y2: '1',
  });
  const clayStops = [0, 0.45, 1].map((offset) => svgElement('stop', { offset }));
  clay.append(...clayStops);

  const shine = svgElement('linearGradient', {
    id: `${uid}-shine`,
    x1: '0',
    y1: '0',
    x2: '1',
    y2: '0',
  });
  shine.append(
    svgElement('stop', { offset: '0', 'stop-color': '#ffffff', 'stop-opacity': '0' }),
    svgElement('stop', { offset: '0.5', 'stop-color': '#ffffff', 'stop-opacity': '0.34' }),
    svgElement('stop', { offset: '1', 'stop-color': '#ffffff', 'stop-opacity': '0' }),
  );

  const clip = svgElement('clipPath', { id: `${uid}-clip` });
  const clipPath = svgElement('path', { d: profilePath(createPot().radii) });
  clip.append(clipPath);
  defs.append(clay, shine, clip);

  const body = svgElement('path', {
    class: 'pottery-wheel-body',
    d: clipPath.getAttribute('d'),
    fill: `url(#${uid}-clay)`,
  });

  const glazeGroup = svgElement('g', {
    class: 'pottery-wheel-glaze',
    'clip-path': `url(#${uid}-clip)`,
  });

  const shineGroup = svgElement('g', {
    class: 'pottery-wheel-shine-group',
    'clip-path': `url(#${uid}-clip)`,
  });
  const shineRect = svgElement('rect', {
    class: 'pottery-wheel-shine',
    x: '-34',
    y: '0',
    width: '30',
    height: '100',
    fill: `url(#${uid}-shine)`,
  });
  shineGroup.append(shineRect);

  const rim = svgElement('ellipse', {
    class: 'pottery-wheel-rim',
    cx: POT_VIEW.axis,
    cy: POT_VIEW.top,
    rx: 10,
    ry: 2.6,
  });

  const svg = svgElement(
    'svg',
    { viewBox: '0 0 100 100', class: 'pottery-wheel-pot-svg', 'aria-hidden': 'true' },
    [defs, body, glazeGroup, shineGroup, rim],
  );

  return { svg, body, clipPath, glazeGroup, rim, clayStops };
}

export function renderPotteryWheel(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const motorLevel = clamp(Math.round(Number(settings.motorLevel) || 1), 1, 3);

  let pot = createPot({ motorLevel, clayIndex: 0 });
  let shelf = [];
  let potsMade = 0;
  let disposed = false;
  let finishing = false;
  let firingTimer = null;
  let glazeTimer = null;
  let idleTimer = null;
  let cancelFinale = null;
  let frameHandle = 0;
  let tween = null;
  let displayRadii = pot.radii.slice();
  let lastRubAt = 0;
  const timers = new Set();

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
  const board = div('pottery-wheel-board');

  const wheel = createWheel();

  const potWrap = div('pottery-wheel-pot');
  const potSvg = createPotSvg();
  potWrap.append(potSvg.svg);

  const kiln = div('pottery-wheel-kiln');
  kiln.setAttribute('aria-hidden', 'true');
  const kilnDoor = div('pottery-wheel-kiln-door');
  const kilnFlame = div('pottery-wheel-kiln-flame');
  kiln.append(kilnDoor, kilnFlame);

  const colourRow = div('pottery-wheel-colours');
  const colourButtons = GLAZE_COLOURS.map((colour) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pottery-wheel-colour-pot';
    button.style.setProperty('--glaze-base', colour.base);
    button.style.setProperty('--glaze-light', colour.light);
    button.style.setProperty('--glaze-dark', colour.dark);
    button.setAttribute('aria-label', colour.id);
    colourRow.append(button);
    return button;
  });

  const shelfStrip = div('pottery-wheel-shelf');
  shelfStrip.setAttribute('aria-hidden', 'true');

  board.append(wheel, potWrap, kiln, colourRow, shelfStrip);
  stage.append(board);

  function geometry() {
    const rect = potSvg.svg.getBoundingClientRect();
    return {
      left: rect.left + rect.width * 0.04,
      top: rect.top + rect.height * 0.1,
      width: rect.width * 0.92,
      height: rect.height * 0.82,
    };
  }

  function potCentre() {
    const rect = potWrap.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.5 };
  }

  // --- painting ----------------------------------------------------------------
  function applyClay(index) {
    const colour = clayColourAt(index);
    const [dark, base, light] = potSvg.clayStops;
    dark.setAttribute('stop-color', colour.dark);
    base.setAttribute('stop-color', colour.base);
    light.setAttribute('stop-color', colour.light);
  }

  function paintProfile(radii) {
    const d = profilePath(radii);
    potSvg.body.setAttribute('d', d);
    potSvg.clipPath.setAttribute('d', d);
    const rimReach = Math.max(3, radii[radii.length - 1] * POT_VIEW.half * 0.92);
    potSvg.rim.setAttribute('rx', rimReach.toFixed(2));
    potSvg.rim.setAttribute('ry', Math.max(2, rimReach * 0.24).toFixed(2));
  }

  function paintGlaze() {
    potSvg.glazeGroup.replaceChildren();
    if (pot.phase !== 'glazed' || pot.glazeIndex < 0) {
      potSvg.rim.removeAttribute('fill');
      return;
    }
    const colour = glazeColourAt(pot.glazeIndex);
    potSvg.rim.setAttribute('fill', colour.light);
    for (const band of GLAZE_BANDS) {
      const y = POT_VIEW.bottom - band.to * (POT_VIEW.bottom - POT_VIEW.top);
      const height = (band.to - band.from) * (POT_VIEW.bottom - POT_VIEW.top);
      potSvg.glazeGroup.append(
        svgElement('rect', {
          x: '0',
          y: y.toFixed(2),
          width: '100',
          height: Math.max(1, height).toFixed(2),
          fill: colour.base,
          opacity: '0.88',
        }),
        svgElement('rect', {
          x: '0',
          y: y.toFixed(2),
          width: '100',
          height: '1.4',
          fill: colour.light,
          opacity: '0.8',
        }),
      );
    }
  }

  function renderShelf() {
    const children = shelf.map((entry) => {
      const wrapper = document.createElement('span');
      wrapper.className = 'pottery-wheel-shelf-pot';
      const colour =
        entry.glazeIndex >= 0
          ? glazeColourAt(entry.glazeIndex)
          : clayColourAt(entry.clayIndex);
      wrapper.style.setProperty('--shelf-pot', colour.base);
      wrapper.style.setProperty('--shelf-pot-light', colour.light);
      const svg = svgElement('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
      svg.append(
        svgElement('path', {
          class: 'pottery-wheel-shelf-pot-shape',
          d: profilePath(entry.radii),
          fill: 'currentColor',
        }),
      );
      wrapper.append(svg);
      return wrapper;
    });
    shelfStrip.replaceChildren(...children);
  }

  function paint() {
    potWrap.classList.toggle('is-fired', pot.phase !== 'shaping');
    potWrap.classList.toggle('is-glazed', pot.phase === 'glazed');
    const kilnOn = pot.phase === 'shaping' && pot.fireReady && motorLevel >= 2;
    kiln.classList.toggle('is-visible', kilnOn);
    colourRow.classList.toggle('is-visible', pot.phase === 'fired');
    colourButtons.forEach((button, index) => {
      button.classList.toggle('is-chosen', pot.glazeIndex === index);
    });
    paintGlaze();
  }

  // Shape changes ease over 300 ms. The wheel itself spins with a CSS animation.
  function animateShape(time) {
    if (disposed) return;
    if (!tween) {
      frameHandle = 0;
      return;
    }
    const progress = clamp((time - tween.start) / SHAPE_EASE_MS, 0, 1);
    const eased = 1 - (1 - progress) ** 3;
    displayRadii = tween.from.map((value, index) => value + (tween.to[index] - value) * eased);
    paintProfile(displayRadii);
    if (progress >= 1) {
      displayRadii = tween.to.slice();
      tween = null;
      frameHandle = 0;
      return;
    }
    frameHandle = window.requestAnimationFrame(animateShape);
  }

  function setRadii(target) {
    tween = { from: displayRadii.slice(), to: target.slice(), start: performance.now() };
    if (!frameHandle) frameHandle = window.requestAnimationFrame(animateShape);
  }

  // --- play --------------------------------------------------------------------
  function restartIdle() {
    idleTimer = clearTimer(idleTimer);
    idleTimer = later(autoFinish, AUTO_FINISH_AFTER_MS);
  }

  function noteForTouch() {
    return Math.min(10, 2 + Math.round((pot.touches % 7)));
  }

  function shapeAt(point) {
    const result = touchPot(pot, point, geometry(), { motorLevel });
    if (!result.shaped) return;
    pot = result.pot;
    setRadii(pot.radii);
    paint();
    playStep(audio(), noteForTouch(), { gain: 0.06, delay: 0.03, duration: 0.26 });
    sparkle(stage, point.x, point.y, {
      count: 5,
      colors: [clayColourAt(pot.clayIndex).light, '#ffffff'],
      speed: 110,
      lifeMs: 700,
      size: 3,
      gravity: 140,
    });
    if (pot.fireReady && motorLevel <= 1 && !firingTimer) {
      firingTimer = later(() => {
        firingTimer = null;
        fireNow();
      }, 650);
    }
  }

  function fireNow({ announce = true } = {}) {
    if (disposed || finishing || pot.phase !== 'shaping') return;
    firingTimer = clearTimer(firingTimer);
    pot = firePot(pot);
    paint();
    if (announce) say('141');
    const at = potCentre();
    sparkle(stage, at.x, at.y, {
      count: 24,
      colors: ['#ffb347', '#ffd98a', '#ffffff'],
      speed: 180,
      lifeMs: 1600,
      size: 4,
      gravity: 40,
    });
    playChord(audio());
    restartIdle();
  }

  function glazeFrom(index) {
    if (disposed || finishing || pot.phase !== 'fired') return;
    pot = glazePot(pot, index);
    paint();
    setRadii(pot.radii);
    const colour = glazeColourAt(pot.glazeIndex);
    const at = potCentre();
    sparkle(stage, at.x, at.y, {
      count: 26,
      colors: [colour.base, colour.light, '#ffffff'],
      speed: 170,
      lifeMs: 1600,
      size: 4,
      gravity: 30,
    });
    playChord(audio());
    say(colour.phrase);
    restartIdle();
    glazeTimer = later(finish, 1100);
  }

  function finish() {
    if (disposed || finishing || pot.phase !== 'glazed') return;
    finishing = true;
    glazeTimer = clearTimer(glazeTimer);
    idleTimer = clearTimer(idleTimer);
    const results = unitResults(pot);
    const finished = pot;
    const colour = glazeColourAt(finished.glazeIndex);
    cancelFinale = finale(stage, audio(), {
      element: potSvg.svg,
      colors: [colour.base, colour.light, '#ffffff'],
      onDone: () => {
        if (disposed) return;
        shelf = shelfWithPot(shelf, finished);
        renderShelf();
        potsMade += 1;
        if (typeof settings.onSuccess === 'function') settings.onSuccess({ results });
        if (disposed) return;
        pot = createPot({ motorLevel, clayIndex: potsMade });
        displayRadii = pot.radii.slice();
        tween = null;
        applyClay(pot.clayIndex);
        paintProfile(displayRadii);
        paint();
        finishing = false;
        cancelFinale = null;
        say('142');
        restartIdle();
      },
    });
  }

  // After a long idle the app finishes the pot itself, slowly, and never nags.
  function autoFinish() {
    if (disposed || finishing) return;
    idleTimer = clearTimer(idleTimer);
    if (pot.phase === 'shaping') {
      fireNow({ announce: false });
      later(autoFinish, 2000);
    } else if (pot.phase === 'fired') {
      glazeFrom(0);
    } else if (pot.phase === 'glazed') {
      finish();
    }
  }

  function kilnAt(point) {
    if (!kiln.classList.contains('is-visible')) return false;
    const rect = kiln.getBoundingClientRect();
    return (
      point.x >= rect.left - 12 &&
      point.x <= rect.right + 12 &&
      point.y >= rect.top - 12 &&
      point.y <= rect.bottom + 12
    );
  }

  function glazeAt(point) {
    if (pot.phase !== 'fired') return -1;
    for (let index = 0; index < colourButtons.length; index += 1) {
      const rect = colourButtons[index].getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const reach = Math.max(rect.width, rect.height) * 0.62;
      if (Math.hypot(point.x - x, point.y - y) <= reach) return index;
    }
    return -1;
  }

  function onDown(tap) {
    if (disposed || finishing) return;
    restartIdle();

    // 1. Every accepted touch answers at once, before any rule is looked at.
    poke(stage, tap.x, tap.y, audio(), { step: 5, gain: 0.05, duration: 0.28 });

    // 2. Then the scene decides what else happens. Nothing is ever refused.
    if (pot.phase === 'shaping' && kilnAt(tap)) {
      fireNow();
      return;
    }
    if (pot.phase === 'fired') {
      const index = glazeAt(tap);
      if (index >= 0) glazeFrom(index);
      return;
    }
    if (pot.phase === 'shaping') shapeAt(tap);
  }

  function onSegment(segment) {
    if (disposed || finishing || motorLevel < 3 || pot.phase !== 'shaping') return;
    restartIdle();
    const result = stretchPot(pot, segment, geometry(), { motorLevel });
    if (!result.shaped) return;
    pot = result.pot;
    setRadii(pot.radii);
    paint();
    const now = performance.now();
    if (now - lastRubAt > 120) {
      lastRubAt = now;
      playTone(audio(), 196 + (segment.x1 % 5) * 38, { gain: 0.025, duration: 0.18 });
    }
  }

  const detachTouch = attachTouch(board, { onDown, onSegment });
  applyClay(pot.clayIndex);
  paintProfile(displayRadii);
  paint();
  renderShelf();
  restartIdle();
  say('140');

  return function cleanup() {
    disposed = true;
    firingTimer = clearTimer(firingTimer);
    glazeTimer = clearTimer(glazeTimer);
    idleTimer = clearTimer(idleTimer);
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    if (cancelFinale) cancelFinale();
    if (frameHandle) window.cancelAnimationFrame(frameHandle);
    frameHandle = 0;
    tween = null;
    detachTouch();
  };
}
