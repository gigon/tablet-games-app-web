// Shared effects for every game: the one place that enforces the sound and motion rules.
//
//   poke(stage, x, y, audioCtx)      ripple + soft tone. Call it on EVERY accepted touch,
//                                    before any rule is checked.
//   pop(stage, x, y, audioCtx)       a thing bursting: ring, a few sparks, a soft pop
//   sparkle(stage, x, y)             a burst from the shared particle system (silent)
//   finale(stage, audioCtx, opts)    the big finish: soft chord, slow sparkle, the
//                                    finished thing held large for 3 s, then onDone
//   playTone / playRun / playChord   notes from the shared scale (scale.js)
//   disposeFx(stage)                 stops everything; app.js calls it between rounds
//
// x and y are CLIENT pixels (event.clientX / clientY, as input.js reports them).
// audioCtx is whatever options.getAudioContext() returned; null simply means silence.
//
// Safety rules kept here, so games cannot break them by accident:
//   - no buzzer: only sine and triangle waves, soft attack, every gain capped (MAX_GAIN)
//   - tones stay inside the scale band (250-1500 Hz); only the pop has a low thud
//   - a cap on simultaneous voices and on particles, so a burst of touches on a tablet
//     neither distorts nor stutters
//   - no full-screen flash, nothing blinking fast: particles fade over a second or more
//   - "Mute speech" in settings mutes the voice only, as it always has; these sounds are
//     part of the toy, like the notes in the music game

import { FINALE_CHORD_STEPS, SCALE_MAX_HZ, SCALE_MIN_HZ, noteAt, risingRun } from './scale.js';

export const MAX_GAIN = 0.25;
export const MIN_ATTACK_S = 0.01;
export const MAX_VOICES = 14;
export const SOFT_WAVES = Object.freeze(['sine', 'triangle']);

export const MAX_PARTICLES = 160;
export const FINALE_HOLD_MS = 3000;
export const RIPPLE_MS = 520;
export const POP_RING_MS = 300;

export const FX_COLORS = Object.freeze(['#ffd43b', '#ff8fab', '#7fffd4', '#9ec5ff', '#ffffff']);

// ---------------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------------

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function safeGain(value, fallback = 0.1) {
  return clampNumber(value, 0.0002, MAX_GAIN, fallback);
}

export function safeFrequency(value) {
  return clampNumber(value, SCALE_MIN_HZ, SCALE_MAX_HZ, noteAt(0));
}

export function safeWave(value) {
  return SOFT_WAVES.includes(value) ? value : 'sine';
}

const voiceEnds = new WeakMap();

// Returns false when too many sounds are already ringing on this context.
function claimVoice(context, endsAt) {
  let ends = voiceEnds.get(context);
  if (!ends) {
    ends = [];
    voiceEnds.set(context, ends);
  }
  const now = context.currentTime;
  for (let index = ends.length - 1; index >= 0; index -= 1) {
    if (ends[index] <= now) ends.splice(index, 1);
  }
  if (ends.length >= MAX_VOICES) return false;
  ends.push(endsAt);
  return true;
}

function ready(context) {
  if (!context || typeof context.createOscillator !== 'function') return false;
  if (context.state === 'suspended' && typeof context.resume === 'function') {
    try {
      const resumed = context.resume();
      if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {});
    } catch {
      /* ignore */
    }
  }
  return true;
}

// One soft note. Returns true when a note was scheduled.
//   gain (<= MAX_GAIN), duration and attack in seconds, delay in seconds from now,
//   wave 'sine' | 'triangle'.
export function playTone(audioCtx, frequency, options = {}) {
  try {
    if (!ready(audioCtx)) return false;
    const gainLevel = safeGain(options.gain, 0.1);
    const duration = clampNumber(options.duration, 0.05, 4, 0.45);
    const attack = clampNumber(options.attack, MIN_ATTACK_S, 0.5, 0.02);
    const start = audioCtx.currentTime + clampNumber(options.delay, 0, 10, 0);
    const end = start + Math.max(duration, attack + 0.03);
    if (!claimVoice(audioCtx, end)) return false;

    const oscillator = audioCtx.createOscillator();
    oscillator.type = safeWave(options.wave);
    oscillator.frequency.setValueAtTime(safeFrequency(frequency), start);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainLevel, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(gain);
    gain.connect(audioCtx.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.03);
    return true;
  } catch {
    return false; // Sound is an enhancement, never a requirement.
  }
}

// A scale step as a note: playStep(ctx, 3) is the fourth note of the shared scale.
export function playStep(audioCtx, step, options = {}) {
  return playTone(audioCtx, noteAt(step, { wrap: options.wrap === true }), options);
}

// A rising run on the shared scale (chain pops, cascades): `count` notes, each one step
// higher. Scheduled on the audio clock, so it needs no timers and no cleanup.
// Returns the run ([{ step, frequency, delayMs }]) so the game can time its animation.
export function playRun(audioCtx, count, options = {}) {
  const run = risingRun(count, options);
  for (const note of run) {
    playTone(audioCtx, note.frequency, {
      gain: options.gain ?? 0.09,
      duration: options.duration ?? 0.32,
      delay: note.delayMs / 1000,
      wave: options.wave,
    });
  }
  return run;
}

// A soft chord, the notes entering 70 ms apart so it blooms instead of hitting.
export function playChord(audioCtx, steps = FINALE_CHORD_STEPS, options = {}) {
  const list = Array.isArray(steps) && steps.length ? steps : FINALE_CHORD_STEPS;
  const each = safeGain((options.gain ?? 0.2) / Math.sqrt(list.length), 0.08);
  list.forEach((step, index) => {
    playTone(audioCtx, noteAt(step), {
      gain: each,
      duration: options.duration ?? 1.8,
      attack: 0.04,
      delay: index * 0.07,
    });
  });
  return list.length;
}

const noiseBuffers = new WeakMap();

function noiseBuffer(context) {
  let buffer = noiseBuffers.get(context);
  if (buffer) return buffer;
  const length = Math.max(1, Math.floor(context.sampleRate * 0.05));
  buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
  noiseBuffers.set(context, buffer);
  return buffer;
}

// The pop: a 30 ms band-passed noise tick plus a short sine falling 400 -> 150 Hz. The
// pitch varies a little each time so a row of pops never sounds mechanical.
export function playPop(audioCtx, options = {}) {
  try {
    if (!ready(audioCtx)) return false;
    const rng = typeof options.rng === 'function' ? options.rng : Math.random;
    const pitch = clampNumber(options.pitch, 0.6, 1.6, 1) * (0.92 + rng() * 0.16);
    const level = safeGain(options.gain, 0.16);
    const start = audioCtx.currentTime + clampNumber(options.delay, 0, 10, 0);
    if (!claimVoice(audioCtx, start + 0.14)) return false;

    const thud = audioCtx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(400 * pitch, start);
    thud.frequency.exponentialRampToValueAtTime(150 * pitch, start + 0.09);
    const thudGain = audioCtx.createGain();
    thudGain.gain.setValueAtTime(0.0001, start);
    thudGain.gain.exponentialRampToValueAtTime(level, start + MIN_ATTACK_S);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
    thud.connect(thudGain);
    thudGain.connect(audioCtx.destination);
    thud.start(start);
    thud.stop(start + 0.14);

    if (typeof audioCtx.createBufferSource === 'function' && typeof audioCtx.createBiquadFilter === 'function') {
      const tick = audioCtx.createBufferSource();
      tick.buffer = noiseBuffer(audioCtx);
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1100 * pitch, start);
      filter.Q.setValueAtTime(1.2, start);
      const tickGain = audioCtx.createGain();
      tickGain.gain.setValueAtTime(0.0001, start);
      tickGain.gain.exponentialRampToValueAtTime(level * 0.6, start + 0.005);
      tickGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.03);
      tick.connect(filter);
      filter.connect(tickGain);
      tickGain.connect(audioCtx.destination);
      tick.start(start);
      tick.stop(start + 0.04);
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------
// Particles (pure part)
// ---------------------------------------------------------------------------------

// Makes one burst of particles around (x, y). Pure: pass rng in tests.
//   count, colors, speed (px/s), lifeMs, size (px radius), gravity (px/s^2), spread
//   (radians, default full circle), angle (centre of the spread, radians; -PI/2 is up)
export function createBurst(options = {}) {
  const rng = typeof options.rng === 'function' ? options.rng : Math.random;
  const count = Math.round(clampNumber(options.count, 0, MAX_PARTICLES, 36));
  const colors = Array.isArray(options.colors) && options.colors.length ? options.colors : FX_COLORS;
  const speed = clampNumber(options.speed, 0, 1200, 220);
  const life = clampNumber(options.lifeMs, 100, 6000, 1200);
  const size = clampNumber(options.size, 1, 24, 5);
  const gravity = clampNumber(options.gravity, -600, 1200, 140);
  const spread = clampNumber(options.spread, 0, Math.PI * 2, Math.PI * 2);
  const angle = clampNumber(options.angle, -Math.PI * 2, Math.PI * 2, -Math.PI / 2);
  const x = Number(options.x) || 0;
  const y = Number(options.y) || 0;

  const particles = [];
  for (let index = 0; index < count; index += 1) {
    const direction = angle + (rng() - 0.5) * spread;
    const velocity = speed * (0.35 + rng() * 0.65);
    particles.push({
      x,
      y,
      vx: Math.cos(direction) * velocity,
      vy: Math.sin(direction) * velocity,
      age: 0,
      life: life * (0.6 + rng() * 0.4),
      size: size * (0.5 + rng() * 0.5),
      color: colors[Math.floor(rng() * colors.length) % colors.length],
      gravity,
    });
  }
  return particles;
}

// Adds fresh particles to a pool, never letting it grow past `max`: the oldest go first.
export function addParticles(pool, fresh, max = MAX_PARTICLES) {
  const limit = Math.max(0, Math.floor(Number(max) || 0));
  const all = [...(Array.isArray(pool) ? pool : []), ...(Array.isArray(fresh) ? fresh : [])];
  return all.length > limit ? all.slice(all.length - limit) : all;
}

// Moves every particle on by dtMs and drops the ones whose life is over.
export function stepParticles(pool, dtMs) {
  const dt = clampNumber(dtMs, 0, 100, 16) / 1000;
  const alive = [];
  for (const particle of pool) {
    const age = particle.age + dt * 1000;
    if (age >= particle.life) continue;
    const drag = Math.max(0, 1 - 1.4 * dt);
    const vx = particle.vx * drag;
    const vy = particle.vy * drag + particle.gravity * dt;
    alive.push({ ...particle, age, vx, vy, x: particle.x + vx * dt, y: particle.y + vy * dt });
  }
  return alive;
}

// 1 at birth, easing to 0 at the end of life. Slow fade, no blinking.
export function particleAlpha(particle) {
  const left = 1 - particle.age / particle.life;
  return Math.max(0, Math.min(1, left * left * (3 - 2 * left)));
}

// ---------------------------------------------------------------------------------
// Drawing (DOM part)
// ---------------------------------------------------------------------------------

const stages = new WeakMap();

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function fxState(stage) {
  let state = stages.get(stage);
  if (!state) {
    state = { layer: null, canvas: null, particles: [], frame: 0, lastTime: 0, timers: new Set(), held: new Set() };
    stages.set(stage, state);
  }
  // app.js empties the stage for every round, so the layer may be gone: make a new one.
  if (!state.layer || state.layer.parentNode !== stage) {
    state.layer = document.createElement('div');
    state.layer.className = 'fx-layer';
    state.layer.setAttribute('aria-hidden', 'true');
    state.canvas = null;
    stage.append(state.layer);
  }
  return state;
}

function later(state, callback, delay) {
  const timer = window.setTimeout(() => {
    state.timers.delete(timer);
    callback();
  }, delay);
  state.timers.add(timer);
  return timer;
}

function localPoint(state, x, y) {
  const rect = state.layer.getBoundingClientRect();
  return { x: (Number(x) || 0) - rect.left, y: (Number(y) || 0) - rect.top, width: rect.width, height: rect.height };
}

function ring(state, point, className, duration, options) {
  const element = document.createElement('span');
  element.className = className;
  element.style.left = `${point.x}px`;
  element.style.top = `${point.y}px`;
  if (options.color) element.style.setProperty('--fx-color', options.color);
  if (Number.isFinite(options.size)) element.style.setProperty('--fx-size', `${options.size}px`);
  state.layer.append(element);
  later(state, () => element.remove(), duration + 60);
}

function ensureCanvas(state) {
  const rect = state.layer.getBoundingClientRect();
  const ratio = Math.min(1.5, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (!state.canvas) {
    state.canvas = document.createElement('canvas');
    state.canvas.className = 'fx-canvas';
    state.layer.prepend(state.canvas);
  }
  if (state.canvas.width !== width || state.canvas.height !== height) {
    state.canvas.width = width;
    state.canvas.height = height;
  }
  state.ratio = ratio;
  return state.canvas.getContext('2d');
}

function drawFrame(state, time) {
  state.frame = 0;
  const canvas = state.canvas;
  if (!canvas || !canvas.isConnected) {
    state.particles = [];
    return;
  }
  const context = canvas.getContext('2d');
  const dt = state.lastTime ? Math.min(50, time - state.lastTime) : 16;
  state.lastTime = time;
  state.particles = stepParticles(state.particles, dt);

  if (!context) {
    state.particles = [];
    return;
  }
  if (state.particles.length === 0) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    state.lastTime = 0;
    return;
  }

  // Fade what is there instead of wiping it: gives each spark a short soft trail.
  context.globalCompositeOperation = 'destination-out';
  context.globalAlpha = 1;
  context.fillStyle = 'rgba(0, 0, 0, 0.22)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'lighter';
  for (const particle of state.particles) {
    context.globalAlpha = particleAlpha(particle);
    context.fillStyle = particle.color;
    context.beginPath();
    context.arc(particle.x * state.ratio, particle.y * state.ratio, particle.size * state.ratio, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  state.frame = window.requestAnimationFrame((next) => drawFrame(state, next));
}

function emit(state, point, options) {
  const context = ensureCanvas(state);
  if (!context) return 0;
  const scale = reducedMotion() ? 0.4 : 1;
  const fresh = createBurst({
    ...options,
    x: point.x,
    y: point.y,
    count: Math.round((options.count ?? 36) * scale),
  });
  state.particles = addParticles(state.particles, fresh, MAX_PARTICLES);
  if (!state.frame && state.particles.length) {
    state.frame = window.requestAnimationFrame((time) => drawFrame(state, time));
  }
  return fresh.length;
}

// A burst of sparks at (x, y). Silent. Options are those of createBurst(): count (default
// 36), colors, speed, lifeMs, size, gravity, spread, angle. Returns how many were added.
export function sparkle(stage, x, y, options = {}) {
  try {
    const state = fxState(stage);
    return emit(state, localPoint(state, x, y), options && typeof options === 'object' ? options : {});
  } catch {
    return 0;
  }
}

// Ripple + soft tone. Call on every accepted touch, anywhere, before checking any rule.
//   options.step    scale step of the tone (default 2); pass a rising step for runs
//   options.color   ripple colour; options.size  ripple diameter in px
//   options.silent  true for the ripple only
export function poke(stage, x, y, audioCtx, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  try {
    const state = fxState(stage);
    ring(state, localPoint(state, x, y), 'fx-ripple', RIPPLE_MS, settings);
  } catch {
    /* effects never break a game */
  }
  if (settings.silent !== true) {
    playStep(audioCtx, settings.step ?? 2, { gain: settings.gain ?? 0.07, duration: 0.3 });
  }
}

// Something bursting at (x, y): a quick ring, a few sparks and the pop sound.
//   options.color, options.size, options.count (sparks, default 8), options.pitch
//   (0.6-1.6, default 1), options.silent
export function pop(stage, x, y, audioCtx, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  try {
    const state = fxState(stage);
    const point = localPoint(state, x, y);
    ring(state, point, 'fx-pop', POP_RING_MS, settings);
    emit(state, point, {
      count: settings.count ?? 8,
      colors: settings.color ? [settings.color, '#ffffff'] : undefined,
      speed: 260,
      lifeMs: 600,
      size: 4,
      gravity: 500,
    });
  } catch {
    /* effects never break a game */
  }
  if (settings.silent !== true) playPop(audioCtx, { pitch: settings.pitch, gain: settings.gain });
}

// The big finish. Plays a soft chord, lets slow sparks drift up from several places and
// holds the finished thing large (CSS class "fx-finale-hold" on options.element) for
// holdMs, then calls options.onDone. Call onSuccess from onDone.
//   options.element  the finished thing to show large (optional)
//   options.holdMs   default 3000;  options.bursts  default 5;  options.colors
//   options.silent   no chord
// Returns a cancel function. disposeFx(stage) cancels it too (and then onDone is not
// called), so a round that is torn down mid-finale stays quiet.
export function finale(stage, audioCtx, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const holdMs = clampNumber(settings.holdMs, 300, 10000, FINALE_HOLD_MS);
  const bursts = Math.round(clampNumber(settings.bursts, 0, 8, 5));
  const rng = typeof settings.rng === 'function' ? settings.rng : Math.random;
  const element = settings.element || null;
  let finished = false;
  let state = null;
  const timers = [];

  const release = () => {
    if (element) element.classList.remove('fx-finale-hold');
    if (state) state.held.delete(release);
  };

  try {
    state = fxState(stage);
    if (element) {
      element.classList.add('fx-finale-hold');
      state.held.add(release);
    }
    for (let index = 0; index < bursts; index += 1) {
      const delay = Math.round((holdMs * 0.7 * index) / Math.max(1, bursts));
      timers.push(
        later(state, () => {
          const rect = state.layer.getBoundingClientRect();
          emit(
            state,
            { x: rect.width * (0.15 + rng() * 0.7), y: rect.height * (0.3 + rng() * 0.45) },
            { count: 26, colors: settings.colors, speed: 150, lifeMs: 2000, size: 5, gravity: 40 },
          );
        }, delay),
      );
    }
    timers.push(
      later(state, () => {
        if (finished) return;
        finished = true;
        release();
        if (typeof settings.onDone === 'function') settings.onDone();
      }, holdMs),
    );
  } catch {
    /* effects never break a game */
  }
  if (settings.silent !== true) playChord(audioCtx, settings.chord);

  return function cancel() {
    if (finished) return;
    finished = true;
    for (const timer of timers) {
      window.clearTimeout(timer);
      if (state) state.timers.delete(timer);
    }
    release();
  };
}

// Stops every effect on a stage: timers, the animation frame, sparks, held elements.
// Safe to call at any time and more than once.
export function disposeFx(stage) {
  const state = stages.get(stage);
  if (!state) return;
  for (const timer of state.timers) window.clearTimeout(timer);
  state.timers.clear();
  for (const release of [...state.held]) release();
  state.held.clear();
  if (state.frame) window.cancelAnimationFrame(state.frame);
  state.frame = 0;
  state.lastTime = 0;
  state.particles = [];
  if (state.layer) state.layer.remove();
  state.layer = null;
  state.canvas = null;
}
