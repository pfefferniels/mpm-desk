import { expect, test } from 'vitest';
import { Alignment } from '../../../src/fitting/alignment';
import {
  Mpm,
  createMpm,
  getInstructions,
  ornamentDraftOf,
} from '../../../src/fitting/instructions/index';
import { InsertDynamicsGradient } from '../../../src/fitting/transformers/index';
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
    { numerator: 1, denominator: 4 },
  );

/** Call the protected `transform` method for testing */
const callTransform = (transformer: InsertDynamicsGradient, msm: Alignment, mpm: Mpm) => {
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
