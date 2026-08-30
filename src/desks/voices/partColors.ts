/**
 * One colour per part.
 *
 * At most six parts can be wanted — the score has six voices, and combining only ever reduces —
 * plus a seventh state for a note in no part at all. Every one has to read as a small filled glyph
 * on white, which rules out most categorical palettes: Okabe–Ito's yellow is 1.1:1 on white and
 * invisible at notehead size, and its orange and sky blue are 2.25 and 2.31, both under the 3:1
 * threshold for non-text. `partColors.test.ts` computes the ratios rather than trusting this note.
 *
 * Ordered so the strongest separations are spent first: after combining, two to four parts is the
 * realistic count. Six categorical hues cannot all be pairwise safe under deuteranopia, so hue is
 * never the only channel — the legend states each part's voices in words, and hovering a row dims
 * every other part.
 */
export const PART_COLORS = [
    '#0072b2', // blue
    '#d55e00', // vermillion
    '#009e73', // bluish green
    '#b85c93', // reddish purple
    '#b07c00', // orange, darkened until it clears 3:1
    '#6b7280', // the theme's own gray — told apart by saturation rather than by hue
] as const;

/**
 * A note in no part: a tie continuation, or a grace note the conversion emits nothing for.
 *
 * Neither is an error and neither can be moved, so it is drawn as the ink a score is normally
 * printed in rather than as a seventh category.
 */
export const UNASSIGNED = '#9ca3af';

/** The colour of a part, by the 1-based number it carries. */
export const colorForPart = (part: number): string =>
    PART_COLORS[(part - 1) % PART_COLORS.length]!;
