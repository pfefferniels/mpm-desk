import { Argumentation, getRange, MSM, Transformer } from "mpmify";
import type { IntensityCurve } from "../utils/intensityCurve";

export type CurvePoint = { x: number; y: number; i: number };

export type OnionSubregion = {
    id: string;
    transformer: Transformer;
    from: number;
    to: number;
    type: string; // MPM element type (dynamics, tempo, ornament, articulation, etc.)
};

export type OnionRegion = {
    id: string;
    argumentation: Argumentation;
    transformers: Transformer[];
    subregions: OnionSubregion[];
    from: number;
    to: number;
};

export type OnionDragState = {
    subregion: OnionSubregion | null;  // null = region drag
    sourceRegionId: string;
    svgX: number;
    svgY: number;
    laneColor: string;
    dropTargetRegionId: string | null;
};

/**
 * Convert downsampled intensity curve to SVG curve points.
 * The `i` field stores the original tick index (not the array index).
 */
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
        i: idx * step,
        x: idx * step,
        y: toY(s),
    }));
}

/** Map a tick index to the nearest downsampled curve point index. */
export function tickToCurveIndex(tick: number, step: number): number {
    return Math.round(tick / step);
}

/**
 * Build OnionRegions from the argumentation→transformers grouping.
 * Each region corresponds to one argumentation group.
 * Each subregion corresponds to one transformer within that group,
 * typed by its primary MPM element type.
 */
export type ChainInfo = {
    chainFrom: number;   // earliest tick in the chain
    chainTo: number;     // latest tick in the chain
    memberIds: string[]; // ordered argumentation ids in the chain
};

/**
 * Walk `continue` links to group regions into chains.
 * Returns a map from region id → ChainInfo for chained regions only.
 */
export function buildChains(regions: OnionRegion[]): Map<string, ChainInfo> {
    const byId = new Map<string, OnionRegion>();
    for (const r of regions) byId.set(r.id, r);

    // successorOf[predId] = region whose argumentation.continue === predId
    const successorOf = new Map<string, OnionRegion>();
    for (const r of regions) {
        const predId = r.argumentation.continue;
        if (predId && byId.has(predId)) {
            successorOf.set(predId, r);
        }
    }

    const visited = new Set<string>();
    const result = new Map<string, ChainInfo>();

    for (const r of regions) {
        if (visited.has(r.id)) continue;

        // Walk back to find root
        let root = r;
        const seen = new Set<string>([r.id]);
        for (;;) {
            const predId = root.argumentation.continue;
            if (!predId || !byId.has(predId) || seen.has(predId)) break;
            root = byId.get(predId)!;
            seen.add(root.id);
        }

        // Walk forward from root
        const members: OnionRegion[] = [root];
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

export function buildRegions(
    argumentations: Map<Argumentation, Transformer[]>,
    msm: MSM,
    elementTypesByTransformer: Map<string, string[]>,
): OnionRegion[] {
    const regions: OnionRegion[] = [];

    for (const [argumentation, localTransformers] of argumentations) {
        const range = getRange(localTransformers, msm);
        if (!range) continue;

        const from = range.from;
        const to = range.to ?? range.from;

        const subregions: OnionSubregion[] = localTransformers.map(t => {
            const tRange = getRange(t.options, msm);
            const types = elementTypesByTransformer.get(t.id) ?? [];
            return {
                id: t.id,
                transformer: t,
                from: tRange?.from ?? from,
                to: tRange?.to ?? to,
                type: types[0] ?? t.name,
            };
        });

        regions.push({
            id: argumentation.id,
            argumentation,
            transformers: localTransformers,
            subregions,
            from,
            to,
        });
    }

    return regions;
}
