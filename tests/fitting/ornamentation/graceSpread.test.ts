import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { convertMeiToMsm, performMsmToData } from 'espressivo';
import {
  Alignment,
  type AlignedGrace,
  type AlignedNote,
  type ScoreNote,
} from '../../../src/fitting/alignment';
import {
  Mpm,
  createMpm,
  exportMPM,
  getDefinition,
  getInstructions,
  ornamentDraftOf,
  silentOrnaments,
} from '../../../src/fitting/instructions/index';
import {
  InsertTemporalSpread,
  MakeChoice,
  StylizeOrnamentation,
} from '../../../src/fitting/transformers/index';
import { compareTransformers } from '../../../src/fitting/transformers/Order';
import { asMSM } from '../../../src/fitting/asMSM';
import { runFit } from '../../../src/fitting/fit';
import { parseWorkFile } from '../../../src/model/Work';
import { partNamesOf } from '../../../src/model/workReducer';
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

/** A principal the recording strikes only as the grace note tied into it. */
const tiedPrincipal = (id: string, date: number, pitch: number, part = 1): ScoreNote => ({
  'xml:id': id,
  date,
  part,
  staff: String(part),
  layer: '1',
  pitchname: 'f',
  octave: 3,
  duration: 2160,
  accidentals: 0,
  'midi.pitch': pitch,
});

const alignment = (
  notes: AlignedNote[],
  graces: AlignedGrace[],
  tiedPrincipals: ScoreNote[] = [],
): Alignment => {
  const msm = new Alignment(notes, [{ date: 0, numerator: 4, denominator: 4 }]);
  msm.graces = graces;
  msm.tiedPrincipals = tiedPrincipals;
  return msm;
};

/** Call the protected `transform` method for testing */
const callTransform = (transformer: { name: string }, msm: Alignment, mpm: Mpm) => {
  interface Transformable {
    transform(msm: Alignment, mpm: Mpm): void;
  }
  (transformer as unknown as Transformable).transform(msm, mpm);
};

/**
 * The figure written for a principal: its ornament, and the frame measured for it, which is
 * parked on the element as a draft until the chain has stylized it.
 */
const figure = (mpm: Mpm, principal: string) => {
  const ornament = only(
    getInstructions(mpm, 'ornament', 'global').filter(
      (o) => o.element.getAttributeValue('noteid') === `#${principal}`,
    ),
    'grace ornament',
  );
  const draft = ornamentDraftOf(ornament.element);
  return {
    ornament,
    pool: ornament.element
      .getChildElements()
      .toArray()
      .map((n) => [n.getAttributeValue('id', 'http://www.w3.org/XML/1998/namespace'), n.getAttributeValue('midi.pitch')]),
    frame: {
      start: draft.frameStart,
      length: draft.frameLength,
      domain: draft.frameDomain,
      shift: draft.noteOffShift,
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
    callTransform(new InsertTemporalSpread({ scope: 'global', graces: 'all' }), msm(), mpm);
    const { ornament, pool, frame } = figure(mpm, 'p');
    expect(ornament.id).toBe('grace_gg');
    expect(ornament.date).toBe(720);
    expect(ornament.noteOrder).toBe('#g1 #g2 #p');
    expect(pool).toEqual([
      ['g1', '74'],
      ['g2', '76'],
    ]);
    // In milliseconds, from the principal's date: the first grace 300 ms ahead, the principal on it.
    expect(frame).toMatchObject({ start: -300, length: 300, domain: 'milliseconds', shift: 'monophonic' });
  });

  // As an arpeggio's is: the frame is a draft for the hinge to put into ticks and
  // `StylizeOrnamentation` to give a definition, and until then the figure names none.
  test('leaves its frame as a draft, and sounds once the chain has stylized it', () => {
    const mpm = createMpm();
    callTransform(new InsertTemporalSpread({ scope: 'global', graces: 'all' }), msm(), mpm);
    expect(getDefinition(mpm, 'ornamentDef', figure(mpm, 'p').ornament.nameRef)).toBeNull();
    expect(silentOrnaments(mpm).map((o) => o.id)).toEqual(['grace_gg']);

    callTransform(new StylizeOrnamentation(), msm(), mpm);
    const { ornament } = figure(mpm, 'p');
    expect(silentOrnaments(mpm)).toEqual([]);
    expect(ornamentDraftOf(ornament.element)).toEqual({});
    const spread = getDefinition(mpm, 'ornamentDef', ornament.nameRef)?.getTemporalSpread();
    expect(spread?.getFrame()).toEqual({
      offset: { value: -300, domain: 'milliseconds' },
      length: { value: 300, domain: 'milliseconds' },
    });
    expect(spread?.noteOffShift).toBe('monophonic');
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

    callTransform(new InsertTemporalSpread({ scope: 'global', graces: 'all' }), rolled, mpm);
    // From the collapsed onset: the grace 240 ms before it, the principal 60 ms after, as recorded.
    expect(figure(mpm, 'p').frame).toMatchObject({ start: -240, length: 300 });
  });

  // One transformer fits both, so the registry no longer orders a figure after the rolls: the
  // calls say it of themselves. Made the other way round, the figure is still measured from the
  // onset the roll leaves its principal on, and not from one the chain goes on to move.
  test('is spread after the rolls, whichever call was made first', () => {
    const rolled = alignment(
      [note('p', 720, 72, 2000), note('bass', 720, 48, 1880)],
      [grace('g1', 'gg', 'p', 0, 74, 1700)],
    );
    const figureFirst = [
      new InsertTemporalSpread({ scope: 'global', group: 'gg' }),
      new InsertTemporalSpread({
        scope: 'global',
        placement: 'estimate',
        date: 720,
        noteOffShiftTolerance: 2,
      }),
    ];
    const ordered = [...figureFirst].sort(compareTransformers);
    expect(ordered).toEqual([figureFirst[1], figureFirst[0]]);

    const mpm = createMpm();
    for (const transformer of ordered) callTransform(transformer, rolled, mpm);
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
      [tiedPrincipal('f3', 720, 53)],
    );

  test('drops the tied grace note from the pool and strikes the principal in its place', () => {
    const mpm = createMpm();
    callTransform(new InsertTemporalSpread({ scope: 'global', graces: 'all' }), msm(), mpm);
    const { ornament, pool, frame } = figure(mpm, 'f3');
    expect(ornament.noteOrder).toBe('#bb #f3');
    expect(pool).toEqual([['bb', '46']]);
    expect(frame).toMatchObject({ start: -350, length: 110 });
  });

  test('is skipped when nothing recorded sounds on its date', () => {
    const mpm = createMpm();
    const lonely = alignment([], msm().graces, msm().tiedPrincipals);
    callTransform(new InsertTemporalSpread({ scope: 'global', graces: 'all' }), lonely, mpm);
    expect(getInstructions(mpm, 'ornament', 'global')).toEqual([]);
  });

  // The renderer plays a figure in its principal's place, and a principal the rendered score
  // does not hold is a figure it skips: no ornament is better than one nobody hears.
  test('is skipped when the score it is rendered against will not hold its principal', () => {
    const mpm = createMpm();
    const unstruck = alignment(msm().allNotes, msm().graces);
    callTransform(new InsertTemporalSpread({ scope: 'global', graces: 'all' }), unstruck, mpm);
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

  test('every group in the scope where it asks for all, only the named one with `group`', () => {
    const all = createMpm();
    callTransform(new InsertTemporalSpread({ scope: 'global', graces: 'all' }), msm(), all);
    expect(getInstructions(all, 'ornament', 'global').map((o) => o.id)).toEqual([
      'grace_one',
      'grace_two',
    ]);

    const one = createMpm();
    callTransform(new InsertTemporalSpread({ scope: 'global', group: 'two' }), msm(), one);
    expect(getInstructions(one, 'ornament', 'global').map((o) => o.id)).toEqual(['grace_two']);
    expect(new InsertTemporalSpread({ scope: 'global', group: 'two' }).range(msm())).toEqual({
      from: 1440,
    });
  });

  test('none while a group still has two readings', () => {
    const unchosen = alignment(msm().allNotes, [
      grace('a', 'one', 'p1', 0, 74, 1800, { source: 'x' }),
      grace('a', 'one', 'p1', 0, 74, 1810, { source: 'y' }),
    ]);
    const mpm = createMpm();
    callTransform(new InsertTemporalSpread({ scope: 'global', graces: 'all' }), unchosen, mpm);
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

  // The roll never strikes these as themselves, so no `<when>` names them: the grace note tied
  // into each is struck early and held in its place.
  test('keeps the five principals a grace note is tied into, out of the notes and in the score', () => {
    const msm = asMSM(mei, movement.msm, movement.graces);
    const tied = msm.tiedPrincipals.map((note) => note['xml:id']);
    expect(tied.sort()).toEqual(
      ['n14pg584', 'n14pg584-rend2', 'nanro74', 'nanro74-rend2', 'nrjny5d'].sort(),
    );
    expect(msm.allNotes.filter((note) => tied.includes(note['xml:id']))).toEqual([]);
    expect(msm.tiedPrincipals.find((note) => note['xml:id'] === 'nanro74')).toMatchObject({
      date: 4320,
      duration: 2160,
      'midi.pitch': 53,
      part: 2,
    });
    const score = msm.serializeScore() ?? '';
    for (const id of tied) expect(score).toContain(`xml:id="${id}"`);
  });

  // Rendered against the alignment's own score, as the app renders it, and not against the raw
  // conversion, which holds every note of the MEI and so had the principals all along.
  test('plays bar 3’s B♭–F as the roll does: the F struck 108 ms after the B♭ and held', () => {
    const msm = asMSM(mei, movement.msm, movement.graces);
    callTransform(new MakeChoice({ prefer: 'c9050e75-97a8-4862-9533-0f4b1439802b' }), msm, createMpm());
    const mpm = createMpm();
    callTransform(new InsertTemporalSpread({ scope: 'global', graces: 'all' }), msm, mpm);
    expect(getInstructions(mpm, 'ornament', 'global')).toHaveLength(8);
    // No tempo here for the hinge to convert along, so the frames are defined as measured.
    callTransform(new StylizeOrnamentation(), msm, mpm);

    const played = performMsmToData({ msm: msm.serializeScore() ?? '', mpm: exportMPM(mpm) })
      .parts.flatMap((part) => part.notes)
      .filter((n) => n.ornamentRef === 'grace_pxnvdff');
    expect(played.map((n) => [n.pitch, n.ornamentSource])).toEqual([
      [46, 'n1or9mhw'],
      [53, 'nanro74'],
    ]);
    const [bb, f] = played;
    expect((f?.milliseconds.date ?? 0) - (bb?.milliseconds.date ?? 0)).toBeCloseTo(108, 6);
  });

  // The chain as published, tempo map and all, where the frame is in ticks. Bar 18 is the figure
  // that kept grace notes in milliseconds for a while: its C leads the F of `ritard.`, the F is
  // on a `<tempo>`, and the tempo before it does not land on the note that ends it. Measured
  // back from the recorded boundary, as the hinge once did, the 632 ms came out as 838.
  test('plays bar 18’s C as far ahead of its F as the roll does, through the tempo map', () => {
    const work = parseWorkFile(readFileSync(publishedPath('work'), 'utf-8'));
    const result = runFit(work, asMSM(mei, movement.msm, movement.graces));
    const fitted = new Alignment(result.ground.notes, result.ground.timeSignatures);
    fitted.tiedPrincipals = result.ground.tiedPrincipals;

    const frame = new DOMParser()
      .parseFromString(result.mpm, 'application/xml')
      .querySelector('ornamentDef[name="def_global_grace_y1eaaloe"] temporalSpread');
    expect(frame?.getAttribute('frame.offset')).toMatch(/ticks$/);
    expect(frame?.getAttribute('frameLength')).toMatch(/ticks$/);

    const [c, f] = performMsmToData({
      msm: fitted.serializeScore(partNamesOf(work)) ?? '',
      mpm: result.mpm,
    })
      .parts.flatMap((part) => part.notes)
      .filter((n) => n.ornamentRef === 'grace_y1eaaloe');
    // Within the fourth decimal of a tick the document keeps.
    expect((f?.milliseconds.date ?? 0) - (c?.milliseconds.date ?? 0)).toBeCloseTo(632, 0);
  });
});
