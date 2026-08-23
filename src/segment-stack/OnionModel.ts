import type { Segment, Span } from "../model/Reconstruction";
import type { IntensityCurve } from "../utils/intensityCurve";

export type CurvePoint = { x: number; y: number };

/** Convert the downsampled intensity curve to SVG curve points, in tick space. */
export function computeCurvePoints(params: {
    curve: IntensityCurve;
    totalHeight: number;
    padTop?: number;
    padBottom?: number;
}): CurvePoint[] {
    const {
        curve,
        totalHeight,
        padTop = 8,
        padBottom = 8,
    } = params;

    const { values, step } = curve;
    if (values.length === 0) return [];

    const availableHeight = Math.max(1, totalHeight - padTop - padBottom);
    const toY = (s: number) => padTop + (1 - s) * availableHeight;

    return values.map((s, idx) => ({
        x: idx * step,
        y: toY(s),
    }));
}

/** Map a tick index to the nearest downsampled curve point index. */
export function tickToCurveIndex(tick: number, step: number): number {
    return Math.round(tick / step);
}

export type ChainInfo = {
    chainFrom: number;   // earliest tick in the chain
    chainTo: number;     // latest tick in the chain
    memberIds: string[]; // ordered segment ids in the chain
};

/**
 * Walk `continue` links to group segments into chains.
 * Returns a map from segment id → ChainInfo for chained segments only.
 */
export function buildChains(segments: Segment[]): Map<string, ChainInfo> {
    const byId = new Map<string, Segment>();
    for (const s of segments) byId.set(s.id, s);

    // successorOf[predId] = segment whose `continue` === predId
    const successorOf = new Map<string, Segment>();
    for (const s of segments) {
        const predId = s.continue;
        if (predId && byId.has(predId)) {
            successorOf.set(predId, s);
        }
    }

    const visited = new Set<string>();
    const result = new Map<string, ChainInfo>();

    for (const s of segments) {
        if (visited.has(s.id)) continue;

        // Walk back to find root
        let root = s;
        const seen = new Set<string>([s.id]);
        for (; ;) {
            const predId = root.continue;
            if (!predId || !byId.has(predId) || seen.has(predId)) break;
            root = byId.get(predId)!;
            seen.add(root.id);
        }

        // Walk forward from root
        const members: Segment[] = [root];
        visited.add(root.id);
        let current = root;
        while (successorOf.has(current.id)) {
            const next = successorOf.get(current.id)!;
            if (visited.has(next.id)) break;
            members.push(next);
            visited.add(next.id);
            current = next;
        }

        if (members.length < 2) continue;

        members.sort((a, b) => a.from - b.from);
        const chainFrom = Math.min(...members.map(m => m.from));
        const chainTo = Math.max(...members.map(m => m.to));
        const memberIds = members.map(m => m.id);

        const info: ChainInfo = { chainFrom, chainTo, memberIds };
        for (const m of members) {
            result.set(m.id, info);
        }
    }

    return result;
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

const LOD_MIN_PX = 30;
const LOD_FADE_PX = 60;

/**
 * The tick span a point-like segment is drawn as, so it responds to zoom
 * naturally: invisible when zoomed out, visible when zoomed in.
 */
export function pointSpanFallback(segments: Segment[]): number {
    const spans = segments.map(s => s.to - s.from).filter(s => s > 0);
    if (spans.length === 0) return 0;
    spans.sort((a, b) => a - b);
    return spans[Math.floor(spans.length / 4)]; // first quartile
}

/**
 * How opaque each segment is at this zoom: small gestures fade out as the view
 * pulls back, so what is left reads at a glance.
 *
 * A chain fades as one gesture. Its members share the chain's extent and the
 * opacity that follows from it, so zooming out never leaves half a chain
 * standing while the rest of it has gone.
 */
export function computeLodOpacities(params: {
    segments: Segment[];
    chains: Map<string, ChainInfo>;
    stretchX: number;
    minPointSpan: number;
}): Map<string, number> {
    const { segments, chains, stretchX, minPointSpan } = params;

    type LodUnit = { ids: string[]; from: number; to: number };
    const units: LodUnit[] = [];
    const seenChains = new Set<ChainInfo>();
    for (const s of segments) {
        const chain = chains.get(s.id);
        if (!chain) {
            units.push({ ids: [s.id], from: s.from, to: s.to });
            continue;
        }
        if (seenChains.has(chain)) continue;
        seenChains.add(chain);
        units.push({ ids: chain.memberIds, from: chain.chainFrom, to: chain.chainTo });
    }

    const map = new Map<string, number>();
    const opacityOf = new Map<LodUnit, number>();
    for (const unit of units) {
        const effectiveSpan = unit.to > unit.from ? unit.to - unit.from : minPointSpan;
        const pixelWidth = effectiveSpan * stretchX;
        const opacity = Math.min(1, Math.max(0, (pixelWidth - LOD_MIN_PX) / (LOD_FADE_PX - LOD_MIN_PX)));
        opacityOf.set(unit, opacity);
        for (const id of unit.ids) map.set(id, opacity);
    }

    // Ensure gap-free coverage: force the largest units visible
    // so every part of the timeline covered by any segment stays filled.
    // Only count fully-opaque units as reliable coverage — units with
    // partial LOD opacity (barely above threshold) render nearly invisible
    // and must not block the gap-fill from showing a proper segment.
    const sorted = [...units].sort((a, b) => (b.to - b.from) - (a.to - a.from));
    const covered: { from: number; to: number }[] = [];
    for (const unit of sorted) {
        if ((opacityOf.get(unit) ?? 0) >= 1) covered.push({ from: unit.from, to: unit.to });
    }
    for (const unit of sorted) {
        if ((opacityOf.get(unit) ?? 0) >= 1) continue;
        if (!isRangeFullyCovered(unit.from, unit.to, covered)) {
            opacityOf.set(unit, 1);
            for (const id of unit.ids) map.set(id, 1);
            covered.push({ from: unit.from, to: unit.to });
        }
    }

    return map;
}

/**
 * The span as drawn: the same gesture, widened when it would otherwise be a point.
 *
 * A span with no extent — a date-based gesture, or one that inherited a segment
 * that is itself a single point — would collapse onto the segment edge where the
 * onion envelope is zero, and be invisible. Extend the lane backwards, never the
 * segment: the segment's range is what the intensity curve is built from.
 */
export function laneOf(span: Span, segmentFrom: number, segmentTo: number): Span {
    if (span.from < span.to) return span;
    if (segmentTo > segmentFrom) {
        const minSpan = Math.max(1, Math.round((segmentTo - segmentFrom) * 0.2));
        return { ...span, from: Math.max(segmentFrom, span.to - minSpan) };
    }
    return { ...span, from: span.to - 1 };
}
