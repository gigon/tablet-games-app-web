import {
  LAUNDRY_COLORS,
  MAX_MOTOR_LEVEL,
  MIN_MOTOR_LEVEL,
  addItemToMachine,
  createItem,
  createMachine,
  generateItem,
  isMachineFull,
  motorHitTest,
  ruleAcceptsItem,
  washMachine,
} from './laundry-logic.js';
import {
  formatLaundryPrompt,
  laundryItemName,
  normalizeGender,
  normalizeLanguage,
} from './i18n.js';
import {
  MIN_TOUCH_DURATION_MS,
  SAFE_MARGIN,
  isTouchDurationValid,
  isWithinSafeArea,
} from './touch.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FLIGHT_MS = 700;
const SHAKE_MS = 520;
const DOOR_CLOSE_MS = 460;
const WASH_MS = 3000;
const RESET_PAUSE_MS = 650;
const NEXT_ITEM_PAUSE_MS = 1000;
const MAX_RULE_LEVEL = 3;
export const MOTOR_FAILURE_DEBOUNCE_MS = 1500;

export function shouldReportBoardMotorFailure(options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  if (source.motorLevel !== 4) return false;
  if (source.multiTouch === true) return false;
  if (source.safe === false) return false;
  if (source.durationValid === false) return false;

  const now = Number(source.now);
  if (!Number.isFinite(now)) return false;

  const last = Number(source.lastFailureAt);
  if (Number.isFinite(last) && now - last < MOTOR_FAILURE_DEBOUNCE_MS) return false;
  return true;
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function nextItemForRule(ruleLevel, rng = Math.random) {
  const level = clamp(ruleLevel, 1, MAX_RULE_LEVEL);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const item = generateItem(rng);
    if (ruleAcceptsItem(level, item)) return item;
  }
  if (level === 3) return createItem('sock', 'blue');
  if (level === 2) return createItem('shirt', 'blue');
  return createItem('shirt', 'white');
}

function svgElement(tag, attributes = {}, children = []) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    element.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (typeof child === 'string') element.append(document.createTextNode(child));
    else if (child) element.append(child);
  }
  return element;
}

function itemPalette(item) {
  const entry = LAUNDRY_COLORS[item.color] || LAUNDRY_COLORS.white;
  return {
    fill: entry.hex,
    outline: entry.dark ? '#dcecff' : '#102234',
  };
}

function shirtGraphic(fill, outline) {
  return svgElement('g', {}, [
    svgElement('path', {
      d: 'M42 20 L54 10 Q60 20 66 10 L78 20 L104 42 L88 58 L78 48 L78 108 Q60 116 42 108 L42 48 L32 58 L16 42 Z',
      fill,
      stroke: outline,
      'stroke-width': 5,
      'stroke-linejoin': 'round',
    }),
    svgElement('path', {
      d: 'M54 10 Q60 24 66 10',
      fill: 'none',
      stroke: outline,
      'stroke-width': 5,
      'stroke-linecap': 'round',
    }),
    svgElement('path', {
      d: 'M48 102 Q60 96 72 102',
      fill: 'none',
      stroke: outline,
      'stroke-width': 4,
      'stroke-linecap': 'round',
      opacity: 0.5,
    }),
  ]);
}

function sockGraphic(fill, outline) {
  return svgElement('g', {}, [
    svgElement('path', {
      d: 'M38 12 H70 V62 Q70 70 78 77 L93 89 Q106 99 97 110 Q86 120 72 109 L48 89 Q38 81 38 66 Z',
      fill,
      stroke: outline,
      'stroke-width': 5,
      'stroke-linejoin': 'round',
    }),
    svgElement('path', {
      d: 'M38 24 H70',
      fill: 'none',
      stroke: outline,
      'stroke-width': 5,
      opacity: 0.8,
    }),
    svgElement('path', {
      d: 'M84 92 Q91 95 94 102',
      fill: 'none',
      stroke: outline,
      'stroke-width': 4,
      'stroke-linecap': 'round',
      opacity: 0.5,
    }),
  ]);
}

function towelGraphic(fill, outline) {
  return svgElement('g', {}, [
    svgElement('rect', {
      x: 24,
      y: 16,
      width: 72,
      height: 92,
      rx: 8,
      fill,
      stroke: outline,
      'stroke-width': 5,
    }),
    svgElement('path', {
      d: 'M34 36 H86 M34 74 H86',
      fill: 'none',
      stroke: outline,
      'stroke-width': 4,
      'stroke-linecap': 'round',
      opacity: 0.55,
    }),
    svgElement('path', {
      d: 'M34 96 Q60 88 86 96',
      fill: 'none',
      stroke: outline,
      'stroke-width': 3,
      'stroke-linecap': 'round',
      opacity: 0.4,
    }),
  ]);
}

function itemGraphic(item) {
  const { fill, outline } = itemPalette(item);
  if (item.kind === 'sock') return sockGraphic(fill, outline);
  if (item.kind === 'towel') return towelGraphic(fill, outline);
  return shirtGraphic(fill, outline);
}

function machineGraphic() {
  const group = svgElement('g');
  const drum = svgElement('g', { class: 'laundry-drum' }, [
    svgElement('circle', { cx: 140, cy: 210, r: 69, fill: '#123650' }),
    svgElement('path', {
      d: 'M78 210 Q140 148 202 210',
      fill: 'none',
      stroke: '#5aa6c7',
      'stroke-width': 9,
      'stroke-linecap': 'round',
      opacity: 0.8,
    }),
    svgElement('path', {
      d: 'M86 238 Q140 190 194 238',
      fill: 'none',
      stroke: '#3d7f9f',
      'stroke-width': 7,
      'stroke-linecap': 'round',
      opacity: 0.65,
    }),
  ]);
  const load = svgElement('g', { class: 'laundry-load' });
  const door = svgElement('g', { class: 'laundry-door' }, [
    svgElement('circle', {
      cx: 140,
      cy: 210,
      r: 90,
      fill: 'none',
      stroke: '#9bb0c1',
      'stroke-width': 12,
    }),
    svgElement('rect', {
      x: 220,
      y: 196,
      width: 17,
      height: 28,
      rx: 7,
      fill: '#6d8497',
      stroke: '#23394c',
      'stroke-width': 3,
    }),
  ]);

  group.append(
    svgElement('rect', {
      x: 26,
      y: 16,
      width: 228,
      height: 308,
      rx: 30,
      fill: '#e8eef5',
      stroke: '#0b1d2c',
      'stroke-width': 7,
    }),
    svgElement('rect', {
      x: 44,
      y: 34,
      width: 192,
      height: 56,
      rx: 14,
      fill: '#c5d3df',
      stroke: '#31495d',
      'stroke-width': 4,
    }),
    svgElement('circle', { cx: 76, cy: 62, r: 15, fill: '#f8fbff', stroke: '#31495d', 'stroke-width': 4 }),
    svgElement('rect', { x: 108, y: 48, width: 56, height: 28, rx: 8, fill: '#2e4a60' }),
    svgElement('circle', { cx: 200, cy: 62, r: 13, fill: '#ffd43b', stroke: '#31495d', 'stroke-width': 4 }),
    svgElement('rect', {
      x: 49,
      y: 104,
      width: 182,
      height: 202,
      rx: 24,
      fill: '#d7e1ea',
      stroke: '#31495d',
      'stroke-width': 5,
    }),
    drum,
    load,
    door,
  );

  return { graphic: group, drum, load, door };
}

function nowSafe(point) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return isWithinSafeArea(point, { width, height }, SAFE_MARGIN);
}

function safeRandom(rng) {
  return typeof rng === 'function' ? rng : Math.random;
}

function stopScheduled(timers) {
  for (const timer of timers) window.clearTimeout(timer);
  timers.clear();
}

function washNoise(context, duration) {
  try {
    const sampleRate = context.sampleRate || 44100;
    const frames = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = context.createBuffer(1, frames, sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < frames; index += 1) {
      data[index] = (Math.random() * 2 - 1) * 0.7;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(460, context.currentTime);
    filter.frequency.linearRampToValueAtTime(260, context.currentTime + duration);
    filter.Q.setValueAtTime(0.8, context.currentTime);

    const gain = context.createGain();
    const start = context.currentTime;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.11, start + 0.2);
    gain.gain.setValueAtTime(0.1, start + duration - 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(start);
    source.stop(start + duration + 0.05);
  } catch {
    /* Sound is an enhancement. */
  }
}

function washThumps(context, duration) {
  try {
    for (let at = 0.3; at < duration; at += 0.56) {
      const start = context.currentTime + at;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(82, start);
      oscillator.frequency.exponentialRampToValueAtTime(46, start + 0.2);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.26);
    }
  } catch {
    /* Sound is an enhancement. */
  }
}

function chime(context) {
  try {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((frequency, index) => {
      const start = context.currentTime + index * 0.11;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.52);
    });
  } catch {
    /* Sound is an enhancement. */
  }
}

export function renderLaundry(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const language = normalizeLanguage(settings.language);
  const gender = normalizeGender(settings.gender);
  const name = typeof settings.name === 'string' ? settings.name : '';
  const showTextLabels = settings.showTextLabels === true;
  const rng = safeRandom(settings.rng);

  let motorLevel = clamp(settings.motorLevel, MIN_MOTOR_LEVEL, MAX_MOTOR_LEVEL);
  let ruleLevel = clamp(settings.ruleLevel, 1, MAX_RULE_LEVEL);
  let machine = createMachine(rng);
  if (Number.isFinite(Number(settings.capacity))) {
    const capacity = clamp(settings.capacity, 3, 4);
    machine = { ...machine, capacity };
  }

  const timers = new Set();
  const activePointers = new Set();
  const loadColors = [];
  let disposed = false;
  let busy = false;
  let currentItem = null;
  let currentItemElement = null;
  let tap = null;
  let drag = null;
  let multiTouch = false;
  let lastBoardMotorFailureAt = -Infinity;

  function later(callback, delay) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function readLevels() {
    const source =
      typeof settings.getLevels === 'function' ? settings.getLevels() : null;
    if (source && Number.isFinite(Number(source.motorLevel))) {
      motorLevel = clamp(source.motorLevel, MIN_MOTOR_LEVEL, MAX_MOTOR_LEVEL);
    } else if (Number.isFinite(Number(settings.motorLevel))) {
      motorLevel = clamp(settings.motorLevel, MIN_MOTOR_LEVEL, MAX_MOTOR_LEVEL);
    }
    if (source && Number.isFinite(Number(source.ruleLevel))) {
      ruleLevel = clamp(source.ruleLevel, 1, MAX_RULE_LEVEL);
    }
    return { motorLevel, ruleLevel };
  }

  function labelFor(item) {
    if (typeof settings.itemLabel === 'function') return settings.itemLabel(item);
    return laundryItemName(language, item.kind);
  }

  function promptFor(item) {
    if (typeof settings.promptForItem === 'function') return settings.promptForItem(item);
    if (typeof settings.promptFor === 'function') return settings.promptFor(item);
    return formatLaundryPrompt({ language, gender, name, kind: item.kind });
  }

  function audioContext() {
    try {
      if (typeof settings.getAudioContext === 'function') {
        return settings.getAudioContext() || null;
      }
      return settings.audioContext || null;
    } catch {
      return null;
    }
  }

  function onPointerDown(event) {
    activePointers.add(event.pointerId);
    if (activePointers.size > 1) multiTouch = true;
  }

  function onPointerUp(event) {
    activePointers.delete(event.pointerId);
    if (activePointers.size === 0) multiTouch = false;
  }

  function point(event) {
    return { x: event.clientX, y: event.clientY };
  }

  function shake(element) {
    if (!element) return;
    element.classList.remove('is-shaking');
    void element.getBoundingClientRect();
    element.classList.add('is-shaking');
    later(() => element.classList.remove('is-shaking'), SHAKE_MS);
  }

  function itemGeometry() {
    if (!currentItemElement) return null;
    const rect = currentItemElement.getBoundingClientRect();
    return {
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      radius: Math.min(rect.width, rect.height) / 2,
      bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    };
  }

  function machineZone() {
    const rect = machineZoneElement.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }

  function flyToMachine(element, baseX, baseY, done) {
    const itemRect = element.getBoundingClientRect();
    const target = machineZoneElement.getBoundingClientRect();
    const dx = target.left + target.width / 2 - (itemRect.left + itemRect.width / 2);
    const dy = target.top + target.height / 2 - (itemRect.top + itemRect.height / 2);
    element.classList.remove('is-dragging');
    element.style.transition = `transform ${FLIGHT_MS}ms cubic-bezier(.35, 0, .25, 1), opacity ${FLIGHT_MS}ms ease-in`;
    element.style.transform = `translate(${baseX + dx}px, ${baseY + dy}px) scale(0.22) rotate(18deg)`;
    element.style.opacity = '0.15';
    later(done, FLIGHT_MS);
  }

  function snapBack(element) {
    element.classList.remove('is-dragging');
    element.style.transition = 'transform 260ms ease-out';
    element.style.transform = '';
    element.style.opacity = '';
    later(() => {
      element.style.transition = '';
    }, 310);
  }

  function renderLoad() {
    machineParts.load.replaceChildren();
    const positions = [
      [116, 194],
      [146, 186],
      [164, 214],
      [130, 226],
    ];
    loadColors.slice(0, positions.length).forEach((color, index) => {
      const fill = LAUNDRY_COLORS[color]?.hex || LAUNDRY_COLORS.white.hex;
      machineParts.load.append(
        svgElement('circle', {
          cx: positions[index][0],
          cy: positions[index][1],
          r: 15,
          fill,
          stroke: '#0c2233',
          'stroke-width': 3,
        }),
      );
    });
  }

  function startWash() {
    busy = true;
    machineElement.classList.add('is-closed');
    later(() => {
      machineElement.classList.add('is-washing');
      const context = audioContext();
      if (context) {
        if (context.state === 'suspended' && typeof context.resume === 'function') {
          context.resume().catch(() => {});
        }
        washNoise(context, WASH_MS / 1000);
        washThumps(context, WASH_MS / 1000);
      }
      later(() => {
        machineElement.classList.remove('is-washing');
        machine = washMachine(machine, rng);
        loadColors.length = 0;
        renderLoad();
        const doneContext = audioContext();
        if (doneContext) chime(doneContext);
        if (typeof settings.onCycleComplete === 'function') {
          settings.onCycleComplete({ washes: machine.washes, capacity: machine.capacity });
        }
        later(() => {
          if (disposed) return;
          machineElement.classList.remove('is-closed');
          busy = false;
          showNextItem();
        }, RESET_PAUSE_MS + 350);
      }, WASH_MS);
    }, DOOR_CLOSE_MS);
  }

  function completeItem(item) {
    machine = addItemToMachine(machine);
    loadColors.push(item.color);
    renderLoad();
    currentItem = null;
    if (currentItemElement) {
      currentItemElement.remove();
      currentItemElement = null;
    }
    if (isMachineFull(machine)) {
      startWash();
    } else {
      later(() => {
        if (disposed) return;
        busy = false;
        showNextItem();
      }, NEXT_ITEM_PAUSE_MS);
    }
  }

  function attemptAt(pointValue) {
    if (disposed || busy || !currentItem) return;
    const levels = readLevels();
    const geometry = itemGeometry();
    if (!geometry) return;
    const hit = motorHitTest(levels.motorLevel, {
      point: pointValue,
      item: geometry,
      machineZone: machineZone(),
    });

    if (!hit) {
      if (levels.motorLevel === 1) return;
      shake(currentItemElement);
      if (typeof settings.onFailure === 'function') {
        settings.onFailure({
          reason: 'motor',
          item: currentItem,
          motorLevel: levels.motorLevel,
          ruleLevel: levels.ruleLevel,
        });
      }
      return;
    }

    if (!ruleAcceptsItem(levels.ruleLevel, currentItem)) {
      shake(currentItemElement);
      if (typeof settings.onFailure === 'function') {
        settings.onFailure({
          reason: 'rule',
          item: currentItem,
          motorLevel: levels.motorLevel,
          ruleLevel: levels.ruleLevel,
        });
      }
      return;
    }

    busy = true;
    const item = currentItem;
    flyToMachine(currentItemElement, 0, 0, () => {
      if (disposed) return;
      if (typeof settings.onSuccess === 'function') {
        settings.onSuccess({
          reason: 'success',
          item,
          motorLevel: levels.motorLevel,
          ruleLevel: levels.ruleLevel,
        });
      }
      completeItem(item);
    });
  }

  function onBoardPointerDown(event) {
    if (disposed || busy || !currentItem) return;
    const levels = readLevels();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (activePointers.size > 1) {
      multiTouch = true;
      tap = null;
      return;
    }
    if (!nowSafe(point(event))) return;
    tap = {
      pointerId: event.pointerId,
      startedAt: performance.now(),
      motorLevel: levels.motorLevel,
    };
  }

  function onBoardPointerUp(event) {
    if (disposed || busy || !tap || tap.pointerId !== event.pointerId) return;
    const startedAt = tap.startedAt;
    const motorLevel = tap.motorLevel;
    tap = null;
    if (!currentItem) return;

    const now = performance.now();
    const safe = nowSafe(point(event));
    const durationValid = isTouchDurationValid(startedAt, now, MIN_TOUCH_DURATION_MS);

    if (motorLevel === 4) {
      if (
        shouldReportBoardMotorFailure({
          motorLevel,
          multiTouch,
          safe,
          durationValid,
          now,
          lastFailureAt: lastBoardMotorFailureAt,
        })
      ) {
        lastBoardMotorFailureAt = now;
        shake(currentItemElement);
        if (typeof settings.onFailure === 'function') {
          const levels = readLevels();
          settings.onFailure({
            reason: 'motor',
            item: currentItem,
            motorLevel: levels.motorLevel,
            ruleLevel: levels.ruleLevel,
          });
        }
      }
      return;
    }

    if (multiTouch) return;
    if (!safe) return;
    if (!durationValid) return;
    attemptAt(point(event));
  }

  function onBoardPointerCancel() {
    tap = null;
  }

  function onDragPointerDown(event) {
    if (disposed || busy || !currentItem || !currentItemElement) return;
    const levels = readLevels();
    if (levels.motorLevel !== 4) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (activePointers.size > 1) {
      multiTouch = true;
      drag = null;
      return;
    }
    if (!nowSafe(point(event))) return;
    event.preventDefault();
    event.stopPropagation();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
    };
    currentItemElement.classList.add('is-dragging');
    currentItemElement.style.transition = 'none';
    try {
      currentItemElement.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onDragPointerMove(event) {
    if (!drag || drag.pointerId !== event.pointerId || !currentItemElement) return;
    event.preventDefault();
    drag.dx = event.clientX - drag.startX;
    drag.dy = event.clientY - drag.startY;
    currentItemElement.style.transform = `translate(${drag.dx}px, ${drag.dy}px)`;
  }

  function onDragPointerUp(event) {
    if (!drag || drag.pointerId !== event.pointerId || !currentItemElement) return;
    event.preventDefault();
    const element = currentItemElement;
    try {
      element.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }

    const startedAt = drag.startedAt;
    const baseX = drag.dx || 0;
    const baseY = drag.dy || 0;
    drag = null;

    if (multiTouch || !isTouchDurationValid(startedAt, performance.now(), MIN_TOUCH_DURATION_MS)) {
      snapBack(element);
      return;
    }
    if (!nowSafe(point(event))) {
      snapBack(element);
      return;
    }

    const levels = readLevels();
    const hit = motorHitTest(4, {
      dragEnd: point(event),
      item: itemGeometry(),
      machineZone: machineZone(),
    });

    if (!hit) {
      snapBack(element);
      if (typeof settings.onFailure === 'function') {
        settings.onFailure({
          reason: 'motor',
          item: currentItem,
          motorLevel: levels.motorLevel,
          ruleLevel: levels.ruleLevel,
        });
      }
      return;
    }

    if (!ruleAcceptsItem(levels.ruleLevel, currentItem)) {
      snapBack(element);
      shake(element);
      if (typeof settings.onFailure === 'function') {
        settings.onFailure({
          reason: 'rule',
          item: currentItem,
          motorLevel: levels.motorLevel,
          ruleLevel: levels.ruleLevel,
        });
      }
      return;
    }

    busy = true;
    const item = currentItem;
    flyToMachine(element, baseX, baseY, () => {
      if (disposed) return;
      if (typeof settings.onSuccess === 'function') {
        settings.onSuccess({
          reason: 'success',
          item,
          motorLevel: levels.motorLevel,
          ruleLevel: levels.ruleLevel,
        });
      }
      completeItem(item);
    });
  }

  function onDragPointerCancel() {
    if (drag && currentItemElement) snapBack(currentItemElement);
    drag = null;
  }

  function buildItemElement(item) {
    const wrapper = document.createElement('div');
    wrapper.className = 'laundry-item';
    wrapper.dataset.kind = item.kind;
    wrapper.dataset.color = item.color;
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'button');
    wrapper.setAttribute('aria-label', labelFor(item));

    const graphic = svgElement('svg', {
      class: 'laundry-item-svg',
      viewBox: '0 0 120 120',
      role: 'img',
      'aria-hidden': 'true',
      focusable: 'false',
    }, [itemGraphic(item)]);

    wrapper.append(graphic);
    wrapper.addEventListener('pointerdown', onDragPointerDown);
    wrapper.addEventListener('pointermove', onDragPointerMove);
    wrapper.addEventListener('pointerup', onDragPointerUp);
    wrapper.addEventListener('pointercancel', onDragPointerCancel);
    return wrapper;
  }

  function showNextItem() {
    if (disposed) return;
    const levels = readLevels();
    const item = nextItemForRule(levels.ruleLevel, rng);
    currentItem = item;
    currentItemElement = buildItemElement(item);
    itemZone.replaceChildren(currentItemElement);

    const promptText = promptFor(item);
    if (promptElement) promptElement.textContent = promptText;
    if (typeof settings.onPrompt === 'function') settings.onPrompt(promptText, item);
    busy = false;
  }

  const board = document.createElement('div');
  board.className = 'laundry-board';

  const promptElement = showTextLabels ? document.createElement('p') : null;
  if (promptElement) promptElement.className = 'laundry-prompt';

  const itemZone = document.createElement('div');
  itemZone.className = 'laundry-item-zone';

  const machineZoneElement = document.createElement('div');
  machineZoneElement.className = 'laundry-machine-zone';

  const machineElement = document.createElement('div');
  machineElement.className = 'laundry-machine';
  const machineParts = machineGraphic();
  const machineSvg = svgElement('svg', {
    class: 'laundry-machine-svg',
    viewBox: '0 0 280 340',
    role: 'img',
    'aria-hidden': 'true',
    focusable: 'false',
  }, [machineParts.graphic]);
  machineElement.append(machineSvg);
  machineZoneElement.append(machineElement);

  board.append(itemZone, machineZoneElement);
  if (promptElement) stage.append(promptElement);
  stage.append(board);

  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  window.addEventListener('pointerup', onPointerUp, { capture: true, passive: true });
  window.addEventListener('pointercancel', onPointerUp, { capture: true, passive: true });
  board.addEventListener('pointerdown', onBoardPointerDown);
  board.addEventListener('pointerup', onBoardPointerUp);
  board.addEventListener('pointercancel', onBoardPointerCancel);

  showNextItem();

  return function cleanup() {
    disposed = true;
    stopScheduled(timers);
    window.removeEventListener('pointerdown', onPointerDown, { capture: true });
    window.removeEventListener('pointerup', onPointerUp, { capture: true });
    window.removeEventListener('pointercancel', onPointerUp, { capture: true });
    board.removeEventListener('pointerdown', onBoardPointerDown);
    board.removeEventListener('pointerup', onBoardPointerUp);
    board.removeEventListener('pointercancel', onBoardPointerCancel);
  };
}
