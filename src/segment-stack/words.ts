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

/** The tree is set in the same serif the title uses. */
export const WORD_FONT_FAMILY = '"Times New Roman", Times, serif';

/**
 * Estimated advance width per character, as a fraction of the font size.
 *
 * Tuned to {@link WORD_FONT_FAMILY} — Times sets a good deal narrower than a
 * sans would, so this dropped when the tree changed face. Deliberately generous:
 * measured against `getComputedTextLength` over every word in the corpus it
 * never under-estimates, and for packing an over-estimate only ever leaves
 * branches further apart than they had to be.
 */
export const CHAR_WIDTH_RATIO = 0.48;
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
