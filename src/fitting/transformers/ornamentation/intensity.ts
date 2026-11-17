import { foldl } from 'espressivo';

/**
 * The `@intensity` that spaces a spread's onsets as they were played.
 *
 * Apart from the two fits that share it, a chord's roll and a grace figure's lead, and from the
 * rubato fit, which spaces a frame's dates the same way.
 *
 * @param onsets sorted, and normalized to [0, 1]
 */
export const determineIntensity = (onsets: number[]): number => {
  const n = onsets.length;
  // intensity only makes sense for more than 2 notes
  if (n <= 2) return 1;

  // The error function we want to minimize.
  const error = (intensity: number): number =>
    foldl(onsets, 0, (sum, onset, i) => {
      const diff = onset - Math.pow(i / (n - 1), intensity);
      return sum + diff * diff;
    });

  // Search bounds. TODO: make these configurable.
  let lower = 0.1,
    upper = 5.0;
  const tol = 1e-6;
  const goldenRatio = (Math.sqrt(5) + 1) / 2;

  let c = upper - (upper - lower) / goldenRatio;
  let d = lower + (upper - lower) / goldenRatio;

  // Continue refining the bounds until convergence.
  while (upper - lower > tol) {
    if (error(c) < error(d)) {
      upper = d;
    } else {
      lower = c;
    }
    c = upper - (upper - lower) / goldenRatio;
    d = lower + (upper - lower) / goldenRatio;
  }

  return (lower + upper) / 2;
};
