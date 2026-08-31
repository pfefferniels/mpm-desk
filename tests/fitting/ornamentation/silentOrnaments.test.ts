import { describe, expect, test } from 'vitest';
import { Alignment } from '../../../src/fitting/alignment';
import {
  FrameDomain,
  type InstructionOptions,
  Mpm,
  NoteOffShift,
  type OrnamentDraft,
  type Scope,
  createMpm,
  fillInAt,
  findInstructionById,
  requireMap,
  setOrnamentDraft,
  silentOrnaments,
} from '../../../src/fitting/instructions/index';
import { StylizeOrnamentation } from '../../../src/fitting/transformers/index';
import { only } from '../../support/at';

/**
 * `silentOrnaments` says which ornaments the renderer will pass over, and the claim it makes is
 * about espressivo rather than about this application: an `<ornament>` whose `@name.ref` reaches
 * no `<ornamentDef>` sounds as nothing. These tests put it either side of the transformer that
 * writes the definitions, because that is the transition the readouts in the bar are there to
 * report — an ornament a desk has fitted but nothing has stylized.
 */

const callTransform = (transformer: StylizeOrnamentation, msm: Alignment, mpm: Mpm) => {
  interface Transformable {
    transform(msm: Alignment, mpm: Mpm): void;
  }
  (transformer as unknown as Transformable).transform(msm, mpm);
};

const stylize = (mpm: Mpm) =>
  callTransform(
    new StylizeOrnamentation({
      tickTolerance: 10,
      gradientTolerance: 0.1,
      intensityTolerance: 0.3,
    }),
    new Alignment([], { numerator: 4, denominator: 4 }),
    mpm,
  );

/** An `<ornament>` as the fitters leave one: the placeholder reference, the values parked. */
const insertOrnament = (
  mpm: Mpm,
  scope: Scope,
  options: InstructionOptions<'ornament'>,
  draft: OrnamentDraft,
) => {
  const map = requireMap(mpm, 'ornament', scope);
  const element = fillInAt(map, options, {
    localName: 'ornament',
    add: (o) => map.addOrnamentV3(o),
    read: (i) => map.getOrnamentOptionsOf(i),
    update: (i, patch) => map.updateOrnamentAt(i, patch),
  });
  setOrnamentDraft(element, draft);
  return element;
};

const roll = {
  frameStart: -360,
  frameLength: 720,
  frameDomain: FrameDomain.Ticks,
  intensity: 1,
  noteOffShift: NoteOffShift.False,
  transitionFrom: -1,
  transitionTo: 0,
} satisfies OrnamentDraft;

const ids = (mpm: Mpm, scope?: Scope) => silentOrnaments(mpm, scope).map((o) => o.id);

describe('the ornaments the renderer passes over', () => {
  test('a fitted ornament is silent until it is stylized', () => {
    const mpm = createMpm();
    insertOrnament(mpm, 'global', { id: 'roll', date: 0, nameRef: 'neutralArpeggio' }, roll);

    // `neutralArpeggio` is what both fitters write, and no definition ever carries it.
    expect(ids(mpm)).toEqual(['roll']);

    stylize(mpm);

    expect(silentOrnaments(mpm)).toHaveLength(0);
  });

  test('an ornament whose frame did not survive translation stays silent after a run', () => {
    const mpm = createMpm();
    insertOrnament(mpm, 'global', { id: 'roll', date: 0, nameRef: 'neutralArpeggio' }, roll);
    insertOrnament(mpm, 'global', { id: 'unusable', date: 1440, nameRef: 'neutralArpeggio' }, roll);
    // No transformer writes a `NaN` frame; a file some earlier version saved does. See the
    // note on `spoilFrame` in `StylizeOrnamentation.test.ts` — that ornament is given no
    // definition, so it keeps the placeholder and remains unheard.
    const unusable = findInstructionById(mpm, 'unusable');
    if (!unusable) throw new Error('no ornament #unusable to spoil');
    setOrnamentDraft(unusable.element, { frameStart: NaN, frameLength: NaN });

    stylize(mpm);

    expect(only(silentOrnaments(mpm), 'silent ornament').id).toBe('unusable');
  });

  test('a scope is answered for on its own', () => {
    const mpm = createMpm();
    insertOrnament(mpm, 'global', { id: 'shared', date: 0, nameRef: 'neutralArpeggio' }, roll);
    insertOrnament(mpm, 0, { id: 'first_part', date: 0, nameRef: 'neutralArpeggio' }, roll);

    expect(ids(mpm, 0)).toEqual(['first_part']);
    expect(ids(mpm, 'global')).toEqual(['shared']);
    expect(ids(mpm)).toEqual(['shared', 'first_part']);
  });

  test('a definition in the part header resolves for that part', () => {
    const mpm = createMpm();
    insertOrnament(mpm, 0, { id: 'first_part', date: 0, nameRef: 'neutralArpeggio' }, roll);

    // `StylizeOrnamentation` walks every scope and writes each part's definitions into that
    // part's own `<header>`. Resolution has to reach them there, not only in the global one.
    stylize(mpm);

    expect(silentOrnaments(mpm, 0)).toHaveLength(0);
  });
});
