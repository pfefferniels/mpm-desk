import type { Motivation, Segment } from "../model/Reconstruction";

/**
 * PROVISIONAL — placeholders, not the vocabulary.
 *
 * 95 of the 128 segments already carry the word for what they do, as free German
 * prose in `note`: „Abschattieren", „Hinspielen", „Hineinfallen", „Nachlauschen".
 * The other 33 have none, and these stand in for them until the real words are
 * chosen. They are the only thing `motivation` is still read for.
 *
 * Typed over {@link Motivation} so a new motivation cannot be added without a
 * word to say for it.
 */
const MOTIVATION_WORDS: Record<Motivation, string> = {
    intensify: "Intensivieren",
    move: "Bewegen",
    relax: "Zurücknehmen",
    calm: "Beruhigen",
};

/** For `unknown`, and for any word the corpus uses that the table has not met. */
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
    return segment.note?.trim()
        || MOTIVATION_WORDS[segment.motivation as Motivation]
        || UNNAMED;
}

/** How long this segment's word runs, in pixels along its own branch. */
export function wordWidth(segment: Segment, fontSize: number): number {
    return wordFor(segment).length * CHAR_WIDTH_RATIO * fontSize + TRAILING_SPACE;
}
