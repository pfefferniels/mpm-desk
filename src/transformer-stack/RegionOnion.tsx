import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Menu, MenuItem } from "@mui/material";
import type { CurvePoint, OnionRegion, OnionSubregion } from "./OnionModel";
import { ArgumentationDialog } from "./ArgumentationDialog";
import { OptionsDialog } from "./OptionsDialog";
import { useSelection } from "../hooks/SelectionProvider";
import { Transformer } from "mpmify";

const REGION_COLOR = "#999";

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
): string {
    if (to <= from || from < 0 || to >= curvePoints.length) return "";

    const step = Math.max(1, Math.floor((to - from) / 120));
    const indices: number[] = [];
    for (let i = from; i <= to; i += step) indices.push(i);
    if (indices[indices.length - 1] !== to) indices.push(to);

    const upperPoints: string[] = [];
    const lowerPoints: string[] = [];

    for (const i of indices) {
        const pt = curvePoints[i];
        const n = curveNormal(curvePoints, i);
        const t = (i - from) / (to - from);
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
): string {
    const clampedFrom = Math.max(regionFrom, Math.min(subFrom, curvePoints.length - 1));
    const clampedTo = Math.max(regionFrom, Math.min(subTo, curvePoints.length - 1));
    if (clampedTo <= clampedFrom) return "";

    const step = Math.max(1, Math.floor((clampedTo - clampedFrom) / 60));
    const indices: number[] = [];
    for (let i = clampedFrom; i <= clampedTo; i += step) indices.push(i);
    if (indices[indices.length - 1] !== clampedTo) indices.push(clampedTo);

    const points: string[] = [];
    const regionSpan = regionTo - regionFrom;

    for (const i of indices) {
        const pt = curvePoints[i];
        const n = curveNormal(curvePoints, i);
        const t = (i - regionFrom) / regionSpan;
        const envelope = Math.sin(Math.PI * t);
        const offset = amplitude * envelope * laneOffset;
        points.push(`${pt.x + n.x * offset},${pt.y + n.y * offset}`);
    }

    return `M ${points[0]} L ${points.join(" L ")}`;
}

const MIN_AMPLITUDE = 6;
const BASE_AMPLITUDE = 20;
const HOVER_EXTRA = 12;

interface RegionOnionProps {
    region: OnionRegion;
    curvePoints: CurvePoint[];
    sizeFactor: number;
    isHovered: boolean;
    isDropTarget?: boolean;
    onHoverChange: (regionId: string | null) => void;
    onDragStart?: (subregion: OnionSubregion, sourceRegionId: string, laneColor: string, e: { clientX: number; clientY: number }) => void;
    draggingSubregionId?: string | null;
    onArgumentationChange: () => void;
}

export const RegionOnion = memo(function RegionOnion({
    region,
    curvePoints,
    sizeFactor,
    isHovered,
    isDropTarget,
    onHoverChange,
    onDragStart,
    draggingSubregionId,
    onArgumentationChange,
}: RegionOnionProps) {
    const [argumentationDialogOpen, setArgumentationDialogOpen] = useState(false);

    const from = Math.max(0, Math.min(region.from, curvePoints.length - 1));
    const to = Math.max(0, Math.min(region.to, curvePoints.length - 1));
    if (to <= from) return null;

    const color = isDropTarget ? "#3498db" : REGION_COLOR;

    const baseAmp = MIN_AMPLITUDE + (BASE_AMPLITUDE - MIN_AMPLITUDE) * sizeFactor;
    const amplitude = isHovered ? baseAmp + HOVER_EXTRA : baseAmp;

    const onionPath = useMemo(
        () => buildOnionPath(curvePoints, from, to, amplitude),
        [curvePoints, from, to, amplitude],
    );

    const hitPath = useMemo(() => {
        const step = Math.max(1, Math.floor((to - from) / 80));
        const pts: string[] = [];
        for (let i = from; i <= to; i += step) {
            const p = curvePoints[i];
            pts.push(`${i === from ? "M" : "L"} ${p.x} ${p.y}`);
        }
        if ((to - from) % step !== 0) {
            const p = curvePoints[to];
            pts.push(`L ${p.x} ${p.y}`);
        }
        return pts.join(" ");
    }, [curvePoints, from, to]);

    return (
        <g
            onMouseEnter={() => onHoverChange(region.id)}
            onMouseLeave={() => onHoverChange(null)}
        >
            {onionPath && (
                <path
                    d={onionPath}
                    fill={color}
                    fillOpacity={isDropTarget ? 0.35 : isHovered ? 0.28 : 0.18 - sizeFactor * 0.1}
                    stroke={color}
                    strokeWidth={isDropTarget ? 1.5 : isHovered ? 0.5 : 1.5 - sizeFactor * 0.5}
                    strokeOpacity={isDropTarget ? 0.6 : isHovered ? 0.25 : 0.5 - sizeFactor * 0.2}
                    pointerEvents="none"
                    style={{ transition: "fill 0.15s, fill-opacity 0.15s, stroke 0.15s, stroke-opacity 0.15s, stroke-width 0.15s" }}
                />
            )}

            {/* Full onion hit area when hovered — click body opens ArgumentationDialog */}
            {isHovered && onionPath && (
                <path
                    d={onionPath}
                    fill="transparent"
                    stroke="transparent"
                    pointerEvents="fill"
                    style={{ cursor: "pointer" }}
                    onClick={() => setArgumentationDialogOpen(true)}
                />
            )}

            {/* Thin hit path along the curve — always present for initial hover detection */}
            <path
                d={hitPath}
                fill="none"
                stroke="transparent"
                strokeWidth={20}
                pointerEvents="stroke"
                style={{ cursor: "pointer" }}
            />

            {/* Subregion lanes on hover */}
            {isHovered && region.subregions.length > 0 && (
                <SubregionLanes
                    subregions={region.subregions}
                    curvePoints={curvePoints}
                    regionFrom={from}
                    regionTo={to}
                    amplitude={amplitude}
                    regionId={region.id}
                    onDragStart={onDragStart}
                    draggingSubregionId={draggingSubregionId}
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
    regionFrom: number;
    regionTo: number;
    amplitude: number;
    regionId: string;
    onDragStart?: (subregion: OnionSubregion, sourceRegionId: string, laneColor: string, e: { clientX: number; clientY: number }) => void;
    draggingSubregionId?: string | null;
}

const LANE_STROKE_WIDTH = 3;
const LANE_STROKE_WIDTH_ACTIVE = 5;
const LANE_HIT_WIDTH = 12;
const DRAG_THRESHOLD = 5;

const SubregionLanes = memo(function SubregionLanes({
    subregions,
    curvePoints,
    regionFrom,
    regionTo,
    amplitude,
    regionId,
    onDragStart,
    draggingSubregionId,
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
    }, [pendingDrag, onDragStart, regionId, toggleActiveTransformer, focusTransformer]);

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

        const regionSpan = regionTo - regionFrom;

        return subregions.map(sr => {
            const laneOffset = laneOffsets.get(sr.type) ?? 0;
            const clampedFrom = Math.max(regionFrom, Math.min(sr.from, curvePoints.length - 1));
            const clampedTo = Math.max(regionFrom, Math.min(sr.to, curvePoints.length - 1));
            const mid = Math.floor((clampedFrom + clampedTo) / 2);
            const pt = curvePoints[mid];
            const n = curveNormal(curvePoints, mid);
            const t = (mid - regionFrom) / regionSpan;
            const envelope = Math.sin(Math.PI * t);
            const off = amplitude * envelope * laneOffset;

            return {
                subregion: sr,
                path: buildLanePath(curvePoints, regionFrom, regionTo, sr.from, sr.to, amplitude, laneOffset),
                color: getLaneColor(sr.type),
                labelX: pt ? pt.x + n.x * off : 0,
                labelY: pt ? pt.y + n.y * off : 0,
            };
        });
    }, [subregions, curvePoints, regionFrom, regionTo, amplitude]);

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
                            pointerEvents="stroke"
                            style={{ cursor: isDragging ? "grabbing" : "default" }}
                            onMouseEnter={() => setHoveredId(subregion.id)}
                            onMouseLeave={() => setHoveredId(null)}
                            onMouseDown={e => {
                                if (e.button === 0) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    pendingDragRef.current = {
                                        subregion,
                                        startX: e.clientX,
                                        startY: e.clientY,
                                        color,
                                    };
                                    setPendingDrag(true);
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
                            style={{ transition: "stroke-opacity 0.15s" }}
                        />
                        {/* Type label on hover */}
                        {hoveredId === subregion.id && !isDragging && (
                            <g pointerEvents="none">
                                <rect
                                    x={labelX - subregion.type.length * 3.2 - 5}
                                    y={labelY - 21}
                                    width={subregion.type.length * 6.4 + 10}
                                    height={16}
                                    rx={4}
                                    fill="white"
                                    fillOpacity={0.92}
                                    stroke={color}
                                    strokeWidth={1}
                                    strokeOpacity={0.4}
                                />
                                <text
                                    x={labelX}
                                    y={labelY - 9}
                                    textAnchor="middle"
                                    fontSize={10}
                                    fill={color}
                                    fontWeight="600"
                                >
                                    {subregion.type}
                                </text>
                            </g>
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
