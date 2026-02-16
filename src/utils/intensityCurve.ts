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

export const negotiateIntensityCurve = (argumentations: Map<Argumentation, Transformer[]>, maxDate: number, msm: MSM) => {
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
    return minMaxScale01(bridged);
}

export const asPathD = (scaled: number[], stretchX: number, totalHeight: number, padTop = 8, padBottom = 8): string => {
    if (scaled.length === 0) return "";

    const availableHeight = Math.max(1, totalHeight - padTop - padBottom);

    // scaled=0 => bottom, scaled=1 => top
    const toY = (s: number) => padTop + (1 - s) * availableHeight;

    // Use array join instead of string concatenation (O(n) vs O(n²))
    const parts = new Array<string>(scaled.length);
    parts[0] = `M ${0} ${toY(scaled[0])}`;
    for (let i = 1; i < scaled.length; i++) {
        const x = i * stretchX;
        parts[i] = `L ${x} ${toY(scaled[i])}`;
    }
    return parts.join(' ');
}