export const isDefined = (onset?: number): boolean => {
  return onset !== undefined && !isNaN(onset);
};

/**
 * `value`, held inside `[min, max]`.
 *
 * The argument order is value-first, and there is only one `clamp` in the package. Either
 * order is defensible; two functions of the same name whose arguments go in a different order
 * are not, and value-first is the one the call sites are written against.
 */
export const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(value, max));
};

/**
 * `num` re-spelled with its decimal exponent moved by `by`.
 *
 * The shift is done on the decimal spelling rather than by multiplying, because multiplying
 * reintroduces exactly the binary error the rounding is there to remove: `1.005 * 100` is
 * `100.49999999999999`, which rounds down, while `+'1.005e2'` is `100.5`, which rounds up.
 *
 * Splitting the exponent off first is what makes this total. Appending `'e' + precision` to
 * `num` directly would assume `num.toString()` never produces an exponent of its own — but
 * JavaScript switches to exponential notation below 1e-7 and at or above 1e21, and
 * `'1e-7' + 'e2'` is not a number at all (issue #36).
 */
const shiftDecimalExponent = (num: number, by: number) => {
  const [mantissa, exponent] = num.toString().split('e');
  return +`${mantissa}e${(exponent ? +exponent : 0) + by}`;
};

const toFixed = (num: number, precision: number) => {
  if (!Number.isFinite(num)) return num;
  const rounded = Math.round(shiftDecimalExponent(num, precision));
  return +shiftDecimalExponent(rounded, -precision).toFixed(precision);
};

export const fix = <T extends object>(obj: T, key: keyof T, precision: number): void => {
  const property = obj[key];
  if (typeof property === 'number' && Number.isFinite(property)) {
    (obj[key] as number) = toFixed(property, precision);
  }
};
