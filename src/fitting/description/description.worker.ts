/**
 * The describe desk's runs, off the main thread.
 *
 * Built like `fit.worker.ts`, and for its reasons: the alignment arrives once, flattened, and is
 * kept; every run starts from the alignment as it arrived; every request carries an id and every
 * reply echoes it. Which answers are still wanted is the client's to say (`client.ts`).
 */
import type { Call } from '../../model/Work';
import { Alignment } from '../alignment';
import type { AlignmentData } from '../fit.worker';
import {
    bringOut,
    describe,
    type BroughtOut,
    type DescribeRunOptions,
    type DescriptionRun,
} from './index';

export type DescriptionRequest =
    | { type: 'load'; requestId: number; alignment: AlignmentData }
    | {
          type: 'describe';
          requestId: number;
          calls: readonly Call[];
          trial?: DescribeRunOptions['trial'];
      }
    | {
          type: 'bring-out';
          requestId: number;
          run: { mpm: string; score: string };
          ids: readonly string[];
          factor: number;
          attenuation: number;
      };

export type DescriptionReply =
    | { type: 'loaded'; requestId: number; notes: number; pedals: number }
    | { type: 'described'; requestId: number; run: DescriptionRun }
    | { type: 'brought-out'; requestId: number; result: BroughtOut }
    | { type: 'error'; requestId: number; message: string };

/** The alignment as it arrived. `describe` copies it for each run. */
let pristine: Alignment | null = null;

const post = (reply: DescriptionReply) => {
    self.postMessage(reply);
};

self.onmessage = (event: MessageEvent<DescriptionRequest>) => {
    const message = event.data;
    const { requestId } = message;
    try {
        if (message.type === 'load') {
            pristine = new Alignment(message.alignment.allNotes, message.alignment.timeSignatures);
            pristine.pedals = message.alignment.pedals;
            pristine.graces = message.alignment.graces;
            pristine.tiedPrincipals = message.alignment.tiedPrincipals;
            post({
                type: 'loaded',
                requestId,
                notes: pristine.allNotes.length,
                pedals: pristine.pedals.length,
            });
        } else if (message.type === 'describe') {
            if (!pristine)
                throw new Error('a description was asked for before the alignment was loaded');
            const run = describe(pristine, message.calls, { trial: message.trial });
            post({ type: 'described', requestId, run });
        } else {
            const { run, ids, factor, attenuation } = message;
            post({
                type: 'brought-out',
                requestId,
                result: bringOut(run, ids, factor, attenuation),
            });
        }
    } catch (error) {
        post({
            type: 'error',
            requestId,
            message: error instanceof Error ? error.message : String(error),
        });
    }
};
