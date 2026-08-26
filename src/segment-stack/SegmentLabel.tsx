import { memo, useId, useMemo } from "react";
import { arcPathD } from "./StackModel";
import type { Segment } from "../model/Reconstruction";
import { wordFor, WORD_FONT_FAMILY } from "./words";

const HOVER_GROW = 1.35;

interface SegmentLabelProps {
    segment: Segment;
    /**
     * Attaches the branch's foot, which the stack slides along the line itself.
     *
     * Zoom is deliberately not a prop here: it would change on all 128 labels at
     * once and React cannot reconcile that inside a frame — see `SegmentStack`.
     */
    footRef: (node: SVGGElement | null) => void;
    /** -1 leans up out of the line, +1 leans down. */
    side: -1 | 1;
    /** Distance from the centre line to the label's foot, in pixels. */
    offset: number;
    centreY: number;
    /** Set from the segment's duration: the longer the gesture, the larger the word. */
    fontSize: number;
    /** Pixel length of the word along its branch, which is what shapes the arc. */
    length: number;
    opacity: number;
    isHovered: boolean;
    isLocked: boolean;
    hasActiveSpan: boolean;
    onHoverChange: (segmentId: string | null) => void;
    onLock: (segmentId: string) => void;
}

/**
 * One segment's word, written along a branch curving off the centre line.
 *
 * The lean is what lets every word be shown at once: two words on the same lean
 * run near-parallel, so they clear each other on a roughly fixed spacing between
 * their feet however long they are — see `packLabels`.
 *
 * The word is set on a `textPath`, so the curve is drawn once as an arc and the
 * type follows it. The arc comes from the same `arcPathD` the packer measured
 * against, so what is drawn is exactly what was packed.
 *
 * The outer group — the one the stack holds by `footRef` — anchors the word in
 * tick space and undoes the X stretch, so everything inside is pixels and the
 * curve comes out true rather than sheared by the viewBox's non-uniform scale.
 */
export const SegmentLabel = memo(function SegmentLabel({
    segment,
    footRef,
    side,
    offset,
    centreY,
    fontSize,
    length,
    opacity,
    isHovered,
    isLocked,
    hasActiveSpan,
    onHoverChange,
    onLock,
}: SegmentLabelProps) {
    const pathId = useId();
    const lit = isHovered || isLocked || hasActiveSpan;
    const word = wordFor(segment);

    const d = useMemo(() => arcPathD(length, side), [length, side]);

    return (
        <g ref={footRef}>
            <g
                transform={
                    lit
                        ? `translate(0, ${centreY + side * offset}) scale(${HOVER_GROW})`
                        : `translate(0, ${centreY + side * offset})`
                }
            >
                <defs>
                    <path id={pathId} d={d} />
                </defs>
                <text
                    fontFamily={WORD_FONT_FAMILY}
                    fontSize={fontSize}
                    fill={lit ? "#111827" : "#374151"}
                    fontWeight={lit ? 600 : 400}
                    // `fill-opacity`, not `opacity`: a group opacity below 1 makes the
                    // browser render that group into its own offscreen buffer, and
                    // 128 of those is what made hovering crawl.
                    fillOpacity={opacity}
                    dominantBaseline="middle"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => onHoverChange(segment.id)}
                    onMouseLeave={() => onHoverChange(null)}
                    onClick={() => onLock(segment.id)}
                >
                    <textPath href={`#${pathId}`}>{word}</textPath>
                </text>
            </g>
        </g>
    );
});
