import { describe, expect, test } from 'vitest';
import { Alignment, type AlignedNote } from '../../../src/fitting/alignment';
import { createMpm, requireMap } from '../../../src/fitting/instructions/index';
import { deriveResidual } from '../../../src/fitting/residual';
import { MakeChoice } from '../../../src/fitting/transformers/choice/MakeChoice';
import { runFit } from '../../../src/fitting/fit';
import { EMPTY_WORK } from '../../../src/model/workReducer';
import '../../../src/fitting/transformers/Order';

/**
 * A recording that is still two recordings, which is what a document looks like before its base
 * text has been chosen.
 *
 * An `xml:id` names a note of the *score*, so a take apiece leaves two rows under the one id — and
 * a residual is one number per note. Neither of the two collapses that used to happen was stated
 * anywhere, and they ran opposite ways: the residual's lookups kept the last row, while
 * `Alignment.build`, which is the score the rendering is computed from, keeps the first. What came
 * back read like any other residual and measured one take against another (issue #49).
 */

const note = (position: number, source: string, onset: number, velocity: number): AlignedNote =>
  ({
    'xml:id': `n_${String(position)}`,
    date: position * 4 * 720,
    part: 1,
    pitchname: 'g',
    octave: 4,
    accidentals: 0,
    duration: 0.25 * 4 * 720,
    'midi.pitch': 67,
    'milliseconds.date': onset,
    'milliseconds.date.end': onset + 1000,
    velocity,
    source,
  }) as AlignedNote;

/** Three quarter notes read twice, the second take quieter and a little later. */
const twoTakes = () =>
  new Alignment(
    [0, 0.25, 0.5].flatMap((position) => [
      note(position, 'welte', position * 4000, 100),
      note(position, 'hupfeld', position * 4000 + 40, 60),
    ]),
    [{ date: 0, numerator: 4, denominator: 4 }],
  );

const withTempo = () => {
  const mpm = createMpm();
  requireMap(mpm, 'tempo', 'global').addTempo({ id: 't1', date: 0, bpm: 60, beatLength: 0.25 });
  return mpm;
};

describe('deriveResidual over readings that still stand', () => {
  test('refuses rather than answering off whichever row it kept', () => {
    expect(() => deriveResidual(twoTakes(), withTempo())).toThrow(/more than one reading/);
  });

  test('says how many notes are still to be chosen, and what would settle it', () => {
    expect(() => deriveResidual(twoTakes(), withTempo())).toThrow(/3 notes/);
    expect(() => deriveResidual(twoTakes(), withTempo())).toThrow(/base text/);
  });

  // The remedy the message names, and the proof that what comes back afterwards is the chosen
  // take: espressivo sounds a note at 100 where no dynamics instruction covers it, so the second
  // take's 60 reads as -40 and the first take's 100 as 0.
  test('answers the chosen take once a choice has been made', () => {
    const msm = twoTakes();
    new MakeChoice({ prefer: 'hupfeld' }).run(msm, createMpm());

    const derived = deriveResidual(msm, withTempo());

    expect(derived.notes.map((n) => n.velocity)).toEqual([-40, -40, -40]);
  });
});

/**
 * The fold has to keep working on such a document, because choosing a base text is a call like any
 * other: a chain that could not run over an unchosen alignment could never produce a chosen one.
 * So `runFit` asks for no residual there, and the desks that plot one are greyed out meanwhile.
 */
describe('the fold over a document waiting for its base text', () => {
  test('runs, and hands back both readings as the ground', () => {
    const result = runFit(EMPTY_WORK, twoTakes());

    expect(result.ground.notes).toHaveLength(6);
    expect(result.mpm).toContain('<mpm');
  });
});
