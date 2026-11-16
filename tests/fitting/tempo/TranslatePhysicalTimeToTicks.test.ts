import { describe, expect, test } from 'vitest';
import { FrameDomain, NoteOffShift, OrnamentNote, performMsmToData } from 'espressivo';
import { Alignment } from '../../../src/fitting/alignment';
import {
  type InstructionOptions,
  Mpm,
  type OrnamentDraft,
  createMpm,
  exportMPM,
  fillInAt,
  getInstructions,
  ornamentDraftOf,
  requireMap,
  setOrnamentDraft,
} from '../../../src/fitting/instructions/index';
import { TranslatePhysicalTimeToTicks } from '../../../src/fitting/transformers/tempo/TranslatePhysicalTimeToTicks';
import { StylizeOrnamentation } from '../../../src/fitting/transformers/ornamentation/StylizeOrnamentation';
import { deriveResidual } from '../../../src/fitting/residual';

/**
 * Quickly generates a simple MSM note
 * @note Example for duration and position: 0.25 = quarter note etc.
 */
const generateNote = (position: number, duration: number, part = 1) => ({
  'xml:id': `n_${part}_${position}`,
  date: position * 4 * 720,
  part: part,
  staff: String(part),
  layer: '1',
  pitchname: 'g',
  octave: 4,
  duration: duration * 4 * 720,
  accidentals: 0,
  'midi.pitch': 67,
});

/**
 * Call the protected `transform` method for testing, the way the other transformer tests do.
 * Calling it directly type-checks only as long as nobody type-checks the tests.
 */
const callTransform = (transformer: TranslatePhysicalTimeToTicks, msm: Alignment, mpm: Mpm) => {
  interface Transformable {
    transform(msm: Alignment, mpm: Mpm): void;
  }
  (transformer as unknown as Transformable).transform(msm, mpm);
};

const msmFixture = new Alignment(
  [
    {
      ...generateNote(0, 0.5), // half note ...
      'milliseconds.date': 0,
      'milliseconds.date.end': 2000, // lasting 2000 ms (i.e. 60bpm)
      velocity: 100,
    },
    {
      ...generateNote(0.5, 0.25), // quarter note ...
      'milliseconds.date': 2000,
      'milliseconds.date.end': 3000, // lasting 1000 ms (i.e. 60bpm too)
      velocity: 100,
    },
    {
      ...generateNote(0.75, 0.25),
      'milliseconds.date': 3000,
      'milliseconds.date.end': 4000,
      velocity: 100,
    },
  ],
  [{ date: 0, numerator: 4, denominator: 4 }],
);

// The claim this file used to make here — that a 60bpm tempo puts these recorded onsets at
// these ticks — is now `deriveResidual`'s to answer, and it is asserted where the conversion
// lives. This transformer no longer touches the score at all.
test('at 60bpm a recorded onset lands on the tick the beat length implies', () => {
  const mpm = createMpm();
  requireMap(mpm, 'tempo', 'global').addTempo({
    id: 'tempo_el',
    bpm: 60,
    beatLength: 0.25,
    date: 0,
  });

  const residual = deriveResidual(msmFixture, mpm);

  expect(residual.notes.map((n) => n.tickDate)).toEqual([0, 1440, 2160]);
});

test('it translates existing physical modifiers into tick modifiers', () => {
  // Arrange: a piece under a single constant tempo, so the tick/ms ratio is known exactly.
  // At 60 bpm with beatLength 0.25 a quarter note (720 ticks) lasts 1000 ms, i.e. 0.72
  // ticks per millisecond.
  const msm = new Alignment(
    [
      {
        ...generateNote(0, 0.25),
        'milliseconds.date': 0,
        'milliseconds.date.end': 1000,
        velocity: 100,
      },
      {
        ...generateNote(0.25, 0.25),
        'milliseconds.date': 1000,
        'milliseconds.date.end': 2000,
        velocity: 100,
      },
      {
        ...generateNote(0.5, 0.25),
        'milliseconds.date': 2000,
        'milliseconds.date.end': 3000,
        velocity: 100,
      },
    ],
    [{ date: 0, numerator: 4, denominator: 4 }],
  );

  const mpm = createMpm();
  requireMap(mpm, 'tempo', 'global').addTempo({
    date: 0,
    id: 'tempo_1',
    beatLength: 0.25,
    bpm: 60,
  });

  // The frame is not an `<ornament>` attribute — it describes the `<temporalSpread>` of the def
  // the `@name.ref` points at, and until `StylizeOrnamentation` builds that def it is parked on
  // the element as a draft. So the fixture is written in two halves, the instruction and the
  // draft, which is exactly how `InsertTemporalSpread` writes one.
  const physicalArpeggios: [InstructionOptions<'ornament'>, OrnamentDraft][] = [
    [
      { date: 720, id: 'ornament_720', noteOrder: 'ascending pitch', nameRef: 'arpeggio' },
      { frameStart: -50, frameLength: 100, frameDomain: FrameDomain.Milliseconds },
    ],
    [
      { date: 1440, id: 'ornament_1440', noteOrder: 'ascending pitch', nameRef: 'arpeggio' },
      { frameStart: -25, frameLength: 50, frameDomain: FrameDomain.Milliseconds },
    ],
  ];
  const ornaments = requireMap(mpm, 'ornament', 'global');
  for (const [options, draft] of physicalArpeggios) {
    setOrnamentDraft(
      fillInAt(ornaments, options, {
        localName: 'ornament',
        add: (o) => ornaments.addOrnamentV3(o),
        read: (i) => ornaments.getOrnamentOptionsOf(i),
        update: (i, patch) => ornaments.updateOrnamentAt(i, patch),
      }),
      draft,
    );
  }

  // Act
  const translate = new TranslatePhysicalTimeToTicks({
    translatePhysicalModifiers: true,
  });
  callTransform(translate, msm, mpm);

  // Assert
  const drafts = getInstructions(mpm, 'ornament', 'global').map((arpeggio) =>
    ornamentDraftOf(arpeggio.element),
  );
  expect(drafts.every((draft) => draft.frameDomain === FrameDomain.Ticks)).toBeTruthy();
  expect(drafts.map((d) => d.frameStart)).toEqual([-36, -18]);
  expect(drafts.map((d) => d.frameLength)).toEqual([72, 36]);
});

/**
 * A frame is a distance the renderer measures, so what is asserted here is the render: the
 * fitted document performed, and the notes found as far from the ornament's date as the frame
 * said in milliseconds.
 *
 * Every case has two tempi meeting on tick 1440, and the first does not land on the note that
 * ends it: at 50 bpm it says its two quarters last 2400 ms, where the recording has the note on
 * the boundary at 2000. That difference is what the conversion once put into every frame that
 * reached across the boundary, by measuring back from the recorded 2000 along a curve that ends
 * at 2400.
 */
describe('a frame in ticks plays back as it was measured in milliseconds', () => {
  const QUARTER = 720;
  const SLOW = 50; // 1200 ms a quarter
  const QUICK = 60000 / 700; // 700 ms a quarter

  const recorded = (id: string, date: number, ms: number, pitch = 60) => ({
    ...generateNote(date / (4 * QUARTER), 0.25),
    'xml:id': id,
    'midi.pitch': pitch,
    'milliseconds.date': ms,
    'milliseconds.date.end': ms + 500,
    velocity: 60,
  });

  /** The first tempo from tick 0, constant or easing off to 40, and the quick one from 1440. */
  const twoTempi = (first: Partial<InstructionOptions<'tempo'>> = {}) => {
    const mpm = createMpm();
    const tempo = requireMap(mpm, 'tempo', 'global');
    tempo.addTempo({ id: 'slow', date: 0, bpm: SLOW, beatLength: 0.25, ...first });
    tempo.addTempo({ id: 'quick', date: 2 * QUARTER, bpm: QUICK, beatLength: 0.25 });
    return mpm;
  };

  /** One `<ornament>` with a frame in milliseconds parked on it, as the fitters leave one. */
  const park = (mpm: Mpm, options: InstructionOptions<'ornament'>, start: number, length: number) => {
    const map = requireMap(mpm, 'ornament', 'global');
    setOrnamentDraft(
      fillInAt(map, options, {
        localName: 'ornament',
        add: (o) => map.addOrnamentV3(o),
        read: (i) => map.getOrnamentOptionsOf(i),
        update: (i, patch) => map.updateOrnamentAt(i, patch),
      }),
      {
        frameStart: start,
        frameLength: length,
        frameDomain: FrameDomain.Milliseconds,
        noteOffShift: NoteOffShift.Monophonic,
      },
    );
  };

  /** The chain from the hinge on, and where the renderer then sounds each note, by id. */
  const perform = (msm: Alignment, mpm: Mpm) => {
    callTransform(new TranslatePhysicalTimeToTicks(), msm, mpm);
    const drafts = new Map(
      getInstructions(mpm, 'ornament', 'global').map((o) => [o.id, ornamentDraftOf(o.element)]),
    );
    (new StylizeOrnamentation() as unknown as { transform(msm: Alignment, mpm: Mpm): void }).transform(
      msm,
      mpm,
    );
    const onsets = new Map(
      performMsmToData({ msm: msm.serializeScore() ?? '', mpm: exportMPM(mpm) })
        .parts.flatMap((part) => part.notes)
        .map((note) => [note.ornamentSource ?? note.id, note.milliseconds.date]),
    );
    return { drafts, at: (id: string) => onsets.get(id) ?? NaN };
  };

  // The renderer times a chord on a `<tempo>`'s own date by the tempo *before* it, and so every
  // note the roll moves off that date, the ones after it included. Converted along the tempo
  // that starts there instead, the 100 ms of the roll after the beat came out as 171 here.
  test('a roll on a tempo boundary, either side of the beat', () => {
    const msm = new Alignment(
      [
        recorded('a', 0, 0),
        recorded('b', QUARTER, 1000),
        recorded('low', 2 * QUARTER, 2000, 48),
        recorded('mid', 2 * QUARTER, 2000, 60),
        recorded('top', 2 * QUARTER, 2000, 72),
        recorded('d', 4 * QUARTER, 3400),
      ],
      [{ date: 0, numerator: 4, denominator: 4 }],
    );
    const mpm = twoTempi();
    park(mpm, { id: 'roll', date: 2 * QUARTER, nameRef: 'neutralArpeggio', noteOrder: 'ascending pitch' }, -100, 200);

    const { drafts, at } = perform(msm, mpm);

    // 100 ms either side at 50 bpm, which is 0.6 ticks a millisecond.
    expect(drafts.get('roll')).toMatchObject({ frameDomain: FrameDomain.Ticks });
    expect(drafts.get('roll')?.frameStart).toBeCloseTo(-60, 6);
    expect(drafts.get('roll')?.frameLength).toBeCloseTo(120, 6);
    expect(at('low') - at('mid')).toBeCloseTo(-100, 3);
    expect(at('top') - at('mid')).toBeCloseTo(100, 3);
  });

  // A grace figure's notes are written into the score where the frame puts them, and each is
  // timed by the tempo that has its tick: the slow one before the boundary, the quick one after.
  // The principal is half a quick beat past it, 350 ms on, and the grace note 600 ms ahead of
  // that, which is 250 ms of the slow tempo. Measured back from the recorded boundary it came
  // out 1000 ms ahead.
  test('a grace figure that reaches back across a tempo boundary', () => {
    const msm = new Alignment(
      [
        recorded('a', 0, 0),
        recorded('b', QUARTER, 1000),
        recorded('x', 2 * QUARTER, 2000),
        recorded('p', 2.5 * QUARTER, 2350, 72),
        recorded('d', 4 * QUARTER, 3400),
      ],
      [{ date: 0, numerator: 4, denominator: 4 }],
    );
    const mpm = twoTempi();
    park(
      mpm,
      {
        id: 'figure',
        date: 2.5 * QUARTER,
        nameRef: 'neutralArpeggio',
        noteid: '#p',
        noteOrder: '#g #p',
        notes: [new OrnamentNote('g', { kind: 'midi', value: 74 })],
      },
      -600,
      600,
    );

    const { drafts, at } = perform(msm, mpm);

    // 350 ms of the quick tempo is the 360 ticks back to the boundary, and 250 ms of the slow
    // one is 150 more.
    expect(drafts.get('figure')?.frameStart).toBeCloseTo(-510, 6);
    expect(drafts.get('figure')?.frameLength).toBeCloseTo(510, 6);
    expect(at('p') - at('g')).toBeCloseTo(600, 3);
  });

  // A partial fit: the tempo map starts later than the piece does. No `<tempo>` of the document
  // times a chord before it, so there is nothing to measure its frame under.
  test('a roll before the tempo map begins stays in milliseconds', () => {
    const msm = new Alignment(
      [
        recorded('low', 0, 0, 48),
        recorded('top', 0, 0, 72),
        recorded('b', 2 * QUARTER, 2000),
        recorded('d', 4 * QUARTER, 3400),
      ],
      [{ date: 0, numerator: 4, denominator: 4 }],
    );
    const mpm = createMpm();
    requireMap(mpm, 'tempo', 'global').addTempo({ id: 'late', date: 2 * QUARTER, bpm: QUICK, beatLength: 0.25 });
    park(mpm, { id: 'roll', date: 0, nameRef: 'neutralArpeggio', noteOrder: 'ascending pitch' }, 0, 150);

    const { drafts, at } = perform(msm, mpm);

    expect(drafts.get('roll')).toMatchObject({
      frameStart: 0,
      frameLength: 150,
      frameDomain: FrameDomain.Milliseconds,
    });
    expect(at('top') - at('low')).toBeCloseTo(150, 3);
  });

  // The renderer has no time for a note that an ornament moves to before the start of the
  // transition its chord lies in: it takes a power of a negative number there, and the note is
  // sounded at NaN. A frame that would ask for that is left in milliseconds, which are added
  // after the tempo map has run.
  test('a roll that begins before the transition its chord lies in stays in milliseconds', () => {
    const msm = new Alignment(
      [
        recorded('a', 0, 0),
        recorded('b', 0.25 * QUARTER, 300),
        recorded('low', 0.25 * QUARTER, 300, 48),
        recorded('d', 2 * QUARTER, 2000),
        recorded('e', 4 * QUARTER, 3400),
      ],
      [{ date: 0, numerator: 4, denominator: 4 }],
    );
    const mpm = twoTempi({ transitionTo: 40, meanTempoAt: 0.4 });
    // A quarter of a beat in, the roll begins 400 ms ahead: before the tempo does.
    park(mpm, { id: 'roll', date: 0.25 * QUARTER, nameRef: 'neutralArpeggio', noteOrder: 'ascending pitch' }, -400, 400);

    const { drafts, at } = perform(msm, mpm);

    expect(drafts.get('roll')).toMatchObject({
      frameStart: -400,
      frameLength: 400,
      frameDomain: FrameDomain.Milliseconds,
    });
    expect(at('b') - at('low')).toBeCloseTo(400, 3);
  });
});
