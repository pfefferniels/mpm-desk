import { useMemo } from "react";
import { Divider, Paper, Popper, Stack, type PopperPlacementType } from "@mui/material";
import type { Segment } from "../model/Reconstruction";
import { beatGrid, tickRange, timelineRows } from "./StackModel";
import { getLaneColor } from "./spanColors";
import { wordFor } from "./words";

/** Wide enough for `accentuationPattern`, the longest type name in the corpus. */
const TYPE_COLUMN = 110;
const TRACK_WIDTH = 180;
const ROW_HEIGHT = 16;
/**
 * Also the shortest a gesture may be drawn: rounded to its own height, a gesture
 * on a single date comes out as a dot, so one rectangle does for both and
 * nothing has to be given a duration it does not have.
 */
const BAR_HEIGHT = 5;

interface SegmentTimelineProps {
    segment: Segment;
    /** Gives a segment that acts on a single point a width to be drawn over. */
    minPointSpan: number;
    /** One beat in ticks, for the grid behind the rows. */
    beatLength: number;
}

const SegmentTimeline = ({ segment, minPointSpan, beatLength }: SegmentTimelineProps) => {
    const { from, to } = useMemo(() => tickRange(segment, minPointSpan), [segment, minPointSpan]);
    const rows = useMemo(
        () => timelineRows(segment, from, to, TRACK_WIDTH, BAR_HEIGHT),
        [segment, from, to],
    );
    const grid = useMemo(() => beatGrid(from, to, beatLength, TRACK_WIDTH), [from, to, beatLength]);

    return (
        <div style={{ fontFamily: "system-ui, sans-serif" }}>
            {rows.map(row => {
                const color = getLaneColor(row.type);
                return (
                    <div key={row.type} style={{ display: "flex", alignItems: "center", height: ROW_HEIGHT }}>
                        <div
                            style={{
                                width: TYPE_COLUMN,
                                paddingRight: 8,
                                textAlign: "right",
                                fontSize: 10,
                                fontWeight: 600,
                                color,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                        >
                            {row.type}
                        </div>
                        <div
                            style={{
                                position: "relative",
                                width: TRACK_WIDTH,
                                height: ROW_HEIGHT,
                                background: "#f9fafb",
                            }}
                        >
                            {grid.map(x => (
                                <div
                                    key={x}
                                    style={{
                                        position: "absolute",
                                        left: x,
                                        top: 0,
                                        bottom: 0,
                                        width: 1,
                                        background: "#e5e7eb",
                                    }}
                                />
                            ))}
                            {row.bars.map(bar => (
                                <div
                                    key={bar.id}
                                    style={{
                                        position: "absolute",
                                        left: bar.left,
                                        top: (ROW_HEIGHT - BAR_HEIGHT) / 2,
                                        width: bar.width,
                                        height: BAR_HEIGHT,
                                        borderRadius: BAR_HEIGHT / 2,
                                        background: color,
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

interface SegmentTimelinePopoverProps {
    /** One column each: the one under the pointer, or the ones held open. */
    segments: Segment[];
    anchorEl: { getBoundingClientRect: () => DOMRect; contextElement?: Element };
    /** Above a word that leans down, below one that leans up — never over it. */
    placement: PopperPlacementType;
    minPointSpan: number;
    beatLength: number;
}

/**
 * What a segment is made of.
 *
 * The word itself is already on the line, spotlit and grown, so saying it again
 * here would only be an echo. What the tree cannot show is the inside of a
 * segment: which gestures the claim rests on, and how they sit against each
 * other over the stretch it covers. That is this card — the lanes an opened
 * segment lays on the centre line, but drawn on the segment's own axis rather
 * than the piece's, so they stay legible at any zoom.
 *
 * The same card answers the pointer and holds still once a word is clicked:
 * what you were reading is what gets kept, rather than being swapped for a
 * different card at the moment you ask to keep it.
 *
 * Several columns show when the playhead is inside more than one segment at
 * once — they argue one moment between them, and only then is the word worth
 * writing again, because it is what tells the columns apart.
 *
 * It follows the pointer around, so it must not swallow events.
 */
export const SegmentTimelinePopover = ({
    segments,
    anchorEl,
    placement,
    minPointSpan,
    beatLength,
}: SegmentTimelinePopoverProps) => (
    <Popper
        open
        anchorEl={anchorEl}
        placement={placement}
        modifiers={[
            { name: "offset", options: { offset: [0, 8] } },
            { name: "preventOverflow", options: { padding: 8 } },
        ]}
        style={{ zIndex: 10, pointerEvents: "none" }}
    >
        <Paper elevation={4} sx={{ borderRadius: 2, px: 1.5, py: 1.25 }}>
            <Stack direction="row" divider={<Divider orientation="vertical" flexItem />} spacing={1.5}>
                {segments.map(segment => (
                    <div key={segment.id} style={{ fontFamily: "system-ui, sans-serif" }}>
                        {segments.length > 1 && (
                            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                                {wordFor(segment)}
                            </div>
                        )}
                        <SegmentTimeline
                            segment={segment}
                            minPointSpan={minPointSpan}
                            beatLength={beatLength}
                        />
                    </div>
                ))}
            </Stack>
        </Paper>
    </Popper>
);
