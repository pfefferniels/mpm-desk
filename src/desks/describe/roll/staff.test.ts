import { describe, expect, it } from 'vitest';
import { ACCIDENTAL, BASS, TREBLE, ledgersOf, signatureMarks, signatureOf, spell, stepOf } from './staff';

/** A natural, by letter and MIDI pitch. */
const natural = (letter: string, pitch: number) => ({ letter, alter: 0, pitch });

describe('stepOf', () => {
    it('puts middle C at 28, between the two staves', () => {
        expect(stepOf(natural('c', 60))).toBe(28);
        expect(stepOf(natural('c', 60))).toBe(TREBLE[0] - 2);
        expect(stepOf(natural('c', 60))).toBe(BASS[4] + 2);
    });

    it('puts the lines of the treble staff on E G B D F', () => {
        const lines = [natural('e', 64), natural('g', 67), natural('b', 71), natural('d', 74), natural('f', 77)];
        expect(lines.map(stepOf)).toEqual(TREBLE);
    });

    it('puts the lines of the bass staff on G B D F A', () => {
        const lines = [natural('g', 43), natural('b', 47), natural('d', 50), natural('f', 53), natural('a', 57)];
        expect(lines.map(stepOf)).toEqual(BASS);
    });

    it('puts the spaces between them, on odd numbers', () => {
        // F A C E, the spaces of the treble staff
        expect([natural('f', 65), natural('a', 69), natural('c', 72), natural('e', 76)].map(stepOf)).toEqual([31, 33, 35, 37]);
    });

    it('goes by the letter, not by the key that is struck', () => {
        // The same key, written three ways, sits in three places.
        expect(stepOf({ letter: 'c', alter: 1, pitch: 61 })).toBe(28);
        expect(stepOf({ letter: 'd', alter: -1, pitch: 61 })).toBe(29);
        expect(stepOf({ letter: 'b', alter: 2, pitch: 61 })).toBe(27);
    });

    it('keeps a note in its own octave when its accidental takes it across a C', () => {
        // C flat is the key of B, and still written on C; B sharp is the key of C, and still on B.
        expect(stepOf({ letter: 'c', alter: -1, pitch: 59 })).toBe(28);
        expect(stepOf({ letter: 'b', alter: 1, pitch: 60 })).toBe(27);
    });

    it('moves seven positions with every octave', () => {
        expect(stepOf(natural('a', 81)) - stepOf(natural('a', 69))).toBe(7);
        expect(stepOf(natural('a', 21))).toBe(5);
    });
});

describe('ledgersOf', () => {
    it('needs none for a note on the staff, or in the space next to it', () => {
        for (const step of [29, 30, 34, 38, 39]) expect(ledgersOf(step, TREBLE)).toEqual([]);
        for (const step of [17, 18, 22, 26, 27]) expect(ledgersOf(step, BASS)).toEqual([]);
    });

    it('gives middle C its one line, under the treble staff and over the bass', () => {
        expect(ledgersOf(28, TREBLE)).toEqual([28]);
        expect(ledgersOf(28, BASS)).toEqual([28]);
    });

    it('counts outwards from the staff to the note', () => {
        // A5 is on the first line above, B5 in the space over it, C6 on the second.
        expect(ledgersOf(40, TREBLE)).toEqual([40]);
        expect(ledgersOf(41, TREBLE)).toEqual([40]);
        expect(ledgersOf(42, TREBLE)).toEqual([40, 42]);
        // F3 written on the treble staff hangs three lines under it.
        expect(ledgersOf(24, TREBLE)).toEqual([28, 26, 24]);
        // E2 is on the first line under the bass staff, C2 on the second.
        expect(ledgersOf(16, BASS)).toEqual([16]);
        expect(ledgersOf(14, BASS)).toEqual([16, 14]);
    });
});

describe('signatureOf', () => {
    const notes = (letter: string, alters: number[]) => alters.map((alter) => ({ letter, alter }));

    it('reads the flats and sharps most notes of a letter carry', () => {
        const signature = signatureOf([...notes('b', [-1, -1, -1, 0]), ...notes('e', [-1, -1]), ...notes('f', [0, 0, 0])]);
        expect([...signature]).toEqual([
            ['e', -1],
            ['b', -1],
        ]);
    });

    it('leaves out a letter that is only altered now and then', () => {
        expect(signatureOf(notes('f', [1, 0, 0, 1, 0])).size).toBe(0);
        expect(signatureOf(notes('f', [1, 1, 0, 1, 1])).get('f')).toBe(1);
    });

    it('takes a double accidental for the single one of the signature', () => {
        expect(signatureOf(notes('f', [2, 2])).get('f')).toBe(1);
    });

    it('is empty for no notes at all', () => {
        expect(signatureOf([]).size).toBe(0);
    });
});

describe('signatureMarks', () => {
    it('writes one flat on the middle line of the treble staff and the second line of the bass', () => {
        const signature = new Map([['b', -1]]);
        expect(signatureMarks(signature, 'treble')).toEqual([{ glyph: '♭', step: 34 }]);
        expect(signatureMarks(signature, 'bass')).toEqual([{ glyph: '♭', step: 20 }]);
    });

    it('writes sharps in their own order, from F on the top line', () => {
        const signature = new Map([
            ['c', 1],
            ['f', 1],
            ['g', 1],
        ]);
        expect(signatureMarks(signature, 'treble').map((mark) => mark.step)).toEqual([38, 35, 39]);
        expect(signatureMarks(signature, 'bass').map((mark) => mark.step)).toEqual([24, 21, 25]);
        expect(signatureMarks(signature, 'treble').every((mark) => mark.glyph === '♯')).toBe(true);
    });

    it('stops at the first accidental the signature lacks', () => {
        // E flat without B flat is no key signature: nothing can be written in order.
        expect(signatureMarks(new Map([['e', -1]]), 'treble')).toEqual([]);
    });

    it('writes nothing for no signature', () => {
        expect(signatureMarks(new Map(), 'treble')).toEqual([]);
    });
});

describe('spell', () => {
    it('leaves a white key as it is', () => {
        expect(spell(60, new Map())).toEqual({ letter: 'c', alter: 0, pitch: 60 });
        expect(spell(71, new Map([['f', 1]]))).toEqual({ letter: 'b', alter: 0, pitch: 71 });
    });

    it('writes a black key as a flat in a flat key and where there is no key', () => {
        expect(spell(46, new Map([['b', -1]]))).toEqual({ letter: 'b', alter: -1, pitch: 46 });
        expect(spell(61, new Map())).toEqual({ letter: 'd', alter: -1, pitch: 61 });
    });

    it('writes it as a sharp in a sharp key', () => {
        expect(spell(66, new Map([['f', 1]]))).toEqual({ letter: 'f', alter: 1, pitch: 66 });
        expect(spell(61, new Map([['f', 1]]))).toEqual({ letter: 'c', alter: 1, pitch: 61 });
    });

    it('gives a spelling that sits where the pitch does', () => {
        for (let pitch = 21; pitch <= 108; pitch++) {
            const spelled = spell(pitch, new Map());
            expect(spelled.pitch).toBe(pitch);
            expect(stepOf(spelled)).toBeGreaterThanOrEqual(stepOf(spell(pitch - 1, new Map())));
        }
    });
});

describe('ACCIDENTAL', () => {
    it('has a sign for every alteration from two flats to two sharps', () => {
        expect([-2, -1, 0, 1, 2].map((alter) => ACCIDENTAL.get(alter))).toEqual(['𝄫', '♭', '♮', '♯', '𝄪']);
    });
});
