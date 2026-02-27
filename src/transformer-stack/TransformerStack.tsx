import { Card } from "@mui/material";
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { useLatest } from "../hooks/useLatest";
import { useSymbolicZoom } from "../hooks/ZoomProvider";
import { useScrollSync } from "../hooks/ScrollSyncProvider";
import { Argumentation, getRange, MPM, MSM, Transformer } from "mpmify";
import { v4 } from "uuid";
import { applyExaggeration, asPathD, negotiateIntensityCurve } from "../utils/intensityCurve";
import { useSelection } from "../hooks/SelectionProvider";
import { EXAGGERATION_MAX, usePlayback } from "../hooks/PlaybackProvider";
import { BarLines } from "./BarLines";
import { ExportPNG } from "../components/ExportPng";
import { buildChains, buildRegions, ChainInfo, computeCurvePoints, OnionDragState, OnionSubregion, tickToCurveIndex } from "./OnionModel";
import { RegionOnion } from "./RegionOnion";
import { CounterScaledXGroup } from "./CounterScaledXGroup";
import { TypeLabel } from "./TypeLabel";
import { cloneTransformerWithArgumentation } from "./cloneTransformer";
import { InstructionPopover } from "./InstructionPopover";
import { MergeOrChainDialog } from "./MergeOrChainDialog";

function lerpHexColor(a: string, b: string, t: number): string {
    const parse = (hex: string) => [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
    const [ar, ag, ab] = parse(a);
    const [br, bg, bb] = parse(b);
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

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
    draggable?: boolean;
}

export const TransformerStack = ({
    transformers,
    setTransformers,
    msm,
    mpm,
    draggable = false,
}: TransformerStackProps) => {
    const { play, stop, exaggeration } = usePlayback();
    const { activeTransformerIds, setActiveTransformerIds, removeActiveTransformers } = useSelection();
    const stretchX = useSymbolicZoom();

    const svgRef = useRef<SVGSVGElement>(null);
    const playTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
    const [dragState, setDragState] = useState<OnionDragState | null>(null);
    const [pendingRegionDrop, setPendingRegionDrop] = useState<{
        sourceRegionId: string;
        targetRegionId: string;
    } | null>(null);
    const dragStateRef = useLatest(dragState);
    const transformersRef = useLatest(transformers);
    const playRef = useLatest(play);
    const stopRef = useLatest(stop);
    const exaggerationRef = useLatest(exaggeration);

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
        () => negotiateIntensityCurve(argumentations, maxDate, msm, elementTypesByTransformer),
        [argumentations, maxDate, msm, elementTypesByTransformer],
    );

    const totalHeight = 300;
    const padTop = 40;
    const padBottom = 40;

    const exaggeratedCurve = useMemo(
        () => applyExaggeration(scaled, exaggeration),
        [scaled, exaggeration],
    );

    const curvePoints = useMemo(
        () => computeCurvePoints({ curve: exaggeratedCurve, totalHeight, padTop, padBottom }),
        [exaggeratedCurve, totalHeight],
    );

    const curvePathD = useMemo(
        () => asPathD(exaggeratedCurve, totalHeight, padTop, padBottom),
        [exaggeratedCurve, totalHeight],
    );

    const regions = useMemo(
        () => buildRegions(argumentations, msm, elementTypesByTransformer),
        [argumentations, msm, elementTypesByTransformer],
    );

    const chains = useMemo(() => buildChains(regions), [regions]);
    const chainsRef = useLatest(chains);

    const chainNeighborBounds = useMemo(() => {
        const map = new Map<string, { prevTo?: number; nextFrom?: number }>();
        const regionById = new Map(regions.map(r => [r.id, r]));
        const seen = new Set<ChainInfo>();
        for (const chain of chains.values()) {
            if (seen.has(chain)) continue;
            seen.add(chain);
            for (let i = 0; i < chain.memberIds.length; i++) {
                const id = chain.memberIds[i];
                const bounds: { prevTo?: number; nextFrom?: number } = {};
                if (i > 0) {
                    const prev = regionById.get(chain.memberIds[i - 1]);
                    if (prev) bounds.prevTo = prev.to;
                }
                if (i < chain.memberIds.length - 1) {
                    const next = regionById.get(chain.memberIds[i + 1]);
                    if (next) bounds.nextFrom = next.from;
                }
                map.set(id, bounds);
            }
        }
        return map;
    }, [regions, chains]);

    const regionColors = useMemo(() => {
        const t = Math.min(1, (exaggeration - 1) / (EXAGGERATION_MAX - 1));
        const map = new Map<string, string>();
        for (const r of regions) {
            const mot = r.argumentation.conclusion.motivation;
            const warm = mot === 'intensify' || mot === 'move';
            const target = warm ? '#c0392b' : '#2980b9';
            map.set(r.id, lerpHexColor('#999999', target, t));
        }
        return map;
    }, [regions, exaggeration]);

    const sizeFactors = useMemo(() => {
        // For chained regions, use the chain's total span
        const effectiveSpans = new Map<string, number>();
        for (const r of regions) {
            const chain = chains.get(r.id);
            effectiveSpans.set(r.id, chain ? chain.chainTo - chain.chainFrom : r.to - r.from);
        }
        const maxSpan = Math.max(1, ...effectiveSpans.values());
        const map = new Map<string, number>();
        for (const [id, span] of effectiveSpans) {
            map.set(id, span / maxSpan);
        }
        return map;
    }, [regions, chains]);

    const LOD_MIN_PX = 30;
    const LOD_FADE_PX = 60;

    const lodOpacities = useMemo(() => {
        const map = new Map<string, number>();
        for (const r of regions) {
            const pixelWidth = (r.to - r.from) * stretchX;
            const opacity = Math.min(1, Math.max(0, (pixelWidth - LOD_MIN_PX) / (LOD_FADE_PX - LOD_MIN_PX)));
            map.set(r.id, opacity);
        }

        // Ensure gap-free coverage: force the largest regions visible
        // so every part of the timeline covered by any region stays filled.
        // Only count fully-opaque regions as reliable coverage — regions with
        // partial LOD opacity (barely above threshold) render nearly invisible
        // and must not block the gap-fill from showing a proper region.
        const sorted = [...regions].sort((a, b) => (b.to - b.from) - (a.to - a.from));
        const covered: { from: number; to: number }[] = [];
        for (const r of sorted) {
            if ((map.get(r.id) ?? 0) >= 1) covered.push({ from: r.from, to: r.to });
        }
        for (const r of sorted) {
            if ((map.get(r.id) ?? 0) >= 1) continue;
            if (!isRangeFullyCovered(r.from, r.to, covered)) {
                map.set(r.id, 1);
                covered.push({ from: r.from, to: r.to });
            }
        }

        return map;
    }, [regions, stretchX]);

    const mergeInto = useCallback(
        (transformerId: string, argumentation: Argumentation) => {
            setTransformers(transformers.map(transformer =>
                transformer.id === transformerId
                    ? cloneTransformerWithArgumentation(transformer, argumentation)
                    : transformer
            ));
        },
        [transformers, setTransformers]
    );

    const extractTransformer = useCallback(
        (transformerId: string) => {
            setTransformers(transformers.map(transformer =>
                transformer.id === transformerId
                    ? cloneTransformerWithArgumentation(transformer, {
                        id: v4(),
                        conclusion: {
                            certainty: 'plausible',
                            motivation: 'calm',
                            id: v4()
                        },
                        type: 'simpleArgumentation'
                    })
                    : transformer
            ));
        }, [transformers, setTransformers]);

    // During drag, force source region (and drop target) to stay hovered
    // Expand to all chain members when hovering a chained region
    const effectiveHoveredIds = useMemo(() => {
        const baseId = dragState ? dragState.sourceRegionId : hoveredRegionId;
        if (!baseId) return new Set<string>();
        const chain = chains.get(baseId);
        if (chain) return new Set(chain.memberIds);
        return new Set([baseId]);
    }, [dragState, hoveredRegionId, chains]);

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
            // Collect mpmIds from all chain members
            const chain = chainsRef.current.get(regionId);
            const ids = chain ? chain.memberIds : [regionId];
            const mpmIds = ts.filter(t => ids.includes(t.argumentation?.id)).flatMap(t => t.created);
            if (mpmIds.length > 0) playRef.current({ mpmIds, exaggerate: exaggerationRef.current });
        }, 150);
    }, [dragStateRef, exaggerationRef, playRef, stopRef, transformersRef, chainsRef]);

    const handleLaneClick = useCallback((subregionId: string) => {
        const ts = transformersRef.current;
        const t = ts.find(t => t.id === subregionId);
        if (t) {
            playRef.current({ mpmIds: t.created, isolate: true, exaggerate: exaggerationRef.current });
        }
    }, [exaggerationRef, playRef, transformersRef]);

    const handleArgumentationChange = useCallback(() => {
        setTransformers([...transformers]);
    }, [transformers, setTransformers]);

    // Mask gap for intensity curve under hovered region
    const maskId = useId();
    const curveStep = scaled.step;

    const maskGap = useMemo(() => {
        if (effectiveHoveredIds.size === 0 || curvePoints.length === 0) return null;
        // Span the full range of all hovered regions (chain-expanded)
        let minFrom = Infinity;
        let maxTo = -Infinity;
        for (const id of effectiveHoveredIds) {
            const r = regions.find(r => r.id === id);
            if (r) {
                minFrom = Math.min(minFrom, r.from);
                maxTo = Math.max(maxTo, r.to);
            }
        }
        if (minFrom === Infinity) return null;
        const f = Math.max(0, Math.min(tickToCurveIndex(minFrom, curveStep), curvePoints.length - 1));
        const t = Math.max(0, Math.min(tickToCurveIndex(maxTo, curveStep), curvePoints.length - 1));
        if (t <= f) return null;
        return { x1: curvePoints[f].x, x2: curvePoints[t].x };
    }, [effectiveHoveredIds, regions, curvePoints, curveStep]);

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

    const handleRegionDragStart = useCallback(
        (sourceRegionId: string, regionColor: string, e: { clientX: number; clientY: number }) => {
            const pos = screenToSvg(e.clientX, e.clientY);
            setDragState({
                subregion: null,
                sourceRegionId,
                svgX: pos.x,
                svgY: pos.y,
                laneColor: regionColor,
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

    const mergeRegions = useCallback(
        (sourceId: string, targetId: string) => {
            const sourceRegion = regions.find(r => r.id === sourceId);
            const targetRegion = regions.find(r => r.id === targetId);
            if (!sourceRegion || !targetRegion) return;
            setTransformers(transformers.map(t =>
                sourceRegion.transformers.some(st => st.id === t.id)
                    ? cloneTransformerWithArgumentation(t, targetRegion.argumentation)
                    : t
            ));
        },
        [regions, transformers, setTransformers],
    );

    const chainRegions = useCallback(
        (sourceId: string, targetId: string) => {
            const sourceRegion = regions.find(r => r.id === sourceId);
            if (!sourceRegion) return;
            sourceRegion.argumentation.continue = targetId;
            setTransformers([...transformers]);
        },
        [regions, transformers, setTransformers],
    );

    const onDragMouseUp = useEffectEvent((e: MouseEvent) => {
        const prev = dragState;
        setDragState(null);
        if (!prev) return;

        const pos = screenToSvg(e.clientX, e.clientY);
        const dropTarget = findDropTarget(pos.x, pos.y, prev.sourceRegionId);

        if (prev.subregion !== null) {
            // Lane drag — existing behavior
            if (dropTarget) {
                const targetRegion = regions.find(r => r.id === dropTarget);
                if (targetRegion) {
                    mergeInto(prev.subregion.id, targetRegion.argumentation);
                }
            } else {
                extractTransformer(prev.subregion.id);
            }
        } else {
            // Region drag — show merge/chain dialog
            if (dropTarget) {
                setPendingRegionDrop({
                    sourceRegionId: prev.sourceRegionId,
                    targetRegionId: dropTarget,
                });
            }
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
    }, [isDragging, onDragMouseMove, onDragMouseUp]);

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
                if (e.key === 'Escape') {
                    handleClearSelection();
                } else if (e.key === 'Backspace' && draggable && activeTransformerIds.size > 0) {
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
                {draggable && (
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
                )}
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
                                regionColor={regionColors.get(region.id) ?? '#999999'}
                                sizeFactor={sizeFactors.get(region.id) ?? 1}
                                lodOpacity={lodOpacities.get(region.id) ?? 1}
                                isHovered={
                                    effectiveHoveredIds.has(region.id) ||
                                    (dragState?.dropTargetRegionId === region.id)
                                }
                                isAnyHovered={effectiveHoveredIds.size > 0}
                                hasActiveSubregion={region.subregions.some(sr => activeTransformerIds.has(sr.id))}
                                isDropTarget={dragState?.dropTargetRegionId === region.id}
                                chainFrom={chains.get(region.id)?.chainFrom}
                                chainTo={chains.get(region.id)?.chainTo}
                                prevChainMemberTo={chainNeighborBounds.get(region.id)?.prevTo}
                                nextChainMemberFrom={chainNeighborBounds.get(region.id)?.nextFrom}
                                onHoverChange={handleHoverChange}
                                onDragStart={draggable ? handleDragStart : undefined}
                                draggingSubregionId={
                                    draggable && dragState?.sourceRegionId === region.id && dragState.subregion
                                        ? dragState.subregion.id
                                        : null
                                }
                                onLaneClick={handleLaneClick}
                                onArgumentationChange={handleArgumentationChange}
                                onRegionDragStart={draggable ? handleRegionDragStart : undefined}
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
                                text={dragState.subregion?.type
                                    ?? regions.find(r => r.id === dragState.sourceRegionId)?.argumentation.conclusion.motivation
                                    ?? "region"}
                                color={dragState.laneColor}
                                boxY={-20}
                                textY={-8}
                            />
                        </CounterScaledXGroup>
                    )}
                </svg>
            </div>
            {!draggable && activeTransformerIds.size === 1 && (
                <InstructionPopover
                    mpm={mpm}
                    transformers={transformers}
                    activeTransformerIds={activeTransformerIds}
                    svgRef={svgRef}
                />
            )}
            {pendingRegionDrop && (
                <MergeOrChainDialog
                    open
                    onMerge={() => {
                        mergeRegions(pendingRegionDrop.sourceRegionId, pendingRegionDrop.targetRegionId);
                        setPendingRegionDrop(null);
                    }}
                    onChain={() => {
                        chainRegions(pendingRegionDrop.sourceRegionId, pendingRegionDrop.targetRegionId);
                        setPendingRegionDrop(null);
                    }}
                    onClose={() => setPendingRegionDrop(null)}
                />
            )}
        </Card>
    );
};
