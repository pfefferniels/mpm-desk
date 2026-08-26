import { describe, expect, test } from 'vitest';
import { StylizeOrnamentation } from '../../../src/fitting/transformers/ornamentation/StylizeOrnamentation';

/**
 * A tolerance of `0` is a request, not a missing argument.
 *
 * `StylizeOrnamentation` folds its caller's options into defaults with `||`, so a legitimate `0`
 * fell back to the default — and `0` is meaningful here: it asks dbscan for exact matches only,
 * which is what the `noteoff.shift` dimension of `StylizeOrnamentation.generateClusters` already
 * does deliberately. It went further and never read two of its three options at all (issue #33).
 *
 * `StylizeArticulation` had the same bug and used to be tested beside it here; it is not part of
 * this application.
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
