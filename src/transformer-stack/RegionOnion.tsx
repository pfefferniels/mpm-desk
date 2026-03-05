import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Menu, MenuItem } from "@mui/material";
import type { CurvePoint, OnionRegion, OnionSubregion } from "./OnionModel";
import { tickToCurveIndex } from "./OnionModel";
import { ArgumentationDialog } from "./ArgumentationDialog";
import { OptionsDialog } from "./OptionsDialog";
import { useSelection } from "../hooks/SelectionProvider";
import { Transformer } from "mpmify";
import { CounterScaledXGroup } from "./CounterScaledXGroup";
import { TypeLabel } from "./TypeLabel";

const SUBREGION_COLORS: Record<string, string> = {
    dynamics: "#8e44ad",
    tempo: "#16a085",
    ornament: "#d35400",
    articulation: "#2c3e50",
    rubato: "#e74c3c",
    accentuationPattern: "#2980b9",
    AddDynamics: "#8e44ad",
    AddTempo: "#16a085",
    AddOrnament: "#d35400",
    AddArticulation: "#2c3e50",
    AddRubato: "#e74c3c",
    AddAccentuationPattern: "#2980b9",
    Modify: "#e67e22",
    MakeChoice: "#27ae60",
};

function getLaneColor(type: string): string {
    return SUBREGION_COLORS[type] ?? "#666";
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
        if (drawTo <= drawFrom) return "";
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
 * Build a path for a subregion lane at a given normal offset within the onion envelope.
 */
function buildLanePath(
    curvePoints: CurvePoint[],
    regionFrom: number,
    regionTo: number,
    subFrom: number,
    subTo: number,
    amplitude: number,
    laneOffset: number,
    chainFrom?: number,
    chainTo?: number,
    regionDrawFrom?: number,
    regionDrawTo?: number,
): string {
    const effectiveFrom = regionDrawFrom ?? regionFrom;
    const effectiveTo = regionDrawTo ?? regionTo;
    const clampedFrom = Math.max(effectiveFrom, Math.min(subFrom, curvePoints.length - 1));
    const clampedTo = Math.max(effectiveFrom, Math.min(subTo, effectiveTo));
    if (clampedTo <= clampedFrom) return "";

    const envelopeFrom = chainFrom ?? regionFrom;
    const envelopeSpan = (chainTo ?? regionTo) - envelopeFrom;

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

interface RegionOnionProps {
    region: OnionRegion;
    curvePoints: CurvePoint[];
    curveStep: number;
    stretchX: number;
    regionColor: string;
    sizeFactor: number;
    isHovered: boolean;
    hoveredSizeFactor: number | null;
    hasActiveSubregion: boolean;
    lodOpacity: number;
    isDropTarget?: boolean;
    chainFrom?: number;  // tick space — earliest tick in the chain
    chainTo?: number;    // tick space — latest tick in the chain
    onHoverChange: (regionId: string | null) => void;
    onDragStart?: (subregion: OnionSubregion, sourceRegionId: string, laneColor: string, e: { clientX: number; clientY: number }) => void;
    draggingSubregionId?: string | null;
    onLaneClick?: (subregionId: string) => void;
    onArgumentationChange: () => void;
    onRegionDragStart?: (sourceRegionId: string, regionColor: string, e: { clientX: number; clientY: number }) => void;
    prevChainMemberTo?: number;   // tick space — previous chain member's `to`
    nextChainMemberFrom?: number; // tick space — next chain member's `from`
}

export const RegionOnion = memo(function RegionOnion({
    region,
    curvePoints,
    curveStep,
    stretchX,
    regionColor,
    sizeFactor,
    lodOpacity,
    isHovered,
    hoveredSizeFactor,
    hasActiveSubregion,
    isDropTarget,
    chainFrom: chainFromTick,
    chainTo: chainToTick,
    onHoverChange,
    onDragStart,
    draggingSubregionId,
    onLaneClick,
    onArgumentationChange,
    onRegionDragStart,
    prevChainMemberTo: prevChainMemberToTick,
    nextChainMemberFrom: nextChainMemberFromTick,
}: RegionOnionProps) {
    const [argumentationDialogOpen, setArgumentationDialogOpen] = useState(false);

    // Pending region drag: distinguish click from drag via threshold
    const [pendingRegionDrag, setPendingRegionDrag] = useState(false);
    const pendingRegionDragRef = useRef<{
        startX: number;
        startY: number;
    } | null>(null);

    useEffect(() => {
        if (!pendingRegionDrag) return;

        const onMouseMove = (e: MouseEvent) => {
            const pending = pendingRegionDragRef.current;
            if (!pending) return;
            if (Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) >= DRAG_THRESHOLD) {
                onRegionDragStart?.(region.id, regionColor, e);
                pendingRegionDragRef.current = null;
                setPendingRegionDrag(false);
            }
        };

        const onMouseUp = () => {
            if (pendingRegionDragRef.current) {
                // Below threshold → click → open ArgumentationDialog
                setArgumentationDialogOpen(true);
            }
            pendingRegionDragRef.current = null;
            setPendingRegionDrag(false);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, [pendingRegionDrag, onRegionDragStart, region.id, regionColor]);

    const from = Math.max(0, Math.min(tickToCurveIndex(region.from, curveStep), curvePoints.length - 1));
    const to = Math.max(0, Math.min(tickToCurveIndex(region.to, curveStep), curvePoints.length - 1));
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

    const color = isDropTarget ? "#3498db" : regionColor;

    const expanded = isHovered || hasActiveSubregion;
    const baseAmp = MIN_AMPLITUDE + (BASE_AMPLITUDE - MIN_AMPLITUDE) * sizeFactor;
    const amplitude = expanded ? baseAmp + HOVER_EXTRA : baseAmp;

    const onionPath = useMemo(
        () => valid ? buildOnionPath(curvePoints, from, to, amplitude, chainFromIdx, chainToIdx, prevMemberToIdx, nextMemberFromIdx) : "",
        [curvePoints, from, to, amplitude, valid, chainFromIdx, chainToIdx, prevMemberToIdx, nextMemberFromIdx],
    );

    if (!valid) return null;

    return (
        <g
            onMouseEnter={() => onHoverChange(region.id)}
            onMouseLeave={() => onHoverChange(null)}
        >
            {onionPath && (
                <path
                    d={onionPath}
                    fill={color}
                    fillOpacity={(isDropTarget ? 0.35 : expanded ? 0.28 : 0.18 - sizeFactor * 0.1) * lodOpacity}
                    stroke={color}
                    strokeWidth={isDropTarget ? 1.5 : expanded ? 0.5 : 1.5 - sizeFactor * 0.5}
                    strokeOpacity={(isDropTarget ? 0.6 : expanded ? 0.25 : 0.5 - sizeFactor * 0.2) * lodOpacity}
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                    style={{ transition: "fill 0.15s, fill-opacity 0.15s, stroke 0.15s, stroke-opacity 0.15s, stroke-width 0.15s" }}
                />
            )}

            {/* Full onion hit area when hovered — click or drag the body */}
            {isHovered && onionPath && (
                <path
                    d={onionPath}
                    fill="transparent"
                    stroke="transparent"
                    pointerEvents="fill"
                    style={{ cursor: onRegionDragStart ? "grab" : "pointer" }}
                    onClick={onRegionDragStart ? undefined : () => setArgumentationDialogOpen(true)}
                    onMouseDown={onRegionDragStart ? (e) => {
                        if (e.button === 0) {
                            e.preventDefault();
                            pendingRegionDragRef.current = {
                                startX: e.clientX,
                                startY: e.clientY,
                            };
                            setPendingRegionDrag(true);
                        }
                    } : undefined}
                />
            )}

            {/* Onion-shaped hit area — background regions peek further from the curve */}
            {onionPath && (
                <path
                    d={onionPath}
                    fill="transparent"
                    stroke="transparent"
                    pointerEvents={hoveredSizeFactor !== null && !isHovered && sizeFactor >= hoveredSizeFactor ? "none" : "fill"}
                    style={{ cursor: onRegionDragStart ? "grab" : "pointer" }}
                    onClick={onRegionDragStart ? undefined : () => setArgumentationDialogOpen(true)}
                    onMouseDown={onRegionDragStart ? (e) => {
                        if (e.button === 0) {
                            e.preventDefault();
                            pendingRegionDragRef.current = {
                                startX: e.clientX,
                                startY: e.clientY,
                            };
                            setPendingRegionDrag(true);
                        }
                    } : undefined}
                />
            )}

            {/* Subregion lanes on hover or when containing active transformer */}
            {expanded && region.subregions.length > 0 && (
                <SubregionLanes
                    subregions={region.subregions}
                    curvePoints={curvePoints}
                    curveStep={curveStep}
                    stretchX={stretchX}
                    regionFrom={from}
                    regionTo={to}
                    amplitude={amplitude}
                    regionId={region.id}
                    chainFrom={chainFromIdx}
                    chainTo={chainToIdx}
                    prevMemberTo={prevMemberToIdx}
                    nextMemberFrom={nextMemberFromIdx}
                    onDragStart={onDragStart}
                    draggingSubregionId={draggingSubregionId}
                    onLaneClick={onLaneClick}
                />
            )}

            <foreignObject>
                <ArgumentationDialog
                    open={argumentationDialogOpen}
                    onClose={() => setArgumentationDialogOpen(false)}
                    argumentation={region.argumentation}
                    onChange={onArgumentationChange}
                />
            </foreignObject>
        </g>
    );
});

/* ── Subregion lanes rendered inside the expanded onion ── */

interface SubregionLanesProps {
    subregions: OnionSubregion[];
    curvePoints: CurvePoint[];
    curveStep: number;
    stretchX: number;
    regionFrom: number;
    regionTo: number;
    amplitude: number;
    regionId: string;
    chainFrom?: number;  // curve index space
    chainTo?: number;    // curve index space
    prevMemberTo?: number;   // curve index space
    nextMemberFrom?: number; // curve index space
    onDragStart?: (subregion: OnionSubregion, sourceRegionId: string, laneColor: string, e: { clientX: number; clientY: number }) => void;
    draggingSubregionId?: string | null;
    onLaneClick?: (subregionId: string) => void;
}

const LANE_STROKE_WIDTH = 3;
const LANE_STROKE_WIDTH_ACTIVE = 5;
const LANE_HIT_WIDTH = 12;
const DRAG_THRESHOLD = 5;
const LANE_GAP_TICKS = 2;

const SubregionLanes = memo(function SubregionLanes({
    subregions,
    curvePoints,
    curveStep,
    stretchX,
    regionFrom,
    regionTo,
    amplitude,
    regionId,
    chainFrom,
    chainTo,
    prevMemberTo,
    nextMemberFrom,
    onDragStart,
    draggingSubregionId,
    onLaneClick,
}: SubregionLanesProps) {
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
    const [menuSubregion, setMenuSubregion] = useState<OnionSubregion | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingTransformer, setEditingTransformer] = useState<Transformer | null>(null);

    const {
        activeTransformerIds,
        toggleActiveTransformer,
        focusTransformer,
        removeTransformer,
        replaceTransformer,
    } = useSelection();

    // Pending drag: distinguish click from drag via threshold
    const [pendingDrag, setPendingDrag] = useState(false);
    const pendingDragRef = useRef<{
        subregion: OnionSubregion;
        startX: number;
        startY: number;
        color: string;
    } | null>(null);

    useEffect(() => {
        if (!pendingDrag) return;

        const onMouseMove = (e: MouseEvent) => {
            const pending = pendingDragRef.current;
            if (!pending) return;
            if (Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) >= DRAG_THRESHOLD) {
                onDragStart?.(pending.subregion, regionId, pending.color, e);
                pendingDragRef.current = null;
                setPendingDrag(false);
            }
        };

        const onMouseUp = (e: MouseEvent) => {
            const pending = pendingDragRef.current;
            if (pending) {
                if (e.metaKey || e.ctrlKey) {
                    toggleActiveTransformer(pending.subregion.id);
                } else {
                    focusTransformer(pending.subregion.id);
                }
                onLaneClick?.(pending.subregion.id);
            }
            pendingDragRef.current = null;
            setPendingDrag(false);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, [pendingDrag, onDragStart, regionId, toggleActiveTransformer, focusTransformer, onLaneClick]);

    const lanes = useMemo(() => {
        const typeOrder: string[] = [];
        for (const sr of subregions) {
            if (!typeOrder.includes(sr.type)) typeOrder.push(sr.type);
        }
        const n = typeOrder.length;

        const laneOffsets = new Map<string, number>();
        for (let i = 0; i < n; i++) {
            const offset = n === 1 ? 0 : -0.7 + (1.4 * i) / (n - 1);
            laneOffsets.set(typeOrder[i], offset);
        }

        const envelopeFrom = chainFrom ?? regionFrom;
        const envelopeSpan = (chainTo ?? regionTo) - envelopeFrom;

        // Compute effective draw boundaries (same logic as buildOnionPath)
        const GAP_INSET = 1;
        let regionDrawFrom = regionFrom;
        let regionDrawTo = regionTo;
        if (chainFrom !== undefined && chainTo !== undefined) {
            if (prevMemberTo !== undefined) {
                const boundary = regionFrom < prevMemberTo
                    ? Math.floor((regionFrom + prevMemberTo) / 2)
                    : regionFrom;
                regionDrawFrom = boundary + GAP_INSET;
            }
            if (nextMemberFrom !== undefined) {
                const boundary = regionTo > nextMemberFrom
                    ? Math.ceil((nextMemberFrom + regionTo) / 2)
                    : regionTo;
                regionDrawTo = boundary - GAP_INSET;
            }
        }

        return subregions.map(sr => {
            const laneOffset = laneOffsets.get(sr.type) ?? 0;
            const srFrom = tickToCurveIndex(sr.from, curveStep);
            const srTo = tickToCurveIndex(sr.to, curveStep);
            const halfGap = Math.min(LANE_GAP_TICKS, Math.floor((srTo - srFrom) / 4));
            const gappedFrom = srFrom + halfGap;
            const gappedTo = srTo - halfGap;
            const clampedFrom = Math.max(regionDrawFrom, Math.min(gappedFrom, curvePoints.length - 1));
            const clampedTo = Math.max(regionDrawFrom, Math.min(gappedTo, regionDrawTo));
            const mid = Math.floor((clampedFrom + clampedTo) / 2);
            const pt = curvePoints[mid];
            const norm = curveNormal(curvePoints, mid);
            const t = (mid - envelopeFrom) / envelopeSpan;
            const envelope = Math.sin(Math.PI * t);
            const off = amplitude * envelope * laneOffset;

            return {
                subregion: sr,
                path: buildLanePath(curvePoints, regionFrom, regionTo, gappedFrom, gappedTo, amplitude, laneOffset, chainFrom, chainTo, regionDrawFrom, regionDrawTo),
                color: getLaneColor(sr.type),
                labelX: pt ? pt.x + norm.x * off : 0,
                labelY: pt ? pt.y + norm.y * off : 0,
            };
        });
    }, [subregions, curvePoints, curveStep, regionFrom, regionTo, amplitude, chainFrom, chainTo, prevMemberTo, nextMemberFrom]);

    const handleContextMenu = (e: React.MouseEvent, sr: OnionSubregion) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuAnchor({ x: e.clientX, y: e.clientY });
        setMenuSubregion(sr);
    };

    const handleCloseMenu = () => {
        setMenuAnchor(null);
        setMenuSubregion(null);
    };

    const handleEdit = () => {
        if (menuSubregion) {
            setEditingTransformer(menuSubregion.transformer);
            setEditDialogOpen(true);
        }
        handleCloseMenu();
    };

    const handleRemove = () => {
        if (menuSubregion) {
            removeTransformer(menuSubregion.transformer);
        }
        handleCloseMenu();
    };

    return (
        <g>
            {lanes.map(({ subregion, path, color, labelX, labelY }) => {
                const isDragging = draggingSubregionId === subregion.id;
                const isActive = activeTransformerIds.has(subregion.id);
                const strokeWidth = isActive ? LANE_STROKE_WIDTH_ACTIVE
                    : hoveredId === subregion.id && !isDragging ? LANE_STROKE_WIDTH + 2
                    : LANE_STROKE_WIDTH;

                return path ? (
                    <g key={subregion.id}>
                        {/* Wider invisible hit area */}
                        <path
                            d={path}
                            fill="none"
                            stroke="transparent"
                            strokeWidth={LANE_HIT_WIDTH}
                            vectorEffect="non-scaling-stroke"
                            pointerEvents="stroke"
                            style={{ cursor: isDragging ? "grabbing" : "default" }}
                            onMouseEnter={() => setHoveredId(subregion.id)}
                            onMouseLeave={() => setHoveredId(null)}
                            onMouseDown={e => {
                                if (e.button === 0) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (onDragStart) {
                                        pendingDragRef.current = {
                                            subregion,
                                            startX: e.clientX,
                                            startY: e.clientY,
                                            color,
                                        };
                                        setPendingDrag(true);
                                    } else {
                                        if (e.metaKey || e.ctrlKey) {
                                            toggleActiveTransformer(subregion.id);
                                        } else {
                                            focusTransformer(subregion.id);
                                        }
                                        onLaneClick?.(subregion.id);
                                    }
                                }
                            }}
                            onContextMenu={e => handleContextMenu(e, subregion)}
                        />
                        {/* Visible lane stroke */}
                        <path
                            d={path}
                            fill="none"
                            stroke={color}
                            strokeWidth={strokeWidth}
                            strokeLinecap="round"
                            strokeOpacity={isDragging ? 0.3 : isActive ? 1 : hoveredId === subregion.id ? 1 : 0.85}
                            strokeDasharray={isDragging ? "4 3" : undefined}
                            pointerEvents="none"
                            vectorEffect="non-scaling-stroke"
                            style={{ transition: "stroke-opacity 0.15s" }}
                        />
                        {/* Type label on hover */}
                        {hoveredId === subregion.id && !isDragging && (
                            <CounterScaledXGroup
                                x={labelX}
                                y={labelY}
                                stretchX={stretchX}
                                pointerEvents="none"
                            >
                                <TypeLabel
                                    text={subregion.type}
                                    color={color}
                                    boxY={-21}
                                    textY={-9}
                                />
                            </CounterScaledXGroup>
                        )}
                    </g>
                ) : null;
            })}

            <Menu
                open={menuAnchor !== null}
                onClose={handleCloseMenu}
                anchorReference="anchorPosition"
                anchorPosition={menuAnchor !== null ? { top: menuAnchor.y, left: menuAnchor.x } : undefined}
            >
                <MenuItem onClick={handleEdit}>Edit...</MenuItem>
                <MenuItem onClick={handleRemove}>Remove</MenuItem>
            </Menu>

            {editingTransformer && (
                <OptionsDialog
                    open={editDialogOpen}
                    onClose={() => {
                        setEditDialogOpen(false);
                        setEditingTransformer(null);
                    }}
                    options={editingTransformer.options}
                    onDone={(newOptions) => {
                        const updated = { ...editingTransformer, options: newOptions } as Transformer;
                        replaceTransformer(updated);
                        setEditDialogOpen(false);
                        setEditingTransformer(null);
                    }}
                />
            )}
        </g>
    );
});
