import { Box, Typography } from '@mui/material';
import { Children, type ReactNode } from 'react';

/**
 * The caption that names a run of controls.
 *
 * Ten point, uppercase, and the palette's most recessive grey, because it is a *signpost* and the
 * controls beside it are the content. `Ribbon` set it in body type and centred it above the row,
 * which cost two things at once: the row grew to the height of a caption plus a button, and at
 * body size the caption competed with the button labels for the same reading — a bar of six groups
 * read as twelve pieces of text with no hierarchy between them.
 *
 * Exported because `ToolField` needs the identical treatment for the name of a field. It is one
 * decision about what a label in this bar looks like, so it is one component; the alternative was
 * an `sx` object shared between two files, which the `react-refresh` rule would have flagged and
 * which invites a caller to spread it and change one property.
 */
export const ToolLabel = ({ children }: { children: ReactNode }) => (
    // The type is `theme.typography.overline`, which the theme sizes for a toolbar row and
    // documents there. What stays here is only what is true of this *position* rather than of
    // the type: it must not be selectable, must not wrap, and must not be shrunk by the flex row
    // it sits in.
    <Typography
        component='span'
        variant='overline'
        sx={{
            userSelect: 'none',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            mr: 0.25,
        }}
    >
        {children}
    </Typography>
);

interface ToolGroupProps {
    /** Omit for a run of controls that needs no name — a lone Play button, say. */
    label?: string;
    children: ReactNode;
}

/**
 * One run of related controls in the app bar, with the rule that separates it from the last one.
 *
 * ## The rule is a left border, not a trailing `Divider`
 *
 * A trailing divider makes the last group draw a rule against nothing, leaves an all-conditional
 * group as an empty box plus a dangling rule, and forces a group that wants no caption to fake
 * one with `title=' '`. A left border on every group but the first avoids all three: rules land
 * strictly *between* groups, a group that renders nothing takes its own rule with it, and the
 * caption is optional.
 *
 * It survives the portal, a portalled node being a real DOM child of the target and CSS sibling
 * selectors reading the DOM. `DeskToolbar.test.tsx` holds that down: the groups land as direct,
 * ordered siblings, and a group toggled back on is re-inserted *before* its neighbour.
 *
 * `& + &` rather than `:not(:first-child)`. `sx` replaces `&` with the class Emotion generated
 * for these styles and every group serialises to the same class, so the rule is `.css-x + .css-x`.
 * It asks the question meant, where `:first-of-type` asks whether this is the first `<div>`; it
 * says nothing about a group that merely sits first, so the portal target may hold a label or
 * spacer; and it avoids Emotion's dev-only unsafe-selector alarm, whose regex catches
 * `:first-child` and `:nth-child` alike.
 *
 * ## Why it can render nothing
 *
 * `Children.toArray` drops `null`, `undefined` and booleans, so a group written entirely as
 * `{cond && <Button/>}` disappears whole when no condition holds. It sees the *elements* it was
 * handed rather than what they render, so a child that returns `null` still counts: a group whose
 * emptiness is decided one level down has to hoist that decision here.
 */
export const ToolGroup = ({ label, children }: ToolGroupProps) => {
    if (Children.toArray(children).length === 0) return null;

    return (
        <Box
            role='group'
            // React omits the attribute entirely when this is undefined, which is what an
            // unlabelled group wants: a `role="group"` with no accessible name is valid, and is
            // read as plain grouping rather than as a group called "".
            aria-label={label}
            sx={{
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
                gap: 0.75,
                px: 1.25,
                '& + &': { borderLeft: 1, borderColor: 'divider' },
            }}
        >
            {label !== undefined && <ToolLabel>{label}</ToolLabel>}
            {children}
        </Box>
    );
};
