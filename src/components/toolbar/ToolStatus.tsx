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
 * A label sizes a button, so a count written into one (`Merge (9)` becoming `Merge (10)`) moves
 * that button's right edge and everything after it. The numbers change while the user drags on
 * the plot beside them, so the button they are selecting *for* slides away under the cursor.
 *
 * Moving the number out is half of it. `minWidth` stops the readout resizing when a digit is
 * added, and `fontVariantNumeric: tabular-nums` stops it jittering when a `1` becomes an `8`,
 * proportional digits differing in width. Neither alone is enough.
 *
 * ## `aria-hidden`, always
 *
 * These update on every frame of a drag, so left visible to assistive technology they are a
 * stream of interruptions that drowns the control being operated. The information belongs in the
 * tooltip of the button the count is about, read on demand and phrased as a sentence ("merge the
 * 3 selected segments") rather than shouted as a bare number.
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
