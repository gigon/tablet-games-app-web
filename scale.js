// The ladder: one pentatonic scale (C D E G A) shared by every game, so anything he does
// sounds like music and all games sound like one family. Two octaves, C4 up to C6, all
// inside the 250-1500 Hz band that the tablet speaker and his hearing handle well.
// Pure module: no audio here. fx.js plays these frequencies.

export const SCALE_MIN_HZ = 250;
export const SCALE_MAX_HZ = 1500;

// MIDI numbers: C4 D4 E4 G4 A4, C5 D5 E5 G5 A5, C6.
export const SCALE_MIDI = Object.freeze([60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84]);

export function midiToFrequency(midi) {
  return 440 * 2 ** ((Number(midi) - 69) / 12);
}

export const SCALE = Object.freeze(SCALE_MIDI.map((midi) => midiToFrequency(midi)));

export const SCALE_STEPS = SCALE.length;
export const TOP_STEP = SCALE_STEPS - 1;

function toStep(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

// Frequency in Hz of a scale step. Step 0 is the lowest note (C4). Steps past either end
// stay on the end note, so a very long run settles on the top note instead of jumping
// down. With { wrap: true } the steps go round and round instead.
export function noteAt(step, { wrap = false } = {}) {
  let index = toStep(step);
  if (wrap) index = ((index % SCALE_STEPS) + SCALE_STEPS) % SCALE_STEPS;
  else index = Math.min(TOP_STEP, Math.max(0, index));
  return SCALE[index];
}

// A rising run: `count` notes, each one step higher than the last, `gapMs` apart.
// Returns [{ step, frequency, delayMs }]. Use it for chain pops, cascades and fills:
// a group of eight is an eight-note climb. fx.playRun() plays it.
export function risingRun(count, { startStep = 0, gapMs = 40, wrap = false } = {}) {
  const total = Math.max(0, Math.min(64, toStep(count)));
  const gap = Math.max(0, Number(gapMs) || 0);
  const start = toStep(startStep);
  const notes = [];
  for (let index = 0; index < total; index += 1) {
    const step = start + index;
    notes.push({ step, frequency: noteAt(step, { wrap }), delayMs: index * gap });
  }
  return notes;
}

// The soft major chord used by the shared finale: C E G and the C above.
export const FINALE_CHORD_STEPS = Object.freeze([0, 2, 3, 5]);

export function chordAt(steps = FINALE_CHORD_STEPS) {
  return steps.map((step) => noteAt(step));
}
