import { useTheme } from '@mui/material/styles';

/**
 * The roll's colours and type.
 *
 * Two kinds, kept apart as `theme.ts` keeps them apart. What frames the drawing, its paper, its
 * ink, its rules, is the Desk's chrome and is asked of the theme. What the drawing *means* by a
 * colour, this hand or that, a grace note, a tempo that is described, is a data palette of the
 * roll's own, as the markup desk's type colours are of that desk, and is stated here.
 */

// The hands, a grace note, and what on the ruler has a tempo of its own: the prototype's hues.
export const RIGHT_HAND = '#2c47cf';
export const LEFT_HAND = '#bf5412';
export const GRACE = '#7a3fb0';
/** Also the badge of a remark the expert asks back about: both say that something was understood. */
export const DESCRIBED = '#0b7566';

/** Remarks are written in the serif the Desk sets a title in. It ships one weight, and its italic. */
export const WORDS_FAMILY = '"EB Garamond", Garamond, "Times New Roman", serif';
export const WORDS_SIZE = 16;
/** As CSS states a font, for measuring the words before they are drawn. */
export const WORDS_FONT = `${String(WORDS_SIZE)}px ${WORDS_FAMILY}`;

/** The theme's tokens, under the names the drawing has for them. */
export interface Tones {
    paper: string;
    ink: string;
    /** The second ink: bar lines, clefs, ledger lines, and the shadows. */
    soft: string;
    /** The third: staff lines, whatever is only assumed, a remark that is set aside. */
    faint: string;
    rule: string;
    /** What the reader's marks are drawn in. */
    pencil: string;
    /** A remark that could not be carried out, and how far a note is from where it was played. */
    trouble: string;
    /** The Desk's own face, for numbers and names. */
    type: string | undefined;
}

export const useTones = (): Tones => {
    const { palette, typography } = useTheme();
    return {
        paper: palette.background.paper,
        ink: palette.text.primary,
        soft: palette.text.secondary,
        faint: palette.text.disabled,
        rule: palette.divider,
        pencil: palette.primary.light,
        trouble: palette.error.main,
        type: typography.fontFamily,
    };
};
