import { describe, expect, test } from 'vitest';
import { Alignment, type AlignedNote } from '../../../src/fitting/alignment';
import { createMpm, requireMap } from '../../../src/fitting/instructions/index';
import { deriveResidual } from '../../../src/fitting/residual';
import { computeTickTimes } from '../../../src/fitting/transformers/tempo/tickTimes';
import { at } from '../../support/at';

const note = (position: number, onset: number, velocity = 100, duration = 1000): AlignedNote =>
  ({
    'xml:id': `n_${position}`,
    date: position * 4 * 720,
    part: 1,
    pitchname: 'g',
    octave: 4,
    accidentals: 0,
    duration: 0.25 * 4 * 720,
    'midi.pitch': 67,
    'milliseconds.date': onset,
    'milliseconds.date.end': onset + duration,
    velocity,
  }) as AlignedNote;

/** Three quarter notes at 60bpm, the last one late and quiet. */
const fixture = () =>
  new Alignment([note(0, 0), note(0.25, 1000), note(0.5, 2100, 80)], {
    numerator: 4,
    denominator: 4,
  });

const withTempo = () => {
  const mpm = createMpm();
  requireMap(mpm, 'tempo', 'global').addTempo({ id: 't1', date: 0, bpm: 60, beatLength: 0.25 });
  return mpm;
};

describe('deriveResidual, tick domain', () => {
  // deriveResidual adds the render on top of the tick walk; the tick figures themselves must
  // pass through untouched.
  test('hands back exactly what the tick walk computed', () => {
    const mpm = withTempo();

    const msm = fixture();
    const computed = computeTickTimes(msm, mpm);
    const derived = deriveResidual(msm, mpm);

    expect(derived.notes.map((n) => n.tickDate)).toEqual(
      msm.allNotes.map((n) => computed.notes.get(n['xml:id'])?.tickDate),
    );
    expect(derived.notes.map((n) => n.tickDuration)).toEqual(
      msm.allNotes.map((n) => computed.notes.get(n['xml:id'])?.tickDuration),
    );
  });

  test('leaves the score it measured untouched', () => {
    const msm = fixture();
    const before = JSON.stringify(msm.allNotes);

    deriveResidual(msm, withTempo());

    expect(JSON.stringify(msm.allNotes)).toEqual(before);
  });

  test('an MPM with no tempo leaves the tick figures unknown, not zero', () => {
    const derived = deriveResidual(fixture(), createMpm());
    expect(derived.notes.map((n) => n.tickDate)).toEqual([undefined, undefined, undefined]);
  });
});

describe('deriveResidual, velocity', () => {
  // meico sounds a note at 100 when no dynamics instruction covers it, so with an MPM that
  // says nothing about dynamics the residual is the whole recorded deviation from 100.
  test('measures against 100 when the MPM says nothing about dynamics', () => {
    const derived = deriveResidual(fixture(), withTempo());
    expect(derived.notes.map((n) => n.velocity)).toEqual([0, 0, -20]);
  });

  test('measures against the curve once there is one', () => {
    const mpm = withTempo();
    requireMap(mpm, 'dynamics', 'global').addDynamics({ id: 'd1', date: 0, volume: 80 });

    const derived = deriveResidual(fixture(), mpm);
    expect(derived.notes.map((n) => n.velocity)).toEqual([20, 20, 0]);
  });

  // `withoutMaps` is what replaces each transformer subtracting its own share: hold your own
  // dimension out and what comes back is what the rest of the MPM leaves for you.
  test('without holds a dimension out of the measurement', () => {
    const mpm = withTempo();
    requireMap(mpm, 'dynamics', 'global').addDynamics({ id: 'd1', date: 0, volume: 80 });

    const withDynamics = deriveResidual(fixture(), mpm);
    const withoutDynamics = deriveResidual(fixture(), mpm, { without: ['dynamics'] });

    expect(withDynamics.notes.map((n) => n.velocity)).toEqual([20, 20, 0]);
    expect(withoutDynamics.notes.map((n) => n.velocity)).toEqual([0, 0, -20]);
  });
});

describe('deriveResidual lookups', () => {
  test('of() finds a note by identity', () => {
    const msm = fixture();
    const derived = deriveResidual(msm, withTempo());

    expect(derived.of(at(msm.allNotes, 2, 'note'))?.velocity).toBe(-20);
  });
});
