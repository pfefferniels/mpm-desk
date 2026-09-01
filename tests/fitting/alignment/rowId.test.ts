import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { convertMeiToMsm } from 'espressivo';
import { rowId, type AlignedNote, type AlignedPedal } from '../../../src/fitting/alignment';
import { asMSM } from '../../../src/fitting/asMSM';

/**
 * What tells one row of the alignment from another, which is what every desk keys its lists by.
 * The id alone does not, for as long as the readings stand side by side.
 */

const note = (id: string, source?: string): AlignedNote =>
  ({
    'xml:id': id,
    part: 1,
    date: 0,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'midi.pitch': 60,
    velocity: 100,
    'milliseconds.date': 0,
    'milliseconds.date.end': 1000,
    source,
  }) as AlignedNote;

const pedal = (id: string, source?: string): AlignedPedal => ({
  'xml:id': id,
  type: 'sustain',
  'milliseconds.date': 0,
  'milliseconds.date.end': 1000,
  source,
});

describe('the identity of an aligned row', () => {
  test('two takes of one note are two rows', () => {
    expect(rowId(note('a', 'welte'))).not.toBe(rowId(note('a', 'hupfeld')));
  });

  test('two notes of one take are two rows', () => {
    expect(rowId(note('a', 'welte'))).not.toBe(rowId(note('b', 'welte')));
  });

  test('the same row asked twice answers the same', () => {
    expect(rowId(note('a', 'welte'))).toBe(rowId(note('a', 'welte')));
  });

  test('a pedal is identified the same way', () => {
    expect(rowId(pedal('sustain-0', 'welte'))).not.toBe(rowId(pedal('sustain-0', 'hupfeld')));
  });

  test('an event outside any recording still has an identity', () => {
    expect(rowId(note('a'))).not.toBe(rowId(note('b')));
  });

  test('a source spelled as a URI does not blur the seam', () => {
    // The pair is spelled into one string, and `@source` is a URI reference, so slashes in it are
    // the normal case rather than the odd one. An `xml:id` is an NCName and can hold none, which
    // is what makes the first `/` the seam.
    expect(rowId(note('a', 'http://x/take1'))).not.toBe(rowId(note('a', 'http://x/take2')));
    expect(rowId(note('a', 'http://x/take1'))).not.toBe(rowId(note('b', 'http://x/take1')));
  });
});

/**
 * The same question against the document the editor opens, where the duplication is not
 * hypothetical: this is the file whose desks warned on every render.
 */
describe('the rows of the shipped transcription, before a base text is chosen', () => {
  const mei = readFileSync('public/transcription.mei', 'utf-8');
  const takes = asMSM(mei, convertMeiToMsm(mei)[0]!.msm);

  const distinct = (values: string[]) => new Set(values).size;

  test('every note is here once per take, all under the one id', () => {
    expect(takes.allNotes).toHaveLength(900);
    expect(distinct(takes.allNotes.map((n) => n['xml:id']))).toBe(450);
    expect(distinct(takes.allNotes.map(rowId))).toBe(900);
  });

  test('and every pedal likewise', () => {
    expect(takes.pedals).toHaveLength(107);
    expect(distinct(takes.pedals.map((p) => p['xml:id']))).toBe(58);
    expect(distinct(takes.pedals.map(rowId))).toBe(107);
  });

  test('the notes of a chord are told apart, which is what ChordSpread keys on', () => {
    const chords = [...takes.in('global').chords().values()];
    const repeats = (values: string[]) => distinct(values) < values.length;

    expect(chords.filter((chord) => repeats(chord.map((n) => n['xml:id'])))).toHaveLength(215);
    expect(chords.filter((chord) => repeats(chord.map(rowId)))).toHaveLength(0);
  });
});
