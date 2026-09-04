import { createTheme } from '@mui/material/styles';

/**
 * The chrome's palette, which the chrome already had.
 *
 * Nothing here is a new colour: every value is one already written by hand under `src/` —
 * `#e5e7eb` on ten borders, `#111827` on nine bits of primary text, `#6b7280` on eight bits of
 * secondary. Collected here so that `sx={{ color: 'text.secondary' }}` and a raw
 * `style={{ color: '#6b7280' }}` beside it mean one colour, rather than the first resolving
 * against an unconfigured theme to MUI's `rgba(0,0,0,0.6)`. Every hand-written literal that stays
 * behind still matches.
 *
 * **`src/segment-stack/spanColors.ts` is deliberately not here.** That is a categorical data
 * palette — MPM element type to hue — and it belongs to the drawings, not to the chrome. Folding
 * it into `palette` would invite `sx` to reach for a tempo green as if it were a UI accent, and
 * would tie the meaning of a lane's colour to a decision about buttons.
 *
 * **White and neutral gray, deliberately.** The desks plot data on white: a tinted ground is not a
 * neutral choice about taste, it shifts every plotted colour sitting on it, and the residuals and
 * span hues are read against each other.
 */
const gray = {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    700: '#374151',
    900: '#111827',
};

export const theme = createTheme({
    palette: {
        mode: 'light',
        /**
         * Near-black, not MUI blue. `#1976d2` appears in exactly zero hand-written styles in this
         * repo — the editor's own emphasis has always been `#111827` — and white on that blue is
         * 4.60:1 where white on near-black is 17.74:1.
         *
         * `light` is load-bearing rather than decorative. Left unset, MUI derives the hover shades
         * itself: `darken(main, .2)` for a near-black main is `#0e131f`, which is 1.04:1 against
         * `main`, so a contained button — with `disableElevation` below removing the shadow that
         * would otherwise say something happened — would have no visible hover state at all.
         * `containedPrimary` below hovers *up* into this `light` instead of down into nothing.
         */
        primary: {
            main: gray[900],
            light: gray[700],
            dark: '#000000',
            contrastText: '#ffffff',
        },
        // The "needs attention" amber the app already speaks: the overwritten-instruction count
        // (`SegmentRow.tsx`), the unassigned banner (`NarrativeDesk.tsx`), the chips that carry a
        // warning (`InstructionChips.tsx`) and the same in `App.tsx` all say `#b45309` by hand.
        warning: {
            main: '#b45309',
            contrastText: '#ffffff',
        },
        background: {
            default: '#ffffff',
            paper: '#ffffff',
        },
        divider: gray[200],
        text: {
            primary: gray[900],
            secondary: gray[500],
            disabled: gray[400],
        },
        /**
         * Only `hover`, because its reach is narrower than the name suggests. `ListItemButton`,
         * `MenuItem` and `TableRow` read `action.hover`; `Button`, `IconButton` and `ToggleButton`
         * ignore it and compute `alpha(text.primary, .04)` for themselves. Over white that comes
         * out at `#f6f6f6` against this `#f3f4f6` — indistinguishable — so overriding the rest of
         * `action` would be configuration that changes nothing anybody can see.
         */
        action: {
            hover: gray[100],
        },
    },
    // 6, not MUI's 4: the narrative desk's own controls already round at 6, and the desks are
    // where most of the app's surface is.
    shape: {
        borderRadius: 6,
    },
    typography: {
        // Exactly what the `:root` rule in the deleted `index.css` said. Stated here because the
        // theme is now the one place the app's type is decided.
        fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif',
        /**
         * No shouting on the controls. One line, and it covers `ToggleButton` as well as `Button`
         * because both read `typography.button`.
         *
         * Deliberate rather than a default being tidied away: the tool-group labels carry the
         * uppercase now, and two levels of uppercase in one 44px row is one too many — the eye
         * loses which of them is the heading.
         */
        button: {
            textTransform: 'none',
        },
        /**
         * The caption that names a run of toolbar controls — `ToolLabel`, and nothing else.
         *
         * `overline` is reused rather than a variant of our own being added, because a new variant
         * name costs two module-augmentation blocks — `TypographyPropsVariantOverrides` and
         * `TypographyVariants`/`TypographyVariantsOptions` — plus a `variantMapping` entry, for a
         * name nothing else in the app would ever ask for.
         *
         * The values are sized for a 44px toolbar row rather than for running text, which is what
         * MUI's own `overline` assumes: ten point against eleven, and `lineHeight: 1` because the
         * caption sits *beside* its controls on one line and any leading pushes the row taller.
         * `text.disabled` and not `text.secondary` — a signpost should sit below the labels it
         * points at, and the controls are the content.
         */
        overline: {
            display: 'inline',
            fontSize: 10,
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: gray[400],
        },
    },
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                /**
                 * The two rules from `index.css` that `CssBaseline` does not already cover, and
                 * that are not decoration.
                 *
                 * `font-synthesis: none` because two of the app's faces cannot be synthesised
                 * over: Bravura Text ships a single weight, and EB Garamond's 600 is a real
                 * SemiBold file — a browser faking either one puts a smeared approximation next to
                 * the genuine article on the same line.
                 */
                html: {
                    fontSynthesis: 'none',
                    textRendering: 'optimizeLegibility',
                },
                /**
                 * The one behaviour of the deleted global `button {}` rule that no inline style
                 * replaces. The narrative desk's raw `<button>`s set their colour, border, radius
                 * and padding but never their font, and its filter `<input>` renders in the UA
                 * font today; without this they would fall back to the platform form font while
                 * everything around them is Inter.
                 */
                'button, input, optgroup, select, textarea': {
                    fontFamily: 'inherit',
                },
            },
        },
        MuiButton: {
            defaultProps: {
                size: 'small',
                disableElevation: true,
            },
            styleOverrides: {
                // An outlined button is a neutral one here: near-black label on a divider-grey
                // rule, rather than MUI's tinted-by-primary border.
                outlinedPrimary: ({ theme }) => ({
                    color: theme.palette.text.primary,
                    borderColor: theme.palette.divider,
                    '&:hover': {
                        borderColor: theme.palette.text.disabled,
                        backgroundColor: theme.palette.action.hover,
                    },
                }),
                // See `palette.primary`: hover goes up into `light`, because down is invisible.
                // The `hover: none` guard keeps a touch device from being left in the hover shade
                // after a tap, which reads as a stuck selection.
                containedPrimary: ({ theme }) => ({
                    '&:hover': {
                        backgroundColor: theme.palette.primary.light,
                        '@media (hover: none)': {
                            backgroundColor: theme.palette.primary.main,
                        },
                    },
                }),
            },
        },
        MuiIconButton: {
            defaultProps: {
                size: 'small',
            },
        },
        // Both, and not just the group: `TempoDesk` uses standalone `ToggleButton`s outside any
        // `ToggleButtonGroup`, so a default set only on the group would miss them.
        MuiToggleButton: {
            defaultProps: {
                size: 'small',
            },
        },
        MuiToggleButtonGroup: {
            defaultProps: {
                size: 'small',
            },
        },
        MuiTooltip: {
            defaultProps: {
                arrow: true,
            },
        },
    },
});
