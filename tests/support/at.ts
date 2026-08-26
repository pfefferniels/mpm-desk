/**
 * Indexed reads for tests, under `noUncheckedIndexedAccess`.
 *
 * Same argument as `result.ts`: `xs[0]!` silences the one thing worth knowing. A list that
 * quietly came back empty surfaces later as `Cannot read properties of undefined`, in an
 * assertion whose name has nothing to do with the list. These fail at the read and say what
 * they found instead.
 *
 * For production code the answer is `src/prelude/seq.ts` — `head`, `last`, `elementAtOrNull`,
 * `numberAt`, `pairwise`. Reach for those first; these exist for the test-local shape where a
 * `toHaveLength` has just run and the next line wants an element out.
 */

/** The element at `index`, or a failure naming the length that did not reach it. */
export function at<T>(xs: readonly T[], index: number, what = 'element'): T {
  const value = xs[index];
  if (value === undefined)
    throw new Error(
      `expected ${what} at ${String(index)}, but the list holds ${String(xs.length)}`,
    );
  return value;
}

/** The only element, or a failure naming how many there actually were. */
export function only<T>(xs: readonly T[], what = 'element'): T {
  if (xs.length !== 1) throw new Error(`expected exactly one ${what}, got ${String(xs.length)}`);
  return at(xs, 0, what);
}
