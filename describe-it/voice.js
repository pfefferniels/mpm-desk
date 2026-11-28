/* A pianist's inner voice on the Web Audio API: the line hummed on welte225.org, in time with the playing. */
/* global AudioBufferSourceNode, BiquadFilterNode, GainNode, IIRFilterNode, OscillatorNode */

// The line's timing in ms (`hummed/src/hummer/melody.ts`): the least from one onset to the next, the
// shortest note, and how long before the note after a rest the voice stops.
const TIMING = { apart: 90, shortest: 40, breathRoom: 120 };

// The hum "mm" of `hummed/research/scripts/synth_dsp.py`: harmonics falling by `tilt` dB per octave
// through Klatt's closed mouth, each resonance as [Hz, bandwidth]; with noise of some 200 to 1500 Hz,
// in the voice some 25 dB under it, in a breath some 20 dB.
const SOURCE = { tilt: 10, harmonics: 24 };
const MOUTH = { pole: [270, 100], zero: [450, 100], formants: [[480, 40], [1270, 350], [2130, 450]], lowpass: 1500 };
const AIR = { hz: 600, Q: 0.45, inVoice: 0.6, inBreath: 0.35 };
// `gain` has a note of velocity 45 at some -20 dBFS; `register` is the dB per octave taken off as the
// pitch rises towards the nasal pole, so that the line is as even as its velocities.
const LEVEL = { gain: 0.1, register: 3 };

// What the voice does (`vocal-map.ts`, `gestures.ts`), in seconds, cents and semitones.
const GLIDE = 0.035; // time constant of the pitch
const HALFWAY = GLIDE * Math.LN2; // a target taken this early is half reached at the onset
// From note to note the voice slides up to a fourth and breaks off before a wider step; a gap wider
// than `legato` is a dip, from `stop` on a silence. A dip leaves this share of the loudness.
const JOIN = { slideMost: 5, breakFor: 0.09, legato: 0.015, stop: 0.11 };
const DIP = { legato: 0.4, detached: 0.1, repeated: 0.2, lasts: 0.07 };
const BEND = { scoop: [20, 80], scoopLate: 0.04, fall: [25, 60] };
const LANDING = { cents: [10, 40], settles: 0.2, keeps: 0.35 };
const WOBBLE = { cents: 20, every: [0.125, 0.2], timeConstant: 0.06, endsBefore: 0.1 };
const EFFORT = { attack: 0.06, release: 0.35, close: 0.012, open: 0.02, tail: 0.15 }; // but for two, time constants
const HUSH = 0.2;
const SEED = 225;

/** Time of a tick in ms, read off the sung notes that were performed; NaN where under two were. */
const clockOf = (anchors) => (tick) => {
  if (anchors.length < 2) return NaN;
  const after = anchors.findIndex(([at]) => at > tick);
  const i = after < 0 ? anchors.length - 1 : Math.max(after, 1);
  const [[tick0, ms0], [tick1, ms1]] = [anchors[i - 1], anchors[i]];
  return ms0 + ((tick - tick0) * (ms1 - ms0)) / (tick1 - tick0);
};

/**
 * The sung line of a passage, in time with a performance.
 *
 * A sung note starts with the piano note it follows, at least 90 ms after the one before; where that
 * note was not performed, its time is interpolated by tick between the sung notes that were. It lasts
 * to the next sung note where that follows directly; else to its written end or the piano's key-off,
 * whichever comes first (a `pedal` note: its written end), and no further than 120 ms before the note
 * after a rest, which has `breathBefore`.
 *
 * @typedef {{ id: string, ref: string | null, pitch: number, from: number, to: number, pedal?: true }} SungNote in ticks
 * @typedef {{ notes: SungNote[], rests: { from: number, to: number }[] }} Reduction
 * @param {Reduction} reduction
 * @param {Map<string, { ms: number, msEnd: number, velocity: number }>} performed the piano notes as
 *   performed, by id, on one clock in ms
 * @param {number} fromTick
 * @param {number} toTick the passage; a sung note belongs to it if it overlaps it
 * @returns {{ pitch: number, ms: number, msEnd: number, velocity: number, breathBefore: boolean }[]} in order; times on
 *   the performance's clock
 */
export function lineOf(reduction, performed, fromTick, toTick) {
  const struck = (note) => performed.get(note.ref);
  const anchors = reduction.notes.filter(struck).map((note) => [note.from, struck(note).ms]);
  const clock = clockOf(anchors);
  const afterRest = new Set(reduction.rests.map((rest) => rest.to));

  const sung = [];
  let loudness = reduction.notes.map(struck).find(Boolean)?.velocity;
  for (const note of reduction.notes) {
    const piano = struck(note);
    const ms = Math.max(piano ? piano.ms : clock(note.from), (sung.at(-1)?.ms ?? -Infinity) + TIMING.apart);
    if (Number.isNaN(ms)) continue;
    loudness = piano?.velocity ?? loudness;
    const breathBefore = note === reduction.notes[0] || afterRest.has(note.from);
    sung.push({ note, piano, ms, velocity: loudness, breathBefore });
  }

  return sung.flatMap(({ note, piano, ms, velocity, breathBefore }, i) => {
    if (note.from >= toTick || note.to <= fromTick) return [];
    const next = sung[i + 1];
    const written = clock(note.to);
    const keyOff = piano?.msEnd ?? written;
    // Past the last performed sung note the written end is a guess. A pedal note is held on while the
    // piano moves, so its key says nothing about its end.
    const end = note.to > anchors.at(-1)[0] ? keyOff : note.pedal ? written : Math.min(written, keyOff);
    const room = next ? next.ms - Math.min(TIMING.breathRoom, (next.ms - ms) / 2) : Infinity;
    const msEnd = next?.note.from === note.to ? next.ms : Math.max(ms + TIMING.shortest, Math.min(end, room));
    return [{ pitch: note.pitch, ms, msEnd, velocity, breathBefore }];
  });
}

/** Mulberry32, drawn between two bounds: the same numbers every time, so that a passage hums the same every time. */
const seeded = (seed) => (low, high) => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return low + ((high - low) * ((t ^ (t >>> 14)) >>> 0)) / 4294967296;
};

/** Klatt's resonator, y[n] = a x[n] + b y[n-1] + c y[n-2], as the coefficients of an IIR filter. */
const resonator = (rate, [hz, bandwidth]) => {
  const c = -Math.exp((-2 * Math.PI * bandwidth) / rate);
  const b = 2 * Math.exp((-Math.PI * bandwidth) / rate) * Math.cos((2 * Math.PI * hz) / rate);
  return { feedforward: [1 - b - c], feedback: [1, -b, -c] };
};

/** The closed mouth as a row of filters: the nasal pole and zero, the formants, a low-pass. */
const tractOf = (audio) => {
  const [pole, zero, ...formants] = [MOUTH.pole, MOUTH.zero, ...MOUTH.formants].map((at) => resonator(audio.sampleRate, at));
  // A zero is its resonator upside down.
  const nasal = { feedforward: zero.feedback.map((k) => (k * pole.feedforward[0]) / zero.feedforward[0]), feedback: pole.feedback };
  const filters = [nasal, ...formants].map((coefficients) => new IIRFilterNode(audio, coefficients));
  filters.push(new BiquadFilterNode(audio, { type: 'lowpass', frequency: MOUTH.lowpass, Q: -3 })); // Q in dB: no resonance
  filters.reduce((from, to) => from.connect(to));
  return filters;
};

/** The notes on the context's clock, each as loud as its effort (`gestures.ts`) has it. */
const timed = (line, timeOf, now, exaggerate) => {
  const efforts = line.map((note) => (Math.max(note.velocity, 1) / 45) ** 1.5);
  const mean = Math.exp(efforts.reduce((sum, effort) => sum + Math.log(effort), 0) / efforts.length);
  const register = (pitch) => 10 ** ((LEVEL.register * (48 - pitch)) / 12 / 20); // about C3
  const level = (note, i) => mean * (efforts[i] / mean) ** exaggerate * register(note.pitch);
  const clocked = (ms) => Math.max(timeOf(ms), now);
  return line
    .map((note, i) => ({ ...note, on: clocked(note.ms), off: clocked(note.msEnd), level: level(note, i) }))
    .filter((note) => note.off > note.on);
};

/**
 * How the voice dips before a note of its phrase: to nothing (`depth` 0) before a step too wide to
 * slide and after a long gap, a little before a repeated or a detached note. Legato: null.
 */
const dipBefore = (note, before) => {
  const gap = note.on - before.off;
  const leap = Math.abs(note.pitch - before.pitch) > JOIN.slideMost;
  if (leap || gap >= JOIN.stop) {
    const silence = leap ? Math.min(JOIN.breakFor, (note.on - before.on) / 2) : 0;
    return { from: Math.min(before.off, note.on - silence), depth: 0 };
  }
  if (gap <= JOIN.legato && note.pitch !== before.pitch) return null;
  const detached = Math.max(0, gap - JOIN.legato) / (JOIN.stop - JOIN.legato);
  const depth = Math.min(DIP.legato + (DIP.detached - DIP.legato) * detached, note.pitch === before.pitch ? DIP.repeated : 1);
  return { from: Math.max(before.on, note.on - Math.max(DIP.lasts, gap)), depth };
};

/** The phrases of a line, each the notes from one breath to the next, a note with the `dip` before it. */
const phrasesOf = (notes) =>
  notes.reduce((phrases, note, i) => {
    const begins = note.breathBefore || !i;
    if (begins) phrases.push([]);
    phrases.at(-1).push({ ...note, dip: begins ? null : dipBefore(note, notes[i - 1]) });
    return phrases;
  }, []);

/** The pitch of a phrase in cents from A4: scooped into, landing a little off, wobbling, falling at the end. */
const intone = (detune, phrase, begin, release, random) => {
  const cents = (note) => 100 * (note.pitch - 69);
  const last = phrase.at(-1);
  detune.setValueAtTime(cents(phrase[0]) - random(...BEND.scoop), begin);
  phrase.forEach((note, i) => {
    const off = Math.sign(random(-1, 1)) * random(...LANDING.cents);
    // In a silence the pitch goes over unheard; else it is half-way there when the note begins.
    if (note.dip?.depth === 0) detune.setValueAtTime(cents(note) + off, Math.max((note.dip.from + note.on) / 2, note.on - GLIDE));
    else detune.setTargetAtTime(cents(note) + off, i ? note.on - HALFWAY : note.on + BEND.scoopLate, GLIDE);
    const until = (note === last ? release : phrase[i + 1].on) - WOBBLE.endsBefore;
    for (let at = note.on + LANDING.settles; at < until; at += random(...WOBBLE.every)) {
      const target = cents(note) + LANDING.keeps * off + random(-WOBBLE.cents, WOBBLE.cents);
      detune.setTargetAtTime(target, at, WOBBLE.timeConstant);
    }
  });
  detune.setTargetAtTime(cents(last) - random(...BEND.fall), release, (last.off - release) / 2);
};

/** The loudness of a phrase: a soft attack, each note's level, the dips between notes, a release. */
const press = (gain, phrase, begin, release) => {
  const last = phrase.at(-1);
  gain.setValueAtTime(0, begin);
  gain.setTargetAtTime(phrase[0].level, begin, EFFORT.attack);
  phrase.slice(1).forEach(({ on, level, dip }) => {
    if (dip) gain.setTargetAtTime(dip.depth * level, dip.from, dip.depth ? (on - dip.from) / 3 : EFFORT.close);
    gain.setTargetAtTime(level, dip ? on : on - HALFWAY, dip ? EFFORT.open : GLIDE);
  });
  gain.setTargetAtTime(0, release, (last.off - release) / 3);
  gain.setTargetAtTime(0, last.off, EFFORT.close);
};

/** Air drawn in between `from` and `to`, where there is time: late in the gap, swelling, and cut off 25 ms before the phrase. */
const inhale = (gain, from, to, depth) => {
  if (to - from < 0.1) return;
  const start = from + 0.35 * (to - from);
  const span = to - 0.025 - start;
  gain.setTargetAtTime(depth, start, span / 4);
  gain.setTargetAtTime(0, start + 0.6 * span, span / 8);
};

/**
 * Creates a hummed voice on an audio context: a source of falling harmonics through the nasal
 * resonances of a closed mouth, with a little air in it.
 *
 * - `hum(line, timeOf, destination, options?)` schedules a whole line of `lineOf`, but what is over;
 *   `timeOf(ms)` gives the context time of a time on the line's clock. Each phrase (the notes up to a
 *   breath) is one source, so that the pitch slides from note to note. Options: `level`, a linear gain
 *   (0.5), and `exaggerate`, how many times as far as the piano's the loudness moves about the line's
 *   mean (1.3).
 * - `hush(when?)` fades out all that sounds or is scheduled.
 *
 * @param {BaseAudioContext} audio
 */
export function createVoice(audio) {
  const runs = new Set();
  const harmonics = Float32Array.from({ length: SOURCE.harmonics + 1 }, (_, h) => (h ? h ** (-SOURCE.tilt / 6.02) : 0));
  const wave = audio.createPeriodicWave(new Float32Array(harmonics.length), harmonics);
  const noise = audio.createBuffer(1, 2 * audio.sampleRate, audio.sampleRate);
  const hiss = seeded(SEED);
  noise.copyToChannel(Float32Array.from({ length: noise.length }, () => hiss(-1, 1)), 0);

  /** What the phrases of a line share, until the last is over: the mouth, and the air in the voice and in the breaths. */
  const mouthOf = (destination, level, from, until) => {
    const master = new GainNode(audio, { gain: level * LEVEL.gain });
    // Some 150 dB down by then; exactly nothing, so that it does not matter when the nodes are taken apart.
    master.gain.setValueAtTime(0, until);
    const tract = tractOf(audio);
    tract.at(-1).connect(master).connect(destination);
    const air = new AudioBufferSourceNode(audio, { buffer: noise, loop: true });
    const band = new BiquadFilterNode(audio, { type: 'bandpass', frequency: AIR.hz, Q: AIR.Q });
    const aspiration = new GainNode(audio, { gain: AIR.inVoice });
    const breath = new GainNode(audio, { gain: 0 });
    air.connect(band).connect(aspiration);
    band.connect(breath).connect(master);
    air.start(from);
    air.stop(until);
    const mouth = { master, tract, aspiration, breath, sources: [air] };
    runs.add(mouth);
    air.onended = () => {
      master.disconnect();
      runs.delete(mouth);
    };
    return mouth;
  };

  const sing = (phrase, mouth, now, random) => {
    const last = phrase.at(-1);
    const begin = Math.max(now, phrase[0].on - HALFWAY);
    const release = Math.max((last.on + last.off) / 2, last.off - EFFORT.release);
    const source = new OscillatorNode(audio, { periodicWave: wave, frequency: 440 });
    const effort = new GainNode(audio, { gain: 0 });
    source.connect(effort).connect(mouth.tract[0]);
    mouth.aspiration.connect(effort);
    intone(source.detune, phrase, begin, release, random);
    press(effort.gain, phrase, begin, release);
    source.start(begin);
    source.stop(last.off + EFFORT.tail);
    mouth.sources.push(source);
  };

  const hum = (line, timeOf, destination, { level = 0.5, exaggerate = 1.3 } = {}) => {
    const now = audio.currentTime;
    const notes = timed(line, timeOf, now, exaggerate);
    if (!notes.length) return;
    const mouth = mouthOf(destination, level, now, notes.at(-1).off + EFFORT.tail);
    const random = seeded(SEED);
    phrasesOf(notes).forEach((phrase, i, phrases) => {
      const [first] = phrase;
      const sungUntil = i ? phrases[i - 1].at(-1).off : first.on - 0.9;
      if (first.breathBefore) inhale(mouth.breath.gain, Math.max(now, sungUntil), first.on, AIR.inBreath * first.level);
      sing(phrase, mouth, now, random);
    });
  };

  const hush = (when = audio.currentTime) => {
    for (const { master, sources } of runs) {
      master.gain.cancelScheduledValues(when);
      master.gain.setTargetAtTime(0, when, HUSH / 8);
      for (const source of sources) source.stop(when + HUSH);
    }
  };

  return { hum, hush };
}
