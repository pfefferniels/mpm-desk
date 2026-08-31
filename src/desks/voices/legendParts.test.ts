import { describe, expect, test } from 'vitest';
import { Alignment, type AlignedNote } from '../../fitting/alignment';
import { voicesOf } from '../../fitting/voices';
import { legendParts } from './legendParts';

const note = (id: string, staff: string, layer: string, part: number): AlignedNote => ({
    'xml:id': id,
    part,
    staff,
    layer,
    date: 0,
    duration: 720,
    pitchname: 'c',
    accidentals: 0,
    octave: 4,
    'midi.pitch': 60,
    velocity: 64,
    'milliseconds.date': 0,
    'milliseconds.date.end': 500,
});

/** Two voices on one staff and one on another, as a conversion with no layout leaves them. */
const asConverted = () =>
    new Alignment([
        note('a1', '1', '1', 1),
        note('a2', '1', '1', 1),
        note('b1', '1', '2', 1),
        note('b2', '1', '2', 1),
        note('c1', '2', '1', 2),
    ]);

const rows = (msm: Alignment, names = new Map<number, string>()) =>
    legendParts(msm, voicesOf(msm), names).map((part) => ({
        number: part.number,
        name: part.name,
        voices: part.voices.map((voice) => voice.key),
    }));

describe('legendParts', () => {
    test('groups the voices of a converted score by the part they are in', () => {
        expect(rows(asConverted())).toEqual([
            { number: 1, name: '', voices: ['1/1', '1/2'] },
            { number: 2, name: '', voices: ['2/1'] },
        ]);
    });

    test('shows the part a move made, which no voice belongs to', () => {
        // The gesture this exists for: some notes picked in the score and sent to a new part. It
        // is in no layout and no voice as a whole is in it, so a legend grouping voices reported
        // nothing at all — the score repainted and the panel said the part did not exist.
        const moved = asConverted();
        moved.allNotes = moved.allNotes.map((n) =>
            n['xml:id'] === 'b1' ? { ...n, part: 3 } : n,
        );

        expect(rows(moved, new Map([[3, 'Inner voice']]))).toEqual([
            { number: 1, name: '', voices: ['1/1', '1/2'] },
            { number: 2, name: '', voices: ['2/1'] },
            { number: 3, name: 'Inner voice', voices: [] },
        ]);
    });

    test('lists a voice under the part it went to, once all of it has moved', () => {
        const moved = asConverted();
        moved.allNotes = moved.allNotes.map((n) =>
            n.staff === '1' && n.layer === '2' ? { ...n, part: 3 } : n,
        );

        expect(rows(moved)).toEqual([
            { number: 1, name: '', voices: ['1/1'] },
            { number: 2, name: '', voices: ['2/1'] },
            { number: 3, name: '', voices: ['1/2'] },
        ]);
    });

    test('leaves out a part the layout names but nothing is in', () => {
        expect(rows(asConverted(), new Map([[4, 'Continuo']])).map((part) => part.number)).toEqual([
            1, 2,
        ]);
    });
});
