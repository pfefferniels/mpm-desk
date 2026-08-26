import { expect, test } from 'vitest';
import {
  calculateRubatoOnDate,
  type RubatoFrame,
} from '../../../src/fitting/transformers/rubato/rubatoMath';

/**
 * The warp has to agree with the renderer, and it did not.
 *
 * mpmify used to clamp `@lateStart` into [0, **0.9**] and `@earlyEnd` into [**0.1**, 1] — bounds
 * that exist nowhere in meico — and it left an inverted window inverted. meico (and espressivo's
 * `resolveRubato`, which is held equivalent to it) floors `lateStart` at 0, caps `earlyEnd` at 1,
 * and widens an inverted or empty window to the whole frame. The difference is not a rounding
 * one: on the frame below, four of these seven windows moved by up to 72 ticks, which is a tenth
 * of a quarter note.
 *
 * Every expectation here is what espressivo resolves the window to, evaluated at the midpoint of
 * a 720-tick frame with the identity intensity.
 */
const rubato = (lateStart?: number, earlyEnd?: number): RubatoFrame => ({
  date: 0,
  frameLength: 720,
  intensity: 1,
  lateStart,
  earlyEnd,
});

test.each([
  // window                       at 360   why
  ['the identity', undefined, undefined, 360],
  ['a window meico leaves alone', 0.1, 0.9, 360],
  ['a lateStart past the old 0.9 cap', 0.95, 1, 702],
  ['an earlyEnd below the old 0.1 floor', 0, 0.05, 18],
  ['an inverted window, widened to the frame', 0.5, 0.3, 360],
  ['an empty window, widened to the frame', 0.4, 0.4, 360],
  ['a negative lateStart, floored at 0', -0.2, 1, 360],
])('%s', (_name, lateStart, earlyEnd, expected) => {
  expect(calculateRubatoOnDate(360, rubato(lateStart, earlyEnd))).toBeCloseTo(expected, 6);
});

test('an absent @intensity is the identity, not NaN', () => {
  // `Math.pow(x, undefined)` is NaN, and a `<rubato>` may legitimately carry no @intensity:
  // the frames `CombineAdjacentRubatos` wrote to close a loop had none by design, and a
  // hand-written document need not state one either. Every date under one used to come back NaN.
  const withoutIntensity: RubatoFrame = {
    date: 0,
    frameLength: 720,
    lateStart: 0.25,
    earlyEnd: 1,
  };
  const answer = calculateRubatoOnDate(360, withoutIntensity);
  expect(Number.isNaN(answer)).toBe(false);
  expect(answer).toBeCloseTo(450, 6);
});

test('an absent @frameLength leaves the date alone rather than answering NaN', () => {
  // `@frameLength` is the one rubato parameter with no default: espressivo's `resolveRubato`
  // rejects the instruction outright. It used to divide by `undefined`.
  //
  // The fixture needs no cast any more. mpmify's own record declared `frameLength` as a
  // required number while a parsed document handed back `undefined` for it, so stating this
  // case at all meant lying to the compiler; espressivo types it optional, which is what a
  // `<rubato>` that inherits its frame from a `rubatoDef` actually looks like.
  const noFrame: RubatoFrame = { date: 0 };
  expect(calculateRubatoOnDate(360, noFrame)).toBe(360);
});
