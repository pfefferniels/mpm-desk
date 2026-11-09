import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { convertMeiToMsm, performMsmToData } from 'espressivo';
import { Alignment, type AlignedGrace, type AlignedNote } from '../../../src/fitting/alignment';
import {
  Mpm,
  createMpm,
  exportMPM,
  getDefinition,
  getInstructions,
} from '../../../src/fitting/instructions/index';
import {
  InsertGraceNotes,
  InsertTemporalSpread,
  MakeChoice,
} from '../../../src/fitting/transformers/index';
import { asMSM } from '../../../src/fitting/asMSM';
import { publishedPath } from '../../../src/test/published';
import { at, only } from '../../support/at';

/** A score note at `date`, recorded at `ms`. */
const note = (id: string, date: number, pitch: number, ms: number, part = 1): AlignedNote => ({
  'xml:id': id,
  date,
  part,
  staff: String(part),
  layer: '1',
  pitchname: 'c',
  octave: 4,
  duration: 720,
  accidentals: 0,
  'midi.pitch': pitch,
  'milliseconds.date': ms,
  'milliseconds.date.end': ms + 500,
  velocity: 60,
});

/** A grace note of `group`, recorded at `ms`, leading to `principal` at `date`. */
const grace = (
  id: string,
  group: string,
  principal: string,
  slot: number,
  pitch: number,
  ms: number,
  { tied = false, date = 720, part = 1, source }: Partial<AlignedGrace> = {},
): AlignedGrace => ({
  'xml:id': id,
  group,
  principal,
  tied,
  part,
  date,
  slot,
  'midi.pitch': pitch,
  'milliseconds.date': ms,
  'milliseconds.date.end': ms + 100,
  velocity: 40,
  ...(source !== undefined && { source }),
});

const alignment = (notes: AlignedNote[], graces: AlignedGrace[]): Alignment => {
  const msm = new Alignment(notes, [{ date: 0, numerator: 4, denominator: 4 }]);
  msm.graces = graces;
  return msm;
};

/** Call the protected `transform` method for testing */
const callTransform = (transformer: { name: string }, msm: Alignment, mpm: Mpm) => {
  interface Transformable {
    transform(msm: Alignment, mpm: Mpm): void;
  }
  (transformer as unknown as Transformable).transform(msm, mpm);
};

/** The figure written for a principal: its ornament, and the frame its definition holds. */
const figure = (mpm: Mpm, principal: string) => {
  const ornament = only(
    getInstructions(mpm, 'ornament', 'global').filter(
      (o) => o.element.getAttributeValue('noteid') === `#${principal}`,
    ),
    'grace ornament',
  );
  const spread = getDefinition(mpm, 'ornamentDef', ornament.nameRef)?.getTemporalSpread();
  return {
    ornament,
    pool: ornament.element
      .getChildElements()
      .toArray()
      .map((n) => [n.getAttributeValue('id', 'http://www.w3.org/XML/1998/namespace'), n.getAttributeValue('midi.pitch')]),
    frame: spread && {
      start: spread.frameStart,
      length: spread.getFrameLength(),
      domain: spread.frameDomain,
      shift: spread.noteOffShift,
    },
  };
};

describe('an untied group', () => {
  // Two grace notes, 300 and 150 ms before a principal struck at 2000 ms on its own beat.
  const msm = () =>
    alignment(
      [note('p', 720, 72, 2000), note('bass', 720, 48, 2000)],
      [grace('g1', 'gg', 'p', 0, 74, 1700), grace('g2', 'gg', 'p', 1, 76, 1850)],
    );

  test('is one ornament on its principal, the grace notes its pool, the principal last', () => {
    const mpm = createMpm();
    callTransform(new InsertGraceNotes({ scope: 'global' }), msm(), mpm);
    const { ornament, pool, frame } = figure(mpm, 'p');
    expect(ornament.id).toBe('grace_gg');
    expect(ornament.date).toBe(720);
    expect(ornament.noteOrder).toBe('#g1 #g2 #p');
    expect(pool).toEqual([
      ['g1', '74'],
      ['g2', '76'],
    ]);
    // In milliseconds, from the principal's date: the first grace 300 ms ahead, the principal on it.
    expect(frame).toMatchObject({ start: -300, length: 300, shift: 'monophonic' });
  });

  test('keeps the stagger an arpeggio fit took out of its principal', () => {
    // The chord rolled bass first, principal 120 ms later; the spread collapses both onto 1940.
    const rolled = alignment(
      [note('p', 720, 72, 2000), note('bass', 720, 48, 1880)],
      [grace('g1', 'gg', 'p', 0, 74, 1700)],
    );
    const mpm = createMpm();
    callTransform(
      new InsertTemporalSpread({
        scope: 'global',
        placement: 'estimate',
        durationThreshold: 35,
        noteOffShiftTolerance: 2,
      }),
      rolled,
      mpm,
    );
    expect(rolled.getByID('p')?.['milliseconds.date']).toBe(1940);
    expect(rolled.getByID('p')?.spread).toBe(60);

    callTransform(new InsertGraceNotes({ scope: 'global' }), rolled, mpm);
    // From the collapsed onset: the grace 240 ms before it, the principal 60 ms after, as recorded.
    expect(figure(mpm, 'p').frame).toMatchObject({ start: -240, length: 300 });
  });
});

describe('a group tied into its principal', () => {
  // B♭ then F, the F tied into the principal: the principal's strike is the grace F's, and the
  // score has no onset of its own for it. The date sounds where the chord's other note does.
  const msm = () =>
    alignment(
      [note('d4', 720, 62, 2000)],
      [
        grace('bb', 'gg', 'f3', 0, 46, 1650),
        grace('f', 'gg', 'f3', 1, 53, 1760, { tied: true }),
      ],
    );

  test('drops the tied grace note from the pool and strikes the principal in its place', () => {
    const mpm = createMpm();
    callTransform(new InsertGraceNotes({ scope: 'global' }), msm(), mpm);
    const { ornament, pool, frame } = figure(mpm, 'f3');
    expect(ornament.noteOrder).toBe('#bb #f3');
    expect(pool).toEqual([['bb', '46']]);
    expect(frame).toMatchObject({ start: -350, length: 110 });
  });

  test('is skipped when nothing recorded sounds on its date', () => {
    const mpm = createMpm();
    const lonely = alignment([], msm().graces);
    callTransform(new InsertGraceNotes({ scope: 'global' }), lonely, mpm);
    expect(getInstructions(mpm, 'ornament', 'global')).toEqual([]);
  });
});

describe('which groups a call writes', () => {
  const msm = () =>
    alignment(
      [note('p1', 720, 72, 2000), note('p2', 1440, 50, 3000, 2)],
      [
        grace('a', 'one', 'p1', 0, 74, 1800),
        grace('b', 'two', 'p2', 0, 52, 2800, { date: 1440, part: 2 }),
      ],
    );

  test('every group in the scope by default, only the named one with `group`', () => {
    const all = createMpm();
    callTransform(new InsertGraceNotes({ scope: 'global' }), msm(), all);
    expect(getInstructions(all, 'ornament', 'global').map((o) => o.id)).toEqual([
      'grace_one',
      'grace_two',
    ]);

    const one = createMpm();
    callTransform(new InsertGraceNotes({ scope: 'global', group: 'two' }), msm(), one);
    expect(getInstructions(one, 'ornament', 'global').map((o) => o.id)).toEqual(['grace_two']);
    expect(new InsertGraceNotes({ scope: 'global', group: 'two' }).range(msm())).toEqual({
      from: 1440,
    });
  });

  test('none while a group still has two readings', () => {
    const unchosen = alignment(msm().allNotes, [
      grace('a', 'one', 'p1', 0, 74, 1800, { source: 'x' }),
      grace('a', 'one', 'p1', 0, 74, 1810, { source: 'y' }),
    ]);
    const mpm = createMpm();
    callTransform(new InsertGraceNotes({ scope: 'global' }), unchosen, mpm);
    expect(getInstructions(mpm, 'ornament', 'global')).toEqual([]);

    callTransform(new MakeChoice({ prefer: 'y' }), unchosen, mpm);
    expect(unchosen.graces.map((g) => g['milliseconds.date'])).toEqual([1810]);
  });
});

describe('the published transcription', () => {
  const mei = readFileSync(publishedPath('mei'), 'utf-8');
  const movement = at(convertMeiToMsm(mei), 0, 'movement');

  test('times every grace note the score writes, once per take', () => {
    const msm = asMSM(mei, movement.msm, movement.graces);
    expect(new Set(msm.graces.map((g) => g.group)).size).toBe(8);
    expect(msm.graces).toHaveLength(13 * 2);
    expect(msm.graces.filter((g) => g.tied).map((g) => g['xml:id']).sort()).toEqual(
      [
        'n1t814ew',
        'n1t814ew',
        'n1t814ew-rend2',
        'n1t814ew-rend2',
        'n45mt0q',
        'n45mt0q',
        'nw7mgns',
        'nw7mgns',
        'nw7mgns-rend2',
        'nw7mgns-rend2',
      ].sort(),
    );
  });

  test('plays bar 3’s B♭–F as the roll does: the F struck 108 ms after the B♭ and held', () => {
    const msm = asMSM(mei, movement.msm, movement.graces);
    callTransform(new MakeChoice({ prefer: 'c9050e75-97a8-4862-9533-0f4b1439802b' }), msm, createMpm());
    const mpm = createMpm();
    callTransform(new InsertGraceNotes({ scope: 'global' }), msm, mpm);
    expect(getInstructions(mpm, 'ornament', 'global')).toHaveLength(8);

    const played = performMsmToData({ msm: movement.msm, mpm: exportMPM(mpm) })
      .parts.flatMap((part) => part.notes)
      .filter((n) => n.ornamentRef === 'grace_pxnvdff');
    expect(played.map((n) => [n.pitch, n.ornamentSource])).toEqual([
      [46, 'n1or9mhw'],
      [53, 'nanro74'],
    ]);
    const [bb, f] = played;
    expect((f?.milliseconds.date ?? 0) - (bb?.milliseconds.date ?? 0)).toBeCloseTo(108, 6);
  });
});
