import { describe, expect, test } from 'vitest';
import { Alignment } from '../../src/fitting/alignment';
import { runFit } from '../../src/fitting/fit';
import {
  getInstructions,
  ornamentDraftOf,
  parseMPM,
} from '../../src/fitting/instructions/index';
import type { WorkFile } from '../../src/model/Work';
import { only } from '../support/at';
import '../../src/fitting/transformers/Order';

/**
 * What `runFit` keeps of a run for the two style desks: the document as a call found it.
 *
 * A style call moves what the fitters measured into shared definitions and clears it off the
 * instructions, so the finished document cannot say where any ornament stood before it was
 * clustered, and the Styles desk drew the reconstruction's 97 spreads as an empty plot. What the
 * desk plots is the document from just before the call, and this is where it comes from.
 */

/** Two notes of one chord, struck a second apart — a rolled chord, seen from the recording. */
const rolledChord = () =>
  new Alignment(
    [60, 67].map((pitch, i) => ({
      'xml:id': `n_${pitch}`,
      date: 0,
      part: 1,
      staff: '1',
      layer: '1',
      pitchname: 'g',
      octave: 4,
      duration: 720,
      accidentals: 0,
      'midi.pitch': pitch,
      'milliseconds.date': 500 + i * 1000,
      'milliseconds.date.end': 1500 + i * 1000,
      velocity: 50,
    })),
    [{ date: 0, numerator: 1, denominator: 4 }],
  );

/** The ramp and the spread fitted, then stylized: the reconstruction's arpeggiation in small. */
const work: WorkFile = {
  name: '',
  mei: '',
  mpm: '',
  provenance: [
    {
      id: 'gradient',
      name: 'InsertDynamicsGradient',
      options: {
        scope: 'global',
        crescendo: { from: -1, to: 0 },
        decrescendo: { from: 0, to: -1 },
        sortVelocities: true,
      },
    },
    {
      id: 'spread',
      name: 'InsertTemporalSpread',
      options: {
        scope: 'global',
        placement: 'estimate',
        durationThreshold: 200,
        noteOffShiftTolerance: 0.2,
      },
    },
    {
      id: 'style',
      name: 'StylizeOrnamentation',
      options: { tickTolerance: 10, intensityTolerance: 0.3, gradientTolerance: 0.1 },
    },
  ],
};

const frameOf = (xml: string | undefined) => {
  if (xml === undefined) throw new Error('nothing was kept');
  const ornament = only(getInstructions(parseMPM(xml), 'ornament', 'global'), 'ornament');
  return ornamentDraftOf(ornament.element);
};

describe('the document as a call found it', () => {
  test('still carries the frame the style call went on to clear', () => {
    const result = runFit(work, rolledChord(), { before: ['StylizeOrnamentation'] });

    expect(frameOf(result.before.StylizeOrnamentation)).toMatchObject({
      frameStart: -500,
      frameLength: 1000,
    });
    expect(frameOf(result.mpm)).toEqual({});
  });

  test('is kept only for a call the chain holds, and only when asked for', () => {
    expect(runFit(work, rolledChord(), { before: ['StylizeArticulation'] }).before).toEqual({});
    expect(runFit(work, rolledChord()).before).toEqual({});
  });

  /** It is read off the run, so it must not be able to change what the run writes. */
  test('leaves the finished document as it is', () => {
    expect(runFit(work, rolledChord(), { before: ['StylizeOrnamentation'] }).mpm).toBe(
      runFit(work, rolledChord()).mpm,
    );
  });
});
