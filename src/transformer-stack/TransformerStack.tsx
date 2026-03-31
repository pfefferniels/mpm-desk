import { Card } from "@mui/material";
import { useCallback, useDeferredValue, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { useLatest } from "../hooks/useLatest";
import { useSymbolicZoom } from "../hooks/ZoomProvider";
import { useScrollSync } from "../hooks/ScrollSyncProvider";
import { Argumentation, getRange, MPM, MSM, Transformer } from "mpmify";
import { v4 } from "uuid";
import { applyExaggeration, applyLocalRenormalization, asPathD, negotiateIntensityCurve } from "../utils/intensityCurve";
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
import { ArgumentationPopover } from "./ArgumentationPopover";
import { ArgumentationTooltip } from "./ArgumentationTooltip";
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
    const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
    const [lockedRegionId, setLockedRegionId] = useState<string | null>(null);
    const [dragState, setDragState] = useState<OnionDragState | null>(null);
    const [pendingRegionDrop, setPendingRegionDrop] = useState<{
        sourceRegionId: string;
        targetRegionId: string;
    } | null>(null);
    const dragStateRef = useLatest(dragState);
    const lockedRegionIdRef = useLatest(lockedRegionId);
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

    const totalHeight = 300;
    const padTop = 40;
    const padBottom = 40;

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

    const subregionToRegion = useMemo(() => {
        const map = new Map<string, string>();
        for (const r of regions) {
            for (const sr of r.subregions) {
                map.set(sr.id, r.id);
            }
        }
        return map;
    }, [regions]);

    const LOD_MIN_PX = 30;
    const LOD_FADE_PX = 60;

    // Minimum effective tick span for point-like regions so they respond to
    // zoom naturally: invisible when zoomed out, visible when zoomed in.
    const minPointSpan = useMemo(() => {
        const spans = regions.map(r => r.to - r.from).filter(s => s > 0);
        if (spans.length === 0) return 0;
        spans.sort((a, b) => a - b);
        return spans[Math.floor(spans.length / 4)]; // first quartile
    }, [regions]);

    const lodOpacities = useMemo(() => {
        const map = new Map<string, number>();
        for (const r of regions) {
            const effectiveSpan = r.to > r.from ? r.to - r.from : minPointSpan;
            const pixelWidth = effectiveSpan * stretchX;
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
    }, [regions, stretchX, minPointSpan]);

    const deferredLodOpacities = useDeferredValue(lodOpacities);

    const scaled = useMemo(
        () => negotiateIntensityCurve(argumentations, maxDate, msm, elementTypesByTransformer, deferredLodOpacities),
        [argumentations, maxDate, msm, elementTypesByTransformer, deferredLodOpacities],
    );

    const exaggeratedCurve = useMemo(
        () => applyExaggeration(scaled, exaggeration),
        [scaled, exaggeration],
    );

    // Defer stretchX for renormalization so the zoom itself stays responsive
    // while the curve normalization catches up between interactions.
    const deferredStretchX = useDeferredValue(stretchX);

    const displayCurve = useMemo(
        () => applyLocalRenormalization(exaggeratedCurve, deferredStretchX),
        [exaggeratedCurve, deferredStretchX],
    );

    const regionColors = useMemo(() => {
        const globalT = Math.min(1, (exaggeration - 1) / (EXAGGERATION_MAX - 1));
        const { values, step } = displayCurve;
        const map = new Map<string, string>();
        for (const r of regions) {
            const mot = r.argumentation.conclusion.motivation;
            const warm = mot === 'intensify' || mot === 'move';
            const target = warm ? '#c0392b' : '#2980b9';

            // Per-region saturation: how far the exaggerated curve deviates
            // from the midline within this region's tick range
            const fromIdx = Math.max(0, Math.min(tickToCurveIndex(r.from, step), values.length - 1));
            const toIdx = Math.max(0, Math.min(tickToCurveIndex(r.to, step), values.length - 1));
            let sumDev = 0;
            let count = 0;
            for (let i = fromIdx; i <= toIdx; i++) {
                sumDev += Math.abs(values[i] - 0.5);
                count++;
            }
            const meanDev = count > 0 ? sumDev / count : 0;
            const localIntensity = Math.min(1, meanDev * 2);

            map.set(r.id, lerpHexColor('#999999', target, globalT * localIntensity));
        }
        return map;
    }, [regions, exaggeration, displayCurve]);

    const curvePoints = useMemo(
        () => computeCurvePoints({ curve: displayCurve, totalHeight, padTop, padBottom }),
        [displayCurve, totalHeight],
    );

    const curvePathD = useMemo(
        () => asPathD(displayCurve, totalHeight, padTop, padBottom),
        [displayCurve, totalHeight],
    );

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
    const baseHoveredId = lockedRegionId ?? (dragState ? dragState.sourceRegionId : hoveredRegionId);
    const effectiveHoveredIds = useMemo(() => {
        if (!baseHoveredId) return new Set<string>();
        const chain = chains.get(baseHoveredId);
        if (chain) return new Set(chain.memberIds);
        return new Set([baseHoveredId]);
    }, [baseHoveredId, chains]);

    const hoveredSizeFactor = baseHoveredId !== null ? (sizeFactors.get(baseHoveredId) ?? null) : null;

    const handleHoverChange = useCallback((regionId: string | null) => {
        if (dragStateRef.current) return;
        if (lockedRegionIdRef.current !== null) return;
        setHoveredRegionId(regionId);
    }, [dragStateRef, lockedRegionIdRef]);

    const handleLock = useCallback((regionId: string) => {
        if (lockedRegionIdRef.current === regionId) {
            // Already locked — clear transformer selection (back to argumentation popover)
            setActiveTransformerIds(new Set());
            return;
        }
        setLockedRegionId(regionId);
        setActiveTransformerIds(new Set());

        // Play audio for the locked region
        const ts = transformersRef.current;
        const chain = chainsRef.current.get(regionId);
        const ids = chain ? chain.memberIds : [regionId];
        const mpmIds = ts.filter(t => ids.includes(t.argumentation?.id)).flatMap(t => t.created);
        if (mpmIds.length > 0) playRef.current({ mpmIds, isolate: true, exaggerate: exaggerationRef.current });
    }, [lockedRegionIdRef, setActiveTransformerIds, transformersRef, chainsRef, playRef, exaggerationRef]);

    const handleLaneClick = useCallback((subregionId: string) => {
        const regionId = subregionToRegion.get(subregionId);
        if (regionId) setLockedRegionId(regionId);

        const ts = transformersRef.current;
        const t = ts.find(t => t.id === subregionId);
        if (t) {
            playRef.current({ mpmIds: t.created, isolate: true, exaggerate: exaggerationRef.current });
        }
    }, [subregionToRegion, exaggerationRef, playRef, transformersRef]);

    const handleArgumentationChange = useCallback(() => {
        setTransformers([...transformersRef.current]);
    }, [setTransformers, transformersRef]);

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
            let bestId: string | null = null;
            let bestSpan = Infinity;
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
                if (Math.abs(svgY - curveY) <= DROP_Y_TOLERANCE) {
                    const span = r.to - r.from;
                    if (span < bestSpan) {
                        bestSpan = span;
                        bestId = r.id;
                    }
                }
            }
            return bestId;
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

            // Prevent cycle: walk target's predecessor chain; abort if we reach source
            const regionById = new Map(regions.map(r => [r.id, r]));
            const visited = new Set<string>();
            let cur = targetId;
            while (cur) {
                if (cur === sourceId) return;
                if (visited.has(cur)) break;
                visited.add(cur);
                cur = regionById.get(cur)?.argumentation.continue ?? "";
            }

            sourceRegion.argumentation.continue = targetId;
            setTransformers([...transformers]);
        },
        [regions, transformers, setTransformers],
    );

    const unchainRegion = useCallback(
        (regionId: string) => {
            const region = regions.find(r => r.id === regionId);
            if (!region) return;
            delete region.argumentation.continue;
            setTransformers([...transformers]);
        },
        [regions, transformers, setTransformers],
    );

    const explodeRegion = useCallback(
        (regionId: string) => {
            const region = regions.find(r => r.id === regionId);
            if (!region || region.transformers.length < 2) return;
            setTransformers(transformers.map(t => {
                if (!region.transformers.some(rt => rt.id === t.id)) return t;
                return cloneTransformerWithArgumentation(t, {
                    id: v4(),
                    conclusion: { certainty: 'plausible', motivation: 'calm', id: v4() },
                    type: 'simpleArgumentation',
                });
            }));
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

    const handleUnlock = useCallback(() => {
        setLockedRegionId(null);
        stopRef.current();
        handleClearSelection();
    }, [stopRef, handleClearSelection]);

    // Lock the parent region when a single transformer is selected (e.g. from a desk click)
    useEffect(() => {
        if (activeTransformerIds.size === 1) {
            const [id] = activeTransformerIds;
            const regionId = subregionToRegion.get(id);
            if (regionId) setLockedRegionId(regionId);
        }
    }, [activeTransformerIds, subregionToRegion]);

    // Clear lock if the locked region no longer exists
    useEffect(() => {
        if (lockedRegionId && !regions.some(r => r.id === lockedRegionId)) {
            setLockedRegionId(null);
        }
    }, [lockedRegionId, regions]);

    const lockedRegion = useMemo(() => {
        if (!lockedRegionId) return null;
        return regions.find(r => r.id === lockedRegionId) ?? null;
    }, [lockedRegionId, regions]);

    const lockAnchorEl = useMemo(() => {
        if (!lockedRegion || curvePoints.length === 0) return null;
        const from = lockedRegion.from;
        const to = lockedRegion.to;

        // Estimate onion top: curve y at center minus expanded amplitude
        const sf = sizeFactors.get(lockedRegion.id) ?? 1;
        const amplitude = (6 + (30 - 6) * sf) + 12; // MIN + (BASE-MIN)*sf + HOVER_EXTRA
        const centerIdx = Math.max(0, Math.min(tickToCurveIndex((from + to) / 2, curveStep), curvePoints.length - 1));
        const onionTopY = curvePoints[centerIdx].y - amplitude;

        return {
            getBoundingClientRect: () => {
                const ctm = svgRef.current?.getScreenCTM();
                if (!ctm) return new DOMRect(0, 0, 0, 0);
                const x1 = ctm.a * from + ctm.e;
                const x2 = ctm.a * to + ctm.e;
                const y = ctm.d * onionTopY + ctm.f;
                return new DOMRect(x1, y, x2 - x1, 0);
            },
            contextElement: svgRef.current ?? undefined,
        };
    }, [lockedRegion, sizeFactors, curvePoints, curveStep, svgRef]);

    const hoveredRegion = useMemo(() => {
        if (!hoveredRegionId || lockedRegionId) return null;
        return regions.find(r => r.id === hoveredRegionId) ?? null;
    }, [hoveredRegionId, lockedRegionId, regions]);

    const hoverAnchorEl = useMemo(() => {
        if (!hoveredRegion || curvePoints.length === 0) return null;
        const from = hoveredRegion.from;
        const to = hoveredRegion.to;

        const sf = sizeFactors.get(hoveredRegion.id) ?? 1;
        const amplitude = (6 + (30 - 6) * sf) + 12;
        const centerIdx = Math.max(0, Math.min(tickToCurveIndex((from + to) / 2, curveStep), curvePoints.length - 1));
        const onionTopY = curvePoints[centerIdx].y - amplitude;

        return {
            getBoundingClientRect: () => {
                const ctm = svgRef.current?.getScreenCTM();
                if (!ctm) return new DOMRect(0, 0, 0, 0);
                const x1 = ctm.a * from + ctm.e;
                const x2 = ctm.a * to + ctm.e;
                const y = ctm.d * onionTopY + ctm.f;
                return new DOMRect(x1, y, x2 - x1, 0);
            },
            contextElement: svgRef.current ?? undefined,
        };
    }, [hoveredRegion, sizeFactors, curvePoints, curveStep, svgRef]);

    if (transformers.length === 0) return null;

    return (
        <Card
            ref={scrollContainerRef}
            tabIndex={-1}
            onMouseDown={(e) => e.currentTarget.focus()}
            onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    handleUnlock();
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
                        onClick={handleUnlock}
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
                            if (a.id === lockedRegionId) return 1;
                            if (b.id === lockedRegionId) return -1;
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
                                hoveredSizeFactor={lockedRegionId !== null ? null : hoveredSizeFactor}
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
                                onRegionDragStart={draggable ? handleRegionDragStart : undefined}
                                isLocked={lockedRegionId === region.id}
                                onLock={handleLock}
                                onUnchain={draggable && region.argumentation.continue ? unchainRegion : undefined}
                                onExplode={draggable && region.subregions.length >= 2 ? explodeRegion : undefined}
                                editable={draggable}
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
            {lockedRegion && lockAnchorEl && (draggable || activeTransformerIds.size === 0) && (
                <ArgumentationPopover
                    argumentation={lockedRegion.argumentation}
                    anchorEl={lockAnchorEl}
                    onArgumentationChange={handleArgumentationChange}
                />
            )}
            {hoveredRegion && hoverAnchorEl && (
                <ArgumentationTooltip
                    argumentation={hoveredRegion.argumentation}
                    anchorEl={hoverAnchorEl}
                />
            )}
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
