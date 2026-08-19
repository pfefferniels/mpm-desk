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
