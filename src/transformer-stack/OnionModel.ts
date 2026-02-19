import { Argumentation, getRange, Transformer } from "mpmify/lib/transformers/Transformer";
import { MSM } from "mpmify";

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
    subregion: OnionSubregion;
    sourceRegionId: string;
    svgX: number;
    svgY: number;
    laneColor: string;
    dropTargetRegionId: string | null;
};

/**
 * Convert scaled intensity values (0..1) to SVG curve points.
 */
export function computeCurvePoints(params: {
    scaled: number[];
    stretchX: number;
    totalHeight: number;
    padTop?: number;
    padBottom?: number;
}): CurvePoint[] {
    const {
        scaled,
        stretchX,
        totalHeight,
        padTop = 8,
        padBottom = 8,
    } = params;

    if (scaled.length === 0) return [];

    const availableHeight = Math.max(1, totalHeight - padTop - padBottom);
    const toY = (s: number) => padTop + (1 - s) * availableHeight;

    return scaled.map((s, i) => ({
        i,
        x: i * stretchX,
        y: toY(s),
    }));
}

/**
 * Build OnionRegions from the argumentation→transformers grouping.
 * Each region corresponds to one argumentation group.
 * Each subregion corresponds to one transformer within that group,
 * typed by its primary MPM element type.
 */
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
            const tRange = getRange(t, msm);
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

/**
 * Assign stacking levels to regions so overlapping ones get different offsets.
 * Greedy sweep-line: sort by start, reuse the lowest free level whose
 * previous interval has ended.
 */
export function assignRegionLevels(regions: OnionRegion[]): Map<string, number> {
    const sorted = [...regions].sort((a, b) => a.from - b.from || a.to - b.to);

    // active[level] = end of current interval on that level
    const active: number[] = [];
    const levels = new Map<string, number>();

    for (const r of sorted) {
        let assigned = -1;
        for (let l = 0; l < active.length; l++) {
            if (active[l] <= r.from) {
                assigned = l;
                break;
            }
        }
        if (assigned === -1) {
            assigned = active.length;
            active.push(0);
        }
        active[assigned] = r.to;
        levels.set(r.id, assigned);
    }

    return levels;
}
