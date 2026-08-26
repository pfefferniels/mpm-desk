import { describe, expect, test } from 'vitest';
import { Alignment, type AlignedNote, type AlignedPedal } from '../../../src/fitting/alignment';
import { at } from '../../support/at';

/**
 * The three places an `Alignment` reports a bound — `lastDate`, `end` and the minimum
 * `shiftToFirstOnset` shifts by — used to be `Math.max`/`Math.min` over a spread.
 *
 * Spreading has two costs. Past roughly 100k arguments it is a `RangeError` rather than a
 * slowdown, which the 450-note corpus does not reach; and `Math.min()` of *nothing* is
 * `Infinity`, which `shiftToFirstOnset` did reach — the note shift was guarded against it, the
 * pedal shift above it was not. These pin the degenerate ends of all three.
 *
 * See issue #49.
 */

/** Onsets are in milliseconds; a note left without one is one the recording never reached. */
const note = (id: string, date: number, duration = 720, onset?: number): AlignedNote =>
  ({
    'xml:id': id,
    part: 1,
    date,
    duration,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'midi.pitch': 60,
    velocity: 100,
    ...(onset === undefined
      ? {}
      : { 'milliseconds.date': onset, 'milliseconds.date.end': onset + 1000 }),
  }) as AlignedNote;

const pedal = (id: string, onset: number, duration = 1000): AlignedPedal => ({
  'xml:id': id,
  type: 'sustain',
  'milliseconds.date': onset,
  'milliseconds.date.end': onset + duration,
});

describe('the bounds of a score', () => {
  test('an empty score ends where it begins', () => {
    const msm = new Alignment();
    expect(msm.lastDate()).toBe(0);
    expect(msm.end).toBe(0);
    expect(msm.lastNote()).toBeUndefined();
  });

  test('lastDate is the latest date, end the latest date plus duration', () => {
    // The longest note does not start last, so `end` has to look past `lastDate`'s answer.
    const msm = new Alignment([note('a', 0, 2880), note('b', 720, 360)]);
    expect(msm.lastDate()).toBe(720);
    expect(msm.end).toBe(2880);
  });

  test('lastNote is the first note on the last date', () => {
    const msm = new Alignment([note('a', 0), note('b', 720), note('c', 720)]);
    expect(msm.lastNote()?.['xml:id']).toBe('b');
  });
});

describe('shifting a score to its first onset', () => {
  test('subtracts the earliest onset from notes and pedals alike', () => {
    const msm = new Alignment([note('a', 0, 720, 2000), note('b', 720, 720, 3000)]);
    msm.pedals = [pedal('p', 2500)];

    msm.shiftToFirstOnset();

    expect(msm.allNotes.map((n) => n['milliseconds.date'])).toEqual([0, 1000]);
    expect(at(msm.pedals, 0, 'pedal')['milliseconds.date']).toBe(500);
    expect(at(msm.pedals, 0, 'pedal')['milliseconds.date.end']).toBe(1500);
  });

  test('a pedal pressed before the first note keeps its release', () => {
    const msm = new Alignment([note('a', 0, 720, 2000)]);
    msm.pedals = [pedal('p', 1500, 2000)];

    msm.shiftToFirstOnset();

    // Half the press is cut away with the silence, so the release stays where it was.
    expect(at(msm.pedals, 0, 'pedal')['milliseconds.date']).toBe(0);
    expect(at(msm.pedals, 0, 'pedal')['milliseconds.date.end']).toBe(1500);
  });

  test('a score with no recorded onset is left alone', () => {
    // `Math.min()` of nothing is `Infinity`, and the pedal loop subtracted it unguarded.
    const msm = new Alignment([note('a', 0), note('b', 720)]);
    msm.pedals = [pedal('p', 4000)];

    msm.shiftToFirstOnset();

    expect(at(msm.pedals, 0, 'pedal')['milliseconds.date']).toBe(4000);
    expect(at(msm.pedals, 0, 'pedal')['milliseconds.date.end']).toBe(5000);
  });
});
