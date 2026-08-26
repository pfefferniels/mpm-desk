import { describe, expect, test } from 'vitest';
import { createMpm, exportMPM } from '../../../src/fitting/instructions/index';
import { InsertMetadata } from '../../../src/fitting/transformers/index';
import { Alignment } from '../../../src/fitting/alignment';

const score = () => new Alignment();

const write = (options: ConstructorParameters<typeof InsertMetadata>[0]) => {
  const mpm = createMpm();
  new InsertMetadata(options).run(score(), mpm);
  return mpm;
};

describe('InsertMetadata', () => {
  test('writes the three children the ODD gives <metadata>', () => {
    const xml = exportMPM(
      write({
        authors: [{ number: 0, text: 'Niels Pfeffer' }],
        comments: [{ text: 'Welte 225' }],
        relatedResources: [{ uri: 'roll.mei', type: 'mei' }],
      }),
    );

    expect(xml).toContain('<author number="0">Niels Pfeffer</author>');
    expect(xml).toContain('<comment>Welte 225</comment>');
    expect(xml).toContain('<resource uri="roll.mei" type="mei" />');
  });

  test('puts <metadata> before the performance, as the content model requires', () => {
    // `<mpm>` is `metadata? performance+`, a sequence — and espressivo's `addMetadata`
    // appends to the root, so the element lands after a performance that is already there.
    const xml = exportMPM(write({ comments: [{ text: 'Welte 225' }] }));

    expect(xml.indexOf('<metadata>')).toBeGreaterThan(-1);
    expect(xml.indexOf('<metadata>')).toBeLessThan(xml.indexOf('<performance'));
  });

  test('says what the options say, not what the options say twice', () => {
    // `addMetadata` appends to a `<metadata>` that is already there. Running the same chain
    // over one document a second time must not list the author twice.
    const mpm = createMpm();
    const transformer = new InsertMetadata({ authors: [{ number: 0, text: 'Grünfeld' }] });
    transformer.run(score(), mpm);
    const once = exportMPM(mpm);
    transformer.run(score(), mpm);

    expect(exportMPM(mpm)).toEqual(once);
  });

  test('writes nothing at all when there is nothing to write', () => {
    expect(exportMPM(write({}))).not.toContain('metadata');
  });
});
