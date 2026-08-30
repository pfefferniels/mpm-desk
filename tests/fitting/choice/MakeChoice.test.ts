import { expect, test } from 'vitest';
import { Mpm, createMpm } from '../../../src/fitting/instructions/index';
import { Alignment, type AlignedNote, type AlignedPedal } from '../../../src/fitting/alignment';
import { MakeChoice } from '../../../src/fitting/transformers/choice/MakeChoice';
import { only } from '../../support/at';

/**
 * `MakeChoice` collapses the several readings of a passage down to one.
 *
 * It used to do both halves of that by splicing out of the array it was walking. For the notes
 * that was only expensive — an `indexOf` scan and a tail shift per note, quadratic in the score.
 * For the pedals it was wrong: splicing out of the array a `for…of` is iterating skips the
 * element that slides into the freed slot, so two adjacent pedals from the rejected source left
 * the second one behind. See issue #49.
 */

const note = (id: string, source: string, velocity: number): AlignedNote => ({
  'xml:id': id,
  part: 1,
  staff: '1',
  layer: '1',
  date: 0,
  duration: 720,
  pitchname: 'c',
  accidentals: 0,
  octave: 4,
  'milliseconds.date': 0,
  'milliseconds.date.end': 1000,
  'midi.pitch': 60,
  velocity,
  source,
});

const pedal = (id: string, source: string): AlignedPedal => ({
  'xml:id': id,
  type: 'sustain',
  'milliseconds.date': 0,
  'milliseconds.date.end': 1000,
  source,
});

/** Call the protected `transform` method for testing */
const callTransform = (transformer: MakeChoice, msm: Alignment, mpm: Mpm) => {
  interface Transformable {
    transform(msm: Alignment, mpm: Mpm): void;
  }
  (transformer as unknown as Transformable).transform(msm, mpm);
};

test('the notes of the rejected reading are gone, the chosen one kept once', () => {
  const msm = new Alignment([note('a', 'take1', 40), note('b', 'take2', 90)]);

  callTransform(new MakeChoice({ scope: 'global', prefer: 'take2' }), msm, createMpm());

  expect(msm.allNotes).toHaveLength(1);
  expect(only(msm.allNotes, 'note').source).toBe('take2');
  expect(only(msm.allNotes, 'note').velocity).toBe(90);
});

test('a split preference takes the velocity from one reading and the timing from the other', () => {
  const msm = new Alignment([note('a', 'take1', 40), note('b', 'take2', 90)]);

  callTransform(
    new MakeChoice({
      scope: 'global',
      timing: 'take2',
      velocity: 'take1',
      pedalling: 'take2',
    }),
    msm,
    createMpm(),
  );

  expect(msm.allNotes).toHaveLength(1);
  expect(only(msm.allNotes, 'note').source).toBe('take2');
  expect(only(msm.allNotes, 'note').velocity).toBe(40);
});

test('adjacent pedals from the rejected reading are both dropped', () => {
  const msm = new Alignment();
  // The two 'take1' pedals are neighbours: splicing the first shifted the second into the slot
  // the iterator had just left, so it was never looked at.
  msm.pedals = [
    pedal('p1', 'take2'),
    pedal('p2', 'take1'),
    pedal('p3', 'take1'),
    pedal('p4', 'take2'),
  ];

  callTransform(
    new MakeChoice({
      scope: 'global',
      from: 0,
      to: 720,
      prefer: 'take2',
    }),
    msm,
    createMpm(),
  );

  expect(msm.pedals.map((p) => p['xml:id'])).toEqual(['p1', 'p4']);
});
