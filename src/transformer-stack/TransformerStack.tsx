import { Card } from "@mui/material";
import { Argumentation, getRange, Transformer } from "mpmify/lib/transformers/Transformer";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLatest } from "../hooks/useLatest";
import { useSymbolicZoom } from "../hooks/ZoomProvider";
import { useScrollSync } from "../hooks/ScrollSyncProvider";
import { MPM, MSM } from "mpmify";
import { v4 } from "uuid";
import { asPathD, negotiateIntensityCurve } from "../utils/intensityCurve";
import { useSelection } from "../hooks/SelectionProvider";
import { usePlayback } from "../hooks/PlaybackProvider";
import { BarLines } from "./BarLines";
import { ExportPNG } from "../ExportPng";
import { buildRegions, computeCurvePoints, OnionDragState, OnionSubregion, tickToCurveIndex } from "./OnionModel";
import { RegionOnion } from "./RegionOnion";

interface TransformerStackProps {
    transformers: Transformer[];
    setTransformers: (transformers: Transformer[]) => void;
    msm: MSM;
    mpm: MPM;
}

export const TransformerStack = ({
    transformers,
    setTransformers,
    msm,
    mpm,
}: TransformerStackProps) => {
    const { play, stop } = usePlayback();
    const { activeTransformerIds, setActiveTransformerIds, removeActiveTransformers } = useSelection();
    const stretchX = useSymbolicZoom();

    const svgRef = useRef<SVGSVGElement>(null);
    const playTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
    const [dragState, setDragState] = useState<OnionDragState | null>(null);
    const dragStateRef = useLatest(dragState);
    const transformersRef = useLatest(transformers);
    const playRef = useLatest(play);
    const stopRef = useLatest(stop);

    // Scroll sync
    const { register, unregister } = useScrollSync();
    const scrollContainerRef = useCallback((element: HTMLDivElement | null) => {
        if (element) {
            register('transformer-stack', element, 'symbolic');
        } else {
            unregister('transformer-stack');
        }
    }, [register, unregister]);

    const argumentations = useMemo(() =>
        Map.groupBy(transformers, t => t.argumentation),
        [transformers]
    );

    const elementTypesByTransformer = useMemo(() => {
        const allInstructions = mpm.getInstructions();
        const idToType = new Map(allInstructions.map(i => [i['xml:id'], i.type]));
        return new Map(
            transformers.map(t => [
                t.id,
                [...new Set(t.created.map(id => idToType.get(id)).filter(Boolean))] as string[]
            ])
        );
    }, [mpm, transformers]);

    const maxDate = getRange(transformers, msm)?.to || 0;
    const maxX = maxDate * stretchX;

    const scaled = useMemo(
        () => negotiateIntensityCurve(argumentations, maxDate, msm),
        [argumentations, maxDate, msm],
    );

    const totalHeight = 300;
    const padTop = 40;
    const padBottom = 40;

    const curvePoints = useMemo(
        () => computeCurvePoints({ curve: scaled, totalHeight, padTop, padBottom }),
        [scaled, totalHeight],
    );

    const curvePathD = useMemo(
        () => asPathD(scaled, totalHeight, padTop, padBottom),
        [scaled, totalHeight],
    );

    const regions = useMemo(
        () => buildRegions(argumentations, msm, elementTypesByTransformer),
        [argumentations, msm, elementTypesByTransformer],
    );

    const sizeFactors = useMemo(() => {
        const maxSpan = Math.max(1, ...regions.map(r => r.to - r.from));
        const map = new Map<string, number>();
        for (const r of regions) {
            map.set(r.id, (r.to - r.from) / maxSpan);
        }
        return map;
    }, [regions]);

    const mergeInto = useCallback(
        (transformerId: string, argumentation: Argumentation) => {
            const transformer = transformers.find(t => t.id === transformerId);
            if (!transformer) return;
            transformer.argumentation = argumentation;
            setTransformers([...transformers]);
        },
        [transformers, setTransformers]
    );

    const extractTransformer = useCallback(
        (transformerId: string) => {
            const transformer = transformers.find(t => t.id === transformerId);
            if (transformer) {
                transformer.argumentation = {
                    id: v4(),
                    conclusion: {
                        certainty: 'plausible',
                        motivation: 'calm',
                        id: v4()
                    },
                    type: 'simpleArgumentation'
                };
                setTransformers([...transformers]);
            }
        }, [transformers, setTransformers]);

    // During drag, force source region (and drop target) to stay hovered
    const effectiveHoveredId = dragState ? dragState.sourceRegionId : hoveredRegionId;
    const handleHoverChange = useCallback((regionId: string | null) => {
        if (dragStateRef.current) return;
        setHoveredRegionId(regionId);

        if (playTimeoutRef.current) clearTimeout(playTimeoutRef.current);

        if (!regionId) {
            stopRef.current();
            return;
        }

        playTimeoutRef.current = setTimeout(() => {
            const ts = transformersRef.current;
            const mpmIds = ts.filter(t => t.argumentation?.id === regionId).flatMap(t => t.created);
            if (mpmIds.length > 0) playRef.current({ mpmIds, isolate: true });
        }, 150);
    }, []);

    const handleArgumentationChange = useCallback(() => {
        setTransformers([...transformers]);
    }, [transformers, setTransformers]);

    // Mask gap for intensity curve under hovered region
    const maskId = useId();
    const curveStep = scaled.step;

    const maskGap = useMemo(() => {
        if (!effectiveHoveredId || curvePoints.length === 0) return null;
        const hr = regions.find(r => r.id === effectiveHoveredId);
        if (!hr) return null;
        const f = Math.max(0, Math.min(tickToCurveIndex(hr.from, curveStep), curvePoints.length - 1));
        const t = Math.max(0, Math.min(tickToCurveIndex(hr.to, curveStep), curvePoints.length - 1));
        if (t <= f) return null;
        return { x1: curvePoints[f].x, x2: curvePoints[t].x };
    }, [effectiveHoveredId, regions, curvePoints, curveStep]);

    // --- Drag-and-drop via window listeners ---

    const screenToSvg = useCallback(
        (clientX: number, clientY: number): { x: number; y: number } => {
            const svg = svgRef.current;
            if (!svg) return { x: 0, y: 0 };
            const ctm = svg.getScreenCTM();
            if (!ctm) return { x: 0, y: 0 };
            const inv = ctm.inverse();
            return {
                x: inv.a * clientX + inv.c * clientY + inv.e,
                y: inv.b * clientX + inv.d * clientY + inv.f,
            };
        },
        [],
    );

    const DROP_Y_TOLERANCE = 40;

    const findDropTarget = useCallback(
        (svgX: number, svgY: number, sourceRegionId: string): string | null => {
            if (curvePoints.length === 0) return null;
            for (const r of regions) {
                if (r.id === sourceRegionId) continue;
                const f = Math.max(0, Math.min(tickToCurveIndex(r.from, curveStep), curvePoints.length - 1));
                const t = Math.max(0, Math.min(tickToCurveIndex(r.to, curveStep), curvePoints.length - 1));
                if (t <= f) continue;
                const x1 = curvePoints[f].x;
                const x2 = curvePoints[t].x;
                if (svgX < x1 || svgX > x2) continue;
                // Find the curve's y at this x by interpolating between nearest points
                let curveY = curvePoints[f].y;
                for (let i = f; i < t; i++) {
                    const p0 = curvePoints[i];
                    const p1 = curvePoints[i + 1];
                    if (svgX >= p0.x && svgX <= p1.x) {
                        const ratio = p1.x === p0.x ? 0 : (svgX - p0.x) / (p1.x - p0.x);
                        curveY = p0.y + ratio * (p1.y - p0.y);
                        break;
                    }
                }
                if (Math.abs(svgY - curveY) <= DROP_Y_TOLERANCE) return r.id;
            }
            return null;
        },
        [regions, curvePoints, curveStep],
    );

    const handleDragStart = useCallback(
        (subregion: OnionSubregion, sourceRegionId: string, laneColor: string, e: { clientX: number; clientY: number }) => {
            const pos = screenToSvg(e.clientX, e.clientY);
            setDragState({
                subregion,
                sourceRegionId,
                svgX: pos.x,
                svgY: pos.y,
                laneColor,
                dropTargetRegionId: null,
            });
        },
        [screenToSvg],
    );

    // Keep latest values in refs so window listeners don't churn
    const findDropTargetRef = useLatest(findDropTarget);
    const mergeIntoRef = useLatest(mergeInto);
    const extractTransformerRef = useLatest(extractTransformer);
    const regionsRef = useLatest(regions);
    const isDragging = dragState !== null;

    useEffect(() => {
        if (!isDragging) return;

        const onMouseMove = (e: MouseEvent) => {
            const pos = screenToSvg(e.clientX, e.clientY);
            setDragState(prev => {
                if (!prev) return null;
                const dropTarget = findDropTargetRef.current(pos.x, pos.y, prev.sourceRegionId);
                return { ...prev, svgX: pos.x, svgY: pos.y, dropTargetRegionId: dropTarget };
            });
        };

        const onMouseUp = (e: MouseEvent) => {
            const prev = dragStateRef.current;
            setDragState(null);
            if (!prev) return;

            const pos = screenToSvg(e.clientX, e.clientY);
            const dropTarget = findDropTargetRef.current(pos.x, pos.y, prev.sourceRegionId);
            if (dropTarget) {
                const targetRegion = regionsRef.current.find(r => r.id === dropTarget);
                if (targetRegion) {
                    mergeIntoRef.current(prev.subregion.id, targetRegion.argumentation);
                }
            } else {
                extractTransformerRef.current(prev.subregion.id);
            }
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, [isDragging, screenToSvg]);

    const handleClearSelection = useCallback(() => {
        setActiveTransformerIds(new Set());
        const currentHash = window.location.hash.slice(1);
        if (currentHash) {
            history.pushState(null, '', window.location.pathname + window.location.search);
        }
    }, [setActiveTransformerIds]);

    useEffect(() => {
        return () => {
            if (playTimeoutRef.current) clearTimeout(playTimeoutRef.current);
        };
    }, []);

    if (transformers.length === 0) return null;

    return (
        <Card
            ref={scrollContainerRef}
            tabIndex={-1}
            onMouseDown={(e) => e.currentTarget.focus()}
            onKeyDown={(e) => {
                if (e.key === 'Backspace' && activeTransformerIds.size > 0) {
                    removeActiveTransformers();
                }
            }}
            style={{
                overflow: "scroll",
                position: "relative",
                height: "300px",
                width: "100vw",
                borderTop: "0.5px solid gray",
                outline: "none",
            }}
        >
            <div style={{
                position: "sticky",
                left: 0,
                width: "100%",
                height: 0,
                zIndex: 1,
                pointerEvents: "none",
            }}>
                <div style={{
                    position: "absolute",
                    top: 4,
                    left: 4,
                    pointerEvents: "auto",
                }}>
                    <ExportPNG
                        curvePathD={curvePathD}
                        maxDate={maxDate}
                        stretchX={stretchX}
                    />
                </div>
            </div>
            <div style={{ position: "relative", width: maxX, height: totalHeight }}>
                <svg
                    width={maxX}
                    height={totalHeight}
                    ref={svgRef}
                    style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        cursor: dragState ? "grabbing" : undefined,
                    }}
                    viewBox={`0 0 ${maxDate} ${totalHeight}`}
                    preserveAspectRatio="none"
                >
                    {/* Background rect for click-to-clear-selection */}
                    <rect
                        x={0}
                        y={0}
                        width={maxDate}
                        height={totalHeight}
                        fill="white"
                        onClick={handleClearSelection}
                    />

                    <BarLines
                        maxDate={maxDate}
                        stretchX={stretchX}
                        height={totalHeight}
                    />

                    {maskGap && (
                        <defs>
                            <mask id={maskId}>
                                <rect x="0" y="0" width={maxDate} height={totalHeight} fill="white" />
                                <rect
                                    x={maskGap.x1}
                                    y="0"
                                    width={maskGap.x2 - maskGap.x1}
                                    height={totalHeight}
                                    fill="black"
                                />
                            </mask>
                        </defs>
                    )}

                    {/* Region onions — largest first so smaller ones render on top */}
                    {[...regions]
                        .sort((a, b) => {
                            const sizeA = a.to - a.from;
                            const sizeB = b.to - b.from;
                            return sizeB - sizeA;
                        })
                        .map(region => (
                            <RegionOnion
                                key={region.id}
                                region={region}
                                curvePoints={curvePoints}
                                curveStep={curveStep}
                                sizeFactor={sizeFactors.get(region.id) ?? 1}
                                isHovered={
                                    effectiveHoveredId === region.id ||
                                    (dragState?.dropTargetRegionId === region.id)
                                }
                                isAnyHovered={effectiveHoveredId !== null}
                                isDropTarget={dragState?.dropTargetRegionId === region.id}
                                onHoverChange={handleHoverChange}
                                onDragStart={handleDragStart}
                                draggingSubregionId={
                                    dragState?.sourceRegionId === region.id
                                        ? dragState.subregion.id
                                        : null
                                }
                                onArgumentationChange={handleArgumentationChange}
                            />
                        ))}

                    {/* Intensity curve on top, masked under hovered region */}
                    <path
                        className="intensityCurve"
                        d={curvePathD}
                        fill="none"
                        stroke="#888"
                        strokeWidth={1.3}
                        strokeOpacity={0.5}
                        strokeDasharray="2.6 3.9"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        pointerEvents="none"
                        vectorEffect="non-scaling-stroke"
                        mask={maskGap ? `url(#${maskId})` : undefined}
                    />

                    {/* Drag label following the cursor */}
                    {dragState && (
                        <g pointerEvents="none" transform={`translate(${dragState.svgX}, ${dragState.svgY}) scale(${1 / stretchX}, 1)`}>
                            <rect
                                x={-dragState.subregion.type.length * 3.2 - 5}
                                y={-20}
                                width={dragState.subregion.type.length * 6.4 + 10}
                                height={16}
                                rx={4}
                                fill="white"
                                fillOpacity={0.92}
                                stroke={dragState.laneColor}
                                strokeWidth={1}
                                strokeOpacity={0.4}
                                vectorEffect="non-scaling-stroke"
                            />
                            <text
                                x={0}
                                y={-8}
                                textAnchor="middle"
                                fontSize={10}
                                fill={dragState.laneColor}
                                fontWeight="600"
                            >
                                {dragState.subregion.type}
                            </text>
                        </g>
                    )}
                </svg>
            </div>
        </Card>
    );
};
