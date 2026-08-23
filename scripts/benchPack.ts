/**
 * How long the tree takes to lay out, over the files the app ships.
 *
 * `packLabels` runs on every zoom step, so it is the one piece of the render
 * that can make the whole view feel stuck.
 */
import { readFileSync } from 'node:fs';
import { containmentDepths, packLabels, pointSpanFallback, typeScale, LINE_HEIGHT_RATIO } from '../src/segment-stack/StackModel.ts';
import { wordFor, wordWidth } from '../src/segment-stack/words.ts';
import type { Reconstruction } from '../src/model/Reconstruction.ts';

const { segments } = JSON.parse(readFileSync('public/segments.json', 'utf-8')) as Reconstruction;
const minPointSpan = pointSpanFallback(segments);
const depths = containmentDepths(segments);

const run = (stretchX: number, fontScale: number) => {
    const sizes = typeScale({ segments, minPointSpan, fontScale, charsOf: s => wordFor(s).length });
    const t0 = performance.now();
    const labels = packLabels({
        segments,
        depths,
        minPointSpan,
        stretchX,
        metricsOf: s => {
            const fontSize = sizes.get(s.id) ?? 11;
            return { length: wordWidth(s, fontSize), lineHeight: fontSize * LINE_HEIGHT_RATIO };
        },
    });
    const ms = performance.now() - t0;
    const tiers = new Set(labels.map(l => Math.round(l.offset))).size;
    return { ms, tiers, maxOffset: Math.max(...labels.map(l => l.offset)) };
};

// The slider runs 1..60; symbolic zoom is that over 200.
for (const slider of [3, 6, 10, 16, 24, 40, 60]) {
    const { ms, tiers, maxOffset } = run(slider / 200, 1);
    console.log(`zoom ${String(slider).padStart(2)}  ${ms.toFixed(1).padStart(7)} ms   tiers ${String(tiers).padStart(3)}   furthest ${maxOffset.toFixed(0)}px`);
}
console.log('');
for (const exag of [1, 1.5, 2]) {
    const { ms, tiers } = run(3 / 200, exag);
    console.log(`exaggeration ${exag}  at fit zoom  ${ms.toFixed(1).padStart(7)} ms   tiers ${tiers}`);
}
