import { Card } from "@mui/material";
import { useCallback, useDeferredValue, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { useLatest } from "../hooks/useLatest";
import { useSymbolicZoom } from "../hooks/ZoomProvider";
import { useScrollSync } from "../hooks/ScrollSyncProvider";
import type { PerformanceReader } from "../utils/mpm";
import type { Segment } from "../model/Reconstruction";
import { applyExaggeration, applyLocalRenormalization, asPathD, negotiateIntensityCurve } from "../utils/intensityCurve";
import { useSelection } from "../hooks/SelectionProvider";
import { EXAGGERATION_MAX, PlaybackNoteEvent, usePlayback } from "../hooks/PlaybackProvider";
import { BarLines } from "./BarLines";
import { buildChains, ChainInfo, computeCurvePoints, computeLodOpacities, pointSpanFallback, tickToCurveIndex } from "./OnionModel";
import { SegmentOnion } from "./SegmentOnion";
import { InstructionPopover } from "./InstructionPopover";
import { SegmentPopover } from "./SegmentPopover";

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

function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const item of a) {
        if (!b.has(item)) return false;
    }
    return true;
}

interface SegmentStackProps {
    segments: Segment[];
    mpm: PerformanceReader;
}

export const SegmentStack = ({ segments, mpm }: SegmentStackProps) => {
    const { play, stop, exaggeration, isPlaying, subscribeNoteEvents } = usePlayback();
    const { activeSpanIds, setActiveSpanIds } = useSelection();
    const stretchX = useSymbolicZoom();

    const svgRef = useRef<SVGSVGElement>(null);
    const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);
    const [lockedSegmentIds, setLockedSegmentIds] = useState<Set<string>>(new Set());
    const lockedSegmentIdsRef = useLatest(lockedSegmentIds);
    const playRef = useLatest(play);
    const stopRef = useLatest(stop);
    const exaggerationRef = useLatest(exaggeration);

    // Scroll sync
    const { register, unregister, scrollToDate } = useScrollSync();
    const scrollContainerRef = useCallback((element: HTMLDivElement | null) => {
        if (element) {
            register('segment-stack', element);
        } else {
            unregister('segment-stack');
        }
    }, [register, unregister]);

    const maxDate = useMemo(
        () => segments.reduce((max, segment) => Math.max(max, segment.to), 0),
        [segments],
    );
    const maxX = maxDate * stretchX;

    const totalHeight = 300;
    const padTop = 40;
    const padBottom = 40;

    const chains = useMemo(() => buildChains(segments), [segments]);
    const chainsRef = useLatest(chains);

    const chainNeighborBounds = useMemo(() => {
        const map = new Map<string, { prevTo?: number; nextFrom?: number }>();
        const segmentById = new Map(segments.map(s => [s.id, s]));
        const seen = new Set<ChainInfo>();
        for (const chain of chains.values()) {
            if (seen.has(chain)) continue;
            seen.add(chain);
            for (let i = 0; i < chain.memberIds.length; i++) {
                const id = chain.memberIds[i];
                const bounds: { prevTo?: number; nextFrom?: number } = {};
                if (i > 0) {
                    const prev = segmentById.get(chain.memberIds[i - 1]);
                    if (prev) bounds.prevTo = prev.to;
                }
                if (i < chain.memberIds.length - 1) {
                    const next = segmentById.get(chain.memberIds[i + 1]);
                    if (next) bounds.nextFrom = next.from;
                }
                map.set(id, bounds);
            }
        }
        return map;
    }, [segments, chains]);

    const sizeFactors = useMemo(() => {
        // For chained segments, use the chain's total span
        const effectiveSpans = new Map<string, number>();
        for (const s of segments) {
            const chain = chains.get(s.id);
            effectiveSpans.set(s.id, chain ? chain.chainTo - chain.chainFrom : s.to - s.from);
        }
        const maxSpan = Math.max(1, ...effectiveSpans.values());
        const map = new Map<string, number>();
        for (const [id, span] of effectiveSpans) {
            map.set(id, span / maxSpan);
        }
        return map;
    }, [segments, chains]);

    const spanToSegment = useMemo(() => {
        const map = new Map<string, string>();
        for (const s of segments) {
            for (const span of s.spans) {
                map.set(span.id, s.id);
            }
        }
        return map;
    }, [segments]);

    /** MPM element id → the segment that claims it, for following playback. */
    const elementToSegment = useMemo(() => {
        const map = new Map<string, string>();
        for (const s of segments) {
            for (const span of s.spans) {
                for (const element of span.elements) map.set(element, s.id);
            }
        }
        return map;
    }, [segments]);

    const minPointSpan = useMemo(() => pointSpanFallback(segments), [segments]);

    const lodOpacities = useMemo(
        () => computeLodOpacities({ segments, chains, stretchX, minPointSpan }),
        [segments, chains, stretchX, minPointSpan],
    );

    // Stabilize lodOpacities reference: keep previous Map when values are identical,
    // preventing useDeferredValue from scheduling redundant re-renders.
    const lodOpacitiesRef = useRef(lodOpacities);
    if (lodOpacities !== lodOpacitiesRef.current) {
        let changed = lodOpacities.size !== lodOpacitiesRef.current.size;
        if (!changed) {
            for (const [id, val] of lodOpacities) {
                if (lodOpacitiesRef.current.get(id) !== val) { changed = true; break; }
            }
        }
        if (changed) lodOpacitiesRef.current = lodOpacities;
    }
    const stableLodOpacities = lodOpacitiesRef.current;

    const deferredLodOpacities = useDeferredValue(stableLodOpacities);

    const scaled = useMemo(
        () => negotiateIntensityCurve(segments, maxDate, deferredLodOpacities),
        [segments, maxDate, deferredLodOpacities],
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

    const segmentColors = useMemo(() => {
        const globalT = Math.min(1, (exaggeration - 1) / (EXAGGERATION_MAX - 1));
        const { values, step } = displayCurve;
        const map = new Map<string, string>();
        for (const s of segments) {
            const warm = s.motivation === 'intensify' || s.motivation === 'move';
            const target = warm ? '#c0392b' : '#2980b9';

            // Per-segment saturation: how far the exaggerated curve deviates
            // from the midline within this segment's tick range
            const fromIdx = Math.max(0, Math.min(tickToCurveIndex(s.from, step), values.length - 1));
            const toIdx = Math.max(0, Math.min(tickToCurveIndex(s.to, step), values.length - 1));
            let sumDev = 0;
            let count = 0;
            for (let i = fromIdx; i <= toIdx; i++) {
                sumDev += Math.abs(values[i] - 0.5);
                count++;
            }
            const meanDev = count > 0 ? sumDev / count : 0;
            const localIntensity = Math.min(1, meanDev * 2);

            map.set(s.id, lerpHexColor('#999999', target, globalT * localIntensity));
        }
        return map;
    }, [segments, exaggeration, displayCurve]);

    const curvePointsRaw = useMemo(
        () => computeCurvePoints({ curve: displayCurve, totalHeight, padTop, padBottom }),
        [displayCurve, totalHeight],
    );
    // Stabilize reference: keep previous array if values are identical.
    // This prevents all ~128 SegmentOnion children from re-rendering when
    // the curve recomputes to the same result.
    const curvePointsRef = useRef(curvePointsRaw);
    if (
        curvePointsRaw !== curvePointsRef.current &&
        (curvePointsRaw.length !== curvePointsRef.current.length ||
            curvePointsRaw.some((p, i) => p.x !== curvePointsRef.current[i].x || p.y !== curvePointsRef.current[i].y))
    ) {
        curvePointsRef.current = curvePointsRaw;
    }
    const curvePoints = curvePointsRef.current;

    const curvePathD = useMemo(
        () => asPathD(displayCurve, totalHeight, padTop, padBottom),
        [displayCurve, totalHeight],
    );

    // Expand to all chain members when hovering a chained segment.
    // When locked, all locked segments count as hovered.
    const baseHoveredId = lockedSegmentIds.size === 0 ? hoveredSegmentId : null;
    const effectiveHoveredIds = useMemo(() => {
        if (lockedSegmentIds.size > 0) return lockedSegmentIds;
        if (!baseHoveredId) return new Set<string>();
        const chain = chains.get(baseHoveredId);
        if (chain) return new Set(chain.memberIds);
        return new Set([baseHoveredId]);
    }, [lockedSegmentIds, baseHoveredId, chains]);

    const hoveredSizeFactor = baseHoveredId !== null ? (sizeFactors.get(baseHoveredId) ?? null) : null;

    const handleHoverChange = useCallback((segmentId: string | null) => {
        if (lockedSegmentIdsRef.current.size > 0) return;
        setHoveredSegmentId(segmentId);
    }, [lockedSegmentIdsRef]);

    const segmentsRef = useLatest(segments);

    const handleLock = useCallback((segmentId: string) => {
        if (lockedSegmentIdsRef.current.has(segmentId)) {
            // Already locked — clear span selection (back to the segment popover)
            setActiveSpanIds(new Set());
            return;
        }
        const chain = chainsRef.current.get(segmentId);
        const ids = chain ? chain.memberIds : [segmentId];
        setLockedSegmentIds(new Set(ids));
        setActiveSpanIds(new Set());

        // Play audio for the locked segment (all chain members)
        const mpmIds = segmentsRef.current
            .filter(s => ids.includes(s.id))
            .flatMap(s => s.spans.flatMap(span => span.elements));
        if (mpmIds.length > 0) playRef.current({ mpmIds, isolate: true, exaggerate: exaggerationRef.current });
    }, [lockedSegmentIdsRef, setActiveSpanIds, segmentsRef, chainsRef, playRef, exaggerationRef]);

    const handleLaneClick = useCallback((spanId: string) => {
        const segmentId = spanToSegment.get(spanId);
        if (segmentId) {
            const chain = chainsRef.current.get(segmentId);
            const ids = chain ? chain.memberIds : [segmentId];
            setLockedSegmentIds(new Set(ids));
        }

        const span = segmentsRef.current.flatMap(s => s.spans).find(s => s.id === spanId);
        if (span) {
            playRef.current({ mpmIds: span.elements, isolate: true, exaggerate: exaggerationRef.current });
        }
    }, [spanToSegment, chainsRef, exaggerationRef, playRef, segmentsRef]);

    // Mask gap for intensity curve under hovered segment
    const maskId = useId();
    const curveStep = scaled.step;

    const maskGap = useMemo(() => {
        if (effectiveHoveredIds.size === 0 || curvePoints.length === 0) return null;
        // Span the full range of all hovered segments (chain-expanded)
        let minFrom = Infinity;
        let maxTo = -Infinity;
        for (const id of effectiveHoveredIds) {
            const s = segments.find(s => s.id === id);
            if (s) {
                minFrom = Math.min(minFrom, s.from);
                maxTo = Math.max(maxTo, s.to);
            }
        }
        if (minFrom === Infinity) return null;
        const f = Math.max(0, Math.min(tickToCurveIndex(minFrom, curveStep), curvePoints.length - 1));
        const t = Math.max(0, Math.min(tickToCurveIndex(maxTo, curveStep), curvePoints.length - 1));
        if (t <= f) return null;
        return { x1: curvePoints[f].x, x2: curvePoints[t].x };
    }, [effectiveHoveredIds, segments, curvePoints, curveStep]);

    const handleClearSelection = useCallback(() => {
        setActiveSpanIds(new Set());
        const currentHash = window.location.hash.slice(1);
        if (currentHash) {
            history.pushState(null, '', window.location.pathname + window.location.search);
        }
    }, [setActiveSpanIds]);

    const handleUnlock = useCallback(() => {
        setLockedSegmentIds(new Set());
        setHoveredSegmentId(null);
        stopRef.current();
        handleClearSelection();
    }, [stopRef, handleClearSelection]);

    // Lock the parent segment when a single span is selected
    useEffect(() => {
        if (activeSpanIds.size === 1) {
            const [id] = activeSpanIds;
            const segmentId = spanToSegment.get(id);
            if (segmentId) {
                const chain = chains.get(segmentId);
                const ids = chain ? chain.memberIds : [segmentId];
                setLockedSegmentIds(new Set(ids));
            }
        }
    }, [activeSpanIds, spanToSegment, chains]);

    // Follow playback: open (lock) the segments whose instructions are currently
    // sounding, so their labels show while the playhead passes through them.
    // While listening, a chain must not open as a whole: an instruction of an
    // earlier chain member can still be "in effect" past that member's span,
    // so per chain only the member the playhead is actually in stays open
    // (falling back to the latest member that has already begun).
    const followPlayback = useEffectEvent(({ date, scoped }: PlaybackNoteEvent) => {
        // Segment previews (lock/lane clicks) manage the lock themselves.
        if (scoped) return;
        const types = ['tempo', 'dynamics', 'rubato', 'articulation', 'asynchrony', 'movement', 'ornament', 'accentuationPattern'] as const;
        const segmentIds = new Set<string>();
        for (const type of types) {
            for (const instruction of mpm.effectiveAt(date, type)) {
                const segmentId = elementToSegment.get(instruction.id);
                if (segmentId) segmentIds.add(segmentId);
            }
        }

        const candidatesByChain = new Map<ChainInfo, string[]>();
        for (const id of segmentIds) {
            const chain = chains.get(id);
            if (!chain) continue;
            const list = candidatesByChain.get(chain);
            if (list) list.push(id);
            else candidatesByChain.set(chain, [id]);
        }
        const segmentById = new Map(segments.map(s => [s.id, s]));
        const laterMember = (a: string, b: string) =>
            (segmentById.get(a)?.from ?? -Infinity) >= (segmentById.get(b)?.from ?? -Infinity) ? a : b;
        for (const candidates of candidatesByChain.values()) {
            if (candidates.length < 2) continue;
            const containing = candidates.filter(id => {
                const s = segmentById.get(id);
                return s !== undefined && s.from <= date && date <= s.to;
            });
            const begun = candidates.filter(id => (segmentById.get(id)?.from ?? Infinity) <= date);
            const keep = containing.length > 0
                ? containing.reduce(laterMember)
                : (begun.length > 0 ? begun.reduce(laterMember) : candidates[0]);
            for (const id of candidates) {
                if (id !== keep) segmentIds.delete(id);
            }
        }

        if (segmentIds.size > 0) {
            setLockedSegmentIds(prev => setsEqual(prev, segmentIds) ? prev : segmentIds);
        }
        scrollToDate(date);
    });

    useEffect(() => subscribeNoteEvents(followPlayback), [subscribeNoteEvents]);

    // Close playback-opened segments when playback stops
    useEffect(() => {
        if (!isPlaying) {
            setLockedSegmentIds(prev => (prev.size > 0 ? new Set() : prev));
        }
    }, [isPlaying]);

    const lockedSegments = useMemo(() => {
        if (lockedSegmentIds.size === 0) return [];
        return segments.filter(s => lockedSegmentIds.has(s.id));
    }, [lockedSegmentIds, segments]);

    /**
     * Anchor a popover above the onions of the given segments.
     * Positions are read from the live CTM, so the popover follows zoom and scroll.
     */
    const anchorFor = useCallback((anchored: Segment[]) => {
        if (anchored.length === 0 || curvePoints.length === 0) return null;
        const from = Math.min(...anchored.map(s => s.from));
        const to = Math.max(...anchored.map(s => s.to));
        let minOnionTopY = Infinity;
        for (const segment of anchored) {
            const sf = sizeFactors.get(segment.id) ?? 1;
            const amplitude = (6 + (30 - 6) * sf) + 12;
            const centerIdx = Math.max(0, Math.min(tickToCurveIndex((segment.from + segment.to) / 2, curveStep), curvePoints.length - 1));
            minOnionTopY = Math.min(minOnionTopY, curvePoints[centerIdx].y - amplitude);
        }
        return {
            getBoundingClientRect: () => {
                const ctm = svgRef.current?.getScreenCTM();
                if (!ctm) return new DOMRect(0, 0, 0, 0);
                const x1 = ctm.a * from + ctm.e;
                const x2 = ctm.a * to + ctm.e;
                const y = ctm.d * minOnionTopY + ctm.f;
                return new DOMRect(x1, y, x2 - x1, 0);
            },
            contextElement: svgRef.current ?? undefined,
        };
    }, [sizeFactors, curvePoints, curveStep]);

    const lockAnchorEl = useMemo(() => anchorFor(lockedSegments), [anchorFor, lockedSegments]);

    const hoveredSegments = useMemo(() => {
        if (!hoveredSegmentId || lockedSegmentIds.size > 0) return [];
        const chain = chains.get(hoveredSegmentId);
        const ids = chain ? chain.memberIds : [hoveredSegmentId];
        return segments.filter(s => ids.includes(s.id));
    }, [hoveredSegmentId, lockedSegmentIds, segments, chains]);

    const hoverAnchorEl = useMemo(() => anchorFor(hoveredSegments), [anchorFor, hoveredSegments]);

    if (segments.length === 0) return null;

    return (
        <Card
            ref={scrollContainerRef}
            tabIndex={-1}
            onMouseDown={(e) => e.currentTarget.focus()}
            onKeyDown={(e) => {
                if (e.key === 'Escape') handleUnlock();
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
            <div style={{ position: "relative", width: maxX, height: totalHeight }}>
                <svg
                    width={maxX}
                    height={totalHeight}
                    ref={svgRef}
                    style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
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

                    {/* Segment onions — largest first so smaller ones render on top */}
                    {[...segments]
                        .sort((a, b) => {
                            const aLocked = lockedSegmentIds.has(a.id);
                            const bLocked = lockedSegmentIds.has(b.id);
                            if (aLocked && !bLocked) return 1;
                            if (!aLocked && bLocked) return -1;
                            return (b.to - b.from) - (a.to - a.from);
                        })
                        .filter(segment => (lodOpacities.get(segment.id) ?? 0) > 0 || lockedSegmentIds.has(segment.id))
                        .map(segment => (
                            <SegmentOnion
                                key={segment.id}
                                segment={segment}
                                curvePoints={curvePoints}
                                curveStep={curveStep}
                                stretchX={stretchX}
                                segmentColor={segmentColors.get(segment.id) ?? '#999999'}
                                sizeFactor={sizeFactors.get(segment.id) ?? 1}
                                lodOpacity={lockedSegmentIds.has(segment.id) ? 1 : (lodOpacities.get(segment.id) ?? 1)}
                                isHovered={effectiveHoveredIds.has(segment.id)}
                                suppressHitArea={
                                    lockedSegmentIds.size === 0 &&
                                    hoveredSizeFactor !== null &&
                                    !effectiveHoveredIds.has(segment.id) &&
                                    (sizeFactors.get(segment.id) ?? 1) >= hoveredSizeFactor
                                }
                                hasActiveSpan={segment.spans.some(span => activeSpanIds.has(span.id))}
                                chainFrom={chains.get(segment.id)?.chainFrom}
                                chainTo={chains.get(segment.id)?.chainTo}
                                prevChainMemberTo={chainNeighborBounds.get(segment.id)?.prevTo}
                                nextChainMemberFrom={chainNeighborBounds.get(segment.id)?.nextFrom}
                                onHoverChange={handleHoverChange}
                                onLaneClick={handleLaneClick}
                                isLocked={lockedSegmentIds.has(segment.id)}
                                onLock={handleLock}
                            />
                        ))}

                    {/* Intensity curve on top, masked under hovered segment */}
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
                </svg>
            </div>
            {lockedSegments.length > 0 && lockAnchorEl && activeSpanIds.size === 0 && (
                <SegmentPopover segments={lockedSegments} anchorEl={lockAnchorEl} />
            )}
            {hoveredSegments.length > 0 && hoverAnchorEl && (
                <SegmentPopover segments={hoveredSegments} anchorEl={hoverAnchorEl} transient />
            )}
            {activeSpanIds.size === 1 && (
                <InstructionPopover
                    mpm={mpm}
                    activeSpanIds={activeSpanIds}
                    svgRef={svgRef}
                />
            )}
        </Card>
    );
};
