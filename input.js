// Shared touch input for toy games (see DEV_GUIDE.md).
//
//   nearestTarget()       "touch anywhere acts on the nearest live target" (M1) and
//                         "touch near counts" (M2), with the miss distance for adaptation
//   assistRadius()        the usual M1 / M2 / M3 reach for a target of a given radius
//   createTouchTracker()  pure: turns pointer events into taps and rub / drag path
//                         segments with speed, following ONE moving pointer and ignoring a
//                         resting palm
//   attachTouch()         the DOM wiring around the tracker; games call this
//
// All coordinates are client pixels (event.clientX / clientY), the same as fx.js expects.
// Everything except attachTouch() and toLocal() is pure and unit-tested.

import {
  MIN_TOUCH_DURATION_MS,
  SAFE_MARGIN,
  isSingleTouch,
  isWithinSafeArea,
  shouldAcceptGameTouch,
} from './touch.js';

// ---------------------------------------------------------------------------------
// Nearest-target assist
// ---------------------------------------------------------------------------------

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// points:  [{ x, y, r?, live? }, ...]  centre, optional radius, live === false is skipped
// touch:   { x, y }
// maxDist: how far from a target's CENTRE a touch may be and still count. A number, or a
//          function (point) => number for per-target reach. Default: no limit.
//
// Returns:
//   target        the nearest live point if it is within maxDist, else null
//   index         its index in points, or -1
//   nearest       the nearest live point even when it is out of reach (make it wink)
//   nearestIndex  its index, or -1
//   distance      centre distance to the nearest live point, or null when there is none
//   missDistance  how far outside that point's edge the touch landed (0 = inside it);
//                 log this for adaptation, or null when there is no live point
export function nearestTarget(points, touch, maxDist = Infinity) {
  const none = { target: null, index: -1, nearest: null, nearestIndex: -1, distance: null, missDistance: null };
  const tx = finite(touch?.x);
  const ty = finite(touch?.y);
  if (!Array.isArray(points) || tx === null || ty === null) return none;

  let best = -1;
  let bestDistance = Infinity;
  points.forEach((point, index) => {
    if (!point || point.live === false) return;
    const px = finite(point.x);
    const py = finite(point.y);
    if (px === null || py === null) return;
    const distance = Math.hypot(px - tx, py - ty);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  if (best < 0) return none;

  const nearest = points[best];
  const radius = Math.max(0, finite(nearest.r) ?? 0);
  const limit = typeof maxDist === 'function' ? maxDist(nearest) : maxDist;
  const reach = limit === undefined || limit === null || Number.isNaN(Number(limit)) ? Infinity : Number(limit);
  const within = bestDistance <= reach;

  return {
    target: within ? nearest : null,
    index: within ? best : -1,
    nearest,
    nearestIndex: best,
    distance: bestDistance,
    missDistance: Math.max(0, bestDistance - radius),
  };
}

// The standard motor ladder for a round target of `radius`:
//   M1 touch anywhere (no limit), M2 touch near (nearFactor x radius), M3+ touch inside.
export function assistRadius(motorLevel, radius, { nearFactor = 2 } = {}) {
  const level = Math.round(Number(motorLevel) || 1);
  const size = Math.max(0, finite(radius) ?? 0);
  if (level <= 1) return Infinity;
  if (level === 2) return size * Math.max(1, finite(nearFactor) ?? 2);
  return size;
}

// ---------------------------------------------------------------------------------
// Continuous touch: taps and rub / drag paths
// ---------------------------------------------------------------------------------

export const REST_MS = 350;
export const REST_RADIUS_PX = 14;
export const MIN_SEGMENT_PX = 3;

// Pure tracker. Feed it every pointer event on the page; it follows one pointer.
//
// The multi-touch rule is the one in touch.js (isSingleTouch): a touch only counts while
// it is the single live pointer. One addition for palms: a pointer that has been down for
// restMs without moving more than restRadius is "resting" and is not counted, so a hand
// lying on the glass does not block the finger that plays. Two fingers landing together
// are still both rejected, exactly as before.
//
// options:
//   getViewport   () => ({ width, height }) for the safe-margin check (required in tests)
//   margin        safe margin in px (default SAFE_MARGIN)
//   minTouchMs    shortest press that counts as a tap (default MIN_TOUCH_DURATION_MS)
//   restMs, restRadius, minSegment   see the constants above
//   palmSize      contact width or height in px from which a pointer is treated as a palm
//                 at once (0 = off, the default; pointer sizes vary a lot between tablets)
export function createTouchTracker(options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const getViewport =
    typeof settings.getViewport === 'function' ? settings.getViewport : () => ({ width: 0, height: 0 });
  const margin = finite(settings.margin) ?? SAFE_MARGIN;
  const minTouchMs = finite(settings.minTouchMs) ?? MIN_TOUCH_DURATION_MS;
  const restMs = Math.max(0, finite(settings.restMs) ?? REST_MS);
  const restRadius = Math.max(0, finite(settings.restRadius) ?? REST_RADIUS_PX);
  const minSegment = Math.max(0, finite(settings.minSegment) ?? MIN_SEGMENT_PX);
  const palmSize = Math.max(0, finite(settings.palmSize) ?? 0);

  const pointers = new Map();

  function safe(x, y) {
    return isWithinSafeArea({ x, y }, getViewport(), margin);
  }

  function isResting(pointer, t) {
    if (pointer.palm) return true;
    return t - pointer.downAt >= restMs && pointer.travel < restRadius;
  }

  // How many pointers count as live touches right now, as seen from `pointer`: itself
  // plus every other pointer that is not resting.
  function liveCount(pointer, t) {
    let count = 1;
    for (const other of pointers.values()) {
      if (other !== pointer && !isResting(other, t)) count += 1;
    }
    return count;
  }

  function down({ id, x, y, t = 0, eligible = true, width = 0, height = 0 } = {}) {
    const px = finite(x) ?? 0;
    const py = finite(y) ?? 0;
    const pointer = {
      id,
      startX: px,
      startY: py,
      x: px,
      y: py,
      fromX: px,
      fromY: py,
      fromT: t,
      downAt: t,
      travel: 0,
      pathLength: 0,
      segments: 0,
      broken: false,
      spoiled: false,
      palm: palmSize > 0 && Math.max(finite(width) ?? 0, finite(height) ?? 0) >= palmSize,
      eligible: eligible === true && safe(px, py),
    };
    // Whatever was already down can no longer be a clean tap (so lifting a resting palm
    // after playing does nothing). A drag that was under way carries on once this new
    // pointer lifts or comes to rest.
    for (const other of pointers.values()) other.spoiled = true;
    pointers.set(id, pointer);
    if (!isSingleTouch(liveCount(pointer, t))) pointer.spoiled = true;
    // True when this press may become a tap or a path: good for instant "press in" feedback.
    return pointer.eligible && !pointer.spoiled && !pointer.palm;
  }

  function move({ id, x, y, t = 0 } = {}) {
    const pointer = pointers.get(id);
    if (!pointer) return null;
    const px = finite(x) ?? pointer.x;
    const py = finite(y) ?? pointer.y;
    pointer.x = px;
    pointer.y = py;
    pointer.travel = Math.max(pointer.travel, Math.hypot(px - pointer.startX, py - pointer.startY));
    if (!pointer.eligible || pointer.palm) return null;

    const restart = () => {
      pointer.fromX = px;
      pointer.fromY = py;
      pointer.fromT = t;
      pointer.broken = true;
    };

    if (!isSingleTouch(liveCount(pointer, t))) {
      pointer.spoiled = true;
      restart();
      return null;
    }
    if (!safe(px, py)) {
      restart();
      return null;
    }

    const dx = px - pointer.fromX;
    const dy = py - pointer.fromY;
    const length = Math.hypot(dx, dy);
    if (length < minSegment || length === 0) return null;

    const dt = Math.max(1, t - pointer.fromT);
    const segment = {
      pointerId: id,
      x0: pointer.fromX,
      y0: pointer.fromY,
      x1: px,
      y1: py,
      dx,
      dy,
      length,
      dt,
      speed: (length / dt) * 1000, // px per second
      t,
      // true for the first piece of a stroke, and for the first piece after a break
      // (second finger, or a trip outside the safe margin): do not join it to the last.
      first: pointer.segments === 0 || pointer.broken,
      pathLength: pointer.pathLength + length,
    };
    pointer.pathLength = segment.pathLength;
    pointer.segments += 1;
    pointer.broken = false;
    pointer.fromX = px;
    pointer.fromY = py;
    pointer.fromT = t;
    return segment;
  }

  function up({ id, x, y, t = 0 } = {}) {
    const pointer = pointers.get(id);
    if (!pointer) return { tap: null, end: null };
    const px = finite(x) ?? pointer.x;
    const py = finite(y) ?? pointer.y;
    if (!isSingleTouch(liveCount(pointer, t))) pointer.spoiled = true;
    pointers.delete(id);
    if (!pointer.eligible || pointer.palm) return { tap: null, end: null };

    const duration = Math.max(0, t - pointer.downAt);
    const summary = {
      pointerId: id,
      x: px,
      y: py,
      startX: pointer.startX,
      startY: pointer.startY,
      duration,
      travel: pointer.travel,
      pathLength: pointer.pathLength,
      averageSpeed: duration > 0 ? (pointer.pathLength / duration) * 1000 : 0,
      spoiled: pointer.spoiled,
    };
    const accepted = shouldAcceptGameTouch({
      start: { x: pointer.startX, y: pointer.startY },
      viewport: getViewport(),
      startedAt: pointer.downAt,
      endedAt: t,
      pointerCount: pointer.spoiled ? 2 : 1,
      margin,
      minimumDurationMs: minTouchMs,
    });
    return { tap: accepted ? summary : null, end: summary };
  }

  function cancel(id) {
    pointers.delete(id);
  }

  function reset() {
    pointers.clear();
  }

  return { down, move, up, cancel, reset, size: () => pointers.size };
}

// Client point -> point relative to an element's top-left corner.
export function toLocal(element, point) {
  const rect = element.getBoundingClientRect();
  return { x: point.x - rect.left, y: point.y - rect.top };
}

// DOM wiring. Listens on the window so that palms and stray fingers outside `element` are
// seen too; only presses that START on `element` (inside the safe margin) produce events.
//
// handlers (all optional, all get client coordinates):
//   onDown({ x, y, pointerId })   at once on an acceptable press: use for "press in"
//   onSegment(segment)            one piece of a rub / drag path (see createTouchTracker)
//   onTap(tap)                    on release of an accepted touch: { x, y, startX, startY,
//                                 duration, travel, pathLength, ... }. A shaky tap has
//                                 travel; for tap toys act at startX / startY or x / y,
//                                 never reject it for moving.
//   onEnd(summary)                on every release of a press that started on the element
// Returns a function that removes the listeners: call it from the game's cleanup.
export function attachTouch(element, handlers = {}, options = {}) {
  const tracker = createTouchTracker({
    getViewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    ...options,
  });
  const call = (name, value) => {
    if (typeof handlers[name] !== 'function') return;
    try {
      handlers[name](value);
    } catch (error) {
      console.error(error);
    }
  };
  const now = () => performance.now();

  function onDown(event) {
    const primary = event.pointerType !== 'mouse' || event.button === 0;
    const eligible = primary && element.contains(event.target);
    const ok = tracker.down({
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      t: now(),
      eligible,
      width: event.width,
      height: event.height,
    });
    if (ok) call('onDown', { x: event.clientX, y: event.clientY, pointerId: event.pointerId });
  }

  function onMove(event) {
    const segment = tracker.move({ id: event.pointerId, x: event.clientX, y: event.clientY, t: now() });
    if (segment) call('onSegment', segment);
  }

  function onUp(event) {
    const { tap, end } = tracker.up({ id: event.pointerId, x: event.clientX, y: event.clientY, t: now() });
    if (tap) call('onTap', tap);
    if (end) call('onEnd', end);
  }

  function onCancel(event) {
    tracker.cancel(event.pointerId);
  }

  function onReset() {
    tracker.reset();
  }

  const capture = { capture: true, passive: true };
  window.addEventListener('pointerdown', onDown, capture);
  window.addEventListener('pointermove', onMove, capture);
  window.addEventListener('pointerup', onUp, capture);
  window.addEventListener('pointercancel', onCancel, capture);
  window.addEventListener('blur', onReset);

  return function detach() {
    window.removeEventListener('pointerdown', onDown, { capture: true });
    window.removeEventListener('pointermove', onMove, { capture: true });
    window.removeEventListener('pointerup', onUp, { capture: true });
    window.removeEventListener('pointercancel', onCancel, { capture: true });
    window.removeEventListener('blur', onReset);
    tracker.reset();
  };
}
