import { expect, test } from 'vitest';
import { Alignment } from '../../../src/fitting/alignment';
import {
  Mpm,
  createMpm,
  exportMPM,
  getInstructions,
} from '../../../src/fitting/instructions/index';
import { InsertDynamicsInstructions } from '../../../src/fitting/transformers/index';
import { deriveResidual } from '../../../src/fitting/residual';
import { at } from '../../support/at';

/**
 * Quickly generates a simple aligned note
 * @note Example for duration and position: 0.25 = quarter note etc.
 */
const generateNote = (position: number, duration: number, part = 1) => ({
  'xml:id': `n_${part}_${position}`,
  date: position * 4 * 720,
  part: part,
  pitchname: 'g',
  octave: 4,
  duration: duration * 4 * 720,
  accidentals: 0,
  'midi.pitch': 67,
});

const msmFixture = () =>
  new Alignment(
    [
      {
        ...generateNote(0, 0.25),
        'milliseconds.date': 1000,
        'milliseconds.date.end': 2000,
        velocity: 50,
      },
      {
        ...generateNote(0.25, 0.25),
        'milliseconds.date': 2000,
        'milliseconds.date.end': 4000,
        velocity: 75,
      },
      {
        ...generateNote(0.5, 0.25),
        'milliseconds.date': 3000,
        'milliseconds.date.end': 6000,
        velocity: 100,
      },
    ],
    { numerator: 3, denominator: 4 },
  );

/** Call the protected `transform` method for testing */
const callTransform = (transformer: InsertDynamicsInstructions, msm: Alignment, mpm: Mpm) => {
  interface Transformable {
    transform(msm: Alignment, mpm: Mpm): void;
  }
  (transformer as unknown as Transformable).transform(msm, mpm);
};

const run = (msm: Alignment, mpm: Mpm) =>
  callTransform(
    new InsertDynamicsInstructions({
      scope: 'global',
      from: 0,
      to: msm.lastDate(),
      phantomVelocities: new Map(),
    }),
    msm,
    mpm,
  );

test('it fits one <dynamics> across the range, from the first velocity to the last', () => {
  const msm = msmFixture();
  const mpm = createMpm();

  run(msm, mpm);

  const dynamics = getInstructions(mpm, 'dynamics', 'global');
  expect(at(dynamics, 0, 'dynamics').date).toBe(0);
  expect(at(dynamics, 0, 'dynamics').volume).toBe(50);
  expect(at(dynamics, 0, 'dynamics').transitionTo).toBe(100);
});

// The closing instruction (issue #24) is now checked structurally on *every* fitted MPM the
// round-trip suite produces, rather than on this one fixture: see the 'every transition is
// closed' invariant in tests/fitting/roundtrip/invariants.ts.

test('the fitted curve explains the notes at both ends of its span exactly', () => {
  const msm = msmFixture();
  const mpm = createMpm();

  run(msm, mpm);

  // The reduction: recorded minus explained. Asked of the document rather than read off the
  // notes — the fit no longer leaves anything behind for the next step to find.
  const residual = deriveResidual(msm, mpm);

  // The curve starts at the instruction's own volume, so the note under it is fully
  // explained. What the curve misses in between is exactly what survives. The tail no longer
  // does: closing the transition makes the span the residual is measured over the same span
  // the curve was fitted over (see old-bugs.md §1, and issue #24).
  expect(residual.of(at(msm.allNotes, 0, 'note'))!.velocity).toBeCloseTo(0, 5);
  expect(residual.of(at(msm.allNotes, msm.allNotes.length - 1, 'note'))!.velocity).toBeCloseTo(
    0,
    5,
  );
});

test('the fitting window is not written into the document', () => {
  const msm = msmFixture();
  const mpm = createMpm();

  run(msm, mpm);

  // `endDate` is a working field of the fit, not an MPM attribute. See old-bugs.md.
  expect(exportMPM(mpm)).not.toContain('endDate');
});

// Superseded by tests/fitting/roundtrip: 'dynamics: linear crescendo 40 to 100' renders the fit and
// measures the velocity error against the performance it was fitted to, which is strictly
// stronger than asserting the middle note lies between the outer two.

/**
 * A phantom velocity is what the caller says the curve should pass through at a date, and it
 * stands in for the chord's own mean whether or not it happens to be `0`. `phantomVelocity ||
 * velocity` read a phantom of 0 as no phantom at all — and a dynamics fading to silence is
 * precisely the case a caller reaches for one (issue #46).
 */
test('a phantom velocity of 0 is used, not read as an absent one', () => {
  const msm = msmFixture();
  const mpm = createMpm();

  callTransform(
    new InsertDynamicsInstructions({
      scope: 'global',
      from: 0,
      to: msm.lastDate(),
      phantomVelocities: new Map([[msm.lastDate(), 0]]),
    }),
    msm,
    mpm,
  );

  expect(at(getInstructions(mpm, 'dynamics', 'global'), 0, 'dynamics').transitionTo).toBe(0);
});

/**
 * `0 / 0` is not a velocity. A date with neither a phantom nor a note carrying a `velocity` has
 * nothing to contribute, and a point whose velocity is NaN is not a point.
 */
test('a chord with no measured velocity contributes no point rather than a NaN one', () => {
  const msm = msmFixture();
  for (const note of msm.allNotes) {
    (note as Partial<typeof note>).velocity = undefined;
  }
  const mpm = createMpm();

  run(msm, mpm);

  expect(getInstructions(mpm, 'dynamics', 'global')).toHaveLength(0);
});
