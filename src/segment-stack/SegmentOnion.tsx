import { memo, useMemo, useState } from "react";
import type { CurvePoint } from "./OnionModel";
import { laneOf, tickToCurveIndex } from "./OnionModel";
import { useSelection } from "../hooks/SelectionProvider";
import type { Segment, Span } from "../model/Reconstruction";
import { CounterScaledXGroup } from "./CounterScaledXGroup";
import { TypeLabel } from "./TypeLabel";

/** One colour per MPM element type. */
const SPAN_COLORS: Record<string, string> = {
    dynamics: "#8e44ad",
    tempo: "#16a085",
    ornament: "#d35400",
    articulation: "#2c3e50",
    rubato: "#e74c3c",
    accentuationPattern: "#2980b9",
};

function getLaneColor(type: string): string {
    return SPAN_COLORS[type] ?? "#666";
}

/**
 * Compute the unit normal at index i in the curve.
 */
function curveNormal(pts: CurvePoint[], i: number): { x: number; y: number } {
    const n = pts.length;
    if (n < 2) return { x: 0, y: -1 };
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    const dx = pts[i1].x - pts[i0].x;
    const dy = pts[i1].y - pts[i0].y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return { x: 0, y: -1 };
    return { x: -dy / len, y: dx / len };
}

/**
 * Build a closed onion/lens shape that bulges symmetrically around the curve.
 */
function buildOnionPath(
    curvePoints: CurvePoint[],
    from: number,
    to: number,
    amplitude: number,
    chainFrom?: number,
    chainTo?: number,
    prevMemberTo?: number,
    nextMemberFrom?: number,
): string {
    if (to <= from || from < 0 || to >= curvePoints.length) return "";

    // Gap insets at chain boundaries (between members, not at chain edges)
    const GAP_INSET = 1;
    let drawFrom = from;
    let drawTo = to;
    if (chainFrom !== undefined && chainTo !== undefined) {
        if (prevMemberTo !== undefined) {
            // Has a predecessor — split at midpoint if overlapping
            const boundary = from < prevMemberTo
                ? Math.floor((from + prevMemberTo) / 2)
                : from;
            drawFrom = boundary + GAP_INSET;
        }
        if (nextMemberFrom !== undefined) {
            // Has a successor — split at midpoint if overlapping
            const boundary = to > nextMemberFrom
                ? Math.ceil((nextMemberFrom + to) / 2)
                : to;
            drawTo = boundary - GAP_INSET;
        }
        if (drawTo <= drawFrom) {
            // Boundary split left no visible room — fall back to unsplit bounds
            drawFrom = from;
            drawTo = to;
        }
    }

    const envelopeFrom = chainFrom ?? from;
    const envelopeSpan = (chainTo ?? to) - envelopeFrom;

    const step = Math.max(1, Math.floor((drawTo - drawFrom) / 120));
    const indices: number[] = [];
    for (let i = drawFrom; i <= drawTo; i += step) indices.push(i);
    if (indices[indices.length - 1] !== drawTo) indices.push(drawTo);

    const upperPoints: string[] = [];
    const lowerPoints: string[] = [];

    for (const i of indices) {
        const pt = curvePoints[i];
        const n = curveNormal(curvePoints, i);
        const t = (i - envelopeFrom) / envelopeSpan;
        const envelope = Math.sin(Math.PI * t);
        const offset = amplitude * envelope;

        upperPoints.push(`${pt.x + n.x * offset},${pt.y + n.y * offset}`);
        lowerPoints.push(`${pt.x - n.x * offset},${pt.y - n.y * offset}`);
    }

    return `M ${upperPoints[0]} L ${upperPoints.join(" L ")} L ${lowerPoints.reverse().join(" L ")} Z`;
}

/**
 * Build a path for a span's lane at a given normal offset within the onion envelope.
 */
function buildLanePath(
    curvePoints: CurvePoint[],
    segmentFrom: number,
    segmentTo: number,
    spanFrom: number,
    spanTo: number,
    amplitude: number,
    laneOffset: number,
    chainFrom?: number,
    chainTo?: number,
    segmentDrawFrom?: number,
    segmentDrawTo?: number,
): string {
    const effectiveFrom = segmentDrawFrom ?? segmentFrom;
    const effectiveTo = segmentDrawTo ?? segmentTo;
    const clampedFrom = Math.max(effectiveFrom, Math.min(spanFrom, curvePoints.length - 1));
    const clampedTo = Math.max(effectiveFrom, Math.min(spanTo, effectiveTo));
    if (clampedTo <= clampedFrom) return "";

    const envelopeFrom = chainFrom ?? segmentFrom;
    const envelopeSpan = (chainTo ?? segmentTo) - envelopeFrom;

    const step = Math.max(1, Math.floor((clampedTo - clampedFrom) / 60));
    const indices: number[] = [];
    for (let i = clampedFrom; i <= clampedTo; i += step) indices.push(i);
    if (indices[indices.length - 1] !== clampedTo) indices.push(clampedTo);

    const points: string[] = [];

    for (const i of indices) {
        const pt = curvePoints[i];
        const n = curveNormal(curvePoints, i);
        const t = (i - envelopeFrom) / envelopeSpan;
        const envelope = Math.sin(Math.PI * t);
        const offset = amplitude * envelope * laneOffset;
        points.push(`${pt.x + n.x * offset},${pt.y + n.y * offset}`);
    }

    return `M ${points[0]} L ${points.join(" L ")}`;
}

const MIN_AMPLITUDE = 6;
const BASE_AMPLITUDE = 30;
const HOVER_EXTRA = 12;

interface SegmentOnionProps {
    segment: Segment;
    curvePoints: CurvePoint[];
    curveStep: number;
    stretchX: number;
    segmentColor: string;
    sizeFactor: number;
    isHovered: boolean;
    suppressHitArea: boolean;
    hasActiveSpan: boolean;
    lodOpacity: number;
    chainFrom?: number;  // tick space — earliest tick in the chain
    chainTo?: number;    // tick space — latest tick in the chain
    onHoverChange: (segmentId: string | null) => void;
    onLaneClick?: (spanId: string) => void;
    isLocked: boolean;
    onLock: (segmentId: string) => void;
    prevChainMemberTo?: number;   // tick space — previous chain member's `to`
    nextChainMemberFrom?: number; // tick space — next chain member's `from`
}

export const SegmentOnion = memo(function SegmentOnion({
    segment,
    curvePoints,
    curveStep,
    stretchX,
    segmentColor,
    sizeFactor,
    lodOpacity,
    isHovered,
    suppressHitArea,
    hasActiveSpan,
    chainFrom: chainFromTick,
    chainTo: chainToTick,
    onHoverChange,
    onLaneClick,
    isLocked,
    onLock,
    prevChainMemberTo: prevChainMemberToTick,
    nextChainMemberFrom: nextChainMemberFromTick,
}: SegmentOnionProps) {
    let from = Math.max(0, Math.min(tickToCurveIndex(segment.from, curveStep), curvePoints.length - 1));
    let to = Math.max(0, Math.min(tickToCurveIndex(segment.to, curveStep), curvePoints.length - 1));
    // Ensure point-like segments still render a small onion so their lanes are reachable.
    if (to <= from && curvePoints.length > 1) {
        const MIN_CURVE_SPAN = 3;
        from = Math.max(0, from - Math.floor(MIN_CURVE_SPAN / 2));
        to = Math.min(curvePoints.length - 1, from + MIN_CURVE_SPAN);
    }
    const valid = to > from;

    const chainFromIdx = chainFromTick !== undefined
        ? Math.max(0, Math.min(tickToCurveIndex(chainFromTick, curveStep), curvePoints.length - 1))
        : undefined;
    const chainToIdx = chainToTick !== undefined
        ? Math.max(0, Math.min(tickToCurveIndex(chainToTick, curveStep), curvePoints.length - 1))
        : undefined;

    const prevMemberToIdx = prevChainMemberToTick !== undefined
        ? Math.max(0, Math.min(tickToCurveIndex(prevChainMemberToTick, curveStep), curvePoints.length - 1))
        : undefined;
    const nextMemberFromIdx = nextChainMemberFromTick !== undefined
        ? Math.max(0, Math.min(tickToCurveIndex(nextChainMemberFromTick, curveStep), curvePoints.length - 1))
        : undefined;

    const expanded = isHovered || hasActiveSpan || isLocked;
    const baseAmp = MIN_AMPLITUDE + (BASE_AMPLITUDE - MIN_AMPLITUDE) * sizeFactor;
    const amplitude = expanded ? baseAmp + HOVER_EXTRA : baseAmp;

    const onionPath = useMemo(
        () => valid ? buildOnionPath(curvePoints, from, to, amplitude, chainFromIdx, chainToIdx, prevMemberToIdx, nextMemberFromIdx) : "",
        [curvePoints, from, to, amplitude, valid, chainFromIdx, chainToIdx, prevMemberToIdx, nextMemberFromIdx],
    );

    if (!valid) return null;

    return (
        <g
            onMouseEnter={() => onHoverChange(segment.id)}
            onMouseLeave={() => onHoverChange(null)}
        >
            {onionPath && (
                <path
                    d={onionPath}
                    fill={segmentColor}
                    fillOpacity={(expanded ? 0.35 : 0.18 - sizeFactor * 0.1) * lodOpacity}
                    stroke="black"
                    strokeWidth={expanded ? 0 : 1.5 - sizeFactor * 0.5}
                    strokeOpacity={expanded ? 0 : (0.5 - sizeFactor * 0.2) * lodOpacity}
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                    style={{ transition: "fill 0.15s, fill-opacity 0.15s, stroke 0.15s, stroke-opacity 0.15s, stroke-width 0.15s" }}
                />
            )}

            {/* Full onion hit area when expanded — click the body */}
            {(isHovered || isLocked) && onionPath && (
                <path
                    d={onionPath}
                    fill="transparent"
                    stroke="transparent"
                    pointerEvents="fill"
                    style={{ cursor: "pointer" }}
                    onClick={() => onLock(segment.id)}
                />
            )}

            {/* Onion-shaped hit area — background segments peek further from the curve */}
            {onionPath && (
                <path
                    d={onionPath}
                    fill="transparent"
                    stroke="transparent"
                    pointerEvents={suppressHitArea && !isHovered ? "none" : "fill"}
                    style={{ cursor: "pointer" }}
                    onClick={() => onLock(segment.id)}
                />
            )}

            {/* Span lanes only when locked or containing the active span */}
            {(isLocked || hasActiveSpan) && segment.spans.length > 0 && (
                <SpanLanes
                    spans={segment.spans}
                    segmentFromTick={segment.from}
                    segmentToTick={segment.to}
                    curvePoints={curvePoints}
                    curveStep={curveStep}
                    stretchX={stretchX}
                    segmentFrom={from}
                    segmentTo={to}
                    amplitude={amplitude}
                    chainFrom={chainFromIdx}
                    chainTo={chainToIdx}
                    prevMemberTo={prevMemberToIdx}
                    nextMemberFrom={nextMemberFromIdx}
                    onLaneClick={onLaneClick}
                />
            )}
        </g>
    );
});

/* ── Span lanes rendered inside the expanded onion ── */

interface SpanLanesProps {
    spans: Span[];
    segmentFromTick: number;
    segmentToTick: number;
    curvePoints: CurvePoint[];
    curveStep: number;
    stretchX: number;
    segmentFrom: number;
    segmentTo: number;
    amplitude: number;
    chainFrom?: number;  // curve index space
    chainTo?: number;    // curve index space
    prevMemberTo?: number;   // curve index space
    nextMemberFrom?: number; // curve index space
    onLaneClick?: (spanId: string) => void;
}

const LANE_STROKE_WIDTH = 3;
const LANE_STROKE_WIDTH_ACTIVE = 5;
const LANE_HIT_WIDTH = 12;
const LANE_GAP_TICKS = 2;

const SpanLanes = memo(function SpanLanes({
    spans,
    segmentFromTick,
    segmentToTick,
    curvePoints,
    curveStep,
    stretchX,
    segmentFrom,
    segmentTo,
    amplitude,
    chainFrom,
    chainTo,
    prevMemberTo,
    nextMemberFrom,
    onLaneClick,
}: SpanLanesProps) {
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const { activeSpanIds, toggleActiveSpan, focusSpan } = useSelection();

    const lanes = useMemo(() => {
        const typeOrder: string[] = [];
        for (const span of spans) {
            if (!typeOrder.includes(span.type)) typeOrder.push(span.type);
        }
        const n = typeOrder.length;

        const laneOffsets = new Map<string, number>();
        for (let i = 0; i < n; i++) {
            const offset = n === 1 ? 0 : -0.7 + (1.4 * i) / (n - 1);
            laneOffsets.set(typeOrder[i], offset);
        }

        const envelopeFrom = chainFrom ?? segmentFrom;
        const envelopeSpan = (chainTo ?? segmentTo) - envelopeFrom;

        // Compute effective draw boundaries (same logic as buildOnionPath)
        const GAP_INSET = 1;
        let segmentDrawFrom = segmentFrom;
        let segmentDrawTo = segmentTo;
        if (chainFrom !== undefined && chainTo !== undefined) {
            if (prevMemberTo !== undefined) {
                const boundary = segmentFrom < prevMemberTo
                    ? Math.floor((segmentFrom + prevMemberTo) / 2)
                    : segmentFrom;
                segmentDrawFrom = boundary + GAP_INSET;
            }
            if (nextMemberFrom !== undefined) {
                const boundary = segmentTo > nextMemberFrom
                    ? Math.ceil((nextMemberFrom + segmentTo) / 2)
                    : segmentTo;
                segmentDrawTo = boundary - GAP_INSET;
            }
            if (segmentDrawTo <= segmentDrawFrom) {
                // Boundary split left no visible room — fall back to unsplit bounds
                segmentDrawFrom = segmentFrom;
                segmentDrawTo = segmentTo;
            }
        }

        return spans.map(span => {
            const drawn = laneOf(span, segmentFromTick, segmentToTick);
            const laneOffset = laneOffsets.get(span.type) ?? 0;
            const spanFrom = tickToCurveIndex(drawn.from, curveStep);
            const spanTo = tickToCurveIndex(drawn.to, curveStep);
            const visibleFrom = Math.max(segmentDrawFrom, spanFrom);
            const visibleTo = Math.min(segmentDrawTo, spanTo);
            const halfGap = Math.min(LANE_GAP_TICKS, Math.floor((visibleTo - visibleFrom) / 4));
            let gappedFrom = spanFrom + halfGap;
            const gappedTo = spanTo - halfGap;
            if (gappedTo <= gappedFrom) {
                const minExtent = Math.max(3, Math.ceil((segmentDrawTo - segmentDrawFrom) * 0.15));
                gappedFrom = Math.max(segmentDrawFrom, gappedTo - minExtent);
            }
            const clampedFrom = Math.max(segmentDrawFrom, Math.min(gappedFrom, curvePoints.length - 1));
            const clampedTo = Math.max(segmentDrawFrom, Math.min(gappedTo, segmentDrawTo));
            const mid = Math.floor((clampedFrom + clampedTo) / 2);
            const pt = curvePoints[mid];
            const norm = curveNormal(curvePoints, mid);
            const t = (mid - envelopeFrom) / envelopeSpan;
            const envelope = Math.sin(Math.PI * t);
            const off = amplitude * envelope * laneOffset;

            return {
                span,
                path: buildLanePath(curvePoints, segmentFrom, segmentTo, gappedFrom, gappedTo, amplitude, laneOffset, chainFrom, chainTo, segmentDrawFrom, segmentDrawTo),
                color: getLaneColor(span.type),
                labelX: pt ? pt.x + norm.x * off : 0,
                labelY: pt ? pt.y + norm.y * off : 0,
            };
        });
    }, [spans, segmentFromTick, segmentToTick, curvePoints, curveStep, segmentFrom, segmentTo, amplitude, chainFrom, chainTo, prevMemberTo, nextMemberFrom]);

    return (
        <g>
            {lanes.map(({ span, path, color, labelX, labelY }) => {
                const isActive = activeSpanIds.has(span.id);
                const strokeWidth = isActive ? LANE_STROKE_WIDTH_ACTIVE
                    : hoveredId === span.id ? LANE_STROKE_WIDTH + 2
                        : LANE_STROKE_WIDTH;

                return path ? (
                    <g key={span.id}>
                        {/* Wider invisible hit area */}
                        <path
                            d={path}
                            fill="none"
                            stroke="transparent"
                            strokeWidth={LANE_HIT_WIDTH}
                            vectorEffect="non-scaling-stroke"
                            pointerEvents="stroke"
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
                        <path
                            d={path}
                            fill="none"
                            stroke={color}
                            strokeWidth={strokeWidth}
                            strokeLinecap="round"
                            strokeOpacity={isActive ? 1 : hoveredId === span.id ? 1 : 0.85}
                            pointerEvents="none"
                            vectorEffect="non-scaling-stroke"
                            style={{ transition: "stroke-opacity 0.15s" }}
                        />
                        {/* Type label on hover */}
                        {hoveredId === span.id && (
                            <CounterScaledXGroup
                                x={labelX}
                                y={labelY}
                                stretchX={stretchX}
                                pointerEvents="none"
                            >
                                <TypeLabel
                                    text={span.type}
                                    color={color}
                                    boxY={-21}
                                    textY={-9}
                                />
                            </CounterScaledXGroup>
                        )}
                    </g>
                ) : null;
            })}
        </g>
    );
});
