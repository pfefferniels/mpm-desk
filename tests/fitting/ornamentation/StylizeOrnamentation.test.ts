import { describe, expect, test } from 'vitest';
import { Alignment } from '../../../src/fitting/alignment';
import {
  FrameDomain,
  type InstructionOptions,
  Mpm,
  NoteOffShift,
  type OrnamentDraft,
  createMpm,
  fillInAt,
  findInstructionById,
  getDefinitions,
  getInstructions,
  ornamentDraftOf,
  requireMap,
  setOrnamentDraft,
} from '../../../src/fitting/instructions/index';
import { StylizeOrnamentation } from '../../../src/fitting/transformers/index';
import { at, only } from '../../support/at';

/**
 * `StylizeOrnamentation` moves the def fields an ornament was fitted with into an
 * `<ornamentDef>` and points the ornament at it. The failure mode this file pins is the one in
 * issue #28: the two halves coming apart, so that the map names a definition that was never
 * written and the ornament has been emptied of the fields that would have described it.
 *
 * These drive the transformer directly with ornaments already in the MPM, because that is where
 * the fitters leave them and the shapes below are ones the ordinary chain no longer produces.
 */

const callTransform = (transformer: StylizeOrnamentation, msm: Alignment, mpm: Mpm) => {
  interface Transformable {
    transform(msm: Alignment, mpm: Mpm): void;
  }
  (transformer as unknown as Transformable).transform(msm, mpm);
};

const run = (mpm: Mpm) =>
  callTransform(
    new StylizeOrnamentation({
      tickTolerance: 10,
      gradientTolerance: 0.1,
      intensityTolerance: 0.3,
    }),
    new Alignment([], [{ date: 0, numerator: 4, denominator: 4 }]),
    mpm,
  );

const defNames = (mpm: Mpm) =>
  getDefinitions(mpm, 'ornamentDef', 'global').map((def) => def.getName());

const ornaments = (mpm: Mpm) => getInstructions(mpm, 'ornament', 'global');

/**
 * An `<ornament>` as the fitters leave it — in the two goes it takes to write one.
 *
 * What MPM lets the instruction say goes through `fillInAt`, which is what the fitters
 * themselves write through; the frame, the ramp and the intensity are `<ornamentDef>` fields with
 * no place on an `<ornament>`, so they are parked on its element for `StylizeOrnamentation` to
 * collect. Both halves are the fixture, and a test that stated only the first would describe an
 * ornament nothing had fitted.
 */
const insertOrnament = (
  mpm: Mpm,
  options: InstructionOptions<'ornament'>,
  draft: OrnamentDraft,
) => {
  const map = requireMap(mpm, 'ornament', 'global');
  const element = fillInAt(map, options, {
    localName: 'ornament',
    add: (o) => map.addOrnamentV3(o),
    read: (i) => map.getOrnamentOptionsOf(i),
    update: (i, patch) => map.updateOrnamentAt(i, patch),
  });
  setOrnamentDraft(element, draft);
  return element;
};

/**
 * Give an ornament already in the document a frame of literal `NaN`.
 *
 * No transformer can produce one: `auditInstructions` sweeps the attributes an instruction
 * states and `AbstractTransformer.run` fails the run on a non-finite one, so nothing an ornament
 * *says* survives as NaN. Its draft can, parking being plain attribute writing onto attributes no
 * options type names, so the sweep never looks at them. That is where issue #28's corpus
 * ornaments came from, which makes parking `NaN` the faithful fixture rather than a workaround.
 *
 * The branch under test is `StylizeOrnamentation`'s "frame present but not a number", which it
 * treats differently from "no frame at all", so both figures have to be there and have to be NaN.
 * The check below stops a fixture that quietly stopped writing a frame from moving these tests
 * onto the ramp-only path.
 */
const spoilFrame = (mpm: Mpm, id: string) => {
  const instruction = findInstructionById(mpm, id);
  if (!instruction) throw new Error(`no ornament #${id} to spoil`);

  const fitted = ornamentDraftOf(instruction.element);
  if (fitted.frameStart === undefined || fitted.frameLength === undefined) {
    throw new Error(`ornament #${id} has no frame to spoil`);
  }
  setOrnamentDraft(instruction.element, { frameStart: NaN, frameLength: NaN });
};

describe('an ornament and its definition do not come apart (#28)', () => {
  test('an unusable frame leaves the ornament untouched rather than half-processed', () => {
    const mpm = createMpm();
    insertOrnament(
      mpm,
      { id: 'orn_broken', date: 0, nameRef: 'neutralArpeggio', scale: 25 },
      {
        frameStart: -360,
        frameLength: 720,
        frameDomain: FrameDomain.Ticks,
        transitionFrom: -1,
        transitionTo: 0,
      },
    );
    spoilFrame(mpm, 'orn_broken');

    run(mpm);

    // No definition, so no reference to it — and the fit it arrived with is still there to
    // be read. Stripping those while writing no definition is what left the real corpus
    // with three unresolvable @name.ref in one run.
    expect(defNames(mpm)).toHaveLength(0);
    expect(ornamentDraftOf(at(ornaments(mpm), 0, 'ornament').element).transitionFrom).toBe(-1);
    expect(ornamentDraftOf(at(ornaments(mpm), 0, 'ornament').element).transitionTo).toBe(0);
  });

  test('an ornament with a ramp and no roll still gets a definition', () => {
    const mpm = createMpm();
    for (const date of [0, 1440]) {
      insertOrnament(
        mpm,
        { id: `orn_${date}`, date, nameRef: 'neutralArpeggio', scale: 25 },
        { transitionFrom: -1, transitionTo: 0 },
      );
    }

    run(mpm);

    // `InsertDynamicsGradient` fits exactly this shape. Clustering keys on the frame, so
    // these used to fall out of it and keep pointing at `neutralArpeggio`, a name no
    // definition carries.
    const defs = getDefinitions(mpm, 'ornamentDef', 'global');
    expect(defs).toHaveLength(1);
    expect(only(defs, 'ornamentDef').getDynamicsGradient()).not.toBeNull();
    expect(only(defs, 'ornamentDef').getDynamicsGradient()!.transitionFrom).toBeCloseTo(-1, 10);
    expect(only(defs, 'ornamentDef').getDynamicsGradient()!.transitionTo).toBeCloseTo(0, 10);
    expect(only(defs, 'ornamentDef').getTemporalSpread()).toBeNull();

    for (const ornament of ornaments(mpm)) {
      expect(ornament.nameRef).toBe(only(defs, 'ornamentDef').getName());
    }
  });

  test('every @name.ref a run writes resolves to a definition it wrote', () => {
    const mpm = createMpm();
    // A mixture: two rolls that cluster, one ramp-only, and one that cannot be used.
    for (const date of [0, 1440]) {
      insertOrnament(
        mpm,
        { id: `roll_${date}`, date, nameRef: 'neutralArpeggio', scale: 25 },
        {
          frameStart: -360,
          frameLength: 720,
          frameDomain: FrameDomain.Ticks,
          intensity: 1,
          noteOffShift: NoteOffShift.False,
          transitionFrom: -1,
          transitionTo: 0,
        },
      );
    }
    insertOrnament(
      mpm,
      { id: 'ramp_only', date: 2880, nameRef: 'neutralArpeggio', scale: 12 },
      { transitionFrom: 0, transitionTo: -1 },
    );
    insertOrnament(
      mpm,
      { id: 'unusable', date: 4320, nameRef: 'neutralArpeggio' },
      { frameStart: -360, frameLength: 720, frameDomain: FrameDomain.Ticks },
    );
    spoilFrame(mpm, 'unusable');

    run(mpm);

    const written = new Set(defNames(mpm));
    for (const ornament of ornaments(mpm)) {
      const reference = ornament.nameRef;
      if (reference === 'neutralArpeggio') {
        // Only the one that got no definition may still carry the fitter's placeholder.
        expect(ornament.id).toBe('unusable');
        continue;
      }
      expect(written.has(reference), `${ornament.id} names ${reference}`).toBe(true);
    }
  });

  test('a gradient is kept when transition.to is 0, which is a legal end (#46)', () => {
    const mpm = createMpm();
    insertOrnament(
      mpm,
      { id: 'crescendo', date: 0, nameRef: 'neutralArpeggio', scale: 25 },
      {
        frameStart: -360,
        frameLength: 720,
        frameDomain: FrameDomain.Ticks,
        intensity: 1,
        noteOffShift: NoteOffShift.False,
        // The end of `InsertDynamicsGradient`'s own default crescendo.
        transitionFrom: -1,
        transitionTo: 0,
      },
    );

    run(mpm);

    const defs = getDefinitions(mpm, 'ornamentDef', 'global');
    expect(defs).toHaveLength(1);
    expect(only(defs, 'ornamentDef').getDynamicsGradient()).not.toBeNull();
    expect(only(defs, 'ornamentDef').getDynamicsGradient()!.transitionTo).toBe(0);
  });
});
