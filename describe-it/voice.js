/* A pianist's inner voice on the Web Audio API: the hummed line of welte225.org, in time with the playing. */

// Timing, as `hummed/src/hummer/melody.ts` has it, in ms.
const SUNG_AT_LEAST = 90;
const SHORTEST = 40;
const BREATH_ROOM = 120;

// The hum "mm" of `hummed/research/scripts/synth_dsp.py`: Hz and bandwidths of Klatt's closed mouth.
const TILT = 10; // dB per octave the source's harmonics fall
const HARMONICS = 24;
const NASAL_POLE = [270, 100];
const NASAL_ZERO = [450, 100];
const FORMANTS = [[480, 40], [1270, 350], [2130, 450]];
const LOWPASS = 1500;
const AIR_BAND = { frequency: 600, Q: 0.45 }; // some 200 to 1500 Hz
const ASPIRATION = 0.1;
const BREATH = 0.05;
const REGISTER = 4; // dB per octave taken off as the pitch rises towards the nasal pole
const LEVEL = 0.4;

// Gestures, as `vocal-map.ts` and `gestures.ts` decide them, in seconds and cents.
const GLIDE = 0.035;
const HALFWAY = GLIDE * Math.LN2;
const SLIDE_MOST = 5; // semitones: a fourth
const BREAK = 0.09;
const LEGATO_WITHIN = 0.015;
const STOP_FROM = 0.11;
const SCOOP = [20, 80];
const SCOOP_LATE = 0.04;
const LANDING = [10, 40];
const SETTLE = 0.2;
const KEEP = 0.35; // share of the landing error that stays
const WOBBLE = 20;
const WOBBLE_EVERY = [0.125, 0.2];
const DRIFT = 0.06;
const FALL = [25, 60];
const ATTACK = 0.06;
const RELEASE = 0.35;
const CLOSE = 0.012;
const OPEN = 0.02;
const TAIL = 0.15;
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
 * A sung note starts with the piano note it follows, at least 90 ms after the one before; where
 * that note was not performed, its time is interpolated by tick between the sung notes that were.
 * It lasts to the next sung note where that follows directly; else to the piano's key-off or to
 * its written end, whichever comes first (a `pedal` note: its written end), and before a rest it
 * stops 120 ms short of the next onset. The note after a rest has `breathBefore`.
 *
 * @typedef {{ id: string, ref: string | null, pitch: number, from: number, to: number, pedal?: true }} SungNote ticks
 * @typedef {{ notes: SungNote[], rests: { from: number, to: number }[] }} Reduction
 * @typedef {{ pitch: number, ms: number, msEnd: number, velocity: number, breathBefore: boolean }} Hummed
 * @param {Reduction} reduction
 * @param {Map<string, { ms: number, msEnd: number, velocity: number }>} performed the piano notes
 *   as performed, by id, on one clock in ms
 * @param {number} fromTick
 * @param {number} toTick the passage; a sung note belongs to it if it overlaps it
 * @returns {Hummed[]} in order; times on the performance's clock
 */
export function lineOf(reduction, performed, fromTick, toTick) {
  const struck = (note) => performed.get(note.ref);
  const clock = clockOf(reduction.notes.filter(struck).map((note) => [note.from, struck(note).ms]));
  const afterRest = new Set(reduction.rests.map((rest) => rest.to));

  const sung = [];
  let loudness = reduction.notes.map(struck).find(Boolean)?.velocity;
  for (const note of reduction.notes) {
    const piano = struck(note);
    const ms = Math.max(piano ? piano.ms : clock(note.from), (sung.at(-1)?.ms ?? -Infinity) + SUNG_AT_LEAST);
    if (Number.isNaN(ms)) continue;
    loudness = piano?.velocity ?? loudness;
    const breathBefore = note === reduction.notes[0] || afterRest.has(note.from);
    sung.push({ note, piano, ms, velocity: loudness, breathBefore });
  }

  return sung.flatMap(({ note, piano, ms, velocity, breathBefore }, k) => {
    if (note.from >= toTick || note.to <= fromTick) return [];
    const next = sung[k + 1];
    const written = clock(note.to);
    // A pedal note is held on while the piano moves: its key says nothing about its end.
    const keyOff = note.pedal && !Number.isNaN(written) ? NaN : piano?.msEnd;
    const beforeNext = next && next.ms - Math.min(BREATH_ROOM, (next.ms - ms) / 2);
    const end = Math.min(...[written, keyOff, beforeNext].filter(Number.isFinite));
    const msEnd = next?.note.from === note.to ? next.ms : Math.max(ms + SHORTEST, end);
    return [{ pitch: note.pitch, ms, msEnd, velocity, breathBefore }];
  });
}

/** Mulberry32: the same numbers each time, so a passage hums the same each time. */
const seeded = (seed) => {
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { between: (low, high) => low + (high - low) * next(), sign: () => (next() < 0.5 ? -1 : 1) };
};

/** Klatt's resonator at `hz`, `bandwidth` wide: y[n] = a x[n] + b y[n-1] + c y[n-2]. */
const resonator = (rate, [hz, bandwidth]) => {
  const c = -Math.exp((-2 * Math.PI * bandwidth) / rate);
  const b = 2 * Math.exp((-Math.PI * bandwidth) / rate) * Math.cos((2 * Math.PI * hz) / rate);
  return { a: 1 - b - c, b, c };
};

const filterOf = (audio, type, frequency, Q) => {
  const filter = audio.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = Q;
  return filter;
};

/** The closed mouth: the nasal pole and zero, the formants and a low-pass, in a row. */
const tractOf = (audio) => {
  const pole = resonator(audio.sampleRate, NASAL_POLE);
  const zero = resonator(audio.sampleRate, NASAL_ZERO);
  // A zero is its resonator upside down.
  const nasal = audio.createIIRFilter([1, -zero.b, -zero.c].map((k) => (k * pole.a) / zero.a), [1, -pole.b, -pole.c]);
  const formants = FORMANTS.map((formant) => {
    const { a, b, c } = resonator(audio.sampleRate, formant);
    return audio.createIIRFilter([a], [1, -b, -c]);
  });
  const output = filterOf(audio, 'lowpass', LOWPASS, -3); // Q in dB: no resonance
  [nasal, ...formants, output].reduce((from, to) => from.connect(to));
  return { input: nasal, output };
};

/** Two seconds of white noise, looped: the air in the voice and in a breath. */
const airOf = (audio) => {
  const random = seeded(SEED);
  const buffer = audio.createBuffer(1, 2 * audio.sampleRate, audio.sampleRate);
  buffer.getChannelData(0).forEach((_, i, samples) => (samples[i] = random.between(-1, 1)));
  const air = audio.createBufferSource();
  air.buffer = buffer;
  air.loop = true;
  return air;
};

/** The phrases of a line: the notes from one breath to the next. */
const phrasesOf = (notes) =>
  notes.reduce((phrases, note) => {
    if (note.breathBefore || !phrases.length) phrases.push([]);
    phrases.at(-1).push(note);
    return phrases;
  }, []);

/**
 * How the voice dips before a note of its phrase: to nothing (`depth` 0) before a step too wide to
 * slide and after a key let go early, a little before a repeated or a detached note; legato: null.
 */
const dipBefore = (note, before) => {
  const gap = note.on - before.off;
  const leap = Math.abs(note.pitch - before.pitch) > SLIDE_MOST;
  if (leap || gap >= STOP_FROM) {
    const silence = leap ? Math.min(BREAK, (note.on - before.on) / 2) : 0;
    return { from: Math.min(before.off, note.on - silence), depth: 0 };
  }
  if (gap <= LEGATO_WITHIN && note.pitch !== before.pitch) return null;
  const detached = Math.max(0, gap - LEGATO_WITHIN) / (STOP_FROM - LEGATO_WITHIN);
  const depth = Math.min(0.4 - 0.3 * detached, note.pitch === before.pitch ? 0.2 : 1);
  return { from: Math.max(before.on, note.on - Math.max(0.07, gap)), depth };
};

/** The pitch of a phrase, in cents from A4: scooped into, landing a little off, wobbling, falling at the end. */
const intone = (detune, phrase, dips, begin, release, random) => {
  const cents = (note) => 100 * (note.pitch - 69);
  detune.setValueAtTime(cents(phrase[0]) - random.between(...SCOOP), begin);
  phrase.forEach((note, i) => {
    const off = random.sign() * random.between(...LANDING);
    // In a silence the pitch goes over unheard; else it is half-way when the note begins.
    if (dips[i]?.depth === 0) detune.setValueAtTime(cents(note) + off, Math.max((dips[i].from + note.on) / 2, note.on - GLIDE));
    else detune.setTargetAtTime(cents(note) + off, i ? note.on - HALFWAY : note.on + SCOOP_LATE, GLIDE);
    const until = i + 1 < phrase.length ? phrase[i + 1].on - 0.1 : release - 0.05;
    for (let at = note.on + SETTLE; at < until; at += random.between(...WOBBLE_EVERY))
      detune.setTargetAtTime(cents(note) + KEEP * off + random.between(-WOBBLE, WOBBLE), at, DRIFT);
  });
  const last = phrase.at(-1);
  detune.setTargetAtTime(cents(last) - random.between(...FALL), release, (last.off - release) / 2);
};

/** The loudness of a phrase: a soft attack, each note's level, the dips between notes, a release. */
const press = (gain, phrase, dips, begin, release) => {
  gain.setValueAtTime(0, begin);
  gain.setTargetAtTime(phrase[0].level, begin, ATTACK);
  phrase.slice(1).forEach((note, i) => {
    const dip = dips[i + 1];
    if (dip) gain.setTargetAtTime(dip.depth * note.level, dip.from, dip.depth ? (note.on - dip.from) / 3 : CLOSE);
    gain.setTargetAtTime(note.level, dip ? note.on : note.on - HALFWAY, dip ? OPEN : GLIDE);
  });
  const last = phrase.at(-1);
  gain.setTargetAtTime(0, release, (last.off - release) / 3);
  gain.setTargetAtTime(0, last.off, CLOSE);
};

/** Air drawn in between `from` and `to`: swelling, and cut off just before the phrase. */
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
 * - `hum(line, timeOf, destination, options?)` schedules a whole line of `lineOf`; `timeOf(ms)`
 *   gives the context time of a time on the line's clock. Each phrase (the notes up to a breath)
 *   is one source, so the pitch slides from note to note; a step wider than a fourth is broken by
 *   a short silence. Options: `level`, a linear gain, and `exaggerate`, how many times as far as
 *   the piano's the loudness moves about the line's mean (1 or more).
 * - `hush(when?)` fades out all that sounds or is scheduled.
 *
 * @param {BaseAudioContext} audio
 */
export function createVoice(audio) {
  const runs = new Set();
  const harmonics = Float32Array.from({ length: HARMONICS + 1 }, (_, h) => (h ? h ** (-TILT / 6.02) : 0));
  const wave = audio.createPeriodicWave(new Float32Array(HARMONICS + 1), harmonics);

  /** The notes on the context's clock, each as loud as its effort (`gestures.ts`) has it. */
  const timed = (line, timeOf, now, exaggerate) => {
    const efforts = line.map((note) => (Math.max(note.velocity, 1) / 45) ** 1.5);
    const mean = Math.exp(efforts.reduce((sum, effort) => sum + Math.log(effort), 0) / efforts.length);
    const level = (note, i) => mean * (efforts[i] / mean) ** exaggerate * 10 ** ((REGISTER * (48 - note.pitch)) / 240);
    return line
      .map((note, i) => ({ ...note, on: Math.max(timeOf(note.ms), now), off: Math.max(timeOf(note.msEnd), now), level: level(note, i) }))
      .filter((note) => note.off > note.on);
  };

  /** What all phrases of a line share: the mouth, and air for the voice and for breaths. */
  const mouthOf = (destination, level, from, until) => {
    const master = audio.createGain();
    master.gain.value = level * LEVEL;
    // Some 150 dB down by then; exactly nothing, so that it does not matter when the nodes are taken apart.
    master.gain.setValueAtTime(0, until);
    const tract = tractOf(audio);
    tract.output.connect(master).connect(destination);
    const air = airOf(audio);
    const band = filterOf(audio, 'bandpass', AIR_BAND.frequency, AIR_BAND.Q);
    const aspiration = audio.createGain();
    aspiration.gain.value = ASPIRATION;
    const breath = audio.createGain();
    breath.gain.value = 0;
    air.connect(band).connect(aspiration);
    band.connect(breath).connect(master);
    air.start(from);
    air.stop(until);
    return { master, tract, aspiration, breath, sources: [air] };
  };

  const sing = (phrase, mouth, now, random) => {
    const [first, last] = [phrase[0], phrase.at(-1)];
    const begin = Math.max(now, first.on - HALFWAY);
    const release = Math.max((last.on + last.off) / 2, last.off - RELEASE);
    const dips = phrase.map((note, i) => (i ? dipBefore(note, phrase[i - 1]) : null));
    const source = audio.createOscillator();
    source.setPeriodicWave(wave);
    source.frequency.value = 440;
    const effort = audio.createGain();
    effort.gain.value = 0;
    source.connect(effort).connect(mouth.tract.input);
    mouth.aspiration.connect(effort);
    intone(source.detune, phrase, dips, begin, release, random);
    press(effort.gain, phrase, dips, begin, release);
    source.start(begin);
    source.stop(last.off + TAIL);
    mouth.sources.push(source);
  };

  const hum = (line, timeOf, destination, { level = 0.5, exaggerate = 1.3 } = {}) => {
    const now = audio.currentTime;
    const random = seeded(SEED);
    const notes = timed(line, timeOf, now, exaggerate);
    if (!notes.length) return;
    const mouth = mouthOf(destination, level, now, notes.at(-1).off + TAIL);
    runs.add(mouth);
    mouth.sources[0].onended = () => {
      mouth.master.disconnect();
      runs.delete(mouth);
    };
    let sungUntil;
    for (const phrase of phrasesOf(notes)) {
      const [first] = phrase;
      if (first.breathBefore) inhale(mouth.breath.gain, Math.max(now, sungUntil ?? first.on - 0.9), first.on, BREATH * first.level);
      sing(phrase, mouth, now, random);
      sungUntil = phrase.at(-1).off;
    }
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
