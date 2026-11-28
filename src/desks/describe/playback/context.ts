/**
 * How much of the music around a passage has to be played for the passage to be understood.
 */
import { PULSES_PER_QUARTER } from '../../../fitting/ppq';
import type { DescribedPlace } from '../../../fitting/transformers/description/Describe';

/** What a remark wrote, in the terms the rules below are stated in. */
export type Subject = 'tempo' | 'rubato' | 'dynamics' | 'roll' | 'touch' | 'accent' | 'pedal';

/** The score as the rules read it. All positions are ticks. */
export interface ScoreGrid {
    /** Every date a note begins on, ascending. */
    dates: readonly number[];
    /** Every beat, ascending. */
    beats: readonly number[];
    /** Every bar's first tick, ascending. */
    bars: readonly number[];
    notes: readonly { id: string; date: number; part: number }[];
}

/** Never more context than this to either side, in beats. */
const MOST_BEATS = 2;

/** The `count`th mark of a grid before a date; short of that many, the grid's first. */
const before = (grid: readonly number[], date: number, count = 1): number =>
    grid.filter((mark) => mark < date).at(-count) ?? grid[0] ?? date;

/** The `count`th mark of a grid after a date; short of that many, the grid's last. */
const after = (grid: readonly number[], date: number, count = 1): number =>
    grid.filter((mark) => mark > date)[count - 1] ?? grid.at(-1) ?? date;

const atOrBefore = (grid: readonly number[], date: number): number =>
    grid.findLast((mark) => mark <= date) ?? grid[0] ?? date;

/**
 * The stretch of the score to play for a passage, with what is needed around it to hear what a
 * remark says of it. All positions are ticks of the score; a chord is every note on one date.
 *
 * - Always the chord before, to measure against, and the chord after: the time a note takes is
 *   only heard when the next one comes.
 * - A pulse (tempo, rubato, a rolled chord against its beat) needs an interval before it began
 *   and one after it ended: back to the beat before the passage's first, on through a second chord.
 * - Touch (legato, detached, held over) and anything said of single notes is between a note and
 *   its neighbours in the same hand: the note before and the note after in that hand, where
 *   there is one within reach.
 * - An accent pattern is heard over its whole bar; the pedal over the beat either side.
 *
 * @param place where the remark was made; its `to` is exclusive.
 * @param about what the remark wrote.
 * @param touched the notes whose touch the remark is about, where it names them.
 * @returns both inclusive: the first and the last date to play.
 */
export const contextOf = (
    { dates, beats, bars, notes }: ScoreGrid,
    place: DescribedPlace,
    about: ReadonlySet<Subject>,
    touched: readonly string[] = [],
): { from: number; to: number } => {
    const inside = dates.filter((date) => date >= place.from && date < place.to);
    const first = inside[0] ?? place.from;
    const last = inside.at(-1) ?? place.from;
    const beat = (beats[1] ?? PULSES_PER_QUARTER) - (beats[0] ?? 0);

    let from = before(dates, first);
    let to = after(dates, last);

    if (about.has('tempo') || about.has('rubato') || about.has('roll')) {
        from = Math.min(from, atOrBefore(beats, atOrBefore(beats, first) - 1), before(dates, first, 2));
        to = Math.max(to, Math.min(after(dates, last, 2), to + 1.5 * beat));
    }
    const named = place.kind === 'notes' || place.kind === 'box';
    const own = new Set(touched.length ? touched : named ? place.notes : []);
    if (own.size || about.has('touch')) {
        const mine = notes.filter((note) =>
            own.size ? own.has(note.id) : note.date >= place.from && note.date < place.to,
        );
        for (const part of new Set(mine.map((note) => note.part))) {
            const hand = notes.filter((note) => note.part === part).map((note) => note.date);
            const reach = mine.filter((note) => note.part === part).map((note) => note.date);
            const earlier = hand.filter((date) => date < Math.min(...reach));
            const later = hand.filter((date) => date > Math.max(...reach));
            if (earlier.length) from = Math.min(from, Math.max(...earlier));
            if (later.length) to = Math.max(to, Math.min(...later));
        }
    }
    if (about.has('accent')) {
        from = Math.min(from, atOrBefore(bars, first));
        to = Math.max(to, after(bars, last));
    }
    if (about.has('pedal')) {
        from = Math.min(from, atOrBefore(beats, first - 1));
        to = Math.max(to, after(beats, last));
    }
    return {
        from: Math.max(from, first - MOST_BEATS * beat, dates[0] ?? from),
        to: Math.min(to, last + MOST_BEATS * beat, dates.at(-1) ?? to),
    };
};
