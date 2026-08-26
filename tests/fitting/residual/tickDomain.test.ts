import { expect, test } from 'vitest';
import { Alignment, type AlignedNote } from '../../../src/fitting/alignment';
import { createMpm, Mpm, requireMap } from '../../../src/fitting/instructions/index';
import {
  computeTickTimes,
  emptyTickTimes,
} from '../../../src/fitting/transformers/tempo/tickTimes';
import { removeRubatoDistortion } from '../../../src/fitting/transformers/rubato/rubatoMath';

const QUARTER = 720;
const FRAME = 4 * QUARTER;

/**
 * Eight quarter notes at a nominal 60bpm — a second to the beat — played with a push and pull
 * inside each bar. The offsets are milliseconds off the beat.
 */
const OFFSETS = [0, -60, 90, 20, 0, -50, 80, 30];

/**
 * `heldOverTheBoundary` gives `n3` — the last note of the first frame — a symbolic duration of
 * two quarters, so that its *end* falls inside the second frame while its onset stays in the
 * first. That is the only shape that makes the second correction's frame lookup observable:
 * with every note a quarter long, no note's end reaches past its own frame at all.
 */
const fixture = (heldOverTheBoundary = false) =>
  new Alignment(
    OFFSETS.map(
      (offset, beat) =>
        ({
          'xml:id': `n${beat}`,
          date: beat * QUARTER,
          part: 1,
          pitchname: 'g',
          octave: 4,
          accidentals: 0,
          duration: heldOverTheBoundary && beat === 3 ? 2 * QUARTER : QUARTER,
          'midi.pitch': 67,
          'milliseconds.date': beat * 1000 + offset,
          'milliseconds.date.end': beat * 1000 + offset + 1000,
          velocity: 100,
        }) as AlignedNote,
    ),
    { numerator: 4, denominator: 4 },
  );

const withTempo = () => {
  const mpm = createMpm();
  requireMap(mpm, 'tempo', 'global').addTempo({ id: 't1', date: 0, bpm: 60, beatLength: 0.25 });
  return mpm;
};

const rubatoAt = (mpm: Mpm, date: number) =>
  requireMap(mpm, 'rubato', 'global').addRubato({
    id: `r${date}`,
    date,
    frameLength: FRAME,
    intensity: 0.65,
  });

/**
 * The tick walk is three steps — onsets, then durations measured from them, then the rubato warp
 * taken back off — and the order is the whole of what `computeTickTimes` adds over calling them
 * itself. Getting it wrong, or dropping the third step, would still typecheck and would still
 * produce plausible positions. This is what says the compensation happens at all.
 */
test('a rubato in the document comes back off the derived positions', () => {
  const msm = fixture();

  const tempoOnly = computeTickTimes(msm, withTempo());

  const mpm = withTempo();
  rubatoAt(mpm, 0);
  const compensated = computeTickTimes(msm, mpm);

  const before = msm.allNotes.map((n) => tempoOnly.notes.get(n['xml:id'])!.tickDate);
  const after = msm.allNotes.map((n) => compensated.notes.get(n['xml:id'])!.tickDate);

  expect(after).not.toEqual(before);
  // The frame's own start is its fixed point: the warp moves notes within a frame, not the
  // frame itself, so the note sitting on the boundary does not move.
  expect(after[0]).toEqual(before[0]);
});

test('the walk leaves the score exactly as it found it', () => {
  const msm = fixture();
  const before = JSON.stringify(msm.allNotes);

  const mpm = withTempo();
  rubatoAt(mpm, 0);
  computeTickTimes(msm, mpm);

  expect(JSON.stringify(msm.allNotes)).toEqual(before);
});

/**
 * Why a compensation applied over the whole document is not the same as one applied per frame.
 *
 * `removeRubatoDistortion`'s second correction walks from where the note ends and asks which
 * rubato is in force *there*. A note whose duration reaches past its own frame therefore depends
 * on whether the next frame is in the document — which, while `InsertRubato` compensated the
 * score one frame at a time, it was not. Nothing does that any more, but the sensitivity is
 * still in the arithmetic and is worth having written down.
 *
 * A rubato reaches exactly one frame: with the second one absent, nothing is in force at the
 * held note's end and the correction is skipped outright.
 */
test('the second duration correction depends on which frames are present', () => {
  const held = () => {
    const times = emptyTickTimes();
    fixture().allNotes.forEach((note, beat) => {
      times.notes.set(note['xml:id'], { tickDate: beat * QUARTER, tickDuration: QUARTER * 2 });
    });
    return times;
  };

  const oneFrame = withTempo();
  rubatoAt(oneFrame, 0);

  const twoFrames = withTempo();
  rubatoAt(twoFrames, 0);
  rubatoAt(twoFrames, FRAME);

  const a = held();
  removeRubatoDistortion(fixture(true), oneFrame, 'global', a);
  const b = held();
  removeRubatoDistortion(fixture(true), twoFrames, 'global', b);

  // The note whose end crosses out of frame 1 is corrected in one and not the other...
  expect(a.notes.get('n3')!.tickDuration).not.toEqual(b.notes.get('n3')!.tickDuration);
  // ... while one sitting wholly inside frame 1 is untouched by the difference.
  expect(a.notes.get('n0')!.tickDuration).toEqual(b.notes.get('n0')!.tickDuration);
});

/**
 * The counterpart, and the reason the case above had to be given a held note to measure.
 *
 * A note whose end lands *exactly* on a frame boundary is corrected identically whether the next
 * frame is there or not, and by two different routes: with the frame absent the lookup finds
 * nothing and skips, with it present the lookup finds it and corrects by zero. Both are right,
 * because a boundary is a fixed point of the warp — the same fact the first test states from the
 * onset side.
 *
 * This is not a fact the suite used to hold. It could not: the inverse was a bisection that
 * stopped as soon as its *output* was within a tick, so the two routes came out 0.011 ticks
 * apart and a `not.toEqual` on this very note passed on that noise. The closed-form inverse
 * makes them equal, which is what a fixed point means.
 */
test('a note ending on a frame boundary is corrected the same either way', () => {
  const held = () => {
    const times = emptyTickTimes();
    fixture().allNotes.forEach((note, beat) => {
      times.notes.set(note['xml:id'], { tickDate: beat * QUARTER, tickDuration: QUARTER * 2 });
    });
    return times;
  };

  const oneFrame = withTempo();
  rubatoAt(oneFrame, 0);

  const twoFrames = withTempo();
  rubatoAt(twoFrames, 0);
  rubatoAt(twoFrames, FRAME);

  const a = held();
  removeRubatoDistortion(fixture(), oneFrame, 'global', a);
  const b = held();
  removeRubatoDistortion(fixture(), twoFrames, 'global', b);

  // n3 ends at 2880, which is where frame 1 stops and frame 2 begins.
  expect(a.notes.get('n3')!.tickDuration).toEqual(b.notes.get('n3')!.tickDuration);
});
