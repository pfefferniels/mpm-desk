/**
 * Write the three files the viewer loads, into the checkout of welte225.org.
 *
 * Run after any edit made outside the editor — a change to the chain, to a fitter, or to the MEI —
 * and commit there. The editor does the same thing on save, and `recordArtefacts.test.ts` fails
 * when the published files no longer match what the chain produces.
 *
 *     npx vite-node scripts/recordOutcomes.ts
 */
import { writeFileSync } from 'node:fs';
import { publishedPath } from '../src/test/published';
import { recordArtefacts } from './recordArtefacts';

const recorded = recordArtefacts();

const written = [
    { file: publishedPath('work'), text: recorded.work },
    { file: publishedPath('performance'), text: recorded.performance },
    { file: publishedPath('score'), text: recorded.score },
];
written.forEach(({ file, text }) => writeFileSync(file, text, 'utf-8'));

console.log(`${String(recorded.calls)} calls`);
console.log(`  ${String(recorded.withElements)} carry elements, ${String(recorded.withRange)} carry a range`);
console.log(`wrote ${written.map(({ file }) => file).join(', ')}`);
