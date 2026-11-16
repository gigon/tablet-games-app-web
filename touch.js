export const SAFE_MARGIN = 64;
export const MIN_TOUCH_DURATION_MS = 40;

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function isWithinSafeArea(point, viewport, margin = SAFE_MARGIN) {
  const x = toFiniteNumber(point?.x);
  const y = toFiniteNumber(point?.y);
  const width = toFiniteNumber(viewport?.width);
  const height = toFiniteNumber(viewport?.height);
  const inset = toFiniteNumber(margin);

  if (x === null || y === null || width === null || height === null || inset === null) {
    return false;
  }

  const safeInset = Math.max(0, inset);
  if (width <= safeInset * 2 || height <= safeInset * 2) return false;

  return (
    x >= safeInset &&
    x <= width - safeInset &&
    y >= safeInset &&
    y <= height - safeInset
  );
}

export function touchDuration(startedAt, endedAt) {
  const start = toFiniteNumber(startedAt);
  const end = toFiniteNumber(endedAt);
  if (start === null || end === null) return 0;
  return Math.max(0, end - start);
}

export function isTouchDurationValid(
  startedAt,
  endedAt,
  minimumDurationMs = MIN_TOUCH_DURATION_MS,
) {
  const minimum = toFiniteNumber(minimumDurationMs);
  const threshold = minimum === null ? MIN_TOUCH_DURATION_MS : Math.max(0, minimum);
  return touchDuration(startedAt, endedAt) >= threshold;
}

export function isSingleTouch(pointerCount) {
  return toFiniteNumber(pointerCount) === 1;
}

export function shouldAcceptGameTouch({
  start,
  viewport,
  startedAt,
  endedAt,
  pointerCount = 1,
  margin = SAFE_MARGIN,
  minimumDurationMs = MIN_TOUCH_DURATION_MS,
} = {}) {
  return (
    isSingleTouch(pointerCount) &&
    isWithinSafeArea(start, viewport, margin) &&
    isTouchDurationValid(startedAt, endedAt, minimumDurationMs)
  );
}
