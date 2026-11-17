// Kaleidoscope: a round black sheet where a finger leaves glowing mirrored strokes. Each
// stroke is repeated around the centre in six rotations with mirror twins, the colours
// drift along the line, and old strokes fade slowly so the picture stays airy. After a
// stretch of drawing the picture is framed, turns once, and a fresh sheet begins.
// See specs/toy-11.md.
//
//   renderKaleidoscope(stage, options) -> cleanup
//
// Every accepted touch answers at once: a poke ripple and a note pitched by the distance
// from the centre, then the mirrored stamp or stroke.

import { finale, playStep, poke, sparkle } from './fx.js';
import { attachTouch } from './input.js';
import {
  MIN_POINT_STEP,
  autoStamp,
  clampToDisc,
  colourFor,
  createUnit,
  fadeAlpha,
  isDone,
  segmentUnit,
  smoothPoint,
  stampUnit,
  symmetryTransforms,
  toUnitPoint,
  transformPoint,
  unitResults,
} from './kaleidoscope-logic.js';

const AUTO_FINISH_AFTER_MS = 60000;
const AUTO_STEP_MS = 900;
const FINALE_HOLD_MS = 3200;
const NOTE_GAP_MS = 110;
const MAX_STROKES = 90;
const FINALE_COLORS = Object.freeze(['#ffd43b', '#ff8fab', '#7fffd4', '#9ec5ff', '#ffffff']);
const STAMP_COLORS = Object.freeze(['#ffd43b', '#ff8fab', '#7fffd4', '#9ec5ff']);

function stepFor(point) {
  const distance = Math.min(1, Math.hypot(Number(point?.x) || 0, Number(point?.y) || 0));
  return Math.round(distance * 10);
}

export function renderKaleidoscope(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};

  let unit = createUnit({ motorLevel: settings.motorLevel });
  let disposed = false;
  let finishing = false;
  let idleTimer = null;
  let cancelFinale = null;
  let current = null;
  let activePointer = null;
  let lastSmoothed = null;
  let lastNoteAt = 0;
  let strokeSeed = 0;
  let frameId = 0;
  let size = { width: 0, height: 0, ratio: 1 };
  const timers = new Set();
  const strokes = [];
  const drewPointers = new Set();

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
  board.className = 'kaleidoscope-board';

  const sheet = document.createElement('div');
  sheet.className = 'kaleidoscope-sheet';

  const canvas = document.createElement('canvas');
  canvas.className = 'kaleidoscope-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  sheet.append(canvas);
  board.append(sheet);
  stage.append(board);

  const context = canvas.getContext('2d');

  function sizeSheet() {
    const rect = board.getBoundingClientRect();
    const width = rect.width || window.innerWidth || 1;
    const height = rect.height || width;
    const side = Math.max(180, Math.min(width, height));
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    sheet.style.width = `${Math.round(side)}px`;
    sheet.style.height = `${Math.round(side)}px`;
    canvas.width = Math.max(1, Math.round(side * ratio));
    canvas.height = Math.max(1, Math.round(side * ratio));
    size = { width: side, height: side, ratio };
    ensureLoop();
  }

  function unitPoint(clientX, clientY) {
    const rect = sheet.getBoundingClientRect();
    return clampToDisc(toUnitPoint({ x: clientX, y: clientY }, rect));
  }

  function clientPoint(point) {
    const rect = sheet.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + point.x * (rect.width / 2),
      y: rect.top + rect.height / 2 + point.y * (rect.height / 2),
    };
  }

  function addStroke(point, now = performance.now()) {
    const stroke = {
      points: [point],
      width: unit.strokeWidth,
      seed: strokeSeed,
      phase: strokeSeed * 47,
      bornAt: now,
    };
    strokeSeed += 1;
    strokes.push(stroke);
    if (strokes.length > MAX_STROKES) strokes.splice(0, strokes.length - MAX_STROKES);
    current = stroke;
    lastSmoothed = point;
    ensureLoop();
    return stroke;
  }

  function drawStroke(stroke, alpha) {
    if (!context || !stroke.points.length || size.width <= 0) return;
    const half = size.width / 2;
    const transforms = symmetryTransforms({ arms: unit.symmetry, mirrored: unit.mirrored });
    const points = stroke.points;

    context.save();
    context.globalAlpha = alpha;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.shadowColor = 'rgba(255, 255, 255, 0.45)';
    context.shadowBlur = Math.max(8, stroke.width * 0.7);

    if (points.length === 1) {
      const radius = Math.max(5, stroke.width * 0.55);
      for (const transform of transforms) {
        const point = transformPoint(points[0], transform);
        context.beginPath();
        context.arc(half + point.x * half, half + point.y * half, radius, 0, Math.PI * 2);
        context.fillStyle = colourFor(stroke.seed, 0, stroke.phase);
        context.fill();
      }
    } else {
      for (const transform of transforms) {
        for (let index = 1; index < points.length; index += 1) {
          const from = transformPoint(points[index - 1], transform);
          const to = transformPoint(points[index], transform);
          context.beginPath();
          context.moveTo(half + from.x * half, half + from.y * half);
          context.lineTo(half + to.x * half, half + to.y * half);
          context.strokeStyle = colourFor(stroke.seed, index, stroke.phase);
          context.lineWidth = stroke.width;
          context.stroke();
        }
      }
    }
    context.restore();
  }

  function drawFrame(now) {
    frameId = 0;
    if (disposed || !context || size.width <= 0) return;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);

    const time = Number(now) || performance.now();
    for (let index = strokes.length - 1; index >= 0; index -= 1) {
      const stroke = strokes[index];
      const alpha = fadeAlpha(time - stroke.bornAt);
      if (alpha <= 0.01 && stroke !== current) {
        strokes.splice(index, 1);
        continue;
      }
      if (alpha > 0.01) drawStroke(stroke, alpha);
    }

    if (strokes.length > 0) ensureLoop();
  }

  function ensureLoop() {
    if (!disposed && !frameId) frameId = window.requestAnimationFrame(drawFrame);
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
    current = null;
    say('151');

    sheet.classList.add('is-framed');
    later(() => sheet.classList.add('is-turning'), 120);

    const results = unitResults(unit);
    cancelFinale = finale(stage, audio(), {
      element: sheet,
      colors: FINALE_COLORS,
      holdMs: FINALE_HOLD_MS,
      bursts: 4,
      onDone: () => {
        say('152');
        if (!disposed && typeof settings.onSuccess === 'function') settings.onSuccess({ results });
      },
    });
  }

  // After a long idle the app finishes the picture itself, slowly, and never nags.
  function autoFinish() {
    if (disposed || finishing) return;
    const step = autoStamp(unit);
    unit = step.unit;
    if (step.stamp) {
      addStroke(step.stamp);
      const at = clientPoint(step.stamp);
      sparkle(stage, at.x, at.y, {
        count: 8,
        colors: STAMP_COLORS,
        speed: 55,
        lifeMs: 1500,
        size: 2.6,
        gravity: 20,
      });
      playStep(audio(), stepFor(step.stamp), { gain: 0.04, duration: 0.5 });
    }
    if (step.done || isDone(unit)) finish();
    else later(autoFinish, AUTO_STEP_MS);
  }

  function answer(point, clientX, clientY) {
    const step = stepFor(point);
    poke(stage, clientX, clientY, audio(), { step, gain: 0.06 });
    sparkle(stage, clientX, clientY, {
      count: 7,
      colors: STAMP_COLORS,
      speed: 70,
      lifeMs: 1100,
      size: 2.8,
      gravity: 25,
    });
  }

  function onTap(tap) {
    if (disposed || finishing) return;
    restartIdle();
    if (drewPointers.delete(tap.pointerId)) return;

    // 1. Every accepted touch answers at once, before anything else is drawn.
    const point = unitPoint(tap.x, tap.y);
    answer(point, tap.x, tap.y);

    // 2. Then the stamp joins the picture; the unit may be complete.
    const result = stampUnit(unit, point);
    unit = result.unit;
    addStroke(result.stamp);
    if (result.done) finish();
  }

  function onSegment(segment) {
    if (disposed || finishing) return;
    restartIdle();
    activePointer = segment.pointerId;
    drewPointers.add(segment.pointerId);

    const to = unitPoint(segment.x1, segment.y1);
    const from = unitPoint(segment.x0, segment.y0);

    if (segment.first) {
      // 1. The first piece of a drag answers at once, wherever the finger went down.
      answer(from, segment.x0, segment.y0);
      // A new piece after a break (second finger, or a trip outside the safe margin) is
      // not joined to the old stroke.
      if (!current || current.points.length > 1) addStroke(from);
    } else if (!current) {
      addStroke(from);
    }

    const smoothed = smoothPoint(lastSmoothed, to, 0.42);
    const previous = lastSmoothed || smoothed;
    if (Math.hypot(smoothed.x - previous.x, smoothed.y - previous.y) < MIN_POINT_STEP) return;

    const result = segmentUnit(unit, {
      x0: previous.x,
      y0: previous.y,
      x1: smoothed.x,
      y1: smoothed.y,
    });
    if (!result.drew) return;

    unit = result.unit;
    current.points.push(smoothed);
    current.bornAt = performance.now();
    lastSmoothed = smoothed;

    if (performance.now() - lastNoteAt > NOTE_GAP_MS) {
      lastNoteAt = performance.now();
      playStep(audio(), stepFor(smoothed), { gain: 0.032, duration: 0.26 });
    }

    if (result.done) finish();
  }

  function onEnd(summary) {
    drewPointers.delete(summary?.pointerId);
    // A resting palm, or a second finger, must not end the stroke being drawn.
    if (summary?.spoiled) return;
    if (activePointer !== null && summary?.pointerId !== activePointer) return;
    if (disposed || finishing) return;
    restartIdle();
    playStep(audio(), 5 + (unit.stamps % 4), { gain: 0.055, duration: 0.8 });
    activePointer = null;
    current = null;
    lastSmoothed = null;
  }

  const detachTouch = attachTouch(board, { onTap, onSegment, onEnd });
  window.addEventListener('resize', sizeSheet);
  sizeSheet();
  restartIdle();
  say('150');

  return function cleanup() {
    disposed = true;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    if (cancelFinale) cancelFinale();
    detachTouch();
    window.removeEventListener('resize', sizeSheet);
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = 0;
    strokes.length = 0;
    drewPointers.clear();
    current = null;
    activePointer = null;
    lastSmoothed = null;
    sheet.classList.remove('is-framed', 'is-turning');
  };
}
