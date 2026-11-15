/**
 * How often a written onset lies at each metrical level, over the scores of the corpus.
 *
 *     npx vite-node scripts/transcription/levels.ts <corpus dir>
 *
 * The numbers `src/alignment/transcription/grid.ts` starts from.
 */
import './node';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { levelOf, type Level } from '../../src/alignment/transcription/grid';
import { isCompound, readScore } from '../../src/alignment/transcription/scoreModel';
import { readManifest } from './corpus';

const dir = process.argv[2];
const seen = new Set<string>();
const simple = new Map<Level, number>();
const compound = new Map<Level, number>();

for (const pair of readManifest(dir)) {
    if (seen.has(pair.score)) continue;
    seen.add(pair.score);
    const mei = readFileSync(join(dir, 'mei', `${pair.score}.mei`), 'utf-8');
    const model = readScore(new DOMParser().parseFromString(mei, 'application/xml'));

    for (const measure of model.measures) {
        const onsets = new Set<number>();
        for (const staff of measure.staves) {
            for (const layer of staff.layers) {
                for (const event of layer.events) {
                    if (!event.grace && event.notes.length > 0) onsets.add(Math.round((event.onset - measure.onset) * 1e6) / 1e6);
                }
            }
        }
        const counts = isCompound(measure.meter) ? compound : simple;
        for (const onset of onsets) {
            const level = levelOf(onset, measure.meter);
            counts.set(level, (counts.get(level) ?? 0) + 1);
        }
    }
}

for (const [name, counts] of [['simple', simple], ['compound', compound]] as const) {
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    console.log(name, total, [...counts].sort((a, b) => a[0] - b[0]).map(([level, count]) => `${String(level)}: ${(count / total).toFixed(3)}`).join(', '));
}
