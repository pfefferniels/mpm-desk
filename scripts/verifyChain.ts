/**
 * Run the real reconstruction and check it against a recorded projection.
 *
 * Deriving the tree on load rather than baking it is only sound if the chain gives the same answer
 * twice. It does — the two fitters that anneal draw from a seeded RNG, pinned by
 * `tests/fitting/determinism.test.ts` — and this is what says the derivation still lands where it
 * did. The fixture it compares against was produced by a different pipeline on a different day,
 * which is what makes the comparison worth anything.
 *
 * It goes through `runFit`, the same fold the editor's worker runs, so what is checked is what
 * ships.
 *
 *     npx vite-node scripts/verifyChain.ts
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// `asMSM` reads the MEI with the platform `DOMParser`, which is the right thing in the browser
// and absent in node. A script-only shim; the app supplies the real one.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).DOMParser ??= new JSDOM().window.DOMParser;

import { convertMeiToMsm } from 'espressivo';
import { runFit } from '../src/fitting/fit';
import { asMSM } from '../src/fitting/asMSM';
import { parseWorkFile } from '../src/model/Work';
import { getTransformerOrder } from '../src/fitting/transformers/TransformerRegistry';

const BAKED = 'src/test/fixtures/segments.json';

const order = getTransformerOrder();
console.log(`registered: ${String(order.length)} — ${order.join(', ')}`);

const mei = readFileSync('public/transcription.mei', 'utf-8');
const work = parseWorkFile(readFileSync('public/work.json', 'utf-8'));
const alignment = asMSM(mei, convertMeiToMsm(mei)[0].msm);
console.log(
    `alignment notes: ${String(alignment.allNotes.length)} | pedals: ${String(alignment.pedals.length)}`,
);

// The chain is noisy about MSM parts it cannot match. That is a property of this fixture rather
// than of the run, and it drowns the result.
const say = console.log;
console.log = () => {};
const result = runFit(work, alignment);
console.log = say;

const { reconstruction, timing, projection, unknown } = result;
console.log(`calls: ${String(work.provenance.length)} | unknown: ${String(unknown.length)}`);
console.log(`chain ran in ${String(timing.chainMs)} ms`);
console.log(`residual: ${JSON.stringify(timing.residual)}`);
console.log(`projected segments: ${String(reconstruction.segments.length)}`);
console.log(`projection: ${JSON.stringify(projection)}`);
console.log(`mpm bytes: ${String(result.mpm.length)}`);

const tally = (segments: { spans: { type: string }[] }[]) => {
    const counts: Record<string, number> = {};
    for (const segment of segments)
        for (const span of segment.spans) counts[span.type] = (counts[span.type] ?? 0) + 1;
    return counts;
};

const baked = JSON.parse(readFileSync(BAKED, 'utf-8')) as {
    segments: { spans: { type: string }[] }[];
};
const expected = tally(baked.segments);
const actual = tally(reconstruction.segments);
console.log(`span types: ${JSON.stringify(actual)}`);

const failures: string[] = [];
if (unknown.length) failures.push(`unknown transformers: ${unknown.map((c) => c.name).join(', ')}`);
if (reconstruction.segments.length !== baked.segments.length)
    failures.push(
        `segments: ${String(reconstruction.segments.length)} derived vs ${String(baked.segments.length)} baked`,
    );
for (const type of new Set([...Object.keys(expected), ...Object.keys(actual)]))
    if (expected[type] !== actual[type])
        failures.push(
            `${type}: ${String(actual[type] ?? 0)} derived vs ${String(expected[type] ?? 0)} baked`,
        );

// One call belongs to no segment and always will: the substituted `InsertMetadata` writes
// `<metadata>`, not an instruction, so there is nothing for a segment to claim.
if (projection.ungroupedCalls !== 1)
    failures.push(`ungrouped calls: ${String(projection.ungroupedCalls)}, expected 1`);
if (projection.droppedElements !== 0)
    failures.push(`dropped elements: ${String(projection.droppedElements)}`);

// Every span leads with the MPM element it is named for. The selection model, the popover and
// the tree all key on this.
for (const segment of reconstruction.segments)
    for (const span of segment.spans)
        if (span.id !== span.elements[0])
            failures.push(`span ${span.id} does not lead with its own element`);

if (failures.length) {
    console.error('\nFAILED:');
    for (const failure of failures) console.error('  -', failure);
    process.exit(1);
}
console.log('\nOK — the live derivation reproduces the bake, span for span.');
