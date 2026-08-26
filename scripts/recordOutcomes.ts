/**
 * Run the chain and write what each call did back into the work file.
 *
 * `Call.elements` and `Call.range` cannot be worked out by a reader: `elements` is a diff over
 * the document before and after a call, and `range` needs the residual wherever a pedal is
 * involved. Recording them lets the viewer draw the tree from `work.json` and `performance.mpm`
 * alone, with no fitting code and no wait.
 *
 * Run after any edit made outside the editor. The editor does the same thing on save.
 *
 *     npx vite-node scripts/recordOutcomes.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// `asMSM` reads the MEI with the platform `DOMParser`, which node has not got.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).DOMParser ??= new JSDOM().window.DOMParser;

import { convertMeiToMsm } from 'espressivo';
import { runFit } from '../src/fitting/fit';
import { asMSM } from '../src/fitting/asMSM';
import { parseWorkFile, serializeWorkFile } from '../src/model/Work';

const WORK = 'public/work.json';
const MEI = 'public/transcription.mei';
const MPM = 'public/performance.mpm';
const SCORE = 'public/score.msm';

const mei = readFileSync(MEI, 'utf-8');
const work = parseWorkFile(readFileSync(WORK, 'utf-8'));
const scoreMsm = convertMeiToMsm(mei)[0].msm;

// The chain is noisy about MSM parts it cannot match; that is a property of the fixture.
const say = console.log;
console.log = () => undefined;
const result = runFit(work, asMSM(mei, scoreMsm));
console.log = say;

const outcomeById = new Map(result.outcomes.map((outcome) => [outcome.id, outcome]));
let withElements = 0;
let withRange = 0;

const provenance = work.provenance.map((call) => {
    const outcome = outcomeById.get(call.id);
    if (!outcome) return call;
    if (outcome.elements.length) withElements++;
    if (outcome.range) withRange++;
    return {
        ...call,
        ...(outcome.elements.length > 0 && { elements: [...outcome.elements] }),
        ...(outcome.range !== null && { range: outcome.range }),
    };
});

writeFileSync(WORK, serializeWorkFile({ ...work, provenance }), 'utf-8');
writeFileSync(MPM, result.mpm, 'utf-8');
writeFileSync(SCORE, scoreMsm, 'utf-8');

console.log(`${String(work.provenance.length)} calls`);
console.log(`  ${String(withElements)} carry elements, ${String(withRange)} carry a range`);
console.log(`wrote ${WORK}, ${MPM}, ${SCORE}`);
