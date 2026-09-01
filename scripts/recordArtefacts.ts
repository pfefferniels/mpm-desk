/**
 * The three files the viewer loads, produced from the MEI and the work file.
 *
 * `Call.elements` and `Call.range` cannot be worked out by a reader: `elements` is a diff over the
 * document before and after a call, and `range` needs the residual wherever a pedal is involved.
 * Recording them lets the viewer draw the tree from `work.json` and `performance.mpm` alone, with
 * no fitting code and no wait — which is what makes the three a build output rather than a source,
 * and what `recordOutcomes.ts` writes and `recordArtefacts.test.ts` checks has not gone stale.
 *
 * Nothing here writes. The script does that, and the test must not.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// `asMSM` reads the MEI with the platform `DOMParser`, which node has not got.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).DOMParser ??= new JSDOM().window.DOMParser;

import { convertMeiToMsm } from 'espressivo';
import { runFit } from '../src/fitting/fit';
import { asMSM } from '../src/fitting/asMSM';
import { parseWorkFile, serializeWorkFile } from '../src/model/Work';

export const RECORDED = {
    work: 'public/work.json',
    performance: 'public/performance.mpm',
    score: 'public/score.msm',
} as const;

const MEI = 'public/transcription.mei';

export interface Recorded {
    /** The work file with each call's outcome recorded on it. */
    work: string;
    /** The performance the chain wrote. */
    performance: string;
    /** The score, converted from the MEI. */
    score: string;
    calls: number;
    withElements: number;
    withRange: number;
}

export const recordArtefacts = (): Recorded => {
    const mei = readFileSync(MEI, 'utf-8');
    const work = parseWorkFile(readFileSync(RECORDED.work, 'utf-8'));
    const score = convertMeiToMsm(mei)[0].msm;

    // The chain is noisy about MSM parts it cannot match; that is a property of the fixture.
    const say = console.log;
    console.log = () => undefined;
    const result = runFit(work, asMSM(mei, score));
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

    return {
        work: serializeWorkFile({ ...work, provenance }),
        performance: result.mpm,
        score,
        calls: work.provenance.length,
        withElements,
        withRange,
    };
};
