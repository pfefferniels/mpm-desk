import { useState } from 'react';
import type { Segment as Gestures, Span } from '../../model/Reconstruction';
import type { PerformanceReader } from '../../utils/mpm';
import { SegmentTimeline, TYPE_COLUMN } from '../../segment-stack/SegmentTimeline';
import { InstructionAttributes } from '../../segment-stack/InstructionAttributes';

/**
 * How wide a row draws its gestures.
 *
 * Wider than the viewer's card, which has to hang off a word without covering the tree. A
 * table column has the room, and the extra pixels go where they are worth most: a segment
 * holding four gestures over two bars is otherwise four bars a few pixels apart.
 */
const TRACK = 360;

/** What the quotation may grow to before it scrolls, so a long def cannot stretch the page. */
const QUOTE_HEIGHT = 180;

interface SegmentGesturesProps {
    /**
     * The segment as the run projected it — its spans, on the ticks they act at.
     *
     * Absent where the projection dropped the segment: every instruction its calls wrote was
     * removed again by a later call, none of them reported a place, or no call names it at all.
     * All three are states the desk exists to make visible, so they are said rather than left
     * blank.
     */
    gestures: Gestures | undefined;
    mpm: PerformanceReader;
    minPointSpan: number;
}

/**
 * What a segment does, drawn — the viewer's card, in a table row.
 *
 * The same picture the tree shows on hover: one lane per kind of gesture, all on the
 * segment's own stretch, tempo and dynamics and the pedals drawn as the curves they are and
 * everything else as the moment it happens at. Sharing the component rather than drawing a
 * second version of it is the point — a segment that reads one way while it is being
 * assembled and another way once it is published is a desk lying to its editor.
 *
 * Two things differ, and both because a desk is not a card:
 *
 * - **Every lane takes the pointer**, tempo and dynamics included. In the viewer a drawn lane
 *   answers its own question, so pointing at it would offer a worse version of what is on the
 *   screen. Here the question behind the picture is often "what does the document actually
 *   say" — the `@bpm` a fit landed on, the `@curvature` a transformer chose — and that is what
 *   the quotation is for.
 * - **The quotation hangs over the rows below**, out of the table's flow. Laid out inside the
 *   cell it would grow the row on hover, which moves the very lane the pointer is on.
 */
export const SegmentGestures = ({ gestures, mpm, minPointSpan }: SegmentGesturesProps) => {
    const [hovered, setHovered] = useState<Span | null>(null);

    if (!gestures) {
        return (
            <span
                style={{ color: '#b45309', fontSize: 11 }}
                title="Nothing is grouped here yet — or every instruction this segment's calls wrote was removed or merged away again by a later call, or none of them named a place on the timeline."
            >
                nothing left to draw
            </span>
        );
    }

    return (
        <div style={{ position: 'relative', width: TYPE_COLUMN + TRACK }}>
            <SegmentTimeline
                segment={gestures}
                mpm={mpm}
                minPointSpan={minPointSpan}
                hovered={hovered}
                onHover={setHovered}
                trackWidth={TRACK}
                reachDrawn
            />

            {hovered && (
                <div
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        zIndex: 5,
                        boxSizing: 'border-box',
                        width: TYPE_COLUMN + TRACK,
                        maxHeight: QUOTE_HEIGHT,
                        overflow: 'auto',
                        background: '#ffffff',
                        border: '1px solid #e5e7eb',
                        borderRadius: 4,
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
                        padding: '6px 8px',
                    }}
                >
                    <InstructionAttributes elements={hovered.elements} mpm={mpm} />
                </div>
            )}
        </div>
    );
};
