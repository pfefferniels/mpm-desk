/**
 * What a rendering leaves of the playing: four measures over the notes of a roll.
 *
 * Each is a root mean square of the recording less the rendering, so that a remark which brings
 * the notes onto their shadows brings its measure down.
 */
import type { RollNote } from '../../../fitting/description/client';
import type { DescribedPlace } from '../../../fitting/transformers/description/Describe';

type Measured = Pick<RollNote, 'id' | 'date' | 'late' | 'loud' | 'longMs'>;

export interface Left {
    notes: number;
    /** How far the chords, each at the mean of its notes, stand from where they are rendered, in ms. */
    pulse: number;
    /** How far the notes of a chord stand from one another, beyond how they are rendered, in ms. */
    chords: number;
    /** In velocity. */
    loud: number;
    /** Of the sounded length, in ms. */
    length: number;
}

const rms = (values: readonly number[]) =>
    Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length));

/**
 * The notes a remark is about: those it names, or every note of its passage.
 *
 * @returns `undefined` for a remark about the whole piece, which is how `leftIn` is asked for all.
 */
export const idsOf = (
    { kind, from, to, notes }: DescribedPlace,
    roll: readonly Pick<RollNote, 'id' | 'date'>[],
): string[] | undefined => {
    if (kind === 'piece') return undefined;
    if (kind === 'notes' || kind === 'box') return notes;
    return roll.filter((note) => note.date >= from && note.date < to).map((note) => note.id);
};

/** @param ids the notes to measure; every note of the roll where none are given. */
export const leftIn = (roll: readonly Measured[], ids?: readonly string[]): Left => {
    const wanted = ids && new Set(ids);
    const notes = wanted ? roll.filter((note) => wanted.has(note.id)) : roll;
    const means = new Map(
        [...Map.groupBy(notes, (note) => note.date)].map(([date, chord]) => [
            date,
            chord.reduce((sum, note) => sum + note.late, 0) / chord.length,
        ]),
    );
    return {
        notes: notes.length,
        pulse: rms([...means.values()]),
        chords: rms(notes.map((note) => note.late - means.get(note.date)!)),
        loud: rms(notes.map((note) => note.loud)),
        length: rms(notes.map((note) => note.longMs)),
    };
};

/** The same under the names the expert knows them by, rounded as it is shown them. */
export const measures = (left: Left) => ({
    notes: left.notes,
    pulse_ms: +left.pulse.toFixed(1),
    spread_ms: +left.chords.toFixed(1),
    velocity: +left.loud.toFixed(2),
    length_ms: +left.length.toFixed(0),
});
