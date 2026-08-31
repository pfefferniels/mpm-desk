import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { convertMeiToMsm } from 'espressivo';
import { Alignment, type AlignedNote, type AlignedPedal } from '../../../src/fitting/alignment';
import { asMSM } from '../../../src/fitting/asMSM';

/**
 * Which readings an alignment holds, which is what decides whether there is a choice to make at
 * all: the editor greys out Base Text below two of them.
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

describe('the readings an alignment holds', () => {
  test('a score nothing has been aligned into holds none', () => {
    expect(new Alignment().sources().size).toBe(0);
  });

  test('one take of a passage is one reading, however many notes it sounded', () => {
    const msm = new Alignment([note('a', 'welte'), note('b', 'welte')]);
    expect([...msm.sources()]).toEqual(['welte']);
  });

  test('two takes of the same note are two readings', () => {
    const msm = new Alignment([note('a', 'welte'), note('a', 'hupfeld')]);
    expect(msm.sources().size).toBe(2);
  });

  test('a reading that differs only in its pedalling still counts', () => {
    // What `MakeChoice` selects pedals on, and the case the desk's colouring exists for: the two
    // takes agree on every note and disagree about the foot.
    const msm = new Alignment([note('a', 'welte')]);
    msm.pedals = [pedal('sustain-0', 'welte'), pedal('sustain-0', 'hupfeld')];
    expect([...msm.sources()].sort()).toEqual(['hupfeld', 'welte']);
  });

  test('an event outside any recording names no reading', () => {
    const msm = new Alignment([note('a', 'welte'), note('b')]);
    msm.pedals = [pedal('sustain-0')];
    expect([...msm.sources()]).toEqual(['welte']);
  });
});

/**
 * The same count, taken the way the editor takes it — off a real MEI rather than off notes built
 * here. `asMSM` reads a source off the `<recording>` each `<when>` sits in, and this is the one
 * place that reading is checked against a document somebody actually recorded.
 */
describe('the readings of the shipped transcription', () => {
  const mei = readFileSync('public/transcription.mei', 'utf-8');

  const withoutSecondRecording = (): string => {
    const document = new DOMParser().parseFromString(mei, 'application/xml');
    document.querySelectorAll('recording')[1]?.remove();
    return new XMLSerializer().serializeToString(document);
  };

  const readingsOf = (source: string) =>
    asMSM(source, convertMeiToMsm(source)[0]!.msm).sources();

  test('are the two takes the file holds', () => {
    expect(readingsOf(mei).size).toBe(2);
  });

  test('are one when the file holds one take', () => {
    // Which is the whole criterion: below two readings there is no choice to make, and the editor
    // greys Base Text out.
    expect(readingsOf(withoutSecondRecording()).size).toBe(1);
  });
});
