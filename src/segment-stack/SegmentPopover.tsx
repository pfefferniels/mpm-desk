import { Popper, Paper, Typography, Stack, Divider } from "@mui/material";
import type { Segment } from "../model/Reconstruction";
import { wordFor } from "./words";

interface SegmentPopoverProps {
    segments: Segment[];
    anchorEl: { getBoundingClientRect: () => DOMRect; contextElement?: Element };
}

/**
 * What an opened segment says, and how sure it is of saying it.
 *
 * The opened segment also lays its gestures out on the centre line, at the
 * piece's own scale, so this card is left to name the claim — hovering is what
 * asks for the inside of a segment, and that goes to `SegmentTimelinePopover`.
 *
 * Several are shown side by side when the playhead is inside more than one at
 * once — they argue one moment between them, so they read as one card with
 * dividers, and the word is what tells the columns apart.
 */
export const SegmentPopover = ({ segments, anchorEl }: SegmentPopoverProps) => (
    <Popper
        open
        anchorEl={anchorEl}
        placement="top"
        modifiers={[
            { name: "offset", options: { offset: [0, 8] } },
            { name: "preventOverflow", options: { padding: 8 } },
        ]}
        style={{ zIndex: 10 }}
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
