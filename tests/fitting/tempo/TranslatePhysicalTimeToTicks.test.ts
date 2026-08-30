import { expect, test } from 'vitest';
import { FrameDomain } from 'espressivo';
import { Alignment } from '../../../src/fitting/alignment';
import {
  type InstructionOptions,
  Mpm,
  type OrnamentDraft,
  createMpm,
  fillInAt,
  getInstructions,
  ornamentDraftOf,
  requireMap,
  setOrnamentDraft,
} from '../../../src/fitting/instructions/index';
import { TranslatePhysicalTimeToTicks } from '../../../src/fitting/transformers/tempo/TranslatePhysicalTimeToTicks';
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
  { numerator: 4, denominator: 4 },
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
    { numerator: 4, denominator: 4 },
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
