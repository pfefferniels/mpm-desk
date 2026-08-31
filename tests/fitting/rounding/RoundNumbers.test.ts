/**
 * Rounding, over the shipped fitted document.
 *
 * A real fixture rather than a built one: what this transformer has to get right is the MPM
 * vocabulary, and a document assembled here would only carry the attributes whoever wrote the
 * test remembered. `src/test/fixtures/performance.mpm` is a run of the chain over the Grünfeld
 * reconstruction, so it holds every element type the fitters write, with the digits they wrote.
 *
 * An *older* run, which is what makes it the better of the two documents in the tree for this:
 * it carries three attributes MPM does not name, and so shows what the transformer leaves alone
 * as well as what it rewrites. `public/performance.mpm`, the current chain's own export, is read
 * beside it for the other half — that the table has not fallen behind the fitters.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { Alignment } from '../../../src/fitting/alignment';
import { exportMPM, getInstructions, parseMPM } from '../../../src/fitting/instructions/index';
import { RoundNumbers } from '../../../src/fitting/transformers/rounding/RoundNumbers';
import { buildChain } from '../../../src/fitting/chain';
import { at } from '../../support/at';

const source = readFileSync('src/test/fixtures/performance.mpm', 'utf-8');

/** The transformer, run the way the chain runs it. `RoundNumbers` reads no note. */
const rounded = (xml: string): string => {
  const mpm = parseMPM(xml);
  new RoundNumbers().run(new Alignment([]), mpm);
  return exportMPM(mpm);
};

/** Every element of a serialized document, in document order, with its attributes in theirs. */
const walk = (xml: string) => {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  return [...document.getElementsByTagName('*')].map((element) => ({
    name: element.localName,
    attributes: [...element.attributes].map((attribute) => ({
      name: attribute.name,
      value: attribute.value,
    })),
  }));
};

/**
 * The fixture as espressivo reads and writes it back, which is what rounding has to be compared
 * against. A parse is not faithful — it re-sorts every map by date, and the fixture holds a
 * `<style>` filed after an instruction dated later than it — so a comparison against the file on
 * disk would report the parser's repairs as this transformer's doing.
 */
const baseline = exportMPM(parseMPM(source));
const once = rounded(source);

/**
 * What this fixture carries that MPM does not name, and that is therefore left as it was found.
 *
 * All three come of the file predating the mpmify port. `@endDate` was mpm-ts's own working
 * field, serialized by accident — a `<tempo>` has no end in MPM — and an `<ornament>` has no
 * `@intensity`; it is `<temporalSpread>` that does.
 *
 * Named rather than tolerated. Rounding whatever parses as a number would rewrite all three, and
 * a foreign attribute is the one a document can least afford to have edited.
 */
const NOT_MPM = ['tempo@endDate', 'dynamics@endDate', 'ornament@intensity'];

/** `element@attribute` for every attribute of a document, so a pair can be named. */
const pairs = (xml: string) =>
  walk(xml).flatMap(({ name, attributes }) =>
    attributes.map((attribute) => ({ key: `${name}@${attribute.name}`, value: attribute.value })),
  );

/**
 * The numeric attributes still written with more than four digits after the point.
 *
 * Numeric, so that an id built from a date — `generateId` writes `tempo_48294.11764705881` for
 * the one `<tempo>` in the shipped document that does not sit on a whole tick — is not read as an
 * over-precise measurement. It is a name, and a name is not this transformer's to shorten.
 */
const overPrecise = (xml: string) =>
  pairs(xml).filter(
    ({ value }) => Number.isFinite(Number(value)) && /\.\d{5,}/.test(value),
  );

describe('RoundNumbers', () => {
  test('leaves no number with more than four decimal places', () => {
    expect(overPrecise(once).filter(({ key }) => !NOT_MPM.includes(key))).toEqual([]);
  });

  /**
   * The same check over the document the *current* chain exports.
   *
   * The fixture above cannot know about an attribute a fitter started writing after it was
   * recorded, and an attribute missing from the transformer's table is left long in silence.
   * `public/performance.mpm` is a run of the chain as it stands, so it is where such a gap shows.
   */
  test('rounds every number the chain writes today', () => {
    const shipped = readFileSync('public/performance.mpm', 'utf-8');
    expect(overPrecise(rounded(shipped))).toEqual([]);
  });

  test('leaves an attribute MPM does not name exactly as it found it', () => {
    const before = pairs(baseline).filter(({ key }) => NOT_MPM.includes(key));
    // The fixture has to hold them, or this asserts nothing.
    expect(before.length).toBeGreaterThan(0);
    expect(pairs(once).filter(({ key }) => NOT_MPM.includes(key))).toEqual(before);
  });

  test('moves no value by more than half of the last place it keeps', () => {
    const before = walk(baseline);
    const after = walk(once);

    const moved = before.flatMap(({ attributes }, index) =>
      attributes.flatMap((attribute, position) => {
        const twin = at(at(after, index, 'element').attributes, position, 'attribute');
        const original = Number(attribute.value);
        const written = Number(twin.value);
        if (!Number.isFinite(original) || !Number.isFinite(written)) return [];
        // Strictly `<= 0.00005`; the tolerance is for the double arithmetic, not for the rule.
        return Math.abs(written - original) > 0.00005 + 1e-12
          ? [`@${attribute.name}: ${attribute.value} became ${twin.value}`]
          : [];
      }),
    );
    expect(moved).toEqual([]);
  });

  test('changes the shape of the document in no way at all', () => {
    const before = walk(baseline);
    const after = walk(once);

    expect(after.map((element) => element.name)).toEqual(before.map((element) => element.name));
    expect(after.map((element) => element.attributes.map((a) => a.name))).toEqual(
      before.map((element) => element.attributes.map((a) => a.name)),
    );
  });

  test('leaves alone what is not a measurement', () => {
    const before = walk(baseline);
    const after = walk(once);

    const named = ['id', 'name', 'name.ref', 'noteid', 'note.order', 'controller', 'time.unit'];
    const changed = before.flatMap(({ attributes }, index) =>
      attributes.flatMap((attribute, position) => {
        if (!named.some((name) => attribute.name === name || attribute.name.endsWith(`:${name}`)))
          return [];
        const twin = at(at(after, index, 'element').attributes, position, 'attribute');
        return twin.value === attribute.value ? [] : [`@${attribute.name}: ${twin.value}`];
      }),
    );
    expect(changed).toEqual([]);
  });

  test('is idempotent', () => {
    expect(rounded(once)).toBe(once);
  });

  test('is answerable for nothing it restates', () => {
    const mpm = parseMPM(source);
    const transformer = new RoundNumbers();
    transformer.run(new Alignment([]), mpm);
    // It rewrote most of the document, so the before/after diff `AbstractTransformer.run` takes
    // would otherwise credit this call with every instruction in it.
    expect(getInstructions(mpm).length).toBeGreaterThan(0);
    expect(transformer.created).toEqual([]);
  });

  test('the chain runs it last, and runs it whether or not a file asked for it', () => {
    const names = buildChain([]).transformers.map((transformer) => transformer.name);
    expect(names).toContain('RoundNumbers');
    expect(names.at(-1)).toBe('RoundNumbers');
  });

  test('a saved call naming it is dropped rather than run twice', () => {
    const { transformers } = buildChain([
      { id: 'saved', name: 'RoundNumbers', options: {} },
    ]);
    expect(transformers.filter((t) => t.name === 'RoundNumbers')).toHaveLength(1);
    expect(transformers.map((t) => t.id)).not.toContain('saved');
  });
});
