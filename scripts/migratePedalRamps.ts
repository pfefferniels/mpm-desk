/**
 * Turn a work file's pedal ramps into guided presses. What is made of each ramp, and why, is in
 * `pedalRamps.ts`.
 *
 * Reads the work file with the ramps and the performance the chain wrote from it, and writes the
 * migrated work file; then `recordOutcomes.ts` records what the chain makes of it:
 *
 *     npx vite-node scripts/migratePedalRamps.ts <work.json> <performance.mpm> <out.json>
 *     npx vite-node scripts/recordOutcomes.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseWorkFile, serializeWorkFile } from '../src/model/Work';
import { migratePedalRamps } from './pedalRamps';

// vite-node passes the script's own arguments after it, past its own.
const [input, performance, output] = process.argv.slice(-3);
if (!input?.endsWith('.json') || !performance?.endsWith('.mpm') || !output?.endsWith('.json')) {
    console.error('usage: migratePedalRamps <work.json> <performance.mpm> <out.json>');
    process.exit(1);
}

const { work, presses } = migratePedalRamps(
    parseWorkFile(readFileSync(input, 'utf-8')),
    readFileSync(performance, 'utf-8'),
);
writeFileSync(output, serializeWorkFile(work), 'utf-8');

const guides = presses.reduce((count, press) => count + press.guides.size, 0);
console.log(`${String(presses.length)} presses: ${String(presses.length * 2)} ramps became ${String(presses.length)} calls and ${String(guides)} guides`);
console.log(`${input} -> ${output}; now run scripts/recordOutcomes.ts`);
