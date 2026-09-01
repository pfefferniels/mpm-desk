import { describe, expect, test } from 'vitest';
import { Alignment, type AlignedNote } from '../../../src/fitting/alignment';
import {
  Mpm,
  createMpm,
  getDefinitions,
  getInstructions,
  requireMap,
} from '../../../src/fitting/instructions/index';
import { InsertMetricalAccentuation } from '../../../src/fitting/transformers/accentuation/index';
import { PULSES_PER_QUARTER } from '../../../src/fitting/ppq';
import { at } from '../../support/at';

/**
 * The loop in `InsertMetricalAccentuation` is driven entirely by the *residual* velocity — what
 * the rest of the MPM leaves unexplained — so a fixture that wants to steer it has to steer that
 * quantity rather than the recorded velocities directly.
 *
 * A single flat `<dynamics>` makes the two the same thing up to a constant: espressivo renders
 * every note at `volume`, so `residual = velocity - volume` exactly, with no rounding to
 * work around. Everything below is written in terms of the residual and the fixture adds the
 * constant back.
 */
const VOLUME = 64;

const note = (index: number, velocity: number): AlignedNote =>
  ({
    'xml:id': `n_${index}`,
    date: index * PULSES_PER_QUARTER,
    part: 1,
    pitchname: 'c',
    octave: 4,
    accidentals: 0,
    duration: PULSES_PER_QUARTER,
    'midi.pitch': 60,
    'milliseconds.date': index * 500,
    'milliseconds.date.end': index * 500 + 500,
    velocity,
  }) as AlignedNote;

/**
 * The residual shape one bar carries, as a fraction of that bar's scale.
 *
 * The peak sits on beat 2 rather than on the downbeat on purpose. A cell's last sample is the
 * *next* bar's downbeat, so a bar whose strongest beat is its first would hand its own scale to
 * the bar before it and no cell's scale would be its own. With the peak inside the bar, each
 * cell's `calculateScale` reads back exactly the scale this fixture gave it — as long as the
 * downbeat fraction is small enough that a louder following bar still does not outweigh it.
 * At 0.3 that holds while no bar is more than three times the strength of the one before it,
 * which every list of scales below respects.
 *
 * Rounded to the nearest integer the shape is `[0, 1, 1, 0]` whatever the scale, which is what
 * `hasSameBeatStructure` compares, so every bar built from it is accepted as the same pattern.
 */
const SHAPE = [0.3, 1, 0.5, 0.2];

/**
 * One bar per entry of `scales`, each carrying `SHAPE` at that strength, then a closing downbeat
 * with no residual at all. The closing note ends the loop the way the end of a piece does: the
 * cell after the last bar has a scale of 0, and a scale of 0 is not a pattern.
 *
 * Dropping it (`closingDownbeat: false`) ends the piece the *other* way it can end — flush with
 * the last bar line, so `msm.end` is a cell boundary and the loop runs out of piece rather than
 * out of pattern. That is a different exit from the same `while`, and issue #43 is about the two
 * exits disagreeing.
 */
const fixture = (scales: number[], { closingDownbeat = true } = {}) => {
  const notes: AlignedNote[] = [];
  for (let bar = 0; bar < scales.length; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      notes.push(
        note(bar * 4 + beat, VOLUME + at(SHAPE, beat, 'beat shape') * at(scales, bar, 'bar scale')),
      );
    }
  }
  if (closingDownbeat) notes.push(note(scales.length * 4, VOLUME));

  const msm = new Alignment(notes, [{ date: 0, numerator: 4, denominator: 4 }]);

  const mpm = createMpm();
  requireMap(mpm, 'tempo', 'global').addTempo({ id: 't1', date: 0, bpm: 120, beatLength: 0.25 });
  requireMap(mpm, 'dynamics', 'global').addDynamics({ id: 'd1', date: 0, volume: VOLUME });

  return { msm, mpm };
};

/** Call the protected `transform` method for testing */
const run = (msm: Alignment, mpm: Mpm, scaleTolerance: number) => {
  const transformer = new InsertMetricalAccentuation({
    scope: 'global',
    name: 'metre',
    from: 0,
    to: 4 * PULSES_PER_QUARTER,
    beatLength: 0.25,
    scaleTolerance,
  });
  interface Transformable {
    transform(msm: Alignment, mpm: Mpm): void;
  }
  (transformer as unknown as Transformable).transform(msm, mpm);
};

const fitted = (mpm: Mpm) =>
  getInstructions(mpm, 'accentuationPattern', 'global').find(
    (p) => p.accentuationPatternDefName === 'metre',
  )!;

describe('the fixture drives the loop it claims to', () => {
  // Everything below reads `@scale` as a mean over a known set of bars. That only means
  // anything if the loop really did take in the bars the test names, so establish it once.
  test('three bars of the same shape are folded into one looping pattern', () => {
    const { msm, mpm } = fixture([10, 20, 30]);
    run(msm, mpm, 25);

    const pattern = fitted(mpm);
    expect(pattern.date).toBe(0);
    expect(pattern.loop).toBe(true);

    // The neutral pattern closing the loop marks where the fold stopped: after bar 3.
    const neutral = getInstructions(mpm, 'accentuationPattern', 'global').find(
      (p) => p.accentuationPatternDefName === 'neutral',
    )!;
    expect(neutral.date).toBe(12 * PULSES_PER_QUARTER);

    // The definition is the prototype's shape, normalised by the prototype's own scale.
    // Each accentuation is espressivo's `[beat, value, transition.from, transition.to]`
    // tuple, so the first two slots are what the shape is read out of.
    const def = getDefinitions(mpm, 'accentuationPatternDef', 'global').find(
      (d) => d.getName() === 'metre',
    )!;
    const accentuations = def.getAllAccentuations().map((a) => a.key);
    expect(accentuations.map(([beat]) => beat)).toEqual([1, 2, 3, 4]);
    expect(accentuations.map(([, value]) => value)).toEqual(SHAPE);
  });
});

describe('the cell is the cycle, not the bar', () => {
  /**
   * MPM's default is `stickToMeasures="true"` (`accentuationPattern.xml`:
   * `<defaultVal>true</defaultVal>`), which re-aligns the pattern at every barline. A cell
   * fitted here is not a bar — `extractVelocities` numbers its beats from the cell's own start
   * and the loop repeats it on its own length — so the pattern the fitter means is one that
   * cycles on `@length`, and the attribute has to be written to say so.
   */
  test('every pattern written says it does not re-align at the barline', () => {
    const { msm, mpm } = fixture([10, 20, 30]);
    run(msm, mpm, 25);

    const written = getInstructions(mpm, 'accentuationPattern', 'global');
    expect(written.length).toBeGreaterThan(1);
    expect(written.map((pattern) => pattern.stickToMeasures)).toEqual(written.map(() => false));
  });
});

describe('@scale, the running mean over the cells the pattern covers', () => {
  // Issue #41. The accumulator counted the prototype as zero samples, so the first pass
  // replaced its scale instead of averaging it in and the reported figure was the mean of
  // the repeats alone: 25 here, the mean of 20 and 30, with the prototype's 10 gone.
  test('counts the cell the pattern was derived from', () => {
    const { msm, mpm } = fixture([10, 20, 30]);
    run(msm, mpm, 25);

    expect(fitted(mpm).scale).toBe(20);
  });

  test("is the prototype's own scale when no repeat is taken in", () => {
    // A second bar well outside the tolerance breaks the loop on its first pass, so the
    // pattern covers the prototype alone and reports the prototype's own scale.
    const { msm, mpm } = fixture([10, 25]);
    run(msm, mpm, 5);

    const pattern = fitted(mpm);
    expect(pattern.scale).toBe(10);
    expect(pattern.loop).toBeUndefined();
  });

  test('weights every cell equally, however many there are', () => {
    const { msm, mpm } = fixture([10, 20, 30, 40, 50]);
    run(msm, mpm, 45);

    expect(fitted(mpm).scale).toBe(30);
  });
});

describe('the scale tolerance is measured against the prototype', () => {
  // Second-order finding of issue #41. The comparison used to run against the running mean,
  // which every accepted cell moves, so the acceptance window walked along with the data.
  test("a drifting run is cut where it leaves the prototype's window", () => {
    // Steps of 2 against a tolerance of 5. Measured against the prototype the run is cut
    // where it should be: bars of 12 and 14 are 2 and 4 away and join, 16 is 6 away and
    // does not, leaving a mean of 12 over three bars.
    //
    // Measured against the running mean it would not be. The mean lags the data by half a
    // step per bar, so the gap it sees grows at half the rate the real one does: 16 reads
    // as 4 away and 18 as 5, both inside the window. The fold would run two bars further
    // and report 14 — a pattern covering a bar 80% stronger than the one that defined it,
    // under a tolerance that said 50%.
    const { msm, mpm } = fixture([10, 12, 14, 16, 18, 20]);
    run(msm, mpm, 5);

    const pattern = fitted(mpm);
    expect(pattern.scale).toBe(12);

    const neutral = getInstructions(mpm, 'accentuationPattern', 'global').find(
      (p) => p.accentuationPatternDefName === 'neutral',
    )!;
    expect(neutral.date).toBe(12 * PULSES_PER_QUARTER);
  });

  test('a cell more than the tolerance from the prototype is refused', () => {
    const { msm, mpm } = fixture([10, 12, 30]);
    run(msm, mpm, 5);

    // Bar 2 is within 5 of the prototype and joins; bar 3 is 20 away and does not.
    expect(fitted(mpm).scale).toBe(11);
  });
});

describe('the closing neutral marks the end of the last accepted cell', () => {
  // Issue #43. The loop advances `currentCell` before judging it and the neutral was placed
  // at `currentCell.start`. On the `break` path that is the start of the *rejected* cell,
  // which is also the end of the last accepted one — right by coincidence. On the path where
  // the `while` condition simply goes false there is no rejected cell: `currentCell` is the
  // one that was just accepted, and the neutral landed a bar early, on top of a repetition
  // the loop had validated, cancelling it.
  const neutralsIn = (mpm: Mpm) =>
    getInstructions(mpm, 'accentuationPattern', 'global').filter(
      (p) => p.accentuationPatternDefName === 'neutral',
    );

  test('a piece ending on the bar line closes the loop after the last bar, not before it', () => {
    // Without the closing downbeat the last note fills bar 3, so `msm.end` is the bar line
    // itself and the third repetition is accepted by the last pass the `while` allows.
    const { msm, mpm } = fixture([10, 10, 10], { closingDownbeat: false });
    expect(msm.end).toBe(12 * PULSES_PER_QUARTER);

    run(msm, mpm, 1);

    // All three bars are in: the pattern loops and reports their common scale.
    const pattern = fitted(mpm);
    expect(pattern.loop).toBe(true);
    expect(pattern.scale).toBe(10);

    // So the neutral belongs after bar 3, not on its downbeat at 8 quarters.
    expect(neutralsIn(mpm).map((n) => n.date)).toEqual([12 * PULSES_PER_QUARTER]);
  });

  test('a following desk on the bar line does not pull the neutral back into the loop', () => {
    const { msm, mpm } = fixture([10, 10, 10]);

    // A second accentuation desk starting at bar 4 — the ordinary shape of two adjacent
    // desks, and what makes this exit reachable on a piece that does not end flush.
    requireMap(mpm, 'accentuationPattern', 'global').addAccentuationPattern({
      id: 'next_desk',
      accentuationPatternDefName: 'other',
      date: 12 * PULSES_PER_QUARTER,
      scale: 7,
    });

    run(msm, mpm, 1);

    const pattern = fitted(mpm);
    expect(pattern.loop).toBe(true);
    expect(pattern.scale).toBe(10);

    // The run was accepted right up to the following desk, so nothing may cancel it before
    // then, and the desk's own pattern has to survive intact.
    //
    // Note what this no longer covers. The neutral is due at 12 quarters, which is the date
    // the next desk already occupies. The write this replaces merged the two: the desk
    // carried a `@name.ref` and a `@scale` already, so the neutral's were dropped and no
    // second element ever appeared. `addAccentuationPattern` appends instead, so the map now
    // holds the desk *and* a neutral at that date, the neutral last. The assertions below
    // still hold — they ask about dates strictly before 12 quarters, and about the desk
    // element itself — but they do not see the neutral sitting on top of it.
    expect(neutralsIn(mpm).filter((n) => n.date < 12 * PULSES_PER_QUARTER)).toEqual([]);

    const nextDesk = getInstructions(mpm, 'accentuationPattern', 'global').find(
      (p) => p.id === 'next_desk',
    )!;
    expect(nextDesk.accentuationPatternDefName).toBe('other');
    expect(nextDesk.scale).toBe(7);
  });
});

/**
 * Beats are counted as integers and converted to ticks once, rather than accumulated.
 *
 * `for (let beat = 0; …; beat += beatLength)` is exact for a binary basis like 0.25 and drifts
 * for anything else. A triplet basis is the ordinary case that is not: adding 1/6 three times
 * gives 0.49999999999999994, so the date it asks about is 1439.9999999999998 — and `notesAtDate`
 * compares dates with `===`, so the beat silently matched no note and dropped out of the pattern
 * (issue #42).
 */
describe('a beat grid that is not a power of two', () => {
  const TRIPLET = 1 / 6;
  const TRIPLET_TICKS = 4 * PULSES_PER_QUARTER * TRIPLET;
  const TRIPLET_SHAPE = [0.3, 1, 0.5, 0.9, 0.4, 0.6, 0.2];

  const tripletFixture = () => {
    const notes = TRIPLET_SHAPE.map(
      (shape, index) =>
        ({
          ...note(0, VOLUME + shape * 10),
          'xml:id': `t_${index}`,
          date: index * TRIPLET_TICKS,
        }) as AlignedNote,
    );

    const msm = new Alignment(notes, [{ date: 0, numerator: 4, denominator: 4 }]);
    const mpm = createMpm();
    requireMap(mpm, 'tempo', 'global').addTempo({ id: 't1', date: 0, bpm: 120, beatLength: 0.25 });
    requireMap(mpm, 'dynamics', 'global').addDynamics({ id: 'd1', date: 0, volume: VOLUME });
    return { msm, mpm };
  };

  test('every beat of the cell reaches the pattern', () => {
    const { msm, mpm } = tripletFixture();

    const transformer = new InsertMetricalAccentuation({
      scope: 'global',
      name: 'triplets',
      from: 0,
      to: 6 * TRIPLET_TICKS,
      beatLength: TRIPLET,
      scaleTolerance: 0,
    });
    interface Transformable {
      transform(msm: Alignment, mpm: Mpm): void;
    }
    (transformer as unknown as Transformable).transform(msm, mpm);

    const def = getDefinitions(mpm, 'accentuationPatternDef', 'global').find(
      (d) => d.getName() === 'triplets',
    )!;

    // Seven samples, and an accentuation for every one but the last — which only names where
    // the one before it transitions to. The accumulating loop lost the samples at 3 and 6
    // beats, which is where the drift first shows.
    const beats = def.getAllAccentuations().map(({ key: [beat] }) => beat);
    expect(beats).toHaveLength(6);
    expect(beats).toEqual([0, 1, 2, 3, 4, 5].map((index) => 4 * index * TRIPLET + 1));
  });
});
