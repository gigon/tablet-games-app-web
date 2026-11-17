// The window: a fogged pane over one of three built-in scenes. A touch clears a soft
// disc at once; rubbing clears a wide path. When most of the glass is clear the last fog
// melts away, the scene comes alive and the shared finale plays. See specs/toy-5.md.
//
//   renderWindow(stage, options) -> cleanup
//
// All movement, sound and speech are enhancements: the toy never refuses a touch and has
// no fail state.

import { finale, playStep, poke } from './fx.js';
import { attachTouch } from './input.js';
import {
  AUTO_RADIUS_CELLS,
  SCENES,
  autoReveal,
  brushRadius,
  createUnit,
  isDone,
  revealAt,
  revealSegment,
  unitResults,
} from './window-logic.js';

const AUTO_FINISH_AFTER_MS = 60000;
const AUTO_STEP_MS = 700;
const RUB_NOTE_GAP_MS = 90;

// The three views take turns, so a new round is a new window to look out of.
let sceneCursor = 0;

function nextSceneIndex() {
  const index = sceneCursor % SCENES.length;
  sceneCursor += 1;
  return index;
}

function flowerMarkup(x, y, scale, petal, delay, palette) {
  const petals = [
    [0, -23],
    [22, -7],
    [14, 19],
    [-14, 19],
    [-22, -7],
  ]
    .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="16" fill="${petal}"/>`)
    .join('');
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <g class="window-flower" style="animation-delay:${delay}ms">
      <path d="M0 0 C -8 -46 8 -88 0 -128" fill="none" stroke="${palette.stem}" stroke-width="7" stroke-linecap="round"/>
      <g transform="translate(0 -136)">
        ${petals}
        <circle r="13" fill="${palette.flowerCenter}"/>
      </g>
    </g>
  </g>`;
}

function houseMarkup(x, y, width, height, wall, roof, lit, palette) {
  const half = width / 2;
  return `<g transform="translate(${x} ${y})">
    <rect x="${-half}" y="${-height}" width="${width}" height="${height}" rx="7" fill="${wall}"/>
    <polygon points="${-half - 16},${-height} 0,${-height - 68} ${half + 16},${-height}" fill="${roof}"/>
    <rect x="${-half + 14}" y="${-height + 20}" width="${width * 0.28}" height="${height * 0.3}" rx="5" fill="${lit}"/>
    <rect x="${half - width * 0.28 - 14}" y="${-height + 20}" width="${width * 0.28}" height="${height * 0.3}" rx="5" fill="${lit}"/>
    <rect x="-13" y="${-height * 0.4}" width="26" height="${height * 0.4}" rx="5" fill="${palette.house2}"/>
  </g>`;
}

function gardenMarkup(palette) {
  return `<svg class="window-scene-svg" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="window-garden-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${palette.skyTop}"/>
        <stop offset="1" stop-color="${palette.skyBottom}"/>
      </linearGradient>
    </defs>
    <rect width="1000" height="700" fill="url(#window-garden-sky)"/>
    <g class="window-sun">
      <circle cx="790" cy="145" r="92" fill="${palette.sun}"/>
      <g stroke="${palette.sunRay}" stroke-width="11" stroke-linecap="round" opacity="0.85">
        <path d="M790 20 V 54"/>
        <path d="M790 236 V 270"/>
        <path d="M665 145 H 699"/>
        <path d="M881 145 H 915"/>
        <path d="M702 57 L 726 81"/>
        <path d="M854 209 L 878 233"/>
        <path d="M878 57 L 854 81"/>
        <path d="M726 209 L 702 233"/>
      </g>
    </g>
    <g class="window-cloud window-cloud--a" fill="${palette.cloud}" opacity="0.92">
      <ellipse cx="230" cy="150" rx="92" ry="42"/>
      <ellipse cx="310" cy="132" rx="68" ry="52"/>
      <ellipse cx="160" cy="170" rx="66" ry="34"/>
    </g>
    <g class="window-cloud window-cloud--b" fill="${palette.cloud}" opacity="0.8">
      <ellipse cx="590" cy="92" rx="74" ry="34"/>
      <ellipse cx="650" cy="78" rx="52" ry="40"/>
    </g>
    <g class="window-birds" fill="none" stroke="${palette.bird}" stroke-width="7" stroke-linecap="round">
      <path class="window-bird" d="M360 230 q 22 -18 44 0 q 22 -18 44 0"/>
      <path class="window-bird window-bird--two" d="M500 190 q 16 -13 32 0 q 16 -13 32 0"/>
    </g>
    <path d="M0 430 Q 250 320 520 425 T 1000 405 V700 H0 Z" fill="${palette.hillBack}"/>
    <path d="M0 520 Q 300 410 620 520 T 1000 500 V700 H0 Z" fill="${palette.hillFront}"/>
    ${flowerMarkup(150, 640, 1.05, palette.petalA, 0, palette)}
    ${flowerMarkup(270, 610, 0.86, palette.petalB, 420, palette)}
    ${flowerMarkup(430, 655, 1.15, palette.petalC, 860, palette)}
    ${flowerMarkup(580, 620, 0.9, palette.petalA, 260, palette)}
    ${flowerMarkup(760, 650, 1.1, palette.petalB, 700, palette)}
    ${flowerMarkup(880, 605, 0.82, palette.petalC, 1180, palette)}
  </svg>`;
}

function villageMarkup(palette) {
  const snow = Array.from({ length: 18 }, (_, index) => {
    const x = 40 + ((index * 137) % 920);
    const y = (index * 83) % 500;
    const size = 3 + (index % 3) * 2;
    const delay = ((index * 0.53) % 7).toFixed(2);
    const duration = (7 + (index % 5) * 1.4).toFixed(1);
    return `<circle class="window-snow" cx="${x}" cy="${y}" r="${size}" fill="${palette.snow}" style="animation-delay:-${delay}s;animation-duration:${duration}s"/>`;
  }).join('');
  const stars = Array.from({ length: 12 }, (_, index) => {
    const x = 50 + ((index * 211) % 900);
    const y = 40 + ((index * 97) % 260);
    return `<circle class="window-star" cx="${x}" cy="${y}" r="${index % 3 === 0 ? 4 : 3}" fill="${palette.star}" opacity="0.85"/>`;
  }).join('');

  return `<svg class="window-scene-svg" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="window-village-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${palette.skyTop}"/>
        <stop offset="1" stop-color="${palette.skyBottom}"/>
      </linearGradient>
    </defs>
    <rect width="1000" height="700" fill="url(#window-village-sky)"/>
    <g class="window-stars">${stars}</g>
    <g class="window-moon">
      <circle cx="800" cy="145" r="74" fill="${palette.moon}"/>
      <circle cx="770" cy="124" r="14" fill="${palette.skyTop}" opacity="0.22"/>
      <circle cx="820" cy="170" r="10" fill="${palette.skyTop}" opacity="0.18"/>
    </g>
    <path d="M0 440 Q 220 340 470 430 T 1000 410 V700 H0 Z" fill="${palette.hillBack}"/>
    <path d="M0 545 Q 300 430 610 535 T 1000 515 V700 H0 Z" fill="${palette.hillFront}"/>
    ${houseMarkup(230, 565, 150, 120, palette.house, palette.roof, palette.window, palette)}
    ${houseMarkup(410, 610, 190, 150, palette.house2, palette.roof2, palette.window, palette)}
    ${houseMarkup(700, 580, 165, 132, palette.house, palette.roof, palette.window, palette)}
    <g transform="translate(900 590)">
      <rect x="-9" y="-70" width="18" height="70" rx="6" fill="${palette.house2}"/>
      <polygon points="-4,-90 -70,-30 -4,-30" fill="${palette.tree}"/>
      <polygon points="4,-90 70,-30 4,-30" fill="${palette.tree}"/>
      <polygon points="0,-120 -54,-62 0,-62" fill="${palette.tree}"/>
    </g>
    <g>${snow}</g>
  </svg>`;
}

function seasideMarkup(palette) {
  return `<svg class="window-scene-svg" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="window-seaside-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${palette.skyTop}"/>
        <stop offset="0.55" stop-color="${palette.skyMid}"/>
        <stop offset="1" stop-color="${palette.skyBottom}"/>
      </linearGradient>
    </defs>
    <rect width="1000" height="700" fill="url(#window-seaside-sky)"/>
    <g class="window-sun">
      <circle cx="690" cy="300" r="105" fill="${palette.sun}"/>
    </g>
    <g class="window-cloud window-cloud--a" fill="${palette.skyBottom}" opacity="0.72">
      <ellipse cx="230" cy="155" rx="105" ry="38"/>
      <ellipse cx="315" cy="140" rx="70" ry="46"/>
    </g>
    <g class="window-gulls" fill="none" stroke="${palette.gull}" stroke-width="6" stroke-linecap="round">
      <path class="window-gull" d="M300 210 q 18 -15 36 0 q 18 -15 36 0"/>
      <path class="window-gull window-gull--two" d="M430 160 q 13 -11 26 0 q 13 -11 26 0"/>
    </g>
    <path d="M0 405 Q 180 378 360 400 T 760 394 T 1000 402 V700 H0 Z" fill="${palette.seaBack}"/>
    <path class="window-wave window-wave--back" d="M0 470 Q 180 440 360 470 T 760 466 T 1000 474 V700 H0 Z" fill="${palette.seaFront}" opacity="0.92"/>
    <path class="window-wave window-wave--front" d="M0 555 Q 200 520 400 555 T 800 548 T 1000 560 V700 H0 Z" fill="${palette.seaBack}" opacity="0.88"/>
    <g stroke="${palette.foam}" stroke-width="7" stroke-linecap="round" fill="none" opacity="0.8">
      <path d="M90 500 q 40 -18 80 0"/>
      <path d="M330 530 q 46 -18 92 0"/>
      <path d="M600 505 q 38 -16 76 0"/>
      <path d="M800 580 q 44 -18 88 0"/>
    </g>
    <path d="M0 640 Q 260 604 540 632 T 1000 628 V700 H0 Z" fill="${palette.sand}"/>
    <g transform="translate(730 470)">
      <g class="window-boat">
        <path d="M-90 38 Q 0 90 90 38 L 68 66 Q 0 96 -68 66 Z" fill="${palette.boat}"/>
        <rect x="-5" y="-150" width="10" height="190" rx="4" fill="${palette.boat}"/>
        <path d="M-8 -142 L -8 15 L -108 15 Z" fill="${palette.sail}"/>
        <path d="M8 -128 L 8 10 L 86 10 Z" fill="${palette.sail2}"/>
      </g>
    </g>
  </svg>`;
}

function sceneMarkup(scene) {
  const palette = scene.palette;
  if (scene.kind === 'garden') return gardenMarkup(palette);
  if (scene.kind === 'village') return villageMarkup(palette);
  return seasideMarkup(palette);
}

function finaleColors(scene) {
  const palette = scene.palette;
  return [
    palette.sun || palette.moon || '#ffd447',
    palette.hillFront || palette.seaFront || palette.roof || '#7fffd4',
    '#ffffff',
  ];
}

function eraseDisc(context, x, y, radius) {
  const r = Math.max(1, radius);
  const gradient = context.createRadialGradient(x, y, 0, x, y, r);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
  gradient.addColorStop(0.62, 'rgba(0, 0, 0, 0.94)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.save();
  context.globalCompositeOperation = 'destination-out';
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, r, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function renderWindow(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const motorLevel = Number(settings.motorLevel) || 1;

  let unit = createUnit({ motorLevel, sceneIndex: nextSceneIndex() });
  let disposed = false;
  let finishing = false;
  let idleTimer = null;
  let cancelFinale = null;
  let lastRubNote = 0;
  const timers = new Set();
  const erasures = [];

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
  board.className = 'window-board';

  const frame = document.createElement('div');
  frame.className = 'window-frame';

  const scene = document.createElement('div');
  scene.className = 'window-scene';
  scene.dataset.scene = unit.scene.kind;
  scene.innerHTML = sceneMarkup(unit.scene);

  const fog = document.createElement('canvas');
  fog.className = 'window-fog';
  fog.setAttribute('aria-hidden', 'true');

  const glass = document.createElement('div');
  glass.className = 'window-glass';
  glass.setAttribute('aria-hidden', 'true');

  frame.append(scene, fog, glass);
  board.append(frame);
  stage.append(board);

  function fogContext() {
    try {
      return fog.getContext('2d');
    } catch {
      return null;
    }
  }

  function paintFog() {
    const rect = fog.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (width <= 0 || height <= 0) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    fog.width = Math.max(1, Math.round(width * ratio));
    fog.height = Math.max(1, Math.round(height * ratio));
    const context = fogContext();
    if (!context) return;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const base = context.createLinearGradient(0, 0, width * 0.35, height);
    base.addColorStop(0, 'rgba(233, 245, 248, 0.97)');
    base.addColorStop(0.55, 'rgba(211, 233, 239, 0.96)');
    base.addColorStop(1, 'rgba(184, 214, 224, 0.96)');
    context.fillStyle = base;
    context.fillRect(0, 0, width, height);

    // A little frozen texture, so the fog reads as condensation and not as a panel.
    const spots = [
      [0.2, 0.18, 0.26],
      [0.48, 0.12, 0.2],
      [0.76, 0.22, 0.3],
      [0.34, 0.48, 0.24],
      [0.68, 0.55, 0.28],
      [0.16, 0.74, 0.3],
      [0.55, 0.82, 0.26],
      [0.86, 0.78, 0.22],
    ];
    for (const [u, v, size] of spots) {
      const radius = size * Math.min(width, height);
      const glow = context.createRadialGradient(u * width, v * height, 0, u * width, v * height, radius);
      glow.addColorStop(0, 'rgba(255, 255, 255, 0.24)');
      glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      context.fillStyle = glow;
      context.fillRect(u * width - radius, v * height - radius, radius * 2, radius * 2);
    }

    context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    context.lineWidth = 2;
    for (let index = 0; index < 9; index += 1) {
      const x = width * (0.08 + index * 0.105);
      context.beginPath();
      context.moveTo(x, height * 0.08);
      context.quadraticCurveTo(x + 12, height * 0.5, x - 8, height * 0.92);
      context.stroke();
    }

    for (const erasure of erasures) {
      eraseDisc(context, erasure.u * width, erasure.v * height, erasure.ru * Math.min(width, height));
    }
  }

  function eraseLocal(clientX, clientY, radius, rect) {
    const width = rect.width;
    const height = rect.height;
    if (width <= 0 || height <= 0) return;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const r = Math.max(1, radius);
    erasures.push({ u: x / width, v: y / height, ru: r / Math.min(width, height) });
    const context = fogContext();
    if (context) eraseDisc(context, x, y, r);
  }

  function eraseAt(clientX, clientY, radius) {
    eraseLocal(clientX, clientY, radius, fog.getBoundingClientRect());
  }

  function eraseSegment(segment, radius) {
    const rect = fog.getBoundingClientRect();
    const dx = segment.x1 - segment.x0;
    const dy = segment.y1 - segment.y0;
    const length = Math.hypot(dx, dy);
    const step = Math.max(10, radius * 0.26);
    const count = Math.min(40, Math.max(1, Math.ceil(length / step)));
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      eraseLocal(segment.x0 + dx * t, segment.y0 + dy * t, radius, rect);
    }
  }

  function rubNote(speed) {
    const now = performance.now();
    if (now - lastRubNote < RUB_NOTE_GAP_MS) return;
    lastRubNote = now;
    const step = Math.min(10, Math.max(0, Math.round((Number(speed) || 0) / 220)));
    playStep(audio(), step, { gain: 0.035, duration: 0.16 });
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
    say(unit.scene.phraseId);

    const results = unitResults(unit);
    board.classList.add('is-revealing');
    scene.classList.add('is-alive');
    fog.classList.add('is-melting');

    cancelFinale = finale(stage, audio(), {
      element: board,
      colors: finaleColors(unit.scene),
      onDone: () => {
        say('94');
        if (!disposed && typeof settings.onSuccess === 'function') settings.onSuccess({ results });
      },
    });
  }

  function clearDisc(x, y, radius) {
    const result = revealAt(unit, { x, y }, fog.getBoundingClientRect(), { radius });
    unit = result.unit;
    if (result.newlyCleared > 0) eraseAt(x, y, radius);
    if (isDone(unit)) finish();
    return result;
  }

  function clearSegment(segment) {
    const radius = brushRadius(motorLevel, { rub: true });
    const result = revealSegment(unit, segment, fog.getBoundingClientRect(), { radius });
    unit = result.unit;
    eraseSegment(segment, radius);
    rubNote(segment.speed);
    if (isDone(unit)) finish();
    return result;
  }

  function onDown(point) {
    if (disposed || finishing) return;
    restartIdle();
    // Every accepted touch answers at once, before any rule or coverage is looked at.
    poke(stage, point.x, point.y, audio(), { step: 1, gain: 0.06 });
    clearDisc(point.x, point.y, brushRadius(motorLevel));
  }

  function onSegment(segment) {
    if (disposed || finishing) return;
    restartIdle();
    clearSegment(segment);
  }

  // After a long idle the window opens itself slowly, and says nothing about him.
  function autoFinish() {
    if (disposed || finishing) return;
    const step = autoReveal(unit, { radiusCells: AUTO_RADIUS_CELLS });
    if (step && step.cellIndex >= 0) {
      const rect = fog.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const x = rect.left + step.fx * rect.width;
        const y = rect.top + step.fy * rect.height;
        const cell = Math.max(rect.width / unit.cols, rect.height / unit.rows);
        eraseAt(x, y, cell * ((step.radiusCells ?? AUTO_RADIUS_CELLS) + 0.6));
      }
    }
    if (isDone(unit)) finish();
    else later(autoFinish, AUTO_STEP_MS);
  }


  const detachTouch = attachTouch(board, { onDown, onSegment });
  window.addEventListener('resize', paintFog);
  paintFog();
  restartIdle();
  say('90');

  return function cleanup() {
    disposed = true;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    window.clearTimeout(idleTimer);
    if (cancelFinale) cancelFinale();
    detachTouch();
    window.removeEventListener('resize', paintFog);
  };
}
