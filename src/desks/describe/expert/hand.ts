/**
 * Calls made by hand on the other desks, told in brief: how many of which transformer, and over
 * which stretch of the score. A document may hold hundreds, and the expert has to know of them
 * without reading them.
 */
import type { Call } from '../../../model/Work';

/** The calls of one transformer among some calls made by hand. */
export interface Told {
    /** "InsertTempo ×5". */
    count: string;
    /** The first and the last tick they speak of, also by bar and beat, where any names a place. */
    where?: string;
    /** How many of them name no place in the score. */
    placeless: number;
    calls: Call[];
}

/** The ticks a call speaks of, as far as its options say; none where it names no place. */
const ticksOf = (
    { options }: Call,
    dateOf: (note: string) => number | undefined,
): number[] => {
    const { from, to, date, length, noteIDs, guides } = options;
    if (typeof from === 'number' && typeof to === 'number') return [from, to];
    if (typeof date === 'number') return [date, date + (typeof length === 'number' ? length : 0)];
    if (Array.isArray(noteIDs)) return noteIDs.flatMap((id) => dateOf(String(id)) ?? []);
    return guides instanceof Map ? [...guides.keys()].filter((key) => typeof key === 'number') : [];
};

/**
 * @param place a tick by its bar and beat.
 * @param dateOf where a note stands, for the calls that name notes and no ticks.
 * @returns the transformers in the order their first call stands in.
 */
export const byTransformer = (
    calls: readonly Call[],
    place: (tick: number) => string,
    dateOf: (note: string) => number | undefined,
): Told[] =>
    [...Map.groupBy(calls, (call) => call.name)].map(([name, named]) => {
        const ticks = named.map((call) => ticksOf(call, dateOf)).filter((of) => of.length > 0);
        const count = `${name} ×${named.length}`;
        const placeless = named.length - ticks.length;
        if (ticks.length === 0) return { count, placeless, calls: named };
        const first = Math.round(Math.min(...ticks.flat()));
        const last = Math.round(Math.max(...ticks.flat()));
        const where =
            first === last
                ? `tick ${first} (${place(first)})`
                : `ticks ${first} to ${last} (${place(first)} to ${place(last)})`;
        return { count, where, placeless, calls: named };
    });
