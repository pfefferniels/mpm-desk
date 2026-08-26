import { describe, expect, test } from 'vitest';
import { createMpm, exportMPM, Mpm, requireMap } from '../../../src/fitting/instructions/index';

/** The attribute names of the first `<tempo>`, in serialized order. */
const tempoAttributeOrder = (mpm: Mpm) => {
  const tag = exportMPM(mpm).match(/<tempo [^>]*\/>/)![0];
  return [...tag.matchAll(/([a-zA-Z:.]+)=/g)].map((m) => m[1]);
};

/**
 * Attribute order is espressivo's now, and it is stable under editing.
 *
 * The order itself moved with the port: mpmify's own writer put `xml:id` second, because its
 * schema table listed the attributes every dated instruction shares before the ones a `<tempo>`
 * adds. espressivo's `addTempo` writes the instruction's own attributes first and `xml:id` last.
 * Neither is more correct — MPM does not order attributes — and nothing downstream reads the
 * document positionally, so what is pinned here is not the order but that *editing does not
 * disturb it*.
 */
describe('editing an instruction', () => {
  test('leaves the attribute where it was in the document', () => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'tempo', 'global');
    const index = map.addTempo({ id: 't1', date: 0, bpm: 120, beatLength: 0.25 });

    const before = tempoAttributeOrder(mpm);
    expect(before).toEqual(['date', 'bpm', 'beatLength', 'xml:id']);

    map.updateTempoAt(index, { bpm: 132 });

    // espressivo's `Element.addAttribute` is remove-then-append, so writing through it
    // would move `bpm` to the end and make every edited document differ from its source by
    // attribute order alone. `patchAttribute` writes through the existing attribute.
    expect(tempoAttributeOrder(mpm)).toEqual(before);
    expect(exportMPM(mpm)).toContain('bpm="132"');
  });

  // `xml:id` is stored namespaced and its local name is `id`, so it only stays put if the
  // lookup asks for the local half. It did not, at first: removal was a silent no-op and a
  // re-set took the append arm.
  test('holds for the namespaced xml:id too', () => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'tempo', 'global');
    const index = map.addTempo({ id: 't1', date: 0, bpm: 120, beatLength: 0.25 });

    map.updateTempoAt(index, { id: 't2' });

    expect(tempoAttributeOrder(mpm)).toEqual(['date', 'bpm', 'beatLength', 'xml:id']);
    expect(exportMPM(mpm)).toContain('xml:id="t2"');
  });

  test('a new attribute lands at the end rather than displacing one', () => {
    const mpm = createMpm();
    const map = requireMap(mpm, 'tempo', 'global');
    const index = map.addTempo({ id: 't1', date: 0, bpm: 120, beatLength: 0.25 });

    map.updateTempoAt(index, { transitionTo: 90 });

    expect(tempoAttributeOrder(mpm)).toEqual([
      'date',
      'bpm',
      'beatLength',
      'xml:id',
      'transition.to',
    ]);
  });
});
