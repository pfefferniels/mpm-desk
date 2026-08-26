import { describe, expect, test } from 'vitest';
import {
  auditInstructions,
  createMpm,
  exportMPM,
  getInstructions,
  Mpm,
  requireMap,
} from '../../../src/fitting/instructions/index';
import { Alignment } from '../../../src/fitting/alignment';
import { at } from '../../support/at';
import {
  AbstractTransformer,
  type TransformationOptions,
} from '../../../src/fitting/transformers/Transformer';

/**
 * mpmify never authors a non-finite attribute; it still reads one.
 *
 * `String(NaN)` is `'NaN'`, and `'NaN'` is a perfectly well-formed attribute value — the
 * document stays schema-valid while saying something no renderer can act on, and the fit that
 * produced it is several steps away by the time anyone notices.
 *
 * The guard is a **sweep**, not a check on the way in. It used to be the latter, which meant it
 * only saw values passed to one generic write method — so it also meant one had to exist. Now
 * `auditInstructions` walks the document and `AbstractTransformer.run` refuses afterwards, which
 * costs one pass per transformer and covers every path into the document, including a write
 * made straight through an espressivo map.
 *
 * It is mpmify's and not espressivo's because espressivo's interior is frozen at
 * logs-and-returns by its own RULE E1: throwing there would be a divergence from the library it
 * is held byte-equivalent to.
 *
 * Reading is deliberately not symmetrical: files written before the guard existed contain such
 * values, and refusing to parse them would make old work unopenable rather than diagnosable.
 */

/** A transformer that writes exactly what it is told, so the guard is what is under test. */
class WritesTempo extends AbstractTransformer<TransformationOptions> {
  readonly name = 'WritesTempo';
  readonly requires = [];
  constructor(
    private readonly bpm: number,
    // Not `id` — the base class has a public one. No default: a default fires on an
    // explicit `undefined`, which is exactly the case one of these tests is about.
    private readonly elementId?: string,
  ) {
    super({});
  }
  protected transform(_msm: Alignment, mpm: Mpm) {
    requireMap(mpm, 'tempo', 'global').addTempo({
      id: this.elementId,
      date: 0,
      bpm: this.bpm,
      beatLength: 0.25,
    });
  }
}

const run = (transformer: AbstractTransformer<TransformationOptions>, mpm: Mpm) =>
  transformer.run(new Alignment([], { numerator: 4, denominator: 4 }), mpm);

describe('a non-finite number never survives a transformer', () => {
  test('NaN is refused, and the message names the attribute', () => {
    expect(() => run(new WritesTempo(NaN, 't1'), createMpm())).toThrow(/<tempo @bpm>="NaN"/);
  });

  test('an infinity is refused too', () => {
    expect(() => run(new WritesTempo(Infinity, 't1'), createMpm())).toThrow(
      /must be a finite number/,
    );
  });

  test('finite numbers are untouched, including zero and negatives', () => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'tempo', 'global');
    map.addTempo({ id: 't1', date: 0, bpm: 60, beatLength: 0.25 });
    map.updateTempoAt(0, { transitionTo: 0, meanTempoAt: -0.5 });

    expect(auditInstructions(mpm).nonFinite).toEqual([]);
    expect(exportMPM(mpm)).toContain('transition.to="0"');
    expect(exportMPM(mpm)).toContain('meanTempoAt="-0.5"');
  });

  test('an instruction with no xml:id is refused for the same reason', () => {
    // Not about finiteness, but the same sweep and the same moment: one without an id
    // cannot be named in a work file's segment `elements`, so the call that wrote it goes
    // unattributed and the bake silently drops its span.
    expect(() => run(new WritesTempo(60), createMpm())).toThrow(/no xml:id/);
  });
});

describe('a non-finite number already in a document', () => {
  test('still reads back as NaN', () => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'tempo', 'global');
    map.addTempo({ id: 't1', date: 0, bpm: 60, beatLength: 0.25, meanTempoAt: 0.5 });

    // What a file written by an earlier version looks like once parsed.
    map.getElement(0)?.getAttribute('meanTempoAt')?.setValue('NaN');

    expect(at(getInstructions(mpm, 'tempo', 'global'), 0, 'tempo').meanTempoAt).toBeNaN();
    expect(auditInstructions(mpm).nonFinite).toEqual(['<tempo @meanTempoAt>="NaN"']);
  });

  test('@bpm is number-or-name, so a NaN there comes back as the string "NaN"', () => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'tempo', 'global');
    map.addTempo({ id: 't1', date: 0, bpm: 60, beatLength: 0.25 });

    // `@bpm` may name a tempo ("Allegro"), so espressivo's reader keeps anything that is
    // not a round-tripping number as text: read back, this NaN is a tempo *named* "NaN".
    // That is why the sweep looks at the serialized attribute and not at the parsed value —
    // a test on the value sees an ordinary string and passes.
    map.getElement(0)?.getAttribute('bpm')?.setValue('NaN');

    expect(at(getInstructions(mpm, 'tempo', 'global'), 0, 'tempo').bpm).toBe('NaN');
    expect(auditInstructions(mpm).nonFinite).toEqual(['<tempo @bpm>="NaN"']);
  });
});
