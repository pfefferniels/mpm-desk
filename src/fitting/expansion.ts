/**
 * The map an `Expand` draws through its points, and the way back.
 *
 * Kept apart from the transformer, so that what reads an expansion without running one — the
 * desks drawing where an event was before it, the work file moving its guides with it — takes
 * the same arithmetic without taking the chain along.
 */

/** A value as the recording has it, and the value it is to have instead. */
export type ExpansionPoint = [from: number, to: number];

const rising = (values: readonly number[]) => values.every((v, k) => k === 0 || v > values[k - 1]);

/**
 * The map the points draw, or `null` where they draw none: fewer than two, a value that is not a
 * finite number, or recorded values that do not rise.
 *
 * Between two points the map is linear; beyond the outermost ones the outermost line carries
 * on, so the points need not span the values they are applied to.
 */
export const expansion = (points: readonly ExpansionPoint[]): ((value: number) => number) | null => {
    if (points.length < 2) return null;
    if (points.some(([from, to]) => !Number.isFinite(from) || !Number.isFinite(to))) return null;
    if (!rising(points.map(([from]) => from))) return null;

    return (value) => {
        // The segment the value falls in; below the first point the first, above the last the last.
        let k = 1;
        while (k < points.length - 1 && value > points[k][0]) k++;
        const [x0, y0] = points[k - 1];
        const [x1, y1] = points[k];
        return y0 + ((value - x0) * (y1 - y0)) / (x1 - x0);
    };
};

/**
 * The map back, from a new value to the recorded one, or `null` where there is none: the map has
 * to rise throughout for every new value to come from one recorded value only.
 *
 * It is the map through the same points read the other way round, beyond the outermost ones as
 * well, since a line carried on is a line carried on in both directions.
 */
export const inverseExpansion = (
    points: readonly ExpansionPoint[],
): ((value: number) => number) | null => {
    if (!expansion(points) || !rising(points.map(([, to]) => to))) return null;
    return expansion(points.map(([from, to]): ExpansionPoint => [to, from]));
};
