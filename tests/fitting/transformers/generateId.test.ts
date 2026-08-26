import { describe, expect, test } from 'vitest';
import {
  createMpm,
  type InstructionOptions,
  Mpm,
  requireMap,
} from '../../../src/fitting/instructions/index';
import { generateId } from '../../../src/fitting/transformers/Transformer';

const tempo = (date: number, id: string): InstructionOptions<'tempo'> => ({
  id,
  date,
  bpm: 60,
  beatLength: 0.25,
});

const addTempo = (mpm: Mpm, id: string) =>
  requireMap(mpm, 'tempo', 'global').addTempo(tempo(0, id));

const withTempos = (...ids: string[]) => {
  const mpm = createMpm();
  for (const id of ids) addTempo(mpm, id);
  return mpm;
};

/**
 * An `xml:id` has to be free, and the suffix used to be the *count* of instructions at the date
 * rather than the first free index. Counting is only the same thing while nothing has ever been
 * removed — and removal is ordinary operation: `InsertTempo` clears every `<tempo>` inside the
 * range it owns before writing its own, and `InsertArticulation` and `StylizeOrnamentation`
 * merge instructions away into definitions (issue #30).
 *
 * A collision is not cosmetic: `AbstractTransformer.run` derives `created` by fingerprinting
 * instructions *by id*, so two elements sharing one id look like one element and only the
 * second can be attributed to the transformer that wrote it.
 */
describe('generateId', () => {
  test('takes the bare name when the date holds nothing', () => {
    expect(generateId('tempo', 0, createMpm())).toBe('tempo_0');
  });

  test('counts up while ids are taken', () => {
    const mpm = withTempos('tempo_0');
    expect(generateId('tempo', 0, mpm)).toBe('tempo_0_1');

    addTempo(mpm, 'tempo_0_1');
    expect(generateId('tempo', 0, mpm)).toBe('tempo_0_2');
  });

  test('does not reissue an id a removal left a hole before', () => {
    // Two instructions at the date, so counting answers `tempo_0_2` — which is taken.
    const mpm = withTempos('tempo_0_1', 'tempo_0_2');

    expect(generateId('tempo', 0, mpm)).toBe('tempo_0');
  });

  test('skips over a hole in the middle of the run', () => {
    const mpm = withTempos('tempo_0', 'tempo_0_2');

    expect(generateId('tempo', 0, mpm)).toBe('tempo_0_1');
  });

  test('a different date is a different name, not a different suffix', () => {
    const mpm = withTempos('tempo_0');

    expect(generateId('tempo', 720, mpm)).toBe('tempo_720');
  });

  test('an id taken in another scope is taken here too', () => {
    // The scan is over the whole document, not over one part: an id is only unique if it is
    // unique everywhere the MPM writer can name it.
    const mpm = createMpm();
    requireMap(mpm, 'tempo', 0).addTempo(tempo(0, 'tempo_0'));

    expect(generateId('tempo', 0, mpm)).toBe('tempo_0_1');
  });
});
