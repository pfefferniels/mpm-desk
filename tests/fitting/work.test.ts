import { describe, expect, test } from 'vitest';
import {
  parseWorkFile,
  serializeWorkFile,
  sourcesOf,
  type Call,
  type WorkFile,
} from '../../src/model/Work';
import { buildChain } from '../../src/fitting/chain';
import '../../src/fitting/transformers/Order';
import { at } from '../support/at';

/**
 * The work file, and the chain built from it.
 *
 * espressivo's `src/fitting/work.ts` was both at once: `exportWork` read a chain and wrote a
 * file, `importWork` read a file and gave back a chain. Here they are two modules —
 * `src/model/Work.ts` reads and writes the document and knows nothing of transformers,
 * `src/fitting/chain.ts` is the registry lookup that turns provenance into a chain — so this
 * file tests the pair, and says at each point which of the two owns the invariant.
 *
 * Two of the five things the espressivo version pinned did not survive the split, and both are
 * deliberate:
 *
 * - **`exportWork` filled a segment's `elements` in from `transformer.created`.** Nothing here
 *   does that. `serializeWorkFile` writes the `WorkFile` it is handed and derives nothing; what
 *   a run produced is projected by `src/model/Reconstruction.ts` instead, from the outcomes the
 *   chain reports. There is no subject left for the assertion.
 * - **`importWork` threw, naming the part of the file it could not read.** `parseWorkFile`
 *   documents that it deliberately does not validate: a file naming a transformer this build
 *   does not have is a real case — it is what a reconstruction saved by a newer build, or by
 *   the build before six transformers were retired, looks like — and reporting it is
 *   `buildChain`'s job. The last test below is what replaced it.
 */

const work = { name: 'Träumerei', mei: 'roll.mei', mpm: 'performance.mpm' };

const call = (name: string, options: Record<string, unknown>): Call => ({
  id: `call-${name}`,
  name,
  options,
});

const choice = () => call('MakeChoice', { scope: 'global', prefer: 'take2' });
const rubato = () => call('InsertRubato', { scope: 'global', date: 0, length: 2880 });

const file = (provenance: Call[], segments: WorkFile['segments'] = []): WorkFile => ({
  ...work,
  provenance,
  segments,
});

describe('the work file', () => {
  test('records every call with the options it ran with', () => {
    const written = serializeWorkFile(file([choice(), rubato()]));
    const read = parseWorkFile(written);

    expect(read.provenance.map((c) => c.name)).toEqual(['MakeChoice', 'InsertRubato']);
    expect(at(read.provenance, 1, 'call').options).toMatchObject({ date: 0, length: 2880 });
    expect(at(read.provenance, 1, 'call').id).toBe('call-InsertRubato');
    expect(read.name).toBe('Träumerei');
  });

  test('carries a segment as it was written, fields this build never heard of and all', () => {
    // Fields from shapes this build no longer writes — `motivation` and `certainty` were dropped
    // in the JSON-LD migration, `calls` when the link moved onto the call. A round trip that
    // quietly tidies them away would edit somebody's file behind their back.
    const segment = {
      id: 'segment-1',
      note: 'Hinspielen auf 1',
      motivation: 'move' as const,
      certainty: 'plausible' as const,
      calls: ['call-InsertRubato'],
    };

    expect(parseWorkFile(serializeWorkFile(file([choice(), rubato()], [segment]))).segments).toEqual(
      [segment],
    );
  });

  /**
   * The `Map` and `Set` envelopes, which are the whole reason these are not `JSON.parse` and
   * `JSON.stringify` at the call site.
   *
   * A reviver without a matching replacer turns every envelope in the shipped file into `{}` —
   * and `{}` has no `.get`, so the first phantom velocity read throws somewhere else entirely.
   * The espressivo tests never pinned this; the shipped reconstruction holds 87 of them.
   */
  test('a Set and a Map option survive the round trip as themselves', () => {
    const written = serializeWorkFile(
      file([
        call('InsertArticulation', { aspects: new Set(['relativeDuration', 'relativeVelocity']) }),
        call('InsertDynamicsInstructions', { phantomVelocities: new Map([['n1', 64]]) }),
      ]),
    );

    // The envelope is in the text, which is what makes the file readable by anything else.
    expect(written).toContain('"dataType": "Set"');
    expect(written).toContain('"dataType": "Map"');

    const provenance = parseWorkFile(written).provenance;
    expect(at(provenance, 0, 'call').options['aspects']).toEqual(
      new Set(['relativeDuration', 'relativeVelocity']),
    );
    expect(at(provenance, 1, 'call').options['phantomVelocities']).toEqual(new Map([['n1', 64]]));
  });

  test('names the recordings the chain chose between', () => {
    expect(sourcesOf([choice(), rubato()])).toEqual(['take2']);
  });

  test('reads the split form of a choice as well as the joint one', () => {
    // A file that names a source per aspect is still a file whose sources are those names.
    const split = call('MakeChoice', {
      scope: 'global',
      velocity: 'take1',
      timing: 'take2',
      pedalling: 'take2',
    });
    expect(sourcesOf([split])).toEqual(['take1', 'take2']);
  });
});

describe('the chain built from it', () => {
  test('comes back as the chain it went out as', () => {
    const json = serializeWorkFile(
      file([{ ...choice(), segment: 'segment-1' }, { ...rubato(), segment: 'segment-1' }], [
        { id: 'segment-1' },
      ]),
    );
    const read = parseWorkFile(json);
    const { transformers, unknown } = buildChain(read.provenance);

    expect(unknown).toEqual([]);
    // `buildChain` always heads the chain with an `InsertMetadata` of its own — an MPM needs a
    // `<metadata>` whether or not the chain says so — and sorts into reduction order.
    expect(transformers.map((t) => t.name)).toEqual([
      'MakeChoice',
      'InsertRubato',
      'InsertMetadata',
    ]);
    expect(at(transformers, 1, 'transformer').id).toBe('call-InsertRubato');
    expect(at(transformers, 1, 'transformer').options).toEqual({
      scope: 'global',
      date: 0,
      length: 2880,
    });
    // The link survives the round trip on the call, which is where it lives.
    expect(read.provenance.map((c) => c.segment)).toEqual(['segment-1', 'segment-1']);
  });

  test('takes the title and author off the metadata call, and rebuilds it', () => {
    const metadata = call('InsertMetadata', {
      authors: [{ number: 0, text: 'Niels Pfeffer' }],
      comments: [{ text: 'Träumerei' }],
    });
    const { transformers, title, author } = buildChain([metadata, rubato()]);

    expect(title).toBe('Träumerei');
    expect(author).toBe('Niels Pfeffer');
    // Rebuilt, not reused: the call in the chain is not the one the file described, which is
    // why it belongs to no segment.
    expect(transformers.filter((t) => t.name === 'InsertMetadata')).toHaveLength(1);
    expect(transformers.find((t) => t.name === 'InsertMetadata')?.id).not.toBe(metadata.id);
  });

  /**
   * What replaced `importWork`'s throw.
   *
   * espressivo's importer wrote the name to `console.error` and dropped it, so a chain quietly
   * ran with fewer calls than the file declared. `buildChain` hands the unknown calls back —
   * which is the only reason a reconstruction saved before the six transformers were retired
   * can still be opened here at all, and the only way anything can say what it lost.
   */
  test('reports a call this build cannot run rather than dropping it silently', () => {
    const { transformers, unknown } = buildChain([
      rubato(),
      call('InsertAsynchrony', {}),
      call('InventASonata', {}),
    ]);

    // `InsertAsynchrony` is a real espressivo fitter this build does not have, and
    // `InventASonata` never existed anywhere — a chain can name either, and both have to come
    // back named rather than quietly missing from the result.
    expect(unknown.map((c) => c.name)).toEqual(['InsertAsynchrony', 'InventASonata']);
    expect(transformers.map((t) => t.name)).toEqual(['InsertRubato', 'InsertMetadata']);
  });

  test('follows the registry alias, so the misspelling in the shipped file still builds', () => {
    const { transformers, unknown } = buildChain([call('TranslatePhyiscalTimeToTicks', {})]);

    expect(unknown).toEqual([]);
    expect(transformers.map((t) => t.name)).toEqual([
      'TranslatePhysicalTimeToTicks',
      'InsertMetadata',
    ]);
  });
});
