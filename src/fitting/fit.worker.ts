/**
 * The fit, off the main thread.
 *
 * A refit of the shipped reconstruction takes about three seconds — 494 calls over 900 aligned
 * notes — so it cannot run where the tree is drawn. What crosses is what {@link runFit} already
 * produces: plain data, with the MPM as XML, because espressivo's document is a live tree and
 * structured clone cannot carry one.
 *
 * ## The alignment is built here, once
 *
 * The MEI and the score MSM cross as text on the first message and the alignment is built and
 * kept. It is expensive to build and it is not plain data, so shipping it per run would cost
 * more than the run. The chain writes *through* it — `MakeChoice` and `Modify` edit the
 * observations, `InsertTempo` shifts every onset to the first — so each run starts from a fresh
 * deep clone of the pristine one, and a run can never inherit the previous run's edits. That is
 * what makes the result a function of the chain alone.
 *
 * ## Staleness
 *
 * Every request carries an id and every reply echoes it. The editor drops a reply whose id is
 * not the one it is waiting for: a fit that takes three seconds will routinely be overtaken by
 * the next edit, and the older answer is not merely late, it is wrong. There is no cancellation —
 * the worker is single-threaded and a running fold cannot be interrupted — so the guard is on
 * the receiving side, which is the only place it can be.
 */
import type { WorkFile } from '../model/Work';
import { runFit, ChainInvalidError, type FitResult } from './fit';
import { Alignment } from './alignment';

/**
 * The alignment, flattened.
 *
 * It is built on the main thread and sent here rather than built here, and that is not an
 * accident of layering: `asMSM` reads the MEI with the platform `DOMParser`, which is a Window
 * API — **a worker does not have one**. The alternative parsers do not help either; xmldom has no
 * `querySelectorAll`, which is what the alignment reader is written against.
 *
 * So the reading happens where the DOM is, and what crosses is the result: three plain fields
 * that `new Alignment(...)` is rebuilt from. This is the shape the previous pipeline's worker
 * used too, for the same reason.
 */
export interface AlignmentData {
    allNotes: Alignment['allNotes'];
    pedals: Alignment['pedals'];
    timeSignature: Alignment['timeSignature'];
}

export interface LoadMessage {
    type: 'load';
    requestId: number;
    alignment: AlignmentData;
}

export interface FitMessage {
    type: 'fit';
    requestId: number;
    work: WorkFile;
}

export type FitRequest = LoadMessage | FitMessage;

export type FitReply =
    | { type: 'loaded'; requestId: number; notes: number; pedals: number }
    | { type: 'fitted'; requestId: number; result: FitResult }
    | { type: 'chain-invalid'; requestId: number; problems: readonly string[] }
    | { type: 'error'; requestId: number; message: string };

/**
 * The alignment as it arrived, never run over.
 *
 * Held rather than rebuilt because building it parses the whole MEI; cloned rather than reused
 * because the chain writes through it.
 */
let pristine: Alignment | null = null;

const post = (reply: FitReply) => {
    self.postMessage(reply);
};

self.onmessage = (event: MessageEvent<FitRequest>) => {
    const message = event.data;
    try {
        if (message.type === 'load') {
            pristine = new Alignment(message.alignment.allNotes, message.alignment.timeSignature);
            pristine.pedals = message.alignment.pedals;
            post({
                type: 'loaded',
                requestId: message.requestId,
                notes: pristine.allNotes.length,
                pedals: pristine.pedals.length,
            });
            return;
        }

        if (message.type === 'fit') {
            if (!pristine) throw new Error('fit requested before the alignment was loaded');
            const result = runFit(message.work, pristine.deepClone());
            post({ type: 'fitted', requestId: message.requestId, result });
        }
    } catch (error) {
        if (error instanceof ChainInvalidError) {
            post({
                type: 'chain-invalid',
                requestId: message.requestId,
                problems: error.problems,
            });
            return;
        }
        post({
            type: 'error',
            requestId: message.requestId,
            message: error instanceof Error ? error.message : String(error),
        });
    }
};
