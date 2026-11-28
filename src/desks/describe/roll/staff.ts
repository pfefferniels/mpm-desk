/* Spelling and staff positions, for drawing pitches on a grand staff. */

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const NATURAL = [0, 2, 4, 5, 7, 9, 11];

/** The staff a note is written on. */
export type StaffName = 'treble' | 'bass';

/** A pitch as it is written: its letter, its alteration in semitones, and the MIDI number. */
interface Spelled {
    letter: string;
    alter: number;
    pitch: number;
}

/** A key signature: letter to alteration, for the altered letters only. */
export type Signature = ReadonlyMap<string, number>;

/** Staff positions (see `stepOf`) of the five lines of each staff, bottom line first. */
export const BASS: readonly number[] = [18, 20, 22, 24, 26];
export const TREBLE: readonly number[] = [30, 32, 34, 36, 38];

export const ACCIDENTAL: ReadonlyMap<number, string> = new Map([
    [-2, '𝄫'],
    [-1, '♭'],
    [0, '♮'],
    [1, '♯'],
    [2, '𝄪'],
]);

/** Where the accidentals of a key signature sit on the treble staff, in the order they are added. */
const FLATS = { letters: ['b', 'e', 'a', 'd', 'g', 'c', 'f'], treble: [34, 37, 33, 36, 32, 35, 31] };
const SHARPS = { letters: ['f', 'c', 'g', 'd', 'a', 'e', 'b'], treble: [38, 35, 39, 36, 33, 37, 34] };

/**
 * Staff position of a spelled pitch, in diatonic steps: middle C is 28, and every line of the
 * grand staff, ledger lines included, is an even number.
 *
 * @param spelled `pitch` is the MIDI number
 */
export const stepOf = ({ letter, alter, pitch }: Spelled): number =>
    (Math.floor((pitch - alter) / 12) - 1) * 7 + LETTERS.indexOf(letter);

/** The ledger lines a note at `step` needs on a staff, given the staff's five lines. */
export const ledgersOf = (step: number, staff: readonly number[]): number[] => {
    const lines: number[] = [];
    for (let line = staff[4] + 2; line <= step; line += 2) lines.push(line);
    for (let line = staff[0] - 2; line >= step; line -= 2) lines.push(line);
    return lines;
};

/**
 * The key signature, read off the notes: for each letter, the accidental most of its notes carry.
 *
 * @returns letter to alteration, for the altered letters only
 */
export const signatureOf = (spelled: readonly Pick<Spelled, 'letter' | 'alter'>[]): Map<string, number> => {
    const signature = new Map<string, number>();
    for (const letter of LETTERS) {
        const alters = spelled.filter((note) => note.letter === letter).map((note) => note.alter);
        const altered = alters.filter((alter) => alter !== 0);
        if (altered.length > alters.length * 0.6) signature.set(letter, Math.sign(altered[0]));
    }
    return signature;
};

/** The signature's accidentals as they are written on a staff: glyph and position, left to right. */
export const signatureMarks = (signature: Signature, staff: StaffName): { glyph: string; step: number }[] => {
    const flats = [...signature.values()].some((alter) => alter < 0);
    const { letters, treble } = flats ? FLATS : SHARPS;
    const glyph = ACCIDENTAL.get(flats ? -1 : 1) ?? '';
    const marks: { glyph: string; step: number }[] = [];
    for (const [index, letter] of letters.entries()) {
        if (!signature.has(letter)) break;
        marks.push({ glyph, step: treble[index] - (staff === 'bass' ? 14 : 0) });
    }
    return marks;
};

/** A spelling for a pitch that has none: a black key as a flat in a flat key, a sharp in a sharp one. */
export const spell = (pitch: number, signature: Signature): Spelled => {
    const sharps = [...signature.values()].some((alter) => alter > 0);
    const pitchClass = ((pitch % 12) + 12) % 12;
    const natural = NATURAL.indexOf(pitchClass);
    if (natural !== -1) return { letter: LETTERS[natural], alter: 0, pitch };
    const alter = sharps ? 1 : -1;
    return { letter: LETTERS[NATURAL.indexOf(pitchClass - alter)], alter, pitch };
};
