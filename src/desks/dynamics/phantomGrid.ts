import { beatLengthInTicks } from '../../fitting/ppq';
import { clamp } from '../../fitting/utils';
import type { DynamicsAnchor } from './anchors';

/**
 * The note values a phantom velocity may be pinned to, as fractions of a whole note.
 *
 * A note value the user picks, rather than one read off the score's metre: where a phantom belongs
 * is a reading of the passage, and a curve is often drawn against a subdivision the signature does
 * not name.
 */
export const PHANTOM_GRIDS = [0.5, 0.25, 0.125, 0.0625] as const;

export type PhantomGrid = (typeof PHANTOM_GRIDS)[number];

export const DEFAULT_PHANTOM_GRID: PhantomGrid = 0.25;

/** The grid's spacing in ticks. */
export const gridTicks = (grid: PhantomGrid): number => beatLengthInTicks(grid);

export const gridLabel = (grid: PhantomGrid): string => `1/${String(1 / grid)}`;

/**
 * Where a click in the plot pencils a phantom in, or nothing where none may go.
 *
 * The date snaps to the nearest grid line counted from tick 0, which is where the score's own
 * dates are counted from, so an anacrusis needs no origin of its own. Off either end of the score
 * there is nothing for a curve to be fitted over, and a click there places nothing.
 */
export const snapPhantom = (
    at: { date: number; velocity: number },
    grid: PhantomGrid,
    end: number,
): DynamicsAnchor | undefined => {
    const ticks = gridTicks(grid);
    const date = Math.round(at.date / ticks) * ticks;
    if (date < 0 || date > end) return undefined;
    return { date, velocity: Math.round(clamp(at.velocity, 0, 127)) };
};

/** Every grid line up to `end`, for drawing. */
export const gridDates = (grid: PhantomGrid, end: number): number[] => {
    const ticks = gridTicks(grid);
    if (end < 0) return [];
    return Array.from({ length: Math.floor(end / ticks) + 1 }, (_, line) => line * ticks);
};
