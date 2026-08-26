/**
 * A deterministic pseudo-random source: the same seed always yields the same sequence.
 *
 * The fitting transformers explore their parameter space by simulated annealing. The pipeline
 * re-runs the *whole* chain on every edit, so an un-seeded `Math.random` meant that touching one
 * desk re-fitted every curve in the piece to slightly different numbers. Seeding the search from
 * its own inputs makes each fit a pure function of what it was asked to fit — which is also what
 * lets a desk's preview agree with what the pipeline will actually insert.
 */
export type Random = () => number;

/**
 * mulberry32: a 32-bit generator that is small, fast and well-distributed enough for annealing.
 */
export const seededRandom = (seed: number): Random => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * FNV-1a, so a seed can be derived from whatever describes the search — the segments being
 * fitted, the points being approximated — rather than from a clock or a counter.
 */
export const hashSeed = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};
