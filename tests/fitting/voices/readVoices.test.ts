import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { convertMeiToMsm } from 'espressivo';
import { asMSM } from '../../../src/fitting/asMSM';
import { voiceKey, voiceLabel, voicesOf } from '../../../src/fitting/voices';
import { Alignment, type AlignedNote } from '../../../src/fitting/alignment';

/**
 * The voice reading, against the score it was designed from rather than a fixture.
 *
 * A fixture would pin what this file believes; the transcription pins what the encoding actually
 * does — 62 chords, one tie crossing two layers, grace notes the conversion emits nothing for, and
 * two `<recording>`s so every note arrives twice.
 */
const mei = readFileSync('public/transcription.mei', 'utf-8');

describe('reading the voices off the MEI', () => {
  const msm = convertMeiToMsm(mei)[0]!.msm;
  const alignment = asMSM(mei, msm);

  test('places every note in a voice', () => {
    const placeless = alignment.allNotes.filter((note) => !note.staff);
    expect(placeless).toEqual([]);
  });

  test('the staff always agrees with the part the conversion put the note in', () => {
    // The invariant the whole default rests on: with no `ProcessVoices` call, `note.part` is the
    // staff, so "no layout means one part per staff" costs nothing to honour.
    const disagreeing = alignment.allNotes.filter((note) => String(note.part) !== note.staff);
    expect(disagreeing).toEqual([]);
  });

  test('finds the six voices of this transcription, with their sizes', () => {
    // Staff 1 layers 1-3 and staff 2 layers 1-3, two of them nearly empty — the voices of a
    // keyboard score, numbered by whoever engraved it.
    //
    // Distinct notes, so these are half the alignment's rows: `asMSM` makes one note per
    // `<when>` and this MEI carries two recordings. They fall short of the MSM's
    // 174/87/5/123/84/3 because a note the recording never sounded reaches no alignment at all,
    // and two notes sharing an onset and a pitch are collapsed.
    expect(
      voicesOf(alignment).map((voice) => [voice.key, voice.notes] as const),
    ).toEqual([
      ['1/1', 173],
      ['1/2', 82],
      ['1/3', 5],
      ['2/1', 116],
      ['2/2', 71],
      ['2/3', 3],
    ]);
  });

  test('holds every note twice, which is why Alignment.build de-duplicates', () => {
    // One note per `<when>`, and this MEI has two `<recording>`s. Nothing noticed while the raw
    // conversion was what got played; a document serialized from here and rendered would sound
    // every note twice until a `MakeChoice` collapsed the readings.
    const perId = new Map<string, number>();
    for (const note of alignment.allNotes) {
      perId.set(note['xml:id'], (perId.get(note['xml:id']) ?? 0) + 1);
    }
    expect(new Set(perId.values())).toEqual(new Set([2]));

    const written = alignment.serializeScore() ?? '';
    const ids = [...written.matchAll(/<note\b[^>]*xml:id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(perId.size);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('voiceKey', () => {
  const of = (staff: string, layer: string) => voiceKey({ staff, layer });

  test('separates the staff from the layer, so the key cannot be ambiguous', () => {
    // espressivo's own `layersToStaffs` concatenates, and staff 1 / layer 11 then collides with
    // staff 11 / layer 1. Two-digit `@n` is not exotic in a keyboard score.
    expect(of('1', '11')).not.toBe(of('11', '1'));
  });

  test('an unlayered note has a key of its own rather than none', () => {
    expect(of('1', '')).toBe('1/');
  });
});

describe('voiceLabel', () => {
  const voice = (staff: string, layer: string) => ({
    staff,
    layer,
    key: voiceKey({ staff, layer }),
    notes: 1,
    part: 1,
  });

  test('names the staff and the voice', () => {
    expect(voiceLabel(voice('2', '3'))).toBe('Staff 2, voice 3');
  });

  test('says only the staff where there is no layer to name', () => {
    expect(voiceLabel(voice('2', ''))).toBe('Staff 2');
  });
});

describe('voicesOf ordering', () => {
  const note = (staff: string, layer: string, part = Number(staff) || 1): AlignedNote => ({
    'xml:id': `${staff}-${layer}-${String(part)}`,
    part,
    staff,
    layer,
    date: 0,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'midi.pitch': 60,
    velocity: 64,
    'milliseconds.date': 0,
    'milliseconds.date.end': 500,
  });

  test('orders by staff then layer, numerically', () => {
    // Lexically, "10" sorts before "9" — which would put the tenth voice of a staff second.
    const found = voicesOf(new Alignment([note('2', '1'), note('1', '10'), note('1', '9')]));
    expect(found.map((voice) => voice.key)).toEqual(['1/9', '1/10', '2/1']);
  });

  test('puts a voice in the part holding most of it, not the part its first note is in', () => {
    // A move takes notes out of a voice without taking the voice. Reading the part off the first
    // note then reports the voice from wherever that one note went.
    const found = voicesOf(
      new Alignment([note('1', '1', 3), note('1', '1', 1), note('1', '1', 1)]),
    );
    expect(found.map((voice) => voice.part)).toEqual([1]);
  });

  test('gives a voice split evenly to the lower-numbered part, so the answer is stable', () => {
    const found = voicesOf(new Alignment([note('1', '1', 3), note('1', '1', 1)]));
    expect(found.map((voice) => voice.part)).toEqual([1]);
  });
});
