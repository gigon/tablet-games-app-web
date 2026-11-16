import {
  MAX_MOTOR_LEVEL,
  MAX_RULE_LEVEL,
  MIN_MOTOR_LEVEL,
  SONGS,
  advance,
  createSession,
  currentNote,
  padForNote,
  padsForLevel,
  validateSong,
} from './music-logic.js';
import { colorName, normalizeLanguage, t } from './i18n.js';
import {
  MIN_TOUCH_DURATION_MS,
  SAFE_MARGIN,
  isTouchDurationValid,
  isWithinSafeArea,
} from './touch.js';

const PAD_HEX = Object.freeze({
  red: '#c40000',
  blue: '#0057d9',
  green: '#008a3c',
  yellow: '#f2c200',
});

const PAD_TONES = Object.freeze({
  red: 392,
  blue: 440,
  green: 494,
  yellow: 523,
});

const ATTACK_S = 0.02;
const NOTE_DECAY_S = 1;
const PHRASE_PAUSE_MS = 320;
const AUTO_PLAY_DELAY_MS = 360;
const RIPPLE_MS = 460;
const PULSE_MS = 520;

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function midiToFrequency(midi) {
  return 440 * 2 ** ((Number(midi) - 69) / 12);
}

function nowSafe(point) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return isWithinSafeArea(point, { width, height }, SAFE_MARGIN);
}

function stopScheduled(timers) {
  for (const timer of timers) window.clearTimeout(timer);
  timers.clear();
}

function playFrequency(context, frequency, level) {
  try {
    if (!context || !Number.isFinite(frequency) || frequency <= 0) return;
    if (context.state === 'suspended' && typeof context.resume === 'function') {
      context.resume().catch(() => {});
    }

    const start = context.currentTime;
    const end = start + NOTE_DECAY_S;

    const fundamental = context.createOscillator();
    fundamental.type = 'sine';
    fundamental.frequency.setValueAtTime(frequency, start);

    const fundamentalGain = context.createGain();
    fundamentalGain.gain.setValueAtTime(0.0001, start);
    fundamentalGain.gain.exponentialRampToValueAtTime(level, start + ATTACK_S);
    fundamentalGain.gain.exponentialRampToValueAtTime(0.0001, end);

    fundamental.connect(fundamentalGain);
    fundamentalGain.connect(context.destination);
    fundamental.start(start);
    fundamental.stop(end + 0.02);

    const overtone = context.createOscillator();
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(frequency * 2, start);

    const overtoneGain = context.createGain();
    overtoneGain.gain.setValueAtTime(0.0001, start);
    overtoneGain.gain.exponentialRampToValueAtTime(level * 0.22, start + ATTACK_S);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);

    overtone.connect(overtoneGain);
    overtoneGain.connect(context.destination);
    overtone.start(start);
    overtone.stop(start + 0.57);
  } catch {
    /* Sound is an enhancement. */
  }
}

export function renderMusic(stage, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const language = normalizeLanguage(settings.language);
  const name = typeof settings.name === 'string' ? settings.name : '';
  const showTextLabels = settings.showTextLabels === true;
  const motorLevel = clamp(settings.motorLevel, MIN_MOTOR_LEVEL, MAX_MOTOR_LEVEL);
  const ruleLevel = clamp(settings.ruleLevel, 1, MAX_RULE_LEVEL);
  const song = validateSong(settings.song) ? settings.song : SONGS[0];
  const padDefinitions = padsForLevel(motorLevel);
  const padCount = padDefinitions.length;

  let session = createSession(song);
  let wrongTaps = 0;
  let disposed = false;
  let busy = false;
  let tap = null;
  let multiTouch = false;

  const timers = new Set();
  const activePointers = new Set();

  function later(callback, delay) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
    return timer;
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

  function playNote(midi) {
    playFrequency(audioContext(), midiToFrequency(midi), 0.2);
  }

  function playPadTone(index) {
    const definition = padDefinitions[index];
    if (!definition) return;
    const frequency = PAD_TONES[definition.colorKey] || PAD_TONES.red;
    playFrequency(audioContext(), frequency, 0.09);
  }

  function promptFor(key) {
    return t(language, key, { name });
  }

  function showPrompt(key) {
    const text = promptFor(key);
    if (promptElement) promptElement.textContent = text;
    if (typeof settings.onPrompt === 'function') settings.onPrompt(text);
  }

  function targetPadIndex() {
    if (session.songDone) return null;
    return padForNote(song, session.noteIndex, padCount);
  }

  function clearTarget() {
    for (const element of padElements) element.classList.remove('is-target');
  }

  function setTarget(announce) {
    clearTarget();
    if (ruleLevel !== 2 || session.songDone) return;
    const target = targetPadIndex();
    if (target === null) return;
    if (padElements[target]) padElements[target].classList.add('is-target');
    if (announce) showPrompt('musicWhereLight');
  }

  function restartAnimation(element, className, duration) {
    if (!element) return;
    element.classList.remove(className);
    void element.getBoundingClientRect();
    element.classList.add(className);
    later(() => element.classList.remove(className), duration);
  }

  function ripplePad(index) {
    restartAnimation(padElements[index], 'is-rippling', RIPPLE_MS);
  }

  function pulsePad(index) {
    restartAnimation(padElements[index], 'is-pulse', PULSE_MS);
  }

  function updateDots() {
    let end = 0;
    dotElements.forEach((dot, index) => {
      end += song.phrases[index];
      dot.classList.toggle('is-done', session.noteIndex >= end);
    });
  }

  function phraseRange(index) {
    let start = 0;
    for (let step = 0; step < index; step += 1) start += song.phrases[step];
    return { start, count: song.phrases[index] || 0 };
  }

  function playSequence(start, count, done) {
    const secondsPerBeat = 60 / song.bpm;
    let offset = 0;
    let played = 0;

    for (let step = 0; step < count; step += 1) {
      const noteIndex = start + step;
      const note = song.notes[noteIndex];
      if (!note) break;
      const at = offset;
      const padIndex = padForNote(song, noteIndex, padCount);
      later(() => {
        playNote(note[0]);
        ripplePad(padIndex);
      }, Math.round(at * 1000));
      offset += note[1] * secondsPerBeat;
      played += 1;
    }

    if (played === 0) {
      done();
      return;
    }

    later(done, Math.round(offset * 1000) + 120);
  }

  function finishNote(previous) {
    session = advance(session);
    wrongTaps = 0;
    updateDots();

    if (session.songDone) {
      clearTarget();
      busy = true;
      later(() => {
        playSequence(0, song.notes.length, () => {
          if (typeof settings.onSuccess === 'function') {
            settings.onSuccess({
              reason: 'song',
              song,
              motorLevel,
              ruleLevel,
            });
          }
          showPrompt('musicEnd');
        });
      }, PHRASE_PAUSE_MS);
      return;
    }

    if (session.phraseDone) {
      clearTarget();
      busy = true;
      const range = phraseRange(previous.phraseIndex);
      later(() => {
        playSequence(range.start, range.count, () => {
          busy = false;
          setTarget(true);
        });
      }, PHRASE_PAUSE_MS);
      return;
    }

    busy = false;
    setTarget(true);
  }

  function acceptNote(note, padIndex) {
    busy = true;
    wrongTaps = 0;
    ripplePad(padIndex);
    playNote(note[0]);
    finishNote({ phraseIndex: session.phraseIndex });
  }

  function autoPlayNote() {
    const note = currentNote(session);
    if (!note) return;
    busy = true;
    wrongTaps = 0;
    const target = targetPadIndex();
    if (target !== null) pulsePad(target);
    playNote(note[0]);
    const previous = { phraseIndex: session.phraseIndex };
    later(() => finishNote(previous), AUTO_PLAY_DELAY_MS);
  }

  function wrongPad(padIndex, targetIndex) {
    wrongTaps += 1;
    playPadTone(padIndex);
    pulsePad(targetIndex);
    if (typeof settings.onFailure === 'function') {
      settings.onFailure({
        reason: 'motor',
        song,
        motorLevel,
        ruleLevel,
      });
    }
    if (wrongTaps >= 2) autoPlayNote();
  }

  function padAt(point) {
    for (let index = padCount - 1; index >= 0; index -= 1) {
      const rect = padElements[index].getBoundingClientRect();
      if (
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      ) {
        return index;
      }
    }
    return null;
  }

  function nearPad(index, point) {
    const rect = padElements[index].getBoundingClientRect();
    const margin = Math.max(28, Math.min(rect.width, rect.height) * 0.08);
    return (
      point.x >= rect.left - margin &&
      point.x <= rect.right + margin &&
      point.y >= rect.top - margin &&
      point.y <= rect.bottom + margin
    );
  }

  function handleTap(point) {
    if (disposed || busy) return;
    const note = currentNote(session);
    if (!note) return;

    if (padCount === 1) {
      acceptNote(note, 0);
      return;
    }

    const target = targetPadIndex();
    const hit = padAt(point);

    if (hit === null) {
      if (ruleLevel === 2 && target !== null && nearPad(target, point)) {
        acceptNote(note, target);
      }
      return;
    }

    if (ruleLevel === 2 && hit !== target) {
      wrongPad(hit, target);
      return;
    }

    acceptNote(note, hit);
  }

  function point(event) {
    return { x: event.clientX, y: event.clientY };
  }

  function onPointerDown(event) {
    activePointers.add(event.pointerId);
    if (activePointers.size > 1) multiTouch = true;
  }

  function onPointerUp(event) {
    activePointers.delete(event.pointerId);
    if (activePointers.size === 0) multiTouch = false;
  }

  function onBoardPointerDown(event) {
    if (disposed || busy) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (activePointers.size > 1) {
      multiTouch = true;
      tap = null;
      return;
    }
    if (!nowSafe(point(event))) return;
    tap = { pointerId: event.pointerId, startedAt: performance.now() };
  }

  function onBoardPointerUp(event) {
    if (!tap || tap.pointerId !== event.pointerId) return;
    const startedAt = tap.startedAt;
    tap = null;
    if (multiTouch) return;
    if (!nowSafe(point(event))) return;
    if (!isTouchDurationValid(startedAt, performance.now(), MIN_TOUCH_DURATION_MS)) {
      return;
    }
    handleTap(point(event));
  }

  function onBoardPointerCancel() {
    tap = null;
  }

  const promptElement = showTextLabels ? document.createElement('p') : null;
  if (promptElement) promptElement.className = 'music-prompt';

  const board = document.createElement('div');
  board.className = 'music-board';

  const dotsElement = document.createElement('div');
  dotsElement.className = 'music-dots';
  dotsElement.setAttribute('aria-hidden', 'true');

  const dotElements = song.phrases.map(() => {
    const dot = document.createElement('span');
    dot.className = 'music-dot';
    dotsElement.append(dot);
    return dot;
  });

  const padsElement = document.createElement('div');
  padsElement.className = 'music-pads';
  padsElement.dataset.count = String(padCount);
  if (padCount === 1) padsElement.classList.add('music-pads-single');

  const padElements = padDefinitions.map((definition) => {
    const element = document.createElement('div');
    element.className = `music-pad music-pad-${definition.colorKey}`;
    element.dataset.index = String(definition.index);
    element.style.setProperty(
      '--music-pad',
      PAD_HEX[definition.colorKey] || PAD_HEX.red,
    );
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', colorName(language, definition.colorKey));
    padsElement.append(element);
    return element;
  });

  board.append(dotsElement, padsElement);
  if (promptElement) stage.append(promptElement);
  stage.append(board);

  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  window.addEventListener('pointerup', onPointerUp, { capture: true, passive: true });
  window.addEventListener('pointercancel', onPointerUp, { capture: true, passive: true });
  board.addEventListener('pointerdown', onBoardPointerDown);
  board.addEventListener('pointerup', onBoardPointerUp);
  board.addEventListener('pointercancel', onBoardPointerCancel);

  updateDots();
  showPrompt('musicStart');
  setTarget(false);

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
