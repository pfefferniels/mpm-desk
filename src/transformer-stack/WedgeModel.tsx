// WedgeModel.ts
import { Argumentation, getRange, Transformer } from "mpmify/lib/transformers/Transformer";
import { MSM } from "mpmify";

function normalize(vx: number, vy: number): { x: number; y: number } {
    const len = Math.hypot(vx, vy);
    if (len === 0) return { x: 0, y: 0 };
    return { x: vx / len, y: vy / len };
}

/**
 * Approximate unit normal at curvePoints[i] using neighbors.
 * Normal is perpendicular to local tangent.
 */
function curveNormal(curvePoints: CurvePoint[], i: number): { x: number; y: number } {
    const n = curvePoints.length;
    if (n < 2) return { x: 0, y: -1 };

    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);

    const dx = curvePoints[i1].x - curvePoints[i0].x;
    const dy = curvePoints[i1].y - curvePoints[i0].y;

    // normal = (-dy, dx)
    return normalize(-dy, dx);
}

export type Side = "above" | "below";

export type Point = { x: number; y: number };

type CurvePoint ={ x: number; y: number; i: number };

export type BBox = { x: number; y: number; w: number; h: number };

export type WedgeModel = {
    argumentationId: string;
    argumentation: Argumentation;
    transformers: Transformer[];

    range: { from: number; to: number };
    side: Side;

    /**
     * Base interval for level assignment (SVG x-coordinates).
     * These define the “foot” of the triangle along the curve.
     */
    baseX1: number;
    baseX2: number;

    /**
     * Anchor y coordinate on the curve (typically the mid-point y).
     * Used to move the wedge tip away from the curve based on level.
     */
    midY: number;

    /**
     * Assigned by level algorithm (Step 4).
     * 0 is closest to the curve, 1 further, etc.
     */
    level: number;

    /**
     * Triangle polygon points in SVG coordinates.
     * Convention: [leftBase, rightBase, tip]
     */
    polygon: [Point, Point, Point];

    tip: Point;
    bbox: BBox;
};

function clamp(n: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, n));
}

function bboxFromPoints(points: Array<Point>): BBox {
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
        x: minX,
        y: minY,
        w: Math.max(1, maxX - minX),
        h: Math.max(1, maxY - minY),
    };
}

/**
 * Convert scaled intensity values (0..1) to SVG curve points.
 */
export function computeCurvePoints(params: {
    scaled: number[];
    stretchX: number;
    totalHeight: number;
    padTop?: number;
    padBottom?: number;
    heightDivisor?: number; // e.g. 6 to compress the curve vertically
}): CurvePoint[] {
    const {
        scaled,
        stretchX,
        totalHeight,
        padTop = 8,
        padBottom = 8,
        heightDivisor = 1,
    } = params;

    if (scaled.length === 0) return [];

    const availableHeight = Math.max(1, totalHeight - padTop - padBottom) / heightDivisor;
    const toY = (s: number) => padTop + (1 - s) * availableHeight;

    return scaled.map((s, i) => ({
        i,
        x: i * stretchX,
        y: toY(s),
    }));
}

/**
 * Build wedge models with initial (level=0) geometry.
 * You can subsequently call:
 *   assignWedgeLevels(wedges, "above"/"below")
 *   applyWedgeLevelGeometry(wedges, { baseAmplitude, levelSpacing })
 */
export function computeWedgeModels(params: {
    argumentations: Map<Argumentation, Transformer[]>;
    msm: MSM;
    curvePoints: CurvePoint[];
    baseAmplitude?: number; // level 0 distance from curve
    minWidthPx?: number;    // ensure very short intervals are still clickable/visible
}): WedgeModel[] {
    const {
        argumentations,
        msm,
        curvePoints,
        baseAmplitude = 30,
        minWidthPx = 32,
    } = params;

    const n = curvePoints.length;
    if (n === 0) return [];

    const wedges: WedgeModel[] = [];

    for (const [argumentation, localTransformers] of argumentations) {
        const r = getRange(localTransformers, msm);
        if (!r) continue;

        const from = clamp(r.from, 0, n - 1);
        const to = clamp(((r.to ?? r.from) || from + 360), 0, n - 1);

        const motivation = argumentation.conclusion.motivation;
        const side: Side = (motivation === "intensify" || motivation === 'move') ? "above" : "below";

        const leftIndex = Math.min(from, to);
        const rightIndex = Math.max(from, to);
        const midIndex = Math.floor((leftIndex + rightIndex) / 2);

        const left = curvePoints[leftIndex];
        const right = curvePoints[rightIndex];
        const mid = curvePoints[midIndex];

        // Skip if any curve point lookup failed (e.g., invalid range indices)
        if (!left || !right || !mid) continue;

        // Base interval in x (ensure min width)
        let baseX1 = Math.min(left.x, right.x);
        let baseX2 = Math.max(left.x, right.x);
        if (baseX2 - baseX1 < minWidthPx) {
            const cx = (baseX1 + baseX2) / 2;
            baseX1 = cx - minWidthPx / 2;
            baseX2 = cx + minWidthPx / 2;
        }

        const midY = mid.y;

        // Initial geometry at level 0
        const level = 0;
        const amplitude = baseAmplitude + level * 0;

        const tipX = (baseX1 + baseX2) / 2;
        const tipY = side === "above" ? midY - amplitude : midY + amplitude;

        const polygon: [Point, Point, Point] = [
            { x: baseX1, y: left.y },
            { x: baseX2, y: right.y },
            { x: tipX, y: tipY },
        ];

        const bbox = bboxFromPoints(polygon);
        const tip = { x: tipX, y: tipY };

        wedges.push({
            argumentationId: argumentation.id,
            argumentation,
            transformers: localTransformers,
            range: { from: leftIndex, to: rightIndex },
            side,
            baseX1,
            baseX2,
            midY,
            level,
            polygon,
            tip,
            bbox,
        });
    }

    return wedges;
}

/**
 * Optimal level assignment for intervals on a given side (above/below).
 * This is greedy coloring of an interval graph using a sweep line,
 * which is provably optimal for intervals.
 */
export function assignWedgeLevels(
    wedges: WedgeModel[],
    side: Side,
    opts?: { gapPx?: number }
): WedgeModel[] {
    const gapPx = opts?.gapPx ?? 0;

    // Sort by start x, then end x
    const items = wedges
        .filter(w => w.side === side)
        .slice()
        .sort((a, b) => a.baseX1 - b.baseX1 || a.baseX2 - b.baseX2);

    type Active = { level: number; end: number };

    // Simple min-heap for active intervals by earliest end
    class MinHeap<T> {
        private a: T[] = [];
        constructor(private less: (x: T, y: T) => boolean) { }
        get size() { return this.a.length; }
        peek() { return this.a[0]; }
        push(v: T) {
            this.a.push(v);
            this.up(this.a.length - 1);
        }
        pop(): T | undefined {
            if (!this.a.length) return undefined;
            const top = this.a[0];
            const last = this.a.pop()!;
            if (this.a.length) {
                this.a[0] = last;
                this.down(0);
            }
            return top;
        }
        private up(i: number) {
            while (i > 0) {
                const p = (i - 1) >> 1;
                if (!this.less(this.a[i], this.a[p])) break;
                [this.a[i], this.a[p]] = [this.a[p], this.a[i]];
                i = p;
            }
        }
        private down(i: number) {
            const n = this.a.length;

            let moved = true;
            while (moved) {
                moved = false;

                const l = i * 2 + 1;
                const r = l + 1;
                let m = i;

                if (l < n && this.less(this.a[l], this.a[m])) m = l;
                if (r < n && this.less(this.a[r], this.a[m])) m = r;

                if (m !== i) {
                    [this.a[i], this.a[m]] = [this.a[m], this.a[i]];
                    i = m;
                    moved = true;
                }
            }
        }
    }

    const active = new MinHeap<Active>((u, v) => u.end < v.end);
    const freeLevels = new MinHeap<number>((a, b) => a < b);

    let nextLevel = 0;

    for (const w of items) {
        // Release all levels whose interval ended before this starts
        while (active.size && (active.peek()!.end + gapPx) <= w.baseX1) {
            const done = active.pop()!;
            freeLevels.push(done.level);
        }

        const level = freeLevels.size ? freeLevels.pop()! : nextLevel++;
        w.level = level;

        active.push({ level, end: w.baseX2 });
    }

    return wedges;
}

/**
 * Simplified wedge geometry:
 * - Base points (polygon[0], polygon[1]) always stay ON the intensity curve
 * - Only the tip (polygon[2]) moves away from the curve based on level
 * - Level 0: tip at baseAmplitude distance
 * - Level N: tip at baseAmplitude + N * levelSpacing distance
 */
export function applyWedgeLevelGeometry(
    wedges: WedgeModel[],
    curvePoints: CurvePoint[],
    opts: {
        baseAmplitude: number;   // tip distance from curve for level 0
        levelSpacing: number;    // additional tip distance per level
    }
): WedgeModel[] {
    const { baseAmplitude, levelSpacing } = opts;

    return wedges.map(w => {
        const leftIdx = w.range.from;
        const rightIdx = w.range.to;

        const leftCurve = curvePoints[leftIdx];
        const rightCurve = curvePoints[rightIdx];

        // Guard against missing curve points
        if (!leftCurve || !rightCurve) {
            return w;
        }

        // Base points use EXACT curve point coordinates (not adjusted baseX1/baseX2)
        // This ensures they sit precisely on the rendered curve polyline vertices
        const p0: Point = {
            x: leftCurve.x,
            y: leftCurve.y,
        };

        const p1: Point = {
            x: rightCurve.x,
            y: rightCurve.y,
        };

        // Calculate tip position using curve normal at midpoint
        const midIdx = Math.floor((leftIdx + rightIdx) / 2);
        const midCurve = curvePoints[midIdx];
        const n = curveNormal(curvePoints, midIdx);

        // Direction: above = negative Y (up in SVG), below = positive Y (down)
        const dir = w.side === "above" ? -1 : 1;
        const nx = n.x * dir;
        const ny = n.y * dir;

        // Tip distance increases with level
        const tipDistance = baseAmplitude + w.level * levelSpacing;

        // Tip starts at curve midpoint (using exact curve coordinates), then moves away
        const tipX0 = (leftCurve.x + rightCurve.x) / 2;
        const tipY0 = midCurve?.y ?? w.midY;

        const tip: Point = {
            x: tipX0 + nx * tipDistance,
            y: tipY0 + ny * tipDistance,
        };

        const polygon: [Point, Point, Point] = [p0, p1, tip];
        const bbox = bboxFromPoints(polygon);

        return { ...w, polygon, bbox, tip };
    });
}
