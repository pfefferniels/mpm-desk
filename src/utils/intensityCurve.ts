import { Argumentation, MSM, getRange, Transformer } from "mpmify";

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

export const negotiateIntensityCurve = (argumentations: Map<Argumentation, Transformer[]>, maxDate: number, msm: MSM): IntensityCurve => {
    const diff: number[] = new Array(maxDate).fill(0);
    for (const [argumentation, localTransformers] of argumentations) {
        const range = getRange(localTransformers, msm);
        if (!range) continue;

        const motivation = argumentation.conclusion.motivation;

        // sign: positive = increase, negative = decrease
        // gain: strong (1.0) vs gentle (0.5)
        let sign: number;
        let gain: number;
        switch (motivation) {
            case "intensify": sign = +1; gain = 1.0; break;
            case "move":      sign = +1; gain = 0.5; break;
            case "relax":     sign = -1; gain = 1.0; break;
            case "calm":      sign = -1; gain = 0.5; break;
            default: continue;
        }

        const start = range.from;
        const end = range.to ?? range.from;
        const length = Math.max(200, end - start + 1);

        if (length === 1) continue;

        for (let idx = 0; idx < length; idx++) {
            const i = start + idx;
            if (!Number.isInteger(i) || i < 0 || i >= diff.length) {
                continue;
            }

            const t = idx / (length - 1);
            const weight = Math.sin(Math.PI * t) * Math.sqrt(length) * gain;
            diff[i] += sign * weight;
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
