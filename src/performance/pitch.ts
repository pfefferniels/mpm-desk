/**
 * The MIDI pitch of a notated note. Used both when reading the score out of the
 * MEI and when reading it back out of the rendered SVG.
 */
const PITCH_CLASS: Record<string, number> = {
    c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
};

const ACCIDENTAL: Record<string, number> = {
    n: 0, f: -1, s: 1, ff: -2, ss: 2, x: 2, xs: 3, ts: 3, tf: -3,
};

export function midiPitch(
    pname: string | null | undefined,
    oct: string | number | null | undefined,
    accid?: string | null
): number | undefined {
    if (!pname || oct === null || oct === undefined || oct === "") return undefined;

    const pitchClass = PITCH_CLASS[pname.toLowerCase()];
    if (pitchClass === undefined) return undefined;

    const octave = typeof oct === "number" ? oct : parseInt(oct, 10);
    if (Number.isNaN(octave)) return undefined;

    return (octave + 1) * 12 + pitchClass + (accid ? (ACCIDENTAL[accid] ?? 0) : 0);
}

/**
 * One name per pitch class, for naming a MIDI pitch that has no notation behind
 * it - a performed note nothing in the score was matched to. Where the score
 * does say how a note is written, ./spellPitch reads that instead.
 */
const PITCH_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

/** A MIDI pitch as a reader would say it, e.g. 60 as "C4" */
export function pitchName(pitch: number): string {
    return `${PITCH_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}
