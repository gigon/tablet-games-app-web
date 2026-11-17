// Sand jar: coloured sand pours into a glass jar from wherever the finger is, layers build
// up, and a full jar is corked and set on a little shelf while a fresh jar begins.
// See specs/toy-4.md.
//
//   renderSandJar(stage, options) -> cleanup
//
// The sand is a column height map drawn on a canvas: no particle physics, a handful of
// rectangles per column. Anything the finger does pours; nothing can fail.

import { finale, poke } from './fx.js';
import { attachTouch } from './input.js';
import {
  POUR_PER_SEGMENT,
  POUR_PER_TAP,
  SAND_COLORS,
  advanceColour,
  autoPour,
  createJar,
  currentColour,
  fillShare,
  isDone,
  pourSand,
  shelfWithJar,
  unitResults,
} from './sand-jar-logic.js';

const AUTO_FINISH_AFTER_MS = 60000;
const AUTO_STEP_MS = 220;
const STREAM_LIFE_MS = 620;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function colourAt(index) {
  const list = SAND_COLORS;
  const safe = ((Math.round(Number(index) || 0) % list.length) + list.length) % list.length;
  return list[safe];
}

export function renderSandJar(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};

  let jar = createJar({ densityLevel: settings.densityLevel });
  let shelf = [];
  let disposed = false;
  let finishing = false;
  let corked = false;
  let idleTimer = null;
  let autoTimer = null;
  let cancelFinale = null;
  let frameHandle = 0;
  let lastFrame = 0;
  let streams = [];
  const timers = new Set();
  const view = { width: 0, height: 0, ratio: 1 };

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
  board.className = 'sand-jar-board';

  const canvas = document.createElement('canvas');
  canvas.className = 'sand-jar-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  const shelfStrip = document.createElement('div');
  shelfStrip.className = 'sand-jar-shelf';
  shelfStrip.setAttribute('aria-hidden', 'true');

  board.append(canvas, shelfStrip);
  stage.append(board);

  const context = canvas.getContext('2d');

  function resize() {
    const rect = canvas.getBoundingClientRect();
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    view.ratio = Math.min(1.5, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(view.width * view.ratio));
    const height = Math.max(1, Math.round(view.height * view.ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  // The glass body and the sand area inside it, in canvas pixels.
  function geometry() {
    const width = view.width;
    const height = view.height;
    const wide = jar.densityLevel < 2;
    const ratio = wide ? 1.12 : 0.52;
    let jarHeight = height * 0.9;
    let jarWidth = jarHeight * ratio;
    if (jarWidth > width * 0.7) {
      jarWidth = width * 0.7;
      jarHeight = jarWidth / ratio;
    }
    const x = (width - jarWidth) / 2;
    const y = (height - jarHeight) / 2;
    const wall = Math.max(5, jarWidth * 0.045);
    const neck = wall * 2.4;
    return {
      x,
      y,
      width: jarWidth,
      height: jarHeight,
      wall,
      inner: {
        left: x + wall,
        right: x + jarWidth - wall,
        top: y + neck,
        bottom: y + jarHeight - wall,
        width: Math.max(1, jarWidth - wall * 2),
        height: Math.max(1, jarHeight - neck - wall),
      },
      radius: Math.min(jarWidth, jarHeight) * 0.16,
    };
  }

  function shelfGradient(summary) {
    const total = summary.bands.reduce((sum, band) => sum + band.count, 0);
    if (!total) return 'linear-gradient(to top, #6b4a2b, #6b4a2b)';
    let used = 0;
    const stops = [];
    for (const band of summary.bands) {
      const start = (used / total) * 100;
      used += band.count;
      const end = (used / total) * 100;
      stops.push(`${colourAt(band.colourIndex).base} ${start.toFixed(1)}% ${end.toFixed(1)}%`);
    }
    return `linear-gradient(to top, ${stops.join(', ')})`;
  }

  function renderShelf() {
    const children = shelf.map((summary) => {
      const element = document.createElement('span');
      element.className = 'sand-jar-shelf-jar';
      element.style.setProperty('--sand-jar-fill', shelfGradient(summary));
      element.style.setProperty('--sand-jar-ratio', summary.shapeId === 'tall' ? '0.58' : '1.08');
      return element;
    });
    shelfStrip.replaceChildren(...children);
  }

  // --- drawing -----------------------------------------------------------------
  function drawSand(inner) {
    if (!context) return;
    const columnWidth = inner.width / jar.cols;
    const cellHeight = inner.height / jar.rows;

    for (let index = 0; index < jar.cols; index += 1) {
      const cells = jar.columns[index];
      if (!cells.length) continue;
      const x = inner.left + index * columnWidth;
      let row = 0;
      while (row < cells.length) {
        const colour = colourAt(cells[row]);
        let end = row + 1;
        while (end < cells.length && cells[end] === cells[row]) end += 1;
        const top = inner.bottom - end * cellHeight;
        const height = Math.max(1, (end - row) * cellHeight + 0.6);
        context.fillStyle = colour.base;
        context.fillRect(x - 0.25, top, columnWidth + 0.5, height);
        row = end;
      }
      const surface = cells[cells.length - 1];
      const top = inner.bottom - cells.length * cellHeight;
      context.fillStyle = colourAt(surface).light;
      context.fillRect(x, top, columnWidth + 0.5, Math.max(1.5, cellHeight * 0.22));
    }

    // The falling stream, from the rim to the top of the sand.
    for (const stream of streams) {
      const alpha = clamp(1 - stream.age / stream.life, 0, 1);
      if (alpha <= 0) continue;
      const colour = colourAt(stream.colourIndex);
      const x = inner.left + stream.fx * inner.width;
      const column = clamp(Math.floor(stream.fx * jar.cols), 0, jar.cols - 1);
      const surface = jar.columns[column].length;
      const surfaceY = inner.bottom - surface * cellHeight;
      const fallTop = Math.min(inner.top, surfaceY);
      context.globalAlpha = alpha * 0.75;
      context.fillStyle = colour.light;
      context.fillRect(x - columnWidth * 0.22, fallTop, columnWidth * 0.44, Math.max(0, surfaceY - fallTop));
      context.beginPath();
      context.ellipse(x, surfaceY, columnWidth * 0.55, Math.max(1, columnWidth * 0.22), 0, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
    }
  }

  function draw() {
    if (!context) return;
    if (!view.width || !view.height) resize();

    context.setTransform(view.ratio, 0, 0, view.ratio, 0, 0);
    context.clearRect(0, 0, view.width, view.height);

    const geo = geometry();
    const inner = geo.inner;

    // Glass body, empty or full.
    roundedRect(context, geo.x, geo.y, geo.width, geo.height, geo.radius);
    context.fillStyle = 'rgba(22, 52, 52, 0.62)';
    context.fill();

    context.save();
    roundedRect(context, geo.x, geo.y, geo.width, geo.height, geo.radius);
    context.clip();
    drawSand(inner);
    context.restore();

    // Glass glare and the rim.
    const glare = context.createLinearGradient(geo.x, 0, geo.x + geo.width, 0);
    glare.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
    glare.addColorStop(0.16, 'rgba(255, 255, 255, 0.04)');
    glare.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
    glare.addColorStop(1, 'rgba(255, 255, 255, 0.07)');
    roundedRect(context, geo.x, geo.y, geo.width, geo.height, geo.radius);
    context.fillStyle = glare;
    context.fill();

    roundedRect(context, geo.x, geo.y, geo.width, geo.height, geo.radius);
    context.lineWidth = Math.max(2, geo.wall * 0.45);
    context.strokeStyle = 'rgba(198, 255, 240, 0.4)';
    context.stroke();

    context.beginPath();
    context.ellipse(
      geo.x + geo.width / 2,
      geo.y + geo.wall * 1.1,
      geo.width * 0.46,
      Math.max(2, geo.wall * 0.7),
      0,
      0,
      Math.PI * 2,
    );
    context.strokeStyle = 'rgba(198, 255, 240, 0.34)';
    context.lineWidth = Math.max(2, geo.wall * 0.32);
    context.stroke();

    if (corked) {
      const corkWidth = Math.min(geo.width * 0.38, geo.width - geo.wall * 3);
      const corkHeight = Math.max(10, geo.wall * 2.6);
      roundedRect(
        context,
        geo.x + (geo.width - corkWidth) / 2,
        geo.y - corkHeight * 0.55,
        corkWidth,
        corkHeight,
        corkHeight * 0.35,
      );
      context.fillStyle = '#b8834f';
      context.fill();
      context.strokeStyle = 'rgba(255, 224, 186, 0.55)';
      context.lineWidth = 2;
      context.stroke();
    }
  }

  // --- play --------------------------------------------------------------------
  function restartIdle() {
    idleTimer = clearTimer(idleTimer);
    idleTimer = later(autoFinish, AUTO_FINISH_AFTER_MS);
  }

  function stopAuto() {
    autoTimer = clearTimer(autoTimer);
  }

  function addStream(fx, colourIndex) {
    streams.push({ fx: clamp(fx, 0, 1), colourIndex, age: 0, life: STREAM_LIFE_MS });
    if (streams.length > 24) streams = streams.slice(streams.length - 24);
  }

  function finish() {
    if (finishing || disposed) return;
    finishing = true;
    corked = true;
    idleTimer = clearTimer(idleTimer);
    stopAuto();
    say('81');
    draw();

    const finished = jar;
    const results = unitResults(finished);
    const nextColour = (finished.colourIndex + 1) % SAND_COLORS.length;

    cancelFinale = finale(stage, audio(), {
      element: board,
      colors: [currentColour(finished).base, currentColour(finished).light, '#ffffff'],
      onDone: () => {
        if (disposed) return;
        shelf = shelfWithJar(shelf, finished);
        renderShelf();
        if (typeof settings.onSuccess === 'function') settings.onSuccess({ results });
        if (disposed) return;
        jar = createJar({ densityLevel: settings.densityLevel, colourIndex: nextColour });
        streams = [];
        corked = false;
        finishing = false;
        cancelFinale = null;
        say('82');
        restartIdle();
        draw();
      },
    });
  }

  // After a long idle the jar fills itself, slowly, and never nags.
  function autoFinish() {
    if (disposed || finishing) return;
    const step = autoPour(jar);
    jar = step.jar;
    if (step.added > 0) {
      const column = clamp(Math.floor(0.5 * jar.cols), 0, jar.cols - 1);
      addStream((column + 0.5) / jar.cols, jar.colourIndex);
    }
    draw();
    if (isDone(jar)) finish();
    else autoTimer = later(autoFinish, AUTO_STEP_MS);
  }

  function pourFrom(clientX, amount) {
    if (disposed || finishing) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const geo = geometry();
    const fx = clamp((x - geo.inner.left) / geo.inner.width, 0, 1);
    const inside = x >= geo.inner.left && x <= geo.inner.right;
    const colour = jar.colourIndex;

    const result = pourSand(jar, { fx, amount, inside, colourIndex: colour });
    jar = result.jar;
    if (result.added > 0) addStream(fx, colour);
    draw();
    if (isDone(jar)) finish();
  }

  function noteStep() {
    return 2 + Math.round(fillShare(jar) * 6);
  }

  function onTap(tap) {
    if (disposed || finishing) return;
    restartIdle();
    stopAuto();

    // 1. Every accepted touch answers at once.
    poke(stage, tap.x, tap.y, audio(), { step: noteStep(), gain: 0.05, duration: 0.26 });

    // 2. Then sand pours. Touches outside the jar pour in from the nearest rim.
    pourFrom(tap.x, POUR_PER_TAP);
  }

  function onSegment(segment) {
    if (disposed || finishing) return;
    restartIdle();
    stopAuto();
    if (segment.first) {
      poke(stage, segment.x0, segment.y0, audio(), { step: noteStep(), gain: 0.045, duration: 0.24 });
    }
    const amount = Math.max(POUR_PER_SEGMENT, Math.round(segment.length / 8));
    pourFrom(segment.x1, amount);
  }

  // --- loop and wiring ---------------------------------------------------------
  function frame(time) {
    if (disposed) return;
    const delta = lastFrame ? Math.min(80, time - lastFrame) : 16;
    lastFrame = time;
    const colour = advanceColour(jar, delta);
    jar = colour.jar;
    for (const stream of streams) stream.age += delta;
    streams = streams.filter((stream) => stream.age < stream.life);
    draw();
    frameHandle = window.requestAnimationFrame(frame);
  }

  const detachTouch = attachTouch(board, { onTap, onSegment });
  window.addEventListener('resize', resize);
  resize();
  renderShelf();
  draw();
  frameHandle = window.requestAnimationFrame(frame);
  restartIdle();
  say('80');

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
    window.removeEventListener('resize', resize);
  };
}
