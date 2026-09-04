import { describe, expect, test } from 'vitest';
import { dbscan } from '../../../src/fitting/dbscan';

const labels = (points: number[][], epsilons?: number[], minPoints = 2) =>
  dbscan(points, epsilons ? { epsilons, minPoints } : { minPoints }).map((p) => p.label);

/**
 * The neighbourhood is a per-axis box, and the radii have to cover every axis of the data.
 *
 * A fixed `[1, 1]` default does not: `rangeQuery` reads `epsilons[dimension]` for every
 * dimension of the point, so a third one compares against `undefined`, and `<= undefined` is
 * `false` for every pair. Three identical points then come back as three separate pieces of
 * noise, with no error and no warning (issue #37).
 */
describe('dbscan default epsilons', () => {
  test('cover as many dimensions as the points have', () => {
    expect(
      labels([
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ]),
    ).toEqual([0, 0, 0]);
  });

  test('still separate points that are further apart than the default radius', () => {
    expect(
      labels([
        [1, 1, 1],
        [1, 1, 1],
        [9, 9, 9],
        [9, 9, 9],
      ]),
    ).toEqual([0, 0, 1, 1]);
  });

  test('a one-dimensional call works as it always did', () => {
    expect(labels([[1], [1], [8], [8]])).toEqual([0, 0, 1, 1]);
  });
});

describe('dbscan explicit epsilons', () => {
  test('shorter than the data is an error rather than universal noise', () => {
    expect(() =>
      dbscan(
        [
          [1, 1, 1],
          [1, 1, 1],
        ],
        { epsilons: [1, 1] },
      ),
    ).toThrow(/epsilons covers 2 dimension/);
  });

  test('a radius of 0 asks for exact matches, and gets them', () => {
    expect(
      labels(
        [
          [1, 5],
          [1, 5],
          [1, 6],
        ],
        [0, 0],
      ),
    ).toEqual([0, 0, -1]);
  });

  test('the box is per axis, not a Euclidean ball', () => {
    // (0.9, 0.9) is inside the box [±1, ±1]; its Euclidean distance is 1.27.
    expect(
      labels(
        [
          [0, 0],
          [0.9, 0.9],
        ],
        [1, 1],
      ),
    ).toEqual([0, 0]);
  });

  test('an empty input is empty rather than an error', () => {
    expect(dbscan([])).toEqual([]);
  });
});
