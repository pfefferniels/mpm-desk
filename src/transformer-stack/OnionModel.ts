import { Argumentation, getRange, Transformer } from "mpmify/lib/transformers/Transformer";
import { MSM } from "mpmify";
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
    subregion: OnionSubregion;
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
