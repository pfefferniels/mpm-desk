import { describe, expect, test } from 'vitest';
import { fix } from '../../../src/fitting/utils';

/**
 * `fix` rounds one numeric property of an object in place.
 *
 * It rounds through the decimal *spelling* of the number rather than by multiplying, because
 * multiplying reintroduces the binary error the rounding exists to remove. The spelling is also
 * where it breaks: JavaScript switches to exponential notation below 1e-7 and at or above 1e21,
 * and appending `'e2'` to `'1e-7'` produces text that is not a number, so the property comes back
 * `NaN` (issue #36). A temporal spread's frame reaches values that small after a
 * milliseconds-to-ticks conversion of a short arpeggio.
 */
describe('fix', () => {
  test('rounds an ordinary number to the requested precision', () => {
    const obj = { value: 0.12345 };
    fix(obj, 'value', 2);
    expect(obj.value).toBe(0.12);
  });

  test('rounds the half up, which is why the decimal spelling is used', () => {
    // `1.005 * 100` is 100.49999999999999 and would round down.
    const obj = { value: 1.005 };
    fix(obj, 'value', 2);
    expect(obj.value).toBe(1.01);
  });

  test('a number JavaScript spells exponentially survives', () => {
    const tiny = { value: 1e-7 };
    fix(tiny, 'value', 2);
    expect(tiny.value).toBe(0);

    const huge = { value: 1.5e21 };
    fix(huge, 'value', 2);
    expect(huge.value).toBe(1.5e21);
  });

  test('a tiny number keeps its magnitude when the precision reaches it', () => {
    const obj = { value: 1.23456e-7 };
    fix(obj, 'value', 10);
    expect(obj.value).toBe(1.235e-7);
  });

  test('zero is a value, not an absent property', () => {
    const obj = { value: 0 };
    fix(obj, 'value', 2);
    expect(obj.value).toBe(0);
  });

  test('a non-finite value is left alone rather than turned into something else', () => {
    const obj = { value: NaN };
    fix(obj, 'value', 2);
    expect(obj.value).toBeNaN();

    const infinite = { value: Infinity };
    fix(infinite, 'value', 2);
    expect(infinite.value).toBe(Infinity);
  });

  test('a non-numeric property is untouched', () => {
    const obj = { value: 'monophonic' };
    fix(obj, 'value', 2);
    expect(obj.value).toBe('monophonic');
  });
});
