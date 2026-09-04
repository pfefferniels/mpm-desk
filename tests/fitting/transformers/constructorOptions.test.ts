import { describe, expect, test } from 'vitest';
import { StylizeOrnamentation } from '../../../src/fitting/transformers/ornamentation/StylizeOrnamentation';

/**
 * A tolerance of `0` is a request, not a missing argument.
 *
 * Folding a caller's options into defaults with `||` sends a legitimate `0` back to the default,
 * and `0` is meaningful here: it asks dbscan for exact matches only, which is what the
 * `noteoff.shift` dimension of `StylizeOrnamentation.generateClusters` does deliberately. See
 * issue #33.
 */
describe('StylizeOrnamentation options', () => {
  test('defaults stand when nothing is passed', () => {
    expect(new StylizeOrnamentation().options).toEqual({
      tickTolerance: 10,
      intensityTolerance: 0.3,
      gradientTolerance: 0.1,
    });
  });

  test('all three are read, not only the first', () => {
    expect(
      new StylizeOrnamentation({
        tickTolerance: 5,
        intensityTolerance: 0.9,
        gradientTolerance: 0.9,
      }).options,
    ).toEqual({
      tickTolerance: 5,
      intensityTolerance: 0.9,
      gradientTolerance: 0.9,
    });
  });

  test('a tolerance of 0 is kept', () => {
    expect(
      new StylizeOrnamentation({
        tickTolerance: 0,
        intensityTolerance: 0,
        gradientTolerance: 0,
      }).options,
    ).toEqual({
      tickTolerance: 0,
      intensityTolerance: 0,
      gradientTolerance: 0,
    });
  });
});
