import { describe, expect, test } from 'vitest';
import { Alignment, type AlignedNote } from '../../../src/fitting/alignment';

const note = (id: string, part: number, date: number): AlignedNote =>
  ({
    'xml:id': id,
    part,
    date,
    duration: 720,
    pitchname: 'g',
    accidentals: 0,
    octave: 4,
    'midi.pitch': 67,
  }) as AlignedNote;

/** Each `<part>`'s `@number`, in document order. */
const partNumbers = (xml: string) =>
  [...xml.matchAll(/<part [^>]*number="(\d+)"/g)].map((m) => m[1]);

/** Every note that survived serialization, in document order. */
const noteIds = (xml: string) => [...xml.matchAll(/<note xml:id="(n\d+)"/g)].map((m) => m[1]);

describe('Alignment.serialize', () => {
  // Issue #34. The part list was `Array.from(Array(2).keys())` — exactly two, always — so a
  // third voice never reached the renderer and nothing said so.
  test('writes one part per part the notes use, not two', () => {
    const msm = new Alignment([
      note('n1', 1, 0),
      note('n2', 2, 0),
      note('n3', 3, 0),
      note('n4', 4, 0),
    ]);

    const xml = msm.serialize()!;

    expect(partNumbers(xml)).toEqual(['1', '2', '3', '4']);
    expect(noteIds(xml)).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  test('a single-part score writes one part, not an empty second one', () => {
    const xml = new Alignment([note('n1', 1, 0), note('n2', 1, 720)]).serialize()!;

    expect(partNumbers(xml)).toEqual(['1']);
    expect(noteIds(xml)).toEqual(['n1', 'n2']);
  });

  test('a gap in the part numbering keeps each part at its own number', () => {
    const xml = new Alignment([note('n1', 1, 0), note('n3', 3, 0)]).serialize()!;

    expect(partNumbers(xml)).toEqual(['1', '3']);
    expect(noteIds(xml)).toEqual(['n1', 'n3']);
  });
});

describe('Alignment.serialize performance data', () => {
  const performed = (): AlignedNote => ({
    ...note('n1', 1, 0),
    'milliseconds.date': 500,
    'milliseconds.date.end': 750,
    velocity: 88,
  });

  // The recording states itself in the attributes MSM states a performance in, so what comes
  // out here is a document espressivo reads back as the performance it went in as.
  test("carries the recording under MSM's own names", () => {
    const xml = new Alignment([performed()]).serialize()!;

    expect(xml).toContain('milliseconds.date="500"');
    expect(xml).toContain('milliseconds.date.end="750"');
    expect(xml).toContain('velocity="88"');
  });

  // A document carrying both the recording and the score is ambiguous about which timing it
  // means, which is exactly what a residual has to keep apart.
  test('serializeScore states the score alone', () => {
    const xml = new Alignment([performed()]).serializeScore()!;

    expect(xml).toContain('midi.pitch="67"');
    expect(xml).not.toContain('milliseconds.date');
    expect(xml).not.toContain('velocity');
  });
});

describe('Alignment.serialize pedals', () => {
  /**
   * It does not, and cannot: MSM's `<pedal>` is `date`/`state`/`date.end` in ticks, and an
   * aligned pedal has no symbolic date — that is why `getRange` derives one from the residual.
   * What mpmify used to emit had no `@date`, so espressivo's `GenericMap.indexElements` skipped
   * every one of them, and a `<pedal>` reaches no renderer in any case; pedalling sounds
   * through MPM's `<movement>` instructions. The pedals live on the alignment instead.
   */
  test('leaves the pedals out, because MSM has no way to say what they are', () => {
    const msm = new Alignment([note('n1', 1, 0)]);
    msm.pedals = [
      {
        'xml:id': 'p1',
        type: 'sustain',
        'milliseconds.date': 0,
        'milliseconds.date.end': 1000,
      },
    ];

    const xml = msm.serialize()!;

    expect(xml).not.toContain('pedalMap');
    expect(xml).not.toContain('"p1"');
    expect(msm.pedals).toHaveLength(1);
  });
});
