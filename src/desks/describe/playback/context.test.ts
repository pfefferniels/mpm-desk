/**
 * How much is played around a passage: each rule the context is made by, on four bars of common
 * time with the right hand in eighths over the left hand's half notes.
 */
import { describe, expect, it } from 'vitest';
import type { DescribedPlace } from '../../../fitting/transformers/description/Describe';
import { contextOf, type ScoreGrid, type Subject } from './context';

const [EIGHTH, BEAT, HALF, BAR] = [360, 720, 1440, 2880];
const END = 4 * BAR;

const every = (step: number, until = END) =>
    Array.from({ length: until / step }, (_, i) => i * step);

const score: ScoreGrid = {
    dates: every(EIGHTH),
    beats: [...every(BEAT), END],
    bars: every(BAR),
    notes: [
        ...every(EIGHTH).map((date) => ({ id: `r${date}`, date, part: 1 })),
        ...every(HALF).map((date) => ({ id: `l${date}`, date, part: 2 })),
    ],
};

const span = (from: number, to: number): DescribedPlace => ({ kind: 'span', from, to, notes: [] });
const about = (...subjects: Subject[]) => new Set(subjects);

/** The second and third beat of the second bar: the eighths on 3600 to 4680. */
const passage = span(BAR + BEAT, BAR + 3 * BEAT);

describe('the music played around a passage', () => {
    it('is always the chord before and the chord after', () => {
        expect(contextOf(score, passage, about())).toEqual({ from: 3240, to: 5040 });
        expect(contextOf(score, passage, about('dynamics'))).toEqual({ from: 3240, to: 5040 });
    });

    it.each<Subject>(['tempo', 'rubato', 'roll'])(
        'for a pulse (%s) goes back to the beat before the first, and on through a second chord',
        (subject) => {
            expect(contextOf(score, passage, about(subject))).toEqual({ from: BAR, to: 5400 });
            // A passage that begins off the beat: the beat before the one it begins in.
            expect(contextOf(score, span(3960, 4680), about(subject))).toEqual({
                from: BAR,
                to: 5040,
            });
        },
    );

    it('for touch takes the note before and the note after in each hand', () => {
        // The left hand's half note on 4320 lies between those on 2880 and 5760.
        expect(contextOf(score, passage, about('touch'))).toEqual({ from: BAR, to: 2 * BAR });
        // Named, only the notes touched count: two eighths, whose neighbours are a chord away.
        expect(contextOf(score, passage, about('touch'), ['r3960', 'r4320'])).toEqual({
            from: 3240,
            to: 5040,
        });
        expect(contextOf(score, passage, about('touch'), ['l4320'])).toEqual({
            from: BAR,
            to: 2 * BAR,
        });
    });

    it('for single notes does the same, whatever is said of them', () => {
        const one: DescribedPlace = { kind: 'notes', from: 4320, to: 4680, notes: ['l4320'] };
        expect(contextOf(score, one, about())).toEqual({ from: BAR, to: 2 * BAR });
        expect(contextOf(score, { ...one, kind: 'box' }, about('dynamics'))).toEqual({
            from: BAR,
            to: 2 * BAR,
        });
        // A passage is not single notes: the hands are not followed.
        expect(contextOf(score, { ...one, kind: 'span' }, about())).toEqual({
            from: 3960,
            to: 4680,
        });
    });

    it('for an accent pattern is the whole bar, for the pedal the beat either side', () => {
        expect(contextOf(score, passage, about('accent'))).toEqual({ from: BAR, to: 2 * BAR });
        expect(contextOf(score, passage, about('pedal'))).toEqual({ from: BAR, to: 5040 });
        // A passage that begins on a beat has the pedal from the beat before.
        expect(contextOf(score, span(BAR, BAR + BEAT), about('pedal'))).toEqual({
            from: BAR - BEAT,
            to: BAR + BEAT,
        });
    });

    it('is never more than two beats to either side', () => {
        const slow: ScoreGrid = {
            ...score,
            dates: every(BAR),
            notes: every(BAR).map((date) => ({ id: `w${date}`, date, part: 1 })),
        };
        // Whole notes: the chord before and the chord after are a bar away, and are not reached.
        expect(contextOf(slow, span(BAR, 2 * BAR), about())).toEqual({
            from: BAR - 2 * BEAT,
            to: BAR + 2 * BEAT,
        });
        expect(contextOf(slow, span(BAR, 2 * BAR), about('tempo', 'accent', 'touch'))).toEqual({
            from: BAR - 2 * BEAT,
            to: BAR + 2 * BEAT,
        });
    });

    it('ends where the piece does', () => {
        // Two beats past its last eighth, and no further back than the first note.
        expect(contextOf(score, span(0, BEAT), about('tempo', 'accent', 'pedal'))).toEqual({
            from: 0,
            to: EIGHTH + HALF,
        });
        expect(contextOf(score, span(END - BEAT, END), about('tempo', 'pedal'))).toEqual({
            from: END - 2 * BEAT,
            to: END - EIGHTH,
        });
    });

    it('takes a passage without a note for the place it begins on', () => {
        expect(contextOf(score, span(3700, 3900), about())).toEqual({ from: 3600, to: 3960 });
    });

    it('adds nothing for an accent where the score states no metre', () => {
        expect(contextOf({ ...score, bars: [] }, passage, about('accent'))).toEqual({
            from: 3240,
            to: 5040,
        });
    });
});
