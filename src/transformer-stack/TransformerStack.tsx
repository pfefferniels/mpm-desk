import { Card } from "@mui/material";
import { Argumentation, getRange, Transformer } from "mpmify/lib/transformers/Transformer";
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
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
import { CounterScaledXGroup } from "./CounterScaledXGroup";
import { TypeLabel } from "./TypeLabel";

/** Check whether [from, to] is fully covered by the union of the given intervals. */
function isRangeFullyCovered(from: number, to: number, intervals: { from: number; to: number }[]): boolean {
    const relevant = intervals
        .filter(i => i.from < to && i.to > from)
        .sort((a, b) => a.from - b.from);
    let cursor = from;
    for (const i of relevant) {
        if (i.from > cursor) return false;
        cursor = Math.max(cursor, i.to);
        if (cursor >= to) return true;
    }
    return cursor >= to;
}

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

    const LOD_MIN_PX = 30;
    const LOD_FADE_PX = 60;

    const lodOpacities = useMemo(() => {
        const map = new Map<string, number>();
        for (const r of regions) {
            const pixelWidth = (r.to - r.from) * stretchX;
            const opacity = Math.min(1, Math.max(0, (pixelWidth - LOD_MIN_PX) / (LOD_FADE_PX - LOD_MIN_PX)));
            map.set(r.id, opacity);
        }

        // Ensure gap-free coverage: force the largest hidden regions visible
        // so every part of the timeline covered by any region stays filled.
        const sorted = [...regions].sort((a, b) => (b.to - b.from) - (a.to - a.from));
        const covered: { from: number; to: number }[] = [];
        for (const r of sorted) {
            if ((map.get(r.id) ?? 0) > 0) covered.push({ from: r.from, to: r.to });
        }
        for (const r of sorted) {
            if ((map.get(r.id) ?? 0) > 0) continue;
            if (!isRangeFullyCovered(r.from, r.to, covered)) {
                map.set(r.id, 1);
                covered.push({ from: r.from, to: r.to });
            }
        }

        return map;
    }, [regions, stretchX]);

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

    const isDragging = dragState !== null;

    const onDragMouseMove = useEffectEvent((e: MouseEvent) => {
        const pos = screenToSvg(e.clientX, e.clientY);
        setDragState(prev => {
            if (!prev) return null;
            const dropTarget = findDropTarget(pos.x, pos.y, prev.sourceRegionId);
            return { ...prev, svgX: pos.x, svgY: pos.y, dropTargetRegionId: dropTarget };
        });
    });

    const onDragMouseUp = useEffectEvent((e: MouseEvent) => {
        const prev = dragState;
        setDragState(null);
        if (!prev) return;

        const pos = screenToSvg(e.clientX, e.clientY);
        const dropTarget = findDropTarget(pos.x, pos.y, prev.sourceRegionId);
        if (dropTarget) {
            const targetRegion = regions.find(r => r.id === dropTarget);
            if (targetRegion) {
                mergeInto(prev.subregion.id, targetRegion.argumentation);
            }
        } else {
            extractTransformer(prev.subregion.id);
        }
    });

    useEffect(() => {
        if (!isDragging) return;
        window.addEventListener("mousemove", onDragMouseMove);
        window.addEventListener("mouseup", onDragMouseUp);
        return () => {
            window.removeEventListener("mousemove", onDragMouseMove);
            window.removeEventListener("mouseup", onDragMouseUp);
        };
    }, [isDragging]);

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
                        .filter(region => (lodOpacities.get(region.id) ?? 0) > 0)
                        .map(region => (
                            <RegionOnion
                                key={region.id}
                                region={region}
                                curvePoints={curvePoints}
                                curveStep={curveStep}
                                stretchX={stretchX}
                                sizeFactor={sizeFactors.get(region.id) ?? 1}
                                lodOpacity={lodOpacities.get(region.id) ?? 1}
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
                        <CounterScaledXGroup
                            x={dragState.svgX}
                            y={dragState.svgY}
                            stretchX={stretchX}
                            pointerEvents="none"
                        >
                            <TypeLabel
                                text={dragState.subregion.type}
                                color={dragState.laneColor}
                                boxY={-20}
                                textY={-8}
                            />
                        </CounterScaledXGroup>
                    )}
                </svg>
            </div>
        </Card>
    );
};
