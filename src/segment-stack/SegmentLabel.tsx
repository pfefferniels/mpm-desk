import { memo, useId, useMemo, useState } from "react";
import { arcPathD, laneOf } from "./StackModel";
import { useSelection } from "../hooks/SelectionProvider";
import type { Segment } from "../model/Reconstruction";
import { wordFor, WORD_FONT_FAMILY } from "./words";
import { TypeLabel } from "./TypeLabel";
import { getLaneColor } from "./spanColors";

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

/* ── What an opened segment is made of, shown down on the centre line ── */

const LANE_STROKE_WIDTH = 3;
const LANE_STROKE_WIDTH_ACTIVE = 5;
const LANE_HIT_HEIGHT = 10;
const LANE_PITCH = 6;
const RIBBON_INSET = 6;

interface SpanRibbonProps {
    segment: Segment;
    from: number;
    to: number;
    centreY: number;
    /** -1 puts the ribbon above the line, +1 below — the way the label leans. */
    side: -1 | 1;
    stretchX: number;
    onLaneClick?: (spanId: string) => void;
}

/**
 * The gestures an opened segment is made of, one lane per MPM element type.
 *
 * The words carry no duration cue of their own, so this is where the stretch of
 * music a segment covers becomes visible — and it only appears once you have
 * asked for it, rather than crowding all 128 at rest.
 */
export const SpanRibbon = memo(function SpanRibbon({
    segment,
    from,
    to,
    centreY,
    side,
    stretchX,
    onLaneClick,
}: SpanRibbonProps) {
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const { activeSpanIds, toggleActiveSpan, focusSpan } = useSelection();

    const widthPx = (to - from) * stretchX;

    const lanes = useMemo(() => {
        const typeOrder: string[] = [];
        for (const span of segment.spans) {
            if (!typeOrder.includes(span.type)) typeOrder.push(span.type);
        }

        return segment.spans.map(span => {
            const drawn = laneOf(span, segment.from, segment.to);
            const x1 = Math.max(0, Math.min((drawn.from - from) * stretchX, widthPx));
            const x2 = Math.max(0, Math.min((drawn.to - from) * stretchX, widthPx));
            return {
                span,
                x1,
                x2: Math.max(x1 + 1, x2),
                lane: typeOrder.indexOf(span.type),
                color: getLaneColor(span.type),
            };
        });
    }, [segment, from, widthPx, stretchX]);

    if (widthPx <= 0) return null;

    return (
        <g transform={`translate(${from}, 0) scale(${1 / stretchX}, 1)`}>
            <g transform={`translate(0, ${centreY})`}>
                {/* The stretch of music this segment covers */}
                <rect
                    x={0}
                    y={-2}
                    width={widthPx}
                    height={4}
                    rx={2}
                    fill="#374151"
                    fillOpacity={0.75}
                    pointerEvents="none"
                />
                {lanes.map(({ span, x1, x2, lane, color }) => {
                    const y = side * (RIBBON_INSET + lane * LANE_PITCH);
                    const isActive = activeSpanIds.has(span.id);

                    return (
                        <g key={span.id}>
                            {/* Wider invisible hit area */}
                            <rect
                                x={x1}
                                y={y - LANE_HIT_HEIGHT / 2}
                                width={x2 - x1}
                                height={LANE_HIT_HEIGHT}
                                fill="transparent"
                                style={{ cursor: "pointer" }}
                                onMouseEnter={() => setHoveredId(span.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                onMouseDown={e => {
                                    if (e.button === 0) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (e.metaKey || e.ctrlKey) {
                                            toggleActiveSpan(span.id);
                                        } else {
                                            focusSpan(span.id);
                                        }
                                        onLaneClick?.(span.id);
                                    }
                                }}
                            />
                            {/* Visible lane stroke */}
                            <line
                                x1={x1}
                                y1={y}
                                x2={x2}
                                y2={y}
                                stroke={color}
                                strokeWidth={isActive ? LANE_STROKE_WIDTH_ACTIVE : LANE_STROKE_WIDTH}
                                strokeLinecap="round"
                                strokeOpacity={isActive || hoveredId === span.id ? 1 : 0.85}
                                pointerEvents="none"
                                style={{ transition: "stroke-opacity 0.15s" }}
                            />
                            {/* Which gesture this lane is — the lanes are only colour otherwise */}
                            {hoveredId === span.id && (
                                <g transform={`translate(${(x1 + x2) / 2}, ${y})`} pointerEvents="none">
                                    <TypeLabel text={span.type} color={color} boxY={-21} textY={-9} />
                                </g>
                            )}
                        </g>
                    );
                })}
            </g>
        </g>
    );
});
