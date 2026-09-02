import { describe, expect, test } from 'vitest';
import { performMsmToData } from 'espressivo';
import { Alignment } from '../../../src/fitting/alignment';
import {
  Mpm,
  createMpm,
  exportMPM,
  getInstructions,
  ornamentDraftOf,
  requireMap,
} from '../../../src/fitting/instructions/index';
import {
  InsertDynamicsGradient,
  StylizeOrnamentation,
  gradientThrough,
  rampVelocities,
} from '../../../src/fitting/transformers/index';
import { at, only } from '../../support/at';

/**
 * Quickly generates a simple MSM note
 * @note Example for duration and position: 0.25 = quarter note etc.
 */
const generateNote = (position: number, duration: number, pitch: number, part = 1) => ({
  'xml:id': `n_${part}_${pitch}`,
  date: position * 4 * 720,
  part: part,
  staff: String(part),
  layer: '1',
  pitchname: 'g',
  octave: 4,
  duration: duration * 4 * 720,
  accidentals: 0,
  'midi.pitch': pitch,
});

/** A rolled chord whose second note is the louder one. */
const msmFixture = () =>
  new Alignment(
    [
      {
        ...generateNote(0, 0.25, 60),
        'milliseconds.date': 1000,
        'milliseconds.date.end': 2000,
        velocity: 50,
      },
      {
        ...generateNote(0, 0.25, 67),
        'milliseconds.date': 1100,
        'milliseconds.date.end': 2100,
        velocity: 100,
      },
    ],
    [{ date: 0, numerator: 1, denominator: 4 }],
  );

/**
 * A chord rolled bottom up, 100 ms between the strokes, at these velocities in the order struck.
 * Pitches 60, 64 and 67, so the notes are `n_1_60`, `n_1_64` and `n_1_67`.
 */
const rolled = (velocities: readonly [number, number, number]) =>
  new Alignment(
    [60, 64, 67].map((pitch, i) => ({
      ...generateNote(0, 0.25, pitch),
      'milliseconds.date': 1000 + 100 * i,
      'milliseconds.date.end': 2000 + 100 * i,
      velocity: at(velocities, i, 'velocity'),
    })),
    [{ date: 0, numerator: 1, denominator: 4 }],
  );

/** Call the protected `transform` method for testing */
const callTransform = (transformer: InsertDynamicsGradient | StylizeOrnamentation, msm: Alignment, mpm: Mpm) => {
  interface Transformable {
    transform(msm: Alignment, mpm: Mpm): void;
  }
  (transformer as unknown as Transformable).transform(msm, mpm);
};

/**
 * The ramp the transformer fitted, read off the ornament it parked it on.
 *
 * The two ends are `<dynamicsGradient>` fields, not `<ornament>` attributes, so they are not part
 * of the instruction and are read through the draft rather than off the options record.
 */
const gradientOf = (mpm: Mpm, index: number) =>
  ornamentDraftOf(at(getInstructions(mpm, 'ornament', 'global'), index, 'ornament').element);

test('it fits a rising chord to the crescendo gradient and flattens the velocities', () => {
  const msm = msmFixture();
  const mpm = createMpm();

  callTransform(
    new InsertDynamicsGradient({
      scope: 'global',
      crescendo: { from: -1, to: 0 },
      decrescendo: { from: 0, to: -1 },
      sortVelocities: true,
    }),
    msm,
    mpm,
  );

  const ornaments = getInstructions(mpm, 'ornament', 'global');
  expect(ornaments).toHaveLength(1);
  expect(gradientOf(mpm, 0).transitionFrom).toBe(-1);
  expect(gradientOf(mpm, 0).transitionTo).toBe(0);
  expect(only(ornaments, 'ornament').scale).toBe(50);

  // The gradient having explained the spread, every note carries the same velocity.
  expect(msm.allNotes.map((n) => n.velocity)).toEqual([100, 100]);
});

test('it works with the constructor defaults, which do not sort velocities', () => {
  const msm = msmFixture();
  const mpm = createMpm();

  // `sortVelocities: false` used to leave the gradient unchosen and throw here.
  // See old-bugs.md.
  callTransform(new InsertDynamicsGradient(), msm, mpm);

  const ornaments = getInstructions(mpm, 'ornament', 'global');
  expect(ornaments).toHaveLength(1);
  expect(gradientOf(mpm, 0).transitionFrom).toBe(-1);
  expect(gradientOf(mpm, 0).transitionTo).toBe(0);
});

test('a chord whose notes are equally loud gets no gradient', () => {
  const msm = msmFixture();
  at(msm.allNotes, 1, 'note').velocity = 50;
  const mpm = createMpm();

  callTransform(new InsertDynamicsGradient(), msm, mpm);

  expect(getInstructions(mpm, 'ornament', 'global')).toHaveLength(0);
});

test('a single explicit gradient is fitted to the chord on its date', () => {
  const msm = msmFixture();
  const mpm = createMpm();

  // The chord is looked up in the map `transform` builds once, rather than by regrouping the
  // whole score inside `applyGradient`. See issue #49.
  callTransform(
    new InsertDynamicsGradient({
      scope: 'global',
      date: 0,
      gradient: { from: 0, to: 1 },
      sortVelocities: false,
    }),
    msm,
    mpm,
  );

  const ornaments = getInstructions(mpm, 'ornament', 'global');
  expect(ornaments).toHaveLength(1);
  expect(only(ornaments, 'ornament').date).toBe(0);
  expect(only(ornaments, 'ornament').scale).toBe(50);
});

test('a single gradient on a date with no chord does nothing', () => {
  const msm = msmFixture();
  const mpm = createMpm();

  callTransform(
    new InsertDynamicsGradient({
      scope: 'global',
      date: 2880,
      gradient: { from: 0, to: 1 },
      sortVelocities: false,
    }),
    msm,
    mpm,
  );

  expect(getInstructions(mpm, 'ornament', 'global')).toHaveLength(0);
});

describe('what MPM cannot hold is refused', () => {
  const single = (gradient: { from: number; to: number }) =>
    new InsertDynamicsGradient({ scope: 'global', date: 0, gradient, sortVelocities: false });

  // The onsets, in seconds, that the desk's line handle used to send as a ramp: issue #29.
  test('a ramp beyond the -1…1 a <dynamicsGradient> allows', () => {
    expect(() =>
      callTransform(single({ from: 28.62, to: 28.75 }), msmFixture(), createMpm()),
    ).toThrow('between -1 and 1');
  });

  test('a ramp with no slope, which only an infinite scale could stretch', () => {
    expect(() => callTransform(single({ from: 0.5, to: 0.5 }), msmFixture(), createMpm())).toThrow(
      'no slope',
    );
  });
});

describe('rampVelocities', () => {
  test('left alone, the ramp is the velocities in the order the notes were struck', () => {
    expect(rampVelocities(rolled([40, 90, 70]).allNotes, false)).toEqual([40, 90, 70]);
  });

  test("sorted, the velocities are redealt along the roll in the chord's own direction", () => {
    expect(rampVelocities(rolled([40, 90, 70]).allNotes, true)).toEqual([40, 70, 90]);
    expect(rampVelocities(rolled([70, 40, 90]).allNotes, true)).toEqual([40, 70, 90]);
    expect(rampVelocities(rolled([90, 40, 70]).allNotes, true)).toEqual([90, 70, 40]);
  });

  test('the ramp runs in onset order however the chord is listed, over the notes that sounded', () => {
    const notes = rolled([40, 70, 90]).allNotes;
    expect(rampVelocities([at(notes, 2), at(notes, 0), at(notes, 1)], false)).toEqual([40, 70, 90]);

    at(notes, 1)['milliseconds.date'] = NaN;
    expect(rampVelocities(notes, false)).toEqual([40, 90]);
  });
});

describe('gradientThrough', () => {
  test('puts the standard where it was chosen, in the units a <dynamicsGradient> takes', () => {
    expect(gradientThrough(40, [40, 70, 90])).toEqual({ from: 0, to: 1 });
    expect(gradientThrough(90, [40, 70, 90])).toEqual({ from: -1, to: 0 });
    expect(gradientThrough(65, [40, 70, 90])).toEqual({ from: -0.5, to: 0.5 });
  });

  test('reads the ramp the way it runs, so a chord rolled from loud to soft is not mirrored', () => {
    expect(gradientThrough(90, [90, 60, 40])).toEqual({ from: 0, to: 1 });
    expect(gradientThrough(40, [90, 60, 40])).toEqual({ from: -1, to: 0 });
  });

  test('holds a standard beyond either end on that end, within the -1…1 MPM allows', () => {
    expect(gradientThrough(120, [40, 70, 90])).toEqual({ from: -1, to: 0 });
    expect(gradientThrough(10, [40, 70, 90])).toEqual({ from: 0, to: 1 });
  });

  test("a flat or an empty ramp keeps the first note's velocity", () => {
    expect(gradientThrough(50, [50, 50])).toEqual({ from: 0, to: 1 });
    expect(gradientThrough(50, [])).toEqual({ from: 0, to: 1 });
  });
});

/**
 * What espressivo makes of the document: the two velocities the ramp was measured between come
 * back exactly, whichever standard was chosen for the chord, with the note between them on the
 * straight line a `<dynamicsGradient>` draws. The recording is left flattened at that standard,
 * which is what a dynamics instruction then has to say.
 *
 * `StylizeOrnamentation` has to run: the ramp is parked on the element until it has an
 * `<ornamentDef>` to live on, and an ornament naming `neutralArpeggio` is one the renderer skips.
 */
describe('the performed ramp meets the recorded ends', () => {
  const stylize = () =>
    new StylizeOrnamentation({ tickTolerance: 10, gradientTolerance: 0.1, intensityTolerance: 0.3 });

  const performedVelocities = (msm: Alignment, mpm: Mpm): number[] => {
    const score = msm.serializeScore();
    expect(score).toBeTruthy();
    const data = performMsmToData({ msm: score!, mpm: exportMPM(mpm) });
    const byId = new Map(
      data.parts.flatMap((part) => part.notes.map((note) => [note.id, note.velocity] as const)),
    );
    return ['n_1_60', 'n_1_64', 'n_1_67'].map((id) => Number(byId.get(id)?.toFixed(6)));
  };

  test.each([
    ['a crescendo with its standard at the first note', [40, 70, 90], 40, true],
    ['a crescendo with its standard between the ends', [40, 70, 90], 70, true],
    ['a chord rolled from loud to soft, its standard at the loudest', [90, 60, 40], 90, true],
    ['an unsorted roll, whose ramp runs from the first note struck to the last', [40, 90, 70], 55, false],
  ] as const)('%s', (_, velocities, standard, sortVelocities) => {
    const msm = rolled(velocities);
    const mpm = createMpm();
    callTransform(
      new InsertDynamicsGradient({
        scope: 'global',
        date: 0,
        gradient: gradientThrough(standard, rampVelocities(msm.allNotes, sortVelocities)),
        sortVelocities,
      }),
      msm,
      mpm,
    );

    expect(msm.allNotes.map((note) => note.velocity)).toEqual([standard, standard, standard]);
    requireMap(mpm, 'dynamics', 'global').addDynamics({ date: 0, volume: standard });
    callTransform(stylize(), msm, mpm);

    const ramp = rampVelocities(rolled(velocities).allNotes, sortVelocities);
    const first = at(ramp, 0, 'velocity');
    const last = at(ramp, 2, 'velocity');
    expect(performedVelocities(msm, mpm)).toEqual([first, (first + last) / 2, last]);
  });
});
