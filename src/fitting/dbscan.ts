import { elementAtOrNull, numberAt } from 'espressivo';

export interface IPoint {
  value: number[];
  index: number;
  label: number;
}

interface DBScanOptions {
  /**
   * The neighbourhood radius, given per dimension: two points are neighbours when they are
   * within `epsilons[d]` of each other in *every* dimension `d`. This is a per-axis box, not
   * a Euclidean ball — which is what the callers want, since they measure ticks against
   * velocity units against dimensionless gradients and there is no meaningful way to add
   * those in quadrature.
   *
   * Must have one entry per dimension of `points`; a shorter array throws. A missing entry
   * would make every comparison `<= undefined` — i.e. `false` — so a three-dimensional call
   * would quietly label every point noise (issue #37).
   *
   * @default 1 in every dimension
   */
  epsilons?: number[];

  /**
   * The minimum number of points in any group for them to be considered a distinct group. All other points are considered to be noise, and will receive a label of -1.
   * @default 2
   */
  minPoints?: number;
}

/**
 * @param points A list of data to perform the clustering on, like `[[1], [2]]`, `[[1, 2], [[3, 4]]` or more dimensions `[[1, 2, 3, 4...],[...]].
 * @param options dbscan related parameters.
 * @returns labels is the returned list of clustered group labels. A label of -1 indicates the point is noise
 */
export function dbscan(points: number[][], options: DBScanOptions = {}): IPoint[] {
  if (!(points instanceof Array)) {
    throw Error(`points must be of type array, ${typeof points} given`);
  }

  const dimensions = points.reduce((widest, point) => Math.max(widest, point.length), 0);
  const { epsilons = new Array<number>(dimensions).fill(1), minPoints = 2 } = options;
  if (epsilons.length < dimensions) {
    throw Error(
      `epsilons covers ${epsilons.length} dimension(s), but the points have ${dimensions}`,
    );
  }

  const data: IPoint[] = points.map((value, index) => ({ index, value, label: -1 }));
  let clusterId = 0;

  for (const point of data) {
    // Only process unlabelled points
    if (point.label !== -1) {
      continue;
    }
    // Get all the points neighbors
    let neighbors = rangeQuery(point, data, epsilons);
    // Check if point is noise
    if (neighbors.length < minPoints) {
      point.label = 0;
      continue;
    }
    // Next cluster label
    clusterId += 1;
    // Label initial point
    point.label = clusterId;
    // Remove point p from n
    let neighbors2 = neighbors.filter((neighbor) => neighbor.index !== point.index);
    // Process every seed point
    while (neighbors2.length) {
      const neighbor = neighbors2.pop();
      if (!neighbor) {
        break;
      }
      // Change noise to border
      if (neighbor.label === 0) {
        neighbor.label = clusterId;
      }
      // Previously processed
      if (neighbor.label !== -1) {
        continue;
      }
      // Label neighbor
      neighbor.label = clusterId;
      // Find neighbors
      neighbors = rangeQuery(neighbor, data, epsilons);
      // Add new neighbors to seed
      if (neighbors.length >= minPoints) {
        neighbors2 = neighbors2.concat(neighbors);
      }
    }
  }

  for (const point of data) {
    point.label -= 1;
  }

  return data;
}

function rangeQuery(current: IPoint, data: IPoint[], epsilons: number[]) {
  return data.filter((point) =>
    point.value.every((value, dimension) => {
      // a point with fewer dimensions than its neighbour is nobody's neighbour, which is the
      // reading `<= undefined` gives it. the epsilon is in range: `epsilons.length` was checked
      // against the widest point above.
      const centre = elementAtOrNull(current.value, dimension);
      return (
        centre !== null && Math.abs(value - centre) <= numberAt(epsilons, dimension, 'the epsilons')
      );
    }),
  );
}
