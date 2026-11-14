/**
 * Turn the published reconstruction's pedal ramps into lines and traces, in a checkout of
 * welte225.org. What is made of each ramp, and why, is in `pedalRamps.ts`.
 *
 * Run once, then `recordOutcomes.ts` to record what the chain makes of the result, and commit
 * both there:
 *
 *     npx vite-node scripts/migratePedalRamps.ts
 *     npx vite-node scripts/recordOutcomes.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseWorkFile, serializeWorkFile } from '../src/model/Work';
import { publishedPath } from '../src/test/published';
import { migratePedalRamps } from './pedalRamps';

const path = publishedPath('work');
const { work, presses } = migratePedalRamps(
    parseWorkFile(readFileSync(path, 'utf-8')),
    readFileSync(publishedPath('mei'), 'utf-8'),
);
if (presses.length === 0) {
    console.log(`${path} has no ramps left; nothing to do`);
    process.exit(0);
}
writeFileSync(path, serializeWorkFile(work), 'utf-8');

const moved = presses.filter((press) => press.onsetChange !== 0);
const worst = presses.reduce((a, b) => (b.worstTickError > a.worstTickError ? b : a));
console.log(`${String(presses.length)} presses: ${String(presses.length * 2)} ramps became a line and a trace each`);
const changes = moved.map((p) => p.onsetChange);
console.log(`  ${String(moved.length)} onsets moved, by ${String(Math.min(...changes))} to ${String(Math.max(...changes))} ms`);
console.log(`  ramp ends within ${worst.worstTickError.toFixed(2)} ticks of the shortcut's (${worst.pedal})`);
for (const press of presses.filter((p) => p.unrenderedDown)) {
    console.log(`  ${press.pedal}: its ramp down starts before the score, where nothing is rendered; the line steps down where it arrives`);
}
console.log(`wrote ${path}; now run scripts/recordOutcomes.ts`);
