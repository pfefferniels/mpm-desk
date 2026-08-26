import { describe, test } from 'vitest';
import { tierTwoCases } from './cases';
import { expectCase } from './expectations';

/**
 * Tier 2 — one aspect at a time, segmentation handed in, compared in performance space.
 *
 * This is the tier that sees the bugs unit tests cannot. All four criticals in the 2026-08
 * audit produced an MPM that was well-formed, internally plausible and passed every unit test
 * in the repo, and were only visible once the document was rendered and the render compared
 * against the performance it had been fitted to.
 *
 * With a single aspect and the boundaries given, the truth is exactly representable and a
 * correct chain would land on zero. Whatever a bound admits above zero is measured, not
 * assumed, and `note` on the case says what causes it.
 */

describe('one aspect, boundaries given, rendered back', () => {
  for (const spec of tierTwoCases) {
    test(spec.name, () => {
      expectCase(spec);
    });
  }
});
