import { describe, expect, test } from 'vitest';
import { performMsmToData } from 'espressivo';
import { Alignment, type AlignedNote, type ScoreNote } from '../../../src/fitting/alignment';
import {
  Mpm,
  createMpm,
  exportMPM,
  getInstructions,
} from '../../../src/fitting/instructions/index';
import {
  InsertDynamicsGradient,
  InsertTemporalSpread,
  StylizeOrnamentation,
} from '../../../src/fitting/transformers/index';
import {
  noteOrderOf,
  sequenceOf,
} from '../../../src/fitting/transformers/ornamentation/noteOrder';
import { at, only } from '../../support/at';

/**
 * `@note.order` is what makes the two halves of an `<ornament>` mean anything: both are measured
 * along the roll, and the attribute is where the element says what the roll was.
 *
 * The failure this file pins is issue #20. `InsertDynamicsGradient` fitted its ramp from the
 * first note struck to the last and then wrote an element that did not say which notes those
 * were, leaving `InsertTemporalSpread` to supply the sequence — which held only for as long as a
 * spread was always asked for over the same chord. Where none was, espressivo did not abstain:
 * it walked the chord by ascending pitch and sounded the ramp along an order nothing had fitted
 * it to.
 */

const note = (
  id: string,
  pitch: number,
  onset: number,
  velocity: number,
  date = 0,
): AlignedNote =>
  ({
    'xml:id': id,
    date,
    part: 1,
    pitchname: 'g',
    octave: 4,
    accidentals: 0,
    duration: 0.25 * 4 * 720,
    'midi.pitch': pitch,
    'milliseconds.date': onset,
    'milliseconds.date.end': onset + 1000,
    velocity,
  }) as AlignedNote;

/** A principal the recording strikes only as the grace note tied into it: a score note, no row. */
const principal = (id: string, pitch: number, date = 0): ScoreNote => ({
  'xml:id': id,
  date,
  part: 1,
  staff: '1',
  layer: '1',
  pitchname: 'c',
  octave: 3,
  accidentals: 0,
  duration: 0.25 * 4 * 720,
  'midi.pitch': pitch,
});

const chord = (notes: AlignedNote[]) =>
  new Alignment(notes, [{ date: 0, numerator: 4, denominator: 4 }]);

interface Transformable {
  transform(msm: Alignment, mpm: Mpm): void;
}
const callTransform = (transformer: unknown, msm: Alignment, mpm: Mpm) =>
  (transformer as Transformable).transform(msm, mpm);

const gradient = () =>
  new InsertDynamicsGradient({
    scope: 'global',
    crescendo: { from: -1, to: 0 },
    decrescendo: { from: 0, to: -1 },
    sortVelocities: false,
  });

const spread = () =>
  new InsertTemporalSpread({
    scope: 'global',
    placement: 'estimate',
    durationThreshold: 0,
    noteOffShiftTolerance: 500,
  });

const orderOf = (mpm: Mpm) => only(getInstructions(mpm, 'ornament', 'global'), 'ornament').noteOrder;

describe('noteOrderOf', () => {
  test('a roll that climbs is the ascending keyword', () => {
    expect(noteOrderOf([note('a', 60, 0, 40), note('b', 64, 10, 45), note('c', 67, 20, 50)])).toBe(
      'ascending pitch',
    );
  });

  test('a roll that falls is the descending keyword', () => {
    expect(noteOrderOf([note('a', 67, 0, 50), note('b', 64, 10, 45), note('c', 60, 20, 40)])).toBe(
      'descending pitch',
    );
  });

  // The keywords say "sort by pitch", so they can only stand in for an order pitch reproduces.
  test('a roll that turns names its notes, in the order they were struck', () => {
    expect(noteOrderOf([note('a', 60, 0, 40), note('b', 72, 10, 45), note('c', 64, 20, 50)])).toBe(
      '#a #b #c',
    );
  });

  // A repeated pitch is a step of zero, which breaks the run rather than being smoothed over —
  // and it has to, since sorting by pitch cannot decide between two notes that share one.
  test('a doubled note falls to the list rather than being called ascending', () => {
    expect(noteOrderOf([note('a', 60, 0, 40), note('b', 60, 10, 45), note('c', 67, 20, 50)])).toBe(
      '#a #b #c',
    );
  });

  // A keyword takes every note at the date, and the score holds one more there than the chord.
  test('a roll that climbs is named note by note where a tied principal shares its date', () => {
    expect(
      noteOrderOf(
        [note('a', 60, 0, 40), note('b', 64, 10, 45), note('c', 67, 20, 50)],
        [principal('p', 48)],
      ),
    ).toBe('#a #b #c');
  });
});

describe('sequenceOf', () => {
  const notes = [note('a', 60, 1000, 40), note('b', 72, 1050, 45), note('c', 64, 1100, 50)];
  const ids = (result: AlignedNote[]) => result.map((n) => n['xml:id']);

  test('an id list is followed as written, however the pitches lie', () => {
    expect(ids(sequenceOf('#a #b #c', notes))).toEqual(['a', 'b', 'c']);
  });

  test('the keywords sort by pitch', () => {
    expect(ids(sequenceOf('ascending pitch', notes))).toEqual(['a', 'c', 'b']);
    expect(ids(sequenceOf('descending pitch', notes))).toEqual(['b', 'c', 'a']);
  });

  // The point of the module: absent is not neutral, it is what the renderer does with absent.
  test('an absent order reads as ascending pitch, the way the renderer reads it', () => {
    expect(ids(sequenceOf(undefined, notes))).toEqual(['a', 'c', 'b']);
  });

  test('a note the list does not name is left out, as the renderer leaves it out', () => {
    expect(ids(sequenceOf('#c #a', notes))).toEqual(['c', 'a']);
  });

  // Silence would be the honest reading and the useless one; the renderer skips such an
  // ornament outright, and a preview that plays nothing says only that something is wrong.
  test('a list naming none of the chord falls back rather than to nothing', () => {
    expect(ids(sequenceOf('#x #y', notes))).toEqual(['a', 'c', 'b']);
  });

  test('espressivo\'s array spelling of a keyword is read as that keyword', () => {
    expect(ids(sequenceOf(['descending pitch'], notes))).toEqual(['b', 'c', 'a']);
  });
});

describe('the ornament states the sequence its ramp was measured along', () => {
  test('a gradient with no temporal spread over it still says how the chord rolled', () => {
    const mpm = createMpm();
    callTransform(gradient(), chord([note('a', 60, 1000, 40), note('b', 67, 1100, 50)]), mpm);

    expect(orderOf(mpm)).toBe('ascending pitch');
  });

  test('a chord rolled from the top says so, rather than being left to default upwards', () => {
    const mpm = createMpm();
    callTransform(gradient(), chord([note('a', 67, 1000, 50), note('b', 60, 1100, 40)]), mpm);

    expect(orderOf(mpm)).toBe('descending pitch');
  });

  test('a roll that turns is named note by note', () => {
    const mpm = createMpm();
    callTransform(
      gradient(),
      chord([note('a', 60, 1000, 40), note('b', 72, 1100, 45), note('c', 64, 1200, 50)]),
      mpm,
    );

    expect(orderOf(mpm)).toBe('#a #b #c');
  });

  // The two transformers share one element through `fillInAt`, which lets whichever wrote a
  // field first keep it. That is only safe while they agree, so this is the property that makes
  // both of them writing the attribute a simplification rather than a race.
  test('the gradient and the spread write the same order, whichever runs', () => {
    const notes = () => [note('a', 60, 1000, 40), note('b', 72, 1100, 45), note('c', 64, 1200, 50)];

    const both = createMpm();
    const msm = chord(notes());
    callTransform(gradient(), msm, both);
    callTransform(spread(), msm, both);

    const spreadOnly = createMpm();
    callTransform(spread(), chord(notes()), spreadOnly);

    expect(getInstructions(both, 'ornament', 'global')).toHaveLength(1);
    expect(orderOf(both)).toBe(orderOf(spreadOnly));
    expect(orderOf(both)).toBe('#a #b #c');
  });
});

/**
 * The end of the argument: what espressivo does with the document, rather than what it says.
 *
 * `StylizeOrnamentation` has to run, because the ramp lives on the `<ornamentDef>` the ornament
 * comes to name and is parked on the element until then — an ornament pointing at
 * `neutralArpeggio` is one the renderer skips.
 */
describe('the performed ramp follows the roll', () => {
  test('a chord that turns is ramped in onset order, not in pitch order', () => {
    // Struck low, then high, then in between: pitch order and onset order disagree from the
    // second note on, which is what makes the default sequence the wrong one.
    const msm = chord([
      note('a', 60, 1000, 40),
      note('b', 72, 1050, 45),
      note('c', 64, 1100, 50),
      note('d', 67, 1150, 55),
    ]);
    const mpm = createMpm();
    callTransform(gradient(), msm, mpm);
    callTransform(
      new StylizeOrnamentation({
        tickTolerance: 10,
        gradientTolerance: 0.1,
        intensityTolerance: 0.3,
      }),
      msm,
      mpm,
    );

    const score = msm.serializeScore();
    expect(score).toBeTruthy();
    const data = performMsmToData({ msm: score!, mpm: exportMPM(mpm) }, {});

    const performed = new Map<string, number>();
    for (const part of data.parts)
      for (const rendered of part.notes)
        if (rendered.id !== null) performed.set(rendered.id, rendered.velocity);

    // The ramp is `transition.from` -1 to `transition.to` 0 over a scale of 55 - 40, laid on
    // meico's uninstructed 100, and it is laid on the notes in the order they were struck.
    expect(['a', 'b', 'c', 'd'].map((id) => performed.get(id))).toEqual([85, 90, 95, 100]);

    // Which is the whole point: the highest note is not the loudest, because it is not the last
    // one struck. Sorted by pitch it would have been.
    expect(performed.get('b')).toBeLessThan(at([...performed.values()], 3, 'velocity'));
  });
});

/**
 * The score the MPM is rendered against holds one more note at some dates than the chord there:
 * a principal a grace note is tied into, which the roll struck with its grace figure, often a beat
 * ahead (`Alignment.tiedPrincipals`). The spread never saw it, and the roll must not take it.
 */
describe('a tied principal on the date of a rolled chord', () => {
  const rolled = () => {
    const msm = chord([note('a', 60, 1000, 40), note('b', 64, 1100, 45), note('c', 67, 1200, 50)]);
    msm.tiedPrincipals = [principal('p', 48)];
    return msm;
  };

  const onsets = (msm: Alignment, mpm: string) =>
    new Map(
      performMsmToData({ msm: msm.serializeScore() ?? '', mpm }, {})
        .parts.flatMap((part) => part.notes)
        .map((n) => [n.id, n.milliseconds.date]),
    );

  test('is left out of the roll, which names the notes it measured', () => {
    const msm = rolled();
    const mpm = createMpm();
    callTransform(gradient(), msm, mpm);
    callTransform(spread(), msm, mpm);
    callTransform(
      new StylizeOrnamentation({
        tickTolerance: 10,
        gradientTolerance: 0.1,
        intensityTolerance: 0.3,
      }),
      msm,
      mpm,
    );
    expect(orderOf(mpm)).toBe('#a #b #c');

    const xml = exportMPM(mpm);
    const without = msm.clone();
    without.tiedPrincipals = [];
    const played = onsets(msm, xml);
    expect(played.has('p')).toBe(true);
    for (const id of ['a', 'b', 'c']) expect(played.get(id)).toBe(onsets(without, xml).get(id));

    // What the keyword would have done: the principal, lowest, rolled first, and the chord a step
    // late from its first note on.
    const keyword = xml.replace('note.order="#a #b #c"', 'note.order="ascending pitch"');
    expect(keyword).not.toBe(xml);
    expect(onsets(msm, keyword).get('a')).toBeGreaterThan(played.get('a') ?? Infinity);
  });
});

/**
 * The other note a keyword takes that the chord does not hold, and this one is not even on the
 * date. espressivo answers a date a part has nothing at with that part's next note, so a roll
 * over the whole score, on a date one hand rests at, takes that hand's next note in: the roll is
 * spaced over a slot too many, and the note taken is struck where the roll puts it.
 */
describe('a hand with nothing on the date of a chord rolled in the other', () => {
  // The right hand rolls two notes on the first beat; the left comes in a quarter later, lower.
  const hands = () =>
    chord([
      note('a', 64, 1000, 40),
      note('b', 67, 1100, 50),
      { ...note('next', 48, 1500, 45, 720), part: 2 },
    ]);

  const stylize = () =>
    new StylizeOrnamentation({ tickTolerance: 10, gradientTolerance: 0.1, intensityTolerance: 0.3 });

  const onsets = (msm: Alignment, mpm: string) =>
    new Map(
      performMsmToData({ msm: msm.serializeScore() ?? '', mpm }, {})
        .parts.flatMap((part) => part.notes)
        .map((n) => [n.id, n.milliseconds.date]),
    );

  test('the whole score has the other hand\'s next note to take, and one hand alone has none', () => {
    const msm = hands();
    expect(msm.in('global').straysAt(0).map((n) => n['xml:id'])).toEqual(['next']);
    // Where both hands have a note there is nothing to take.
    expect(msm.in('global').straysAt(720)).toEqual([]);
    expect(msm.in(0).straysAt(0)).toEqual([]);
  });

  test('the roll names its two notes, and the other hand\'s note stays where it is', () => {
    const msm = hands();
    const mpm = createMpm();
    callTransform(gradient(), msm, mpm);
    callTransform(spread(), msm, mpm);
    callTransform(stylize(), msm, mpm);
    expect(orderOf(mpm)).toBe('#a #b');

    const xml = exportMPM(mpm);
    const bare = onsets(msm, exportMPM(createMpm()));
    const played = onsets(msm, xml);
    expect(played.get('next')).toBe(bare.get('next'));

    // What the keyword would have done: the left hand's note, lowest, rolled first, ahead of
    // where the score has it, and the chord's own two notes spaced as the last two of three.
    const keyword = xml.replace('note.order="#a #b"', 'note.order="ascending pitch"');
    expect(keyword).not.toBe(xml);
    const taken = onsets(msm, keyword);
    expect(taken.get('next')).toBeLessThan(bare.get('next') ?? -Infinity);
    expect((taken.get('b') ?? 0) - (taken.get('a') ?? 0)).toBeLessThan(
      (played.get('b') ?? 0) - (played.get('a') ?? 0),
    );
  });

  // A part's own roll is on a date the part has, so the keyword is safe there and is kept: it is
  // what a reader can see the roll in.
  test('a roll written for one hand keeps its keyword', () => {
    const msm = hands();
    const mpm = createMpm();
    callTransform(
      new InsertTemporalSpread({
        scope: 0,
        placement: 'estimate',
        durationThreshold: 0,
        noteOffShiftTolerance: 500,
      }),
      msm,
      mpm,
    );
    expect(only(getInstructions(mpm, 'ornament', 0), 'ornament').noteOrder).toBe('ascending pitch');
  });
});
