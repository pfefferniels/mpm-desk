import { describe, test, expect } from 'vitest';
import { Alignment } from '../../src/fitting/alignment';
import { createMpm, exportMPM, getInstructions } from '../../src/fitting/instructions/index';
import { InsertDynamicsInstructions } from '../../src/fitting/transformers/dynamics/InsertDynamicsInstructions';
import type { Transformer } from '../../src/fitting/transformers/Transformer';
import { at } from '../support/at';

/**
 * The pipeline re-folds the *entire* chain over a fresh MPM on every edit, so the fold has to be
 * a function: the same chain over the same alignment must produce the same document. Fitting a
 * curve by simulated annealing used to draw from `Math.random` — touching any desk then re-fitted
 * every curve in the piece to slightly different numbers.
 *
 * These tests fold twice and compare the serialized result, which is exactly what the worker
 * hands back to the UI.
 *
 * This used to guard two annealing fitters. `ApproximateLogarithmicTempo` was the other, and it
 * is not part of this application; `src/fitting/transformers/dynamics/Approximation.ts` is now
 * the only module in the tree that draws a random number at all, which is what makes this one
 * file still the whole guard against `Math.random` creeping back into a fit.
 */

const BEAT = 720;

/** Notes whose onsets accelerate and whose velocities swell — enough to make the fitter work. */
const buildMsm = () => {
  const notes = Array.from({ length: 17 }, (_, i) => {
    const x = i / 16;
    // accelerando: beats get closer together
    const onset = 750 * i - 180 * x * i;
    return {
      'xml:id': `n_1_${i}`,
      date: i * BEAT,
      part: 1,
      pitchname: 'g' as const,
      octave: 4,
      duration: BEAT,
      accidentals: 0,
      'midi.pitch': 67,
      'milliseconds.date': onset,
      'milliseconds.date.end': onset + 500,
      // a swell, so the dynamics fit is neither flat nor a straight line
      velocity: Math.round(50 + 45 * Math.sin(Math.PI * x)),
    };
  });
  return new Alignment(notes, { numerator: 4, denominator: 4 });
};

/**
 * The fitter, over one span.
 *
 * A call's own `v4()` id stays as minted: it names the call in the work file and never reaches
 * the MPM, so it cannot make two folds differ. What the fitter does mint per run is a working
 * `dynamics_<uuid>`, and `generateId` replaces every one of those with a name derived from the
 * date before it is written — which is why the serialized comparison below can
 * be exact rather than up to a renaming.
 */
const chain = (): Transformer[] => [
  new InsertDynamicsInstructions({
    scope: 'global',
    from: 0,
    to: 16 * BEAT,
    phantomVelocities: new Map(),
  }),
];

/** What the worker does: fresh MPM, cloned alignment, run every transformer, serialize. */
const fold = (transformers: Transformer[]) => {
  const msm = buildMsm().deepClone();
  const mpm = createMpm();
  for (const transformer of transformers) transformer.run(msm, mpm);
  return exportMPM(mpm);
};

describe('the pipeline fold is a function of its inputs', () => {
  test('folding the same chain twice yields the same MPM', () => {
    expect(fold(chain())).toBe(fold(chain()));
  });

  test('the fitted dynamics curve does not drift across runs', () => {
    const curves = () => {
      const msm = buildMsm().deepClone();
      const mpm = createMpm();
      at(chain(), 0, 'transformer').run(msm, mpm);
      return getInstructions(mpm, 'dynamics', 'global').map((d) => [
        d.volume,
        d.transitionTo,
        d.curvature,
        d.protraction,
      ]);
    };
    const first = curves();
    expect(first.length).toBeGreaterThan(0);
    expect(curves()).toEqual(first);
    expect(curves()).toEqual(first);
  });
});
