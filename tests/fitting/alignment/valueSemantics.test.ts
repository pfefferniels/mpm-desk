import { describe, expect, test } from 'vitest';
import { Alignment, type AlignedNote, type AlignedPedal } from '../../../src/fitting/alignment';
import { at } from '../../support/at';

/**
 * An `Alignment` is a score, and a score handed to two callers has to behave as two scores.
 *
 * It did not. `clone()` passed `this.allNotes` to the constructor, which sorted it in place and
 * kept it, and then assigned `this.pedals` across — so the "copy" shared both arrays and every
 * note object with the original, and merely constructing it reordered the original. `asChords`
 * and `notesInPart` handed out the interior array as well, so a caller that sorted what a query
 * returned was editing the score.
 *
 * These pin the four places that aliased. They are cheap and they are the kind of thing that
 * quietly comes back, because every one of them reads correct.
 */

const note = (id: string, date: number, velocity = 100, part = 1): AlignedNote => {
  // A second to the quarter, so the recording reads as a steady 60bpm.
  const onset = (date / 720) * 1000;
  return {
    'xml:id': id,
    part,
    staff: String(part),
    layer: '1',
    date,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'milliseconds.date': onset,
    'milliseconds.date.end': onset + 1000,
    'midi.pitch': 60,
    velocity,
  };
};

const pedal = (id: string): AlignedPedal => ({
  'xml:id': id,
  type: 'sustain',
  'milliseconds.date': 0,
  'milliseconds.date.end': 1000,
});

describe('an Alignment copy is independent of its original', () => {
  test('clone shares neither the notes array nor the note objects', () => {
    const original = new Alignment([note('a', 0), note('b', 720)]);
    const copy = original.clone();

    expect(copy.allNotes).not.toBe(original.allNotes);

    at(copy.allNotes, 0, 'note').velocity = 1;
    expect(at(original.allNotes, 0, 'note').velocity).toBe(100);
  });

  test('clone shares neither the pedals array nor the pedal objects', () => {
    const original = new Alignment([note('a', 0)]);
    original.pedals = [pedal('ped_0')];
    const copy = original.clone();

    expect(copy.pedals).not.toBe(original.pedals);

    at(copy.pedals, 0, 'pedal')['milliseconds.date.end'] = 99;
    expect(at(original.pedals, 0, 'pedal')['milliseconds.date.end']).toBe(1000);
  });

  test('constructing an Alignment does not reorder the array it was handed', () => {
    const notes = [note('b', 720), note('a', 0)];
    new Alignment(notes);

    expect(notes.map((n) => n['xml:id'])).toEqual(['b', 'a']);
  });

  test('a score with no time signature copies to a score with no time signature', () => {
    const original = new Alignment([note('a', 0)]);
    expect(original.timeSignatures).toEqual([]);

    expect(original.deepClone().timeSignatures).toEqual([]);
    expect(original.deepClone().principalTimeSignature).toBeUndefined();
  });

  test('the signature map copies entry by entry, as separate objects', () => {
    const original = new Alignment([note('a', 0)], [{ date: 0, numerator: 3, denominator: 4 }]);
    const copy = original.deepClone();

    expect(copy.timeSignatures).toEqual([{ date: 0, numerator: 3, denominator: 4 }]);
    expect(at(copy.timeSignatures, 0, 'signature')).not.toBe(
      at(original.timeSignatures, 0, 'signature'),
    );
  });

  test('constructing an Alignment does not reorder the signatures it was handed', () => {
    const signatures = [
      { date: 720, numerator: 4, denominator: 4 },
      { date: 0, numerator: 1, denominator: 4 },
    ];
    const alignment = new Alignment([note('a', 0)], signatures);

    expect(alignment.timeSignatures.map((s) => s.date)).toEqual([0, 720]);
    expect(signatures.map((s) => s.date)).toEqual([720, 0]);
  });
});

describe('an Alignment query does not edit the score', () => {
  test('asChords leaves the score in the order it found it', () => {
    const msm = new Alignment();
    msm.allNotes = [note('b', 720), note('a', 0)];

    msm.asChords('global');

    expect(msm.allNotes.map((n) => n['xml:id'])).toEqual(['b', 'a']);
  });

  test('notesInPart hands back a fresh array for a part and for the whole score', () => {
    const msm = new Alignment([note('a', 0), note('b', 720)]);

    expect(msm.notesInPart('global')).not.toBe(msm.allNotes);

    // Sorting what a query returned must not be able to reach the score.
    msm.notesInPart('global').sort((x, y) => y.date - x.date);
    expect(msm.allNotes.map((n) => n['xml:id'])).toEqual(['a', 'b']);
  });

  test('asChords still groups by date and covers every note', () => {
    const msm = new Alignment([note('a', 0), note('b', 0), note('c', 720)]);
    const chords = msm.asChords('global');

    expect([...chords.keys()].sort((x, y) => x - y)).toEqual([0, 720]);
    expect(chords.get(0)?.map((n) => n['xml:id'])).toEqual(['a', 'b']);
    expect(chords.get(720)?.map((n) => n['xml:id'])).toEqual(['c']);
  });
});

describe('getByID answers what its type says it answers', () => {
  test('a missing id is undefined, which a `=== null` guard would have missed', () => {
    const msm = new Alignment([note('a', 0)]);

    expect(msm.getByID('nope')).toBeUndefined();
    expect(msm.getByID('a')?.['xml:id']).toBe('a');
  });
});
