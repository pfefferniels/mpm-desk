import type { DynamicsSegment } from './segments';

/**
 * A date a dynamics curve can depart from or arrive at, and the velocity it holds there.
 *
 * Two things are anchors: a chord onset, where the velocity is the recording's, and a phantom,
 * where it is the one pencilled in. The insert gesture does not tell them apart — it hands
 * `InsertDynamicsInstructions` two dates, and the transformer reads a phantom in place of the
 * chord's mean at every date it covers, chord or no chord.
 */
export interface DynamicsAnchor {
    date: number;
    velocity: number;
}

const meanOf = (velocities: number[]) =>
    velocities.reduce((sum, velocity) => sum + velocity, 0) / velocities.length;

/**
 * Every anchor in the plot, in date order.
 *
 * A phantom replaces the chord at its own date rather than joining it, which is what pencilling
 * one in over a dot means. A chord anchor takes the mean of the dots plotted at its date; a chord
 * struck at one velocity — nearly every one — has a single dot and so its own velocity.
 */
export const anchorsOf = (
    segments: readonly DynamicsSegment[],
    phantoms: ReadonlyMap<number, number>,
): DynamicsAnchor[] => {
    const plotted = segments.reduce<Map<number, number[]>>((acc, segment) => {
        const here = acc.get(segment.date.start);
        if (here) here.push(segment.velocity);
        else acc.set(segment.date.start, [segment.velocity]);
        return acc;
    }, new Map());

    const byDate = new Map<number, DynamicsAnchor>([
        ...[...plotted].map(([date, velocities]): [number, DynamicsAnchor] => [
            date,
            { date, velocity: meanOf(velocities) },
        ]),
        ...[...phantoms].map(([date, velocity]): [number, DynamicsAnchor] => [
            date,
            { date, velocity },
        ]),
    ]);

    return [...byDate.values()].sort((a, b) => a.date - b.date);
};

/** The anchor nearest `date`, or none within `within` ticks of it. */
export const nearestAnchor = (
    anchors: readonly DynamicsAnchor[],
    date: number,
    within: number,
): DynamicsAnchor | undefined =>
    anchors
        .filter((anchor) => Math.abs(anchor.date - date) <= within)
        .reduce<DynamicsAnchor | undefined>(
            (best, anchor) =>
                best === undefined || Math.abs(anchor.date - date) < Math.abs(best.date - date)
                    ? anchor
                    : best,
            undefined,
        );
