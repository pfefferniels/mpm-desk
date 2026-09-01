/**
 * Write the three files the viewer loads.
 *
 * Run after any edit made outside the editor — a change to the chain, to a fitter, or to the MEI.
 * The editor does the same thing on save, and `recordArtefacts.test.ts` fails when the shipped
 * files no longer match what the chain produces.
 *
 *     npx vite-node scripts/recordOutcomes.ts
 */
import { writeFileSync } from 'node:fs';
import { RECORDED, recordArtefacts } from './recordArtefacts';

const recorded = recordArtefacts();

writeFileSync(RECORDED.work, recorded.work, 'utf-8');
writeFileSync(RECORDED.performance, recorded.performance, 'utf-8');
writeFileSync(RECORDED.score, recorded.score, 'utf-8');

console.log(`${String(recorded.calls)} calls`);
console.log(`  ${String(recorded.withElements)} carry elements, ${String(recorded.withRange)} carry a range`);
console.log(`wrote ${RECORDED.work}, ${RECORDED.performance}, ${RECORDED.score}`);
