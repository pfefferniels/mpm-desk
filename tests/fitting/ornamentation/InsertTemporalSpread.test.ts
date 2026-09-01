import { expect, test } from 'vitest';
import { Alignment } from '../../../src/fitting/alignment';
import {
  FrameDomain,
  Mpm,
  createMpm,
  getInstructions,
  ornamentDraftOf,
} from '../../../src/fitting/instructions/index';
import { InsertTemporalSpread } from '../../../src/fitting/transformers/index';
import { at, only } from '../../support/at';

/**
 * Quickly generates a simple aligned note
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

/** Two notes of one chord, struck a second apart — a rolled chord, seen from the recording. */
const msmFixture = () =>
  new Alignment(
    [
      {
        ...generateNote(0, 0.25, 60),
        'milliseconds.date': 500,
        'milliseconds.date.end': 1500,
        velocity: 50,
      },
      {
        ...generateNote(0, 0.25, 67),
        'milliseconds.date': 1500,
        'milliseconds.date.end': 2500,
        velocity: 50,
      },
    ],
    [{ date: 0, numerator: 1, denominator: 4 }],
  );

/** Call the protected `transform` method for testing */
const callTransform = (transformer: InsertTemporalSpread, msm: Alignment, mpm: Mpm) => {
  interface Transformable {
    transform(msm: Alignment, mpm: Mpm): void;
  }
  (transformer as unknown as Transformable).transform(msm, mpm);
};

const run = (msm: Alignment, mpm: Mpm) =>
  callTransform(
    new InsertTemporalSpread({
      scope: 'global',
      placement: 'estimate',
      durationThreshold: 200,
      noteOffShiftTolerance: 0.2,
    }),
    msm,
    mpm,
  );

test('it describes the roll as an <ornament> in milliseconds around the estimated onset', () => {
  const msm = msmFixture();
  const mpm = createMpm();

  run(msm, mpm);

  const arpeggios = getInstructions(mpm, 'ornament', 'global');
  expect(arpeggios).toHaveLength(1);
  expect(only(arpeggios, 'ornament').noteOrder).toEqual('ascending pitch');

  // The frame belongs on the `<temporalSpread>` of a def that does not exist yet, so it is
  // parked on the element rather than said by the instruction. `StylizeOrnamentation` is what
  // eventually moves it.
  const frame = ornamentDraftOf(only(arpeggios, 'ornament').element);
  expect(frame.frameStart).toEqual(-500);
  expect(frame.frameLength).toEqual(1000);
  expect(frame.frameDomain).toEqual(FrameDomain.Milliseconds);
});

test('it collapses the rolled chord onto one onset, so a tempo can be read off it', () => {
  const msm = msmFixture();
  const mpm = createMpm();

  run(msm, mpm);

  // §0 of PORT-TO-ESPRESSIVO.md: the roll is explained, then removed, and only then is the
  // onset clean enough to measure a tempo from.
  expect(msm.allNotes.map((note) => note['milliseconds.date'])).toEqual([1000, 1000]);
});

test('a roll shorter than the threshold is left alone', () => {
  const msm = msmFixture();
  // the same note, struck 10 ms after the first rather than a second after it
  at(msm.allNotes, 1, 'note')['milliseconds.date'] = 510;
  at(msm.allNotes, 1, 'note')['milliseconds.date.end'] = 1510;
  const mpm = createMpm();

  run(msm, mpm);

  expect(getInstructions(mpm, 'ornament', 'global')).toHaveLength(0);
});
