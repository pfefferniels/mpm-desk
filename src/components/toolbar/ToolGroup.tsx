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
 * `Ribbon` rendered a vertical `Divider` after its children, unconditionally, and that one choice
 * produced three separate defects. The last group in the bar drew a rule against nothing, so every
 * desk ended in a stray vertical tick. A group whose controls are all conditional — the
 * accentuation desk's are, every one of them — collapsed to an empty labelled box *plus* that
 * dangling rule, which is the state the bar sat in most of the time. And a group that wanted no
 * caption had to pass `title=' '` to fake one, because there was no way to say "no label" to
 * something that always rendered a label slot.
 *
 * A left border on every group but the first fixes all three by construction. Rules land strictly
 * *between* groups, so the last one has nothing after it to draw against; a group that renders
 * nothing takes its own rule away with it, because the rule is a property of the group and not of
 * the space beside it; and the caption becomes genuinely optional.
 *
 * It also survives the portal. Every desk reaches the bar through `createPortal`, so its groups are
 * nowhere near the app's own groups in the React tree — but a portalled node is a real DOM child of
 * the target, and CSS sibling selectors read the DOM. The rule therefore sees the app's groups and
 * the desk's groups as one row, which is what the eye sees too. `DeskToolbar.test.tsx` holds that
 * claim down: it asserts the groups land as direct, ordered siblings, and that a group toggled back
 * on is re-inserted *before* its neighbour rather than appended after it.
 *
 * `& + &` — a group directly after another group — rather than `:not(:first-child)`. `sx` replaces
 * `&` with the class Emotion generated for these styles, and every group serialises to the same
 * styles and so the same class, so the rule comes out as `.css-x + .css-x`. Three things follow.
 * It asks the question that is actually meant, where `:first-of-type` asks whether this is the
 * first `<div>` and stops being the same question the day a group renders as something else. It
 * says nothing about a group that merely happens to sit first, so the portal target may hold a
 * label or a spacer without the first group silently growing a rule against it — the fragility the
 * `:first-child` form would have carried. And it avoids Emotion's dev-only unsafe-selector alarm,
 * whose regex catches `:first-child` and `:nth-child` alike and would have printed a `console.error`
 * at startup and in every test that renders a group.
 *
 * ## Why it can render nothing
 *
 * `Children.toArray` drops `null`, `undefined` and booleans, so a group written entirely as
 * `{cond && <Button/>}` reports zero children when no condition holds and the whole group — rule,
 * caption and box — disappears.
 *
 * The limit worth knowing: this sees the *elements* it was handed, not what they render. A child
 * component that itself returns `null` still counts as a child here, and the group stays on screen
 * around it. A group whose emptiness is decided one level down has to hoist that decision to this
 * level — pass the condition in, rather than letting the child swallow it.
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
