/**
 * What a played key is called in the score: its letter, its accidental and its octave.
 *
 * A MIDI recording knows 61; the notation needs to know whether that is a C sharp or a D flat.
 * The general problem has good solutions, Meredith's ps13 (2006) the best known, and none of
 * them is needed here, because they all work out a tonal context that this score already
 * states. A note the performer added is spelled the way the bars around it spell that pitch,
 * and where they do not have it, as the spelling nearest to theirs on the line of fifths, which
 * is the principle of Temperley (2001) with the hard part given.
 */

import type { WrittenNote } from "./scoreModel";

export interface Spelling {
    /** The letter, lower case */
    pname: string;
    /** The octave it is written in, middle C being c4 */
    oct: number;
    /** Semitones the letter is altered by: -1 a flat, 1 a sharp */
    alter: number;
}

const LETTERS = ["c", "d", "e", "f", "g", "a", "b"];
const NATURAL: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** Where a letter stands on the line of fifths, F at -1 and C at 0; an accidental moves it seven. */
const FIFTHS: Record<string, number> = { f: -1, c: 0, g: 1, d: 2, a: 3, e: 4, b: 5 };

const fifthsOf = (pname: string, alter: number): number => (FIFTHS[pname] ?? 0) + 7 * alter;

/** The octave a spelling has to be written in to sound at a pitch. */
const octaveFor = (pitch: number, pname: string, alter: number): number =>
    Math.round((pitch - alter - (NATURAL[pname] ?? 0)) / 12) - 1;

interface SpellingContext {
    /** What the key signature alters on the staff the note goes on, by letter: "s" or "f" */
    key: ReadonlyMap<string, string>;
    /** The written notes around it, the nearest in time first */
    around: readonly WrittenNote[];
}

/**
 * Spell one pitch.
 *
 * Three rules, in order. The score's own spelling of that pitch class nearby wins outright: an
 * added octave is the note it doubles, and a chromatic passing note that the left hand writes
 * as F sharp is not a G flat in the right. Failing that, a pitch the key signature has is
 * spelled as the key spells it. Failing that, the spelling that lies nearest the notes around
 * it on the line of fifths, which is what makes the leading note of a dominant a sharp in a
 * flat key.
 */
export function spell(pitch: number, context: SpellingContext): Spelling {
    const pc = ((pitch % 12) + 12) % 12;

    for (const note of context.around) {
        if ((((note.pitch % 12) + 12) % 12) === pc && Math.abs(note.alter) <= 2) {
            return { pname: note.pname, alter: note.alter, oct: octaveFor(pitch, note.pname, note.alter) };
        }
    }

    const candidates: { pname: string; alter: number }[] = [];
    for (const pname of LETTERS) {
        for (const alter of [-1, 0, 1]) {
            if ((((NATURAL[pname] + alter) % 12) + 12) % 12 === pc) candidates.push({ pname, alter });
        }
    }

    const inKey = candidates.find(
        ({ pname, alter }) => alter === (context.key.get(pname) === "s" ? 1 : context.key.get(pname) === "f" ? -1 : 0),
    );
    if (inKey) return { ...inKey, oct: octaveFor(pitch, inKey.pname, inKey.alter) };

    const centre = centreOf(context);
    let best = candidates[0];
    let bestDistance = Infinity;
    for (const candidate of candidates) {
        const distance = Math.abs(fifthsOf(candidate.pname, candidate.alter) - centre);
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }
    return { ...best, oct: octaveFor(pitch, best.pname, best.alter) };
}

/**
 * Where the music around a note sits on the line of fifths.
 *
 * The mean of the notes written nearby, and where there are none, the middle of the scale the
 * key signature gives: a signature of n sharps is the seven fifths from n - 1 to n + 5.
 */
function centreOf(context: SpellingContext): number {
    if (context.around.length > 0) {
        let sum = 0;
        for (const note of context.around) sum += fifthsOf(note.pname, note.alter);
        return sum / context.around.length;
    }

    let signature = 0;
    for (const accidental of context.key.values()) signature += accidental === "s" ? 1 : accidental === "f" ? -1 : 0;
    return signature + 2;
}

/** The MEI value for an alteration: what `@accid` and `@accid.ges` take. */
export function accidentalOf(alter: number): string {
    return alter === 0 ? "n" : alter === 1 ? "s" : alter === -1 ? "f" : alter === 2 ? "x" : alter === -2 ? "ff" : "n";
}
