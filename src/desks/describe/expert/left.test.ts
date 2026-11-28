import { describe, expect, it } from 'vitest';
import { idsOf, leftIn, measures } from './left';

/**
 * The four measures of what a rendering leaves, over notes whose distances are easy to sum: that
 * the pulse is of the chords and the spread of the notes within them, and which notes a remark is
 * measured by.
 */

const note = (id: string, date: number, late: number, loud = 0, longMs = 0) => ({
    id,
    date,
    late,
    loud,
    longMs,
});

/** A chord played 100 ms late and rolled over 40 ms; a chord on time; a single note, early. */
const roll = [
    note('a1', 0, 80, 3, 100),
    note('a2', 0, 120, -3, 100),
    note('b1', 720, 0),
    note('b2', 720, 0),
    note('c', 1440, -50, 4, -200),
];

describe('leftIn', () => {
    it('takes the pulse from the chords, each at the mean of its notes', () => {
        const { pulse } = leftIn(roll);
        expect(pulse).toBeCloseTo(Math.sqrt((100 ** 2 + 0 + 50 ** 2) / 3));
    });

    it('takes the spread from the notes, each against the mean of its chord', () => {
        const { chords } = leftIn(roll);
        expect(chords).toBeCloseTo(Math.sqrt((20 ** 2 + 20 ** 2) / 5));
    });

    it('takes loudness and length from every note alike', () => {
        const left = leftIn(roll);
        expect(left.notes).toBe(5);
        expect(left.loud).toBeCloseTo(Math.sqrt((9 + 9 + 16) / 5));
        expect(left.length).toBeCloseTo(Math.sqrt((100 ** 2 + 100 ** 2 + 200 ** 2) / 5));
    });

    it('measures the notes it is given, and nothing where it is given none', () => {
        expect(leftIn(roll, ['a1', 'a2'])).toMatchObject({ notes: 2, pulse: 100, chords: 20 });
        expect(leftIn(roll, [])).toEqual({ notes: 0, pulse: 0, chords: 0, loud: 0, length: 0 });
    });
});

describe('measures', () => {
    it('names them as the expert knows them, and rounds them as it is shown them', () => {
        const left = { notes: 3, pulse: 12.345, chords: 0.049, loud: 1.2345, length: 99.5 };
        expect(measures(left)).toEqual({
            notes: 3,
            pulse_ms: 12.3,
            spread_ms: 0,
            velocity: 1.23,
            length_ms: 100,
        });
    });
});

describe('idsOf', () => {
    const about = (kind: 'piece' | 'span' | 'notes' | 'box' | 'arrow', notes: string[] = []) => ({
        kind,
        from: 0,
        to: 1440,
        notes,
    });

    it('names no note for the whole piece, which is every note', () => {
        expect(idsOf(about('piece'), roll)).toBeUndefined();
    });

    it('takes a passage and a direction by their ticks, the end excluded', () => {
        expect(idsOf(about('span'), roll)).toEqual(['a1', 'a2', 'b1', 'b2']);
        expect(idsOf(about('arrow', ['a1', 'b2']), roll)).toEqual(['a1', 'a2', 'b1', 'b2']);
    });

    it('takes a set and a box by the notes they name', () => {
        expect(idsOf(about('notes', ['a2']), roll)).toEqual(['a2']);
        expect(idsOf(about('box', ['a1', 'b1']), roll)).toEqual(['a1', 'b1']);
    });
});
