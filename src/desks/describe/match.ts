/**
 * How well the MPM matches the playing, as one figure and the four it is made of.
 *
 * A note is what the MPM so far renders, its shadow the same note as it was played. Each of the
 * four is the distance between the two in one respect, as a root mean square over the notes. They
 * fall as more is described; at nought the MPM plays what the pianist played. The match is the
 * share of what there was to explain with nothing described that is now explained, each of the
 * four counting a quarter.
 */

/** What is left between the rendering and the playing, over some notes. */
export interface Left {
    /** How many notes it was taken over. */
    notes: number;
    /** How early or late the chords sound, in ms. */
    pulse: number;
    /** How far the notes of a chord are from one another beyond what is rendered, in ms. */
    chords: number;
    /** How much louder or softer the notes were played, in key velocity. */
    loud: number;
    /** How much longer or shorter they were held, in ms. */
    length: number;
}

export type Meter = 'pulse' | 'chords' | 'loud' | 'length';

/** The four, in the order they are shown, with what each is called and what it says. */
export const METERS: readonly { key: Meter; name: string; says: string }[] = [
    {
        key: 'pulse',
        name: 'Timing',
        says: 'How early or late a chord sounds against where it was played. Remarks about tempo and rubato bring it down.',
    },
    {
        key: 'chords',
        name: 'In chords',
        says: 'How far the notes of one chord were played from each other, beyond what the MPM has: rolled chords, hands not together.',
    },
    {
        key: 'loud',
        name: 'Loudness',
        says: 'How much louder or softer a note was played, in key velocity (the MIDI scale, 1 to 127). Dynamics and accents.',
    },
    {
        key: 'length',
        name: 'Length',
        says: 'How much longer or shorter a note was held. Articulation: legato, detached, held over.',
    },
];

/** A distance as it is read: milliseconds, seconds from a thousand of them, velocity for loudness. */
export const amountOf = (key: Meter, value: number): string => {
    if (!Number.isFinite(value)) return '–';
    if (key === 'loud') return value.toFixed(1);
    if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} s`;
    return `${value >= 10 ? String(Math.round(value)) : value.toFixed(1)} ms`;
};

const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi);

/** How much of one of the four is left of what there was with nothing described, from 0 to 1. */
export const shareLeft = (key: Meter, now: Left, was: Left): number => clamp(now[key] / Math.max(was[key], 1e-9), 0, 1);

/**
 * The match: the share of what there was to explain that is explained, from 0 to 1. Null where
 * one of the four cannot be measured, as with no notes at all.
 *
 * @param now what is left as the document stands
 * @param was what there was with nothing described
 */
export const matchOf = (now: Left, was: Left): number | null => {
    if (!METERS.every(({ key }) => Number.isFinite(now[key]) && Number.isFinite(was[key]))) return null;
    if (now.notes === 0) return null;
    const left = METERS.map(({ key }) => shareLeft(key, now, was));
    return 1 - left.reduce((sum, share) => sum + share, 0) / left.length;
};
