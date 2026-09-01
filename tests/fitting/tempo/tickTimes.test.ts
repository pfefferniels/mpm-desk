import { describe, expect, test } from 'vitest';
import { Alignment, type AlignedNote } from '../../../src/fitting/alignment';
import {
  type InstructionOptions,
  createMpm,
  requireMap,
} from '../../../src/fitting/instructions/index';
import { computeTickTimes } from '../../../src/fitting/transformers/tempo/tickTimes';
import { placeTempos, segmentAtMs } from '../../../src/fitting/transformers/tempo/placedTempos';
import { at } from '../../support/at';

const QUARTER = 720;
const BOUNDARY = 2 * QUARTER;

/**
 * Four quarters under two tempo instructions, recorded so that the boundary does **not** land
 * where the notation puts it.
 *
 * That gap is the whole point. The `<tempo>` says the first two beats last 2 000 ms; the
 * recording says the note on the boundary sounded at 1 800 ms. `placeTempos` calls the first
 * figure `modelledMs` and the second `measuredMs`, and advances its cursor by the second — so a
 * window built from `modelledMs` overlaps the next segment by 200 ms, and one that stops at the
 * last `measuredMs` leaves everything after 3 800 ms with no segment at all. Both were happening
 * (issue #27), and a recording where the two figures happen to agree cannot see either.
 */
const score = () => {
  const msm = new Alignment(
    [0, 1, 2, 3].map((beat) => {
      // The note on the boundary arrives 200 ms early; the rest are played as written.
      const onset = beat === 2 ? 1800 : beat * 1000;
      return {
        'xml:id': `n${beat}`,
        date: beat * QUARTER,
        part: 1,
        pitchname: 'g',
        octave: 4,
        accidentals: 0,
        duration: QUARTER,
        'midi.pitch': 67,
        velocity: 100,
        'milliseconds.date': onset,
        'milliseconds.date.end': onset + 1000,
      } as AlignedNote;
    }),
    [{ date: 0, numerator: 4, denominator: 4 }],
  );

  msm.pedals = [
    // Down exactly with the note that dates the boundary, so its tick position is knowable
    // without doing any of the arithmetic under test: it is that note's.
    {
      'xml:id': 'ped_boundary',
      type: 'sustain',
      'milliseconds.date': 1800,
      'milliseconds.date.end': 2300,
    },
    // Down after the last modelled moment of the piece, and released later still.
    {
      'xml:id': 'ped_late',
      type: 'sustain',
      'milliseconds.date': 3500,
      'milliseconds.date.end': 3900,
    },
  ];
  return msm;
};

const twoTempi = () => {
  const mpm = createMpm();
  const tempi = requireMap(mpm, 'tempo', 'global');
  for (const [id, date] of [
    ['t0', 0],
    ['t1', BOUNDARY],
  ] as const) {
    tempi.addTempo({ id, date, bpm: 60, beatLength: 0.25 });
  }
  return mpm;
};

describe('every recorded event gets a position', () => {
  /**
   * The assertion issue #27 asks for: not "these notes are at these ticks", but that nothing
   * came out unplaced. The last note of the run is released at 4 000 ms, and the final
   * segment's `measuredMs` reaches 3 800 — so under a closed last window it had a `tickDate`
   * and no `tickDuration`. `InsertRubato` checks for that and abandons the whole frame;
   * `InsertArticulation` did not check, and `undefined - note.duration` reached the document.
   */
  test('a note released after the last modelled moment still gets a tickDuration', () => {
    const msm = score();
    const times = computeTickTimes(msm, twoTempi());

    for (const note of msm.allNotes) {
      const time = times.notes.get(note['xml:id']);
      expect(time?.tickDate, `${note['xml:id']} has no tickDate`).toBeDefined();
      expect(time?.tickDuration, `${note['xml:id']} has no tickDuration`).toBeDefined();
    }
  });

  /** The same for pedals, which are filtered by the millisecond window and nothing else. */
  test('a pedal down after the last modelled moment still gets both', () => {
    const msm = score();
    const times = computeTickTimes(msm, twoTempi());

    for (const pedal of msm.pedals) {
      const time = times.pedals.get(pedal['xml:id']);
      expect(time?.tickDate, `${pedal['xml:id']} has no tickDate`).toBeDefined();
      expect(time?.tickDuration, `${pedal['xml:id']} has no tickDuration`).toBeDefined();
    }
  });

  /**
   * Coherence, which is the other half of the same defect and the harder one to notice: while
   * the onset window ran to `modelledMs` and the duration window to `measuredMs`, an event in
   * the 200 ms where they disagree took its onset from one segment and its release from the
   * next. Both figures looked reasonable and their difference was nonsense.
   *
   * A pedal pressed at the very moment a note sounds is at that note's tick, whatever the two
   * segments say — so this states the property without restating the arithmetic. Under the
   * overlapping windows the pedal came out at 1 296 and the note at 1 440.
   */
  test('a pedal down with a note is placed on that note', () => {
    const msm = score();
    const times = computeTickTimes(msm, twoTempi());

    expect(times.pedals.get('ped_boundary')!.tickDate).toBeCloseTo(
      times.notes.get('n2')!.tickDate!,
      6,
    );
  });
});

/**
 * The walk starts from what the *document* says, and that does not say plainly what curve it
 * describes: `resolveTempo` decides that, and for two spellings the answer is not the one the
 * attributes read like. Both used to be inverted at `@bpm`, because the old test for whether an
 * instruction ramps was a truthiness check on its target and its shape — which calls
 * `@meanTempoAt="0"` false, `0` being falsy, and an absent `@meanTempoAt` false as well.
 *
 * The defect itself cannot come back the way it went: `dateAtMilliseconds` takes a *resolved*
 * span now, so there is nothing unresolved left for it to misread. What these two guard is the
 * one step where the decision is still open — `resolveSpan`, where an `@meanTempoAt` of 0 handed
 * on as `meanTempoAt ? ... : null` becomes a linear ramp again, which is the same falsy-zero
 * mistake one level up.
 */
describe('the walk reads an instruction the way the renderer resolves it', () => {
  const under = (tempo: Partial<InstructionOptions<'tempo'>>) => {
    const mpm = createMpm();
    requireMap(mpm, 'tempo', 'global').addTempo({
      id: 't',
      date: 0,
      bpm: 60,
      beatLength: 0.25,
      ...tempo,
    });
    return computeTickTimes(score(), mpm);
  };

  /**
   * `@meanTempoAt="0"` means the mean tempo is reached before the span begins, so meico makes
   * the instruction a *constant at `@transition.to`* — the ramp is gone. One second at 120 bpm
   * with a quarter-note beat is 1 440 ticks; read at `@bpm` it would have been 720.
   */
  test('@meanTempoAt="0" places notes at the target tempo, not the starting one', () => {
    const times = under({ transitionTo: 120, meanTempoAt: 0 });
    expect(times.notes.get('n1')!.tickDate).toBeCloseTo(1440, 6);
  });

  /**
   * And a `@transition.to` with no `@meanTempoAt` is a *linear ramp*, not a constant at either
   * end — so a note a second in lands strictly between the two constant readings. The old
   * closed form put it exactly on the lower one.
   */
  test('a @transition.to with no @meanTempoAt places notes on the ramp', () => {
    const onRamp = under({ transitionTo: 120 })!.notes.get('n1')!.tickDate!;

    expect(onRamp).toBeGreaterThan(720);
    expect(onRamp).toBeLessThan(1440);
  });
});

describe('the millisecond windows are a partition', () => {
  /**
   * Stated over the segments themselves rather than through the walks, because this is the
   * property the walks are entitled to assume: exactly one segment per time, no gaps, no
   * overlaps, and no finite time left over at either end.
   */
  test('every time from before the piece to after it lands in exactly one segment', () => {
    const segments = placeTempos(score(), twoTempi(), 'global');
    expect(segments).toHaveLength(2);

    const boundaries = segments.flatMap((s) => [s.startMs, s.startMs + s.measuredMs]);
    const times = [-5000, -1, ...boundaries.flatMap((ms) => [ms - 1, ms, ms + 1]), 99_000];

    for (const ms of times) {
      const owners = segments.filter(
        (segment, i) =>
          ms >= (i === 0 ? -Infinity : segment.startMs) &&
          ms < (i === segments.length - 1 ? Infinity : segment.startMs + segment.measuredMs),
      );

      expect(owners, `${ms} ms is owned by ${owners.length} segments`).toHaveLength(1);
      expect(segmentAtMs(segments, ms)).toBe(owners[0]);
    }
  });

  /**
   * The arithmetic behind the partition, asserted directly so that a change to the anchoring
   * rule has to come here and say so: the cursor advances by what the recording measured, so
   * each window's end *is* the next window's start.
   */
  test('each window ends where the next one starts', () => {
    const segments = placeTempos(score(), twoTempi(), 'global');

    for (let i = 0; i + 1 < segments.length; i++) {
      const window = at(segments, i, 'segment');
      expect(window.startMs + window.measuredMs).toBe(at(segments, i + 1, 'segment').startMs);
    }
    // ... and the recording, not the notation, is what decides where that is.
    const first = at(segments, 0, 'segment');
    expect(first.modelledMs).toBe(2000);
    expect(first.measuredMs).toBe(1800);
  });

  /** With no `<tempo>` in scope there is no timeline to divide, and no position to invent. */
  test('a scope with no tempo yields no segments and no positions', () => {
    const msm = score();
    const times = computeTickTimes(msm, createMpm());

    expect(placeTempos(msm, createMpm(), 'global')).toHaveLength(0);
    expect(times.notes.size).toBe(0);
    expect(times.pedals.size).toBe(0);
  });
});
