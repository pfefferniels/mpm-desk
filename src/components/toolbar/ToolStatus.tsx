import { Typography } from '@mui/material';
import type { ReactNode } from 'react';

interface ToolStatusProps {
    /**
     * How wide to hold the readout, in pixels. Size it for the widest value it will ever show, not
     * for the value it shows now — see below; this is the prop that does the work.
     */
    width: number;
    tone?: 'default' | 'warning';
    children: ReactNode;
}

/**
 * A live number beside a button, rather than inside its label.
 *
 * ## What this is for
 *
 * Every count in the bar is currently written into the label of the button it belongs to: `Make
 * Choice (12)`, `Modify +3`, `Merge (3)`. A label is what sizes a button, so each of those buttons
 * changes width as its number changes — and the numbers change while the user is dragging on the
 * plot beside them, meaning the button reflows under a cursor that is on its way to it. `Merge (9)`
 * becoming `Merge (10)` moves the button's right edge and everything after it in the row. The state
 * where this matters most is the one where the count is climbing because the user is selecting, and
 * the button they are selecting *for* is the one sliding away.
 *
 * Moving the number out is only half of it. `minWidth` is what stops the readout itself from
 * resizing when a digit is added, and `fontVariantNumeric: tabular-nums` is what stops it jittering
 * when a `1` becomes an `8` — proportional digits differ in width, so a counter that ticks up
 * shivers even at a fixed total width. Together they mean nothing in the row moves while a value
 * changes. Neither alone is enough.
 *
 * ## `aria-hidden`, always
 *
 * These update on every frame of a drag. Left visible to assistive technology they would be a
 * stream of interruptions saying nothing a screen-reader user can act on, and they would drown the
 * control the user is actually operating. The information is not lost: it belongs in the tooltip of
 * the button the count is about, which is read on demand and phrased as a sentence — "merge the 3
 * selected segments" — rather than shouted as a bare number.
 */
export const ToolStatus = ({ width, tone = 'default', children }: ToolStatusProps) => (
    <Typography
        variant='caption'
        aria-hidden
        sx={{
            minWidth: width,
            flexShrink: 0,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: tone === 'warning' ? 'warning.main' : 'text.secondary',
        }}
    >
        {children}
    </Typography>
);
