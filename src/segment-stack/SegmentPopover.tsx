import { Popper, Paper, Typography, Stack, Divider } from "@mui/material";
import type { Segment } from "../model/Reconstruction";
import { wordFor } from "./words";

interface SegmentPopoverProps {
    segments: Segment[];
    anchorEl: { getBoundingClientRect: () => DOMRect; contextElement?: Element };
    /** Follows the pointer around on hover, so it must not swallow events. */
    transient?: boolean;
}

/**
 * What a segment says, and how sure it is of saying it.
 *
 * This is where the word goes when the box is too narrow to hold it, which at
 * most zooms is most of them — so it says the same thing the box would, rather
 * than naming the motivation the box no longer speaks in.
 *
 * Several are shown side by side when a chain is open — the members argue one
 * gesture between them, so they read as one card with dividers.
 */
export const SegmentPopover = ({ segments, anchorEl, transient }: SegmentPopoverProps) => (
    <Popper
        open
        anchorEl={anchorEl}
        placement="top"
        modifiers={[
            { name: "offset", options: { offset: [0, 8] } },
            { name: "preventOverflow", options: { padding: 8 } },
        ]}
        style={{ zIndex: 10, pointerEvents: transient ? "none" : undefined }}
    >
        <Paper elevation={4} sx={{ borderRadius: 2, p: 1.5 }}>
            <Stack direction="row" divider={<Divider orientation="vertical" flexItem />} spacing={1.5}>
                {segments.map(segment => (
                    <div key={segment.id} style={{ maxWidth: 300 }}>
                        <Typography variant="subtitle2">
                            {wordFor(segment)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {segment.certainty}
                        </Typography>
                    </div>
                ))}
            </Stack>
        </Paper>
    </Popper>
);
