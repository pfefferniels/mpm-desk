import { clamp } from './geometry';

/**
 * The clefs and accidentals, as Bravura Text holds them.
 *
 * Bravura Text is the SMuFL font the Desk ships, in the form meant for running text. Its glyphs
 * at the SMuFL code points are registered against a staff, not each against its own line, and
 * that staff is what all the numbers here are read off (measured in the browser, and stated here
 * so that nothing has to be measured again):
 *
 * - the bottom line of the staff is the baseline, and its five lines span 0.8 em: **one em is
 *   five staff spaces**, ten staff positions;
 * - a clef stands where it stands on that staff, the G clef curled round the second line and the
 *   F clef with its dots either side of the fourth, so a clef set with its baseline on a staff's
 *   bottom line and an em of ten rows is on its line;
 * - an accidental is centred on the middle line, two spaces up.
 *
 * The Unicode musical symbols of the same font are drawn for text instead, larger and each on a
 * baseline of its own, which is why the roll does not use them.
 */
export const MUSIC_FONT = "'Bravura Text'";

export const G_CLEF = '';
export const F_CLEF = '';

/** Alteration in semitones to the accidental that writes it. */
export const ACCIDENTAL_GLYPH: ReadonlyMap<number, string> = new Map([
    [-2, ''],
    [-1, ''],
    [0, ''],
    [1, ''],
    [2, ''],
]);

/** Staff positions in an em: five spaces, each two positions. */
const ROWS_PER_EM = 10;
/** How far above the baseline the line or space an accidental is on runs, in em. */
const ACCIDENTAL_RISE = 0.4;

/** The font size at which a clef fits a staff whose positions are `rowHeight` apart. */
export const clefSize = (rowHeight: number): number => rowHeight * ROWS_PER_EM;

/**
 * The font size of an accidental.
 *
 * Under half the size the staff would ask for: a note here is a box a good half of a notehead
 * tall, and its accidental is drawn to go with the box. Never too small to be told a sharp from
 * a natural.
 */
export const accidentalSize = (rowHeight: number): number => clamp(rowHeight * 4.2, 20, 36);

/** The baseline that puts an accidental of `size` on the line or space at `y`. */
export const accidentalBaseline = (y: number, size: number): number => y + ACCIDENTAL_RISE * size;
