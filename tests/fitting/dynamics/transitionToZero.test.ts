import { expect, test } from 'vitest';
import type { Normalized } from 'espressivo';
import {
  computeInnerControlPointsXPositions,
  positionAtDate,
  volumeAtDate,
} from '../../../src/fitting/transformers/dynamics/Approximation';
import type { DynamicsWithEndDate } from '../../../src/fitting/transformers/dynamics/InsertDynamicsInstructions';
import type { InstructionOptions } from '../../../src/fitting/instructions/index';

/**
 * A `@transition.to` of **0** is a target, not an absence.
 *
 * Both evaluators used to test the attribute for truthiness — `!` of it for dynamics, `=== undefined`
 * for movement — and the dynamics one therefore read a fade to silence as *no transition at all*,
 * holding the start volume flat across the whole span. A `<movement>` lifting a pedal fully is
 * the same shape. See issue #46.
 *
 * This is a behaviour change on documents that already exist: anything fitted against the
 * held-flat reading now renders as the fade it always said it was.
 */
const straightRamp = computeInnerControlPointsXPositions(0.0, 0.0);

/**
 * A 0..1 quantity as `<movement>` types one. The brand is compile-time only and espressivo emits
 * no converter for it (`units.ts` is required to produce no JavaScript), so a plain number
 * reaches it through an assertion — the same one `InsertPedal` makes.
 */
const normalized = (value: number) => value as Normalized;

const fadeToSilence: DynamicsWithEndDate & typeof straightRamp = {
  id: 'd0',
  date: 0,
  endDate: 720,
  volume: 100,
  transitionTo: 0,
  ...straightRamp,
};

const pedalFullyUp: InstructionOptions<'movement'> & {
  position: Normalized;
  endDate: number;
} & typeof straightRamp = {
  id: 'm0',
  date: 0,
  endDate: 720,
  position: normalized(1),
  controller: 'sustain',
  transitionTo: normalized(0),
  ...straightRamp,
};

test('a <dynamics> fading to silence is a transition, not a held level', () => {
  expect(volumeAtDate(fadeToSilence, 0)).toBe(100);
  expect(volumeAtDate(fadeToSilence, 720)).toBe(0);

  // The whole of the bug: the midpoint used to answer 100, because `!0` said "no target".
  const midpoint = volumeAtDate(fadeToSilence, 360);
  expect(midpoint).toBeLessThan(100);
  expect(midpoint).toBeGreaterThan(0);
  expect(midpoint).toBeCloseTo(50, 6);
});

test('a <movement> lifting the pedal fully is a transition, not a held position', () => {
  expect(positionAtDate(pedalFullyUp, 0)).toBe(1);
  expect(positionAtDate(pedalFullyUp, 720)).toBe(0);

  const midpoint = positionAtDate(pedalFullyUp, 360);
  expect(midpoint).toBeLessThan(1);
  expect(midpoint).toBeGreaterThan(0);
  expect(midpoint).toBeCloseTo(0.5, 6);
});

test('an absent @transition.to is still a held level', () => {
  // The other half of the distinction: absence really does mean "no transition", and `??` has
  // to keep answering that where `||` accidentally did.
  const held: DynamicsWithEndDate & typeof straightRamp = {
    ...fadeToSilence,
    transitionTo: undefined,
  };
  expect(volumeAtDate(held, 360)).toBe(100);
  expect(volumeAtDate(held, 720)).toBe(100);
});
