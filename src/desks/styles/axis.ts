import type { IPoint } from '../../fitting/dbscan';

/** One axis of a plot: what it measures, and the stretch of it that is drawn. */
export interface Axis {
    label: string;
    min: number;
    max: number;
}

/**
 * The range a set of points covers in one dimension, padded so nothing lands on an axis.
 *
 * For the plots whose units are the recording's own — milliseconds of roll, say — where a range
 * written into the call site is a guess about the piece rather than about the measurement.
 */
export const axisOver = (label: string, points: readonly IPoint[], dimension: number): Axis => {
    const values = points
        .map(point => point.value[dimension])
        .filter((value): value is number => value !== undefined && Number.isFinite(value));
    if (values.length === 0) return { label, min: 0, max: 1 };

    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.08, 1);
    return { label, min: min - padding, max: max + padding };
};
