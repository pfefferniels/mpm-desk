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
    const min = Math.min(...values);
    const max = Math.max(...values);
    const r = max - min;
    if (r === 0) return values.map(() => 0);
    return values.map(v => (v - min) / r);
}

export const negotiateIntensityCurve = (argumentations: Map<Argumentation, Transformer[]>, maxDate: number, msm: MSM) => {
    const diff: number[] = new Array(maxDate).fill(0);
    for (const [argumentation, localTransformers] of argumentations) {
        const range = getRange(localTransformers, msm);
        if (!range) continue;

        if (argumentation.conclusion.motivation === "intensification") {
            for (let i = range.from; i <= (range.to || range.from); i++) {
                if (!Number.isInteger(i) || i < 0 || i >= diff.length) {
                    continue;
                }
                diff[i] += 1;
            }
        }

        if (argumentation.conclusion.motivation === "relaxation") {
            for (let i = range.from; i <= (range.to || range.from); i++) {
                if (!Number.isInteger(i) || i < 0 || i >= diff.length) {
                    continue;
                }
                diff[i] -= 1;
            }
        }
    }

    const curve: number[] = [];
    let current = 0;
    for (let i = 0; i < diff.length; i++) {
        current += diff[i];
        curve.push(current);
    }

    const bridged = bridgeToZeroLinear(curve);
    return minMaxScale01(bridged);
}

export const asPathD = (scaled: number[], stretchX: number, totalHeight: number): string => {
    if (scaled.length === 0) return "";
    const padTop = 10;
    const padBottom = 10;

    const availableHeight = Math.max(1, totalHeight - padTop - padBottom);

    // scaled=0 => bottom, scaled=1 => top
    const toY = (s: number) => padTop + (1 - s) * availableHeight;

    let d = `M ${0} ${toY(scaled[0])}`;
    for (let i = 1; i < scaled.length; i++) {
        const x = i * stretchX;
        d += ` L ${x} ${toY(scaled[i])}`;
    }
    return d;
}