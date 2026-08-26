import { describe, test } from 'vitest';
import { tierThreeCases } from './cases';
import { expectCase } from './expectations';

/**
 * Tier 3 — several aspects at once, and in the last pair, the segmentation withheld.
 *
 * This is the honest number. Aspects interact: the tempo fit runs over onsets a rubato has
 * already warped, the dynamics fit absorbs per-note articulation into its curve, and the
 * articulation step is then measured against that curve. None of it shows up one aspect at a
 * time, which is why tier 2 can be clean while this is not.
 *
 * The two "all five aspects" cases share a truth and differ only in whether the chain is told
 * where the segments are, so the gap between their bounds is what that knowledge is worth.
 */

describe('several aspects at once, rendered back', () => {
  for (const spec of tierThreeCases) {
    test(spec.name, () => {
      expectCase(spec);
    });
  }
});
