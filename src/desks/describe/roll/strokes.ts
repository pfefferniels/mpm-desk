import type { PlacedNote } from './geometry';
import type { About, RollNote } from './types';

/**
 * What a gesture on the roll says, and which notes a remark is about.
 *
 * A reader writes on the roll as on paper: a stroke along it brackets a passage, a stroke down
 * it boxes some of its notes, a stroke from one note to another is an arrow. This is the reading
 * of those strokes, apart from the component that follows the pointer.
 */

/** A stroke of the pointer across the roll, from where it went down to where it is now. */
export interface Stroke {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    /** Begun on the ruler, where every stroke is a passage. */
    ruler: boolean;
}

/** A stroke as the roll follows it: what it began on, and what it would be if the pointer were lifted now. */
export interface Drag extends Stroke {
    /** The note and the remark the pointer went down on. */
    note: string | null;
    mark: string | null;
    additive: boolean;
    /** A press that can only become a click: a finger, which scrolls the roll, or a reader who may not write. */
    tap: boolean;
    moved: boolean;
    /** The note a stroke begun on a note has reached: the two make an arrow. */
    aim: string | null;
}

/** The remark an event is on, if it is on one: its words, or the brace over its passage. */
export const remarkAt = (target: EventTarget | null): string | null =>
    target instanceof Element ? (target.closest('[data-remark]')?.getAttribute('data-remark') ?? null) : null;

/** Further than a hand trembles on a click. */
export const hasMoved = ({ x0, y0, x1, y1 }: Stroke): boolean => Math.abs(x1 - x0) > 4 || Math.abs(y1 - y0) > 4;

/** A stroke that stays level is a passage; one that goes up or down is a box of notes. */
export const isFlat = ({ y0, y1, ruler }: Stroke): boolean => ruler || Math.abs(y1 - y0) < 16;

/**
 * The notes a stroke takes: every note beginning under a flat one, and of those the ones a tall
 * one reaches down to.
 *
 * A box that holds every note of its stretch is a passage all the same.
 */
export const caughtBy = (stroke: Stroke, placed: readonly PlacedNote[]): { kind: 'span' | 'box'; notes: RollNote[] } | null => {
    const [x0, x1] = [Math.min(stroke.x0, stroke.x1), Math.max(stroke.x0, stroke.x1)];
    const [y0, y1] = [Math.min(stroke.y0, stroke.y1), Math.max(stroke.y0, stroke.y1)];
    const flat = isFlat(stroke);
    const within = placed.filter(({ now }) => now.x <= x1 && now.x + Math.min(now.w, 12) >= x0);
    const boxed = flat ? within : within.filter(({ now }) => now.y + now.h >= y0 && now.y <= y1);
    if (boxed.length === 0) return null;
    return { kind: flat || boxed.length === within.length ? 'span' : 'box', notes: boxed.map(({ note }) => note) };
};

/** The whole piece, which is what a remark is about when nothing is in hand. */
export const wholePiece = (end: number): About => ({ kind: 'piece', from: 0, to: end, notes: [] });

/** Where the piece ends, in ticks. */
export const endOf = (notes: readonly RollNote[], bars: readonly { to: number }[]): number => {
    let end = bars.length ? bars[bars.length - 1].to : 0;
    for (const note of notes) end = Math.max(end, note.date + note.duration);
    return end;
};

/**
 * What a handful of notes says a remark is about.
 *
 * The stretch runs from the first of them to the next date of the score after the last, so that
 * `to` is exclusive and the last chord is inside. An arrow wants two notes, one after the other;
 * anything else called an arrow is a set of notes.
 *
 * @param picked the notes in hand
 * @param notes every note of the piece
 * @param end where the piece ends, in ticks
 */
export const aboutOf = (kind: Exclude<About['kind'], 'piece'>, picked: readonly RollNote[], notes: readonly RollNote[], end: number): About => {
    if (picked.length === 0) return wholePiece(end);
    const sorted = [...picked].sort((a, b) => a.date - b.date || a.pitch - b.pitch);
    const first = sorted[0].date;
    const last = sorted[sorted.length - 1].date;
    let next = Infinity;
    for (const note of notes) if (note.date > last && note.date < next) next = note.date;
    const arrow = sorted.length === 2 && first < last;
    return {
        kind: kind === 'arrow' && !arrow ? 'notes' : kind,
        from: first,
        to: Number.isFinite(next) ? next : Math.max(end, last),
        notes: sorted.map((note) => note.id),
    };
};

/**
 * The notes a remark is about: those in its stretch for a passage or an arrow, those it names
 * for a set or a box, and none for the whole piece, which singles nothing out.
 */
export const notesOf = (about: About, notes: readonly RollNote[]): string[] =>
    about.kind === 'piece'
        ? []
        : about.kind === 'span' || about.kind === 'arrow'
          ? notes.filter((note) => note.date >= about.from && note.date < about.to).map((note) => note.id)
          : about.notes;
