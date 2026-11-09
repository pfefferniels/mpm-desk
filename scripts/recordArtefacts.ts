/**
 * The three files welte225.org publishes beside the MEI, produced from the MEI and the work file
 * as published.
 *
 * `performance.mpm` and `score.msm` are what the chain and the conversion make of the MEI, and
 * the landing page reads them without running either. `Call.elements` and `Call.range` cannot be
 * worked out by a reader either: `elements` is a diff over the document before and after a call,
 * and `range` needs the residual wherever a pedal is involved. That is what makes the three a
 * build output rather than a source, and what `recordOutcomes.ts` writes and
 * `recordArtefacts.test.ts` checks has not gone stale.
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
import { publishedPath } from '../src/test/published';

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
    const mei = readFileSync(publishedPath('mei'), 'utf-8');
    const work = parseWorkFile(readFileSync(publishedPath('work'), 'utf-8'));
    const movement = convertMeiToMsm(mei)[0];
    const score = movement.msm;

    // The chain is noisy about MSM parts it cannot match; that is a property of the fixture.
    const say = console.log;
    console.log = () => undefined;
    const result = runFit(work, asMSM(mei, score, movement.graces));
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
