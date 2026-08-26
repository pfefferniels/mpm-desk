import type { Segment } from "../model/Reconstruction";

/**
 * What a segment says when it says nothing.
 *
 * An unnamed segment is drawn as unnamed. There is no placeholder vocabulary behind this on
 * purpose: a stand-in that reads like a real word cannot be told from one on the branch, so a
 * blank is the more honest drawing.
 */
const UNNAMED = "Unbestimmt";


/** The tree is set in the same serif the title uses; see `index.css` for the faces. */
export const WORD_FONT_FAMILY = '"EB Garamond", Garamond, "Times New Roman", serif';

/**
 * Estimated advance width per character, as a fraction of the font size.
 *
 * Tuned to {@link WORD_FONT_FAMILY} by measuring `getComputedTextLength` over
 * every word in the corpus: one ratio has to cover the widest of them, or two
 * words touch, so this sits just above the worst case — „Zurücknehmen", at
 * 0.4723.
 *
 * It is worth knowing what that costs. Garamond's *median* word needs only
 * 0.425, so a single ratio carries about a fifth more branch than the writing
 * actually fills, and the packer holds every branch that much further from its
 * neighbours than it had to. Measuring each word once at load would recover it,
 * at the price of putting DOM metrics under the layout model.
 */
export const CHAR_WIDTH_RATIO = 0.475;
const TRAILING_SPACE = 6;

/** What a segment says, in as many words as it takes. */
export function wordFor(segment: Segment): string {
    return segment.note?.trim() || UNNAMED;
}

/** How long this segment's word runs, in pixels along its own branch. */
export function wordWidth(segment: Segment, fontSize: number): number {
    return wordFor(segment).length * CHAR_WIDTH_RATIO * fontSize + TRAILING_SPACE;
}
