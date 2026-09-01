/**
 * The alignment as three documents, and back.
 *
 * `Alignment.serialize()` states the score and the recording together, in MSM's own attributes,
 * so the document half is readable by anything that reads MSM. Two things the alignment holds
 * have no MSM spelling and travel beside it as JSON: `<pedal>` is `date`/`state`/`date.end` in
 * ticks and a recorded pedal has no symbolic date at all, and `source` — which reading of the
 * passage a note came from, what `MakeChoice` selects on — is not an MSM attribute either.
 */
import { Msm } from 'espressivo';
import { Builder, type Element } from 'espressivo';
import { descendantElements, requireAttributeValue } from 'espressivo';
import { Alignment, type AlignedNote, type AlignedPedal } from '../../../src/fitting/alignment';
import type { DatedTimeSignature } from '../../../src/fitting/timeSignature';
import { at } from '../../support/at';

/** A recorded pedal: onset and release in milliseconds, and no symbolic date. */
interface FixturePedal {
  id: string;
  type: 'sustain' | 'soft';
  date: number;
  end: number;
  source?: string;
}

/**
 * The source of one `<note>`, positionally — the nth entry belongs to the nth `<note>` of the
 * document. A note the alignment holds twice, once per reading, is two `<note>` elements under
 * one `xml:id`, so `id` is a checksum and not a key.
 */
interface FixtureSource {
  id: string;
  source?: string;
}

interface AlignmentFixture {
  msm: string;
  pedals: FixturePedal[];
  sources: FixtureSource[];
}

export const deserializeAlignment = (fixture: AlignmentFixture): Alignment => {
  const root = new Builder().build(fixture.msm).getRootElement();

  const inScore: { element: Element; part: number }[] = [];
  for (const part of descendantElements(root, (e) => e.getLocalName() === 'part')) {
    const number = Number(requireAttributeValue('number', part));
    for (const element of descendantElements(part, (e) => e.getLocalName() === 'note')) {
      inScore.push({ element, part: number });
    }
  }

  if (inScore.length !== fixture.sources.length) {
    throw new Error(
      `the fixture holds ${String(inScore.length)} notes and ` +
        `${String(fixture.sources.length)} sources`,
    );
  }

  const alignment = new Alignment(
    inScore.map(({ element, part }, index) =>
      readNote(element, part, at(fixture.sources, index, 'source')),
    ),
    timeSignaturesOf(root),
  );
  alignment.pedals = fixture.pedals.map((pedal): AlignedPedal => ({
    'xml:id': pedal.id,
    'milliseconds.date': pedal.date,
    'milliseconds.date.end': pedal.end,
    type: pedal.type,
    ...(pedal.source !== undefined && { source: pedal.source }),
  }));
  return alignment;
};

/** The two JSON halves of the triple, checked rather than trusted. */
export const parseAlignmentFixture = (
  msm: string,
  pedals: string,
  sources: string,
): AlignmentFixture => ({
  msm,
  pedals: records(pedals, 'the pedals').map(readFixturePedal),
  sources: records(sources, 'the sources').map(readFixtureSource),
});

const readNote = (element: Element, part: number, source: FixtureSource): AlignedNote => {
  const options = Msm.noteOptionsOf(element);
  if (options === null) throw new Error('a <note> carries no date, duration or midi.pitch');

  const id = required(options.id, 'xml:id', '?');
  if (source.id !== id) {
    throw new Error(`the sources are out of step: <note ${id}> is paired with ${source.id}`);
  }

  return {
    part,
    staff: String(part),
    layer: '1',
    'xml:id': id,
    date: options.date,
    duration: options.duration,
    pitchname: required(options.pitchname, 'pitchname', id),
    octave: required(options.octave, 'octave', id),
    accidentals: required(options.accidentals, 'accidentals', id),
    'midi.pitch': options.midiPitch,
    'milliseconds.date': required(options.millisecondsDate, 'milliseconds.date', id),
    'milliseconds.date.end': required(options.millisecondsDateEnd, 'milliseconds.date.end', id),
    velocity: required(options.velocity, 'velocity', id),
    ...(source.source !== undefined && { source: source.source }),
  };
};

const required = <T>(value: T | undefined, what: string, id: string): T => {
  if (value === undefined) throw new Error(`<note ${id}> carries no ${what}`);
  return value;
};

const timeSignaturesOf = (root: Element): DatedTimeSignature[] =>
  descendantElements(root, (e) => e.getLocalName() === 'timeSignature').map((element) => ({
    date: Number(requireAttributeValue('date', element)),
    numerator: Number(requireAttributeValue('numerator', element)),
    denominator: Number(requireAttributeValue('denominator', element)),
  }));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const records = (json: string, where: string): Record<string, unknown>[] => {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error(`${where} of the fixture are not an array`);
  return parsed.map((entry: unknown, index: number) => {
    if (!isRecord(entry)) throw new Error(`${where}[${String(index)}] is not an object`);
    return entry;
  });
};

const readFixturePedal = (entry: Record<string, unknown>, index: number): FixturePedal => {
  const where = `pedal ${String(index)}`;
  const type = stringAt(entry, 'type', where);
  if (type !== 'sustain' && type !== 'soft') throw new Error(`${where}: type is "${type}"`);

  return {
    id: stringAt(entry, 'id', where),
    type,
    date: numberAt(entry, 'date', where),
    end: numberAt(entry, 'end', where),
    ...(entry['source'] !== undefined && { source: stringAt(entry, 'source', where) }),
  };
};

const readFixtureSource = (entry: Record<string, unknown>, index: number): FixtureSource => {
  const where = `source ${String(index)}`;
  return {
    id: stringAt(entry, 'id', where),
    ...(entry['source'] !== undefined && { source: stringAt(entry, 'source', where) }),
  };
};

const stringAt = (entry: Record<string, unknown>, key: string, where: string): string => {
  const value = entry[key];
  if (typeof value !== 'string') throw new Error(`${where}: ${key} is not a string`);
  return value;
};

const numberAt = (entry: Record<string, unknown>, key: string, where: string): number => {
  const value = entry[key];
  if (typeof value !== 'number') throw new Error(`${where}: ${key} is not a number`);
  return value;
};
