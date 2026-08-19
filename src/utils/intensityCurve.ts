import type { Segment } from "../model/Reconstruction";

function bridgeToZeroLinear(curve: number[]): number[] {
    const n = curve.length;
    if (n === 0) return [];
    if (n === 1) return [0];

    const end = curve[n - 1];
    return curve.map((v, i) => {
        const t = i / (n - 1);
        const drift = t * end;
        return v - drift;
    });
}

function minMaxScale01(values: number[]): number[] {
    if (values.length === 0) return [];
    // Avoid spread operator to prevent stack overflow with large arrays
    let min = values[0];
    let max = values[0];
    for (let i = 1; i < values.length; i++) {
        if (values[i] < min) min = values[i];
        if (values[i] > max) max = values[i];
    }
    const r = max - min;
    if (r === 0) return values.map(() => 0);
    return values.map(v => (v - min) / r);
}

/**
 * Downsample an array by picking every step-th element,
 * always including the first and last elements.
 */
function downsample(values: number[], maxPoints: number): { values: number[]; step: number } {
    if (values.length <= maxPoints) return { values, step: 1 };
    const step = Math.ceil(values.length / maxPoints);
    const result: number[] = [];
    for (let i = 0; i < values.length; i += step) {
        result.push(values[i]);
    }
    // Always include the very last point
    if ((values.length - 1) % step !== 0) {
        result.push(values[values.length - 1]);
    }
    return { values: result, step };
}

const MAX_CURVE_POINTS = 2000;

export type IntensityCurve = {
    /** Downsampled 0..1 intensity values for rendering */
    values: number[];
    /** Step size used for downsampling (1 = no downsampling) */
    step: number;
    /** Original full-resolution length (= maxDate) */
    fullLength: number;
};

/**
 * Sum every segment into one curve of rising and falling intensity.
 *
 * Each segment contributes a half-sine bump: upwards for `intensify`/`move`,
 * downwards for `relax`/`calm`, and taller the longer it lasts. The sum is
 * integrated, de-trended and scaled to 0..1, so the curve reads as a shape
 * rather than as a stack of individual claims.
 */
export const negotiateIntensityCurve = (
    segments: Segment[],
    maxDate: number,
    lodWeights?: Map<string, number>,
): IntensityCurve => {
    // Index: MPM element type → sorted start dates, to bound point-like segments
    const startsByType = new Map<string, number[]>();
    for (const segment of segments) {
        for (const span of segment.spans) {
            let starts = startsByType.get(span.type);
            if (!starts) { starts = []; startsByType.set(span.type, starts); }
            starts.push(span.from);
        }
    }
    for (const starts of startsByType.values()) {
        starts.sort((a, b) => a - b);
    }

    const diff: number[] = new Array(maxDate).fill(0);
    for (const segment of segments) {
        const lodWeight = lodWeights?.get(segment.id) ?? 1;
        if (lodWeight === 0) continue;

        // sign: positive = increase, negative = decrease
        // gain: strong (1.0) vs gentle (0.5)
        let sign: number;
        let gain: number;
        switch (segment.motivation) {
            case "intensify": sign = +1; gain = 1.0; break;
            case "move":      sign = +1; gain = 0.5; break;
            case "relax":     sign = -1; gain = 1.0; break;
            case "calm":      sign = -1; gain = 0.5; break;
            default: continue;
        }

        const start = segment.from;
        let length = Math.max(200, segment.to - start + 1);

        // A segment that acts on a single point has no length of its own; give it
        // one, clamped to where the next segment of the same type takes over.
        if (segment.to === segment.from) {
            let nextStart = Infinity;
            for (const span of segment.spans) {
                const starts = startsByType.get(span.type);
                if (!starts) continue;
                // Find first start strictly after current start
                for (const s of starts) {
                    if (s > start && s < nextStart) { nextStart = s; break; }
                }
            }
            if (nextStart < start + length) {
                length = nextStart - start;
            }
        }

        if (length === 1) continue;

        for (let idx = 0; idx < length; idx++) {
            const i = start + idx;
            if (!Number.isInteger(i) || i < 0 || i >= diff.length) {
                continue;
            }

            const t = idx / (length - 1);
            const weight = Math.sin(Math.PI * t) * Math.sqrt(length) * gain;
            diff[i] += sign * weight * lodWeight;
        }
    }

    // Pre-allocate array for better performance
    const curve = new Array<number>(diff.length);
    let current = 0;
    for (let i = 0; i < diff.length; i++) {
        current += diff[i];
        curve[i] = current;
    }

    const bridged = bridgeToZeroLinear(curve);
    const scaled = minMaxScale01(bridged);
    const { values, step } = downsample(scaled, MAX_CURVE_POINTS);
    return { values, step, fullLength: scaled.length };
}

export function applyExaggeration(curve: IntensityCurve, exag: number): IntensityCurve {
    if (exag === 1.0) return curve;
    const invExag = 1 / exag;
    return {
        ...curve,
        values: curve.values.map(v => {
            const d = v - 0.5;
            if (d === 0) return 0.5;
            const sign = d > 0 ? 1 : -1;
            return 0.5 + sign * Math.pow(Math.abs(d), invExag);
        }),
    };
}

/**
 * Zoom-dependent local renormalization: amplifies local curve variations as the
 * user zooms in. Each point is renormalized relative to a local neighborhood
 * whose size shrinks with zoom. This is scroll-independent — the same tick
 * always maps to the same value for a given stretchX.
 *
 * stretchX here is the symbolic zoom (physicalSlider / 200), typically 0.005–0.3.
 * Below NO_EFFECT_STRETCH the window covers the full curve (= global normalization).
 * Above it, the window shrinks proportionally and a blend factor increases.
 *
 * Uses an O(n) monotone-deque sliding window for min/max computation.
 */
export function applyLocalRenormalization(curve: IntensityCurve, stretchX: number): IntensityCurve {
    const { values } = curve;
    const n = values.length;
    if (n === 0) return curve;

    // At/below this symbolic stretchX (≈ slider position 5), the window covers
    // the full curve so local = global = no visible change.
    const NO_EFFECT_STRETCH = 0.025;
    const windowFraction = Math.min(1, NO_EFFECT_STRETCH / stretchX);
    const W = Math.max(Math.floor(n * 0.05), Math.floor(n * windowFraction));

    // If window covers the full curve, local = global → skip
    if (W >= n) return curve;

    // Blend: 0 when W=n (fully global), caps at 0.9 to preserve some global context.
    const blend = Math.min(0.9, 1 - W / n);

    // O(n) sliding window min/max using monotone deques.
    // For a centered window [i-W, i+W], we split into two half-windows and combine:
    //   - "right min/max": sliding min/max over [i, i+W] computed right-to-left
    //   - "left min/max": sliding min/max over [i-W, i] computed left-to-right
    //   - centered min = min(left_min, right_min), same for max
    const leftMin = new Float64Array(n);
    const leftMax = new Float64Array(n);
    const rightMin = new Float64Array(n);
    const rightMax = new Float64Array(n);

    // Right pass: for each i, compute min/max of values[i..min(n-1, i+W)]
    // Process right-to-left with a deque of size W+1
    {
        const dqMin: number[] = []; // indices, front = index of minimum
        const dqMax: number[] = [];
        for (let i = n - 1; i >= 0; i--) {
            // Remove elements outside window [i, i+W]
            while (dqMin.length && dqMin[0] > i + W) dqMin.shift();
            while (dqMax.length && dqMax[0] > i + W) dqMax.shift();
            // Maintain monotonicity
            while (dqMin.length && values[dqMin[dqMin.length - 1]] >= values[i]) dqMin.pop();
            while (dqMax.length && values[dqMax[dqMax.length - 1]] <= values[i]) dqMax.pop();
            dqMin.push(i);
            dqMax.push(i);
            rightMin[i] = values[dqMin[0]];
            rightMax[i] = values[dqMax[0]];
        }
    }

    // Left pass: for each i, compute min/max of values[max(0, i-W)..i]
    // Process left-to-right with a deque of size W+1
    {
        const dqMin: number[] = [];
        const dqMax: number[] = [];
        for (let i = 0; i < n; i++) {
            while (dqMin.length && dqMin[0] < i - W) dqMin.shift();
            while (dqMax.length && dqMax[0] < i - W) dqMax.shift();
            while (dqMin.length && values[dqMin[dqMin.length - 1]] >= values[i]) dqMin.pop();
            while (dqMax.length && values[dqMax[dqMax.length - 1]] <= values[i]) dqMax.pop();
            dqMin.push(i);
            dqMax.push(i);
            leftMin[i] = values[dqMin[0]];
            leftMax[i] = values[dqMax[0]];
        }
    }

    // Combine and renormalize
    const result = new Array<number>(n);
    for (let i = 0; i < n; i++) {
        const min = leftMin[i] < rightMin[i] ? leftMin[i] : rightMin[i];
        const max = leftMax[i] > rightMax[i] ? leftMax[i] : rightMax[i];
        const range = max - min;
        const localValue = range > 0 ? (values[i] - min) / range : 0.5;
        result[i] = values[i] + blend * (localValue - values[i]);
    }

    return { ...curve, values: result };
}

export const asPathD = (curve: IntensityCurve, totalHeight: number, padTop = 8, padBottom = 8): string => {
    const { values, step } = curve;
    if (values.length === 0) return "";

    const availableHeight = Math.max(1, totalHeight - padTop - padBottom);

    // scaled=0 => bottom, scaled=1 => top
    const toY = (s: number) => padTop + (1 - s) * availableHeight;

    // Use array join instead of string concatenation (O(n) vs O(n²))
    const parts = new Array<string>(values.length);
    parts[0] = `M ${0} ${toY(values[0])}`;
    for (let i = 1; i < values.length; i++) {
        const x = i * step;
        parts[i] = `L ${x} ${toY(values[i])}`;
    }
    return parts.join(' ');
}
