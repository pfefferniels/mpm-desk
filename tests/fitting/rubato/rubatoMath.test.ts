import { describe, expect, test } from 'vitest';
import { createMpm, requireMap } from '../../../src/fitting/instructions/index';
import {
  calculateRubatoOnDate,
  type RubatoFrame,
  rubatoWarpOf,
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
  // rejects the instruction rather than dividing by `undefined`. It is typed optional, which is
  // what a `<rubato>` inheriting its frame from a `rubatoDef` looks like, so this case needs no
  // cast.
  const noFrame: RubatoFrame = { date: 0 };
  expect(calculateRubatoOnDate(360, noFrame)).toBe(360);
});

/**
 * The warp read both ways, for a caller that has to say where a note is to be *written* for the
 * rubato to put it where it was played: `TranslatePhysicalTimeToTicks`, placing the notes of a
 * grace figure.
 */
describe('the warp a scope performs', () => {
  /** One frame of a quarter that rushes, from tick 720, and nothing either side of it. */
  const document = () => {
    const mpm = createMpm();
    requireMap(mpm, 'rubato', 'global').addRubato({
      id: 'rush',
      date: 720,
      frameLength: 720,
      intensity: 0.6,
      loop: false,
    });
    return mpm;
  };

  test('takes a date where the renderer takes it, and leaves one no frame covers', () => {
    const warp = rubatoWarpOf(document(), 'global');

    expect(warp.performed(1080)).toBeCloseTo(720 + 720 * 0.5 ** 0.6, 9);
    // Before the frame, and after it: the rubato does not loop.
    expect(warp.performed(360)).toBe(360);
    expect(warp.performed(1800)).toBe(1800);
  });

  test('says where a note is to be written to be put at a position', () => {
    const warp = rubatoWarpOf(document(), 'global');

    for (const date of [720, 800, 1080, 1400]) {
      expect(warp.written(warp.performed(date))).toBeCloseTo(date, 9);
    }
    expect(warp.written(360)).toBe(360);
    expect(warp.written(1800)).toBe(1800);
  });

  // A frame that starts late puts no note in its first stretch, so there is no date to write
  // one on to have it there. The nearest the rubato allows is the start of the frame.
  test('answers the end of the frame for a position the rubato puts no note at', () => {
    const mpm = createMpm();
    requireMap(mpm, 'rubato', 'global').addRubato({
      id: 'late',
      date: 720,
      frameLength: 720,
      intensity: 1,
      lateStart: 0.25,
      loop: false,
    });
    const warp = rubatoWarpOf(mpm, 'global');

    expect(warp.performed(720)).toBeCloseTo(900, 9);
    expect(warp.written(800)).toBe(720);
  });

  // The renderer's rule: a part's own map where it has one, the global one where it has none.
  test('is a part\'s own rubato where it has one, and the global one where it has none', () => {
    const mpm = document();
    requireMap(mpm, 'rubato', 1).addRubato({
      id: 'drag',
      date: 720,
      frameLength: 720,
      intensity: 1.5,
      loop: false,
    });

    expect(rubatoWarpOf(mpm, 0).performed(1080)).toBeCloseTo(720 + 720 * 0.5 ** 0.6, 9);
    expect(rubatoWarpOf(mpm, 1).performed(1080)).toBeCloseTo(720 + 720 * 0.5 ** 1.5, 9);
  });
});
