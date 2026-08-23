import { Card } from "@mui/material";
import { useCallback, useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useLatest } from "../hooks/useLatest";
import { useSymbolicZoom } from "../hooks/ZoomProvider";
import { useScrollSync } from "../hooks/ScrollSyncProvider";
import type { PerformanceReader } from "../utils/mpm";
import type { Segment } from "../model/Reconstruction";
import { useSelection } from "../hooks/SelectionProvider";
import { PlaybackNoteEvent, usePlayback } from "../hooks/PlaybackProvider";
import { BarLines } from "./BarLines";
import { buildChains, ChainInfo, containmentDepths, fadeOpacities, LabelPlacement, LINE_HEIGHT_RATIO, packLabels, packZoom, pointSpanFallback, tickRange, treeGeometry, typeScale } from "./StackModel";
import { SegmentLabel, SpanRibbon } from "./SegmentLabel";
import { useTickAnchors } from "./useTickAnchors";
import { wordFor, wordWidth } from "./words";
import { InstructionPopover } from "./InstructionPopover";
import { SegmentPopover } from "./SegmentPopover";

function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const item of a) {
        if (!b.has(item)) return false;
    }
    return true;
}

/**
 * The viewport the tree sits in.
 *
 * The tree is meant to be read whole at whatever place you have zoomed in to,
 * so the card takes the window rather than a polite share of it — the branches
 * bend flat precisely so they fit inside this (see `arcOf`). It still scrolls,
 * for the zoomed-right-out view where a hundred-odd gestures genuinely will not
 * fit on a screen at any legible size.
 */
const MAX_CARD_HEIGHT = '94vh';
const MIN_CANVAS_HEIGHT = 260;
/** How much of the exaggeration slider's travel goes into the size of the writing. */
const EXAG_TYPE_GROWTH = 0.7;
/** How far the rest of the tree steps back while one word is spotlit. */
const OTHERS_DIM = 0.35;

interface SegmentStackProps {
    segments: Segment[];
    mpm: PerformanceReader;
}

export const SegmentStack = ({ segments, mpm }: SegmentStackProps) => {
    const { play, stop, exaggeration, isPlaying, subscribeNoteEvents } = usePlayback();
    const { activeSpanIds, setActiveSpanIds } = useSelection();
    const stretchX = useSymbolicZoom();

    const svgRef = useRef<SVGSVGElement>(null);
    const cardRef = useRef<HTMLDivElement | null>(null);
    const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);
    const [lockedSegmentIds, setLockedSegmentIds] = useState<Set<string>>(new Set());
    const lockedSegmentIdsRef = useLatest(lockedSegmentIds);
    /**
     * Who opened the segments that are open.
     *
     * Playback opens them as the playhead passes and they close again when it stops. A click opens
     * one deliberately, and its preview stops on its own after a few seconds — the spotlight has to
     * outlive the sound, or clicking a word would light it up and then drop it.
     */
    const lockOriginRef = useRef<'user' | 'playback'>('playback');
    const playRef = useLatest(play);
    const stopRef = useLatest(stop);
    const exaggerationRef = useLatest(exaggeration);

    // Scroll sync
    const { register, unregister, scrollToDate } = useScrollSync();
    const scrollContainerRef = useCallback((element: HTMLDivElement | null) => {
        cardRef.current = element;
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
    /**
     * Zoom, twice over: where the branches sit, and how they are stacked.
     *
     * Sliding 128 words along the line is one transform each and the browser
     * does that at frame rate, so position follows the slider exactly — which
     * is what makes a drag feel attached to the hand. Stacking them is the
     * expensive half, so it answers to a rung of {@link packZoom} instead, and
     * at low priority: between rungs the tree keeps its shape and simply
     * stretches, and React builds the next one without blocking the drag.
     *
     * The two never disagree, because a placement holds no zoom of its own —
     * only a tick, a lean, and a distance from the line.
     *
     * The rung is what is deferred, not the zoom: deferring the zoom itself
     * would schedule a second pass over the tree on every step of a drag, to
     * arrive at the same rung it already had.
     */
    const packStretchX = useDeferredValue(packZoom(stretchX));
    const maxX = maxDate * stretchX;

    const chains = useMemo(() => buildChains(segments), [segments]);
    const chainsRef = useLatest(chains);

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
    const minPointSpanRef = useLatest(minPointSpan);

    /**
     * How solid each word reads. On the packing rung rather than the live zoom,
     * so the tree does not change colour under a drag — and so this stays the
     * same object between rungs, which is what keeps 128 memo'd labels from
     * re-rendering for it.
     */
    const opacities = useMemo(
        () => fadeOpacities({ segments, chains, stretchX: packStretchX, minPointSpan }),
        [segments, chains, packStretchX, minPointSpan],
    );

    const depths = useMemo(() => containmentDepths(segments), [segments]);

    /** Exaggeration is the size of the writing now there is nothing else to grow. */
    const fontScale = 1 + (exaggeration - 1) * EXAG_TYPE_GROWTH;

    /** How big each word is set — the longer the gesture, the larger the type. */
    const fontSizes = useMemo(
        () => typeScale({
            segments,
            minPointSpan,
            fontScale,
            charsOf: s => wordFor(s).length,
        }),
        [segments, minPointSpan, fontScale],
    );

    const labels = useMemo(
        () => packLabels({
            segments,
            depths,
            minPointSpan,
            stretchX: packStretchX,
            metricsOf: s => {
                const fontSize = fontSizes.get(s.id) ?? 11;
                return {
                    length: wordWidth(s, fontSize),
                    lineHeight: fontSize * LINE_HEIGHT_RATIO,
                };
            },
        }),
        [segments, depths, minPointSpan, packStretchX, fontSizes],
    );

    const { totalHeight, centreY } = useMemo(
        () => treeGeometry({ labels, minHeight: MIN_CANVAS_HEIGHT }),
        [labels],
    );

    /** Everything pinned to a tick — the branch feet and the bar numbers — slides from here. */
    const anchorRef = useTickAnchors(stretchX);

    /**
     * Keep the line in the middle of the window when the tree outgrows it.
     *
     * The branches reach a long way in both directions, so a tree taller than
     * its card would otherwise open showing only the top of it. This runs when
     * the geometry changes — a zoom or the exaggeration knob — which is exactly
     * when the reader expects the view to resettle, and leaves manual scrolling
     * alone in between.
     */
    useEffect(() => {
        const card = cardRef.current;
        if (!card) return;
        const overflow = totalHeight - card.clientHeight;
        if (overflow <= 0) return;
        card.scrollTop = Math.max(0, Math.min(overflow, centreY - card.clientHeight / 2));
    }, [totalHeight, centreY]);

    const labelById = useMemo(() => {
        const map = new Map<string, LabelPlacement>();
        for (const label of labels) map.set(label.segment.id, label);
        return map;
    }, [labels]);

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
        lockOriginRef.current = 'user';
        setLockedSegmentIds(new Set(ids));
        setActiveSpanIds(new Set());

        // Preview the locked segment: its own stretch of music, spotlit, and nothing else. The
        // whole chain, because a chain is one gesture and the words light up together.
        const members = segmentsRef.current.filter(s => ids.includes(s.id));
        const mpmIds = members.flatMap(s => s.spans.flatMap(span => span.elements));
        if (mpmIds.length > 0) {
            const ranges = members.map(s => tickRange(s, minPointSpanRef.current));
            playRef.current({
                mpmIds,
                isolate: true,
                exaggerate: exaggerationRef.current,
                range: {
                    from: Math.min(...ranges.map(r => r.from)),
                    to: Math.max(...ranges.map(r => r.to)),
                },
            });
        }
    }, [lockedSegmentIdsRef, setActiveSpanIds, segmentsRef, chainsRef, playRef, exaggerationRef, minPointSpanRef]);

    const handleLaneClick = useCallback((spanId: string) => {
        const segmentId = spanToSegment.get(spanId);
        if (segmentId) {
            const chain = chainsRef.current.get(segmentId);
            const ids = chain ? chain.memberIds : [segmentId];
            lockOriginRef.current = 'user';
            setLockedSegmentIds(new Set(ids));
        }

        const span = segmentsRef.current.flatMap(s => s.spans).find(s => s.id === spanId);
        if (span) {
            playRef.current({
                mpmIds: span.elements,
                isolate: true,
                exaggerate: exaggerationRef.current,
                range: tickRange(span, minPointSpanRef.current),
            });
        }
    }, [spanToSegment, chainsRef, exaggerationRef, playRef, segmentsRef, minPointSpanRef]);

    const handleClearSelection = useCallback(() => {
        setActiveSpanIds(new Set());
        const currentHash = window.location.hash.slice(1);
        if (currentHash) {
            history.pushState(null, '', window.location.pathname + window.location.search);
        }
    }, [setActiveSpanIds]);

    const handleUnlock = useCallback(() => {
        lockOriginRef.current = 'playback';
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
                lockOriginRef.current = 'user';
                setLockedSegmentIds(new Set(ids));
            }
        }
    }, [activeSpanIds, spanToSegment, chains]);

    // Follow playback: open (lock) the segments whose instructions are currently
    // sounding, so their words show while the playhead passes through them.
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
            lockOriginRef.current = 'playback';
            setLockedSegmentIds(prev => setsEqual(prev, segmentIds) ? prev : segmentIds);
        }
        scrollToDate(date);
    });

    useEffect(() => subscribeNoteEvents(followPlayback), [subscribeNoteEvents]);

    // Close playback-opened segments when playback stops — but leave a clicked one open. A
    // segment preview stops itself at the end of its own stretch of music, and the reader is
    // still looking at the word they clicked.
    useEffect(() => {
        if (!isPlaying && lockOriginRef.current === 'playback') {
            setLockedSegmentIds(prev => (prev.size > 0 ? new Set() : prev));
        }
    }, [isPlaying]);

    /**
     * Anchor a popover at the foot of the given segments' branches.
     * Positions are read from the live CTM, so the popover follows zoom and scroll.
     *
     * Every segment is drawn now, so a placement is always there to anchor to —
     * but playback can still name a segment while the tree is re-packing, so the
     * lookup stays guarded.
     */
    const anchorFor = useCallback((anchored: Segment[]) => {
        const placed = anchored.map(s => labelById.get(s.id)).filter(l => l !== undefined);
        if (placed.length === 0) return null;
        const from = Math.min(...placed.map(l => l.tick));
        const to = Math.max(...placed.map(l => l.tick + l.length / stretchX));
        // Sit above the highest foot, or below the lowest, so the card never
        // covers the word it is describing.
        const leansUp = placed.some(l => l.side === -1);
        const y = leansUp
            ? centreY - Math.max(...placed.filter(l => l.side === -1).map(l => l.offset))
            : centreY + Math.max(...placed.map(l => l.offset));
        return {
            getBoundingClientRect: () => {
                const ctm = svgRef.current?.getScreenCTM();
                if (!ctm) return new DOMRect(0, 0, 0, 0);
                const x1 = ctm.a * from + ctm.e;
                const x2 = ctm.a * to + ctm.e;
                return new DOMRect(x1, ctm.d * y + ctm.f, x2 - x1, 0);
            },
            contextElement: svgRef.current ?? undefined,
        };
    }, [labelById, centreY, stretchX]);

    const lockedSegments = useMemo(() => {
        if (lockedSegmentIds.size === 0) return [];
        return segments.filter(s => lockedSegmentIds.has(s.id));
    }, [lockedSegmentIds, segments]);

    const lockAnchorEl = useMemo(() => anchorFor(lockedSegments), [anchorFor, lockedSegments]);

    const hoveredSegments = useMemo(() => {
        if (!hoveredSegmentId || lockedSegmentIds.size > 0) return [];
        const chain = chains.get(hoveredSegmentId);
        const ids = chain ? chain.memberIds : [hoveredSegmentId];
        return segments.filter(s => ids.includes(s.id));
    }, [hoveredSegmentId, lockedSegmentIds, segments, chains]);

    const hoverAnchorEl = useMemo(() => anchorFor(hoveredSegments), [anchorFor, hoveredSegments]);

    /**
     * The tree, split into what is spotlit and what is stepping back.
     *
     * The dim is one `opacity` on the group rather than one per word: a group
     * opacity below 1 costs the browser an offscreen buffer, and paying that 128
     * times on every hover is what made the view crawl. It also means hovering
     * re-renders the one word that moved between the groups, not all of them.
     */
    const [dimmed, spotlit] = useMemo(() => {
        const lit: typeof labels = [];
        const rest: typeof labels = [];
        for (const label of labels) {
            (effectiveHoveredIds.has(label.segment.id) ? lit : rest).push(label);
        }
        return [rest, lit];
    }, [labels, effectiveHoveredIds]);

    /** Segments the reader has opened, and the way their word leans. */
    const openSegments = useMemo(() => {
        const open = segments.filter(s =>
            lockedSegmentIds.has(s.id) || s.spans.some(span => activeSpanIds.has(span.id)));
        return open.map(segment => ({
            segment,
            side: labelById.get(segment.id)?.side ?? (1 as -1 | 1),
        }));
    }, [segments, lockedSegmentIds, activeSpanIds, labelById]);

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
                height: `min(${Math.max(MIN_CANVAS_HEIGHT, totalHeight)}px, ${MAX_CARD_HEIGHT})`,
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
                        stretchX={packStretchX}
                        height={totalHeight}
                        anchorRef={anchorRef}
                    />

                    <g
                        opacity={spotlit.length > 0 ? OTHERS_DIM : 1}
                        style={{ transition: "opacity 0.18s ease" }}
                    >
                        {dimmed.map(label => (
                            <SegmentLabel
                                key={label.segment.id}
                                segment={label.segment}
                                footRef={anchorRef(label.tick)}
                                side={label.side}
                                offset={label.offset}
                                centreY={centreY}
                                fontSize={label.fontSize}
                                length={label.length}
                                opacity={opacities.get(label.segment.id) ?? 1}
                                isHovered={false}
                                isLocked={false}
                                hasActiveSpan={false}
                                onHoverChange={handleHoverChange}
                                onLock={handleLock}
                            />
                        ))}
                    </g>

                    {/* Spotlit words draw last, above the ones stepping back */}
                    {spotlit.map(label => (
                        <SegmentLabel
                            key={label.segment.id}
                            segment={label.segment}
                            footRef={anchorRef(label.tick)}
                            side={label.side}
                            offset={label.offset}
                            centreY={centreY}
                            fontSize={label.fontSize}
                            length={label.length}
                            opacity={1}
                            isHovered
                            isLocked={lockedSegmentIds.has(label.segment.id)}
                            hasActiveSpan={label.segment.spans.some(span => activeSpanIds.has(span.id))}
                            onHoverChange={handleHoverChange}
                            onLock={handleLock}
                        />
                    ))}

                    {/* What an opened segment is made of, down on the line itself */}
                    {openSegments.map(({ segment, side }) => {
                        const { from, to } = tickRange(segment, minPointSpan);
                        return (
                            <SpanRibbon
                                key={segment.id}
                                segment={segment}
                                from={from}
                                to={to}
                                centreY={centreY}
                                side={side}
                                stretchX={stretchX}
                                onLaneClick={handleLaneClick}
                            />
                        );
                    })}

                    {/* The centre line the story is told around */}
                    <line
                        className="centreLine"
                        x1={0}
                        y1={centreY}
                        x2={maxDate}
                        y2={centreY}
                        stroke="#9ca3af"
                        strokeWidth={1}
                        pointerEvents="none"
                        vectorEffect="non-scaling-stroke"
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
